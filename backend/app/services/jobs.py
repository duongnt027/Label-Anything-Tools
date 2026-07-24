from datetime import timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Job, JobState, Log, LogAction, LogTargetType, now_gmt7


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


def refresh_annotator_locks(db: Session) -> None:
    timeout = timedelta(minutes=settings.annotator_lock_timeout_minutes)
    now = now_gmt7()
    jobs = (
        db.query(Job)
        .filter(Job.state == JobState.in_progress, Job.locked_by_id.isnot(None))
        .all()
    )
    for job in jobs:
        last_log = (
            db.query(Log)
            .filter(Log.target_type == LogTargetType.job, Log.target_id == job.id)
            .order_by(Log.created_at.desc())
            .first()
        )
        if last_log is None:
            continue
        if now - last_log.created_at > timeout:
            prev = job.locked_by_id
            job.locked_by_id = None
            job.locked_at = None
            write_log(
                db,
                actor_id=prev or job.assignee_id or 0,
                action=LogAction.unlock_job_auto,
                target_type=LogTargetType.job,
                target_id=job.id,
                detail="Auto unlock after inactivity",
            )


def touch_job_lock(db: Session, job: Job, user_id: int) -> None:
    job.locked_by_id = user_id
    job.locked_at = now_gmt7()
    job.modifier_id = user_id
