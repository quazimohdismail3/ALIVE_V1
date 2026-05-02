# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the post-auth `Landing.jsx` screen with a proper `Dashboard.jsx` that shows live HRV status, RF badge, rule-based session recommendations, and recent session history, without touching the HRV pipeline or any downstream screens.

**Architecture:** `Dashboard.jsx` composes four new leaf components (`LiveHRVStrip`, `RFStatusBadge`, `RecommendationCard`, `SessionHistoryCard`) and two new fetch hooks (`useSessionHistory`, `useRecommendations`). Data flows one-way: SensorContext → components (live sensor state), and two new REST endpoints (`GET /api/sessions`, `GET /api/recommendations`) → hooks → components (persisted data). App.jsx gets three string replacements only (`'landing'` → `'dashboard'`). The backend adds one new `db.get_sessions()` function and one pure-function `build_recommendations()` rule engine; both are independently testable before any frontend work starts.

**Tech Stack:** React 18 + Vite, FastAPI, asyncpg + SQLite (dual-path), pytest, Supabase JWT auth.

**Reference spec:** `docs/superpowers/specs/2026-05-02-dashboard-design.md`

**Depends on (must be done first — do not skip):**
- SensorContext spec — provides `useSensorContext()` hook, `rfBpm`, `rfConfidenceTag`, `isConnected`, `latestHRV`, `wsRef`
- Auth/Landing spec — renames `Landing.jsx` → stub; this plan creates `Dashboard.jsx` as the new file

**Gate:** `npm run build` passes, `python -m pytest backend/tests/test_sessions_api.py backend/tests/test_recommendations.py` passes, Dashboard mounts without crash, history list renders, badge shows correct state for all 4 confidence tags.

---

## File Map

**Backend — create:**
- `backend/api/sessions.py` — `GET /api/sessions` FastAPI router
- `backend/recommendations.py` — pure `build_recommendations()` function
- `backend/api/recommendations.py` — `GET /api/recommendations` FastAPI router
- `backend/tests/test_sessions_api.py` — route tests with stubbed auth + DB
- `backend/tests/test_recommendations.py` — unit tests for `build_recommendations()`

**Backend — modify:**
- `backend/db.py` — add `async get_sessions(user_id, limit)` function
- `backend/main.py` — mount `sessions_router` and `recommendations_router`

**Frontend — create:**
- `frontend/src/hooks/useSessionHistory.js`
- `frontend/src/hooks/useRecommendations.js`
- `frontend/src/components/LiveHRVStrip.jsx`
- `frontend/src/components/RFStatusBadge.jsx`
- `frontend/src/components/SessionHistoryCard.jsx`
- `frontend/src/components/RecommendationCard.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/styles/dashboard.css`

**Frontend — modify:**
- `frontend/src/lib/api.js` — add `getSessions()` and `getRecommendations()`
- `frontend/src/App.jsx` — 3 string replacements: `'landing'` → `'dashboard'`, import swap

---

## Tasks

### T1 — Add `db.get_sessions()` to `backend/db.py`

This is the Postgres path. SQLite path already exists via `storage.list_sessions()`.

- [ ] Open `backend/db.py`. After the `get_eligible_sessions()` function, add:

```python
async def get_sessions(user_id: str, limit: int = 10) -> list[dict]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, started_at, duration_s, peak_vs, final_vs, rmssd_median,
                      session_type
               FROM sessions
               WHERE user_id = $1
                 AND discarded = false
               ORDER BY started_at DESC
               LIMIT $2""",
            user_id, limit
        )
        return [dict(r) for r in rows]
```

Note: the Postgres `sessions` schema stores `rmssd_median` not `rmssd_start`/`rmssd_end`. The `_format_session_row` helper in T2 normalises both paths.

- [ ] Verify: no imports needed (asyncpg pool already in scope).

---

### T2 — Create `backend/api/sessions.py`

- [ ] Create `backend/api/sessions.py`:

```python
"""GET /api/sessions — return the user's last N sessions."""
from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from backend.auth import get_current_user
from backend import db, storage

router = APIRouter()


def _format_session_row(row: dict) -> dict:
    # Normalise rmssd: Postgres has rmssd_median; SQLite has rmssd_start + rmssd_end
    rmssd_vals = [v for v in [
        row.get("rmssd_median"),
        row.get("rmssd_start"),
        row.get("rmssd_end"),
    ] if v is not None]
    rmssd_avg = sum(rmssd_vals) / len(rmssd_vals) if rmssd_vals else None

    # Normalise VS score: Postgres has peak_vs + final_vs; SQLite has neither
    peak_vs = row.get("peak_vs")
    final_vs = row.get("final_vs")
    vs_vals = [v for v in [peak_vs, final_vs] if v is not None]
    vs_avg = sum(vs_vals) / len(vs_vals) if vs_vals else None

    # Normalise timestamp: Postgres returns datetime; SQLite stores Unix epoch float
    started_at = row.get("started_at") or row.get("created_at")
    if isinstance(started_at, (int, float)):
        created_at_iso = datetime.utcfromtimestamp(started_at).isoformat() + "Z"
    else:
        created_at_iso = str(started_at)

    return {
        "id": str(row["id"]),
        "created_at": created_at_iso,
        "duration_s": row.get("duration_s"),
        "vs_score_avg": round(vs_avg, 1) if vs_avg is not None else None,
        "rmssd_avg": round(rmssd_avg, 1) if rmssd_avg is not None else None,
        "session_type": row.get("session_type", "unknown"),
    }


@router.get("/api/sessions")
async def get_sessions(
    limit: int = Query(10, ge=1, le=20),
    user_id: str = Depends(get_current_user),
):
    if os.environ.get("DATABASE_URL"):
        rows = await db.get_sessions(user_id, limit)
    else:
        rows = storage.list_sessions(user_id=user_id, limit=limit)
    return [_format_session_row(dict(r)) for r in rows]
```

- [ ] Note: `get_current_user` in `backend/auth.py` returns a `str` (the user sub) per `backend/api/profile.py` pattern — use `user_id: str = Depends(get_current_user)` directly (not `user["sub"]` — that is the `baseline.py` pattern which wraps a dict; confirm which signature auth.py uses before implementing).
  - Check: `grep -n "def get_current_user" backend/auth.py` — if it returns str, use `user_id: str = Depends(get_current_user)`.
  - If it returns dict with `sub` key, use `user = Depends(get_current_user)` and `user_id = user["sub"]`.

---

### T3 — Create `backend/recommendations.py` (pure function, no I/O)

- [ ] Create `backend/recommendations.py`:

```python
"""
Rule-based session recommendations.
Pure function — no DB calls, no FastAPI. Testable standalone.
NO RAG, NO ML. Rule 1: circadian. Rule 2: recency. Rule 3: RMSSD vs baseline.
// UNTUNED — thresholds require real H10 session data to validate
"""
from __future__ import annotations
from datetime import datetime, timezone


def build_recommendations(
    sessions: list[dict],
    baseline_rmssd: float | None,
    client_tz_offset_hours: float = 0,
) -> list[dict]:
    """Returns 0–2 recommendation dicts. No side effects."""
    now_utc_hour = datetime.now(timezone.utc).hour
    now_local_hour = (now_utc_hour + client_tz_offset_hours) % 24
    recs: list[dict] = []

    # Rule 1: Circadian window
    if 6 <= now_local_hour < 12:
        recs.append({"session_type": "focus", "duration_min": 15,
                     "reason": "Morning window", "cta": "Start Focus", "_p": 1})
    elif 13 <= now_local_hour < 15:
        recs.append({"session_type": "calm", "duration_min": 10,
                     "reason": "Post-lunch reset", "cta": "Start Calm", "_p": 1})
    elif 15 <= now_local_hour < 18:
        recs.append({"session_type": "flow", "duration_min": 12,
                     "reason": "Afternoon energy", "cta": "Start Flow", "_p": 1})
    elif 18 <= now_local_hour < 21:
        recs.append({"session_type": "calm", "duration_min": 10,
                     "reason": "Wind down", "cta": "Start Calm", "_p": 1})
    else:  # 21–6 night
        recs.append({"session_type": "calm", "duration_min": 7,
                     "reason": "Late evening", "cta": "Start Calm", "_p": 1})

    # Rule 2: No session in last 24 h → add check-in nudge (slot 2 only)
    last_session_age_h: float | None = None
    if sessions:
        raw_ts = sessions[0].get("started_at") or sessions[0].get("created_at")
        if isinstance(raw_ts, (int, float)):
            last_session_age_h = (datetime.now(timezone.utc).timestamp() - raw_ts) / 3600
        elif isinstance(raw_ts, str):
            try:
                ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp()
                last_session_age_h = (datetime.now(timezone.utc).timestamp() - ts) / 3600
            except ValueError:
                pass

    if (last_session_age_h is None or last_session_age_h > 24) and \
            not any(r["session_type"] == "calm" for r in recs):
        recs.append({"session_type": "calm", "duration_min": 10,
                     "reason": "Time for a check-in", "cta": "Start Calm", "_p": 2})

    # Rule 3: RMSSD vs baseline (// UNTUNED — needs real H10 data)
    if baseline_rmssd and sessions:
        last_rmssd = sessions[0].get("rmssd_avg") or \
                     sessions[0].get("rmssd_median") or \
                     sessions[0].get("rmssd_end")
        if last_rmssd is not None:
            ratio = last_rmssd / baseline_rmssd
            if ratio < 0.85 and len(recs) < 2:
                recs.append({"session_type": "calm", "duration_min": 10,
                             "reason": "Recovery needed", "cta": "Start Calm", "_p": 3})
            elif ratio >= 0.90 and 6 <= now_local_hour < 12:
                for r in recs:
                    if r["session_type"] == "focus":
                        r["duration_min"] = 20
                        r["reason"] = "Strong baseline — full focus block"

    # Deduplicate by session_type, keep highest-priority (lowest _p)
    seen: set[str] = set()
    deduped: list[dict] = []
    for r in sorted(recs, key=lambda x: x["_p"]):
        if r["session_type"] not in seen:
            seen.add(r["session_type"])
            deduped.append({k: v for k, v in r.items() if k != "_p"})

    return deduped[:2]
```

---

### T4 — Create `backend/api/recommendations.py`

- [ ] Create `backend/api/recommendations.py`:

```python
"""GET /api/recommendations — rule-based session recommendations."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Query
from backend.auth import get_current_user
from backend import db, storage
from backend.recommendations import build_recommendations

router = APIRouter()


@router.get("/api/recommendations")
async def get_recommendations(
    client_tz_offset: float = Query(0.0, ge=-12, le=14),
    user_id: str = Depends(get_current_user),
):
    # Fetch last 5 sessions (sufficient for rules)
    if os.environ.get("DATABASE_URL"):
        sessions = [dict(r) for r in await db.get_sessions(user_id, limit=5)]
    else:
        sessions = storage.list_sessions(user_id=user_id, limit=5)

    # Fetch baseline RMSSD — degrade gracefully if unavailable
    baseline_rmssd: float | None = None
    if os.environ.get("DATABASE_URL"):
        try:
            b = await db.get_baseline(user_id)
            baseline_rmssd = b.get("rmssd_mean") if b else None
        except Exception:
            pass

    return build_recommendations(
        sessions=sessions,
        baseline_rmssd=baseline_rmssd,
        client_tz_offset_hours=client_tz_offset,
    )
```

---

### T5 — Mount routers in `backend/main.py`

- [ ] Open `backend/main.py`. After the existing `app.include_router(baseline_router)` line, add:

```python
from backend.api.sessions import router as sessions_router
app.include_router(sessions_router)

from backend.api.recommendations import router as recommendations_router
app.include_router(recommendations_router)
```

- [ ] Verify: server starts without import errors — `python -m uvicorn backend.main:app --reload`.

---

### T6 — Create `backend/tests/test_recommendations.py`

Write tests first (TDD order). Tests are pure — no server, no DB.

- [ ] Create `backend/tests/test_recommendations.py`:

```python
"""Unit tests for build_recommendations() — no I/O, no FastAPI."""
from unittest.mock import patch
from datetime import datetime, timezone
from backend.recommendations import build_recommendations


def _session(age_hours: float, rmssd: float | None = None, session_type: str = "calm") -> dict:
    ts = datetime.now(timezone.utc).timestamp() - age_hours * 3600
    return {"started_at": ts, "rmssd_avg": rmssd, "session_type": session_type}


def test_morning_returns_focus():
    with patch("backend.recommendations.datetime") as mock_dt:
        mock_dt.now.return_value.hour = 8  # 08:00 UTC, tz_offset=0
        mock_dt.now.return_value.timestamp = datetime.now(timezone.utc).timestamp
        recs = build_recommendations([], None, 0)
    assert recs[0]["session_type"] == "focus"
    assert recs[0]["duration_min"] == 15


def test_evening_returns_calm():
    with patch("backend.recommendations.datetime") as mock_dt:
        mock_dt.now.return_value.hour = 19
        mock_dt.now.return_value.timestamp = datetime.now(timezone.utc).timestamp
        recs = build_recommendations([], None, 0)
    assert recs[0]["session_type"] == "calm"
    assert recs[0]["reason"] == "Wind down"


def test_no_recent_session_adds_checkin_calm():
    # Morning → focus in slot 1. No session for 48h → calm check-in in slot 2.
    with patch("backend.recommendations.datetime") as mock_dt:
        mock_dt.now.return_value.hour = 8
        mock_dt.now.return_value.timestamp = datetime.now(timezone.utc).timestamp
        recs = build_recommendations([_session(age_hours=48)], None, 0)
    types = [r["session_type"] for r in recs]
    assert "focus" in types
    assert "calm" in types


def test_recent_session_no_checkin_slot():
    # Session 2h ago — no duplicate calm injected.
    with patch("backend.recommendations.datetime") as mock_dt:
        mock_dt.now.return_value.hour = 8
        mock_dt.now.return_value.timestamp = datetime.now(timezone.utc).timestamp
        recs = build_recommendations([_session(age_hours=2)], None, 0)
    assert len(recs) == 1  # only morning focus, no nudge


def test_rmssd_suppressed_adds_recovery():
    # Morning + rmssd suppressed → focus + recovery calm (2 recs)
    with patch("backend.recommendations.datetime") as mock_dt:
        mock_dt.now.return_value.hour = 8
        mock_dt.now.return_value.timestamp = datetime.now(timezone.utc).timestamp
        recs = build_recommendations(
            [_session(age_hours=1, rmssd=30.0)],  # rmssd 30 vs baseline 40 = 0.75 ratio
            baseline_rmssd=40.0,
            client_tz_offset_hours=0,
        )
    types = [r["session_type"] for r in recs]
    assert "calm" in types
    assert any(r["reason"] == "Recovery needed" for r in recs)


def test_max_two_recommendations():
    with patch("backend.recommendations.datetime") as mock_dt:
        mock_dt.now.return_value.hour = 8
        mock_dt.now.return_value.timestamp = datetime.now(timezone.utc).timestamp
        recs = build_recommendations(
            [_session(age_hours=48, rmssd=25.0)],
            baseline_rmssd=40.0,
        )
    assert len(recs) <= 2


def test_empty_sessions_no_crash():
    recs = build_recommendations([], None, 0)
    assert isinstance(recs, list)
    assert len(recs) >= 1  # at least circadian rule fires


def test_tz_offset_shifts_circadian():
    # 23:00 UTC + 9h offset = 08:00 local → should return focus
    with patch("backend.recommendations.datetime") as mock_dt:
        mock_dt.now.return_value.hour = 23
        mock_dt.now.return_value.timestamp = datetime.now(timezone.utc).timestamp
        recs = build_recommendations([], None, client_tz_offset_hours=9)
    assert recs[0]["session_type"] == "focus"
```

- [ ] Run: `python -m pytest backend/tests/test_recommendations.py -v` — all 8 tests pass.

---

### T7 — Create `backend/tests/test_sessions_api.py`

- [ ] Create `backend/tests/test_sessions_api.py`:

```python
"""Integration tests for GET /api/sessions — stub auth + storage."""
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.auth import get_current_user

TEST_USER = "test-user-dashboard"

app.dependency_overrides[get_current_user] = lambda: TEST_USER


@pytest.fixture
def client():
    return TestClient(app)


def test_sessions_empty_returns_list(client, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")  # force SQLite path
    import backend.storage as st
    monkeypatch.setattr(st, "list_sessions", lambda user_id, limit: [])
    r = client.get("/api/sessions", headers={"Authorization": "Bearer fake"})
    assert r.status_code == 200
    assert r.json() == []


def test_sessions_formats_sqlite_row(client, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    import backend.storage as st
    fake_row = {
        "id": "abc123", "started_at": 1746000000.0,
        "duration_s": 600, "rmssd_start": 50.0, "rmssd_end": 60.0,
        "peak_vs": None, "final_vs": None, "session_type": "calm",
    }
    monkeypatch.setattr(st, "list_sessions", lambda user_id, limit: [fake_row])
    r = client.get("/api/sessions", headers={"Authorization": "Bearer fake"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["rmssd_avg"] == 55.0  # (50+60)/2
    assert data[0]["vs_score_avg"] is None
    assert data[0]["session_type"] == "calm"


def test_sessions_limit_query_param(client, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    import backend.storage as st
    captured = {}
    def fake_list(user_id, limit):
        captured["limit"] = limit
        return []
    monkeypatch.setattr(st, "list_sessions", fake_list)
    client.get("/api/sessions?limit=5", headers={"Authorization": "Bearer fake"})
    assert captured["limit"] == 5


def test_sessions_limit_max_20(client):
    r = client.get("/api/sessions?limit=99", headers={"Authorization": "Bearer fake"})
    assert r.status_code == 422  # FastAPI Query validation
```

- [ ] Run: `python -m pytest backend/tests/test_sessions_api.py -v`.

---

### T8 — Add `getSessions()` and `getRecommendations()` to `frontend/src/lib/api.js`

- [ ] Open `frontend/src/lib/api.js`. After `putProfile`, add:

```js
export async function getSessions(limit = 10) {
  const headers = await authHeaders()
  const r = await fetch(`${API_URL}/api/sessions?limit=${limit}`, { headers })
  if (!r.ok) throw new Error(`getSessions failed: ${r.status}`)
  return r.json()
}

export async function getRecommendations() {
  const tzOffsetHours = -(new Date().getTimezoneOffset()) / 60
  const headers = await authHeaders()
  const r = await fetch(
    `${API_URL}/api/recommendations?client_tz_offset=${tzOffsetHours}`,
    { headers }
  )
  if (!r.ok) throw new Error(`getRecommendations failed: ${r.status}`)
  return r.json()
}
```

- [ ] Verify: no new imports needed — `authHeaders` and `API_URL` already defined above.

---

### T9 — Create `frontend/src/hooks/useSessionHistory.js`

- [ ] Create `frontend/src/hooks/useSessionHistory.js`:

```js
import { useState, useEffect } from 'react'
import { getSessions } from '../lib/api'

export function useSessionHistory(limit = 10) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getSessions(limit)
      .then(data => { if (!cancelled) setSessions(data) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [limit])

  return { sessions, loading, error }
}
```

