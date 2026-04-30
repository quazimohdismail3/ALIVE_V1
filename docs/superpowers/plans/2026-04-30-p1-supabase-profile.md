# P1 Implementation Plan — Supabase Profile + Baseline Tables + ProfileSetup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase user_profiles + user_baselines + auxiliary tables with RLS, build /api/profile endpoint, and ship a one-question-per-screen ProfileSetup wizard that gates Landing for users without a profile.

**Architecture:** Backend already uses asyncpg + Supabase (db.py at `backend/db.py`). Existing `sessions`/`hrv_snapshots`/`rr_intervals` tables stay untouched in P1; we ADD new tables (user_profiles, user_baselines, session_rr_segments, session_metric_snapshots, insight_events) and ALTER `sessions` to add baseline-related columns the later phases need. Frontend has Supabase auth wired in `AuthContext.jsx`; we add a thin `lib/api.js` REST client and a new `ProfileSetup.jsx` page, with App.jsx gating Landing on profile presence.

**Tech Stack:** FastAPI + asyncpg + Supabase Postgres (with RLS), React + Vite + @supabase/supabase-js, pytest + pytest-asyncio for backend tests.

**Reference spec:** `docs/superpowers/specs/2026-04-30-h10-gold-standard-design.md`
**Design language:** `~/.claude/projects/C--Users-user-Desktop-mission-alive/memory/reference_psyche-design-language.md`

---

## File Map

**Backend — create:**
- `backend/migrations/001_user_profiles_baselines.sql` — schema + RLS
- `backend/api/__init__.py` — package marker
- `backend/api/profile.py` — FastAPI router
- `backend/tests/test_db_profile.py` — unit tests for profile CRUD
- `backend/tests/test_profile_api.py` — integration test (RLS isolation)

**Backend — modify:**
- `backend/db.py` — append `Profile` dataclass + `get_profile`/`upsert_profile`
- `backend/auth.py` — append `get_current_user` FastAPI dependency
- `backend/main.py` — mount `api.profile.router`

**Frontend — create:**
- `frontend/src/lib/api.js` — REST client (getProfile, putProfile)
- `frontend/src/pages/ProfileSetup.jsx` — 6-card wizard
- `frontend/src/pages/ProfileSetup.module.css` — scoped styles

**Frontend — modify:**
- `frontend/src/App.jsx` — add `profile` state + gate; `profileSetup` screen
- `frontend/src/context/AuthContext.jsx` — expose `accessToken` getter

**No deletions in P1.** SQLite is already dead — no archive needed.

---

## Task 1: Migration SQL — schema + RLS

**Files:**
- Create: `backend/migrations/001_user_profiles_baselines.sql`

This migration creates user_profiles, user_baselines, session_rr_segments, session_metric_snapshots, insight_events; alters existing `sessions` to add baseline columns; enables RLS with `auth.uid() = user_id` policies.

- [ ] **Step 1: Write the migration SQL**

Create `backend/migrations/001_user_profiles_baselines.sql`:

```sql
-- 001_user_profiles_baselines.sql
-- Phase P1 — Mission Alive H10 Gold Standard
-- Adds profile + baseline + auxiliary tables. Extends sessions with
-- baseline-related columns. RLS enforced everywhere.

-- 1. user_profiles
create table if not exists public.user_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  age        int  not null check (age between 13 and 100),
  sex        text not null check (sex in ('male','female','prefer_not_to_say')),
  height_cm  int  not null check (height_cm between 100 and 230),
  weight_kg  numeric(5,2),
  resting_hr int check (resting_hr between 30 and 120),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. user_baselines
create table if not exists public.user_baselines (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  rmssd_mean           numeric(6,2) not null,
  rmssd_sd             numeric(6,2) not null,
  rmssd_min            numeric(6,2) not null,
  rmssd_max            numeric(6,2) not null,
  hr_rest_mean         numeric(5,2),
  source               text not null check (source in ('cold_start','blended','personal')),
  n_sessions_used      int not null default 0,
  posterior_precision  numeric(10,4) not null,
  window_start         timestamptz,
  updated_at           timestamptz default now()
);

-- 3. ALTER existing sessions to add baseline-related columns
alter table public.sessions
  add column if not exists rmssd_start              numeric(6,2),
  add column if not exists rmssd_end                numeric(6,2),
  add column if not exists rmssd_median             numeric(6,2),
  add column if not exists rmssd_z                  numeric(5,2),
  add column if not exists recovery_score           int check (recovery_score between 0 and 100),
  add column if not exists hr_mean                  numeric(5,2),
  add column if not exists arousal_start            numeric(4,3),
  add column if not exists arousal_end              numeric(4,3),
  add column if not exists dominant_state           text,
  add column if not exists state_distribution       jsonb,
  add column if not exists artifact_rate            numeric(4,3),
  add column if not exists mean_sqi                 numeric(4,3),
  add column if not exists hr_drift_bpm             numeric(5,2),
  add column if not exists baseline_eligible        boolean not null default false,
  add column if not exists baseline_excluded_reason text,
  add column if not exists baseline_weight          numeric(4,3),
  add column if not exists post_mood                int check (post_mood between 1 and 5);

-- 4. session_rr_segments (waveform drill-down)
create table if not exists public.session_rr_segments (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  t_offset_s int  not null,
  rr_chunk   jsonb not null,
  primary key (session_id, t_offset_s)
);

-- 5. session_metric_snapshots (per-cycle JSON for stats charts)
create table if not exists public.session_metric_snapshots (
  session_id   uuid not null references public.sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  t_offset_s   int  not null,
  metrics_json jsonb not null,
  state_json   jsonb,
  params_json  jsonb,
  primary key (session_id, t_offset_s)
);

-- 6. insight_events
create table if not exists public.insight_events (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete cascade,
  rule_id    text not null,
  payload    jsonb not null,
  rendered   text not null,
  created_at timestamptz default now()
);
create index if not exists insight_events_user_time
  on public.insight_events(user_id, created_at desc);

-- 7. RLS — enable
alter table public.user_profiles            enable row level security;
alter table public.user_baselines           enable row level security;
alter table public.session_rr_segments      enable row level security;
alter table public.session_metric_snapshots enable row level security;
alter table public.insight_events           enable row level security;

-- 8. RLS policies — own-row only

create policy user_profiles_select on public.user_profiles
  for select using (auth.uid() = user_id);
create policy user_profiles_insert on public.user_profiles
  for insert with check (auth.uid() = user_id);
create policy user_profiles_update on public.user_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_profiles_delete on public.user_profiles
  for delete using (auth.uid() = user_id);

create policy user_baselines_select on public.user_baselines
  for select using (auth.uid() = user_id);
create policy user_baselines_insert on public.user_baselines
  for insert with check (auth.uid() = user_id);
create policy user_baselines_update on public.user_baselines
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_baselines_delete on public.user_baselines
  for delete using (auth.uid() = user_id);

create policy session_rr_segments_select on public.session_rr_segments
  for select using (auth.uid() = user_id);
create policy session_rr_segments_insert on public.session_rr_segments
  for insert with check (auth.uid() = user_id);

create policy session_metric_snapshots_select on public.session_metric_snapshots
  for select using (auth.uid() = user_id);
create policy session_metric_snapshots_insert on public.session_metric_snapshots
  for insert with check (auth.uid() = user_id);

create policy insight_events_select on public.insight_events
  for select using (auth.uid() = user_id);
create policy insight_events_insert on public.insight_events
  for insert with check (auth.uid() = user_id);
```

