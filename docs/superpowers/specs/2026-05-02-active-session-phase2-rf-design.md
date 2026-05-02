# Active Session + Phase 2 RF Convergence — Design Spec
**Date:** 2026-05-02  
**Status:** DRAFT — not yet implemented  
**Version gate:** V2 (do not implement until V2.1 real H10 sessions complete)  
**Files touched:** `frontend/src/pages/Session.jsx`, `frontend/src/hooks/usePhase2RFConvergence.js` (new), `backend/rf_calibration.py`, `backend/main.py`, `backend/api/profile.py`, `frontend/src/lib/api.js`

---

## 0. Reality Check — What the Code Actually Does Today

Before specifying changes, the current state must be understood precisely.

**Session.jsx (current):**
- Opens its own `SensorFusion` if `cfg.fusion` is absent; consumes the handed-off fusion from Setup otherwise.
- Sends `{type: "session_start"}` sentinel immediately on WS open (polling 50ms until `readyState === OPEN`) to skip the 2s cal-detect peek in the backend.
- Emits `{rr, resp_amp}` at 500ms intervals from `fusion.getReading()`.
- Handles three WS frame types: `auth_ok`, `msg.status` (buffering/low_sqi), `'t' in msg` (data frame). Data frames update `frame` state; `audio.updateRF(msg.rf_bpm)` is called every frame.
- Audio starts on `auth_ok` using `rfBpm ?? msg.rf_bpm ?? 6`.
- No BLE code; sensor is already abstracted through SensorFusion.

**rf_calibration.py (current):**
- `compute_coherence_at_frequency(rr_intervals_ms, resp_signal, target_bpm, resp_fs=25.0)` — cross-spectral coherence using `scipy.signal.coherence` on a 4 Hz interpolated RR grid. Returns 0–1. Requires ≥15 RR intervals, ≥30 resp samples, ≥15s of data.
- `BayesianRFOptimizer` — GP with RBF kernel (length_scale=0.8, noise=0.02), Expected Improvement acquisition. Search bounds 4.0–8.5 BPM. Height-based prior: >183cm → 5.0, 168–183cm → 5.5, <168cm → 6.0.
- `MODE_CALIBRATION_CONFIG` — per-mode thresholds: mode 1 (rPPG) min_coherence_lock=0.75, settling=25s, tag=MEDIUM; modes 2/3 (H10) min_coherence_lock=0.85, settling=20s, tag=HIGH.

**main.py session loop (current):**
- RF calibration runs inside the session loop already: if `not rf_locked` and settling time passed and `len(_rr_buffer) >= 15`, calls `compute_coherence_at_frequency` and `rf_optimizer.next_evaluation_point()`. This is **continuous** — not bounded to 90s.
- The current in-session RF sweep uses the BayesianRFOptimizer the same way as the dedicated cal phase. The main gap: no `db.update_rf_calibration` call exists, and no `phase2_rf_update` frame is emitted.
- Arc phases: SessionManager uses named phases per session type (e.g., `find_your_calm` → ACKNOWLEDGE → SLOW → ANCHOR → RELEASE). There are **no** INTRO/RAMP/SUSTAIN/COOL_DOWN phases — the spec prompt's phase names are conceptual; the real code uses `session_manager.update()`.
- No `SensorContext` exists yet — this is a planned future abstraction.

**profile.py (current):**
- Only `GET /api/profile` and `PUT /api/profile` exist. No `/api/profile/calibration` endpoint.

**db.py (current):**
- `rf_bpm` and `rf_locked` are persisted in the `sessions` table via `db.finish_session()`. No `user_profiles.rf_bpm` or `user_profiles.rf_confidence_tag` column exists or is written.

---

## 1. Scope of This Spec

This spec defines three bounded changes:

1. **Backend:** Add `compute_rsa_amplitude()` to `rf_calibration.py`; add RSA-based Phase 2 RF micro-shift logic to the session WS loop (first 90s only); emit `phase2_rf_update` frame; persist improved `rf_bpm` to user profile after session if improved.

