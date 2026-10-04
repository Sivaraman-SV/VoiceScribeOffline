"""Faster-Whisper adapter with per-utterance code-switching.

Installed via ``pip install -r requirements-asr.txt``. The import is lazy so the
prototype runs (and Demo Mode works) without the ML stack present.

Every recording is cut at pauses into utterances and each utterance is decoded
on its own. Whisper never conditions on its previous output, so one misheard
window cannot cascade into the rest of a long consultation, and with
``ASR_LANGUAGES`` set each utterance's language is detected among the clinic's
languages only (see ``code_switch.py``).

With ``ASR_SECOND_PASS=indic_conformer``, utterances that are mostly Hindi, Tamil
or Telugu go to AI4Bharat IndicConformer instead, and Whisper output that fails
the checks in ``hypothesis.py`` is re-recognised by it.
"""

from __future__ import annotations

import asyncio
import math
import threading
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger, track_duration
from app.services.asr.base import ASRProvider
from app.services.asr.code_switch import LanguagePolicy, clean_asr_text, parse_languages, style_prompt
from app.services.asr.hypothesis import (
    DecodeQuality,
    compression_limit,
    conformer_plausible,
    tamil_is_garbled,
    whisper_problem,
)
from app.services.asr.indic_conformer_engine import IndicConformerEngine
from app.services.asr.medical_normalizer import normalize_medical_transcript
from app.services.types import ASRSegment, AudioFrame

logger = get_logger(__name__)

SAMPLE_RATE = 16000

# Utterance cutting: pauses longer than this end an utterance ...
_SPLIT_SILENCE_MS = 500
# ... pauses up to this length are bridged, and fragments shorter than
# _MIN_CONTEXT_SECONDS are joined to a neighbour: Whisper and language
# detection both need a few seconds of context to be reliable.
_MERGE_GAP_SECONDS = 1.0
_MIN_CONTEXT_SECONDS = 2.5
_MAX_UTTERANCE_SECONDS = 25.0
_MIN_UTTERANCE_SECONDS = 0.3
_PAD_SECONDS = 0.2
# Re-decoded at higher temperature when the greedy/beam result trips the
# compression-ratio or log-probability thresholds.
_TEMPERATURES = (0.0, 0.2, 0.4, 0.6)
# Below this share of English, an utterance counts as Indian-language speech.
_ENGLISH_HEAVY = 0.5
_CONFORMER_CONFIDENCE = 0.85
_REJECTED_CONFIDENCE = 0.35
# ASR_TAMIL_MODEL checkpoints were fine-tuned on plain Tamil transcripts without
# timestamp tokens: decoding with timestamps or the code-mixed style prompt
# pushes them off their training distribution.
_TAMIL_MODEL_PROMPT = False
_TAMIL_MODEL_TIMESTAMPS = False

# One model per (name, device, compute type) for the whole process. Loading
# large-v3-turbo takes several seconds and ~1.5 GB, so it must not be repeated
# for every session.
_MODELS: dict[tuple[str, str, str], Any] = {}
_MODELS_LOCK = threading.Lock()


class FasterWhisperUnavailable(RuntimeError):
    pass


def resolve_device(device: str | None, compute_type: str | None) -> tuple[str, str]:
    """``auto`` becomes CUDA float16 when CTranslate2 sees a GPU, otherwise CPU int8."""
    device = (device or "auto").lower().strip()
    compute_type = (compute_type or "auto").lower().strip()
    if device == "auto":
        try:
            import ctranslate2  # type: ignore import-not-found

            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:  # noqa: BLE001 - no CUDA runtime means CPU
            device = "cpu"
    if compute_type in ("auto", "default", ""):
        compute_type = "float16" if device == "cuda" else "int8"
    return device, compute_type


