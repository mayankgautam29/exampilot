# The agent

## What makes it an agent

A request goes through plan, act, observe, verify. The model (or, offline, the deterministic parser) must first declare a checklist, then call tools, read their results, and finally answer. After any proposal the **non-LLM validator** runs again over the stored plan and the answer may not claim success if hard violations exist.

## Tools (`backend/app/agent/tools.py`)

| Tool | Kind | Roles |
| --- | --- | --- |
| `declare_plan` | read | all |
| `get_plan_summary`, `get_violations`, `resolve_entity`, `list_free_slots`, `explain_slot`, `compare_plans` | read | admin |
| `get_student_schedule`, `explain_seat` | read | admin, own record for students |
| `explain_duty`, `get_faculty_duties` | read | admin, own record for faculty |
| `search_regulations` | read | all |
| `propose_changes`, `simulate_disruption`, `create_scenarios` | propose (sandbox only) | admin |

There is **no approve, publish or reject tool**. Role checks run in `execute()`; prompts never grant rights. Tests: `test_agent.py::test_tool_executor_enforces_roles_in_code`, `test_llm_has_no_approval_or_publish_tool`, `test_prompt_injection_changes_nothing`.

## Loop (`orchestrator.py`)

1. Forced `declare_plan` (mode ANY restricted to that tool).
2. Up to four model calls in total and six tool executions. Tool errors (`invalid_arguments`, unknown entity) are returned to the model so it can correct itself once.
3. `resolve_entity` with low confidence ends the run with a `clarify` event; the UI shows quick-reply chips.
4. `propose_changes` builds a child DRAFT through `services/planner.py`. Infeasible requests return the minimal conflicting constraints and up to three ranked alternatives (students affected, courses moved, cost).
5. The `verify` event is produced by `verify_plan`, which re-runs `engine/validator.py`.
6. Failures of Gemini (429, circuit open, budget) fall back to the deterministic parser through the same tools and audit trail.

Every event and tool call is written to the audit log with arguments, a summarised result, latency, model and the public rationale string.

## Gemini (`llm.py`)

Manual function calling with automatic calling disabled, thinking budget 0 where supported, token bucket for requests per minute, daily counter in `LLMUsage`, backoff honouring `retryDelay`, model fallback chain from `.env`, circuit breaker (three failures, sixty seconds), cache for deterministic calls. `GET /agent/status` reports `live`, `degraded` or `offline`. Only synthetic data is ever sent; the catalogue uses ids.

Run `python scripts/check_gemini.py` after setting `GEMINI_API_KEY` in `backend/.env` to list the models your key can use and print suggested values.

## Offline parser (`fallback_parser.py`)

Regex plus fuzzy matching for: move or pin a course to a day or date and session; unpin; room unavailable; faculty unavailable; block a date; add supplementary students; regenerate timetable, seating or invigilation; set max exams per day, max duties or max fill; why-questions; summaries; policy questions. Ambiguity (several courses, no session) returns clarification chips. 18 phrasings plus routing tests are in `test_parser.py`.

## Regulations Q&A (`rag.py`)

BM25 over `data/regulations.md` rules. A question must reach the score and coverage thresholds; otherwise the answer is exactly `Not covered in the approved regulations.` A model answer is accepted only if every cited id was retrieved and every number appears in a cited rule; otherwise the extractive answer (the rule text with its id) is returned. 15 in-scope and 8 out-of-scope questions are in `test_grounding.py`.
