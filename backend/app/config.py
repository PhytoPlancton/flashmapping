"""Application settings loaded from backend/.env."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    mongo_uri: str
    mongo_db: str = "pharma_mapping"
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    # Pipedrive integration (push-only, single tenant MVP)
    pipedrive_api_key: str = ""
    pipedrive_api_base: str = "https://api.pipedrive.com/v1"
    # ---- Security knobs ----
    # "prod" toggles: disables /docs /redoc /openapi, tightens registration,
    # raises password minimum length, and enables security headers.
    env: str = "dev"              # "dev" | "prod"
    # When false in prod, /api/auth/register returns 403 unless the caller
    # holds a valid team-invite code (POST /api/teams/accept-invite covers
    # the invite + register flow separately; /register is locked otherwise).
    allow_open_registration: bool = True
    # Fernet key (32 url-safe base64 bytes) used to encrypt secrets at rest
    # (currently: per-team Pipedrive API keys). Generate once:
    #     python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # If unset, secrets are stored unencrypted (back-compat) but the app
    # logs a warning at startup in prod.
    secrets_encryption_key: str = ""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def is_prod(self) -> bool:
        return (self.env or "").strip().lower() == "prod"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings
