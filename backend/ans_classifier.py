"""ANS Classifier — L3 Polyvagal state classification.

Five states (Porges):
  - ventral_vagal       (regulated, social)
  - healthy_sympathetic (mobilized, no alarm)
  - anxious_sympathetic (mobilized, alarm)
  - dorsal_vagal        (shutdown, freeze)
  - burnout_rigidity    (depletion, low variability)

Confidence >=0.75 required to act on a classification (CONFIDENCE_GATE).
Runs in parallel with affect_classifier (L4) -- never sequential.
"""
from __future__ import annotations
from dataclasses import dataclass

from .config import CONFIDENCE_GATE
from .hrv_processor import HRVMetrics


STATES = (
    "ventral_vagal",
    "healthy_sympathetic",
    "anxious_sympathetic",
    "dorsal_vagal",
    "burnout_rigidity",
)


@dataclass
class ANSClassification:
    state: str
    confidence: float
    scores: dict[str, float]
    confidence_tag: str = "UNKNOWN"   # RF-derived: RESONANT | PARASYMPATHETIC | ENTRAINING | DYSREGULATED

    @property
    def actionable(self) -> bool:
        return self.confidence >= CONFIDENCE_GATE


def classify(m: HRVMetrics | None, rmssd_norm: float = 0.5, rf_hz: float | None = None, rf_error: float | None = None) -> ANSClassification:
    """Score each polyvagal state from HRV metrics.

    rmssd_norm is the personal-percentile normalized RMSSD (0..1).
    rf_hz and rf_error are optional RF entrainment signals; when provided,
    a confidence_tag is derived from the 4-quadrant RF model.
    """
    if m is None:
        return ANSClassification(
            state="ventral_vagal",
            confidence=0.0,
            scores={s: 0.2 for s in STATES},
            confidence_tag="UNKNOWN",
        )
    s: dict[str, float] = {}

    # Ventral vagal: high RMSSD, balanced SD1/SD2, moderate DFA
    s["ventral_vagal"] = (
        0.5 * rmssd_norm
        + 0.3 * _bell(m.sd1_sd2_ratio, center=0.65, width=0.25)
        + 0.2 * _bell(m.dfa_alpha1, center=1.0, width=0.3)
    )
    if m.lf_hf_ratio is not None and 1.0 <= m.lf_hf_ratio <= 2.5:
        s["ventral_vagal"] += 0.05 * _bell(m.lf_hf_ratio, center=1.5, width=0.7)

    # Healthy sympathetic: moderate RMSSD, low SVI, DFA ~1.0
    s["healthy_sympathetic"] = (
        0.4 * _bell(rmssd_norm, center=0.45, width=0.2)
        + 0.3 * _bell(m.svi, center=0.05, width=0.05)
        + 0.3 * _bell(m.dfa_alpha1, center=1.0, width=0.2)
    )

    # Anxious sympathetic: low RMSSD, HIGH SVI, low SD1/SD2
    s["anxious_sympathetic"] = (
        0.4 * (1.0 - rmssd_norm)
        + 0.4 * _ramp(m.svi, low=0.08, high=0.25)
        + 0.2 * (1.0 - min(1.0, m.sd1_sd2_ratio / 0.6))
    )
    if m.lf_hf_ratio is not None and m.lf_hf_ratio > 2.0:
        s["anxious_sympathetic"] += 0.1 * min(1.0, (m.lf_hf_ratio - 2.0) / 3.0)

    # Dorsal vagal: very low RMSSD, low HR, low DFA (rigid shutdown)
    s["dorsal_vagal"] = (
        0.5 * (1.0 - rmssd_norm)
        + 0.3 * (1.0 if m.hr < 55 else max(0.0, 1.0 - (m.hr - 55) / 15))
        + 0.2 * (1.0 - min(1.0, m.dfa_alpha1 / 1.2))
    )
    if m.lf_hf_ratio is not None and m.lf_hf_ratio < 0.8:
        s["dorsal_vagal"] += 0.05 * max(0.0, 1.0 - m.lf_hf_ratio / 0.8)

    # Burnout rigidity: clinically requires ABSOLUTE low RMSSD AND low SVI.
    # Gate by absolute RMSSD < 30ms -- otherwise score is forced to ~0.
    if m.rmssd < 30.0:
        s["burnout_rigidity"] = (
            0.5 * (1.0 - rmssd_norm)
            + 0.5 * _bell(m.svi, center=0.02, width=0.02)
        )
    else:
        s["burnout_rigidity"] = 0.05

    # Sharpen scores (power=4) before normalizing -- preserves the 0.75 gate
    # by making the winning state dominate when its evidence is strong.
    # Bell-curve scoring is naturally soft; raising to a power converts
    # "moderate winner" -> "clear winner" without changing the ranking.
    sharpened = {k: max(v, 1e-6) ** 4 for k, v in s.items()}
    total = sum(sharpened.values()) or 1.0
    probs = {k: v / total for k, v in sharpened.items()}
    state = max(probs, key=probs.get)
    confidence = probs[state]
    # RF confidence tag -- sharpens ANS state with entrainment signal
    if rf_hz is not None and rf_error is not None:
        at_resonance = rf_error < 0.008  # within ~0.5 BPM of personal RF
        if state == "ventral_vagal" and at_resonance:
            confidence_tag = "RESONANT"      # highest therapeutic value
        elif state == "ventral_vagal" and not at_resonance:
            confidence_tag = "PARASYMPATHETIC"
        elif state != "ventral_vagal" and at_resonance:
            confidence_tag = "ENTRAINING"    # mechanism active, not yet recovered
        else:
            confidence_tag = "DYSREGULATED"
    else:
        confidence_tag = "UNKNOWN"
    return ANSClassification(state=state, confidence=confidence, scores=probs, confidence_tag=confidence_tag)


# --- helpers
def _bell(x: float, center: float, width: float) -> float:
    """Gaussian-ish bump, peak 1.0 at center."""
    if width <= 0:
        return 0.0
    z = (x - center) / width
    import math
    return math.exp(-0.5 * z * z)


def _ramp(x: float, low: float, high: float) -> float:
    if x <= low:
        return 0.0
    if x >= high:
        return 1.0
    return (x - low) / (high - low)


class ANSClassifierHysteresis:
    """Require N consecutive same classifications before accepting state change.
    Prevents artifact-driven state flips at 1Hz update rate.
    """

    def __init__(self, min_consecutive: int = 3):
        self.min_consecutive = min_consecutive
        self._pending_state: str | None = None
        self._pending_count: int = 0
        self._confirmed_state: str = "ventral_vagal"

    def update(self, raw: ANSClassification) -> ANSClassification:
        """Return smoothed classification — only changes state after min_consecutive confirmations."""
        if raw.state == self._confirmed_state:
            self._pending_state = None
            self._pending_count = 0
            return raw
        if raw.state == self._pending_state:
            self._pending_count += 1
        else:
            self._pending_state = raw.state
            self._pending_count = 1
        if self._pending_count >= self.min_consecutive:
            self._confirmed_state = raw.state
            self._pending_state = None
            self._pending_count = 0
            return raw
        # Pending: return confirmed state, signal reduced confidence
        return ANSClassification(
            state=self._confirmed_state,
            confidence=raw.confidence * 0.8,
            scores=raw.scores,
            confidence_tag=raw.confidence_tag,
        )

    def reset(self) -> None:
        self._pending_state = None
        self._pending_count = 0
        self._confirmed_state = "ventral_vagal"
