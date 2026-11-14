from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from ..agent import briefing
from ..agent.llm import llm
from ..db import get_session
from ..deps import admin_only, current_user
from ..engine import explain
from ..engine.diff import diff_plans
from ..engine.ops import Regenerate, parse_ops
from ..engine.validator import validate
from ..models.tables import PlanVersion, User
from ..services import audit, jobs, plans
from ..services.datasets import load_dataset
from ..services.planner import build_plan
from .common import plan_for_user

router = APIRouter(tags=["plans"])

HARD_CODES = [
    ("H-STU-SLOT-CLASH", "No student has two exams in one session"),
    ("H-STU-DAY-LIMIT", "No student exceeds the exams-per-day limit"),
    ("H-ROOM-CAPACITY", "Every room is within its fill limit and every student has a room"),
    ("H-ROOM-BLOCKED", "No blocked room is used"),
    ("H-BLOCKED-SLOT", "No exam sits in a holiday or blocked date"),
    ("H-EXAM-MISSING", "Every course has an exam slot"),
    ("H-SEAT-DUP", "Every student has exactly one seat and no seat is shared"),
    ("H-SEAT-BLOCKED", "No blocked or non-existent seat is used"),
    ("H-ACCESS", "Accessible and extra-time students are placed correctly"),
    ("H-INVIG-COVERAGE", "Every room and session has enough invigilators and relievers"),
    ("H-INVIG-DOUBLE", "No invigilator is in two places in one session"),
    ("H-INVIG-OWN-COURSE", "No invigilator watches their own course"),
    ("H-INVIG-UNAVAILABLE", "No invigilator is used while unavailable"),
    ("H-INVIG-DAYLIMIT", "No invigilator exceeds the daily duty limit"),
    ("H-INVIG-MAXDUTIES", "No invigilator exceeds the total duty limit"),
    ("H-PIN", "Every pin and forbid request is honoured"),
]


class GenerateRequest(BaseModel):
    label: str = "Generated plan"
    base_plan_id: int | None = None
    ops: list[dict] = []


class RejectRequest(BaseModel):
    reason: str


def summaries(session: Session, status: str | None, kind: str | None) -> list[dict]:
    query = select(PlanVersion).order_by(PlanVersion.version.desc())
    if status:
        query = query.where(PlanVersion.status == status)
    if kind:
        query = query.where(PlanVersion.kind == kind)
    return [plans.plan_summary(pv) for pv in session.exec(query)]


