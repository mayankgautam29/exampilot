from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from ..agent import rag
from ..agent.llm import llm
from ..agent.orchestrator import run_agent
from ..db import get_session
from ..deps import admin_only, current_user, rate_limit
from ..models.tables import PlanVersion, User
from ..services import audit
from ..services.plans import get_plan, plan_summary, published_plan
from .common import sse

router = APIRouter(tags=["agent"])


class ChatBody(BaseModel):
    message: str
    plan_id: int | None = None


class AskBody(BaseModel):
    question: str


def stream_events(user: User, message: str, plan_id: int | None):
    for event in run_agent(user, message, plan_id, llm):
        if event["type"] == "tool_result":
            event = {k: v for k, v in event.items() if k != "result"}
        yield event


@router.post("/agent/chat", dependencies=[Depends(rate_limit("agent", 40))])
def chat(body: ChatBody, user: User = Depends(admin_only)):
    if not body.message.strip():
        raise HTTPException(422, "Message is empty")
    return sse(stream_events(user, body.message.strip()[:1500], body.plan_id))


@router.post("/me/chat", dependencies=[Depends(rate_limit("agent", 40))])
def scoped_chat(body: ChatBody, session: Session = Depends(get_session), user: User = Depends(current_user)):
    if not body.message.strip():
        raise HTTPException(422, "Message is empty")
    if user.role == "admin":
        raise HTTPException(403, "Admins use /agent/chat")
    published = published_plan(session)
    return sse(stream_events(user, body.message.strip()[:600], published.id if published else None))


@router.get("/agent/status")
def status(user: User = Depends(current_user)) -> dict:
    return llm.status()


@router.post("/agent/regulations/ask", dependencies=[Depends(rate_limit("agent", 40))])
def ask(body: AskBody, user: User = Depends(current_user)) -> dict:
    result = rag.answer_question(body.question.strip()[:500], llm)
    audit.log(user.id, user.role, "regulations.ask", "regulations", {"question": body.question[:300], "grounded": result["grounded"], "mode": result["mode"], "citations": result["citations"]})
    return result


def proposal_row(session: Session, plan_id: int) -> PlanVersion:
    pv = get_plan(session, plan_id)
    if pv.status != "DRAFT" or pv.kind not in ("scenario", "hotfix"):
        raise HTTPException(409, "Only sandbox proposals in DRAFT can be applied or discarded")
    return pv


@router.post("/agent/proposals/{plan_id}/apply")
def apply_proposal(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    pv = proposal_row(session, plan_id)
    if pv.kind == "scenario":
        pv.kind = "full"
    pv.origin = f"{pv.origin}+applied"
    pv.row_version += 1
    session.add(pv)
    session.commit()
    audit.log(user.id, user.role, "proposal.apply", f"plan:{plan_id}", {})
    return plan_summary(pv)


@router.post("/agent/proposals/{plan_id}/discard")
def discard_proposal(plan_id: int, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    pv = proposal_row(session, plan_id)
    pv.status = "SUPERSEDED"
    pv.rejection_reason = "Discarded by administrator"
    pv.row_version += 1
    session.add(pv)
    session.commit()
    audit.log(user.id, user.role, "proposal.discard", f"plan:{plan_id}", {})
    return plan_summary(pv)
