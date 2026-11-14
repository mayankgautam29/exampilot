from __future__ import annotations

from .data import Dataset
from .plan import Plan


def student_view(plan: Plan) -> dict[tuple[str, str], tuple[str, str, int, int]]:
    return {(s["student_id"], s["course_id"]): (s["slot_id"], s["room_id"], s["row"], s["col"]) for s in plan.seats}


def duty_keys(plan: Plan) -> set[tuple[str, str, str | None]]:
    return {(d["slot_id"], d["faculty_id"], d["room_id"]) for d in plan.duties}


def diff_plans(ds: Dataset, old: Plan, new: Plan, kpis_old: dict | None = None, kpis_new: dict | None = None) -> dict:
    moved = []
    for course_id, slot_id in new.exams.items():
        before = old.exams.get(course_id)
        if before != slot_id:
            moved.append({"course_id": course_id, "from": before, "to": slot_id, "students": ds.size(course_id) if course_id in ds.courses else 0})
    before_view, after_view = student_view(old), student_view(new)
    affected: set[str] = set()
    rooms_changed = 0
    seats_changed = 0
    for key, view in after_view.items():
        previous = before_view.get(key)
        if previous is None or previous[0] != view[0]:
            affected.add(key[0])
        elif previous[1] != view[1]:
            affected.add(key[0])
            rooms_changed += 1
        elif previous[2:] != view[2:]:
            seats_changed += 1
    duties_before, duties_after = duty_keys(old), duty_keys(new)
    changed_duties = duties_before ^ duties_after
    invigilators = sorted({duty[1] for duty in changed_duties})
    replacements = []
    removed = list(duties_before - duties_after)
    added = [d for d in duties_after - duties_before]
    for slot_id, faculty_id, room_id in sorted(removed, key=lambda d: (d[0], str(d[2]), d[1])):
        match = next((a for a in added if a[0] == slot_id and a[2] == room_id), None)
        if match:
            replacements.append({"slot_id": slot_id, "room_id": room_id, "from": faculty_id, "to": match[1]})
            added.remove(match)
    deltas = {}
    if kpis_old and kpis_new:
        for key, value in kpis_new.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool) and isinstance(kpis_old.get(key), (int, float)):
                deltas[key] = round(value - kpis_old[key], 2)
    sample = sorted(affected)[:8]
    return {
        "courses_moved": sorted(moved, key=lambda m: m["course_id"]),
        "rooms_changed": rooms_changed,
        "students_affected": {"count": len(affected), "sample": sample},
        "invigilators_changed": {"count": len(invigilators), "faculty": invigilators[:12], "replacements": replacements[:20]},
        "seats_changed": seats_changed,
        "kpi_deltas": deltas,
        "affected_student_ids": sorted(affected),
        "affected_faculty_ids": invigilators,
    }
