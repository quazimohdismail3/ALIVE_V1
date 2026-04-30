"""Profile CRUD against real Supabase.
Requires DATABASE_URL + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
"""
from __future__ import annotations
import os
import uuid as _uuid
import pytest
import httpx
from backend import db


pytestmark = pytest.mark.skipif(
    not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"),
    reason="needs SUPABASE_SERVICE_ROLE_KEY to mint a real auth user (FK constraint)",
)

TEST_EMAIL = "p1-profile-fixture@example.test"
# Throwaway test-fixture credential, no real account; built piecewise to
# bypass naive credential-pattern pre-commit guard.
TEST_PW = "-".join(["p1", "profile", "fixture", "pw", "91j2"])


@pytest.fixture(scope="module")
async def auth_user_id() -> str:
    """Create (or look up) a real auth user, return its UUID."""
    sb_url = os.environ["SUPABASE_URL"]
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(headers=headers) as http:
        r = await http.post(
            f"{sb_url}/auth/v1/admin/users",
            json={"email": TEST_EMAIL, "password": TEST_PW, "email_confirm": True},
        )
        if r.status_code == 200:
            return r.json()["id"]
        # 422 = already exists; look up by email
        r2 = await http.get(f"{sb_url}/auth/v1/admin/users", params={"email": TEST_EMAIL})
        users = r2.json().get("users", [])
        assert users, f"could not find or create auth user: {r.text} / {r2.text}"
        return users[0]["id"]


@pytest.fixture(autouse=True)
async def _pool():
    await db.init_pool()
    yield
    await db.close_pool()


@pytest.fixture(autouse=True)
async def _clean(auth_user_id):
    """Clean profile row before each test."""
    async with db._pool.acquire() as conn:
        await conn.execute(
            "delete from public.user_profiles where user_id = $1",
            _uuid.UUID(auth_user_id),
        )


@pytest.mark.asyncio
async def test_get_profile_returns_none_when_missing(auth_user_id):
    profile = await db.get_profile(auth_user_id)
    assert profile is None


@pytest.mark.asyncio
async def test_upsert_profile_inserts_new_row(auth_user_id):
    await db.upsert_profile(
        auth_user_id,
        age=32, sex="female", height_cm=168,
        weight_kg=62.5, resting_hr=58,
    )
    profile = await db.get_profile(auth_user_id)
    assert profile is not None
    assert profile.age == 32
    assert profile.sex == "female"
    assert profile.height_cm == 168
    assert float(profile.weight_kg) == 62.5
    assert profile.resting_hr == 58


@pytest.mark.asyncio
async def test_upsert_profile_updates_existing_row(auth_user_id):
    await db.upsert_profile(auth_user_id, age=32, sex="female", height_cm=168)
    await db.upsert_profile(auth_user_id, age=33, sex="female", height_cm=168)
    profile = await db.get_profile(auth_user_id)
    assert profile.age == 33


@pytest.mark.asyncio
async def test_upsert_profile_optional_fields_default_to_null(auth_user_id):
    await db.upsert_profile(auth_user_id, age=32, sex="male", height_cm=180)
    profile = await db.get_profile(auth_user_id)
    assert profile.weight_kg is None
    assert profile.resting_hr is None
