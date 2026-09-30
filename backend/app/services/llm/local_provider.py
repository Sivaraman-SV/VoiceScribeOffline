"""Local LLM provider for Ollama, llama.cpp, or any OpenAI-compatible server.

The server does not have to run on this machine: ``LOCAL_LLM_BASE_URL`` may
point at a GPU host elsewhere on the hospital network, or at an Ollama server
tunnelled out of a notebook during development.

One inference pass returns the SOAP note *and* the entity list. The note is
emitted first so that, when streaming, sections appear while the entity list is
still being generated.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
import time
from typing import Any, Callable

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.services.asr.code_switch import colloquial_glossary
from app.services.asr.medical_normalizer import normalize_segments
from app.services.llm.base import (
    ExtractionResponse,
    LLMCallStats,
    LLMError,
    LLMInvalidOutput,
    LLMModelNotFound,
    LLMProvider,
    LLMServiceUnavailable,
    LLMTimeout,
    LLMUnavailable,
    NoteResponse,
    PartialNoteCallback,
)
from app.services.llm.grounding import (
    expand_clinical_text,
    filter_ungrounded_entities,
    purge_note_hallucinations,
)
from app.services.llm.json_parse import extract_json_object
from app.services.llm.schemas import ExtractionResult, NoteUpdate, coerce_llm_payload

logger = get_logger(__name__)

NOTE_KEYS: tuple[str, ...] = (
    "chief_complaint",
    "history_of_present_illness",
    "review_of_systems",
    "relevant_medical_history",
    "social_history",
    "family_history",
    "menstrual_history",
    "current_medication",
    "allergies",
    "treatment_history",
    "previous_investigation",
    "physical_examination",
    "assessment",
    "plan",
    "follow_up",
)

LOCAL_SYSTEM_INSTRUCTION = """\
You are a senior clinical documentation specialist working as the ambient scribe in an Indian outpatient clinic.
You write concise, information-dense notes in standard international medical English, the way an experienced physician would.
You document only what was said in the consultation. You never diagnose, prescribe or advise on your own.
You always answer with a single valid JSON object and nothing else.
"""

_ROLE_NAMES = {
    "DOCTOR": "Doctor",
    "PATIENT": "Patient",
    "NURSE": "Nurse",
    "STAFF": "Staff",
}

_PROMPT_RULES = """\
RULES (all mandatory):
1. Document only facts stated in the transcript. Never add a symptom, finding, vital sign, drug, dose, diagnosis, test or advice that no speaker said.
2. The transcript may mix English with Hindi, Tamil or Telugu (Hinglish / Tanglish / Telugu-English) and contains Indian brand names. Translate every clinical fact into standard medical English. Keep brand names as spoken and add the generic in brackets only when certain, e.g. "Dolo 650 (paracetamol)".
3. Lines are labelled Doctor / Patient. Patient statements are subjective history. assessment, plan and follow_up come ONLY from what the Doctor said.
4. A section that was not discussed must be exactly "Not mentioned". In particular:
   - physical_examination: "Not mentioned" unless examination findings or vital values were spoken.
   - assessment: "Not mentioned" unless the doctor voiced an impression or diagnosis.
   - plan: "Not mentioned" unless the doctor ordered a test, prescribed a medicine or gave advice. Never write a prescription the doctor did not say.
   - follow_up: "Not mentioned" unless the doctor gave a review time.
