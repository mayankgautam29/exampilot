# Build report

## What was built

- **Planning engine** (`backend/app/engine`): CP-SAT timetable with relaxation ladder, unsat-core diagnosis and ranked alternatives; per-session venue allocation; invigilation roster with relievers and fairness; seat planner (farthest-point, greedy, simulated annealing, risk index against random); independent validator (16 hard and 6 soft codes); KPIs, health score, diff, explanations, disruption engine, baselines.
- **Governance** (`services`, `api`): JWT and RBAC on every route, plan state machine with optimistic locking and server-side re-validation at publish, hash-chained append-only audit log with a verify endpoint, background jobs with SSE, mock outbox, PDF, Excel, ICS and QR hall-ticket exports.
- **Agent** (`agent`): role-checked tool registry with no approve or publish tool, plan-act-observe-verify loop, Gemini adapter (manual function calling, budget, fallback, circuit breaker), deterministic offline parser, grounded regulation Q&A, number-verified briefing.
- **Frontend** (`frontend`): Command Center with live solver console, Copilot with run timeline and proposal diff, drag-and-drop Timetable with live feasibility, Seating Studio with random/optimised toggle, Invigilation matrix, Scenario Lab, Approvals with publish checklist, Disruption Mode, Regulations Q&A, Audit with verify seal, Benchmark, Outbox, student, faculty and public verify pages; light and dark theme, command palette, voice input.
- **Dev and deploy**: Makefile, `run.sh`, Dockerfile, `docker-compose.yml` (Postgres), `render.yaml`, scripts (`check_gemini.py`, `demo_flow.py`, `tamper_demo.py`, `export_openapi.py`, `smoke_deployed.py`).

## Acceptance checklist

| Item | Result |
| --- | --- |
| Clean start from the README | The same commands were run one by one on Windows (venv and pip install, seed, uvicorn, `next dev`, `next build`). `make` is not installed on this machine, so the Makefile targets and `run.sh` themselves were **not executed**. Not tested on a fresh clone. |
| No key, app fully usable offline | Verified: every test and the demo flow run with `GEMINI_API_KEY` empty; the badge shows **AI: offline**. |
| With a key, badge shows AI: live | **Not verified.** No Gemini key was available. The adapter was checked against the installed `google-genai` 3.3.0 types and the live loop is tested with a scripted fake model (plan, tools, verify, answer, fallback). |
| Generated plan quality | 0 hard violations; health 91.7 (published baseline) and 90.4 (fresh run); seating risk 3.3 (97 percent better than random; limit 15); duty spread 4 to 5 (limit 2); solve about 27 s with 8 workers and a 20 s timetable limit (limit 60 s). |
| Ten scripted agent prompts | Pass in `test_agent.py`: move a course; block a room on a date and session; faculty unavailable; impossible request with diagnosis and at least two alternatives; ambiguous request with chips; combined multi-change; cited policy answer; refused out-of-scope question; student asking about another seat (denied); prompt injection (no state change). |
| Injected violation cannot be published; student gets 403 | Pass (`test_publish_is_blocked_for_a_plan_with_an_injected_violation`, admin-endpoint 403 matrix). |
| Audit verify green, tamper demo red | Pass in tests and by running `scripts/tamper_demo.py --keep` against the dev database, then pressing Verify in the UI (`docs/screenshots/11-audit-tamper-detected.jpg`). |
| Disruption to hotfix to approval to outbox | Pass (`test_disruption_creates_hotfix_that_needs_approval_then_notifies`). |
| Scenario Lab compares at least three and adopts one | Pass (`test_scenario_lab_compares_three_and_adopts_one`). |
| Exports open correctly | PDFs re-read with pypdf, Excel with openpyxl (all seven sheets, frozen headers), ICS event count, hall-ticket ZIP, QR token verifies and forgeries are rejected. The QR image itself was not scanned with a camera. |
| pytest, tsc, next build | `pytest`: 132 passed in about 3 minutes. `npx tsc --noEmit` clean. `next build` succeeded for all 19 routes. |
| No secrets in git | A scan of the repository for Google API key prefixes finds nothing; `.env` is ignored and only `.env.example` ships. |
| DEPLOY.md and smoke script | Written. `scripts/smoke_deployed.py` passes against the locally running API. **The Docker image was not built or run**: the Docker daemon was not running on this machine. Render and Vercel were not touched. |
| DEMO_SCRIPT with screenshots | `docs/DEMO_SCRIPT.md` plus 12 screenshots in `docs/screenshots/`. |

## Measured

- Fresh seed with solving: about 35 s. Seed from the committed snapshot (`make seed`, `make reset-demo`): a few seconds.
- A pin proposal that moves 5 courses re-solves in a few seconds because of the stability weights; faculty and room changes re-plan only the named sessions.
- `SCALE=3` (2,186 students, 45 rooms, 135 faculty): feasible, 0 hard violations, seating risk 9, duty spread 5 to 6, about 77 s end to end (invigilation scales its time limit with the student count).

## What was cut or simplified

- The brief's synthetic counts conflict; see `docs/DECISIONS.md` for the choice made.
- The "Why" explanations rephrase through Gemini only when a key is present; otherwise a deterministic template is shown.
- The Timetable page refuses drops on red sessions and offers a pin proposal for green and amber ones; it does not offer to resolve a red session by relaxing a constraint (the Copilot does that through ranked alternatives).
- Frontend components have no automated tests beyond type-checking and the production build; behaviour was checked by hand in the browser (login, Command Center, Copilot, Timetable drag and drop, Seating Studio, Invigilation, Approvals, Audit, Student). Disruptions, Scenario Lab, Benchmark, Outbox, Regulations and Faculty pages compile and their API calls are covered by backend tests, but were not clicked through in the browser.
- Voice input uses the Web Speech API and falls back to a message when unsupported; it was not tested with a microphone.
- PostgreSQL is supported through `DATABASE_URL` and `docker-compose.yml` but was not run.

## Known limitations

- The hard rule of one exam per day on nine usable days leaves little slack. Pinning a course to an arbitrary session often forces several other courses to move, or triggers the relaxation ladder. That is correct behaviour, but it makes impossible requests easy to create.
- With one CPU (Render free tier) solves are slow; the code drops to two workers and shorter limits, and returns the best feasible plan on timeout.
- The regulation retriever is lexical (BM25 with a small synonym table). Unusual phrasings of an in-scope question may be refused; out-of-scope questions are refused reliably in the tested set.
- Generated TypeScript types cover paths and request bodies; most responses are plain dictionaries typed by hand in `frontend/lib/types.ts`.
- Real Gemini quota behaviour (429 handling, model fallback) is implemented but untested against the live service.

## Commands

```bash
make setup && make seed && make dev      # or ./run.sh
make test                                # pytest + tsc
make reset-demo                          # restore the demo state
make openapi                             # docs/openapi.json + frontend/lib/api-types.ts
python scripts/check_gemini.py           # after setting GEMINI_API_KEY in backend/.env
python scripts/demo_flow.py              # scripted agent flow against a running API
python scripts/tamper_demo.py --keep     # edit one audit row; --restore puts it back
python scripts/smoke_deployed.py http://localhost:8000
```
