import io
import zipfile

import pytest
from openpyxl import load_workbook
from pypdf import PdfReader
from sqlmodel import select

from app.db import new_session
from app.models.tables import Notification, PlanVersion, SeatAssignment
from .helpers import published, wait_job


def test_login_and_me(client, admin):
    me = client.get("/auth/me", headers=admin).json()
    assert me["role"] == "admin"
    assert client.post("/auth/login", json={"email": "admin@jklu.demo", "password": "wrong"}).status_code == 401
    assert client.get("/plans").status_code == 401


ADMIN_ONLY = [("get", "/plans"), ("get", "/approvals"), ("get", "/audit"), ("get", "/audit/verify"), ("get", "/outbox"), ("get", "/benchmark/run"), ("get", "/disruptions"), ("get", "/export/plan.xlsx"), ("get", "/export/roster.pdf"), ("get", "/export/halltickets.zip"), ("post", "/plans/1/publish"), ("post", "/plans/1/approve"), ("post", "/agent/chat")]


@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_student_and_faculty_get_403_on_admin_endpoints(client, student, faculty, method, path):
    for headers in (student, faculty):
        response = client.request(method.upper(), path, headers=headers, json={"message": "x"} if method == "post" else None)
        assert response.status_code == 403, (path, response.status_code)


def test_cross_user_access_is_denied(client, admin, student, student2, faculty):
    plan = published(client, admin)
    own = client.get("/me/exams", headers=student).json()["student"]["id"]
    other = client.get("/me/exams", headers=student2).json()["student"]["id"]
    assert client.get(f"/plans/{plan['id']}/explain/seat", params={"student": other}, headers=student).status_code == 403
    assert client.get(f"/export/hallticket/{other}.pdf", headers=student).status_code == 403
    assert client.get(f"/export/hallticket/{own}.pdf", headers=student).status_code == 200
    rooms = client.get(f"/plans/{plan['id']}/rooms", params={"slot": "2026-12-07-S1"}, headers=faculty)
    assert rooms.status_code == 200
    assert client.get(f"/plans/{plan['id']}/seating", params={"slot": "2026-12-07-S1", "room": "A101"}, headers=student).status_code in (403,)
    assert client.get("/me/duties", headers=student).status_code == 403
    assert client.get("/me/exams", headers=faculty).status_code == 403


def test_published_plan_is_valid_and_healthy(client, admin):
    plan = published(client, admin)
    assert plan["hard_violations"] == 0
    assert plan["kpis"]["health"]["score"] >= 85
    assert plan["kpis"]["seating_risk_index"] <= 15
    assert plan["kpis"]["duties_max"] - plan["kpis"]["duties_min"] <= 2
    proof = client.get(f"/plans/{plan['id']}/validate", headers=admin).json()
    assert proof["publishable"] and all(c["passed"] for c in proof["checks"])


def seed_draft(client, admin):
    return next(p for p in client.get("/plans", params={"status": "DRAFT"}, headers=admin).json() if p["origin"] == "seed")


def test_state_machine_rejects_skipping_steps(client, admin):
    draft = seed_draft(client, admin)
    assert client.post(f"/plans/{draft['id']}/publish", headers=admin).status_code == 409
    assert client.post(f"/plans/{draft['id']}/approve", headers=admin).status_code == 409
    assert client.post(f"/plans/{draft['id']}/reject", json={"reason": " "}, headers=admin).status_code in (409, 422)


def test_publish_is_blocked_for_a_plan_with_an_injected_violation(client, admin):
    base = published(client, admin)
    clone = client.post(f"/plans/{base['id']}/rollback", headers=admin).json()
    assert clone["status"] == "PENDING_APPROVAL"
    with new_session() as session:
        pv = session.get(PlanVersion, clone["id"])
        data = dict(pv.data_json)
        data["seats"] = data["seats"][1:]
        pv.data_json = data
        session.add(pv)
        session.commit()
    assert client.post(f"/plans/{clone['id']}/approve", headers=admin).status_code == 200
    response = client.post(f"/plans/{clone['id']}/publish", headers=admin)
    assert response.status_code == 409
    assert response.json()["detail"]["violations"]
    assert client.get(f"/plans/{clone['id']}", headers=admin).json()["status"] == "APPROVED"
    entries = client.get("/audit", params={"action": "plan.publish_blocked"}, headers=admin).json()
    assert entries


