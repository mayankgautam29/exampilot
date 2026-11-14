from __future__ import annotations

import hashlib
import math
import random
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass

import numpy as np

from .data import Dataset, Room
from .plan import Plan
from .rules import Rules

SeatStudent = tuple[str, str, str, bool]


@dataclass
class SeatResult:
    seats: dict[str, tuple[int, int]]
    penalty: float
    baseline: float
    adjacent_pairs: int

    @property
    def risk(self) -> float:
        return 100.0 * self.penalty / self.baseline if self.baseline > 0 else 0.0


def effective_coords(room: Room, seats: list[tuple[int, int]]) -> np.ndarray:
    return np.array([(r, c + room.aisle_shift(c)) for r, c in seats], dtype=float)


def weight_matrix(room: Room, seats: list[tuple[int, int]], rules: Rules) -> np.ndarray:
    coords = effective_coords(room, seats)
    dr = np.abs(coords[:, None, 0] - coords[None, :, 0])
    dc = np.abs(coords[:, None, 1] - coords[None, :, 1])
    distance = np.maximum(dr, dc)
    base = np.zeros_like(distance)
    base[distance == 1] = rules.seat_penalty_distance_1
    base[distance == 2] = rules.seat_penalty_distance_2
    base[distance == 3] = rules.seat_penalty_distance_3
    direction = np.ones_like(distance)
    direction[(dr == 0) & (distance > 0)] = rules.side_multiplier
    direction[(dc == 0) & (distance > 0)] = rules.front_back_multiplier
    return base * direction


def pair_matrix(students: list[SeatStudent], rules: Rules) -> np.ndarray:
    courses = np.array([s[1] for s in students])
    sections = np.array([s[2] for s in students])
    same_course = courses[:, None] == courses[None, :]
    same_section = sections[:, None] == sections[None, :]
    matrix = same_course * np.where(same_section, rules.same_section_multiplier, 1.0)
    np.fill_diagonal(matrix, 0.0)
    return matrix


def farthest_points(coords: np.ndarray, count: int, chosen: list[int]) -> list[int]:
    chosen = list(chosen)
    if not chosen and count > 0:
        chosen.append(int(np.lexsort((coords[:, 1], coords[:, 0]))[0]))
    nearest = np.full(len(coords), np.inf)
    for index in chosen:
        nearest = np.minimum(nearest, np.max(np.abs(coords - coords[index]), axis=1) + 0.01 * np.linalg.norm(coords - coords[index], axis=1))
    while len(chosen) < count:
        candidate = int(np.argmax(np.where(np.isin(np.arange(len(coords)), chosen), -1.0, nearest)))
        chosen.append(candidate)
        step = np.max(np.abs(coords - coords[candidate]), axis=1) + 0.01 * np.linalg.norm(coords - coords[candidate], axis=1)
        nearest = np.minimum(nearest, step)
    return chosen


def interleave(students: list[SeatStudent]) -> list[int]:
    by_course: dict[str, list[int]] = {}
    for index, student in enumerate(students):
        by_course.setdefault(student[1], []).append(index)
    queues = sorted(by_course.values(), key=len, reverse=True)
    order: list[int] = []
    while any(queues):
        for queue in queues:
            if queue:
                order.append(queue.pop(0))
    return order


def total_penalty(matrix: np.ndarray, weights: np.ndarray, seat_of: np.ndarray) -> float:
    return float((matrix * weights[np.ix_(seat_of, seat_of)]).sum() / 2)


def count_adjacent(room: Room, students: list[SeatStudent], seats: dict[str, tuple[int, int]]) -> int:
    by_course: dict[str, list[tuple[float, float]]] = {}
    for student_id, course_id, _, _ in students:
        r, c = seats[student_id]
        by_course.setdefault(course_id, []).append((r, c + room.aisle_shift(c)))
    pairs = 0
    for points in by_course.values():
        for i in range(len(points)):
            for j in range(i + 1, len(points)):
                if max(abs(points[i][0] - points[j][0]), abs(points[i][1] - points[j][1])) == 1:
                    pairs += 1
    return pairs


