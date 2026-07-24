from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Job, JobState, LogAction, LogTargetType, User, UserRole
from app.schemas import UserCreate, UserOut, UserUpdate
from app.security import hash_password
from app.services.jobs import write_log

router = APIRouter(prefix="/api/users", tags=["users"])


def _resolve_supervisor_id(db: Session, username: str | None) -> int | None:
    if username is None or not str(username).strip():
        return None
    sup = db.query(User).filter(User.username == username.strip()).first()
    if not sup:
        raise HTTPException(400, f"Không tìm thấy supervisor '{username}'")
    return sup.id


def _user_out(db: Session, u: User) -> UserOut:
    supervisor_username = None
    if u.supervisor_id:
        sup = db.get(User, u.supervisor_id)
        supervisor_username = sup.username if sup else None
    return UserOut(
        id=u.id,
        username=u.username,
        role=u.role.value,
        supervisor_username=supervisor_username,
    )


@router.get("", response_model=list[UserOut])
def list_users(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    users = db.query(User).order_by(User.id).all()
    return [_user_out(db, u) for u in users]


@router.post("", response_model=UserOut)
def create_user(
    body: UserCreate,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(400, "Username exists")
    try:
        role = UserRole(body.role)
    except ValueError:
        raise HTTPException(400, "Invalid role")
    user = User(
        username=body.username,
        password=hash_password(body.password),
        role=role,
        supervisor_id=_resolve_supervisor_id(db, body.supervisor_username),
    )
    db.add(user)
    db.flush()
    write_log(
        db,
        actor_id=admin.id,
        action=LogAction.add_user,
        target_type=LogTargetType.user,
        target_id=user.id,
        detail=f"Created user {user.username}",
    )
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if body.username is not None:
        user.username = body.username
    if body.password is not None:
        user.password = hash_password(body.password)
    if body.role is not None:
        user.role = UserRole(body.role)
    data = body.model_dump(exclude_unset=True)
    if "supervisor_username" in data:
        user.supervisor_id = _resolve_supervisor_id(db, body.supervisor_username)
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    active = (
        db.query(Job)
        .filter(
            (Job.assignee_id == user_id) | (Job.locked_by_id == user_id),
            Job.state.in_(
                [JobState.new, JobState.in_progress, JobState.need_review, JobState.rejected]
            ),
        )
        .first()
    )
    if active:
        raise HTTPException(400, "User has active jobs; reassign or complete first")
    write_log(
        db,
        actor_id=admin.id,
        action=LogAction.remove_user,
        target_type=LogTargetType.user,
        target_id=user.id,
        detail=f"Removed user {user.username}",
    )
    db.delete(user)
    db.commit()
    return {"ok": True}
