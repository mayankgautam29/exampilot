from __future__ import annotations

import re
import uuid
from typing import Iterator

from ..db import new_session
from ..engine import explain
from ..engine.validator import validate
from ..models.tables import User
from ..services import audit
from ..services.datasets import load_dataset
from ..services.plans import get_plan, load_plan, published_plan
from . import prompts, rag
from .fallback_parser import HELP_TEXT, interpret
from .llm import LLMError, Message
from .tools import ToolContext, declarations, execute, summarize

MAX_MODEL_CALLS = 4
MAX_TOOL_RUNS = 6


def chunk_words(text: str, size: int = 8) -> list[str]:
    words = text.split(" ")
    return [" ".join(words[i:i + size]) + (" " if i + size < len(words) else "") for i in range(0, len(words), size)]


def log_event(ctx: ToolContext, event: dict) -> dict:
    if event["type"] not in ("tool_call", "tool_result", "answer_delta", "mode"):
        payload = {k: v for k, v in event.items() if k != "type"}
        audit.log(ctx.user.id, ctx.user.role, f"agent.{event['type']}", ctx.run_id, payload, reasoning=str(event.get("rationale", "")))
    return event


def verify_plan(plan_id: int) -> dict:
    with new_session() as session:
        ds = load_dataset(session)
        pv = get_plan(session, plan_id)
        plan, spec = load_plan(pv)
        violations = validate(ds, spec, plan)
        hard = [v.to_dict() for v in violations if v.severity == "hard"]
        stored = pv.kpis_json
        return {
            "plan_id": plan_id,
            "hard_count": len(hard),
            "hard_violations": hard[:8],
            "soft_count": len(violations) - len(hard),
            "kpis_match": stored.get("hard_violations") == len(hard),
            "health": stored.get("health", {}).get("score"),
            "clashes": stored.get("clashes"),
            "valid": len(hard) == 0,
        }


def proposal_answer(result: dict, ops_text: str) -> str:
    diff = result.get("diff") or {}
    moved = diff.get("courses_moved", [])
    lines = [f"I prepared sandbox plan #{result['plan_id']} for: {ops_text}."]
    if moved:
        lines.append("Courses moved: " + "; ".join(f"{m['course_id']} {(m['from'] or '?')[5:]} to {m['to'][5:]} ({m['students']} students)" for m in moved[:6]) + ("." if len(moved) <= 6 else f" and {len(moved) - 6} more."))
    else:
        lines.append("No course had to move.")
    lines.append(f"{diff.get('students_affected', {}).get('count', 0)} students affected, {diff.get('rooms_changed', 0)} room changes, {diff.get('invigilators_changed', {}).get('count', 0)} invigilator changes, {diff.get('seats_changed', 0)} seat changes.")
    health = result.get("health", {}).get("score")
    if result.get("hard_count"):
        lines.append(f"Warning: the validator found {result['hard_count']} hard violations, so this plan cannot be published as it stands.")
    else:
        lines.append(f"The independent validator found 0 hard violations; plan health is {health}.")
    if result.get("relaxed"):
        lines.append("The one exam per day rule had to be relaxed (R-2.3); this needs explicit approval.")
    lines.append("Use Apply to draft, Discard, or Submit for approval.")
    return " ".join(lines)


def infeasible_answer(result: dict) -> str:
    diagnosis = result.get("diagnosis", {})
    lines = [f"That request cannot be satisfied: {result.get('message', 'the constraints conflict')}."]
    for text in diagnosis.get("explanations", []):
        lines.append(text + ".")
    if not diagnosis.get("explanations"):
        for item in diagnosis.get("core", [])[:4]:
            lines.append(f"{item['human_text']} ({item['rule_id']}).")
    alternatives = diagnosis.get("alternatives", [])
    if alternatives:
        lines.append("Ranked alternatives:")
        for option in alternatives:
            lines.append(f"{option['label']}: {option['title']} — {option['courses_moved']} courses move, {option['students_affected']} students affected.")
    return " ".join(lines)


