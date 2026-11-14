from __future__ import annotations

import math
import random
from datetime import date, timedelta

from faker import Faker

from ..engine.data import Course, Dataset, Faculty, Room, Slot, Student
from ..engine.rules import load_rules

DEPARTMENTS = ["CSE", "ECE", "ME", "CIV", "MGT", "DES"]
SEMESTERS = [1, 3, 5]
SECTIONS = ["A", "B"]

SUBJECTS = {
    "CSE": ["Programming Fundamentals", "Discrete Mathematics", "Digital Logic", "Computer Organisation",
            "Data Structures", "Object Oriented Programming", "Database Systems", "Operating Systems",
            "Machine Learning", "Compiler Design", "Computer Networks", "Software Engineering"],
    "ECE": ["Circuit Theory", "Electronic Devices", "Signals and Systems", "Engineering Mathematics",
            "Analog Circuits", "Digital Electronics", "Electromagnetics", "Control Systems",
            "VLSI Design", "Communication Systems", "Embedded Systems", "Antenna Theory"],
    "ME": ["Engineering Mechanics", "Thermodynamics", "Material Science", "Workshop Practice",
           "Fluid Mechanics", "Machine Design", "Manufacturing Processes", "Heat Transfer",
           "Robotics", "Power Plant Engineering", "Automobile Engineering", "Refrigeration"],
    "CIV": ["Surveying", "Building Materials", "Engineering Geology", "Structural Mechanics",
            "Concrete Technology", "Soil Mechanics", "Hydraulics", "Transportation Engineering",
            "Steel Structures", "Environmental Engineering", "Foundation Engineering", "Construction Management"],
    "MGT": ["Principles of Management", "Business Economics", "Financial Accounting", "Business Communication",
            "Marketing Management", "Organisational Behaviour", "Operations Management", "Business Statistics",
            "Strategic Management", "Corporate Finance", "Human Resource Management", "Business Analytics"],
    "DES": ["Design Fundamentals", "Visual Communication", "Design History", "Sketching Techniques",
            "Interaction Design", "Typography", "Product Design", "User Research",
            "Design Systems", "Motion Graphics", "Service Design", "Design Portfolio"],
}

ELECTIVES = {
    1: ["Design Thinking", "Environmental Studies", "Professional Ethics", "Foreign Language"],
    3: ["Entrepreneurship", "Data Literacy", "Public Speaking", "Sustainability"],
    5: ["Innovation Management", "Cyber Awareness", "Film Appreciation", "Behavioural Economics"],
}

ROOM_SPECS = [
    ("G1", "Ground Block", 0, 8, 8, True, False),
    ("G2", "Ground Block", 0, 6, 8, True, False),
    ("G3", "Ground Block", 0, 10, 8, True, False),
    ("Q1", "Quiet Wing", 1, 5, 6, False, True),
    ("Q2", "Quiet Wing", 1, 6, 6, False, True),
    ("A101", "Block A", 1, 10, 12, False, False),
    ("A102", "Block A", 1, 10, 10, False, False),
    ("A201", "Block A", 2, 8, 12, False, False),
    ("A202", "Block A", 2, 9, 10, False, False),
    ("B101", "Block B", 1, 8, 10, False, False),
    ("B102", "Block B", 1, 8, 9, False, False),
    ("B201", "Block B", 2, 7, 10, False, False),
    ("B202", "Block B", 2, 8, 8, False, False),
    ("C101", "Block C", 1, 6, 10, False, False),
    ("C102", "Block C", 1, 6, 8, False, False),
]


def build_slots(start_date: str) -> dict[str, Slot]:
    rules = load_rules()
    sessions = {"S1": (rules.s1_start, rules.s1_end), "S2": (rules.s2_start, rules.s2_end)}
    current = date.fromisoformat(start_date)
    working_days: list[date] = []
    while len(working_days) < rules.exam_period_days:
        if current.weekday() < 5:
            working_days.append(current)
        current += timedelta(days=1)
    holidays = {working_days[3 + index * 4].isoformat() for index in range(rules.holidays_in_period)}
    slots: dict[str, Slot] = {}
    for day in working_days:
        for session, (start, end) in sessions.items():
            slot_id = f"{day.isoformat()}-{session}"
            slots[slot_id] = Slot(slot_id, day.isoformat(), session, start, end, day.isoformat() in holidays)
    return slots


