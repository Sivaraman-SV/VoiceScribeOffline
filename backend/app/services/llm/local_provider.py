"""Local LLM provider connecting to Ollama, llama.cpp, or any OpenAI-compatible local server.

Default stack for an RTX 4050 laptop (6 GB): Qwen 2.5 7B via Ollama on GPU,
Faster-Whisper on CPU so the two models do not share VRAM.
"""

from __future__ import annotations

import asyncio
import json
import random
import time
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.services.asr.medical_normalizer import normalize_segments
from app.services.llm.base import (
    ExtractionResponse,
    LLMCallStats,
    LLMError,
    LLMInvalidOutput,
    LLMProvider,
    LLMTimeout,
    LLMUnavailable,
    NoteResponse,
)
from app.services.llm.grounding import filter_ungrounded_entities, purge_note_hallucinations
from app.services.llm.json_parse import extract_json_object
from app.services.llm.schemas import ExtractionResult, NoteUpdate, coerce_llm_payload

logger = get_logger(__name__)

LOCAL_SYSTEM_INSTRUCTION = """\
You are an expert ambient clinical scribe for medical encounters.
Your role is to produce thorough, professional, high-accuracy clinical documentation in standard medical English.
Extract every spoken symptom, duration, severity, vital sign, and clinical complaint without omission.
Synthesize structured SOAP documentation with high clinical fidelity.
Always output valid JSON only.
"""


def _build_local_extraction_prompt(
    segments: list[dict[str, Any]],
    rule_hints: list[dict[str, Any]] | None = None,
) -> str:
    transcript = "\n".join(
        f"[{s.get('ref', 'seg')}] {s.get('speaker_label', 'speaker')}: {s.get('text', '')}"
        for s in segments
    )
    hints_text = ""
    if rule_hints:
        valid_hints = [h for h in rule_hints if h.get("value")]
        if valid_hints:
            hints_text = (
                "CLINICAL NLP HINTS DETECTED IN TRANSCRIPT:\n"
                f"{json.dumps(valid_hints, default=str)}\n"
            )

    return f"""You are an expert medical scribe. Carefully analyze the consultation transcript, extract ALL clinical entities, and draft a comprehensive, high-quality SOAP clinical note in valid JSON format.

EXTRACTION INSTRUCTIONS:
1. Extract EVERY symptom spoken by the patient (e.g., "cold", "fever", "body pain", "breathing issues", "cough", "headache", "chest discomfort"). Never omit any symptom.
2. Extract durations (e.g., "for two days", "2 days", "since yesterday") as DURATION entities.
3. Extract severity, temperature, or quantified vitals (e.g., "99 to 101 degrees Fahrenheit", "slight", "severe") as FINDING or SEVERITY entities.
4. Extract all medications, sprays, and topicals mentioned (e.g., "Volini", "Dolo 650", "Paracetamol", "Moov", "Combiflam").
5. Mark denied symptoms (e.g., "no chest pain", "no vomiting") with status NEGATED.

SOAP NOTE REQUIREMENTS:
- chief_complaint: Comprehensive list of ALL presenting complaints with duration (e.g., "Cold, fever (99°F–101°F), generalized body pain, and breathing difficulty for 2 days").
- history_of_present_illness: A rich, chronological clinical narrative detailing onset, symptom character, temperature range, severity, breathing difficulty, and functional impact.
- past_medical_history: Chronic illnesses or surgical history mentioned, or "" if none.
- physical_examination: Reported vitals, temperature, oxygen saturation, or exam observations, or "" if none.
- current_medication: Medications or remedies used at home prior to or during this visit, or "" if none.
- allergies: Known allergies mentioned, or "" if none.
- assessment: Working diagnosis or clinical diagnostic impression reflecting the symptoms (e.g., "Acute febrile upper respiratory tract illness / viral syndrome with mild dyspnea").
- plan: Clinical guidance, symptomatic relief (rest, hydration, antipyretics), vitals monitoring (temperature, SpO2), and return warnings if dyspnea worsens.
- follow_up: Specific follow-up timeframe (e.g., "Review in 48 to 72 hours, or immediately if shortness of breath or fever worsens").

TRANSCRIPT:
{transcript}
{hints_text}
Output JSON format:
{{"entities": [
  {{"entity_type": "SYMPTOM", "value": "cold", "status": "PRESENT", "confidence": 0.95, "source_segment_ids": ["seg_0001"]}},
  {{"entity_type": "DURATION", "value": "for two days", "status": "PRESENT", "confidence": 0.95, "source_segment_ids": ["seg_0001"]}},
  {{"entity_type": "SYMPTOM", "value": "fever", "status": "PRESENT", "confidence": 0.95, "source_segment_ids": ["seg_0001"]}},
  {{"entity_type": "FINDING", "value": "temperature 99 to 101 F", "status": "PRESENT", "confidence": 0.95, "source_segment_ids": ["seg_0001"]}},
  {{"entity_type": "SYMPTOM", "value": "body pain", "status": "PRESENT", "confidence": 0.95, "source_segment_ids": ["seg_0001"]}},
  {{"entity_type": "SYMPTOM", "value": "breathing issues", "status": "PRESENT", "confidence": 0.95, "source_segment_ids": ["seg_0001"]}}
], "unsupported_content": [],
"note": {{
  "chief_complaint": "Cold, fever (99°F–101°F), generalized body pain, and breathing difficulty for 2 days",
  "history_of_present_illness": "Patient presents with a 2-day history of cold accompanied by slight fever ranging between 99°F and 101°F. Also reports associated mild generalized body pain and difficulty breathing.",
  "past_medical_history": "",
  "physical_examination": "Temperature: 99°F–101°F (reported). Subjective breathing difficulty noted.",
  "current_medication": "",
  "allergies": "",
  "assessment": "Acute febrile upper respiratory tract infection / viral syndrome with mild dyspnea.",
  "plan": "Advised adequate rest and oral hydration. Symptomatic antipyretic (Paracetamol) as needed for fever and body pain. Monitor temperature and SpO2. Urgent review if breathing difficulty worsens.",
  "follow_up": "Review in 48 to 72 hours, or immediately if shortness of breath worsens."
}}}}"""


