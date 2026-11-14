from __future__ import annotations

import numpy as np

from .data import Dataset
from .ops import Spec
from .plan import Plan
from .rules import load_rules
from .validator import Violation


def gini(values: list[float]) -> float:
    if not values or sum(values) == 0:
        return 0.0
    ordered = np.sort(np.array(values, dtype=float))
    n = len(ordered)
    index = np.arange(1, n + 1)
    return float((2 * (index * ordered).sum()) / (n * ordered.sum()) - (n + 1) / n)


def student_gaps(ds: Dataset, plan: Plan) -> tuple[float, float, float]:
    gaps: list[int] = []
    per_day_ok = 0
    counted = 0
    for course_ids in ds.enrollments.values():
        days = sorted(ds.day_of(plan.exams[c]) for c in course_ids if c in plan.exams and plan.exams[c] in ds.slots)
        if not days:
            continue
        counted += 1
        if len(days) == len(set(days)):
            per_day_ok += 1
        gaps.extend(b - a for a, b in zip(days, days[1:]))
    mean_gap = float(np.mean(gaps)) if gaps else 0.0
    min_gap = float(min(gaps)) if gaps else 0.0
    return mean_gap, min_gap, (100.0 * per_day_ok / counted if counted else 100.0)


def duty_counts(ds: Dataset, plan: Plan) -> list[int]:
    counts = {f: 0 for f in ds.faculty}
    for duty in plan.duties:
        if duty["room_id"]:
            counts[duty["faculty_id"]] += 1
    return list(counts.values())


def compute_kpis(ds: Dataset, spec: Spec, plan: Plan, violations: list[Violation], stats: dict | None = None) -> dict:
    ds = ds.with_supplementary(spec.supplementary)
    rules = load_rules(spec.rules)
    mean_gap, min_gap, pct_one_per_day = student_gaps(ds, plan)
    slot_rooms = plan.slot_rooms()
    rooms_per_slot = [len(r) for r in slot_rooms.values()] or [0]
    seats_used = sum(sum(rooms.values()) for rooms in slot_rooms.values())
    seats_open = sum(ds.rooms[room].seat_count for rooms in slot_rooms.values() for room in rooms)
    duties = duty_counts(ds, plan)
    penalty = sum(s["penalty"] for s in plan.seat_stats)
    baseline = sum(s["baseline"] for s in plan.seat_stats)
    risk = 100.0 * penalty / baseline if baseline > 0 else 0.0
    return {
        "clashes": sum(1 for v in violations if v.code == "H-STU-SLOT-CLASH"),
        "hard_violations": sum(1 for v in violations if v.severity == "hard"),
        "soft_violations": sum(1 for v in violations if v.severity == "soft"),
        "pct_students_one_exam_per_day": round(pct_one_per_day, 1),
        "mean_gap_days": round(mean_gap, 2),
        "min_gap_days": min_gap,
        "rooms_per_slot_mean": round(float(np.mean(rooms_per_slot)), 1),
        "rooms_total": sum(rooms_per_slot),
        "seat_utilisation_pct": round(100.0 * seats_used / seats_open, 1) if seats_open else 0.0,
        "duties_min": min(duties) if duties else 0,
        "duties_max": max(duties) if duties else 0,
        "duties_mean": round(float(np.mean(duties)), 2) if duties else 0.0,
        "duty_gini": round(gini(duties), 3),
        "seating_risk_index": round(risk, 1),
        "seating_risk_reduction_pct": round(100.0 - risk, 1) if baseline > 0 else 0.0,
        "adjacent_pairs": sum(s["adjacent_pairs"] for s in plan.seat_stats),
        "relaxed_rules": plan.relaxed,
        "students": len(ds.students),
        "courses": len(ds.courses),
        "max_exams_per_day_rule": rules.max_exams_per_day,
        "stage_seconds": (stats or {}).get("stage_seconds", {}),
    }
