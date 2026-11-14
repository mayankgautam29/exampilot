from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlmodel import Session, select

from ..db import get_session
from ..deps import admin_only, current_user
from ..models.tables import AuditLog, User
from ..services import audit, exports, plans
from ..services.datasets import load_dataset
from .common import published_or_404

router = APIRouter(prefix="/export", tags=["exports"])


def pick_plan(session: Session, plan_id: int | None, user: User):
    pv = plans.get_plan(session, plan_id) if plan_id else published_or_404(session)
    if user.role != "admin" and pv.status != "PUBLISHED":
        raise HTTPException(403, "Only the published plan can be exported by your role")
    return pv


def file_response(content: bytes | str, media_type: str, name: str) -> Response:
    return Response(content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/timetable.pdf")
def timetable_pdf(plan_id: int | None = None, session: Session = Depends(get_session), user: User = Depends(current_user)) -> Response:
    pv = pick_plan(session, plan_id, user)
    plan, spec = plans.load_plan(pv)
    audit.log(user.id, user.role, "export.timetable", f"plan:{pv.id}", {})
    return file_response(exports.timetable_pdf(load_dataset(session).with_supplementary(spec.supplementary), plan, pv), "application/pdf", "timetable.pdf")


def allowed_rooms(plan, user: User) -> set[tuple[str, str]] | None:
    if user.role == "admin":
        return None
    if user.role == "faculty":
        return {(d["slot_id"], d["room_id"]) for d in plan.duties if d["faculty_id"] == user.ref_id and d["room_id"]}
    raise HTTPException(403, "Students cannot export seating charts")


@router.get("/seating.pdf")
def seating_pdf(plan_id: int | None = None, slot: str | None = None, room: str | None = None, session: Session = Depends(get_session), user: User = Depends(current_user)) -> Response:
    pv = pick_plan(session, plan_id, user)
    plan, spec = plans.load_plan(pv)
    allowed = allowed_rooms(plan, user)
    audit.log(user.id, user.role, "export.seating", f"plan:{pv.id}", {"slot": slot, "room": room})
    ds = load_dataset(session).with_supplementary(spec.supplementary)
    return file_response(exports.seating_pdf(ds, plan, slot, room, allowed), "application/pdf", "seating.pdf")


@router.get("/attendance.pdf")
def attendance_pdf(slot: str, room: str, plan_id: int | None = None, session: Session = Depends(get_session), user: User = Depends(current_user)) -> Response:
    pv = pick_plan(session, plan_id, user)
    plan, spec = plans.load_plan(pv)
    allowed = allowed_rooms(plan, user)
    if allowed is not None and (slot, room) not in allowed:
        raise HTTPException(403, "You may only export rooms you invigilate")
    audit.log(user.id, user.role, "export.attendance", f"plan:{pv.id}", {"slot": slot, "room": room})
    return file_response(exports.attendance_pdf(load_dataset(session).with_supplementary(spec.supplementary), plan, slot, room), "application/pdf", f"attendance-{room}-{slot}.pdf")


@router.get("/roster.pdf")
def roster_pdf(plan_id: int | None = None, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> Response:
    pv = pick_plan(session, plan_id, user)
    plan, _ = plans.load_plan(pv)
    audit.log(user.id, user.role, "export.roster", f"plan:{pv.id}", {})
    return file_response(exports.roster_pdf(load_dataset(session), plan), "application/pdf", "roster.pdf")


@router.get("/plan.xlsx")
def plan_xlsx(plan_id: int | None = None, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> Response:
    pv = pick_plan(session, plan_id, user)
    plan, spec = plans.load_plan(pv)
    rows = session.exec(select(AuditLog).order_by(AuditLog.id.desc()).limit(500)).all()
    audit.log(user.id, user.role, "export.xlsx", f"plan:{pv.id}", {})
    return file_response(exports.plan_xlsx(load_dataset(session).with_supplementary(spec.supplementary), plan, pv, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "plan.xlsx")


@router.get("/hallticket/{student_id}.pdf")
def hallticket(student_id: str, plan_id: int | None = None, session: Session = Depends(get_session), user: User = Depends(current_user)) -> Response:
    if user.role != "admin" and user.ref_id != student_id:
        raise HTTPException(403, "You can only download your own hall ticket")
    pv = pick_plan(session, plan_id, user)
    plan, spec = plans.load_plan(pv)
    ds = load_dataset(session).with_supplementary(spec.supplementary)
    if student_id not in ds.students:
        raise HTTPException(404, "Unknown student")
    audit.log(user.id, user.role, "export.hallticket", f"plan:{pv.id}", {"student": student_id})
    return file_response(exports.hallticket_pdf(ds, plan, pv.id, student_id), "application/pdf", f"hallticket-{student_id}.pdf")


@router.get("/halltickets.zip")
def halltickets(plan_id: int | None = None, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> Response:
    pv = pick_plan(session, plan_id, user)
    plan, spec = plans.load_plan(pv)
    audit.log(user.id, user.role, "export.halltickets", f"plan:{pv.id}", {})
    return file_response(exports.halltickets_zip(load_dataset(session).with_supplementary(spec.supplementary), plan, pv.id), "application/zip", "halltickets.zip")


@router.get("/calendar/{user_id}.ics")
def calendar(user_id: str, session: Session = Depends(get_session), user: User = Depends(current_user)) -> Response:
    target = user if user_id == "me" else session.get(User, int(user_id)) if user_id.isdigit() else None
    if target is None:
        raise HTTPException(404, "Unknown user")
    if user.role != "admin" and target.id != user.id:
        raise HTTPException(403, "You can only download your own calendar")
    pv = published_or_404(session)
    plan, _ = plans.load_plan(pv)
    ds = load_dataset(session)
    if target.role == "student":
        body = exports.student_ics(ds, plan, target.ref_id)
    elif target.role == "faculty":
        body = exports.faculty_ics(ds, plan, target.ref_id)
    else:
        raise HTTPException(422, "Admins have no personal calendar")
    audit.log(user.id, user.role, "export.calendar", f"user:{target.id}", {})
    return file_response(body, "text/calendar", "exams.ics")
