# backend/session_manager.py
import time
from dataclasses import dataclass, field
from typing import Optional

# Arc phase definitions from Section 12 of master prompt
SESSION_ARCS = {
    "find_your_calm": [
        {"name": "ACKNOWLEDGE", "max_duration": 240,
         "transition": lambda vs, hrv: hrv.get("rmssd_delta", 0) >= 5},
        {"name": "SLOW",        "max_duration": 360,
         # lf_coherence_at_rf absent from HRVMetrics; proxy: LF dominance = lf/(lf+hf) > 0.5
         # indicates LF-band entrainment consistent with resonance-frequency breathing.
         "transition": lambda vs, hrv: (
             hrv.get("lf_power") is not None and hrv.get("hf_power") is not None
             and hrv["lf_power"] / (hrv["lf_power"] + hrv["hf_power"] + 1e-9) > 0.5
             and vs >= 45
         )},
        {"name": "ANCHOR",      "max_duration": 420,
         "transition": lambda vs, hrv: vs >= 65},
        {"name": "RELEASE",     "max_duration": 120,
         "transition": lambda vs, hrv: False},
    ],
    "wind_down": [
        {"name": "MEET",        "max_duration": 300,
         "transition": lambda vs, hrv: False},
        {"name": "DECELERATE",  "max_duration": 420,
         "transition": lambda vs, hrv: hrv.get("dfa_alpha1", 1.0) < 0.80},
        {"name": "DEEPEN",      "max_duration": 780,
         "transition": lambda vs, hrv: hrv.get("dfa_alpha1", 1.0) < 0.75},
        {"name": "DISSOLVE",    "max_duration": 900,
         "transition": lambda vs, hrv: hrv.get("dfa_alpha1", 1.0) < 0.70},
        {"name": "MONITOR",     "max_duration": 99999,
         "transition": lambda vs, hrv: False},
    ],
    "morning_emergence": [
        {"name": "ORIENT",    "max_duration": 240,
         "transition": lambda vs, hrv: vs > 30},
        {"name": "ACTIVATE",  "max_duration": 360,
         "transition": lambda vs, hrv: vs > 50},
        {"name": "ENERGIZE",  "max_duration": 480,
         "transition": lambda vs, hrv: vs >= 60},
        {"name": "PRIME",     "max_duration": 420,
         "transition": lambda vs, hrv: False},
    ],
}

# Backend profile name → frontend session name aliases
SESSION_ARCS["calm"]     = SESSION_ARCS["find_your_calm"]
SESSION_ARCS["recovery"] = SESSION_ARCS["wind_down"]
SESSION_ARCS["energy"]   = SESSION_ARCS["morning_emergence"]


@dataclass
class SessionState:
    session_type: str
    mode: int
    phase_idx: int = 0
    phase_start: float = field(default_factory=time.time)
    session_start: float = field(default_factory=time.time)
    peak_vs: int = 0
    phases_completed: list = field(default_factory=list)
    rmssd_history: list = field(default_factory=list)
    rmssd_delta: float = 0.0


class SessionManager:
    def __init__(self, session_type: str, mode: int):
        self.state = SessionState(session_type=session_type, mode=mode)
        self.arc = SESSION_ARCS.get(session_type, SESSION_ARCS["find_your_calm"])

    def current_phase(self) -> str:
        idx = min(self.state.phase_idx, len(self.arc) - 1)
        return self.arc[idx]["name"]

    def update(self, vs: int, hrv_metrics: dict) -> str:
        self.state.peak_vs = max(self.state.peak_vs, vs)
        rmssd = float(hrv_metrics.get("rmssd", 0))
        self.state.rmssd_history.append(rmssd)
        if len(self.state.rmssd_history) > 4:
            self.state.rmssd_delta = (
                self.state.rmssd_history[-1] - self.state.rmssd_history[-3]
            )

        enriched = {**hrv_metrics, "rmssd_delta": self.state.rmssd_delta}
        phase_def = self.arc[self.state.phase_idx]
        elapsed = time.time() - self.state.phase_start

        should_transition = (
            phase_def["transition"](vs, enriched)
            or elapsed > phase_def["max_duration"]
        )

        if should_transition and self.state.phase_idx < len(self.arc) - 1:
            self.state.phases_completed.append({
                "phase": phase_def["name"],
                "duration_s": round(elapsed),
                "vs_at_exit": vs,
            })
            self.state.phase_idx += 1
            self.state.phase_start = time.time()

        return self.current_phase()

    def skill_transfer_score(self, final_vs: int) -> Optional[float]:
        if self.state.peak_vs == 0:
            return None
        return round(final_vs / self.state.peak_vs, 2)

    def summary(self) -> dict:
        return {
            "session_type": self.state.session_type,
            "mode": self.state.mode,
            "peak_vs": self.state.peak_vs,
            "phases_completed": self.state.phases_completed,
            "duration_s": round(time.time() - self.state.session_start),
        }
