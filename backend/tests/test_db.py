import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio

# We test the SQL helpers by mocking the asyncpg connection
# db.py exposes: init_pool, close_pool, create_session, write_snapshot,
#                write_rr, finish_session


@pytest.fixture
def mock_pool():
    pool = MagicMock()
    conn = AsyncMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    return pool, conn


@pytest.mark.asyncio
async def test_create_session_returns_uuid(mock_pool):
    import uuid
    from backend import db
    pool, conn = mock_pool
    expected_id = uuid.uuid4()
    conn.fetchval.return_value = expected_id
    db._pool = pool

    result = await db.create_session(
        user_id="user-123",
        session_type="find_your_calm",
        mode=3,
        device_label="Polar H10",
    )
    assert result == expected_id
    conn.fetchval.assert_called_once()
    sql = conn.fetchval.call_args[0][0]
    assert "insert into public.sessions" in sql.lower()


@pytest.mark.asyncio
async def test_write_snapshot_executes(mock_pool):
    from backend import db
    pool, conn = mock_pool
    db._pool = pool

    await db.write_snapshot(
        session_id="sess-1",
        user_id="user-1",
        epoch_s=10,
        metrics={
            "rmssd": 42.0, "sdnn": 55.0, "lf_hf": 1.2,
            "dfa_a1": 1.0, "svi": 5.0, "poincare_sd1": 30.0,
            "poincare_sd2": 80.0, "vs_score": 65.0, "ans_state": "calm",
            "arc_phase": "settle", "rf_coherence": 0.7, "rf_locked": True,
            "ls_arousal": 0.3, "ls_valence": None,
            "ls_regulation": 0.6, "ls_engagement": 0.5,
        },
    )
    conn.execute.assert_called_once()
    sql = conn.execute.call_args[0][0]
    assert "insert into public.hrv_snapshots" in sql.lower()


@pytest.mark.asyncio
async def test_write_rr_executes(mock_pool):
    from backend import db
    pool, conn = mock_pool
    db._pool = pool

    await db.write_rr(
        session_id="sess-1",
        user_id="user-1",
        rr_ms=812.0,
        accepted=True,
        source="polar_h10",
    )
    conn.execute.assert_called_once()
    sql = conn.execute.call_args[0][0]
    assert "insert into public.rr_intervals" in sql.lower()


@pytest.mark.asyncio
async def test_finish_session_updates(mock_pool):
    from backend import db
    pool, conn = mock_pool
    db._pool = pool

    await db.finish_session(
        session_id="sess-1",
        outcome={
            "ended_at": "2026-04-29T10:00:00Z",
            "duration_s": 600,
            "peak_vs": 82.0,
            "final_vs": 78.0,
            "skill_transfer_score": 0.95,
            "rf_locked": True,
            "rf_bpm": 6.1,
            "rf_lock_epoch_s": 120,
            "arc_phases_completed": 3,
            "circadian_phase": "morning",
            "circadian_fit_score": 0.8,
            "rr_total": 600,
            "rr_rejected": 5,
            "sqi_mean": 0.97,
            "discarded": False,
        },
    )
    conn.execute.assert_called_once()
    sql = conn.execute.call_args[0][0]
    assert "update public.sessions" in sql.lower()
