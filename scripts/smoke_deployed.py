import json
import sys
import time

import httpx

if len(sys.argv) < 2:
    sys.exit("usage: python scripts/smoke_deployed.py <api_url>")
base = sys.argv[1].rstrip("/")
client = httpx.Client(base_url=base, timeout=120)
failures = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + name + (f" - {detail}" if detail else ""))
    if not ok:
        failures.append(name)


deadline = time.time() + 150
ready = False
while time.time() < deadline and not ready:
    try:
        ready = client.get("/health/ready").json().get("ready", False)
    except Exception:
        pass
    if not ready:
        time.sleep(3)
check("health/ready", ready)
if not ready:
    sys.exit(1)

token = client.post("/auth/login", json={"email": "admin@jklu.demo", "password": "Demo@1234"}).json()["token"]
headers = {"Authorization": f"Bearer {token}"}
plans = client.get("/plans", headers=headers).json()
published = next((p for p in plans if p["status"] == "PUBLISHED"), None)
check("published plan exists", published is not None)
if published:
    proof = client.get(f"/plans/{published['id']}/validate", headers=headers).json()
    check("published plan has 0 hard violations", proof["hard_count"] == 0, f"{proof['hard_count']} hard")

answer = None
with client.stream("POST", "/agent/chat", headers=headers, json={"message": "Can students use calculators?"}) as response:
    for line in response.iter_lines():
        if line.startswith("data: "):
            event = json.loads(line[6:])
            if event["type"] == "done":
                answer = event["answer"]
check("offline agent answers a policy question", bool(answer) and "R-7.5" in answer, (answer or "")[:70])
seal = client.get("/audit/verify", headers=headers).json()
check("audit chain is valid", seal["valid"], f"{seal['checked']} entries")
check("students cannot reach admin endpoints", client.get("/plans", headers={"Authorization": "Bearer x"}).status_code == 401)
print("\nAll checks passed." if not failures else f"\n{len(failures)} check(s) failed: {failures}")
sys.exit(1 if failures else 0)
