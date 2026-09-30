"""LLM failure visibility, model fallback, strict grounding and Indian-language handling.

All network calls are faked; no model is loaded.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.models.enums import AudioSource, NoteStatus, SessionMode
from app.schemas.clinical import ClinicalNoteContent
from app.services.asr.code_switch import colloquial_glossary
from app.services.asr.medical_normalizer import normalize_medical_transcript
from app.services.diarization.text_splitter import ClinicalTextSplitter
from app.services.llm.base import LLMServiceUnavailable, LLMUnavailable
from app.services.llm.grounding import is_grounded, purge_note_hallucinations, unspoken_drugs
from app.services.llm.local_provider import (
    LocalLLMProvider,
    build_single_pass_prompt,
    format_transcript,
    partial_note_sections,
)
from app.services.llm.schemas import NoteUpdate, coerce_llm_payload
from app.services.note_engine.engine import NoteUpdateOutcome
from app.services.pipeline import LLM_SERVICE_UNAVAILABLE, SessionPipeline, SessionRuntime

HEADACHE_CONSULT = [
    {"ref": "seg_001", "role": "DOCTOR", "speaker_label": "speaker_0", "text": "How long have you had this headache?"},
    {
        "ref": "seg_002",
        "role": "PATIENT",
        "speaker_label": "speaker_1",
        "text": "Since 5 days doctor, very severe, over the forehead. I have sinus problem before.",
    },
    {"ref": "seg_003", "role": "DOCTOR", "speaker_label": "speaker_0", "text": "Did you take any tablet?"},
    {"ref": "seg_004", "role": "PATIENT", "speaker_label": "speaker_1", "text": "Yes, I took one dark tablet."},
    {"ref": "seg_005", "role": "DOCTOR", "speaker_label": "speaker_0", "text": "Do you smoke or drink?"},
    {
        "ref": "seg_006",
        "role": "PATIENT",
        "speaker_label": "speaker_1",
        "text": "No doctor, I don't smoke or drink. I go walking daily.",
    },
]

# What a real Ollama reply looks like: plain-string sections without segment ids.
LLM_REPLY = {
    "note": {
        "chief_complaint": "Severe frontal headache for 5 days",
        "history_of_present_illness": "Severe headache over the forehead for 5 days. Took one Dolo tablet.",
        "review_of_systems": "Not mentioned",
        "relevant_medical_history": "Prior sinus problem.",
        "social_history": "Non-smoker. Denies alcohol use. Walks daily.",
        "current_medication": "Dolo tablet, one dose taken.",
        "physical_examination": "Not mentioned",
        "assessment": "Acute sinusitis",
        "plan": "Tab Paracetamol 650 mg TDS for 3 days. CT scan of sinuses.",
        "follow_up": "Review after 3 days.",
    },
    "entities": [
        {"entity_type": "SYMPTOM", "value": "headache", "status": "PRESENT", "source_segment_ids": ["seg_001", "seg_002"]},
        {"entity_type": "DURATION", "value": "5 days", "status": "PRESENT", "source_segment_ids": ["seg_002"]},
    ],
}


def _ollama_response(content: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code=status,
        json={"message": {"role": "assistant", "content": json.dumps(content)}, "prompt_eval_count": 900, "eval_count": 400},
        request=httpx.Request("POST", "http://gpu-host:11434/api/chat"),
    )


# ------------------------------------------------------------ the original crash
async def test_plain_string_sections_produce_llm_note_not_fallback(monkeypatch) -> None:
    """Sections without segment ids used to raise NameError (``re`` not imported)."""
    provider = LocalLLMProvider(base_url="http://gpu-host:11434", model="gemma2:9b", fallback_models=[])

    async def fake_post(url, json=None, **_kwargs):  # noqa: A002
        return _ollama_response(LLM_REPLY)

    monkeypatch.setattr(provider._get_client(), "post", fake_post)
    extraction = await provider.extract_entities(session_context={}, segments=HEADACHE_CONSULT)
    note = (await provider.generate_note(session_context={}, segments=HEADACHE_CONSULT, entities=[])).result.note

    assert extraction.result.entities
    assert note.chief_complaint.text == "Severe frontal headache for 5 days"
    assert "Non-smoker" in note.social_history.text
    assert note.relevant_medical_history.text == "Prior sinus problem."
    assert note.history_of_present_illness.source_segment_ids, "provenance should be linked"
    # The doctor never prescribed, ordered a scan, diagnosed, or set a review date.
    assert note.plan.text == ""
    assert note.assessment.text == ""
    assert note.follow_up.text == ""
    await provider.aclose()


def test_transcript_is_speaker_labelled_for_the_prompt() -> None:
    text = format_transcript(HEADACHE_CONSULT[:2])
    assert text.splitlines()[0] == "[seg_001] Doctor: How long have you had this headache?"
    assert text.splitlines()[1].startswith("[seg_002] Patient: Since 5 days")
    unknown = format_transcript([{"ref": "seg_009", "speaker_label": "speaker_1", "text": "hello"}])
    assert unknown == "[seg_009] Speaker 2: hello"


def test_prompt_puts_note_first_and_carries_vernacular_glossary() -> None:
    prompt = build_single_pass_prompt(
        [{"ref": "seg_001", "role": "PATIENT", "text": "Doctor, enakku thalai vali irukku, kallu tiruguthunnayi"}]
    )
    assert prompt.index('"note"') < prompt.index('"entities"')
    assert '"thalai vali" = headache' in prompt
    assert '"kallu tiruguthunnayi" = giddiness / vertigo' in prompt
    assert "Not mentioned" in prompt


# ---------------------------------------------------------------- model chain
async def test_missing_model_falls_back_to_next_in_chain(monkeypatch) -> None:
    provider = LocalLLMProvider(
        base_url="http://gpu-host:11434", model="medgemma:9b", fallback_models=["gemma2:9b", "qwen2.5:14b"]
    )
    tried: list[str] = []

    async def fake_post(url, json=None, **_kwargs):  # noqa: A002
        tried.append(json["model"])
        if json["model"] == "medgemma:9b":
            return httpx.Response(404, json={"error": "model not found"}, request=httpx.Request("POST", url))
        return _ollama_response(LLM_REPLY)

    monkeypatch.setattr(provider._get_client(), "post", fake_post)
    response = await provider.extract_entities(session_context={}, segments=HEADACHE_CONSULT)

    assert tried == ["medgemma:9b", "gemma2:9b"]
    assert response.stats.model == "gemma2:9b"
    assert response.stats.detail["fallback_from"] == "medgemma:9b"
    assert provider.model == "gemma2:9b"
    await provider.aclose()


async def test_unusable_json_tries_next_model(monkeypatch) -> None:
    provider = LocalLLMProvider(base_url="http://gpu-host:11434", model="gemma2:9b", fallback_models=["qwen2.5:14b"])

    async def fake_post(url, json=None, **_kwargs):  # noqa: A002
        if json["model"] == "gemma2:9b":
            return httpx.Response(
                200, json={"message": {"content": '{"note": {"chief'}}, request=httpx.Request("POST", url)
            )
        return _ollama_response(LLM_REPLY)

    monkeypatch.setattr(provider._get_client(), "post", fake_post)
    response = await provider.extract_entities(session_context={}, segments=HEADACHE_CONSULT)
    assert response.stats.model == "qwen2.5:14b"
    await provider.aclose()


async def test_unreachable_server_is_a_service_unavailable_error(monkeypatch) -> None:
    provider = LocalLLMProvider(base_url="http://gpu-host:11434", model="gemma2:9b", max_retries=1)

    async def fake_post(*_args, **_kwargs):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(provider._get_client(), "post", fake_post)
    with pytest.raises(LLMServiceUnavailable) as info:
        await provider.extract_entities(session_context={}, segments=HEADACHE_CONSULT)
    assert info.value.code == "LLM_SERVICE_UNAVAILABLE"
    assert isinstance(info.value, LLMUnavailable)
    await provider.aclose()


async def test_ollama_options_keep_context_large_enough(monkeypatch) -> None:
    provider = LocalLLMProvider(base_url="https://abc.trycloudflare.com", model="gemma2:9b", fallback_models=[])
    captured: dict = {}

    async def fake_post(url, json=None, **_kwargs):  # noqa: A002
        captured["url"], captured["payload"] = url, json
        return _ollama_response(LLM_REPLY)

    monkeypatch.setattr(provider._get_client(), "post", fake_post)
    long_consult = HEADACHE_CONSULT * 20
    await provider.extract_entities(session_context={}, segments=long_consult)
    # A tunnel URL without :11434 must still use the native API, which honours num_ctx.
    assert captured["url"] == "https://abc.trycloudflare.com/api/chat"
    options = captured["payload"]["options"]
    prompt_chars = sum(len(m["content"]) for m in captured["payload"]["messages"])
    assert options["num_ctx"] >= prompt_chars / 3.2 + options["num_predict"]
    assert captured["payload"]["keep_alive"]
    await provider.aclose()


# ------------------------------------------------------------------ streaming
def test_partial_sections_are_read_from_incomplete_json() -> None:
    buffer = '{"note": {"chief_complaint": {"text": "Severe headache for 5 days", "source_segment_ids": []}, ' \
             '"history_of_present_illness": {"text": "Five-day history of severe fr'
    sections = partial_note_sections(buffer)
    assert sections["chief_complaint"] == "Severe headache for 5 days"
    assert sections["history_of_present_illness"] == "Five-day history of severe fr"


# ------------------------------------------------------ pipeline visibility
class _FailingLLM:
    name = "local"
    model = "gemma2:9b"
    is_mock = False

    async def extract_entities(self, **_kwargs):
        raise LLMServiceUnavailable("Could not connect to local LLM at http://gpu-host:11434.")

    def describe(self):
        return {"provider": self.name, "model": self.model, "mock": False}


async def test_llm_failure_is_loud_and_the_fallback_note_is_labelled(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []

    async def capture(session_id, event_type, payload):
        events.append((event_type.value, payload))

    monkeypatch.setattr("app.services.pipeline.manager.broadcast", capture)
    runtime = SessionRuntime(
        session_id="sess-1", reference="R-1", mode=SessionMode.DEMO, audio_source=AudioSource.SIMULATION, llm=_FailingLLM()
    )
    pipeline = SessionPipeline()

    provider, result = await pipeline._call_provider(
        runtime, "extraction", lambda active: active.extract_entities(session_context={}, segments=HEADACHE_CONSULT)
    )

    assert provider.is_mock and result is not None
    errors = [payload for kind, payload in events if kind == "PROCESSING_ERROR"]
    assert errors and errors[0]["code"] == LLM_SERVICE_UNAVAILABLE
    assert "[OFFLINE FALLBACK - OLLAMA DISCONNECTED]" in errors[0]["message"]
    assert runtime.ai_degraded is True

    outcome = NoteUpdateOutcome(content=ClinicalNoteContent(), status=NoteStatus.DRAFT, version=1)
    pipeline._mark_fallback(runtime, outcome, provider)
    assert outcome.content.fallback is not None
    assert outcome.content.fallback.label == "OFFLINE FALLBACK - OLLAMA DISCONNECTED"
    assert outcome.status is NoteStatus.REVIEW_REQUIRED
    assert outcome.review_flags[0]["severity"] == "ERROR"


async def test_final_pass_retries_the_llm_despite_cooldown(monkeypatch) -> None:
    async def noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr("app.services.pipeline.manager.broadcast", noop)
    calls = {"n": 0}

    class Flaky(_FailingLLM):
        async def extract_entities(self, **_kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise LLMServiceUnavailable("cold start")
            return "ok"

    runtime = SessionRuntime(
        session_id="sess-2", reference="R-2", mode=SessionMode.DEMO, audio_source=AudioSource.SIMULATION, llm=Flaky()
    )
    pipeline = SessionPipeline()
    call = lambda active: active.extract_entities(session_context={}, segments=HEADACHE_CONSULT)  # noqa: E731

    await pipeline._call_provider(runtime, "extraction", call)
    provider, _ = await pipeline._call_provider(runtime, "extraction", call)
    assert provider.is_mock and calls["n"] == 1, "mid-consultation update inside the cooldown skips the LLM"

    provider, result = await pipeline._call_provider(runtime, "extraction", call, final=True)
    assert provider.name == "local" and result == "ok"
    assert calls["n"] == 2
    assert runtime.ai_degraded is False and runtime.fallback_reason is None

    outcome = NoteUpdateOutcome(content=ClinicalNoteContent(), status=NoteStatus.DRAFT, version=1)
    pipeline._mark_fallback(runtime, outcome, provider)
    assert outcome.content.fallback is None


# ------------------------------------------------------------------ grounding
def _note(**sections: str) -> NoteUpdate:
    return NoteUpdate.model_validate(coerce_llm_payload({"note": sections}, NoteUpdate))


def test_prescription_not_spoken_by_doctor_is_removed() -> None:
    segments = HEADACHE_CONSULT + [
        {"ref": "seg_007", "role": "DOCTOR", "text": "This looks like sinusitis. Take Sinarest twice daily and steam inhalation."}
    ]
    update = _note(
        assessment="Acute sinusitis",
        plan="Sinarest twice daily. Steam inhalation. Tab Augmentin 625 mg BD for 5 days.",
    )
    purge_note_hallucinations(update, segments)
    assert update.note.assessment.text == "Acute sinusitis"
    assert "Sinarest" in update.note.plan.text
    assert "Steam inhalation" in update.note.plan.text
    assert "Augmentin" not in update.note.plan.text


def test_patient_words_cannot_become_the_doctors_assessment() -> None:
    segments = [
        {"ref": "seg_001", "role": "DOCTOR", "text": "What happened?"},
        {"ref": "seg_002", "role": "PATIENT", "text": "I think it is migraine, doctor. Severe headache."},
    ]
    update = _note(assessment="Migraine", plan="Tab Paracetamol 650 mg SOS")
    purge_note_hallucinations(update, segments)
    assert update.note.assessment.text == ""
    assert update.note.plan.text == ""


def test_unspoken_drug_detection_is_brand_generic_aware() -> None:
    assert unspoken_drugs("Continue Paracetamol", "I took Dolo yesterday") == []
    assert unspoken_drugs("Start Azithral 500", "I took Dolo yesterday") == ["azithral"]


# ------------------------------------------------------------- speech & roles
@pytest.mark.parametrize(
    ("spoken", "expected"),
    [
        ("I took one dark tablet", "I took one Dolo tablet"),
        ("he gave me a dollar tablet", "he gave me a Dolo tablet"),
        ("dolo 650 twice", "Dolo 650 twice"),
        ("pan 40 before food", "Pan 40 before food"),
        ("augmenting 625", "Augmentin 625"),
        ("sinarist for cold", "Sinarest for cold"),
    ],
)
def test_indian_brand_mishears_are_normalised(spoken: str, expected: str) -> None:
    assert normalize_medical_transcript(spoken) == expected
    assert normalize_medical_transcript(expected) == expected, "normalisation must be idempotent"


def test_vernacular_is_grounded_in_english() -> None:
    assert is_grounded("headache", "enakku thalai vali irukku")
    assert is_grounded("dizziness", "subah se chakkar aa raha hai")
    assert is_grounded("vertigo", "kallu tiruguthunnayi doctor garu")
    assert is_grounded("abdominal pain", "kadupu noppi undi")
    assert colloquial_glossary("gas trouble and loose motions")["gas trouble"] == "dyspepsia / gastritis"


def test_offline_splitter_labels_doctor_and_patient_turns() -> None:
    turns = [
        {"ref": "seg_001", "text": "How long have you had this headache?"},
        {"ref": "seg_002", "text": "Since 5 days, doctor. Very intense over the temples."},
        {"ref": "seg_003", "text": "Kab se chakkar aa raha hai?"},
        {"ref": "seg_004", "text": "Doctor sahab, mujhe subah se chakkar aa raha hai."},
        {"ref": "seg_005", "text": "Okay."},
    ]
    roles = ClinicalTextSplitter().split(turns)
    assert roles == {
        "seg_001": "doctor",
        "seg_002": "patient",
        "seg_003": "doctor",
        "seg_004": "patient",
        "seg_005": "doctor",
    }


@pytest.mark.parametrize("model_name", ["medscribe-rules-v1", "qwen2.5:7b", "gemini-2.5-flash", None])
def test_mock_mode_never_builds_a_real_llm(model_name) -> None:
    from app.services.llm import DeterministicLLMProvider, build_llm_provider

    assert isinstance(build_llm_provider(model_name), DeterministicLLMProvider)


def test_rule_engine_session_stays_on_rules_even_in_local_mode(monkeypatch) -> None:
    from app.core.config import AIMode, settings
    from app.services.llm import DeterministicLLMProvider, build_llm_provider
    from app.services.llm.local_provider import LocalLLMProvider

    monkeypatch.setattr(settings, "ai_mode", AIMode.LOCAL)
    assert isinstance(build_llm_provider("medscribe-rules-v1"), DeterministicLLMProvider)
    assert isinstance(build_llm_provider("qwen2.5:7b"), LocalLLMProvider)
