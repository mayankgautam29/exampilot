from __future__ import annotations

from ortools.sat.python import cp_model

from .data import Dataset
from .ops import Spec
from .plan import Plan
from .rules import Rules, Weights, demand_for


class InvigilationInfeasible(Exception):
    pass


def eligible_faculty(ds: Dataset, spec: Spec, plan: Plan, slot_id: str) -> list[str]:
    owned = {ds.courses[c].owner_faculty_id for c in plan.courses_in_slot(slot_id)}
    result = []
    for faculty in ds.faculty.values():
        if faculty.id in owned:
            continue
        if slot_id in spec.unavailable_slots(faculty.id, faculty.unavailable_slots):
            continue
        result.append(faculty.id)
    return result


def precheck(ds: Dataset, spec: Spec, rules: Rules, plan: Plan, slots: list[str]) -> None:
    for slot_id in slots:
        rooms = plan.slot_rooms().get(slot_id, {})
        needed = sum(demand_for(rules, n) for n in rooms.values()) + rules.relievers_per_slot
        available = len(eligible_faculty(ds, spec, plan, slot_id))
        if needed > available:
            raise InvigilationInfeasible(f"{slot_id} needs {needed} invigilators and relievers but only {available} faculty are eligible")


def assign_chiefs(ds: Dataset, duties: list[dict]) -> list[dict]:
    by_room: dict[tuple[str, str], list[dict]] = {}
    for duty in duties:
        if duty["room_id"]:
            by_room.setdefault((duty["slot_id"], duty["room_id"]), []).append(duty)
    for members in by_room.values():
        chief = max(members, key=lambda d: (ds.faculty[d["faculty_id"]].rank, -int(d["faculty_id"][1:])))
        for duty in members:
            duty["role"] = "chief" if duty is chief else "invigilator"
    return duties


def solve(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, plan: Plan, baseline: list[dict], only_slots: set[str] | None, workers: int, time_limit: float) -> list[dict]:
    slots = [s for s in ds.usable_slot_ids if only_slots is None or s in only_slots]
    precheck(ds, spec, rules, plan, slots)
    fixed = [d for d in baseline if only_slots is not None and d["slot_id"] not in only_slots]
    fixed_total: dict[str, int] = {}
    fixed_day: dict[tuple[str, int], int] = {}
    for duty in fixed:
        if duty["room_id"]:
            fixed_total[duty["faculty_id"]] = fixed_total.get(duty["faculty_id"], 0) + 1
            key = (duty["faculty_id"], ds.day_of(duty["slot_id"]))
            fixed_day[key] = fixed_day.get(key, 0) + 1
    baseline_pairs = {(d["faculty_id"], d["slot_id"], d["room_id"]) for d in baseline if d["slot_id"] in slots}
    baseline_relievers = {(d["faculty_id"], d["slot_id"]) for d in baseline if d["room_id"] is None and d["slot_id"] in slots}
    use_stability = bool(baseline) and not spec.reroll.get("invigilation")
    model = cp_model.CpModel()
    a: dict[tuple[str, str, str], cp_model.IntVar] = {}
    rel: dict[tuple[str, str], cp_model.IntVar] = {}
    objective = []
    room_depts: dict[tuple[str, str], set[str]] = {}
    for allocation in plan.allocations:
        room_depts.setdefault((allocation["slot_id"], allocation["room_id"]), set()).add(ds.courses[allocation["course_id"]].dept)
    duty_of: dict[tuple[str, str], list[cp_model.IntVar]] = {}
    for slot_id in slots:
        rooms = plan.slot_rooms().get(slot_id, {})
        eligible = eligible_faculty(ds, spec, plan, slot_id)
        for room_id, students in rooms.items():
            for f in eligible:
                a[f, slot_id, room_id] = model.NewBoolVar(f"a_{f}_{slot_id}_{room_id}")
                duty_of.setdefault((f, slot_id), []).append(a[f, slot_id, room_id])
                if ds.faculty[f].dept in room_depts.get((slot_id, room_id), set()):
                    objective.append(int(weights.invig_own_dept) * a[f, slot_id, room_id])
                if use_stability and (f, slot_id, room_id) not in baseline_pairs:
                    objective.append(int(weights.invig_stability) * a[f, slot_id, room_id])
            model.Add(sum(a[f, slot_id, room_id] for f in eligible) == demand_for(rules, students))
        for f in eligible:
            rel[f, slot_id] = model.NewBoolVar(f"rel_{f}_{slot_id}")
            model.Add(sum(duty_of.get((f, slot_id), [])) + rel[f, slot_id] <= 1)
            if use_stability and (f, slot_id) not in baseline_relievers:
                objective.append(int(weights.invig_stability) * rel[f, slot_id])
        model.Add(sum(rel[f, slot_id] for f in eligible) == rules.relievers_per_slot)
    totals = {}
    for f, faculty in ds.faculty.items():
        limit = min(faculty.max_duties, rules.max_duties)
        variables = [v for (ff, _, _), v in a.items() if ff == f]
        total = model.NewIntVar(0, limit, f"total_{f}")
        model.Add(total == sum(variables) + fixed_total.get(f, 0))
        totals[f] = total
        by_day: dict[int, list[cp_model.IntVar]] = {}
        for (ff, s, _), v in a.items():
            if ff == f:
                by_day.setdefault(ds.day_of(s), []).append(v)
        for day, day_vars in by_day.items():
            model.Add(sum(day_vars) + fixed_day.get((f, day), 0) <= rules.max_per_day)
        dates = {}
        for slot_id in slots:
            dates.setdefault(ds.slots[slot_id].date, []).append(slot_id)
        for date, date_slots in dates.items():
            if len(date_slots) == 2 and all((f, s) in duty_of for s in date_slots):
                both = model.NewBoolVar(f"b2b_{f}_{date}")
                model.Add(sum(sum(duty_of[f, s]) for s in date_slots) <= 1 + both)
                objective.append(int(weights.invig_back_to_back) * both)
    top = model.NewIntVar(0, rules.max_duties, "top")
    bottom = model.NewIntVar(0, rules.max_duties, "bottom")
    for f in ds.faculty:
        model.Add(top >= totals[f])
        model.Add(bottom <= totals[f])
    objective.append(int(weights.invig_spread) * (top - bottom))
    model.Minimize(sum(objective))
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = workers
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.random_seed = spec.seed + spec.reroll.get("invigilation", 0)
    status = solver.Solve(model)
    if status == cp_model.INFEASIBLE:
        raise InvigilationInfeasible("Invigilation cannot be staffed within the duty limits")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise InvigilationInfeasible("The invigilation solver ran out of time; raise SOLVER_TIME_LIMIT_S")
    duties = [dict(d) for d in fixed]
    for (f, s, r), var in a.items():
        if solver.Value(var):
            duties.append({"slot_id": s, "room_id": r, "faculty_id": f, "role": "invigilator"})
    for (f, s), var in rel.items():
        if solver.Value(var):
            duties.append({"slot_id": s, "room_id": None, "faculty_id": f, "role": "reliever"})
    return assign_chiefs(ds, duties)