def load_whisper_model(model_name: str, device: str, compute_type: str) -> tuple[Any, str, str]:
    """Return a shared ``WhisperModel`` and the device/compute type actually used."""
    try:
        from faster_whisper import WhisperModel  # type: ignore import-not-found
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise FasterWhisperUnavailable(
            "faster-whisper is not installed. Install requirements-asr.txt and set ASR_PROVIDER=faster_whisper."
        ) from exc

    device, compute_type = resolve_device(device, compute_type)
    with _MODELS_LOCK:
        for key in ((model_name, device, compute_type), (model_name, "cpu", "int8")):
            if key in _MODELS:
                return _MODELS[key], key[1], key[2]
        # num_workers > 1 lets concurrent sessions decode in parallel on the
        # same loaded weights instead of queueing behind one another.
        workers = max(1, settings.asr_num_workers)
        threads = max(1, settings.asr_cpu_threads)
        logger.info(
            "loading_asr_model",
            extra={"model": model_name, "device": device, "compute": compute_type, "workers": workers},
        )
        try:
            model = WhisperModel(
                model_name, device=device, compute_type=compute_type, num_workers=workers, cpu_threads=threads
            )
        except Exception as exc:
            logger.warning(
                "asr_gpu_or_device_failed_using_cpu",
                extra={"requested_device": device, "error": str(exc)},
            )
            device, compute_type = "cpu", "int8"
            model = WhisperModel(
                model_name, device=device, compute_type=compute_type, num_workers=workers, cpu_threads=threads
            )
        _MODELS[(model_name, device, compute_type)] = model
        return model, device, compute_type


def merge_spans(spans: list[tuple[float, float]], duration: float) -> list[tuple[float, float]]:
    """Join VAD speech spans into utterances long enough to recognise reliably."""
    merged: list[list[float]] = []
    for start, end in spans:
        if merged and start - merged[-1][1] <= _MERGE_GAP_SECONDS and end - merged[-1][0] <= _MAX_UTTERANCE_SECONDS:
            merged[-1][1] = end
        else:
            merged.append([start, end])

    joined: list[list[float]] = []
    for span in merged:
        previous = joined[-1] if joined else None
        too_short = span[1] - span[0] < _MIN_CONTEXT_SECONDS or (
            previous is not None and previous[1] - previous[0] < _MIN_CONTEXT_SECONDS
        )
        if (
            previous is not None
            and too_short
            and span[0] - previous[1] <= 2 * _MERGE_GAP_SECONDS
            and span[1] - previous[0] <= _MAX_UTTERANCE_SECONDS
        ):
            previous[1] = span[1]
        else:
            joined.append(list(span))
    return [
        (max(0.0, start), min(duration, end))
        for start, end in joined
        if end - start >= _MIN_UTTERANCE_SECONDS
    ]


