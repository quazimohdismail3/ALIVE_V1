"""Mission Alive â€” central config. All env vars loaded here only."""
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _get(key: str, default: str | None = None) -> str | None:
    return os.environ.get(key, default)


def _getf(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


# --- Database
DATABASE_URL = _get("DATABASE_URL", "sqlite:///./mission_alive.db")

# --- Personal RMSSD baseline (used by state_estimation.normalize)
PERSONAL_RMSSD_MIN = _getf("PERSONAL_RMSSD_MIN", 52.0)
PERSONAL_RMSSD_MAX = _getf("PERSONAL_RMSSD_MAX", 122.0)
PERSONAL_RMSSD_MEAN = _getf("PERSONAL_RMSSD_MEAN", 88.0)

# --- WHOOP
WHOOP_CLIENT_ID = _get("WHOOP_CLIENT_ID", "")
WHOOP_CLIENT_SECRET = _get("WHOOP_CLIENT_SECRET", "")  # [env] no default - set in .env
WHOOP_REDIRECT_URI = _get("WHOOP_REDIRECT_URI", "http://localhost:8000/whoop/callback")

# --- Spotify
SPOTIFY_CLIENT_ID = _get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = _get("SPOTIFY_CLIENT_SECRET", "")  # [env] no default - set in .env

# --- Gemini (V1: stubbed, not required)
GEMINI_API_KEY = _get("GEMINI_API_KEY", "")

# --- Control loop
CONTROL_HZ = 1.0  # 1 Hz cycle
EMA_ALPHA = 0.2
KP = 0.15
KD = 0.8
CONFIDENCE_GATE = 0.75
RMSSD_DELTA_THRESHOLD = 5.0  # ms
STATE_CHANGE_CONFIRM_CYCLES = 2
MIN_RR_FOR_METRICS = 15
PARAM_RAMP_MS = 2000

# --- Safety thresholds
SAFETY_RMSSD_LOW = 15.0
SAFETY_RMSSD_HIGH = 200.0
SAFETY_STATE_DELTA_MAX = 0.4
SAFETY_LOW_CYCLES = 3
