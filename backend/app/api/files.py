from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Image, User
from app.services.tasks import storage_path

router = APIRouter(prefix="/api/files", tags=["files"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def _resolve_user(token: str | None, query_token: str | None, db: Session) -> User:
    raw = token or query_token
    if not raw:
        raise HTTPException(401)
    try:
        payload = jwt.decode(raw, settings.secret_key, algorithms=["HS256"])
        uid = payload.get("sub")
        if uid is None:
            raise HTTPException(401)
    except JWTError:
        raise HTTPException(401)
    user = db.get(User, int(uid))
    if not user:
        raise HTTPException(401)
    return user


@router.get("/{image_id}")
def serve_image(
    image_id: int,
    t: str | None = Query(None),
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    _resolve_user(token, t, db)
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(404)
    path = storage_path(img.image_source)
    if not path.is_file():
        raise HTTPException(404, "File missing on storage")
    return FileResponse(path)
