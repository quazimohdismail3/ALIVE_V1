"""Affect Classifier — L4 Russell Circumplex (arousal × valence).

Runs in PARALLEL with ans_classifier (L3), never sequential.
Output is a quadrant + (arousal, valence) pair in [-1, 1].

Russell 1980 (JPSP 39:1161). The four quadrants:
  Q1 high-arousal positive-valence : excited / happy
  Q2 high-arousal negative-valence : tense / angry
  Q3 low-arousal  negative-valence : depressed / sad
  Q4 low-arousal  positive-valence : calm / relaxed
"""
from __future__ import annotations
from dataclasses import dataclass

from .hrv_processor import HRVMetrics


@dataclass
class AffectClassification:
    arousal: float   # -1..1
    valence: float   # -1..1
    quadrant: str    # one of Q1..Q4


def classify(m: HRVMetrics, rmssd_norm: float) -> AffectClassification:
    # Arousal: high RMSSD → low arousal. Bound to [-1, 1].
    arousal = max(-1.0, min(1.0, 1.0 - 2.0 * rmssd_norm))

    # Valence: SD1/SD2 balance + DFA coherence → positive feeling.
    bal = max(0.0, min(1.0, m.sd1_sd2_ratio / 0.8))
    coh = max(0.0, min(1.0, 1.0 - abs(m.dfa_alpha1 - 1.0) / 0.5))
    valence = 2.0 * (0.6 * bal + 0.4 * coh) - 1.0

    if arousal >= 0 and valence >= 0:
        q = "Q1"
    elif arousal >= 0 and valence < 0:
        q = "Q2"
    elif arousal < 0 and valence < 0:
        q = "Q3"
    else:
        q = "Q4"

    return AffectClassification(arousal=arousal, valence=valence, quadrant=q)
