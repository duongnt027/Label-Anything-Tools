import base64
import io
import json
import os
import random
import re
import shutil
import uuid
import zipfile
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Box, Image, Job, JobState, LogAction, LogTargetType, Task, User, UserRole
from app.services.jobs import count_job_images, task_stats, touch_job_lock, write_log
from app.services.status import derive_image_status


def storage_path(*parts: str | int | Path) -> Path:
    return Path(settings.storage_root).joinpath(*(str(p) for p in parts))


def ensure_storage() -> None:
    storage_path().mkdir(parents=True, exist_ok=True)


ROLE_RANK = {"admin": 3, "reviewer": 2, "annotator": 1}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}


def _safe_basename(name: str) -> str:
    base = Path(name).name
    base = re.sub(r"[^\w.\- ]+", "_", base).strip()
    return base or "image.jpg"


def _unique_name(dest_dir: Path, filename: str) -> str:
    candidate = _safe_basename(filename)
    if not (dest_dir / candidate).exists():
        return candidate
    stem = Path(candidate).stem
    ext = Path(candidate).suffix or ".jpg"
    n = 2
    while (dest_dir / f"{stem}_{n}{ext}").exists():
        n += 1
    return f"{stem}_{n}{ext}"


async def materialize_uploads(files: list, user_id: int) -> list[tuple[str, str]]:
    ensure_storage()
    batch_dir = storage_path("uploads", str(user_id), uuid.uuid4().hex)
    batch_dir.mkdir(parents=True, exist_ok=True)
    items: list[tuple[str, str]] = []

    for f in files:
        raw_name = f.filename or "image.jpg"
        content = await f.read()
        if raw_name.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    ext = Path(info.filename).suffix.lower()
                    if ext not in IMAGE_EXTENSIONS:
                        continue
                    name = _unique_name(batch_dir, info.filename)
                    dest = batch_dir / name
                    dest.write_bytes(zf.read(info))
                    items.append((str(dest), name))
        else:
            ext = Path(raw_name).suffix.lower()
            if ext not in IMAGE_EXTENSIONS:
                continue
            name = _unique_name(batch_dir, raw_name)
            dest = batch_dir / name
            dest.write_bytes(content)
            items.append((str(dest), name))

    items.sort(key=lambda x: x[1].lower())
    return items


def copy_images_to_task(
    db: Session,
    task: Task,
    sources: list[tuple[str, str]],
    modifier_id: int,
    chunk_size: int,
) -> None:
    ensure_storage()
    storage_path("tasks", str(task.id)).mkdir(parents=True, exist_ok=True)

    chunks: list[list[tuple[str, str]]] = []
    for i in range(0, len(sources), chunk_size):
        chunks.append(sources[i : i + chunk_size])

    for chunk in chunks:
        job = Job(
            task_id=task.id,
            state=JobState.new,
            assignee_id=None,
            modifier_id=modifier_id,
        )
        db.add(job)
        db.flush()
        job_dir = storage_path("tasks", str(task.id), "jobs", str(job.id))
        job_dir.mkdir(parents=True, exist_ok=True)

        for order_idx, (src, original_name) in enumerate(chunk):
            src_path = Path(src)
            if not src_path.is_file():
                raise FileNotFoundError(src)
            stored_name = _unique_name(job_dir, original_name)
            rel = f"tasks/{task.id}/jobs/{job.id}/{stored_name}"
            dest = storage_path(rel)
            shutil.copy2(src_path, dest)
            db.add(
                Image(
                    task_id=task.id,
                    job_id=job.id,
                    image_source=rel,
                    order_index=order_idx,
                    modifier_id=modifier_id,
                )
            )


def copy_images_to_golden_pool(
    db: Session,
    task: Task,
    sources: list[tuple[str, str]],
    modifier_id: int,
) -> int:
    """Copy source images into the task golden pool (job_id=None, is_golden=True)."""
    ensure_storage()
    golden_dir = storage_path("tasks", str(task.id), "golden")
    golden_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for src, original_name in sources:
        src_path = Path(src)
        if not src_path.is_file():
            continue
        stored_name = _unique_name(golden_dir, original_name)
        rel = f"tasks/{task.id}/golden/{stored_name}"
        dest = storage_path(rel)
        shutil.copy2(src_path, dest)
        db.add(
            Image(
                task_id=task.id,
                job_id=None,
                is_golden=True,
                image_source=rel,
                modifier_id=modifier_id,
            )
        )
        count += 1
    return count


