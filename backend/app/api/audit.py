from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import or_
from sqlmodel import Session, select

from ..db import get_session
from ..deps import admin_only
from ..models.tables import AuditLog, User
from ..services import audit as audit_service

router = APIRouter(tags=["audit"])


def query_rows(session: Session, actor: int | None, action: str | None, entity: str | None, q: str | None, limit: int, offset: int):
    query = select(AuditLog).order_by(AuditLog.id.desc())
    if actor is not None:
        query = query.where(AuditLog.actor_id == actor)
    if action:
        query = query.where(AuditLog.action.startswith(action))
    if entity:
        query = query.where(AuditLog.entity.contains(entity))
    if q:
        query = query.where(or_(AuditLog.reasoning.contains(q), AuditLog.action.contains(q), AuditLog.entity.contains(q)))
    return session.exec(query.offset(offset).limit(limit)).all()


def row_dict(row: AuditLog) -> dict:
    return {"id": row.id, "ts": row.ts.isoformat(), "actor_id": row.actor_id, "role": row.role, "action": row.action, "entity": row.entity, "payload": row.payload_json, "reasoning": row.reasoning, "hash": row.hash, "prev_hash": row.prev_hash}


@router.get("/audit")
def list_audit(actor: int | None = None, action: str | None = None, entity: str | None = None, q: str | None = None, limit: int = 100, offset: int = 0, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> list[dict]:
    return [row_dict(r) for r in query_rows(session, actor, action, entity, q, min(limit, 500), offset)]


@router.get("/audit/verify")
def verify(session: Session = Depends(get_session), user: User = Depends(admin_only)) -> dict:
    return audit_service.verify_chain(session)


@router.get("/audit/export")
def export(format: str = "json", action: str | None = None, session: Session = Depends(get_session), user: User = Depends(admin_only)) -> Response:
    rows = [row_dict(r) for r in query_rows(session, None, action, None, None, 5000, 0)]
    audit_service.log(user.id, user.role, "export.audit", "audit", {"format": format, "rows": len(rows)})
    if format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["id", "ts", "actor_id", "role", "action", "entity", "reasoning", "payload", "hash"])
        for row in rows:
            writer.writerow([row["id"], row["ts"], row["actor_id"], row["role"], row["action"], row["entity"], row["reasoning"], json.dumps(row["payload"]), row["hash"]])
        return Response(buffer.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=audit.csv"})
    return Response(json.dumps(rows, indent=1), media_type="application/json", headers={"Content-Disposition": "attachment; filename=audit.json"})
