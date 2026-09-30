"""Medical Terminology & Phonetic Normalizer for Indian Clinical Dialogues.

Corrects common acoustic and phonetic transcription errors produced by Whisper models
when transcribing Indian English and clinical medical encounters.
"""

from __future__ import annotations

import re
from typing import Sequence

from app.services.asr.medical_lexicon import PHONETIC_CORRECTIONS

_ALREADY_EXPANDED = r"(?<!OD \()(?<!BD \()(?<!TDS \()(?<!SOS \()"

# Regex replacement rules: (pattern, replacement)
_DOSAGE_AND_VITALS_RULES: list[tuple[re.Pattern[str], str]] = [
    # --- Dosages & Frequencies ---
    (re.compile(r"\b(\d+)\s*(?:mili\s*gram|milli\s*gram|mili\s*grams|milli\s*grams)\b", re.IGNORECASE), r"\1 mg"),
    (re.compile(_ALREADY_EXPANDED + r"\b(?:once\s*a\s*day|once\s*daily|one\s*time\s*daily)\b", re.IGNORECASE), "OD (once daily)"),
    (re.compile(_ALREADY_EXPANDED + r"\b(?:twice\s*a\s*day|twice\s*daily|two\s*times\s*a\s*day)\b", re.IGNORECASE), "BD (twice daily)"),
    (re.compile(_ALREADY_EXPANDED + r"\b(?:thrice\s*a\s*day|thrice\s*daily|three\s*times\s*a\s*day)\b", re.IGNORECASE), "TDS (thrice daily)"),
    (re.compile(_ALREADY_EXPANDED + r"\b(?:when\s*needed|as\s*needed|jarurat\s*padne\s*par|zaroorat\s*padne\s*par)\b", re.IGNORECASE), "SOS (as needed)"),

    # --- Clinical Abbreviations & Vitals ---
    (re.compile(r"\b(?:blood\s*pressure|b\s*\.?\s*p\.?)\b", re.IGNORECASE), "BP"),
    (re.compile(r"\b(?:sugar\s*level|sugar\s*test|blood\s*sugar)\b", re.IGNORECASE), "blood sugar"),
    (re.compile(r"\b(?:sp\s*o2|spo2|oxygen\s*saturation)\b", re.IGNORECASE), "SpO2"),
    (re.compile(r"\b(?:ecg|e\s*\.?\s*c\s*\.?\s*g\.?)\b", re.IGNORECASE), "ECG"),
    (re.compile(r"\b(?:x\s*ray|x-ray)\b", re.IGNORECASE), "X-Ray"),
]

# Combined phonetic rules: brand names & medical mishears first, then dosages and vitals
_PHONETIC_RULES: list[tuple[re.Pattern[str], str]] = list(PHONETIC_CORRECTIONS) + _DOSAGE_AND_VITALS_RULES


def normalize_medical_transcript(text: str) -> str:
    """Normalize common acoustic and phonetic transcription errors in medical text."""
    if not text:
        return text

    normalized = text
    for pattern, replacement in _PHONETIC_RULES:
        normalized = pattern.sub(replacement, normalized)

    return normalized.strip()


def normalize_segments(segments: Sequence[dict[str, object]]) -> list[dict[str, object]]:
    """Normalize a list of transcript segment dicts in-place or as copies."""
    results: list[dict[str, object]] = []
    for s in segments:
        copy_s = dict(s)
        raw_text = str(copy_s.get("text", ""))
        copy_s["text"] = normalize_medical_transcript(raw_text)
        results.append(copy_s)
    return results
