from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Iterator

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from ..config import settings
from ..models.tables import PlanVersion, User
from ..services.plans import get_plan, published_plan


def sse(events: Iterator[dict]) -> StreamingResponse:
    def encode() -> Iterator[str]:
        for event in events:
            yield f"data: {json.dumps(event, default=str)}\n\n"

    return StreamingResponse(encode(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def published_or_404(session: Session) -> PlanVersion:
    plan = published_plan(session)
    if plan is None:
        raise HTTPException(404, "No plan has been published yet")
    return plan


def plan_for_user(session: Session, user: User, plan_id: int) -> PlanVersion:
    pv = get_plan(session, plan_id)
    if user.role != "admin" and pv.status != "PUBLISHED":
        raise HTTPException(403, "Only the published plan is visible to your role")
    return pv


def make_token(plan_id: int, student_id: str, course_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps([plan_id, student_id, course_id]).encode()).decode().rstrip("=")
    signature = hmac.new(settings.jwt_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:24]
    return f"{payload}.{signature}"


def read_token(token: str) -> tuple[int, str, str] | None:
    payload, _, signature = token.partition(".")
    expected = hmac.new(settings.jwt_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:24]
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        plan_id, student_id, course_id = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except Exception:
        return None
    return plan_id, student_id, course_id
