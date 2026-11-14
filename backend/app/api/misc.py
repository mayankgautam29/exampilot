from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..db import get_session
from ..deps import admin_only, current_user
from ..engine.baselines import run_benchmark
from ..models.tables import Job, Notification, User
from ..seed.loader import is_ready
from ..services import audit, jobs, plans
from ..services.datasets import load_dataset
from .common import published_or_404, sse

router = APIRouter(tags=["misc"])
_benchmark_cache: dict[int, dict] = {}


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
def ready() -> dict:
    try:
        return {"ready": is_ready()}
    except Exception:
        return {"ready": False}


@router.get("/jobs/{job_id}")
def job_status(job_id: str, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return {"id": job.id, "kind": job.kind, "status": job.status, "plan_id": job.plan_id, "error": job.error, "result": job.result_json}


@router.get("/solve/stream")
def solve_stream(job_id: str = Query(...), session: Session = Depends(get_session), user: User = Depends(admin_only)):
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    snapshot = {"status": job.status, "error": job.error, "plan_id": job.plan_id}

    def events():
        if not jobs.known(job_id):
            kind = "done" if snapshot["status"] == "done" else "error"
            message = "Interrupted - the server restarted while this job was running. Re-run it." if snapshot["status"] == "interrupted" else snapshot["error"]
            yield {"type": kind, "message": message, "plan_id": snapshot["plan_id"]}
            return
        cursor = 0
        started = time.time()
        while time.time() - started < 900:
            batch = jobs.events_since(job_id, cursor)
            for event in batch:
                cursor += 1
                yield event
                if event["type"] in ("done", "error"):
                    return
            time.sleep(0.2)

    return sse(events())


@router.get("/benchmark/run")
def benchmark(session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    pv = published_or_404(session)
    if pv.id not in _benchmark_cache:
        ds = load_dataset(session)
        seconds = pv.solver_stats_json.get("stage_seconds", {}).get("total", 0)
        _benchmark_cache[pv.id] = {"plan_id": pv.id, "rows": run_benchmark(ds, pv.kpis_json, seconds)}
    audit.log(user.id, user.role, "benchmark.run", f"plan:{pv.id}", {})
    return _benchmark_cache[pv.id]


@router.get("/outbox")
def outbox(limit: int = 100, channel: str | None = None, to: str | None = None, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    query = select(Notification).order_by(Notification.id.desc())
    if channel:
        query = query.where(Notification.channel == channel)
    if to:
        query = query.where(Notification.to.contains(to))
    rows = session.exec(query.limit(min(limit, 500))).all()
    total = len(session.exec(select(Notification.id)).all())
    return {"total": total, "items": [{"id": n.id, "plan_id": n.plan_id, "channel": n.channel, "to": n.to, "subject": n.subject, "body": n.body, "status": n.status, "created_at": n.created_at.isoformat()} for n in rows]}
