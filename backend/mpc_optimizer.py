"""Model Predictive Control — candidate generation + forward-model scoring.

Per cycle:
  1. Base params = music_engine.generate_params(state, session)
  2. Generate 12 perturbed candidates
  3. Predict ΔState via forward_model for each
  4. Score = ||predicted_next - target|| + smoothness_penalty * ||Δparams||
  5. Return minimum-score candidate
"""
from __future__ import annotations
import math
import random

from .forward_model import predict_delta
from .music_engine import generate_params
from .state_estimation import StateVector


N_CANDIDATES = 12
SMOOTHNESS_PENALTY = 0.15
_PERTURB_SCALE = {
    "bpm": 4.0,
    "rhythmic_complexity": 0.08,
    "beat_regularity": 0.08,
    "silence_ratio": 0.08,
    "harmonic_tension": 0.08,
    "chord_complexity": 0.08,
    "voice_range_presence": 0.08,
    "brightness": 0.08,
    "roughness": 0.06,
    "warmth": 0.08,
    "spatial_width": 0.08,
    "binaural_beat_hz": 1.5,
    "breath_sync_ratio": 0.08,
    "micro_variation": 0.06,
}
_RNG = random.Random(17)


def _distance(a: StateVector, b: StateVector) -> float:
    return math.sqrt(
        (a.arousal - b.arousal) ** 2
        + (a.valence - b.valence) ** 2
        + (a.stability - b.stability) ** 2
        + (a.coherence - b.coherence) ** 2
        + 0.5 * (a.autonomic_balance - b.autonomic_balance) ** 2
        + 0.5 * (a.recovery_rate - b.recovery_rate) ** 2
    )


def _add_delta(state: StateVector, delta: StateVector) -> StateVector:
    return StateVector(
        arousal=max(0.0, min(1.0, state.arousal + delta.arousal)),
        valence=max(-1.0, min(1.0, state.valence + delta.valence)),
        stability=max(0.0, min(1.0, state.stability + delta.stability)),
        coherence=max(0.0, min(1.0, state.coherence + delta.coherence)),
        autonomic_balance=max(0.0, state.autonomic_balance + delta.autonomic_balance),
        recovery_rate=max(-1.0, min(1.0, state.recovery_rate + delta.recovery_rate)),
        rmssd_norm=state.rmssd_norm,
    )


def _params_distance(a: dict, b: dict) -> float:
    d = 0.0
    for k, scale in _PERTURB_SCALE.items():
        d += ((a.get(k, 0) - b.get(k, 0)) / scale) ** 2
    return math.sqrt(d)


def _perturb(base: dict) -> dict:
    out = dict(base)
    for k, scale in _PERTURB_SCALE.items():
        if k in out:
            out[k] = out[k] + _RNG.gauss(0, scale)
    # Clamp all 0..1 params
    for k in (
        "rhythmic_complexity", "beat_regularity", "silence_ratio",
        "harmonic_tension", "chord_complexity", "voice_range_presence",
        "brightness", "roughness", "warmth", "spatial_width",
        "breath_sync_ratio", "micro_variation",
    ):
        out[k] = max(0.0, min(1.0, out[k]))
    out["bpm"] = max(50.0, min(140.0, out["bpm"]))
    out["binaural_beat_hz"] = max(0.0, min(30.0, out["binaural_beat_hz"]))
    return out


def optimize(
    state: StateVector,
    target: StateVector,
    session: str,
    prev_params: dict | None = None,
) -> tuple[dict, str, float]:
    """Return (best_params, strategy, score)."""
    base, strategy = generate_params(state, session)
    candidates = [base] + [_perturb(base) for _ in range(N_CANDIDATES - 1)]

    best = None
    best_score = float("inf")
    for c in candidates:
        delta = predict_delta(c, state)
        predicted = _add_delta(state, delta)
        err = _distance(predicted, target)
        smooth = 0.0 if prev_params is None else _params_distance(c, prev_params)
        score = err + SMOOTHNESS_PENALTY * smooth
        if score < best_score:
            best_score = score
            best = c

    assert best is not None
    return best, strategy, best_score
