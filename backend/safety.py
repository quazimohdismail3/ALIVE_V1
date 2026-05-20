"""Safety supervisor — abnormal HRV detection + safe fallback.

Triggers safe fallback when:
  - RMSSD < 15ms for 3 consecutive cycles (severe parasympathetic collapse)
  - RMSSD > 200ms (artifact or sensor error)
  - State vector changes > 0.4 in any dim in one cycle (instability)

Safe fallback music params:
  - SOMA carrier 52Hz, BPM 60, silence-rich, no binaural
"""
from __future__ import annotations
from dataclasses import dataclass

from .config import (
    SAFETY_LOW_CYCLES,
    SAFETY_RMSSD_HIGH,
    SAFETY_RMSSD_LOW,
    SAFETY_STATE_DELTA_MAX,
)
from .hrv_processor import HRVMetrics
from .state_estimation import StateVector


SAFE_FALLBACK_PARAMS = {
    "bpm": 60.0,
    "rhythmic_complexity": 0.0,
    "beat_regularity": 1.0,
    "silence_ratio": 0.7,
    "key_mode": 0,
    "harmonic_tension": 0.0,
    "chord_complexity": 0.0,
    "voice_range_presence": 0.0,
    "brightness": 0.2,
    "roughness": 0.0,
    "warmth": 0.9,
    "spatial_width": 0.4,
    "soma_carrier_hz": 52.0,
    "binaural_carrier_hz": 432.0,
    "binaural_beat_hz": 0.0,
    "breath_sync_ratio": 0.5,
    "micro_variation": 0.05,
}


@dataclass
class SafetyStatus:
    safe: bool
    reason: str | None
    fallback_active: bool


class SafetySupervisor:
    def __init__(self):
        self.low_count = 0
        self.prev_state: StateVector | None = None
        self.fallback_active = False

    def check(self, m: HRVMetrics, state: StateVector) -> SafetyStatus:
        reason: str | None = None

        if m.rmssd > SAFETY_RMSSD_HIGH:
            reason = f"rmssd>{SAFETY_RMSSD_HIGH} (artifact)"
        elif m.rmssd < SAFETY_RMSSD_LOW:
            self.low_count += 1
            if self.low_count >= SAFETY_LOW_CYCLES:
                reason = f"rmssd<{SAFETY_RMSSD_LOW} for {self.low_count} cycles"
        else:
            self.low_count = 0

        if reason is None and self.prev_state is not None:
            deltas = [
                abs(a - b)
                for a, b in zip(state.as_tuple(), self.prev_state.as_tuple())
            ]
            if max(deltas) > SAFETY_STATE_DELTA_MAX:
                reason = f"state delta {max(deltas):.2f} > {SAFETY_STATE_DELTA_MAX}"

        self.prev_state = state
        self.fallback_active = reason is not None
        return SafetyStatus(
            safe=reason is None,
            reason=reason,
            fallback_active=self.fallback_active,
        )

    def reset(self) -> None:
        self.low_count = 0
        self.prev_state = None
        self.fallback_active = False
