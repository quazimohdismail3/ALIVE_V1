# Spec: RR-Derived RF Measurement + Biofeedback Mirror

**Date:** 2026-05-06  
**Status:** Approved — awaiting V2.1 hardware validation before tuning  
**Approach:** B (measure + visual guide, no raw numbers shown)  
**Research reference:** `docs/references/rr-respiration-rate-research.md`  
**Related spec:** `docs/superpowers/specs/2026-05-02-calibration-progressive-rf-design.md` (calibration redesign — parallel track)

---

## Problem Statement

Mission Alive's MPC loop optimizes music to drive the user toward resonance breathing. But MPC currently has **no signal indicating whether entrainment is actually working**. It measures the output (RMSSD) but not the mechanism (actual breathing rate). The result: MPC adjusts music blindly — it can't distinguish "user is breathing at 0.1 Hz and resonating" from "RMSSD is high for unrelated reasons."

Additionally, `rf_calibration.py` fails silently in H10 mode (Mode 2): the `resp_buffer` it needs is filled with zeros because the H10 accelerometer is not implemented in the frontend. RF calibration never locks.

---

## Scientific Basis (Summary)

- RSA (Respiratory Sinus Arrhythmia) imprints breathing frequency directly onto the RR interval series. Extract the oscillation → get breathing rate without mic or accelerometer.
- Personal RF ranges 4.5–7 BPM — NOT universally 6 BPM. Using wrong RF suppresses RSA.
- RF changes session-to-session in 66.7% of participants (Vaschillo). Must be re-assessed each session.
- Music tempo entrains breathing at 1:4 ratio at slow tempos. Tempo is MPC's lever to close RF error.
- Singing/chanting at 0.1 Hz produces equivalent RSA to paced breathing — mantra-like audio is specifically effective.

Full citation list in research reference doc above.

---

## Preconditions (Must Verify Before Implementation)

1. **hrv_processor.py vs hrv_engine.py duplication:** Both define `HRVMetrics` dataclass. `main.py` imports from `hrv_processor`. All RF additions go to `hrv_processor.py` only. Do not touch `hrv_engine.py`.
2. **scipy already a dependency:** `rf_calibration.py` already uses `scipy.signal.coherence`. `scipy.signal.welch` is in the same package — no new dependency needed.
3. **Existing WebSocket frame** already includes `rf_coherence` field. Adding `rf_hz` follows the same pattern.
4. **current_mode hardcoded to 2 in main.py** — all mode-dependent logic uses Mode 2 (H10) config. This is a known pre-existing bug; do not fix here.
5. **Migration 002** (rf_calibration table) is defined in the calibration redesign spec. This spec does NOT add DB columns. `rf_hz` is a live session signal only — not persisted.

---

## Scope — What This Spec Covers

| In scope | Out of scope |
|---|---|
| `backend/rf_engine.py` (new file) | Fixing I:E ratio bug in calibration |
| `HRVMetrics` dataclass + `rf_hz` field | Fixing CAL_DWELL_S timing |
| `state_estimation.py` RF fields | hrv_engine.py duplication cleanup |
| `ans_classifier.py` 4-quadrant table | Forward model entrainment fitting (V3+) |
| `mpc_optimizer.py` rf_error term (UNTUNED) | Supabase DB migration |
| WebSocket frame `rf_hz` addition | Any mode other than Mode 2 (H10) |
| Frontend orb animation (ghost ring + inner orb) | Music param changes beyond tempo lever |
| Mode 2 calibration resp signal fix | Accelerometer implementation |

---

## Architecture

### New File: `backend/rf_engine.py`

Single class, no external state. Stateless relative to session — `HRVProcessor` owns the instance.

