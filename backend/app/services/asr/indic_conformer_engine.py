"""AI4Bharat IndicConformer-600M as a second recogniser next to Whisper.

A multilingual Conformer (hybrid CTC/RNNT) trained on the 22 scheduled Indian
languages. It is markedly better than Whisper on Hindi, Tamil and Telugu speech,
and its CTC decoder only emits what is acoustically present, so it cannot fall
into Whisper's repetition and hallucination loops. It does not cover English and
writes English loanwords in the native script, which is why Whisper keeps the
English-heavy utterances.

Needs ``transformers``, ``torchaudio`` and ``onnxruntime-gpu`` on the ASR host.
"""

from __future__ import annotations

import threading
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

SUPPORTED_LANGUAGES = frozenset(
    {
        "as", "bn", "brx", "doi", "gu", "hi", "kn", "kok", "ks", "mai", "ml",
        "mni", "mr", "ne", "or", "pa", "sa", "sat", "sd", "ta", "te", "ur",
    }
)

_MODELS: dict[str, Any] = {}
# A model that failed to load is not retried by later sessions, and the status
# endpoint can report why it is off.
_FAILURES: dict[str, str] = {}
_LOCK = threading.Lock()


class IndicConformerEngineUnavailable(RuntimeError):
    pass


class IndicConformerEngine:
    def __init__(self, model_name: str | None = None, decoder: str | None = None) -> None:
        self.model_name = model_name or settings.asr_second_pass_model
        self.decoder = (decoder or settings.asr_second_pass_decoder or "ctc").lower()

    @property
    def failed(self) -> str | None:
        return _FAILURES.get(self.model_name)

    @failed.setter
    def failed(self, reason: str | None) -> None:
        if reason is None:
            _FAILURES.pop(self.model_name, None)
        else:
            _FAILURES[self.model_name] = reason

    @property
    def loaded(self) -> bool:
        return self.model_name in _MODELS

    def supports(self, language: str | None) -> bool:
        return bool(language) and language in SUPPORTED_LANGUAGES and self.failed is None

    def load(self) -> Any:  # pragma: no cover - requires the model download
        import os

        os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
        with _LOCK:
            if self.model_name in _MODELS:
                return _MODELS[self.model_name]
            if self.failed:
                raise IndicConformerEngineUnavailable(self.failed)
            try:
                from transformers import AutoModel  # type: ignore import-not-found
            except ImportError as exc:
                raise IndicConformerEngineUnavailable(
                    "IndicConformer needs transformers, torchaudio and onnxruntime-gpu on the ASR host."
                ) from exc
            logger.info("loading_indic_conformer", extra={"model": self.model_name, "decoder": self.decoder})
            try:
                model = AutoModel.from_pretrained(
                    self.model_name, trust_remote_code=True, token=settings.huggingface_token or None
                )
            except Exception as exc:
                detail = str(exc) or type(exc).__name__
                if not settings.huggingface_token and (
                    "not a valid model identifier" in detail or "401" in detail or "gated" in detail.lower()
                ):
                    detail = (
                        f"{detail} — set Kaggle secret HUGGINGFACE_TOKEN after accepting "
                        f"https://huggingface.co/{self.model_name}"
                    )
                self.failed = detail
                raise IndicConformerEngineUnavailable(self.failed) from exc
            _MODELS[self.model_name] = model
            return model

    def transcribe(self, audio: Any, language: str) -> str:  # pragma: no cover - requires the model
        import numpy as np  # type: ignore
        import torch  # type: ignore import-not-found

        model = self.load()
        wav = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)).unsqueeze(0)
        with torch.inference_mode():
            output = model(wav, language, self.decoder)
        if isinstance(output, (list, tuple)):
            output = output[0] if output else ""
        return str(output or "").strip()

    def describe(self) -> dict[str, object]:
        if self.failed:
            status = "failed"
        elif self.loaded:
            status = "loaded"
        else:
            status = "not_loaded"
        return {"model": self.model_name, "decoder": self.decoder, "status": status, "error": self.failed}