---

### T10 — Create `frontend/src/hooks/useRecommendations.js`

- [ ] Create `frontend/src/hooks/useRecommendations.js`:

```js
import { useState, useEffect } from 'react'
import { getRecommendations } from '../lib/api'

export function useRecommendations() {
  const [recommendations, setRecommendations] = useState([])

  useEffect(() => {
    getRecommendations()
      .then(setRecommendations)
      .catch(() => setRecommendations([]))  // silent fail — section not rendered
  }, [])

  return { recommendations }
}
```

---

### T11 — Create `frontend/src/components/LiveHRVStrip.jsx`

- [ ] Create `frontend/src/components/LiveHRVStrip.jsx`:

```jsx
/** LiveHRVStrip — sticky top bar showing HR and H10 connection status.
 *  Props sourced from SensorContext in Dashboard, passed as plain props.
 *  No HRV metrics here — HR + connection state only. */
export default function LiveHRVStrip({ hr, isConnected }) {
  if (!isConnected) {
    return (
      <div className="hrv-strip hrv-strip--offline">
        <span className="hrv-dot" />
        <span>H10 not connected</span>
      </div>
    )
  }
  return (
    <div className="hrv-strip hrv-strip--live">
      <span className="hrv-dot hrv-dot--pulse" />
      <span className="hrv-bpm">{hr ?? '—'}</span>
      <span className="hrv-unit">bpm</span>
    </div>
  )
}
```

---

### T12 — Create `frontend/src/components/RFStatusBadge.jsx`

- [ ] Create `frontend/src/components/RFStatusBadge.jsx`:

```jsx
import { useState } from 'react'

const TAG_CONFIG = {
  UNVALIDATED: { label: 'Estimating RF…',          color: '#7A7A96', showBpm: false },
  DRAFT:       { label: 'Draft RF: {bpm} bpm',      color: '#EF9F27', showBpm: true },
  REFINED:     { label: 'Refining… {bpm} bpm',      color: '#1D9E75', showBpm: true },
  CONFIRMED:   { label: 'RF locked: {bpm} bpm ✓',   color: '#534AB7', showBpm: true },
}

/** RFStatusBadge — tappable badge showing current RF confidence state.
 *  Self-contained modal. Props: rfBpm (number|null), rfConfidenceTag (string). */
export default function RFStatusBadge({ rfBpm, rfConfidenceTag = 'UNVALIDATED' }) {
  const [modalOpen, setModalOpen] = useState(false)
  const cfg = TAG_CONFIG[rfConfidenceTag] ?? TAG_CONFIG.UNVALIDATED
  const label = cfg.showBpm && rfBpm != null
    ? cfg.label.replace('{bpm}', rfBpm.toFixed(1))
    : cfg.label.replace(' {bpm}', '').replace('{bpm}', '')

  const isDraftOrAbove = ['DRAFT', 'REFINED', 'CONFIRMED'].includes(rfConfidenceTag)
  const modalStatus = isDraftOrAbove
    ? `Current estimate: ${rfBpm?.toFixed(1) ?? '—'} bpm (${rfConfidenceTag.toLowerCase()})`
    : 'Still collecting data. Connect H10 and complete a session to confirm.'

  return (
    <>
      <button
        className="rf-badge"
        style={{ color: cfg.color }}
        onClick={() => setModalOpen(true)}
        aria-label="About Resonant Frequency"
      >
        {label}
      </button>

      {modalOpen && (
        <div className="rf-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="rf-modal" onClick={e => e.stopPropagation()}>
            <h3>What is RF?</h3>
            <p>
              Your Resonant Frequency (RF) is the breathing rate that produces
              peak heart rate variability — typically 4.5–7 bpm. We estimate it
              passively while you use the app.
            </p>
            <p className="rf-modal-status">{modalStatus}</p>
            <button onClick={() => setModalOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
```

---

### T13 — Create `frontend/src/components/SessionHistoryCard.jsx`

- [ ] Create `frontend/src/components/SessionHistoryCard.jsx`:

```jsx
/** SessionHistoryCard — one row in the recent sessions list.
 *  Uses v2-card class to match InsightCard and HrvMetrics visual style. */

const SESSION_ICON = { focus: '🎯', calm: '🌊', flow: '✨' }

function formatRelativeDate(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}

function formatDuration(s) {
  if (s == null) return '—'
  return Math.round(s / 60) + ' min'
}

function vsColor(score) {
  if (score < 40) return 'var(--vs-low, #E24B4A)'
  if (score < 70) return 'var(--vs-mid, #EF9F27)'
  if (score < 90) return 'var(--vs-good, #1D9E75)'
  return 'var(--vs-peak, #534AB7)'
}

export default function SessionHistoryCard({ id, created_at, duration_s, vs_score_avg, rmssd_avg, session_type, onTap }) {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const icon = prefersReduced ? session_type : (SESSION_ICON[session_type] ?? session_type)

  return (
    <div className="v2-card session-history-card" onClick={() => onTap?.(id)} role="button" tabIndex={0}>
      <div className="shc-left">
        <div className="shc-type-badge">{icon}</div>
      </div>
      <div className="shc-body">
        <div className="shc-date">{formatRelativeDate(created_at)}</div>
        <div className="shc-meta">{formatDuration(duration_s)} · {session_type}</div>
      </div>
      <div className="shc-right">
        {vs_score_avg != null && (
          <div className="shc-vs" style={{ color: vsColor(vs_score_avg) }}>
            {Math.round(vs_score_avg)}
          </div>
        )}
        {rmssd_avg != null && (
          <div className="shc-rmssd">{Math.round(rmssd_avg)} ms</div>
        )}
      </div>
    </div>
  )
}

export function SessionHistoryEmpty() {
  return <div className="shc-empty">No sessions yet. Start your first session above.</div>
}
```

---

### T14 — Create `frontend/src/components/RecommendationCard.jsx`

- [ ] Create `frontend/src/components/RecommendationCard.jsx`:

```jsx
/** RecommendationCard — one rule-based recommendation from /api/recommendations.
 *  Tapping card or button both call onStart with pre-filled session type. */
export default function RecommendationCard({ session_type, duration_min, reason, cta, onStart }) {
  function handleStart(e) {
    e.stopPropagation()
    onStart?.({ sessionType: session_type, durationMin: duration_min })
  }

  return (
    <div className="v2-card rec-card" onClick={handleStart} role="button" tabIndex={0}>
      <div className="rec-type">{session_type}</div>
      <div className="rec-duration">{duration_min} min</div>
      <div className="rec-reason">{reason}</div>
      <button className="rec-cta" onClick={handleStart}>{cta}</button>
    </div>
  )
}
```

---

### T15 — Create `frontend/src/styles/dashboard.css`

- [ ] Create `frontend/src/styles/dashboard.css`:

```css
/* ── LiveHRVStrip ─────────────────────────────────────────── */
.hrv-strip {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--surface-2);
  position: sticky; top: 0; z-index: 10;
}
.hrv-strip--offline { opacity: 0.5; }
.hrv-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #7A7A96; flex-shrink: 0;
}
.hrv-dot--pulse {
  background: var(--vs-good, #1D9E75);
  animation: hrv-pulse 1s ease-in-out infinite;
}
@keyframes hrv-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) {
  .hrv-dot--pulse { animation: none; opacity: 1; }
}
.hrv-bpm {
  font-family: Figtree, sans-serif; font-size: 18px; font-weight: 600;
  color: var(--text); font-variant-numeric: tabular-nums;
}
.hrv-unit { font-size: 12px; color: #7A7A96; }

/* ── RFStatusBadge ────────────────────────────────────────── */
.rf-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 20px;
  background: var(--surface-2); cursor: pointer;
  font-size: 13px; font-weight: 500;
  border: none; font-family: inherit;
}
.rf-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.rf-modal {
  background: var(--surface-1); border-radius: 16px;
  padding: 24px; max-width: 320px; width: 90%;
  color: var(--text);
}
.rf-modal h3 { margin: 0 0 12px; font-family: Outfit, sans-serif; }
.rf-modal p { font-size: 14px; line-height: 1.5; margin: 0 0 10px; color: #B0B0C0; }
.rf-modal-status { color: var(--text) !important; font-weight: 500; }
.rf-modal button {
  margin-top: 16px; padding: 8px 20px; border-radius: 20px;
  background: var(--surface-2); border: none; color: var(--text);
  cursor: pointer; font-family: inherit; font-size: 14px;
}

/* ── SessionHistoryCard ───────────────────────────────────── */
.session-history-card {
  display: flex; align-items: center; gap: 12px; cursor: pointer;
}
.session-history-card:focus-visible { outline: 2px solid #534AB7; outline-offset: 2px; }
.shc-left { flex-shrink: 0; font-size: 20px; }
.shc-body { flex: 1; min-width: 0; }
.shc-date { font-size: 13px; color: var(--text); font-weight: 500; }
.shc-meta { font-size: 11px; color: #7A7A96; margin-top: 2px; }
.shc-right { flex-shrink: 0; text-align: right; }
.shc-vs {
  font-family: Figtree, sans-serif; font-size: 20px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.shc-rmssd { font-size: 11px; color: #7A7A96; margin-top: 2px; }
.shc-empty {
  color: #7A7A96; font-size: 14px; text-align: center; padding: 24px 0;
}

/* ── RecommendationCard ───────────────────────────────────── */
.rec-card { cursor: pointer; }
.rec-card:focus-visible { outline: 2px solid #534AB7; outline-offset: 2px; }
.rec-type {
  font-size: 11px; color: #7A7A96; text-transform: uppercase;
  letter-spacing: 0.06em; margin-bottom: 2px;
}
.rec-duration {
  font-family: Figtree, sans-serif; font-size: 22px; font-weight: 700;
  color: var(--text);
}
.rec-reason { font-size: 13px; color: #7A7A96; margin-top: 4px; }
.rec-cta {
  margin-top: 12px; padding: 8px 16px; border-radius: 20px;
  background: #534AB7; color: #fff; border: none; cursor: pointer;
  font-size: 14px; font-weight: 600; font-family: inherit;
}

/* ── Dashboard layout ─────────────────────────────────────── */
.dashboard-greeting {
  font-family: Outfit, sans-serif; font-size: 22px; font-weight: 600;
  color: var(--text); margin: 20px 16px 8px;
}
.dashboard-section-label {
  font-size: 11px; font-weight: 600; color: #7A7A96;
  text-transform: uppercase; letter-spacing: 0.08em;
  margin: 24px 16px 10px;
}
.dashboard-cards { display: flex; flex-direction: column; gap: 10px; padding: 0 16px; }
.dashboard-cta {
  width: calc(100% - 32px); margin: 20px 16px;
  padding: 16px; border-radius: 14px;
  background: #534AB7; color: #fff; border: none;
  font-size: 17px; font-weight: 700; cursor: pointer;
  font-family: Outfit, sans-serif;
}
.dashboard-cta:active { opacity: 0.85; }
```

