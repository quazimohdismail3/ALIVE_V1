from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
import asyncpg

_pool: Optional[asyncpg.Pool] = None


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=os.environ["DATABASE_URL"],
        min_size=1,
        max_size=5,
        statement_cache_size=0,  # required for Supabase connection pooler
    )


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def create_session(
    user_id: str,
    session_type: str,
    mode: int,
    device_label: Optional[str] = None,
) -> Any:
    async with _pool.acquire() as conn:
        return await conn.fetchval(
            """
            insert into public.sessions
              (user_id, session_type, mode, device_label, started_at)
            values ($1, $2, $3, $4, $5)
            returning id
            """,
            user_id,
            session_type,
            mode,
            device_label,
            datetime.now(timezone.utc),
        )


async def write_snapshot(
    session_id: Any,
    user_id: str,
    epoch_s: int,
    metrics: dict,
) -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            insert into public.hrv_snapshots
              (session_id, user_id, ts, epoch_s,
               rmssd, sdnn, lf_hf, dfa_a1, svi, poincare_sd1, poincare_sd2,
               vs_score, ans_state, arc_phase, rf_coherence, rf_locked,
               ls_arousal, ls_valence, ls_regulation, ls_engagement)
            values
              ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            """,
            session_id, user_id, datetime.now(timezone.utc), epoch_s,
            metrics.get("rmssd"), metrics.get("sdnn"), metrics.get("lf_hf"),
            metrics.get("dfa_a1"), metrics.get("svi"),
            metrics.get("poincare_sd1"), metrics.get("poincare_sd2"),
            metrics.get("vs_score"), metrics.get("ans_state"),
            metrics.get("arc_phase"), metrics.get("rf_coherence"),
            metrics.get("rf_locked"),
            metrics.get("ls_arousal"), metrics.get("ls_valence"),
            metrics.get("ls_regulation"), metrics.get("ls_engagement"),
        )


async def write_rr(
    session_id: Any,
    user_id: str,
    rr_ms: float,
    accepted: bool,
    source: str,
) -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            insert into public.rr_intervals
              (session_id, user_id, ts, rr_ms, accepted, source)
            values ($1, $2, $3, $4, $5, $6)
            """,
            session_id, user_id, datetime.now(timezone.utc),
            rr_ms, accepted, source,
        )


async def finish_session(session_id: Any, outcome: dict) -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            update public.sessions set
              ended_at = $2, duration_s = $3, peak_vs = $4, final_vs = $5,
              skill_transfer_score = $6, rf_locked = $7, rf_bpm = $8,
              rf_lock_epoch_s = $9, arc_phases_completed = $10,
              circadian_phase = $11, circadian_fit_score = $12,
              rr_total = $13, rr_rejected = $14, sqi_mean = $15,
              discarded = $16, updated_at = now()
            where id = $1
            """,
            session_id,
            outcome.get("ended_at"),
            outcome.get("duration_s"),
            outcome.get("peak_vs"),
            outcome.get("final_vs"),
            outcome.get("skill_transfer_score"),
            outcome.get("rf_locked"),
            outcome.get("rf_bpm"),
            outcome.get("rf_lock_epoch_s"),
            outcome.get("arc_phases_completed"),
            outcome.get("circadian_phase"),
            outcome.get("circadian_fit_score"),
            outcome.get("rr_total"),
            outcome.get("rr_rejected"),
            outcome.get("sqi_mean"),
            outcome.get("discarded", False),
        )


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
