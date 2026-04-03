import os
import secrets
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache


class Settings(BaseSettings):
    # Environment
    ENVIRONMENT: str = "development"  # development, staging, production

    # Database - PostgreSQL for production, SQLite for local dev
    DATABASE_URL: str = "sqlite+aiosqlite:///:memory:"
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30

    # JWT
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60  # 1 hour
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # API Keys
    ANTHROPIC_API_KEY: str = ""
    GOOGLE_AI_API_KEY: str = ""

    # Email (Resend for sending)
    RESEND_API_KEY: str = ""
    EMAIL_FROM_ADDRESS: str = "notifications@epotracker.com"
    EMAIL_FROM_NAME: str = "EPO Tracker"

    # Gmail OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/email/oauth/callback"

    # App Settings
    APP_NAME: str = "EPO Tracker"
    APP_URL: str = "http://localhost:3000"
    API_URL: str = "http://localhost:8000"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Rate Limiting
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_BURST: int = 10

    # Security
    ALLOWED_HOSTS: List[str] = ["*"]

    @field_validator("SECRET_KEY", mode="before")
    @classmethod
    def set_secret_key(cls, v: str) -> str:
        if not v or v == "your-super-secret-key-change-in-production" or v == "your-secret-key-change-in-production":
            # Auto-generate for development, MUST be set in production
            if os.getenv("ENVIRONMENT", "development") == "production":
                raise ValueError("SECRET_KEY must be explicitly set in production!")
            return secrets.token_urlsafe(64)
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
