from __future__ import annotations

import io
import zipfile
from datetime import datetime, timezone

import qrcode
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..config import settings
from ..engine.data import Dataset
from ..engine.plan import Plan
from ..models.tables import AuditLog, PlanVersion
from ..api.common import make_token

PALETTE = ["#fecaca", "#fed7aa", "#fde68a", "#d9f99d", "#a7f3d0", "#a5f3fc", "#bfdbfe", "#c7d2fe", "#e9d5ff", "#fbcfe8", "#e5e7eb", "#fef3c7"]


def course_colors(course_ids: list[str]) -> dict[str, str]:
    return {c: PALETTE[i % len(PALETTE)] for i, c in enumerate(sorted(set(course_ids)))}


def build_pdf(story: list, landscape_mode: bool = False) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4) if landscape_mode else A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    doc.build(story)
    return buffer.getvalue()


def table_style(header_color: str = "#1e293b") -> TableStyle:
    return TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(header_color)), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#94a3b8")), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")])


def timetable_pdf(ds: Dataset, plan: Plan, pv: PlanVersion) -> bytes:
    styles = getSampleStyleSheet()
    rows = [["Date", "Session", "Time", "Course", "Name", "Dept", "Students"]]
    for course_id, slot_id in sorted(plan.exams.items(), key=lambda item: (item[1], item[0])):
        slot = ds.slots[slot_id]
        rows.append([slot.date, slot.session, f"{slot.start}-{slot.end}", course_id, ds.courses[course_id].name, ds.courses[course_id].dept, str(ds.size(course_id))])
    table = Table(rows, repeatRows=1)
    table.setStyle(table_style())
    return build_pdf([Paragraph(f"Examination timetable - plan v{pv.version}", styles["Title"]), Paragraph("SYNTHETIC DATA - demonstration only", styles["Normal"]), Spacer(1, 6 * mm), table])


def seating_page(ds: Dataset, plan: Plan, slot_id: str, room_id: str, pdf: canvas.Canvas, width: float, height: float) -> None:
    room = ds.rooms[room_id]
    seats = [s for s in plan.seats if s["slot_id"] == slot_id and s["room_id"] == room_id]
    palette = course_colors([s["course_id"] for s in seats])
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(15 * mm, height - 15 * mm, f"Room {room_id} - {ds.slots[slot_id].label} ({ds.slots[slot_id].date})")
    names = ", ".join(ds.faculty[d["faculty_id"]].name + (" (chief)" if d["role"] == "chief" else "") for d in plan.duties if d["slot_id"] == slot_id and d["room_id"] == room_id)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(15 * mm, height - 20 * mm, f"Invigilators: {names}")
    cell_w = min(22 * mm, (width - 30 * mm) / (room.cols + len(room.aisle_cols)))
    cell_h = min(11 * mm, (height - 70 * mm) / room.rows)
    top = height - 30 * mm
    by_pos = {(s["row"], s["col"]): s for s in seats}
    for row in range(room.rows):
        for col in range(room.cols):
            x = 15 * mm + (col + room.aisle_shift(col)) * cell_w
            y = top - (row + 1) * cell_h
            seat = by_pos.get((row, col))
            blocked = [row, col] in room.blocked_seats
            pdf.setFillColor(colors.HexColor(palette[seat["course_id"]]) if seat else colors.HexColor("#9ca3af" if blocked else "#ffffff"))
            pdf.rect(x, y, cell_w, cell_h, fill=1, stroke=1)
            pdf.setFillColor(colors.black)
            pdf.setFont("Helvetica", 5.5)
            if seat:
                pdf.drawCentredString(x + cell_w / 2, y + cell_h / 2 + 1, seat["student_id"][4:])
                pdf.drawCentredString(x + cell_w / 2, y + 2, f"{row + 1}-{col + 1}")
    legend_y = 14 * mm
    pdf.setFont("Helvetica", 7)
    for index, (course_id, color) in enumerate(palette.items()):
        pdf.setFillColor(colors.HexColor(color))
        pdf.rect(15 * mm + index * 34 * mm, legend_y, 4 * mm, 4 * mm, fill=1)
        pdf.setFillColor(colors.black)
        pdf.drawString(20 * mm + index * 34 * mm, legend_y + 1, course_id)
    pdf.showPage()


def seating_pdf(ds: Dataset, plan: Plan, slot_id: str | None, room_id: str | None, allowed: set[tuple[str, str]] | None = None) -> bytes:
    buffer = io.BytesIO()
    page = landscape(A4)
    pdf = canvas.Canvas(buffer, pagesize=page)
    keys = sorted(plan.room_students())
    for key in keys:
        if slot_id and key[0] != slot_id or room_id and key[1] != room_id:
            continue
        if allowed is not None and key not in allowed:
            continue
        seating_page(ds, plan, key[0], key[1], pdf, page[0], page[1])
    pdf.save()
    return buffer.getvalue()


