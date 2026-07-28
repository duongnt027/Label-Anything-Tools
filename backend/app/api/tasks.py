import os
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import (
    Image,
    Job,
    JobState,
    LogAction,
    LogTargetType,
    MinRoleToAddClass,
    Task,
    TaskAssignee,
    User,
    UserRole,
)
from app.schemas import ExportGoldenOptions, ExportOptions, TaskAssigneesIn, TaskCreate, TaskOut, UserOut
from app.api.users import _user_out
from app.services.tasks import (
    copy_images_to_golden_pool,
    copy_images_to_task,
    ensure_storage,
    export_golden_pool_json,
    export_task_json,
    import_task_json,
    materialize_uploads,
    storage_path,
)
from app.services.jobs import count_task_images, write_log

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _task_out(db: Session, task: Task) -> TaskOut:
    jobs = db.query(Job).filter(Job.task_id == task.id).all()
    job_num = len(jobs)
    completed_jobs = sum(1 for j in jobs if j.state == JobState.completed)
    process = round(100.0 * completed_jobs / job_num, 1) if job_num else 0.0
    created = task.created_at.isoformat() if task.created_at else ""
    return TaskOut(
        id=task.id,
        name=task.name,
        job_num=job_num,
        img_num=count_task_images(db, task.id),
        completed_jobs=completed_jobs,
        process=process,
        classes=task.classes or [],
        min_role_to_add_class=task.min_role_to_add_class.value,
        golden_per_job=task.golden_per_job,
        chunk_size=task.chunk_size,
        created_at=created,
    )


@router.get("", response_model=list[TaskOut])
def list_tasks(user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.id.asc()).all()
    return [_task_out(db, t) for t in tasks]


@router.post("", response_model=TaskOut)
async def create_task(
    chunk_size: int = Form(50),
    name: str | None = Form(None),
    classes: str = Form(""),
    min_role_to_add_class: str = Form("admin"),
    golden_per_job: int = Form(0),
    server_folder: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    ensure_storage()
    sources: list[tuple[str, str]] = []
    if server_folder and server_folder.strip():
        folder = Path(server_folder.strip())
        if not folder.is_dir():
            folder = storage_path(server_folder.strip())
        if not folder.is_dir():
            raise HTTPException(400, "Thư mục mount không tồn tại")
        for ext in ("*.jpg", "*.jpeg", "*.png", "*.webp", "*.bmp", "*.gif"):
            for p in sorted(folder.glob(ext)):
                sources.append((str(p), p.name))
    if files:
        try:
            sources.extend(await materialize_uploads(files, user.id))
        except zipfile.BadZipFile:
            raise HTTPException(400, "File ZIP không hợp lệ")
    if not sources:
        raise HTTPException(400, "Chọn mount folder hoặc upload ZIP/folder")

    task = Task(
        name=name or "",
        chunk_size=chunk_size,
        classes=[c.strip() for c in classes.split(",") if c.strip()],
        min_role_to_add_class=MinRoleToAddClass(min_role_to_add_class),
        golden_per_job=golden_per_job,
        modifier_id=user.id,
    )
    db.add(task)
    db.flush()
    if not task.name:
        task.name = f"#{task.id}"
    copy_images_to_task(db, task, sources, user.id, chunk_size)
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.create_task,
        target_type=LogTargetType.task,
        target_id=task.id,
        detail=f"Created task with {len(sources)} images",
    )
    db.commit()
    db.refresh(task)
    return _task_out(db, task)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    return _task_out(db, task)


@router.delete("/{task_id}")
def delete_task(task_id: int, user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.delete_task,
        target_type=LogTargetType.task,
        target_id=task.id,
        detail="Deleted task",
    )
    db.delete(task)
    db.commit()
    return {"ok": True}


