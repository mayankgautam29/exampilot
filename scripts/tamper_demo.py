import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text
from sqlmodel import Session

from app.config import DATA_DIR
from app.db import engine, is_sqlite
from app.services.audit import verify_chain

if not is_sqlite:
    sys.exit("This demo edits the SQLite file directly. Run it against the default local database.")

BACKUP = DATA_DIR / "tamper_backup.json"
TRIGGER = "CREATE TRIGGER IF NOT EXISTS auditlog_no_update BEFORE UPDATE ON auditlog BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END"
ROW_ID = next((int(arg) for arg in sys.argv[1:] if arg.isdigit()), 5)


def report(label: str) -> None:
    with Session(engine) as session:
        result = verify_chain(session)
    print(f"{label}: valid={result['valid']} checked={result['checked']} broken_at={result['broken_at']} {result['reason']}")


def restore() -> None:
    saved = json.loads(BACKUP.read_text())
    with engine.begin() as connection:
        connection.execute(text("DROP TRIGGER IF EXISTS auditlog_no_update"))
        connection.execute(text("UPDATE auditlog SET reasoning = :text WHERE id = :id"), {"text": saved["reasoning"], "id": saved["id"]})
        connection.execute(text(TRIGGER))
    BACKUP.unlink()
    report("Restored")


if "--restore" in sys.argv:
    restore()
    sys.exit(0)

report("Before")
with engine.begin() as connection:
    original = connection.execute(text("SELECT reasoning FROM auditlog WHERE id = :id"), {"id": ROW_ID}).scalar_one()
    try:
        connection.execute(text("UPDATE auditlog SET reasoning = 'edited' WHERE id = :id"), {"id": ROW_ID})
    except Exception as error:
        print(f"The database refuses a plain edit: {str(error).splitlines()[0]}")
        print("An attacker with file access would drop the trigger first. Doing that now.")
BACKUP.write_text(json.dumps({"id": ROW_ID, "reasoning": original}))
with engine.begin() as connection:
    connection.execute(text("DROP TRIGGER IF EXISTS auditlog_no_update"))
    connection.execute(text("UPDATE auditlog SET reasoning = 'edited by an attacker' WHERE id = :id"), {"id": ROW_ID})
report("After tampering")
if "--keep" in sys.argv:
    print("Left tampered on purpose. Press Verify chain on the Audit page to see the red seal, then run with --restore.")
else:
    restore()
