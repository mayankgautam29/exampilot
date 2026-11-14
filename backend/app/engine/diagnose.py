from __future__ import annotations

from ortools.sat.python import cp_model

from .data import Dataset
from .ops import RelaxConstraint, SetRule, Spec, apply_ops
from .plan import Plan
from .rules import Rules, Weights, load_rules, load_weights
from .timetable import Group, build_model, solve


def status_with(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, hard_day: bool, active: set[str]) -> str:
    built = build_model(ds, spec, rules, weights, None, hard_day)
    built.model.ClearObjective()
    for group in built.groups:
        built.model.Add(group.literal == (1 if group.id in active else 0))
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 4
    solver.parameters.max_time_in_seconds = 10
    return solver.StatusName(solver.Solve(built.model))


def quick_core(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, hard_day: bool) -> list[str]:
    built = build_model(ds, spec, rules, weights, None, hard_day)
    built.model.ClearObjective()
    built.model.AddAssumptions([g.literal for g in built.groups])
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    solver.parameters.max_time_in_seconds = 5
    if solver.Solve(built.model) != cp_model.INFEASIBLE:
        return []
    try:
        indices = set(solver.SufficientAssumptionsForInfeasibility())
    except Exception:
        return []
    return [g.id for g in built.groups if g.literal.Index() in indices]


def find_core(ds: Dataset, spec: Spec, rules: Rules, weights: Weights, hard_day: bool | None = None) -> list[Group]:
    if hard_day is None:
        hard_day = rules.max_exams_per_day == 1
    groups = build_model(ds, spec, rules, weights, None, hard_day).groups
    all_ids = [g.id for g in groups]
    if status_with(ds, spec, rules, weights, hard_day, set(all_ids)) != "INFEASIBLE":
        return []
    minimal = quick_core(ds, spec, rules, weights, hard_day) or list(all_ids)
    for group_id in list(minimal):
        trial = [i for i in minimal if i != group_id]
        if status_with(ds, spec, rules, weights, hard_day, set(trial)) == "INFEASIBLE":
            minimal = trial
    return [g for g in groups if g.id in minimal]


def describe_pair_conflicts(ds: Dataset, spec: Spec, core: list[Group]) -> list[str]:
    pinned = [(g.id.split(":", 1)[1], spec.pins[g.id.split(":", 1)[1]]) for g in core if g.id.startswith("pin:") and g.id.split(":", 1)[1] in spec.pins]
    messages = []
    for i in range(len(pinned)):
        for j in range(i + 1, len(pinned)):
            (a, slot_a), (b, slot_b) = pinned[i], pinned[j]
            shared = ds.shared.get(tuple(sorted((a, b))), 0)
            if not shared or slot_a not in ds.slots or slot_b not in ds.slots:
                continue
            if slot_a == slot_b:
                messages.append(f"{a} pinned to {ds.slots[slot_a].label} AND {b} pinned to {ds.slots[slot_b].label} share {shared} students (R-2.2)")
            elif ds.slots[slot_a].date == ds.slots[slot_b].date:
                messages.append(f"{a} and {b} are both pinned on {ds.slots[slot_a].date} and share {shared} students (R-2.1)")
    return messages


def relax_op(group: Group):
    if group.id == "rule:max_exams_per_day":
        return SetRule(key="max_exams_per_day", value=2)
    if group.id == "capacity":
        return None
    return RelaxConstraint(group_id=group.id)


def alternatives(ds: Dataset, spec: Spec, core: list[Group], baseline_exams: dict[str, str] | None, workers: int, time_limit: float) -> list[dict]:
    options = []
    for group in core:
        op = relax_op(group)
        if op is None:
            continue
        relaxed_spec = apply_ops(spec, [op])
        rules = load_rules(relaxed_spec.rules)
        result = solve(ds, relaxed_spec, rules, load_weights(relaxed_spec.weights), baseline_exams, workers, time_limit)
        if result.status not in ("OPTIMAL", "FEASIBLE"):
            continue
        moved = [c for c, s in result.exams.items() if baseline_exams and baseline_exams.get(c) != s]
        students = {sid for c in moved for sid in ds.course_students[c]}
        options.append({
            "title": f"Relax: {group.text}",
            "group_id": group.id,
            "ops": [op.model_dump()],
            "courses_moved": len(moved),
            "moved": [{"course_id": c, "from": (baseline_exams or {}).get(c), "to": result.exams[c]} for c in moved[:10]],
            "students_affected": len(students),
            "cost": result.objective,
            "relaxed_rules": result.relaxed,
        })
    options.sort(key=lambda o: (o["students_affected"], o["courses_moved"], o["cost"]))
    for index, option in enumerate(options[:3]):
        option["label"] = "Option " + "ABC"[index]
    return options[:3]


def diagnose(ds: Dataset, spec: Spec, baseline: Plan | None, workers: int, time_limit: float = 5.0, hard_day: bool | None = None) -> dict:
    rules = load_rules(spec.rules)
    weights = load_weights(spec.weights)
    core = find_core(ds, spec, rules, weights, hard_day)
    return {
        "core": [{"group_id": g.id, "human_text": g.text, "rule_id": g.rule_id} for g in core],
        "explanations": describe_pair_conflicts(ds, spec, core),
        "alternatives": alternatives(ds, spec, core, baseline.exams if baseline else None, workers, time_limit),
    }
