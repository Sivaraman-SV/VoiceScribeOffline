"""NVIDIA Parakeet ASR Provider (FastConformer CTC/TDT).

Provides high-speed, zero-hallucination acoustic speech-to-text inference
using NVIDIA NeMo's Parakeet models (e.g. nvidia/parakeet-ctc-0.6b or parakeet-tdt-1.1b).
"""

from __future__ import annotations

import asyncio
import io
import math
import tempfile
import wave
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger, track_duration
from app.services.asr.base import ASRProvider, ASRUnavailable
from app.services.asr.medical_normalizer import normalize_medical_transcript
from app.services.types import ASRSegment, AudioFrame

logger = get_logger(__name__)

SAMPLE_RATE = 16000


class ParakeetUnavailable(ASRUnavailable):
    pass


_PARAKEET_MODELS: dict[str, Any] = {}


def load_parakeet_model(model_name: str, device: str) -> Any:
    """Return a cached NeMo ASR model or load it."""
    global _PARAKEET_MODELS
    key = f"{model_name}_{device}"
    if key in _PARAKEET_MODELS:
        return _PARAKEET_MODELS[key]

    try:
        import nemo.collections.asr as nemo_asr  # type: ignore
        import torch  # type: ignore
    except ImportError as exc:
        raise ParakeetUnavailable(
            "NVIDIA NeMo is not installed. To enable Parakeet ASR, run: "
            "pip install nemo_toolkit['asr']"
        ) from exc

    logger.info("loading_parakeet_model", extra={"model": model_name, "device": device})
    try:
        model = nemo_asr.models.ASRModel.from_pretrained(model_name=model_name)
        if device == "cuda" and torch.cuda.is_available():
            model = model.cuda()
        model.eval()
        _PARAKEET_MODELS[key] = model
        return model
    except Exception as exc:
        logger.exception("parakeet_model_load_failed", extra={"model": model_name})
        raise ParakeetUnavailable(f"Failed to load NVIDIA Parakeet model '{model_name}': {exc}") from exc


class ParakeetASRProvider(ASRProvider):
    name = "parakeet"
    is_mock = False

    def __init__(
        self,
        model_name: str | None = None,
        device: str | None = None,
    ) -> None:
        self.model_name = model_name or getattr(settings, "parakeet_model", "nvidia/parakeet-ctc-0.6b")
        self.device = device or getattr(settings, "asr_device", "cuda")
        self._model: Any | None = None

    def _load(self) -> Any:
        if self._model is None:
            self._model = load_parakeet_model(self.model_name, self.device)
        return self._model

    async def warmup(self) -> None:
        await asyncio.to_thread(self._load)

    async def transcribe(self, audio_chunk: AudioFrame) -> list[ASRSegment]:
        if not audio_chunk.decoded or not audio_chunk.pcm:
            return []

        with track_duration("asr", logger, provider=self.name, session_id=audio_chunk.session_id):
            model = await asyncio.to_thread(self._load)
            return await asyncio.to_thread(self._transcribe_sync, model, audio_chunk)

    def _transcribe_sync(self, model: Any, frame: AudioFrame) -> list[ASRSegment]:
        import numpy as np  # type: ignore

        audio = np.frombuffer(frame.pcm, dtype=np.int16).astype(np.float32) / 32768.0
        rate = frame.sample_rate or SAMPLE_RATE
        if rate != SAMPLE_RATE:
            positions = np.arange(0, len(audio), rate / SAMPLE_RATE)
            audio = np.interp(positions, np.arange(len(audio)), audio).astype(np.float32)

        # Write canonical 16 kHz WAV buffer for NeMo file input
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as temp_wav:
            with wave.open(temp_wav.name, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes((audio * 32767.0).astype(np.int16).tobytes())

            try:
                hypotheses = model.transcribe([temp_wav.name])
            except Exception as exc:
                logger.warning("parakeet_transcription_failed", exc_info=True)
                raise ParakeetUnavailable(f"Parakeet transcription failed: {exc}") from exc

        if not hypotheses:
            return []

        raw_text = hypotheses[0] if isinstance(hypotheses, list) else str(hypotheses)
        if hasattr(raw_text, "text"):
            raw_text = raw_text.text
        raw_text = str(raw_text).strip()

        if not raw_text:
            return []

        # Run medical normalizer to map Indian brands & phonetic clinical terms
        normalized_text = normalize_medical_transcript(raw_text)

        return [
            ASRSegment(
                id=f"asr_{frame.sequence:04d}_00",
                text=normalized_text,
                start_time=round(frame.start_time, 3),
                end_time=round(frame.end_time, 3),
                confidence=0.95,
                language="en",
                words=[],
            )
        ]

    def describe(self) -> dict[str, object]:
        return {
            "name": self.name,
            "mock": self.is_mock,
            "model": self.model_name,
            "device": self.device,
            "language": "en",
        }
