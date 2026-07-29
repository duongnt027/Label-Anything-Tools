from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import settings

_engine_kwargs: dict = {"pool_pre_ping": True}

if settings.db_use_pgbouncer:
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_size"] = settings.db_pool_size
    _engine_kwargs["max_overflow"] = settings.db_max_overflow
    _engine_kwargs["pool_recycle"] = settings.db_pool_recycle

engine = create_engine(settings.database_url, **_engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
