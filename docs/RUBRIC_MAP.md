# Rubric map

Each line: where it lives, which test proves it, and where to see it in the demo (`docs/DEMO_SCRIPT.md` step numbers).

## Agentic capabilities (30)

| Line | Implementation | Test | Demo |
| --- | --- | --- | --- |
| Multi-step planning (10) | `agent/orchestrator.py` forced `declare_plan`, checklist in the Copilot run panel; four-stage `engine/pipeline.py` | `test_agent.py::test_live_loop_plans_acts_verifies_and_answers` | 3, 4 |
| Tool and API integration (10) | `agent/tools.py` (CP-SAT via planner, validator, database reads, RAG, exports, fuzzy resolver `resolve_entity`, mock notification outbox) | `test_agent.py::test_tool_executor_enforces_roles_in_code` | 3, 9 |
| Adaptability and recovery (10) | Relaxation ladder `engine/timetable.py`; unsat core and ranked alternatives `engine/diagnose.py`; clarify chips `agent/fallback_parser.py`; retries and model fallback `agent/llm.py`; offline fallback `orchestrator.offline_flow`; best feasible on timeout | `test_engine.py::test_planted_conflict_is_diagnosed_with_a_minimal_core`, `test_relaxation_ladder_flags_the_plan`, `test_agent.py::test_live_loop_falls_back_when_the_model_fails`, `test_impossible_request_gives_diagnosis_and_alternatives`, `test_ambiguous_request_asks_with_chips` | 4, 5 |

## Domain accuracy (25)

| Line | Implementation | Test | Demo |
| --- | --- | --- | --- |
| Functional correctness (10) | Independent `engine/validator.py` (16 hard, 6 soft codes), publish gate in `services/plans.publish`, proof panel on the Command Center | `test_engine.py::test_validator_catches_each_corruption` (16 mutations), `test_publish_is_blocked_for_a_plan_with_an_injected_violation` | 2, 7 |
| Knowledge grounding (10) | `agent/rag.py`, `data/regulations.md`, `config/rules.yaml`, number-verified `agent/briefing.py` | `test_grounding.py` (15 cited, 8 refused, lying LLM rejected), `test_rules_consistency.py`, `test_api.py::test_benchmark_and_briefing` | 6 |
| Optimisation and reasoning (5) | Seating risk vs random (`engine/seating.py`), Benchmark page, `engine/explain.py` with alternative costs, health score `engine/health.py` | `test_engine.py::test_kpis_meet_targets`, `test_benchmark_shows_clear_win`, `test_explanations_are_deterministic_facts` | 2, 10 |

## Architecture (20)

| Line | Implementation | Test | Demo |
| --- | --- | --- | --- |
| Stack and code quality (10) | `engine/` vs `agent/` vs `api/` vs `services/`; typed Pydantic ops; generated `frontend/lib/api-types.ts`; strict TypeScript | `pytest` (all), `npx tsc --noEmit` | - |
| Performance and streaming (5) | CP-SAT progress over SSE (`/solve/stream`), agent SSE, move-check in under 150 ms, seat cache by content hash, scoped re-plans | `test_move_check_is_fast`, `test_generate_streams_solver_progress` | 1, 3 |
| Scalability and data handling (5) | Indexed schema and derived tables, PostgreSQL via `DATABASE_URL`, job table, optimistic locking, `SCALE=3 make seed` | `test_optimistic_locking_and_rejection_reason` | - |

## Safety and governance (15)

| Line | Implementation | Test | Demo |
| --- | --- | --- | --- |
| Approval gates (5) | State machine and server-side re-validation (`services/plans.py`); no approve or publish tool | `test_state_machine_rejects_skipping_steps`, `test_llm_has_no_approval_or_publish_tool`, `test_prompt_injection_changes_nothing` | 7 |
| RBAC and privacy (5) | `deps.py`, per-route role dependencies, tool role checks, banner, ids only to the LLM | `test_cross_user_access_is_denied`, `test_student_cannot_ask_about_someone_elses_seat` | 8 |
| Auditability (5) | Hash-chained log, `/audit/verify`, triggers, `scripts/tamper_demo.py`, Audit page with reasoning and tool payloads | `test_audit_chain_is_valid_and_records_reasoning`, `test_zz_tamper.py` | 9 |

## Demo and UX (10)

| Line | Implementation | Demo |
| --- | --- | --- |
| Dashboards (5) | Command Center, Seating Studio, Timetable, Invigilation, Scenario Lab, Benchmark, Audit, Outbox | all |
| Live demo (5) | `make reset-demo` in about four seconds from a committed snapshot, offline-safe agent, scripted flow `scripts/demo_flow.py`, Disruption chaos button | all |
