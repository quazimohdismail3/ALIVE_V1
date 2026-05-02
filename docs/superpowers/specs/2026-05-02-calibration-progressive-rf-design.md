# Calibration Redesign — Progressive RF Discovery
**Date:** 2026-05-02  
**Status:** SPEC — not yet implemented  
**Author:** Lead Architect  
**Depends on:** sensor-streaming-architecture (SensorContext sub-project)

---

## 1. Problem Statement

Three compounding bugs make the current calibration clinically invalid:

| Bug | Location | Effect |
|-----|----------|--------|
| 60% inhale / 40% exhale | `Calibration.jsx` lines ~205–207 (`inhaleS`, `exhaleS`) | Inhale-dominant breathing suppresses vagal tone. Backwards from the correct 40/60 I:E ratio. |
| 50% / 50% audio | `BreathActuator._cycle()` — `halfMs = periodMs / 2` | Audio phase correct relative to itself but wrong ratio; mismatched from orb. |
| Orb and audio out of phase | No shared start signal | Audio `_cycle()` starts independently on `start()` call; orb CSS animation starts independently on mount. They drift apart. |
| Dwell 30s at 4.5 bpm = 2.25 cycles | `main.py` `CAL_DWELL_S = 30.0` | Minimum for RSA estimation is 6 cycles = 90s at 4.5 bpm. |
| Search range 4.0–8.5 bpm | `BayesianRFOptimizer.search_bounds` | Clinical standard is 4.5–6.5 bpm. Range 4.0–4.4 and 6.6–8.5 are noise. |
| 3-bucket height prior | `BayesianRFOptimizer.__init__` — three `if height_cm >` branches | Iizawa 2024 (N=122) provides continuous formula with R²=0.55. 3-buckets discard precision. |
| Coherence fails in Mode 1 | `main.py` line ~520 — `np.zeros(50)` when `_resp_buffer` empty | Phase 0 uses guided breathing; resp signal must be synthesised from breathing guide timing. |

---

## 2. Scope of This Spec

This spec covers only `Calibration Redesign — Progressive RF Discovery`. It does not cover session music engine, ANS classifier, or baseline engine (those are separate sub-projects).

**Files touched:**
- `backend/rf_calibration.py` — prior formula, search bounds, new `compute_rsa_amplitude`
- `backend/main.py` — Phase 0 WS handler, Phase 1 passive scan endpoint, Phase 2 session hook
- `backend/db.py` — new DB functions for rf_calibration table
- `frontend/src/pages/Calibration.jsx` — I:E ratio fix, sync mechanism
- `frontend/src/audio/breath_actuator.js` — I:E ratio fix, sync via returned promise
- `frontend/src/pages/Dashboard.jsx` — new file; Phase 1 passive scan subscriber
- `backend/migrations/002_rf_calibration.sql` — new table + column additions

---

## 3. Science Anchors

```
Iizawa et al. 2024 (N=122, ages 20–64):
  Male:   RF = 17.90 − 0.07 × height_cm   (R²=0.55, prediction σ=±0.5 bpm)
  Female: RF = 15.88 − 0.06 × height_cm   (R²=0.55)
  Age: not significant — exclude from formula.
  Clamp output: max(4.5, min(6.5, result))

Clinically correct I:E ratio: 40% inhale / 60% exhale
  - Extended exhale activates parasympathetic via Hering-Breuer reflex
  - 60% inhale is the inverse and suppresses vagal tone

Minimum dwell for RSA estimation:
  - At 4.5 bpm: one cycle = 60/4.5 = 13.33s → 6 cycles = 80s
  - At 6.5 bpm: one cycle = 9.23s → 6 cycles = 55.4s
  - Safe floor: 90s (covers worst case 4.5 bpm with margin)

RSA amplitude definition:
  - Peak-to-trough HR variation per breath cycle
  - Threshold for "adequate resonance": ≥8 bpm peak-trough
  - Computed from RR intervals, not from a separate resp signal
  - Does not require resp_signal → works in Mode 1 without mic resp
```

---

## 4. RF Confidence State Machine

```
UNVALIDATED  →  DRAFT  →  REFINED  →  CONFIRMED
```

| State | Condition to enter | Stored as |
|-------|--------------------|-----------|
| `UNVALIDATED` | Phase 0 complete, coherence < 0.6 | `confidence_tag = 'UNVALIDATED'` |
| `DRAFT` | Phase 0 complete, coherence ≥ 0.6 | `confidence_tag = 'DRAFT'` |
| `REFINED` | Phase 1 passive scan improves coherence ≥ 10% vs DRAFT value | `confidence_tag = 'REFINED'` |
| `CONFIRMED` | Phase 2: 3 sessions with RSA ≥ 8 bpm peak-trough at current rf_bpm | `confidence_tag = 'CONFIRMED'` |

Auto-retrigger (return to `DRAFT`):
- 2-week gap since last session, OR
- RSA drops > 20% relative to `rsa_amplitude` baseline across 2 consecutive sessions, OR
- User taps "Recalibrate" in settings (future)

---

## 5. Database: Migration 002

**File:** `backend/migrations/002_rf_calibration.sql`

