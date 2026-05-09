"""GET /api/baseline — return (or recompute) the user's personal RMSSD baseline."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from backend.auth import get_current_user
from backend import db
from backend.baseline_engine import recompute_baseline_from_sessions

router = APIRouter()


def _require_pool() -> None:
    if db._pool is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Database not configured")


@router.get("/api/baseline")
async def get_baseline(user_id: str = Depends(get_current_user)):
    _require_pool()
    row = await db.get_baseline(user_id)
    if row is None:
        # Recompute on demand (cold start)
        profile = await db.get_profile(user_id)
        if profile is None:
            return {"source": "cold_start", "rmssd_mean": None, "rmssd_sd": None}
        sessions = await db.get_eligible_sessions(user_id)
        baseline = recompute_baseline_from_sessions(
            {
                "age": profile.age,
                "sex": profile.sex,
                "height_cm": profile.height_cm,
                "weight_kg": float(profile.weight_kg) if profile.weight_kg is not None else None,
                "resting_hr": profile.resting_hr,
            },
            sessions,
        )
        await db.upsert_baseline(user_id, {
            "rmssd_mean": baseline.rmssd_mean,
            "rmssd_sd": baseline.rmssd_sd,
            "rmssd_min": baseline.rmssd_min,
            "rmssd_max": baseline.rmssd_max,
            "source": baseline.source,
            "n_sessions_used": baseline.n_sessions_used,
            "posterior_precision": baseline.posterior_precision,
        })
        row = {
            "rmssd_mean": baseline.rmssd_mean,
            "rmssd_sd": baseline.rmssd_sd,
            "rmssd_min": baseline.rmssd_min,
            "rmssd_max": baseline.rmssd_max,
            "source": baseline.source,
            "n_sessions_used": baseline.n_sessions_used,
            "posterior_precision": baseline.posterior_precision,
        }
    return row
