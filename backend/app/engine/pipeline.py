from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Callable

from . import diagnose as diagnosis
from . import invigilation, seating, timetable, venues
from .data import Dataset
from .ops import Spec
from .plan import Plan
from .rules import load_rules, load_weights


class PlanningError(Exception):
    def __init__(self, stage: str, message: str, diagnosis_info: dict | None = None):
        super().__init__(message)
        self.stage = stage
        self.message = message
        self.diagnosis = diagnosis_info or {}


@dataclass
class SolverConfig:
    workers: int = 8
    timetable_seconds: float = 20.0
    venue_seconds: float = 2.0
    invigilation_seconds: float = 10.0
    seat_iterations: int = 30000
    seat_workers: int = 4


class Emitter:
    def __init__(self, emit: Callable[[dict], None] | None):
        self.emit = emit

    def put(self, event: dict) -> None:
        self.send({"type": "progress", "stage": "timetable", **event})

    def send(self, event: dict) -> None:
        if self.emit:
            self.emit(event)


def run_pipeline(ds: Dataset, spec: Spec, baseline: Plan | None, config: SolverConfig, only_slots: set[str] | None = None, emit: Callable[[dict], None] | None = None) -> tuple[Plan, dict]:
    started = time.time()
    events = Emitter(emit)
    ds = ds.with_supplementary(spec.supplementary)
    rules = load_rules(spec.rules)
    weights = load_weights(spec.weights)
    seconds: dict[str, float] = {}
    stats: dict = {"workers": config.workers}
    plan = Plan()

    events.send({"type": "stage", "stage": "timetable", "status": "running"})
    t = time.time()
    if only_slots is not None and baseline is not None:
        plan.exams = dict(baseline.exams)
        plan.relaxed = baseline.relaxed
    else:
        result = timetable.solve(ds, spec, rules, weights, baseline.exams if baseline else None, config.workers, config.timetable_seconds, events)
        if result.status not in ("OPTIMAL", "FEASIBLE"):
            events.send({"type": "stage", "stage": "timetable", "status": "infeasible"})
            info = diagnosis.diagnose(ds, spec, baseline, config.workers, hard_day=False)
            raise PlanningError("timetable", "The timetable constraints cannot all be satisfied", info)
        plan.exams = result.exams
        plan.relaxed = result.relaxed
        stats["timetable"] = {"status": result.status, "objective": result.objective, "bound": result.bound, "solutions": result.solutions, "relaxed": result.relaxed}
    seconds["timetable"] = round(time.time() - t, 2)
    events.send({"type": "stage", "stage": "timetable", "status": "done", "seconds": seconds["timetable"], "relaxed": plan.relaxed})

    events.send({"type": "stage", "stage": "venues", "status": "running"})
    t = time.time()
    try:
        plan.allocations = venues.allocate_all(ds, spec, rules, weights, plan.exams, baseline.allocations if baseline else [], only_slots, config.workers, config.venue_seconds)
    except venues.VenueInfeasible as error:
        raise PlanningError("venues", str(error))
    seconds["venues"] = round(time.time() - t, 2)
    events.send({"type": "stage", "stage": "venues", "status": "done", "seconds": seconds["venues"]})

    events.send({"type": "stage", "stage": "invigilation", "status": "running"})
    t = time.time()
    try:
        invigilation_limit = config.invigilation_seconds * max(1, math.ceil(len(ds.students) / 400))
        plan.duties = invigilation.solve(ds, spec, rules, weights, plan, baseline.duties if baseline else [], only_slots, config.workers, invigilation_limit)
    except invigilation.InvigilationInfeasible as error:
        raise PlanningError("invigilation", str(error))
    seconds["invigilation"] = round(time.time() - t, 2)
    events.send({"type": "stage", "stage": "invigilation", "status": "done", "seconds": seconds["invigilation"]})

    events.send({"type": "stage", "stage": "seating", "status": "running"})
    t = time.time()
    cache_baseline = None if spec.reroll.get("seating") else baseline
    try:
        plan.seats, plan.seat_stats = seating.seat_plan(ds, plan, rules, cache_baseline, spec.seed, spec.reroll.get("seating", 0), config.seat_iterations, config.seat_workers)
    except ValueError as error:
        raise PlanningError("seating", str(error))
    seconds["seating"] = round(time.time() - t, 2)
    events.send({"type": "stage", "stage": "seating", "status": "done", "seconds": seconds["seating"]})

    seconds["total"] = round(time.time() - started, 2)
    stats["stage_seconds"] = seconds
    return plan, stats
