from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Box, BoxStatus, Image, Job, JobState, LogAction, LogTargetType, User, UserRole
from app.schemas import BoxIn, BoxUpdate, ImageUpdate
from app.services.jobs import touch_job_lock, write_log
from app.services.status import sync_box_status_from_tags
from app.services.tasks import box_to_dict, image_to_dict, storage_path

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/{image_id}")
def get_image(image_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(404)
    return image_to_dict(img)


@router.get("/{image_id}/boxes")
def list_boxes(image_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(404)
    return [box_to_dict(b) for b in img.boxes]


_ACCEPT_TAGS = frozenset({"Accept S1", "Accept All"})
_ANNOTATE_JOB_STATES = frozenset({JobState.new, JobState.rejected, JobState.in_progress})


def _assert_image_editable(db: Session, user: User, img: Image) -> Job | None:
    if img.job_id is None:
        if user.role.value != "admin":
            raise HTTPException(403)
        return None
    job = db.get(Job, img.job_id)
    if not job:
        raise HTTPException(404)
    if job.locked_by_id and job.locked_by_id != user.id and user.role != UserRole.admin:
        raise HTTPException(403, "Job locked by another user")
    if user.role == UserRole.annotator and job.assignee_id != user.id:
        raise HTTPException(403)
    return job


def _strip_accept_tags(img: Image) -> bool:
    """Remove Accept S1 / Accept All. Returns True if changed."""
    tags = list(img.tag or [])
    cleaned = [t for t in tags if t not in _ACCEPT_TAGS]
    if cleaned != tags:
        img.tag = cleaned
        return True
    return False


def _annotator_may_clear_accept(user: User, job: Job | None) -> bool:
    """Accept tags auto-clear only for annotator work (not reviewer edits)."""
    if user.role == UserRole.annotator:
        return True
    if user.role == UserRole.admin and job and job.state in _ANNOTATE_JOB_STATES:
        return True
    return False


@router.patch("/{image_id}")
def update_image(
    image_id: int,
    body: ImageUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(404)
    job = _assert_image_editable(db, user, img)
    caption_changed = False
    if body.caption is not None:
        if body.caption != (img.caption or ""):
            caption_changed = True
        img.caption = body.caption
    if body.details is not None:
        img.details = body.details
    if body.tag is not None:
        if user.role == UserRole.annotator:
            raise HTTPException(403, "Annotator cannot set image tags directly")
        old_tags = set(img.tag or [])
        new_tags = list(body.tag)
        if old_tags & _ACCEPT_TAGS:
            added = set(new_tags) - old_tags
            if added - _ACCEPT_TAGS:
                raise HTTPException(400, "Xóa Accept S1 / Accept All trước khi thêm tag khác")
        img.tag = new_tags
    # Accept S1/All: reviewer removes manually; annotator clears only via caption / add-delete box
    if caption_changed and _annotator_may_clear_accept(user, job):
        _strip_accept_tags(img)
    img.modifier_id = user.id
    if job:
        touch_job_lock(db, job, user.id)
        write_log(
            db,
            actor_id=user.id,
            action=LogAction.edit_image_tag,
            target_type=LogTargetType.image,
            target_id=img.id,
        )
    db.commit()
    return image_to_dict(img)


_GOLDEN_REF_PREFIX = "golden_pool_id:"


def _parse_golden_ref(details: str | None) -> int | None:
    if not details:
        return None
    for part in details.split("|"):
        part = part.strip()
        if part.startswith(_GOLDEN_REF_PREFIX):
            try:
                return int(part[len(_GOLDEN_REF_PREFIX) :])
            except ValueError:
                return None
    return None


def _set_golden_ref(details: str | None, golden_id: int | None) -> str | None:
    parts = [p for p in (details or "").split("|") if p.strip() and not p.strip().startswith(_GOLDEN_REF_PREFIX)]
    if golden_id is not None:
        parts.append(f"{_GOLDEN_REF_PREFIX}{golden_id}")
    joined = "|".join(parts).strip("|")
    return joined or None


@router.post("/{image_id}/golden-pool")
def add_to_golden_pool(
    image_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role.value != "admin":
        raise HTTPException(403)
    img = db.get(Image, image_id)
    if not img or not img.job_id:
        raise HTTPException(400)
    existing_id = _parse_golden_ref(img.details)
    if existing_id and db.get(Image, existing_id):
        img.is_golden = True
        db.commit()
        return image_to_dict(img)
    import shutil
    from pathlib import Path

    rel = img.image_source
    golden_dir = storage_path("tasks", str(img.task_id), "golden")
    golden_dir.mkdir(parents=True, exist_ok=True)
    from app.services.tasks import _unique_name

    stored_name = _unique_name(golden_dir, Path(rel).name)
    new_rel = f"tasks/{img.task_id}/golden/{stored_name}"
    dest = storage_path(new_rel)
    shutil.copy2(storage_path(rel), dest)
    golden = Image(
        task_id=img.task_id,
        job_id=None,
        is_golden=True,
        image_source=new_rel,
        caption=img.caption,
        details=img.details,
        tag=list(img.tag or []),
        modifier_id=user.id,
    )
    db.add(golden)
    db.flush()
    for box in img.boxes:
        db.add(
            Box(
                img_id=golden.id,
                is_golden=True,
                tag=list(box.tag),
                status=box.status,
                modifier_id=user.id,
                class_=box.class_,
                box_points=box.box_points,
                segment_points=box.segment_points,
                ocr_text=box.ocr_text,
                caption=box.caption,
                details=box.details,
            )
        )
    img.is_golden = True
    img.details = _set_golden_ref(img.details, golden.id)
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.add_to_golden_pool,
        target_type=LogTargetType.image,
        target_id=golden.id,
    )
    db.commit()
    return image_to_dict(img)


@router.delete("/{image_id}/golden-pool")
def remove_from_golden_pool(
    image_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role.value != "admin":
        raise HTTPException(403)
    img = db.get(Image, image_id)
    if not img or not img.job_id:
        raise HTTPException(400)
    golden_id = _parse_golden_ref(img.details)
    if golden_id:
        golden = db.get(Image, golden_id)
        if golden and golden.is_golden and golden.job_id is None:
            rel = golden.image_source
            db.delete(golden)
            try:
                path = storage_path(rel)
                if path.is_file():
                    path.unlink()
            except OSError:
                pass
    img.is_golden = False
    img.details = _set_golden_ref(img.details, None)
    db.commit()
    return image_to_dict(img)


@router.post("/{image_id}/boxes")
def add_box(
    image_id: int,
    body: BoxIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(404)
    job = _assert_image_editable(db, user, img)
    if user.role not in (UserRole.annotator, UserRole.admin):
        raise HTTPException(403)
    if _annotator_may_clear_accept(user, job):
        _strip_accept_tags(img)
    box = Box(
        img_id=img.id,
        is_golden=img.is_golden,
        modifier_id=user.id,
        class_=body.class_name,
        box_points=body.box_points,
        segment_points=body.segment_points,
        ocr_text=body.ocr_text,
        caption=body.caption,
        details=body.details,
    )
    db.add(box)
    if job:
        touch_job_lock(db, job, user.id)
        write_log(
            db,
            actor_id=user.id,
            action=LogAction.add_box,
            target_type=LogTargetType.box,
            target_id=img.id,
        )
    db.commit()
    db.refresh(box)
    return box_to_dict(box)


@router.patch("/boxes/{box_id}")
def update_box(
    box_id: int,
    body: BoxUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    box = db.get(Box, box_id)
    if not box:
        raise HTTPException(404)
    img = box.image
    job = _assert_image_editable(db, user, img)
    data = body.model_dump(exclude_unset=True)
    if "class_name" in data:
        box.class_ = data.pop("class_name")
    if "status" in data and user.role == UserRole.annotator:
        del data["status"]
    for k, v in data.items():
        if k == "tag":
            # Copy list so ARRAY mutations don't leak across ORM instances
            box.tag = list(v or [])
            # Annotator clearing tags = marked fixed → Unseen; reviewer still syncs Rejected when tags present
            box.status = BoxStatus(sync_box_status_from_tags(box.tag, box.status.value))
        elif hasattr(box, k if k != "class" else "class_"):
            setattr(box, k if k != "class" else "class_", v)
    # Updating box fields must NOT clear Accept S1/All (only add/delete box or image caption)
    box.modifier_id = user.id
    if job:
        touch_job_lock(db, job, user.id)
        write_log(
            db,
            actor_id=user.id,
            action=LogAction.edit_box,
            target_type=LogTargetType.box,
            target_id=box.id,
        )
    db.commit()
    return box_to_dict(box)


@router.delete("/boxes/{box_id}")
def delete_box(
    box_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    box = db.get(Box, box_id)
    if not box:
        raise HTTPException(404)
    img = box.image
    job = _assert_image_editable(db, user, img)
    # Annotator, reviewer (surplus box), and admin may delete boxes
    if user.role not in (UserRole.annotator, UserRole.reviewer, UserRole.admin):
        raise HTTPException(403)
    if _annotator_may_clear_accept(user, job):
        _strip_accept_tags(img)
    db.delete(box)
    if job:
        touch_job_lock(db, job, user.id)
        write_log(
            db,
            actor_id=user.id,
            action=LogAction.delete_box,
            target_type=LogTargetType.box,
            target_id=box_id,
        )
    db.commit()
    return {"ok": True}


@router.delete("/{image_id}/tags/{tag_name}")
def remove_image_tag(
    image_id: int,
    tag_name: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(404)
    _assert_image_editable(db, user, img)
    if tag_name in _ACCEPT_TAGS and user.role == UserRole.annotator:
        raise HTTPException(403, "Annotator cannot remove Accept S1 / Accept All")
    img.tag = [t for t in (img.tag or []) if t != tag_name]
    img.modifier_id = user.id
    db.commit()
    return image_to_dict(img)
