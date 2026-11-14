import math
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel

RULES_PATH = Path(__file__).resolve().parent.parent / "config" / "rules.yaml"

OVERRIDABLE_RULES = {
    "max_exams_per_day": int,
    "max_fill": float,
    "max_course_share": float,
    "students_per_invigilator": int,
    "max_duties": int,
    "max_per_day": int,
    "relievers_per_slot": int,
}


class Rules(BaseModel):
    exam_period_days: int
    holidays_in_period: int
    s1_start: str
    s1_end: str
    s2_start: str
    s2_end: str
    max_exams_per_day: int
    relaxed_max_exams_per_day: int
    min_free_days_preferred: int
    max_fill: float
    max_course_share: float
    extra_time_pct: int
    students_per_invigilator: int
    large_room_threshold: int
    large_room_min_invigilators: int
    max_duties: int
    max_per_day: int
    relievers_per_slot: int
    same_section_multiplier: float
    side_multiplier: float
    front_back_multiplier: float
    seat_penalty_distance_1: int
    seat_penalty_distance_2: int
    seat_penalty_distance_3: int
    report_before_min: int
    late_entry_min: int


class Weights(BaseModel):
    consecutive_days: float
    hard_early: float
    balance: float
    balance_count: float
    stability: float
    relaxed_same_day: float
    venue_rooms: float
    venue_splits: float
    venue_dominance: float
    venue_mix: float
    venue_waste: float
    venue_stability: float
    invig_spread: float
    invig_own_dept: float
    invig_back_to_back: float
    invig_stability: float
    health_spread: float
    health_utilisation: float
    health_fairness: float
    health_seating: float
    health_stability: float


@lru_cache(maxsize=1)
def _raw() -> dict:
    return yaml.safe_load(RULES_PATH.read_text(encoding="utf-8"))


def load_rules(overrides: dict | None = None) -> Rules:
    values = dict(_raw()["parameters"])
    for key, value in (overrides or {}).items():
        if key in OVERRIDABLE_RULES:
            values[key] = OVERRIDABLE_RULES[key](value)
    return Rules(**values)


def load_weights(overrides: dict | None = None) -> Weights:
    values = dict(_raw()["weights"])
    for key, value in (overrides or {}).items():
        if key in values:
            values[key] = float(value)
    return Weights(**values)


def demand_for(rules: Rules, students: int) -> int:
    needed = max(1, math.ceil(students / rules.students_per_invigilator))
    if students >= rules.large_room_threshold:
        needed = max(needed, rules.large_room_min_invigilators)
    return needed