def for_model(name: str, result: dict) -> dict:
    trimmed = {k: v for k, v in result.items() if not k.startswith("_")}
    if "diff" in trimmed and trimmed["diff"]:
        diff = trimmed["diff"]
        trimmed["diff"] = {"courses_moved": diff["courses_moved"][:8], "students_affected": diff["students_affected"]["count"], "rooms_changed": diff["rooms_changed"], "invigilators_changed": diff["invigilators_changed"]["count"], "seats_changed": diff["seats_changed"]}
    if "kpis" in trimmed:
        kpis = trimmed.pop("kpis")
        trimmed["kpi_summary"] = {k: kpis.get(k) for k in ("clashes", "mean_gap_days", "seating_risk_index", "duty_gini")}
    if "diagnosis" in trimmed:
        trimmed["diagnosis"] = {"core": trimmed["diagnosis"].get("core"), "explanations": trimmed["diagnosis"].get("explanations"), "alternatives": [{k: v for k, v in a.items() if k in ("label", "title", "courses_moved", "students_affected", "ops")} for a in trimmed["diagnosis"].get("alternatives", [])]}
    if "scenarios" in trimmed:
        trimmed["scenarios"] = [{k: v for k, v in s.items() if k in ("name", "status", "plan_id", "hard_count", "message")} | {"students_affected": (s.get("diff") or {}).get("students_affected", {}).get("count")} for s in trimmed["scenarios"]]
    return trimmed


def working_plan_exams(ctx: ToolContext) -> tuple:
    with new_session() as session:
        ds = load_dataset(session)
        plan_id = ctx.plan_id or published_plan(session).id
        ctx.plan_id = plan_id
        plan, _ = load_plan(get_plan(session, plan_id))
        return ds, plan, plan_id


def run_tool(ctx: ToolContext, name: str, args: dict) -> Iterator[dict]:
    yield {"type": "tool_call", "name": name, "args": {k: v for k, v in args.items() if k != "rationale"}, "rationale": args.get("rationale", "")}
    result = execute(ctx, name, args)
    yield {"type": "tool_result", "name": name, "summary": summarize(name, result), "latency_ms": result.get("_latency_ms"), "error": result.get("error"), "result": result}


def finish(ctx: ToolContext, answer: str, proposal: dict | None, alternatives: list | None, mode: str, extra: dict | None = None) -> Iterator[dict]:
    for chunk in chunk_words(answer):
        yield {"type": "answer_delta", "text": chunk}
    audit.log(ctx.user.id, ctx.user.role, "agent.answer", ctx.run_id, {"answer": answer[:1500], "proposal": proposal.get("plan_id") if proposal else None})
    yield log_event(ctx, {"type": "done", "answer": answer, "proposal": proposal, "alternatives": alternatives or [], "mode": mode, "run_id": ctx.run_id, **(extra or {})})


def verify_event(ctx: ToolContext, plan_id: int) -> dict:
    return log_event(ctx, {"type": "verify", **verify_plan(plan_id)})


