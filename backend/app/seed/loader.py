from __future__ import annotations

import hashlib
import json
from dataclasses import asdict

from sqlalchemy import insert
from sqlmodel import Session, SQLModel, select

from ..config import SEED_DIR, settings
from ..db import engine, init_db, new_session
from ..engine.data import Dataset
from ..engine.ops import FacultyUnavailable, Spec
from ..engine.pipeline import run_pipeline
from ..engine.plan import Plan
from ..models import tables
from ..services import audit, plans
from ..services.auth import hash_password
from ..services.datasets import clear_dataset_cache, load_dataset
from ..services.planner import build_plan
from .generator import DEPARTMENTS, generate_dataset

SNAPSHOT_PATH = SEED_DIR / "baseline_plan.json"
DEMO_PASSWORD = "Demo@1234"


def dataset_hash(ds: Dataset) -> str:
    payload = json.dumps({"enrollments": ds.enrollments, "rooms": [asdict(r) for r in ds.rooms.values()], "faculty": [asdict(f) for f in ds.faculty.values()], "slots": [asdict(s) for s in ds.slots.values()]}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def populate(session: Session, ds: Dataset) -> None:
    session.execute(insert(tables.Department), [{"id": d, "name": d} for d in DEPARTMENTS] + [{"id": "OPEN", "name": "Open electives"}])
    session.execute(insert(tables.Course), [asdict(c) for c in ds.courses.values()])
    session.execute(insert(tables.Student), [asdict(s) for s in ds.students.values()])
    session.execute(insert(tables.Enrollment), [{"student_id": sid, "course_id": cid} for sid, cids in ds.enrollments.items() for cid in cids])
    session.execute(insert(tables.Room), [asdict(r) for r in ds.rooms.values()])
    session.execute(insert(tables.Faculty), [asdict(f) for f in ds.faculty.values()])
    session.execute(insert(tables.Slot), [asdict(s) for s in ds.slots.values()])
    password_hash = hash_password(DEMO_PASSWORD)
    users = [
        {"email": "admin@jklu.demo", "password_hash": password_hash, "role": "admin", "ref_id": None},
        {"email": "admin2@jklu.demo", "password_hash": password_hash, "role": "admin", "ref_id": None},
    ]
    for index, faculty_id in enumerate(sorted(ds.faculty), start=1):
        users.append({"email": f"faculty{index:02d}@jklu.demo", "password_hash": password_hash, "role": "faculty", "ref_id": faculty_id})
    for index, student_id in enumerate(sorted(ds.students), start=1):
        users.append({"email": f"student{index:03d}@jklu.demo", "password_hash": password_hash, "role": "student", "ref_id": student_id})
    session.execute(insert(tables.User), users)
    session.commit()


def read_snapshot(ds: Dataset) -> tuple[Plan, Spec, dict] | None:
    if not SNAPSHOT_PATH.exists():
        return None
    data = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    if data.get("dataset_hash") != dataset_hash(ds):
        return None
    return Plan.from_dict(data["plan"]), Spec(**data["spec"]), data["stats"]


def write_snapshot(ds: Dataset, plan: Plan, spec: Spec, stats: dict) -> None:
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps({"dataset_hash": dataset_hash(ds), "plan": plan.to_dict(), "spec": spec.model_dump(), "stats": stats}), encoding="utf-8")


def build_baseline(session: Session, ds: Dataset, use_snapshot: bool) -> tables.PlanVersion:
    admin = session.exec(select(tables.User).where(tables.User.email == "admin@jklu.demo")).one()
    snapshot = read_snapshot(ds) if use_snapshot else None
    if snapshot:
        plan, spec, stats = snapshot
    else:
        spec = Spec(seed=settings.seed)
        plan, stats = run_pipeline(ds, spec, None, plans.SOLVER_CONFIG)
        write_snapshot(ds, plan, spec, stats)
    pv = plans.save_plan(session, ds, plan, spec, stats, None, None, "full", "Baseline timetable", "baseline", admin.id)
    plans.submit(session, pv.id, admin, None)
    plans.approve(session, pv.id, admin, None)
    pv, _ = plans.publish(session, ds, pv.id, admin, None)
    return pv


def build_draft(session: Session, ds: Dataset, baseline: tables.PlanVersion) -> None:
    admin = session.exec(select(tables.User).where(tables.User.email == "admin@jklu.demo")).one()
    plan, _ = plans.load_plan(baseline)
    duty = next(d for d in plan.duties if d["room_id"] and d["role"] == "invigilator")
    build_plan(admin.id, "admin", baseline.id, [FacultyUnavailable(faculty_id=duty["faculty_id"], slot_ids=[duty["slot_id"]])], f"Draft: {duty['faculty_id']} unavailable", "seed", "full", only_slots={duty["slot_id"]})


def seed_database(reset: bool = False, use_snapshot: bool = True) -> None:
    if reset:
        SQLModel.metadata.drop_all(engine)
    init_db()
    clear_dataset_cache()
    ds = generate_dataset(settings.seed, settings.scale, settings.exam_start_date)
    with new_session() as session:
        if session.exec(select(tables.User)).first() is not None:
            if session.exec(select(tables.PlanVersion).where(tables.PlanVersion.status == "PUBLISHED")).first() is not None:
                return
            session.close()
            SQLModel.metadata.drop_all(engine)
            init_db()
    with new_session() as session:
        populate(session, ds)
    clear_dataset_cache()
    with new_session() as session:
        stored = load_dataset(session)
        audit.log(None, "system", "seed.start", "database", {"students": len(stored.students), "courses": len(stored.courses), "seed": settings.seed})
        baseline = build_baseline(session, stored, use_snapshot)
        build_draft(session, stored, baseline)
        audit.log(None, "system", "seed.done", f"plan:{baseline.id}", {})


def is_ready() -> bool:
    with new_session() as session:
        return session.exec(select(tables.PlanVersion).where(tables.PlanVersion.status == "PUBLISHED")).first() is not None
