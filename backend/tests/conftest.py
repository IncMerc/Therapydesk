# needs a real postgres with db/init applied (RLS), e.g. `docker compose up db`
import os

import tempfile

os.environ.setdefault("JWT_SECRET", "test-secret-that-is-long-enough-for-hs256")
os.environ.setdefault("LIVEKIT_API_SECRET", "livekit-test-secret-that-is-long-enough")
os.environ.setdefault("RECORDINGS_DIR", tempfile.mkdtemp(prefix="recordings-"))
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://app_user:app_password@localhost:5432/therapy")
ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/therapy")

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(autouse=True)
def clean_db():
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute("TRUNCATE therapists, recording_chunks, processing_jobs, transcript_segments, session_notes RESTART IDENTITY CASCADE")
    yield


@pytest.fixture
def api():
    return TestClient(app)


def _signup(api, email):
    r = api.post("/api/auth/signup", json={"email": email, "fullName": "Dr Test", "password": "correct-horse-battery"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


@pytest.fixture
def alice(api):
    return _signup(api, "alice@example.com")


@pytest.fixture
def bob(api):
    return _signup(api, "bob@example.com")
