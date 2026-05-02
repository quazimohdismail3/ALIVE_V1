# Active Session + Phase 2 RF Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RSA-amplitude-based Phase 2 RF micro-shift logic to the live session loop (first 90s), emit `phase2_rf_update` WS frames on improvement, persist the improved `rf_bpm` to the user profile, and consume the updates silently in the frontend hook.

**Architecture:** Backend owns all Phase 2 logic (candidate selection, 30s dwell, ≥15% improvement gate, 90s window); `compute_rsa_amplitude()` is a pure function added to `rf_calibration.py`; `main.py` session loop gains Phase 2 state vars, a new code block before the existing coherence-based calibration, and a post-session `db.update_rf_calibration()` call. Frontend is a thin receiver: `usePhase2RFConvergence` hook reads `phase2_rf_update` frames and calls `audioRef.current.updateRF()` silently with no re-render.

**Tech Stack:** Python 3.11 + asyncpg + FastAPI, pytest + pytest-asyncio, React 18 + Vite, Supabase Postgres.

**Reference spec:** `docs/superpowers/specs/2026-05-02-active-session-phase2-rf-design.md`

**Version gate:** V2 — do not implement until V2.1 real H10 sessions complete (see CLAUDE.md ORDERED WORK LIST).

**Dependencies (must exist before implementing):**
- DB migration 002 must add `rf_bpm FLOAT`, `rf_rsa_amplitude FLOAT`, `rf_confidence_tag TEXT DEFAULT 'UNCONFIRMED'` columns to `user_profiles` (Task 1 below defines this migration).
- `db.update_rf_calibration()` is new and defined in Task 2 below.
- `SensorContext` is NOT required — Session.jsx continues using `cfg.fusion` handoff. `useSensorFrame` abstraction is NOT used; the hook receives the raw WS message object directly from `handleWsMessage`. This spec is self-contained.

---

## File Map

**Backend — modify:**
- `backend/rf_calibration.py` — add `compute_rsa_amplitude()`
- `backend/main.py` — import new function; add Phase 2 state vars + logic block; conditionally add `phase2_rf_update` to emit frame; persist in `finally`; seed `rf_bpm` from profile on session start
- `backend/db.py` — add `update_rf_calibration()`
- `backend/api/profile.py` — add `CalibrationPatch` model + `PATCH /api/profile/calibration`

**Frontend — create:**
- `frontend/src/hooks/usePhase2RFConvergence.js` — new hook

**Frontend — modify:**
- `frontend/src/pages/Session.jsx` — import hook; add `rfConfidenceTag`; add `rfBpmRef`; add `handleRfUpdate`; wire `phase2HandleFrame` in `handleWsMessage`; update audio call to prefer `rfBpmRef`
- `frontend/src/lib/api.js` — add `patchCalibration()`

**DB — migration:**
- `supabase/migrations/20260502000001_rf_calibration_columns.sql` — 3 new columns on `user_profiles`

**Tests — create:**
- `backend/tests/test_rsa_amplitude.py` — pure-function unit tests for `compute_rsa_amplitude`
- `backend/tests/test_phase2_ws.py` — WS integration test for Phase 2 frame emission

---

## Tasks

### Task 1 — DB Migration: add RF calibration columns

- [ ] Create `supabase/migrations/20260502000001_rf_calibration_columns.sql`:

```sql
-- Migration: add RF calibration columns to user_profiles
-- Run via: mcp supabase apply_migration

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS rf_bpm             FLOAT,
  ADD COLUMN IF NOT EXISTS rf_rsa_amplitude   FLOAT,
  ADD COLUMN IF NOT EXISTS rf_confidence_tag  TEXT DEFAULT 'UNCONFIRMED';
```

