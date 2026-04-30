"""Tests for baseline_engine — cold-start prior, quality gates, Bayesian recompute."""
import pytest
from backend.baseline_engine import (
    cold_start_prior,
    quality_check,
    recompute_baseline_from_sessions,
    session_z,
    recovery_score,
)

# --- cold_start_prior ---

def test_cold_start_young_male():
    profile = {"age": 25, "sex": "male", "height_cm": 175}
    mean, sd = cold_start_prior(profile)
    assert 40.0 < mean < 90.0
    assert sd > 0

def test_cold_start_female_bonus():
    p_male = {"age": 35, "sex": "male", "height_cm": 170}
    p_female = {"age": 35, "sex": "female", "height_cm": 170}
    mean_m, _ = cold_start_prior(p_male)
    mean_f, _ = cold_start_prior(p_female)
    assert mean_f > mean_m

def test_cold_start_obese_penalty():
    p_normal = {"age": 35, "sex": "male", "height_cm": 170, "weight_kg": 70.0}
    p_obese  = {"age": 35, "sex": "male", "height_cm": 170, "weight_kg": 110.0}
    mean_n, _ = cold_start_prior(p_normal)
    mean_o, _ = cold_start_prior(p_obese)
    assert mean_o < mean_n

def test_cold_start_resting_hr_effect():
    p_low_hr = {"age": 35, "sex": "male", "height_cm": 170, "resting_hr": 50}
    p_hi_hr  = {"age": 35, "sex": "male", "height_cm": 170, "resting_hr": 80}
    mean_low, _ = cold_start_prior(p_low_hr)
    mean_hi,  _ = cold_start_prior(p_hi_hr)
    assert mean_low > mean_hi

# --- quality_check ---

GOOD_SESSION = {
    "sensor_mode": 2, "rr_count": 400, "artifact_rate": 0.05,
    "mean_sqi": 0.85, "hr_drift_bpm": 5.0,
}

def test_quality_good_session():
    ok, reason, w = quality_check(GOOD_SESSION)
    assert ok is True
    assert reason is None
    assert 0.0 < w <= 1.0

def test_quality_reject_wrong_mode():
    s = {**GOOD_SESSION, "sensor_mode": 1}
    ok, reason, _ = quality_check(s)
    assert ok is False
    assert reason == "wrong_mode"

def test_quality_reject_too_short():
    s = {**GOOD_SESSION, "rr_count": 50}
    ok, reason, _ = quality_check(s)
    assert ok is False
    assert reason == "too_short"

def test_quality_reject_high_artifacts():
    s = {**GOOD_SESSION, "artifact_rate": 0.30}
    ok, reason, _ = quality_check(s)
    assert ok is False
    assert reason == "artifacts"

def test_quality_reject_low_sqi():
    s = {**GOOD_SESSION, "mean_sqi": 0.4}
    ok, reason, _ = quality_check(s)
    assert ok is False
    assert reason == "low_sqi"

def test_quality_reject_hr_drift():
    s = {**GOOD_SESSION, "hr_drift_bpm": 50.0}
    ok, reason, _ = quality_check(s)
    assert ok is False
    assert reason == "hr_drift"

# --- Bayesian recompute ---

PROFILE = {"age": 35, "sex": "male", "height_cm": 175}

def test_cold_start_no_sessions():
    b = recompute_baseline_from_sessions(PROFILE, [])
    assert b.source == "cold_start"
    assert b.n_sessions_used == 0
    assert b.rmssd_mean > 0

def test_blended_one_session():
    sessions = [{"rmssd_median": 55.0, "baseline_weight": 0.8}]
    b = recompute_baseline_from_sessions(PROFILE, sessions)
    assert b.source == "blended"
    assert b.n_sessions_used == 1

def test_personal_three_sessions():
    sessions = [
        {"rmssd_median": 55.0, "baseline_weight": 0.9},
        {"rmssd_median": 60.0, "baseline_weight": 0.85},
        {"rmssd_median": 58.0, "baseline_weight": 0.8},
    ]
    b = recompute_baseline_from_sessions(PROFILE, sessions)
    assert b.source == "personal"
    assert b.n_sessions_used == 3
    assert 50 < b.rmssd_mean < 70

def test_posterior_pulls_toward_data():
    b0 = recompute_baseline_from_sessions(PROFILE, [])
    sessions = [
        {"rmssd_median": 80.0, "baseline_weight": 0.9},
        {"rmssd_median": 82.0, "baseline_weight": 0.9},
        {"rmssd_median": 81.0, "baseline_weight": 0.9},
    ]
    b3 = recompute_baseline_from_sessions(PROFILE, sessions)
    assert b3.rmssd_mean > b0.rmssd_mean

# --- recovery score ---

def test_recovery_score_midpoint():
    b = recompute_baseline_from_sessions(PROFILE, [])
    z = session_z(b.rmssd_mean, b)
    assert z == pytest.approx(0.0, abs=0.01)
    assert recovery_score(z) == 50

def test_recovery_score_above_baseline():
    assert recovery_score(2.0) > 80

def test_recovery_score_below_baseline():
    assert recovery_score(-2.0) < 20