class FasterWhisperProvider(ASRProvider):
    name = "faster_whisper"
    is_mock = False

    def __init__(
        self,
        model_name: str | None = None,
        device: str | None = None,
        compute_type: str | None = None,
        initial_prompt: str | None = None,
        language: str | None = None,
        languages: str | None = None,
        second_pass: IndicConformerEngine | None = None,
        tamil_model: str | None = None,
    ) -> None:
        self.model_name = model_name or settings.faster_whisper_model
        self.device = device or settings.asr_device
        self.compute_type = compute_type or settings.asr_compute_type
        # An explicit prompt replaces the built-in code-mixed style prompts.
        # Never put drug names in it - Whisper copies prompt words into the output.
        self.prompt_override = (
            initial_prompt if initial_prompt is not None else (settings.indic_asr_prompt_biasing or None)
        )
        fixed = (language or settings.indic_asr_language or "auto").lower().strip()
        self.fixed_language = None if fixed in ("auto", "none", "", "code_switching", "indic") else fixed
        self.languages = parse_languages(languages if languages is not None else settings.asr_languages)
        if not self.fixed_language and self.languages == ("en",):
            self.fixed_language = "en"
        self.use_style_prompts = settings.asr_style_prompts
        # Per provider instance, i.e. per session: remembers which language the
        # conversation has been in.
        self.policy = LanguagePolicy(allowed=self.languages)
        self.second_pass = second_pass
        if self.second_pass is None and settings.asr_second_pass == "indic_conformer" and self._expects_indic():
            self.second_pass = IndicConformerEngine()
        self.tamil_model_name = (tamil_model if tamil_model is not None else settings.asr_tamil_model).strip()
        if not self._expects_tamil():
            self.tamil_model_name = ""
        self.tamil_failed: str | None = None
        self._model: Any | None = None
        self._tamil_model: Any | None = None

    def _expects_indic(self) -> bool:
        if self.fixed_language:
            return self.fixed_language != "en"
        return any(language != "en" for language in self.languages) or not self.languages

    def _expects_tamil(self) -> bool:
        if self.fixed_language:
            return self.fixed_language == "ta"
        return "ta" in self.languages or not self.languages

    def _load(self) -> Any:
        if self._model is None:
            self._model, self.device, self.compute_type = load_whisper_model(
                self.model_name, self.device, self.compute_type
            )
        return self._model

    def _tamil(self) -> Any | None:
        """The Tamil-trained model, or ``None`` when unset or it failed to load."""
        if not self.tamil_model_name or self.tamil_failed:
            return None
        if self._tamil_model is None:
            from pathlib import Path

            from app.core.config import BACKEND_ROOT

            name = self.tamil_model_name
            local = Path(name) if Path(name).is_absolute() else BACKEND_ROOT / name
            try:
                self._tamil_model, _device, _compute = load_whisper_model(
                    str(local) if local.is_dir() else name, self.device, self.compute_type
                )
            except Exception as exc:  # noqa: BLE001 - the main model still works
                self.tamil_failed = str(exc) or type(exc).__name__
                logger.exception("asr_tamil_model_failed", extra={"model": name})
                return None
        return self._tamil_model

    async def warmup(self) -> None:  # pragma: no cover - requires model download
        await asyncio.to_thread(self._load)
        if self.second_pass is not None:
            try:
                await asyncio.to_thread(self.second_pass.load)
            except Exception as exc:
                self._disable_second_pass(exc)

    async def transcribe(self, audio_chunk: AudioFrame) -> list[ASRSegment]:  # pragma: no cover - optional dependency
        if not audio_chunk.decoded or not audio_chunk.pcm:
            return []
        with track_duration("asr", logger, provider=self.name, session_id=audio_chunk.session_id):
            model = await asyncio.to_thread(self._load)
            return await asyncio.to_thread(self._transcribe_sync, model, audio_chunk)

    # ------------------------------------------------------------- internals
    def _transcribe_sync(self, model: Any, frame: AudioFrame) -> list[ASRSegment]:
        import numpy as np  # type: ignore

        audio = np.frombuffer(frame.pcm, dtype=np.int16).astype(np.float32) / 32768.0
        rate = frame.sample_rate or SAMPLE_RATE
        if rate != SAMPLE_RATE:
            # The preprocessor always emits 16 kHz; this only guards direct callers.
            positions = np.arange(0, len(audio), rate / SAMPLE_RATE)
            audio = np.interp(positions, np.arange(len(audio)), audio).astype(np.float32)

        results: list[ASRSegment] = []
        for start, end in self._utterances(audio):
            piece = audio[int(start * SAMPLE_RATE) : int(end * SAMPLE_RATE)]
            duration = end - start
            language, language_confidence = self._language_for(model, piece, duration)
            english_share = self._english_share(language)
            offset = frame.start_time + start

            source, reason = "whisper", "English-heavy utterance"
            conformer_language = language if self._conformer_handles(language) else None
            if conformer_language and english_share < _ENGLISH_HEAVY:
                text = self._second_pass_text(piece, conformer_language, duration)
                if text:
                    self._append_conformer(results, frame, text, offset, offset + duration, conformer_language)
                    source, reason = "indic_conformer", "Indian-language utterance"
                else:
                    reason = "second recogniser returned nothing usable"

            if source == "whisper":
                tamil_model = self._tamil() if language == "ta" and english_share < _ENGLISH_HEAVY else None
                if tamil_model is not None:
                    segments, prompt = self._decode_whisper(tamil_model, piece, "ta", tamil_trained=True)
                    source, reason = "tamil_whisper", "Tamil utterance"
                else:
                    segments, prompt = self._decode_whisper(model, piece, language)
                raw_text = " ".join((segment.text or "").strip() for segment in segments).strip()
                problem = whisper_problem(raw_text, language, duration, self._quality(segments))
                if problem == "garbled Tamil":
                    retry_segments, retry_prompt = self._decode_whisper(model, piece, None)
                    retry_text = " ".join(
                        (segment.text or "").strip() for segment in retry_segments
                    ).strip()
                    retry_problem = whisper_problem(
                        retry_text, None, duration, self._quality(retry_segments)
                    )
                    if retry_text and (not retry_problem or not tamil_is_garbled(retry_text)):
                        segments, prompt, raw_text, problem = (
                            retry_segments,
                            retry_prompt,
                            retry_text,
                            retry_problem,
                        )
                        language = None
                rescue_language = conformer_language or self._rescue_language()
                rescued = None
                if problem and rescue_language and self._conformer_handles(rescue_language):
                    rescued = self._second_pass_text(piece, rescue_language, duration)
                if rescued:
                    self._append_conformer(results, frame, rescued, offset, offset + duration, rescue_language)
                    source, reason = "indic_conformer", f"Whisper rejected: {problem}"
                else:
                    self._append_whisper(results, frame, segments, prompt, offset, language, problem)
                    if problem:
                        reason = f"kept with low confidence: {problem}"

            logger.debug(
                "asr_utterance",
                extra={
                    "session_id": frame.session_id,
                    "start": round(offset, 2),
                    "end": round(offset + duration, 2),
                    "language": language,
                    "language_confidence": language_confidence,
                    "english_share": round(english_share, 3),
                    "source": source,
                    "reason": reason,
                },
            )
        return results

    def _decode_whisper(
        self, model: Any, piece: Any, language: str | None, tamil_trained: bool = False
    ) -> tuple[list[Any], str | None]:
        # The Tamil-trained model was fine-tuned on plain Tamil transcripts without
        # timestamps; the code-mixed style prompt and timestamp tokens only hurt it.
        prompt = None if tamil_trained and not _TAMIL_MODEL_PROMPT else self._prompt_for(language)
        # Tamil / Hindi need a wider beam than English; turbo is otherwise too greedy.
        # The Tamil-trained model scored the same at beam 2 as at 5, so it keeps the setting.
        wide = language in ("ta", "hi", "te", "ml") and not tamil_trained
        beam = max(settings.asr_beam_size, 5) if wide else settings.asr_beam_size
        segments, _info = model.transcribe(
            piece,
            language=language,
            task="transcribe",
            beam_size=beam,
            vad_filter=False,
            without_timestamps=tamil_trained and not _TAMIL_MODEL_TIMESTAMPS,
            word_timestamps=not tamil_trained or _TAMIL_MODEL_TIMESTAMPS,
            condition_on_previous_text=False,
            initial_prompt=prompt,
            temperature=list(_TEMPERATURES),
            compression_ratio_threshold=compression_limit(language),
            log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
            repetition_penalty=1.05,
            no_repeat_ngram_size=0,
        )
        kept = [
            segment
            for segment in segments
            if not (getattr(segment, "no_speech_prob", 0.0) > 0.8 and getattr(segment, "avg_logprob", 0.0) < -0.8)
        ]
        return kept, prompt

    @staticmethod
    def _quality(segments: list[Any]) -> DecodeQuality:
        if not segments:
            return DecodeQuality()
        weights = [max(getattr(s, "end", 0.0) - getattr(s, "start", 0.0), 0.01) for s in segments]
        total = sum(weights)
        logprob = sum(getattr(s, "avg_logprob", 0.0) * w for s, w in zip(segments, weights)) / total
        compression = max(getattr(s, "compression_ratio", 1.0) for s in segments)
        return DecodeQuality(avg_logprob=logprob, compression_ratio=compression)

    def _append_whisper(
        self,
        results: list[ASRSegment],
        frame: AudioFrame,
        segments: list[Any],
        prompt: str | None,
        offset: float,
        language: str | None,
        problem: str | None,
    ) -> None:
        for segment in segments:
            text = clean_asr_text(segment.text, prompt)
            text = normalize_medical_transcript(text) if text else ""
            if not text:
                continue
            confidence = self._confidence(segment)
            if problem:
                confidence = min(confidence, _REJECTED_CONFIDENCE)
            results.append(
                ASRSegment(
                    id=f"asr_{frame.sequence:04d}_{len(results):02d}",
                    text=text,
                    start_time=round(offset + segment.start, 3),
                    end_time=round(offset + segment.end, 3),
                    confidence=confidence,
                    language=language or "auto",
                    words=[
                        {
                            "word": word.word,
                            "start": round(offset + word.start, 3),
                            "end": round(offset + word.end, 3),
                        }
                        for word in (getattr(segment, "words", None) or [])
                    ],
                )
            )

    @staticmethod
    def _append_conformer(
        results: list[ASRSegment], frame: AudioFrame, text: str, start: float, end: float, language: str
    ) -> None:
        cleaned = clean_asr_text(text)
        cleaned = normalize_medical_transcript(cleaned) if cleaned else ""
        if not cleaned:
            return
        results.append(
            ASRSegment(
                id=f"asr_{frame.sequence:04d}_{len(results):02d}",
                text=cleaned,
                start_time=round(start, 3),
                end_time=round(end, 3),
                confidence=_CONFORMER_CONFIDENCE,
                language=language,
                words=[],
            )
        )

    def _conformer_handles(self, language: str | None) -> bool:
        return self.second_pass is not None and self.second_pass.supports(language)

    def _rescue_language(self) -> str | None:
        """Indian language to re-recognise a rejected English decode in."""
        if self.fixed_language:
            return None
        candidate = self.policy.best_indic()
        if candidate and self.policy.last_scores.get(candidate, 0.0) >= 0.1:
            return candidate
        return None

    def _second_pass_text(self, piece: Any, language: str, duration: float) -> str | None:
        assert self.second_pass is not None
        try:
            text = self.second_pass.transcribe(piece, language)
        except Exception as exc:
            self._disable_second_pass(exc)
            return None
        return text if conformer_plausible(text, duration) else None

    def _disable_second_pass(self, exc: Exception) -> None:
        if self.second_pass is not None and self.second_pass.failed is None:
            self.second_pass.failed = str(exc) or type(exc).__name__
            logger.exception("asr_second_pass_disabled", extra={"model": self.second_pass.model_name})

    def _english_share(self, language: str | None) -> float:
        if self.fixed_language:
            return 1.0 if self.fixed_language == "en" else 0.0
        return self.policy.last_scores.get("en", 1.0 if language == "en" else 0.0)

    def _utterances(self, audio: Any) -> list[tuple[float, float]]:  # pragma: no cover - optional dependency
        """Speech spans in seconds, cut at pauses and merged to a usable length."""
        duration = len(audio) / SAMPLE_RATE
        try:
            from faster_whisper.vad import VadOptions, get_speech_timestamps  # type: ignore

            spans = get_speech_timestamps(
                audio,
                VadOptions(
                    min_silence_duration_ms=_SPLIT_SILENCE_MS,
                    speech_pad_ms=int(_PAD_SECONDS * 1000),
                    max_speech_duration_s=_MAX_UTTERANCE_SECONDS,
                ),
            )
        except Exception:
            logger.warning("asr_vad_failed_transcribing_whole_frame", exc_info=True)
            return [(0.0, duration)] if duration >= _MIN_UTTERANCE_SECONDS else []
        return merge_spans(
            [(span["start"] / SAMPLE_RATE, span["end"] / SAMPLE_RATE) for span in spans], duration
        )

    def _language_for(self, model: Any, piece: Any, duration: float) -> tuple[str | None, float]:
        if self.fixed_language:
            return self.fixed_language, 1.0
        try:
            _language, _probability, probabilities = model.detect_language(piece)
        except Exception:
            logger.warning("asr_language_detection_failed", exc_info=True)
            return self.policy.previous, 0.0
        return self.policy.choose(probabilities, duration)

    def _prompt_for(self, language: str | None) -> str | None:
        if self.prompt_override:
            return self.prompt_override
        if not self.use_style_prompts:
            return None
        return style_prompt(language)

    def describe(self) -> dict[str, object]:
        return {
            "name": self.name,
            "mock": self.is_mock,
            "model": self.model_name,
            "device": self.device,
            "compute_type": self.compute_type,
            "languages": list(self.languages) or "any",
            "language_mode": self.fixed_language or "per-utterance (code-switching)",
            "loaded": any(key[0] == self.model_name for key in _MODELS),
            "second_pass": self.second_pass.describe() if self.second_pass else None,
            "tamil_model": (
                {"model": self.tamil_model_name, "status": "failed" if self.tamil_failed else (
                    "loaded" if self._tamil_model is not None else "not_loaded"), "error": self.tamil_failed}
                if self.tamil_model_name
                else None
            ),
        }

    @staticmethod
    def _confidence(segment: Any) -> float:  # pragma: no cover - optional dependency
        logprob = getattr(segment, "avg_logprob", None)
        if logprob is None:
            return 0.8
        return round(min(max(math.exp(logprob), 0.0), 1.0), 4)
