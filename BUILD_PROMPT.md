# Build prompt (condensed)

The full brief asked for **ExamPilot**, a working, demo-ready agentic system that:

- generates a clash-free exam timetable, allocates students to rooms, assigns invigilators and produces seat-level plans that maximise separation between students of the same course;
- lets an administrator change the plan in natural language (typed or spoken), validates every constraint, explains conflicts, offers ranked alternatives and re-plans with minimal disruption;
- publishes only after administrator approval, with RBAC and a tamper-evident audit log of every reasoning step, tool call and human decision.

Judged on: agentic capabilities 30 (multi-step planning, tool integration, adaptability and recovery), domain accuracy 25 (correctness, knowledge grounding, optimisation), architecture 20 (code quality, performance and streaming, scalability), safety and governance 15 (approval gates, RBAC and privacy, auditability), demo and UX 10.

Hard rules: real agent behaviour (not an LLM wrapper); zero hallucination on institutional rules (answers only from `data/regulations.md`); human in the loop (the LLM has no approve or publish tool); synthetic data only and mocked integrations; RBAC on every endpoint and every agent tool; audit log of reasoning, tool calls and approvals; must run from a clean clone using the README.

Fixed stack: FastAPI, Pydantic v2, SQLModel on SQLite (WAL) or PostgreSQL, OR-tools CP-SAT, numpy, rank_bm25, rapidfuzz, google-genai (manual function calling), reportlab, openpyxl, qrcode; Next.js App Router, strict TypeScript, Tailwind, shadcn/ui, Recharts, framer-motion, TanStack Query, zustand, cmdk, dnd-kit. The app must work without a Gemini key (offline mode) and never depend on it for a live demo. Phases: scaffold, data, engine, API and governance, agent, frontend, wow features, exports, polish, deploy. See `docs/RUBRIC_MAP.md` for how each rubric line is met.
