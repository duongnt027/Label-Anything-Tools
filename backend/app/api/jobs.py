from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Box, BoxStatus, Image, Job, JobState, LogAction, LogTargetType, Task, User, UserRole
from app.schemas import AssignJobIn, JobOut
from app.services.jobs import (
    count_job_images,
    refresh_annotator_locks,
    touch_job_lock,
    write_log,
)
from app.services.status import derive_image_status
from app.services.tasks import box_to_dict, image_to_dict, inject_golden_images

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

ERROR_IMAGE_TAGS = {"Thiếu box", "Thừa box", "Sai Caption"}


def _job_out(db: Session, job: Job) -> JobOut:
    img_num = count_job_images(db, job.id)
    if job.state in (JobState.need_review,) and job.review_stage == 2:
        total_boxes = (
            db.query(Box)
            .join(Image)
            .filter(Image.job_id == job.id)
            .count()
        )
        progress = (job.review_s2_process / total_boxes * 100) if total_boxes else 0
    elif job.state == JobState.need_review:
        progress = (job.review_s1_process / img_num * 100) if img_num else 0
    else:
        progress = (job.annotator_process / img_num * 100) if img_num else 0
    assignee_username = None
    if job.assignee_id:
        u = db.get(User, job.assignee_id)
        assignee_username = u.username if u else None
    locked_by_username = None
    if job.locked_by_id:
        lu = db.get(User, job.locked_by_id)
        locked_by_username = lu.username if lu else None
    updated = job.updated_at.isoformat() if job.updated_at else ""
    return JobOut(
        id=job.id,
        task_id=job.task_id,
        state=job.state.value,
        img_num=img_num,
        annotator_process=job.annotator_process,
        review_s1_process=job.review_s1_process,
        review_s2_process=job.review_s2_process,
        review_stage=job.review_stage,
        assignee_id=job.assignee_id,
        assignee_username=assignee_username,
        locked_by_id=job.locked_by_id,
        locked_by_username=locked_by_username,
        updated_at=updated,
        progress=round(progress, 1),
    )


def _reviewer_for_job(db: Session, job: Job) -> User | None:
    if not job.assignee_id:
        return None
    annotator = db.get(User, job.assignee_id)
    if not annotator or not annotator.supervisor_id:
        return None
    return db.get(User, annotator.supervisor_id)


def _can_edit_job(user: User, job: Job, db: Session, view_as: str | None) -> tuple[bool, bool]:
    """Returns (can_view, can_edit)."""
    readonly = False
    if user.role == UserRole.admin:
        if job.locked_by_id and job.locked_by_id != user.id:
            return True, False
        return True, job.locked_by_id == user.id or job.locked_by_id is None

    if user.role == UserRole.annotator:
        if job.assignee_id != user.id:
            return False, False
        if job.state in (JobState.new, JobState.rejected, JobState.in_progress):
            if job.locked_by_id and job.locked_by_id != user.id:
                return True, False
            return True, True
        return True, False

    if user.role == UserRole.reviewer:
        rev = _reviewer_for_job(db, job)
        if rev and rev.id != user.id and user.role != UserRole.admin:
            return False, False
        if job.state != JobState.need_review:
            return True, False
        if job.locked_by_id and job.locked_by_id != user.id:
            return True, False
        return True, True

    return False, False


@router.get("/my")
def my_jobs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    refresh_annotator_locks(db)
    db.commit()
    if user.role == UserRole.annotator:
        jobs = db.query(Job).filter(Job.assignee_id == user.id).order_by(Job.id.asc()).all()
    elif user.role == UserRole.reviewer:
        subs = db.query(User.id).filter(User.supervisor_id == user.id).subquery()
        jobs = (
            db.query(Job)
            .filter(Job.assignee_id.in_(subs), Job.state == JobState.need_review)
            .order_by(Job.id.asc())
            .all()
        )
    else:
        jobs = db.query(Job).order_by(Job.id.asc()).limit(50).all()
    return [_job_out(db, j) for j in jobs]


