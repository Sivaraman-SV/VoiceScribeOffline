"""Medical Terminology & Phonetic Normalizer for Indian Clinical Dialogues.

Corrects common acoustic and phonetic transcription errors produced by Whisper models
when transcribing Indian English, Hinglish, Tanglish, and regional medical encounters.
"""

from __future__ import annotations

import re
from typing import Sequence

_ALREADY_EXPANDED = r"(?<!OD \()(?<!BD \()(?<!TDS \()(?<!SOS \()"

# Regex replacement rules: (pattern, replacement)
# Carefully bounded with \b to avoid replacing substrings inside longer words.
# Do NOT map everyday English ("tell me") onto drug names — that invents medications.
_PHONETIC_RULES: list[tuple[re.Pattern[str], str]] = [
    # --- Common Indian Pharmaceutical Brands (high-confidence mishears only) ---
    (re.compile(r"\b(?:tell\s*my|tel\s*my)\s*(20|40|80)\b", re.IGNORECASE), r"Telma \1"),
    (re.compile(r"\btelma\b", re.IGNORECASE), "Telma"),
    (re.compile(r"\b(?:pan\s*[- ]?d|penn\s*[- ]?d)\b", re.IGNORECASE), "Pan-D"),
    (re.compile(r"\b(?:panto\s*sid|pantocid)\b", re.IGNORECASE), "Pantocid"),
    (re.compile(r"\b(?:pantodac|panto\s*dac)\b", re.IGNORECASE), "Pantodac"),
    (re.compile(r"\b(?:paracet\s*model|paracet\s*mol|paracetmol|paracetamol)\b", re.IGNORECASE), "Paracetamol"),
    (re.compile(r"\b(?:dolo\s*[- ]?650|dollo\s*[- ]?650|dolor\s*[- ]?650|dolo\s*six\s*fifty)\b", re.IGNORECASE), "Dolo 650"),
    (re.compile(r"\b(?:crossin|crocin)\b", re.IGNORECASE), "Crocin"),
    (re.compile(r"\b(?:glyco\s*met|glycomet)\b", re.IGNORECASE), "Glycomet"),
    (re.compile(r"\b(?:met\s*formin|metformin)\b", re.IGNORECASE), "Metformin"),
    (re.compile(r"\b(?:am\s*long|amlong)\b", re.IGNORECASE), "Amlong"),
    (re.compile(r"\b(?:ogmentin|aug\s*mentin|augmentin)\b", re.IGNORECASE), "Augmentin"),
    (re.compile(r"\b(?:azithral|azithromycin)\b", re.IGNORECASE), "Azithral"),
    (re.compile(r"\b(?:calpol)\b", re.IGNORECASE), "Calpol"),
    (re.compile(r"\b(?:combi\s*flam|combiflam)\b", re.IGNORECASE), "Combiflam"),
    (re.compile(r"\b(?:sef\s*tum|ceftum)\b", re.IGNORECASE), "Ceftum"),
    (re.compile(r"\b(?:claw\s*vam|clavam)\b", re.IGNORECASE), "Clavam"),
    (re.compile(r"\b(?:eco\s*sprin|eco\s*spring|ecosprin)\b", re.IGNORECASE), "Ecosprin"),
    (re.compile(r"\b(?:a\s*torva|atorva|atorvastatin)\b", re.IGNORECASE), "Atorva"),
    (re.compile(r"\b(?:ro\s*suvas|rosuvas|rosuvastatin)\b", re.IGNORECASE), "Rosuvas"),
    (re.compile(r"\b(?:montek\s*[- ]?lc|montair\s*[- ]?lc)\b", re.IGNORECASE), "Montair-LC"),
    (re.compile(r"\b(?:vomi\s*kind|vomikind)\b", re.IGNORECASE), "Vomikind"),
    (re.compile(r"\b(?:on\s*dem|ondem)\b", re.IGNORECASE), "Ondem"),
    (re.compile(r"\b(?:a\s*legra|allegra)\b", re.IGNORECASE), "Allegra"),
    (re.compile(r"\b(?:meftal\s*[- ]?spas)\b", re.IGNORECASE), "Meftal-Spas"),
    (re.compile(r"\b(?:zifi|zi\s*fi)\b", re.IGNORECASE), "Zifi"),
    (re.compile(r"\b(?:supradyn|supra\s*dyn)\b", re.IGNORECASE), "Supradyn"),
    (re.compile(r"\b(?:shelcal|shel\s*cal)\b", re.IGNORECASE), "Shelcal"),
    (re.compile(r"\b(?:becosules|beco\s*sules)\b", re.IGNORECASE), "Becosules"),

    # --- Dosages & Frequencies ---
    # The lookbehinds keep these idempotent: the pipeline normalises text that a
    # provider has already normalised, and "OD (once daily)" must not become
    # "OD (OD (once daily))".
    (re.compile(r"\b(\d+)\s*(?:mili\s*gram|milli\s*gram|mili\s*grams|milli\s*grams)\b", re.IGNORECASE), r"\1 mg"),
    (re.compile(_ALREADY_EXPANDED + r"\b(?:once\s*a\s*day|once\s*daily|one\s*time\s*daily)\b", re.IGNORECASE), "OD (once daily)"),
    (re.compile(_ALREADY_EXPANDED + r"\b(?:twice\s*a\s*day|twice\s*daily|two\s*times\s*a\s*day)\b", re.IGNORECASE), "BD (twice daily)"),
    (re.compile(_ALREADY_EXPANDED + r"\b(?:thrice\s*a\s*day|thrice\s*daily|three\s*times\s*a\s*day)\b", re.IGNORECASE), "TDS (thrice daily)"),
    # "if pain" is deliberately not here: "if pain persists, come back" is not
    # an as-needed instruction.
    (re.compile(_ALREADY_EXPANDED + r"\b(?:when\s*needed|as\s*needed|jarurat\s*padne\s*par|zaroorat\s*padne\s*par)\b", re.IGNORECASE), "SOS (as needed)"),

    # --- Clinical Abbreviations & Vitals ---
    (re.compile(r"\b(?:blood\s*pressure|b\s*\.?\s*p\.?)\b", re.IGNORECASE), "BP"),
    (re.compile(r"\b(?:sugar\s*level|sugar\s*test|blood\s*sugar)\b", re.IGNORECASE), "blood sugar"),
    (re.compile(r"\b(?:sp\s*o2|spo2|oxygen\s*saturation)\b", re.IGNORECASE), "SpO2"),
    (re.compile(r"\b(?:ecg|e\s*\.?\s*c\s*\.?\s*g\.?)\b", re.IGNORECASE), "ECG"),
    (re.compile(r"\b(?:x\s*ray|x-ray)\b", re.IGNORECASE), "X-Ray"),

    # --- Common Tanglish Acoustic Mishear Corrections ---
    (re.compile(r"\b(?:rinnala|rin\s*nala|pinnala|pinnadi)\b", re.IGNORECASE), "பின்னால"),
    (re.compile(r"\b(?:தலவிலியா|thalaivaliya|thalavaliya)\b", re.IGNORECASE), "தலைவலியா"),
    (re.compile(r"\b(?:தலவிலி|thalaivali|thalavali)\b", re.IGNORECASE), "தலைவலி"),
    (re.compile(r"\b(?:ableu\s*severe|avlo\s*severe|avvalavu\s*severe)\b", re.IGNORECASE), "அவ்வளவு severe"),
    (re.compile(r"\b(?:puanakonsoor|puanakonsur)\b", re.IGNORECASE), "பின்னால கொஞ்சம்"),
    (re.compile(r"\b(?:kojnjyom|koinjyom|koncho|konjam)\b", re.IGNORECASE), "கொஞ்சம்"),
    (re.compile(r"\b(?:potten|poten)\b", re.IGNORECASE), "போட்டேன்"),
    (re.compile(r"\b(?:saapten|saaptom)\b", re.IGNORECASE), "சாப்பிட்டேன்"),
    (re.compile(r"\b(?:erukku|irukku)\b", re.IGNORECASE), "இருக்கு"),
    (re.compile(r"\b(?:erukanga|irukanga|irukkaanga)\b", re.IGNORECASE), "இருக்காங்க"),
    (re.compile(r"\b(?:illa|illai)\b", re.IGNORECASE), "இல்ல"),
    (re.compile(r"\b(?:pannunga|pannungalen)\b", re.IGNORECASE), "பண்ணுங்க"),
    (re.compile(r"\b(?:pannum|pannanum)\b", re.IGNORECASE), "பண்ணனும்"),
    (re.compile(r"\b(?:romba|roomba)\b", re.IGNORECASE), "ரொம்ப"),
    (re.compile(r"\b(?:mudiyala|mudiyale)\b", re.IGNORECASE), "முடியல"),
    (re.compile(r"\b(?:theriyala|teriyala)\b", re.IGNORECASE), "தெரியல"),
    (re.compile(r"\b(?:paravala|paravailla)\b", re.IGNORECASE), "பரவாயில்ல"),
    (re.compile(r"\b(?:solranga|solunga|sollunga)\b", re.IGNORECASE), "சொல்லுங்க"),
    (re.compile(r"\b(?:ennachu|enna\s*aachu)\b", re.IGNORECASE), "என்னாச்சு"),
    (re.compile(r"\b(?:paapom|paakanum)\b", re.IGNORECASE), "பாக்கணும்"),
    (re.compile(r"\b(?:vaanga)\b", re.IGNORECASE), "வாங்க"),
    (re.compile(r"\b(?:enakku|inaku)\b", re.IGNORECASE), "எனக்கு"),
    (re.compile(r"\b(?:ungalluku|ungalukku)\b", re.IGNORECASE), "உங்களுக்கு"),
]


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