2. **Frontend hook:** `usePhase2RFConvergence` — consumes `phase2_rf_update` frames from the WS, applies silent `rf_bpm` updates to context, skips entirely if `rfConfidenceTag === 'CONFIRMED'`.

3. **Frontend Session.jsx:** Wire the hook; remove BLE init remnants (already absent); handle `phase2_rf_update` in `handleWsMessage`.

**Out of scope for this spec:** SensorContext (spec it separately), full multi-session CONFIRMED locking logic (belongs in a Phase 3 spec), Bayesian RF optimizer changes.

---

## 2. RSA Amplitude — The New Signal

### Why RSA, not coherence?

The existing calibration phase uses cross-spectral coherence between the RR series and respiratory signal. Coherence requires a clean, simultaneously-sampled respiratory reference signal (mic amplitude). In a live session, the respiratory signal can be noisy or absent (especially mode 2 on H10 without accelerometer implemented). RSA amplitude is computable from RR intervals alone — no respiratory reference needed.

**RSA amplitude** (Respiratory Sinus Arrhythmia): within each breath cycle window, the RR interval series rises (inhale slows HR, RR lengthens) and falls (exhale speeds HR, RR shortens). The peak-trough difference in RR within one breath window is a direct measure of vagal tone and resonance quality.

### Computation definition

```python
# backend/rf_calibration.py

def compute_rsa_amplitude(rr_intervals_ms: list[float], rf_bpm: float) -> float:
    """
    RSA amplitude: mean peak-trough RR range across complete breath windows.

    Parameters
    ----------
    rr_intervals_ms : list of float
        Accepted (artifact-filtered) RR intervals in milliseconds.
    rf_bpm : float
        Current resonance frequency target in breaths per minute.

    Returns
    -------
    float
        Mean RSA amplitude in milliseconds. Returns 0.0 if insufficient data.

    Notes
    -----
    - Breath window duration = 60.0 / rf_bpm seconds.
    - Minimum 2 complete windows required (returns 0.0 otherwise).
    - Uses cumulative RR time to define window boundaries — no interpolation.
    - Peak = max(RR) within window, trough = min(RR) within window.
    - Amplitude = mean(peak - trough) across all complete windows.
    """
    if len(rr_intervals_ms) < 10:
        return 0.0
    window_s = 60.0 / rf_bpm          # e.g. 10.0s at 6 BPM
    rr_s = [r / 1000.0 for r in rr_intervals_ms]
    t_cumulative = []
    acc = 0.0
    for r in rr_s:
        acc += r
        t_cumulative.append(acc)
    total_s = acc

    if total_s < 2 * window_s:        # need at least 2 complete windows
        return 0.0

    amplitudes = []
    win_start = 0.0
    while win_start + window_s <= total_s:
        win_end = win_start + window_s
        window_rrs = [
            rr_intervals_ms[i]
            for i, t in enumerate(t_cumulative)
            if win_start <= t < win_end
        ]
        if len(window_rrs) >= 3:      # need ≥3 beats per window
            amplitudes.append(max(window_rrs) - min(window_rrs))
        win_start += window_s

    if len(amplitudes) < 2:
        return 0.0
    return float(sum(amplitudes) / len(amplitudes))
```

**Threshold for micro-shift trigger:** RSA amplitude < 8.0 ms (8 ms peak-trough within a breath window is a weak vagal response at the current RF; shifting ±0.25 BPM may find a better resonance pocket).

**Improvement threshold for silent update:** If candidate RSA amplitude improves by > 15% relative (`(new - old) / old > 0.15`), apply the micro-shift.

---

## 3. Phase 2 Window — Mapping to Real Arc Phases

The spec requests "first 90 seconds." In practice, sessions start buffering HRV for ~30 RR intervals before the first data frame arrives. The 90s window must be measured from `t_start` (the WS connection time), not from when metrics first flow.

The SessionManager arc phases for `find_your_calm`: ACKNOWLEDGE (max 240s), SLOW, ANCHOR, RELEASE. The first 90s will almost always fall inside ACKNOWLEDGE. For `wind_down`: MEET (max 300s). For `morning_emergence`: ORIENT (max 240s).

