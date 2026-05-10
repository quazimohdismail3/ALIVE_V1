"""Profile REST endpoints. RLS gates per-user data; auth via Bearer JWT."""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.auth import get_current_user
from backend import db


router = APIRouter(prefix="/api", tags=["profile"])


def _require_pool() -> None:
    """Raise 503 when the DB pool is not initialised (DATABASE_URL absent)."""
    if db._pool is None:
        raise HTTPException(status_code=503, detail="Database not configured")


class ProfileIn(BaseModel):
    age:        int   = Field(..., ge=13, le=100)
    sex:        str   = Field(..., pattern="^(male|female|prefer_not_to_say)$")
    height_cm:  int   = Field(..., ge=100, le=230)
    weight_kg:  Optional[float] = Field(default=None, ge=20, le=300)
    resting_hr: Optional[int]   = Field(default=None, ge=30, le=120)


class ProfileOut(BaseModel):
    age:               int
    sex:               str
    height_cm:         int
    weight_kg:         Optional[float] = None
    resting_hr:        Optional[int]   = None
    calibration_done:  bool            = False
    rf_bpm:            Optional[float] = None
    rf_confidence_tag: Optional[str]   = None
    rf_locked:         bool            = False


@router.get("/profile", response_model=ProfileOut)
async def get_profile(user_id: str = Depends(get_current_user)) -> ProfileOut:
    _require_pool()
    profile = await db.get_profile(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    return ProfileOut(
        age=profile.age,
        sex=profile.sex,
        height_cm=profile.height_cm,
        weight_kg=float(profile.weight_kg) if profile.weight_kg is not None else None,
        resting_hr=profile.resting_hr,
        calibration_done=bool(profile.calibration_done),
        rf_bpm=float(profile.rf_bpm) if profile.rf_bpm is not None else None,
        rf_confidence_tag=profile.rf_confidence_tag,
    )


@router.put("/profile", response_model=ProfileOut)
async def put_profile(
    body: ProfileIn,
    user_id: str = Depends(get_current_user),
) -> ProfileOut:
    _require_pool()
    await db.upsert_profile(
        user_id,
        age=body.age,
        sex=body.sex,
        height_cm=body.height_cm,
        weight_kg=body.weight_kg,
        resting_hr=body.resting_hr,
    )
    return ProfileOut(**body.model_dump())


class CalibrationPatch(BaseModel):
    rf_bpm:    float = Field(..., ge=3.0, le=10.0)
    rf_locked: bool  = False


@router.patch("/profile/calibration", response_model=ProfileOut)
async def patch_calibration(
    body: CalibrationPatch,
    user_id: str = Depends(get_current_user),
) -> ProfileOut:
    _require_pool()
    tag = "REFINED" if body.rf_locked else "DRAFT"
    await db.set_calibration_done(user_id, body.rf_bpm, tag)
    profile = await db.get_profile(user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    return ProfileOut(
        age=profile.age,
        sex=profile.sex,
        height_cm=profile.height_cm,
        weight_kg=float(profile.weight_kg) if profile.weight_kg is not None else None,
        resting_hr=profile.resting_hr,
        calibration_done=True,
        rf_bpm=body.rf_bpm,
        rf_confidence_tag=tag,
        rf_locked=body.rf_locked,
    )
