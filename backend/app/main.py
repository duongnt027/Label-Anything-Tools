from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, files, images, jobs, tasks, users
from app.database import Base, SessionLocal, engine
from app.models import User, UserRole
from app.security import hash_password
from app.services.tasks import ensure_storage


def seed_users():
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return
        admin = User(
            username="admin",
            password=hash_password("1"),
            role=UserRole.admin,
            supervisor_id=None,
        )
        db.add(admin)
        db.flush()
        reviewer = User(
            username="reviewer1",
            password=hash_password("1"),
            role=UserRole.reviewer,
            supervisor_id=admin.id,
        )
        db.add(reviewer)
        db.flush()
        annotator = User(
            username="annotator1",
            password=hash_password("1"),
            role=UserRole.annotator,
            supervisor_id=reviewer.id,
        )
        db.add(annotator)
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_storage()
    seed_users()
    yield


app = FastAPI(title="Label Anything", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(tasks.router)
app.include_router(jobs.router)
app.include_router(images.router)
app.include_router(files.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
