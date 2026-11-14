from __future__ import annotations

from .data import Dataset
from .kpis import compute_kpis
from .ops import Spec
from .plan import Plan
from .rules import Weights, load_weights
from .validator import Violation


def moved_fraction(ds: Dataset, plan: Plan, baseline: Plan | None) -> float:
    if baseline is None:
        return 0.0
    moved = sum(ds.size(c) for c, slot in plan.exams.items() if c in baseline.exams and baseline.exams[c] != slot and c in ds.courses)
    total = sum(ds.size(c) for c in plan.exams if c in ds.courses)
    return moved / total if total else 0.0


def health_score(kpis: dict, weights: Weights, moved: float) -> dict:
    spread = 0.5 * min(1.0, kpis["mean_gap_days"] / 3.0) + 0.5 * kpis["pct_students_one_exam_per_day"] / 100.0
    util = kpis["seat_utilisation_pct"] / 100.0
    utilisation = 1.0 if 0.25 <= util <= 0.7 else max(0.0, 1.0 - min(abs(util - 0.25), abs(util - 0.7)) / 0.25)
    fairness = max(0.0, 1.0 - kpis["duty_gini"])
    seating = max(0.0, min(1.0, 1.0 - kpis["seating_risk_index"] / 100.0))
    stability = max(0.0, 1.0 - moved)
    components = {"spread": spread, "utilisation": utilisation, "fairness": fairness, "seating": seating, "stability": stability}
    blend = (
        weights.health_spread * spread + weights.health_utilisation * utilisation + weights.health_fairness * fairness
        + weights.health_seating * seating + weights.health_stability * stability
    ) / (weights.health_spread + weights.health_utilisation + weights.health_fairness + weights.health_seating + weights.health_stability)
    score = 0.0 if kpis["hard_violations"] else round(100.0 * blend, 1)
    return {"score": score, "components": {k: round(v * 100, 1) for k, v in components.items()}}


def plan_health(ds: Dataset, spec: Spec, plan: Plan, violations: list[Violation], baseline: Plan | None = None) -> dict:
    kpis = compute_kpis(ds, spec, plan, violations)
    return health_score(kpis, load_weights(spec.weights), moved_fraction(ds.with_supplementary(spec.supplementary), plan, baseline))