def inject_golden_images(db: Session, job: Job, modifier_id: int) -> None:
    if job.golden_injected:
        return
    task = db.get(Task, job.task_id)
    if not task or task.golden_per_job <= 0:
        job.golden_injected = True
        return

    pool = (
        db.query(Image)
        .filter(Image.task_id == task.id, Image.job_id.is_(None), Image.is_golden.is_(True))
        .all()
    )
    if not pool:
        job.golden_injected = True
        return

    pick_count = min(task.golden_per_job, len(pool))
    selected = random.sample(pool, pick_count)
    img_num = count_job_images(db, job.id)
    for idx, golden in enumerate(selected):
        rel = golden.image_source
        src = storage_path(rel)
        job_dir = storage_path("tasks", str(task.id), "jobs", str(job.id))
        job_dir.mkdir(parents=True, exist_ok=True)
        stored_name = _unique_name(job_dir, Path(rel).name)
        new_rel = f"tasks/{task.id}/jobs/{job.id}/{stored_name}"
        dest = storage_path(new_rel)
        shutil.copy2(src, dest)
        new_img = Image(
            task_id=task.id,
            job_id=job.id,
            is_golden=True,
            image_source=new_rel,
            order_index=img_num + idx,
            caption=golden.caption,
            details=golden.details,
            tag=list(golden.tag),
            modifier_id=modifier_id,
        )
        db.add(new_img)
        db.flush()
        for box in golden.boxes:
            db.add(
                Box(
                    img_id=new_img.id,
                    is_golden=True,
                    tag=list(box.tag),
                    status=box.status,
                    modifier_id=modifier_id,
                    class_=box.class_,
                    box_points=box.box_points,
                    segment_points=box.segment_points,
                    ocr_text=box.ocr_text,
                    caption=box.caption,
                    details=box.details,
                )
            )
    job.golden_injected = True
    write_log(
        db,
        actor_id=modifier_id,
        action=LogAction.inject_golden_images,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=f"Injected {pick_count} golden images",
    )


def export_task_json(
    db: Session,
    task_id: int,
    *,
    box_visibility: str = "all",
    include_images: bool = False,
    include_rejected: bool | None = None,
    job_ids: list[int] | None = None,
) -> list[dict]:
    # Backward compat: include_rejected=False ≈ visible only; True ≈ all
    visibility = (box_visibility or "all").lower()
    if include_rejected is not None and box_visibility == "all":
        visibility = "all" if include_rejected else "visible"
    if visibility not in ("all", "visible", "invisible"):
        visibility = "all"

    q = db.query(Image).filter(Image.task_id == task_id, Image.job_id.isnot(None))
    if job_ids:
        q = q.filter(Image.job_id.in_(job_ids))
    images = q.order_by(Image.id).all()
    result = []
    for img in images:
        bboxes = []
        for box in img.boxes:
            visible = box.status.value != "Rejected"
            if visibility == "visible" and not visible:
                continue
            if visibility == "invisible" and visible:
                continue
            parts = box.box_points.split()
            x, y, w, h = (float(p) for p in (parts + ["0", "0", "0", "0"])[:4])
            seg = []
            if box.segment_points.strip():
                seg = [float(v) for v in box.segment_points.split()]
            bboxes.append(
                {
                    "id": box.id,
                    "x": x,
                    "y": y,
                    "w": w,
                    "h": h,
                    "caption": box.caption,
                    "ocr": box.ocr_text,
                    "class": box.class_,
                    "segment": seg,
                    "visible": visible,
                }
            )
        entry: dict = {
            "id": img.id,
            "path": str(storage_path(img.image_source)),
            "caption": img.caption,
            "bboxes": bboxes,
        }
        if include_images:
            src = storage_path(img.image_source)
            if src.is_file():
                entry["image_base64"] = base64.b64encode(src.read_bytes()).decode("ascii")
                entry["image_filename"] = Path(img.image_source).name
        result.append(entry)
    return result


