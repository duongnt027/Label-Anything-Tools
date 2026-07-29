import copy
import json
import os
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
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
from app.schemas import ExportGoldenOptions, ExportOptions, MountDirEntry, MountTreeOut, TaskAssigneesIn, TaskCreate, TaskOut, UserOut
from app.api.users import _user_out
from app.services.tasks import (
    apply_task_json_by_filename,
    copy_images_to_golden_pool,
    _rewrite_annotation_paths_for_renames,
    copy_images_to_task,
    ensure_storage,
    export_golden_pool_zip,
    export_task_zip,
    extract_task_zip,
    import_task_json,
    link_mount_images_to_task,
    list_mount_folder_images,
    materialize_uploads,
    mount_tree,
    parse_annos_upload,
    resolve_mount_dir,
    storage_path,
)
from app.services.jobs import count_task_images, write_log

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _folder_from_server_mount(server_folder: str) -> Path:
    try:
        return resolve_mount_dir(server_folder.strip())
    except ValueError:
        raise HTTPException(400, "Đường dẫn mount không hợp lệ")
    except FileNotFoundError:
        raise HTTPException(400, "Thư mục mount không tồn tại")


def _upload_files_from_form(form) -> list[UploadFile]:
    """Collect multipart file parts (works when File() binding misses behind some proxies)."""
    out: list[UploadFile] = []
    if hasattr(form, "getlist"):
        for f in form.getlist("files"):
            if hasattr(f, "read") and getattr(f, "filename", None):
                out.append(f)  # type: ignore[arg-type]
    if not out:
        single = form.get("files")
        if single is not None and hasattr(single, "read") and getattr(single, "filename", None):
            out.append(single)  # type: ignore[arg-type]
    return out


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


@router.get("/mount-tree", response_model=MountTreeOut)
def browse_mount_tree(
    path: str = "",
    user: User = Depends(require_roles("admin")),
):
    del user
    ensure_storage()
    try:
        current, parent, entries = mount_tree(path)
    except ValueError:
        raise HTTPException(400, "Đường dẫn không hợp lệ")
    except FileNotFoundError:
        raise HTTPException(404, "Thư mục không tồn tại")
    return MountTreeOut(
        path=current,
        parent=parent,
        entries=[MountDirEntry(**e) for e in entries],
    )


