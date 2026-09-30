"""Local transcription / diarization and LLM JSON parsing — no network."""

from __future__ import annotations

import json
import math
import struct

from app.core.config import ASRProviderName, DiarizationProviderName, Settings, settings
from app.models.enums import AudioSource
from app.services.diarization import build_diarization_provider
from app.services.diarization.local_provider import LocalDiarizationProvider
from app.services.llm.json_parse import extract_json_object
from app.services.llm.prompts import build_extraction_prompt
from app.services.llm.schemas import ExtractionResult, NoteUpdate, coerce_llm_payload
from app.services.types import AudioFrame


def test_offline_defaults_target_gpu_server() -> None:
    fields = Settings.model_fields
    assert fields["asr_provider"].default is ASRProviderName.FASTER_WHISPER
    assert fields["faster_whisper_model"].default == "large-v3-turbo"
    assert fields["local_llm_model"].default == "gemma2:9b"
    assert fields["asr_device"].default == "cuda"
    assert fields["asr_compute_type"].default == "float16"
    assert fields["asr_beam_size"].default == 2
    assert fields["asr_num_workers"].default == 2
    assert fields["indic_whisper_use_transformers"].default is False
    assert fields["local_llm_temperature"].default == 0.1
    assert fields["local_llm_num_ctx"].default == 4096
    assert fields["local_llm_max_tokens"].default == 1200
    # Nothing loads a model at start-up unless explicitly enabled.
    assert fields["asr_warmup_on_startup"].default is False
    assert fields["local_llm_warmup_on_startup"].default is False


def _tone(seconds: float, hz: float, sample_rate: int = 16000) -> bytes:
    frames = bytearray()
    n = int(seconds * sample_rate)
    for index in range(n):
        value = 0.65 * math.sin(2 * math.pi * hz * index / sample_rate)
        frames += struct.pack("<h", int(max(-1.0, min(1.0, value)) * 24000))
    return bytes(frames)


def _parse(text: str, schema):
    return schema.model_validate(coerce_llm_payload(extract_json_object(text), schema))


def test_default_real_audio_diarizer_is_local(monkeypatch) -> None:
    monkeypatch.setattr(settings, "diarization_provider", DiarizationProviderName.LOCAL)
    provider = build_diarization_provider(audio_source=AudioSource.MICROPHONE)
    assert isinstance(provider, LocalDiarizationProvider)


async def test_local_diarizer_splits_two_pitches() -> None:
    pcm = _tone(1.0, 110.0) + _tone(1.0, 240.0)
    frame = AudioFrame(
        session_id="local-diar",
        sequence=1,
        pcm=pcm,
        sample_rate=16000,
        channels=1,
        start_time=0.0,
        end_time=2.0,
        source=AudioSource.MICROPHONE,
        speech_ratio=0.9,
        speech_regions=[(0.0, 1.0), (1.0, 2.0)],
    )
    turns = await LocalDiarizationProvider().diarize(frame)
    labels = {turn.speaker_id for turn in turns}
    assert "speaker_0" in labels
    assert "speaker_1" in labels


def test_llm_extracts_json_from_reasoning_text() -> None:
    text = (
        "The patient mentioned fever. Final answer:\n"
        '{"entities": [{"entity_type": "SYMPTOM", "value": "fever", "status": "PRESENT",'
        ' "source_segment_ids": ["seg_001"]}], "unsupported_content": []}'
    )
    parsed = _parse(text, ExtractionResult)
    assert parsed.entities[0].value == "fever"


def test_llm_repairs_truncated_json() -> None:
    text = '{"entities": [{"entity_type": "SYMPTOM", "value": "fever", "status": "PRESENT"'
    parsed = _parse(text, ExtractionResult)
    assert parsed.entities[0].value == "fever"


def test_extraction_prompt_includes_confidence_example() -> None:
    prompt = build_extraction_prompt(
        session_context={"reference": "MS-1"},
        segments=[{"ref": "seg_001", "start_time": 0.0, "role": "PATIENT", "speaker_label": "speaker_1", "confidence": 0.9, "text": "I have a fever."}],
    )
    assert "confidence" in prompt
    assert '"entity_type": "SYMPTOM"' in prompt or '"entity_type":"SYMPTOM"' in prompt


def test_llm_parses_entities_missing_confidence() -> None:
    payload = {
        "entities": [
            {
                "entity_type": "SYMPTOM",
                "value": "fever",
                "status": "PRESENT",
                "source_segment_ids": ["seg_001"],
            }
        ]
    }
    parsed = _parse(json.dumps(payload), ExtractionResult)
    assert parsed.entities[0].value == "fever"
    assert parsed.entities[0].confidence == 0.75