```sql
-- 002_rf_calibration.sql
-- Progressive RF Discovery — confidence state machine storage
-- All statements idempotent. No DROPs.

-- 1. rf_calibration — one row per user, upserted on each phase transition
create table if not exists public.rf_calibration (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  rf_bpm           numeric(4,2)  not null,
  confidence_tag   text          not null check (confidence_tag in ('UNVALIDATED','DRAFT','REFINED','CONFIRMED')),
  phase            int           not null check (phase between 0 and 2),
  coherence        numeric(4,3),
  rsa_amplitude    numeric(5,2),          -- peak-trough HR bpm from Phase 2
  sessions_at_rf   int           not null default 0,  -- sessions confirming current rf_bpm
  prior_bpm        numeric(4,2),          -- formula output before any measurement
  last_measured_at timestamptz   default now(),
  created_at       timestamptz   default now()
);

-- 2. Add rf columns to user_profiles (fast lookup without join)
alter table public.user_profiles
  add column if not exists rf_bpm          numeric(4,2),
  add column if not exists rf_confidence   text check (rf_confidence in ('UNVALIDATED','DRAFT','REFINED','CONFIRMED')),
  add column if not exists rf_updated_at   timestamptz;

-- 3. RLS
alter table public.rf_calibration enable row level security;

do $$ begin
  create policy rf_calibration_select on public.rf_calibration
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy rf_calibration_insert on public.rf_calibration
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy rf_calibration_update on public.rf_calibration
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- 4. Index for fast lookup
create index if not exists rf_calibration_user_time
  on public.rf_calibration(user_id, last_measured_at desc);
```

---

## 6. Backend: `rf_calibration.py` Changes

### 6.1 Replace 3-Bucket Height Prior with Iizawa Formula

**Current code (lines ~47–57 of `BayesianRFOptimizer.__init__`):**
```python
if height_cm > 183:
    self.f0 = 5.0
elif height_cm >= 168:
    self.f0 = 5.5
else:
    self.f0 = 6.0
```

**Replace with:**
```python
# constants at module level
RF_SEARCH_MIN = 4.5   # replaces 4.0 — clinical standard lower bound
RF_SEARCH_MAX = 6.5   # replaces 8.5 — clinical standard upper bound

def compute_prior_rf_bpm(sex: str, height_cm: float) -> float:
    """Iizawa et al. 2024 (N=122). R²=0.55, σ=±0.5 bpm.
    sex: 'male' | 'female' | 'prefer_not_to_say'
    Returns rf_bpm clamped to [RF_SEARCH_MIN, RF_SEARCH_MAX], rounded to 0.5.
    """
    if sex == 'male':
        raw = 17.90 - 0.07 * height_cm
    elif sex == 'female':
        raw = 15.88 - 0.06 * height_cm
    else:
        # average of male and female formulas
        raw = (17.90 - 0.07 * height_cm + 15.88 - 0.06 * height_cm) / 2.0
    clamped = max(RF_SEARCH_MIN, min(RF_SEARCH_MAX, raw))
    # Round to nearest 0.5
    return round(clamped * 2) / 2
```

**`BayesianRFOptimizer.__init__` update:**
```python
def __init__(self, sex: str = 'prefer_not_to_say', height_cm: float = None, prior_rf: float = None):
    self.search_bounds = (RF_SEARCH_MIN, RF_SEARCH_MAX)  # was (4.0, 8.5)
    if prior_rf:
        self.f0 = max(RF_SEARCH_MIN, min(RF_SEARCH_MAX, prior_rf))
    elif height_cm:
        self.f0 = compute_prior_rf_bpm(sex, height_cm)
    else:
        self.f0 = 5.5  # population median fallback
    self.next_freq = self.f0
    # rest unchanged
```

### 6.2 New Function: `compute_rsa_amplitude`

Add after `compute_coherence_at_frequency`:

```python
def compute_rsa_amplitude(rr_intervals_ms: list, target_bpm: float) -> float:
    """RSA amplitude: mean peak-to-trough HR variation per breath cycle.

    Algorithm:
    1. Convert RR to instantaneous HR (bpm).
    2. Low-pass filter at 2× target breathing frequency to isolate respiratory band.
    3. Segment into breath cycles (window = 60/target_bpm seconds).
    4. Per window: amplitude = max(HR) - min(HR).
    5. Return median amplitude across all complete windows.

    Returns 0.0 if insufficient data (< 6 complete cycles).

    Args:
        rr_intervals_ms: list of RR intervals in milliseconds
        target_bpm: breathing rate being tested (bpm), used for window sizing
    Returns:
        rsa_amplitude in bpm (peak-to-trough). Threshold for resonance: ≥ 8.0.
    """
    if len(rr_intervals_ms) < 12:
        return 0.0

    rr_s = np.array(rr_intervals_ms) / 1000.0
    t_rr = np.cumsum(rr_s)
    t_rr -= t_rr[0]
    total_duration = t_rr[-1]

    # Need at least 6 complete cycles
    cycle_s = 60.0 / target_bpm
    if total_duration < 6 * cycle_s:
        return 0.0

    # Interpolate to 4Hz uniform grid (same as coherence computation)
    t_uniform = np.arange(0, total_duration, 0.25)
    rr_interp = np.interp(t_uniform, t_rr, rr_s)

    # Instantaneous HR in bpm
    hr_uniform = 60.0 / rr_interp

    # Low-pass filter at 2× target breathing frequency
    fs = 4.0
    cutoff_hz = (target_bpm / 60.0) * 2.0
    nyq = fs / 2.0
    if cutoff_hz >= nyq:
        cutoff_hz = nyq * 0.9
    b, a = signal.butter(2, cutoff_hz / nyq, btype='low')
    hr_filtered = signal.filtfilt(b, a, hr_uniform)

    # Segment into breath-cycle windows
    samples_per_cycle = int(round(cycle_s * fs))
    n_complete = len(hr_filtered) // samples_per_cycle
    if n_complete < 6:
        return 0.0

    amplitudes = []
    for i in range(n_complete):
        window = hr_filtered[i * samples_per_cycle:(i + 1) * samples_per_cycle]
        amplitudes.append(float(np.max(window) - np.min(window)))

    return float(np.median(amplitudes))
```

