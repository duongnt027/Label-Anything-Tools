from datetime import timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Image, Job, JobState, Log, LogAction, LogTargetType, now_gmt7


def count_job_images(db: Session, job_id: int) -> int:
    from sqlalchemy import func

    from app.models import Image

    return (
        db.query(func.count(Image.id))
        .filter(Image.job_id == job_id, Image.job_id.isnot(None))
        .scalar()
        or 0
    )


def count_task_images(db: Session, task_id: int) -> int:
    from sqlalchemy import func

    from app.models import Image

    return (
        db.query(func.count(Image.id))
        .filter(
            Image.task_id == task_id,
            Image.job_id.isnot(None),
            Image.is_golden.is_(False),
        )
        .scalar()
        or 0
    )


def task_stats(db: Session, task_id: int) -> tuple[int, float]:
    from sqlalchemy import func

    jobs = db.query(Job).filter(Job.task_id == task_id).all()
    total = len(jobs)
    if total == 0:
        return 0, 0.0
    completed = sum(1 for j in jobs if j.state == JobState.completed)
    return total, round(100.0 * completed / total, 1)


def write_log(
    db: Session,
    *,
    actor_id: int,
    action: LogAction,
    target_type: LogTargetType,
    target_id: int,
    detail: str = "",
) -> None:
    db.add(
        Log(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=detail,
        )
    )


def last_view_order_index(db: Session, job_id: int, user_id: int) -> int | None:
    """Last image order_index this user viewed in the job (from view_image logs)."""
    log = (
        db.query(Log)
        .filter(
            Log.actor_id == user_id,
            Log.action == LogAction.view_image,
            Log.target_type == LogTargetType.job,
            Log.target_id == job_id,
        )
        .order_by(Log.id.desc())
        .first()
    )
    if not log or not log.detail.startswith("view image "):
        return None
    try:
        image_id = int(log.detail.rsplit(" ", 1)[-1])
    except ValueError:
        return None
    img = db.get(Image, image_id)
    if not img or img.job_id != job_id or img.order_index is None:
        return None
    return img.order_index


def refresh_annotator_locks(db: Session) -> None:
    """Auto-unlock jobs whose holder stayed inside but idle past JOB_LOCK_TIMEOUT_MINUTES."""
    timeout = timedelta(minutes=settings.job_lock_timeout_minutes)
    now = now_gmt7()
    jobs = (
        db.query(Job)
        .filter(Job.locked_by_id.isnot(None), Job.locked_at.isnot(None))
        .all()
    )
    for job in jobs:
        locked_at = job.locked_at
        if locked_at.tzinfo is None:
            from app.models import TZ

            locked_at = locked_at.replace(tzinfo=TZ)
        if now - locked_at <= timeout:
            continue
        prev = job.locked_by_id
        job.locked_by_id = None
        job.locked_at = None
        write_log(
            db,
            actor_id=prev or job.assignee_id or 0,
            action=LogAction.unlock_job_auto,
            target_type=LogTargetType.job,
            target_id=job.id,
            detail=f"Auto unlock after {settings.job_lock_timeout_minutes}m idle inside job",
        )


def touch_job_lock(db: Session, job: Job, user_id: int) -> None:
    job.locked_by_id = user_id
    job.locked_at = now_gmt7()
    job.modifier_id = user_id


def clear_job_lock(db: Session, job: Job, actor_id: int, *, detail: str = "Unlock on leave") -> bool:
    """Clear lock if held. Returns True when a lock was cleared."""
    if job.locked_by_id is None:
        return False
    prev = job.locked_by_id
    job.locked_by_id = None
    job.locked_at = None
    write_log(
        db,
        actor_id=actor_id or prev or 0,
        action=LogAction.unlock_job_manual,
        target_type=LogTargetType.job,
        target_id=job.id,
        detail=detail,
    )
    return True