- [ ] **Step 2: Apply migration to Supabase via MCP**

Run via Supabase MCP tool:

```
mcp__supabase__apply_migration
  name: "001_user_profiles_baselines"
  query: <paste full SQL from step 1>
```

Expected: success, no errors. If `sessions` table missing, this is the first run on a clean Supabase project — apply existing pre-P1 migration first (sessions/hrv_snapshots/rr_intervals must already exist; verify with `mcp__supabase__list_tables`).

- [ ] **Step 3: Verify tables created and RLS enabled**

Run via Supabase MCP:

```
mcp__supabase__list_tables  schemas: ["public"]
```

Expected output includes: user_profiles, user_baselines, session_rr_segments, session_metric_snapshots, insight_events. Each shows `rls_enabled=true`.

- [ ] **Step 4: Verify ALTER on sessions added new columns**

Run via Supabase MCP:

```
mcp__supabase__execute_sql
  query: "select column_name from information_schema.columns where table_name='sessions' and column_name in ('rmssd_median','baseline_eligible','baseline_weight','baseline_excluded_reason','post_mood','recovery_score') order by column_name;"
```

Expected: 6 rows returned — all columns present.

- [ ] **Step 5: Commit migration file**

```bash
git add backend/migrations/001_user_profiles_baselines.sql
git commit -m "feat(db): add user_profiles, user_baselines, session_rr_segments, session_metric_snapshots, insight_events with RLS

Extends sessions with baseline-related columns (rmssd_*, recovery_score, baseline_*, post_mood).
RLS policies enforce auth.uid()=user_id on all new tables.
Applied via Supabase MCP."
```

---

## Task 2: Profile dataclass + db CRUD

**Files:**
- Modify: `backend/db.py` (append after existing functions)
- Test: `backend/tests/test_db_profile.py` (create)

**Pattern note:** existing db.py uses module-level `_pool` + `async with _pool.acquire()`. Match that pattern; do not introduce a class.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_db_profile.py`:

```python
"""Profile CRUD against real Supabase. Requires DATABASE_URL + a test auth user UUID."""
from __future__ import annotations
import os
import uuid
import pytest
from backend import db


# Fixture: test user UUID. Use a fixed UUID created manually in Supabase auth (or
# derive from env var TEST_USER_ID). RLS will be bypassed because db.py connects as
# postgres role (DSN), not as a logged-in user — see task 6 for the RLS test that
# uses a JWT-scoped connection.
TEST_USER_ID = os.environ.get("TEST_USER_ID", "00000000-0000-0000-0000-000000000001")


@pytest.fixture(autouse=True)
async def _pool():
    await db.init_pool()
    yield
    await db.close_pool()


@pytest.fixture(autouse=True)
async def _clean():
    """Clean profile row before each test."""
    async with db._pool.acquire() as conn:
        await conn.execute(
            "delete from public.user_profiles where user_id = $1",
            uuid.UUID(TEST_USER_ID),
        )


@pytest.mark.asyncio
async def test_get_profile_returns_none_when_missing():
    profile = await db.get_profile(TEST_USER_ID)
    assert profile is None