def offline_flow(ctx: ToolContext, message: str) -> Iterator[dict]:
    ds, plan, _ = working_plan_exams(ctx)
    result = interpret(message, ds, ctx.user.role, ctx.user.ref_id, plan.exams)
    kind = result.kind
    if kind == "denied":
        yield log_event(ctx, {"type": "plan", "steps": ["Check who the request is about", "Refuse because it concerns another person"], "rationale": "Privacy rule"})
        audit.log(ctx.user.id, ctx.user.role, "agent.denied", ctx.run_id, {"message": message[:300]})
        yield from finish(ctx, result.message, None, None, "offline")
        return
    if kind == "clarify":
        yield log_event(ctx, {"type": "plan", "steps": ["Resolve the entities in the request", "Ask which one you mean"], "rationale": "The request matches several options"})
        yield log_event(ctx, {"type": "clarify", **result.clarify})
        yield from finish(ctx, result.clarify["question"], None, None, "offline", {"clarify": result.clarify})
        return
    if kind == "unknown":
        yield from finish(ctx, result.message or HELP_TEXT, None, None, "offline")
        return
    if kind == "change":
        steps = ["Understand the request as change operations", "Propose the change on a sandbox copy with minimal disruption", "Verify with the independent validator", "Summarise the impact for approval"]
        yield log_event(ctx, {"type": "plan", "steps": steps, "rationale": "Offline planner"})
        ops_text = "; ".join(f"{op['op']} {', '.join(str(v) for k, v in op.items() if k != 'op')}" for op in result.ops)
        outcome = None
        for event in run_tool(ctx, "propose_changes", {"ops": result.ops, "rationale": "Apply the parsed operations to a sandbox plan"}):
            yield event
            if event["type"] == "tool_result":
                outcome = event["result"]
        if outcome.get("error"):
            yield from finish(ctx, f"I could not prepare that change: {outcome['message']}", None, None, "offline")
            return
        if outcome.get("status") == "invalid":
            yield from finish(ctx, "I could not apply that: " + "; ".join(outcome["errors"]), None, None, "offline")
            return
        if outcome.get("status") == "infeasible":
            diagnosis = outcome.get("diagnosis", {})
            yield from finish(ctx, infeasible_answer(outcome), None, diagnosis.get("alternatives"), "offline", {"diagnosis": diagnosis, "ops": result.ops})
            return
        yield verify_event(ctx, outcome["plan_id"])
        from ..engine.ops import parse_ops

        description = "; ".join(op.describe() for op in parse_ops(result.ops))
        yield from finish(ctx, proposal_answer(outcome, description), outcome, None, "offline")
        return
    if kind in ("explain_slot", "explain_seat", "explain_duty", "summary", "violations", "schedule", "duties"):
        tool_name = {"explain_slot": "explain_slot", "explain_seat": "explain_seat", "explain_duty": "explain_duty", "summary": "get_plan_summary", "violations": "get_violations", "schedule": "get_student_schedule", "duties": "get_faculty_duties"}[kind]
        yield log_event(ctx, {"type": "plan", "steps": ["Read the facts with a tool", "Explain them in plain words"], "rationale": "Read-only request"})
        outcome = None
        for event in run_tool(ctx, tool_name, {**result.args, "rationale": "Read the facts needed to answer"}):
            yield event
            if event["type"] == "tool_result":
                outcome = event["result"]
        if outcome.get("error"):
            yield from finish(ctx, outcome["message"], None, None, "offline")
            return
        yield from finish(ctx, read_answer(kind, outcome, ds), None, None, "offline", {"facts": outcome.get("facts")})
        return
    yield log_event(ctx, {"type": "plan", "steps": ["Search the approved regulations", "Answer only from the retrieved rules"], "rationale": "Policy question"})
    for event in run_tool(ctx, "search_regulations", {"query": result.args["query"], "rationale": "Find the governing rule"}):
        yield event
    answer = rag.answer_question(result.args["query"])
    text = answer["answer"] + ("" if answer["grounded"] else " " + answer["note"])
    yield from finish(ctx, text, None, None, "offline", {"citations": answer["citations"], "grounded": answer["grounded"]})


def read_answer(kind: str, outcome: dict, ds) -> str:
    if kind in ("explain_slot", "explain_seat", "explain_duty"):
        return " ".join(outcome["facts"][:5])
    if kind == "summary":
        health = outcome["health"]
        return f"Plan {outcome['plan_id']} (v{outcome['version']}, {outcome['status']}) has health {health['score']} with {outcome['hard_violations']} hard and {outcome['soft_violations']} soft violations. Seating risk is {outcome['kpis']['seating_risk_index']} versus 100 for random, and invigilation duties range from {outcome['kpis']['duties_min']} to {outcome['kpis']['duties_max']}."
    if kind == "violations":
        if not outcome["hard_count"]:
            return f"There are no hard violations and {outcome['soft_count']} soft preferences unmet."
        return f"{outcome['hard_count']} hard violations: " + "; ".join(v["message"] for v in outcome["hard"][:5])
    if kind == "schedule":
        exams = [e for e in outcome["exams"] if e["slot_id"]]
        if not exams:
            return "No exams are scheduled for you yet."
        first = exams[0]
        rest = "; ".join(f"{e['course_id']} on {e['when']} in {e['room']} seat {e['seat']}" for e in exams[1:5])
        return f"Your next exam is {first['course_id']} ({first['course']}) on {first['when']} at {first['start']} in room {first['room']}, seat {first['seat']}. Then: {rest}."
    duties = outcome["duties"]
    if not duties:
        return "You have no invigilation duties in this plan."
    return "Your duties: " + "; ".join(f"{d['when']} {d['role']} in {d['room'] or 'reliever pool'}" for d in duties[:8]) + "."