- [ ] Apply via Supabase MCP: `mcp__supabase__apply_migration` with the SQL above.
- [ ] Verify: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='user_profiles' AND column_name IN ('rf_bpm','rf_rsa_amplitude','rf_confidence_tag');` returns 3 rows.

**Commit:** `git add supabase/migrations/20260502000001_rf_calibration_columns.sql && git commit -m "db: add rf_bpm, rf_rsa_amplitude, rf_confidence_tag to user_profiles"`

---

### Task 2 — Backend: add `db.update_rf_calibration()`

- [ ] Open `backend/db.py`. After the `upsert_baseline` function (around line 220), add:

```python
async def update_rf_calibration(
    user_id: str,
    rf_bpm: float,
    rsa_amplitude: float,
    tag: str | None,
) -> None:
    """
    Update rf_bpm and rf_rsa_amplitude in user_profiles.
    tag is written only when not None (partial update allowed).
    Called from session WS finally block and PATCH /api/profile/calibration.
    """
    uid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
    async with _pool.acquire() as conn:
        if tag is not None:
            await conn.execute(
                """
                UPDATE public.user_profiles
                SET rf_bpm = $1,
                    rf_rsa_amplitude = $2,
                    rf_confidence_tag = $3,
                    updated_at = NOW()
                WHERE user_id = $4
                """,
                rf_bpm, rsa_amplitude, tag, uid,
            )
        else:
            await conn.execute(
                """
                UPDATE public.user_profiles
                SET rf_bpm = $1,
                    rf_rsa_amplitude = $2,
                    updated_at = NOW()
                WHERE user_id = $3
                """,
                rf_bpm, rsa_amplitude, uid,
            )
```

- [ ] No other changes to `db.py`.

**Commit:** `git add backend/db.py && git commit -m "db: add update_rf_calibration() for Phase 2 RF persistence"`

---

### Task 3 — Backend: `compute_rsa_amplitude()` in `rf_calibration.py`

- [ ] Open `backend/rf_calibration.py`. After the `compute_coherence_at_frequency` function and before `class BayesianRFOptimizer`, add:

```python
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
    - Breath window = 60.0 / rf_bpm seconds.
    - Minimum 2 complete windows required; returns 0.0 otherwise.
    - Uses cumulative RR time to define window boundaries — no interpolation.
    - Minimum 3 beats per window required to compute amplitude.
    - # UNTUNED — RSA_LOW_THRESHOLD_MS=8.0 needs validation after ≥3 real H10 sessions.
    """
    if len(rr_intervals_ms) < 10:
        return 0.0
    window_s = 60.0 / rf_bpm          # e.g. 10.0s at 6 BPM
    rr_s = [r / 1000.0 for r in rr_intervals_ms]
    t_cumulative: list[float] = []
    acc = 0.0
    for r in rr_s:
        acc += r
        t_cumulative.append(acc)
    total_s = acc

    if total_s < 2 * window_s:        # need at least 2 complete windows
        return 0.0

    amplitudes: list[float] = []
    win_start = 0.0
    while win_start + window_s <= total_s:
        win_end = win_start + window_s
        window_rrs = [
            rr_intervals_ms[i]
            for i, t in enumerate(t_cumulative)
            if win_start <= t < win_end
        ]
        if len(window_rrs) >= 3:      # need ≥3 beats per window to compute range
            amplitudes.append(max(window_rrs) - min(window_rrs))
        win_start += window_s

    if len(amplitudes) < 2:
        return 0.0
    return float(sum(amplitudes) / len(amplitudes))
```

- [ ] No changes to `compute_coherence_at_frequency`, `BayesianRFOptimizer`, or `MODE_CALIBRATION_CONFIG`.

**Verify:** The function signature is `compute_rsa_amplitude(rr_intervals_ms: list[float], rf_bpm: float) -> float`. It is importable as `from .rf_calibration import compute_rsa_amplitude`.

**Commit:** `git add backend/rf_calibration.py && git commit -m "feat(rf): add compute_rsa_amplitude() — RSA-based Phase 2 signal"`

---

### Task 4 — Tests: `compute_rsa_amplitude` unit tests

- [ ] Create `backend/tests/test_rsa_amplitude.py`:

```python
"""Unit tests for compute_rsa_amplitude.