@pytest.mark.asyncio
async def test_upsert_profile_inserts_new_row():
    await db.upsert_profile(
        TEST_USER_ID,
        age=32, sex="female", height_cm=168,
        weight_kg=62.5, resting_hr=58,
    )
    profile = await db.get_profile(TEST_USER_ID)
    assert profile is not None
    assert profile.age == 32
    assert profile.sex == "female"
    assert profile.height_cm == 168
    assert float(profile.weight_kg) == 62.5
    assert profile.resting_hr == 58


@pytest.mark.asyncio
async def test_upsert_profile_updates_existing_row():
    await db.upsert_profile(TEST_USER_ID, age=32, sex="female", height_cm=168)
    await db.upsert_profile(TEST_USER_ID, age=33, sex="female", height_cm=168)
    profile = await db.get_profile(TEST_USER_ID)
    assert profile.age == 33


@pytest.mark.asyncio
async def test_upsert_profile_optional_fields_default_to_null():
    await db.upsert_profile(TEST_USER_ID, age=32, sex="male", height_cm=180)
    profile = await db.get_profile(TEST_USER_ID)
    assert profile.weight_kg is None
    assert profile.resting_hr is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && DATABASE_URL=$DATABASE_URL python -m pytest tests/test_db_profile.py -v
```

Expected: FAIL with `AttributeError: module 'backend.db' has no attribute 'get_profile'`.

- [ ] **Step 3: Implement Profile dataclass + CRUD in db.py**

Append to `backend/db.py` (do not modify existing functions):

```python
from dataclasses import dataclass
from decimal import Decimal


@dataclass
class Profile:
    user_id: str
    age: int
    sex: str
    height_cm: int
    weight_kg: Optional[Decimal]
    resting_hr: Optional[int]


async def get_profile(user_id: str) -> Optional[Profile]:
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            select user_id::text, age, sex, height_cm, weight_kg, resting_hr
            from public.user_profiles
            where user_id = $1
            """,
            uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
        )
    if row is None:
        return None
    return Profile(**dict(row))


async def upsert_profile(
    user_id: str,
    *,
    age: int,
    sex: str,
    height_cm: int,
    weight_kg: Optional[float] = None,
    resting_hr: Optional[int] = None,
) -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            insert into public.user_profiles
              (user_id, age, sex, height_cm, weight_kg, resting_hr, updated_at)
            values ($1, $2, $3, $4, $5, $6, now())
            on conflict (user_id) do update set
              age        = excluded.age,
              sex        = excluded.sex,
              height_cm  = excluded.height_cm,
              weight_kg  = excluded.weight_kg,
              resting_hr = excluded.resting_hr,
              updated_at = now()
            """,
            uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
            age, sex, height_cm, weight_kg, resting_hr,
        )
```

Add `import uuid` at top of `backend/db.py` if not already present.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && DATABASE_URL=$DATABASE_URL python -m pytest tests/test_db_profile.py -v
```

Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_db_profile.py
git commit -m "feat(db): add Profile dataclass + get_profile/upsert_profile

Append to existing asyncpg db.py module. Tests run against real Supabase
using TEST_USER_ID env var (defaults to fixed UUID). Cleans profile row
before each test to keep them idempotent."
```

---

## Task 3: FastAPI auth dependency `get_current_user`

**Files:**
- Modify: `backend/auth.py` (append)
- Test: `backend/tests/test_auth.py` (extend; already exists per memory)

Existing `validate_token(token)` decodes a Supabase JWT. We need a FastAPI dependency that pulls the bearer token from the request headers and returns the user UUID.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_auth.py`:

```python
import pytest
from fastapi import HTTPException
from backend.auth import get_current_user


class FakeRequest:
    def __init__(self, auth_header: str | None):
        self.headers = {"Authorization": auth_header} if auth_header else {}


def test_get_current_user_returns_sub_from_valid_token(monkeypatch):
    monkeypatch.setattr(
        "backend.auth.validate_token",
        lambda token: {"sub": "abcd-1234"},
    )
    user_id = get_current_user(FakeRequest("Bearer goodtoken"))
    assert user_id == "abcd-1234"


def test_get_current_user_raises_401_when_no_header():
    with pytest.raises(HTTPException) as exc:
        get_current_user(FakeRequest(None))
    assert exc.value.status_code == 401


def test_get_current_user_raises_401_when_malformed_header():
    with pytest.raises(HTTPException) as exc:
        get_current_user(FakeRequest("not-bearer"))
    assert exc.value.status_code == 401


def test_get_current_user_raises_401_on_invalid_token(monkeypatch):
    from backend.auth import AuthError
    monkeypatch.setattr(
        "backend.auth.validate_token",
        lambda token: (_ for _ in ()).throw(AuthError("invalid")),
    )
    with pytest.raises(HTTPException) as exc:
        get_current_user(FakeRequest("Bearer badtoken"))
    assert exc.value.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_auth.py -v
```

Expected: 4 NEW FAILURES with `ImportError: cannot import name 'get_current_user' from 'backend.auth'`.

- [ ] **Step 3: Implement `get_current_user`**

Append to `backend/auth.py`:

```python
from fastapi import HTTPException, Request


def get_current_user(request: Request) -> str:
    """FastAPI dependency. Extracts Supabase JWT from Authorization header,
    validates it, returns the user UUID (sub claim). Raises 401 on any failure.
    """
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing or malformed bearer token")
    token = header[len("Bearer "):]
    try:
        payload = validate_token(token)
    except AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return payload["sub"]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && python -m pytest tests/test_auth.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/auth.py backend/tests/test_auth.py
git commit -m "feat(auth): add get_current_user FastAPI dependency

Extracts and validates Supabase JWT from Authorization: Bearer header.
Returns the sub claim (user UUID). Raises 401 on any failure.
4 unit tests cover valid token, missing header, malformed header, invalid token."
```