def seat_room(room: Room, students: list[SeatStudent], rules: Rules, seed: int, iterations: int) -> SeatResult:
    free = room.free_seats()
    if len(students) > len(free):
        raise ValueError(f"Room {room.id} has {len(free)} seats for {len(students)} students")
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)
    weights = weight_matrix(room, free, rules)
    coords = effective_coords(room, free)
    matrix = pair_matrix(students, rules)
    n = len(students)
    aisle_flags = np.array([room.is_aisle_seat(c) for _, c in free])
    needs_access = [i for i, s in enumerate(students) if s[3]]
    reserved: list[int] = []
    if needs_access:
        pool = [i for i in range(len(free)) if aisle_flags[i]]
        if len(pool) < len(needs_access):
            raise ValueError(f"Room {room.id} lacks aisle seats for accessible students")
        picked = farthest_points(coords[pool], len(needs_access), [])
        reserved = [pool[i] for i in picked]
    chosen = farthest_points(coords, n, reserved)
    seat_of = np.zeros(n, dtype=int)
    occupant = np.full(len(free), -1, dtype=int)
    for student_index, seat_index in zip(needs_access, reserved):
        seat_of[student_index] = seat_index
        occupant[seat_index] = student_index
    placed = list(needs_access)
    open_seats = np.zeros(len(free), dtype=bool)
    open_seats[[i for i in chosen if i not in reserved]] = True
    rank = {seat: position for position, seat in enumerate(chosen)}
    for student_index in [i for i in interleave(students) if i not in needs_access]:
        if placed:
            cost = weights[:, seat_of[placed]] @ matrix[student_index, placed]
        else:
            cost = np.zeros(len(free))
        candidates = np.flatnonzero(open_seats)
        best = min(candidates, key=lambda seat: (cost[seat], rank[seat]))
        seat_of[student_index] = best
        occupant[best] = student_index
        open_seats[best] = False
        placed.append(student_index)
    pinned = np.array([s[3] for s in students])
    penalty = total_penalty(matrix, weights, seat_of)
    temperature = 30.0
    cooling = (0.05 / temperature) ** (1.0 / max(1, iterations))
    seat_count = len(free)
    hot: list[int] = []
    for step in range(iterations):
        if penalty <= 0:
            break
        temperature *= cooling
        if step % 200 == 0:
            per_student = (matrix * weights[np.ix_(seat_of, seat_of)]).sum(axis=1)
            hot = [int(i) for i in np.flatnonzero(per_student > 0)]
        a = rng.choice(hot) if hot and rng.random() < 0.7 else rng.randrange(n)
        target = rng.randrange(seat_count)
        i = seat_of[a]
        if target == i:
            continue
        b = occupant[target]
        if b == -1:
            if pinned[a] and not aisle_flags[target]:
                continue
            delta = float(matrix[a] @ weights[target, seat_of] - matrix[a] @ weights[i, seat_of])
        else:
            if (pinned[a] and not aisle_flags[target]) or (pinned[b] and not aisle_flags[i]):
                continue
            j = target
            pair = matrix[a, b] * weights[i, j]
            delta = float(
                matrix[a] @ weights[j, seat_of] + matrix[b] @ weights[i, seat_of]
                - matrix[a] @ weights[i, seat_of] - matrix[b] @ weights[j, seat_of]
                + 2 * pair
            )
        if delta <= 0 or rng.random() < math.exp(-delta / temperature):
            if b == -1:
                occupant[i] = -1
                occupant[target] = a
                seat_of[a] = target
            else:
                seat_of[a], seat_of[b] = target, i
                occupant[target], occupant[i] = a, b
            penalty += delta
    penalty = total_penalty(matrix, weights, seat_of)
    random_total = 0.0
    for _ in range(30):
        draw = np_rng.choice(len(free), size=n, replace=False)
        random_total += total_penalty(matrix, weights, draw)
    seats = {students[i][0]: free[seat_of[i]] for i in range(n)}
    return SeatResult(seats, penalty, random_total / 30, count_adjacent(room, students, seats))