Run: pytest backend/tests/test_rsa_amplitude.py -v
Expected: 6 passed.
"""
import math
import pytest
from backend.rf_calibration import compute_rsa_amplitude


def test_flat_rr_returns_zero():
    """Flat RR series → no amplitude at 6 BPM."""
    rrs = [700.0] * 20
    result = compute_rsa_amplitude(rrs, 6.0)
    assert result == 0.0


def test_too_few_intervals_returns_zero():
    """< 10 RR intervals → 0.0 (guard)."""
    rrs = [700.0] * 9
    assert compute_rsa_amplitude(rrs, 6.0) == 0.0


def test_too_short_duration_returns_zero():
    """Total duration < 2 breath windows → 0.0."""
    # At 6 BPM, window = 10s. 15 × 700ms = 10.5s < 20s (2 windows).
    rrs = [700.0] * 15
    assert compute_rsa_amplitude(rrs, 6.0) == 0.0


def test_synthetic_rsa_6bpm():
    """
    Synthetic RR oscillating ±15ms around 850ms at exactly 6 BPM.
    Each 10s window contains ~14 beats; peak-trough ≈ 30ms.
    Expect result ≈ 30.0ms ± 5ms.
    """
    import math
    # Build RR series: ~14 beats per 10s window, oscillating sinusoidally
    n_beats = 42  # 3 windows worth
    rrs = []
    t = 0.0
    for i in range(n_beats):
        # RR oscillates between 835ms and 865ms at 6 BPM (10s period)
        rr = 850.0 + 15.0 * math.sin(2 * math.pi * t / 10.0)
        rrs.append(rr)
        t += rr / 1000.0
    result = compute_rsa_amplitude(rrs, 6.0)
    assert 20.0 <= result <= 40.0, f"Expected ~30ms, got {result:.1f}ms"


def test_synthetic_rsa_55bpm():
    """Same test at 5.5 BPM (window ≈ 10.9s). Should still return ~30ms."""
    n_beats = 42
    rrs = []
    t = 0.0
    period = 60.0 / 5.5
    for i in range(n_beats):
        rr = 850.0 + 15.0 * math.sin(2 * math.pi * t / period)
        rrs.append(rr)
        t += rr / 1000.0
    result = compute_rsa_amplitude(rrs, 5.5)
    assert 15.0 <= result <= 45.0, f"Expected ~30ms at 5.5 BPM, got {result:.1f}ms"


def test_bounds_clamp_safe():
    """Normal physiological data at 8.5 BPM boundary does not crash."""
    rrs = [700.0 + 30.0 * (i % 2) for i in range(40)]
    result = compute_rsa_amplitude(rrs, 8.5)
    assert isinstance(result, float)
    assert result >= 0.0
```

- [ ] Run: `cd C:/Users/user/Desktop/mission_alive && python -m pytest backend/tests/test_rsa_amplitude.py -v`
- [ ] Expected output: `6 passed` with test names printed.

**Commit:** `git add backend/tests/test_rsa_amplitude.py && git commit -m "test(rf): unit tests for compute_rsa_amplitude — 6 cases"`

---

### Task 5 — Backend: Phase 2 logic in `main.py`

This task has four sub-steps. Apply them in order.

#### 5a — Update import line

- [ ] In `backend/main.py`, find the existing import:

```python
from .rf_calibration import BayesianRFOptimizer, compute_coherence_at_frequency, MODE_CALIBRATION_CONFIG
```

Replace with:

```python
from .rf_calibration import (
    BayesianRFOptimizer,
    compute_coherence_at_frequency,
    compute_rsa_amplitude,       # Phase 2 RSA convergence
    MODE_CALIBRATION_CONFIG,
)
```

#### 5b — Load user profile and seed rf_bpm before session loop

- [ ] In `backend/main.py`, find the block that initializes session state variables (around the line `rf_optimizer = BayesianRFOptimizer()`). After `sid = None` and the DB `create_session` block, add a profile load block. It must appear BEFORE `rf_optimizer = BayesianRFOptimizer()`:

```python
    # Load user profile for RF seeding and confidence tag check
    user_profile = None
    if os.environ.get("DATABASE_URL"):
        try:
            user_profile = await db.get_profile(user_id)
        except Exception:
            pass  # DB failure must not block session start
```

- [ ] Then find `rf_optimizer = BayesianRFOptimizer()  # default prior; no height/prior_rf without user profile` and replace it with:

```python
    # Seed RF optimizer with stored profile values when available
    _stored_rf_bpm = getattr(user_profile, "rf_bpm", None) if user_profile else None
    _height_cm = getattr(user_profile, "height_cm", None) if user_profile else None
    rf_optimizer = BayesianRFOptimizer(
        height_cm=_height_cm,
        prior_rf=float(_stored_rf_bpm) if _stored_rf_bpm is not None else None,
    )
    rf_locked = False
    rf_bpm = rf_optimizer.f0
    rf_coherence = 0.0
```

Note: remove the existing separate `rf_locked = False`, `rf_bpm = rf_optimizer.f0`, `rf_coherence = 0.0` lines that follow since they are now included above.

#### 5c — Add Phase 2 state variables

- [ ] After the `_resp_buffer` initialization line, add:

```python
    # ---- Phase 2 RSA convergence state (first 90s, non-CONFIRMED profiles only)
    PHASE2_WINDOW_S = 90.0
    RSA_SHIFT_STEP = 0.25           # BPM step for micro-shift candidates
    RSA_LOW_THRESHOLD_MS = 8.0      # # UNTUNED — trigger threshold; calibrate after ≥3 H10 sessions
    RSA_IMPROVEMENT_MIN = 0.15      # 15% relative improvement required to apply candidate
    phase2_done = False
    phase2_baseline_rsa: float | None = None
    phase2_best_rsa: float = 0.0
    phase2_best_bpm: float = rf_bpm  # Note: rf_bpm assigned above in 5b
    phase2_candidate: float | None = None
    phase2_candidate_start: float = 0.0
    PHASE2_CANDIDATE_WINDOW_S = 30.0
```

#### 5d — Replace the session loop RF block and add Phase 2 update to emit frame

- [ ] In the SESSION PHASE while loop, find the existing RF calibration block:

```python
            # --- RF calibration — runs during settling phase, stops once locked
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

Replace the entire block with:

```python
            # --- Phase 2 RSA convergence (first 90s, rfConfidenceTag != CONFIRMED)
            phase2_rf_update_payload: dict | None = None
            _rf_confidence_tag = getattr(user_profile, "rf_confidence_tag", None) if user_profile else None

            if (not phase2_done
                    and elapsed < PHASE2_WINDOW_S
                    and _rf_confidence_tag != "CONFIRMED"
                    and len(_rr_buffer) >= 10):

                current_rsa = compute_rsa_amplitude(_rr_buffer[-60:], rf_bpm)

                if phase2_baseline_rsa is None and current_rsa > 0:
                    phase2_baseline_rsa = current_rsa
                    phase2_best_rsa = current_rsa
                    phase2_best_bpm = rf_bpm

                if phase2_baseline_rsa is not None:
                    if current_rsa < RSA_LOW_THRESHOLD_MS and phase2_candidate is None:
                        # Baseline RSA is weak — try ±0.25 BPM candidate
                        candidates = [rf_bpm + RSA_SHIFT_STEP, rf_bpm - RSA_SHIFT_STEP]
                        candidates = [c for c in candidates if 4.0 <= c <= 8.5]
                        if candidates:
                            phase2_candidate = candidates[0]
                            phase2_candidate_start = time.time()

                    if phase2_candidate is not None:
                        candidate_elapsed = time.time() - phase2_candidate_start
                        candidate_rsa = compute_rsa_amplitude(_rr_buffer[-30:], phase2_candidate)

                        if candidate_elapsed >= PHASE2_CANDIDATE_WINDOW_S or elapsed >= PHASE2_WINDOW_S - 1:
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
                                rf_bpm = phase2_candidate  # apply to live session immediately
                            phase2_candidate = None        # done with this candidate

            if elapsed >= PHASE2_WINDOW_S:
                phase2_done = True

            # --- Coherence-based RF calibration (continues regardless of Phase 2)
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

- [ ] Find the emit frame block (the `await websocket.send_json({` call at the end of the while loop body). Replace the single `await websocket.send_json({...})` call with a conditional payload builder:

```python
            # --- Emit frame
            _frame_payload = {
                "t": elapsed,
                "metrics": metrics.to_dict(),
                "state": state.to_dict(),
                "ans": {"state": ans.state, "confidence": ans.confidence, "actionable": ans.actionable},
                "affect": {"arousal": affect.arousal, "valence": affect.valence, "quadrant": affect.quadrant},
                "vs": vs_result,
                "music_params": best_params,
                "strategy": strategy,
                "mpc_score": score,
                "safety": {"safe": safety_status.safe, "reason": safety_status.reason},
                "rf_locked": rf_locked,
                "rf_bpm": rf_bpm,
                "rf_coherence": rf_coherence,
                "session_phase": current_phase,
                "session_type": session_manager.state.session_type,
            }
            if phase2_rf_update_payload is not None:
                _frame_payload["phase2_rf_update"] = phase2_rf_update_payload
            await websocket.send_json(_frame_payload)
```

- [ ] In the `finally` block, after `await db.finish_session(...)`, add the Phase 2 persistence call. Insert it immediately after the `db.finish_session` block, still inside the `if not discard_flag and last_state is not None ... and sid:` guard:

```python
                # Phase 2: persist improved RF BPM if found during session
                if (phase2_best_bpm != rf_optimizer.f0
                        and phase2_best_rsa > 0
                        and os.environ.get("DATABASE_URL")):
                    try:
                        await db.update_rf_calibration(
                            user_id=user_id,
                            rf_bpm=round(phase2_best_bpm, 2),
                            rsa_amplitude=round(phase2_best_rsa, 2),
                            tag=None,   # tag update reserved for Phase 3 multi-session locking
                        )
                    except Exception:
                        pass  # DB failure must not surface to user
```

- [ ] Verify: `python -m py_compile backend/main.py` exits 0.

**Commit:** `git add backend/main.py && git commit -m "feat(session): Phase 2 RSA RF convergence — 90s micro-shift + phase2_rf_update frame"`

---

### Task 6 — Backend: `PATCH /api/profile/calibration` endpoint

- [ ] Open `backend/api/profile.py`. After the `ProfileOut` class definition, add the `CalibrationPatch` model and the new route. Add them at the end of the file:

```python
from typing import Optional   # already imported — confirm, do not duplicate

class CalibrationPatch(BaseModel):
    rf_bpm:        float         = Field(..., ge=4.0, le=8.5)
    rsa_amplitude: float         = Field(..., ge=0.0)
    tag:           Optional[str] = Field(
        default=None,
        pattern="^(UNCONFIRMED|MEDIUM|HIGH|CONFIRMED)$",
    )


@router.patch("/profile/calibration")
async def patch_calibration(
    body: CalibrationPatch,
    user_id: str = Depends(get_current_user),
) -> dict:
    """
    REST endpoint for frontend-driven calibration writes.
    The session WS finally block calls db.update_rf_calibration() directly.
    This endpoint exists for future UI flows (e.g., a settings screen).
    """
    await db.update_rf_calibration(
        user_id=user_id,
        rf_bpm=body.rf_bpm,
        rsa_amplitude=body.rsa_amplitude,
        tag=body.tag,
    )
    return {"rf_bpm": body.rf_bpm, "rf_confidence_tag": body.tag}
```

- [ ] Verify no duplicate `Optional` import: `python -m py_compile backend/api/profile.py` exits 0.

**Commit:** `git add backend/api/profile.py && git commit -m "feat(api): add PATCH /api/profile/calibration for RF calibration writes"`

---

### Task 7 — Backend: WS integration test for Phase 2 frame

- [ ] Create `backend/tests/test_phase2_ws.py`:

```python
"""
Integration tests for Phase 2 RF convergence in the session WS loop.
Uses the simulator (?sim=1) to produce controllable RR data.