---

## Task 4: `/api/profile` GET + PUT endpoints

**Files:**
- Create: `backend/api/__init__.py`
- Create: `backend/api/profile.py`
- Test: `backend/tests/test_profile_api.py` (will hold both API tests + RLS isolation in Task 6)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_profile_api.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && DATABASE_URL=$DATABASE_URL python -m pytest tests/test_profile_api.py -v
```

Expected: FAIL — `404 Not Found` because `/api/profile` does not exist yet.

- [ ] **Step 3: Create `backend/api/__init__.py`**

```python
"""HTTP API routers (REST). WebSocket session stream stays in main.py."""
```

- [ ] **Step 4: Implement the router**

Create `backend/api/profile.py`:

```python
"""Profile REST endpoints. RLS gates per-user data; auth via Bearer JWT."""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.auth import get_current_user
from backend import db


router = APIRouter(prefix="/api", tags=["profile"])


class ProfileIn(BaseModel):
    age:        int  = Field(..., ge=13, le=100)
    sex:        str  = Field(..., pattern="^(male|female|prefer_not_to_say)$")
    height_cm:  int  = Field(..., ge=100, le=230)
    weight_kg:  Optional[float] = Field(default=None, ge=20, le=300)
    resting_hr: Optional[int]   = Field(default=None, ge=30, le=120)


class ProfileOut(BaseModel):
    age:        int
    sex:        str
    height_cm:  int
    weight_kg:  Optional[float] = None
    resting_hr: Optional[int]   = None


