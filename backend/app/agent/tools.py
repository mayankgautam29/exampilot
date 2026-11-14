from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable

from pydantic import BaseModel, Field, ValidationError
from rapidfuzz import fuzz, process

from ..db import new_session
from ..engine import explain
from ..engine.diff import diff_plans
from ..engine.disruption import build_disruption
from ..engine.ops import parse_ops
from ..models.tables import User
from ..services import audit
from ..services.datasets import load_dataset
from ..services.plans import get_plan, load_plan, plan_summary, published_plan
from ..services.planner import build_plan
from . import rag
from .llm import ToolSpec


class ToolError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ToolContext:
    user: User
    plan_id: int | None
    run_id: str = ""
    model: str = ""
    proposals: list[int] | None = None

    def remember(self, plan_id: int) -> None:
        if self.proposals is None:
            self.proposals = []
        self.proposals.append(plan_id)


class Rationale(BaseModel):
    rationale: str = Field(default="", description="One short sentence explaining why this tool is being called")


class DeclarePlan(Rationale):
    steps: list[str] = Field(min_length=1, max_length=8, description="Ordered checklist of the steps you will take")


class NoArgs(Rationale):
    pass


class ViolationsArgs(Rationale):
    limit: int = Field(default=20, ge=1, le=50)


class ResolveArgs(Rationale):
    kind: str = Field(description="course, room, faculty, student or slot")
    text: str


class CourseArgs(Rationale):
    course: str = Field(description="Course id such as CSE301")


class StudentArgs(Rationale):
    student: str = Field(description="Student roll number such as JK26CSE014")


class SeatArgs(StudentArgs):
    slot: str | None = Field(default=None, description="Optional slot id")


class DutyArgs(Rationale):
    faculty: str
    slot: str


class FacultyArgs(Rationale):
    faculty: str


class SearchArgs(Rationale):
    query: str


class CompareArgs(Rationale):
    a: int
    b: int


class ProposeArgs(Rationale):
    ops: list[dict] = Field(min_length=1, description="List of change operations, each with an 'op' field")
    label: str = ""


class DisruptionArgs(Rationale):
    kind: str = Field(description="invigilator_absent, room_unavailable or date_blocked")
    faculty_id: str | None = None
    room_id: str | None = None
    slot_id: str | None = None
    date: str | None = None


class ScenarioItem(BaseModel):
    name: str
    ops: list[dict]


class ScenarioArgs(Rationale):
    scenarios: list[ScenarioItem] = Field(min_length=1, max_length=4)


OPS_HELP = (
    "Each op is one of: "
    '{"op":"pin_course","course_id","slot_id"}, {"op":"unpin_course","course_id"}, {"op":"forbid_slots","course_id","slot_ids"}, '
    '{"op":"block_room","room_id","slot_ids"}, {"op":"block_date","date"}, {"op":"faculty_unavailable","faculty_id","slot_ids"}, '
    '{"op":"add_supplementary","course_id","n"}, {"op":"set_rule","key","value"}, {"op":"regenerate","scope"}. Slot ids look like 2026-12-07-S1.'
)


@dataclass
class Tool:
    name: str
    description: str
    model: type[BaseModel]
    roles: set[str]
    handler: Callable[[ToolContext, BaseModel], dict]
    kind: str = "read"


REGISTRY: dict[str, Tool] = {}


def tool(name: str, description: str, model: type[BaseModel], roles: set[str], kind: str = "read"):
    def register(func: Callable[[ToolContext, BaseModel], dict]):
        REGISTRY[name] = Tool(name, description, model, roles, func, kind)
        return func

    return register


ALL = {"admin", "faculty", "student"}
ADMIN = {"admin"}


def working_plan(ctx: ToolContext, session) -> tuple:
    plan_id = ctx.plan_id
    if plan_id is None:
        published = published_plan(session)
        if published is None:
            raise ToolError("no_plan", "There is no plan yet")
        plan_id = published.id
    pv = get_plan(session, plan_id)
    plan, spec = load_plan(pv)
    return pv, plan, spec


def own_only(ctx: ToolContext, target: str) -> None:
    if ctx.user.role != "admin" and ctx.user.ref_id != target:
        raise ToolError("permission_denied", "You can only access your own records")


@tool("declare_plan", "Declare the ordered checklist of steps you will take before acting. Always call this first.", DeclarePlan, ALL)
def declare_plan(ctx: ToolContext, args: DeclarePlan) -> dict:
    return {"steps": args.steps}


