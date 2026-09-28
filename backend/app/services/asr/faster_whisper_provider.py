"""Faster-Whisper adapter with per-utterance code-switching.

Installed via ``pip install -r requirements-asr.txt``. The import is lazy so the
prototype runs (and Demo Mode works) without the ML stack present.

Whisper fixes one language for each 30-second window, so a consultation that
moves between Tamil, English and Hindi used to come out in a single language
(and script) for the whole recording. Instead, the audio is cut at pauses into
utterances, each utterance's language is detected among ``ASR_LANGUAGES`` only,
and it is decoded in that language with a code-mixed style prompt so English
words stay in English. See ``code_switch.py``.
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
from app.services.asr.medical_normalizer import normalize_medical_transcript
from app.services.types import ASRSegment, AudioFrame

logger = get_logger(__name__)

SAMPLE_RATE = 16000

# Utterance cutting: pauses longer than this end an utterance ...
_SPLIT_SILENCE_MS = 450
# ... short pauses are bridged, up to this length, to give language detection
# and the decoder enough context.
_MERGE_GAP_SECONDS = 0.6
_MAX_UTTERANCE_SECONDS = 20.0
_MIN_UTTERANCE_SECONDS = 0.3
_PAD_SECONDS = 0.2

# One model per (name, device, compute type) for the whole process. Loading
# large-v3-turbo takes several seconds and ~1.5 GB, so it must not be repeated
# for every session.
_MODELS: dict[tuple[str, str, str], Any] = {}
_MODELS_LOCK = threading.Lock()


class FasterWhisperUnavailable(RuntimeError):
    pass


def load_whisper_model(model_name: str, device: str, compute_type: str) -> tuple[Any, str, str]:
    """Return a shared ``WhisperModel`` and the device/compute type actually used."""
    try:
        from faster_whisper import WhisperModel  # type: ignore import-not-found
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise FasterWhisperUnavailable(
            "faster-whisper is not installed. Install requirements-asr.txt and set ASR_PROVIDER=faster_whisper."
        ) from exc

    with _MODELS_LOCK:
        for key in ((model_name, device, compute_type), (model_name, "cpu", "int8")):
            if key in _MODELS:
                return _MODELS[key], key[1], key[2]
        logger.info("loading_asr_model", extra={"model": model_name, "device": device, "compute": compute_type})
        try:
            model = WhisperModel(model_name, device=device, compute_type=compute_type)
        except Exception as exc:
            logger.warning(
                "asr_gpu_or_device_failed_using_cpu",
                extra={"requested_device": device, "error": str(exc)},
            )
            device, compute_type = "cpu", "int8"
            model = WhisperModel(model_name, device=device, compute_type=compute_type)
        _MODELS[(model_name, device, compute_type)] = model
        return model, device, compute_type


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
    ) -> None:
        self.model_name = model_name or settings.faster_whisper_model
        self.device = device or getattr(settings, "asr_device", "auto")
        self.compute_type = compute_type or getattr(settings, "asr_compute_type", "int8")
        # An explicit prompt replaces the built-in code-mixed style prompts.
        # Never put drug names in it - Whisper copies prompt words into the output.
        self.prompt_override = (
            initial_prompt if initial_prompt is not None else (settings.indic_asr_prompt_biasing or None)
        )
        fixed = (language or settings.indic_asr_language or "auto").lower().strip()
        self.fixed_language = None if fixed in ("auto", "none", "", "code_switching", "indic") else fixed
        self.languages = parse_languages(languages if languages is not None else settings.asr_languages)
        self.use_style_prompts = settings.asr_style_prompts
        # Per provider instance, i.e. per session: remembers which language the
        # conversation has been in.
        self.policy = LanguagePolicy(allowed=self.languages)
        self._model: Any | None = None

    def _load(self) -> Any:
        if self._model is None:
            self._model, self.device, self.compute_type = load_whisper_model(
                self.model_name, self.device, self.compute_type
            )
        return self._model

    async def warmup(self) -> None:  # pragma: no cover - requires model download
        await asyncio.to_thread(self._load)

    async def transcribe(self, audio_chunk: AudioFrame) -> list[ASRSegment]:  # pragma: no cover - optional dependency
        if not audio_chunk.decoded or not audio_chunk.pcm:
            return []
        with track_duration("asr", logger, provider=self.name, session_id=audio_chunk.session_id):
            model = await asyncio.to_thread(self._load)
            return await asyncio.to_thread(self._transcribe_sync, model, audio_chunk)

    # ------------------------------------------------------------- internals
    def _transcribe_sync(self, model: Any, frame: AudioFrame) -> list[ASRSegment]:  # pragma: no cover
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
            language, language_confidence = self._language_for(model, piece, end - start)
            prompt = self._prompt_for(language)
            segments, _info = model.transcribe(
                piece,
                language=language,
                task="transcribe",
                beam_size=settings.asr_beam_size,
                # Utterances are already cut at pauses; a second VAD pass would
                # only clip word onsets.
                vad_filter=False,
                word_timestamps=True,
                condition_on_previous_text=False,
                initial_prompt=prompt,
                # Use strict greedy decoding (temperature=0.0) to prevent fallback sampling
                # from introducing Cyrillic tokens or hallucinated repetitions in Indic languages.
                temperature=0.0,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.6,
                repetition_penalty=1.05,
                no_repeat_ngram_size=0,
            )
            for segment in segments:
                if getattr(segment, "no_speech_prob", 0.0) > 0.8 and getattr(segment, "avg_logprob", 0.0) < -0.8:
                    continue
                text = clean_asr_text(segment.text, prompt)
                text = normalize_medical_transcript(text) if text else ""
                if not text:
                    continue
                offset = frame.start_time + start
                results.append(
                    ASRSegment(
                        id=f"asr_{frame.sequence:04d}_{len(results):02d}",
                        text=text,
                        start_time=round(offset + segment.start, 3),
                        end_time=round(offset + segment.end, 3),
                        confidence=self._confidence(segment),
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
            logger.debug(
                "asr_utterance",
                extra={
                    "session_id": frame.session_id,
                    "start": round(frame.start_time + start, 2),
                    "end": round(frame.start_time + end, 2),
                    "language": language,
                    "language_confidence": language_confidence,
                },
            )
        return results

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

        merged: list[list[float]] = []
        for span in spans:
            start, end = span["start"] / SAMPLE_RATE, span["end"] / SAMPLE_RATE
            if (
                merged
                and start - merged[-1][1] <= _MERGE_GAP_SECONDS
                and end - merged[-1][0] <= _MAX_UTTERANCE_SECONDS
            ):
                merged[-1][1] = end
            else:
                merged.append([start, end])
        return [
            (max(0.0, start), min(duration, end))
            for start, end in merged
            if end - start >= _MIN_UTTERANCE_SECONDS
        ]

    def _language_for(self, model: Any, piece: Any, duration: float) -> tuple[str | None, float]:  # pragma: no cover
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
        }

    @staticmethod
    def _confidence(segment: Any) -> float:  # pragma: no cover - optional dependency
        logprob = getattr(segment, "avg_logprob", None)
        if logprob is None:
            return 0.8
        return round(min(max(math.exp(logprob), 0.0), 1.0), 4)
