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
    app_version: str = "0.1.0"
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
    local_llm_model: str = "gemma4:12b"
    # Tried in order when the primary model is missing or returns unusable JSON.
    local_llm_fallback_models: str = "gemma4:e4b,gemma2:9b"
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
    # Server GPU defaults (RTX 3090/4090, T4, A10G). On a low-VRAM laptop set
    # ASR_DEVICE=cpu and ASR_COMPUTE_TYPE=int8.
    asr_provider: ASRProviderName = ASRProviderName.FASTER_WHISPER
    diarization_provider: DiarizationProviderName = DiarizationProviderName.LOCAL
    faster_whisper_model: str = "large-v3-turbo"
    parakeet_model: str = "nvidia/parakeet-ctc-0.6b"
    asr_device: str = "cuda"
    asr_compute_type: str = "float16"
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
    indic_conformer_model: str = "ai4bharat/indicconformer_stt_multi_hybrid_rnnt_600m"
    asr_second_pass: str = "none"
    # Enforce pure English transcription and clinical prompt biasing
    indic_asr_language: str = "en"
    asr_languages: str = "en"
    asr_style_prompts: bool = True
    asr_beam_size: int = 2
    indic_asr_prompt_biasing: str = (
        "Doctor and patient clinical discussion regarding headache, fever, cough, "
        "body pain, backache, joint pain, chest discomfort, nausea, vomiting, loose motion, "
        "vitals, blood pressure, Volini gel, Moov spray, Omnigel, Dolo 650, Paracetamol, "
        "Combiflam, Pantocid, Pan-D, Azithral, Augmentin, Cetirizine, Montair-LC, Allegra, "
        "Digene, Electral ORS, Metformin, Telma."
    )
    pyannote_model: str = "pyannote/speaker-diarization-3.1"
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
        if asr == "tanglish_whisper":
            asr_model = self.tanglish_whisper_model
        elif asr == "hinglish_whisper":
            asr_model = self.hinglish_whisper_model
        elif asr == "indic_conformer" or (asr == "indic_whisper" and self.indic_whisper_use_transformers):
            asr_model = self.indic_whisper_model
        else:
            asr_model = self.faster_whisper_model
        return {
            "llm_server": f"{self.local_llm_base_url} ({self.local_llm_api} API)",
            "llm_fallback_chain": " → ".join(self.local_llm_model_chain),
            "audio": "Browser 16 kHz mono WAV → local preprocess (VAD)",
            "asr": f"{asr} / {asr_model} ({self.asr_compute_type} on {self.asr_device})",
            "languages": f"{self.asr_languages} ({'per-utterance code-switching' if self.indic_asr_language in ('auto', '') else self.indic_asr_language})",
            "diarization": self.diarization_provider.value,
            "llm": f"{self.effective_ai_mode.value} / {self.local_llm_model if self.effective_ai_mode.value in ('local', 'ollama') else self.gemini_model}",
            "grounding": "Entities must match the transcript; assessment/plan must match the doctor's own words",
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