@tool("get_plan_summary", "Get status, KPIs, health score and violation counts of the working plan.", NoArgs, ADMIN)
def get_plan_summary(ctx: ToolContext, args: NoArgs) -> dict:
    with new_session() as session:
        pv, _, _ = working_plan(ctx, session)
        summary = plan_summary(pv)
        return {"plan_id": pv.id, "version": pv.version, "status": pv.status, "kpis": pv.kpis_json, "health": pv.kpis_json.get("health"), "hard_violations": summary["hard_violations"], "soft_violations": summary["soft_violations"]}


@tool("get_violations", "List hard and soft constraint violations of the working plan.", ViolationsArgs, ADMIN)
def get_violations(ctx: ToolContext, args: ViolationsArgs) -> dict:
    with new_session() as session:
        pv, _, _ = working_plan(ctx, session)
        hard = [v for v in pv.violations_json if v["severity"] == "hard"]
        soft = [v for v in pv.violations_json if v["severity"] == "soft"]
        return {"hard_count": len(hard), "soft_count": len(soft), "hard": hard[: args.limit], "soft": soft[: args.limit]}


def candidates_for(ds, kind: str, text: str) -> list[dict]:
    if kind == "course":
        pool = {c.id: f"{c.id} {c.name}" for c in ds.courses.values()}
    elif kind == "room":
        pool = {r.id: r.id for r in ds.rooms.values()}
    elif kind == "faculty":
        pool = {f.id: f"{f.id} {f.name}" for f in ds.faculty.values()}
    elif kind == "slot":
        pool = {s.id: f"{s.id} {s.label}" for s in ds.slots.values() if not s.blocked}
    else:
        raise ToolError("invalid_arguments", "kind must be course, room, faculty or slot")
    matches = process.extract(text, pool, scorer=fuzz.WRatio, limit=4)
    return [{"id": key, "label": label, "score": round(score, 1)} for label, score, key in matches]


@tool("resolve_entity", "Fuzzy match free text to a course, room, faculty member or slot. Returns candidates with confidence.", ResolveArgs, ADMIN)
def resolve_entity(ctx: ToolContext, args: ResolveArgs) -> dict:
    with new_session() as session:
        ds = load_dataset(session)
    found = candidates_for(ds, args.kind, args.text)
    confident = bool(found) and found[0]["score"] >= 85 and (len(found) == 1 or found[0]["score"] - found[1]["score"] >= 8 or found[0]["score"] >= 99)
    return {"candidates": found, "best": found[0]["id"] if confident else None, "confident": confident}


@tool("list_free_slots", "List every slot for a course with feasibility colour (green, amber, red), reason and students affected.", CourseArgs, ADMIN)
def list_free_slots(ctx: ToolContext, args: CourseArgs) -> dict:
    with new_session() as session:
        ds = load_dataset(session)
        _, plan, spec = working_plan(ctx, session)
        if args.course not in ds.courses:
            raise ToolError("unknown_entity", f"Unknown course {args.course}")
        rows = explain.move_check(ds, spec, plan, args.course)
    usable = [r for r in rows if r["status"] != "red"]
    return {"course": args.course, "current_slot": plan.exams.get(args.course), "options": usable[:10], "blocked_count": len(rows) - len(usable)}


@tool("get_student_schedule", "Get a student's exam schedule with room and seat. Students may only read their own.", StudentArgs, ALL)
def get_student_schedule(ctx: ToolContext, args: StudentArgs) -> dict:
    own_only(ctx, args.student)
    with new_session() as session:
        ds = load_dataset(session)
        _, plan, spec = working_plan(ctx, session)
        if args.student not in ds.students:
            raise ToolError("unknown_entity", f"Unknown student {args.student}")
        seats = {s["course_id"]: s for s in plan.seats if s["student_id"] == args.student}
        exams = []
        for course_id in ds.enrollments[args.student]:
            slot_id = plan.exams.get(course_id)
            seat = seats.get(course_id)
            exams.append({"course_id": course_id, "course": ds.courses[course_id].name, "slot_id": slot_id, "when": ds.slots[slot_id].label if slot_id else None, "date": ds.slots[slot_id].date if slot_id else None, "start": ds.slots[slot_id].start if slot_id else None, "room": seat["room_id"] if seat else None, "seat": f"{seat['row'] + 1}-{seat['col'] + 1}" if seat else None})
        exams.sort(key=lambda e: (e["slot_id"] or "9"))
        return {"student": args.student, "exams": exams}