def test_llm_parses_note_without_confidence() -> None:
    payload = {
        "note": {
            "chief_complaint": {"text": "Fever", "source_segment_ids": ["seg_001"]},
            "history_of_present_illness": {"text": "", "source_segment_ids": []},
            "relevant_medical_history": {"text": "", "source_segment_ids": []},
            "assessment": {"text": "", "source_segment_ids": []},
            "plan": {"text": "", "source_segment_ids": []},
            "follow_up": {"text": "", "source_segment_ids": []},
        },
        "changed_sections": ["chief_complaint"],
    }
    parsed = _parse(json.dumps(payload), NoteUpdate)
    assert parsed.note.chief_complaint.text == "Fever"
    assert parsed.note.chief_complaint.confidence == 0.75


def test_llm_parses_fenced_json() -> None:
    text = """```json
{"entities": [{"entity_type": "SYMPTOM", "value": "chest pain", "status": "PRESENT",
"confidence": 0.9, "source_segment_ids": ["seg_001"]}], "unsupported_content": []}
```"""
    parsed = _parse(text, ExtractionResult)
    assert parsed.entities[0].value == "chest pain"


def test_build_asr_provider_parakeet() -> None:
    from app.services.asr import build_asr_provider
    from app.services.asr.parakeet_provider import ParakeetASRProvider

    provider = build_asr_provider(provider_name="parakeet")
    assert isinstance(provider, ParakeetASRProvider)
    assert provider.name == "parakeet"
    desc = provider.describe()
    assert desc["model"] == "nvidia/parakeet-ctc-0.6b"
    assert desc["language"] == "en"


def test_session_create_schema_accepts_asr_provider() -> None:
    from app.schemas.session import SessionCreate

    sc = SessionCreate(
        name="Test",
        patient_id="PT-001",
        asr_provider="parakeet",
    )
    assert sc.asr_provider == "parakeet"


async def test_multi_symptom_clinical_extraction() -> None:
    from app.services.nlp.clinical_nlp import ClinicalNLPService
    from app.services.types import AssembledSegment
    from app.models.enums import SpeakerRole, EntityType

    utterance = (
        "hello doctor i have had cold for two days now and slight fever which is ranging around "
        "ninety nine to hundred and one degree fahrenheit and i have had slight body pain and "
        "breathing issues as well"
    )
    seg = AssembledSegment(
        ref="seg_001",
        speaker_label="speaker_0",
        role=SpeakerRole.PATIENT,
        text=utterance,
        start_time=0.0,
        end_time=8.0,
        confidence=0.95,
        asr_confidence=0.95,
        diarization_confidence=0.95,
    )
    candidates = ClinicalNLPService().extract([seg])
    found_types_values = {(c.entity_type, c.value.lower()) for c in candidates}

    assert any(t == EntityType.SYMPTOM and "cold" in v for t, v in found_types_values)
    assert any(t == EntityType.SYMPTOM and "fever" in v for t, v in found_types_values)
    assert any(t == EntityType.SYMPTOM and "body pain" in v for t, v in found_types_values)
    assert any(t == EntityType.SYMPTOM and "breathing issues" in v for t, v in found_types_values)
    assert any(t == EntityType.DURATION and "two days" in v for t, v in found_types_values)
    assert any(t == EntityType.FINDING for t, _ in found_types_values)

    from app.services.llm.mock_provider import DeterministicLLMProvider

    entities = [
        {"entity_type": c.entity_type.value, "value": c.value, "status": c.status.value, "source_segment_ids": c.source_segment_refs}
        for c in candidates
    ]
    note_resp = await DeterministicLLMProvider().generate_note(
        session_context={"reference": "SIM-01"},
        segments=[{"ref": seg.ref, "text": seg.text, "role": "PATIENT", "speaker_label": "speaker_0"}],
        entities=entities,
    )
    cc = note_resp.result.note.chief_complaint.text
    hpi = note_resp.result.note.history_of_present_illness.text
    assert "cold" in cc.lower()
    assert "fever" in cc.lower()
    assert "body pain" in cc.lower() or "pain" in cc.lower()
    assert "breathing" in cc.lower()
    assert "two days" in cc.lower()
    # Patient-only history: the doctor voiced no impression or plan, so none is written.
    assert note_resp.result.note.assessment.text == "Not mentioned"
    assert note_resp.result.note.plan.text == "Not mentioned"
