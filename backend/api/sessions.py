# backend/api/sessions.py
from fastapi import APIRouter, Depends, HTTPException
from backend.auth import get_current_user
from backend import db

router = APIRouter()


@router.get("/api/sessions")
async def list_sessions(limit: int = 10, user: str = Depends(get_current_user)):
    if limit < 1 or limit > 50:
        raise HTTPException(status_code=400, detail="limit must be 1–50")
    rows = await db.get_sessions(user, limit)
    result = []
    for r in rows:
        result.append({
            "id": r["id"],
            "session_type": r["session_type"],
            "sensor_mode": r["sensor_mode"],
            "started_at": r["started_at"].isoformat() if r["started_at"] else None,
            "ended_at": r["ended_at"].isoformat() if r["ended_at"] else None,
            "duration_s": r["duration_s"],
            "rmssd_median": r["rmssd_median"],
            "hr_mean": r["hr_mean"],
            "rr_count": r["rr_count"],
            "artifact_rate": r["artifact_rate"],
            "mean_sqi": r["mean_sqi"],
            "baseline_eligible": r["baseline_eligible"],
        })
    return result


@router.get("/api/recommendations")
async def get_recommendations(user: str = Depends(get_current_user)):
    sessions = await db.get_sessions(user, limit=5)
    recs = []
    if not sessions:
        recs.append({
            "type": "onboarding",
            "title": "Complete your first session",
            "body": "Start a 5-minute Find Your Calm session to establish your baseline.",
        })
    else:
        latest = sessions[0]
        if latest.get("rmssd_median") and latest["rmssd_median"] < 30:
            recs.append({
                "type": "recovery",
                "title": "Try a recovery session",
                "body": "Your HRV was low last session. A short breathing session can help.",
            })
        if len(sessions) >= 3:
            recs.append({
                "type": "streak",
                "title": "You're building momentum",
                "body": f"{len(sessions)} sessions completed. Consistency matters most.",
            })
    return recs
