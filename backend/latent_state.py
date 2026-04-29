# backend/latent_state.py
# Phase 1: deterministic feature → 4D latent mapping.
# Phase 2: replace compute() with JEPA encoder forward pass.
# Interface contract is frozen. Never change the return signature.
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class LatentStateVector:
    # Axis 1 — Polyvagal
    arousal: float
    coherence: float
    stability: float
    regulationCapacity: float
    # Axis 2 — Valence-Arousal (NULL in Mode 2)
    valence: Optional[float]
    stressIndex: float
    # Axis 3 — DMN/TPN
    cognitiveLoad: float
    fatigue: float
    # Axis 4 — Circadian
    circadianAlignment: float
    environmentalComfort: float
    # Meta
    respiratoryQuality: float
    adaptationRate: float
    confidenceScore: float
    activeModalities: list = field(default_factory=list)


class LatentStateExtractor:
    def compute(self, hrv_metrics: dict, face_features: dict,
                pose_features: dict, context: dict, mode: int) -> LatentStateVector:
        arousal = self._hrv_to_arousal(hrv_metrics)
        coherence = float(hrv_metrics.get("lf_coherence_at_rf", 0.0))
        stability = self._rmssd_stability(hrv_metrics)
        regulation_capacity = self._sd_ratio(hrv_metrics)
        valence = self._face_valence(face_features) if mode != 2 else None
        stress_index = float(hrv_metrics.get("sympathetic_volatility_norm", 0.5))
        cognitive_load = self._sampen_tpn(hrv_metrics)
        fatigue = self._fatigue_proxy(hrv_metrics, face_features, mode)
        circadian_alignment = float(context.get("circadian_score", 0.5))
        env_comfort = float(context.get("ambient_score", 0.5))
        resp_quality = float(hrv_metrics.get("rsa_amplitude_norm", 0.5))
        adaptation_rate = float(hrv_metrics.get("rmssd_velocity_norm", 0.5))
        confidence = self._confidence(hrv_metrics, mode)
        return LatentStateVector(
            arousal=arousal, coherence=coherence, stability=stability,
            regulationCapacity=regulation_capacity, valence=valence,
            stressIndex=stress_index, cognitiveLoad=cognitive_load,
            fatigue=fatigue, circadianAlignment=circadian_alignment,
            environmentalComfort=env_comfort, respiratoryQuality=resp_quality,
            adaptationRate=adaptation_rate, confidenceScore=confidence,
            activeModalities=self._active_modalities(mode, face_features, pose_features),
        )

    def _hrv_to_arousal(self, hrv: dict) -> float:
        rmssd = float(hrv.get("rmssd", 40.0))
        return float(max(0.0, min(1.0, 1.0 - (rmssd - 10) / 90)))

    def _rmssd_stability(self, hrv: dict) -> float:
        rmssd_var = float(hrv.get("rmssd_variance", 100.0))
        return float(max(0.0, min(1.0, 1.0 - rmssd_var / 500)))

    def _sd_ratio(self, hrv: dict) -> float:
        sd1 = float(hrv.get("sd1", 20.0))
        sd2 = float(hrv.get("sd2", 40.0))
        return float(min(1.0, (sd2 / (sd1 + 1e-9)) / 4.0))

    def _face_valence(self, face: dict) -> Optional[float]:
        if not face:
            return None
        return float(face.get("valence_proxy", 0.0))

    def _sampen_tpn(self, hrv: dict) -> float:
        sampen = float(hrv.get("sample_entropy", 1.0))
        return float(max(0.0, min(1.0, 1.0 - sampen / 2.5)))

    def _fatigue_proxy(self, hrv: dict, face: dict, mode: int) -> float:
        ear = float(face.get("ear", 0.3)) if face and mode != 2 else 0.3
        rmssd_drop = float(hrv.get("rmssd_drop_rate", 0.0))
        ear_fatigue = max(0.0, 1.0 - ear / 0.3)
        return float(min(1.0, (ear_fatigue + rmssd_drop) / 2))

    def _confidence(self, hrv: dict, mode: int) -> float:
        base = {1: 0.65, 2: 0.90, 3: 0.95}.get(mode, 0.75)
        signal_q = float(hrv.get("signal_quality", 1.0))
        return float(base * signal_q)

    def _active_modalities(self, mode: int, face: dict, pose: dict) -> list:
        mods = ["circadian"]
        if mode in (2, 3): mods.append("h10")
        if mode in (1, 3): mods.append("rppg")
        if face and mode != 2: mods.append("facemesh")
        if pose and mode != 2: mods.append("pose")
        mods.append("mic")
        return mods
