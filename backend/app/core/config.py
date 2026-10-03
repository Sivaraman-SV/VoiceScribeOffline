"""Central configuration for MedScribe Live.

Every tunable value lives here so that business logic never hard-codes a model
name, provider or connection string.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent


class AIMode(str, Enum):
    GEMINI = "gemini"
    LOCAL = "local"
    OLLAMA = "ollama"
    MOCK = "mock"


class ASRProviderName(str, Enum):
    GEMINI = "gemini"
    FASTER_WHISPER = "faster_whisper"
    PARAKEET = "parakeet"
    INDIC_WHISPER = "indic_whisper"
    INDIC_CONFORMER = "indic_conformer"
    TANGLISH_WHISPER = "tanglish_whisper"
    TANGLISH_MED = "tanglish_med"
    HINGLISH_WHISPER = "hinglish_whisper"
    MOCK = "mock"


class DiarizationProviderName(str, Enum):
    GEMINI = "gemini"
    LOCAL = "local"
    NEURAL = "neural"
    PYANNOTE = "pyannote"
    CONVERSATIONAL = "conversational"
    MOCK = "mock"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- application -------------------------------------------------------
    app_name: str = "VoiceScribe AI"
    app_version: str = "2.0.0"
    environment: str = "development"
    log_level: str = "INFO"
    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"

    # --- AI ----------------------------------------------------------------
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.7-flash"
    ai_mode: AIMode = AIMode.LOCAL
    gemini_verify_ssl: bool = True
    gemini_http_proxy: str | None = None
    gemini_update_interval_seconds: float = 10.0
    gemini_min_segments_per_update: int = 3
    gemini_timeout_seconds: float = 45.0
    gemini_max_retries: int = 3
    gemini_temperature: float = 0.1

    # --- Local / Offline LLM (Ollama / llama.cpp) --------------------------
    # The base URL may point at this machine or at a remote GPU host (e.g. an
    # Ollama server tunnelled out of a Kaggle notebook).
    local_llm_base_url: str = "http://localhost:11434/v1"
    # gemma4:e4b fits a 8 GB GPU or 16 GB of RAM. gemma4:e2b is the low-end tier;
    # gemma4:12b is the quality tier for a 16 GB+ GPU.
    local_llm_model: str = "gemma4:e4b"
    # Tried in order when the primary model is missing or returns unusable JSON.
    local_llm_fallback_models: str = "gemma4:e2b"
    # "ollama" uses the native /api/chat endpoint, the only one that honours
    # num_ctx / keep_alive. "openai" is for llama.cpp / vLLM servers.
    local_llm_api: str = "ollama"
    local_llm_api_key: str | None = None
    local_llm_timeout_seconds: float = 180.0
    local_llm_connect_timeout_seconds: float = 15.0
    local_llm_max_retries: int = 2
    local_llm_temperature: float = 0.1
    local_llm_num_ctx: int = 4096
    local_llm_max_tokens: int = 1200
    local_llm_keep_alive: str = "30m"
    local_llm_stream: bool = True
    # Gemma 4 can emit a reasoning trace before answering; for note writing it
    # only adds latency.
    local_llm_think: bool = False
    # Off by default: a warm-up request makes whichever host serves the base URL
    # load the model into memory.
    local_llm_warmup_on_startup: bool = False
    # After a failed LLM call, incremental (mid-consultation) updates skip the
    # LLM for this long. The final end-of-consultation pass always retries it.
    llm_retry_cooldown_seconds: float = 20.0

    # --- database ----------------------------------------------------------
    database_url: str = "postgresql+asyncpg://medscribe:medscribe@localhost:5432/medscribe"
    allow_sqlite_fallback: bool = True
    sqlite_fallback_url: str = "sqlite+aiosqlite:///./medscribe_dev.db"
    db_echo: bool = False
    auto_create_schema: bool = True

    # --- demo mode ---------------------------------------------------------
    enable_demo_mode: bool = True
    demo_segment_interval_seconds: float = 2.5

    # --- pipeline providers ------------------------------------------------
    # "auto" picks CUDA float16 when a GPU is present and CPU int8 otherwise.
    asr_provider: ASRProviderName = ASRProviderName.FASTER_WHISPER
    # neural = sherpa-onnx speaker embeddings on CPU; falls back to local pitch
    # clustering when sherpa-onnx or the model file is missing.
    diarization_provider: DiarizationProviderName = DiarizationProviderName.NEURAL
    faster_whisper_model: str = "large-v3-turbo"
    parakeet_model: str = "nvidia/parakeet-ctc-0.6b"
    asr_device: str = "auto"
    asr_compute_type: str = "auto"
    # Parallel decodes per loaded Whisper model (one per concurrent consultation room).
    asr_num_workers: int = 2
    asr_cpu_threads: int = 4
    # Off by default so starting the backend never loads Whisper on its own.
    asr_warmup_on_startup: bool = False
    indic_whisper_model: str = "ai4bharat/whisper-medium-hi_alldata_multigpu"
    indic_whisper_use_transformers: bool = False
    tanglish_whisper_model: str = "Badri0510/whisper-tanglish-DPO-production"
    tanglish_med_model: str = "surendirakrishna/OHM-Tanglish-MedASR-1.7B-v152"
    hinglish_whisper_model: str = "Oriserve/Whisper-Hindi2Hinglish-Apex"
    indic_conformer_model: str = "ai4bharat/indic-conformer-600m-multilingual"
    # Each utterance is detected among these languages, so Tamil-English and
    # Hindi-English consultations are transcribed as spoken.
    indic_asr_language: str = "code_switching"
    asr_languages: str = "ta,hi,en"
    asr_style_prompts: bool = True
    asr_beam_size: int = 2
    # Replaces the built-in style prompts when set. Keep drugs, symptoms and numbers
    # out of it: Whisper copies prompt words into the transcript.
    indic_asr_prompt_biasing: str = ""
    # Second recogniser for Indian-language utterances: "indic_conformer" runs
    # AI4Bharat IndicConformer-600M next to Whisper and keeps the better hypothesis.
    # Whisper alone is weak on Tamil; if the conformer cannot load, Whisper is used.
    asr_second_pass: str = "indic_conformer"
    asr_second_pass_model: str = "ai4bharat/indic-conformer-600m-multilingual"
    asr_second_pass_decoder: str = "ctc"
    pyannote_model: str = "pyannote/speaker-diarization-3.1"
    # Neural diarization (DIARIZATION_PROVIDER=neural). Relative paths are under backend/.
    speaker_embedding_model: str = "models/speaker/wespeaker_en_voxceleb_resnet34_LM.onnx"
    diarization_max_speakers: int = 2
    # Two groups of utterances are separate voices only when they are this much
    # more alike inside than across (mean cosine similarity). Lower splits more.
    diarization_split_margin: float = 0.12
    diarization_num_threads: int = 2
    # Optional WAV (3-30 s) of the doctor speaking. Pins that voice as the doctor.
    doctor_voice_sample: str = ""
    huggingface_token: str | None = None

    # Gemini audio transcription. The ASR model is configurable separately from
    # the structuring model because transcription is the more latency-sensitive
    # call and may warrant a cheaper/faster model.
    gemini_asr_model: str | None = None
    gemini_asr_timeout_seconds: float = 180.0
    gemini_asr_max_retries: int = 2
    asr_max_audio_bytes: int = 48 * 1024 * 1024

    # --- audio -------------------------------------------------------------
    audio_sample_rate: int = 16000
    audio_channels: int = 1
    audio_storage_dir: str = "./storage/audio"

    # --- security ----------------------------------------------------------
    dev_auth_enabled: bool = True
    dev_user_email: str = "dev.clinician@medscribe.local"
    dev_user_role: str = "DOCTOR"
    secret_key: str = "change-me-in-production"
    data_retention_days: int = 30

    # --- monitoring --------------------------------------------------------
    enable_metrics: bool = True

    @field_validator("ai_mode", mode="before")
    @classmethod
    def _retired_groq_mode(cls, value: object) -> object:
        if isinstance(value, str) and value.strip().lower() == "groq":
            return AIMode.GEMINI.value
        return value

    @field_validator("gemini_api_key", "huggingface_token", "local_llm_api_key", mode="before")
    @classmethod
    def _blank_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def effective_gemini_asr_model(self) -> str:
        return self.gemini_asr_model or self.gemini_model

    @property
    def effective_ai_mode(self) -> AIMode:
        if self.ai_mode is AIMode.MOCK:
            return AIMode.MOCK
        if self.ai_mode in (AIMode.LOCAL, AIMode.OLLAMA):
            return self.ai_mode
        if self.ai_mode is AIMode.GEMINI and self.gemini_configured:
            return AIMode.GEMINI
        return AIMode.LOCAL

    @property
    def audio_storage_path(self) -> Path:
        path = Path(self.audio_storage_dir)
        if not path.is_absolute():
            path = BACKEND_ROOT / path
        return path

    @property
    def local_llm_model_chain(self) -> list[str]:
        """Primary model first, then configured fallbacks, without duplicates."""
        chain = [self.local_llm_model, *self.local_llm_fallback_models.split(",")]
        return list(dict.fromkeys(model.strip() for model in chain if model and model.strip()))

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def pipeline_summary(self) -> dict[str, str]:
        """Single source of truth for the offline stack shown in Settings."""
        asr = self.asr_provider.value
        if asr in ("gemini", "parakeet", "mock"):
            asr_line = f"{asr} ({self.parakeet_model})" if asr == "parakeet" else asr
        else:
            # Every Whisper-family provider name runs Faster-Whisper with this model.
            asr_line = f"Faster-Whisper {self.faster_whisper_model} ({self.asr_compute_type} on {self.asr_device})"
        code_switching = self.indic_asr_language in ("auto", "", "code_switching", "indic")
        second_pass = (
            f"IndicConformer ({self.asr_second_pass_model}, {self.asr_second_pass_decoder})"
            if self.asr_second_pass == "indic_conformer"
            else "off"
        )
        return {
            "llm_server": f"{self.local_llm_base_url} ({self.local_llm_api} API)",
            "llm_fallback_chain": " → ".join(self.local_llm_model_chain),
            "audio": "Browser 16 kHz mono WAV, streamed in ~15 s pieces → server preprocess (VAD)",
            "asr": asr_line,
            "asr_second_pass": second_pass,
            "languages": f"{self.asr_languages} ({'per-utterance code-switching' if code_switching else 'fixed: ' + self.indic_asr_language})",
            "diarization": self.diarization_provider.value,
            "llm": f"{self.effective_ai_mode.value} / {self.local_llm_model if self.effective_ai_mode.value in ('local', 'ollama') else self.gemini_model}",
            "grounding": "Entities must match the transcript; assessment/plan must match the doctor's own words",
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
