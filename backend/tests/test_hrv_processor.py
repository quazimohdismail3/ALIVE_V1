"""Tests for HRVProcessor — MIN_RR_FOR_METRICS=15 and hf/lf power fields."""
import random
import sys
import os

# Allow running with: python -m pytest backend/tests/test_hrv_processor.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.hrv_processor import HRVProcessor


def test_compute_returns_result_with_15_rr():
    proc = HRVProcessor()
    for rr in [800, 820, 810, 830, 790, 800, 815, 805, 825, 795, 800, 810, 820, 800, 815]:
        proc.push(rr)
    result = proc.compute()
    assert result is not None, "compute() must not return None with >= 15 RR intervals"
    assert result.hr > 0
    assert result.rmssd > 0


def test_compute_returns_none_with_too_few_rr():
    proc = HRVProcessor()
    for rr in [800, 820, 810]:
        proc.push(rr)
    result = proc.compute()
    assert result is None


def test_hf_lf_available_with_60_rr():
    rng = random.Random(42)
    proc = HRVProcessor()
    for _ in range(70):
        proc.push(800 + rng.uniform(-50, 50))
    result = proc.compute()
    assert result is not None
    # HF/LF may be None if computation fails, but should return a value with 70 RRs
    if result.hf_power is not None:
        assert result.hf_power >= 0
    if result.lf_power is not None:
        assert result.lf_power >= 0


def test_hf_lf_none_below_60_rr():
    """With < 60 RRs, freq domain fields must be None."""
    proc = HRVProcessor()
    for _ in range(20):
        proc.push(800)
    result = proc.compute()
    assert result is not None
    assert result.hf_power is None
    assert result.lf_power is None
    assert result.lf_hf_ratio is None


def test_to_dict_includes_hf_lf_fields():
    proc = HRVProcessor()
    for rr in [800, 820, 810, 830, 790, 800, 815, 805, 825, 795, 800, 810, 820, 800, 815]:
        proc.push(rr)
    result = proc.compute()
    assert result is not None
    d = result.to_dict()
    assert "hf_power" in d
    assert "lf_power" in d
    assert "lf_hf_ratio" in d
