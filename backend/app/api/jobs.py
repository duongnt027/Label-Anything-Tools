from fastapi import APIRouter, Depends, HTTPException, Query
import json
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import (
    Box,
    BoxStatus,
    Image,
    Job,
    JobState,
    LogAction,
    LogTargetType,
    Task,
    TaskAssignee,
    User,
    UserRole,
)
from app.schemas import AssignJobIn, AutoAssignIn, JobOut, JobStateIn, TrackBoxesDeleteIn
from app.services.jobs import (
    clear_job_lock,
    count_job_images,
    last_view_order_index,
    refresh_annotator_locks,
    touch_job_lock,
    write_log,
)
from app.services.status import derive_image_status
from app.services.tasks import box_to_dict, image_to_dict, inject_golden_images

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

ERROR_IMAGE_TAGS = {"Thiếu box", "Thừa box", "Sai Caption"}


def _box_track_id(details: str | None) -> str | None:
    if not details or not details.strip():
        return None
    try:
        o = json.loads(details)
        if isinstance(o, dict):
            t = o.get("_track")
            if isinstance(t, str) and t.strip():
                return t.strip()
    except json.JSONDecodeError:
        pass
    return None


def _task_job_id(db: Session, job: Job) -> int:
    """1-based job number within its task (not the global PK)."""
    return (
        db.query(func.count(Job.id))
        .filter(Job.task_id == job.task_id, Job.id <= job.id)
        .scalar()
        or 0
    )


def _job_out(db: Session, job: Job, task_job_id: int | None = None) -> JobOut:
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
        task_job_id=task_job_id if task_job_id is not None else _task_job_id(db, job),
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
        if not rev or rev.id != user.id:
            return False, False
        # Can always view assignee jobs; edit only when need_review
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
        # All jobs of supervised annotators (view); edit gated by need_review on open
        jobs = (
            db.query(Job)
            .filter(Job.assignee_id.in_(subs))
            .order_by(Job.id.asc())
            .all()
        )
    else:
        jobs = db.query(Job).order_by(Job.id.asc()).limit(50).all()
    return [_job_out(db, j) for j in jobs]


