"""HRV Simulator — 6 session-specific physiological profiles.

Generates plausible RR intervals (ms) reflecting the autonomic state expected
during each session type. Each profile has phases (e.g., onset, plateau, taper)
so the simulator can be used to validate the closed loop end-to-end.

Usage:
    sim = HRVSimulator("calm")
    for _ in range(120):
        rr = sim.next_rr()    # one RR interval (ms)
        time.sleep(rr / 1000) # real-time pacing if needed
"""
from __future__ import annotations
import math
import random
from dataclasses import dataclass, field
from typing import Iterator


@dataclass
class Phase:
    name: str
    duration_s: float
    target_rmssd: float       # ms
    target_hr: float          # bpm
    sympathetic_drive: float  # 0..1, modulates SVI
    noise_ms: float = 8.0     # gaussian RR jitter


PROFILES: dict[str, list[Phase]] = {
    # Calm — settle into ventral vagal. RMSSD rises, HR drops, low symp.
    "calm": [
        Phase("settling", 90, target_rmssd=55, target_hr=72, sympathetic_drive=0.35, noise_ms=10),
        Phase("entering", 180, target_rmssd=78, target_hr=64, sympathetic_drive=0.2),
        Phase("regulated", 330, target_rmssd=95, target_hr=58, sympathetic_drive=0.1, noise_ms=6),
    ],
    # Energy — healthy sympathetic, mobilized but not anxious.
    "energy": [
        Phase("warmup", 60, target_rmssd=60, target_hr=72, sympathetic_drive=0.4),
        Phase("ramp", 180, target_rmssd=55, target_hr=88, sympathetic_drive=0.6),
        Phase("plateau", 240, target_rmssd=52, target_hr=96, sympathetic_drive=0.65),
        Phase("cooldown", 120, target_rmssd=70, target_hr=76, sympathetic_drive=0.4),
    ],
    # Focus — sustained mid sympathetic, low SVI (clean attention).
    "focus": [
        Phase("settle", 60, target_rmssd=65, target_hr=70, sympathetic_drive=0.3),
        Phase("engaged", 480, target_rmssd=58, target_hr=78, sympathetic_drive=0.45, noise_ms=5),
        Phase("release", 60, target_rmssd=80, target_hr=66, sympathetic_drive=0.2),
    ],
    # Recovery — rapid parasympathetic restoration after exertion.
    "recovery": [
        Phase("post_load", 60, target_rmssd=42, target_hr=92, sympathetic_drive=0.55),
        Phase("opening", 240, target_rmssd=70, target_hr=70, sympathetic_drive=0.3),
        Phase("restored", 300, target_rmssd=98, target_hr=58, sympathetic_drive=0.12, noise_ms=6),
    ],
    # Presence — slow, stable, high coherence (DFA-friendly).
    "presence": [
        Phase("arrive", 120, target_rmssd=70, target_hr=66, sympathetic_drive=0.25),
        Phase("deepen", 240, target_rmssd=88, target_hr=60, sympathetic_drive=0.15, noise_ms=5),
        Phase("still", 240, target_rmssd=100, target_hr=56, sympathetic_drive=0.1, noise_ms=4),
    ],
    # ADHD Flow — sustained mid sympathetic, novelty injection (handled by engine).
    "adhd_flow": [
        Phase("anchor", 60, target_rmssd=55, target_hr=78, sympathetic_drive=0.5),
        Phase("flow", 540, target_rmssd=58, target_hr=82, sympathetic_drive=0.5, noise_ms=7),
    ],
}

# Frontend session name → backend profile aliases
PROFILES["find_your_calm"] = PROFILES["calm"]
PROFILES["wind_down"]      = PROFILES["recovery"]
PROFILES["morning_emergence"] = PROFILES["energy"]


class HRVSimulator:
    """Generates RR intervals for a chosen session profile."""

    def __init__(self, profile: str = "calm", seed: int | None = None):
        if profile not in PROFILES:
            raise ValueError(f"Unknown profile {profile!r}. Options: {list(PROFILES)}")
        self.profile_name = profile
        self.phases = PROFILES[profile]
        self.rng = random.Random(seed)
        self.t = 0.0  # elapsed seconds since start
        self._tick = 0  # beat counter for alternating perturbation

    # --- public API
    def next_rr(self) -> float:
        """Return one RR interval in ms, advancing internal time."""
        phase = self._current_phase()
        rr_mean = 60_000.0 / phase.target_hr  # ms

        # Beat-to-beat parasympathetic perturbation. RMSSD math:
        #   if RR_i = μ + ε_i with ε ~ N(0, σ²) iid, then
        #   RMSSD = std(diff(RR)) = σ·√2  →  σ = RMSSD/√2.
        # So drawing ε from N(0, target_rmssd/√2) produces measured RMSSD ≈ target.
        sigma = phase.target_rmssd / math.sqrt(2)
        para = self.rng.gauss(0, sigma)
        # Slow respiratory modulation of mean RR (cosmetic — does not drive RMSSD)
        resp = 6.0 * math.sin(2 * math.pi * (self.t / 4.0))
        # LF drift modulated by sympathetic drive
        lf = phase.sympathetic_drive * 10 * math.sin(2 * math.pi * (self.t / 12.0))
        # Background noise floor (sensor jitter)
        sensor = self.rng.gauss(0, phase.noise_ms * 0.3)
        self._tick += 1

        rr = rr_mean + para + resp + lf + sensor
        rr = max(300.0, min(2000.0, rr))  # physiological clamp
        self.t += rr / 1000.0
        return rr

    def stream(self, n: int) -> Iterator[float]:
        for _ in range(n):
            yield self.next_rr()

    def reset(self) -> None:
        self.t = 0.0
        self._tick = 0

    # --- internal
    def _current_phase(self) -> Phase:
        elapsed = 0.0
        for p in self.phases:
            elapsed += p.duration_s
            if self.t < elapsed:
                return p
        return self.phases[-1]


if __name__ == "__main__":
    # Quick smoke test
    for name in PROFILES:
        sim = HRVSimulator(name, seed=42)
        rrs = list(sim.stream(60))
        mean_rr = sum(rrs) / len(rrs)
        print(f"{name:10s}  mean_RR={mean_rr:6.1f}ms  HR≈{60000/mean_rr:5.1f}bpm  n={len(rrs)}")
