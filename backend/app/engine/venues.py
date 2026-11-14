from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from ortools.sat.python import cp_model

from .data import Dataset
from .ops import Spec
from .rules import Rules, Weights


class VenueInfeasible(Exception):
    pass


@dataclass
class Cohort:
    course_id: str
    group: str
    students: list[str]


def build_cohorts(ds: Dataset, course_ids: list[str]) -> list[Cohort]:
    cohorts: list[Cohort] = []
    for course_id in course_ids:
        groups: dict[str, list[str]] = {"general": [], "ACC": [], "XT": []}
        for student_id in ds.course_students[course_id]:
            student = ds.students[student_id]
            if student.needs_accessible:
                groups["ACC"].append(student_id)
            elif student.extra_time_pct > 0:
                groups["XT"].append(student_id)
            else:
                groups["general"].append(student_id)
        for group, students in groups.items():
            if students:
                cohorts.append(Cohort(course_id, group, students))
    return cohorts


def allowed_rooms(ds: Dataset, spec: Spec, slot_id: str, group: str) -> list[str]:
    rooms = []
    for room in ds.rooms.values():
        if spec.is_room_blocked(room.id, slot_id):
            continue
        if group == "ACC" and not room.accessible:
            continue
        if group == "XT" and not room.quiet:
            continue
        if group == "general" and room.quiet:
            continue
        rooms.append(room.id)
    return rooms


def proportional_hint(ds: Dataset, spec: Spec, rules: Rules, slot_id: str, cohorts: list[Cohort]) -> dict[tuple[int, str], int]:
    hint: dict[tuple[int, str], int] = {}
    general_total = sum(len(c.students) for c in cohorts if c.group == "general")
    general_rooms = sorted(allowed_rooms(ds, spec, slot_id, "general"), key=lambda r: -ds.rooms[r].seat_count)
    chosen: list[str] = []
    seats = 0
    for room_id in general_rooms:
        if seats * 0.4 >= general_total:
            break
        chosen.append(room_id)
        seats += ds.rooms[room_id].seat_count
    for k, cohort in enumerate(cohorts):
        options = chosen if cohort.group == "general" else allowed_rooms(ds, spec, slot_id, cohort.group)
        if not options:
            continue
        weights = [ds.rooms[r].seat_count for r in options]
        remaining = len(cohort.students)
        shares = [remaining * w / sum(weights) for w in weights]
        counts = [int(share) for share in shares]
        order = sorted(range(len(options)), key=lambda i: shares[i] - counts[i], reverse=True)
        for i in order[: remaining - sum(counts)]:
            counts[i] += 1
        for room_id, count in zip(options, counts):
            hint[k, room_id] = min(count, ds.rooms[room_id].usable(rules.max_fill))
    return hint