**Rule:** Phase 2 runs while `elapsed < 90.0` (seconds since WS start). The elapsed counter already exists in the session loop as `elapsed = cycle_t0 - t_start`.

This matches the conceptual INTRO+RAMP window without requiring arc phase name changes.

---

## 4. Backend Changes

### 4.1 `backend/rf_calibration.py`

Add `compute_rsa_amplitude()` as defined in Section 2. No changes to existing functions.

Import addition in `main.py`:
```python
from .rf_calibration import (
    BayesianRFOptimizer,
    compute_coherence_at_frequency,
    compute_rsa_amplitude,       # new
    MODE_CALIBRATION_CONFIG,
)
```

### 4.2 `backend/main.py` — Session loop additions

**New state variables** (add alongside existing RF state vars):

```python
# Phase 2 RSA convergence state
PHASE2_WINDOW_S = 90.0
RSA_SHIFT_STEP = 0.25           # BPM step for micro-shift candidates
RSA_LOW_THRESHOLD_MS = 8.0      # trigger micro-shift below this
RSA_IMPROVEMENT_MIN = 0.15      # 15% relative improvement required to apply
phase2_done = False             # True after 90s window closes or after one improvement applied
phase2_baseline_rsa: float | None = None   # RSA at rf_bpm at first measurement
phase2_best_rsa: float = 0.0
phase2_best_bpm: float = rf_bpm
phase2_candidate: float | None = None      # current candidate being evaluated
phase2_candidate_start: float = 0.0
PHASE2_CANDIDATE_WINDOW_S = 30.0           # dwell at each candidate
```

**Modified RF calibration block** (replace the current `if not rf_locked:` block):

```python
# --- Phase 2 RSA convergence (first 90s, rfConfidenceTag != CONFIRMED)
# Existing coherence-based RF calibration continues after 90s as before.
phase2_rf_update_payload: dict | None = None

rf_confidence_tag = getattr(user_profile, "rf_confidence_tag", None) if user_profile else None

if (not phase2_done
        and elapsed < PHASE2_WINDOW_S
        and rf_confidence_tag != "CONFIRMED"
        and len(_rr_buffer) >= 10):

    current_rsa = compute_rsa_amplitude(_rr_buffer[-60:], rf_bpm)

    if phase2_baseline_rsa is None and current_rsa > 0:
        phase2_baseline_rsa = current_rsa
        phase2_best_rsa = current_rsa
        phase2_best_bpm = rf_bpm

    if phase2_baseline_rsa is not None:
        if current_rsa < RSA_LOW_THRESHOLD_MS and phase2_candidate is None:
            # Baseline RSA is weak — try a candidate
            # Pick the candidate (current ± 0.25) not yet tried
            candidates = [rf_bpm + RSA_SHIFT_STEP, rf_bpm - RSA_SHIFT_STEP]
            candidates = [
                c for c in candidates
                if 4.0 <= c <= 8.5
            ]
            if candidates:
                phase2_candidate = candidates[0]
                phase2_candidate_start = time.time()

        if phase2_candidate is not None:
            candidate_elapsed = time.time() - phase2_candidate_start
            candidate_rsa = compute_rsa_amplitude(_rr_buffer[-30:], phase2_candidate)

            if candidate_elapsed >= PHASE2_CANDIDATE_WINDOW_S or elapsed >= PHASE2_WINDOW_S - 1:
                # Evaluate candidate
                if (candidate_rsa > phase2_best_rsa
                        and (candidate_rsa - phase2_best_rsa) / max(phase2_best_rsa, 1.0) > RSA_IMPROVEMENT_MIN):
                    improvement = (candidate_rsa - phase2_best_rsa) / max(phase2_best_rsa, 1.0)
                    phase2_best_rsa = candidate_rsa
                    phase2_best_bpm = phase2_candidate
                    phase2_rf_update_payload = {
                        "candidate_bpm": round(phase2_candidate, 2),
                        "rsa_amplitude": round(candidate_rsa, 2),
                        "baseline_rsa": round(phase2_best_rsa, 2),
                        "improvement": round(improvement, 3),
                    }
                    rf_bpm = phase2_candidate  # apply to live session
                phase2_candidate = None        # done with this candidate

if elapsed >= PHASE2_WINDOW_S:
    phase2_done = True

# --- Existing coherence-based calibration (continues regardless of Phase 2)
if not rf_locked:
    elapsed_since_settle = time.time() - _settling_start
    if elapsed_since_settle > _rf_config["settling_seconds"] and len(_rr_buffer) >= 15:
        _resp_arr = np.array(_resp_buffer[-100:]) if _resp_buffer else np.zeros(50)
        rf_coherence = compute_coherence_at_frequency(_rr_buffer[-60:], _resp_arr, rf_bpm)
        rf_optimizer.observe(rf_bpm, rf_coherence)
        if rf_coherence >= _rf_config["min_coherence_lock"]:
            rf_locked = True
            rf_bpm, _ = rf_optimizer.best_estimate()
        else:
            rf_bpm = rf_optimizer.next_evaluation_point()
```