### 6.3 `MODE_CALIBRATION_CONFIG` Update

Replace the existing `MODE_CALIBRATION_CONFIG` dict:

```python
MODE_CALIBRATION_CONFIG = {
    1: {
        "rr_source": "rppg",
        "resp_source": "synthesised",        # Phase 0: guide tone timing; mic for Phase 1
        "settling_seconds": 0,               # Phase 0 has no settling — guided breathing starts immediately
        "min_coherence_lock": 0.6,           # Phase 0 threshold for DRAFT tag
        "confidence_tag": "DRAFT",
    },
    2: {
        "rr_source": "h10",
        "resp_source": "synthesised",        # Phase 0: guide tone timing
        "settling_seconds": 0,
        "min_coherence_lock": 0.6,
        "confidence_tag": "DRAFT",
    },
    3: {
        "rr_source": "h10",
        "resp_source": "synthesised",
        "settling_seconds": 0,
        "min_coherence_lock": 0.6,
        "confidence_tag": "DRAFT",
    },
}

# Phase 1 passive scan thresholds (natural breathing, no guide)
PHASE1_MIN_COHERENCE_IMPROVEMENT = 0.10   # 10% relative improvement required
PHASE1_WINDOW_S = 30.0                    # seconds per candidate frequency

# Phase 2 session-embedded thresholds
PHASE2_RSA_THRESHOLD = 8.0               # bpm peak-trough — minimum for resonance
PHASE2_SESSIONS_TO_CONFIRM = 3           # sessions needed to reach CONFIRMED
PHASE2_RSA_DROP_THRESHOLD = 0.20         # 20% RSA drop triggers re-trigger
PHASE2_GAP_DAYS = 14                     # inactivity days triggers re-trigger
```

---

## 7. Backend: `main.py` Changes

### 7.1 Phase 0 WS Handler — Replace Calibration Block

**Constants to change (lines ~249–250):**
```python
# REPLACE:
CAL_DWELL_S = 30.0
CAL_CAP_S = 120.0

# WITH:
CAL_DWELL_S = 90.0    # minimum 6 cycles at 4.5 bpm (worst case) with margin
CAL_CAP_S = 90.0      # Phase 0 is exactly 90s — no Bayesian sweep, single frequency
```

**BayesianRFOptimizer instantiation (line ~231) — pass profile data:**
```python
# REPLACE:
rf_optimizer = BayesianRFOptimizer()  # default prior; no height/prior_rf

# WITH:
_profile = await db.get_profile(user_id)  # already fetched for session init
_prior_bpm = None
if _profile:
    _prior_bpm = compute_prior_rf_bpm(_profile.sex, _profile.height_cm)
rf_optimizer = BayesianRFOptimizer(
    sex=_profile.sex if _profile else 'prefer_not_to_say',
    height_cm=_profile.height_cm if _profile else None,
    prior_rf=_prior_bpm,
)
rf_bpm = rf_optimizer.f0   # formula output; sent to frontend as initial target_bpm
```

**Synthesised resp signal for Phase 0 coherence:**

Phase 0 uses guided breathing. The frontend breathes at exactly `rf_bpm`. We can synthesise the expected respiratory signal server-side from the guide timing rather than relying on mic:

```python
def _synthesise_resp_signal(duration_s: float, rf_bpm: float, fs: float = 25.0) -> np.ndarray:
    """Generate ideal sinusoidal resp signal at rf_bpm for coherence computation.
    Used in Phase 0 where breathing is guided and the resp waveform is known.
    """
    t = np.arange(0, duration_s, 1.0 / fs)
    freq_hz = rf_bpm / 60.0
    return np.sin(2 * np.pi * freq_hz * t)
```

**Phase 0 loop replacement** — inside `if cal_active:` block:

```python
if cal_active:
    # Phase 0: single frequency, 90s, guided breathing
    CAL_DWELL_S = 90.0
    CAL_CAP_S   = 90.0
    cal_start_t  = time.time()
    target_bpm   = rf_optimizer.f0          # formula prior
    coherence_so_far = 0.0
    _prior_bpm_value = rf_optimizer.f0

    # Send initial target so frontend can start orb + audio immediately
    await websocket.send_json({
        "cal": True,
        "target_bpm": round(target_bpm, 2),
        "coherence_so_far": 0.0,
        "dwell_remaining": CAL_DWELL_S,
        "elapsed": 0.0,
        "n_rr": 0,
    })

    try:
        while True:
            now = time.time()
            elapsed_s = now - cal_start_t
            if elapsed_s >= CAL_CAP_S:
                break

            # Drain ~1s of incoming WS messages
            drain_end = now + 1.0
            while time.time() < drain_end:
                try:
                    msg = await asyncio.wait_for(websocket.receive_json(), timeout=0.1)
                    if isinstance(msg.get("rr"), (int, float)):
                        _rr_buffer.append(float(msg["rr"]))
                    if isinstance(msg.get("resp_amp"), (int, float)):
                        _resp_buffer.append(float(msg["resp_amp"]))
                except (asyncio.TimeoutError, Exception):
                    break

            # Compute coherence using synthesised resp signal (known guide timing)
            if len(_rr_buffer) >= 15:
                _synth_resp = _synthesise_resp_signal(elapsed_s, target_bpm)
                coherence_so_far = compute_coherence_at_frequency(
                    _rr_buffer, _synth_resp, target_bpm
                )

            # Send cal frame
            await websocket.send_json({
                "cal": True,
                "target_bpm": round(target_bpm, 2),
                "coherence_so_far": round(float(coherence_so_far), 3),
                "dwell_remaining": max(0.0, CAL_DWELL_S - elapsed_s),
                "elapsed": round(elapsed_s, 1),
                "n_rr": len(_rr_buffer),
            })

    except Exception:
        pass

    # Determine confidence tag
    if coherence_so_far >= 0.6:
        confidence_tag = "DRAFT"
        rf_locked = True
    else:
        confidence_tag = "UNVALIDATED"
        rf_locked = False

    rf_bpm = target_bpm  # Phase 0 does not change frequency

    # Persist to rf_calibration table
    try:
        await db.upsert_rf_calibration(user_id, {
            "rf_bpm": round(float(rf_bpm), 2),
            "confidence_tag": confidence_tag,
            "phase": 0,
            "coherence": round(float(coherence_so_far), 3),
            "rsa_amplitude": None,
            "sessions_at_rf": 0,
            "prior_bpm": round(float(_prior_bpm_value), 2),
        })
        # Mirror to user_profiles for fast session-start lookup
        await db.update_profile_rf(user_id, rf_bpm, confidence_tag)
    except Exception:
        pass  # DB failure must not block cal_done delivery

    await websocket.send_json({
        "cal_done": True,
        "rf_bpm": round(float(rf_bpm), 2),
        "rf_locked": rf_locked,
        "rf_coherence": round(float(coherence_so_far), 3),
        "confidence_tag": confidence_tag,
        "prior_bpm": round(float(_prior_bpm_value), 2),
    })
    return  # WebSocket handler ends here for calibration connections
```

### 7.2 Phase 1 Passive Scan — New WS Message Type

Phase 1 reuses the existing session WebSocket. The frontend sends a new message type `{"type": "passive_scan_start"}` while the user is on the Dashboard.

**Add to the main WS receive loop (session phase), inside the message-drain block:**

```python
# Phase 1 passive scan — triggered by Dashboard when H10 stays connected
if msg.get("type") == "passive_scan_start":
    # Read current rf_calibration row
    _rf_row = await db.get_rf_calibration(user_id)
    if _rf_row and _rf_row["confidence_tag"] in ("DRAFT", "UNVALIDATED"):
        asyncio.create_task(
            _run_phase1_passive_scan(
                websocket, user_id, _rr_buffer, _rf_row
            )
        )
```

**New coroutine `_run_phase1_passive_scan`** (add as module-level function in `main.py`):

```python
async def _run_phase1_passive_scan(
    websocket,
    user_id: str,
    rr_buffer: list,
    rf_row: dict,
) -> None:
    """Phase 1: silent background scan of prior±0.5 and prior±1.0 bpm.
    Uses natural breathing (no guide tone). 4 candidates × 30s each.
    Updates rf_calibration if coherence improves ≥ 10%.
    Sends {"type": "scan_update", "status": "personalising"} while running.
    Sends {"type": "scan_done", "rf_bpm": x, "improved": bool} on completion.
    """
    current_rf = float(rf_row["rf_bpm"])
    current_coh = float(rf_row.get("coherence") or 0.0)

    candidates = [
        current_rf - 1.0,
        current_rf - 0.5,
        current_rf + 0.5,
        current_rf + 1.0,
    ]
    candidates = [
        round(c, 2) for c in candidates
        if RF_SEARCH_MIN <= c <= RF_SEARCH_MAX
    ]

    await websocket.send_json({"type": "scan_update", "status": "personalising"})

    best_bpm = current_rf
    best_coh = current_coh

    for cand_bpm in candidates:
        window_start = time.time()
        window_rr = list(rr_buffer)   # snapshot at window start

        # Collect 30s of natural-breathing RR
        while time.time() - window_start < PHASE1_WINDOW_S:
            await asyncio.sleep(1.0)
            # rr_buffer is mutated in place by main loop — get new arrivals
            window_rr = list(rr_buffer)

        if len(window_rr) < 15:
            continue

        # Natural breathing: no synthesised signal — use mic resp if available,
        # else fall back to synthesised at cand_bpm (conservative)
        resp_arr = np.array(rr_buffer[-100:]) if rr_buffer else None
        if resp_arr is None or len(resp_arr) < 30:
            resp_arr = _synthesise_resp_signal(PHASE1_WINDOW_S, cand_bpm)

        coh = compute_coherence_at_frequency(window_rr[-60:], resp_arr, cand_bpm)

        if coh > best_coh:
            best_bpm = cand_bpm
            best_coh = coh

    # Only update if improvement ≥ 10% relative
    improved = False
    if current_coh > 0 and (best_coh - current_coh) / current_coh >= PHASE1_MIN_COHERENCE_IMPROVEMENT:
        improved = True
    elif current_coh == 0 and best_coh > 0:
        improved = True

    if improved:
        try:
            await db.upsert_rf_calibration(user_id, {
                "rf_bpm": round(best_bpm, 2),
                "confidence_tag": "REFINED",
                "phase": 1,
                "coherence": round(float(best_coh), 3),
                "rsa_amplitude": None,
                "sessions_at_rf": 0,
                "prior_bpm": rf_row.get("prior_bpm"),
            })
            await db.update_profile_rf(user_id, best_bpm, "REFINED")
        except Exception:
            pass

    try:
        await websocket.send_json({
            "type": "scan_done",
            "rf_bpm": round(best_bpm, 2),
            "improved": improved,
        })
    except Exception:
        pass
```

