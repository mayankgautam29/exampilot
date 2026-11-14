import pytest

from app.agent.fallback_parser import interpret
from app.seed.generator import generate_dataset


@pytest.fixture(scope="module")
def ds():
    return generate_dataset()


def parse(ds, text, exams=None):
    return interpret(text, ds, "admin", None, exams or {"CSE301": "2026-12-09-S1"})


CASES = [
    ("move CSE301 to 2026-12-08 morning", [{"op": "pin_course", "course_id": "CSE301", "slot_id": "2026-12-08-S1"}]),
    ("Move Data Structures to 2026-12-08 afternoon", [{"op": "pin_course", "course_id": "CSE301", "slot_id": "2026-12-08-S2"}]),
    ("please shift CSE301 to the second monday afternoon", [{"op": "pin_course", "course_id": "CSE301", "slot_id": "2026-12-14-S2"}]),
    ("schedule CSE301 on Tuesday afternoon", [{"op": "pin_course", "course_id": "CSE301", "slot_id": "2026-12-08-S2"}]),
    ("pin CSE301", [{"op": "pin_course", "course_id": "CSE301", "slot_id": "2026-12-09-S1"}]),
    ("unpin CSE301", [{"op": "unpin_course", "course_id": "CSE301"}]),
    ("room G1 unavailable on 2026-12-08 afternoon", [{"op": "block_room", "room_id": "G1", "slot_ids": ["2026-12-08-S2"]}]),
    ("Room A101 flooded on Dec 15 morning", [{"op": "block_room", "room_id": "A101", "slot_ids": ["2026-12-15-S1"]}]),
    ("block room B101 on 9 dec", [{"op": "block_room", "room_id": "B101", "slot_ids": ["2026-12-09-S1", "2026-12-09-S2"]}]),
    ("faculty F05 unavailable on 9 dec", [{"op": "faculty_unavailable", "faculty_id": "F05", "slot_ids": ["2026-12-09-S1", "2026-12-09-S2"]}]),
    ("F07 is absent on 2026-12-14 morning", [{"op": "faculty_unavailable", "faculty_id": "F07", "slot_ids": ["2026-12-14-S1"]}]),
    ("block 2026-12-14", [{"op": "block_date", "date": "2026-12-14"}]),
    ("add 12 supplementary students to OE101", [{"op": "add_supplementary", "course_id": "OE101", "n": 12}]),
    ("add 5 supplementary students to Signals and Systems", [{"op": "add_supplementary", "course_id": "ECE103", "n": 5}]),
    ("regenerate seating", [{"op": "regenerate", "scope": "seating"}]),
    ("regenerate the invigilation roster", [{"op": "regenerate", "scope": "invigilation"}]),
    ("set max exams per day to 2", [{"op": "set_rule", "key": "max_exams_per_day", "value": 2.0}]),
    ("set max fill to 80%", [{"op": "set_rule", "key": "max_fill", "value": 0.8}]),
]


@pytest.mark.parametrize("text,ops", CASES)
def test_phrasings_become_ops(ds, text, ops):
    result = parse(ds, text)
    assert result.kind == "change", (text, result)
    assert result.ops == ops


def test_multi_change_request(ds):
    result = parse(ds, "move CSE301 to 2026-12-14 morning and CSE302 to 2026-12-15 afternoon, then regenerate seating")
    assert [op["op"] for op in result.ops] == ["pin_course", "pin_course", "regenerate"]


def test_ambiguous_course_asks_for_clarification(ds):
    result = parse(ds, "move math to 2026-12-08 morning")
    assert result.kind == "clarify"
    assert len(result.clarify["options"]) >= 2


def test_missing_session_asks_for_clarification(ds):
    result = parse(ds, "move CSE301 to 2026-12-08")
    assert result.kind == "clarify"
    assert {o["label"][:7] for o in result.clarify["options"]} == {"Morning", "Afterno"}


def test_questions_are_routed(ds):
    assert parse(ds, "Can students use calculators?").kind == "question"
    assert parse(ds, "why is CSE301 on that day?").kind == "explain_slot"
    assert parse(ds, "how is the plan doing?").kind == "summary"


def test_student_scope_blocks_other_students(ds):
    own = interpret("Where do I sit?", ds, "student", "JK26CSE001", {})
    assert own.kind == "schedule"
    other = interpret("Where does JK26CSE014 sit?", ds, "student", "JK26CSE001", {})
    assert other.kind == "denied"
    assert interpret("where does my friend sit", ds, "student", "JK26CSE001", {}).kind == "denied"
