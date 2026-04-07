"""Second-order control dynamics for state trajectory.

Proportional-derivative controller with damping to prevent oscillation.
Per cycle (dt = 1s):
    error        = target - current
    acceleration = Kp * error - Kd * velocity
    velocity    += acceleration * dt
    new_state    = current + velocity * dt
"""
from __future__ import annotations
import numpy as np

from .config import KD, KP
from .state_estimation import StateVector


_DIMS = 6  # arousal, valence, stability, coherence, autonomic_balance, recovery_rate


class StateDynamics:
    def __init__(self, kp: float = KP, kd: float = KD):
        self.kp = kp
        self.kd = kd
        self.velocity = np.zeros(_DIMS)

    def step(
        self,
        current: StateVector,
        target: StateVector,
        dt: float = 1.0,
    ) -> StateVector:
        cur = np.array(current.as_tuple())
        tgt = np.array(target.as_tuple())
        error = tgt - cur
        acc = self.kp * error - self.kd * self.velocity
        self.velocity = self.velocity + acc * dt
        new = cur + self.velocity * dt

        # Clamp dimensions
        new[0] = np.clip(new[0], 0.0, 1.0)   # arousal
        new[1] = np.clip(new[1], -1.0, 1.0)  # valence
        new[2] = np.clip(new[2], 0.0, 1.0)   # stability
        new[3] = np.clip(new[3], 0.0, 1.0)   # coherence
        new[4] = np.clip(new[4], 0.0, 3.0)   # SD1/SD2 ratio
        new[5] = np.clip(new[5], -1.0, 1.0)  # recovery_rate

        return StateVector(
            arousal=float(new[0]),
            valence=float(new[1]),
            stability=float(new[2]),
            coherence=float(new[3]),
            autonomic_balance=float(new[4]),
            recovery_rate=float(new[5]),
            rmssd_norm=current.rmssd_norm,
        )

    def reset(self) -> None:
        self.velocity = np.zeros(_DIMS)