def live_flow(ctx: ToolContext, message: str, llm) -> Iterator[dict]:
    ds, plan, plan_id = working_plan_exams(ctx)
    with new_session() as session:
        pv = get_plan(session, plan_id)
        plan_line = f"plan {pv.id} v{pv.version} {pv.status}, health {pv.kpis_json.get('health', {}).get('score')}, {pv.kpis_json.get('hard_violations')} hard violations"
    system = prompts.system_prompt(ctx.user.role)
    scope = f"The signed-in student is {ctx.user.ref_id}.\n" if ctx.user.role == "student" else f"The signed-in faculty member is {ctx.user.ref_id}.\n" if ctx.user.role == "faculty" else ""
    messages = [Message("user", f"{prompts.catalogue(ds, plan_line) if ctx.user.role == 'admin' else ''}\n{scope}User request (untrusted): {message}")]
    tools = declarations(ctx.user.role)
    runs = 0
    proposal: dict | None = None
    alternatives: list = []
    diagnosis: dict = {}
    last_ops: list = []
    answer = ""
    for call_index in range(MAX_MODEL_CALLS):
        force = ["declare_plan"] if call_index == 0 else None
        response = llm.chat(messages, system, tools=tools, force=force)
        ctx.model = response.model
        if not response.tool_calls:
            answer = response.text.strip()
            break
        messages.append(Message("model", response.text, response.tool_calls, raw=response.raw))
        for call in response.tool_calls:
            if runs >= MAX_TOOL_RUNS:
                messages.append(Message("tool", name=call.name, result={"error": "tool_budget", "message": "Tool budget exhausted"}))
                continue
            runs += 1
            if call.name == "declare_plan":
                yield log_event(ctx, {"type": "plan", "steps": call.args.get("steps", []), "rationale": call.args.get("rationale", "")})
            outcome: dict = {}
            for event in run_tool(ctx, call.name, call.args):
                if event["type"] == "tool_call" and call.name == "declare_plan":
                    continue
                yield event
                if event["type"] == "tool_result":
                    outcome = event["result"]
            if call.name == "resolve_entity" and not outcome.get("error") and not outcome.get("confident") and outcome.get("candidates"):
                chips = [{"label": c["label"], "reply": f"{message} (I mean {c['id']})"} for c in outcome["candidates"][:4]]
                clarify = {"question": f"Which {call.args.get('kind', 'item')} do you mean?", "options": chips}
                yield log_event(ctx, {"type": "clarify", **clarify})
                yield from finish(ctx, clarify["question"], None, None, "live", {"clarify": clarify})
                return
            if call.name in ("propose_changes", "simulate_disruption") and outcome.get("status") == "ok":
                proposal = outcome
                yield verify_event(ctx, outcome["plan_id"])
            if call.name == "propose_changes":
                last_ops = call.args.get("ops", [])
            if outcome.get("status") == "infeasible":
                diagnosis = outcome.get("diagnosis", {})
                alternatives = diagnosis.get("alternatives", [])
            messages.append(Message("tool", name=call.name, result=for_model(call.name, outcome)))
    if not answer:
        if proposal:
            answer = proposal_answer(proposal, proposal.get("summary", "your request"))
        elif alternatives:
            answer = "I could not satisfy that request. See the ranked alternatives."
        else:
            answer = "I could not complete that within the step budget. Please rephrase or break the request into smaller parts."
    if proposal and proposal.get("hard_count") and "violation" not in answer.lower():
        answer += f" Warning: the validator found {proposal['hard_count']} hard violations, so this plan cannot be published as it stands."
    yield from finish(ctx, answer, proposal, alternatives, "live", {"model": ctx.model, "diagnosis": diagnosis, "ops": last_ops})


def run_agent(user: User, message: str, plan_id: int | None, llm) -> Iterator[dict]:
    ctx = ToolContext(user=user, plan_id=plan_id, run_id=uuid.uuid4().hex[:10])
    audit.log(user.id, user.role, "agent.request", ctx.run_id, {"message": message[:600]})
    status = llm.status()
    yield {"type": "mode", **status, "run_id": ctx.run_id}
    if llm.available():
        try:
            yield from live_flow(ctx, message, llm)
            return
        except LLMError as error:
            yield log_event(ctx, {"type": "info", "message": f"AI unavailable ({error}); using the offline parser."})
        except Exception as error:
            yield log_event(ctx, {"type": "info", "message": f"AI run failed ({error}); using the offline parser."})
    yield from offline_flow(ctx, message)
