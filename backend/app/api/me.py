from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..deps import current_user, require_role
from ..models.tables import User
from ..services import audit, plans
from ..services.datasets import load_dataset
from .common import make_token, published_or_404, read_token

router = APIRouter(tags=["me"])


def student_exams(session: Session, student_id: str) -> tuple[list[dict], int]:
    pv = published_or_404(session)
    ds = load_dataset(session)
    plan, _ = plans.load_plan(pv)
    seats = {s["course_id"]: s for s in plan.seats if s["student_id"] == student_id}
    exams = []
    for course_id in ds.enrollments.get(student_id, []):
        slot_id = plan.exams.get(course_id)
        seat = seats.get(course_id)
        if not slot_id or not seat:
            continue
        slot = ds.slots[slot_id]
        exams.append({"course_id": course_id, "course": ds.courses[course_id].name, "slot_id": slot_id, "date": slot.date, "session": slot.session, "start": slot.start, "end": slot.end, "label": slot.label, "room_id": seat["room_id"], "row": seat["row"], "col": seat["col"], "seat": f"{seat['row'] + 1}-{seat['col'] + 1}", "token": make_token(pv.id, student_id, course_id)})
    exams.sort(key=lambda e: e["slot_id"])
    return exams, pv.id


@router.get("/me/exams")
def my_exams(session: Session = Depends(get_session), user: User = Depends(require_role("student"))) -> dict:
    exams, plan_id = student_exams(session, user.ref_id)
    ds = load_dataset(session)
    student = ds.students[user.ref_id]
    return {"plan_id": plan_id, "student": {"id": student.id, "name": student.name, "dept": student.dept, "semester": student.semester, "section": student.section, "extra_time_pct": student.extra_time_pct, "needs_accessible": student.needs_accessible}, "exams": exams}


@router.get("/me/seat")
def my_seat(slot: str, session: Session = Depends(get_session), user: User = Depends(require_role("student"))) -> dict:
    exams, _ = student_exams(session, user.ref_id)
    mine = next((e for e in exams if e["slot_id"] == slot), None)
    if mine is None:
        raise HTTPException(404, "You have no exam in that session")
    room = load_dataset(session).rooms[mine["room_id"]]
    return {"room": {"id": room.id, "rows": room.rows, "cols": room.cols, "blocked_seats": room.blocked_seats, "aisle_cols": room.aisle_cols}, "seat": {"row": mine["row"], "col": mine["col"]}, "course_id": mine["course_id"]}


@router.get("/me/duties")
def my_duties(session: Session = Depends(get_session), user: User = Depends(require_role("faculty"))) -> dict:
    pv = published_or_404(session)
    ds = load_dataset(session)
    plan, _ = plans.load_plan(pv)
    duties = []
    for d in plan.duties:
        if d["faculty_id"] != user.ref_id:
            continue
        slot = ds.slots[d["slot_id"]]
        courses = sorted({a["course_id"] for a in plan.allocations if a["slot_id"] == d["slot_id"] and a["room_id"] == d["room_id"]}) if d["room_id"] else []
        duties.append({"slot_id": d["slot_id"], "date": slot.date, "label": slot.label, "start": slot.start, "end": slot.end, "room_id": d["room_id"], "role": d["role"], "courses": courses})
    duties.sort(key=lambda d: d["slot_id"])
    faculty = ds.faculty[user.ref_id]
    return {"plan_id": pv.id, "faculty": {"id": faculty.id, "name": faculty.name, "dept": faculty.dept, "rank": faculty.rank}, "duties": duties}


@router.get("/verify/{token}")
def verify_ticket(token: str, session: Session = Depends(get_session)) -> dict:
    parsed = read_token(token)
    if parsed is None:
        audit.log(None, "public", "ticket.invalid", "verify", {})
        return {"valid": False, "reason": "The signature on this ticket does not match"}
    plan_id, student_id, course_id = parsed
    pv = plans.get_plan(session, plan_id)
    ds = load_dataset(session)
    plan, _ = plans.load_plan(pv)
    seat = next((s for s in plan.seats if s["student_id"] == student_id and s["course_id"] == course_id), None)
    if seat is None or student_id not in ds.students:
        return {"valid": False, "reason": "No such seat in this plan"}
    slot = ds.slots[plan.exams[course_id]]
    current = pv.status == "PUBLISHED"
    audit.log(None, "public", "ticket.verified", f"plan:{plan_id}", {"roll": student_id, "course": course_id})
    return {"valid": True, "current": current, "roll_no": student_id, "course_id": course_id, "course": ds.courses[course_id].name, "date": slot.date, "start": slot.start, "end": slot.end, "room": seat["room_id"], "seat": f"{seat['row'] + 1}-{seat['col'] + 1}", "plan_version": pv.version, "reason": "" if current else "This ticket belongs to a plan version that is no longer published"}