def build_rooms(scale: float) -> dict[str, Room]:
    rng = random.Random(7)
    rooms: dict[str, Room] = {}
    copies = max(1, math.ceil(scale))
    for copy in range(copies):
        for name, building, floor, rows, cols, accessible, quiet in ROOM_SPECS:
            room_name = name if copy == 0 else f"{name}x{copy + 1}"
            blocked: list[list[int]] = []
            if rows * cols >= 60:
                for _ in range(rng.randint(1, 3)):
                    seat = [rng.randrange(rows), rng.randrange(cols)]
                    if seat not in blocked:
                        blocked.append(seat)
            aisles = [cols // 2 - 1] if cols >= 6 else []
            rooms[room_name] = Room(room_name, room_name, building, floor, rows, cols, blocked, aisles, accessible, quiet)
    return rooms


def build_faculty(count: int, slots: dict[str, Slot], rng: random.Random, fake: Faker) -> dict[str, Faculty]:
    usable = [slot.id for slot in slots.values() if not slot.blocked]
    faculty: dict[str, Faculty] = {}
    for index in range(count):
        faculty_id = f"F{index + 1:02d}"
        unavailable = rng.sample(usable, rng.randint(1, 3)) if rng.random() < 0.25 else []
        faculty[faculty_id] = Faculty(faculty_id, f"Dr. {fake.name()}", DEPARTMENTS[index % len(DEPARTMENTS)], rng.randint(1, 5), 8, sorted(unavailable))
    return faculty


def build_courses(faculty: dict[str, Faculty], rng: random.Random) -> dict[str, Course]:
    courses: dict[str, Course] = {}
    owners_by_dept: dict[str, list[str]] = {dept: [f.id for f in faculty.values() if f.dept == dept] for dept in DEPARTMENTS}
    pointer = {dept: 0 for dept in DEPARTMENTS}
    all_faculty = list(faculty)
    elective_pointer = 0
    for dept in DEPARTMENTS:
        for sem_index, sem in enumerate(SEMESTERS):
            for number in range(4):
                code = f"{dept}{sem}{number + 1:02d}"
                owners = owners_by_dept[dept]
                owner = owners[pointer[dept] % len(owners)]
                pointer[dept] += 1
                name = SUBJECTS[dept][sem_index * 4 + number]
                courses[code] = Course(code, code, name, dept, sem, rng.choice([3, 4]), f"{dept}-{sem}", 180, owner, rng.randint(1, 3))
    for sem in SEMESTERS:
        for number, name in enumerate(ELECTIVES[sem]):
            code = f"OE{sem}{number + 1:02d}"
            owner = all_faculty[(elective_pointer * 3 + 1) % len(all_faculty)]
            elective_pointer += 1
            courses[code] = Course(code, code, name, "OPEN", sem, 3, f"OPEN-{sem}", 120, owner, rng.randint(1, 2))
    return courses


def build_students(courses: dict[str, Course], scale: float, rng: random.Random, fake: Faker) -> tuple[dict[str, Student], dict[str, list[str]]]:
    students: dict[str, Student] = {}
    enrollments: dict[str, list[str]] = {}
    per_section = max(4, round(20 * scale))
    counters = {dept: 0 for dept in DEPARTMENTS}
    for dept in DEPARTMENTS:
        for sem in SEMESTERS:
            core = [c.id for c in courses.values() if c.cohort_key == f"{dept}-{sem}"]
            electives = [c.id for c in courses.values() if c.cohort_key == f"OPEN-{sem}"]
            for section in SECTIONS:
                for _ in range(per_section + rng.randint(-1, 2)):
                    counters[dept] += 1
                    roll = f"JK26{dept}{counters[dept]:03d}"
                    students[roll] = Student(roll, roll, fake.name(), dept, sem, section, False, 0)
                    picks = rng.sample(electives, 1 if rng.random() < 0.5 else 2)
                    enrollments[roll] = sorted(core + picks)
    roll_numbers = sorted(students)
    for roll in rng.sample(roll_numbers, round(0.03 * len(roll_numbers))):
        students[roll].needs_accessible = True
    remaining = [roll for roll in roll_numbers if not students[roll].needs_accessible]
    for roll in rng.sample(remaining, round(0.04 * len(roll_numbers))):
        students[roll].extra_time_pct = load_rules().extra_time_pct
    return students, enrollments


def generate_dataset(seed: int = 42, scale: float = 1.0, start_date: str = "2026-12-07") -> Dataset:
    rng = random.Random(seed)
    fake = Faker("en_IN")
    fake.seed_instance(seed)
    slots = build_slots(start_date)
    rooms = build_rooms(scale)
    faculty = build_faculty(45 * max(1, math.ceil(scale)), slots, rng, fake)
    courses = build_courses(faculty, rng)
    students, enrollments = build_students(courses, scale, rng, fake)
    return Dataset(courses, students, rooms, faculty, slots, enrollments)
