from __future__ import annotations

from dataclasses import dataclass

from .data import Dataset
from .plan import Plan
from .rules import Rules
from .ops import BlockDate, BlockRoom, ChangeOp, FacultyUnavailable, Spec


@dataclass
class DisruptionPlan:
    ops: list[ChangeOp]
    only_slots: set[str] | None
    summary: str


def build_disruption(ds: Dataset, kind: str, payload: dict) -> DisruptionPlan:
    if kind == "invigilator_absent":
        faculty_id, slot_id = payload["faculty_id"], payload["slot_id"]
        return DisruptionPlan([FacultyUnavailable(faculty_id=faculty_id, slot_ids=[slot_id])], {slot_id}, f"{ds.faculty[faculty_id].name} is absent in {ds.slots[slot_id].label}")
    if kind == "room_unavailable":
        room_id, slot_id = payload["room_id"], payload["slot_id"]
        return DisruptionPlan([BlockRoom(room_id=room_id, slot_ids=[slot_id])], {slot_id}, f"Room {room_id} is unavailable in {ds.slots[slot_id].label}")
    if kind == "date_blocked":
        date = payload["date"]
        return DisruptionPlan([BlockDate(date=date)], None, f"{date} is blocked for exams")
    raise ValueError(f"Unknown disruption type '{kind}'")


def duty_totals(ds: Dataset, plan: Plan) -> dict[str, int]:
    totals = {f: 0 for f in ds.faculty}
    for duty in plan.duties:
        if duty["room_id"]:
            totals[duty["faculty_id"]] += 1
    return totals


def day_count(ds: Dataset, plan: Plan, faculty_id: str, slot_id: str) -> int:
    date = ds.slots[slot_id].date
    return sum(1 for d in plan.duties if d["faculty_id"] == faculty_id and d["room_id"] and ds.slots[d["slot_id"]].date == date)


def swap_with_reliever(ds: Dataset, spec: Spec, rules: Rules, plan: Plan, faculty_id: str, slot_id: str) -> tuple[Plan | None, dict | None]:
    mine = [d for d in plan.duties if d["faculty_id"] == faculty_id and d["slot_id"] == slot_id]
    if not mine:
        return None, None
    totals = duty_totals(ds, plan)
    busy = {d["faculty_id"] for d in plan.duties if d["slot_id"] == slot_id}
    owned = {ds.courses[c].owner_faculty_id for c in plan.courses_in_slot(slot_id)}
    relievers = [d["faculty_id"] for d in plan.duties if d["slot_id"] == slot_id and d["room_id"] is None and d["faculty_id"] != faculty_id]
    pool = [f for f in ds.faculty.values() if f.id not in busy and f.id not in owned and f.id != faculty_id and slot_id not in spec.unavailable_slots(f.id, f.unavailable_slots)]
    pool.sort(key=lambda f: (totals[f.id], -f.rank, f.id))
    new_plan = Plan.from_dict(plan.to_dict())
    target = mine[0]
    if target["room_id"] is None:
        if not pool:
            return None, None
        replacement = pool[0].id
        target_row = next(d for d in new_plan.duties if d["faculty_id"] == faculty_id and d["slot_id"] == slot_id)
        target_row["faculty_id"] = replacement
        return new_plan, {"slot_id": slot_id, "room_id": None, "from": faculty_id, "to": replacement}
    candidates = [r for r in sorted(relievers, key=lambda f: (totals[f], -ds.faculty[f].rank, f)) if totals[r] < min(ds.faculty[r].max_duties, rules.max_duties) and day_count(ds, plan, r, slot_id) < rules.max_per_day]
    if not candidates or not pool:
        return None, None
    replacement = candidates[0]
    new_reliever = pool[0].id
    for duty in new_plan.duties:
        if duty["slot_id"] == slot_id and duty["faculty_id"] == faculty_id:
            duty["faculty_id"] = replacement
            duty["role"] = target["role"]
        elif duty["slot_id"] == slot_id and duty["faculty_id"] == replacement and duty["room_id"] is None:
            duty["faculty_id"] = new_reliever
    return new_plan, {"slot_id": slot_id, "room_id": target["room_id"], "from": faculty_id, "to": replacement}
