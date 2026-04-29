# backend/rf_calibration.py
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


class BayesianRFOptimizer:
    """GP surrogate model for personal RF search. Finds RF in 3–5 evaluations."""

    def __init__(self, height_cm: float = None, prior_rf: float = None):
        self.observations = []
        self.search_bounds = (4.0, 8.5)
        if prior_rf:
            self.f0 = prior_rf
        elif height_cm:
            if height_cm > 183:
                self.f0 = 5.0
            elif height_cm >= 168:
                self.f0 = 5.5
            else:
                self.f0 = 6.0
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
