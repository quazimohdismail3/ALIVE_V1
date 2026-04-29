# backend/vs_score.py
import numpy as np

WEIGHTS = {
    "lf_coherence": 0.25,
    "rsa_amplitude": 0.25,
    "rmssd_trajectory": 0.15,
    "dfa_alpha1": 0.15,
    "breath_rsa_lock": 0.10,
    "posture_openness": 0.05,
    "sd2_sd1_ratio": 0.05,
}

VS_COLOR_BANDS = [
    (0, 30, "#E24B4A"),    # SHUTDOWN/ANXIOUS
    (31, 55, "#EF9F27"),   # STRESSED/ACTIVATED
    (56, 75, "#1D9E75"),   # REGULATED
    (76, 100, "#534AB7"),  # FLOW/MEDITATIVE
]


def compute_vs_adaptive(components: dict, mode: int, confidences: dict) -> dict:
    """
    Mode-adaptive VS score. Unavailable components have weight redistributed.
    Returns {"vs": int, "confidence": str, "components_used": list, "mode": int}
    """
    available = {k: v for k, v in components.items() if v is not None}
    if not available:
        return {"vs": 0, "confidence": "LOW", "components_used": [], "mode": mode}

    unavailable_weight = sum(WEIGHTS[k] for k in WEIGHTS if k not in available)
    total_avail = sum(WEIGHTS[k] for k in available)
    adjusted = {
        k: WEIGHTS[k] + WEIGHTS[k] / total_avail * unavailable_weight
        for k in available
    }

    raw = sum(
        adjusted[k] * float(available[k]) * float(confidences.get(k, 1.0))
        for k in available
    )
    vs = int(np.clip(raw * 100, 0, 100))

    overall_conf = sum(float(confidences.get(k, 1.0)) for k in available) / len(available)
    conf_tag = "HIGH" if overall_conf > 0.8 else "MEDIUM" if overall_conf > 0.5 else "LOW"

    return {
        "vs": vs,
        "confidence": conf_tag,
        "components_used": list(available.keys()),
        "mode": mode,
    }


def vs_color(vs: int) -> str:
    for lo, hi, color in VS_COLOR_BANDS:
        if lo <= vs <= hi:
            return color
    return "#1D9E75"