```python
"""RR-derived respiratory frequency via Welch PSD on RSA oscillation."""
import numpy as np
from scipy.signal import welch
from scipy.interpolate import interp1d

class RFEngine:
    RESAMPLE_HZ = 4          # uniform grid for spectral analysis
    SEARCH_LO   = 0.07       # Hz = 4.2 BPM (covers full 4.5+ BPM range with margin)
    SEARCH_HI   = 0.40       # Hz = 24 BPM
    MIN_WINDOW_S = 30        # minimum clean data for live session RF
    CAL_WINDOW_S = 90        # minimum for calibration (6 cycles at 4.5 BPM)

    def __init__(self):
        self._rr_ms: list[float] = []
        self._timestamps: list[float] = []
        self._elapsed: float = 0.0

    def push_rr(self, rr_ms: float) -> None:
        """Called once per incoming RR interval. Maintains rolling buffer."""
        self._rr_ms.append(rr_ms)
        self._elapsed += rr_ms / 1000.0
        # Keep only last CAL_WINDOW_S seconds
        while self._elapsed > self.CAL_WINDOW_S and len(self._rr_ms) > 1:
            self._elapsed -= self._rr_ms.pop(0) / 1000.0

    def compute_rf(self, window_s: float = MIN_WINDOW_S) -> float | None:
        """
        Returns RF in Hz. None if insufficient data.
        window_s=30 for live session, window_s=90 for calibration.
        # UNTUNED: peak detection threshold not validated on real H10 data
        """
        if self._elapsed < window_s or len(self._rr_ms) < 20:
            return None
        resampled = self._resample()
        if resampled is None:
            return None
        freqs, psd = welch(resampled, fs=self.RESAMPLE_HZ, nperseg=min(256, len(resampled)))
        mask = (freqs >= self.SEARCH_LO) & (freqs <= self.SEARCH_HI)
        if not mask.any():
            return None
        peak_freq = freqs[mask][np.argmax(psd[mask])]
        return float(peak_freq)

    def as_resp_signal(self) -> np.ndarray:
        """
        Synthetic respiratory signal derived from RR series via bandpass.
        Plugs into rf_calibration.compute_coherence_at_frequency() as resp_buffer
        when H10 accelerometer is unavailable (current state of Mode 2).
        """
        resampled = self._resample()
        if resampled is None:
            return np.array([])
        from scipy.signal import butter, filtfilt
        b, a = butter(2, [self.SEARCH_LO, self.SEARCH_HI],
                      btype='band', fs=self.RESAMPLE_HZ)
        return filtfilt(b, a, resampled)

    def _resample(self) -> np.ndarray | None:
        if len(self._rr_ms) < 10:
            return None
        rr_s = np.array(self._rr_ms) / 1000.0
        cumtime = np.cumsum(rr_s)
        if cumtime[-1] < 10:
            return None
        uniform_t = np.arange(0, cumtime[-1], 1.0 / self.RESAMPLE_HZ)
        interpolator = interp1d(cumtime, rr_s, kind='linear', bounds_error=False,
                                fill_value=(rr_s[0], rr_s[-1]))
        return interpolator(uniform_t)
```

---

### `backend/hrv_processor.py` — Minimal Extension

Two changes only:

**1. Add `rf_hz: float | None` to `HRVMetrics` dataclass:**
```python
@dataclass
class HRVMetrics:
    rmssd: float
    sdnn: float
    dfa_alpha1: float
    rf_hz: float | None = None   # ADD: RR-derived respiratory frequency
```

**2. Add `RFEngine` instance and call in `HRVProcessor`:**
```python
from .rf_engine import RFEngine   # ADD

class HRVProcessor:
    def __init__(self):
        self._rf_engine = RFEngine()   # ADD
        # ... existing __init__ unchanged ...

    def push(self, rr_ms: float):
        self._rf_engine.push_rr(rr_ms)   # ADD — before or after existing logic
        # ... existing push() unchanged ...

    def compute(self) -> HRVMetrics:
        # ... existing RMSSD/DFA computation unchanged ...
        rf_hz = self._rf_engine.compute_rf()   # ADD
        return HRVMetrics(
            rmssd=rmssd,
            sdnn=sdnn,
            dfa_alpha1=dfa,
            rf_hz=rf_hz,   # ADD
        )
```

No other changes to `hrv_processor.py`.

---

### `backend/rf_calibration.py` — Resp Signal Fallback Fix

In the calibration loop where `_resp_buffer` is used, add a fallback:

```python
# In the method that calls compute_coherence_at_frequency():
resp_signal = self._resp_buffer  # existing

# ADD: fallback for Mode 2 when H10 accel not available
if len(resp_signal) == 0 or np.all(resp_signal == 0):
    resp_signal = self._hrv_processor.rf_engine.as_resp_signal()
    # rf_engine must be accessible — pass via constructor or session reference
```

**Interface requirement:** `rf_calibration.py` needs a reference to the session's `HRVProcessor.rf_engine`. Pass it at construction time, not via global. Exact wiring: `BayesianRFOptimizer.__init__` receives `hrv_processor: HRVProcessor` parameter.

This fixes the known Mode 2 calibration failure without adding hardware.

---

### `backend/state_estimation.py` — RF Fields