@router.get("/profile", response_model=ProfileOut)
async def get_profile(user_id: str = Depends(get_current_user)) -> ProfileOut:
    profile = await db.get_profile(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    return ProfileOut(
        age=profile.age,
        sex=profile.sex,
        height_cm=profile.height_cm,
        weight_kg=float(profile.weight_kg) if profile.weight_kg is not None else None,
        resting_hr=profile.resting_hr,
    )


@router.put("/profile", response_model=ProfileOut)
async def put_profile(
    body: ProfileIn,
    user_id: str = Depends(get_current_user),
) -> ProfileOut:
    await db.upsert_profile(
        user_id,
        age=body.age,
        sex=body.sex,
        height_cm=body.height_cm,
        weight_kg=body.weight_kg,
        resting_hr=body.resting_hr,
    )
    return ProfileOut(**body.model_dump())
```

- [ ] **Step 5: Mount router in main.py**

Edit `backend/main.py` — add near other route mounts (search for existing `app.include_router` or `@app.get` lines; if no router pattern, add after `app = FastAPI(...)`):

```python
from backend.api.profile import router as profile_router
app.include_router(profile_router)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && DATABASE_URL=$DATABASE_URL python -m pytest tests/test_profile_api.py -v
```

Expected: 5 PASSED.

- [ ] **Step 7: Commit**

```bash
git add backend/api/__init__.py backend/api/profile.py backend/main.py backend/tests/test_profile_api.py
git commit -m "feat(api): add /api/profile GET and PUT endpoints

Pydantic validation enforces age 13-100, sex enum, height 100-230, optional
weight/resting_hr ranges. Auth via Bearer JWT (Supabase). 5 integration tests
cover happy path, validation, optional fields, missing profile."
```

---

## Task 5: RLS isolation integration test (two users)

**Files:**
- Modify: `backend/tests/test_profile_api.py` (extend with two-user RLS test)

**Why this test exists:** asyncpg connects as the postgres superuser via DATABASE_URL and bypasses RLS. The application layer enforces user_id via the JWT sub claim — but if a coding mistake ever passes a different user_id into a query, RLS at the database level is the last line of defense. This test connects via a Supabase-issued user JWT (which DOES respect RLS) and verifies cross-user reads are blocked.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_profile_api.py`:

```python
"""RLS isolation — verify a user's JWT cannot read another user's profile via
a JWT-scoped Postgres connection. Requires SUPABASE_URL +
SUPABASE_SERVICE_ROLE_KEY env vars to mint two test JWTs via admin API.
"""
import asyncpg
import httpx


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"),
    reason="needs SUPABASE_SERVICE_ROLE_KEY to mint test JWTs",
)
async def test_rls_blocks_cross_user_profile_read():
    """Two real auth users; user A writes profile; user B's JWT-scoped
    connection cannot read it."""
    sb_url = os.environ["SUPABASE_URL"]
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    db_url = os.environ["DATABASE_URL"]

    # 1. Create two test users via Supabase admin API (idempotent: ignore conflict)
    async with httpx.AsyncClient(headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }) as http:
        a = await http.post(f"{sb_url}/auth/v1/admin/users", json={
            "email": "rls-test-a@example.test",
            "password": "rls-test-A-password-9q3",
            "email_confirm": True,
        })
        b = await http.post(f"{sb_url}/auth/v1/admin/users", json={
            "email": "rls-test-b@example.test",
            "password": "rls-test-B-password-9q3",
            "email_confirm": True,
        })
        # Both 200 (created) or 422 (already exists) acceptable
        assert a.status_code in (200, 422), a.text
        assert b.status_code in (200, 422), b.text

        # 2. Sign in to get JWTs
        sa = await http.post(f"{sb_url}/auth/v1/token?grant_type=password", json={
            "email": "rls-test-a@example.test",
            "password": "rls-test-A-password-9q3",
        })
        sb = await http.post(f"{sb_url}/auth/v1/token?grant_type=password", json={
            "email": "rls-test-b@example.test",
            "password": "rls-test-B-password-9q3",
        })
        assert sa.status_code == 200, sa.text
        assert sb.status_code == 200, sb.text
        token_a = sa.json()["access_token"]
        token_b = sb.json()["access_token"]
        user_a_id = sa.json()["user"]["id"]

    # 3. Write profile for user A using superuser pool (bypasses RLS — used here as setup)
    await db.init_pool()
    try:
        async with db._pool.acquire() as conn:
            await conn.execute(
                "delete from public.user_profiles where user_id = $1",
                uuid.UUID(user_a_id),
            )
        await db.upsert_profile(user_a_id, age=40, sex="male", height_cm=178)

        # 4. Open a JWT-scoped connection as user B and try to read A's profile
        # Supabase pooler accepts a "options" param to set request.jwt.claim.sub
        # but cleaner: use the REST PostgREST endpoint which honors RLS directly.
        async with httpx.AsyncClient(headers={
            "apikey": os.environ["SUPABASE_ANON_KEY"],
            "Authorization": f"Bearer {token_b}",
        }) as http:
            r = await http.get(
                f"{sb_url}/rest/v1/user_profiles",
                params={"user_id": f"eq.{user_a_id}", "select": "age"},
            )
        assert r.status_code == 200
        body = r.json()
        assert body == [], f"RLS leak: user B read user A's profile: {body}"

        # 5. Sanity check: user A CAN read their own profile via REST
        async with httpx.AsyncClient(headers={
            "apikey": os.environ["SUPABASE_ANON_KEY"],
            "Authorization": f"Bearer {token_a}",
        }) as http:
            r2 = await http.get(
                f"{sb_url}/rest/v1/user_profiles",
                params={"user_id": f"eq.{user_a_id}", "select": "age"},
            )
        assert r2.status_code == 200
        assert r2.json() == [{"age": 40}]
    finally:
        await db.close_pool()
```

- [ ] **Step 2: Run test to verify it gates correctly**

```bash
cd backend && python -m pytest tests/test_profile_api.py::test_rls_blocks_cross_user_profile_read -v
```

Expected: PASS (RLS is already enabled by Task 1 migration). If the test fails with `RLS leak`, the migration policies were not applied correctly — re-check policies in Supabase dashboard.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_profile_api.py
git commit -m "test(rls): two-user isolation test for user_profiles

Mints two real Supabase auth users via admin API, signs them in, and
verifies user B's JWT-scoped REST read cannot see user A's profile.
Skipped when SUPABASE_SERVICE_ROLE_KEY env var is missing."
```

---

## Task 6: Frontend `lib/api.js` REST client

**Files:**
- Create: `frontend/src/lib/api.js`

- [ ] **Step 1: Write the client**

Create `frontend/src/lib/api.js`:

```javascript
import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function authHeaders() {
  if (!supabase) return {}
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function getProfile() {
  const headers = await authHeaders()
  const r = await fetch(`${API_URL}/api/profile`, { headers })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`getProfile failed: ${r.status}`)
  return r.json()
}

export async function putProfile(profile) {
  const headers = {
    ...(await authHeaders()),
    'Content-Type': 'application/json',
  }
  const r = await fetch(`${API_URL}/api/profile`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(profile),
  })
  if (!r.ok) {
    const detail = await r.text()
    throw new Error(`putProfile failed: ${r.status} ${detail}`)
  }
  return r.json()
}
```

- [ ] **Step 2: Manual smoke (no test framework yet for frontend)**

Open browser devtools console on a logged-in dev session and run:

```javascript
const { getProfile, putProfile } = await import('/src/lib/api.js')
console.log(await getProfile())  // expect: null (no profile yet)
console.log(await putProfile({ age: 30, sex: 'female', height_cm: 165 }))
console.log(await getProfile())  // expect: { age: 30, sex: 'female', height_cm: 165, weight_kg: null, resting_hr: null }
```

Expected: first call null, PUT returns the body, second GET returns the saved profile.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "feat(frontend): add lib/api.js REST client (getProfile, putProfile)

Pulls Bearer token from Supabase session. VITE_API_URL env var (defaults to
http://localhost:8000)."
```

---

## Task 7: ProfileSetup.jsx — one-question-per-screen wizard

**Files:**
- Create: `frontend/src/pages/ProfileSetup.jsx`
- Create: `frontend/src/pages/ProfileSetup.module.css`

**Design constraints (from `reference_psyche-design-language.md`):**
- One question per card — Calm/Headspace cadence
- Progress shown as dots, never %
- Optional fields collapsed under soft "These help us be even more accurate"
- Citations on tooltips for sex (Umetani 1998, Nunan 2010) and resting_hr (Aubert 2003)
- No clinical red, no failure framing — invalid input shows soft amber-grey hint
- Final card: "Your starting baseline is ready"

- [ ] **Step 1: Implement the component**

Create `frontend/src/pages/ProfileSetup.jsx`:

```jsx
import { useState } from 'react'
import { putProfile } from '../lib/api'
import styles from './ProfileSetup.module.css'

const STEPS = ['hero', 'age', 'sex', 'height', 'weight', 'resting_hr', 'done']

export default function ProfileSetup({ onComplete }) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState({
    age: '', sex: '', height_cm: '',
    weight_kg: '', resting_hr: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))
  const set = (k) => (v) => setData((d) => ({ ...d, [k]: v }))

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        age: parseInt(data.age, 10),
        sex: data.sex,
        height_cm: parseInt(data.height_cm, 10),
        weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
        resting_hr: data.resting_hr ? parseInt(data.resting_hr, 10) : null,
      }
      await putProfile(payload)
      next()  // go to 'done' card
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const current = STEPS[step]

  return (
    <div className={styles.root}>
      <Dots count={STEPS.length} active={step} />
      {current === 'hero' && (
        <Card>
          <h1>Tell us about you</h1>
          <p>So the science can fit your body.</p>
          <PrimaryButton onClick={next}>Begin</PrimaryButton>
        </Card>
      )}
      {current === 'age' && (
        <Card>
          <h2>How old are you?</h2>
          <NumberInput value={data.age} onChange={set('age')} min={13} max={100} placeholder="32" />
          <Nav onBack={back} onNext={next} canNext={isValidAge(data.age)} />
        </Card>
      )}
      {current === 'sex' && (
        <Card>
          <h2>Biological sex</h2>
          <p className={styles.subtle}>
            Shapes your healthy heart-rhythm range — peer-reviewed norms (Umetani 1998, Nunan 2010).
          </p>
          <SegmentedChoice
            options={[
              ['male', 'Male'],
              ['female', 'Female'],
              ['prefer_not_to_say', 'Prefer not to say'],
            ]}
            value={data.sex}
            onChange={set('sex')}
          />
          <Nav onBack={back} onNext={next} canNext={!!data.sex} />
        </Card>
      )}
      {current === 'height' && (
        <Card>
          <h2>Your height</h2>
          <NumberInput value={data.height_cm} onChange={set('height_cm')} min={100} max={230} placeholder="170" suffix="cm" />
          <Nav onBack={back} onNext={next} canNext={isValidHeight(data.height_cm)} />
        </Card>
      )}
      {current === 'weight' && (
        <Card>
          <h2>Your weight</h2>
          <p className={styles.subtle}>Optional — helps fine-tune your baseline.</p>
          <NumberInput value={data.weight_kg} onChange={set('weight_kg')} min={20} max={300} placeholder="65" suffix="kg" allowEmpty />
          <Nav onBack={back} onNext={next} canNext={true} />
        </Card>
      )}
      {current === 'resting_hr' && (
        <Card>
          <h2>Resting heart rate</h2>
          <p className={styles.subtle}>
            Optional — your heart rate when fully rested. Lower resting HR is associated with higher HRV (Aubert 2003).
          </p>
          <NumberInput value={data.resting_hr} onChange={set('resting_hr')} min={30} max={120} placeholder="60" suffix="bpm" allowEmpty />
          <Nav onBack={back} onNext={submit} canNext={true} nextLabel={submitting ? 'Saving…' : 'Finish'} disabled={submitting} />
          {error && <p className={styles.softError}>Something didn't save. Let's try again.</p>}
        </Card>
      )}
      {current === 'done' && (
        <Card>
          <h1>Your starting baseline is ready</h1>
          <p>We'll refine it from your real H10 sessions over the next few days.</p>
          <PrimaryButton onClick={onComplete}>Continue</PrimaryButton>
        </Card>
      )}
    </div>
  )
}

function isValidAge(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 13 && n <= 100 }
function isValidHeight(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 100 && n <= 230 }

function Dots({ count, active }) {
  return (
    <div className={styles.dots}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={i === active ? styles.dotActive : styles.dot} />
      ))}
    </div>
  )
}

function Card({ children }) {
  return <div className={styles.card}>{children}</div>
}

function PrimaryButton({ children, onClick, disabled }) {
  return <button className={styles.primary} onClick={onClick} disabled={disabled}>{children}</button>
}

function NumberInput({ value, onChange, min, max, placeholder, suffix, allowEmpty }) {
  return (
    <div className={styles.inputRow}>
      <input
        className={styles.numberInput}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        placeholder={placeholder}
        inputMode="numeric"
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  )
}

function SegmentedChoice({ options, value, onChange }) {
  return (
    <div className={styles.segmented}>
      {options.map(([val, label]) => (
        <button
          key={val}
          className={value === val ? styles.segmentActive : styles.segment}
          onClick={() => onChange(val)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Nav({ onBack, onNext, canNext, nextLabel = 'Next', disabled }) {
  return (
    <div className={styles.nav}>
      <button className={styles.secondary} onClick={onBack}>Back</button>
      <button className={styles.primary} onClick={onNext} disabled={!canNext || disabled}>{nextLabel}</button>
    </div>
  )
}
```

- [ ] **Step 2: Add component styles**

Create `frontend/src/pages/ProfileSetup.module.css`:

