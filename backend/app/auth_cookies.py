"""Browser session cookie (same-origin via nginx) — works for all clients on the LAN, including <img> loads."""

from fastapi import Response

from app.config import settings

AUTH_COOKIE_NAME = "la_access_token"


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
