from __future__ import annotations

from dataclasses import asdict, dataclass

from .data import Dataset
from .ops import Spec
from .plan import Plan
from .rules import Rules, demand_for, load_rules


@dataclass
class Violation:
    code: str
    severity: str
    entity_ids: list[str]
    message: str
    rule_id: str

    def to_dict(self) -> dict:
        return asdict(self)


def hard(code: str, ids: list[str], message: str, rule: str) -> Violation:
    return Violation(code, "hard", ids, message, rule)


def soft(code: str, ids: list[str], message: str, rule: str) -> Violation:
    return Violation(code, "soft", ids, message, rule)


def check_timetable(ds: Dataset, spec: Spec, plan: Plan, rules: Rules) -> list[Violation]:
    found: list[Violation] = []
    limit = rules.relaxed_max_exams_per_day if plan.relaxed else rules.max_exams_per_day
    for course_id in ds.courses:
        if course_id not in plan.exams:
            found.append(hard("H-EXAM-MISSING", [course_id], f"{course_id} has no exam slot", "R-1.1"))
    for course_id, slot_id in plan.exams.items():
        slot = ds.slots.get(slot_id)
        if slot is None or slot.blocked or slot.date in spec.blocked_dates:
            found.append(hard("H-BLOCKED-SLOT", [course_id, slot_id], f"{course_id} is scheduled in unavailable slot {slot_id}", "R-1.2"))
    for course_id, slot_id in spec.pins.items():
        if plan.exams.get(course_id) != slot_id:
            found.append(hard("H-PIN", [course_id], f"{course_id} must be in {slot_id} but is in {plan.exams.get(course_id)}", "R-2.2"))
    for course_id, slots in spec.forbids.items():
        if plan.exams.get(course_id) in slots:
            found.append(hard("H-PIN", [course_id], f"{course_id} is in forbidden slot {plan.exams.get(course_id)}", "R-2.2"))
    consecutive: dict[tuple[str, str], int] = {}
    same_day: dict[tuple[str, str], int] = {}
    for student_id, course_ids in ds.enrollments.items():
        scheduled = [(c, plan.exams[c]) for c in course_ids if c in plan.exams and plan.exams[c] in ds.slots]
        by_slot: dict[str, list[str]] = {}
        by_day: dict[str, list[str]] = {}
        for course_id, slot_id in scheduled:
            by_slot.setdefault(slot_id, []).append(course_id)
            by_day.setdefault(ds.slots[slot_id].date, []).append(course_id)
        for slot_id, courses in by_slot.items():
            if len(courses) > 1:
                found.append(hard("H-STU-SLOT-CLASH", [student_id, slot_id], f"{student_id} has {len(courses)} exams in {slot_id}: {', '.join(sorted(courses))}", "R-2.2"))
        for date, courses in by_day.items():
            if len(courses) > limit:
                found.append(hard("H-STU-DAY-LIMIT", [student_id, date], f"{student_id} has {len(courses)} exams on {date}", "R-2.1"))
            elif len(courses) > 1 and plan.relaxed:
                for i in range(len(courses)):
                    for j in range(i + 1, len(courses)):
                        key = tuple(sorted((courses[i], courses[j])))
                        same_day[key] = same_day.get(key, 0) + 1
        days = sorted({ds.day_index[ds.slots[s].date] for _, s in scheduled if ds.slots[s].date in ds.day_index})
        day_courses = {ds.day_index[ds.slots[s].date]: c for c, s in scheduled if ds.slots[s].date in ds.day_index}
        for first, second in zip(days, days[1:]):
            if second - first == 1:
                key = tuple(sorted((day_courses[first], day_courses[second])))
                consecutive[key] = consecutive.get(key, 0) + 1
    for (a, b), count in sorted(same_day.items()):
        found.append(soft("S-RELAXED-SAMEDAY", [a, b], f"{a} and {b} share a day for {count} students (relaxed rule)", "R-2.3"))
    for (a, b), count in sorted(consecutive.items()):
        found.append(soft("S-CONSEC-DAYS", [a, b], f"{a} and {b} fall on consecutive days for {count} students", "R-2.4"))
    return found


