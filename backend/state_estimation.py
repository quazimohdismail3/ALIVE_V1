"""6D autonomic state vector with nonlinear mappings + EMA smoothing.

Dimensions:
  arousal           (0..1) — high RMSSD → low arousal (sigmoid)
  valence           (-1..1)
  stability         (0..1) — low SVI → high stability
  coherence         (0..1) — DFA closeness to 1.0
  autonomic_balance (raw SD1/SD2)
  recovery_rate     (EMA of ΔRMSSD)

Personal normalization only — never population norms.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
import math

from .config import (
    EMA_ALPHA,
    PERSONAL_RMSSD_MAX,
    PERSONAL_RMSSD_MIN,
)
from .hrv_processor import HRVMetrics


@dataclass
class StateVector:
    arousal: float
    valence: float
    stability: float
    coherence: float
    autonomic_balance: float
    recovery_rate: float
    rmssd_norm: float
    rf_hz: float | None = None       # measured breathing rate from RFEngine
    rf_error: float | None = None    # |rf_hz - user_calibrated_rf_hz| in Hz; None if rf_hz is None

    def to_dict(self) -> dict:
        return asdict(self)

    def as_tuple(self) -> tuple[float, ...]:
        return (
            self.arousal,
            self.valence,
            self.stability,
            self.coherence,
            self.autonomic_balance,
            self.recovery_rate,
        )


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def normalize_rmssd(rmssd: float) -> float:
    """Personal-percentile normalization to 0..1."""
    rng = max(PERSONAL_RMSSD_MAX - PERSONAL_RMSSD_MIN, 1.0)
    return max(0.0, min(1.0, (rmssd - PERSONAL_RMSSD_MIN) / rng))


def estimate_raw(m: HRVMetrics) -> StateVector:
    rmssd_norm = normalize_rmssd(m.rmssd)
    arousal = _sigmoid(-(rmssd_norm - 0.5) * 6.0)
    valence = max(-1.0, min(1.0, math.tanh(m.sd1_sd2_ratio * 3.0 - 1.0)))
    stability = 1.0 - _sigmoid((m.svi - 0.15) * 20.0)
    coherence = max(0.0, min(1.0, m.dfa_alpha1 / 1.5))
    autonomic_balance = m.sd1_sd2_ratio
    return StateVector(
        arousal=arousal,
        valence=valence,
        stability=stability,
        coherence=coherence,
        autonomic_balance=autonomic_balance,
        recovery_rate=0.0,
        rmssd_norm=rmssd_norm,
    )


class StateEstimator:
    """Stateful EMA smoother and recovery_rate tracker."""

    def __init__(self, alpha: float = EMA_ALPHA, user_calibrated_rf_hz: float = 0.1):
        self.alpha = alpha
        self.user_calibrated_rf_hz = user_calibrated_rf_hz   # personal RF from profile, 0.1 Hz fallback
        self.smoothed: StateVector | None = None
        self._last_rmssd: float | None = None

    def update(self, m: HRVMetrics) -> StateVector:
        # RF error: distance from personal resonance frequency
        rf_error: float | None = None
        if m.rf_hz is not None:
            rf_error = abs(m.rf_hz - self.user_calibrated_rf_hz)

        raw = estimate_raw(m)
        raw.rf_hz = m.rf_hz
        raw.rf_error = rf_error

        # Recovery rate = EMA of ΔRMSSD (ms/cycle), normalized to ~[-1, 1]
        if self._last_rmssd is not None:
            delta = (m.rmssd - self._last_rmssd) / 20.0  # scale: 20ms swing → 1.0
            delta = max(-1.0, min(1.0, delta))
            prior = self.smoothed.recovery_rate if self.smoothed else 0.0
            raw.recovery_rate = (1 - 0.3) * prior + 0.3 * delta
        self._last_rmssd = m.rmssd

        if self.smoothed is None:
            self.smoothed = raw
            return raw

        a = self.alpha
        s = self.smoothed
        merged = StateVector(
            arousal=(1 - a) * s.arousal + a * raw.arousal,
            valence=(1 - a) * s.valence + a * raw.valence,
            stability=(1 - a) * s.stability + a * raw.stability,
            coherence=(1 - a) * s.coherence + a * raw.coherence,
            autonomic_balance=(1 - a) * s.autonomic_balance + a * raw.autonomic_balance,
            recovery_rate=raw.recovery_rate,
            rmssd_norm=(1 - a) * s.rmssd_norm + a * raw.rmssd_norm,
            rf_hz=raw.rf_hz,      # not EMA-smoothed (instantaneous measurement)
            rf_error=raw.rf_error, # not EMA-smoothed
        )
        self.smoothed = merged
        return merged

    def reset(self) -> None:
        self.smoothed = None
        self._last_rmssd = None
