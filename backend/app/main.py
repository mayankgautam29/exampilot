from __future__ import annotations

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .api import agent, approvals, audit, auth, disruptions, exports, invigilation, me, misc, plans, scenarios, seating
from .seed.loader import is_ready, seed_database
from .services import jobs
from .services.datasets import clear_dataset_cache

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    clear_dataset_cache()
    jobs.mark_interrupted()
    if settings.auto_seed_on_empty and not is_ready():
        threading.Thread(target=seed_in_background, daemon=True).start()
    yield


app = FastAPI(title="ExamPilot API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_origin_regex=settings.frontend_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

for module in (auth, plans, seating, invigilation, agent, scenarios, approvals, audit, disruptions, me, exports, misc):
    app.include_router(module.router)


def seed_in_background() -> None:
    try:
        seed_database()
    except Exception as error:
        print(f"Seeding failed: {error}")
