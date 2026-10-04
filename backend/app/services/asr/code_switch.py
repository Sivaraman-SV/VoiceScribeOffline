"""Code-switching support for Tamil / Tanglish / English / Hinglish consultations.

Whisper decides the language once per 30-second window and then writes every
word in that language's script - or translates it. A consultation that moves
between Tamil, English and Hindi therefore comes out in one language for the
whole recording. The pieces here let the ASR providers work per utterance
instead:

* ``LanguagePolicy`` picks the language of one utterance, restricted to the
  languages the clinic actually speaks, with a little stickiness so a short
  "okay" does not flip a Tamil conversation to English.
* ``style_prompt`` gives Whisper a code-mixed example in the target language so
  English words stay in Latin script ("BP normal-ஆ இருக்கு") instead of being
  transliterated or translated.
* ``clean_asr_text`` repairs the output: English loanwords that Whisper still
  wrote in Tamil or Devanagari script go back to English, repetition loops are
  collapsed, and known Whisper hallucinations are dropped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Whisper confuses these with the languages the clinic speaks. Their probability
# is folded into the target so, for example, Hindi detected as Urdu is written in
# Devanagari rather than Perso-Arabic script.
_LANGUAGE_ALIASES: dict[str, str] = {
    "ur": "hi",
    "ml": "ta",
    "te": "ta",
    "kn": "ta",
    "si": "ta",
}

# Style examples only: code-mixed, clinically neutral (no symptoms, drugs or
# numbers), so that if Whisper ever echoes one it cannot invent a finding - and
# ``is_prompt_echo`` drops that echo anyway.
_STYLE_PROMPTS: dict[str, str] = {
    "ta": "சரி doctor, நான் சொல்றேன். Okay, அப்புறம் என்ன பண்ணணும்?",
    "hi": "हाँ doctor, मैं बताता हूँ। Okay, उसके बाद क्या करना है?",
    "te": "సరే doctor garu, నేను చెప్తాను. Okay, తర్వాత ఏం చేయాలి?",
    "en": "Okay doctor, let me explain. Right, so what should I do next?",
}


# Romanised vernacular and Indian-English idioms -> standard clinical English.
# Used to ground the LLM (only entries that occur in the transcript are sent)
# and by the anti-hallucination filter to accept translated claims. Keys are
# lowercase and matched as whole phrases.
CLINICAL_COLLOQUIALISMS: dict[str, str] = {
    # Hindi / Hinglish
    "sir dard": "headache",
    "sar dard": "headache",
    "sar mein dard": "headache",
    "sir mein dard": "headache",
    "chakkar": "dizziness / vertigo",
    "chakkar aa raha": "dizziness / vertigo",
    "pet dard": "abdominal pain",
    "pet mein dard": "abdominal pain",
    "bukhar": "fever",
    "khansi": "cough",
    "zukam": "coryza / common cold",
    "ulti": "vomiting",
    "dast": "diarrhoea",
    "kamzori": "generalised weakness",
    "saans phoolna": "breathlessness",
    "saans lene mein takleef": "breathlessness",
    "seene mein jalan": "heartburn",
    "chhati mein dard": "chest pain",
    "jor ka dard": "joint pain",
    "kamar dard": "low back pain",
    "neend nahi": "insomnia",
    "bhook nahi": "loss of appetite",
    "peshab mein jalan": "dysuria",
    # Tamil / Tanglish
    "thalai vali": "headache",
    "thalaivali": "headache",
    "thala vali": "headache",
    "thudikudhu": "throbbing pain",
    "kaichal": "fever",
    "kaachal": "fever",
    "juram": "fever",
    "irumal": "cough",
    "sali": "coryza / common cold",
    "nenju eri": "heartburn / dyspepsia",
    "nenju erichal": "heartburn / dyspepsia",
    "nenju vali": "chest pain",
    "vayiru vali": "abdominal pain",
    "vayiru eri": "epigastric burning",
    "vaanthi": "vomiting",
    "vaandhi": "vomiting",
    "mayakkam": "dizziness / giddiness",
    "thala suthuthu": "giddiness / vertigo",
    "moochu vaangudhu": "breathlessness",
    "udambu vali": "body ache / myalgia",
    "kaal vali": "leg pain",
    "mudhugu vali": "back pain",
    "thookam varala": "insomnia",
    "pasi illa": "loss of appetite",
    "vayitha vali": "abdominal pain",
    "vayithu vali": "abdominal pain",
    "padapadappu": "palpitations",
    "thummal": "sneezing",
    "valippu": "seizures",
    "manjal kamalai": "jaundice",
    "maathirai": "tablet",
    "mathirai": "tablet",
    "marundhu": "medicine",
    "oosi": "injection",
    "saapattukku munnadi": "before food",
    "sapadukku munnadi": "before food",
    "saapta apram": "after food",
    "sapta apram": "after food",
    "verum vayithula": "on an empty stomach",
    "rendu thadava": "twice",
    "moonu thadava": "three times",
    # Telugu / Telugu-English
    "thala noppi": "headache",
    "tala noppi": "headache",
    "kadupu noppi": "abdominal pain",
    "kadupulo noppi": "abdominal pain",
    "jwaram": "fever",
    "jvaram": "fever",
    "daggu": "cough",
    "jalubu": "coryza / common cold",
    "vantulu": "vomiting",
    "vanthulu": "vomiting",
    "kallu tiruguthunnayi": "giddiness / vertigo",
    "kallu tirugutunnayi": "giddiness / vertigo",
    "tala tirugudu": "giddiness / vertigo",
    "gunde noppi": "chest pain",
    "gunde manta": "heartburn",
    "ayasam": "breathlessness",
    "nadumu noppi": "low back pain",
    "ollu noppulu": "body ache / myalgia",
    "neerasam": "fatigue / weakness",
    "motions": "diarrhoea",
    # Indian-English idioms
    "gas trouble": "dyspepsia / gastritis",
    "gastric problem": "dyspepsia / gastritis",
    "acidity": "dyspepsia / acid reflux",
    "loose motions": "acute diarrhoea",
    "loose motion": "acute diarrhoea",
    "motion problem": "diarrhoea",
    "sugar problem": "diabetes mellitus",
    "sugar patient": "diabetes mellitus",
    "have sugar": "diabetes mellitus",
    "bp problem": "hypertension",
    "bp patient": "hypertension",
    "high bp": "hypertension",
    "low bp": "hypotension",
    "pressure problem": "hypertension",
    "giddiness": "dizziness",
    "body pain": "generalised body ache / myalgia",
    "cold tablet": "unspecified over-the-counter cold tablet",
    "fits": "seizures",
    "piles": "haemorrhoids",
    "jaundice": "jaundice",
    "heart problem": "cardiac history (unspecified)",
}

# The same vocabulary in Tamil and Devanagari script, which is what Whisper
# writes for Tamil and Hindi utterances. Matched as substrings so inflected
# forms (தலைவலியா, बुखार से) still count.
NATIVE_CLINICAL_TERMS: dict[str, str] = {
    # Tamil
    "தலைவலி": "headache",
    "தலை வலி": "headache",
    "காய்ச்சல்": "fever",
    "ஜுரம்": "fever",
    "இருமல்": "cough",
    "சளி": "coryza / common cold",
    "தொண்டை வலி": "sore throat",
    "வயிற்று வலி": "abdominal pain",
    "வயிறு வலி": "abdominal pain",
    "வாந்தி": "vomiting",
    "குமட்டல்": "nausea",
    "வயிற்றுப்போக்கு": "diarrhoea",
    "பேதி": "diarrhoea",
    "மலச்சிக்கல்": "constipation",
    "நெஞ்சு வலி": "chest pain",
    "நெஞ்செரிச்சல்": "heartburn",
    "மூச்சுத் திணறல்": "breathlessness",
    "மூச்சு திணறல்": "breathlessness",
    "தலைச்சுற்றல்": "giddiness / vertigo",
    "மயக்கம்": "dizziness / giddiness",
    "உடம்பு வலி": "body ache / myalgia",
    "உடல் வலி": "body ache / myalgia",
    "முதுகு வலி": "back pain",
    "மூட்டு வலி": "joint pain",
    "கால் வலி": "leg pain",
    "சோர்வு": "fatigue / weakness",
    "பசி இல்லை": "loss of appetite",
    "தூக்கம் இல்லை": "insomnia",
    "அரிப்பு": "itching",
    "வீக்கம்": "swelling",
    "சிறுநீர் எரிச்சல்": "dysuria",
    "இரத்த அழுத்தம்": "blood pressure",
    "ரத்த அழுத்தம்": "blood pressure",
    "சர்க்கரை நோய்": "diabetes mellitus",
    "ஒவ்வாமை": "allergy",
    "பல் வலி": "toothache",
    "காது வலி": "ear pain",
    "கண் வலி": "eye pain",
    "நெஞ்சு படபடப்பு": "palpitations",
    "படபடப்பு": "palpitations",
    "மரத்துப் போ": "numbness",
    "மரத்து போ": "numbness",
    "தும்மல்": "sneezing",
    "மூக்கு ஒழுகு": "rhinorrhoea / runny nose",
    "தொண்டை கரகரப்பு": "hoarseness",
    "வலிப்பு": "seizures",
    "மஞ்சள் காமாலை": "jaundice",
    "மாதவிடாய்": "menstruation",
    "வெள்ளைப்படு": "vaginal discharge",
    "கர்ப்பம்": "pregnancy",
    "சிறுநீர்": "urine",
    "மலம்": "stool",
    # Spoken Tamil, as ASR writes it for colloquial speech
    "காச்சல்": "fever",
    "தல வலி": "headache",
    "தலவலி": "headache",
    "வயித்து வலி": "abdominal pain",
    "வயித்துவலி": "abdominal pain",
    "வயிறு எரியுது": "epigastric burning",
    "நெஞ்சு எரியுது": "heartburn",
    "மூச்சு வாங்குது": "breathlessness",
    "மூச்சு விட முடியல": "breathlessness",
    "தலை சுத்து": "giddiness / vertigo",
    "தல சுத்து": "giddiness / vertigo",
    "உடம்பு சரியில்ல": "feeling unwell",
    "தூக்கம் வரல": "insomnia",
    "பசி எடுக்கல": "loss of appetite",
    "பசியே இல்ல": "loss of appetite",
    "பேதி ஆகுது": "diarrhoea",
    "மூட்டு வீக்கம்": "joint swelling",
    "கை கால் வலி": "limb pain",
    # Medicines and dosing instructions
    "மாத்திரை": "tablet",
    "மருந்து": "medicine",
    "ஊசி": "injection",
    "சாப்பாட்டுக்கு முன்": "before food",
    "சாப்பிடுறதுக்கு முன்": "before food",
    "சாப்பிட்ட பிறகு": "after food",
    "சாப்பிட்ட பின்": "after food",
    "சாப்பிட்டதுக்கு அப்புறம்": "after food",
    "வெறும் வயித்துல": "on an empty stomach",
    "வெறும் வயிற்றில்": "on an empty stomach",
    "ஒரு நாளைக்கு": "per day",
    "ரெண்டு தடவை": "twice",
    "இரண்டு தடவை": "twice",
    "மூணு தடவை": "three times",
    "மூன்று தடவை": "three times",
    "ராத்திரி": "night",
    "மதியம்": "afternoon",
    # Hindi
    "सिर दर्द": "headache",
    "सिरदर्द": "headache",
    "बुखार": "fever",
    "खांसी": "cough",
    "खाँसी": "cough",
    "जुकाम": "coryza / common cold",
    "ज़ुकाम": "coryza / common cold",
    "गले में दर्द": "sore throat",
    "गला खराब": "sore throat",
    "पेट दर्द": "abdominal pain",
    "पेट में दर्द": "abdominal pain",
    "उल्टी": "vomiting",
    "मतली": "nausea",
    "जी मिचलाना": "nausea",
    "दस्त": "diarrhoea",
    "कब्ज": "constipation",
    "सीने में दर्द": "chest pain",
    "छाती में दर्द": "chest pain",
    "सीने में जलन": "heartburn",
    "सांस फूलना": "breathlessness",
    "साँस फूलना": "breathlessness",
    "चक्कर": "dizziness / vertigo",
    "कमजोरी": "generalised weakness",
    "कमज़ोरी": "generalised weakness",
    "थकान": "fatigue",
    "बदन दर्द": "body ache / myalgia",
    "शरीर में दर्द": "body ache / myalgia",
    "कमर दर्द": "low back pain",
    "जोड़ों में दर्द": "joint pain",
    "जोड़ों का दर्द": "joint pain",
    "भूख नहीं": "loss of appetite",
    "नींद नहीं": "insomnia",
    "खुजली": "itching",
    "सूजन": "swelling",
    "पेशाब में जलन": "dysuria",
}

_COLLOQUIAL_RE = re.compile(
    r"\b(" + "|".join(re.escape(term) for term in sorted(CLINICAL_COLLOQUIALISMS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def colloquial_glossary(text: str) -> dict[str, str]:
    """Colloquial terms that occur in ``text`` mapped to their clinical English."""
    found: dict[str, str] = {}
    for match in _COLLOQUIAL_RE.finditer(text or ""):
        term = match.group(1).lower()
        found.setdefault(term, CLINICAL_COLLOQUIALISMS[term])
    for term, english in NATIVE_CLINICAL_TERMS.items():
        if term in (text or ""):
            found.setdefault(term, english)
    return found


def parse_languages(value: str | None) -> tuple[str, ...]:
    """``"ta, en ,hi"`` -> ``("ta", "en", "hi")``; empty means no restriction."""
    if not value:
        return ()
    return tuple(dict.fromkeys(part.strip().lower() for part in value.split(",") if part.strip()))


def style_prompt(language: str | None, override: str | None = None) -> str | None:
    if override:
        return override
    return _STYLE_PROMPTS.get(language or "en")


@dataclass
class LanguagePolicy:
    """Chooses one utterance's language from Whisper's language probabilities."""

    allowed: tuple[str, ...] = ("en",)
    # Whisper's language classifier leans English on code-mixed Indian speech
    # (English loanwords), so English must be clearly ahead to win ...
    english_threshold: float = 0.7
    # ... and an Indian language only needs a modest share to be decoded as such.
    indic_threshold: float = 0.15
    short_utterance_seconds: float = 2.0
    previous: str | None = None
    counts: dict[str, int] = field(default_factory=dict)
    # Normalised scores behind the last decision, read by the hybrid recogniser.
    last_scores: dict[str, float] = field(default_factory=dict)

    def choose(self, probabilities: list[tuple[str, float]], duration: float) -> tuple[str, float]:
        if not self.allowed or self.allowed == ("en",):
            self.previous = "en"
            self.last_scores = {"en": 1.0}
            return "en", 1.0
        scores: dict[str, float] = {}
        for language, probability in probabilities:
            target = language if not self.allowed or language in self.allowed else _LANGUAGE_ALIASES.get(language)
            if target is None or (self.allowed and target not in self.allowed):
                continue
            scores[target] = scores.get(target, 0.0) + probability

        if not scores:
            fallback = self.previous or (self.allowed[0] if self.allowed else "en")
            self.last_scores = {}
            return fallback, 0.0

        total = sum(scores.values()) or 1.0
        normalized = {language: score / total for language, score in scores.items()}
        self.last_scores = normalized
        indic = {language: score for language, score in normalized.items() if language != "en"}
        best_indic = max(indic, key=indic.__getitem__) if indic else None

        if normalized.get("en", 0.0) >= self.english_threshold:
            language = "en"
        elif best_indic and indic[best_indic] >= self.indic_threshold:
            language = best_indic
        else:
            language = max(normalized, key=normalized.__getitem__)

        # A short "okay" / "haan" carries too little audio to trust a switch.
        # Each decision depends only on this utterance and the one before it, so
        # a long consultation cannot drift into one language.
        if (
            duration < self.short_utterance_seconds
            and self.previous in normalized
            and self.previous != language
            and normalized[self.previous] >= 0.25
        ):
            language = self.previous

        self.previous = language
        self.counts[language] = self.counts.get(language, 0) + 1
        return language, round(normalized.get(language, 0.0), 4)

    def best_indic(self) -> str | None:
        """Most likely Indian language for the last utterance, if any scored."""
        indic = {language: score for language, score in self.last_scores.items() if language != "en"}
        return max(indic, key=indic.__getitem__) if indic else None


# --------------------------------------------------------------------------
# Output repair
# --------------------------------------------------------------------------

# English words Whisper writes in native script when it decodes a code-mixed
# utterance as Tamil or Hindi. Mapping them back keeps the transcript in the
# conventional code-mixed form and lets the English clinical NLP find them.
_TAMIL_LOANWORDS: dict[str, str] = {
    "டாக்டர்": "doctor",
    "பிரஷர்": "pressure",
    "பீபீ": "BP",
    "பிபி": "BP",
    "சுகர்": "sugar",
    "ஃபீவர்": "fever",
    "பீவர்": "fever",
    "டேப்லெட்": "tablet",
    "டேப்லட்": "tablet",
    "ஸ்கேன்": "scan",
    "டெஸ்ட்": "test",
    "ரிப்போர்ட்": "report",
    "ரிப்போர்ட்ஸ்": "reports",
    "இன்ஜெக்ஷன்": "injection",
    "இஞ்செக்ஷன்": "injection",
    "ஹாஸ்பிடல்": "hospital",
    "ஹாஸ்பிட்டல்": "hospital",
    "அலர்ஜி": "allergy",
    "டயபடீஸ்": "diabetes",
    "டயாபடீஸ்": "diabetes",
    "கொலஸ்ட்ரால்": "cholesterol",
    "தைராய்டு": "thyroid",
    "எக்ஸ்ரே": "X-Ray",
    "ஈசிஜி": "ECG",
    "பிளட்": "blood",
    "யூரின்": "urine",
    "செக்கப்": "checkup",
    "செக்அப்": "checkup",
    "டோஸ்": "dose",
    "சிரப்": "syrup",
    "ஆயின்மென்ட்": "ointment",
    "ஆபரேஷன்": "operation",
    "இன்ஃபெக்ஷன்": "infection",
    "இன்பெக்ஷன்": "infection",
    "ஹெட்டேக்": "headache",
    "ஹெட்ஏக்": "headache",
    "ஹெடேக்": "headache",
    "வாமிட்டிங்": "vomiting",
    "மோஷன்": "motion",
    "கோல்ட்": "cold",
    "கஃப்": "cough",
    "காஃப்": "cough",
    "பெயின்": "pain",
    "ஸ்ட்ரெஸ்": "stress",
    "ஃபாலோ": "follow",
    "ஃபாலோ அப்": "follow up",
    "நார்மல்": "normal",
    "அப்நார்மல்": "abnormal",
    "மெடிசின்": "medicine",
    "மெடிசின்ஸ்": "medicines",
    "டெம்பரேச்சர்": "temperature",
    "வெயிட்": "weight",
    "ஹார்ட்": "heart",
    "கிட்னி": "kidney",
    "லிவர்": "liver",
    "லங்ஸ்": "lungs",
    "பாராசிட்டமால்": "Paracetamol",
    "பாராசிடமால்": "Paracetamol",
    "டொலோ": "Dolo",
    "டோலோ": "Dolo",
    "செஸ்ட் பெயின்": "chest pain",
    "டிஸ்கம்ஃபோர்ட்": "discomfort",
    "ரிலீஃப்": "relief",
    "பிராப்ளம்": "problem",
    "ப்ராப்ளம்": "problem",
    "சிம்டம்ஸ்": "symptoms",
    "லைட்": "light",
    "சிவியர்": "severe",
    "சீரியஸ்": "serious",
    "கன்சல்டேஷன்": "consultation",
    "பிரஸ்கிரிப்ஷன்": "prescription",
    "ஆன்டிபயாடிக்": "antibiotic",
    "ஆன்டிபயாட்டிக்": "antibiotic",
    "கிளினிக்": "clinic",
    "நர்ஸ்": "nurse",
    "வார்டு": "ward",
    "ஐசியூ": "ICU",
    "ஐசியு": "ICU",
    "எமர்ஜென்சி": "emergency",
    "ஆக்ஸிஜன்": "oxygen",
    "ஆக்சிஜன்": "oxygen",
    # The Tamil-trained model (ASR_TAMIL_MODEL) writes every English word in Tamil
    # script, so Tanglish symptoms, tests, timing and common drugs are listed too.
    "ஷுகர்": "sugar",
    "லெவல்": "level",
    "கவுண்ட்": "count",
    "ப்ளட்": "blood",
    "இசிஜி": "ECG",
    "எக்கோ": "echo",
    "சிடி ஸ்கேன்": "CT scan",
    "சிட்டி ஸ்கேன்": "CT scan",
    "எம்ஆர்ஐ": "MRI",
    "அல்ட்ராசவுண்ட்": "ultrasound",
    "அல்ட்ரா சவுண்ட்": "ultrasound",
    "டேப்லெட்ஸ்": "tablets",
    "கேப்சூல்": "capsule",
    "இன்ஜக்ஷன்": "injection",
    "டிரிப்ஸ்": "drips",
    "டிரிப்": "drip",
    "கிட்டினஸ்": "giddiness",
    "கிடினஸ்": "giddiness",
    "டிஸினஸ்": "dizziness",
    "வீக்னஸ்": "weakness",
    "டயர்டு": "tired",
    "டயர்ட்": "tired",
    "ஸ்வெல்லிங்": "swelling",
    "வீசிங்": "wheezing",
    "பிரீத்திங்": "breathing",
    "ப்ரீத்திங்": "breathing",
    "ஆஸ்துமா": "asthma",
    "செஸ்ட்": "chest",
    "பேக் பெயின்": "back pain",
    "ஜாயின்ட் பெயின்": "joint pain",
    "ஜாயிண்ட் பெயின்": "joint pain",
    "லூஸ் மோஷன்": "loose motion",
    "கான்ஸ்டிபேஷன்": "constipation",
    "டயரியா": "diarrhea",
    "கேஸ் ட்ரபுள்": "gas trouble",
    "கேஸ்ட்ரிக்": "gastric",
    "அசிடிட்டி": "acidity",
    "அல்சர்": "ulcer",
    "ஹார்ட் அட்டாக்": "heart attack",
    "ஸ்ட்ரோக்": "stroke",
    "பீரியட்ஸ்": "periods",
    "பிரக்னன்சி": "pregnancy",
    "ப்ரெக்னன்சி": "pregnancy",
    "டெலிவரி": "delivery",
    "பிளேட்லெட்": "platelet",
    "பிளேட்லெட்ஸ்": "platelets",
    "ஹீமோகுளோபின்": "hemoglobin",
    "டெங்கு": "dengue",
    "டைபாய்டு": "typhoid",
    "மலேரியா": "malaria",
    "கோவிட்": "COVID",
    "இன்சுலின்": "insulin",
    "மெட்ஃபார்மின்": "Metformin",
    "மெட்பார்மின்": "Metformin",
    "ஆஸ்பிரின்": "Aspirin",
    "க்ரோசின்": "Crocin",
    "குரோசின்": "Crocin",
    "அட்மிட்": "admit",
    "டிஸ்சார்ஜ்": "discharge",
    "சர்ஜரி": "surgery",
    "ரிவ்யூ": "review",
    "டயட்": "diet",
    "எக்சர்சைஸ்": "exercise",
    "வாக்கிங்": "walking",
    "ஸ்மோக்கிங்": "smoking",
    "ஆல்கஹால்": "alcohol",
    "சிகரெட்": "cigarette",
    "ஹிஸ்டரி": "history",
    "டெய்லி": "daily",
    "மார்னிங்": "morning",
    "ஈவினிங்": "evening",
    "நைட்": "night",
    "பேஷண்ட்": "patient",
    "பேஷன்ட்": "patient",
    "ஓகே": "okay",
}

_HINDI_LOANWORDS: dict[str, str] = {
    "डॉक्टर": "doctor",
    "डाक्टर": "doctor",
    "प्रेशर": "pressure",
    "बीपी": "BP",
    "शुगर": "sugar",
    "फीवर": "fever",
    "टैबलेट": "tablet",
    "टेबलेट": "tablet",
    "स्कैन": "scan",
    "टेस्ट": "test",
    "रिपोर्ट": "report",
    "रिपोर्ट्स": "reports",
    "इंजेक्शन": "injection",
    "हॉस्पिटल": "hospital",
    "अस्पताल": "hospital",
    "एलर्जी": "allergy",
    "डायबिटीज": "diabetes",
    "डायबिटीज़": "diabetes",
    "कोलेस्ट्रॉल": "cholesterol",
    "थायराइड": "thyroid",
    "एक्स-रे": "X-Ray",
    "एक्सरे": "X-Ray",
    "ईसीजी": "ECG",
    "ब्लड": "blood",
    "यूरिन": "urine",
    "चेकअप": "checkup",
    "डोज": "dose",
    "डोज़": "dose",
    "सिरप": "syrup",
    "ऑपरेशन": "operation",
    "इन्फेक्शन": "infection",
    "इंफेक्शन": "infection",
    "हेडेक": "headache",
    "वोमिटिंग": "vomiting",
    "मोशन": "motion",
    "नॉर्मल": "normal",
    "नार्मल": "normal",
    "मेडिसिन": "medicine",
    "टेम्परेचर": "temperature",
    "वेट": "weight",
    "किडनी": "kidney",
    "लिवर": "liver",
    "फॉलो": "follow",
}

_TAMIL_BLOCK = "஀-௿"
_TAMIL_MARKS = "ஂஃா-்ௗ"
_DEVANAGARI_BLOCK = "ऀ-ॿ"
_DEVANAGARI_MARKS = "ऀ-ःऺ-ॏ॑-ॗॢॣ"


def _loanword_pattern(words: dict[str, str], block: str, marks: str) -> re.Pattern[str]:
    alternatives = "|".join(re.escape(word) for word in sorted(words, key=len, reverse=True))
    # A native-script word boundary: ``\b`` is unusable here because Python does
    # not treat Tamil/Devanagari vowel signs as word characters. The word must
    # not continue with a vowel sign (that would be a different inflection);
    # a following consonant is an attached suffix, captured separately.
    return re.compile(rf"(?<![{block}])({alternatives})(?![{marks}])([{block}]*)")


_TAMIL_LOANWORD_RE = _loanword_pattern(_TAMIL_LOANWORDS, _TAMIL_BLOCK, _TAMIL_MARKS)
_HINDI_LOANWORD_RE = _loanword_pattern(_HINDI_LOANWORDS, _DEVANAGARI_BLOCK, _DEVANAGARI_MARKS)


def romanize_loanwords(text: str) -> str:
    """``சுகர்ல`` -> ``sugar-ல``, ``बीपी`` -> ``BP``; native words are untouched."""

    def _swap(table: dict[str, str]):
        def _replace(match: re.Match[str]) -> str:
            english, suffix = table[match.group(1)], match.group(2)
            return f"{english}-{suffix}" if suffix else english

        return _replace

    text = _TAMIL_LOANWORD_RE.sub(_swap(_TAMIL_LOANWORDS), text)
    return _HINDI_LOANWORD_RE.sub(_swap(_HINDI_LOANWORDS), text)


# Whole-segment outputs Whisper produces on silence, music or noise (learned
# from subtitled video). Only exact matches are dropped - a patient saying
# "thank you" mid-sentence is kept.
_HALLUCINATIONS = {
    "thank you for watching",
    "thanks for watching",
    "thank you for watching.",
    "please subscribe",
    "please like and subscribe",
    "subscribe to my channel",
    "subtitles by the amara.org community",
    "you",
    "பார்த்ததற்கு நன்றி",
    "சப்ஸ்கிரைப் செய்யுங்கள்",
    "देखने के लिए धन्यवाद",
    "सब्सक्राइब करें",
}

_REPEATED_WORD_RE = re.compile(r"((\S+)[\s,]+)(?:\2[\s,]+){3,}", re.UNICODE)
_REPEATED_PHRASE_RE = re.compile(r"((?:\S+\s+){2,6}?)\1{2,}", re.UNICODE)
_PUNCT_RE = re.compile(r"[\s\.\,\!\?।॥]+")


def _collapse_repetitions(text: str) -> str:
    text = _REPEATED_WORD_RE.sub(r"\1", text + " ").strip()
    return _REPEATED_PHRASE_RE.sub(r"\1", text + " ").strip()


def _key(text: str) -> str:
    return _PUNCT_RE.sub(" ", text).strip().lower()


def is_prompt_echo(text: str, prompt: str | None) -> bool:
    """True only when Whisper verbatim repeats the prompt or a substantial chunk of it."""
    if not prompt or not text:
        return False
    cleaned_text = _key(text)
    cleaned_prompt = _key(prompt)
    if not cleaned_text or not cleaned_prompt:
        return False
    if cleaned_text == cleaned_prompt or (len(cleaned_text.split()) >= 6 and cleaned_text in cleaned_prompt):
        return True
    return False


_CYRILLIC_OR_GREEK = re.compile(r"[\u0400-\u04FF\u0370-\u03FF]+")


def clean_asr_text(text: str, prompt: str | None = None) -> str:
    """Repair one ASR segment; returns ``""`` for output that must be discarded."""
    text = (text or "").strip()
    if not text:
        return ""
    if _key(text) in {_key(item) for item in _HALLUCINATIONS}:
        return ""
    if is_prompt_echo(text, prompt):
        return ""
    text = _CYRILLIC_OR_GREEK.sub("", text)
    text = _collapse_repetitions(text)
    return romanize_loanwords(text)

