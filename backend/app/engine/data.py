from __future__ import annotations

import datetime
import math
from dataclasses import dataclass, field
from functools import cached_property
from itertools import combinations


@dataclass
class Course:
    id: str
    code: str
    name: str
    dept: str
    semester: int
    credits: int
    cohort_key: str
    exam_duration_min: int
    owner_faculty_id: str
    difficulty: int


@dataclass
class Student:
    id: str
    roll_no: str
    name: str
    dept: str
    semester: int
    section: str
    needs_accessible: bool
    extra_time_pct: int


@dataclass
class Room:
    id: str
    name: str
    building: str
    floor: int
    rows: int
    cols: int
    blocked_seats: list[list[int]]
    aisle_cols: list[int]
    accessible: bool
    quiet: bool

    @property
    def seat_count(self) -> int:
        return self.rows * self.cols - len(self.blocked_seats)

    def usable(self, max_fill: float) -> int:
        return math.floor(self.seat_count * max_fill)

    def aisle_shift(self, col: int) -> int:
        return sum(1 for aisle in self.aisle_cols if aisle < col)

    def is_aisle_seat(self, col: int) -> bool:
        return col in self.aisle_cols or (col - 1) in self.aisle_cols

    def free_seats(self) -> list[tuple[int, int]]:
        blocked = {tuple(seat) for seat in self.blocked_seats}
        return [(r, c) for r in range(self.rows) for c in range(self.cols) if (r, c) not in blocked]


@dataclass
class Faculty:
    id: str
    name: str
    dept: str
    rank: int
    max_duties: int
    unavailable_slots: list[str]


@dataclass
class Slot:
    id: str
    date: str
    session: str
    start: str
    end: str
    blocked: bool = False

    @property
    def label(self) -> str:
        day = datetime.date.fromisoformat(self.date)
        return f"{day.strftime('%a %d %b')} {self.session}"


@dataclass
class Dataset:
    courses: dict[str, Course]
    students: dict[str, Student]
    rooms: dict[str, Room]
    faculty: dict[str, Faculty]
    slots: dict[str, Slot]
    enrollments: dict[str, list[str]]
    cache: dict = field(default_factory=dict, repr=False)

    @cached_property
    def course_students(self) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {course_id: [] for course_id in self.courses}
        for student_id, course_ids in self.enrollments.items():
            for course_id in course_ids:
                result[course_id].append(student_id)
        for ids in result.values():
            ids.sort()
        return result

    @cached_property
    def shared(self) -> dict[tuple[str, str], int]:
        counts: dict[tuple[str, str], int] = {}
        for course_ids in self.enrollments.values():
            for a, b in combinations(sorted(course_ids), 2):
                counts[(a, b)] = counts.get((a, b), 0) + 1
        return counts

    @cached_property
    def shared_by_course(self) -> dict[str, dict[str, int]]:
        result: dict[str, dict[str, int]] = {course_id: {} for course_id in self.courses}
        for (a, b), count in self.shared.items():
            result[a][b] = count
            result[b][a] = count
        return result

    @cached_property
    def usable_slot_ids(self) -> list[str]:
        return [slot.id for slot in self.slots.values() if not slot.blocked]

    @cached_property
    def day_index(self) -> dict[str, int]:
        dates = sorted({slot.date for slot in self.slots.values() if not slot.blocked})
        return {date: index for index, date in enumerate(dates)}

    @cached_property
    def faculty_courses(self) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {faculty_id: [] for faculty_id in self.faculty}
        for course in self.courses.values():
            result.setdefault(course.owner_faculty_id, []).append(course.id)
        return result

    def size(self, course_id: str) -> int:
        return len(self.course_students[course_id])

    def day_of(self, slot_id: str) -> int:
        return self.day_index[self.slots[slot_id].date]

    def slots_on(self, date: str) -> list[str]:
        return [slot.id for slot in self.slots.values() if slot.date == date and not slot.blocked]

    def with_supplementary(self, extra: dict[str, int]) -> Dataset:
        if not extra:
            return self
        students = dict(self.students)
        enrollments = {key: list(value) for key, value in self.enrollments.items()}
        for course_id, count in extra.items():
            course = self.courses.get(course_id)
            if course is None:
                continue
            for index in range(1, count + 1):
                student_id = f"SUP-{course_id}-{index:02d}"
                students[student_id] = Student(student_id, student_id, f"Supplementary {index}", course.dept, course.semester, "S", False, 0)
                enrollments[student_id] = [course_id]
        return Dataset(self.courses, students, self.rooms, self.faculty, self.slots, enrollments)