```css
.root {
  min-height: 100dvh;
  background: radial-gradient(ellipse at center, #1a1f4d 0%, #0c0e2b 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: #f4ead4;
  font-family: 'Outfit', system-ui, sans-serif;
}

.dots {
  display: flex;
  gap: 8px;
  margin-bottom: 32px;
}
.dot, .dotActive {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(244, 234, 212, 0.25);
  transition: background 600ms ease;
}
.dotActive {
  background: #3FBFA8;
}

.card {
  max-width: 420px;
  width: 100%;
  padding: 32px 24px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(12px);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: fadeIn 600ms ease;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.card h1 {
  font-size: 32px;
  font-weight: 200;
  letter-spacing: 0.02em;
  margin: 0;
}
.card h2 {
  font-size: 22px;
  font-weight: 300;
  margin: 0;
}
.card p {
  font-weight: 350;
  opacity: 0.7;
  margin: 0;
  line-height: 1.6;
}

.subtle {
  font-size: 14px;
  opacity: 0.6 !important;
}

.softError {
  color: #9C8A6E;
  font-size: 14px;
}

.inputRow {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
}
.numberInput {
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(244, 234, 212, 0.3);
  color: #f4ead4;
  font-size: 56px;
  font-family: inherit;
  font-weight: 200;
  text-align: center;
  width: 160px;
  padding: 8px 0;
  outline: none;
  transition: border-color 300ms ease;
}
.numberInput:focus {
  border-color: #3FBFA8;
}
.suffix {
  font-size: 16px;
  opacity: 0.6;
}

.segmented {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.segment, .segmentActive {
  padding: 14px 20px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.02);
  color: inherit;
  font-family: inherit;
  font-size: 16px;
  cursor: pointer;
  transition: all 300ms ease;
}
.segmentActive {
  background: rgba(63, 191, 168, 0.2);
  border-color: #3FBFA8;
}

.nav {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;
}
.primary, .secondary {
  flex: 1;
  padding: 14px 20px;
  border-radius: 12px;
  border: none;
  font-family: inherit;
  font-size: 16px;
  cursor: pointer;
  transition: all 300ms ease;
}
.primary {
  background: #3FBFA8;
  color: #0c0e2b;
}
.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.secondary {
  background: transparent;
  color: rgba(244, 234, 212, 0.7);
  border: 1px solid rgba(244, 234, 212, 0.2);
}

@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
}
```

- [ ] **Step 3: Manual smoke test**

Run dev server:

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

Temporarily add to App.jsx (will be replaced in Task 8) just to render and click through:

```jsx
import ProfileSetup from './pages/ProfileSetup'
// inside App, render: <ProfileSetup onComplete={() => alert('done')} />
```

Click through all 7 steps. Verify:
- Dots indicator advances
- Age "5" disables Next; "32" enables it
- Sex selection works
- Height "170" enables Next
- Weight skip (empty) allowed
- Resting HR skip allowed
- Submit posts; success card appears

Revert the temporary App.jsx render — the real wiring is Task 8.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ProfileSetup.jsx frontend/src/pages/ProfileSetup.module.css
git commit -m "feat(ui): ProfileSetup wizard — one question per screen

