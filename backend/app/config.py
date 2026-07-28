from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg2://label_anything:label_anything_secret@localhost:5432/label_anything"
    secret_key: str = "dev-secret-key"
    storage_root: str = "/data/storage"
    # Timeout (minutes) while user stays inside a job; leaving unlocks immediately.
    job_lock_timeout_minutes: int = Field(
        default=30,
        validation_alias=AliasChoices("JOB_LOCK_TIMEOUT_MINUTES", "ANNOTATOR_LOCK_TIMEOUT_MINUTES"),
    )
    access_token_expire_minutes: int = 60 * 24


settings = Settings()