def _build_local_note_prompt(
    segments: list[dict[str, Any]],
    entities: list[dict[str, Any]],
) -> str:
    transcript = "\n".join(
        f"[{s.get('ref', 'seg')}] {s.get('speaker_label', 'speaker')}: {s.get('text', '')}"
        for s in segments
    )
    findings = ", ".join(
        f"{e.get('value')} ({e.get('status')})" for e in entities if e.get("value")
    ) or "None documented"

    return f"""You are a professional medical scribe. Write a comprehensive, high-quality SOAP clinical note in standard clinical English based on the consultation transcript below.

SECTION REQUIREMENTS:
- chief_complaint: Comprehensive summary of all presenting complaints with duration (e.g., "Cold, fever (99°F–101°F), generalized body pain, and breathing difficulty for 2 days").
- history_of_present_illness: Detailed narrative of the illness including symptom onset, progression, severity, temperature range, and any aggravating/relieving factors.
- past_medical_history: Chronic conditions or surgical history discussed (or "" if not discussed).
- physical_examination: Vitals, temperature, or exam findings mentioned (or "" if not discussed).
- current_medication: Medications or remedies used by the patient at home prior to or during visit (or "" if not discussed).
- allergies: Known drug/food allergies mentioned (or "" if not discussed).
- assessment: Working clinical diagnosis or diagnostic impression based on the symptoms (e.g., "Acute febrile upper respiratory tract illness / viral syndrome with mild dyspnea").
- plan: Clinical guidance, symptomatic relief, vitals monitoring, and return precautions.
- follow_up: Specific follow-up timeframe and emergency warning signs.

TRANSCRIPT:
{transcript}

EXTRACTED FINDINGS:
{findings}

Return JSON with keys:
chief_complaint, history_of_present_illness, past_medical_history, physical_examination, current_medication, allergies, assessment, plan, follow_up"""


