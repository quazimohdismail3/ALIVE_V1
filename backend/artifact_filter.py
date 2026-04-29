"""Artifact filter for RR intervals.

Three-stage gate:
  1. Absolute bounds (300..2000 ms) — physiological plausibility
  2. Relative filter — reject if |RR_i - RR_{i-1}| / RR_{i-1} > 0.25
  3. Signal Quality Index (SQI) — fraction of accepted RRs in window

Returns (accepted_rr_or_None, sqi). Caller decides whether to use the value
based on SQI threshold.
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass


ABS_MIN_MS = 300.0
ABS_MAX_MS = 2000.0
RELATIVE_MAX = 0.25  # 25% jump = artifact (motion, ectopic)
SQI_WINDOW = 30

_SQI_THRESHOLDS: dict[str, float] = {
    'calm':        0.80,
    'recovery':    0.75,
    'adhd':        0.75,
    'energy':      0.60,
    'breathwork':  0.65,
    'presence':    0.75,
    'calibration': 0.95,
}


@dataclass
class FilterResult:
    accepted: float | None  # None if rejected
    sqi: float              # 0..1, rolling fraction accepted


class ArtifactFilter:
    def __init__(self, session_type: str = 'calm', window: int = SQI_WINDOW):
        self.session_type = session_type
        self.window = window
        self.last_accepted: float | None = None
        self.history: deque[bool] = deque(maxlen=window)

    @property
    def sqi_threshold(self) -> float:
        return _SQI_THRESHOLDS.get(self.session_type, 0.70)

    def push(self, rr_ms: float) -> FilterResult:
        ok = self._check(rr_ms)
        self.history.append(ok)
        if ok:
            self.last_accepted = rr_ms
        sqi = sum(self.history) / max(len(self.history), 1)
        return FilterResult(accepted=rr_ms if ok else None, sqi=sqi)

    def _check(self, rr: float) -> bool:
        if not (ABS_MIN_MS <= rr <= ABS_MAX_MS):
            return False
        if self.last_accepted is not None:
            delta = abs(rr - self.last_accepted) / self.last_accepted
            if delta > RELATIVE_MAX:
                return False
        return True

    def reset(self) -> None:
        self.last_accepted = None
        self.history.clear()