@router.post("", response_model=TaskOut)
async def create_task(
    chunk_size: int = Form(50),
    name: str | None = Form(None),
    classes: str = Form(""),
    min_role_to_add_class: str = Form("admin"),
    golden_per_job: int = Form(2),
    server_folder: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    ensure_storage()
    sources: list[tuple[str, str]] = []
    annotation_items: list[dict] | None = None

    if server_folder and server_folder.strip():
        folder = _folder_from_server_mount(server_folder)
        sources = list_mount_folder_images(folder)
    elif files:
        for f in files:
            raw_name = (f.filename or "").lower()
            content = await f.read()
            if raw_name.endswith(".zip"):
                try:
                    zip_sources, ann = extract_task_zip(content, user.id)
                except zipfile.BadZipFile:
                    raise HTTPException(400, "File ZIP không hợp lệ")
                except ValueError as ex:
                    raise HTTPException(400, str(ex))
                except json.JSONDecodeError:
                    raise HTTPException(400, "File JSON trong ZIP không hợp lệ")
                sources.extend(zip_sources)
                if ann is not None:
                    annotation_items = ann
            else:
                raise HTTPException(400, "Upload ZIP phải là file .zip")
    else:
        raise HTTPException(400, "Chọn mount folder hoặc upload ZIP")

    if not sources:
        raise HTTPException(400, "Không có ảnh để tạo task")

    if chunk_size < 2:
        raise HTTPException(400, "Chunk size (ảnh / job) phải lớn hơn 1")
    if golden_per_job < 2:
        raise HTTPException(400, "Golden / job phải lớn hơn 1")

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
    try:
        if server_folder and server_folder.strip():
            link_mount_images_to_task(db, task, sources, user.id, chunk_size)
        else:
            copy_images_to_task(db, task, sources, user.id, chunk_size)
    except FileNotFoundError as ex:
        raise HTTPException(400, f"Không tìm thấy file ảnh: {ex}") from ex
    except ValueError as ex:
        raise HTTPException(400, str(ex)) from ex
    labeled = 0
    if annotation_items:
        labeled = apply_task_json_by_filename(db, task, annotation_items, user.id)
    detail = f"Created task with {len(sources)} images"
    if server_folder and server_folder.strip():
        detail += " (mount, no copy)"
    if labeled:
        detail += f", applied labels to {labeled} images from JSON"
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.create_task,
        target_type=LogTargetType.task,
        target_id=task.id,
        detail=detail,
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
    del user
    if not db.get(Task, task_id):
        raise HTTPException(404)
    data, filename = export_golden_pool_zip(
        db,
        task_id,
        box_visibility=opts.box_visibility,
        include_images=opts.include_images,
        image_ids=opts.image_ids,
    )
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{task_id}/golden-pool/import")
async def import_golden_pool(
    task_id: int,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    ensure_storage()
    form = await request.form()
    raw_folder = form.get("server_folder")
    server_folder = raw_folder.strip() if isinstance(raw_folder, str) and raw_folder.strip() else None
    upload_files = _upload_files_from_form(form)

    if not server_folder and not upload_files:
        raise HTTPException(400, "Chọn mount folder hoặc upload ZIP")

    sources: list[tuple[str, str]] = []
    annotation_items: list[dict] | None = None

    if server_folder:
        folder = _folder_from_server_mount(server_folder)
        sources = list_mount_folder_images(folder)

    for f in upload_files:
        raw_name = (f.filename or "").lower()
        content = await f.read()
        if raw_name.endswith(".zip"):
            try:
                zip_sources, ann = extract_task_zip(content, user.id)
            except zipfile.BadZipFile:
                raise HTTPException(400, "File ZIP không hợp lệ")
            except ValueError as ex:
                raise HTTPException(400, str(ex))
            except json.JSONDecodeError:
                raise HTTPException(400, "File JSON trong ZIP không hợp lệ")
            sources.extend(zip_sources)
            if ann is not None:
                annotation_items = ann
        else:
            batch = await materialize_uploads([f], user.id)
            sources.extend(batch)

    if not sources:
        if server_folder:
            raise HTTPException(
                400,
                "Thư mục mount không có ảnh (chọn thư mục có file ảnh ngay trong folder, không chỉ thư mục con)",
            )
        raise HTTPException(
            400,
            "ZIP không có ảnh hợp lệ — cùng cấu trúc khi tạo task: một thư mục ảnh (cấp 1), tùy chọn một annos.json",
        )

    count, golden_lookup, rename_map = copy_images_to_golden_pool(db, task, sources, user.id)
    labeled = 0
    if annotation_items:
        annos = copy.deepcopy(annotation_items)
        _rewrite_annotation_paths_for_renames(annos, rename_map)
        labeled = apply_task_json_by_filename(
            db,
            task,
            annos,
            user.id,
            image_lookup=golden_lookup,
        )
    detail = f"Imported {count} golden images"
    if labeled:
        detail += f", applied labels on {labeled} images from JSON"
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.add_to_golden_pool,
        target_type=LogTargetType.task,
        target_id=task.id,
        detail=detail,
    )
    db.commit()
    return {"imported": count, "labeled": labeled}


@router.post("/{task_id}/export")
def export_task(
    task_id: int,
    opts: ExportOptions,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    del user
    if not db.get(Task, task_id):
        raise HTTPException(404)
    data, filename = export_task_zip(
        db,
        task_id,
        box_visibility=opts.box_visibility,
        include_images=opts.include_images,
        include_rejected=opts.include_rejected,
        job_ids=opts.job_ids,
    )
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
    raw = await file.read()
    try:
        items = parse_annos_upload(raw, file.filename or "annos.json")
    except zipfile.BadZipFile:
        raise HTTPException(400, "File ZIP không hợp lệ")
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    except json.JSONDecodeError:
        raise HTTPException(400, "annos.json không hợp lệ")
    count = import_task_json(db, task_id, items, user.id)
    db.commit()
    return {"updated": count}