class LocalLLMProvider(LLMProvider):
    """Local offline LLM provider running via Ollama / llama.cpp / vLLM."""

    name = "local"
    is_mock = False

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
        max_retries: int | None = None,
        temperature: float | None = None,
    ) -> None:
        self.base_url = (base_url or settings.local_llm_base_url).rstrip("/")
        self.model = model or settings.local_llm_model
        self.timeout_seconds = timeout_seconds or settings.local_llm_timeout_seconds
        self.max_retries = max_retries or settings.local_llm_max_retries
        self.temperature = settings.local_llm_temperature if temperature is None else temperature
        self._client: httpx.AsyncClient | None = None
        self._cached_note: tuple[str, dict[str, Any], LLMCallStats] | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout_seconds, connect=10.0),
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def _post_chat(self, prompt: str, *, purpose: str) -> tuple[str, LLMCallStats]:
        client = self._get_client()
        num_ctx = getattr(settings, "local_llm_num_ctx", 4096)
        max_tokens = getattr(settings, "local_llm_max_tokens", 1500)

        is_ollama = "11434" in self.base_url
        if is_ollama:
            ollama_base = self.base_url[:-3] if self.base_url.endswith("/v1") else self.base_url
            url = f"{ollama_base}/api/chat"
            model_l = self.model.lower()
            if "gemma" in model_l:
                chat_messages = [
                    {"role": "user", "content": f"{LOCAL_SYSTEM_INSTRUCTION}\n\n{prompt}"}
                ]
            else:
                chat_messages = [
                    {"role": "system", "content": LOCAL_SYSTEM_INSTRUCTION},
                    {"role": "user", "content": prompt},
                ]
            payload = {
                "model": self.model,
                "messages": chat_messages,
                "stream": False,
                "format": "json",
                "options": {
                    "num_gpu": 99,
                    "num_thread": 8,
                    "num_ctx": num_ctx,
                    "num_predict": max_tokens,
                    "temperature": self.temperature,
                },
            }
        else:
            url = f"{self.base_url}/chat/completions"
            payload = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": LOCAL_SYSTEM_INSTRUCTION},
                    {"role": "user", "content": prompt},
                ],
                "temperature": self.temperature,
                "max_tokens": max_tokens,
                "response_format": {"type": "json_object"},
                "stream": False,
            }

        attempts = 0
        started = time.perf_counter()
        last_error: LLMError | None = None

        while attempts < max(1, self.max_retries):
            attempts += 1
            try:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
            except httpx.ConnectError as exc:
                last_error = LLMUnavailable(
                    f"Could not connect to local LLM at {self.base_url}. "
                    "Ensure Ollama or local LLM server is running (e.g. 'ollama serve')."
                )
                logger.warning(
                    "local_llm_connect_failed",
                    extra={"purpose": purpose, "attempt": attempts, "error": str(exc)},
                )
            except httpx.TimeoutException as exc:
                last_error = LLMTimeout(f"Local LLM call timed out after {self.timeout_seconds:.0f}s")
                logger.warning("local_llm_timeout", extra={"purpose": purpose, "attempt": attempts})
                _ = exc
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                error_body = exc.response.text[:300]
                if status == 404:
                    last_error = LLMUnavailable(
                        f"Model '{self.model}' not found on local LLM server. "
                        f"Run 'ollama pull {self.model}' to download it."
                    )
                else:
                    last_error = LLMUnavailable(f"Local LLM returned HTTP {status}: {error_body}")
                logger.warning(
                    "local_llm_http_error",
                    extra={"purpose": purpose, "attempt": attempts, "status": status, "body": error_body},
                )
            except Exception as exc:
                last_error = LLMError(f"Unexpected local LLM error: {exc}")
                logger.warning("local_llm_error", extra={"purpose": purpose, "attempt": attempts, "error": str(exc)})
            else:
                if is_ollama and "message" in data:
                    raw_content = data.get("message", {}).get("content", "") or ""
                    duration_ms = (time.perf_counter() - started) * 1000
                    stats = LLMCallStats(
                        provider=self.name,
                        model=self.model,
                        duration_ms=round(duration_ms, 2),
                        attempts=attempts,
                        prompt_tokens=data.get("prompt_eval_count"),
                        output_tokens=data.get("eval_count"),
                    )
                    return raw_content, stats

                choices = data.get("choices") or []
                if not choices:
                    last_error = LLMInvalidOutput("Local LLM returned no choices.")
                else:
                    raw_content = choices[0].get("message", {}).get("content", "") or ""
                    if not raw_content.strip():
                        last_error = LLMInvalidOutput("Local LLM returned empty message content.")
                    else:
                        duration_ms = (time.perf_counter() - started) * 1000
                        usage = data.get("usage") or {}
                        stats = LLMCallStats(
                            provider=self.name,
                            model=self.model,
                            duration_ms=round(duration_ms, 2),
                            attempts=attempts,
                            prompt_tokens=usage.get("prompt_tokens"),
                            output_tokens=usage.get("completion_tokens"),
                        )
                        return raw_content, stats

            if attempts < self.max_retries:
                await asyncio.sleep(min(4.0, 0.5 * (2 ** (attempts - 1))) + random.uniform(0, 0.2))

        raise last_error or LLMUnavailable("Local LLM call failed")

    async def extract_entities(
        self,
        *,
        session_context: dict[str, Any],
        segments: list[dict[str, Any]],
        rule_based_candidates: list[dict[str, Any]] | None = None,
        existing_entities: list[dict[str, Any]] | None = None,
    ) -> ExtractionResponse:
        clean_segments = normalize_segments(segments)
        prompt = _build_local_extraction_prompt(
            segments=clean_segments,
            rule_hints=rule_based_candidates,
        )
        raw_text, stats = await self._post_chat(prompt, purpose="entity_extraction")
        try:
            parsed_json = extract_json_object(raw_text)
            coerced = coerce_llm_payload(parsed_json, ExtractionResult)
            result = ExtractionResult.model_validate(coerced)
            segment_texts = {
                str(s.get("ref", "")): str(s.get("text", "")) for s in clean_segments
            }
            kept, dropped = filter_ungrounded_entities(
                result.entities,
                segment_texts=segment_texts,
                full_transcript=" ".join(segment_texts.values()),
            )
            if dropped:
                logger.info("local_llm_dropped_ungrounded_entities", extra={"dropped": dropped})
            result.entities = kept

            # Cache the single-pass note if produced by the unified prompt
            transcript_key = " ".join(str(s.get("text", "")) for s in clean_segments)
            if isinstance(parsed_json, dict) and "note" in parsed_json and isinstance(parsed_json["note"], dict):
                self._cached_note = (transcript_key, parsed_json["note"], stats)

            return ExtractionResponse(result=result, stats=stats)
        except Exception as exc:
            logger.warning("local_llm_extraction_parse_error", extra={"raw": raw_text[:400], "error": str(exc)})
            raise LLMInvalidOutput(f"Local LLM returned malformed extraction JSON: {exc}") from exc

    def _link_provenance(self, result: NoteUpdate, clean_segments: list[dict[str, Any]]) -> None:
        """Auto-link transcript segment provenance for documented sections."""
        seg_dict = {
            str(s.get("ref", "")): str(s.get("text", "")).lower()
            for s in clean_segments
            if s.get("ref") and s.get("text")
        }
        all_refs = list(seg_dict.keys())

        for key, _ in result.note.model_dump().items():
            section_obj = getattr(result.note, key, None)
            if not section_obj or not section_obj.text:
                continue
            if not section_obj.source_segment_ids:
                sec_words = set(re.findall(r"\w{3,}", section_obj.text.lower()))
                sec_words.difference_update({
                    "the", "and", "for", "with", "was", "has", "have", "had",
                    "not", "patient", "reports", "doctor", "history", "clinical"
                })
                matched = [
                    ref for ref, seg_txt in seg_dict.items()
                    if any(w in seg_txt for w in sec_words)
                ]
                section_obj.source_segment_ids = matched if matched else (all_refs[:3] if all_refs else [])

    async def generate_note(
        self,
        *,
        session_context: dict[str, Any],
        segments: list[dict[str, Any]],
        entities: list[dict[str, Any]],
        current_note: dict[str, Any] | None = None,
    ) -> NoteResponse:
        clean_segments = normalize_segments(segments)
        transcript_key = " ".join(str(s.get("text", "")) for s in clean_segments)

        # Fast path: reuse single-pass note generated during extraction
        cached = self._cached_note
        if cached is not None and cached[0] == transcript_key and isinstance(cached[1], dict):
            logger.info("local_llm_reusing_single_pass_note", extra={"model": self.model})
            note_dict, stats = cached[1], cached[2]
            self._cached_note = None
            try:
                coerced = coerce_llm_payload(note_dict, NoteUpdate)
                result = NoteUpdate.model_validate(coerced)
                purge_note_hallucinations(result, clean_segments, entities)
                self._link_provenance(result, clean_segments)
                return NoteResponse(result=result, stats=stats)
            except Exception as exc:
                logger.warning("cached_note_coercion_failed_falling_back", extra={"error": str(exc)})

        prompt = _build_local_note_prompt(
            segments=clean_segments,
            entities=entities,
        )
        raw_text, stats = await self._post_chat(prompt, purpose="note_generation")
        try:
            parsed_json = extract_json_object(raw_text)
            coerced = coerce_llm_payload(parsed_json, NoteUpdate)
            result = NoteUpdate.model_validate(coerced)
            purge_note_hallucinations(result, clean_segments, entities)
            self._link_provenance(result, clean_segments)
            return NoteResponse(result=result, stats=stats)
        except Exception as exc:
            logger.warning("local_llm_note_parse_error", extra={"raw": raw_text[:400], "error": str(exc)})
            raise LLMInvalidOutput(f"Local LLM returned malformed clinical note JSON: {exc}") from exc

    async def check_connection(self) -> dict[str, Any]:
        """Verify local LLM server accessibility and model readiness."""
        client = self._get_client()
        try:
            resp = await client.get("/models")
            resp.raise_for_status()
            models_data = resp.json()
            available_models = [m.get("id", "") for m in (models_data.get("data") or [])]
            has_target = any(self.model in m for m in available_models)
            return {
                "ok": True,
                "provider": self.name,
                "model": self.model,
                "base_url": self.base_url,
                "model_available": has_target,
                "installed_models": available_models[:10],
            }
        except httpx.ConnectError:
            return {
                "ok": False,
                "provider": self.name,
                "error": f"Connection refused at {self.base_url}. Ensure Ollama or local LLM server is running.",
            }
        except Exception as exc:
            return {
                "ok": False,
                "provider": self.name,
                "error": str(exc),
            }

    async def aclose(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
