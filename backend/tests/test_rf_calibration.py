import numpy as np
import pytest
from backend.rf_calibration import compute_coherence_at_frequency, BayesianRFOptimizer, MODE_CALIBRATION_CONFIG
from backend.hrv_processor import HRVProcessor


# ---------------------------------------------------------------------------
# Cal-frame hrv contract — Calibration.jsx reads msg.hrv.{rmssd,hr,artifact_rate}
# ---------------------------------------------------------------------------

def test_cal_hrv_none_when_proc_not_ready():
    """hrv key is None in cal frame when proc hasn't accumulated MIN_RR_FOR_METRICS intervals."""
    proc = HRVProcessor()
    m = proc.compute()
    hrv = {"rmssd": round(m.rmssd, 1), "sdnn": round(m.sdnn, 1),
           "hr": round(m.hr, 1), "artifact_rate": round(m.artifact_rate, 4)} if m is not None else None
    assert hrv is None


def test_cal_hrv_has_required_fields_when_proc_ready():
    """After MIN_RR_FOR_METRICS (30) intervals, hrv dict has rmssd, hr, artifact_rate for Calibration.jsx."""
    proc = HRVProcessor()
    for _ in range(30):
        proc.push(800.0)
    m = proc.compute()
    assert m is not None, "proc should be ready after 10 RR intervals"

    hrv = {
        "rmssd": round(m.rmssd, 1),
        "sdnn":  round(m.sdnn,  1),
        "hr":    round(m.hr,    1),
        "artifact_rate": round(m.artifact_rate, 4),
    }

    assert isinstance(hrv["rmssd"], float)
    assert isinstance(hrv["hr"], float) and 30.0 <= hrv["hr"] <= 220.0
    assert isinstance(hrv["artifact_rate"], float) and 0.0 <= hrv["artifact_rate"] <= 1.0


def test_cal_hrv_artifact_rate_zero_for_clean_signal():
    """Constant-interval RR stream (no artifacts) → artifact_rate == 0.0."""
    proc = HRVProcessor()
    for _ in range(30):
        proc.push(800.0)
    m = proc.compute()
    assert m is not None
    assert m.artifact_rate == 0.0


def test_coherence_needs_min_data():
    assert compute_coherence_at_frequency([850] * 5, np.zeros(10), 6.0) == 0.0


def test_coherence_needs_min_duration():
    # 10 RR intervals of ~850ms each = ~8.5s < 15s minimum
    rr = [850.0] * 10
    resp = np.sin(np.linspace(0, 4 * np.pi, 50))
    assert compute_coherence_at_frequency(rr, resp, 6.0) == 0.0


def test_bayesian_cold_start_height_tall():
    opt = BayesianRFOptimizer(height_cm=190)
    assert opt.f0 == 4.6  # Iizawa formula: 17.90 - 0.07*190 = 4.60


def test_bayesian_cold_start_height_medium():
    opt = BayesianRFOptimizer(height_cm=175)
    assert opt.f0 == 5.6  # Iizawa formula: 17.90 - 0.07*175 = 5.65 → rounds to 5.6


def test_bayesian_cold_start_height_short():
    opt = BayesianRFOptimizer(height_cm=160)
    assert opt.f0 == 6.5  # Iizawa formula: 17.90 - 0.07*160 = 6.70 → clamped to 6.5


def test_bayesian_prior_rf_overrides_height():
    opt = BayesianRFOptimizer(height_cm=175, prior_rf=7.0)
    assert opt.f0 == 7.0


def test_bayesian_exploration_in_bounds():
    opt = BayesianRFOptimizer(prior_rf=6.0)
    opt.observe(6.0, 0.5)
    nxt = opt.next_evaluation_point()
    assert 4.0 <= nxt <= 8.5


def test_bayesian_best_estimate():
    opt = BayesianRFOptimizer()
    opt.observe(5.5, 0.6)
    opt.observe(6.0, 0.9)
    opt.observe(5.0, 0.4)
    bpm, coh = opt.best_estimate()
    assert bpm == 6.0
    assert coh == 0.9


def test_bayesian_no_observations():
    opt = BayesianRFOptimizer(prior_rf=5.5)
    bpm, coh = opt.best_estimate()
    assert bpm == 5.5
    assert coh == 0.0


def test_mode_config_all_modes_present():
    assert set(MODE_CALIBRATION_CONFIG.keys()) == {1, 2, 3}


def test_mode2_high_confidence():
    assert MODE_CALIBRATION_CONFIG[2]["confidence_tag"] == "HIGH"
    assert MODE_CALIBRATION_CONFIG[2]["min_coherence_lock"] == 0.85


def test_mode1_medium_confidence():
    assert MODE_CALIBRATION_CONFIG[1]["confidence_tag"] == "MEDIUM"
    assert MODE_CALIBRATION_CONFIG[1]["min_coherence_lock"] == 0.75
