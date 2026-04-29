# backend/state_classifier.py
# Mode-aware POLYBIO-7 wrapper around existing ANS classifier.
# Mode 2: Axis 2 (valence) unavailable — ANXIOUS/STRESSED collapse to "STRESS".
#
# NOTE: ans_classifier exposes a module-level classify() function (not a class).
# It takes (HRVMetrics, rmssd_norm: float) -> ANSClassification.
# StateClassifier wraps it with a dict-based interface for mode-aware callers.
from __future__ import annotations

from .ans_classifier import classify as _ans_classify
from .hrv_processor import HRVMetrics


class StateClassifier:
    """Mode-aware wrapper around the ANS polyvagal classifier."""

    def classify(self, metrics: HRVMetrics, rmssd_norm: float, mode: int) -> dict:
        """
        Classify ANS state with mode-aware Axis 2 handling.

        Mode 2: Axis 2 (valence) unavailable — anxious_sympathetic collapses
        to a generic "STRESS" label (cannot distinguish anxious vs stressed
        without valence signal).

        Returns {"state": str, "confidence": float, "axis2_available": bool,
                 "actionable": bool, "scores": dict}
        """
        result = _ans_classify(metrics, rmssd_norm)

        state = result.state
        confidence = result.confidence
        axis2_available = mode != 2

        # Mode 2: collapse ANXIOUS/STRESSED disambiguation (requires valence Axis 2)
        # anxious_sympathetic vs healthy_sympathetic distinction needs valence;
        # without it, collapse anxious_sympathetic to the generic "STRESS" label.
        if not axis2_available and state == "anxious_sympathetic":
            state = "STRESS"

        return {
            "state": state,
            "confidence": confidence,
            "axis2_available": axis2_available,
            "actionable": result.actionable,
            "scores": result.scores,
        }
