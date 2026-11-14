from __future__ import annotations

from sqlalchemy import event, text
from sqlmodel import Session, SQLModel, create_engine

from .config import settings
from .models import tables  # noqa: F401

is_sqlite = settings.database_url.startswith("sqlite")

if is_sqlite:
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False, "timeout": 60})

    @event.listens_for(engine, "connect")
    def sqlite_pragmas(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=60000")
        cursor.close()
else:
    engine = create_engine(settings.database_url, pool_pre_ping=True)

SQLITE_TRIGGERS = [
    "CREATE TRIGGER IF NOT EXISTS auditlog_no_update BEFORE UPDATE ON auditlog BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END",
    "CREATE TRIGGER IF NOT EXISTS auditlog_no_delete BEFORE DELETE ON auditlog BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END",
]
POSTGRES_RULES = [
    "CREATE OR REPLACE RULE auditlog_no_update AS ON UPDATE TO auditlog DO INSTEAD NOTHING",
    "CREATE OR REPLACE RULE auditlog_no_delete AS ON DELETE TO auditlog DO INSTEAD NOTHING",
]


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    with engine.begin() as connection:
        for statement in SQLITE_TRIGGERS if is_sqlite else POSTGRES_RULES:
            connection.execute(text(statement))


def get_session():
    with Session(engine) as session:
        yield session


def new_session() -> Session:
    return Session(engine)