@router.post("/{task_id}/classes")
def add_class(
    task_id: int,
    class_name: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    from app.services.tasks import ROLE_RANK, can_add_class

    if not can_add_class(user, task) and user.role != UserRole.admin:
        raise HTTPException(403)
    existing = task.classes or []
    if not any(c.lower() == class_name.lower() for c in existing):
        task.classes = list(existing) + [class_name]
        write_log(
            db,
            actor_id=user.id,
            action=LogAction.add_class,
            target_type=LogTargetType.class_,
            target_id=task.id,
            detail=f"Added class {class_name}",
        )
        db.commit()
    return {"classes": task.classes}


@router.delete("/{task_id}/classes/{class_name}")
def remove_class(
    task_id: int,
    class_name: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.models import Box
    from app.services.tasks import can_add_class

    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    if user.role != UserRole.admin and not can_add_class(user, task):
        raise HTTPException(403)
    target = class_name.lower()
    task.classes = [c for c in (task.classes or []) if c.lower() != target]
    imgs = db.query(Image).filter(Image.task_id == task_id).all()
    img_ids = [i.id for i in imgs]
    if img_ids:
        boxes = db.query(Box).filter(Box.img_id.in_(img_ids)).all()
        for box in boxes:
            if (box.class_ or "").lower() == target:
                db.delete(box)
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.remove_class,
        target_type=LogTargetType.class_,
        target_id=task.id,
        detail=f"Removed class {class_name}",
    )
    db.commit()
    return {"ok": True, "classes": task.classes}


@router.get("/{task_id}/assignees", response_model=list[UserOut])
def list_task_assignees(
    task_id: int,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    if not db.get(Task, task_id):
        raise HTTPException(404)
    rows = (
        db.query(User)
        .join(TaskAssignee, TaskAssignee.user_id == User.id)
        .filter(TaskAssignee.task_id == task_id)
        .order_by(User.username)
        .all()
    )
    return [_user_out(db, u) for u in rows]


@router.put("/{task_id}/assignees", response_model=list[UserOut])
def set_task_assignees(
    task_id: int,
    body: TaskAssigneesIn,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    """Replace the assignee pool for a task. Users removed are unassigned from jobs."""
    if not db.get(Task, task_id):
        raise HTTPException(404)

    wanted_ids = list(dict.fromkeys(body.user_ids))  # unique, keep order
    if wanted_ids:
        users = (
            db.query(User)
            .filter(
                User.id.in_(wanted_ids),
                User.role.in_([UserRole.annotator, UserRole.reviewer]),
            )
            .all()
        )
        found = {u.id for u in users}
        missing = [i for i in wanted_ids if i not in found]
        if missing:
            raise HTTPException(400, "Chỉ thêm annotator/reviewer hợp lệ vào assignees")
    else:
        found = set()

    existing = db.query(TaskAssignee).filter(TaskAssignee.task_id == task_id).all()
    existing_ids = {r.user_id for r in existing}
    to_remove = existing_ids - found
    to_add = found - existing_ids

    if to_remove:
        # Clear job assignees who are no longer in the pool
        jobs = (
            db.query(Job)
            .filter(Job.task_id == task_id, Job.assignee_id.in_(to_remove))
            .all()
        )
        for job in jobs:
            job.assignee_id = None
            job.modifier_id = admin.id
            if job.locked_by_id in to_remove:
                job.locked_by_id = None
                job.locked_at = None
        db.query(TaskAssignee).filter(
            TaskAssignee.task_id == task_id,
            TaskAssignee.user_id.in_(to_remove),
        ).delete(synchronize_session=False)

    for uid in to_add:
        db.add(TaskAssignee(task_id=task_id, user_id=uid))

    db.commit()
    rows = (
        db.query(User)
        .join(TaskAssignee, TaskAssignee.user_id == User.id)
        .filter(TaskAssignee.task_id == task_id)
        .order_by(User.username)
        .all()
    )
    return [_user_out(db, u) for u in rows]


@router.get("/{task_id}/golden-pool")
def golden_pool(task_id: int, user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    imgs = (
        db.query(Image)
        .filter(Image.task_id == task_id, Image.job_id.is_(None), Image.is_golden.is_(True))
        .order_by(Image.id)
        .all()
    )
    from app.services.tasks import image_to_dict

    result = []
    for img in imgs:
        item = image_to_dict(img)
        boxes = list(img.boxes)
        item["box_count"] = len(boxes)
        item["class_count"] = len({(b.class_ or "").strip() for b in boxes if (b.class_ or "").strip()})
        result.append(item)
    return result


@router.delete("/{task_id}/golden-pool/{image_id}")
def delete_golden_image(
    task_id: int,
    image_id: int,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    img = db.get(Image, image_id)
    if not img or img.task_id != task_id or not img.is_golden or img.job_id is not None:
        raise HTTPException(404, "Golden image không tồn tại")
    rel = img.image_source
    db.delete(img)
    db.commit()
    try:
        path = storage_path(rel)
        if path.is_file():
            path.unlink()
    except OSError:
        pass
    return {"ok": True}


@router.post("/{task_id}/golden-pool/export")
def export_golden_pool(
    task_id: int,
    opts: ExportGoldenOptions,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    if not db.get(Task, task_id):
        raise HTTPException(404)
    return export_golden_pool_json(
        db,
        task_id,
        box_visibility=opts.box_visibility,
        include_images=opts.include_images,
        image_ids=opts.image_ids,
    )


@router.post("/{task_id}/golden-pool/import")
async def import_golden_pool(
    task_id: int,
    server_folder: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    ensure_storage()
    sources: list[tuple[str, str]] = []
    if server_folder and server_folder.strip():
        folder = Path(server_folder.strip())
        if not folder.is_dir():
            folder = storage_path(server_folder.strip())
        if not folder.is_dir():
            raise HTTPException(400, "Thư mục mount không tồn tại")
        for ext in ("*.jpg", "*.jpeg", "*.png", "*.webp", "*.bmp", "*.gif"):
            for p in sorted(folder.glob(ext)):
                sources.append((str(p), p.name))
    if files:
        try:
            sources.extend(await materialize_uploads(files, user.id))
        except zipfile.BadZipFile:
            raise HTTPException(400, "File ZIP không hợp lệ")
    if not sources:
        raise HTTPException(400, "Chọn mount folder hoặc upload ZIP")
    count = copy_images_to_golden_pool(db, task, sources, user.id)
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.add_to_golden_pool,
        target_type=LogTargetType.task,
        target_id=task.id,
        detail=f"Imported {count} golden images",
    )
    db.commit()
    return {"imported": count}


@router.post("/{task_id}/export")
def export_task(
    task_id: int,
    opts: ExportOptions,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    if not db.get(Task, task_id):
        raise HTTPException(404)
    return export_task_json(
        db,
        task_id,
        box_visibility=opts.box_visibility,
        include_images=opts.include_images,
        include_rejected=opts.include_rejected,
        job_ids=opts.job_ids,
    )


@router.post("/{task_id}/import")
async def import_task(
    task_id: int,
    file: UploadFile = File(...),
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    if not db.get(Task, task_id):
        raise HTTPException(404)
    import json

    data = json.loads(await file.read())
    if isinstance(data, dict):
        data = [data]
    count = import_task_json(db, task_id, data, user.id)
    db.commit()
    return {"updated": count}
