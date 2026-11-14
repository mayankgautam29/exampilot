import pytest
from sqlalchemy import text
from sqlalchemy.exc import DatabaseError

from app.db import engine


def test_audit_log_blocks_update_and_delete(client):
    with pytest.raises(DatabaseError):
        with engine.begin() as connection:
            connection.execute(text("UPDATE auditlog SET reasoning = 'x' WHERE id = 1"))
    with pytest.raises(DatabaseError):
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM auditlog WHERE id = 1"))


def test_tampering_is_detected_at_the_edited_row(client, admin):
    assert client.get("/audit/verify", headers=admin).json()["valid"]
    with engine.begin() as connection:
        connection.execute(text("DROP TRIGGER auditlog_no_update"))
        connection.execute(text("UPDATE auditlog SET reasoning = 'edited by an attacker' WHERE id = 3"))
    result = client.get("/audit/verify", headers=admin).json()
    assert result["valid"] is False and result["broken_at"] == 3
