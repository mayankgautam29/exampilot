import copy
import re
import time
from pathlib import Path

import pytest

from app.engine import diagnose, explain, timetable
from app.engine.baselines import run_benchmark
from app.engine.diff import diff_plans
from app.engine.kpis import compute_kpis
from app.engine.ops import AddSupplementary, BlockDate, PinCourse, Spec, SetRule, apply_ops, parse_ops, validate_ops
from app.engine.pipeline import PlanningError, SolverConfig, run_pipeline
from app.engine.plan import Plan
from app.engine.rules import load_rules, load_weights
from app.engine.validator import hard_violations, validate
from app.seed.generator import generate_dataset

CONFIG = SolverConfig(workers=4, timetable_seconds=6, venue_seconds=1.5, invigilation_seconds=6, seat_iterations=8000, seat_workers=1)


@pytest.fixture(scope="module")
def ds():
    return generate_dataset(scale=0.5)


@pytest.fixture(scope="module")
def built(ds):
    plan, stats = run_pipeline(ds, Spec(), None, CONFIG)
    return plan, stats


def codes(ds, spec, plan):
    return {v.code for v in hard_violations(validate(ds, spec, plan))}


def test_generated_plan_has_no_hard_violations(ds, built):
    plan, _ = built
    assert hard_violations(validate(ds, Spec(), plan)) == []


def test_kpis_meet_targets(ds, built):
    plan, stats = built
    kpis = compute_kpis(ds, Spec(), plan, validate(ds, Spec(), plan), stats)
    assert kpis["clashes"] == 0
    assert kpis["pct_students_one_exam_per_day"] == 100
    assert kpis["seating_risk_index"] <= 15
    assert kpis["duties_max"] - kpis["duties_min"] <= 2
    assert not kpis["relaxed_rules"]


def test_validator_does_not_depend_on_the_solver():
    source = (Path(__file__).parent.parent / "engine" / "validator.py").read_text()
    assert "ortools" not in source
    import subprocess
    import sys

    code = "import sys; import app.engine.validator; sys.exit(1 if any(m.startswith('ortools') for m in sys.modules) else 0)"
    assert subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).parents[2]).returncode == 0


def first_shared_pair(ds):
    return max(ds.shared.items(), key=lambda item: item[1])[0]


def mutate_clash(ds, spec, plan):
    a, b = first_shared_pair(ds)
    plan.exams[a] = plan.exams[b]


def mutate_day(ds, spec, plan):
    a, b = first_shared_pair(ds)
    slot = ds.slots[plan.exams[b]]
    other = "S2" if slot.session == "S1" else "S1"
    plan.exams[a] = f"{slot.date}-{other}"


def mutate_capacity(ds, spec, plan):
    plan.allocations[0]["students"] = plan.allocations[0]["students"] + [f"X{i}" for i in range(500)]


def mutate_room_blocked(ds, spec, plan):
    allocation = plan.allocations[0]
    spec.blocked_rooms.append([allocation["room_id"], allocation["slot_id"]])


def mutate_blocked_slot(ds, spec, plan):
    spec.blocked_dates.append(ds.slots[next(iter(plan.exams.values()))].date)


def mutate_missing_exam(ds, spec, plan):
    plan.exams.pop(next(iter(plan.exams)))


def mutate_seat_dup(ds, spec, plan):
    plan.seats[1]["row"], plan.seats[1]["col"] = plan.seats[0]["row"], plan.seats[0]["col"]
    plan.seats[1]["room_id"], plan.seats[1]["slot_id"] = plan.seats[0]["room_id"], plan.seats[0]["slot_id"]


def mutate_seat_blocked(ds, spec, plan):
    seat = next(s for s in plan.seats if ds.rooms[s["room_id"]].blocked_seats)
    seat["row"], seat["col"] = ds.rooms[seat["room_id"]].blocked_seats[0]


def mutate_access(ds, spec, plan):
    seat = next(s for s in plan.seats if ds.students[s["student_id"]].needs_accessible)
    plain = next(r for r in ds.rooms.values() if not r.accessible)
    seat["room_id"] = plain.id