@tool("explain_slot", "Explain why a course sits in its slot, with conflicts and the best alternatives and cost deltas.", CourseArgs, ADMIN)
def explain_slot_tool(ctx: ToolContext, args: CourseArgs) -> dict:
    with new_session() as session:
        ds = load_dataset(session)
        _, plan, spec = working_plan(ctx, session)
        if args.course not in plan.exams:
            raise ToolError("unknown_entity", f"Unknown course {args.course}")
        return explain.explain_slot(ds, spec, plan, args.course)


@tool("explain_seat", "Explain a student's seat. Students may only ask about themselves.", SeatArgs, ALL)
def explain_seat_tool(ctx: ToolContext, args: SeatArgs) -> dict:
    own_only(ctx, args.student)
    with new_session() as session:
        ds = load_dataset(session)
        _, plan, _ = working_plan(ctx, session)
        if args.student not in ds.students:
            raise ToolError("unknown_entity", f"Unknown student {args.student}")
        return explain.explain_seat(ds, plan, args.student, args.slot)


@tool("explain_duty", "Explain why a faculty member holds a duty in a slot.", DutyArgs, {"admin", "faculty"})
def explain_duty_tool(ctx: ToolContext, args: DutyArgs) -> dict:
    own_only(ctx, args.faculty)
    with new_session() as session:
        ds = load_dataset(session)
        _, plan, spec = working_plan(ctx, session)
        if args.faculty not in ds.faculty or args.slot not in ds.slots:
            raise ToolError("unknown_entity", "Unknown faculty or slot")
        return explain.explain_duty(ds, spec, plan, args.faculty, args.slot)


@tool("get_faculty_duties", "List a faculty member's invigilation duties.", FacultyArgs, {"admin", "faculty"})
def get_faculty_duties(ctx: ToolContext, args: FacultyArgs) -> dict:
    own_only(ctx, args.faculty)
    with new_session() as session:
        ds = load_dataset(session)
        _, plan, _ = working_plan(ctx, session)
        if args.faculty not in ds.faculty:
            raise ToolError("unknown_entity", f"Unknown faculty {args.faculty}")
        duties = [{"slot_id": d["slot_id"], "when": ds.slots[d["slot_id"]].label, "room": d["room_id"], "role": d["role"]} for d in plan.duties if d["faculty_id"] == args.faculty]
        return {"faculty": args.faculty, "duties": sorted(duties, key=lambda d: d["slot_id"])}


@tool("search_regulations", "Search the approved regulations. This is the only allowed source for policy answers.", SearchArgs, ALL)
def search_regulations(ctx: ToolContext, args: SearchArgs) -> dict:
    return rag.search(args.query)


@tool("compare_plans", "Compare two plan versions by id.", CompareArgs, ADMIN)
def compare_plans(ctx: ToolContext, args: CompareArgs) -> dict:
    with new_session() as session:
        ds = load_dataset(session)
        a, b = get_plan(session, args.a), get_plan(session, args.b)
        plan_a, _ = load_plan(a)
        plan_b, spec_b = load_plan(b)
        info = diff_plans(ds.with_supplementary(spec_b.supplementary), plan_a, plan_b, a.kpis_json, b.kpis_json)
        return {key: info[key] for key in ("courses_moved", "rooms_changed", "students_affected", "invigilators_changed", "seats_changed", "kpi_deltas")}


@tool("propose_changes", "Apply change operations to a sandbox copy of the working plan and re-plan with minimal disruption. " + OPS_HELP, ProposeArgs, ADMIN, "propose")
def propose_changes(ctx: ToolContext, args: ProposeArgs) -> dict:
    try:
        ops = parse_ops(args.ops)
    except ValidationError as error:
        raise ToolError("invalid_arguments", f"Operations are malformed: {error.errors()[0]['msg']} at {error.errors()[0]['loc']}")
    with new_session() as session:
        _, _, _ = working_plan(ctx, session)
        base_id = ctx.plan_id or published_plan(session).id
    result = build_plan(ctx.user.id, ctx.user.role, base_id, ops, args.label or "; ".join(op.describe() for op in ops)[:120], "agent", "scenario")
    if result.get("status") == "ok":
        ctx.remember(result["plan_id"])
    return result


