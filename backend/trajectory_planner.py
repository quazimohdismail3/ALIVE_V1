"""Trajectory planner — nonlinear paths from current → target state.

NEVER use linear interpolation. Trajectories follow biological easing curves
appropriate to the session type:
  - calm/recovery/presence: ease-out (fast initial movement, slow approach)
  - energy/adhd_flow:       ease-in-out with phase plateaus
  - focus:                  smoothstep (sigmoidal)

The planner returns the *next intermediate target* one cycle ahead — the
state_dynamics PD controller then steers toward it.
"""
from __future__ import annotations
from dataclasses import dataclass
import math

from .state_estimation import StateVector


# Target state vectors per session type — ideal end-state
SESSION_TARGETS: dict[str, dict[str, float]] = {
    "calm": dict(
        arousal=0.15, valence=0.75, stability=0.85, coherence=0.9,
        autonomic_balance=0.75, recovery_rate=0.2,
    ),
    "energy": dict(
        arousal=0.75, valence=0.7, stability=0.7, coherence=0.85,
        autonomic_balance=0.55, recovery_rate=0.0,
    ),
    "focus": dict(
        arousal=0.6, valence=0.55, stability=0.95, coherence=0.95,
        autonomic_balance=0.6, recovery_rate=0.0,
    ),
    "recovery": dict(
        arousal=0.1, valence=0.8, stability=0.85, coherence=0.9,
        autonomic_balance=0.8, recovery_rate=0.5,
    ),
    "presence": dict(
        arousal=0.2, valence=0.7, stability=0.95, coherence=0.95,
        autonomic_balance=0.7, recovery_rate=0.1,
    ),
    "adhd_flow": dict(
        arousal=0.65, valence=0.65, stability=0.85, coherence=0.9,
        autonomic_balance=0.6, recovery_rate=0.0,
    ),
}


def _ease_out(t: float) -> float:
    return 1.0 - (1.0 - t) ** 3


def _ease_in_out(t: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * t)


def _smoothstep(t: float) -> float:
    return t * t * (3 - 2 * t)


_CURVES = {
    "calm": _ease_out,
    "recovery": _ease_out,
    "presence": _ease_out,
    "energy": _ease_in_out,
    "adhd_flow": _ease_in_out,
    "focus": _smoothstep,
}


@dataclass
class Trajectory:
    session: str
    duration_s: float
    start: StateVector

    def target_at(self, elapsed_s: float) -> StateVector:
        t = max(0.0, min(1.0, elapsed_s / max(self.duration_s, 1.0)))
        curve = _CURVES.get(self.session, _ease_in_out)
        progress = curve(t)

        end = SESSION_TARGETS.get(self.session, SESSION_TARGETS["calm"])
        s = self.start

        def lerp(a: float, b: float) -> float:
            return a + progress * (b - a)

        return StateVector(
            arousal=lerp(s.arousal, end["arousal"]),
            valence=lerp(s.valence, end["valence"]),
            stability=lerp(s.stability, end["stability"]),
            coherence=lerp(s.coherence, end["coherence"]),
            autonomic_balance=lerp(s.autonomic_balance, end["autonomic_balance"]),
            recovery_rate=lerp(s.recovery_rate, end["recovery_rate"]),
            rmssd_norm=s.rmssd_norm,
        )

    def final_target(self) -> StateVector:
        return self.target_at(self.duration_s)