def check_rooms(ds: Dataset, spec: Spec, plan: Plan, rules: Rules) -> list[Violation]:
    found: list[Violation] = []
    counts = plan.room_course_counts()
    for (slot_id, room_id), by_course in sorted(counts.items()):
        room = ds.rooms[room_id]
        total = sum(by_course.values())
        if total > room.usable(rules.max_fill):
            found.append(hard("H-ROOM-CAPACITY", [room_id, slot_id], f"{room_id} holds {total} students in {slot_id}, limit {room.usable(rules.max_fill)}", "R-3.1"))
        if spec.is_room_blocked(room_id, slot_id):
            found.append(hard("H-ROOM-BLOCKED", [room_id, slot_id], f"{room_id} is blocked in {slot_id} but used", "R-3.1"))
        for course_id, count in by_course.items():
            if count > rules.max_course_share * room.seat_count:
                found.append(soft("S-COURSE-SHARE", [room_id, slot_id, course_id], f"{course_id} fills {count} of {room.seat_count} seats in {room_id}", "R-3.2"))
    allocated = {(a["slot_id"], sid): (a["room_id"], a["course_id"]) for a in plan.allocations for sid in a["students"]}
    for student_id, course_ids in ds.enrollments.items():
        for course_id in course_ids:
            slot_id = plan.exams.get(course_id)
            if slot_id is not None and allocated.get((slot_id, student_id), (None, None))[1] != course_id:
                found.append(hard("H-ROOM-CAPACITY", [student_id, course_id], f"{student_id} has no room for {course_id}", "R-3.1"))
    return found


def check_seating(ds: Dataset, spec: Spec, plan: Plan, rules: Rules) -> list[Violation]:
    found: list[Violation] = []
    used: dict[tuple[str, str, int, int], int] = {}
    seats_of: dict[tuple[str, str], list[dict]] = {}
    for seat in plan.seats:
        key = (seat["slot_id"], seat["room_id"], seat["row"], seat["col"])
        used[key] = used.get(key, 0) + 1
        seats_of.setdefault((seat["slot_id"], seat["student_id"]), []).append(seat)
        room = ds.rooms[seat["room_id"]]
        if [seat["row"], seat["col"]] in room.blocked_seats or not (0 <= seat["row"] < room.rows and 0 <= seat["col"] < room.cols):
            found.append(hard("H-SEAT-BLOCKED", [seat["room_id"], seat["student_id"]], f"{seat['student_id']} sits in unusable seat {seat['row']}-{seat['col']} of {seat['room_id']}", "R-5.5"))
        student = ds.students.get(seat["student_id"])
        if student is not None:
            if student.needs_accessible and not (room.accessible and room.is_aisle_seat(seat["col"])):
                found.append(hard("H-ACCESS", [student.id, room.id], f"{student.id} needs an accessible aisle seat but has {room.id} {seat['row']}-{seat['col']}", "R-3.3"))
            if student.extra_time_pct > 0 and not room.quiet:
                found.append(hard("H-ACCESS", [student.id, room.id], f"{student.id} has extra time but sits in non-quiet room {room.id}", "R-3.4"))
    for key, count in used.items():
        if count > 1:
            found.append(hard("H-SEAT-DUP", [key[1], f"{key[2]}-{key[3]}"], f"Seat {key[2]}-{key[3]} of {key[1]} used {count} times in {key[0]}", "R-5.4"))
    allocation_room = {(a["slot_id"], sid): a["room_id"] for a in plan.allocations for sid in a["students"]}
    for student_id, course_ids in ds.enrollments.items():
        for course_id in course_ids:
            slot_id = plan.exams.get(course_id)
            if slot_id is None:
                continue
            seats = [s for s in seats_of.get((slot_id, student_id), []) if s["course_id"] == course_id]
            if len(seats) != 1:
                found.append(hard("H-SEAT-DUP", [student_id, course_id], f"{student_id} has {len(seats)} seats for {course_id}", "R-5.4"))
            elif allocation_room.get((slot_id, student_id)) != seats[0]["room_id"]:
                found.append(hard("H-SEAT-DUP", [student_id, course_id], f"{student_id} seat room differs from allocation", "R-5.4"))
    for stat in plan.seat_stats:
        if stat["adjacent_pairs"] > 0:
            found.append(soft("S-SEAT-ADJ-SAME-COURSE", [stat["room_id"], stat["slot_id"]], f"{stat['adjacent_pairs']} same-course adjacent pairs in {stat['room_id']} ({stat['slot_id']})", "R-5.1"))
    return found


