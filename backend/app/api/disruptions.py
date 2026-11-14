from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session, new_session
from ..deps import admin_only
from ..engine.diff import diff_plans
from ..engine.disruption import build_disruption, swap_with_reliever
from ..engine.ops import apply_ops, validate_ops
from ..engine.rules import load_rules
from ..engine.validator import hard_violations, validate
from ..models.tables import Disruption, User
from ..services import audit, jobs, plans
from ..services.datasets import load_dataset
from ..services.planner import build_plan

router = APIRouter(tags=["disruptions"])


class DisruptionBody(BaseModel):
    kind: str
    faculty_id: str | None = None
    room_id: str | None = None
    slot_id: str | None = None
    date: str | None = None


def fast_reliever_plan(user: User, base_id: int, change, faculty_id: str, slot_id: str) -> dict | None:
    with new_session() as session:
        ds = load_dataset(session)
        base = plans.get_plan(session, base_id)
        plan, spec = plans.load_plan(base)
        new_spec = apply_ops(spec, change.ops)
        candidate, swap = swap_with_reliever(ds, new_spec, load_rules(new_spec.rules), plan, faculty_id, slot_id)
        if candidate is None or hard_violations(validate(ds, new_spec, candidate)):
            return None
        pv = plans.save_plan(session, ds, candidate, new_spec, {"stage_seconds": {"total": 0.0}, "method": "reliever swap"}, plan, base_id, "hotfix", f"Hotfix: {change.summary}", "disruption", user.id, "PENDING_APPROVAL")
        info = diff_plans(ds, plan, candidate, base.kpis_json, pv.kpis_json)
        return {"plan_id": pv.id, "diff": info, "swap": swap, "hard_count": 0, "status": "ok"}


@router.post("/disruptions")
def create(body: DisruptionBody, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    published = plans.published_plan(session)
    if published is None:
        raise HTTPException(404, "There is no published plan to protect")
    ds = load_dataset(session)
    try:
        change = build_disruption(ds, body.kind, body.model_dump())
    except (KeyError, ValueError):
        raise HTTPException(422, "Missing details for this disruption type")
    errors = validate_ops(ds, change.ops)
    if errors:
        raise HTTPException(422, "; ".join(errors))
    record = Disruption(kind=body.kind, payload_json=body.model_dump(), summary=change.summary, created_by=user.id)
    session.add(record)
    session.commit()
    session.refresh(record)
    audit.log(user.id, user.role, "disruption.reported", f"disruption:{record.id}", {"kind": body.kind, "summary": change.summary})
    base_id = published.id

    def work(emit) -> dict:
        result = None
        if body.kind == "invigilator_absent":
            emit({"type": "stage", "stage": "invigilation", "status": "running"})
            result = fast_reliever_plan(user, base_id, change, body.faculty_id, body.slot_id)
            emit({"type": "stage", "stage": "invigilation", "status": "done"})
        if result is None:
            result = build_plan(user.id, user.role, base_id, change.ops, f"Hotfix: {change.summary}", "disruption", "hotfix", emit=emit, only_slots=change.only_slots, status="PENDING_APPROVAL")
        if result.get("status") != "ok":
            message = result.get("message") or "; ".join(result.get("errors", [])) or "The disruption could not be absorbed"
            raise RuntimeError(message)
        with new_session() as inner:
            row = inner.get(Disruption, record.id)
            row.plan_id = result["plan_id"]
            row.status = "HOTFIX_PENDING"
            inner.add(row)
            inner.commit()
        diff = result.get("diff") or {}
        replacements = diff.get("invigilators_changed", {}).get("replacements", [])
        audit.log(user.id, user.role, "disruption.hotfix", f"plan:{result['plan_id']}", {"disruption": record.id, "replacements": replacements[:10], "students_affected": diff.get("students_affected", {}).get("count")})
        return {"plan_id": result["plan_id"], "disruption_id": record.id, "summary": change.summary, "replacements": replacements, "students_affected": diff.get("students_affected", {}).get("count", 0), "courses_moved": len(diff.get("courses_moved", [])), "hard_count": result.get("hard_count", 0)}

    return {"job_id": jobs.submit("disruption", user.id, work), "disruption_id": record.id}


@router.get("/disruptions")
def list_disruptions(session: Session = Depends(get_session), user: User = Depends(admin_only)) -> list[dict]:
    return [{"id": d.id, "kind": d.kind, "summary": d.summary, "status": d.status, "plan_id": d.plan_id, "payload": d.payload_json, "created_at": d.created_at.isoformat()} for d in session.exec(select(Disruption).order_by(Disruption.id.desc()))]