Add two fields to the existing state dataclass (exact name to be confirmed by reading file):

```python
rf_hz: float | None    # measured breathing rate
rf_error: float | None # |rf_hz - user_calibrated_rf_hz| in Hz; None if rf_hz is None
```

`rf_error` computation requires `user_calibrated_rf_hz` — read from the session's user profile (already fetched at session start for baseline). If no calibration exists, use `0.1` (6 BPM fallback).

---

### `backend/ans_classifier.py` — 4-Quadrant RF Table

Add RF as a **confidence modifier** — it does not replace existing RMSSD classification, it sharpens it:

```python
# After existing ANS state is determined, apply RF confidence:
if rf_hz is not None and rf_error is not None:
    at_resonance = rf_error < 0.008  # within ~0.5 BPM of personal RF
    if ans_state == "ventral_vagal" and at_resonance:
        confidence_tag = "RESONANT"      # new: highest therapeutic value
    elif ans_state == "ventral_vagal" and not at_resonance:
        confidence_tag = "PARASYMPATHETIC"
    elif ans_state != "ventral_vagal" and at_resonance:
        confidence_tag = "ENTRAINING"    # mechanism active, not yet recovered
    else:
        confidence_tag = "DYSREGULATED"
# If rf_hz is None: confidence_tag = existing behavior (no change)
```

The `ENTRAINING` state is the key new signal: tells MPC "user is trying to breathe at RF, keep music tempo stable, don't change."

---

### `backend/mpc_optimizer.py` — RF Error Term

Add to the objective function inside the 12-candidate scoring loop:

```python
# ADD to objective (exact variable names to match existing code):
W_RF = 0.0  # UNTUNED — set to 0 until V2.1 real H10 session data available
if rf_error is not None:
    rf_score = 1.0 / (1.0 + rf_error * 10)  # peaks at rf_error=0, decays smoothly
    objective += W_RF * rf_score
```

With `W_RF = 0.0` this has zero effect on session behavior until we tune it. The structure is in place; tuning requires ≥3 real H10 sessions.

**Tempo lever comment (to be added near tempo candidate generation):**
```python
# Music entrainment: at slow tempos, breathing synchronizes at 1:4 tempo:RF ratio.
# Target tempo for RF entrainment = user_rf_hz * 4 (e.g., 0.1 Hz RF → 0.4 Hz = 24 BPM accent).
# Forward model tempo-RF coupling: UNTUNED — implement after V2.1 data collection.
```

---

### WebSocket Frame — `rf_hz` Addition

In `main.py`, where the outgoing frame dict is constructed (near existing `rf_coherence` field):

```python
# ADD alongside existing rf_coherence:
"rf_hz": metrics.rf_hz,              # float | None
"rf_calibrated_hz": session_rf_hz,   # float — user's personal RF from profile
```

`session_rf_hz` is already fetched at session start (same fetch as `baseline_rmssd`). Use `0.1` as fallback if calibration not available.

---

### Frontend — `sessionStore.js`

Add two fields to the existing session state object:

```javascript
rf_hz: null,            // measured RF in Hz (null until 30s of data)
rf_calibrated_hz: null, // personal RF from DB
```

Update when WS frame arrives — same pattern as existing `vs`, `metrics`, etc.

---

### Frontend — Orb Animation (CosmicOrb / VagusNerveAnimated)

**Read the existing animation component before implementing.** Do not duplicate or override existing CSS animations — extend only.

Design intent:
- **Ghost ring**: constant CSS animation at `rf_calibrated_hz`. Duration = `1 / rf_calibrated_hz` seconds per cycle. Fallback to 10s (6 BPM) if null. Pure CSS, no JS animation loop.
- **Inner orb**: existing pulsing orb gains a second animation layer synced to `rf_hz`. If `rf_hz` is null, inner orb animation unchanged from current behavior.
- **Merge animation**: when `|rf_hz - rf_calibrated_hz| < 0.008 Hz`: add a CSS class `in-resonance` that increases glow intensity and blends ring opacity. Remove class otherwise.

No numbers, labels, percentages, or BPM values visible at any point.

Implementation: pass `rfHz` and `rfCalibratedHz` as props to the orb component. Internal animation duration computed as `cssSeconds = rfHz ? (1 / rfHz).toFixed(2) : null`. Apply via inline style on the inner ring element only.

---

## End-to-End Data Flow

