from __future__ import annotations

import re

from ..models.tables import PlanVersion

SYSTEM = "You write one page executive briefings for a Controller of Examinations. Use only numbers from the JSON. Do not mention dates, identifiers or versions."


def facts_for(pv: PlanVersion, days: int, sessions: int) -> dict:
    kpis = pv.kpis_json
    health = kpis.get("health", {})
    return {
        "courses": kpis.get("courses"),
        "students": kpis.get("students"),
        "exam_days": days,
        "sessions": sessions,
        "clashes": kpis.get("clashes"),
        "hard_violations": kpis.get("hard_violations"),
        "soft_violations": kpis.get("soft_violations"),
        "students_one_exam_per_day_pct": kpis.get("pct_students_one_exam_per_day"),
        "mean_gap_days": kpis.get("mean_gap_days"),
        "rooms_used_per_session": kpis.get("rooms_per_slot_mean"),
        "seat_utilisation_pct": kpis.get("seat_utilisation_pct"),
        "duties_min": kpis.get("duties_min"),
        "duties_max": kpis.get("duties_max"),
        "duties_mean": kpis.get("duties_mean"),
        "seating_risk_index": kpis.get("seating_risk_index"),
        "seating_risk_reduction_pct": kpis.get("seating_risk_reduction_pct"),
        "adjacent_same_course_pairs": kpis.get("adjacent_pairs"),
        "health_score": health.get("score"),
        "relaxed_rules": "yes" if kpis.get("relaxed_rules") else "no",
    }


def variants(value) -> set[str]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return set()
    forms = {str(value), f"{value:.0f}", f"{value:.1f}", f"{value:.2f}"}
    if float(value).is_integer():
        forms.add(str(int(value)))
    return {f.rstrip("0").rstrip(".") if "." in f else f for f in forms} | forms


def allowed_numbers(facts: dict) -> set[str]:
    allowed: set[str] = set()
    for value in facts.values():
        allowed |= variants(value)
    return allowed


def numbers_verified(text: str, facts: dict) -> bool:
    allowed = allowed_numbers(facts)
    for number in re.findall(r"\d+(?:\.\d+)?", text):
        if number not in allowed and number.rstrip("0").rstrip(".") not in allowed:
            return False
    return True


def template_text(facts: dict) -> str:
    risk = f"The seating risk index is {facts['seating_risk_index']} against 100 for random seating, a {facts['seating_risk_reduction_pct']} percent reduction, with {facts['adjacent_same_course_pairs']} adjacent same course pairs. " if facts["seating_risk_index"] is not None else ""
    relaxed = "The plan relaxed the one exam per day rule and needs explicit sign-off. " if facts["relaxed_rules"] == "yes" else "No examination rule was relaxed. "
    return (
        f"The plan schedules {facts['courses']} courses for {facts['students']} students across {facts['exam_days']} exam days and {facts['sessions']} sessions. "
        f"There are {facts['clashes']} student clashes and {facts['hard_violations']} hard violations, with {facts['soft_violations']} soft preferences left unmet. "
        f"{facts['students_one_exam_per_day_pct']} percent of students sit at most one exam a day and the mean gap between a student's exams is {facts['mean_gap_days']} days. "
        f"On average {facts['rooms_used_per_session']} rooms are used per session at {facts['seat_utilisation_pct']} percent seat utilisation. "
        f"Invigilation duties range from {facts['duties_min']} to {facts['duties_max']} per faculty member with a mean of {facts['duties_mean']}. "
        f"{risk}{relaxed}The overall plan health score is {facts['health_score']} out of 100."
    )


def build(pv: PlanVersion, days: int, sessions: int, llm) -> dict:
    facts = facts_for(pv, days, sessions)
    if llm is not None and llm.available():
        import json

        prompt = f"Write a briefing of about 150 words in plain prose, no bullet points, no headings. Facts JSON:\n{json.dumps(facts)}"
        for attempt in range(2):
            try:
                text = llm.complete(prompt + ("" if attempt == 0 else "\nUse only numbers that appear in the JSON."), system=SYSTEM, cache=attempt == 0).strip()
            except Exception:
                break
            if numbers_verified(text, facts):
                return {"text": text, "verified": True, "mode": "llm", "facts": facts}
    text = template_text(facts)
    return {"text": text, "verified": numbers_verified(text, facts), "mode": "template", "facts": facts}
