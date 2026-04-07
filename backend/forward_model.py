"""Forward model — predict the physiological response to a music param set.

Used by MPC to score candidate parameter sets without waiting for real
HRV measurements. Returns predicted *delta* state vector for one cycle.

Mappings are linear-in-params with bounded magnitudes — calibrated against
intended music-physiology relationships from the V1 spec. They are NOT
high-fidelity; they are good enough for ranking candidates.
"""
from __future__ import annotations

from .state_estimation import StateVector


# Per-cycle effect coefficients. Each entry: (param, dim, magnitude).
# Magnitude is the per-cycle delta when the param is at its max value.
_EFFECTS = [
    # bpm: high → arousal up, stability down (low rmssd)
    ("bpm",                 "arousal",          +0.04),
    ("bpm",                 "stability",        -0.02),
    # silence_ratio: more silence → calmer
    ("silence_ratio",       "arousal",          -0.05),
    ("silence_ratio",       "coherence",        +0.02),
    # harmonic_tension → arousal
    ("harmonic_tension",    "arousal",          +0.03),
    ("harmonic_tension",    "valence",          -0.02),
    # warmth → valence + stability
    ("warmth",              "valence",          +0.03),
    ("warmth",              "stability",        +0.02),
    # brightness → arousal up
    ("brightness",          "arousal",          +0.025),
    # binaural_beat_hz: low (delta/theta) → calming, high (beta) → activating
    ("binaural_beat_hz",    "arousal",          +0.0015),  # per Hz
    # spatial_width → coherence + stability
    ("spatial_width",       "coherence",        +0.015),
    ("spatial_width",       "stability",        +0.01),
    # micro_variation → recovery_rate (variability promotes parasympathetic)
    ("micro_variation",     "recovery_rate",    +0.04),
    ("micro_variation",     "coherence",        +0.015),
    # breath_sync_ratio → autonomic_balance + valence
    ("breath_sync_ratio",   "autonomic_balance", +0.04),
    ("breath_sync_ratio",   "valence",          +0.02),
    # rhythmic_complexity → arousal + (negative) stability
    ("rhythmic_complexity", "arousal",          +0.03),
    ("rhythmic_complexity", "stability",        -0.02),
    # voice_range_presence → valence
    ("voice_range_presence", "valence",         +0.025),
    # roughness → arousal up, valence down
    ("roughness",           "arousal",          +0.025),
    ("roughness",           "valence",          -0.03),
]


def _norm(param_name: str, value: float) -> float:
    """Normalize each param into 0..1 for linear summation."""
    if param_name == "bpm":
        return max(0.0, min(1.0, (value - 50) / 80))   # 50..130 bpm
    if param_name == "binaural_beat_hz":
        return max(0.0, min(1.0, value / 30.0))          # 0..30Hz
    if param_name == "soma_carrier_hz":
        return max(0.0, min(1.0, (value - 30) / 100))   # 30..130Hz
    return max(0.0, min(1.0, float(value)))               # 0..1 native


def predict_delta(params: dict, current: StateVector) -> StateVector:
    """Return a StateVector representing the predicted ΔState for one cycle."""
    delta = {
        "arousal": 0.0, "valence": 0.0, "stability": 0.0,
        "coherence": 0.0, "autonomic_balance": 0.0, "recovery_rate": 0.0,
    }
    for pname, dim, mag in _EFFECTS:
        v = params.get(pname, 0.0)
        delta[dim] += mag * _norm(pname, v)

    # Diminishing returns near edges
    for dim in delta:
        cur = getattr(current, dim)
        if delta[dim] > 0:
            headroom = max(0.0, 1.0 - cur)
            delta[dim] *= headroom
        else:
            headroom = max(0.0, cur - (-1.0 if dim == "valence" else 0.0))
            delta[dim] *= headroom

    return StateVector(
        arousal=delta["arousal"],
        valence=delta["valence"],
        stability=delta["stability"],
        coherence=delta["coherence"],
        autonomic_balance=delta["autonomic_balance"],
        recovery_rate=delta["recovery_rate"],
        rmssd_norm=current.rmssd_norm,
    )
