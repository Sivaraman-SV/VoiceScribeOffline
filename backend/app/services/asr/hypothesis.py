"""Quality checks for one utterance's recognition hypotheses.

Whisper fails in recognisable ways on long, code-mixed consultations: repetition
loops, far more text than the audio could hold, very low token confidence, or
output in a script the language does not use (Malayalam letters for Tamil
speech). These checks decide when its output is rejected in favour of the
second recogniser, which is a CTC model and cannot invent words.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

_SCRIPT_RANGES: dict[str, tuple[tuple[int, int], ...]] = {
    "latin": ((0x41, 0x5A), (0x61, 0x7A), (0xC0, 0x24F)),
    "devanagari": ((0x0900, 0x097F),),
    "bengali": ((0x0980, 0x09FF),),
    "gurmukhi": ((0x0A00, 0x0A7F),),
    "gujarati": ((0x0A80, 0x0AFF),),
    "odia": ((0x0B00, 0x0B7F),),
    "tamil": ((0x0B80, 0x0BFF),),
    "telugu": ((0x0C00, 0x0C7F),),
    "kannada": ((0x0C80, 0x0CFF),),
    "malayalam": ((0x0D00, 0x0D7F),),
    "arabic": ((0x0600, 0x06FF),),
}

_LANGUAGE_SCRIPTS: dict[str, frozenset[str]] = {
    "en": frozenset({"latin"}),
    "hi": frozenset({"devanagari", "latin"}),
    "mr": frozenset({"devanagari", "latin"}),
    "ne": frozenset({"devanagari", "latin"}),
    "bn": frozenset({"bengali", "latin"}),
    "pa": frozenset({"gurmukhi", "latin"}),
    "gu": frozenset({"gujarati", "latin"}),
    "or": frozenset({"odia", "latin"}),
    "ta": frozenset({"tamil", "latin"}),
    "te": frozenset({"telugu", "latin"}),
    "kn": frozenset({"kannada", "latin"}),
    "ml": frozenset({"malayalam", "latin"}),
    "ur": frozenset({"arabic", "latin"}),
}

# Fast speech is ~15-20 characters per second; beyond this the text cannot
# have come from the audio.
_MAX_CHARS_PER_SECOND = 28.0
_MAX_COMPRESSION_RATIO = 2.4
# Whisper measures compression on UTF-8 bytes. Indian scripts take three bytes a
# letter with a near-constant lead pair, so clean Tamil compresses far more than
# English: a fifth of correct Tamil sentences in FLEURS / dialect speech pass 2.4
# (highest 3.5), while a phrase repeated three or four times lands around 4.
_MAX_COMPRESSION_RATIO_INDIC = 3.6
_INDIC_SCRIPTS = frozenset(
    {"devanagari", "bengali", "gurmukhi", "gujarati", "odia", "tamil", "telugu", "kannada", "malayalam"}
)
_MIN_AVG_LOGPROB = -1.0
_MAX_FOREIGN_SCRIPT_SHARE = 0.2


@dataclass(frozen=True)
class DecodeQuality:
    avg_logprob: float = 0.0
    compression_ratio: float = 1.0


def _script_of(char: str) -> str | None:
    code = ord(char)
    for script, ranges in _SCRIPT_RANGES.items():
        if any(low <= code <= high for low, high in ranges):
            return script
    return None


def foreign_script_share(text: str, language: str | None) -> float:
    """Share of letters written in a script ``language`` does not use."""
    allowed = _LANGUAGE_SCRIPTS.get(language or "")
    if not allowed:
        return 0.0
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return 0.0
    foreign = sum(1 for char in letters if _script_of(char) not in allowed)
    return foreign / len(letters)


def compression_limit(language: str | None, text: str | None = None) -> float:
    """Highest Whisper compression ratio that is still ordinary speech.

    Judged by the script of ``text`` when given, otherwise by ``language``.
    """
    if text is not None:
        letters = [char for char in text if char.isalpha()]
        indic = sum(1 for char in letters if _script_of(char) in _INDIC_SCRIPTS)
        uses_indic = bool(letters) and indic / len(letters) >= 0.5
    else:
        uses_indic = bool(_LANGUAGE_SCRIPTS.get(language or "", frozenset()) & _INDIC_SCRIPTS)
    return _MAX_COMPRESSION_RATIO_INDIC if uses_indic else _MAX_COMPRESSION_RATIO


def _has_repetition_loop(text: str) -> bool:
    words = text.lower().split()
    if len(words) < 9:
        return False
    trigrams = Counter(tuple(words[index : index + 3]) for index in range(len(words) - 2))
    return trigrams.most_common(1)[0][1] >= 3


_TAMIL_VIRAMA = "\u0bcd"
_TAMIL_VOWEL_SIGNS = frozenset("ாிீுூெேைொோௌஂ")
_TAMIL_INDEPENDENT = frozenset("அஆஇஈஉஊஎஏஐஒஓஔஃ")
# Vowel sign then another mark, or virama then a mark: not legal Tamil spelling.
_ILLEGAL_TAMIL_MARKS = re.compile(
    r"[\u0bbe\u0bbf\u0bc0\u0bc1\u0bc2\u0bc6\u0bc7\u0bc8\u0bca\u0bcb\u0bcc]"
    r"[\u0bbe\u0bbf\u0bc0\u0bc1\u0bc2\u0bc6\u0bc7\u0bc8\u0bca\u0bcb\u0bcc\u0bcd]"
    r"|\u0bcd[\u0bbe\u0bbf\u0bc0\u0bc1\u0bc2\u0bc6\u0bc7\u0bc8\u0bca\u0bcb\u0bcc\u0bcd]"
)
# Frequent clinic / function words. Real Tamil almost always contains one of these;
# Whisper's invented-script soup does not.
_KNOWN_TAMIL = (
    "எனக்கு",
    "இருக்கு",
    "இருக்கும்",
    "இல்லை",
    "இல்ல",
    "வலி",
    "தலைவலி",
    "நான்",
    "வந்து",
    "போய்",
    "சரி",
    "ஆனா",
    "ஆனால்",
    "கொஞ்சம்",
    "ரொம்ப",
    "வயிறு",
    "நெஞ்சு",
    "காய்ச்சல்",
    "இருமல்",
    "மாத்திரை",
    "டாக்டர்",
    "மருந்து",
    "காலை",
    "மாலை",
    "இரவு",
    "நாள்",
    "நேத்து",
    "அப்போ",
    "இப்போ",
    "அப்புறம்",
    "பசி",
    "தூக்கம்",
    "மூச்சு",
    "இரத்தம்",
    "சர்க்கரை",
)


def tamil_is_garbled(text: str) -> bool:
    """True when Tamil-script output contains spellings no Tamil word can have.

    Turbo Whisper sometimes emits Tamil letters that look plausible at a glance
    but stack vowel signs and viramas illegally. That text should be rejected so
    IndicConformer or a second decode can replace it. Letter-ratio rules are not
    used: virama-heavy formal Tamil looks the same as this soup by ratio, and such
    a rule rejected a third of correct human transcripts (FLEURS / dialect speech).
    """
    letters = [char for char in text if 0x0B80 <= ord(char) <= 0x0BFF]
    if len(letters) < 8:
        return False
    known = any(word in text for word in _KNOWN_TAMIL)
    illegal = len(_ILLEGAL_TAMIL_MARKS.findall(text))
    if illegal >= 2:
        return True
    if known:
        return False
    if illegal >= 1 and len(letters) >= 12:
        return True
    virama = sum(1 for char in letters if char == _TAMIL_VIRAMA)
    vowels = sum(1 for char in letters if char in _TAMIL_VOWEL_SIGNS or char in _TAMIL_INDEPENDENT)
    if len(letters) - virama - vowels <= 0:
        return True
    jammed_latin = bool(re.search(r"[A-Za-z]{7,}", text.replace(" ", "")))
    return len(letters) >= 16 and jammed_latin


def whisper_problem(text: str, language: str | None, duration: float, quality: DecodeQuality) -> str | None:
    """Why this Whisper output should not be trusted, or ``None`` if it looks sound."""
    text = (text or "").strip()
    if not text:
        return "no speech recognised" if duration >= 2.0 else None
    if quality.compression_ratio > compression_limit(language, text) or _has_repetition_loop(text):
        return "repetition loop"
    if duration > 0 and len(text.replace(" ", "")) / duration > _MAX_CHARS_PER_SECOND:
        return "more text than the audio could contain"
    if quality.avg_logprob < _MIN_AVG_LOGPROB:
        return "low recognition confidence"
    if foreign_script_share(text, language) > _MAX_FOREIGN_SCRIPT_SHARE:
        return "output in the wrong script"
    if language == "ta" and tamil_is_garbled(text):
        return "garbled Tamil"
    return None


def conformer_plausible(text: str | None, duration: float) -> bool:
    text = (text or "").strip()
    if not any(char.isalpha() for char in text):
        return False
    return duration <= 0 or len(text.replace(" ", "")) / duration <= _MAX_CHARS_PER_SECOND
