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

    def to_dict(self) -> dict:
        return asdict(self)


class HRVProcessor:
    def __init__(self, short: int = SHORT_WINDOW, long: int = LONG_WINDOW):
        self.short = short
        self.long = long
        self.buf: deque[float] = deque(maxlen=long)

    def push(self, rr_ms: float) -> None:
        self.buf.append(float(rr_ms))

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
        return self._metrics(rr, rr_short)

    # --- internal
    def _metrics(self, rr_long: np.ndarray, rr_short: np.ndarray) -> HRVMetrics:
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
