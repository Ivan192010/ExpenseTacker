from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Railway injects DATABASE_URL as postgresql://...; we normalise it to asyncpg.
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/couplecount"

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30

    # Device binding: how many phones each user may have registered at once.
    max_devices_per_user: int = 2

    # Used to decide which month is "current" (MSI billing, installment hub, etc.).
    app_timezone: str = "America/Mexico_City"

    cors_origins: str = "*"

    @field_validator("database_url")
    @classmethod
    def _normalise_db_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)


@lru_cache
def get_settings() -> Settings:
    return Settings()
