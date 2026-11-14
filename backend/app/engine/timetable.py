from __future__ import annotations

import queue
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from .data import Dataset
from .ops import Spec
from .rules import Rules, Weights


@dataclass
class Group:
    id: str
    text: str
    rule_id: str
    literal: cp_model.IntVar | None = None


@dataclass
class TimetableResult:
    status: str
    exams: dict[str, str] = field(default_factory=dict)
    relaxed: bool = False
    objective: float = 0.0
    bound: float = 0.0
    wall_time: float = 0.0
    solutions: int = 0
    groups: list[Group] = field(default_factory=list)


class ProgressCallback(cp_model.CpSolverSolutionCallback):
    def __init__(self, events: queue.Queue | None):
        super().__init__()
        self.events = events
        self.count = 0

    def on_solution_callback(self) -> None:
        self.count += 1
        if self.events is not None:
            self.events.put({"t": round(self.WallTime(), 2), "objective": self.ObjectiveValue(), "bound": self.BestObjectiveBound(), "solutions": self.count})


def slot_capacity(ds: Dataset, spec: Spec, rules: Rules, slot_id: str, with_blocks: bool) -> int:
    total = 0
    for room in ds.rooms.values():
        if with_blocks and spec.is_room_blocked(room.id, slot_id):
            continue
        total += room.usable(rules.max_fill)
    return total


@dataclass
class Built:
    model: cp_model.CpModel
    x: dict[tuple[str, str], cp_model.IntVar]
    groups: list[Group]


