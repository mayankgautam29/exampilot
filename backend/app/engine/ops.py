from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from .data import Dataset
from .rules import OVERRIDABLE_RULES


class Spec(BaseModel):
    pins: dict[str, str] = {}
    forbids: dict[str, list[str]] = {}
    blocked_rooms: list[list[str]] = []
    blocked_dates: list[str] = []
    faculty_unavailable: dict[str, list[str]] = {}
    supplementary: dict[str, int] = {}
    rules: dict[str, float] = {}
    weights: dict[str, float] = {}
    reroll: dict[str, int] = {}
    seed: int = 42

    def is_room_blocked(self, room_id: str, slot_id: str) -> bool:
        return [room_id, slot_id] in self.blocked_rooms

    def unavailable_slots(self, faculty_id: str, base: list[str]) -> set[str]:
        return set(base) | set(self.faculty_unavailable.get(faculty_id, []))


class PinCourse(BaseModel):
    op: Literal["pin_course"] = "pin_course"
    course_id: str
    slot_id: str

    def apply_to(self, spec: Spec) -> None:
        spec.pins[self.course_id] = self.slot_id

    def describe(self) -> str:
        return f"Pin {self.course_id} to {self.slot_id}"


class UnpinCourse(BaseModel):
    op: Literal["unpin_course"] = "unpin_course"
    course_id: str

    def apply_to(self, spec: Spec) -> None:
        spec.pins.pop(self.course_id, None)

    def describe(self) -> str:
        return f"Unpin {self.course_id}"


class ForbidSlots(BaseModel):
    op: Literal["forbid_slots"] = "forbid_slots"
    course_id: str
    slot_ids: list[str]

    def apply_to(self, spec: Spec) -> None:
        spec.forbids[self.course_id] = sorted(set(spec.forbids.get(self.course_id, [])) | set(self.slot_ids))

    def describe(self) -> str:
        return f"Forbid {self.course_id} in {', '.join(self.slot_ids)}"


class BlockRoom(BaseModel):
    op: Literal["block_room"] = "block_room"
    room_id: str
    slot_ids: list[str]

    def apply_to(self, spec: Spec) -> None:
        for slot_id in self.slot_ids:
            if [self.room_id, slot_id] not in spec.blocked_rooms:
                spec.blocked_rooms.append([self.room_id, slot_id])

    def describe(self) -> str:
        return f"Block room {self.room_id} in {', '.join(self.slot_ids)}"


class BlockDate(BaseModel):
    op: Literal["block_date"] = "block_date"
    date: str

    def apply_to(self, spec: Spec) -> None:
        if self.date not in spec.blocked_dates:
            spec.blocked_dates.append(self.date)

    def describe(self) -> str:
        return f"Block date {self.date}"


class FacultyUnavailable(BaseModel):
    op: Literal["faculty_unavailable"] = "faculty_unavailable"
    faculty_id: str
    slot_ids: list[str]

    def apply_to(self, spec: Spec) -> None:
        current = set(spec.faculty_unavailable.get(self.faculty_id, []))
        spec.faculty_unavailable[self.faculty_id] = sorted(current | set(self.slot_ids))

    def describe(self) -> str:
        return f"Faculty {self.faculty_id} unavailable in {', '.join(self.slot_ids)}"


class AddSupplementary(BaseModel):
    op: Literal["add_supplementary"] = "add_supplementary"
    course_id: str
    n: int = Field(ge=1, le=200)

    def apply_to(self, spec: Spec) -> None:
        spec.supplementary[self.course_id] = spec.supplementary.get(self.course_id, 0) + self.n

    def describe(self) -> str:
        return f"Add {self.n} supplementary students to {self.course_id}"


class SetRule(BaseModel):
    op: Literal["set_rule"] = "set_rule"
    key: str
    value: float

    def apply_to(self, spec: Spec) -> None:
        spec.rules[self.key] = self.value

    def describe(self) -> str:
        return f"Set rule {self.key} = {self.value:g}"


class SetWeights(BaseModel):
    op: Literal["set_weights"] = "set_weights"
    weights: dict[str, float]

    def apply_to(self, spec: Spec) -> None:
        spec.weights.update(self.weights)

    def describe(self) -> str:
        return "Set weights " + ", ".join(f"{k}={v:g}" for k, v in self.weights.items())


class RelaxConstraint(BaseModel):
    op: Literal["relax_constraint"] = "relax_constraint"
    group_id: str

    def apply_to(self, spec: Spec) -> None:
        kind, _, key = self.group_id.partition(":")
        if kind == "pin":
            spec.pins.pop(key, None)
        elif kind == "forbid":
            spec.forbids.pop(key, None)
        elif kind == "blockdate":
            spec.blocked_dates = [d for d in spec.blocked_dates if d != key]
        elif kind == "blockroom":
            spec.blocked_rooms = [pair for pair in spec.blocked_rooms if pair[1] != key]
        elif kind == "rule":
            spec.rules[key] = 2

    def describe(self) -> str:
        return f"Relax constraint {self.group_id}"


class Regenerate(BaseModel):
    op: Literal["regenerate"] = "regenerate"
    scope: Literal["timetable", "seating", "invigilation", "all"] = "all"

    def apply_to(self, spec: Spec) -> None:
        scopes = ["timetable", "seating", "invigilation"] if self.scope == "all" else [self.scope]
        for scope in scopes:
            spec.reroll[scope] = spec.reroll.get(scope, 0) + 1

    def describe(self) -> str:
        return f"Regenerate {self.scope}"


ChangeOp = Annotated[
    Union[PinCourse, UnpinCourse, ForbidSlots, BlockRoom, BlockDate, FacultyUnavailable, AddSupplementary, SetRule, SetWeights, RelaxConstraint, Regenerate],
    Field(discriminator="op"),
]


class OpList(BaseModel):
    ops: list[ChangeOp]


def parse_ops(raw: list[dict]) -> list[ChangeOp]:
    return OpList(ops=raw).ops


def apply_ops(spec: Spec, ops: list[ChangeOp]) -> Spec:
    new_spec = spec.model_copy(deep=True)
    for op in ops:
        op.apply_to(new_spec)
    return new_spec


def validate_ops(ds: Dataset, ops: list[ChangeOp]) -> list[str]:
    errors: list[str] = []
    for op in ops:
        course_id = getattr(op, "course_id", None)
        if course_id is not None and course_id not in ds.courses:
            errors.append(f"Unknown course '{course_id}'")
        room_id = getattr(op, "room_id", None)
        if room_id is not None and room_id not in ds.rooms:
            errors.append(f"Unknown room '{room_id}'")
        faculty_id = getattr(op, "faculty_id", None)
        if faculty_id is not None and faculty_id not in ds.faculty:
            errors.append(f"Unknown faculty '{faculty_id}'")
        slot_ids = list(getattr(op, "slot_ids", []))
        if getattr(op, "slot_id", None):
            slot_ids.append(op.slot_id)
        for slot_id in slot_ids:
            if slot_id not in ds.slots:
                errors.append(f"Unknown slot '{slot_id}'")
            elif ds.slots[slot_id].blocked:
                errors.append(f"Slot '{slot_id}' is a holiday")
        if isinstance(op, BlockDate) and not ds.slots_on(op.date):
            errors.append(f"No exam slots on '{op.date}'")
        if isinstance(op, SetRule) and op.key not in OVERRIDABLE_RULES:
            errors.append(f"Rule '{op.key}' cannot be changed")
    return errors
