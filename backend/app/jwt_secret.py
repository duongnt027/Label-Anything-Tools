"""Persist JWT signing key on STORAGE volume so API rebuilds do not invalidate sessions."""

import secrets
from pathlib import Path

_PLACEHOLDER_SECRETS = frozenset(
    {
        "",
        "dev-secret-key",
        "change-me-in-production-use-openssl-rand-hex-32",
    }
)

_SECRET_FILENAME = ".jwt_secret_key"


def resolve_jwt_secret(storage_root: str, env_secret: str) -> str:
    root = Path(storage_root)
    root.mkdir(parents=True, exist_ok=True)
    path = root / _SECRET_FILENAME

    if path.is_file():
        stored = path.read_text(encoding="utf-8").strip()
        if stored:
            return stored

    env = (env_secret or "").strip()
    if env and env not in _PLACEHOLDER_SECRETS:
        secret = env
    else:
        secret = secrets.token_hex(32)

    path.write_text(secret + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return secret