6-card flow (hero, age, sex, height, weight*, resting_hr*, done) with
Calm/Headspace cadence. Cosmic background. Per psyche-design-language:
no clinical red, soft amber-grey for errors, citations in subhead copy."
```

---

## Task 8: AuthContext — expose `accessToken` getter (no-op if already present)

**Files:**
- Modify: `frontend/src/context/AuthContext.jsx`

The api.js client uses `supabase.auth.getSession()` directly so this is mostly a no-op verification — but if AuthContext currently filters out the access token from its public surface, expose it for App.jsx's profile gate.

- [ ] **Step 1: Read current AuthContext.jsx**

```bash
# Open in editor or:
cat frontend/src/context/AuthContext.jsx
```

If `useAuth()` already returns `session` (per memory #938), no change needed and `session.access_token` is reachable. Skip to Step 3.

- [ ] **Step 2: If `session` is NOT exposed, expose it**

If the context value omits session, edit the provider to include it. Search for `value={` line and ensure `session` is in the object. Example:

```jsx
return (
  <AuthContext.Provider value={{ user, session, loading, signOut }}>
    {children}
  </AuthContext.Provider>
)
```

- [ ] **Step 3: No commit unless changed**

If no edit was needed, skip. If edited:

```bash
git add frontend/src/context/AuthContext.jsx
git commit -m "feat(auth): expose session from AuthContext for API client access"
```

---

## Task 9: App.jsx — profile gate

**Files:**
- Modify: `frontend/src/App.jsx`

**Add behavior:** when user is authenticated, fetch profile on mount. If 404 → render ProfileSetup. If 200 → continue to existing screens. After ProfileSetup completes, transition to `landing`.

- [ ] **Step 1: Read current App.jsx**

```bash
cat frontend/src/App.jsx
```

Per memory #1058, App.jsx is a useState screen-switcher: `'login' | 'landing' | 'setup' | 'session' | 'insight'`. We add a `'profileSetup'` screen and a `profileLoaded` state.

- [ ] **Step 2: Add profile gate**

Edit `frontend/src/App.jsx` — add imports + new state + effect + screen branch. Concrete diff (paste-replace at the relevant locations):

```jsx
import ProfileSetup from './pages/ProfileSetup'
import { getProfile } from './lib/api'

// Inside component, after existing useState lines, add:
const [profile, setProfile] = useState(undefined)  // undefined = loading, null = none, object = present

// Replace the existing user-effect (or add a new effect after it):
useEffect(() => {
  if (!user) {
    setProfile(undefined)
    return
  }
  let cancelled = false
  ;(async () => {
    try {
      const p = await getProfile()
      if (!cancelled) setProfile(p)  // null if 404
    } catch (e) {
      if (!cancelled) {
        console.error('profile fetch failed', e)
        setProfile(null)  // treat error as missing — re-prompt
      }
    }
  })()
  return () => { cancelled = true }
}, [user])

// In the render branch (where unauthenticated users see LoginScreen):
if (!user) return <LoginScreen />
if (profile === undefined) return <LoadingSpinner />  // or existing spinner JSX
if (profile === null) {
  return (
    <ProfileSetup
      onComplete={async () => {
        // Re-fetch to populate state then drop into landing
        const p = await getProfile()
        setProfile(p)
        setScreen('landing')
      }}
    />
  )
}
// Existing screen switch unchanged below this point.
```

If there is no shared `LoadingSpinner` component, reuse whatever spinning div exists in the existing loading branch (per memory #1058: "spinning CSS border div against #0A0A0F").

- [ ] **Step 3: Manual smoke test**

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

Test cases:
1. **New user signup** → ProfileSetup appears → submit → Landing appears.
2. **Existing user with profile** → Landing appears immediately (no ProfileSetup flash).
3. **Existing user, deleted profile via Supabase admin** → on next load, ProfileSetup appears.
4. **Network failure during fetch** → ProfileSetup appears (graceful degrade).

For test 3, delete the profile row via Supabase MCP:

```
mcp__supabase__execute_sql
  query: "delete from public.user_profiles where user_id = '<that user's uuid>';"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(app): gate Landing on profile presence — ProfileSetup if 404

After auth, fetch profile via /api/profile. Render ProfileSetup if null
(404 or fetch error). On completion, refetch and route to landing."
```

---

## Task 10: End-to-end verification + push

**Files:** none modified — verification only.

- [ ] **Step 1: Backend tests pass**

```bash
cd backend && DATABASE_URL=$DATABASE_URL python -m pytest -v
```

Expected: all green (existing tests + new test_db_profile, test_auth additions, test_profile_api).

- [ ] **Step 2: Frontend build passes**

```bash
cd frontend && npm run build
```

Expected: build succeeds, no missing-import errors.

- [ ] **Step 3: Live E2E with two real users**

In two separate browser private windows:
1. **Window A:** sign up `e2e-a@example.test` → ProfileSetup → submit `{age:30, sex:'female', height_cm:165}` → arrive at Landing.
2. **Window B:** sign up `e2e-b@example.test` → ProfileSetup → submit `{age:45, sex:'male', height_cm:180, weight_kg:80}` → arrive at Landing.
3. **Verify isolation via Supabase MCP:**

```
mcp__supabase__execute_sql
  query: "select user_id, age, sex, height_cm from public.user_profiles order by age;"
```

Expected: 2 rows, distinct user_ids, correct values per user.

- [ ] **Step 4: Update CLAUDE.md LIVE STATE TABLE**

Edit `CLAUDE.md`:
- Change `Auth / Postgres` row from `❌ SQLite, no auth` to `✅ Supabase + auth + profile`
- Update `Last updated` to today (`2026-04-30`)
- Append to Update Protocol log:

```
[2026-04-30] P1 shipped — Supabase user_profiles + RLS + ProfileSetup wizard live; reason: unblocks per-user baseline math (P2)
```

- [ ] **Step 5: Push to GitHub**

Per memory `feedback_push-after-changes.md`: push immediately after committing.

```bash
git push origin main
```

Expected: Vercel + Railway auto-deploy. Verify deploy success in dashboards.

- [ ] **Step 6: Final commit for CLAUDE.md update**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update LIVE STATE TABLE — P1 (auth + profile + Supabase) shipped"
git push origin main
```

---

## Out of P1 scope (do NOT do here)

These belong to P2/P3/P4 — flagged so the engineer doesn't drift:

- baseline_engine.py (P2)
- HRVProcessor quality scalars (P2)
- Calibration cal_hrv harvest (P2)
- Calibration UI psyche redesign (P2)
- Control loop retune / dynamic alpha / sliding window (P3)
- Stats.jsx, SessionDetail.jsx, all NEW components (P4)
- Insight engine R3–R10 (P4)
- Tone.js scrub renderer (P4)

If a task tempts you to touch any of these, stop and update the plan instead.

---

## Spec coverage check

Mapping each P1 spec section to a task:

| Spec section | Task |
|--------------|------|
| §2 schema (user_profiles, user_baselines, session_rr_segments, session_metric_snapshots, insight_events, RLS policies) | Task 1 |
| §2 sessions ALTER (rmssd_*, recovery_score, baseline_*, post_mood) | Task 1 step 4 |
| §5g GET /api/profile | Tasks 2, 3, 4 |
| §5g PUT /api/profile | Tasks 2, 3, 4 |
| §5.5 ProfileSetup screen — 6-card flow, Calm/Headspace cadence | Tasks 6, 7 |
| §5.5 ProfileSetup citations on tooltips | Task 7 step 1 (subhead copy) |
| §5.5 LoginScreen redirect to ProfileSetup if profile null | Tasks 8, 9 |
| §6a P1 acceptance: RLS isolation verified | Task 5 |
| §6 risk: cross-user data leak | Tasks 1 (policies), 5 (test) |
| §6 risk: asyncpg pool exhaustion | Existing db.py already caps at 5 — no change |

All P1 spec requirements have a task. P2–P4 spec sections explicitly excluded above.
