from pydantic import BaseModel, ConfigDict, Field


class TaskEventCount(BaseModel):
    action: str
    count: int


class TaskUserStatistics(BaseModel):
    user_id: int
    username: str
    events: list[TaskEventCount]


class TaskStatisticsSection(BaseModel):
    key: str
    label: str
    description: str
    users: list[TaskUserStatistics]


class TaskStatisticsOut(BaseModel):
    sections: list[TaskStatisticsSection]


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    supervisor_username: str | None = None


class LoginResponse(Token):
    user: UserOut


class UserCreate(BaseModel):
    username: str
    password: str
    role: str
    supervisor_username: str | None = None


class UserUpdate(BaseModel):
    username: str | None = None
    password: str | None = None
    role: str | None = None
    supervisor_username: str | None = None


class TaskCreate(BaseModel):
    name: str | None = None
    chunk_size: int = 50
    classes: list[str] = Field(default_factory=list)
    min_role_to_add_class: str = "admin"
    golden_per_job: int = 2


class TaskUpdate(BaseModel):
    name: str | None = None


class TaskOut(BaseModel):
    id: int
    name: str
    job_num: int
    img_num: int
    completed_jobs: int
    process: float
    classes: list[str]
    min_role_to_add_class: str
    golden_per_job: int
    chunk_size: int
    created_at: str


class JobOut(BaseModel):
    id: int
    task_id: int
    task_job_id: int
    state: str
    img_num: int
    annotator_process: int
    review_s1_process: int
    review_s2_process: int
    review_stage: int | None
    assignee_id: int | None
    assignee_username: str | None = None
    locked_by_id: int | None
    locked_by_username: str | None = None
    updated_at: str
    progress: float


class AssignJobIn(BaseModel):
    assignee_id: int


class JobStateIn(BaseModel):
    state: str


class AutoAssignIn(BaseModel):
    assignee_ids: list[int] | None = None


class TaskAssigneesIn(BaseModel):
    user_ids: list[int]


class TrackBoxesDeleteIn(BaseModel):
    track_id: str
    from_order_index: int = 0


class BoxIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    class_name: str = Field(alias="class", default="")
    box_points: str = "0.5 0.5 0.1 0.1"
    segment_points: str = ""
    ocr_text: str = ""
    caption: str = ""
    details: str = ""


class BoxUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    class_name: str | None = Field(default=None, alias="class")
    box_points: str | None = None
    segment_points: str | None = None
    ocr_text: str | None = None
    caption: str | None = None
    details: str | None = None
    tag: list[str] | None = None
    status: str | None = None


class ImageUpdate(BaseModel):
    caption: str | None = None
    details: str | None = None
    tag: list[str] | None = None


class ExportOptions(BaseModel):
    include_images: bool = False
    # all | visible | invisible
    box_visibility: str = "all"
    # legacy alias kept for older clients
    include_rejected: bool | None = None
    job_ids: list[int] | None = None


class ExportGoldenOptions(BaseModel):
    include_images: bool = False
    box_visibility: str = "all"
    image_ids: list[int] | None = None


class MountDirEntry(BaseModel):
    name: str
    path: str
    has_children: bool
    image_count: int


class MountTreeOut(BaseModel):
    path: str
    parent: str | None
    entries: list[MountDirEntry]
