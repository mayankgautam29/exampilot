from __future__ import annotations

import hashlib
import json
import threading

from sqlmodel import Session, select

from ..db import new_session
from ..models.tables import AuditLog, now

GENESIS = "GENESIS"
_lock = threading.Lock()


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def row_digest(prev_hash: str, row: AuditLog) -> str:
    body = {
        "ts": row.ts.replace(tzinfo=None).isoformat(),
        "actor_id": row.actor_id,
        "role": row.role,
        "action": row.action,
        "entity": row.entity,
        "payload": row.payload_json,
        "reasoning": row.reasoning,
    }
    return hashlib.sha256((prev_hash + canonical(body)).encode()).hexdigest()


def log(actor_id: int | None, role: str, action: str, entity: str = "", payload: dict | None = None, reasoning: str = "") -> AuditLog:
    with _lock, new_session() as session:
        last = session.exec(select(AuditLog).order_by(AuditLog.id.desc()).limit(1)).first()
        prev_hash = last.hash if last else GENESIS
        row = AuditLog(ts=now(), actor_id=actor_id, role=role, action=action, entity=entity, payload_json=json.loads(canonical(payload or {})), reasoning=reasoning, prev_hash=prev_hash)
        row.hash = row_digest(prev_hash, row)
        session.add(row)
        session.commit()
        session.refresh(row)
        return row


def verify_chain(session: Session) -> dict:
    previous = GENESIS
    count = 0
    for row in session.exec(select(AuditLog).order_by(AuditLog.id)):
        count += 1
        if row.prev_hash != previous:
            return {"valid": False, "checked": count, "broken_at": row.id, "reason": "previous hash does not match"}
        if row_digest(previous, row) != row.hash:
            return {"valid": False, "checked": count, "broken_at": row.id, "reason": "row content does not match its hash"}
        previous = row.hash
    return {"valid": True, "checked": count, "broken_at": None, "reason": ""}
