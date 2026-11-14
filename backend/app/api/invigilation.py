from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..deps import admin_only, current_user, require_role
from ..engine.disruption import swap_with_reliever
from ..engine.kpis import gini
from ..engine.rules import load_rules
from ..engine.validator import hard_violations, validate
from ..models.tables import SwapRequest, User
from ..services import audit, plans
from ..services.datasets import load_dataset
from ..services.planner import build_plan
from ..engine.ops import FacultyUnavailable

router = APIRouter(tags=["invigilation"])


class SwapBody(BaseModel):
    slot_id: str
    reason: str = ""
    plan_id: int | None = None


def precheck(session: Session, plan_id: int, faculty_id: str, slot_id: str) -> dict:
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, spec = plans.load_plan(pv)
    rules = load_rules(spec.rules)
    spec = spec.model_copy(deep=True)
    spec.faculty_unavailable[faculty_id] = sorted(set(spec.faculty_unavailable.get(faculty_id, [])) | {slot_id})
    candidate, change = swap_with_reliever(ds, spec, rules, plan, faculty_id, slot_id)
    if candidate is None:
        return {"feasible": False, "message": "No eligible reliever is available; the solver would need to re-plan this session", "replacement": None, "violations": []}
    blocking = hard_violations(validate(ds, spec, candidate))
    return {"feasible": not blocking, "message": "A reliever can take over" if not blocking else "The swap would break hard rules", "replacement": change, "violations": [v.to_dict() for v in blocking[:5]]}


@router.get("/plans/{plan_id}/roster")
def roster(plan_id: int, session: Session = Depends(get_session), user: User = Depends(require_role("admin", "faculty"))) -> dict:
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, _ = plans.load_plan(pv)
    if user.role == "faculty" and pv.status != "PUBLISHED":
        raise HTTPException(403, "Only the published plan is visible")
    totals = {f: 0 for f in ds.faculty}
    for duty in plan.duties:
        if duty["room_id"]:
            totals[duty["faculty_id"]] += 1
    visible = [f for f in ds.faculty.values() if user.role == "admin" or f.id == user.ref_id]
    rows = [{"faculty_id": f.id, "name": f.name, "dept": f.dept, "rank": f.rank, "total": totals[f.id], "max": f.max_duties, "duties": [{"slot_id": d["slot_id"], "room_id": d["room_id"], "role": d["role"]} for d in plan.duties if d["faculty_id"] == f.id]} for f in visible]
    relievers = {slot: [d["faculty_id"] for d in plan.duties if d["slot_id"] == slot and d["room_id"] is None] for slot in ds.usable_slot_ids}
    return {"plan_id": plan_id, "faculty": rows, "slots": [{"id": s.id, "label": s.label} for s in ds.slots.values() if not s.blocked], "relievers": relievers if user.role == "admin" else {}, "gini": round(gini(list(totals.values())), 3), "min": min(totals.values()), "max": max(totals.values())}


@router.post("/swaps")
def request_swap(body: SwapBody, session: Session = Depends(get_session), user: User = Depends(require_role("faculty"))) -> dict:
    published = plans.published_plan(session)
    plan_id = body.plan_id or (published.id if published else None)
    if plan_id is None:
        raise HTTPException(404, "No published plan")
    check = precheck(session, plan_id, user.ref_id, body.slot_id)
    swap = SwapRequest(plan_id=plan_id, faculty_id=user.ref_id, slot_id=body.slot_id, reason=body.reason, precheck_json=check)
    session.add(swap)
    session.commit()
    session.refresh(swap)
    audit.log(user.id, user.role, "swap.request", f"swap:{swap.id}", {"slot": body.slot_id, "feasible": check["feasible"]}, reasoning=body.reason)
    return {"id": swap.id, "status": swap.status, "precheck": check}


@router.get("/swaps")
def list_swaps(session: Session = Depends(get_session), user: User = Depends(current_user)) -> list[dict]:
    query = select(SwapRequest).order_by(SwapRequest.id.desc())
    if user.role == "faculty":
        query = query.where(SwapRequest.faculty_id == user.ref_id)
    elif user.role != "admin":
        raise HTTPException(403, "Not allowed")
    return [{"id": s.id, "plan_id": s.plan_id, "faculty_id": s.faculty_id, "slot_id": s.slot_id, "reason": s.reason, "status": s.status, "precheck": s.precheck_json, "created_at": s.created_at.isoformat()} for s in session.exec(query)]


@router.post("/swaps/{swap_id}/approve")
def approve_swap(swap_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    swap = session.get(SwapRequest, swap_id)
    if swap is None:
        raise HTTPException(404, "Swap not found")
    if swap.status != "PENDING":
        raise HTTPException(409, f"Swap is already {swap.status}")
    result = build_plan(user.id, user.role, swap.plan_id, [FacultyUnavailable(faculty_id=swap.faculty_id, slot_ids=[swap.slot_id])], f"Swap: {swap.faculty_id} released from {swap.slot_id}", "swap", "hotfix", only_slots={swap.slot_id}, status="PENDING_APPROVAL")
    if result.get("status") != "ok":
        raise HTTPException(409, result.get("message") or "The swap could not be planned")
    swap.status = "IN_APPROVAL"
    session.add(swap)
    session.commit()
    audit.log(user.id, user.role, "swap.approve", f"swap:{swap.id}", {"hotfix_plan": result["plan_id"]})
    return {"id": swap.id, "status": swap.status, "plan_id": result["plan_id"]}


@router.post("/swaps/{swap_id}/reject")
def reject_swap(swap_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    swap = session.get(SwapRequest, swap_id)
    if swap is None:
        raise HTTPException(404, "Swap not found")
    swap.status = "REJECTED"
    session.add(swap)
    session.commit()
    audit.log(user.id, user.role, "swap.reject", f"swap:{swap.id}", {})
    return {"id": swap.id, "status": swap.status}
