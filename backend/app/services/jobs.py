from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from ..db import new_session
from ..models.tables import Job

_pool = ThreadPoolExecutor(max_workers=3)
_events: dict[str, list[dict]] = {}
_lock = threading.Lock()


def push(job_id: str, event: dict) -> None:
    with _lock:
        _events.setdefault(job_id, []).append(event)


def events_since(job_id: str, cursor: int) -> list[dict]:
    with _lock:
        return list(_events.get(job_id, []))[cursor:]


def known(job_id: str) -> bool:
    with _lock:
        return job_id in _events


def update(job_id: str, **fields) -> None:
    with new_session() as session:
        job = session.get(Job, job_id)
        if job is not None:
            for key, value in fields.items():
                setattr(job, key, value)
            session.add(job)
            session.commit()


def submit(kind: str, user_id: int | None, work: Callable[[Callable[[dict], None]], dict]) -> str:
    job_id = uuid.uuid4().hex[:12]
    with new_session() as session:
        session.add(Job(id=job_id, kind=kind, status="queued", created_by=user_id))
        session.commit()
    push(job_id, {"type": "queued", "job_id": job_id})

    def run() -> None:
        update(job_id, status="running")
        push(job_id, {"type": "started"})
        try:
            result = work(lambda event: push(job_id, event))
            update(job_id, status="done", plan_id=result.get("plan_id"), result_json=result)
            push(job_id, {"type": "done", **result})
        except Exception as error:
            update(job_id, status="failed", error=str(error))
            push(job_id, {"type": "error", "message": str(error)})

    _pool.submit(run)
    return job_id


def mark_interrupted() -> None:
    with new_session() as session:
        from sqlmodel import select

        for job in session.exec(select(Job).where(Job.status.in_(["queued", "running"]))):
            job.status = "interrupted"
            job.error = "The server restarted while this job was running. Re-run it."
            session.add(job)
        session.commit()