@router.get("/by-task/{task_id}")
def jobs_by_task(
    task_id: int,
    tab: str = Query("annotator"),
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    q = db.query(Job).filter(Job.task_id == task_id)
    if tab == "annotator":
        q = q.filter(Job.state.in_([JobState.new, JobState.in_progress, JobState.rejected]))
    elif tab == "review_s1":
        q = q.filter(Job.state == JobState.need_review, Job.review_stage == 1)
    elif tab == "review_s2":
        q = q.filter(Job.state == JobState.need_review, Job.review_stage == 2)
    jobs = q.order_by(Job.id).all()
    return [_job_out(db, j) for j in jobs]


@router.post("/{job_id}/assign", response_model=JobOut)
def assign_job(
    job_id: int,
    body: AssignJobIn,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    if job.assignee_id is not None:
        raise HTTPException(400, "Job đã được assign, không thể đổi assignee")
    annotator = db.get(User, body.assignee_id)
    if not annotator or annotator.role != UserRole.annotator:
        raise HTTPException(400, "Chỉ assign cho user role annotator")
    job.assignee_id = annotator.id
    job.modifier_id = admin.id
    write_log(
        db,
        actor_id=admin.id,
        action=LogAction.assign_job,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=f"Assigned to {annotator.username}",
    )
    db.commit()
    db.refresh(job)
    return _job_out(db, job)


@router.post("/{job_id}/open")
def open_job(
    job_id: int,
    view_as: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    refresh_annotator_locks(db)
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    if user.role == UserRole.admin and view_as in ("annotator", "reviewer"):
        effective_role = view_as
        if view_as == "annotator":
            if job.assignee_id and job.assignee_id != user.id:
                can_view, can_edit = True, False
            elif job.state in (JobState.new, JobState.rejected, JobState.in_progress):
                if job.locked_by_id and job.locked_by_id != user.id:
                    can_view, can_edit = True, False
                else:
                    can_view, can_edit = True, True
            else:
                can_view, can_edit = True, False
        elif view_as == "reviewer":
            if job.state != JobState.need_review:
                can_view, can_edit = True, False
            elif job.locked_by_id and job.locked_by_id != user.id:
                can_view, can_edit = True, False
            else:
                can_view, can_edit = True, True
        else:
            can_view, can_edit = _can_edit_job(user, job, db, view_as)
    else:
        can_view, can_edit = _can_edit_job(user, job, db, view_as)
    if not can_view:
        raise HTTPException(403)

    effective_role = user.role.value
    if user.role == UserRole.admin and view_as in ("annotator", "reviewer"):
        effective_role = view_as

    if can_edit:
        if job.state == JobState.rejected and effective_role == "annotator":
            job.state = JobState.in_progress
        if job.state == JobState.new and effective_role == "annotator":
            job.state = JobState.in_progress
        if job.state == JobState.in_progress and effective_role == "annotator":
            touch_job_lock(db, job, user.id)
            write_log(
                db,
                actor_id=user.id,
                action=LogAction.lock_job,
                target_type=LogTargetType.job,
                target_id=job.id,
            )
        if job.state == JobState.need_review and effective_role == "reviewer":
            if job.review_stage is None:
                job.review_stage = 1
            touch_job_lock(db, job, user.id)
            write_log(
                db,
                actor_id=user.id,
                action=LogAction.lock_job,
                target_type=LogTargetType.job,
                target_id=job.id,
            )
        job.modifier_id = user.id
    db.commit()
    task = db.get(Task, job.task_id)
    return {
        "job": _job_out(db, job),
        "can_edit": can_edit,
        "effective_role": effective_role,
        "task_classes": (task.classes if task else []) or [],
        "min_role_to_add_class": task.min_role_to_add_class.value if task else "admin",
    }


@router.get("/{job_id}/images")
def job_images(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    imgs = (
        db.query(Image)
        .filter(Image.job_id == job_id)
        .order_by(Image.order_index.nulls_last(), Image.id)
        .all()
    )
    return [image_to_dict(i) for i in imgs]


@router.get("/{job_id}/images/{image_id}/boxes")
def image_boxes(
    job_id: int, image_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    img = db.get(Image, image_id)
    if not img or img.job_id != job_id:
        raise HTTPException(404)
    return [box_to_dict(b) for b in img.boxes]


@router.post("/{job_id}/view-image/{image_id}")
def view_image(
    job_id: int,
    image_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = db.get(Job, job_id)
    img = db.get(Image, image_id)
    if not job or not img or img.job_id != job_id:
        raise HTTPException(404)
    idx = img.order_index or 0
    if job.state == JobState.in_progress:
        job.annotator_process = max(job.annotator_process, idx + 1)
    elif job.state == JobState.need_review and job.review_stage == 1:
        job.review_s1_process = max(job.review_s1_process, idx + 1)
    touch_job_lock(db, job, user.id)
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.view_image,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=f"view image {image_id}",
    )
    job.modifier_id = user.id
    db.commit()
    return {"ok": True, "job": _job_out(db, job)}


@router.post("/{job_id}/submit")
def submit_job(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job or job.assignee_id != user.id:
        raise HTTPException(403)
    img_num = count_job_images(db, job.id)
    if job.annotator_process < img_num:
        raise HTTPException(400, "View all images before submit")
    job.state = JobState.need_review
    job.review_stage = 1
    job.review_s1_process = 0
    job.review_s2_process = 0
    inject_golden_images(db, job, user.id)
    job.locked_by_id = None
    job.locked_at = None
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.submit_job,
        target_type=LogTargetType.job,
        target_id=job.id,
    )
    job.modifier_id = user.id
    db.commit()
    return _job_out(db, job)


@router.post("/{job_id}/review/stage1/continue")
def review_stage1_continue(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    rev = _reviewer_for_job(db, job) if job else None
    if not job or (user.role != UserRole.admin and (not rev or rev.id != user.id)):
        raise HTTPException(403)
    img_num = count_job_images(db, job.id)
    if job.review_s1_process < img_num:
        raise HTTPException(400, "View all images first")
    imgs = db.query(Image).filter(Image.job_id == job_id).all()
    for img in imgs:
        tags = list(img.tag or [])
        has_error = any(t in ERROR_IMAGE_TAGS for t in tags)
        if not has_error and "Accept S1" not in tags:
            tags.append("Accept S1")
            img.tag = tags
            img.modifier_id = user.id
    job.review_stage = 2
    job.review_s2_process = 0
    job.modifier_id = user.id
    db.commit()
    return _job_out(db, job)


@router.post("/{job_id}/review/stage2/submit")
def review_stage2_submit(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    rev = _reviewer_for_job(db, job) if job else None
    if not job or (user.role != UserRole.admin and (not rev or rev.id != user.id)):
        raise HTTPException(403)
    boxes = db.query(Box).join(Image).filter(Image.job_id == job_id).all()
    for box in boxes:
        if box.tag:
            box.status = BoxStatus.Rejected
        elif box.status == BoxStatus.Unseen:
            box.status = BoxStatus.Accepted
    imgs = db.query(Image).filter(Image.job_id == job_id).all()
    for img in imgs:
        tags = list(img.tag or [])
        if "Sai Caption" in tags:
            continue
        all_accepted = all(b.status == BoxStatus.Accepted for b in img.boxes)
        if all_accepted and not any(t in ERROR_IMAGE_TAGS for t in tags):
            if "Accept All" not in tags:
                tags.append("Accept All")
            img.tag = tags
    job.review_s2_process = len(boxes)
    job.modifier_id = user.id
    db.commit()
    return {"boxes": len(boxes)}


@router.post("/{job_id}/accept")
def accept_job(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    rev = _reviewer_for_job(db, job) if job else None
    if not job or job.state != JobState.need_review:
        raise HTTPException(400)
    if user.role != UserRole.admin and (not rev or rev.id != user.id):
        raise HTTPException(403)
    job.state = JobState.completed
    job.locked_by_id = None
    job.locked_at = None
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.accept_job,
        target_type=LogTargetType.job,
        target_id=job.id,
    )
    job.modifier_id = user.id
    db.commit()
    return _job_out(db, job)


@router.post("/{job_id}/reject")
def reject_job(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    rev = _reviewer_for_job(db, job) if job else None
    if not job or job.state != JobState.need_review:
        raise HTTPException(400)
    if user.role != UserRole.admin and (not rev or rev.id != user.id):
        raise HTTPException(403)
    job.state = JobState.rejected
    job.locked_by_id = None
    job.locked_at = None
    write_log(
        db,
        actor_id=user.id,
        action=LogAction.reject_job,
        target_type=LogTargetType.job,
        target_id=job.id,
    )
    job.modifier_id = user.id
    db.commit()
    return _job_out(db, job)


@router.get("/{job_id}/stage2/boxes")
def stage2_boxes(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    boxes = (
        db.query(Box)
        .join(Image)
        .filter(Image.job_id == job_id)
        .order_by(Box.class_, Box.id)
        .all()
    )
    result = []
    for b in boxes:
        d = box_to_dict(b)
        d["image_source"] = b.image.image_source
        result.append(d)
    return result