def test_optimistic_locking_and_rejection_reason(client, admin):
    draft = seed_draft(client, admin)
    assert client.post(f"/plans/{draft['id']}/submit", headers={**admin, "If-Match": "99"}).status_code == 409
    submitted = client.post(f"/plans/{draft['id']}/submit", headers={**admin, "If-Match": str(draft["row_version"])})
    assert submitted.status_code == 200 and submitted.json()["status"] == "PENDING_APPROVAL"
    assert client.post(f"/plans/{draft['id']}/reject", json={"reason": ""}, headers=admin).status_code == 422
    rejected = client.post(f"/plans/{draft['id']}/reject", json={"reason": "Needs another look"}, headers=admin).json()
    assert rejected["status"] == "REJECTED" and rejected["rejection_reason"] == "Needs another look"
    assert client.post(f"/plans/{draft['id']}/submit", headers=admin).status_code == 200


def test_approval_inbox_shows_diff_and_checklist(client, admin):
    inbox = client.get("/approvals", headers=admin).json()
    assert inbox
    item = inbox[0]
    assert "diff" in item and "checklist" in item and "health" in item


def test_full_lifecycle_publish_notifies_and_supersedes(client, admin, student):
    pending = [p for p in client.get("/plans", headers=admin).json() if p["status"] == "PENDING_APPROVAL" and p["origin"] == "seed"]
    plan = pending[0]
    before = client.get("/outbox", headers=admin).json()["total"]
    approved = client.post(f"/plans/{plan['id']}/approve", headers=admin)
    assert approved.status_code == 200 and approved.json()["status"] == "APPROVED"
    result = client.post(f"/plans/{plan['id']}/publish", headers=admin)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "PUBLISHED"
    assert result.json()["notifications_sent"] >= 1
    assert client.get("/outbox", headers=admin).json()["total"] > before
    statuses = [p["status"] for p in client.get("/plans", headers=admin).json()]
    assert statuses.count("PUBLISHED") == 1 and "SUPERSEDED" in statuses
    assert client.get("/me/exams", headers=student).json()["plan_id"] == plan["id"]


def test_seating_view_and_explanations(client, admin):
    plan = published(client, admin)
    rooms = client.get(f"/plans/{plan['id']}/rooms", params={"slot": "2026-12-07-S1"}, headers=admin).json()
    assert rooms
    first = rooms[0]
    grid = client.get(f"/plans/{plan['id']}/seating", params={"slot": "2026-12-07-S1", "room": first["room_id"]}, headers=admin).json()
    assert grid["optimised"]["risk"] <= grid["random"]["risk"]
    assert len(grid["optimised"]["students"]) == len(grid["random"]["students"]) == first["students"]
    student_id = grid["optimised"]["students"][0]["student_id"]
    seat = client.get(f"/plans/{plan['id']}/explain/seat", params={"student": student_id}, headers=admin).json()
    assert seat["facts"] and seat["text"]
    course = grid["optimised"]["students"][0]["course_id"]
    assert client.get(f"/plans/{plan['id']}/explain/slot", params={"course": course}, headers=admin).json()["data"]["alternatives"] is not None
    moves = client.get(f"/plans/{plan['id']}/move-check", params={"course": course}, headers=admin).json()
    assert len(moves) == 18


