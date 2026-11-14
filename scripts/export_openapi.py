import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app

target = Path(__file__).resolve().parents[1] / "docs" / "openapi.json"
target.write_text(json.dumps(app.openapi(), indent=1), encoding="utf-8")
print(f"Wrote {target}")
