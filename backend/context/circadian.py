# backend/context/circadian.py
from datetime import datetime
from zoneinfo import ZoneInfo

CIRCADIAN_PHASES = {
    "MORNING_RISE":    (6, 9),
    "PEAK":            (9, 12),
    "POST_LUNCH_DIP":  (13, 15),
    "AFTERNOON_PEAK":  (15, 18),
    "EVENING_WIND":    (18, 21),
    "NIGHT":           (21, 6),
}

SESSION_CIRCADIAN_FIT = {
    "find_your_calm": {
        "MORNING_RISE": 0.9, "PEAK": 0.7, "POST_LUNCH_DIP": 1.0,
        "AFTERNOON_PEAK": 0.7, "EVENING_WIND": 0.8, "NIGHT": 0.5,
    },
    "wind_down": {
        "EVENING_WIND": 1.0, "NIGHT": 1.0, "POST_LUNCH_DIP": 0.7,
        "AFTERNOON_PEAK": 0.3, "PEAK": 0.2, "MORNING_RISE": 0.1,
    },
    "morning_emergence": {
        "MORNING_RISE": 1.0, "PEAK": 0.5, "POST_LUNCH_DIP": 0.2,
        "AFTERNOON_PEAK": 0.2, "EVENING_WIND": 0.1, "NIGHT": 0.1,
    },
}


def get_circadian_context(user_timezone: str = "UTC") -> dict:
    try:
        now = datetime.now(ZoneInfo(user_timezone))
    except Exception:
        now = datetime.now(ZoneInfo("UTC"))
    hour = now.hour + now.minute / 60.0
    phase = next(
        (p for p, (start, end) in CIRCADIAN_PHASES.items()
         if (start <= hour < end) or (start > end and (hour >= start or hour < end))),
        "NIGHT",
    )
    return {
        "phase": phase,
        "hour": hour,
        "circadian_score": _phase_score(hour),
    }


def session_circadian_fit(session_id: str, phase: str) -> float:
    return SESSION_CIRCADIAN_FIT.get(session_id, {}).get(phase, 0.5)


def _phase_score(hour: float) -> float:
    if 6 <= hour < 9:   return 0.5 + (hour - 6) / 6
    if 9 <= hour < 12:  return 0.9
    if 12 <= hour < 13: return 0.7
    if 13 <= hour < 15: return 0.4
    if 15 <= hour < 18: return 0.8
    if 18 <= hour < 21: return 0.5
    return 0.2