def export_golden_pool_json(
    db: Session,
    task_id: int,
    *,
    box_visibility: str = "all",
    include_images: bool = False,
    image_ids: list[int] | None = None,
) -> list[dict]:
    visibility = (box_visibility or "all").lower()
    if visibility not in ("all", "visible", "invisible"):
        visibility = "all"

    q = db.query(Image).filter(
        Image.task_id == task_id,
        Image.job_id.is_(None),
        Image.is_golden.is_(True),
    )
    if image_ids:
        q = q.filter(Image.id.in_(image_ids))
    images = q.order_by(Image.id).all()
    result = []
    for img in images:
        bboxes = []
        for box in img.boxes:
            visible = box.status.value != "Rejected"
            if visibility == "visible" and not visible:
                continue
            if visibility == "invisible" and visible:
                continue
            parts = box.box_points.split()
            x, y, w, h = (float(p) for p in (parts + ["0", "0", "0", "0"])[:4])
            seg = []
            if box.segment_points.strip():
                seg = [float(v) for v in box.segment_points.split()]
            bboxes.append(
                {
                    "id": box.id,
                    "x": x,
                    "y": y,
                    "w": w,
                    "h": h,
                    "caption": box.caption,
                    "ocr": box.ocr_text,
                    "class": box.class_,
                    "segment": seg,
                    "visible": visible,
                }
            )
        entry: dict = {
            "id": img.id,
            "path": str(storage_path(img.image_source)),
            "caption": img.caption,
            "bboxes": bboxes,
            "is_golden": True,
        }
        if include_images:
            src = storage_path(img.image_source)
            if src.is_file():
                entry["image_base64"] = base64.b64encode(src.read_bytes()).decode("ascii")
                entry["image_filename"] = Path(img.image_source).name
        result.append(entry)
    return result


def import_task_json(db: Session, task_id: int, items: list[dict], modifier_id: int) -> int:
    updated = 0
    for item in items:
        path = item.get("path", "")
        rel = path
        if path.startswith(settings.storage_root):
            rel = os.path.relpath(path, settings.storage_root)
        img = (
            db.query(Image)
            .filter(Image.task_id == task_id, Image.image_source == rel)
            .first()
        )
        if not img:
            continue
        img.caption = item.get("caption")
        img.modifier_id = modifier_id
        for box in list(img.boxes):
            db.delete(box)
        for b in item.get("bboxes", []):
            db.add(
                Box(
                    img_id=img.id,
                    is_golden=img.is_golden,
                    modifier_id=modifier_id,
                    class_=b.get("class", ""),
                    box_points=f"{b.get('x', 0)} {b.get('y', 0)} {b.get('w', 0)} {b.get('h', 0)}",
                    segment_points=" ".join(str(v) for v in b.get("segment", [])),
                    ocr_text=b.get("ocr", ""),
                    caption=b.get("caption", ""),
                )
            )
        updated += 1
    return updated


def image_to_dict(img: Image) -> dict:
    return {
        "id": img.id,
        "task_id": img.task_id,
        "job_id": img.job_id,
        "is_golden": img.is_golden,
        "image_source": img.image_source,
        "filename": Path(img.image_source).name,
        "order_index": img.order_index,
        "tag": list(img.tag or []),
        "status": derive_image_status(img.tag or []),
        "caption": img.caption,
        "details": img.details,
    }


def box_to_dict(box: Box) -> dict:
    return {
        "id": box.id,
        "img_id": box.img_id,
        "is_golden": box.is_golden,
        "tag": list(box.tag or []),
        "status": box.status.value,
        "class": box.class_,
        "box_points": box.box_points,
        "segment_points": box.segment_points,
        "ocr_text": box.ocr_text,
        "caption": box.caption,
        "details": box.details,
    }


def can_add_class(user: User, task: Task) -> bool:
    return ROLE_RANK[user.role.value] >= ROLE_RANK[task.min_role_to_add_class.value]
