from __future__ import annotations

import threading
import time
from typing import Callable

from ..db import new_session
from ..engine.diff import diff_plans
from ..engine.ops import BlockRoom, ChangeOp, FacultyUnavailable, Regenerate, Spec, apply_ops, validate_ops
from ..engine.pipeline import PlanningError, run_pipeline
from ..engine.plan import Plan
from . import audit
from .datasets import load_dataset
from .plans import SOLVER_CONFIG, get_plan, load_plan, save_plan

PIPELINE_SLOTS = threading.Semaphore(2)


def result_payload(pv, diff: dict | None) -> dict:
    hard = [v for v in pv.violations_json if v["severity"] == "hard"]
    return {
        "status": "ok",
        "plan_id": pv.id,
        "version": pv.version,
        "kind": pv.kind,
        "relaxed": bool(pv.data_json.get("relaxed")),
        "kpis": pv.kpis_json,
        "health": pv.kpis_json.get("health", {}),
        "hard_count": len(hard),
        "hard_violations": hard[:10],
        "soft_count": sum(1 for v in pv.violations_json if v["severity"] == "soft"),
        "diff": diff,
        "solve_seconds": pv.solver_stats_json.get("stage_seconds", {}).get("total"),
    }


def auto_scope(ops: list[ChangeOp]) -> set[str] | None:
    slots: set[str] = set()
    for op in ops:
        if isinstance(op, (FacultyUnavailable, BlockRoom)):
            slots |= set(op.slot_ids)
        elif not (isinstance(op, Regenerate) and op.scope == "seating"):
            return None
    return slots


def build_plan(user_id: int | None, role: str, base_plan_id: int | None, ops: list[ChangeOp], label: str, origin: str, kind: str, emit: Callable[[dict], None] | None = None, only_slots: set[str] | None = None, status: str = "DRAFT", stable: bool = True) -> dict:
    with new_session() as session:
        ds = load_dataset(session)
        base = get_plan(session, base_plan_id) if base_plan_id else None
        base_plan, base_spec = load_plan(base) if base else (None, Spec())
        base_kpis = base.kpis_json if base else None
    errors = validate_ops(ds, ops)
    if errors:
        return {"status": "invalid", "errors": errors}
    spec = apply_ops(base_spec, ops)
    started = time.time()
    scope = only_slots
    if scope is None and stable and base_plan is not None:
        scope = auto_scope(ops)
    try:
        with PIPELINE_SLOTS:
            try:
                plan, stats = run_pipeline(ds, spec, base_plan if stable else None, SOLVER_CONFIG, scope, emit)
            except PlanningError as scoped_error:
                if scope is None or only_slots is not None or scoped_error.stage == "timetable":
                    raise
                plan, stats = run_pipeline(ds, spec, base_plan, SOLVER_CONFIG, None, emit)
    except PlanningError as error:
        audit.log(user_id, role, "solver.failed", f"plan:{base_plan_id}", {"stage": error.stage, "message": error.message, "ops": [op.describe() for op in ops], "core": error.diagnosis.get("core", [])})
        return {"status": "infeasible", "stage": error.stage, "message": error.message, "diagnosis": error.diagnosis}
    with new_session() as session:
        pv = save_plan(session, ds, plan, spec, stats, base_plan, base_plan_id, kind, label, origin, user_id, status)
        diff = diff_plans(ds.with_supplementary(spec.supplementary), base_plan, plan, base_kpis, pv.kpis_json) if base_plan else None
        payload = result_payload(pv, diff)
    audit.log(user_id, role, "solver.run", f"plan:{payload['plan_id']}", {"ops": [op.describe() for op in ops], "stage_seconds": stats.get("stage_seconds"), "relaxed": plan.relaxed, "hard_violations": payload["hard_count"], "seconds": round(time.time() - started, 1)})
    return payload
