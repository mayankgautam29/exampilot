# Five-minute demo

Prepare: `make reset-demo`, then `make dev`, open http://localhost:3000. Accounts use password `Demo@1234`: `admin@jklu.demo`, `faculty01@jklu.demo`, `student001@jklu.demo`. Works with or without a Gemini key.

Screenshots of these steps are in `docs/screenshots/`.

1. **Generate with the live solver (0:00).** Command Center, press *Generate plan*. Watch the four stages and the chart of objective against lower bound (`02-live-solver-console.jpg`). About 30 seconds. Close the dialog; the new draft appears in the pipeline.
2. **Proof panel (0:45).** On the same page show the sixteen independent checks, the health radar, seating risk 3 (about 97 percent better than random), duty spread 4 to 5 (`01-command-center.jpg`).
3. **Copilot edit with a diff (1:15).** Copilot: type `move CSE301 to 2026-12-07 afternoon`. Show the plan checklist, the `propose_changes` card with its rationale, the validator tick and the proposal diff with the mini calendar (`03-copilot-run.jpg`). Then `room G1 unavailable on 2026-12-08 afternoon`: only the affected session changes. Optionally speak a request with the microphone button.
4. **Impossible request and alternatives (2:00).** Type `pin CIV501 to 2026-12-15 afternoon and pin CIV502 to 2026-12-15 afternoon`. The agent names the two conflicting pins with the shared-student count and offers ranked options; press *Try this option* to see its diff. Then `move math to 2026-12-08 morning` shows clarification chips.
5. **Policy answer and refusal (2:45).** Regulations Q&A: `How many exams can a student take in one day?` returns the rule with `[R-2.1]`; `What is the exam fee?` is refused with the fixed sentence.
6. **Scenario Lab (3:15).** Solve the three preset branches together, read the comparison table and radar, adopt one.
7. **Approve and publish (3:45).** Approvals: pick the draft, show diff, checklist, briefing with the verified chip. Approve, then Publish and tick the checklist. The banner shows how many notifications were created; open Outbox.
8. **Student seat and QR (4:15).** Sign out, sign in as `student001`. Show the exam cards with countdown and your highlighted seat, ask `Where does JK26CSE014 sit?` (denied), download the hall ticket, scan or open the QR link (`/verify/...`).
9. **Audit and tamper (4:35).** Back as admin, Audit, press *Verify chain* (green). In a terminal run `python scripts/tamper_demo.py --keep`, press Verify again (red, first broken row). Afterwards run `python scripts/tamper_demo.py --restore`.
10. **Benchmark (4:50).** Benchmark page: ExamPilot against Random and Greedy.

Spare: Disruption Mode, *Simulate chaos*, then approve the hotfix in Approvals and see the outbox fill.
