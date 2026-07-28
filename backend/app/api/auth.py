from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.auth_cookies import clear_auth_cookie, set_auth_cookie
from app.database import get_db
from app.api.users import _user_out
from app.deps import create_access_token, get_current_user
from app.models import User
from app.schemas import LoginResponse, Token, UserOut
from app.security import verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    token = create_access_token(user.id)
    set_auth_cookie(response, token)
    return LoginResponse(
        access_token=token,
        user=_user_out(db, user),
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _user_out(db, user)


@router.post("/refresh", response_model=Token)
def refresh_session(response: Response, user: User = Depends(get_current_user)):
    """Issue a new token while the current one is still valid (extends long sessions)."""
    token = create_access_token(user.id)
    set_auth_cookie(response, token)
    return Token(access_token=token)


@router.post("/logout")
def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}
