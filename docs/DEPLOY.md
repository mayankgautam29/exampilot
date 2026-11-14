# Deployment

Run the live demo locally (or on a paid always-on instance). Keep the deployed link as the shareable backup: the Render free tier has 512 MB of RAM, 0.1 CPU, sleeps after 15 minutes, uses an ephemeral disk, and its free Postgres expires after 30 days. Solves are slow on that CPU.

## Backend on Render

1. Push the repository to GitHub.
2. In Render choose *New, Blueprint* and select the repository. `render.yaml` creates the Docker web service (health check `/health`) and a free Postgres database.
3. Set `GEMINI_API_KEY` (optional; the app works offline without it). `JWT_SECRET` is generated.
4. Copy the service URL, for example `https://exampilot-api.onrender.com`.
5. After the frontend exists, put its URL in `FRONTEND_ORIGINS` (comma separated). `FRONTEND_ORIGIN_REGEX=https://.*\.vercel\.app` already allows Vercel previews.

The container is built from the repository root (`backend/Dockerfile`) so `data/` is copied in. On an empty database `ensure_seeded` loads users and the committed `data/seed/baseline_plan.json` snapshot instead of re-solving, so a cold start takes seconds. `GET /health` is immediate; `GET /health/ready` is false until seeding finishes. Interrupted jobs are marked as such so the UI never hangs.

Resource awareness: on one CPU the solver uses 2 workers, a 10 second stage limit and fewer annealing iterations; set `SOLVER_WORKERS`, `SOLVER_TIME_LIMIT_S` and `SEAT_ITERATIONS` to override.

## Frontend on Vercel

1. Import the repository, set *Root Directory* to `frontend`.
2. Add one environment variable `NEXT_PUBLIC_API_URL` with the Render URL (https).
3. Deploy. The value is baked into the build, so change it and redeploy if the API URL changes.
4. The browser calls the API directly (including SSE); there are no Next.js API routes and no secrets.

While the free API wakes up, the app shows *Waking up the planner…* and polls `/health/ready` with backoff for up to 90 seconds.

## Keep awake

An uptime pinger (for example every 5 minutes against `/health`) keeps the free instance warm for a demo.

## Verify

```bash
python scripts/smoke_deployed.py https://exampilot-api.onrender.com
```

It checks readiness, logs in as the demo admin, confirms the published plan has 0 hard violations, runs an offline agent command and verifies the audit chain.

## Local Docker

```bash
docker build -f backend/Dockerfile -t exampilot-api .
docker run --rm -p 8000:8000 exampilot-api
python scripts/smoke_deployed.py http://localhost:8000
```

With Postgres: `docker compose --profile full up --build`.