def attendance_pdf(ds: Dataset, plan: Plan, slot_id: str, room_id: str) -> bytes:
    styles = getSampleStyleSheet()
    seats = sorted((s for s in plan.seats if s["slot_id"] == slot_id and s["room_id"] == room_id), key=lambda s: (s["row"], s["col"]))
    rows = [["Seat", "Roll no", "Name", "Course", "Signature"]]
    for seat in seats:
        student = ds.students[seat["student_id"]]
        rows.append([f"{seat['row'] + 1}-{seat['col'] + 1}", student.roll_no, student.name, seat["course_id"], ""])
    table = Table(rows, repeatRows=1, colWidths=[18 * mm, 32 * mm, 55 * mm, 25 * mm, 45 * mm], rowHeights=[8 * mm] + [7 * mm] * (len(rows) - 1))
    table.setStyle(table_style())
    return build_pdf([Paragraph(f"Attendance sheet - Room {room_id}, {ds.slots[slot_id].label} ({ds.slots[slot_id].date})", styles["Title"]), table])


def roster_pdf(ds: Dataset, plan: Plan) -> bytes:
    styles = getSampleStyleSheet()
    rows = [["Date", "Session", "Room", "Role", "Faculty", "Dept"]]
    for duty in sorted(plan.duties, key=lambda d: (d["slot_id"], d["room_id"] or "~", d["role"], d["faculty_id"])):
        slot = ds.slots[duty["slot_id"]]
        faculty = ds.faculty[duty["faculty_id"]]
        rows.append([slot.date, slot.session, duty["room_id"] or "Reliever pool", duty["role"], faculty.name, faculty.dept])
    table = Table(rows, repeatRows=1)
    table.setStyle(table_style())
    return build_pdf([Paragraph("Invigilator roster", styles["Title"]), table])


def qr_reader(url: str) -> ImageReader:
    image = qrcode.make(url)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return ImageReader(buffer)


def hallticket_pdf(ds: Dataset, plan: Plan, plan_id: int, student_id: str) -> bytes:
    student = ds.students[student_id]
    buffer = io.BytesIO()
    page = A4
    pdf = canvas.Canvas(buffer, pagesize=page)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(18 * mm, page[1] - 20 * mm, "HALL TICKET")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(18 * mm, page[1] - 26 * mm, "SYNTHETIC DATA - demonstration only")
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(18 * mm, page[1] - 36 * mm, f"{student.name}   Roll no: {student.roll_no}")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(18 * mm, page[1] - 42 * mm, f"Department: {student.dept}   Semester: {student.semester}   Section: {student.section}")
    if student.extra_time_pct:
        pdf.drawString(18 * mm, page[1] - 48 * mm, f"Extra time: {student.extra_time_pct}% - seated in a quiet room")
    seats = {s["course_id"]: s for s in plan.seats if s["student_id"] == student_id}
    y = page[1] - 62 * mm
    for course_id in sorted(ds.enrollments[student_id], key=lambda c: plan.exams.get(c, "")):
        slot_id = plan.exams.get(course_id)
        seat = seats.get(course_id)
        if not slot_id or not seat:
            continue
        slot = ds.slots[slot_id]
        pdf.setStrokeColor(colors.HexColor("#94a3b8"))
        pdf.rect(18 * mm, y - 24 * mm, page[0] - 36 * mm, 28 * mm)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(22 * mm, y - 2 * mm, f"{course_id} - {ds.courses[course_id].name}")
        pdf.setFont("Helvetica", 9)
        pdf.drawString(22 * mm, y - 9 * mm, f"{slot.date} ({slot.label.split(' ')[0]})  {slot.start} - {slot.end}")
        pdf.drawString(22 * mm, y - 15 * mm, f"Room {seat['room_id']}   Seat {seat['row'] + 1}-{seat['col'] + 1}   Report 30 minutes early")
        url = f"{settings.frontend_origins[0]}/verify/{make_token(plan_id, student_id, course_id)}"
        pdf.drawImage(qr_reader(url), page[0] - 50 * mm, y - 22 * mm, 24 * mm, 24 * mm)
        y -= 32 * mm
        if y < 30 * mm:
            pdf.showPage()
            y = page[1] - 30 * mm
    pdf.save()
    return buffer.getvalue()


def halltickets_zip(ds: Dataset, plan: Plan, plan_id: int) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for student_id in sorted({s["student_id"] for s in plan.seats}):
            archive.writestr(f"{student_id}.pdf", hallticket_pdf(ds, plan, plan_id, student_id))
    return buffer.getvalue()


