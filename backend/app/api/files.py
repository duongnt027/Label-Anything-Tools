from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.auth_cookies import AUTH_COOKIE_NAME
from app.database import get_db
from app.deps import user_from_access_token
from app.models import Image, User
from app.services.tasks import storage_path

router = APIRouter(prefix="/api/files", tags=["files"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def _resolve_user(
    request: Request,
    token: str | None,
    query_token: str | None,
    db: Session,
) -> User:
    raw = token or request.cookies.get(AUTH_COOKIE_NAME) or query_token
    return user_from_access_token(raw, db)


@router.get("/{image_id}")
def serve_image(
    image_id: int,
    request: Request,
    t: str | None = Query(None),
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    _resolve_user(request, token, t, db)
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(404)
    path = storage_path(img.image_source)
    if not path.is_file():
        raise HTTPException(404, "File missing on storage")
    return FileResponse(path)