### 7.3 Phase 2 Session Hook — First 90s RSA Measurement

Add at the **start of the session loop** (after `cal_active` block, in the main 1Hz loop), gated by a `_phase2_active` flag:

```python
# Phase 2 state — initialised once per WebSocket session
_phase2_active = False
_phase2_rsa_window_start: float | None = None
_phase2_rr_snapshot: list = []
PHASE2_WINDOW_S = 90.0

# Load current RF state from DB at session start
_rf_row = await db.get_rf_calibration(user_id)
if _rf_row and _rf_row["confidence_tag"] in ("DRAFT", "REFINED"):
    _phase2_active = True
    _phase2_rsa_window_start = time.time()
```

**Inside the 1Hz loop, after HRV computation:**

```python
# Phase 2: measure RSA amplitude during first 90s of session
if _phase2_active and _phase2_rsa_window_start is not None:
    _phase2_elapsed = time.time() - _phase2_rsa_window_start
    if _phase2_elapsed >= PHASE2_WINDOW_S:
        _phase2_active = False   # stop measuring
        _rsa = compute_rsa_amplitude(_rr_buffer, rf_bpm)

        # Load current sessions_at_rf count
        _rf_row_now = await db.get_rf_calibration(user_id)
        _sessions_at_rf = int((_rf_row_now or {}).get("sessions_at_rf") or 0)
        _current_tag = (_rf_row_now or {}).get("confidence_tag", "DRAFT")

        if _rsa >= PHASE2_RSA_THRESHOLD:
            _sessions_at_rf += 1
        else:
            # RSA below threshold — try rf±0.25 in next session (flag only; no freq change mid-session)
            pass  # TODO Phase 2.1: nudge rf_bpm by ±0.25 next session

        # Promote to CONFIRMED after 3 sessions with good RSA
        if _sessions_at_rf >= PHASE2_SESSIONS_TO_CONFIRM and _current_tag != "CONFIRMED":
            _current_tag = "CONFIRMED"

        # Detect RSA drop — two consecutive sessions below 80% of baseline
        # (implemented in Phase 2 iteration — requires session history; skip for now)

        try:
            await db.upsert_rf_calibration(user_id, {
                "rf_bpm": round(float(rf_bpm), 2),
                "confidence_tag": _current_tag,
                "phase": 2,
                "coherence": (_rf_row_now or {}).get("coherence"),
                "rsa_amplitude": round(float(_rsa), 2),
                "sessions_at_rf": _sessions_at_rf,
                "prior_bpm": (_rf_row_now or {}).get("prior_bpm"),
            })
            await db.update_profile_rf(user_id, rf_bpm, _current_tag)
        except Exception:
            pass
```

---

## 8. Backend: `db.py` New Functions

Add these three functions to `db.py`:

```python
async def get_rf_calibration(user_id: str) -> dict | None:
    """Fetch current RF calibration row for user. Returns None if not yet calibrated."""
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            select rf_bpm, confidence_tag, phase, coherence, rsa_amplitude,
                   sessions_at_rf, prior_bpm, last_measured_at
            from public.rf_calibration
            where user_id = $1
            """,
            uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
        )
        if row is None:
            return None
        return dict(row)


async def upsert_rf_calibration(user_id: str, data: dict) -> None:
    """Insert or update rf_calibration row. data keys must match table columns.
    Always sets last_measured_at = now().
    """
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            insert into public.rf_calibration
              (user_id, rf_bpm, confidence_tag, phase, coherence,
               rsa_amplitude, sessions_at_rf, prior_bpm, last_measured_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, now())
            on conflict (user_id) do update set
              rf_bpm          = excluded.rf_bpm,
              confidence_tag  = excluded.confidence_tag,
              phase           = excluded.phase,
              coherence       = coalesce(excluded.coherence, rf_calibration.coherence),
              rsa_amplitude   = coalesce(excluded.rsa_amplitude, rf_calibration.rsa_amplitude),
              sessions_at_rf  = excluded.sessions_at_rf,
              prior_bpm       = coalesce(excluded.prior_bpm, rf_calibration.prior_bpm),
              last_measured_at = now()
            """,
            uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
            data["rf_bpm"],
            data["confidence_tag"],
            data["phase"],
            data.get("coherence"),
            data.get("rsa_amplitude"),
            data.get("sessions_at_rf", 0),
            data.get("prior_bpm"),
        )


async def update_profile_rf(user_id: str, rf_bpm: float, confidence_tag: str) -> None:
    """Mirror rf_bpm + confidence to user_profiles for fast session-start lookup.
    Called after every rf_calibration upsert.
    """
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            update public.user_profiles
            set rf_bpm        = $2,
                rf_confidence = $3,
                rf_updated_at = now()
            where user_id = $1
            """,
            uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
            rf_bpm,
            confidence_tag,
        )
```

---

## 9. Frontend: Fix `Calibration.jsx` I:E Ratio

**Current (line ~205–207):**
```jsx
const inhaleS = (periodS * 0.6).toFixed(2);   // WRONG — 60% inhale
const exhaleS = (periodS * 0.4).toFixed(2);   // WRONG — 40% exhale
```

**Fix:**
```jsx
const inhaleS = (periodS * 0.4).toFixed(2);   // 40% inhale — parasympathetic correct
const exhaleS = (periodS * 0.6).toFixed(2);   // 60% exhale — extended exhale = vagal tone
```

**CSS animation keyframes** — the current `calBreathe` animation peaks at 60% (the keyframe timestamp), which coincidentally matches the new inhale ratio. The keyframe percentage in CSS means time-through-animation, not I:E ratio. The I:E ratio is controlled by the `inhaleS`/`exhaleS` values used in the progress display and passed to `BreathActuator`. The CSS animation uses `breatheDur` (total period) and the keyframe at 40% sets the peak correctly:

```css
/* REPLACE current calBreathe (peaks at 60%) with: */
@keyframes calBreathe {
  0%   { transform: scale(0.72); opacity: 0.55; }
  40%  { transform: scale(1.15); opacity: 1.00; }  /* peak at 40% of period = end of inhale */
  100% { transform: scale(0.72); opacity: 0.55; }
}
```

**Sync: pass start signal to BreathActuator.** Add a ref and a new prop to coordinate:

```jsx
const actuatorRef = useRef(null);

// In the WS open handler, after sending cal_start, start audio in sync with orb:
// (orb animation starts immediately on CSS mount; we need audio to start at same instant)
// The orb animation begins when status === 'sweeping'. Trigger audio at same setState call.

// Replace the setStatus('sweeping') call with:
setStatus('sweeping');
// Start audio on next frame so React has committed the orb animation
requestAnimationFrame(() => {
    if (!actuatorRef.current) {
        actuatorRef.current = new BreathActuator();
    }
    actuatorRef.current.start(target_bpm_from_ws);  // target_bpm comes from first cal frame
});
```

**Pass targetBpm to actuator when backend sends new target:**
```jsx
// In handleMsg, after setTargetBpm(msg.target_bpm):
if (actuatorRef.current) {
    actuatorRef.current.setRF(msg.target_bpm);
}
```

**Cleanup on unmount** (add to existing cleanup in `useEffect` return):
```jsx
return () => {
    cancelled = true;
    clearInterval(sendIvRef.current);
    try { wsRef.current?.close(); } catch (_) {}
    actuatorRef.current?.stop();
    // Do NOT stop fusion — it carries into the session
};
```

**Show inhale/exhale breakdown in UI** (replace current display which shows the old wrong ratio):
```jsx
{status === 'sweeping' && (
    <>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            Breathe with the orb
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Inhale {inhaleS}s · Exhale {exhaleS}s
        </div>
    </>
)}
```

---

## 10. Frontend: Fix `breath_actuator.js` I:E Ratio

**Current `_cycle()` (line ~38–47):**
```javascript
_cycle() {
    if (!this._running) return;
    const periodMs = (60 / this._rfBpm) * 1000;
    const halfMs = periodMs / 2;        // WRONG — 50/50
    try { this._synth.triggerAttack(174); } catch(_) {}
    this._timeout = setTimeout(() => {
        try { this._synth.triggerRelease(); } catch(_) {}
        this._timeout = setTimeout(() => this._cycle(), halfMs);  // WRONG — 50/50
    }, halfMs);
}
```

**Fix:**
```javascript
// Constants — 40% inhale / 60% exhale
static INHALE_RATIO = 0.4;
static EXHALE_RATIO = 0.6;

_cycle() {
    if (!this._running) return;
    const periodMs = (60 / this._rfBpm) * 1000;
    const inhaleMs = periodMs * BreathActuator.INHALE_RATIO;   // 40%
    const exhaleMs = periodMs * BreathActuator.EXHALE_RATIO;   // 60%
    try { this._synth.triggerAttack(174); } catch(_) {}
    this._timeout = setTimeout(() => {
        try { this._synth.triggerRelease(); } catch(_) {}
        this._timeout = setTimeout(() => this._cycle(), exhaleMs);
    }, inhaleMs);
}
```

