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
    if body.caption is not None:
        img.caption = body.caption
    if body.details is not None:
        img.details = body.details
    if body.tag is not None:
        if user.role == UserRole.annotator:
            raise HTTPException(403, "Annotator cannot set image tags directly")
        img.tag = body.tag
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
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.add_to_golden_pool,
        target_type=LogTargetType.image,
        target_id=golden.id,
    )
    db.commit()
    return image_to_dict(golden)


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
    tags = list(img.tag or [])
    if "Accept S1" in tags:
        tags = [t for t in tags if t != "Accept S1"]
        img.tag = tags
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
            box.tag = v
            if user.role != UserRole.annotator:
                box.status = BoxStatus(sync_box_status_from_tags(v or [], box.status.value))
        elif hasattr(box, k if k != "class" else "class_"):
            setattr(box, k if k != "class" else "class_", v)
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
    if user.role not in (UserRole.annotator, UserRole.admin):
        raise HTTPException(403)
    tags = list(img.tag or [])
    if "Accept S1" in tags:
        tags = [t for t in tags if t != "Accept S1"]
        img.tag = tags
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
    img.tag = [t for t in (img.tag or []) if t != tag_name]
    img.modifier_id = user.id
    db.commit()
    return image_to_dict(img)
