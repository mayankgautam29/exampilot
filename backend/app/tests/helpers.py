import json


def stream_events(client, path: str, headers: dict, body: dict | None = None, method: str = "POST", params: dict | None = None) -> list[dict]:
    events = []
    with client.stream(method, path, headers=headers, json=body, params=params) as response:
        assert response.status_code == 200, response.read()
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def chat(client, headers: dict, message: str, plan_id: int | None = None, path: str = "/agent/chat") -> dict:
    events = stream_events(client, path, headers, {"message": message, "plan_id": plan_id})
    done = next(e for e in events if e["type"] == "done")
    done["events"] = events
    done["types"] = [e["type"] for e in events]
    return done


def wait_job(client, headers: dict, job_id: str) -> dict:
    events = stream_events(client, "/solve/stream", headers, method="GET", params={"job_id": job_id})
    return events[-1] | {"all_events": events}


def published(client, headers: dict) -> dict:
    return next(p for p in client.get("/plans", headers=headers).json() if p["status"] == "PUBLISHED")
