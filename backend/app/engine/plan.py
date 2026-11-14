from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Plan:
    exams: dict[str, str] = field(default_factory=dict)
    allocations: list[dict] = field(default_factory=list)
    seats: list[dict] = field(default_factory=list)
    duties: list[dict] = field(default_factory=list)
    seat_stats: list[dict] = field(default_factory=list)
    relaxed: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict) -> Plan:
        return Plan(
            exams=dict(data.get("exams", {})),
            allocations=list(data.get("allocations", [])),
            seats=list(data.get("seats", [])),
            duties=list(data.get("duties", [])),
            seat_stats=list(data.get("seat_stats", [])),
            relaxed=bool(data.get("relaxed", False)),
        )

    def room_students(self) -> dict[tuple[str, str], list[str]]:
        result: dict[tuple[str, str], list[str]] = {}
        for allocation in self.allocations:
            key = (allocation["slot_id"], allocation["room_id"])
            result.setdefault(key, []).extend(allocation["students"])
        return result

    def room_course_counts(self) -> dict[tuple[str, str], dict[str, int]]:
        result: dict[tuple[str, str], dict[str, int]] = {}
        for allocation in self.allocations:
            key = (allocation["slot_id"], allocation["room_id"])
            counts = result.setdefault(key, {})
            counts[allocation["course_id"]] = counts.get(allocation["course_id"], 0) + len(allocation["students"])
        return result

    def slot_rooms(self) -> dict[str, dict[str, int]]:
        result: dict[str, dict[str, int]] = {}
        for (slot_id, room_id), students in self.room_students().items():
            result.setdefault(slot_id, {})[room_id] = len(students)
        return result

    def courses_in_slot(self, slot_id: str) -> list[str]:
        return sorted(course_id for course_id, slot in self.exams.items() if slot == slot_id)