**Envelope fix** — the attack and release times must not overlap with the next cycle. At 4.5 bpm and 40/60:
- inhaleMs = 13,333ms × 0.4 = 5,333ms
- exhaleMs = 13,333ms × 0.6 = 8,000ms
- Current `attack: 1.8, release: 1.8` is fine for these durations.

No envelope change needed for clinically relevant RF range (4.5–6.5 bpm).

**Sync contract:** `BreathActuator.start()` is called via `requestAnimationFrame` callback (see Section 9) at the same frame the orb CSS animation starts. Both inhale phases begin at t=0 relative to that frame. Drift is bounded by one `requestAnimationFrame` (~16ms) — acceptable.

---

## 11. Frontend: `Dashboard.jsx` — Phase 1 Passive Scan Subscriber

This component does not exist yet. It must be created as `frontend/src/pages/Dashboard.jsx`.

**Responsibilities:**
1. Display `rf_bpm` and `confidence_tag` from Supabase `rf_calibration` table.
2. Subscribe to `SensorContext` (from sensor-streaming sub-project) for H10 connection state.
3. When H10 is connected and `confidence_tag` in `['UNVALIDATED', 'DRAFT']`: open a background WS and send `{"type": "passive_scan_start"}`.
4. Show "personalising" pill while scan runs; hide on `scan_done`.
5. On `scan_done` with `improved: true`: show "Your breathing profile just updated" toast (2s, no action required).

**WS connection for Phase 1:**
```jsx
// Dashboard.jsx — Phase 1 passive scan hook
function usePassiveScan({ rfTag, h10Connected, session, backendMode, timezone }) {
    const [scanning, setScanning] = useState(false);
    const [scanDone, setScanDone] = useState(false);
    const wsRef = useRef(null);
    const hasScannedRef = useRef(false);   // run only once per mount

    useEffect(() => {
        // Only run if: H10 connected, calibration not yet CONFIRMED, not already scanned
        if (!h10Connected) return;
        if (!['UNVALIDATED', 'DRAFT'].includes(rfTag)) return;
        if (hasScannedRef.current) return;
        hasScannedRef.current = true;

        async function startScan() {
            let authToken = 'dev';
            if (supabase) {
                const { data: { session: supa } } = await supabase.auth.getSession();
                if (supa?.access_token) authToken = supa.access_token;
            }

            const ws = new WSClient(
                session ?? 'find_your_calm',
                backendMode ?? 2,
                authToken,
                (msg) => {
                    if (msg.type === 'scan_update' && msg.status === 'personalising') {
                        setScanning(true);
                    }
                    if (msg.type === 'scan_done') {
                        setScanning(false);
                        setScanDone(msg.improved === true);
                        try { wsRef.current?.close(); } catch (_) {}
                    }
                },
                { timezone, noReconnect: true }
            );
            wsRef.current = ws;
            ws.connect();

            // Wait for auth_ok, then send passive_scan_start
            ws.ws?.addEventListener('open', () => {
                ws.send({ type: 'passive_scan_start' });
            });
        }

        startScan().catch(console.warn);

        return () => {
            try { wsRef.current?.close(); } catch (_) {}
        };
    }, [h10Connected, rfTag]);

    return { scanning, scanDone };
}
```

**UI for passive scan indicator** (inside Dashboard render):
```jsx
{scanning && (
    <div style={{
        position: 'fixed', bottom: 24, right: 16,
        background: 'rgba(124,111,247,0.15)',
        border: '1px solid rgba(124,111,247,0.3)',
        borderRadius: 20, padding: '6px 14px',
        fontSize: 11, color: 'rgba(124,111,247,0.9)',
        backdropFilter: 'blur(8px)',
    }}>
        personalising
    </div>
)}
{scanDone && (
    // 2s auto-dismiss toast
    <ScanImprovedToast onDismiss={() => setScanDone(false)} />
)}
```

---

## 12. Wire-Up: How Profile Data Reaches Phase 0

The `main.py` WebSocket handler already calls `await db.get_profile(user_id)` during session initialisation (for baseline lookup). For the calibration path (`cal_active = True`), the profile fetch must happen **before** the calibration block:

```python
# In main.py, before "if cal_active:" block — add profile fetch if not already present:
_profile = await db.get_profile(user_id)

# Then in calibration block:
if cal_active:
    if _profile:
        _prior_bpm = compute_prior_rf_bpm(_profile.sex, _profile.height_cm)
        rf_optimizer = BayesianRFOptimizer(
            sex=_profile.sex,
            height_cm=_profile.height_cm,
            prior_rf=_prior_bpm,
        )
    else:
        # No profile — fallback to population median
        _prior_bpm = 5.5
        rf_optimizer = BayesianRFOptimizer()
    rf_bpm = rf_optimizer.f0
```

Profile contains `sex` and `height_cm` (both required fields in `user_profiles`, enforced by `ProfileSetup.jsx`). They are always present for authenticated users who completed onboarding.

---

## 13. Phase 0 One-Time Guard

Phase 0 runs once — on first launch. On subsequent launches, the existing `rf_calibration` row in Supabase provides `rf_bpm`. The App routing layer must check:

```javascript
// In App.jsx, when deciding whether to show Calibration screen:
const rfRow = await supabase
    .from('rf_calibration')
    .select('rf_bpm, confidence_tag')
    .eq('user_id', session.user.id)
    .single();

if (rfRow.data) {
    // Skip Phase 0 — use stored rf_bpm
    setCfg(prev => ({ ...prev, rfBpm: rfRow.data.rf_bpm }));
    setScreen('dashboard');
} else {
    // First launch — run Phase 0
    setScreen('calibration');
}
```

---

## 14. Constants Reference Table

All magic numbers in one place — single source of truth:

| Constant | Value | Location | Meaning |
|----------|-------|----------|---------|
| `RF_SEARCH_MIN` | 4.5 | `rf_calibration.py` | Clinical lower bound |
| `RF_SEARCH_MAX` | 6.5 | `rf_calibration.py` | Clinical upper bound |
| `PHASE0_DWELL_S` | 90.0 | `main.py` `CAL_DWELL_S` | Min 6 cycles at 4.5 bpm |
| `PHASE0_CAP_S` | 90.0 | `main.py` `CAL_CAP_S` | Phase 0 is fixed 90s |
| `PHASE0_COHERENCE_DRAFT` | 0.6 | `main.py` | Threshold for DRAFT tag |
| `PHASE1_WINDOW_S` | 30.0 | `rf_calibration.py` | Per-candidate window |
| `PHASE1_MIN_COHERENCE_IMPROVEMENT` | 0.10 | `rf_calibration.py` | 10% relative required |
| `PHASE2_RSA_THRESHOLD` | 8.0 | `rf_calibration.py` | bpm peak-trough minimum |
| `PHASE2_SESSIONS_TO_CONFIRM` | 3 | `rf_calibration.py` | Sessions to reach CONFIRMED |
| `PHASE2_RSA_DROP_THRESHOLD` | 0.20 | `rf_calibration.py` | 20% drop → retrigger |
| `PHASE2_GAP_DAYS` | 14 | `rf_calibration.py` | Inactivity → retrigger |
| `INHALE_RATIO` | 0.4 | `breath_actuator.js` | 40% inhale |
| `EXHALE_RATIO` | 0.6 | `breath_actuator.js` | 60% exhale |
| `RSA_MIN_CYCLES` | 6 | `rf_calibration.py` in `compute_rsa_amplitude` | Min windows required |
| `COHERENCE_FS` | 4.0 | `rf_calibration.py` | Interpolation grid Hz |
| `RESP_FS` | 25.0 | `rf_calibration.py` | Synthesised resp signal Hz |

---

## 15. Verification Checklist

Before merging any implementation of this spec:

- [ ] `compute_prior_rf_bpm('male', 175)` returns 5.5 (17.90 − 0.07×175 = 17.90−12.25 = 5.65 → rounds to 5.5)
- [ ] `compute_prior_rf_bpm('female', 165)` returns 6.0 (15.88 − 0.06×165 = 15.88−9.90 = 5.98 → rounds to 6.0)
- [ ] `compute_prior_rf_bpm('male', 190)` returns 4.5 (clamp: 17.90−13.30=4.60 → rounds to 4.5 ✓)
- [ ] `compute_rsa_amplitude` returns 0.0 for input with < 6 complete cycles
- [ ] `compute_rsa_amplitude` returns value ≥ 8.0 for synthetic sinusoidal RR with known 10 bpm RSA amplitude
- [ ] `BreathActuator` inhale duration = `periodMs * 0.4`, exhale = `periodMs * 0.6` (unit test)
- [ ] Orb CSS `@keyframes calBreathe` peaks at 40% keyframe
- [ ] Orb animation and audio tone start within same `requestAnimationFrame` call
- [ ] Phase 0 WS sends `cal_done` after exactly 90s (± 1s rounding)
- [ ] `confidence_tag` = `DRAFT` when coherence ≥ 0.6, `UNVALIDATED` otherwise
- [ ] Phase 1 passive scan only fires when `rfTag in ['UNVALIDATED', 'DRAFT']`
- [ ] Phase 1 does NOT update rf_bpm unless improvement ≥ 10% relative
- [ ] `rf_calibration` table has RLS — user can only read/write own row
- [ ] `user_profiles.rf_bpm` mirrors `rf_calibration.rf_bpm` after every upsert
- [ ] App.jsx skips Calibration screen if `rf_calibration` row exists in Supabase
- [ ] Phase 2 session hook deactivates after 90s (`_phase2_active = False`)
- [ ] `sessions_at_rf` increments only when RSA ≥ 8.0 bpm — not on every session
- [ ] `confidence_tag` transitions to `CONFIRMED` only after 3 sessions with RSA ≥ 8.0

---

## 16. Out of Scope for This Spec

- RSA drop retrigger across consecutive sessions (requires session-history query — implement in Phase 2.1)
- Manual recalibrate button in settings (V3)
- rf±0.25 frequency nudge within Phase 2 when RSA < 8.0 (deferred to Phase 2.1)
- Phase 1 passive scan via mic resp signal (blocked until H10 accelerometer or mic resp pipeline is validated; synthesised fallback used)
- Monetisation / Stripe