def allocate_slot(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, slot_id: str, course_ids: list[str], baseline_rooms: dict[tuple[str, str], set[str]], time_limit: float) -> list[dict]:
    cohorts = build_cohorts(ds, course_ids)
    if not cohorts:
        return []
    model = cp_model.CpModel()
    room_ids = [room.id for room in ds.rooms.values() if not spec.is_room_blocked(room.id, slot_id)]
    capacity = {r: ds.rooms[r].usable(rules.max_fill) for r in room_ids}
    seats = {r: ds.rooms[r].seat_count for r in room_ids}
    n: dict[tuple[int, str], cp_model.IntVar] = {}
    present: dict[tuple[int, str], cp_model.IntVar] = {}
    objective = []
    for k, cohort in enumerate(cohorts):
        options = allowed_rooms(ds, spec, slot_id, cohort.group)
        if not options:
            raise VenueInfeasible(f"No {cohort.group} room available in {slot_id} for {cohort.course_id}")
        size = len(cohort.students)
        for r in options:
            n[k, r] = model.NewIntVar(0, min(size, capacity[r]), f"n_{k}_{r}")
            present[k, r] = model.NewBoolVar(f"z_{k}_{r}")
            model.Add(n[k, r] >= 1).OnlyEnforceIf(present[k, r])
            model.Add(n[k, r] == 0).OnlyEnforceIf(present[k, r].Not())
        model.Add(sum(n[k, r] for r in options) == size)
        objective.append(int(weights.venue_splits) * (sum(present[k, r] for r in options) - 1))
        base = baseline_rooms.get((cohort.course_id, cohort.group))
        if base:
            for r in options:
                if r not in base:
                    objective.append(int(weights.venue_stability) * n[k, r])
    used = {r: model.NewBoolVar(f"used_{r}") for r in room_ids}
    for r in room_ids:
        load = sum(n[k, r] for k in range(len(cohorts)) if (k, r) in n)
        model.Add(load <= capacity[r] * used[r])
        accessible_load = [n[k, r] for k, cohort in enumerate(cohorts) if cohort.group == "ACC" and (k, r) in n]
        if accessible_load:
            aisle_seats = sum(1 for _, c in ds.rooms[r].free_seats() if ds.rooms[r].is_aisle_seat(c))
            model.Add(sum(accessible_load) <= aisle_seats)
        objective.append(int(weights.venue_rooms) * used[r])
        objective.append(int(weights.venue_waste * seats[r]) * used[r])
        share_limit = int(rules.max_course_share * seats[r])
        density = max(1, round(weights.venue_mix * 100 / seats[r]))
        for k in range(len(cohorts)):
            if (k, r) not in n:
                continue
            over = model.NewIntVar(0, capacity[r], f"over_{k}_{r}")
            model.Add(over >= n[k, r] - share_limit)
            objective.append(int(weights.venue_dominance) * over)
            square = model.NewIntVar(0, capacity[r] * capacity[r], f"sq_{k}_{r}")
            model.AddMultiplicationEquality(square, [n[k, r], n[k, r]])
            objective.append(density * square)
    for key, value in proportional_hint(ds, spec, rules, slot_id, cohorts).items():
        if key in n:
            model.AddHint(n[key], value)
            model.AddHint(present[key], 1 if value else 0)
    model.Minimize(sum(objective))
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.random_seed = spec.seed
    solver.parameters.relative_gap_limit = 0.01
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise VenueInfeasible(f"Cannot seat all students of {slot_id} within room capacity")
    allocations: list[dict] = []
    for k, cohort in enumerate(cohorts):
        cursor = 0
        for r in sorted(room_ids):
            if (k, r) not in n:
                continue
            count = solver.Value(n[k, r])
            if count:
                allocations.append({"slot_id": slot_id, "room_id": r, "course_id": cohort.course_id, "group": cohort.group, "students": cohort.students[cursor:cursor + count]})
                cursor += count
    return allocations


def can_reuse(ds: Dataset, spec: Spec, rules: Rules, slot_id: str, course_ids: list[str], base_allocations: list[dict]) -> bool:
    if not base_allocations or spec.reroll:
        return False
    if {a["course_id"] for a in base_allocations} != set(course_ids):
        return False
    for course_id in course_ids:
        if sum(len(a["students"]) for a in base_allocations if a["course_id"] == course_id) != ds.size(course_id):
            return False
    loads: dict[str, int] = {}
    for allocation in base_allocations:
        if spec.is_room_blocked(allocation["room_id"], slot_id):
            return False
        loads[allocation["room_id"]] = loads.get(allocation["room_id"], 0) + len(allocation["students"])
    return all(load <= ds.rooms[room_id].usable(rules.max_fill) for room_id, load in loads.items())


def allocate_all(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, exams: dict[str, str], baseline_allocations: list[dict], only_slots: set[str] | None, workers: int, time_limit: float) -> list[dict]:
    baseline_rooms: dict[tuple[str, str], set[str]] = {}
    for allocation in baseline_allocations:
        baseline_rooms.setdefault((allocation["course_id"], allocation["group"]), set()).add(allocation["room_id"])
    target_slots = []
    kept: dict[str, list[dict]] = {}
    for slot_id in ds.usable_slot_ids:
        if only_slots is not None and slot_id not in only_slots:
            continue
        course_ids = sorted(c for c, s in exams.items() if s == slot_id)
        base_allocations = [a for a in baseline_allocations if a["slot_id"] == slot_id]
        if can_reuse(ds, spec, rules, slot_id, course_ids, base_allocations):
            kept[slot_id] = base_allocations
        else:
            target_slots.append(slot_id)

    def work(slot_id: str) -> list[dict]:
        course_ids = sorted(c for c, s in exams.items() if s == slot_id)
        return allocate_slot(ds, spec, rules, weights, slot_id, course_ids, baseline_rooms, time_limit)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        solved = dict(zip(target_slots, pool.map(work, target_slots)))
    solved.update(kept)
    result: list[dict] = []
    for slot_id in ds.usable_slot_ids:
        if slot_id in solved:
            result.extend(solved[slot_id])
        else:
            result.extend(a for a in baseline_allocations if a["slot_id"] == slot_id)
    return result
