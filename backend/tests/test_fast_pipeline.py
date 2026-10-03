"""Latency work: streamed recording pieces, skipped redundant LLM passes, compact
LLM output, CPU/GPU auto-selection and native-script Tamil/Hindi grounding.

No model is loaded and no network is used.
"""

from __future__ import annotations

import json
import sys
import types

import httpx

from app.models.enums import EntityType, SessionStatus
from app.services.asr.code_switch import colloquial_glossary
from app.services.asr.faster_whisper_provider import resolve_device
from app.services.diarization.gemini_provider import GeminiDiarizationProvider
from app.services.llm.grounding import cite_entities
from app.services.llm.local_provider import LocalLLMProvider, build_single_pass_prompt
from app.services.llm.schemas import ExtractedEntity
from app.services.pipeline import pipeline
from tests.test_real_audio_transcription import (
    SPOKEN_SENTENCE,
    StubGeminiASR,
    _microphone_session,
    speech_like_wav,
)

CONSULT = [
    {"ref": "seg_001", "role": "DOCTOR", "speaker_label": "speaker_0", "text": "What is the problem?"},
    {"ref": "seg_002", "role": "PATIENT", "speaker_label": "speaker_1", "text": "எனக்கு மூணு நாளா தலைவலி doctor."},
    {"ref": "seg_003", "role": "DOCTOR", "speaker_label": "speaker_0", "text": "Bukhar bhi hai?"},
    {"ref": "seg_004", "role": "PATIENT", "speaker_label": "speaker_1", "text": "हाँ, कल रात से बुखार है।"},
]


# ------------------------------------------------------------ device choice
def _fake_ctranslate2(monkeypatch, gpus: int) -> None:
    module = types.SimpleNamespace(get_cuda_device_count=lambda: gpus)
    monkeypatch.setitem(sys.modules, "ctranslate2", module)


def test_auto_device_uses_the_gpu_when_present(monkeypatch) -> None:
    _fake_ctranslate2(monkeypatch, 1)
    assert resolve_device("auto", "auto") == ("cuda", "float16")


def test_auto_device_falls_back_to_cpu_int8(monkeypatch) -> None:
    _fake_ctranslate2(monkeypatch, 0)
    assert resolve_device("auto", "auto") == ("cpu", "int8")
    assert resolve_device("cuda", "int8_float16") == ("cuda", "int8_float16")


# ------------------------------------------------------- native-script terms
def test_tamil_and_hindi_script_terms_are_grounded_and_glossed() -> None:
    entities = [
        ExtractedEntity(entity_type=EntityType.SYMPTOM, value="headache"),
        ExtractedEntity(entity_type=EntityType.SYMPTOM, value="fever"),
    ]
    cite_entities(entities, {s["ref"]: s["text"] for s in CONSULT})
    assert entities[0].source_segment_ids == ["seg_002"]
    assert set(entities[1].source_segment_ids) == {"seg_003", "seg_004"}

    glossary = colloquial_glossary(" ".join(s["text"] for s in CONSULT))
    assert glossary["தலைவலி"] == "headache"
    assert glossary["बुखार"] == "fever"


# ----------------------------------------------------------------- prompt
def test_prompt_prefix_is_stable_as_the_transcript_grows() -> None:
    early = build_single_pass_prompt(CONSULT[:2])
    later = build_single_pass_prompt(CONSULT, [{"value": "fever", "status": "PRESENT"}])
    transcript_start = early.index("TRANSCRIPT:")
    assert later[:transcript_start] == early[:transcript_start]
    # Per-update extras come after the transcript, never before it.
    assert later.index("Terms a rule engine spotted") > later.index("[seg_004]")


def _reply(content: dict) -> httpx.Response:
    return httpx.Response(
        200,
        json={"message": {"role": "assistant", "content": json.dumps(content)}},
        request=httpx.Request("POST", "http://gpu-host:11434/api/chat"),
    )


async def test_compact_reply_is_cited_locally_and_gemma4_does_not_think(monkeypatch) -> None:
    provider = LocalLLMProvider(base_url="http://gpu-host:11434", model="gemma4:e4b", fallback_models=[])
    captured: dict = {}

    async def fake_post(url, json=None, **_kwargs):  # noqa: A002
        captured["payload"] = json
        return _reply(
            {
                "note": {"chief_complaint": "Headache for 3 days with fever since last night."},
                "entities": [
                    {"type": "SYMPTOM", "value": "headache", "status": "PRESENT"},
                    {"type": "SYMPTOM", "value": "fever", "status": "PRESENT", "detail": "since last night"},
                ],
            }
        )

    monkeypatch.setattr(provider._get_client(), "post", fake_post)
    extraction = await provider.extract_entities(session_context={}, segments=CONSULT)

    assert captured["payload"]["think"] is False
    assert captured["payload"]["messages"][0]["role"] == "system"
    cited = {entity.value: entity.source_segment_ids for entity in extraction.result.entities}
    assert cited["headache"] == ["seg_002"]
    assert "seg_004" in cited["fever"]

    note = (await provider.generate_note(session_context={}, segments=CONSULT, entities=[])).result.note
    assert note.chief_complaint.text.startswith("Headache for 3 days")
    assert note.plan.text == ""
    await provider.aclose()


def test_think_flag_is_only_sent_to_gemma4() -> None:
    provider = LocalLLMProvider(base_url="http://gpu-host:11434", model="gemma2:9b", fallback_models=[])
    _url, payload = provider._payload("hello", "gemma2:9b", stream=False)
    assert "think" not in payload


# ------------------------------------------------------- streamed recording
async def test_live_pieces_draft_in_background_and_stop_reuses_the_note(client, monkeypatch) -> None:
    session = await _microphone_session(client)
    runtime = pipeline.runtime(session["id"])
    assert runtime is not None
    runtime.asr = StubGeminiASR(
        f'{{"turns":[{{"speaker":"speaker_1","text":"{SPOKEN_SENTENCE}","start":0.0,"end":2.0}}]}}'
    )
    runtime.diarizer = GeminiDiarizationProvider()

    calls: list[int] = []
    original = runtime.llm.extract_entities

    async def counting(**kwargs):
        calls.append(len(kwargs["segments"]))
        return await original(**kwargs)

    monkeypatch.setattr(runtime.llm, "extract_entities", counting)
    upload = f"/api/sessions/{session['id']}/audio/upload"
    wav = {"file": ("piece.wav", speech_like_wav(), "audio/wav")}

    piece = await client.post(f"{upload}?final=false", files=wav)
    assert piece.status_code == 200, piece.text
    assert piece.json()["ok"] is True
    assert runtime.ai_task is not None
    await runtime.ai_task
    assert calls == [1], "a piece is drafted in the background"

    last = await client.post(f"{upload}?final=true", files={"file": ("last.wav", speech_like_wav(), "audio/wav")})
    assert last.status_code == 200, last.text
    assert last.json()["ok"] is True
    assert calls == [1, 2], "the last piece waits for one pass over the whole transcript"

    stopped = await client.post(f"/api/sessions/{session['id']}/stop")
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["status"] == SessionStatus.REVIEW.value
    assert calls == [1, 2], "ending the session must not regenerate an up-to-date note"
