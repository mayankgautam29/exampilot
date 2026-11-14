from __future__ import annotations

import os

from fastapi import HTTPException
import hashlib

from sqlalchemy import delete, insert
from sqlmodel import Session, select

from ..config import settings
from ..engine.data import Dataset
from ..engine.diff import diff_plans, student_view
from ..engine.health import health_score, moved_fraction
from ..engine.kpis import compute_kpis
from ..engine.ops import Spec
from ..engine.pipeline import SolverConfig
from ..engine.plan import Plan
from ..engine.rules import load_weights
from ..engine.validator import hard_violations, validate
from ..models.tables import ExamEntry, InvigDuty, Notification, PlanVersion, RoomAllocation, SeatAssignment, User, now
from . import audit

SOLVER_CONFIG = SolverConfig(
    workers=settings.solver_workers,
    timetable_seconds=settings.solver_time_limit_s,
    venue_seconds=2.0,
    invigilation_seconds=10.0 if settings.solver_workers > 2 else 5.0,
    seat_iterations=settings.seat_iterations,
    seat_workers=settings.solver_workers if (os.cpu_count() or 1) > 1 else 1,
)

STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PUBLISHED", "REJECTED", "SUPERSEDED"]


def get_plan(session: Session, plan_id: int) -> PlanVersion:
    plan = session.get(PlanVersion, plan_id)
    if plan is None:
        raise HTTPException(404, f"Plan {plan_id} not found")
    return plan


def published_plan(session: Session) -> PlanVersion | None:
    return session.exec(select(PlanVersion).where(PlanVersion.status == "PUBLISHED").order_by(PlanVersion.version.desc())).first()


def load_plan(pv: PlanVersion) -> tuple[Plan, Spec]:
    return Plan.from_dict(pv.data_json), Spec(**pv.spec_json)


def plan_summary(pv: PlanVersion) -> dict:
    return {
        "id": pv.id,
        "parent_id": pv.parent_id,
        "kind": pv.kind,
        "status": pv.status,
        "version": pv.version,
        "row_version": pv.row_version,
        "label": pv.label,
        "origin": pv.origin,
        "created_by": pv.created_by,
        "created_at": pv.created_at.isoformat(),
        "approved_by": pv.approved_by,
        "rejection_reason": pv.rejection_reason,
        "kpis": pv.kpis_json,
        "hard_violations": sum(1 for v in pv.violations_json if v["severity"] == "hard"),
        "soft_violations": sum(1 for v in pv.violations_json if v["severity"] == "soft"),
        "relaxed": bool(pv.data_json.get("relaxed")),
        "solver_stats": pv.solver_stats_json,
    }


def evaluate(ds: Dataset, spec: Spec, plan: Plan, stats: dict, baseline: Plan | None) -> tuple[list[dict], dict]:
    violations = validate(ds, spec, plan)
    kpis = compute_kpis(ds, spec, plan, violations, stats)
    supplemented = ds.with_supplementary(spec.supplementary)
    kpis["health"] = health_score(kpis, load_weights(spec.weights), moved_fraction(supplemented, plan, baseline))
    return [v.to_dict() for v in violations], kpis


def write_derived(session: Session, plan_id: int, plan: Plan) -> None:
    session.execute(delete(ExamEntry).where(ExamEntry.plan_id == plan_id))
    session.execute(insert(ExamEntry), [{"plan_id": plan_id, "course_id": c, "slot_id": s} for c, s in plan.exams.items()])
    allocations = [{"plan_id": plan_id, "slot_id": a["slot_id"], "room_id": a["room_id"], "course_id": a["course_id"], "n_students": len(a["students"])} for a in plan.allocations]
    if allocations:
        session.execute(insert(RoomAllocation), allocations)
    seats = [{"plan_id": plan_id, "slot_id": s["slot_id"], "student_id": s["student_id"], "room_id": s["room_id"], "course_id": s["course_id"], "row": s["row"], "col": s["col"]} for s in plan.seats]
    for start in range(0, len(seats), 2000):
        session.execute(insert(SeatAssignment), seats[start:start + 2000])
    duties = [{"plan_id": plan_id, "slot_id": d["slot_id"], "room_id": d["room_id"], "faculty_id": d["faculty_id"], "role": d["role"]} for d in plan.duties]
    if duties:
        session.execute(insert(InvigDuty), duties)


