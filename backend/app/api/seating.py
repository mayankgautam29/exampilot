from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from ..agent import rag
from ..agent.llm import llm
from ..db import get_session
from ..deps import admin_only, current_user
from ..engine import explain
from ..engine.rules import load_rules
from ..engine.seating import SeatStudent, pair_matrix, random_seats, weight_matrix
from ..models.tables import User
from ..services import audit, plans
from ..services.datasets import load_dataset

import numpy as np

router = APIRouter(tags=["seating"])


def rephrase(result: dict) -> str:
    template = explain.render_template(result)
    if not llm.available():
        return template
    facts = " ".join(result["facts"])
    try:
        text = llm.complete("Rewrite these facts as 2 or 3 clear sentences for an administrator. Add nothing that is not stated.\n" + facts, cache=True).strip()
    except Exception:
        return template
    return text if rag.numbers_in(text) <= rag.numbers_in(facts) else template


def allowed_room(plan, user: User, slot_id: str, room_id: str) -> None:
    if user.role == "admin":
        return
    if user.role == "faculty" and any(d["faculty_id"] == user.ref_id and d["slot_id"] == slot_id and d["room_id"] == room_id for d in plan.duties):
        return
    raise HTTPException(403, "You may only view seating charts of rooms you invigilate")


@router.get("/plans/{plan_id}/rooms")
def rooms_in_slot(plan_id: int, slot: str = Query(...), session: Session = Depends(get_session), user: User = Depends(current_user)) -> list[dict]:
    if user.role == "student":
        raise HTTPException(403, "Students cannot list rooms")
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, _ = plans.load_plan(pv)
    stats = {(s["slot_id"], s["room_id"]): s for s in plan.seat_stats}
    counts = plan.room_course_counts()
    result = []
    for (slot_id, room_id), by_course in sorted(counts.items()):
        if slot_id != slot:
            continue
        if user.role == "faculty" and not any(d["faculty_id"] == user.ref_id and d["slot_id"] == slot_id and d["room_id"] == room_id for d in plan.duties):
            continue
        stat = stats.get((slot_id, room_id), {})
        room = ds.rooms[room_id]
        chiefs = [d["faculty_id"] for d in plan.duties if d["slot_id"] == slot_id and d["room_id"] == room_id]
        result.append({"room_id": room_id, "students": sum(by_course.values()), "seats": room.seat_count, "courses": by_course, "risk": stat.get("risk"), "adjacent_pairs": stat.get("adjacent_pairs"), "accessible": room.accessible, "quiet": room.quiet, "invigilators": chiefs})
    return result


@router.get("/plans/{plan_id}/seating")
def seating(plan_id: int, slot: str = Query(...), room: str = Query(...), session: Session = Depends(get_session), user: User = Depends(current_user)) -> dict:
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, spec = plans.load_plan(pv)
    allowed_room(plan, user, slot, room)
    supplemented = ds.with_supplementary(spec.supplementary)
    room_obj = ds.rooms[room]
    seats = [s for s in plan.seats if s["slot_id"] == slot and s["room_id"] == room]
    students = [{"row": s["row"], "col": s["col"], "student_id": s["student_id"], "name": supplemented.students[s["student_id"]].name, "course_id": s["course_id"], "section": supplemented.students[s["student_id"]].section, "accessible": supplemented.students[s["student_id"]].needs_accessible, "extra_time": supplemented.students[s["student_id"]].extra_time_pct > 0} for s in seats]
    members: list[SeatStudent] = [(s["student_id"], s["course_id"], supplemented.students[s["student_id"]].section, supplemented.students[s["student_id"]].needs_accessible) for s in seats]
    stat = next((s for s in plan.seat_stats if s["slot_id"] == slot and s["room_id"] == room), {})
    rules = load_rules(spec.rules)
    free = room_obj.free_seats()
    index = {seat: i for i, seat in enumerate(free)}
    weights = weight_matrix(room_obj, free, rules)
    matrix = pair_matrix(members, rules)
    drawn = random_seats(room_obj, members, 7)
    draw = np.array([index[drawn[m[0]]] for m in members], dtype=int)
    random_penalty = float((matrix * weights[np.ix_(draw, draw)]).sum() / 2) if members else 0.0
    baseline = stat.get("baseline") or 0.0
    random_students = [{**student, "row": drawn[student["student_id"]][0], "col": drawn[student["student_id"]][1]} for student in students]
    return {
        "plan_id": plan_id,
        "slot_id": slot,
        "room": {"id": room, "rows": room_obj.rows, "cols": room_obj.cols, "blocked_seats": room_obj.blocked_seats, "aisle_cols": room_obj.aisle_cols, "accessible": room_obj.accessible, "quiet": room_obj.quiet},
        "optimised": {"students": students, "risk": stat.get("risk"), "adjacent_pairs": stat.get("adjacent_pairs"), "penalty": stat.get("penalty")},
        "random": {"students": random_students, "risk": round(100 * random_penalty / baseline, 1) if baseline else 100.0},
        "invigilators": [{"faculty_id": d["faculty_id"], "name": ds.faculty[d["faculty_id"]].name, "role": d["role"]} for d in plan.duties if d["slot_id"] == slot and d["room_id"] == room],
    }


@router.get("/plans/{plan_id}/explain/{kind}")
def explain_endpoint(plan_id: int, kind: str, course: str | None = None, student: str | None = None, faculty: str | None = None, slot: str | None = None, session: Session = Depends(get_session), user: User = Depends(current_user)) -> dict:
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, spec = plans.load_plan(pv)
    if kind == "seat":
        if student is None:
            raise HTTPException(422, "student is required")
        if user.role != "admin" and user.ref_id != student:
            raise HTTPException(403, "You can only ask about your own seat")
        result = explain.explain_seat(ds, plan, student, slot)
    elif kind == "slot":
        if user.role != "admin":
            raise HTTPException(403, "Admin only")
        if course not in plan.exams:
            raise HTTPException(404, "Unknown course")
        result = explain.explain_slot(ds, spec, plan, course)
    elif kind == "duty":
        if faculty is None or slot is None:
            raise HTTPException(422, "faculty and slot are required")
        if user.role == "student" or (user.role == "faculty" and user.ref_id != faculty):
            raise HTTPException(403, "Not allowed")
        result = explain.explain_duty(ds, spec, plan, faculty, slot)
    else:
        raise HTTPException(404, "kind must be seat, slot or duty")
    result["text"] = rephrase(result)
    audit.log(user.id, user.role, f"explain.{kind}", f"plan:{plan_id}", {"course": course, "student": student, "faculty": faculty, "slot": slot})
    return result
