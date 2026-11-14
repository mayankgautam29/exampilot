import os
import tempfile
from pathlib import Path

TEST_DIR = Path(tempfile.mkdtemp(prefix="exampilot-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TEST_DIR / 'test.db').as_posix()}"
os.environ["AUTO_SEED_ON_EMPTY"] = "false"
os.environ["GEMINI_API_KEY"] = ""
os.environ["SOLVER_TIME_LIMIT_S"] = "8"

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.seed.loader import seed_database


@pytest.fixture(scope="session")
def client():
    seed_database()
    with TestClient(app) as test_client:
        yield test_client


def login(client, email: str) -> dict:
    response = client.post("/auth/login", json={"email": email, "password": "Demo@1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


@pytest.fixture(scope="session")
def admin(client):
    return login(client, "admin@jklu.demo")


@pytest.fixture(scope="session")
def student(client):
    return login(client, "student001@jklu.demo")


@pytest.fixture(scope="session")
def student2(client):
    return login(client, "student002@jklu.demo")


@pytest.fixture(scope="session")
def faculty(client):
    return login(client, "faculty01@jklu.demo")