def save_plan(session: Session, ds: Dataset, plan: Plan, spec: Spec, stats: dict, baseline: Plan | None, parent_id: int | None, kind: str, label: str, origin: str, created_by: int | None, status: str = "DRAFT") -> PlanVersion:
    violations, kpis = evaluate(ds, spec, plan, stats, baseline)
    latest = session.exec(select(PlanVersion.version).order_by(PlanVersion.version.desc())).first() or 0
    pv = PlanVersion(parent_id=parent_id, kind=kind, status=status, version=latest + 1, label=label, origin=origin, spec_json=spec.model_dump(), data_json=plan.to_dict(), kpis_json=kpis, violations_json=violations, solver_stats_json=stats, created_by=created_by)
    session.add(pv)
    session.commit()
    session.refresh(pv)
    write_derived(session, pv.id, plan)
    session.commit()
    return pv


def check_lock(pv: PlanVersion, if_match: str | None) -> None:
    if if_match is not None and if_match.strip('"') != str(pv.row_version):
        raise HTTPException(409, f"Plan changed since you loaded it (row version {pv.row_version}, you sent {if_match})")


def bump(pv: PlanVersion) -> None:
    pv.row_version += 1


def submit(session: Session, plan_id: int, user: User, if_match: str | None) -> PlanVersion:
    pv = get_plan(session, plan_id)
    check_lock(pv, if_match)
    if pv.status not in ("DRAFT", "REJECTED"):
        raise HTTPException(409, f"Only DRAFT or REJECTED plans can be submitted (status is {pv.status})")
    pv.status = "PENDING_APPROVAL"
    bump(pv)
    session.add(pv)
    session.commit()
    audit.log(user.id, user.role, "plan.submit", f"plan:{pv.id}", {"version": pv.version})
    return pv


def approve(session: Session, plan_id: int, user: User, if_match: str | None) -> PlanVersion:
    pv = get_plan(session, plan_id)
    check_lock(pv, if_match)
    if pv.status != "PENDING_APPROVAL":
        raise HTTPException(409, f"Only PENDING_APPROVAL plans can be approved (status is {pv.status})")
    admins = session.exec(select(User).where(User.role == "admin")).all()
    if settings.require_different_approver and len(admins) > 1 and pv.created_by == user.id:
        raise HTTPException(403, "The approver must be different from the plan creator")
    pv.status = "APPROVED"
    pv.approved_by = user.id
    pv.rejection_reason = None
    bump(pv)
    session.add(pv)
    session.commit()
    audit.log(user.id, user.role, "plan.approve", f"plan:{pv.id}", {"version": pv.version, "hard_violations": sum(1 for v in pv.violations_json if v["severity"] == "hard")})
    return pv


def reject(session: Session, plan_id: int, user: User, reason: str, if_match: str | None) -> PlanVersion:
    if not reason.strip():
        raise HTTPException(422, "A rejection reason is required")
    pv = get_plan(session, plan_id)
    check_lock(pv, if_match)
    if pv.status not in ("PENDING_APPROVAL", "APPROVED"):
        raise HTTPException(409, f"Only pending or approved plans can be rejected (status is {pv.status})")
    pv.status = "REJECTED"
    pv.rejection_reason = reason.strip()
    pv.approved_by = None
    bump(pv)
    session.add(pv)
    session.commit()
    audit.log(user.id, user.role, "plan.reject", f"plan:{pv.id}", {"version": pv.version}, reasoning=reason.strip())
    return pv


def publish(session: Session, ds: Dataset, plan_id: int, user: User, if_match: str | None) -> tuple[PlanVersion, int]:
    pv = get_plan(session, plan_id)
    check_lock(pv, if_match)
    if pv.status != "APPROVED":
        raise HTTPException(409, f"Only APPROVED plans can be published (status is {pv.status})")
    plan, spec = load_plan(pv)
    blocking = hard_violations(validate(ds, spec, plan))
    if blocking:
        audit.log(user.id, user.role, "plan.publish_blocked", f"plan:{pv.id}", {"codes": sorted({v.code for v in blocking}), "count": len(blocking)})
        raise HTTPException(409, {"message": "Publish blocked: the plan has hard violations", "violations": [v.to_dict() for v in blocking[:20]], "count": len(blocking)})
    previous = published_plan(session)
    if previous is not None:
        previous.status = "SUPERSEDED"
        bump(previous)
        session.add(previous)
    pv.status = "PUBLISHED"
    bump(pv)
    session.add(pv)
    session.commit()
    sent = fan_out(session, ds, pv, previous)
    audit.log(user.id, user.role, "plan.publish", f"plan:{pv.id}", {"version": pv.version, "supersedes": previous.id if previous else None, "notifications": sent})
    return pv, sent