**Modified emit frame** — add `phase2_rf_update` field:

```python
await websocket.send_json({
    "t": elapsed,
    # ... all existing fields unchanged ...
    "rf_locked": rf_locked,
    "rf_bpm": rf_bpm,
    "rf_coherence": rf_coherence,
    "session_phase": current_phase,
    "session_type": session_manager.state.session_type,
    # Phase 2 RSA update — only present when an improvement was applied this cycle
    "phase2_rf_update": phase2_rf_update_payload,   # None most frames → omitted by send_json
})
```

Note: `send_json` does not omit `None` values automatically. Use a conditional:

```python
frame_payload = {
    "t": elapsed,
    # ... all existing fields ...
}
if phase2_rf_update_payload is not None:
    frame_payload["phase2_rf_update"] = phase2_rf_update_payload
await websocket.send_json(frame_payload)
```

**Post-session persistence** — in the `finally` block, after `db.finish_session()`:

```python
# Persist improved RF BPM if Phase 2 found a better value
if (not discard_flag
        and phase2_best_bpm != rf_optimizer.f0
        and phase2_best_rsa > 0
        and os.environ.get("DATABASE_URL")):
    try:
        await db.update_rf_calibration(
            user_id=user_id,
            rf_bpm=round(phase2_best_bpm, 2),
            rsa_amplitude=round(phase2_best_rsa, 2),
            tag=None,   # tag update handled by multi-session lock logic (Phase 3)
        )
    except Exception:
        pass  # DB failure must not surface to user
```

### 4.3 `backend/db.py` — New function

```python
async def update_rf_calibration(
    user_id: str,
    rf_bpm: float,
    rsa_amplitude: float,
    tag: str | None,
) -> None:
    """
    Upsert rf_bpm and rsa_amplitude into user_profiles.
    tag is written only if not None (allows partial update).

    Requires columns in user_profiles:
      rf_bpm FLOAT,
      rf_rsa_amplitude FLOAT,
      rf_confidence_tag TEXT DEFAULT 'UNCONFIRMED'
    """
    async with pool.acquire() as conn:
        if tag is not None:
            await conn.execute(
                """
                UPDATE user_profiles
                SET rf_bpm = $1, rf_rsa_amplitude = $2, rf_confidence_tag = $3,
                    updated_at = NOW()
                WHERE user_id = $4
                """,
                rf_bpm, rsa_amplitude, tag, user_id,
            )
        else:
            await conn.execute(
                """
                UPDATE user_profiles
                SET rf_bpm = $1, rf_rsa_amplitude = $2,
                    updated_at = NOW()
                WHERE user_id = $3
                """,
                rf_bpm, rsa_amplitude, user_id,
            )
```

### 4.4 `backend/api/profile.py` — New PATCH endpoint