Run: pytest backend/tests/test_phase2_ws.py -v
Expected: 3 passed.
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from backend.rf_calibration import compute_rsa_amplitude


# ---- Pure logic tests (no WS needed) ----

def test_phase2_improvement_threshold():
    """Simulated improvement of 20% exceeds RSA_IMPROVEMENT_MIN (0.15)."""
    baseline_rsa = 5.0
    candidate_rsa = 6.1  # 22% improvement
    improvement = (candidate_rsa - baseline_rsa) / max(baseline_rsa, 1.0)
    assert improvement > 0.15


def test_phase2_no_improvement_below_threshold():
    """10% improvement does NOT exceed RSA_IMPROVEMENT_MIN (0.15)."""
    baseline_rsa = 5.0
    candidate_rsa = 5.5  # 10% improvement
    improvement = (candidate_rsa - baseline_rsa) / max(baseline_rsa, 1.0)
    assert improvement < 0.15


def test_phase2_candidate_bounds():
    """Candidate BPM is clamped to [4.0, 8.5]."""
    def get_candidates(rf_bpm, step=0.25):
        candidates = [rf_bpm + step, rf_bpm - step]
        return [c for c in candidates if 4.0 <= c <= 8.5]

    # At lower bound
    assert get_candidates(4.0) == [4.25]   # 3.75 excluded
    # At upper bound
    assert get_candidates(8.5) == [8.25]   # 8.75 excluded
    # Mid-range — both candidates valid
    assert len(get_candidates(6.0)) == 2