def mutate_coverage(ds, spec, plan):
    target = plan.duties[0]
    plan.duties = [d for d in plan.duties if not (d["slot_id"] == target["slot_id"] and d["room_id"] == target["room_id"])]


def mutate_double(ds, spec, plan):
    duty = next(d for d in plan.duties if d["room_id"])
    other = next(d for d in plan.duties if d["slot_id"] == duty["slot_id"] and d["room_id"] and d["room_id"] != duty["room_id"])
    plan.duties.append({"slot_id": duty["slot_id"], "room_id": other["room_id"], "faculty_id": duty["faculty_id"], "role": "invigilator"})


def mutate_own_course(ds, spec, plan):
    duty = next(d for d in plan.duties if d["room_id"])
    course = plan.courses_in_slot(duty["slot_id"])[0]
    duty["faculty_id"] = ds.courses[course].owner_faculty_id


def mutate_unavailable(ds, spec, plan):
    duty = next(d for d in plan.duties if d["room_id"])
    spec.faculty_unavailable[duty["faculty_id"]] = [duty["slot_id"]]


def mutate_daylimit(ds, spec, plan):
    duty = next(d for d in plan.duties if d["room_id"])
    date = ds.slots[duty["slot_id"]].date
    for index in range(3):
        plan.duties.append({"slot_id": f"{date}-S{1 + index % 2}", "room_id": "ZZ", "faculty_id": duty["faculty_id"], "role": "invigilator"})
    ds.rooms.setdefault("ZZ", ds.rooms[duty["room_id"]])


def mutate_maxduties(ds, spec, plan):
    spec.rules["max_duties"] = 1


def mutate_pin(ds, spec, plan):
    course, slot = next(iter(plan.exams.items()))
    other = next(s for s in ds.usable_slot_ids if s != slot)
    spec.pins[course] = other


MUTATIONS = {
    "H-STU-SLOT-CLASH": mutate_clash,
    "H-STU-DAY-LIMIT": mutate_day,
    "H-ROOM-CAPACITY": mutate_capacity,
    "H-ROOM-BLOCKED": mutate_room_blocked,
    "H-BLOCKED-SLOT": mutate_blocked_slot,
    "H-EXAM-MISSING": mutate_missing_exam,
    "H-SEAT-DUP": mutate_seat_dup,
    "H-SEAT-BLOCKED": mutate_seat_blocked,
    "H-ACCESS": mutate_access,
    "H-INVIG-COVERAGE": mutate_coverage,
    "H-INVIG-DOUBLE": mutate_double,
    "H-INVIG-OWN-COURSE": mutate_own_course,
    "H-INVIG-UNAVAILABLE": mutate_unavailable,
    "H-INVIG-DAYLIMIT": mutate_daylimit,
    "H-INVIG-MAXDUTIES": mutate_maxduties,
    "H-PIN": mutate_pin,
}


@pytest.mark.parametrize("code", sorted(MUTATIONS))
def test_validator_catches_each_corruption(ds, built, code):
    plan = Plan.from_dict(copy.deepcopy(built[0].to_dict()))
    spec = Spec()
    local = copy.copy(ds)
    local.rooms = dict(ds.rooms)
    MUTATIONS[code](local, spec, plan)
    assert code in codes(local, spec, plan)


def test_unmutated_plan_is_clean_for_every_code(ds, built):
    assert codes(ds, Spec(), built[0]) == set()


def test_move_check_is_fast(ds, built):
    plan, _ = built
    started = time.time()
    rows = explain.move_check(ds, Spec(), plan, next(iter(plan.exams)))
    assert time.time() - started < 0.15
    assert {r["status"] for r in rows} <= {"green", "amber", "red"}
    assert len(rows) == len(ds.usable_slot_ids)