@router.get("/plans")
def list_plans(status: str | None = None, kind: str | None = None, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> list[dict]:
    return summaries(session, status, kind)


@router.get("/catalogue")
def catalogue(session: Session = Depends(get_session), user: User = Depends(current_user)) -> dict:
    ds = load_dataset(session)
    admin = user.role != "student"
    return {
        "courses": [{"id": c.id, "name": c.name, "dept": c.dept, "semester": c.semester, "size": ds.size(c.id), "difficulty": c.difficulty, "owner": c.owner_faculty_id} for c in ds.courses.values()],
        "rooms": [{"id": r.id, "building": r.building, "floor": r.floor, "rows": r.rows, "cols": r.cols, "seats": r.seat_count, "accessible": r.accessible, "quiet": r.quiet} for r in ds.rooms.values()],
        "faculty": [{"id": f.id, "name": f.name, "dept": f.dept, "rank": f.rank} for f in ds.faculty.values()] if admin else [],
        "slots": [{"id": s.id, "date": s.date, "session": s.session, "start": s.start, "end": s.end, "blocked": s.blocked, "label": s.label} for s in ds.slots.values()],
    }


@router.get("/plans/{plan_id}")
def plan_detail(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, spec = plans.load_plan(pv)
    supplemented = ds.with_supplementary(spec.supplementary)
    return {
        **plans.plan_summary(pv),
        "spec": spec.model_dump(),
        "violations": pv.violations_json[:400],
        "exams": [{"course_id": c, "name": supplemented.courses[c].name, "dept": supplemented.courses[c].dept, "semester": supplemented.courses[c].semester, "difficulty": supplemented.courses[c].difficulty, "size": supplemented.size(c), "slot_id": s, "pinned": spec.pins.get(c) == s} for c, s in sorted(plan.exams.items())],
        "rooms_per_slot": {slot: len(rooms) for slot, rooms in plan.slot_rooms().items()},
        "headline": {"pending_hard": sum(1 for v in pv.violations_json if v["severity"] == "hard")},
    }


@router.post("/plans/generate")
def generate(body: GenerateRequest, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    ops = parse_ops(body.ops) if body.ops else [Regenerate(scope="all")]
    audit.log(user.id, user.role, "plan.generate_requested", f"plan:{body.base_plan_id}", {"label": body.label, "ops": [op.describe() for op in ops]})

    def work(emit) -> dict:
        result = build_plan(user.id, user.role, body.base_plan_id, ops, body.label, "generate", "full", emit=emit, stable=body.base_plan_id is not None)
        if result.get("status") != "ok":
            raise RuntimeError(result.get("message") or "; ".join(result.get("errors", [])) or "Plan generation failed")
        result.pop("diff", None)
        return result

    return {"job_id": jobs.submit("generate", user.id, work)}


@router.get("/plans/{plan_id}/validate")
def validate_plan(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, spec = plans.load_plan(pv)
    violations = validate(ds, spec, plan)
    hard = [v.to_dict() for v in violations if v.severity == "hard"]
    soft = [v.to_dict() for v in violations if v.severity == "soft"]
    by_code: dict[str, int] = {}
    for v in hard:
        by_code[v["code"]] = by_code.get(v["code"], 0) + 1
    checks = [{"code": code, "description": text, "violations": by_code.get(code, 0), "passed": by_code.get(code, 0) == 0} for code, text in HARD_CODES]
    audit.log(user.id, user.role, "plan.validate", f"plan:{plan_id}", {"hard": len(hard), "soft": len(soft)})
    return {"plan_id": plan_id, "hard_count": len(hard), "soft_count": len(soft), "hard": hard[:100], "soft": soft[:100], "checks": checks, "publishable": not hard}


@router.get("/plans/{plan_id}/kpis")
def plan_kpis(plan_id: int, session: Session = Depends(get_session), user: User = Depends(current_user)) -> dict:
    return plan_for_user(session, user, plan_id).kpis_json


@router.get("/plans/{plan_id}/health")
def plan_health(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    return plans.get_plan(session, plan_id).kpis_json.get("health", {})


@router.get("/plans/{a}/diff/{b}")
def plan_diff(a: int, b: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    first, second = plans.get_plan(session, a), plans.get_plan(session, b)
    ds = load_dataset(session)
    plan_a, _ = plans.load_plan(first)
    plan_b, spec_b = plans.load_plan(second)
    info = diff_plans(ds.with_supplementary(spec_b.supplementary), plan_a, plan_b, first.kpis_json, second.kpis_json)
    info.pop("affected_student_ids", None)
    return info


@router.post("/plans/{plan_id}/submit")
def submit(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only), if_match: str | None = Header(default=None)) -> dict:
    return plans.plan_summary(plans.submit(session, plan_id, user, if_match))


@router.post("/plans/{plan_id}/approve")
def approve(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only), if_match: str | None = Header(default=None)) -> dict:
    return plans.plan_summary(plans.approve(session, plan_id, user, if_match))


@router.post("/plans/{plan_id}/reject")
def reject(plan_id: int, body: RejectRequest, session: Session = Depends(get_session), user: User = Depends(admin_only), if_match: str | None = Header(default=None)) -> dict:
    return plans.plan_summary(plans.reject(session, plan_id, user, body.reason, if_match))


@router.post("/plans/{plan_id}/publish")
def publish(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only), if_match: str | None = Header(default=None)) -> dict:
    ds = load_dataset(session)
    pv, sent = plans.publish(session, ds, plan_id, user, if_match)
    return {**plans.plan_summary(pv), "notifications_sent": sent}


@router.post("/plans/{plan_id}/rollback")
def rollback(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    return plans.plan_summary(plans.rollback(session, plan_id, user))


@router.get("/plans/{plan_id}/briefing")
def plan_briefing(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, _ = plans.load_plan(pv)
    days = len({ds.slots[s].date for s in plan.exams.values()})
    result = briefing.build(pv, days, len(set(plan.exams.values())), llm)
    audit.log(user.id, user.role, "plan.briefing", f"plan:{plan_id}", {"mode": result["mode"], "verified": result["verified"]})
    return result


@router.get("/plans/{plan_id}/move-check")
def move_check(plan_id: int, course: str = Query(...), session: Session = Depends(get_session), user: User = Depends(admin_only)) -> list[dict]:
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    if course not in ds.courses:
        from fastapi import HTTPException

        raise HTTPException(404, f"Unknown course {course}")
    plan, spec = plans.load_plan(pv)
    return explain.move_check(ds, spec, plan, course)


@router.get("/plans/{plan_id}/timetable")
def timetable(plan_id: int, session: Session = Depends(get_session), user: User = Depends(current_user)) -> dict:
    pv = plan_for_user(session, user, plan_id)
    ds = load_dataset(session)
    plan, spec = plans.load_plan(pv)
    return {"plan_id": plan_id, "exams": [{"course_id": c, "name": ds.courses[c].name if c in ds.courses else c, "slot_id": s, "dept": ds.courses[c].dept if c in ds.courses else "", "size": ds.size(c) if c in ds.courses else 0} for c, s in sorted(plan.exams.items())], "relaxed": plan.relaxed}