def random_seats(room: Room, students: list[SeatStudent], seed: int) -> dict[str, tuple[int, int]]:
    free = room.free_seats()
    rng = np.random.default_rng(seed)
    picks = rng.choice(len(free), size=len(students), replace=False)
    return {students[i][0]: free[picks[i]] for i in range(len(students))}


def content_hash(room: Room, students: list[SeatStudent], seed: int) -> str:
    payload = f"{room.id}|{room.rows}x{room.cols}|{sorted(room.blocked_seats)}|{seed}|" + "|".join(f"{s[0]}:{s[1]}:{s[2]}:{int(s[3])}" for s in sorted(students))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def stable_seed(base: int, key: str) -> int:
    return base + int(hashlib.sha256(key.encode()).hexdigest()[:6], 16)


def _run_job(job: tuple) -> SeatResult:
    room, students, rules, seed, iterations = job
    return seat_room(room, students, rules, seed, iterations)


def seat_plan(ds: Dataset, plan: Plan, rules: Rules, baseline: Plan | None, base_seed: int, reroll: int, iterations: int, workers: int) -> tuple[list[dict], list[dict]]:
    previous_stats = {(s["slot_id"], s["room_id"]): s for s in (baseline.seat_stats if baseline else [])}
    previous_seats: dict[tuple[str, str], list[dict]] = {}
    for seat in (baseline.seats if baseline else []):
        previous_seats.setdefault((seat["slot_id"], seat["room_id"]), []).append(seat)
    course_of = {(a["slot_id"], a["room_id"], sid): a["course_id"] for a in plan.allocations for sid in a["students"]}
    jobs: list[tuple] = []
    meta: list[tuple[str, str, str]] = []
    seats_out: list[dict] = []
    stats_out: list[dict] = []
    for (slot_id, room_id), student_ids in sorted(plan.room_students().items()):
        room = ds.rooms[room_id]
        students: list[SeatStudent] = [(sid, course_of[(slot_id, room_id, sid)], ds.students[sid].section, ds.students[sid].needs_accessible) for sid in sorted(student_ids)]
        seed = stable_seed(base_seed + reroll * 1000, f"{slot_id}{room_id}")
        digest = content_hash(room, students, seed if reroll else base_seed)
        cached = previous_stats.get((slot_id, room_id))
        if cached and cached.get("hash") == digest and (slot_id, room_id) in previous_seats:
            seats_out.extend(previous_seats[(slot_id, room_id)])
            stats_out.append(cached)
            continue
        jobs.append((room, students, rules, seed, iterations))
        meta.append((slot_id, room_id, digest))
    results: list[SeatResult] = []
    if jobs:
        if workers > 1 and len(jobs) > 2:
            try:
                with ProcessPoolExecutor(max_workers=workers) as pool:
                    results = list(pool.map(_run_job, jobs, chunksize=2))
            except Exception:
                results = [_run_job(job) for job in jobs]
        else:
            results = [_run_job(job) for job in jobs]
    for (slot_id, room_id, digest), job, result in zip(meta, jobs, results):
        course_by_student = {s[0]: s[1] for s in job[1]}
        for student_id, (row, col) in result.seats.items():
            seats_out.append({"slot_id": slot_id, "room_id": room_id, "student_id": student_id, "course_id": course_by_student[student_id], "row": row, "col": col})
        stats_out.append({"slot_id": slot_id, "room_id": room_id, "n": len(job[1]), "penalty": round(result.penalty, 2), "baseline": round(result.baseline, 2), "risk": round(result.risk, 2), "adjacent_pairs": result.adjacent_pairs, "hash": digest})
    return seats_out, stats_out