def build_model(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, baseline: dict[str, str] | None, hard_day: bool) -> Built:
    model = cp_model.CpModel()
    slot_ids = ds.usable_slot_ids
    course_ids = list(ds.courses)
    x = {(c, s): model.NewBoolVar(f"x_{c}_{s}") for c in course_ids for s in slot_ids}
    groups: list[Group] = []

    def new_group(group_id: str, text: str, rule_id: str) -> cp_model.IntVar:
        literal = model.NewBoolVar(f"g_{group_id}")
        groups.append(Group(group_id, text, rule_id, literal))
        return literal

    for c in course_ids:
        model.AddExactlyOne(x[c, s] for s in slot_ids)

    for course_id, slot_id in spec.pins.items():
        if course_id not in ds.courses:
            continue
        literal = new_group(f"pin:{course_id}", f"{course_id} is pinned to {slot_id}", "R-2.2")
        if (course_id, slot_id) in x:
            model.Add(x[course_id, slot_id] == 1).OnlyEnforceIf(literal)
        else:
            model.Add(literal == 0)

    for course_id, forbidden in spec.forbids.items():
        if course_id not in ds.courses:
            continue
        literal = new_group(f"forbid:{course_id}", f"{course_id} is forbidden in {', '.join(forbidden)}", "R-2.2")
        for slot_id in forbidden:
            if (course_id, slot_id) in x:
                model.Add(x[course_id, slot_id] == 0).OnlyEnforceIf(literal)

    for date in spec.blocked_dates:
        literal = new_group(f"blockdate:{date}", f"{date} is blocked for exams", "R-1.2")
        for slot_id in ds.slots_on(date):
            for c in course_ids:
                model.Add(x[c, slot_id] == 0).OnlyEnforceIf(literal)

    capacity_literal = new_group("capacity", "Room capacity per session (85% fill)", "R-3.1")
    for s in slot_ids:
        load = sum(ds.size(c) * x[c, s] for c in course_ids)
        model.Add(load <= slot_capacity(ds, spec, rules, s, False)).OnlyEnforceIf(capacity_literal)
    blocks_by_slot: dict[str, list[str]] = {}
    for room_id, slot_id in spec.blocked_rooms:
        blocks_by_slot.setdefault(slot_id, []).append(room_id)
    for slot_id, room_ids in blocks_by_slot.items():
        if slot_id not in slot_ids:
            continue
        literal = new_group(f"blockroom:{slot_id}", f"Rooms {', '.join(room_ids)} unavailable in {slot_id}", "R-3.1")
        load = sum(ds.size(c) * x[c, slot_id] for c in course_ids)
        model.Add(load <= slot_capacity(ds, spec, rules, slot_id, True)).OnlyEnforceIf(literal)

    dates = sorted(ds.day_index, key=lambda d: ds.day_index[d])
    day_slots = {date: ds.slots_on(date) for date in dates}

    def on_day(c: str, date: str):
        return sum(x[c, s] for s in day_slots[date])

    for (a, b) in ds.shared:
        for s in slot_ids:
            model.Add(x[a, s] + x[b, s] <= 1)

    if hard_day:
        day_literal = new_group("rule:max_exams_per_day", "A student may sit at most one exam per day", "R-2.1")
        for (a, b) in ds.shared:
            for date in dates:
                model.Add(on_day(a, date) + on_day(b, date) <= 1).OnlyEnforceIf(day_literal)

    objective = []
    day_value = {c: sum(ds.day_index[d] * on_day(c, d) for d in dates) for c in course_ids}
    for (a, b), count in ds.shared.items():
        gap = model.NewIntVar(0, len(dates), f"gap_{a}_{b}")
        model.AddAbsEquality(gap, day_value[a] - day_value[b])
        near = model.NewBoolVar(f"near_{a}_{b}")
        model.Add(gap >= rules.min_free_days_preferred + 1).OnlyEnforceIf(near.Not())
        objective.append(int(weights.consecutive_days * count) * near)
        if not hard_day:
            same = model.NewBoolVar(f"same_{a}_{b}")
            model.Add(gap >= 1).OnlyEnforceIf(same.Not())
            objective.append(int(weights.relaxed_same_day * count) * same)

    for c in course_ids:
        size = ds.size(c)
        factor = ds.courses[c].difficulty - 1 + (1 if size >= 80 else 0)
        if factor:
            for index, s in enumerate(slot_ids):
                objective.append(int(weights.hard_early * factor * max(1, size // 10) * index) * x[c, s])

    total_students = sum(ds.size(c) for c in course_ids)
    max_load = model.NewIntVar(0, total_students, "max_load")
    min_load = model.NewIntVar(0, total_students, "min_load")
    max_count = model.NewIntVar(0, len(course_ids), "max_count")
    min_count = model.NewIntVar(0, len(course_ids), "min_count")
    for s in slot_ids:
        model.Add(max_load >= sum(ds.size(c) * x[c, s] for c in course_ids))
        model.Add(min_load <= sum(ds.size(c) * x[c, s] for c in course_ids))
        model.Add(max_count >= sum(x[c, s] for c in course_ids))
        model.Add(min_count <= sum(x[c, s] for c in course_ids))
    objective.append(int(weights.balance) * (max_load - min_load))
    objective.append(int(weights.balance_count) * (max_count - min_count))

    if baseline:
        for c in course_ids:
            base_slot = baseline.get(c)
            if base_slot in slot_ids:
                moved = 1 - x[c, base_slot]
                objective.append(int(weights.stability * ds.size(c)) * moved)
                model.AddHint(x[c, base_slot], 1)
    model.Minimize(sum(objective))
    return Built(model, x, groups)


def run_solver(model: cp_model.CpModel, workers: int, time_limit: float, seed: int, events: queue.Queue | None, with_callback: bool = True):
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = workers
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.random_seed = seed
    callback = ProgressCallback(events)
    status = solver.Solve(model, callback) if with_callback else solver.Solve(model)
    return solver, status, callback


def solve_once(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, baseline: dict[str, str] | None, hard_day: bool, workers: int, time_limit: float, events: queue.Queue | None) -> TimetableResult:
    built = build_model(ds, spec, rules, weights, baseline, hard_day)
    for group in built.groups:
        built.model.Add(group.literal == 1)
    seed = spec.seed + spec.reroll.get("timetable", 0)
    solver, status, callback = run_solver(built.model, workers, time_limit, seed, events)
    result = TimetableResult(status=solver.StatusName(status), wall_time=solver.WallTime(), solutions=callback.count, groups=built.groups)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        result.objective = solver.ObjectiveValue()
        result.bound = solver.BestObjectiveBound()
        for (c, s), var in built.x.items():
            if solver.Value(var):
                result.exams[c] = s
    return result


def solve(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, baseline: dict[str, str] | None, workers: int, time_limit: float, events: queue.Queue | None = None) -> TimetableResult:
    if spec.reroll.get("timetable"):
        baseline = None
    hard_day = rules.max_exams_per_day == 1
    result = solve_once(ds, spec, rules, weights, baseline, hard_day, workers, time_limit, events)
    if result.status in ("OPTIMAL", "FEASIBLE"):
        return result
    if hard_day:
        relaxed = solve_once(ds, spec, rules, weights, baseline, False, workers, time_limit, events)
        if relaxed.status in ("OPTIMAL", "FEASIBLE"):
            relaxed.relaxed = True
            return relaxed
        return relaxed
    return result
