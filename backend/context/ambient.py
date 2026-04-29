# backend/context/ambient.py
# Placeholder ambient context — Ambient Light API not available server-side.
# Returns neutral scores. Frontend fills via WS sensor_update.

def get_ambient_context() -> dict:
    return {
        "ambient_score": 0.5,  # neutral until frontend provides
        "noise_proxy": 0.5,
    }