---

### T16 — Create `frontend/src/pages/Dashboard.jsx`

This is the final composition step. All leaf components and hooks must be complete before this task.

- [ ] Create `frontend/src/pages/Dashboard.jsx`:

```jsx
/**
 * Dashboard — post-auth home screen.
 * Replaces Landing.jsx role; keeps same props { onStart, user, profile }
 * so App.jsx change is minimal.
 *
 * Depends on SensorContext spec being implemented first.
 * If SensorContext is not yet available, replace useSensorContext() with
 * stub values: { latestHRV: null, isConnected: false, rfBpm: null,
 *               rfConfidenceTag: 'UNVALIDATED', wsRef: { current: null } }
 */
import { useEffect, useRef } from 'react'
import '../styles/dashboard.css'
import LiveHRVStrip from '../components/LiveHRVStrip'
import RFStatusBadge from '../components/RFStatusBadge'
import RecommendationCard from '../components/RecommendationCard'
import SessionHistoryCard, { SessionHistoryEmpty } from '../components/SessionHistoryCard'
import { useSessionHistory } from '../hooks/useSessionHistory'
import { useRecommendations } from '../hooks/useRecommendations'

// STUB: replace with real useSensorContext() once SensorContext spec is implemented
function useSensorContextStub() {
  return {
    latestHRV: null,
    isConnected: false,
    rfBpm: null,
    rfConfidenceTag: 'UNVALIDATED',
    wsRef: { current: null },
  }
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard({ onStart, user, profile }) {
  const { sessions, loading: sessionsLoading } = useSessionHistory(10)
  const { recommendations } = useRecommendations()

  // TODO: swap stub → real hook when SensorContext spec ships
  const { latestHRV, isConnected, rfBpm, rfConfidenceTag, wsRef } =
    useSensorContextStub()

  // Background RF scan trigger: fire once on mount if H10 connected + RF not locked
  useEffect(() => {
    if (!isConnected) return
    if (rfConfidenceTag === 'CONFIRMED') return
    wsRef.current?.send(JSON.stringify({ type: 'rf_background_scan' }))
  }, [isConnected, rfConfidenceTag])  // wsRef intentionally omitted — stable ref

  const firstName = profile?.display_name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'
  const hr = latestHRV?.hr ?? null

  function handleStart(overrides = {}) {
    // Build cfg matching the shape Landing.jsx passed to Setup.jsx
    const cfg = {
      session: overrides.sessionType ?? 'find_your_calm',
      sensorMode: 2,   // default H10; Setup.jsx lets user change
      backendMode: 2,
      durationMin: overrides.durationMin ?? 10,
    }
    onStart(cfg)
  }

  return (
    <div className="dashboard-root">
      <LiveHRVStrip hr={hr} isConnected={isConnected} />

      <div className="dashboard-greeting">
        {getGreeting()}, {firstName}
      </div>
      <div style={{ padding: '0 16px' }}>
        <RFStatusBadge rfBpm={rfBpm} rfConfidenceTag={rfConfidenceTag} />
      </div>

      {recommendations.length > 0 && (
        <>
          <div className="dashboard-section-label">Recommended</div>
          <div className="dashboard-cards">
            {recommendations.map((rec, i) => (
              <RecommendationCard key={i} {...rec} onStart={handleStart} />
            ))}
          </div>
        </>
      )}

      <button className="dashboard-cta" onClick={() => handleStart()}>
        ▶ Start Session
      </button>

      <div className="dashboard-section-label">Recent Sessions</div>
      <div className="dashboard-cards">
        {sessionsLoading
          ? null
          : sessions.length === 0
            ? <SessionHistoryEmpty />
            : sessions.map(s => (
                <SessionHistoryCard
                  key={s.id}
                  {...s}
                  onTap={(id) => {
                    // Stub: Insight screen loading by ID is a separate spec
                    console.log('session tap', id)
                  }}
                />
              ))
        }
      </div>
    </div>
  )
}
```

