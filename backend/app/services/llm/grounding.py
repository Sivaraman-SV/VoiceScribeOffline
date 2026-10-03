"""Transcript grounding: drop clinical claims the conversation never made.

Small local models copy drugs and diagnoses from few-shot prompts.
few-shot prompts. This module is the last line of defence: an entity or note
clause is kept only when the transcript (including Indian vernacular synonyms)
actually supports it.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from app.models.enums import EntityType
from app.services.asr.code_switch import CLINICAL_COLLOQUIALISMS, NATIVE_CLINICAL_TERMS
from app.services.asr.medical_lexicon import PHARMACEUTICAL_DIRECTORY
from app.services.llm.schemas import ExtractedEntity, GeneratedNote, NoteUpdate
from app.services.nlp.terminology import _SYNONYMS

# Extra brand/generic pairs used only for grounding, not for rewriting speech.
_BRAND_GENERIC: dict[str, str] = {
    "dolo": "paracetamol",
    "crocin": "paracetamol",
    "calpol": "paracetamol",
    "glycomet": "metformin",
    "telma": "telmisartan",
    "pan-d": "pantoprazole",
    "pantocid": "pantoprazole",
    "ondem": "ondansetron",
    "vomikind": "ondansetron",
    "augmentin": "amoxicillin",
    "azithral": "azithromycin",
    "combiflam": "ibuprofen",
    "pan 40": "pantoprazole",
    "meftal": "mefenamic acid",
    "sinarest": "paracetamol",
    "cheston cold": "cetirizine",
    "montair": "montelukast",
    "allegra": "fexofenadine",
    "zerodol": "aceclofenac",
    "ecosprin": "aspirin",
}

# Every drug name the lexicon knows, used to catch prescriptions nobody spoke.
_KNOWN_DRUGS: frozenset[str] = frozenset(
    {name.lower() for names in PHARMACEUTICAL_DIRECTORY.values() for name in names}
    | set(_BRAND_GENERIC)
    | set(_BRAND_GENERIC.values())
    | {"paracetamol", "ibuprofen", "aspirin", "insulin", "prednisolone", "antibiotic", "antibiotics"}
)
_KNOWN_DRUG_RE = re.compile(
    r"\b(" + "|".join(re.escape(name) for name in sorted(_KNOWN_DRUGS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)

# Hedging and framing words that carry no diagnostic content of their own.
_ASSESSMENT_FILLER = {
    "likely", "possible", "possibly", "probable", "probably", "suspected", "suspect",
    "differential", "differentials", "include", "includes", "including", "diagnosis",
    "diagnoses", "impression", "consistent", "working", "rule", "versus", "query",
    "clinical", "assessment", "patient", "doctor", "states", "stated", "mentioned",
    "considered", "considering", "could", "would", "with", "from", "that", "this",
    "acute", "chronic", "mild", "moderate", "severe",
}

# Spoken Indian terms that terminology.py does not always list as full phrases.
_VERNACULAR_EXTRA: dict[str, str] = {
    "sar dard": "headache",
    "sir dard": "headache",
    "thalai vali": "headache",
    "chhati dard": "chest pain",
    "chhati me dard": "chest pain",
    "nenju vali": "chest pain",
    "ulti": "vomiting",
    "khansi": "cough",
    "jor": "fever",
    "pani": "fever",
    "jwaram": "fever",
}

# Types that must never appear unless the transcript supports them.
STRICT_ENTITY_TYPES = {
    EntityType.MEDICATION,
    EntityType.DIAGNOSIS_MENTIONED,
    EntityType.ALLERGY,
    EntityType.SYMPTOM,
    EntityType.FINDING,
    EntityType.PROCEDURE,
    EntityType.INVESTIGATION,
}

_TOKEN_RE = re.compile(r"[\w]{3,}", re.UNICODE)
_CLAUSE_SPLIT = re.compile(r"(?:\n+|;\s+|\.\s+|\d+\.\s*)")
_DRUG_HINT = re.compile(
    r"\b(?:tab|tablet|cap|capsule|syrup|inj|injection|mg|mcg|iu|drops|ointment|"
    r"dolo|crocin|paracetamol|metformin|telma|pantocid|ondem|azithral|augmentin|"
    r"amoxicillin|ibuprofen|aspirin|insulin|antibiotic)\b",
    re.IGNORECASE,
)

_DIAGNOSIS_SYMPTOM_SUPPORT: dict[str, tuple[str, ...]] = {
    "viral fever": ("fever", "temp", "cold", "chill", "body pain", "ache", "juram", "kaachal"),
    "upper respiratory": ("cold", "cough", "throat", "fever", "breath", "sneeze", "runny", "nasal"),
    "urti": ("cold", "cough", "throat", "fever", "breath", "sneeze", "runny", "nasal"),
    "uti": ("urine", "dysuria", "burning", "fever", "bladder"),
    "gastroenteritis": ("vomit", "diarrhea", "loose", "nausea", "stomach", "abdomen"),
    "typhoid": ("typhoid", "enteric"),
    "dengue": ("dengue", "platelet"),
    "malaria": ("malaria", "rigor"),
    "pneumonia": ("cough", "breath", "fever", "chest", "crackles", "crepitation"),
    "bronchitis": ("cough", "sputum", "phlegm", "breath", "cold"),
    "sinusitis": ("sinus", "nasal", "cold", "headache", "facial"),
    "migraine": ("headache", "head", "aura", "throbbing", "sar dard", "thalavali"),
    "gerd": ("heartburn", "acid", "reflux", "chest", "burning", "indigestion"),
    "acid reflux": ("heartburn", "acid", "reflux", "chest", "burning", "indigestion"),
    "hypertension": ("bp", "blood pressure", "hypertension"),
    "diabetes mellitus": ("diabetes", "sugar", "glucose"),
    "anemia": ("anemia", "anaemia", "hb", "hemoglobin"),
    "anaemia": ("anemia", "anaemia", "hb", "hemoglobin"),
}

_INVENTED_DIAGNOSIS_MARKERS = tuple(_DIAGNOSIS_SYMPTOM_SUPPORT.keys())


# "chakkar" -> ("dizziness", "vertigo"): every alternative counts as a translation.
_COLLOQUIAL_OPTIONS: dict[str, tuple[str, ...]] = {
    phrase: tuple(option.strip().lower() for option in english.split("/") if option.strip())
    for phrase, english in {**CLINICAL_COLLOQUIALISMS, **NATIVE_CLINICAL_TERMS}.items()
}


def _synonym_pairs() -> dict[str, str]:
    pairs = dict(_SYNONYMS)
    pairs.update(_BRAND_GENERIC)
    pairs.update(_VERNACULAR_EXTRA)
    for phrase, options in _COLLOQUIAL_OPTIONS.items():
        pairs.setdefault(phrase, options[0])
    return pairs


_SYNONYM_PAIRS = _synonym_pairs()


def expand_clinical_text(text: str) -> str:
    """Lowercased text plus English/vernacular/brand expansions."""
    raw = (text or "").lower()
    extras: list[str] = []
    for phrase, english in _SYNONYM_PAIRS.items():
        if phrase in raw:
            extras.append(english)
            extras.extend(_COLLOQUIAL_OPTIONS.get(phrase, ()))
        if english in raw:
            extras.append(phrase)
    return f"{raw} {' '.join(extras)}".strip()


def is_grounded(value: str, cited_text: str) -> bool:
    """True when ``value`` is supported by ``cited_text`` (verbatim, synonym, or token overlap).

    Only the transcript is synonym-expanded. Expanding the claim as well would
    let "viral fever / typhoid" match a transcript that only said "bukhar".
    """
    return _grounded_in(value, expand_clinical_text(cited_text or ""))


def _grounded_in(value: str, haystack: str) -> bool:
    value = (value or "").strip()
    if not value:
        return False
    value_l = value.lower()
    if not haystack:
        return False
    if value_l in haystack:
        return True
    for phrase, english in _SYNONYM_PAIRS.items():
        if value_l in (phrase, english) and (phrase in haystack or english in haystack):
            return True
        if phrase in value_l and (phrase in haystack or english in haystack):
            return True
    tokens = [tok for tok in _TOKEN_RE.findall(value_l) if len(tok) >= 4]
    if not tokens:
        short = [tok for tok in _TOKEN_RE.findall(value_l) if len(tok) >= 3]
        return bool(short) and all(tok in haystack for tok in short)
    matched = sum(1 for tok in tokens if tok in haystack)
    return matched / len(tokens) >= 0.5


def cite_entities(entities: list[ExtractedEntity], segment_texts: dict[str, str], limit: int = 4) -> None:
    """Fill ``source_segment_ids`` for entities the model returned without them."""
    expanded: dict[str, str] | None = None
    for entity in entities:
        if entity.source_segment_ids:
            continue
        if expanded is None:
            expanded = {ref: expand_clinical_text(text) for ref, text in segment_texts.items()}
        entity.source_segment_ids = [
            ref for ref, haystack in expanded.items() if _grounded_in(entity.value, haystack)
        ][:limit]


def transcript_blob(segments: Iterable[dict[str, Any]]) -> str:
    return " ".join(str(s.get("text", "")) for s in segments)


def filter_ungrounded_entities(
    entities: list[ExtractedEntity],
    *,
    segment_texts: dict[str, str],
    full_transcript: str | None = None,
) -> tuple[list[ExtractedEntity], int]:
    """Drop strictly-clinical entities that are not supported by the transcript."""
    blob = full_transcript or " ".join(segment_texts.values())
    kept: list[ExtractedEntity] = []
    dropped = 0
    for entity in entities:
        cited = " ".join(segment_texts.get(ref, "") for ref in entity.source_segment_ids)
        support = cited or blob
        if entity.entity_type in STRICT_ENTITY_TYPES and not is_grounded(entity.value, support):
            dropped += 1
            continue
        kept.append(entity)
    return kept, dropped


def _clause_supported(clause: str, transcript: str) -> bool:
    text = clause.strip()
    if not text:
        return False
    lowered = text.lower()
    haystack = expand_clinical_text(transcript)
    for marker, required_support in _DIAGNOSIS_SYMPTOM_SUPPORT.items():
        if marker in lowered:
            if not any(req in haystack for req in required_support):
                return False
    if is_grounded(text, transcript):
        return True
    if _DRUG_HINT.search(text):
        return False
    tokens = [tok for tok in _TOKEN_RE.findall(lowered) if len(tok) >= 4]
    if not tokens:
        return True
    matched = sum(1 for tok in tokens if tok in haystack)
    return matched / len(tokens) >= 0.25


def _filter_section_text(text: str, transcript: str, *, medication_section: bool) -> str:
    if not (text or "").strip():
        return ""
    clauses = [part.strip(" -•\t") for part in _CLAUSE_SPLIT.split(text) if part.strip(" -•\t")]
    if len(clauses) <= 1 and not medication_section:
        return text if _clause_supported(text, transcript) else ""
    kept = [clause for clause in clauses if _clause_supported(clause, transcript)]
    if not kept:
        return ""
    if "\n" in text:
        return "\n".join(kept)
    return ". ".join(kept) + ("." if text.rstrip().endswith(".") else "")


def unspoken_drugs(text: str, transcript: str) -> list[str]:
    """Drug names in ``text`` that the transcript never mentions (brand/generic aware)."""
    haystack = expand_clinical_text(transcript)
    missing: list[str] = []
    for match in _KNOWN_DRUG_RE.finditer(text or ""):
        name = match.group(1).lower()
        if name in haystack or name in missing:
            continue
        missing.append(name)
    return missing


def doctor_transcript(segments: Iterable[dict[str, Any]]) -> str:
    """What the doctor said. Without any doctor-attributed turn, the whole transcript."""
    items = list(segments)
    doctor = [s for s in items if str(s.get("role", "")).upper() == "DOCTOR"]
    return transcript_blob(doctor if doctor else items)


def _assessment_clause_supported(clause: str, doctor_text: str, transcript: str) -> bool:
    """The doctor voiced it, and the conversation contains symptoms that fit it."""
    lowered = clause.strip().lower()
    if not lowered:
        return False
    whole = expand_clinical_text(transcript)
    for marker, required_support in _DIAGNOSIS_SYMPTOM_SUPPORT.items():
        if marker in lowered and not any(req in whole for req in required_support):
            return False
    haystack = expand_clinical_text(doctor_text)
    if unspoken_drugs(clause, doctor_text):
        return False
    tokens = [
        tok for tok in _TOKEN_RE.findall(lowered) if len(tok) >= 4 and tok not in _ASSESSMENT_FILLER
    ]
    if not tokens:
        return False
    matched = sum(1 for tok in tokens if tok in haystack)
    return matched / len(tokens) >= 0.5


def _doctor_clause_supported(clause: str, doctor_text: str) -> bool:
    if unspoken_drugs(clause, doctor_text):
        return False
    return _clause_supported(clause, doctor_text)


def _filter_clauses(text: str, keep) -> str:
    if not (text or "").strip():
        return ""
    clauses = [part.strip(" -•\t") for part in _CLAUSE_SPLIT.split(text) if part.strip(" -•\t")]
    kept = [clause for clause in clauses if keep(clause)]
    if not kept:
        return ""
    if len(kept) == len(clauses):
        return text
    if "\n" in text:
        return "\n".join(kept)
    return ". ".join(kept) + ("." if text.rstrip().endswith(".") else "")


def _clear(section) -> None:
    section.text = ""
    section.source_segment_ids = []
    section.confidence = 0.0


def purge_note_hallucinations(
    update: NoteUpdate,
    segments: list[dict[str, Any]],
    entities: list[dict[str, Any]] | None = None,
) -> None:
    """Strip invented medications, diagnoses, and unsupported plan/assessment text.

    Assessment, plan and follow-up are the doctor's decisions, so they are
    checked against the doctor's own words; a clause the doctor never voiced is
    removed and an emptied section is shown as "Not mentioned".
    """
    transcript = transcript_blob(segments)
    entity_blob = " ".join(
        str(e.get("value", "")) for e in (entities or []) if e.get("value")
    )
    support = f"{transcript} {entity_blob}"
    doctor_text = doctor_transcript(segments)

    note: GeneratedNote = update.note

    for key in ("current_medication", "treatment_history"):
        section = getattr(note, key, None)
        if section is None or not section.text:
            continue
        section.text = _filter_clauses(
            section.text,
            lambda clause: not unspoken_drugs(clause, transcript) and _clause_supported(clause, support),
        )
        if not section.text.strip():
            _clear(section)

    decision_rules = {
        "assessment": lambda clause: _assessment_clause_supported(clause, doctor_text, transcript),
        "plan": lambda clause: _doctor_clause_supported(clause, doctor_text),
        "follow_up": lambda clause: _doctor_clause_supported(clause, doctor_text),
    }
    for key, keep in decision_rules.items():
        section = getattr(note, key, None)
        if section is None or not section.text:
            continue
        section.text = _filter_clauses(section.text, keep)
        if not section.text.strip():
            _clear(section)

    for key in ("allergies", "relevant_medical_history"):
        section = getattr(note, key, None)
        if section is None or not section.text:
            continue
        if not _clause_supported(section.text, support):
            _clear(section)
            continue
        section.text = _filter_section_text(section.text, support, medication_section=False)
        if not section.text.strip():
            _clear(section)
