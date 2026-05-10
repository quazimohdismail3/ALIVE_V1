"""HRV Processor — RR buffer → time-domain + nonlinear metrics.

Central metric: RMSSD (non-negotiable). All other metrics are derived
from the same RR buffer in the same call to keep them temporally aligned.

Dual window:
  - short_window (30 RRs): fast metrics for the control loop
  - long_window  (180 RRs): slow trend / DFA / SVI

Refs:
  Task Force ESC/NASPE 1996 — HRV standards
  Shaffer & Ginsberg 2017 — HRV norms (Front Public Health 5:258)
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass, asdict
import math
from typing import Iterable

import numpy as np

from .config import MIN_RR_FOR_METRICS
from .rf_engine import RFEngine


SHORT_WINDOW = 30
LONG_WINDOW = 180


@dataclass
class HRVMetrics:
    rmssd: float          # ms — central
    sdnn: float           # ms
    sd1: float            # ms (Poincaré short)
    sd2: float            # ms (Poincaré long)
    sd1_sd2_ratio: float
    svi: float            # sympathovagal variability index
    dfa_alpha1: float     # nonlinear complexity
    mean_rr: float        # ms
    hr: float             # bpm
    n_rr: int
    # Quality scalars (P2) — UNTUNED: thresholds pending ≥3 real H10 sessions
    artifact_rate: float = 0.0   # fraction of RR diffs flagged as artifacts
    mean_sqi: float = 1.0        # signal quality index proxy (0–1)
    hr_drift_bpm: float = 0.0    # HR drift = max(HR) − min(HR) over session
    rf_hz: float | None = None   # RR-derived respiratory frequency (Hz); None < 30s data
    hf_power: float | None = None      # ms² — HF band 0.15–0.4 Hz (parasympathetic)
    lf_power: float | None = None      # ms² — LF band 0.04–0.15 Hz (sympathovagal)
    lf_hf_ratio: float | None = None   # LF/HF ratio

    def to_dict(self) -> dict:
        return asdict(self)


class HRVProcessor:
    def __init__(self, short: int = SHORT_WINDOW, long: int = LONG_WINDOW):
        self.short = short
        self.long = long
        self._rf_engine = RFEngine()
        self.buf: deque[float] = deque(maxlen=long)

    def push(self, rr_ms: float) -> None:
        self.buf.append(float(rr_ms))
        self._rf_engine.push_rr(rr_ms)

    def push_many(self, rrs: Iterable[float]) -> None:
        for r in rrs:
            self.push(r)

    def ready(self) -> bool:
        return len(self.buf) >= MIN_RR_FOR_METRICS

    def compute(self) -> HRVMetrics | None:
        if not self.ready():
            return None
        rr = np.array(self.buf, dtype=float)
        rr_short = rr[-self.short:]
        rf_hz = self._rf_engine.compute_rf()
        return self._metrics(rr, rr_short, rf_hz=rf_hz)

    # --- internal
    def _metrics(self, rr_long: np.ndarray, rr_short: np.ndarray, rf_hz: float | None = None) -> HRVMetrics:
        diff = np.diff(rr_short)
        rmssd = float(np.sqrt(np.mean(diff ** 2))) if diff.size else 0.0
        sdnn = float(np.std(rr_short, ddof=0))
        sd1 = rmssd / math.sqrt(2)
        sd2_sq = max(0.0, 2 * sdnn ** 2 - sd1 ** 2)
        sd2 = math.sqrt(sd2_sq)
        sd1_sd2 = sd1 / max(sd2, 0.01)

        # SVI: variability of mean RR over rolling sub-windows of long buffer
        svi = self._svi(rr_long)

        dfa = self._dfa_alpha1(rr_long)

        mean_rr = float(np.mean(rr_short))
        hr = 60_000.0 / max(mean_rr, 1.0)

        # Quality scalars (P2)
        artifact_rate = self._artifact_rate(rr_long)
        mean_sqi = max(0.0, min(1.0, 1.0 - artifact_rate))
        hr_drift_bpm = self._hr_drift(rr_long)

        # Frequency domain (requires >= 60 RRs for reliable estimates)
        hf_power, lf_power, lf_hf_ratio = self._freq_domain(rr_long)

        return HRVMetrics(
            rmssd=rmssd,
            sdnn=sdnn,
            sd1=sd1,
            sd2=sd2,
            sd1_sd2_ratio=sd1_sd2,
            svi=svi,
            dfa_alpha1=dfa,
            mean_rr=mean_rr,
            hr=hr,
            n_rr=len(rr_long),
            artifact_rate=artifact_rate,
            mean_sqi=mean_sqi,
            hr_drift_bpm=hr_drift_bpm,
            rf_hz=rf_hz,
            hf_power=hf_power,
            lf_power=lf_power,
            lf_hf_ratio=lf_hf_ratio,
        )

    @staticmethod
    def _svi(rr: np.ndarray) -> float:
        # Sympathovagal variability index proxy:
        # std of windowed mean RR / overall mean RR. Higher = more sympathetic flux.
        if rr.size < 30:
            return 0.0
        win = 10
        means = np.array([rr[i:i + win].mean() for i in range(0, rr.size - win + 1, 5)])
        if means.size < 2:
            return 0.0
        return float(np.std(means) / max(np.mean(rr), 1.0))

    @staticmethod
    def _artifact_rate(rr: np.ndarray) -> float:
        """Fraction of successive RR diffs that exceed 20% of the local median.
        Proxy for ectopic/motion artifact density.
        """
        if rr.size < 4:
            return 0.0
        median_rr = float(np.median(rr))
        if median_rr == 0:
            return 0.0
        diffs = np.abs(np.diff(rr))
        artifacts = np.sum(diffs > 0.20 * median_rr)
        return float(artifacts) / max(len(diffs), 1)

    @staticmethod
    def _hr_drift(rr: np.ndarray) -> float:
        """HR drift (bpm) = max(HR over 10-RR windows) − min(HR over 10-RR windows).
        Captures non-stationarity; high drift may indicate posture change or artefact.
        """
        if rr.size < 10:
            return 0.0
        win = 10
        hr_means = []
        for i in range(0, rr.size - win + 1, 5):
            mean_rr_w = float(np.mean(rr[i:i + win]))
            if mean_rr_w > 0:
                hr_means.append(60_000.0 / mean_rr_w)
        if len(hr_means) < 2:
            return 0.0
        return float(max(hr_means) - min(hr_means))

    @staticmethod
    def _freq_domain(rr: np.ndarray) -> tuple[float | None, float | None, float | None]:
        """Simple FFT-based LF/HF power. Requires >= 60 RR intervals for reliable estimates.
        Returns (hf_power, lf_power, lf_hf_ratio) in ms² or (None, None, None) if insufficient data."""
        if rr.size < 60:
            return None, None, None
        try:
            # Resample RR to 4Hz evenly-spaced using linear interpolation
            cumtime = np.cumsum(rr) / 1000.0  # cumulative time in seconds
            fs = 4.0
            t_uniform = np.arange(cumtime[0], cumtime[-1], 1.0 / fs)
            if len(t_uniform) < 32:
                return None, None, None
            rr_uniform = np.interp(t_uniform, cumtime, rr)
            rr_uniform -= np.mean(rr_uniform)  # detrend (mean removal)
            # Welch-like: use Hanning window on full signal
            N = len(rr_uniform)
            window = np.hanning(N)
            fft_vals = np.fft.rfft(rr_uniform * window)
            freqs = np.fft.rfftfreq(N, d=1.0 / fs)
            psd = (np.abs(fft_vals) ** 2) / (fs * N)  # one-sided PSD (ms²/Hz)
            df = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0
            # Integrate bands
            lf_mask = (freqs >= 0.04) & (freqs < 0.15)
            hf_mask = (freqs >= 0.15) & (freqs < 0.40)
            lf_power = float(np.sum(psd[lf_mask]) * df)
            hf_power = float(np.sum(psd[hf_mask]) * df)
            lf_hf = lf_power / max(hf_power, 0.01)
            return round(hf_power, 2), round(lf_power, 2), round(lf_hf, 3)
        except Exception:
            return None, None, None

    @staticmethod
    def _dfa_alpha1(rr: np.ndarray) -> float:
        # Detrended fluctuation analysis, short-term (alpha1).
        # Approximate, fast version. For n<30 returns ~1.0 (neutral).
        n = rr.size
        if n < 30:
            return 1.0
        try:
            y = np.cumsum(rr - np.mean(rr))
            scales = [4, 6, 8, 10, 12, 16]
            scales = [s for s in scales if s < n // 4]
            if len(scales) < 2:
                return 1.0
            flucts = []
            for s in scales:
                segs = n // s
                if segs < 2:
                    continue
                rms_segs = []
                for i in range(segs):
                    seg = y[i * s:(i + 1) * s]
                    x = np.arange(seg.size)
                    coef = np.polyfit(x, seg, 1)
                    trend = np.polyval(coef, x)
                    rms_segs.append(np.sqrt(np.mean((seg - trend) ** 2)))
                flucts.append(np.mean(rms_segs))
            if len(flucts) < 2:
                return 1.0
            log_s = np.log(scales[: len(flucts)])
            log_f = np.log(np.maximum(flucts, 1e-9))
            alpha = float(np.polyfit(log_s, log_f, 1)[0])
            return max(0.3, min(1.8, alpha))
        except Exception:
            return 1.0
