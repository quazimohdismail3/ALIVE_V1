"""ANS Classifier — L3 Polyvagal state classification.

Five states (Porges):
  - ventral_vagal       (regulated, social)
  - healthy_sympathetic (mobilized, no alarm)
  - anxious_sympathetic (mobilized, alarm)
  - dorsal_vagal        (shutdown, freeze)
  - burnout_rigidity    (depletion, low variability)

Confidence ≥0.75 required to act on a classification (CONFIDENCE_GATE).
Runs in parallel with affect_classifier (L4) — never sequential.
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

    @property
    def actionable(self) -> bool:
        return self.confidence >= CONFIDENCE_GATE


def classify(m: HRVMetrics, rmssd_norm: float) -> ANSClassification:
    """Score each polyvagal state from HRV metrics.

    rmssd_norm is the personal-percentile normalized RMSSD (0..1).
    """
    s: dict[str, float] = {}

    # Ventral vagal: high RMSSD, balanced SD1/SD2, moderate DFA
    s["ventral_vagal"] = (
        0.5 * rmssd_norm
        + 0.3 * _bell(m.sd1_sd2_ratio, center=0.65, width=0.25)
        + 0.2 * _bell(m.dfa_alpha1, center=1.0, width=0.3)
    )

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

    # Dorsal vagal: very low RMSSD, low HR, low DFA (rigid shutdown)
    s["dorsal_vagal"] = (
        0.5 * (1.0 - rmssd_norm)
        + 0.3 * (1.0 if m.hr < 55 else max(0.0, 1.0 - (m.hr - 55) / 15))
        + 0.2 * (1.0 - min(1.0, m.dfa_alpha1 / 1.2))
    )

    # Burnout rigidity: clinically requires ABSOLUTE low RMSSD AND low SVI.
    # Gate by absolute RMSSD < 30ms — otherwise score is forced to ~0.
    if m.rmssd < 30.0:
        s["burnout_rigidity"] = (
            0.5 * (1.0 - rmssd_norm)
            + 0.5 * _bell(m.svi, center=0.02, width=0.02)
        )
    else:
        s["burnout_rigidity"] = 0.05

    # Sharpen scores (power=4) before normalizing — preserves the 0.75 gate
    # by making the winning state dominate when its evidence is strong.
    # Bell-curve scoring is naturally soft; raising to a power converts
    # "moderate winner" → "clear winner" without changing the ranking.
    sharpened = {k: max(v, 1e-6) ** 4 for k, v in s.items()}
    total = sum(sharpened.values()) or 1.0
    probs = {k: v / total for k, v in sharpened.items()}
    state = max(probs, key=probs.get)
    confidence = probs[state]
    return ANSClassification(state=state, confidence=confidence, scores=probs)


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
