from __future__ import annotations

import random
import time

from .data import Dataset
from .kpis import compute_kpis
from .ops import Spec
from .plan import Plan
from .rules import load_rules
from .seating import SeatStudent, pair_matrix, weight_matrix
from .validator import validate

import numpy as np


def random_timetable(ds: Dataset, seed: int) -> dict[str, str]:
    rng = random.Random(seed)
    slots = ds.usable_slot_ids
    return {c: rng.choice(slots) for c in ds.courses}


def greedy_timetable(ds: Dataset) -> dict[str, str]:
    exams: dict[str, str] = {}
    for course_id in sorted(ds.courses, key=lambda c: -ds.size(c)):
        for slot_id in ds.usable_slot_ids:
            if all(exams.get(other) != slot_id for other in ds.shared_by_course[course_id]):
                exams[course_id] = slot_id
                break
        else:
            exams[course_id] = ds.usable_slot_ids[0]
    return exams


def naive_rooms_and_seats(ds: Dataset, exams: dict[str, str], shuffle: bool, seed: int) -> Plan:
    rng = random.Random(seed)
    rules = load_rules()
    plan = Plan(exams=exams)
    room_order = sorted((r for r in ds.rooms.values() if not r.quiet), key=lambda r: -r.seat_count)
    for slot_id in ds.usable_slot_ids:
        students: list[tuple[str, str]] = []
        for course_id in sorted(c for c, s in exams.items() if s == slot_id):
            students.extend((sid, course_id) for sid in ds.course_students[course_id])
        if shuffle:
            rng.shuffle(students)
        cursor = 0
        for room in room_order:
            if cursor >= len(students):
                break
            chunk = students[cursor:cursor + room.seat_count]
            cursor += len(chunk)
            free = room.free_seats()
            for (sid, course_id), (row, col) in zip(chunk, free):
                plan.seats.append({"slot_id": slot_id, "room_id": room.id, "student_id": sid, "course_id": course_id, "row": row, "col": col})
            by_course: dict[str, list[str]] = {}
            for sid, course_id in chunk:
                by_course.setdefault(course_id, []).append(sid)
            for course_id, ids in by_course.items():
                plan.allocations.append({"slot_id": slot_id, "room_id": room.id, "course_id": course_id, "group": "general", "students": ids})
            members: list[SeatStudent] = [(sid, course_id, ds.students[sid].section, False) for sid, course_id in chunk]
            weights = weight_matrix(room, free[:len(chunk)], rules)
            matrix = pair_matrix(members, rules)
            penalty = float((matrix * weights).sum() / 2)
            base = random_penalty(room, members, rules, rng.randrange(10**6))
            adjacent = int(((weights >= rules.seat_penalty_distance_1) & (matrix > 0)).sum() // 2)
            plan.seat_stats.append({"slot_id": slot_id, "room_id": room.id, "n": len(chunk), "penalty": penalty, "baseline": base, "risk": 0, "adjacent_pairs": adjacent, "hash": ""})
    return plan


def random_penalty(room, members: list[SeatStudent], rules, seed: int) -> float:
    free = room.free_seats()
    weights = weight_matrix(room, free, rules)
    matrix = pair_matrix(members, rules)
    rng = np.random.default_rng(seed)
    total = 0.0
    for _ in range(10):
        draw = rng.choice(len(free), size=len(members), replace=False)
        total += float((matrix * weights[np.ix_(draw, draw)]).sum() / 2)
    return total / 10


def evaluate(ds: Dataset, name: str, exams: dict[str, str], shuffle: bool, started: float) -> dict:
    spec = Spec()
    plan = naive_rooms_and_seats(ds, exams, shuffle, 1)
    violations = validate(ds, spec, plan)
    kpis = compute_kpis(ds, spec, plan, [v for v in violations if v.code == "H-STU-SLOT-CLASH" or v.severity == "soft"])
    return {"name": name, "clashes": kpis["clashes"], "mean_gap_days": kpis["mean_gap_days"], "seating_risk_index": kpis["seating_risk_index"], "adjacent_pairs": kpis["adjacent_pairs"], "runtime_s": round(time.time() - started, 2)}


def run_benchmark(ds: Dataset, exampilot_kpis: dict, exampilot_seconds: float) -> list[dict]:
    started = time.time()
    random_row = evaluate(ds, "Random", random_timetable(ds, 7), True, started)
    started = time.time()
    greedy_row = evaluate(ds, "Greedy first-fit", greedy_timetable(ds), False, started)
    pilot = {"name": "ExamPilot", "clashes": exampilot_kpis["clashes"], "mean_gap_days": exampilot_kpis["mean_gap_days"], "seating_risk_index": exampilot_kpis["seating_risk_index"], "adjacent_pairs": exampilot_kpis["adjacent_pairs"], "runtime_s": exampilot_seconds}
    return [random_row, greedy_row, pilot]
