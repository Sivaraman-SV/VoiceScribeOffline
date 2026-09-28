"""AI4Bharat IndicWhisper / code-switched speech recognition provider.

By default this is the same per-utterance code-switching Faster-Whisper engine
as ``faster_whisper`` (see ``faster_whisper_provider.py``): each utterance's
language is detected among ``ASR_LANGUAGES`` (Tamil, English, Hindi by default)
and decoded with a code-mixed style prompt.

``INDIC_WHISPER_USE_TRANSFORMERS=true`` instead runs an AI4Bharat checkpoint
through HuggingFace Transformers. Those checkpoints are single-language (the
default one is Hindi only) and need PyTorch, so they suit a Hindi-only clinic
with a larger GPU - not Tanglish.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger, track_duration
from app.services.asr.code_switch import clean_asr_text
from app.services.asr.faster_whisper_provider import FasterWhisperProvider
from app.services.asr.medical_normalizer import normalize_medical_transcript
from app.services.types import ASRSegment, AudioFrame

logger = get_logger(__name__)


class IndicWhisperASRProvider(FasterWhisperProvider):
    """Code-switching Faster-Whisper, or an AI4Bharat Transformers checkpoint."""

    name = "indic_whisper"
    is_mock = False

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.indic_model_name = settings.indic_whisper_model
        self.use_transformers = bool(settings.indic_whisper_use_transformers)
        self._pipeline: Any | None = None
        self._engine_type = "faster_whisper"

    def _load_transformers(self) -> Any | None:
        if self._pipeline is not None:
            return self._pipeline
        try:
            import torch  # type: ignore
            from transformers import pipeline  # type: ignore
        except ImportError as exc:
            logger.warning("transformers_indic_whisper_not_available", extra={"error": str(exc)})
            self.use_transformers = False
            return None
        device_str = "cuda:0" if torch.cuda.is_available() else "cpu"
        logger.info("loading_indic_whisper_transformers", extra={"model": self.indic_model_name, "device": device_str})
        self._pipeline = pipeline("automatic-speech-recognition", model=self.indic_model_name, device=device_str)
        self._engine_type = "transformers"
        return self._pipeline

    async def transcribe(self, audio_chunk: AudioFrame) -> list[ASRSegment]:
        if not audio_chunk.decoded or not audio_chunk.pcm:
            return []
        if self.use_transformers:
            engine = await asyncio.to_thread(self._load_transformers)
            if engine is not None:
                with track_duration("asr_indic_whisper_transcribe"):
                    return await asyncio.to_thread(self._transcribe_transformers, engine, audio_chunk)
        return await super().transcribe(audio_chunk)

    def _transcribe_transformers(self, pipeline_fn: Any, audio_chunk: AudioFrame) -> list[ASRSegment]:
        import numpy as np  # type: ignore

        audio_arr = np.frombuffer(audio_chunk.pcm, dtype=np.int16).astype(np.float32) / 32768.0
        generate_kwargs: dict[str, Any] = {"task": "transcribe"}
        if self.fixed_language:
            generate_kwargs["language"] = self.fixed_language

        output = pipeline_fn(audio_arr, generate_kwargs=generate_kwargs, return_timestamps=True)
        text = clean_asr_text((output.get("text") or "").strip())
        text = normalize_medical_transcript(text) if text else ""
        if not text:
            return []

        duration = len(audio_arr) / float(audio_chunk.sample_rate)
        return [
            ASRSegment(
                id=f"asr_{audio_chunk.sequence:04d}_00",
                text=text,
                start_time=round(audio_chunk.start_time, 3),
                end_time=round(audio_chunk.start_time + duration, 3),
                confidence=0.92,
                language=self.fixed_language or "auto",
                words=[],
            )
        ]

    def describe(self) -> dict[str, object]:
        info = super().describe()
        info.update(name=self.name, engine=self._engine_type)
        if self._engine_type == "transformers":
            info["model"] = self.indic_model_name
        return info
