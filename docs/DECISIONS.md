# Decisions

One line per non-obvious choice.

- The brief's synthetic-data counts conflict (24 core courses cannot give 36 dept-semester groups four courses each). I generate 4 core courses per department-semester group plus 12 semester-restricted open electives (84 courses, about 730 students, 5-6 exams each), which matches the stated exam load and class sizes.
- Open electives are offered per semester, not campus-wide. With a hard one-exam-per-day rule and nine usable days, campus-wide electives would need twelve distinct days and make the baseline infeasible.
- Rules live in `backend/app/config/rules.yaml` (flat `parameters` plus `weights`). `test_rules_consistency.py` fails if a numeric parameter is missing from `data/regulations.md`.
- `bcrypt` is used directly instead of `passlib` because passlib breaks with bcrypt 5. One hash is computed per seed and shared by all demo users, so seeding 780 users takes milliseconds, not minutes.
- SQLModel 0.0.50 requires timezone-aware datetimes, so every timestamp is UTC-aware; the audit hash uses the naive ISO form so it survives a database round trip.
- Python 3.13 and the newest pinned wheels were used locally; the Dockerfile targets Python 3.11 as the brief requires and uses the same pinned requirements.
- The seating risk target (at most 15 percent of random) is reached by the venue stage, not only by the annealer: the venue model minimises the sum of squared course counts per room (density), so mixed rooms are preferred, and each slot starts from a proportional hint. Without the hint CP-SAT with one worker stalls on some slots.
- Venue stage runs one single-worker CP-SAT per session in a thread pool; it is faster and more reliable than one multi-worker solve per session.
- Unchanged sessions reuse the baseline room allocation and seat map (content-hash cache), so a re-solve touches only what must change.
- Stability weights are high (timetable 30 per student moved, invigilation 40 per changed duty) so a request moves only what the constraints force. Pinning one course moves 5 courses instead of 11.
- Simple operations (faculty unavailable, room blocked, regenerate seating) skip the timetable stage and re-plan only the named sessions. If that scoped plan fails it falls back to a full re-solve.
- Infeasibility diagnosis uses an assumption-based core first, then a deletion filter that rebuilds the model with each non-core group fixed off. Leaving unassumed literals free made CP-SAT time out on feasible subsets, so those are rebuilt instead.
- The relaxation ladder only relaxes the one-exam-per-day rule, never silently: the plan carries `relaxed=true`, the validator reports `S-RELAXED-SAMEDAY`, KPIs, UI and audit show it, and the approval checklist asks for acknowledgement.
- The independent validator imports nothing from the solver; a test imports it in a subprocess and asserts `ortools` is not loaded.
- Gemini turns are not streamed because manual function calling is used with automatic calling disabled. The final answer is delivered as `answer_delta` chunks by the server; tool progress is real-time SSE.
- Gemini 3 style thought signatures are preserved by appending the model's raw `Content` back into the history instead of rebuilding it.
- Tool parameter schemas are hand-written and ops are validated server-side by Pydantic; a malformed op returns an `invalid_arguments` result so the model can retry once.
- Gemini is optional. `GeminiLLM.available()` is false without a key, with an open circuit breaker, or after the daily budget; the orchestrator then runs the deterministic parser through the same tools, validator and audit trail.
- Regulation answers need BM25 score at least 1.0 and at least 60 percent coverage of the question's specific terms (generic words are ignored). A small synonym table maps everyday words (morning, phone, late) to the regulation's wording.
- Proposals are ordinary child `PlanVersion` rows of kind `scenario` or `hotfix`; "Apply" changes the kind to `full`; "Discard" supersedes them. The UI buttons call REST endpoints; there is no LLM tool for it.
- Row-version optimistic locking uses a separate `row_version` column and `If-Match`; the `version` column stays the plan's human version number.
- `approver != creator` is enforced only when `REQUIRE_DIFFERENT_APPROVER=true` and more than one admin exists; it is off by default so one person can run the demo.
- Audit rows are written through their own short session, after the caller commits, so audit writes never wait on a caller's write lock. Hash input is `prev_hash + canonical_json(row)`.
- SQLite triggers (and Postgres rules) forbid UPDATE and DELETE on `auditlog`; `make reset-demo` drops and recreates the tables.
- Background jobs run in a thread pool with job rows in the database; on restart, running jobs are marked `interrupted` and the stream endpoint says so.
- shadcn/ui was initialised with the current CLI, which uses the Base UI flavour; I use only buttons, cards, badges, dialogs, sheets, tabs, inputs and a native `<select>`.
- The frontend types are local interfaces plus a generated `lib/api-types.ts` from `docs/openapi.json`; most endpoints return plain dictionaries, so the generated types cover paths and request bodies, not every response.
- No `make` on the Windows development machine, so every Makefile target is a thin wrapper around commands that are also documented in the README.
