from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session

from ..agent.fallback_parser import interpret
from ..db import get_session
from ..deps import admin_only
from ..engine.diff import diff_plans
from ..engine.ops import parse_ops
from ..models.tables import User
from ..services import audit, jobs, plans
from ..services.datasets import load_dataset
from ..services.planner import build_plan

router = APIRouter(tags=["scenarios"])


class ScenarioBody(BaseModel):
    name: str = "Scenario"
    ops: list[dict] = []
    text: str = ""
    base_plan_id: int | None = None


@router.post("/scenarios")
def create_scenario(body: ScenarioBody, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    base = plans.get_plan(session, body.base_plan_id) if body.base_plan_id else plans.published_plan(session)
    if base is None:
        raise HTTPException(404, "No base plan available")
    ops_raw = body.ops
    if not ops_raw and body.text.strip():
        ds = load_dataset(session)
        plan, _ = plans.load_plan(base)
        outcome = interpret(body.text, ds, "admin", None, plan.exams)
        if outcome.kind == "clarify":
            raise HTTPException(422, outcome.clarify["question"] + " Please be more specific.")
        if outcome.kind != "change":
            raise HTTPException(422, outcome.message or "I could not turn that into changes")
        ops_raw = outcome.ops
    if not ops_raw:
        raise HTTPException(422, "Provide ops or text")
    ops = parse_ops(ops_raw)
    audit.log(user.id, user.role, "scenario.create", f"plan:{base.id}", {"name": body.name, "ops": [op.describe() for op in ops]})

    def work(emit) -> dict:
        result = build_plan(user.id, user.role, base.id, ops, body.name, "scenario", "scenario", emit=emit)
        if result.get("status") == "infeasible":
            raise RuntimeError(result["message"] + ": " + "; ".join(item["human_text"] for item in result.get("diagnosis", {}).get("core", [])[:3]))
        if result.get("status") != "ok":
            raise RuntimeError("; ".join(result.get("errors", [])) or "Scenario failed")
        return result

    return {"job_id": jobs.submit("scenario", user.id, work), "base_plan_id": base.id}


@router.get("/scenarios/compare")
def compare(ids: str = Query(...), session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    ds = load_dataset(session)
    rows = []
    for raw in ids.split(","):
        pv = plans.get_plan(session, int(raw))
        parent = plans.get_plan(session, pv.parent_id) if pv.parent_id else None
        info = None
        if parent:
            old, _ = plans.load_plan(parent)
            new, spec = plans.load_plan(pv)
            info = diff_plans(ds.with_supplementary(spec.supplementary), old, new)
        kpis = pv.kpis_json
        health = kpis.get("health", {})
        rows.append({
            "plan_id": pv.id,
            "label": pv.label,
            "status": pv.status,
            "courses_moved": len(info["courses_moved"]) if info else 0,
            "students_affected": info["students_affected"]["count"] if info else 0,
            "seating_risk": kpis.get("seating_risk_index"),
            "fairness": round(100 * (1 - kpis.get("duty_gini", 0)), 1),
            "rooms_total": kpis.get("rooms_total"),
            "health": health.get("score"),
            "hard_violations": kpis.get("hard_violations"),
            "components": health.get("components", {}),
            "relaxed": kpis.get("relaxed_rules"),
        })
    return {"rows": rows}


@router.post("/scenarios/{plan_id}/adopt")
def adopt(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    pv = plans.get_plan(session, plan_id)
    if pv.status != "DRAFT" or pv.kind not in ("scenario", "hotfix"):
        raise HTTPException(409, "Only DRAFT scenarios can be adopted")
    if pv.kind == "scenario":
        pv.kind = "full"
    pv.origin = "scenario+adopted"
    pv.row_version += 1
    session.add(pv)
    session.commit()
    audit.log(user.id, user.role, "scenario.adopt", f"plan:{plan_id}", {"label": pv.label})
    return plans.plan_summary(pv)
