"""Quality checks for one utterance's recognition hypotheses.

Whisper fails in recognisable ways on long, code-mixed consultations: repetition
loops, far more text than the audio could hold, very low token confidence, or
output in a script the language does not use (Malayalam letters for Tamil
speech). These checks decide when its output is rejected in favour of the
second recogniser, which is a CTC model and cannot invent words.
"""

from __future__ import annotations

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


def _has_repetition_loop(text: str) -> bool:
    words = text.lower().split()
    if len(words) < 9:
        return False
    trigrams = Counter(tuple(words[index : index + 3]) for index in range(len(words) - 2))
    return trigrams.most_common(1)[0][1] >= 3


def whisper_problem(text: str, language: str | None, duration: float, quality: DecodeQuality) -> str | None:
    """Why this Whisper output should not be trusted, or ``None`` if it looks sound."""
    text = (text or "").strip()
    if not text:
        return "no speech recognised" if duration >= 2.0 else None
    if quality.compression_ratio > _MAX_COMPRESSION_RATIO or _has_repetition_loop(text):
        return "repetition loop"
    if duration > 0 and len(text.replace(" ", "")) / duration > _MAX_CHARS_PER_SECOND:
        return "more text than the audio could contain"
    if quality.avg_logprob < _MIN_AVG_LOGPROB:
        return "low recognition confidence"
    if foreign_script_share(text, language) > _MAX_FOREIGN_SCRIPT_SHARE:
        return "output in the wrong script"
    return None


def conformer_plausible(text: str | None, duration: float) -> bool:
    text = (text or "").strip()
    if not any(char.isalpha() for char in text):
        return False
    return duration <= 0 or len(text.replace(" ", "")) / duration <= _MAX_CHARS_PER_SECOND