def check_invigilation(ds: Dataset, spec: Spec, plan: Plan, rules: Rules) -> list[Violation]:
    found: list[Violation] = []
    if not plan.duties:
        return found
    room_counts = plan.slot_rooms()
    assigned: dict[tuple[str, str], int] = {}
    relievers: dict[str, int] = {}
    per_slot: dict[tuple[str, str], int] = {}
    per_day: dict[tuple[str, str], int] = {}
    totals: dict[str, int] = {}
    own_dept = 0
    own_dept_ids: set[str] = set()
    room_depts: dict[tuple[str, str], set[str]] = {}
    for allocation in plan.allocations:
        room_depts.setdefault((allocation["slot_id"], allocation["room_id"]), set()).add(ds.courses[allocation["course_id"]].dept)
    for duty in plan.duties:
        faculty = ds.faculty[duty["faculty_id"]]
        slot_id = duty["slot_id"]
        per_slot[(faculty.id, slot_id)] = per_slot.get((faculty.id, slot_id), 0) + 1
        owned = {ds.courses[c].owner_faculty_id for c in plan.courses_in_slot(slot_id)}
        if faculty.id in owned:
            found.append(hard("H-INVIG-OWN-COURSE", [faculty.id, slot_id], f"{faculty.id} invigilates a slot containing their own course ({slot_id})", "R-4.2"))
        if slot_id in spec.unavailable_slots(faculty.id, faculty.unavailable_slots):
            found.append(hard("H-INVIG-UNAVAILABLE", [faculty.id, slot_id], f"{faculty.id} is unavailable in {slot_id}", "R-4.4"))
        if duty["room_id"] is None:
            relievers[slot_id] = relievers.get(slot_id, 0) + 1
            continue
        assigned[(slot_id, duty["room_id"])] = assigned.get((slot_id, duty["room_id"]), 0) + 1
        day_key = (faculty.id, ds.slots[slot_id].date)
        per_day[day_key] = per_day.get(day_key, 0) + 1
        totals[faculty.id] = totals.get(faculty.id, 0) + 1
        if faculty.dept in room_depts.get((slot_id, duty["room_id"]), set()):
            own_dept += 1
            own_dept_ids.add(faculty.id)
    for (faculty_id, slot_id), count in per_slot.items():
        if count > 1:
            found.append(hard("H-INVIG-DOUBLE", [faculty_id, slot_id], f"{faculty_id} has {count} duties in {slot_id}", "R-4.4"))
    for (faculty_id, date), count in per_day.items():
        if count > rules.max_per_day:
            found.append(hard("H-INVIG-DAYLIMIT", [faculty_id, date], f"{faculty_id} has {count} duties on {date}", "R-4.4"))
    for faculty_id, count in totals.items():
        limit = min(ds.faculty[faculty_id].max_duties, rules.max_duties)
        if count > limit:
            found.append(hard("H-INVIG-MAXDUTIES", [faculty_id], f"{faculty_id} has {count} duties, limit {limit}", "R-4.4"))
    for slot_id, rooms in room_counts.items():
        for room_id, students in rooms.items():
            needed = demand_for(rules, students)
            if assigned.get((slot_id, room_id), 0) < needed:
                found.append(hard("H-INVIG-COVERAGE", [room_id, slot_id], f"{room_id} in {slot_id} needs {needed} invigilators, has {assigned.get((slot_id, room_id), 0)}", "R-4.1"))
        if relievers.get(slot_id, 0) < rules.relievers_per_slot:
            found.append(hard("H-INVIG-COVERAGE", [slot_id], f"{slot_id} needs {rules.relievers_per_slot} relievers, has {relievers.get(slot_id, 0)}", "R-4.5"))
    if own_dept:
        found.append(soft("S-INVIG-OWN-DEPT", sorted(own_dept_ids), f"{own_dept} duties are in the invigilator's own department", "R-4.3"))
    duty_values = [totals.get(f, 0) for f in ds.faculty]
    if duty_values and max(duty_values) - min(duty_values) > 2:
        found.append(soft("S-DUTY-IMBALANCE", [], f"Duty counts range from {min(duty_values)} to {max(duty_values)}", "R-4.4"))
    return found


def validate(ds: Dataset, spec: Spec, plan: Plan) -> list[Violation]:
    ds = ds.with_supplementary(spec.supplementary)
    rules = load_rules(spec.rules)
    return check_timetable(ds, spec, plan, rules) + check_rooms(ds, spec, plan, rules) + check_seating(ds, spec, plan, rules) + check_invigilation(ds, spec, plan, rules)


def hard_violations(violations: list[Violation]) -> list[Violation]:
    return [v for v in violations if v.severity == "hard"]
