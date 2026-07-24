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
    annotator_lock_timeout_minutes: int = 30
    access_token_expire_minutes: int = 60 * 24


settings = Settings()
