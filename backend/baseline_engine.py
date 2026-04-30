"""Baseline Engine — cold-start prior, quality gates, Bayesian recompute.

Computes a personal RMSSD baseline using:
  1. Population prior (cold start) parameterised by age/sex/BMI/resting-HR.
  2. Bayesian update: each eligible session shifts posterior toward personal data.
  3. Quality gate: rejects sessions that fail sensor-mode, length, artifact, SQI,
     or HR-drift checks before they influence the baseline.

All functions here are PURE (no I/O). DB calls live in db.py.

Refs:
  Umetani 1998 — age/sex norms for RMSSD
  Nunan 2010 meta — HRV population norms
  Voss 2015 — short-term HRV review
  Aubert 2003 — athletes vs sedentary
  Koenig 2014 — BMI and HRV

NOTE: Quality thresholds below are UNTUNED — pending ≥3 real H10 sessions.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Tuple

WINDOW_DAYS = 14


@dataclass
class Baseline:
    rmssd_mean: float
    rmssd_sd: float
    rmssd_min: float
    rmssd_max: float
    hr_rest_mean: Optional[float]
    source: str  # 'cold_start' | 'blended' | 'personal'
    n_sessions_used: int
    posterior_precision: float
    window_start: Optional[str]


def cold_start_prior(profile: dict) -> Tuple[float, float]:
    """Returns (mean_rmssd_ms, sd_rmssd_ms).
    Refs: Umetani 1998, Nunan 2010 meta, Voss 2015, Aubert 2003, Koenig 2014.
    """
    age = profile.get("age", 35)
    sex = profile.get("sex", "prefer_not_to_say")
    height_cm = profile.get("height_cm", 170)
    weight_kg = profile.get("weight_kg")
    resting_hr = profile.get("resting_hr")

    ln_mean = 4.5 - 0.025 * age
    if sex == "female":
        ln_mean += 0.15
    if resting_hr is not None:
        ln_mean += 0.01 * (60 - resting_hr)
    if weight_kg is not None and height_cm is not None:
        bmi = weight_kg / ((height_cm / 100) ** 2)
        if bmi > 30:
            ln_mean -= 0.10
    sigma = 0.35
    mean = math.exp(ln_mean)
    sd = mean * (math.exp(sigma) - 1.0) / 2
    return mean, sd


# UNTUNED — pending ≥3 real H10 sessions
HARD_REJECT_RULES = [
    ("wrong_mode",  lambda s: s.get("sensor_mode", 2) != 2),
    ("too_short",   lambda s: s.get("rr_count", 0) < 300),
    ("artifacts",   lambda s: s.get("artifact_rate", 1.0) > 0.20),
    ("low_sqi",     lambda s: s.get("mean_sqi", 0.0) < 0.6),
    ("hr_drift",    lambda s: s.get("hr_drift_bpm", 999) > 40),
]

# UNTUNED — pending ≥3 real H10 sessions
CALIBRATION_REJECT_RULES = [
    ("wrong_mode",  lambda s: s.get("sensor_mode", 2) != 2),
    ("too_short",   lambda s: s.get("rr_count", 0) < 100),
    ("artifacts",   lambda s: s.get("artifact_rate", 1.0) > 0.20),
    ("low_sqi",     lambda s: s.get("mean_sqi", 0.0) < 0.7),
]


def quality_check(session: dict, is_calibration: bool = False) -> Tuple[bool, Optional[str], float]:
    """Check session quality against hard-reject rules.

    Returns (ok, reason, weight):
      ok     — True if session passes all rules
      reason — first failing rule name, or None if ok
      weight — baseline contribution weight in [0, 1]; 0 if rejected
    """
    rules = CALIBRATION_REJECT_RULES if is_calibration else HARD_REJECT_RULES
    for reason, rule in rules:
        if rule(session):
            return False, reason, 0.0
    w = (
        (1 - session.get("artifact_rate", 0.0))
        * session.get("mean_sqi", 1.0)
        * min(1.0, session.get("rr_count", 0) / 600)
    )
    return True, None, max(0.0, min(1.0, w))


def session_z(rmssd_session_median: float, baseline: Baseline) -> float:
    """Z-score of a session RMSSD vs personal baseline."""
    if baseline.rmssd_sd == 0:
        return 0.0
    return (rmssd_session_median - baseline.rmssd_mean) / baseline.rmssd_sd


def recovery_score(z: float) -> int:
    """Logistic recovery score 0–100. z=0 → 50, z=2 → ~88, z=-2 → ~12."""
    return int(round(100 / (1 + math.exp(-z))))


def recompute_baseline_from_sessions(profile: dict, sessions: list) -> Baseline:
    """Pure function — takes profile dict and list of eligible session dicts.

    Bayesian update:
      prior: N(mu_0, var_0) from cold_start_prior
      likelihood: each session contributes weighted precision tau_i = w / var_0
      posterior: precision-weighted sum → (mu_post, sd_post)
    """
    mu_0, sd_0 = cold_start_prior(profile)
    var_0 = sd_0 ** 2
    tau_0 = 1.0 / var_0

    tau_post = tau_0
    weighted_sum = mu_0 * tau_0
    for s in sessions:
        w = s.get("baseline_weight", 0.0)
        tau_i = w / var_0
        tau_post += tau_i
        weighted_sum += s.get("rmssd_median", mu_0) * tau_i

    mu_post = weighted_sum / tau_post
    sd_post = math.sqrt(1.0 / tau_post)
    n = len(sessions)
    source = "cold_start" if n == 0 else "blended" if n < 3 else "personal"

    return Baseline(
        rmssd_mean=round(mu_post, 2),
        rmssd_sd=round(sd_post, 2),
        rmssd_min=round(mu_post - sd_post, 2),
        rmssd_max=round(mu_post + sd_post, 2),
        hr_rest_mean=None,
        source=source,
        n_sessions_used=n,
        posterior_precision=round(tau_post, 4),
        window_start=None,
    )
