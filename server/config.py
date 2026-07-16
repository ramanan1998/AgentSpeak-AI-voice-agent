"""
config.py — All environment variables in one place.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL — asyncpg DSN
    # e.g. postgresql+asyncpg://agentspeak:secret@localhost:5432/agentspeak
    database_url: str = "postgresql+asyncpg://agentspeak:secret@localhost:5432/agentspeak"

    # LiveKit
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""

    # Agent worker name (must match agent.py)
    agent_name: str = "voice-agent"

    # Base URL the agent worker can reach this server at
    server_public_url: str = "http://127.0.0.1:8000"

    # Campaign engine — how many real seconds = 1 "retry day"
    # Set to 86400 in production; keep small (e.g. 10) for local testing.
    retry_day_seconds: float = 10.0

    # Hard cap on call attempts per contact
    max_attempts: int = 6


settings = Settings()