```

- [ ] Run: `cd C:/Users/user/Desktop/mission_alive && python -m pytest backend/tests/test_phase2_ws.py -v`
- [ ] Expected: `3 passed`.

**Commit:** `git add backend/tests/test_phase2_ws.py && git commit -m "test(phase2): Phase 2 RF convergence logic tests — 3 cases"`

---

### Task 8 — Frontend: `usePhase2RFConvergence` hook

- [ ] Create `frontend/src/hooks/usePhase2RFConvergence.js`:

```js
import { useCallback, useRef } from 'react';

/**
 * usePhase2RFConvergence
 *
 * Receives phase2_rf_update frames from the session WS (passed in by
 * Session.jsx handleWsMessage) and calls onRfUpdate when the backend
 * reports an improvement > 15%.
 *
 * Silent by design: no state changes, no re-renders.
 * No-ops entirely if rfConfidenceTag === 'CONFIRMED'.
 *
 * Does NOT depend on SensorContext — receives raw WS message objects.
 *
 * @param {object} params
 * @param {string} params.rfConfidenceTag  'UNCONFIRMED' | 'MEDIUM' | 'HIGH' | 'CONFIRMED'
 * @param {function} params.onRfUpdate     (newBpm: number) => void — called on improvement
 */
export function usePhase2RFConvergence({ rfConfidenceTag, onRfUpdate }) {
  // Capture confirmed state at mount; does not need to react to changes
  // (rfConfidenceTag is set once from cfg before session start).
  const confirmedRef = useRef(rfConfidenceTag === 'CONFIRMED');

  /**
   * handleFrame — called for every incoming WS message object.
   * Filters for phase2_rf_update presence and improvement threshold.
   */
  const handleFrame = useCallback((msg) => {
    if (confirmedRef.current) return;           // CONFIRMED → skip entirely
    if (!msg.phase2_rf_update) return;          // key absent this frame → no-op

    const { candidate_bpm, improvement } = msg.phase2_rf_update;
    // Backend already gates to > 15% before emitting the frame.
    // Frontend re-checks to be explicit (never apply a non-improving update).
    if (typeof improvement === 'number' && improvement > 0.15) {
      onRfUpdate(candidate_bpm);
    }
  }, [onRfUpdate]);

  return { handleFrame };
}
```

- [ ] Verify file exists at `frontend/src/hooks/usePhase2RFConvergence.js`.

**Commit:** `git add frontend/src/hooks/usePhase2RFConvergence.js && git commit -m "feat(hook): usePhase2RFConvergence — silent Phase 2 RF update consumer"`

---

### Task 9 — Frontend: wire hook into `Session.jsx`

Five targeted changes. Make them in order.

#### 9a — Import the hook

- [ ] In `frontend/src/pages/Session.jsx`, find the existing imports block. After the last import line, add:

```js
import { usePhase2RFConvergence } from '../hooks/usePhase2RFConvergence.js';
```

#### 9b — Destructure `rfConfidenceTag` and add `rfBpmRef`

- [ ] Find:

```js
  const { session, sensorMode, backendMode, timezone, rfBpm } = cfg ?? {};
