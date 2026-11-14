from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from rapidfuzz import fuzz

from ..engine.data import Dataset

MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
          "january": 1, "february": 2, "march": 3, "april": 4, "june": 6, "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12}
WEEKDAYS = {"monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2, "thursday": 3, "thu": 3, "thur": 3, "thurs": 3, "friday": 4, "fri": 4}
MORNING = r"\b(morning|forenoon|s1|first session|am)\b"
AFTERNOON = r"\b(afternoon|evening|s2|second session|pm)\b"
FILLER = set("""move shift schedule reschedule pin unpin put place hold please can could would you the a an to on at for of in my this that exam exams examination paper
room rooms unavailable blocked block date dates faculty professor prof dr mr ms mrs absent leave sick available not be is are will with and also then
supplementary students student add set max maximum per day days regenerate re roll run it its make from into onto during session week next first second last following
forbid avoid never do dont don't cannot can't invigilate invigilating invigilator duty closed flood flooded maintenance out order cancel holiday no remove release""".split())
QUESTION_START = re.compile(r"^(what|when|where|who|which|how|why|is|are|does|do|should|tell me|explain|show|give me|list)\b")
COMMAND = re.compile(r"\b(move|shift|reschedule|schedule|pin|unpin|block|forbid|regenerate|re-?roll|re-?run|set max|put|place|add \d+)\b|\b(unavailable|absent|on leave|flooded?|out of order|not available)\b")

HELP_TEXT = (
    "I can change the plan (for example: move CSE301 to Tuesday morning; room G1 unavailable on 2026-12-08 afternoon; faculty F05 unavailable on 2026-12-09; "
    "add 10 supplementary students to OE101; regenerate seating; set max exams per day to 2), explain it (why is CSE301 on that day?), "
    "show a summary, or answer policy questions from the regulations."
)


@dataclass
class Interpretation:
    kind: str
    ops: list[dict] = field(default_factory=list)
    clarify: dict | None = None
    args: dict = field(default_factory=dict)
    message: str = ""


class Context:
    def __init__(self, ds: Dataset, exams: dict[str, str]):
        self.ds = ds
        self.exams = exams
        self.dates = sorted({s.date for s in ds.slots.values() if not s.blocked})
        self.year = int(self.dates[0][:4]) if self.dates else date.today().year

    def slot_ids(self, day: str, session: str | None) -> list[str]:
        wanted = [session] if session else ["S1", "S2"]
        return [f"{day}-{s}" for s in wanted if f"{day}-{s}" in self.ds.slots]


def detect_session(text: str) -> str | None:
    if re.search(MORNING, text):
        return "S1"
    if re.search(AFTERNOON, text):
        return "S2"
    return None


def find_dates(text: str, ctx: Context) -> list[str]:
    found = re.findall(r"\d{4}-\d{2}-\d{2}", text)
    if found:
        return found[:1]
    for match in re.finditer(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b", text):
        month = MONTHS.get(match.group(2))
        if month:
            return [date(ctx.year, month, int(match.group(1))).isoformat()]
    for match in re.finditer(r"\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b", text):
        month = MONTHS.get(match.group(1))
        if month:
            return [date(ctx.year, month, int(match.group(2))).isoformat()]
    slash = re.search(r"\b(\d{1,2})/(\d{1,2})\b", text)
    if slash:
        return [date(ctx.year, int(slash.group(2)), int(slash.group(1))).isoformat()]
    for word, weekday in WEEKDAYS.items():
        if re.search(rf"\b{word}\b", text):
            matches = [d for d in ctx.dates if date.fromisoformat(d).weekday() == weekday]
            if len(matches) > 1:
                if re.search(r"\b(second|2nd|next|following|week 2|later)\b", text):
                    return [matches[1]]
                if re.search(r"\b(last|final)\b", text):
                    return [matches[-1]]
                return [matches[0]]
            return matches
    return []


def substitute_course_names(text: str, ds: Dataset) -> str:
    for course in sorted(ds.courses.values(), key=lambda c: -len(c.name)):
        text = re.sub(re.escape(course.name), course.id, text, flags=re.I)
    return text


def content_tokens(clause: str, ctx: Context) -> list[str]:
    tokens = re.findall(r"[a-z0-9]+", clause.lower())
    ignored = FILLER | set(MONTHS) | set(WEEKDAYS) | {"morning", "afternoon", "evening", "forenoon", "s1", "s2", "am", "pm"}
    room_ids = {r.lower() for r in ctx.ds.rooms}
    return [t for t in tokens if t not in ignored and not t.isdigit() and t not in room_ids and not re.fullmatch(r"[a-z]{2,3}\d{3}|f\d{2}|jk26\w+", t)]


def score_tokens(tokens: list[str], name: str) -> float:
    name_tokens = [t for t in re.findall(r"[a-z0-9]+", name.lower()) if t != "dr"]
    scores = []
    for token in tokens:
        best = max((fuzz.partial_ratio(token, nt) if len(token) >= 3 else (100 if token == nt else 0)) for nt in name_tokens)
        scores.append(best)
    return sum(scores) / len(scores) if scores else 0.0


def pick(candidates: list[tuple[str, float]]) -> tuple[str | None, list[str]]:
    good = sorted((c for c in candidates if c[1] >= 85), key=lambda c: -c[1])
    if not good:
        return None, []
    if len(good) == 1 or good[0][1] - good[1][1] >= 10:
        return good[0][0], []
    top = good[0][1]
    return None, [c[0] for c in good if top - c[1] < 10][:4]


def find_course(clause: str, ctx: Context) -> tuple[str | None, list[str]]:
    codes = [c.upper() for c in re.findall(r"\b[a-z]{2,3}\d{3}\b", clause.lower()) if c.upper() in ctx.ds.courses]
    if codes:
        return codes[0], []
    tokens = content_tokens(clause, ctx)
    if not tokens:
        return None, []
    return pick([(c.id, score_tokens(tokens, c.name)) for c in ctx.ds.courses.values()])


def find_faculty(clause: str, ctx: Context) -> tuple[str | None, list[str]]:
    codes = [c.upper() for c in re.findall(r"\bf\d{2}\b", clause.lower()) if c.upper() in ctx.ds.faculty]
    if codes:
        return codes[0], []
    tokens = content_tokens(clause, ctx)
    if not tokens:
        return None, []
    return pick([(f.id, score_tokens(tokens, f.name)) for f in ctx.ds.faculty.values()])


def find_rooms(clause: str, ctx: Context) -> list[str]:
    return [r for r in ctx.ds.rooms if re.search(rf"\b{re.escape(r.lower())}\b", clause.lower())]


def clarify_entity(kind: str, options: list[str], message: str, phrase_hint: str, ctx: Context) -> Interpretation:
    chips = []
    for option in options:
        label = f"{option} {ctx.ds.courses[option].name}" if kind == "course" else f"{option} {ctx.ds.faculty[option].name}"
        chips.append({"label": label, "reply": re.sub(re.escape(phrase_hint), option, message, count=1, flags=re.I) if phrase_hint else f"{message} {option}"})
    return Interpretation("clarify", clarify={"question": f"Which {kind} do you mean?", "options": chips})


def phrase_of(clause: str, ctx: Context) -> str:
    tokens = content_tokens(clause, ctx)
    return " ".join(tokens)


def clause_ops(clause: str, message: str, verb_hint: str | None, ctx: Context) -> Interpretation:
    text = clause.lower().strip()
    dates = find_dates(text, ctx)
    session = detect_session(text)
    rooms = find_rooms(text, ctx)
    if re.search(r"\bunpin\b|\bremove (the )?pin\b|\brelease\b", text):
        course, options = find_course(text, ctx)
        if options:
            return clarify_entity("course", options, message, phrase_of(text, ctx), ctx)
        if course is None:
            return Interpretation("unknown", message="Which course should be unpinned?")
        return Interpretation("change", ops=[{"op": "unpin_course", "course_id": course}])
    if re.search(r"\bregenerate\b|\bre-?roll\b|\bre-?run\b|\bre-?shuffle\b", text):
        scope = "seating" if re.search(r"seat", text) else "invigilation" if re.search(r"invigilat|duty|duties", text) else "timetable" if re.search(r"timetable|schedule|slots", text) else "all"
        return Interpretation("change", ops=[{"op": "regenerate", "scope": scope}])
    if "supplementary" in text:
        count = re.search(r"\b(\d+)\b", text)
        course, options = find_course(text, ctx)
        if options:
            return clarify_entity("course", options, message, phrase_of(text, ctx), ctx)
        if not count or course is None:
            return Interpretation("unknown", message="Tell me how many supplementary students and for which course.")
        return Interpretation("change", ops=[{"op": "add_supplementary", "course_id": course, "n": int(count.group(1))}])
    if re.search(r"\bset\b.*\bmax", text) or re.search(r"\bmax(imum)?\b.*\bper day\b", text) or re.search(r"\bmax(imum)?\b.*\bfill\b", text):
        number = re.search(r"(\d+(?:\.\d+)?)\s*%?", text.split("max", 1)[1])
        if not number:
            return Interpretation("unknown", message="What value should the limit be set to?")
        value = float(number.group(1))
        if "fill" in text:
            return Interpretation("change", ops=[{"op": "set_rule", "key": "max_fill", "value": value / 100 if value > 1 else value}])
        if "duties" in text or "duty" in text:
            return Interpretation("change", ops=[{"op": "set_rule", "key": "max_duties", "value": value}])
        return Interpretation("change", ops=[{"op": "set_rule", "key": "max_exams_per_day", "value": value}])
    unavailable = re.search(r"\b(unavailable|blocked|closed|flood\w*|out of order|maintenance|not available)\b", text)
    if rooms and (unavailable or re.search(r"\bblock\b", text)):
        if not dates:
            return Interpretation("unknown", message="On which date is the room unavailable?")
        slots = ctx.slot_ids(dates[0], session)
        return Interpretation("change", ops=[{"op": "block_room", "room_id": room, "slot_ids": slots} for room in rooms])
    faculty_words = re.search(r"\b(absent|on leave|sick|cannot invigilate|can't invigilate|unavailable|not available)\b", text)
    if faculty_words and not rooms:
        faculty, options = find_faculty(text, ctx)
        if options:
            return clarify_entity("faculty", options, message, phrase_of(text, ctx), ctx)
        if faculty is None:
            return Interpretation("unknown", message="Which faculty member is unavailable?")
        if not dates:
            return Interpretation("unknown", message="On which date is the faculty member unavailable?")
        return Interpretation("change", ops=[{"op": "faculty_unavailable", "faculty_id": faculty, "slot_ids": ctx.slot_ids(dates[0], session)}])
    if re.search(r"\b(forbid|avoid|never|not)\b.*\b(on|in)\b", text) and dates and re.search(r"\bforbid|avoid|never|do not|don't|not\b", text):
        course, options = find_course(text, ctx)
        if options:
            return clarify_entity("course", options, message, phrase_of(text, ctx), ctx)
        if course:
            return Interpretation("change", ops=[{"op": "forbid_slots", "course_id": course, "slot_ids": ctx.slot_ids(dates[0], session)}])
    if re.search(r"\bblock\b|\bholiday\b|\bno exams?\b|\bcancel\b", text) and dates:
        return Interpretation("change", ops=[{"op": "block_date", "date": dates[0]}])
    verb = re.search(r"\b(move|shift|reschedule|schedule|pin|put|place|hold)\b", text) or verb_hint
    if verb:
        course, options = find_course(text, ctx)
        if options:
            return clarify_entity("course", options, message, phrase_of(text, ctx), ctx)
        if course is None:
            return Interpretation("unknown", message="Which course do you want to change?")
        if not dates:
            current = ctx.exams.get(course)
            if re.search(r"\bpin\b", text) and current:
                return Interpretation("change", ops=[{"op": "pin_course", "course_id": course, "slot_id": current}])
            return Interpretation("unknown", message=f"When should {course} be held? Give a day or date and a session.")
        if len(dates) > 1:
            chips = [{"label": date.fromisoformat(d).strftime("%a %d %b"), "reply": f"move {course} to {d} {'morning' if session != 'S2' else 'afternoon'}"} for d in dates]
            return Interpretation("clarify", clarify={"question": "Which date do you mean?", "options": chips})
        if session is None:
            chips = [{"label": "Morning (S1)", "reply": f"move {course} to {dates[0]} morning"}, {"label": "Afternoon (S2)", "reply": f"move {course} to {dates[0]} afternoon"}]
            return Interpretation("clarify", clarify={"question": f"Morning or afternoon on {dates[0]}?", "options": chips})
        return Interpretation("change", ops=[{"op": "pin_course", "course_id": course, "slot_id": f"{dates[0]}-{session}"}])
    return Interpretation("unknown", message=HELP_TEXT)


def split_clauses(text: str) -> list[str]:
    parts = re.split(r"\s*(?:;|,|\band then\b|\bthen\b|\band also\b|\balso\b|\band\b)\s*", text)
    return [p for p in parts if p.strip()]


def interpret_admin(message: str, ctx: Context) -> Interpretation:
    text = substitute_course_names(message.strip(), ctx.ds)
    lowered = text.lower()
    lowered = re.sub(r"^(please|can you|could you|would you|i want to|i need to|let's|lets)\s+", "", lowered).strip(" ?.!")
    if QUESTION_START.match(lowered) and not re.match(r"^(show|give me|list)\b", lowered) or lowered.endswith("?") and not COMMAND.search(lowered):
        return interpret_question(text, lowered, ctx)
    if COMMAND.search(lowered):
        clauses = split_clauses(lowered)
        ops: list[dict] = []
        verb_hint = None
        for clause in clauses:
            result = clause_ops(clause, message, verb_hint, ctx)
            if result.kind != "change":
                return result
            ops.extend(result.ops)
            if result.ops and result.ops[0]["op"] == "pin_course":
                verb_hint = "move"
        return Interpretation("change", ops=ops)
    return interpret_question(text, lowered, ctx)


def interpret_question(text: str, lowered: str, ctx: Context) -> Interpretation:
    roll = re.search(r"\bjk26[a-z]{2,3}\d{3}\b", lowered)
    if re.search(r"\bwhy\b", lowered) and (roll or re.search(r"\b(seat|sit|sitting|seated)\b", lowered)) and roll:
        return Interpretation("explain_seat", args={"student": roll.group(0).upper()})
    if re.search(r"\bwhy\b.*\b(invigilat|duty|assigned)", lowered):
        faculty, _ = find_faculty(lowered, ctx)
        dates = find_dates(lowered, ctx)
        session = detect_session(lowered) or "S1"
        if faculty and dates:
            return Interpretation("explain_duty", args={"faculty": faculty, "slot": f"{dates[0]}-{session}"})
    if re.search(r"\bwhy\b", lowered):
        course, options = find_course(lowered, ctx)
        if options:
            return clarify_entity("course", options, text, phrase_of(lowered, ctx), ctx)
        if course:
            return Interpretation("explain_slot", args={"course": course})
    if re.search(r"\b(summary|status|kpis?|health|overview|how is the plan|how good)\b", lowered):
        return Interpretation("summary")
    if re.search(r"\b(violations?|clash(es)?)\b", lowered):
        return Interpretation("violations")
    return Interpretation("question", args={"query": text})


def interpret_student(message: str, ref_id: str, ctx: Context) -> Interpretation:
    lowered = message.lower().strip(" ?.!")
    others = [r.upper() for r in re.findall(r"\bjk26[a-z]{2,3}\d{3}\b", lowered) if r.upper() != ref_id.upper()]
    asks_other = re.search(r"\b(someone else|somebody else|another student|his|her|their|friend|classmate|roommate|other student)\b", lowered)
    if others or (asks_other and re.search(r"\b(seat|sit|exam|room|schedule|timetable)\b", lowered)):
        return Interpretation("denied", message="You can only see your own timetable and seat. Ask the examination office for anyone else's details.")
    if re.search(r"\b(sit|seat|seated|room|where)\b", lowered) or re.search(r"\b(next exam|when|schedule|timetable|exams?)\b", lowered) and re.search(r"\bmy\b|\bi\b", lowered):
        return Interpretation("schedule", args={"student": ref_id})
    return Interpretation("question", args={"query": message})


def interpret_faculty(message: str, ref_id: str, ctx: Context) -> Interpretation:
    lowered = message.lower().strip(" ?.!")
    if re.search(r"\b(my )?(duty|duties|invigilat\w*|where am i)\b", lowered) and re.search(r"\bmy\b|\bi\b|\bme\b", lowered):
        return Interpretation("duties", args={"faculty": ref_id})
    return Interpretation("question", args={"query": message})


def interpret(message: str, ds: Dataset, role: str, ref_id: str | None, exams: dict[str, str]) -> Interpretation:
    ctx = Context(ds, exams)
    if role == "student" and ref_id:
        return interpret_student(message, ref_id, ctx)
    if role == "faculty" and ref_id:
        return interpret_faculty(message, ref_id, ctx)
    return interpret_admin(message, ctx)