@router.get("/by-task/{task_id}")
def jobs_by_task(
    task_id: int,
    tab: str = Query("all"),
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
    # When listing all jobs of a task, local ids are consecutive 1..n.
    # For filtered tabs, still number by creation order within the full task.
    if tab == "all":
        return [_job_out(db, j, task_job_id=i) for i, j in enumerate(jobs, start=1)]
    return [_job_out(db, j) for j in jobs]


def _task_pool_user_ids(db: Session, task_id: int) -> set[int]:
    return {
        r.user_id
        for r in db.query(TaskAssignee.user_id).filter(TaskAssignee.task_id == task_id).all()
    }


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
    assignee = db.get(User, body.assignee_id)
    if not assignee or assignee.role not in (UserRole.annotator, UserRole.reviewer):
        raise HTTPException(400, "Chỉ assign cho annotator hoặc reviewer")
    if assignee.id not in _task_pool_user_ids(db, job.task_id):
        raise HTTPException(400, "User chưa được thêm vào Assignees của task")
    prev = job.assignee_id
    job.assignee_id = assignee.id
    job.modifier_id = admin.id
    # Reassigning to someone else clears an active lock from the previous holder.
    if prev != assignee.id and job.locked_by_id is not None and job.locked_by_id != assignee.id:
        clear_job_lock(db, job, admin.id, detail=f"Unlock due to reassign to {assignee.username}")
    write_log(
        db,
        actor_id=admin.id,
        action=LogAction.assign_job,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=f"Assigned to {assignee.username}" + (f" (was user #{prev})" if prev and prev != assignee.id else ""),
    )
    db.commit()
    db.refresh(job)
    return _job_out(db, job)


@router.patch("/{job_id}/state", response_model=JobOut)
def set_job_state(
    job_id: int,
    body: JobStateIn,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    try:
        new_state = JobState(body.state)
    except ValueError:
        raise HTTPException(400, f"State không hợp lệ: {body.state}")
    prev = job.state.value
    job.state = new_state
    if new_state == JobState.need_review and job.review_stage is None:
        job.review_stage = 1
    if new_state in (JobState.new, JobState.completed):
        job.locked_by_id = None
        job.locked_at = None
    job.modifier_id = admin.id
    write_log(
        db,
        actor_id=admin.id,
        action=LogAction.change_job_state,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=f"State {prev} → {new_state.value}",
    )
    db.commit()
    db.refresh(job)
    return _job_out(db, job)


@router.post("/{job_id}/unassign", response_model=JobOut)
def unassign_job(
    job_id: int,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    if job.assignee_id is None:
        return _job_out(db, job)
    prev = job.assignee_id
    job.assignee_id = None
    job.modifier_id = admin.id
    if job.locked_by_id == prev:
        job.locked_by_id = None
        job.locked_at = None
    write_log(
        db,
        actor_id=admin.id,
        action=LogAction.assign_job,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=f"Unassigned (was user #{prev})",
    )
    db.commit()
    db.refresh(job)
    return _job_out(db, job)


@router.post("/by-task/{task_id}/auto-assign")
def auto_assign_jobs(
    task_id: int,
    body: AutoAssignIn | None = None,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    """Assign unassigned jobs evenly across the task assignee pool."""
    if not db.get(Task, task_id):
        raise HTTPException(404)

    pool_ids = _task_pool_user_ids(db, task_id)
    if not pool_ids:
        raise HTTPException(400, "Chưa có thành viên khả thi để tự assign — thêm vào Assignees trước")

    # Only members already in the persisted pool (ignore body ids outside the pool).
    requested = set(body.assignee_ids) if body and body.assignee_ids else pool_ids
    member_ids = sorted(pool_ids & requested)
    if not member_ids:
        raise HTTPException(400, "Không có thành viên trong Assignees để auto assign")

    member_set = set(member_ids)
    jobs = db.query(Job).filter(Job.task_id == task_id).order_by(Job.id).all()

    counts: dict[int, int] = {mid: 0 for mid in member_ids}
    for job in jobs:
        if job.assignee_id in member_set:
            counts[job.assignee_id] += 1

    unassigned = [j for j in jobs if j.assignee_id is None]
    assigned_n = 0
    for job in unassigned:
        best = min(member_ids, key=lambda mid: (counts[mid], mid))
        job.assignee_id = best
        job.modifier_id = admin.id
        counts[best] += 1
        assigned_n += 1
        write_log(
            db,
            actor_id=admin.id,
            action=LogAction.assign_job,
            target_type=LogTargetType.job,
            target_id=job.id,
            detail=f"Auto-assigned to user #{best}",
        )

    db.commit()
    return {"assigned": assigned_n, "counts": counts}


@router.post("/{job_id}/unlock", response_model=JobOut)
def unlock_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Leave workspace → unlock immediately. Timeout only applies while still inside."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    if job.locked_by_id is None:
        return _job_out(db, job)
    if job.locked_by_id != user.id and user.role != UserRole.admin:
        raise HTTPException(403, "Job đang bị người khác lock")
    clear_job_lock(db, job, user.id, detail="Unlock on leave")
    job.modifier_id = user.id
    db.commit()
    db.refresh(job)
    return _job_out(db, job)


def _admin_view_permissions(
    job: Job, view_as: str | None, admin_view: str | None, admin_id: int
) -> tuple[bool, bool, str]:
    """Admin preview: can always view; edit only on the job's current stage screen."""
    screen = admin_view if admin_view in ("annotator", "s1", "s2") else None
    if screen is None:
        if view_as == "annotator":
            screen = "annotator"
        elif view_as == "reviewer":
            screen = "s2" if (job.review_stage or 1) == 2 else "s1"
        else:
            return True, False, "admin"

    effective = "annotator" if screen == "annotator" else "reviewer"
    stage_ok = False
    if screen == "annotator":
        stage_ok = job.state in (JobState.new, JobState.rejected, JobState.in_progress)
    elif screen == "s1":
        stage_ok = job.state == JobState.need_review and (job.review_stage or 1) == 1
    elif screen == "s2":
        stage_ok = job.state == JobState.need_review and job.review_stage == 2

    if not stage_ok:
        return True, False, effective
    # Edit when unlocked or already locked by this admin
    if job.locked_by_id is None or job.locked_by_id == admin_id:
        return True, True, effective
    return True, False, effective


@router.post("/{job_id}/open")
def open_job(
    job_id: int,
    view_as: str | None = Query(None),
    admin_view: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    refresh_annotator_locks(db)
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)

    if user.role == UserRole.admin and (
        view_as in ("annotator", "reviewer") or admin_view in ("annotator", "s1", "s2")
    ):
        can_view, can_edit, effective_role = _admin_view_permissions(
            job, view_as, admin_view, user.id
        )
    else:
        can_view, can_edit = _can_edit_job(user, job, db, view_as)
        effective_role = user.role.value
        if user.role == UserRole.admin and view_as in ("annotator", "reviewer"):
            effective_role = view_as

    if not can_view:
        raise HTTPException(403)

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
    resume_order_index = last_view_order_index(db, job.id, user.id)
    return {
        "job": _job_out(db, job),
        "can_edit": can_edit,
        "effective_role": effective_role,
        "task_classes": (task.classes if task else []) or [],
        "min_role_to_add_class": task.min_role_to_add_class.value if task else "admin",
        "resume_order_index": resume_order_index,
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
    # Only refresh lock timeout while the current user still holds the lock.
    if job.locked_by_id == user.id:
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


@router.post("/{job_id}/delete-track-boxes")
def delete_track_boxes(
    job_id: int,
    body: TrackBoxesDeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete all boxes with the same track id from this order_index through the end of the job."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    can_view, can_edit = _can_edit_job(user, job, db, None)
    if not can_view:
        raise HTTPException(403)
    if not can_edit:
        raise HTTPException(403, "Job is locked or read-only")
    track_id = (body.track_id or "").strip()
    if not track_id:
        raise HTTPException(400, "track_id required")
    imgs = (
        db.query(Image)
        .filter(
            Image.job_id == job_id,
            func.coalesce(Image.order_index, 0) >= body.from_order_index,
        )
        .all()
    )
    deleted = 0
    for img in imgs:
        for box in list(img.boxes):
            if _box_track_id(box.details) != track_id:
                continue
            write_log(
                db,
                actor_id=user.id,
                action=LogAction.delete_box,
                target_type=LogTargetType.box,
                target_id=box.id,
            )
            db.delete(box)
            deleted += 1
    if deleted and job:
        touch_job_lock(db, job, user.id)
        job.modifier_id = user.id
    db.commit()
    return {"ok": True, "deleted": deleted}


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
    s2_boxes = [
        box
        for box in boxes
        if "Accept S1" in (box.image.tag or []) or "Accept All" in (box.image.tag or [])
    ]
    for box in s2_boxes:
        if box.tag:
            box.status = BoxStatus.Rejected
        elif box.status == BoxStatus.Unseen:
            box.status = BoxStatus.Accepted
    imgs = db.query(Image).filter(Image.job_id == job_id).all()
    for img in imgs:
        tags = list(img.tag or [])
        if "Accept S1" not in tags and "Accept All" not in tags:
            continue
        if "Sai Caption" in tags:
            continue
        all_accepted = all(b.status == BoxStatus.Accepted for b in img.boxes)
        if all_accepted and not any(t in ERROR_IMAGE_TAGS for t in tags):
            if "Accept All" not in tags:
                tags.append("Accept All")
            img.tag = tags
    job.review_s2_process = len(s2_boxes)
    job.modifier_id = user.id
    db.commit()
    return {"boxes": len(boxes)}


def _job_has_review_issues(db: Session, job_id: int) -> bool:
    """True if any box is Rejected or any image still carries error tags."""
    rejected_boxes = (
        db.query(Box.id)
        .join(Image)
        .filter(Image.job_id == job_id, Box.status == BoxStatus.Rejected)
        .limit(1)
        .first()
    )
    if rejected_boxes:
        return True
    imgs = db.query(Image).filter(Image.job_id == job_id).all()
    for img in imgs:
        tags = list(img.tag or [])
        if any(t in ERROR_IMAGE_TAGS for t in tags):
            return True
    return False


@router.post("/{job_id}/accept")
def accept_job(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    rev = _reviewer_for_job(db, job) if job else None
    if not job or job.state != JobState.need_review:
        raise HTTPException(400)
    if user.role != UserRole.admin and (not rev or rev.id != user.id):
        raise HTTPException(403)
    # Cannot complete a job that still has rejected boxes / image error tags
    if _job_has_review_issues(db, job.id):
        job.state = JobState.rejected
        action = LogAction.reject_job
        detail = "auto-rejected: has Rejected boxes or image error tags"
    else:
        job.state = JobState.completed
        action = LogAction.accept_job
        detail = ""
    job.locked_by_id = None
    job.locked_at = None
    write_log(
        db,
        actor_id=user.id,
        action=action,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=detail,
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
    """Only boxes from images that passed Stage 1 (Accept S1 / Accept All)."""
    boxes = (
        db.query(Box)
        .join(Image)
        .filter(Image.job_id == job_id)
        .order_by(Box.class_, Box.id)
        .all()
    )
    result = []
    for b in boxes:
        tags = set(b.image.tag or [])
        if "Accept S1" not in tags and "Accept All" not in tags:
            continue
        d = box_to_dict(b)
        d["image_source"] = b.image.image_source
        result.append(d)
    return result