def ics_escape(text: str) -> str:
    slash = chr(92)
    return text.replace(",", slash + ",").replace(";", slash + ";")


def ics_event(uid: str, summary: str, date: str, start: str, end: str, location: str) -> list[str]:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    begin = f"{date.replace('-', '')}T{start.replace(':', '')}00"
    finish = f"{date.replace('-', '')}T{end.replace(':', '')}00"
    return ["BEGIN:VEVENT", f"UID:{uid}@exampilot.demo", f"DTSTAMP:{stamp}", f"DTSTART:{begin}", f"DTEND:{finish}", f"SUMMARY:{ics_escape(summary)}", f"LOCATION:{ics_escape(location)}", "END:VEVENT"]


def student_ics(ds: Dataset, plan: Plan, student_id: str) -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ExamPilot//Demo//EN"]
    seats = {s["course_id"]: s for s in plan.seats if s["student_id"] == student_id}
    for course_id in ds.enrollments[student_id]:
        slot_id, seat = plan.exams.get(course_id), seats.get(course_id)
        if slot_id and seat:
            slot = ds.slots[slot_id]
            lines += ics_event(f"{student_id}-{course_id}", f"Exam: {ds.courses[course_id].name}", slot.date, slot.start, slot.end, f"Room {seat['room_id']} seat {seat['row'] + 1}-{seat['col'] + 1}")
    return "\r\n".join(lines + ["END:VCALENDAR"]) + "\r\n"


def faculty_ics(ds: Dataset, plan: Plan, faculty_id: str) -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ExamPilot//Demo//EN"]
    for duty in plan.duties:
        if duty["faculty_id"] == faculty_id:
            slot = ds.slots[duty["slot_id"]]
            where = f"Room {duty['room_id']}" if duty["room_id"] else "Reliever pool"
            lines += ics_event(f"{faculty_id}-{duty['slot_id']}", f"Invigilation ({duty['role']})", slot.date, slot.start, slot.end, where)
    return "\r\n".join(lines + ["END:VCALENDAR"]) + "\r\n"


def style_sheet(sheet, headers: list[str], rows: list[list]) -> None:
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1E293B")
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    for index, header in enumerate(headers, start=1):
        longest = max([len(str(header))] + [len(str(r[index - 1])) for r in rows[:300]])
        sheet.column_dimensions[get_column_letter(index)].width = min(60, longest + 3)


def plan_xlsx(ds: Dataset, plan: Plan, pv: PlanVersion, audit_rows: list[AuditLog]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Timetable"
    style_sheet(sheet, ["Course", "Name", "Dept", "Date", "Session", "Start", "End", "Students"], [[c, ds.courses[c].name, ds.courses[c].dept, ds.slots[s].date, ds.slots[s].session, ds.slots[s].start, ds.slots[s].end, ds.size(c)] for c, s in sorted(plan.exams.items(), key=lambda i: (i[1], i[0]))])
    style_sheet(workbook.create_sheet("RoomAllocation"), ["Date", "Session", "Room", "Course", "Group", "Students"], [[ds.slots[a["slot_id"]].date, ds.slots[a["slot_id"]].session, a["room_id"], a["course_id"], a["group"], len(a["students"])] for a in plan.allocations])
    style_sheet(workbook.create_sheet("Seating"), ["Date", "Session", "Room", "Roll no", "Course", "Row", "Col"], [[ds.slots[s["slot_id"]].date, ds.slots[s["slot_id"]].session, s["room_id"], s["student_id"], s["course_id"], s["row"] + 1, s["col"] + 1] for s in plan.seats])
    style_sheet(workbook.create_sheet("Invigilation"), ["Date", "Session", "Room", "Role", "Faculty", "Name"], [[ds.slots[d["slot_id"]].date, ds.slots[d["slot_id"]].session, d["room_id"] or "reliever", d["role"], d["faculty_id"], ds.faculty[d["faculty_id"]].name] for d in plan.duties])
    style_sheet(workbook.create_sheet("Violations"), ["Code", "Severity", "Rule", "Message"], [[v["code"], v["severity"], v["rule_id"], v["message"]] for v in pv.violations_json])
    style_sheet(workbook.create_sheet("KPIs"), ["KPI", "Value"], [[k, str(v)] for k, v in pv.kpis_json.items() if k not in ("stage_seconds",)])
    style_sheet(workbook.create_sheet("Audit"), ["Id", "Time", "Role", "Action", "Entity", "Reasoning"], [[a.id, a.ts.isoformat(), a.role, a.action, a.entity, a.reasoning] for a in audit_rows])
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