```

Replace with:

```js
  const { session, sensorMode, backendMode, timezone, rfBpm, rfConfidenceTag } = cfg ?? {};

  // rfBpmRef: updated by Phase 2 without triggering re-render
  const rfBpmRef = useRef(rfBpm ?? 6);
```

#### 9c — Add `handleRfUpdate` callback (stable, no re-render)

- [ ] After the `useWakeLock` line (the hook destructure), add:

```js
  // Phase 2: stable callback — updates audio + CSS without re-render
  const handleRfUpdate = useCallback((newBpm) => {
    rfBpmRef.current = newBpm;
    audioRef.current?.updateRF(newBpm);
    document.documentElement.style.setProperty('--rf-period', `${(60 / newBpm).toFixed(1)}s`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

Note: `audioRef` is initialized in the `useEffect` below. The callback is safe to call only after the effect has run (i.e., after `auth_ok`), which is exactly when Phase 2 frames can arrive.

#### 9d — Instantiate the hook

- [ ] After the `handleRfUpdate` callback definition (before the main `useEffect`), add:

```js
  const { handleFrame: phase2HandleFrame } = usePhase2RFConvergence({
    rfConfidenceTag: rfConfidenceTag ?? 'UNCONFIRMED',
    onRfUpdate: handleRfUpdate,
  });
```

#### 9e — Wire into `handleWsMessage`

- [ ] Find the existing `handleWsMessage` function. Inside the `if ('t' in msg)` branch, find:

```js
      setFrame(msg);
      setLastStatus(null);
      accumPush(msg);

      // Wire audio updates every frame
      if (audioRef.current?._started) {
        if (msg.rf_bpm) audioRef.current.updateRF(msg.rf_bpm);
```

Replace the entire `if ('t' in msg)` branch with:

```js
    if ('t' in msg) {
      phase2HandleFrame(msg);         // Phase 2: no-op if CONFIRMED or no update this frame
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
```

- [ ] Verify: `cd frontend && npm run build` exits 0 (no import errors, no undefined variable errors).

**Commit:** `git add frontend/src/pages/Session.jsx && git commit -m "feat(session): wire usePhase2RFConvergence + rfBpmRef for silent Phase 2 RF updates"`

---

### Task 10 — Frontend: `patchCalibration()` in `api.js`

- [ ] Open `frontend/src/lib/api.js`. After the `putProfile` function, add:

```js
/**
 * patchCalibration — frontend-initiated calibration write.
 * NOTE: session WS finally block writes directly to DB; this endpoint
 * is available for future UI flows (e.g., settings screen).
 *
 * @param {{ rfBpm: number, rsaAmplitude: number, tag?: string }} params
 */
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
      ...(tag != null ? { tag } : {}),
    }),
  });
  if (!r.ok) throw new Error(`patchCalibration failed: ${r.status}`);
  return r.json();
}
```

- [ ] Verify: `cd frontend && npm run build` still exits 0.

**Commit:** `git add frontend/src/lib/api.js && git commit -m "feat(api): add patchCalibration() for REST-driven RF calibration writes"`

---

### Task 11 — End-to-end verification

Run all checks in this order:

#### 11a — Python tests

```bash
cd C:/Users/user/Desktop/mission_alive
python -m pytest backend/tests/test_rsa_amplitude.py backend/tests/test_phase2_ws.py -v
```

Expected output:
```
backend/tests/test_rsa_amplitude.py::test_flat_rr_returns_zero PASSED
backend/tests/test_rsa_amplitude.py::test_too_few_intervals_returns_zero PASSED
backend/tests/test_rsa_amplitude.py::test_too_short_duration_returns_zero PASSED
backend/tests/test_rsa_amplitude.py::test_synthetic_rsa_6bpm PASSED
backend/tests/test_rsa_amplitude.py::test_synthetic_rsa_55bpm PASSED
backend/tests/test_rsa_amplitude.py::test_bounds_clamp_safe PASSED
backend/tests/test_phase2_ws.py::test_phase2_improvement_threshold PASSED
backend/tests/test_phase2_ws.py::test_phase2_no_improvement_below_threshold PASSED
backend/tests/test_phase2_ws.py::test_phase2_candidate_bounds PASSED
9 passed
```

#### 11b — Frontend build

```bash
cd C:/Users/user/Desktop/mission_alive/frontend && npm run build
```

Expected: exits 0, no TypeScript/ESLint errors in the listed files.

#### 11c — Backend compile check

```bash
cd C:/Users/user/Desktop/mission_alive
python -m py_compile backend/rf_calibration.py backend/main.py backend/db.py backend/api/profile.py
```

Expected: exits 0 (no syntax errors).

#### 11d — Manual verification checklist (from spec §10)

- [ ] `compute_rsa_amplitude([700]*20, 6.0)` returns `0.0` (flat RR → zero amplitude)
- [ ] Synthetic test with ±15ms oscillation at 6 BPM returns value in [20, 40] ms
- [ ] Session WS emits `phase2_rf_update` key only on the frame where ≥15% improvement found
- [ ] `phase2_rf_update` absent from all frames when `elapsed >= 90.0`
- [ ] `rfConfidenceTag === 'CONFIRMED'` → `handleFrame` returns immediately (no `onRfUpdate` call)
- [ ] CSS `--rf-period` updates silently — no orb re-render other than the breath ring period change
- [ ] `db.update_rf_calibration()` NOT called when `discard_flag = True`
- [ ] `PATCH /api/profile/calibration` returns HTTP 200 `{"rf_bpm": 6.25, "rf_confidence_tag": null}` for valid body
- [ ] `PATCH /api/profile/calibration` returns HTTP 422 for `rf_bpm: 3.9` (below 4.0 minimum)

**Final commit:** `git add -p && git commit -m "chore: verification pass complete — Phase 2 RF convergence ready for H10 testing"`

---

## Thresholds Marked Untuned

The following constants in `main.py` are marked `# UNTUNED` and must NOT be adjusted until ≥3 real Polar H10 sessions are complete (CLAUDE.md §V2.1):

| Constant | File | Value | Comment |
|---|---|---|---|
| `RSA_LOW_THRESHOLD_MS` | `backend/main.py` | `8.0` | Trigger for micro-shift. Needs empirical H10 calibration. |
| `RSA_IMPROVEMENT_MIN` | `backend/main.py` | `0.15` | 15% relative improvement gate. Provisional. |
| `PHASE2_CANDIDATE_WINDOW_S` | `backend/main.py` | `30.0` | Dwell at candidate BPM. One candidate per session is intentional. |

The `# UNTUNED` comment is placed inline in the code (see Task 3 and Task 5c) to prevent premature tuning.

---

## What This Spec Does NOT Include

- Multi-session CONFIRMED locking (Phase 3): requires `rf_rsa_history` table + cross-session variance check.
- `SensorContext` / `useSensorFrame` abstraction: separate spec. Session.jsx continues using `cfg.fusion`.
- `POST /api/session/finalize` (SW Background Sync fallback): deferred — current `POST /api/session/end` is sufficient for V2.
- Changes to `BayesianRFOptimizer` or `compute_coherence_at_frequency`: no modifications.
- Discard path changes: the `discard_flag` guard in the `finally` block already prevents `update_rf_calibration()` from being called on discarded sessions.