```python
class CalibrationPatch(BaseModel):
    rf_bpm: float = Field(..., ge=4.0, le=8.5)
    rsa_amplitude: float = Field(..., ge=0.0)
    tag: Optional[str] = Field(default=None, pattern="^(UNCONFIRMED|MEDIUM|HIGH|CONFIRMED)$")


@router.patch("/profile/calibration")
async def patch_calibration(
    body: CalibrationPatch,
    user_id: str = Depends(get_current_user),
) -> dict:
    await db.update_rf_calibration(
        user_id=user_id,
        rf_bpm=body.rf_bpm,
        rsa_amplitude=body.rsa_amplitude,
        tag=body.tag,
    )
    return {"rf_bpm": body.rf_bpm, "rf_confidence_tag": body.tag}
```

**Note:** The backend already calls `db.update_rf_calibration()` directly in the WS `finally` block. The REST endpoint (`PATCH /api/profile/calibration`) is provided for frontend-initiated updates only (e.g., if a future frontend flow needs to write calibration data without a WS session). It is not called from the session `finally` block.

### 4.5 DB schema migration required

```sql
-- Add to Supabase via apply_migration
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS rf_bpm FLOAT,
  ADD COLUMN IF NOT EXISTS rf_rsa_amplitude FLOAT,
  ADD COLUMN IF NOT EXISTS rf_confidence_tag TEXT DEFAULT 'UNCONFIRMED';
```

**User profile load in main.py:** Before the session loop starts, load the user profile to get `rf_confidence_tag` and any stored `rf_bpm`:

```python
user_profile = None
if os.environ.get("DATABASE_URL"):
    try:
        user_profile = await db.get_profile(user_id)
        if user_profile and getattr(user_profile, "rf_bpm", None):
            rf_bpm = user_profile.rf_bpm          # seed with stored value
            rf_optimizer.f0 = rf_bpm
            rf_optimizer.next_freq = rf_bpm
    except Exception:
        pass
```

---

## 5. WebSocket Message Contract

### Existing data frame (no change to existing fields)

```json
{
  "t": 45.2,
  "metrics": { ... },
  "ans": { "state": "CALM", "confidence": 0.82, "actionable": true },
  "vs": { "vs": 58 },
  "rf_bpm": 6.0,
  "rf_locked": false,
  "rf_coherence": 0.61,
  "session_phase": "ACKNOWLEDGE",
  "session_type": "find_your_calm"
}
```

### New: frame with Phase 2 update (only on the cycle an improvement fires)

```json
{
  "t": 67.1,
  "metrics": { ... },
  "rf_bpm": 6.25,
  "rf_locked": false,
  "rf_coherence": 0.63,
  "session_phase": "ACKNOWLEDGE",
  "phase2_rf_update": {
    "candidate_bpm": 6.25,
    "rsa_amplitude": 14.3,
    "baseline_rsa": 5.8,
    "improvement": 0.147
  }
}
```

`phase2_rf_update` is absent from all other frames (key not present, not null). Frontend must use `"phase2_rf_update" in msg` check.

---

## 6. Frontend Changes

### 6.1 `usePhase2RFConvergence` hook (new file)

**Path:** `frontend/src/hooks/usePhase2RFConvergence.js`

```js
import { useCallback, useRef } from 'react';

/**
 * usePhase2RFConvergence
 *
 * Consumes phase2_rf_update frames from the session WS.
 * Silently updates rfBpm in context when an improvement > 15% arrives.
 * No-ops entirely if rfConfidenceTag === 'CONFIRMED'.
 *
 * @param {object} params
 * @param {string} params.rfConfidenceTag  - 'UNCONFIRMED' | 'MEDIUM' | 'HIGH' | 'CONFIRMED'
 * @param {function} params.onRfUpdate     - called with new rf_bpm when improvement applied
 */
export function usePhase2RFConvergence({ rfConfidenceTag, onRfUpdate }) {
  const confirmedRef = useRef(rfConfidenceTag === 'CONFIRMED');

  // Called by Session.jsx handleWsMessage for every incoming frame
  const handleFrame = useCallback((msg) => {
    if (confirmedRef.current) return;           // CONFIRMED → skip entirely
    if (!msg.phase2_rf_update) return;          // no update this frame

    const { candidate_bpm, improvement } = msg.phase2_rf_update;
    if (improvement > 0.15) {
      onRfUpdate(candidate_bpm);
    }
  }, [onRfUpdate]);

  return { handleFrame };
}
```

