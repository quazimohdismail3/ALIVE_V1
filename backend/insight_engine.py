"""Session-end insight generation.

Rule-based, 14 conditions per spec. Each rule maps observed metrics
to a short second-person insight in Mission Alive's voice.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass
class SessionSummary:
    session: str
    duration_s: float
    rmssd_start: float
    rmssd_end: float
    arousal_start: float
    arousal_end: float
    dominant_state: str
    fallback_triggered: bool
    sensor_mode: str


def generate_insight(s: SessionSummary) -> str:
    d_rm = s.rmssd_end - s.rmssd_start
    d_ar = s.arousal_end - s.arousal_start
    pct = (d_rm / max(s.rmssd_start, 1)) * 100

    # 1. safety fallback
    if s.fallback_triggered:
        return "Your body asked for an anchor today. We held one. That was the right thing."

    # 2. large RMSSD gain
    if d_rm >= 20:
        return "Your nervous system opened. RMSSD lifted meaningfully — that's a real shift."

    # 3. moderate gain
    if d_rm >= 10:
        return "You moved toward regulation. The parasympathetic came online."

    # 4. small gain
    if d_rm >= 5:
        return "Small but real. Your body found its way closer."

    # 5. arousal drop (calm-family)
    if s.session in ("calm", "recovery", "presence") and d_ar <= -0.15:
        return "Arousal dropped. You let go of something you'd been holding."

    # 6. arousal rise (energy-family)
    if s.session in ("energy", "adhd_flow") and d_ar >= 0.15:
        return "Clean activation. You mobilized without the alarm."

    # 7. focus sustained
    if s.session == "focus" and abs(d_ar) < 0.1 and d_rm > -5:
        return "You held the line. Attention stayed — no drift, no crash."

    # 8. no change
    if abs(d_rm) < 3 and abs(d_ar) < 0.08:
        return "Nothing dramatic today. Showing up is the practice."

    # 9. RMSSD loss
    if d_rm <= -15:
        return "Your system pushed back today. That's information — notice what came up."

    # 10. dominant dorsal
    if s.dominant_state == "dorsal_vagal":
        return "Deep stillness. Your body chose rest over response."

    # 11. dominant ventral
    if s.dominant_state == "ventral_vagal":
        return "Ventral vagal — the state that makes connection possible. You were here."

    # 12. dominant anxious
    if s.dominant_state == "anxious_sympathetic":
        return "Alarm bells ran. The music met you there — what changed?"

    # 13. burnout
    if s.dominant_state == "burnout_rigidity":
        return "Low variability all session. Consistency matters more than intensity today."

    # 14. default
    return f"Session complete. ΔRMSSD {d_rm:+.1f}ms ({pct:+.0f}%)."
