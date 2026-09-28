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
    "ta": "doctor, எனக்கு 2 days-ஆ severe headache and chest pain இருக்கு. Paracetamol Dolo 650 tablet போட்டேன். BP check பண்ணனும்.",
    "hi": "doctor, मुझे 2 days से fever and chest pain है। मैंने Paracetamol Dolo 650 tablet ली थी। BP check करना है।",
    "en": "doctor, I have had a headache and chest discomfort for two days. I took a Dolo 650 tablet.",
}


def parse_languages(value: str | None) -> tuple[str, ...]:
    """``"ta, en ,hi"`` -> ``("ta", "en", "hi")``; empty means no restriction."""
    if not value:
        return ()
    return tuple(dict.fromkeys(part.strip().lower() for part in value.split(",") if part.strip()))


def style_prompt(language: str | None, override: str | None = None) -> str | None:
    if override:
        return override
    return _STYLE_PROMPTS.get(language or "")


@dataclass
class LanguagePolicy:
    """Chooses one utterance's language from Whisper's language probabilities."""

    allowed: tuple[str, ...] = ("ta", "en", "hi")
    # Added to the previous utterance's language; short utterances get more,
    # because Whisper's detection on under two seconds of audio is unreliable.
    stickiness: float = 0.15
    short_utterance_seconds: float = 2.0
    previous: str | None = None
    counts: dict[str, int] = field(default_factory=dict)

    def choose(self, probabilities: list[tuple[str, float]], duration: float) -> tuple[str, float]:
        scores: dict[str, float] = {}
        for language, probability in probabilities:
            target = language if not self.allowed or language in self.allowed else _LANGUAGE_ALIASES.get(language)
            if target is None or (self.allowed and target not in self.allowed):
                continue
            scores[target] = scores.get(target, 0.0) + probability

        if not scores:
            fallback = self.previous or (self.allowed[0] if self.allowed else "en")
            return fallback, 0.0

        total = sum(scores.values()) or 1.0
        normalized = {language: score / total for language, score in scores.items()}

        # CRITICAL: Whisper's acoustic classifier has a massive English prior.
        # In a Tamil clinic, code-mixed utterances often score 0.10-0.40 for 'ta'
        # while 'en' scores 0.55-0.75 simply because of English loanwords.
        # However, a clear English sentence scores en >= 0.85.
        # When 'ta' is present and 'en' is not overwhelmingly dominant (< 0.85):
        # decode as 'ta' so Tamil words are written in authentic Tamil script
        # and English words stay in Latin script.
        if "ta" in self.allowed and normalized.get("ta", 0.0) >= 0.10 and normalized.get("en", 0.0) < 0.85:
            self.previous = "ta"
            self.counts["ta"] = self.counts.get("ta", 0) + 1
            return "ta", round(normalized.get("ta", 0.0), 4)

        if "hi" in self.allowed and normalized.get("hi", 0.0) >= 0.10 and normalized.get("en", 0.0) < 0.85:
            self.previous = "hi"
            self.counts["hi"] = self.counts.get("hi", 0) + 1
            return "hi", round(normalized.get("hi", 0.0), 4)

        biased = dict(normalized)
        if self.previous in biased:
            bonus = self.stickiness * (2.0 if duration < self.short_utterance_seconds else 1.0)
            biased[self.previous] += bonus
        # A language that has dominated the session so far wins close calls
        if self.counts:
            dominant = max(self.counts, key=self.counts.__getitem__)
            if dominant in biased and dominant != "en":
                biased[dominant] += 0.05

        language = max(biased, key=biased.__getitem__)
        self.previous = language
        self.counts[language] = self.counts.get(language, 0) + 1
        return language, round(normalized.get(language, 0.0), 4)


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
    "வாமிட்டிங்": "vomiting",
    "மோஷன்": "motion",
    "கோல்ட்": "cold",
    "கஃப்": "cough",
    "பெயின்": "pain",
    "ஸ்ட்ரெஸ்": "stress",
    "ஃபாலோ": "follow",
    "நார்மல்": "normal",
    "மெடிசின்": "medicine",
    "டெம்பரேச்சர்": "temperature",
    "வெயிட்": "weight",
    "ஹார்ட்": "heart",
    "கிட்னி": "kidney",
    "லிவர்": "liver",
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
    """True when a segment is mostly words copied from the style prompt."""
    if not prompt or not text:
        return False
    words = _key(text).split()
    if len(words) < 3:
        return False
    prompt_words = set(_key(prompt).split())
    overlap = sum(1 for word in words if word in prompt_words)
    return overlap / len(words) >= 0.6


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