@tool("simulate_disruption", "Simulate an invigilator absence, an unavailable room or a blocked date and produce a sandbox hotfix plan.", DisruptionArgs, ADMIN, "propose")
def simulate_disruption(ctx: ToolContext, args: DisruptionArgs) -> dict:
    with new_session() as session:
        ds = load_dataset(session)
        base_id = ctx.plan_id or published_plan(session).id
    try:
        change = build_disruption(ds, args.kind, args.model_dump())
    except (KeyError, ValueError) as error:
        raise ToolError("invalid_arguments", f"Disruption arguments are incomplete: {error}")
    result = build_plan(ctx.user.id, ctx.user.role, base_id, change.ops, f"Simulation: {change.summary}", "agent", "hotfix", only_slots=change.only_slots)
    if result.get("status") == "ok":
        ctx.remember(result["plan_id"])
    result["summary"] = change.summary
    return result


@tool("create_scenarios", "Create up to four what-if scenarios, each a list of change operations, and solve them in parallel.", ScenarioArgs, ADMIN, "propose")
def create_scenarios(ctx: ToolContext, args: ScenarioArgs) -> dict:
    with new_session() as session:
        base_id = ctx.plan_id or published_plan(session).id

    def solve(item: ScenarioItem) -> dict:
        try:
            ops = parse_ops(item.ops)
        except ValidationError as error:
            return {"name": item.name, "status": "invalid", "errors": [str(error.errors()[0]["msg"])]}
        result = build_plan(ctx.user.id, ctx.user.role, base_id, ops, item.name, "scenario", "scenario")
        result["name"] = item.name
        return result

    with ThreadPoolExecutor(max_workers=len(args.scenarios)) as pool:
        results = list(pool.map(solve, args.scenarios))
    for result in results:
        if result.get("status") == "ok":
            ctx.remember(result["plan_id"])
    return {"scenarios": results}


def declarations(role: str) -> list[ToolSpec]:
    specs = []
    for item in REGISTRY.values():
        if role in item.roles:
            schema = item.model.model_json_schema()
            schema.pop("title", None)
            specs.append(ToolSpec(item.name, item.description, schema))
    return specs


def summarize(name: str, result: dict) -> str:
    if "error" in result:
        return f"error: {result['message']}"
    if name == "propose_changes" or name == "simulate_disruption":
        if result.get("status") == "ok":
            diff = result.get("diff") or {}
            return f"plan {result['plan_id']}: {len(diff.get('courses_moved', []))} courses moved, {diff.get('students_affected', {}).get('count', 0)} students affected, {result['hard_count']} hard violations"
        return result.get("message") or "; ".join(result.get("errors", [])) or result.get("status", "")
    if name == "resolve_entity":
        return f"best match {result['best']}" if result["best"] else "ambiguous: " + ", ".join(c["id"] for c in result["candidates"][:3])
    if name == "search_regulations":
        return "found " + ", ".join(c["id"] for c in result["chunks"]) if result["grounded"] else "no grounded match"
    if name == "get_plan_summary":
        return f"plan {result['plan_id']} {result['status']}, health {result['health']['score']}, {result['hard_violations']} hard violations"
    if name == "create_scenarios":
        return f"{sum(1 for s in result['scenarios'] if s.get('status') == 'ok')} of {len(result['scenarios'])} scenarios solved"
    if name in ("explain_slot", "explain_seat", "explain_duty"):
        return result["facts"][0] if result["facts"] else "no facts"
    return "ok"


def execute(ctx: ToolContext, name: str, args: dict) -> dict:
    started = time.time()
    item = REGISTRY.get(name)
    if item is None:
        result = {"error": "unknown_tool", "message": f"No tool named {name}"}
    elif ctx.user.role not in item.roles:
        result = {"error": "permission_denied", "message": f"Your role ({ctx.user.role}) may not use {name}"}
        audit.log(ctx.user.id, ctx.user.role, "agent.tool_denied", ctx.run_id, {"tool": name, "args": args})
    else:
        try:
            parsed = item.model(**args)
            result = item.handler(ctx, parsed)
        except ValidationError as error:
            first = error.errors()[0]
            result = {"error": "invalid_arguments", "message": f"{'.'.join(str(p) for p in first['loc'])}: {first['msg']}"}
        except ToolError as error:
            result = {"error": error.code, "message": error.message}
        except Exception as error:
            result = {"error": "tool_failed", "message": str(error)}
    latency = round((time.time() - started) * 1000)
    audit.log(ctx.user.id, ctx.user.role, "agent.tool_call", ctx.run_id, {"tool": name, "args": args, "summary": summarize(name, result), "latency_ms": latency, "model": ctx.model, "error": result.get("error")}, reasoning=str(args.get("rationale", "")))
    result["_latency_ms"] = latency
    return result
