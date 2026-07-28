import enum
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

TZ = ZoneInfo("Asia/Ho_Chi_Minh")


class UserRole(str, enum.Enum):
    admin = "admin"
    annotator = "annotator"
    reviewer = "reviewer"


class MinRoleToAddClass(str, enum.Enum):
    admin = "admin"
    reviewer = "reviewer"
    annotator = "annotator"


class JobState(str, enum.Enum):
    new = "new"
    in_progress = "in_progress"
    need_review = "need_review"
    completed = "completed"
    rejected = "rejected"


class BoxStatus(str, enum.Enum):
    Unseen = "Unseen"
    Accepted = "Accepted"
    Rejected = "Rejected"


class LogTargetType(str, enum.Enum):
    task = "task"
    job = "job"
    image = "image"
    box = "box"
    user = "user"
    class_ = "class"


class LogAction(str, enum.Enum):
    create_task = "create_task"
    delete_task = "delete_task"
    add_class = "add_class"
    remove_class = "remove_class"
    add_user = "add_user"
    remove_user = "remove_user"
    assign_job = "assign_job"
    view_image = "view_image"
    add_box = "add_box"
    edit_box = "edit_box"
    delete_box = "delete_box"
    edit_image_tag = "edit_image_tag"
    edit_box_tag = "edit_box_tag"
    submit_job = "submit_job"
    accept_job = "accept_job"
    reject_job = "reject_job"
    lock_job = "lock_job"
    unlock_job_auto = "unlock_job_auto"
    unlock_job_manual = "unlock_job_manual"
    add_to_golden_pool = "add_to_golden_pool"
    inject_golden_images = "inject_golden_images"
    change_job_state = "change_job_state"


def now_gmt7() -> datetime:
    return datetime.now(TZ)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False)
    supervisor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    supervisor = relationship("User", remote_side=[id], back_populates="subordinates")
    subordinates = relationship("User", back_populates="supervisor")


class Task(Base):
    __tablename__ = "task"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    classes: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    min_role_to_add_class: Mapped[MinRoleToAddClass] = mapped_column(
        Enum(MinRoleToAddClass, name="min_role_to_add_class"),
        default=MinRoleToAddClass.admin,
    )
    golden_per_job: Mapped[int] = mapped_column(Integer, default=0)
    chunk_size: Mapped[int] = mapped_column(Integer, default=50)
    modifier_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_gmt7)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_gmt7, onupdate=now_gmt7
    )

    jobs = relationship("Job", back_populates="task", cascade="all, delete-orphan")
    images = relationship("Image", back_populates="task", cascade="all, delete-orphan")
    assignees = relationship("TaskAssignee", back_populates="task", cascade="all, delete-orphan")


class TaskAssignee(Base):
    """Users allowed to be assigned to jobs of this task."""

    __tablename__ = "task_assignees"
    __table_args__ = (
        UniqueConstraint("task_id", "user_id", name="uq_task_assignee"),
        Index("ix_task_assignees_task_id", "task_id"),
        Index("ix_task_assignees_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    task = relationship("Task", back_populates="assignees")
    user = relationship("User")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_task_id", "task_id"),
        Index("ix_jobs_assignee", "assignee_id"),
        Index("ix_jobs_state_assignee", "state", "assignee_id"),
        Index("ix_jobs_locked_by", "locked_by_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"), nullable=False)
    state: Mapped[JobState] = mapped_column(Enum(JobState, name="job_state"), default=JobState.new)
    annotator_process: Mapped[int] = mapped_column(Integer, default=0)
    review_s1_process: Mapped[int] = mapped_column(Integer, default=0)
    review_s2_process: Mapped[int] = mapped_column(Integer, default=0)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    locked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_stage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    golden_injected: Mapped[bool] = mapped_column(Boolean, default=False)
    modifier_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_gmt7)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_gmt7, onupdate=now_gmt7
    )

    task = relationship("Task", back_populates="jobs")
    images = relationship("Image", back_populates="job", foreign_keys="Image.job_id")


class Image(Base):
    __tablename__ = "images"
    __table_args__ = (
        Index("ix_images_job_id", "job_id"),
        Index("ix_images_task_golden", "task_id", "is_golden"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=True
    )
    is_golden: Mapped[bool] = mapped_column(Boolean, default=False)
    image_source: Mapped[str] = mapped_column(String(1024), nullable=False)
    order_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tag: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    modifier_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_gmt7)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_gmt7, onupdate=now_gmt7
    )

    task = relationship("Task", back_populates="images")
    job = relationship("Job", back_populates="images", foreign_keys=[job_id])
    boxes = relationship("Box", back_populates="image", cascade="all, delete-orphan")


class Box(Base):
    __tablename__ = "boxes"
    __table_args__ = (Index("ix_boxes_img_id", "img_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    img_id: Mapped[int] = mapped_column(ForeignKey("images.id", ondelete="CASCADE"), nullable=False)
    is_golden: Mapped[bool] = mapped_column(Boolean, default=False)
    tag: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    status: Mapped[BoxStatus] = mapped_column(Enum(BoxStatus, name="box_status"), default=BoxStatus.Unseen)
    modifier_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    class_: Mapped[str] = mapped_column("class", String(255), default="")
    box_points: Mapped[str] = mapped_column(String(255), default="0 0 0 0")
    segment_points: Mapped[str] = mapped_column(Text, default="")
    ocr_text: Mapped[str] = mapped_column(Text, default="")
    caption: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_gmt7)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_gmt7, onupdate=now_gmt7
    )

    image = relationship("Image", back_populates="boxes")


class Log(Base):
    __tablename__ = "logs"
    __table_args__ = (
        Index("ix_logs_target", "target_type", "target_id"),
        Index("ix_logs_created_at", "created_at"),
        Index("ix_logs_actor", "actor_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    action: Mapped[LogAction] = mapped_column(Enum(LogAction, name="log_action"), nullable=False)
    target_type: Mapped[LogTargetType] = mapped_column(
        Enum(LogTargetType, name="log_target_type"), nullable=False
    )
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_gmt7)