**Why no state inside the hook:** The hook is stateless on the frontend. The backend owns all Phase 2 logic (which candidate to try, when to measure, whether threshold is met). The frontend hook is purely a receiver: it reads the `phase2_rf_update` field and, if present with improvement > 15%, calls `onRfUpdate`. This avoids duplicating the 90s window tracking in JS.

### 6.2 `Session.jsx` changes

**1. Import the hook:**

```js
import { usePhase2RFConvergence } from '../hooks/usePhase2RFConvergence.js';
```

**2. Destructure `rfConfidenceTag` from cfg and set up RF update callback:**

```js
const { session, sensorMode, backendMode, timezone, rfBpm, rfConfidenceTag } = cfg ?? {};

// Local rfBpm ref — updated silently by Phase 2 without re-render
const rfBpmRef = useRef(rfBpm ?? 6);
```

**3. Define `onRfUpdate` callback (stable ref, no re-render):**

```js
const handleRfUpdate = useCallback((newBpm) => {
  rfBpmRef.current = newBpm;
  // Update audio immediately — no UI change
  audioRef.current?.updateRF(newBpm);
  // Update CSS breathing ring period
  document.documentElement.style.setProperty('--rf-period', `${(60 / newBpm).toFixed(1)}s`);
}, []);
```

**4. Instantiate the hook:**

```js
const { handleFrame: phase2HandleFrame } = usePhase2RFConvergence({
  rfConfidenceTag: rfConfidenceTag ?? 'UNCONFIRMED',
  onRfUpdate: handleRfUpdate,
});
```

**5. Wire into `handleWsMessage`:**

```js
function handleWsMessage(msg) {
  if (msg.type === 'auth_ok') {
    setWsStatus('live');
    audioRef.current?.start(rfBpmRef.current ?? msg.rf_bpm ?? 6).catch(() => {});
    return;
  }
  if (msg.status) {
    setLastStatus(msg);
    return;
  }
  if ('t' in msg) {
    phase2HandleFrame(msg);         // ← Phase 2 hook (no-ops if CONFIRMED or no update)
    setFrame(msg);
    setLastStatus(null);
    accumPush(msg);

    if (audioRef.current?._started) {
      // Prefer rfBpmRef (Phase 2 may have shifted it) over msg.rf_bpm
      const activeBpm = rfBpmRef.current ?? msg.rf_bpm;
      if (activeBpm) audioRef.current.updateRF(activeBpm);
      if (msg.session_phase && msg.ans?.state) {
        audioRef.current.updateState(msg.session_phase, msg.ans.state, false);
      }
    }
  }
}
```

**6. BLE init code:** Already absent from Session.jsx. No change needed.

**7. SensorContext:** Not yet implemented. Session.jsx continues to use `cfg.fusion` handoff from Setup. When SensorContext is introduced (separate spec), the `fusion` init block moves to the context provider. Session.jsx will replace `cfg?.fusion ?? new SensorFusion(...)` with `useSensorContext()`. That change is out of scope here.

---

## 7. `frontend/src/lib/api.js` — New function

```js
export async function patchCalibration({ rfBpm, rsaAmplitude, tag }) {
  const headers = {
    ...(await authHeaders()),
    'Content-Type': 'application/json',
  };
  const r = await fetch(`${API_URL}/api/profile/calibration`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      rf_bpm: rfBpm,
      rsa_amplitude: rsaAmplitude,
      tag: tag ?? undefined,
    }),
  });
  if (!r.ok) throw new Error(`patchCalibration failed: ${r.status}`);
  return r.json();
}
```

This function is not called from Session.jsx. The session WS `finally` block writes directly to DB via `db.update_rf_calibration()`. The REST function is available for any future UI-driven calibration write (e.g., a "Save calibration" button in a settings screen).

---

## 8. Multi-Session CONFIRMED Locking — Deferred to Phase 3

