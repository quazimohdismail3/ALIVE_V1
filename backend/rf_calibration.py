# backend/rf_calibration.py
from __future__ import annotations
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .hrv_processor import HRVProcessor

import numpy as np
from scipy import signal
from scipy.optimize import minimize_scalar
from scipy.stats import norm


def compute_coherence_at_frequency(
    rr_intervals_ms: list,
    resp_signal: np.ndarray,
    target_bpm: float,
    resp_fs: float = 25.0,
) -> float:
    """Cross-spectral coherence between RR series and respiratory signal.
    At resonance: coherence > 0.85 at target_bpm/60 Hz. Returns 0–1.
    """
    if len(rr_intervals_ms) < 15 or len(resp_signal) < 30:
        return 0.0
    target_hz = target_bpm / 60.0
    rr_s = np.array(rr_intervals_ms) / 1000.0
    t_rr = np.cumsum(rr_s)
    t_rr -= t_rr[0]
    if t_rr[-1] < 15:
        return 0.0
    t_uniform = np.arange(0, t_rr[-1], 0.25)
    rr_interp = np.interp(t_uniform, t_rr, rr_s)
    n_target = len(t_uniform)
    resp_resampled = signal.resample(resp_signal, n_target)
    nperseg = min(128, len(rr_interp) // 2)
    if nperseg < 16:
        return 0.0
    f, Cxy = signal.coherence(rr_interp, resp_resampled, fs=4.0, nperseg=nperseg)
    mask = np.abs(f - target_hz) < 0.025
    if not np.any(mask):
        return 0.0
    return float(np.max(Cxy[mask]))


def compute_prior_rf_bpm(height_cm: float, sex: str = "male") -> float:
    """Iizawa 2024 height-based RF prior. Clamped to [4.5, 6.5]."""
    if sex == "female":
        rf = 15.88 - 0.06 * height_cm
    else:
        rf = 17.90 - 0.07 * height_cm
    return round(max(4.5, min(6.5, rf)), 1)


def compute_rsa_amplitude(rr_intervals_ms: list, rf_bpm: float) -> float:
    """RSA amplitude: peak-to-trough RR variation in the RF band (ms).
    Uses 30s sliding window bandpass. Returns 0.0 if insufficient data."""
    if len(rr_intervals_ms) < 20:
        return 0.0
    rr = np.array(rr_intervals_ms, dtype=float)
    t = np.cumsum(rr / 1000.0)
    t -= t[0]
    if t[-1] < 20.0:
        return 0.0
    fs = 4.0
    t_uniform = np.arange(0, t[-1], 1.0 / fs)
    rr_interp = np.interp(t_uniform, t, rr)
    rf_hz = rf_bpm / 60.0
    low, high = max(0.01, rf_hz - 0.05), rf_hz + 0.05
    sos = signal.butter(2, [low, high], btype="bandpass", fs=fs, output="sos")
    filtered = signal.sosfiltfilt(sos, rr_interp)
    return float(np.max(filtered) - np.min(filtered))


class BayesianRFOptimizer:
    """GP surrogate model for personal RF search. Finds RF in 3–5 evaluations."""

    def __init__(self, height_cm: float = None, sex: str = "male", prior_rf: float = None, hrv_processor: "HRVProcessor | None" = None):
        self._hrv_processor = hrv_processor
        self.observations = []
        self.search_bounds = (4.5, 6.5)
        if prior_rf:
            self.f0 = prior_rf
        elif height_cm is not None:
            self.f0 = compute_prior_rf_bpm(height_cm, sex)
        else:
            self.f0 = 5.5
        self.next_freq = self.f0

    def observe(self, bpm: float, coherence: float):
        self.observations.append((bpm, coherence))

    def next_evaluation_point(self) -> float:
        if len(self.observations) < 3:
            tested = [o[0] for o in self.observations]
            candidates = [self.f0 + 0.6, self.f0 - 0.6, self.f0 + 1.2, self.f0 - 1.2]
            candidates = [c for c in candidates
                          if self.search_bounds[0] <= c <= self.search_bounds[1]
                          and not any(abs(c - t) < 0.1 for t in tested)]
            return candidates[0] if candidates else self.f0 + 0.3

        X = np.array([o[0] for o in self.observations]).reshape(-1, 1)
        y = np.array([o[1] for o in self.observations])
        length_scale = 0.8
        noise = 0.02

        def rbf(x1, x2):
            return np.exp(-0.5 * ((x1 - x2) / length_scale) ** 2)

        K = np.array([[rbf(x1[0], x2[0]) for x2 in X] for x1 in X])
        K += noise * np.eye(len(X))
        K_inv = np.linalg.inv(K)
        best_y = np.max(y)

        def neg_ei(bpm_val):
            k_star = np.array([rbf(bpm_val, xi[0]) for xi in X])
            mu = float(k_star @ K_inv @ y)
            sigma2 = float(rbf(bpm_val, bpm_val) - k_star @ K_inv @ k_star)
            sigma = max(np.sqrt(abs(sigma2)), 1e-9)
            z = (mu - best_y) / sigma
            return -((mu - best_y) * norm.cdf(z) + sigma * norm.pdf(z))

        result = minimize_scalar(neg_ei, bounds=self.search_bounds, method='bounded')
        return round(result.x, 2)

    def best_estimate(self) -> tuple:
        if not self.observations:
            return self.f0, 0.0
        return max(self.observations, key=lambda o: o[1])

    def get_resp_signal(self, resp_buffer: list) -> "np.ndarray":
        """Return resp signal for coherence computation. Falls back to RR-derived signal for Mode 2."""
        if resp_buffer and not np.all(np.array(resp_buffer) == 0):
            return np.array(resp_buffer, dtype=float)
        if self._hrv_processor is not None:
            synthetic = self._hrv_processor._rf_engine.as_resp_signal()
            if len(synthetic) > 0:
                return synthetic
        return np.zeros(50)


MODE_CALIBRATION_CONFIG = {
    1: {
        "rr_source": "rppg",
        "resp_source": "mic",
        "settling_seconds": 25,
        "min_coherence_lock": 0.75,
        "confidence_tag": "MEDIUM",
    },
    2: {
        "rr_source": "h10",
        "resp_source": "h10_accel",
        "settling_seconds": 20,
        "min_coherence_lock": 0.85,
        "confidence_tag": "HIGH",
    },
    3: {
        "rr_source": "h10",
        "resp_source": "best_of_mic_and_h10_accel",
        "settling_seconds": 20,
        "min_coherence_lock": 0.85,
        "confidence_tag": "HIGH",
    },
}
