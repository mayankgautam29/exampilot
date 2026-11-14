from __future__ import annotations

import threading
from dataclasses import fields

from sqlmodel import Session, select

from ..engine.data import Course, Dataset, Faculty, Room, Slot, Student
from ..models import tables

_lock = threading.Lock()
_cache: dict[str, Dataset] = {}


def convert(cls, row):
    return cls(**{f.name: getattr(row, f.name) for f in fields(cls)})


def load_dataset(session: Session) -> Dataset:
    with _lock:
        if "ds" in _cache:
            return _cache["ds"]
        enrollments: dict[str, list[str]] = {}
        for row in session.exec(select(tables.Enrollment)):
            enrollments.setdefault(row.student_id, []).append(row.course_id)
        dataset = Dataset(
            courses={r.id: convert(Course, r) for r in session.exec(select(tables.Course).order_by(tables.Course.id))},
            students={r.id: convert(Student, r) for r in session.exec(select(tables.Student).order_by(tables.Student.id))},
            rooms={r.id: convert(Room, r) for r in session.exec(select(tables.Room).order_by(tables.Room.id))},
            faculty={r.id: convert(Faculty, r) for r in session.exec(select(tables.Faculty).order_by(tables.Faculty.id))},
            slots={r.id: convert(Slot, r) for r in session.exec(select(tables.Slot).order_by(tables.Slot.id))},
            enrollments={key: sorted(value) for key, value in enrollments.items()},
        )
        _cache["ds"] = dataset
        return dataset


def clear_dataset_cache() -> None:
    with _lock:
        _cache.clear()