---

### T17 — Update `frontend/src/App.jsx` (3 surgical string replacements)

- [ ] Open `frontend/src/App.jsx`. Make exactly 3 changes:

**Change 1 — import swap (line 7):**
```js
// Remove:
import Landing from './pages/Landing.jsx'
// Add:
import Dashboard from './pages/Dashboard.jsx'
```

**Change 2 — default case in switch (lines ~126–130):**
```js
// Remove:
    default: // 'landing'
      return (
        <Landing
          onStart={(c) => { setCfg(c); setScreen('setup') }}
        />
      )
// Add:
    default: // 'dashboard'
      return (
        <Dashboard
          onStart={(c) => { setCfg(c); setScreen('setup') }}
          user={user}
          profile={profile}
        />
      )
```

**Change 3 — ProfileSetup onComplete callback (line ~78):**
```js
// Remove:
          setScreen('landing')
// Add:
          setScreen('dashboard')
```

- [ ] Also update the `onDiscard` callback in the `case 'session':` branch and `onDone` in `case 'insight':` — change `setScreen('landing')` → `setScreen('dashboard')` in both.

- [ ] Verify: no `'landing'` string remains in App.jsx — `grep -n "landing" frontend/src/App.jsx` should return 0 matches.

---

### T18 — Build verification and smoke test

- [ ] Run: `npm run build` from `frontend/` — must pass with 0 errors.
- [ ] Run: `python -m pytest backend/tests/test_recommendations.py backend/tests/test_sessions_api.py -v` — all tests pass.
- [ ] Start backend: `python -m uvicorn backend.main:app --reload`
- [ ] Start frontend: `cd frontend && npm run dev`
- [ ] Manual checks:
  - [ ] Dashboard loads after login without white screen or console errors
  - [ ] `GET /api/sessions` returns 200 (empty array is fine)
  - [ ] `GET /api/recommendations` returns 200 with at least 1 recommendation
  - [ ] RFStatusBadge renders with "Estimating RF…" (UNVALIDATED state)
  - [ ] LiveHRVStrip shows "H10 not connected" when H10 is off
  - [ ] "Start Session" CTA calls `onStart` and navigates to Setup screen
  - [ ] `cfg` object arriving at Setup.jsx has `session` and `sensorMode` keys

---

### T19 — Commit

- [ ] Stage: `git add frontend/src/pages/Dashboard.jsx frontend/src/components/LiveHRVStrip.jsx frontend/src/components/RFStatusBadge.jsx frontend/src/components/SessionHistoryCard.jsx frontend/src/components/RecommendationCard.jsx frontend/src/styles/dashboard.css frontend/src/hooks/useSessionHistory.js frontend/src/hooks/useRecommendations.js frontend/src/lib/api.js frontend/src/App.jsx backend/db.py backend/api/sessions.py backend/api/recommendations.py backend/recommendations.py backend/main.py backend/tests/test_recommendations.py backend/tests/test_sessions_api.py`
- [ ] Commit: `feat(dashboard): add Dashboard screen with session history, RF badge, and rule-based recommendations`
- [ ] Do NOT push until full pipeline end-to-end passes (V2 gate: see CLAUDE.md DECISION TREES → "Should I commit / deploy?").

---

## Implementation Order Summary

1. T1 + T3 (db.get_sessions, build_recommendations) — pure backend, no deps
2. T6 + T7 (tests) — write before routes (TDD)
3. T2 + T4 (route files) — after tests are written
4. T5 (mount routers) — after route files exist
5. T8 (api.js) — frontend fetch wrappers
6. T9 + T10 (hooks) — after api.js
7. T11–T14 (leaf components) — independently testable, any order
8. T15 (CSS) — before T16
9. T16 (Dashboard.jsx) — after all components and hooks
10. T17 (App.jsx) — after Dashboard.jsx
11. T18 + T19 — build + commit

## Known Stubs / Follow-up Specs

- `useSensorContextStub()` in Dashboard.jsx must be replaced with real `useSensorContext()` once SensorContext spec ships — marked with TODO comment in code.
- `onTap(id)` in SessionHistoryCard is wired but Insight.jsx changes (loading historical session by ID) are a separate spec.
- `session_type` values in `cfg` passed to Setup may need mapping from Dashboard's `'focus'/'calm'/'flow'` to Landing's existing `'find_your_calm'/'wind_down'/'morning_emergence'` IDs — verify in Setup.jsx before T17 lands.
