from __future__ import annotations

from .data import Dataset
from .ops import Spec
from .plan import Plan
from .rules import Rules, Weights, load_rules, load_weights
from .timetable import slot_capacity


def course_cost(ds: Dataset, rules: Rules, weights: Weights, exams: dict[str, str], course_id: str, slot_id: str) -> float:
    cost = 0.0
    day = ds.day_of(slot_id)
    for other, shared in ds.shared_by_course[course_id].items():
        if other not in exams:
            continue
        gap = abs(ds.day_of(exams[other]) - day)
        if gap <= rules.min_free_days_preferred:
            cost += weights.consecutive_days * shared
        if gap == 0:
            cost += weights.relaxed_same_day * shared
    index = ds.usable_slot_ids.index(slot_id)
    factor = ds.courses[course_id].difficulty - 1 + (1 if ds.size(course_id) >= 80 else 0)
    cost += weights.hard_early * factor * max(1, ds.size(course_id) // 10) * index
    return cost


def slot_load(ds: Dataset, plan: Plan, slot_id: str, skip: str) -> int:
    return sum(ds.size(c) for c in plan.courses_in_slot(slot_id) if c != skip)


def check_slot(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, plan: Plan, course_id: str, slot_id: str) -> dict:
    slot = ds.slots[slot_id]
    current = plan.exams.get(course_id)
    delta = course_cost(ds, rules, weights, plan.exams, course_id, slot_id) - (course_cost(ds, rules, weights, plan.exams, course_id, current) if current else 0.0)
    result = {"slot_id": slot_id, "label": slot.label, "status": "green", "feasible": True, "reason": "No conflicts", "students_affected": ds.size(course_id), "est_cost_delta": round(delta, 1)}
    if slot.blocked or slot.date in spec.blocked_dates:
        return {**result, "status": "red", "feasible": False, "reason": "Date is a holiday or blocked", "students_affected": 0}
    if slot_id in spec.forbids.get(course_id, []):
        return {**result, "status": "red", "feasible": False, "reason": "Slot is forbidden for this course", "students_affected": 0}
    if slot_load(ds, plan, slot_id, course_id) + ds.size(course_id) > slot_capacity(ds, spec, rules, slot_id, True):
        return {**result, "status": "red", "feasible": False, "reason": "Not enough room capacity (85% fill rule)", "students_affected": 0}
    displaced: list[str] = []
    for other, shared in ds.shared_by_course[course_id].items():
        other_slot = plan.exams.get(other)
        if other_slot is None or other == course_id:
            continue
        same_slot = other_slot == slot_id
        same_day = ds.slots[other_slot].date == slot.date and rules.max_exams_per_day == 1
        if not (same_slot or same_day):
            continue
        reason = f"{other} shares {shared} students and is {'in the same session' if same_slot else 'on the same day'}"
        if spec.pins.get(other) == other_slot:
            return {**result, "status": "red", "feasible": False, "reason": reason + " and is pinned", "students_affected": 0}
        displaced.append(other)
        result["reason"] = reason
    if displaced:
        affected = {sid for c in displaced + [course_id] for sid in ds.course_students[c]}
        result.update(status="amber", students_affected=len(affected), reason=f"Needs moving {', '.join(displaced[:3])}: " + result["reason"])
    return result


def move_check(ds: Dataset, spec: Spec, plan: Plan, course_id: str) -> list[dict]:
    ds = ds.with_supplementary(spec.supplementary)
    rules, weights = load_rules(spec.rules), load_weights(spec.weights)
    return [check_slot(ds, spec, rules, weights, plan, course_id, slot_id) for slot_id in ds.usable_slot_ids]


def explain_slot(ds: Dataset, spec: Spec, plan: Plan, course_id: str) -> dict:
    ds = ds.with_supplementary(spec.supplementary)
    rules, weights = load_rules(spec.rules), load_weights(spec.weights)
    slot_id = plan.exams[course_id]
    course = ds.courses[course_id]
    facts = [f"{course_id} ({course.name}) is scheduled for {ds.slots[slot_id].label} with {ds.size(course_id)} students."]
    neighbours = sorted(ds.shared_by_course[course_id].items(), key=lambda item: -item[1])[:5]
    conflicts = [{"course_id": other, "shared": shared, "slot_id": plan.exams.get(other)} for other, shared in neighbours]
    for item in conflicts:
        slot_label = ds.slots[item["slot_id"]].label if item["slot_id"] else "unscheduled"
        facts.append(f"It shares {item['shared']} students with {item['course_id']}, which sits in {slot_label}, so those two cannot be in the same session or on the same day (R-2.1, R-2.2).")
    if course_id in spec.pins:
        facts.append(f"It is pinned to {ds.slots[spec.pins[course_id]].label} by an administrator.")
    if spec.forbids.get(course_id):
        facts.append("It is forbidden in: " + ", ".join(ds.slots[s].label for s in spec.forbids[course_id]) + ".")
    if spec.blocked_dates:
        facts.append("Blocked dates: " + ", ".join(spec.blocked_dates) + ".")
    options = [check_slot(ds, spec, rules, weights, plan, course_id, s) for s in ds.usable_slot_ids if s != slot_id]
    options = [o for o in options if o["status"] != "red"]
    options.sort(key=lambda o: (o["status"] != "green", o["est_cost_delta"]))
    current_cost = round(course_cost(ds, rules, weights, plan.exams, course_id, slot_id), 1)
    facts.append(f"Its current placement cost is {current_cost} (lower is better: closeness to other exams of the same students and difficulty weighting).")
    alternatives = options[:3]
    for option in alternatives:
        facts.append(f"Alternative {option['label']}: cost change {option['est_cost_delta']:+}, {option['students_affected']} students affected ({option['reason']}).")
    return {"facts": facts, "data": {"course_id": course_id, "slot_id": slot_id, "conflicts": conflicts, "alternatives": alternatives, "cost": current_cost}}


def nearest_same_course(room, seat: dict, mates: list[dict]) -> int | None:
    best = None
    for other in mates:
        if other["student_id"] == seat["student_id"] or other["course_id"] != seat["course_id"]:
            continue
        dr = abs(other["row"] - seat["row"])
        dc = abs((other["col"] + room.aisle_shift(other["col"])) - (seat["col"] + room.aisle_shift(seat["col"])))
        distance = max(dr, dc)
        best = distance if best is None else min(best, distance)
    return best


def explain_seat(ds: Dataset, plan: Plan, student_id: str, slot_id: str | None = None) -> dict:
    student_seats = [s for s in plan.seats if s["student_id"] == student_id and (slot_id is None or s["slot_id"] == slot_id)]
    entries = []
    facts: list[str] = []
    for seat in sorted(student_seats, key=lambda s: s["slot_id"]):
        room = ds.rooms[seat["room_id"]]
        mates = [s for s in plan.seats if s["slot_id"] == seat["slot_id"] and s["room_id"] == seat["room_id"]]
        distance = nearest_same_course(room, seat, mates)
        neighbours = []
        for other in mates:
            if other["student_id"] == student_id:
                continue
            if max(abs(other["row"] - seat["row"]), abs(other["col"] - seat["col"])) == 1:
                neighbours.append({"student_id": other["student_id"], "course_id": other["course_id"], "section": ds.students[other["student_id"]].section if other["student_id"] in ds.students else "S"})
        label = f"{ds.slots[seat['slot_id']].label}: {seat['course_id']} in {room.name}, seat {seat['row'] + 1}-{seat['col'] + 1}"
        facts.append(label + ".")
        if distance is None:
            facts.append("No other student of the same course sits in this room.")
        else:
            facts.append(f"The nearest student of the same course is {distance} seats away; seats are chosen to push same-course students apart (R-5.1).")
        student = ds.students.get(student_id)
        if student and student.needs_accessible:
            facts.append("An aisle seat in an accessible room was reserved for this student (R-3.3).")
        if student and student.extra_time_pct:
            facts.append("This student has extra time and is placed in a quiet room (R-3.4).")
        entries.append({"slot_id": seat["slot_id"], "room_id": seat["room_id"], "row": seat["row"], "col": seat["col"], "course_id": seat["course_id"], "nearest_same_course": distance, "neighbours": neighbours})
    if not entries:
        facts.append("No seat is assigned to this student in the selected session.")
    return {"facts": facts, "data": {"student_id": student_id, "seats": entries}}


def explain_duty(ds: Dataset, spec: Spec, plan: Plan, faculty_id: str, slot_id: str) -> dict:
    ds = ds.with_supplementary(spec.supplementary)
    faculty = ds.faculty[faculty_id]
    duty = next((d for d in plan.duties if d["faculty_id"] == faculty_id and d["slot_id"] == slot_id), None)
    facts: list[str] = []
    if duty is None:
        facts.append(f"{faculty.name} has no duty in {ds.slots[slot_id].label}.")
        return {"facts": facts, "data": {"faculty_id": faculty_id, "slot_id": slot_id}}
    where = f"room {duty['room_id']}" if duty["room_id"] else "the reliever pool"
    facts.append(f"{faculty.name} is the {duty['role']} in {where} for {ds.slots[slot_id].label}.")
    owned = ds.faculty_courses.get(faculty_id, [])
    facts.append(f"They own {', '.join(owned) if owned else 'no courses'}, none of which is examined in this session (R-4.2).")
    unavailable = spec.unavailable_slots(faculty_id, faculty.unavailable_slots)
    facts.append("They are available in this session." if slot_id not in unavailable else "They are marked unavailable in this session.")
    totals = {f: 0 for f in ds.faculty}
    for d in plan.duties:
        if d["room_id"]:
            totals[d["faculty_id"]] += 1
    mean = sum(totals.values()) / len(totals)
    facts.append(f"They have {totals[faculty_id]} duties in total against a mean of {mean:.1f}, keeping the load fair (R-4.4).")
    if duty["room_id"]:
        depts = {ds.courses[a["course_id"]].dept for a in plan.allocations if a["slot_id"] == slot_id and a["room_id"] == duty["room_id"]}
        facts.append("The room hosts their own department's exams." if faculty.dept in depts else "The room hosts other departments' exams, which is preferred (R-4.3).")
    return {"facts": facts, "data": {"faculty_id": faculty_id, "slot_id": slot_id, "role": duty["role"], "room_id": duty["room_id"], "total_duties": totals[faculty_id]}}


def render_template(explanation: dict) -> str:
    return " ".join(explanation["facts"][:4])
