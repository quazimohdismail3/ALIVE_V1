"""HTTP integration tests for /api/profile.

Uses TestClient with a JWT-stub override of get_current_user — no real Supabase
auth signup needed for these tests. RLS isolation test (Task 6) uses a real
JWT-scoped connection via Supabase admin SDK.
"""
from __future__ import annotations
import os
import uuid
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.auth import get_current_user
from backend import db


_db_url = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(
    not _db_url or "PLACEHOLDER" in _db_url,
    reason="needs real DATABASE_URL",
)

TEST_USER_ID = os.environ.get("TEST_USER_ID", "00000000-0000-0000-0000-000000000001")


@pytest.fixture(autouse=True)
def _override_auth():
    app.dependency_overrides[get_current_user] = lambda: TEST_USER_ID
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
async def _pool_and_clean():
    await db.init_pool()
    async with db._pool.acquire() as conn:
        await conn.execute(
            "delete from public.user_profiles where user_id = $1",
            uuid.UUID(TEST_USER_ID),
        )
    yield
    await db.close_pool()


def test_get_profile_returns_404_when_missing():
    client = TestClient(app)
    r = client.get("/api/profile")
    assert r.status_code == 404


def test_put_profile_creates_then_get_returns_200():
    client = TestClient(app)
    payload = {
        "age": 32, "sex": "female", "height_cm": 168,
        "weight_kg": 62.5, "resting_hr": 58,
    }
    r = client.put("/api/profile", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["age"] == 32
    assert body["sex"] == "female"

    r2 = client.get("/api/profile")
    assert r2.status_code == 200
    assert r2.json()["age"] == 32


def test_put_profile_validates_age_range():
    client = TestClient(app)
    r = client.put("/api/profile", json={
        "age": 5, "sex": "male", "height_cm": 180,
    })
    assert r.status_code == 422


def test_put_profile_validates_sex_enum():
    client = TestClient(app)
    r = client.put("/api/profile", json={
        "age": 32, "sex": "other", "height_cm": 168,
    })
    assert r.status_code == 422


def test_put_profile_optional_fields_omitted():
    client = TestClient(app)
    r = client.put("/api/profile", json={
        "age": 32, "sex": "male", "height_cm": 180,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["weight_kg"] is None
    assert body["resting_hr"] is None
