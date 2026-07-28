from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.jwt_secret import resolve_jwt_secret


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
    # Default 30 days; renewed via POST /api/auth/refresh while the app is in use.
    access_token_expire_minutes: int = Field(
        default=60 * 24 * 30,
        validation_alias=AliasChoices("ACCESS_TOKEN_EXPIRE_MINUTES", "JWT_EXPIRE_MINUTES"),
    )
    # SQLAlchemy pool (use NullPool when DB_USE_PGBOUNCER=true behind PgBouncer transaction mode)
    db_use_pgbouncer: bool = Field(default=False, validation_alias="DB_USE_PGBOUNCER")
    db_pool_size: int = Field(default=5, validation_alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=10, validation_alias="DB_MAX_OVERFLOW")
    db_pool_recycle: int = Field(default=1800, validation_alias="DB_POOL_RECYCLE")

    def model_post_init(self, __context: object) -> None:
        object.__setattr__(
            self,
            "secret_key",
            resolve_jwt_secret(self.storage_root, self.secret_key),
        )


settings = Settings()
