from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Box, Image, Job, JobState, Log, LogAction, LogTargetType, Task, User, UserRole
from app.schemas import UserCreate, UserOut, UserUpdate
from app.security import hash_password
from app.services.jobs import write_log

router = APIRouter(prefix="/api/users", tags=["users"])


ROLE_RANK = {"admin": 3, "reviewer": 2, "annotator": 1}


def _resolve_supervisor_id(
    db: Session,
    username: str | None,
    *,
    subordinate_role: UserRole,
    subordinate_username: str | None = None,
) -> int | None:
    if username is None or not str(username).strip():
        return None
    sup = db.query(User).filter(User.username == username.strip()).first()
    if not sup:
        raise HTTPException(400, f"Không tìm thấy supervisor '{username}'")
    if subordinate_username and sup.username == subordinate_username:
        raise HTTPException(400, "Không thể tự làm supervisor của chính mình")
    sub_rank = ROLE_RANK.get(subordinate_role.value, 0)
    sup_rank = ROLE_RANK.get(sup.role.value, 0)
    # Admin may only have another admin (or none). Others need a strictly higher role.
    if subordinate_role == UserRole.admin:
        if sup.role != UserRole.admin:
            raise HTTPException(400, "Admin chỉ có thể có supervisor là admin khác")
    elif sup_rank <= sub_rank:
        raise HTTPException(400, "Supervisor phải có role cao hơn user hiện tại")
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
        supervisor_id=_resolve_supervisor_id(
            db,
            body.supervisor_username,
            subordinate_role=role,
            subordinate_username=body.username,
        ),
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
        user.supervisor_id = _resolve_supervisor_id(
            db,
            body.supervisor_username,
            subordinate_role=user.role,
            subordinate_username=user.username,
        )
    elif body.role is not None and user.supervisor_id:
        # Role changed: drop supervisor if no longer valid.
        sup = db.get(User, user.supervisor_id)
        if sup:
            try:
                _resolve_supervisor_id(
                    db,
                    sup.username,
                    subordinate_role=user.role,
                    subordinate_username=user.username,
                )
            except HTTPException:
                user.supervisor_id = None
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
    if user.id == admin.id:
        raise HTTPException(400, "Không thể xóa chính tài khoản đang đăng nhập")
    first_admin = (
        db.query(User)
        .filter(User.role == UserRole.admin)
        .order_by(User.id.asc())
        .first()
    )
    if first_admin and first_admin.id == user.id:
        raise HTTPException(400, "Không thể xóa admin gốc của hệ thống")

    blocking = (
        db.query(Job)
        .filter(
            Job.state.in_([JobState.in_progress, JobState.need_review]),
            (Job.assignee_id == user_id) | (Job.locked_by_id == user_id),
        )
        .first()
    )
    if blocking:
        raise HTTPException(
            400,
            "User đang giữ hoặc được gán job đang làm/review; gỡ gán hoặc hoàn thành job trước",
        )

    # Detach FK references so DELETE users succeeds (Postgres has no ON DELETE SET NULL on these).
    db.query(User).filter(User.supervisor_id == user_id).update(
        {User.supervisor_id: None}, synchronize_session=False
    )
    db.query(Job).filter(Job.assignee_id == user_id).update(
        {Job.assignee_id: None}, synchronize_session=False
    )
    db.query(Job).filter(Job.locked_by_id == user_id).update(
        {Job.locked_by_id: None}, synchronize_session=False
    )
    fallback_modifier = admin.id
    db.query(Task).filter(Task.modifier_id == user_id).update(
        {Task.modifier_id: fallback_modifier}, synchronize_session=False
    )
    db.query(Job).filter(Job.modifier_id == user_id).update(
        {Job.modifier_id: fallback_modifier}, synchronize_session=False
    )
    db.query(Image).filter(Image.modifier_id == user_id).update(
        {Image.modifier_id: fallback_modifier}, synchronize_session=False
    )
    db.query(Box).filter(Box.modifier_id == user_id).update(
        {Box.modifier_id: fallback_modifier}, synchronize_session=False
    )
    db.query(Log).filter(Log.actor_id == user_id).update(
        {Log.actor_id: fallback_modifier}, synchronize_session=False
    )

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
