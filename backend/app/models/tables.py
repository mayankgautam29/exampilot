from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Column, Index
from sqlmodel import Field, SQLModel


def now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    role: str
    ref_id: str | None = Field(default=None, index=True)


class Department(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str


class Course(SQLModel, table=True):
    id: str = Field(primary_key=True)
    code: str
    name: str
    dept: str = Field(index=True)
    semester: int
    credits: int
    cohort_key: str
    exam_duration_min: int
    owner_faculty_id: str = Field(index=True)
    difficulty: int


class Student(SQLModel, table=True):
    id: str = Field(primary_key=True)
    roll_no: str = Field(index=True)
    name: str
    dept: str = Field(index=True)
    semester: int
    section: str
    needs_accessible: bool = False
    extra_time_pct: int = 0


class Enrollment(SQLModel, table=True):
    student_id: str = Field(primary_key=True)
    course_id: str = Field(primary_key=True, index=True)


class Room(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    building: str
    floor: int
    rows: int
    cols: int
    blocked_seats: list = Field(default_factory=list, sa_column=Column(JSON))
    aisle_cols: list = Field(default_factory=list, sa_column=Column(JSON))
    accessible: bool = False
    quiet: bool = False


class Faculty(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    dept: str = Field(index=True)
    rank: int
    max_duties: int
    unavailable_slots: list = Field(default_factory=list, sa_column=Column(JSON))


class Slot(SQLModel, table=True):
    id: str = Field(primary_key=True)
    date: str = Field(index=True)
    session: str
    start: str
    end: str
    blocked: bool = False


class PlanVersion(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    parent_id: int | None = Field(default=None, index=True)
    kind: str = "full"
    status: str = Field(default="DRAFT", index=True)
    version: int = 1
    row_version: int = 1
    label: str = ""
    origin: str = "manual"
    spec_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    data_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    kpis_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    violations_json: list = Field(default_factory=list, sa_column=Column(JSON))
    solver_stats_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: int | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=now)
    approved_by: int | None = None
    rejection_reason: str | None = None


class ExamEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(index=True)
    course_id: str = Field(index=True)
    slot_id: str = Field(index=True)


class RoomAllocation(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(index=True)
    slot_id: str = Field(index=True)
    room_id: str = Field(index=True)
    course_id: str = Field(index=True)
    n_students: int


class SeatAssignment(SQLModel, table=True):
    __table_args__ = (Index("ix_seat_plan_student", "plan_id", "student_id"), Index("ix_seat_plan_room", "plan_id", "slot_id", "room_id"))
    id: int | None = Field(default=None, primary_key=True)
    plan_id: int
    slot_id: str
    student_id: str
    room_id: str
    course_id: str
    row: int
    col: int


class InvigDuty(SQLModel, table=True):
    __table_args__ = (Index("ix_duty_plan_faculty", "plan_id", "faculty_id"),)
    id: int | None = Field(default=None, primary_key=True)
    plan_id: int
    slot_id: str = Field(index=True)
    room_id: str | None = Field(default=None, index=True)
    faculty_id: str
    role: str


class AuditLog(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(default_factory=now)
    actor_id: int | None = Field(default=None, index=True)
    role: str = ""
    action: str = Field(index=True)
    entity: str = Field(default="", index=True)
    payload_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    reasoning: str = ""
    prev_hash: str = ""
    hash: str = ""


class Notification(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(index=True)
    channel: str
    to: str = Field(index=True)
    subject: str
    body: str
    status: str = "sent"
    created_at: datetime = Field(default_factory=now)


class LLMUsage(SQLModel, table=True):
    date: str = Field(primary_key=True)
    model: str = Field(primary_key=True)
    calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0


class Job(SQLModel, table=True):
    id: str = Field(primary_key=True)
    kind: str
    status: str = "queued"
    plan_id: int | None = None
    error: str | None = None
    result_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: int | None = None
    created_at: datetime = Field(default_factory=now)


class SwapRequest(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    plan_id: int = Field(index=True)
    faculty_id: str = Field(index=True)
    slot_id: str
    room_id: str | None = None
    reason: str = ""
    status: str = "PENDING"
    precheck_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=now)


class Disruption(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    kind: str
    payload_json: dict = Field(default_factory=dict, sa_column=Column(JSON))
    summary: str = ""
    plan_id: int | None = Field(default=None, index=True)
    status: str = "OPEN"
    created_by: int | None = None
    created_at: datetime = Field(default_factory=now)