def test_planted_conflict_is_diagnosed_with_a_minimal_core(ds, built):
    plan, _ = built
    a, b = first_shared_pair(ds)
    slot = plan.exams[b]
    spec = apply_ops(Spec(), [PinCourse(course_id=a, slot_id=slot), PinCourse(course_id=b, slot_id=slot)])
    with pytest.raises(PlanningError) as caught:
        run_pipeline(ds, spec, plan, CONFIG)
    info = caught.value.diagnosis
    assert {item["group_id"] for item in info["core"]} == {f"pin:{a}", f"pin:{b}"}
    assert info["explanations"] and "share" in info["explanations"][0]
    assert len(info["alternatives"]) >= 2
    assert info["alternatives"][0]["students_affected"] <= info["alternatives"][-1]["students_affected"]


def test_deletion_filter_gives_same_core(ds):
    a, b = first_shared_pair(ds)
    spec = apply_ops(Spec(), [PinCourse(course_id=a, slot_id="2026-12-07-S1"), PinCourse(course_id=b, slot_id="2026-12-07-S1"), BlockDate(date="2026-12-09")])
    core = diagnose.find_core(ds, spec, load_rules(), load_weights(), hard_day=False)
    assert {g.id for g in core} == {f"pin:{a}", f"pin:{b}"}


def test_relaxation_ladder_flags_the_plan(ds, built):
    plan, _ = built
    a, b = first_shared_pair(ds)
    slot = ds.slots[plan.exams[b]]
    other = "S2" if slot.session == "S1" else "S1"
    spec = apply_ops(Spec(), [PinCourse(course_id=a, slot_id=f"{slot.date}-{other}"), PinCourse(course_id=b, slot_id=slot.id)])
    relaxed, _ = run_pipeline(ds, spec, plan, CONFIG)
    assert relaxed.relaxed
    violations = validate(ds, spec, relaxed)
    assert hard_violations(violations) == []
    assert any(v.code == "S-RELAXED-SAMEDAY" for v in violations)


def test_minimal_disruption_when_re_solving(ds, built):
    plan, _ = built
    spec = apply_ops(Spec(), [SetRule(key="max_duties", value=7)])
    again, _ = run_pipeline(ds, spec, plan, CONFIG)
    info = diff_plans(ds, plan, again)
    assert len(info["courses_moved"]) == 0
    assert info["rooms_changed"] == 0


def test_supplementary_students_get_seats(ds, built):
    plan, _ = built
    course = next(iter(plan.exams))
    spec = apply_ops(Spec(), [AddSupplementary(course_id=course, n=6)])
    grown, _ = run_pipeline(ds, spec, plan, CONFIG)
    assert hard_violations(validate(ds, spec, grown)) == []
    assert sum(1 for s in grown.seats if s["student_id"].startswith("SUP-")) == 6


def test_ops_validation_and_whitelist(ds):
    assert validate_ops(ds, parse_ops([{"op": "pin_course", "course_id": "NOPE", "slot_id": "2026-12-07-S1"}]))
    assert validate_ops(ds, parse_ops([{"op": "set_rule", "key": "jwt_secret", "value": 1}]))
    assert not validate_ops(ds, parse_ops([{"op": "set_rule", "key": "max_fill", "value": 0.8}]))


def test_explanations_are_deterministic_facts(ds, built):
    plan, _ = built
    course = next(iter(plan.exams))
    facts = explain.explain_slot(ds, Spec(), plan, course)
    assert facts["facts"] and "students" in facts["facts"][0]
    seat = plan.seats[0]
    assert explain.explain_seat(ds, plan, seat["student_id"])["data"]["seats"]
    duty = next(d for d in plan.duties if d["room_id"])
    assert explain.explain_duty(ds, Spec(), plan, duty["faculty_id"], duty["slot_id"])["facts"]


def test_benchmark_shows_clear_win(ds, built):
    plan, stats = built
    kpis = compute_kpis(ds, Spec(), plan, validate(ds, Spec(), plan), stats)
    rows = {r["name"]: r for r in run_benchmark(ds, kpis, 1.0)}
    assert rows["ExamPilot"]["clashes"] == 0 < rows["Random"]["clashes"]
    assert rows["ExamPilot"]["seating_risk_index"] < rows["Greedy first-fit"]["seating_risk_index"]
    assert rows["ExamPilot"]["mean_gap_days"] > rows["Greedy first-fit"]["mean_gap_days"]