The brief specifies: after 3 sessions total, if RSA amplitude is stable (±15% across sessions) → `rf_bpm` locked, tag → CONFIRMED.

**This is explicitly out of scope for this spec.** Reason: it requires:
- A `rf_rsa_history` table or JSONB column tracking per-session RSA values.
- A cron or post-session function that checks history depth and variance.
- A definition of "session" — only sessions where Phase 2 ran, or all sessions?

The groundwork laid here (persisting `rf_bpm` and `rsa_amplitude` per session) enables Phase 3 to build the locking logic. Tag stays `UNCONFIRMED` or `MEDIUM`/`HIGH` from the calibration phase until Phase 3 ships.

---

## 9. Assumptions & Constraints

| Assumption | Impact if wrong |
|---|---|
| `user_profile.rf_confidence_tag` exists on the profile object returned by `db.get_profile()` | Backend will crash with AttributeError; add `getattr(user_profile, "rf_confidence_tag", None)` guard |
| RSA amplitude < 8ms is a meaningful "weak" threshold at these H10 data quality levels | Threshold needs empirical calibration after ≥3 real sessions; marked `# UNTUNED` until then |
| `compute_rsa_amplitude` is cheap enough to call every second | It is O(n) in RR buffer length; with `_rr_buffer[-60:]` capped at 60 elements it takes < 1ms |
| The 30s candidate dwell window fits within the 90s Phase 2 budget | At most 1 candidate can be evaluated (30s baseline measure + 30s candidate + 30s buffer). This is intentional — one micro-shift per session. |
| `audioRef.current?.updateRF(newBpm)` is safe to call outside React render | SessionAudio.updateRF already uses a ref internally; confirmed safe |

---

## 10. Verification Checklist

Before calling this spec implemented:

- [ ] `compute_rsa_amplitude([700]*20, 6.0)` returns 0.0 (flat RR → no amplitude)
- [ ] `compute_rsa_amplitude` with a synthetic RSA signal (RR oscillating ±15ms at 6 BPM) returns ~30ms
- [ ] Session WS emits `phase2_rf_update` only once during first 90s when improvement > 15% found
- [ ] `phase2_rf_update` absent from frames outside the 90s window
- [ ] `rfConfidenceTag === 'CONFIRMED'` → `handleFrame` returns immediately, no update applied
- [ ] Audio `--rf-period` CSS var updates silently (no screen repaint other than breath ring)
- [ ] `db.update_rf_calibration()` called in `finally` only when `phase2_best_bpm != rf_optimizer.f0`
- [ ] Discard path: `update_rf_calibration` is NOT called when `discard_flag = True`
- [ ] DB migration applied; `user_profiles` has `rf_bpm`, `rf_rsa_amplitude`, `rf_confidence_tag`
- [ ] Profile load in session WS seeds `rf_bpm` from DB when available
- [ ] `PATCH /api/profile/calibration` returns 200 with correct payload; 422 for `rf_bpm` outside 4.0–8.5

---

## 11. File Change Summary

| File | Change type | Lines estimate |
|---|---|---|
| `backend/rf_calibration.py` | Add `compute_rsa_amplitude()` | +35 |
| `backend/main.py` | Add Phase 2 state vars; replace RF block; add `phase2_rf_update` to emit; persist in `finally`; load user_profile | +60, ~10 changed |
| `backend/db.py` | Add `update_rf_calibration()` | +25 |
| `backend/api/profile.py` | Add `PATCH /api/profile/calibration` | +20 |
| `backend/api/profile.py` | Add `CalibrationPatch` Pydantic model | +8 |
| `frontend/src/hooks/usePhase2RFConvergence.js` | New file | +35 |
| `frontend/src/pages/Session.jsx` | Import hook; rfBpmRef; handleRfUpdate; wire handleFrame; update audio call | +15, ~5 changed |
| `frontend/src/lib/api.js` | Add `patchCalibration()` | +15 |
| DB migration | Add 3 columns to `user_profiles` | 1 migration file |

Total: ~210 lines added, ~15 lines changed. No deletions except replacing the RF calibration block in main.py (net neutral).
