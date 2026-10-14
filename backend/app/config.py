from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # must be app_user, not the table owner, otherwise RLS doesn't apply
    database_url: str = "postgresql+psycopg://app_user:app_password@localhost:5432/therapy"
    jwt_secret: str
    jwt_ttl_hours: int = 12
    allow_signup: bool = True
    cors_origins: list[str] = ["http://localhost:5173"]

    public_app_url: str = "http://localhost:5173"

    # local livekit by default; point these at LiveKit Cloud to call other devices
    livekit_url: str = "ws://localhost:7880"  # browser-facing
    livekit_api_key: str = "therapydesk"
    livekit_api_secret: str

    recordings_dir: str = "/data/recordings"
    max_chunk_bytes: int = 5 * 1024 * 1024

    # local/ollama keep everything on this machine. groq is faster but sends audio out: demo data only
    transcription_provider: Literal["local", "groq"] = "local"
    whisper_model: str = "small"  # tiny/base/small/medium/large-v3
    whisper_language: str | None = None  # None = auto-detect
    models_dir: str = "/data/models"
    llm_provider: Literal["ollama", "groq"] = "ollama"
    ollama_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "llama3.1:8b"
    ollama_num_ctx: int = 16384
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_llm_model: str = "llama-3.3-70b-versatile"
    groq_whisper_model: str = "whisper-large-v3-turbo"
    note_chunk_tokens: int = 6000
    delete_audio_after_transcription: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