5. Record stated negatives explicitly, e.g. "Non-smoker. Denies alcohol use. No known drug allergies."
6. Medicines the patient already took (including vague descriptions such as "a tablet for fever") belong in current_medication or treatment_history, in the patient's terms, never in plan.
7. Where a speaker is uncertain, say so ("possibly", "patient unsure")."""

_PROMPT_SECTIONS = """\
NOTE SECTIONS:
- chief_complaint: main symptom(s) with duration, e.g. "Severe headache for 5 days".
- history_of_present_illness: chronological narrative in full sentences covering, where stated: onset, location, duration, character, aggravating and relieving factors, radiation, timing, severity, associated symptoms, and treatment tried with its effect.
- review_of_systems: other symptoms asked about, positives and pertinent negatives, e.g. "Denies fever, vomiting or visual disturbance".
- relevant_medical_history: past medical/surgical history, chronic illnesses, similar past episodes, or their stated absence.
- social_history: smoking, alcohol, tobacco, occupation, physical activity, diet, sleep, as stated.
- family_history: illnesses in the family, as stated.
- menstrual_history: only if discussed.
- current_medication: medicines or home remedies currently being taken, with dose and frequency if stated.
- allergies: as stated, including "No known drug allergies" if the patient denied allergies.
- treatment_history: earlier treatment for this complaint and its response.
- previous_investigation: earlier test or scan results mentioned.
- physical_examination: vitals and examination findings spoken during the visit.
- assessment: the doctor's stated impression or differential diagnosis.
- plan: investigations ordered, medicines prescribed (name, dose, frequency, duration exactly as spoken), advice and warning signs given by the doctor.
- follow_up: review timing stated by the doctor."""

_PROMPT_ENTITIES = """\
ENTITIES: list every clinical item once, in English.
entity_type is one of SYMPTOM, FINDING, MEDICATION, ALLERGY, DIAGNOSIS_MENTIONED, PROCEDURE, INVESTIGATION, DURATION, SEVERITY, FREQUENCY, CHARACTER, PLAN, FOLLOW_UP, MEDICAL_HISTORY.
status is PRESENT, NEGATED (explicitly denied), UNCERTAIN or HISTORICAL.
source_segment_ids are the [seg_...] ids of the lines that state the item."""

_OUTPUT_SHAPE = (
    '{"note": {'
    + ", ".join(f'"{key}": {{"text": "...", "source_segment_ids": ["seg_..."]}}' for key in NOTE_KEYS)
    + '}, "entities": [{"entity_type": "...", "value": "...", "status": "...", '
    '"source_segment_ids": ["seg_..."], "detail": null}]}'
)


def _speaker_name(segment: dict[str, Any]) -> str:
    role = str(segment.get("role") or "").upper()
    if role in _ROLE_NAMES:
        return _ROLE_NAMES[role]
    label = str(segment.get("speaker_label") or "")
    match = re.search(r"(\d+)$", label)
    return f"Speaker {int(match.group(1)) + 1}" if match else "Speaker"


def format_transcript(segments: list[dict[str, Any]]) -> str:
    """``[seg_001] Doctor: How long have you had this headache?``"""
    return "\n".join(
        f"[{s.get('ref', 'seg')}] {_speaker_name(s)}: {str(s.get('text', '')).strip()}"
        for s in segments
        if str(s.get("text", "")).strip()
    )


def build_single_pass_prompt(
    segments: list[dict[str, Any]],
    rule_hints: list[dict[str, Any]] | None = None,
) -> str:
    transcript = format_transcript(segments)
    parts = [
        "Write the clinical note for this outpatient consultation and extract its clinical entities.",
        _PROMPT_RULES,
        _PROMPT_SECTIONS,
        _PROMPT_ENTITIES,
    ]

    glossary = colloquial_glossary(transcript)
    if glossary:
        parts.append(
            "VERNACULAR TERMS HEARD IN THIS TRANSCRIPT:\n"
            + "\n".join(f'- "{term}" = {english}' for term, english in glossary.items())
        )

    hints = [
        f"{h.get('value')} ({h.get('status', 'PRESENT')})"
        for h in (rule_hints or [])
        if h.get("value")
    ][:40]
    if hints:
        parts.append("Terms a rule engine spotted (verify against the transcript): " + "; ".join(hints))

    parts.append(f"TRANSCRIPT:\n{transcript}")
    parts.append(f"Return exactly one JSON object with the note first:\n{_OUTPUT_SHAPE}")
    return "\n\n".join(parts)


# ------------------------------------------------------------ partial streaming
_PARTIAL_SECTION_RE = re.compile(
    r'"(' + "|".join(NOTE_KEYS) + r')"\s*:\s*(?:\{\s*"text"\s*:\s*)?"((?:[^"\\]|\\.)*)',
    re.DOTALL,
)


def partial_note_sections(buffer: str) -> dict[str, str]:
    """Section texts visible so far in a JSON document that is still being generated."""
    sections: dict[str, str] = {}
    for match in _PARTIAL_SECTION_RE.finditer(buffer):
        raw = match.group(2)
        if raw.endswith("\\") and not raw.endswith("\\\\"):
            raw = raw[:-1]
        try:
            text = json.loads(f'"{raw}"')
        except json.JSONDecodeError:
            text = raw.replace('\\"', '"').replace("\\n", "\n")
        sections[match.group(1)] = text
    return sections


class _StreamRelay:
    """Throttles partial-note callbacks so the socket is not flooded per token."""

    def __init__(self, callback: PartialNoteCallback, interval: float = 0.25) -> None:
        self.callback = callback
        self.interval = interval
        self.buffer = ""
        self._last_sent = 0.0
        self._last_payload: dict[str, str] = {}

    async def feed(self, chunk: str) -> None:
        self.buffer += chunk
        now = time.monotonic()
        if now - self._last_sent >= self.interval:
            await self._send(now)

    async def flush(self) -> None:
        await self._send(time.monotonic())

    async def _send(self, now: float) -> None:
        sections = partial_note_sections(self.buffer)
        if sections and sections != self._last_payload:
            self._last_payload = sections
            self._last_sent = now
            try:
                await self.callback(sections)
            except Exception:  # noqa: BLE001 - a broken socket must not break generation
                logger.warning("partial_note_callback_failed", exc_info=True)


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
        fallback_models: list[str] | None = None,
        api: str | None = None,
    ) -> None:
        self.base_url = (base_url or settings.local_llm_base_url).rstrip("/")
        self.model = model or settings.local_llm_model
        self.requested_model = self.model
        self.timeout_seconds = timeout_seconds or settings.local_llm_timeout_seconds
        self.max_retries = max_retries or settings.local_llm_max_retries
        self.temperature = settings.local_llm_temperature if temperature is None else temperature
        self.api = (api or settings.local_llm_api or "ollama").lower()
        chain = [self.model, *(fallback_models if fallback_models is not None else settings.local_llm_model_chain)]
        self.model_chain = list(dict.fromkeys(m for m in chain if m))
        self._missing_models: set[str] = set()
        self._client: httpx.AsyncClient | None = None
        self._cached_note: tuple[str, dict[str, Any], LLMCallStats] | None = None

    # ------------------------------------------------------------------ transport
    @property
    def is_ollama(self) -> bool:
        return self.api == "ollama"

    @property
    def _ollama_root(self) -> str:
        return self.base_url[:-3] if self.base_url.endswith("/v1") else self.base_url

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            headers = {"Content-Type": "application/json"}
            if settings.local_llm_api_key:
                headers["Authorization"] = f"Bearer {settings.local_llm_api_key}"
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout_seconds, connect=settings.local_llm_connect_timeout_seconds),
                headers=headers,
            )
        return self._client

    def _messages(self, prompt: str, model: str) -> list[dict[str, str]]:
        # Gemma's chat template has no system role.
        if "gemma" in model.lower():
            return [{"role": "user", "content": f"{LOCAL_SYSTEM_INSTRUCTION}\n\n{prompt}"}]
        return [
            {"role": "system", "content": LOCAL_SYSTEM_INSTRUCTION},
            {"role": "user", "content": prompt},
        ]

    @staticmethod
    def _context_window(prompt: str, max_tokens: int) -> int:
        """Large enough for prompt + answer: Ollama silently drops the start of an overlong prompt."""
        estimated_prompt = int(len(prompt) / 3.2) + 64
        needed = estimated_prompt + max_tokens
        window = max(settings.local_llm_num_ctx, ((needed // 1024) + 1) * 1024)
        return min(window, 16384)

    def _payload(self, prompt: str, model: str, *, stream: bool) -> tuple[str, dict[str, Any]]:
        max_tokens = settings.local_llm_max_tokens
        messages = self._messages(prompt, model)
        if self.is_ollama:
            full_prompt = "\n".join(message["content"] for message in messages)
            return f"{self._ollama_root}/api/chat", {
                "model": model,
                "messages": messages,
                "stream": stream,
                "format": "json",
                "keep_alive": settings.local_llm_keep_alive,
                "options": {
                    "num_gpu": 99,
                    "num_ctx": self._context_window(full_prompt, max_tokens),
                    "num_predict": max_tokens,
                    "temperature": self.temperature,
                },
            }
        return f"{self.base_url}/chat/completions", {
            "model": model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "stream": False,
        }

    async def _request_once(
        self, url: str, payload: dict[str, Any], relay: _StreamRelay | None
    ) -> tuple[str, int | None, int | None]:
        client = self._get_client()
        if relay is not None and payload.get("stream"):
            content: list[str] = []
            prompt_tokens = output_tokens = None
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code >= 400:
                    await response.aread()
                    response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    if chunk.get("error"):
                        raise LLMError(str(chunk["error"]))
                    piece = (chunk.get("message") or {}).get("content") or ""
                    if piece:
                        content.append(piece)
                        await relay.feed(piece)
                    if chunk.get("done"):
                        prompt_tokens = chunk.get("prompt_eval_count")
                        output_tokens = chunk.get("eval_count")
            await relay.flush()
            return "".join(content), prompt_tokens, output_tokens

        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        if isinstance(data.get("message"), dict):
            return (
                data["message"].get("content", "") or "",
                data.get("prompt_eval_count"),
                data.get("eval_count"),
            )
        choices = data.get("choices") or []
        if not choices:
            raise LLMInvalidOutput("Local LLM returned no choices.")
        usage = data.get("usage") or {}
        return (
            choices[0].get("message", {}).get("content", "") or "",
            usage.get("prompt_tokens"),
            usage.get("completion_tokens"),
        )

    async def _post_chat(
        self,
        prompt: str,
        *,
        purpose: str,
        model: str | None = None,
        on_partial: PartialNoteCallback | None = None,
    ) -> tuple[str, LLMCallStats]:
        """One model, bounded retries. Raises typed errors the caller can act on."""
        model = model or self.model
        stream = bool(on_partial) and self.is_ollama and settings.local_llm_stream
        url, payload = self._payload(prompt, model, stream=stream)
        started = time.perf_counter()
        last_error: LLMError | None = None
        attempts = 0

        while attempts < max(1, self.max_retries):
            attempts += 1
            relay = _StreamRelay(on_partial) if stream and on_partial else None
            try:
                raw_content, prompt_tokens, output_tokens = await self._request_once(url, payload, relay)
            except httpx.ConnectError as exc:
                last_error = LLMUnavailable(
                    f"Could not connect to local LLM at {self.base_url}. "
                    "Ensure Ollama or the local LLM server is running and reachable (e.g. 'ollama serve')."
                )
                logger.warning(
                    "local_llm_connect_failed",
                    extra={"purpose": purpose, "model": model, "attempt": attempts, "error": str(exc)},
                )
            except httpx.TimeoutException:
                last_error = LLMTimeout(
                    f"Local LLM '{model}' did not answer within {self.timeout_seconds:.0f}s "
                    "(the model may still be loading into GPU memory)."
                )
                logger.warning("local_llm_timeout", extra={"purpose": purpose, "model": model, "attempt": attempts})
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                body = exc.response.text[:300]
                if status == 404:
                    raise LLMModelNotFound(
                        f"Model '{model}' is not installed on the LLM server. Run 'ollama pull {model}'."
                    ) from exc
                last_error = LLMUnavailable(f"Local LLM returned HTTP {status}: {body}")
                logger.warning(
                    "local_llm_http_error",
                    extra={"purpose": purpose, "model": model, "attempt": attempts, "status": status, "body": body},
                )
            except LLMError as exc:
                if "not found" in str(exc).lower():
                    raise LLMModelNotFound(str(exc)) from exc
                last_error = exc
                logger.warning("local_llm_error", extra={"purpose": purpose, "model": model, "error": str(exc)})
            except Exception as exc:  # noqa: BLE001 - mapped to a typed error below
                last_error = LLMError(f"Unexpected local LLM error: {exc}")
                logger.exception("local_llm_unexpected_error", extra={"purpose": purpose, "model": model})
            else:
                if not raw_content.strip():
                    last_error = LLMInvalidOutput(f"Local LLM '{model}' returned an empty message.")
                else:
                    return raw_content, LLMCallStats(
                        provider=self.name,
                        model=model,
                        duration_ms=round((time.perf_counter() - started) * 1000, 2),
                        attempts=attempts,
                        prompt_tokens=prompt_tokens,
                        output_tokens=output_tokens,
                    )

            if attempts < self.max_retries:
                await asyncio.sleep(min(4.0, 0.5 * (2 ** (attempts - 1))) + random.uniform(0, 0.2))

        raise last_error or LLMUnavailable("Local LLM call failed")

    async def _complete(
        self,
        prompt: str,
        *,
        purpose: str,
        parse: Callable[[str], Any],
        on_partial: PartialNoteCallback | None = None,
    ) -> tuple[Any, LLMCallStats]:
        """Walk the model chain until one model returns parseable output.

        A missing model or unusable JSON moves on to the next model. An
        unreachable server stops immediately: no other model can help.
        """
        failures: list[str] = []
        candidates = [m for m in self.model_chain if m not in self._missing_models] or self.model_chain
        # Start from the model that last worked.
        if self.model in candidates:
            candidates.remove(self.model)
            candidates.insert(0, self.model)

        for model in candidates:
            try:
                raw_text, stats = await self._post_chat(prompt, purpose=purpose, model=model, on_partial=on_partial)
            except LLMModelNotFound as exc:
                self._missing_models.add(model)
                failures.append(str(exc))
                logger.warning("local_llm_model_missing", extra={"model": model, "purpose": purpose})
                continue
            except LLMUnavailable as exc:
                if "Could not connect" in str(exc):
                    raise LLMServiceUnavailable(str(exc)) from exc
                failures.append(f"{model}: {exc}")
                logger.exception("local_llm_model_failed", extra={"model": model, "purpose": purpose})
                continue
            except LLMError as exc:
                failures.append(f"{model}: {exc}")
                logger.exception("local_llm_model_failed", extra={"model": model, "purpose": purpose})
                continue

            try:
                result = parse(raw_text)
            except Exception as exc:  # noqa: BLE001 - try the next model
                failures.append(f"{model}: unusable JSON ({exc})")
                logger.exception(
                    "local_llm_parse_failed", extra={"model": model, "purpose": purpose, "raw": raw_text[:400]}
                )
                continue

            if model != self.requested_model:
                stats.detail["fallback_from"] = self.requested_model
                logger.warning(
                    "local_llm_model_fallback_used",
                    extra={"requested": self.requested_model, "used": model, "purpose": purpose},
                )
            self.model = model
            return result, stats

        raise LLMServiceUnavailable(
            "All local LLM options failed: " + " | ".join(failures or ["no model configured"])
        )

    # ------------------------------------------------------------------ parsing
    def _parse_extraction(
        self, raw_text: str, clean_segments: list[dict[str, Any]]
    ) -> tuple[ExtractionResult, dict[str, Any] | None]:
        parsed_json = extract_json_object(raw_text)
        coerced = coerce_llm_payload(parsed_json, ExtractionResult)
        result = ExtractionResult.model_validate(coerced)
        segment_texts = {str(s.get("ref", "")): str(s.get("text", "")) for s in clean_segments}
        kept, dropped = filter_ungrounded_entities(
            result.entities,
            segment_texts=segment_texts,
            full_transcript=" ".join(segment_texts.values()),
        )
        if dropped:
            logger.info("local_llm_dropped_ungrounded_entities", extra={"dropped": dropped})
        result.entities = kept
        note = parsed_json.get("note") if isinstance(parsed_json, dict) else None
        return result, note if isinstance(note, dict) else None

    def _finalise_note(
        self,
        payload: dict[str, Any],
        clean_segments: list[dict[str, Any]],
        entities: list[dict[str, Any]],
    ) -> NoteUpdate:
        coerced = coerce_llm_payload(payload, NoteUpdate)
        result = NoteUpdate.model_validate(coerced)
        purge_note_hallucinations(result, clean_segments, entities)
        self._link_provenance(result, clean_segments)
        if not result.changed_sections:
            result.changed_sections = [
                key for key, section in result.note.model_dump().items() if (section.get("text") or "").strip()
            ]
        return result

    @staticmethod
    def _link_provenance(result: NoteUpdate, clean_segments: list[dict[str, Any]]) -> None:
        """Cite transcript segments for sections the model returned without ids.

        Matching uses the vernacular-expanded segment text so an English note
        line can cite a Tanglish/Hinglish utterance. A section nothing matches
        keeps no citation and is flagged for review downstream.
        """
        seg_dict = {
            str(s.get("ref", "")): expand_clinical_text(str(s.get("text", "")))
            for s in clean_segments
            if s.get("ref") and s.get("text")
        }
        roles = {str(s.get("ref", "")): str(s.get("role", "")).upper() for s in clean_segments}
        stop = {
            "the", "and", "for", "with", "was", "has", "have", "had", "not", "patient", "reports",
            "doctor", "history", "clinical", "mentioned", "denies", "since", "days", "from",
        }
        for key in result.note.model_dump():
            section = getattr(result.note, key, None)
            if not section or not section.text or section.source_segment_ids:
                continue
            words = set(re.findall(r"\w{4,}", section.text.lower())) - stop
            refs = [ref for ref, text in seg_dict.items() if any(word in text for word in words)]
            if key in ("assessment", "plan", "follow_up"):
                doctor_refs = [ref for ref in refs if roles.get(ref) == "DOCTOR"]
                refs = doctor_refs or refs
            section.source_segment_ids = refs[:8]

    # ------------------------------------------------------------------ public
    async def extract_entities(
        self,
        *,
        session_context: dict[str, Any],
        segments: list[dict[str, Any]],
        rule_based_candidates: list[dict[str, Any]] | None = None,
        existing_entities: list[dict[str, Any]] | None = None,
        on_partial_note: PartialNoteCallback | None = None,
    ) -> ExtractionResponse:
        clean_segments = normalize_segments(segments)
        prompt = build_single_pass_prompt(clean_segments, rule_based_candidates)
        (result, note), stats = await self._complete(
            prompt,
            purpose="single_pass",
            parse=lambda raw: self._parse_extraction(raw, clean_segments),
            on_partial=on_partial_note,
        )
        transcript_key = " ".join(str(s.get("text", "")) for s in clean_segments)
        self._cached_note = (transcript_key, note, stats) if note is not None else None
        return ExtractionResponse(result=result, stats=stats)

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

        cached, self._cached_note = self._cached_note, None
        if cached is not None and cached[0] == transcript_key:
            try:
                result = self._finalise_note({"note": cached[1]}, clean_segments, entities)
                logger.info("local_llm_reusing_single_pass_note", extra={"model": cached[2].model})
                return NoteResponse(result=result, stats=cached[2])
            except Exception:  # noqa: BLE001 - regenerate below
                logger.exception("cached_note_unusable_regenerating")

        prompt = build_single_pass_prompt(clean_segments)
        result, stats = await self._complete(
            prompt,
            purpose="note_generation",
            parse=lambda raw: self._finalise_note(extract_json_object(raw), clean_segments, entities),
        )
        return NoteResponse(result=result, stats=stats)

    async def warmup(self) -> None:
        """Ask the server to load the model now instead of on the first consultation."""
        if not self.is_ollama:
            return
        try:
            response = await self._get_client().post(
                f"{self._ollama_root}/api/generate",
                json={"model": self.model, "prompt": "", "keep_alive": settings.local_llm_keep_alive},
            )
            response.raise_for_status()
            logger.info("local_llm_warm", extra={"model": self.model})
        except Exception as exc:  # noqa: BLE001 - warm-up is best effort
            logger.warning("local_llm_warmup_failed", extra={"model": self.model, "error": str(exc)})

    async def check_connection(self) -> dict[str, Any]:
        """Verify the server is reachable and report which chain models are installed."""
        client = self._get_client()
        path = f"{self._ollama_root}/api/tags" if self.is_ollama else "/models"
        try:
            resp = await client.get(path)
            resp.raise_for_status()
            data = resp.json()
            installed = [m.get("name", "") for m in data.get("models") or []] or [
                m.get("id", "") for m in data.get("data") or []
            ]
            available = [m for m in self.model_chain if any(m == i or i.startswith(f"{m}:") for i in installed)]
            return {
                "ok": True,
                "provider": self.name,
                "model": self.model,
                "base_url": self.base_url,
                "model_available": self.model in available,
                "available_chain_models": available,
                "model_chain": self.model_chain,
                "installed_models": installed[:20],
            }
        except httpx.ConnectError:
            return {
                "ok": False,
                "provider": self.name,
                "error": f"Connection refused at {self.base_url}. Ensure Ollama or the local LLM server is running.",
            }
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "provider": self.name, "error": str(exc)}

    def describe(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "model": self.model,
            "mock": self.is_mock,
            "model_chain": self.model_chain,
            "base_url": self.base_url,
        }

    async def aclose(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