```
Polar H10 BLE
    ↓ rr_ms (every 500ms from frontend)
[main.py WebSocket handler]
    ↓
artifact_filter.py → rejects ectopic RR (existing, unchanged)
    ↓ clean rr_ms
hrv_processor.py
  ├── existing: RMSSD, DFA, SDNN
  └── NEW: rf_engine.push_rr() → rf_engine.compute_rf() → HRVMetrics.rf_hz
    ↓ HRVMetrics (now includes rf_hz)
state_estimation.py
  └── NEW: rf_hz, rf_error added to state vector
    ↓ StateVector (7D)
ans_classifier.py
  └── NEW: confidence_tag (RESONANT / PARASYMPATHETIC / ENTRAINING / DYSREGULATED)
    ↓
mpc_optimizer.py
  └── NEW: rf_error term in objective (W_RF=0.0, UNTUNED)
    ↓ music_params
music_engine.py (unchanged)
    ↓
[WebSocket frame] → adds rf_hz, rf_calibrated_hz
    ↓
Frontend sessionStore.js → rf_hz, rf_calibrated_hz stored
    ↓
CosmicOrb / VagusNerveAnimated → ghost ring + inner orb animation
```

Parallel path:
```
rf_engine.as_resp_signal() → rf_calibration.py → fixes Mode 2 coherence computation
```

---

## Files Touched (Exhaustive List)

| File | Change type | Size |
|---|---|---|
| `backend/rf_engine.py` | **NEW** | ~70 lines |
| `backend/hrv_processor.py` | Add `rf_hz` to dataclass + `RFEngine` instance | +8 lines |
| `backend/rf_calibration.py` | Resp signal fallback | +6 lines |
| `backend/state_estimation.py` | Add `rf_hz`, `rf_error` fields | +4 lines |
| `backend/ans_classifier.py` | 4-quadrant confidence tag | +12 lines |
| `backend/mpc_optimizer.py` | `W_RF=0.0` objective term + comment | +8 lines |
| `backend/main.py` | Add `rf_hz`, `rf_calibrated_hz` to frame | +2 lines |
| `frontend/src/sessionStore.js` | Add `rf_hz`, `rf_calibrated_hz` fields | +2 lines |
| `frontend/src/components/CosmicOrb.jsx` (or VagusNerveAnimated) | Ghost ring + merge class | +~30 lines |

**Files NOT touched:** `hrv_engine.py`, `artifact_filter.py`, `forward_model.py`, `safety.py`, `music_engine.py`, `db.py`, `storage.py`, all other frontend components.

---

## Gating — What Requires V2.1 Real H10 Data

| Item | Status |
|---|---|
| `RFEngine` code and wiring | Build now |
| WebSocket frame addition | Build now |
| Ghost ring + inner orb animation | Build now |
| Mode 2 calibration resp fix | Build now |
| `W_RF` in MPC objective | `0.0` until V2.1 |
| `rf_error` threshold for `ENTRAINING` state | `0.008 Hz` provisional — validate V2.1 |
| Tempo–RF entrainment model in forward_model.py | Do not build until V2.1+ session data |

---

## Failure Modes and Handling

| Failure | Behavior |
|---|---|
| `rf_hz = None` (< 30s data) | Ghost ring still shows. Inner orb unchanged. No resonance tag sent. |
| `rf_calibrated_hz = None` (no calibration) | Ghost ring uses 10s cycle (0.1 Hz fallback). `rf_error` uses 0.1 as target. |
| Ectopic spike corrupts RF | `artifact_filter.py` already rejects. Welch PSD further smooths residual noise. |
| Severe motion artifact | RF will be absent (< 20 clean RR). Graceful degradation to `rf_hz = None`. |
| User breathing too fast (>24 BPM) | Outside `SEARCH_HI` — returns `None`. Normal in early session before entrainment. |

---

## Self-Review

- **Placeholders:** `W_RF = 0.0` is intentional (UNTUNED), not a placeholder. `UNTUNED` comments added in code to mark as requiring V2.1 data.
- **Internal consistency:** rf_hz flows from `rf_engine → hrv_processor → state_estimation → ans_classifier → mpc_optimizer → WebSocket → frontend`. No breaks in chain.
- **Scope:** Does not touch calibration timing, I:E ratio, music engine parameters, DB schema, or safety supervisor. All those are separate specs.
- **Ambiguity resolved:** Ghost ring uses `rf_calibrated_hz` (personal RF), NOT 6 BPM. Fallback to 0.1 Hz only when calibration absent.
- **Duplication avoided:** `hrv_engine.py` not touched. Only `hrv_processor.py` extended.