def rollback(session: Session, plan_id: int, user: User) -> PlanVersion:
    source = get_plan(session, plan_id)
    if source.status not in ("PUBLISHED", "SUPERSEDED", "APPROVED"):
        raise HTTPException(409, "Only previously published plans can be rolled back to")
    latest = session.exec(select(PlanVersion.version).order_by(PlanVersion.version.desc())).first() or 0
    clone = PlanVersion(parent_id=source.id, kind="full", status="PENDING_APPROVAL", version=latest + 1, label=f"Rollback to v{source.version}", origin="rollback", spec_json=source.spec_json, data_json=source.data_json, kpis_json=source.kpis_json, violations_json=source.violations_json, solver_stats_json=source.solver_stats_json, created_by=user.id)
    session.add(clone)
    session.commit()
    session.refresh(clone)
    write_derived(session, clone.id, Plan.from_dict(clone.data_json))
    session.commit()
    audit.log(user.id, user.role, "plan.rollback", f"plan:{clone.id}", {"restores": source.id})
    return clone


def schedule_lines(ds: Dataset, view: dict, student_id: str, changed: set[str]) -> list[str]:
    lines = []
    entries = sorted(((key[1], value) for key, value in view.items() if key[0] == student_id), key=lambda item: item[1][0])
    for course_id, (slot_id, room_id, row, col) in entries:
        marker = " (changed)" if course_id in changed else ""
        lines.append(f"{course_id} {ds.courses[course_id].name}: {ds.slots[slot_id].label}, room {room_id}, seat {row + 1}-{col + 1}{marker}")
    return lines


def fan_out(session: Session, ds: Dataset, pv: PlanVersion, previous: PlanVersion | None) -> int:
    plan, spec = load_plan(pv)
    supplemented = ds.with_supplementary(spec.supplementary)
    emails = {u.ref_id: u.email for u in session.exec(select(User).where(User.ref_id.is_not(None)))}
    view = student_view(plan)
    notifications: list[Notification] = []
    if previous is None:
        targets = {sid: set() for sid in supplemented.students if not sid.startswith("SUP-")}
        subject, intro = "Your exam timetable is published", "Your exam timetable has been published."
    else:
        old_plan, _ = load_plan(previous)
        info = diff_plans(supplemented, old_plan, plan)
        old_view = student_view(old_plan)
        targets = {}
        for sid in info["affected_student_ids"]:
            if sid.startswith("SUP-"):
                continue
            changed = {key[1] for key, value in view.items() if key[0] == sid and old_view.get(key) != value}
            targets[sid] = changed
        subject, intro = "Your exam schedule has changed", "Your exam schedule has been updated after re-approval."
        for faculty_id in info["affected_faculty_ids"]:
            if faculty_id in emails:
                notifications.append(Notification(plan_id=pv.id, channel="email", to=emails[faculty_id], subject="Your invigilation duty has changed", body="Your invigilation duties changed in the newly published plan. Please open ExamPilot to review them."))
    for sid, changed in targets.items():
        address = emails.get(sid, f"{sid.lower()}@jklu.demo")
        body = intro + "\n" + "\n".join(schedule_lines(supplemented, view, sid, changed))
        notifications.append(Notification(plan_id=pv.id, channel="email", to=address, subject=subject, body=body))
        if previous is not None and changed:
            notifications.append(Notification(plan_id=pv.id, channel="whatsapp", to=f"+91-98{int(hashlib.sha256(sid.encode()).hexdigest()[:8], 16) % 10**8:08d}", subject=subject, body=f"{intro} {len(changed)} exam(s) changed: {', '.join(sorted(changed))}"))
    session.add_all(notifications)
    session.commit()
    return len(notifications)
