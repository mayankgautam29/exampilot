# Architecture

```
Browser (Next.js, TanStack Query, SSE via fetch)
   |  REST + SSE, JWT bearer
FastAPI  app/api/*  ->  app/services/*  ->  app/engine/*  (pure Python + OR-tools)
                              |                 ^
                              |                 | validator is independent of the solver
                              v
                      SQLModel (SQLite WAL / PostgreSQL)
Agent layer  app/agent/*  (tools, orchestrator, RAG, Gemini adapter) calls services and engine only through tools
```

## Layers

| Layer | Path | Rule |
| --- | --- | --- |
| Engine | `backend/app/engine` | No web, database or LLM imports. Takes a `Dataset`, a `Spec` and a baseline `Plan`. |
| Services | `backend/app/services` | Lifecycle, audit chain, jobs, exports, planner glue. |
| API | `backend/app/api` | Thin routers. Every route declares its role dependency. |
| Agent | `backend/app/agent` | Tool registry with role checks in code, orchestrator loop, regulations RAG, Gemini adapter. |
| Frontend | `frontend` | App Router pages per role; only the API URL is configured. |

## Planning pipeline

`engine/pipeline.py` runs four stages and emits progress events:

1. **Timetable** (`timetable.py`, CP-SAT). One slot per course, no shared-student clash in a session, at most one exam a day (hard), 85% fill capacity per session. Soft: consecutive days weighted by shared students, big or hard courses early, balanced load and course count, stability to the baseline. The ladder relaxes the day rule only when infeasible.
2. **Venues** (`venues.py`). Cohorts are course x group (general, accessible, extra-time). Integer room counts; minimises rooms, splits and squared density; accessible students only in accessible rooms and at most the number of aisle seats; extra-time students only in quiet rooms.
3. **Invigilation** (`invigilation.py`). Demand per room, own-course exclusion, availability, per-day and total limits, relievers, fairness, department preference, back-to-back and stability. Chief is the most senior.
4. **Seating** (`seating.py`). Farthest-point seat choice, greedy constructive placement, simulated annealing with incremental deltas, risk index against 30 random seatings. Rooms are seated in a process pool and cached by content hash.

`validator.py` recomputes 16 hard and 6 soft checks from the plan data. `kpis.py`, `health.py`, `diff.py`, `explain.py`, `diagnose.py`, `disruption.py` and `baselines.py` sit beside it.

## Plan lifecycle

`DRAFT -> PENDING_APPROVAL -> APPROVED -> PUBLISHED`; `REJECTED` (reason required) can be resubmitted; publishing supersedes the previous plan. Publish re-runs the validator on the stored plan and returns 409 if any hard violation exists. Every transition checks `If-Match` against `row_version` when supplied.

## Data model

Tables are in `app/models/tables.py`. The plan itself is stored once as JSON (`PlanVersion.data_json`) and also written to indexed derived tables (`ExamEntry`, `RoomAllocation`, `SeatAssignment` indexed by `(plan_id, student_id)`, `InvigDuty`) so queries by student or room are cheap. Ids are natural strings (course code, roll number, room name, slot id) so engine, database and UI agree.

## Streaming

`/solve/stream?job_id=` replays job events (stage, CP-SAT objective and bound, done or error). `/agent/chat` streams `mode`, `plan`, `tool_call`, `tool_result`, `verify`, `clarify`, `answer_delta`, `done`. Both use `text/event-stream` consumed with `fetch`.

## Scaling

`SCALE=3 make seed` triples sections and rooms and faculty (about 2,200 students). Indexes cover every foreign key. PostgreSQL works through `DATABASE_URL` (`docker-compose.yml`). Heavy work is bounded by a two-slot semaphore and a job table.