def test_exports_open_and_contain_expected_rows(client, admin, student):
    plan = published(client, admin)
    timetable = PdfBytes(client.get("/export/timetable.pdf", headers=admin))
    assert "Examination timetable" in timetable.text()
    seating = PdfBytes(client.get("/export/seating.pdf", params={"slot": "2026-12-07-S1"}, headers=admin))
    assert "Room" in seating.text()
    xlsx = load_workbook(io.BytesIO(client.get("/export/plan.xlsx", headers=admin).content))
    assert {"Timetable", "RoomAllocation", "Seating", "Invigilation", "Violations", "KPIs", "Audit"} <= set(xlsx.sheetnames)
    assert xlsx["Timetable"].max_row > 80 and xlsx["Timetable"].freeze_panes == "A2"
    roster = PdfBytes(client.get("/export/roster.pdf", headers=admin))
    assert "Invigilator roster" in roster.text()
    exams = client.get("/me/exams", headers=student).json()
    roll = exams["student"]["id"]
    ticket = PdfBytes(client.get(f"/export/hallticket/{roll}.pdf", headers=student))
    assert roll in ticket.text() and "HALL TICKET" in ticket.text()
    ics = client.get("/export/calendar/me.ics", headers=student).text
    assert ics.count("BEGIN:VEVENT") == len(exams["exams"])
    zipped = zipfile.ZipFile(io.BytesIO(client.get("/export/halltickets.zip", headers=admin).content))
    assert len(zipped.namelist()) > 600


class PdfBytes:
    def __init__(self, response):
        assert response.status_code == 200, response.text
        self.reader = PdfReader(io.BytesIO(response.content))

    def text(self) -> str:
        return " ".join(page.extract_text() for page in self.reader.pages)


def test_hall_ticket_token_verifies_and_rejects_forgeries(client, student):
    first = client.get("/me/exams", headers=student).json()["exams"][0]
    good = client.get(f"/verify/{first['token']}").json()
    assert good["valid"] and good["course_id"] == first["course_id"] and good["room"] == first["room_id"] and good["seat"] == first["seat"]
    payload, _, signature = first["token"].partition(".")
    assert not client.get(f"/verify/{payload}.{'0' * len(signature)}").json()["valid"]
    assert not client.get("/verify/garbage").json()["valid"]


def test_faculty_views(client, faculty):
    duties = client.get("/me/duties", headers=faculty).json()["duties"]
    assert duties
    roster = client.get("/plans/1/roster", headers=faculty)
    assert roster.status_code in (200, 403)


def test_disruption_creates_hotfix_that_needs_approval_then_notifies(client, admin):
    plan = published(client, admin)
    detail = client.get(f"/plans/{plan['id']}/roster", headers=admin).json()
    person = next(f for f in detail["faculty"] if any(d["room_id"] for d in f["duties"]))
    duty = next(d for d in person["duties"] if d["room_id"])
    started = client.post("/disruptions", json={"kind": "invigilator_absent", "faculty_id": person["faculty_id"], "slot_id": duty["slot_id"]}, headers=admin)
    assert started.status_code == 200, started.text
    done = wait_job(client, admin, started.json()["job_id"])
    assert done["type"] == "done", done
    hotfix = client.get(f"/plans/{done['plan_id']}", headers=admin).json()
    assert hotfix["kind"] == "hotfix" and hotfix["status"] == "PENDING_APPROVAL" and hotfix["hard_violations"] == 0
    assert done["replacements"] and done["replacements"][0]["from"] == person["faculty_id"]
    assert client.get("/plans", params={"status": "PUBLISHED"}, headers=admin).json()[0]["id"] == plan["id"]
    before = client.get("/outbox", headers=admin).json()["total"]
    assert client.post(f"/plans/{hotfix['id']}/approve", headers=admin).status_code == 200
    assert client.post(f"/plans/{hotfix['id']}/publish", headers=admin).status_code == 200
    assert client.get("/outbox", headers=admin).json()["total"] > before


