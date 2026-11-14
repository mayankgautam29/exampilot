# Security and governance

- **Synthetic data only.** Faker generates every person; a banner is shown on the login page and the footer of every page. Nothing connects to a real system; email and WhatsApp are rows in the `Notification` table (the Outbox page).
- **Authentication.** JWT HS256, eight hours, bcrypt password hashes. `/auth/login` is rate limited, and so are the agent endpoints.
- **RBAC on the server.** Every route declares `admin_only`, `require_role(...)` or `current_user` with an in-handler ownership check. Students may read only their own exams, seat, hall ticket and calendar; faculty only their own duties and the seating charts of rooms they invigilate. Cross-user requests return 403 (`test_api.py::test_cross_user_access_is_denied`, `test_student_and_faculty_get_403_on_admin_endpoints`).
- **Agent tools.** Role checks are inside `tools.execute`. The model has no tool that approves, rejects or publishes. User text is treated as untrusted in the prompt and by the code.
- **Approval gates.** State machine in `services/plans.py`. Publishing needs an APPROVED plan, passes `If-Match` when sent, and re-runs the validator on the stored data; a plan with any hard violation returns 409 and an audit entry.
- **Audit.** Append-only table, SHA-256 chain, triggers or rules that block UPDATE and DELETE, `/audit/verify` returns the first broken row. `python scripts/tamper_demo.py` shows an edit being detected.
- **Secrets.** Only in environment variables. `backend/.env` is git-ignored; `.env.example` ships. No keys are in the frontend.
- **CORS.** Only `FRONTEND_ORIGINS` and the optional `FRONTEND_ORIGIN_REGEX`.
- **LLM privacy.** Only synthetic data and identifiers are sent to Gemini. Free-tier prompts may be used by Google, so never point this at real records.
- **Hall tickets.** QR codes carry an HMAC-signed token (plan, student, course); `/verify/{token}` is public and reveals only the ticket details.
