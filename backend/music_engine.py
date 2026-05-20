"""Music Engine — 16 parameter generation.

Strategy A (deterministic): nonlinear mapping from StateVector + session → 16 params.
Strategy B (Gemini): stubbed in V1, falls through to A via gemini_mapper.

Critical bugs to never reintroduce:
  - Tempo direction: low RMSSD → SLOWER tempo (not faster)
  - Binaural L=lower, R=higher (enforced at audio engine, not here)
  - Dorian ratio 1.414 tritone excluded (enforced in frontend scale)
"""
from __future__ import annotations

from . import gemini_mapper
from .state_estimation import StateVector


PARAM_NAMES = (
    # Tier 1 Temporal
    "bpm", "rhythmic_complexity", "beat_regularity", "silence_ratio",
    # Tier 2 Harmonic
    "key_mode", "harmonic_tension", "chord_complexity", "voice_range_presence",
    # Tier 3 Timbral
    "brightness", "roughness", "warmth", "spatial_width",
    # Tier 4 Biological
    "soma_carrier_hz", "binaural_beat_hz", "breath_sync_ratio", "micro_variation",
)


def _strategy_a(state: StateVector, session: str, affect_quadrant: str | None = None) -> dict:
    a = state.arousal
    v = state.valence
    st = state.stability
    co = state.coherence
    rm = state.rmssd_norm

    # --- Tier 1 Temporal
    # LOW RMSSD → SLOWER tempo (spec fix — not the opposite)
    bpm = 60 + rm * 40 + a * 10          # 60..110
    rhythmic_complexity = 0.2 + a * 0.5
    beat_regularity = 0.5 + st * 0.5
    silence_ratio = 0.6 - a * 0.5

    # --- Tier 2 Harmonic
    key_mode = 1 if v >= 0.0 else 0       # 0=minor, 1=major, 2=lydian
    if session == "presence":
        key_mode = 2
    harmonic_tension = max(0.0, min(1.0, 0.3 + (1.0 - st) * 0.5))
    chord_complexity = 0.2 + co * 0.5
    voice_range_presence = 0.3 + (1.0 - a) * 0.4

    # --- Tier 3 Timbral
    brightness = 0.3 + a * 0.5
    roughness = max(0.0, (1.0 - v) * 0.3)
    warmth = 0.4 + (1.0 - a) * 0.4
    spatial_width = 0.4 + co * 0.5

    # --- Tier 4 Biological
    # SOMA carrier: 40Hz entrainment (focus) → 60Hz relaxation → 52Hz neutral
    if session in ("focus", "adhd_flow"):
        soma_carrier_hz = 40.0
    elif session in ("calm", "recovery", "presence"):
        soma_carrier_hz = 60.0
    else:
        soma_carrier_hz = 52.0

    # Binaural: low arousal → theta (6Hz), mid → alpha (10Hz), high → beta (18Hz)
    if a < 0.35:
        binaural_beat_hz = 4.0 + a * 6.0      # 4..6 delta/theta
    elif a < 0.7:
        binaural_beat_hz = 8.0 + (a - 0.35) * 8.0  # 8..12 alpha
    else:
        binaural_beat_hz = 14.0 + (a - 0.7) * 16.0  # 14..20 beta

    breath_sync_ratio = 0.5 + st * 0.4
    micro_variation = 0.1 + co * 0.3

    # --- Affect quadrant layer (on top of ANS layer; Q4 = nominal, no adjustment)
    if affect_quadrant == "Q3":
        # Low arousal, negative valence (depressed/sad) → warmth + gradual uplift
        warmth = min(1.0, warmth + 0.2)
        brightness = min(1.0, brightness + 0.1)
        silence_ratio = max(0.0, silence_ratio - 0.1)
        key_mode = 1  # force major
    elif affect_quadrant == "Q2":
        # High arousal, negative valence (tense/angry) → grounding
        harmonic_tension = max(0.0, harmonic_tension - 0.2)
        beat_regularity = min(1.0, beat_regularity + 0.2)
        rhythmic_complexity = max(0.0, rhythmic_complexity - 0.2)
    elif affect_quadrant == "Q1":
        # High arousal, positive valence (excited) → reduce arousal gently
        silence_ratio = min(1.0, silence_ratio + 0.05)

    return dict(
        bpm=round(float(bpm), 2),
        rhythmic_complexity=round(float(rhythmic_complexity), 3),
        beat_regularity=round(float(beat_regularity), 3),
        silence_ratio=round(float(max(0.0, silence_ratio)), 3),
        key_mode=int(key_mode),
        harmonic_tension=round(float(harmonic_tension), 3),
        chord_complexity=round(float(chord_complexity), 3),
        voice_range_presence=round(float(voice_range_presence), 3),
        brightness=round(float(brightness), 3),
        roughness=round(float(roughness), 3),
        warmth=round(float(warmth), 3),
        spatial_width=round(float(spatial_width), 3),
        soma_carrier_hz=round(float(soma_carrier_hz), 2),
        binaural_beat_hz=round(float(binaural_beat_hz), 2),
        breath_sync_ratio=round(float(breath_sync_ratio), 3),
        micro_variation=round(float(micro_variation), 3),
    )


def generate_params(state: StateVector, session: str, affect_quadrant: str | None = None) -> tuple[dict, str]:
    """Return (params, strategy). V1 always resolves to Strategy A."""
    b = gemini_mapper.map_state_to_params(state, session)
    if b is not None:
        return b, "B"
    return _strategy_a(state, session, affect_quadrant=affect_quadrant), "A"
