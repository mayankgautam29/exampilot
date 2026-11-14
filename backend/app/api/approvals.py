from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..db import get_session
from ..deps import admin_only
from ..engine.diff import diff_plans
from ..models.tables import PlanVersion, User
from ..services import plans
from ..services.datasets import load_dataset

router = APIRouter(tags=["approvals"])


@router.get("/approvals")
def inbox(session: Session = Depends(get_session), user: User = Depends(admin_only)) -> list[dict]:
    ds = load_dataset(session)
    published = plans.published_plan(session)
    published_plan, _ = plans.load_plan(published) if published else (None, None)
    pending = session.exec(select(PlanVersion).where(PlanVersion.status.in_(["PENDING_APPROVAL", "APPROVED"])).order_by(PlanVersion.version.desc())).all()
    items = []
    for pv in pending:
        plan, spec = plans.load_plan(pv)
        info = None
        if published_plan is not None:
            info = diff_plans(ds.with_supplementary(spec.supplementary), published_plan, plan, published.kpis_json, pv.kpis_json)
            info.pop("affected_student_ids", None)
        hard = [v for v in pv.violations_json if v["severity"] == "hard"]
        items.append({**plans.plan_summary(pv), "diff": info, "hard": hard[:20], "health": pv.kpis_json.get("health", {}), "checklist": {"zero_hard_violations": not hard, "relaxed_rules_acknowledged": not plan.relaxed, "diff_reviewed": info is not None}})
    return items