def test_swap_request_prechecks_and_goes_through_approval(client, admin, faculty):
    duties = client.get("/me/duties", headers=faculty).json()["duties"]
    mine = next(d for d in duties if d["room_id"])
    request = client.post("/swaps", json={"slot_id": mine["slot_id"], "reason": "Medical appointment"}, headers=faculty)
    assert request.status_code == 200
    assert "feasible" in request.json()["precheck"]
    listing = client.get("/swaps", headers=admin).json()
    assert any(s["id"] == request.json()["id"] for s in listing)
    approved = client.post(f"/swaps/{request.json()['id']}/approve", headers=admin)
    assert approved.status_code == 200
    assert client.get(f"/plans/{approved.json()['plan_id']}", headers=admin).json()["status"] == "PENDING_APPROVAL"


def test_scenario_lab_compares_three_and_adopts_one(client, admin):
    base = published(client, admin)
    bodies = [
        {"name": "Room G1 floods", "text": "room G1 unavailable on 2026-12-08 afternoon"},
        {"name": "Extra students", "ops": [{"op": "add_supplementary", "course_id": "OE101", "n": 8}]},
        {"name": "Fresh invigilation", "ops": [{"op": "regenerate", "scope": "invigilation"}]},
    ]
    jobs = [client.post("/scenarios", json=body, headers=admin).json()["job_id"] for body in bodies]
    ids = []
    for job in jobs:
        done = wait_job(client, admin, job)
        assert done["type"] == "done", done
        ids.append(done["plan_id"])
    table = client.get("/scenarios/compare", params={"ids": ",".join(map(str, ids))}, headers=admin).json()["rows"]
    assert len(table) == 3 and all(r["hard_violations"] == 0 for r in table)
    adopted = client.post(f"/scenarios/{ids[0]}/adopt", headers=admin).json()
    assert adopted["kind"] == "full" and adopted["status"] == "DRAFT"
    assert published(client, admin)["id"] == base["id"]


def test_generate_streams_solver_progress(client, admin):
    started = client.post("/plans/generate", json={"label": "Fresh run"}, headers=admin).json()
    done = wait_job(client, admin, started["job_id"])
    assert done["type"] == "done", done
    stages = [e["stage"] for e in done["all_events"] if e["type"] == "stage" and e["status"] == "done"]
    assert stages == ["timetable", "venues", "invigilation", "seating"]
    assert any(e["type"] == "progress" and "objective" in e for e in done["all_events"])
    plan = client.get(f"/plans/{done['plan_id']}", headers=admin).json()
    assert plan["hard_violations"] == 0 and plan["status"] == "DRAFT"


def test_benchmark_and_briefing(client, admin):
    rows = {r["name"]: r for r in client.get("/benchmark/run", headers=admin).json()["rows"]}
    assert rows["ExamPilot"]["clashes"] == 0 < rows["Random"]["clashes"]
    plan = published(client, admin)
    brief = client.get(f"/plans/{plan['id']}/briefing", headers=admin).json()
    assert brief["verified"] and brief["text"]


def test_regulation_endpoint_cites_or_refuses(client, student):
    good = client.post("/agent/regulations/ask", json={"question": "Can I use a mobile phone?"}, headers=student).json()
    assert good["grounded"] and "R-7.4" in good["answer"]
    refused = client.post("/agent/regulations/ask", json={"question": "What is the hostel fee?"}, headers=student).json()
    assert refused["answer"] == "Not covered in the approved regulations."


def test_audit_chain_is_valid_and_records_reasoning(client, admin):
    assert client.get("/audit/verify", headers=admin).json()["valid"]
    actions = {row["action"] for row in client.get("/audit", params={"limit": 500}, headers=admin).json()}
    assert {"auth.login", "plan.publish", "plan.approve", "solver.run", "plan.validate"} <= actions
    export = client.get("/audit/export", params={"format": "csv"}, headers=admin)
    assert export.status_code == 200 and "action" in export.text.splitlines()[0]
