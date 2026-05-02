# Calibration Redesign — Progressive RF Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 clinically-invalid calibration bugs (wrong I:E ratio, 50/50 audio, orb-audio desync, too-short dwell, bad search bounds, crude height prior, broken Mode-1 coherence) and layer in a Progressive RF Discovery state machine (Phase 0 guided → Phase 1 passive background → Phase 2 in-session RSA confirmation).

**Architecture:** `rf_calibration.py` gains `compute_prior_rf_bpm` (Iizawa 2024 formula), `compute_rsa_amplitude`, and updated constants. `main.py` Phase 0 WS handler is replaced with a fixed 90s single-frequency block that synthesises the resp signal from guide timing; Phase 1 runs as a background asyncio task inside the session WS; Phase 2 hooks into the 1Hz session loop. A new `rf_calibration` Supabase table (migration 002) holds the four-state confidence machine (UNVALIDATED → DRAFT → REFINED → CONFIRMED); `user_profiles` gets three mirror columns for fast session-start lookup. Frontend fixes the I:E ratio in both the orb CSS and `BreathActuator`, syncs them via `requestAnimationFrame`, and a new `Dashboard.jsx` subscribes to Phase 1 scan events.

**Tech Stack:** Python 3.11 / FastAPI / asyncpg / NumPy / SciPy, React 18 / Vite / Tone.js, Supabase Postgres with RLS, pytest + pytest-asyncio, Vitest (frontend unit tests).

**Reference spec:** `docs/superpowers/specs/2026-05-02-calibration-progressive-rf-design.md`

**COORDINATION NOTE — Migration 002:** This plan writes `backend/migrations/002_rf_calibration.sql`. The Auth/Landing spec's migration 002 adds columns to `user_profiles` (`calibration_done`, `rf_bpm`, `rf_confidence_tag`). Both specs target the same file number. Whoever runs second must append their SQL to the same `002_rf_calibration.sql` file, not create a `003_`. Confirm with the other plan's worker before applying to Supabase.

---

## File Map

**Backend — create:**
- `backend/migrations/002_rf_calibration.sql` — rf_calibration table + user_profiles rf columns + RLS
- `backend/tests/test_rf_calibration_v2.py` — new tests for compute_prior_rf_bpm, compute_rsa_amplitude, updated optimizer

**Backend — modify:**
- `backend/rf_calibration.py` — add `RF_SEARCH_MIN/MAX`, `compute_prior_rf_bpm`, `compute_rsa_amplitude`, update `BayesianRFOptimizer.__init__`, update `MODE_CALIBRATION_CONFIG`, add Phase 1/2 constants
- `backend/main.py` — replace Phase 0 cal block, add `_synthesise_resp_signal`, add `_run_phase1_passive_scan`, add Phase 2 session hook
- `backend/db.py` — append `get_rf_calibration`, `upsert_rf_calibration`, `update_profile_rf`

**Frontend — create:**
- `frontend/src/pages/Dashboard.jsx` — Phase 1 passive scan subscriber + rf_bpm/confidence display

**Frontend — modify:**
- `frontend/src/pages/Calibration.jsx` — I:E ratio fix (0.4/0.6), CSS keyframe peak at 40%, BreathActuator init + sync via requestAnimationFrame, cleanup on unmount
- `frontend/src/audio/breath_actuator.js` — I:E ratio fix (INHALE_RATIO=0.4, EXHALE_RATIO=0.6), static class constants
- `frontend/src/App.jsx` — Phase 0 one-time guard (skip Calibration if rf_calibration row exists)

---

## Task 1: Write failing backend tests (TDD red phase)

**Files:**
- Create: `backend/tests/test_rf_calibration_v2.py`

Tests cover all spec verification items for `rf_calibration.py`. They must fail against the current codebase before any implementation changes.

- [ ] **Step 1.1: Create test file**

Create `backend/tests/test_rf_calibration_v2.py`:

```python
"""Tests for Progressive RF Discovery — spec 2026-05-02.

Run:
    python -m pytest backend/tests/test_rf_calibration_v2.py -v

Expected before implementation: ALL FAIL (imports will succeed, assertions will fail).
Expected after implementation:  ALL PASS.
"""
import numpy as np
import pytest
from backend.rf_calibration import (
    compute_prior_rf_bpm,
    compute_rsa_amplitude,
    BayesianRFOptimizer,
    MODE_CALIBRATION_CONFIG,
    RF_SEARCH_MIN,
    RF_SEARCH_MAX,
    PHASE1_MIN_COHERENCE_IMPROVEMENT,
    PHASE1_WINDOW_S,
    PHASE2_RSA_THRESHOLD,
    PHASE2_SESSIONS_TO_CONFIRM,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

def test_search_bounds_clinical():
    assert RF_SEARCH_MIN == 4.5, "Clinical lower bound must be 4.5 bpm"
    assert RF_SEARCH_MAX == 6.5, "Clinical upper bound must be 6.5 bpm"


def test_phase1_constants():
    assert PHASE1_MIN_COHERENCE_IMPROVEMENT == 0.10
    assert PHASE1_WINDOW_S == 30.0


def test_phase2_constants():
    assert PHASE2_RSA_THRESHOLD == 8.0
    assert PHASE2_SESSIONS_TO_CONFIRM == 3


# ---------------------------------------------------------------------------
# compute_prior_rf_bpm — Iizawa 2024 formula
# ---------------------------------------------------------------------------

def test_prior_male_175():
    # 17.90 - 0.07*175 = 17.90 - 12.25 = 5.65 → rounds to nearest 0.5 = 5.5
    result = compute_prior_rf_bpm('male', 175)
    assert result == 5.5, f"Expected 5.5, got {result}"


def test_prior_female_165():
    # 15.88 - 0.06*165 = 15.88 - 9.90 = 5.98 → rounds to nearest 0.5 = 6.0
    result = compute_prior_rf_bpm('female', 165)
    assert result == 6.0, f"Expected 6.0, got {result}"


def test_prior_male_190_clamped():
    # 17.90 - 0.07*190 = 17.90 - 13.30 = 4.60 → rounds to 4.5 (clamp floor is 4.5)
    result = compute_prior_rf_bpm('male', 190)
    assert result == 4.5, f"Expected 4.5 (clamped), got {result}"


def test_prior_female_short_clamped_to_max():
    # 15.88 - 0.06*100 = 15.88 - 6.0 = 9.88 → clamp to 6.5
    result = compute_prior_rf_bpm('female', 100)
    assert result == 6.5, f"Expected 6.5 (clamped to max), got {result}"


def test_prior_prefer_not_to_say_is_average():
    male_val = 17.90 - 0.07 * 170
    female_val = 15.88 - 0.06 * 170
    avg = (male_val + female_val) / 2.0
    clamped = max(4.5, min(6.5, avg))
    expected = round(clamped * 2) / 2
    result = compute_prior_rf_bpm('prefer_not_to_say', 170)
    assert result == expected, f"Expected {expected}, got {result}"


def test_prior_result_always_in_bounds():
    for h in range(150, 200):
        for sex in ('male', 'female', 'prefer_not_to_say'):
            r = compute_prior_rf_bpm(sex, float(h))
            assert RF_SEARCH_MIN <= r <= RF_SEARCH_MAX, (
                f"Out of bounds: sex={sex} h={h} → {r}"
            )


# ---------------------------------------------------------------------------
# BayesianRFOptimizer — updated init signature + bounds
# ---------------------------------------------------------------------------

def test_optimizer_search_bounds_updated():
    opt = BayesianRFOptimizer()
    assert opt.search_bounds == (4.5, 6.5), (
        f"search_bounds must be (4.5, 6.5), got {opt.search_bounds}"
    )


def test_optimizer_uses_iizawa_prior_male():
    opt = BayesianRFOptimizer(sex='male', height_cm=175)
    assert opt.f0 == 5.5


def test_optimizer_uses_iizawa_prior_female():
    opt = BayesianRFOptimizer(sex='female', height_cm=165)
    assert opt.f0 == 6.0


def test_optimizer_prior_rf_overrides_formula():
    opt = BayesianRFOptimizer(sex='male', height_cm=175, prior_rf=5.0)
    assert opt.f0 == 5.0


def test_optimizer_next_point_in_new_bounds():
    opt = BayesianRFOptimizer(sex='male', height_cm=175)
    opt.observe(5.5, 0.5)
    nxt = opt.next_evaluation_point()
    assert 4.5 <= nxt <= 6.5, f"Next point {nxt} outside clinical bounds"


def test_optimizer_prior_rf_clamped_to_new_bounds():
    # prior_rf above RF_SEARCH_MAX should be clamped
    opt = BayesianRFOptimizer(prior_rf=9.0)
    assert opt.f0 <= RF_SEARCH_MAX


# ---------------------------------------------------------------------------
# MODE_CALIBRATION_CONFIG — updated for Phase 0
# ---------------------------------------------------------------------------

def test_mode_config_all_modes_present():
    assert set(MODE_CALIBRATION_CONFIG.keys()) == {1, 2, 3}


def test_mode_config_resp_source_synthesised():
    for mode in (1, 2, 3):
        assert MODE_CALIBRATION_CONFIG[mode]["resp_source"] == "synthesised", (
            f"mode {mode} resp_source must be 'synthesised' for Phase 0"
        )


def test_mode_config_settling_zero():
    # Phase 0 has no settling — guided breathing starts immediately
    for mode in (1, 2, 3):
        assert MODE_CALIBRATION_CONFIG[mode]["settling_seconds"] == 0


def test_mode_config_coherence_draft_threshold():
    # Phase 0 threshold is 0.6 (DRAFT) for all modes
    for mode in (1, 2, 3):
        assert MODE_CALIBRATION_CONFIG[mode]["min_coherence_lock"] == 0.6
        assert MODE_CALIBRATION_CONFIG[mode]["confidence_tag"] == "DRAFT"


# ---------------------------------------------------------------------------
# compute_rsa_amplitude
# ---------------------------------------------------------------------------

def test_rsa_amplitude_returns_zero_insufficient_data():
    # Fewer than 12 intervals → 0.0
    assert compute_rsa_amplitude([800.0] * 10, 6.0) == 0.0


def test_rsa_amplitude_returns_zero_under_6_cycles():
    # At 6.0 bpm: cycle = 10s, 6 cycles = 60s.
    # 30 intervals × 800ms = 24s < 60s → 0.0
    assert compute_rsa_amplitude([800.0] * 30, 6.0) == 0.0


def test_rsa_amplitude_detects_known_amplitude():
    """Synthetic RR with 10 bpm sinusoidal RSA should return amplitude ≥ 8.0."""
    # Baseline HR 60 bpm (1000ms RR). Sinusoidal modulation: ±5 bpm RSA.
    # HR(t) = 60 + 5*sin(2π*rf*t) → RR(t) = 60000 / HR(t)
    rf_bpm = 5.0
    fs_rr = 4.0  # 4Hz RR resampling grid
    duration = 120.0  # 2 minutes — well above 6 cycles at 5 bpm (72s)
    t = np.arange(0, duration, 1.0 / fs_rr)
    hr = 60.0 + 5.0 * np.sin(2 * np.pi * (rf_bpm / 60.0) * t)
    rr_ms = (60.0 / hr) * 1000.0
    result = compute_rsa_amplitude(list(rr_ms), rf_bpm)
    assert result >= 8.0, (
        f"Known 10 bpm RSA amplitude should return ≥ 8.0, got {result:.2f}"
    )


def test_rsa_amplitude_returns_float():
    rr = [800.0] * 120  # 120 × 800ms = 96s
    result = compute_rsa_amplitude(rr, 5.0)
    assert isinstance(result, float)
```

- [ ] **Step 1.2: Verify tests fail against current code**

```bash
cd C:\Users\user\Desktop\mission_alive && python -m pytest backend/tests/test_rf_calibration_v2.py -v 2>&1 | head -60
```

Expected output: `ImportError` or `AssertionError` on `RF_SEARCH_MIN`, `compute_prior_rf_bpm`, `compute_rsa_amplitude` — confirms red phase. Any test that passes without changes is a false green; check it.

- [ ] **Step 1.3: Commit red-phase tests**

```bash
git add backend/tests/test_rf_calibration_v2.py
git commit -m "test(calibration): add red-phase tests for Progressive RF Discovery — compute_prior_rf_bpm, compute_rsa_amplitude, updated optimizer bounds and MODE_CALIBRATION_CONFIG"
```

---

## Task 2: Update `backend/rf_calibration.py`

**Files:**
- Modify: `backend/rf_calibration.py`

Four changes in one file: add module-level constants, add `compute_prior_rf_bpm`, add `compute_rsa_amplitude`, update `BayesianRFOptimizer.__init__`, update `MODE_CALIBRATION_CONFIG`, add Phase 1/2 constants.

- [ ] **Step 2.1: Add module-level constants before `compute_coherence_at_frequency`**

In `backend/rf_calibration.py`, insert at the top of the file after the imports:

```python
# ---------------------------------------------------------------------------
# Clinical constants — single source of truth (see spec §14)
# ---------------------------------------------------------------------------
RF_SEARCH_MIN = 4.5   # clinical lower bound (was 4.0)
RF_SEARCH_MAX = 6.5   # clinical upper bound (was 8.5)

# Phase 1 passive scan
PHASE1_MIN_COHERENCE_IMPROVEMENT = 0.10   # 10% relative improvement required
PHASE1_WINDOW_S = 30.0                    # seconds per candidate frequency

# Phase 2 session-embedded
PHASE2_RSA_THRESHOLD = 8.0               # bpm peak-trough — minimum for resonance
PHASE2_SESSIONS_TO_CONFIRM = 3           # sessions needed to reach CONFIRMED
PHASE2_RSA_DROP_THRESHOLD = 0.20         # 20% RSA drop triggers re-trigger
PHASE2_GAP_DAYS = 14                     # inactivity days triggers re-trigger
```

- [ ] **Step 2.2: Add `compute_prior_rf_bpm` function after the constants block**

```python
def compute_prior_rf_bpm(sex: str, height_cm: float) -> float:
    """Iizawa et al. 2024 (N=122). R²=0.55, σ=±0.5 bpm.

    sex: 'male' | 'female' | 'prefer_not_to_say'
    Returns rf_bpm clamped to [RF_SEARCH_MIN, RF_SEARCH_MAX], rounded to nearest 0.5.
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

- [ ] **Step 2.3: Add `compute_rsa_amplitude` after `compute_coherence_at_frequency`**

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
        target_bpm:      breathing rate being tested (bpm), used for window sizing
    Returns:
        rsa_amplitude in bpm (peak-to-trough). Threshold for resonance: >= 8.0.
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

    # Interpolate to 4Hz uniform grid (same grid as compute_coherence_at_frequency)
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

- [ ] **Step 2.4: Update `BayesianRFOptimizer.__init__` signature and body**

Replace the current `__init__` method entirely:

```python
def __init__(self, sex: str = 'prefer_not_to_say', height_cm: float = None, prior_rf: float = None):
    self.observations = []
    self.search_bounds = (RF_SEARCH_MIN, RF_SEARCH_MAX)  # was (4.0, 8.5)
    if prior_rf:
        self.f0 = max(RF_SEARCH_MIN, min(RF_SEARCH_MAX, prior_rf))
    elif height_cm:
        self.f0 = compute_prior_rf_bpm(sex, height_cm)
    else:
        self.f0 = 5.5  # population median fallback
    self.next_freq = self.f0
```

Note: existing callers in `main.py` that pass only `height_cm` as a keyword argument still work because `sex` defaults to `'prefer_not_to_say'`. Callers passing only `prior_rf` also still work.

- [ ] **Step 2.5: Replace `MODE_CALIBRATION_CONFIG` dict entirely**

Replace the existing `MODE_CALIBRATION_CONFIG` dict with:

```python
MODE_CALIBRATION_CONFIG = {
    1: {
        "rr_source": "rppg",
        "resp_source": "synthesised",        # Phase 0: guide tone timing
        "settling_seconds": 0,               # Phase 0 has no settling
        "min_coherence_lock": 0.6,           # threshold for DRAFT tag
        "confidence_tag": "DRAFT",
    },
    2: {
        "rr_source": "h10",
        "resp_source": "synthesised",
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
```

- [ ] **Step 2.6: Run new tests — expect green**

```bash
cd C:\Users\user\Desktop\mission_alive && python -m pytest backend/tests/test_rf_calibration_v2.py -v
```

Expected output: all tests pass. If any fail, fix `rf_calibration.py` before proceeding.

- [ ] **Step 2.7: Run existing rf_calibration tests — confirm no regressions**

```bash
python -m pytest backend/tests/test_rf_calibration.py -v
```

Expected: tests that relied on old 3-bucket height prior (`test_bayesian_cold_start_height_tall`, `test_bayesian_cold_start_height_medium`, `test_bayesian_cold_start_height_short`) will now fail because the Iizawa formula produces different values. Update those three tests to the new Iizawa outputs:

| Old test | Old expected | New expected (Iizawa) |
|----------|-------------|----------------------|
| `height_cm=190` tall | `5.0` | `4.5` (17.90−13.30=4.60→4.5) |
| `height_cm=175` medium | `5.5` | `5.5` (17.90−12.25=5.65→5.5) — unchanged |
| `height_cm=160` short | `6.0` | `6.5` (17.90−11.20=6.70→clamp→6.5) |

Also update `test_bayesian_exploration_in_bounds` bounds assertion from `4.0 <= nxt <= 8.5` to `4.5 <= nxt <= 6.5`.

Edit `backend/tests/test_rf_calibration.py`:
- `test_bayesian_cold_start_height_tall`: `assert opt.f0 == 4.5`
- `test_bayesian_cold_start_height_short`: `assert opt.f0 == 6.5`
- `test_bayesian_exploration_in_bounds`: `assert 4.5 <= nxt <= 6.5`

Then confirm both test files pass:

```bash
python -m pytest backend/tests/test_rf_calibration.py backend/tests/test_rf_calibration_v2.py -v
```

Expected: all tests pass.

- [ ] **Step 2.8: Commit**

```bash
git add backend/rf_calibration.py backend/tests/test_rf_calibration.py
git commit -m "feat(calibration): Iizawa 2024 height prior, clinical search bounds 4.5-6.5, compute_rsa_amplitude, Phase 0/1/2 constants, MODE_CALIBRATION_CONFIG for Phase 0"
```

---

## Task 3: Migration 002 — `rf_calibration` table + `user_profiles` rf columns

**Files:**
- Create: `backend/migrations/002_rf_calibration.sql`

**COORDINATION NOTE:** The Auth/Landing spec's migration 002 also targets this filename. Check whether that spec's migration has already been written. If the file already exists, APPEND the SQL below to the existing content. If the file does not exist, create it fresh with the content below.

- [ ] **Step 3.1: Write (or append to) migration SQL**

`backend/migrations/002_rf_calibration.sql`:

```sql
-- 002_rf_calibration.sql
-- Progressive RF Discovery — confidence state machine storage
-- All statements idempotent. No DROPs.
-- If Auth/Landing migration 002 already exists, APPEND from this line.

-- 1. rf_calibration — one row per user, upserted on each phase transition
create table if not exists public.rf_calibration (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  rf_bpm           numeric(4,2)  not null,
  confidence_tag   text          not null check (
    confidence_tag in ('UNVALIDATED','DRAFT','REFINED','CONFIRMED')
  ),
  phase            int           not null check (phase between 0 and 2),
  coherence        numeric(4,3),
  rsa_amplitude    numeric(5,2),          -- peak-trough HR bpm from Phase 2
  sessions_at_rf   int           not null default 0,
  prior_bpm        numeric(4,2),          -- Iizawa formula output before any measurement
  last_measured_at timestamptz   default now(),
  created_at       timestamptz   default now()
);

-- 2. Add rf mirror columns to user_profiles (fast lookup without join)
alter table public.user_profiles
  add column if not exists rf_bpm          numeric(4,2),
  add column if not exists rf_confidence   text check (
    rf_confidence in ('UNVALIDATED','DRAFT','REFINED','CONFIRMED')
  ),
  add column if not exists rf_updated_at   timestamptz;

-- 3. RLS — enable row-level security
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

- [ ] **Step 3.2: Apply migration to Supabase**

```bash
# Copy SQL and apply via Supabase SQL editor, or use the MCP tool:
# mcp__supabase__execute_sql with the SQL above
# Verify no errors. If the Auth/Landing 002 already exists in Supabase,
# only run the rf_calibration-specific statements (items 1, 3, 4 above;
# item 2 may overlap — check for duplicate_column errors and handle with
# the `add column if not exists` guard which is already present).
```

- [ ] **Step 3.3: Verify table structure**

```sql
-- Run in Supabase SQL editor:
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'rf_calibration'
order by ordinal_position;
```

Expected: 10 rows — user_id, rf_bpm, confidence_tag, phase, coherence, rsa_amplitude, sessions_at_rf, prior_bpm, last_measured_at, created_at.

```sql
-- Verify rf columns added to user_profiles:
select column_name from information_schema.columns
where table_name = 'user_profiles'
  and column_name in ('rf_bpm', 'rf_confidence', 'rf_updated_at');
```

Expected: 3 rows returned.

- [ ] **Step 3.4: Commit**

```bash
git add backend/migrations/002_rf_calibration.sql
git commit -m "feat(db): migration 002 — rf_calibration table with confidence state machine + rf mirror columns on user_profiles"
```

---

## Task 4: Add `db.py` RF functions

**Files:**
- Modify: `backend/db.py`

Three new async functions appended to the end of `backend/db.py`.

- [ ] **Step 4.1: Append three functions to `backend/db.py`**

```python
async def get_rf_calibration(user_id: str) -> Optional[dict]:
    """Fetch current RF calibration row for user. Returns None if not yet calibrated."""
    if _pool is None:
        return None
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
    """Insert or update rf_calibration row. Always sets last_measured_at = now().

    Required keys in data: rf_bpm, confidence_tag, phase.
    Optional keys: coherence, rsa_amplitude, sessions_at_rf, prior_bpm.
    """
    if _pool is None:
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            insert into public.rf_calibration
              (user_id, rf_bpm, confidence_tag, phase, coherence,
               rsa_amplitude, sessions_at_rf, prior_bpm, last_measured_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, now())
            on conflict (user_id) do update set
              rf_bpm           = excluded.rf_bpm,
              confidence_tag   = excluded.confidence_tag,
              phase            = excluded.phase,
              coherence        = coalesce(excluded.coherence, rf_calibration.coherence),
              rsa_amplitude    = coalesce(excluded.rsa_amplitude, rf_calibration.rsa_amplitude),
              sessions_at_rf   = excluded.sessions_at_rf,
              prior_bpm        = coalesce(excluded.prior_bpm, rf_calibration.prior_bpm),
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
    """Mirror rf_bpm + confidence_tag to user_profiles for fast session-start lookup.
    Called after every upsert_rf_calibration. No-ops if _pool is None or row missing.
    """
    if _pool is None:
        return
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

Note: `uuid` is already imported at the top of `db.py`. `Optional` is imported from `typing`.

- [ ] **Step 4.2: Verify db.py imports are present**

Check that `db.py` has `import uuid` and `from typing import Any, Optional`. If `Optional` is missing, add it to the existing `from typing import` line.

- [ ] **Step 4.3: Run db tests — no regressions**

```bash
python -m pytest backend/tests/test_db.py backend/tests/test_db_profile.py -v
```

Expected: all pass (new functions are additive; they require DB connection to test fully, which mocked tests skip gracefully due to `if _pool is None: return None`).

- [ ] **Step 4.4: Commit**

```bash
git add backend/db.py
git commit -m "feat(db): add get_rf_calibration, upsert_rf_calibration, update_profile_rf for progressive RF state machine"
```

---

## Task 5: Update `backend/main.py` — Phase 0, Phase 1, Phase 2

**Files:**
- Modify: `backend/main.py`

Three surgical changes:
1. Add `_synthesise_resp_signal` helper and `_run_phase1_passive_scan` coroutine (module-level).
2. Replace the Phase 0 calibration block (`if cal_active:`) with the new single-frequency 90s block.
3. Add Phase 2 session hook (load rf_row at session start; measure RSA in first 90s of 1Hz loop).

- [ ] **Step 5.1: Update `main.py` imports**

At the top of `main.py`, update the rf_calibration import line:

```python
# REPLACE:
from .rf_calibration import BayesianRFOptimizer, compute_coherence_at_frequency, MODE_CALIBRATION_CONFIG

# WITH:
from .rf_calibration import (
    BayesianRFOptimizer,
    compute_coherence_at_frequency,
    compute_rsa_amplitude,
    compute_prior_rf_bpm,
    MODE_CALIBRATION_CONFIG,
    PHASE1_MIN_COHERENCE_IMPROVEMENT,
    PHASE1_WINDOW_S,
    PHASE2_RSA_THRESHOLD,
    PHASE2_SESSIONS_TO_CONFIRM,
    RF_SEARCH_MIN,
    RF_SEARCH_MAX,
)
```

- [ ] **Step 5.2: Add `_synthesise_resp_signal` helper (module-level, before the `@app.websocket` decorator)**

Add after the imports, as a module-level function:

```python
def _synthesise_resp_signal(duration_s: float, rf_bpm: float, fs: float = 25.0) -> np.ndarray:
    """Generate ideal sinusoidal resp signal at rf_bpm for coherence computation.
    Used in Phase 0 where breathing is guided and the resp waveform is known.
    Phase 0 resp is synthesised — never relies on empty _resp_buffer.
    """
    t = np.arange(0, duration_s, 1.0 / fs)
    freq_hz = rf_bpm / 60.0
    return np.sin(2 * np.pi * freq_hz * t)
```

- [ ] **Step 5.3: Add `_run_phase1_passive_scan` coroutine (module-level)**

Add after `_synthesise_resp_signal`:

```python
async def _run_phase1_passive_scan(
    websocket,
    user_id: str,
    rr_buffer: list,
    rf_row: dict,
) -> None:
    """Phase 1: silent background scan of prior±0.5 and prior±1.0 bpm.
    Uses natural breathing (no guide tone). 4 candidates × 30s each.
    Updates rf_calibration if coherence improves >= 10% relative.
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

    try:
        await websocket.send_json({"type": "scan_update", "status": "personalising"})
    except Exception:
        return

    best_bpm = current_rf
    best_coh = current_coh

    for cand_bpm in candidates:
        window_start = time.time()

        # Collect PHASE1_WINDOW_S seconds of natural-breathing RR
        while time.time() - window_start < PHASE1_WINDOW_S:
            await asyncio.sleep(1.0)

        window_rr = list(rr_buffer)
        if len(window_rr) < 15:
            continue

        # No guided resp available — synthesise at cand_bpm as conservative baseline
        resp_arr = _synthesise_resp_signal(PHASE1_WINDOW_S, cand_bpm)
        coh = compute_coherence_at_frequency(window_rr[-60:], resp_arr, cand_bpm)

        if coh > best_coh:
            best_bpm = cand_bpm
            best_coh = coh

    # Only update if improvement >= 10% relative
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

- [ ] **Step 5.4: Replace Phase 0 calibration block in `ws_session`**

Locate the `if cal_active:` block that starts with `CAL_DWELL_S = 30.0` (around line 249). Replace the entire block up to and including the `return` or fallthrough after `cal_done` is sent:

```python
    if cal_active:
        # ============================================================
        # PHASE 0: single-frequency guided breathing — 90s fixed
        # ============================================================
        CAL_DWELL_S = 90.0   # min 6 cycles at 4.5 bpm (worst case) + margin
        CAL_CAP_S   = 90.0   # Phase 0 is exactly 90s — no frequency sweep

        # Build optimizer with profile-derived prior (Iizawa 2024 formula)
        _profile = await db.get_profile(user_id)
        if _profile:
            _prior_bpm = compute_prior_rf_bpm(_profile.sex, _profile.height_cm)
            rf_optimizer = BayesianRFOptimizer(
                sex=_profile.sex,
                height_cm=_profile.height_cm,
                prior_rf=_prior_bpm,
            )
        else:
            _prior_bpm = 5.5
            rf_optimizer = BayesianRFOptimizer()

        cal_start_t      = time.time()
        target_bpm       = rf_optimizer.f0        # Iizawa-derived starting frequency
        coherence_so_far = 0.0
        _prior_bpm_value = rf_optimizer.f0

        # Send initial target so frontend can start orb + audio immediately
        try:
            await websocket.send_json({
                "cal": True,
                "target_bpm": round(float(target_bpm), 2),
                "coherence_so_far": 0.0,
                "dwell_remaining": CAL_DWELL_S,
                "elapsed": 0.0,
                "n_rr": 0,
            })
        except Exception:
            pass

        try:
            while True:
                now = time.time()
                elapsed_s = now - cal_start_t
                if elapsed_s >= CAL_CAP_S:
                    break

                # Drain ~1s of incoming WS messages to gather RR intervals
                drain_end = now + 1.0
                while time.time() < drain_end:
                    try:
                        msg = await asyncio.wait_for(
                            websocket.receive_json(), timeout=0.1
                        )
                        if isinstance(msg.get("rr"), (int, float)):
                            rr_val = float(msg["rr"])
                            r = flt.push(rr_val)
                            if r.accepted is not None:
                                proc.push(r.accepted)
                                _rr_buffer.append(r.accepted)
                        if isinstance(msg.get("resp_amp"), (int, float)):
                            _resp_buffer.append(float(msg["resp_amp"]))
                        if msg.get("cmd") == "discard":
                            raise WebSocketDisconnect()
                    except asyncio.TimeoutError:
                        break

                # Coherence: use synthesised resp signal (guide timing is known)
                if len(_rr_buffer) >= 15:
                    _synth_resp = _synthesise_resp_signal(elapsed_s, target_bpm)
                    coherence_so_far = compute_coherence_at_frequency(
                        _rr_buffer, _synth_resp, target_bpm
                    )

                # Compute live HRV for display
                _cm = proc.compute()

                # Emit cal frame ~1Hz
                try:
                    await websocket.send_json({
                        "cal": True,
                        "target_bpm": round(float(target_bpm), 2),
                        "coherence_so_far": round(float(coherence_so_far), 3),
                        "dwell_remaining": max(0.0, CAL_DWELL_S - elapsed_s),
                        "elapsed": round(elapsed_s, 1),
                        "n_rr": len(_rr_buffer),
                        "hrv": {
                            "rmssd": round(_cm.rmssd, 1),
                            "sdnn":  round(_cm.sdnn,  1),
                            "hr":    round(_cm.hr,    1),
                            "artifact_rate": round(_cm.artifact_rate, 4),
                        } if _cm is not None else None,
                    })
                except Exception:
                    break

        except WebSocketDisconnect:
            pass

        # Determine confidence tag from final coherence
        rf_bpm = target_bpm   # Phase 0 does not sweep frequencies
        rf_coherence = coherence_so_far
        if coherence_so_far >= _rf_config["min_coherence_lock"]:
            confidence_tag = "DRAFT"
            rf_locked = True
        else:
            confidence_tag = "UNVALIDATED"
            rf_locked = False

        # Harvest HRV snapshot for baseline quality check
        cal_metrics = proc.compute()
        cal_duration_s = round(time.time() - cal_start_t, 1)
        if cal_metrics is not None:
            cal_hrv = {
                "sensor_mode": current_mode,
                "rmssd_median": round(cal_metrics.rmssd, 2),
                "hr_mean": round(cal_metrics.hr, 1),
                "rr_count": cal_metrics.n_rr,
                "artifact_rate": round(cal_metrics.artifact_rate, 4),
                "mean_sqi": round(cal_metrics.mean_sqi, 4),
                "hr_drift_bpm": round(cal_metrics.hr_drift_bpm, 2),
                "duration_s": cal_duration_s,
            }
        else:
            cal_hrv = {
                "sensor_mode": current_mode,
                "rmssd_median": None,
                "hr_mean": None,
                "rr_count": len(_rr_buffer),
                "artifact_rate": 1.0,
                "mean_sqi": 0.0,
                "hr_drift_bpm": 0.0,
                "duration_s": cal_duration_s,
            }

        # Persist rf_calibration row
        baseline_eligible = False
        try:
            await db.upsert_rf_calibration(user_id, {
                "rf_bpm": round(float(rf_bpm), 2),
                "confidence_tag": confidence_tag,
                "phase": 0,
                "coherence": round(float(rf_coherence), 3),
                "rsa_amplitude": None,
                "sessions_at_rf": 0,
                "prior_bpm": round(float(_prior_bpm_value), 2),
            })
            await db.update_profile_rf(user_id, rf_bpm, confidence_tag)
        except Exception:
            pass  # DB failure must not block cal_done delivery

        # Baseline quality check (existing logic — unchanged)
        try:
            from .baseline_engine import quality_check, recompute_baseline_from_sessions
            ok, _reason, weight = quality_check(cal_hrv, is_calibration=True)
            if ok and os.environ.get("DATABASE_URL"):
                cal_hrv["baseline_weight"] = round(weight, 4)
                cal_hrv["baseline_eligible"] = True
                await db.create_session_row(user_id, {
                    **cal_hrv,
                    "session_type": "calibration",
                    "baseline_excluded_reason": None,
                })
                profile_obj = await db.get_profile(user_id)
                if profile_obj is not None:
                    eligible_sessions = await db.get_eligible_sessions(user_id)
                    profile_dict = {
                        "age": profile_obj.age,
                        "sex": profile_obj.sex,
                        "height_cm": profile_obj.height_cm,
                        "weight_kg": float(profile_obj.weight_kg) if profile_obj.weight_kg is not None else None,
                        "resting_hr": profile_obj.resting_hr,
                    }
                    new_baseline = recompute_baseline_from_sessions(profile_dict, eligible_sessions)
                    await db.upsert_baseline(user_id, {
                        "rmssd_mean": new_baseline.rmssd_mean,
                        "rmssd_sd": new_baseline.rmssd_sd,
                        "rmssd_min": new_baseline.rmssd_min,
                        "rmssd_max": new_baseline.rmssd_max,
                        "source": new_baseline.source,
                        "n_sessions_used": new_baseline.n_sessions_used,
                        "posterior_precision": new_baseline.posterior_precision,
                    })
                    baseline_eligible = True
        except Exception:
            pass

        try:
            await websocket.send_json({
                "cal_done": True,
                "rf_bpm": round(float(rf_bpm), 2),
                "rf_locked": bool(rf_locked),
                "rf_coherence": round(float(rf_coherence), 3),
                "confidence_tag": confidence_tag,
                "prior_bpm": round(float(_prior_bpm_value), 2),
                "cal_hrv": cal_hrv,
                "baseline_eligible": baseline_eligible,
            })
        except Exception:
            pass
        return
```

- [ ] **Step 5.5: Add Phase 1 passive scan trigger to session message loop**

Inside the session WS message-drain loop (the block that processes incoming `msg` dicts during the active session), add the Phase 1 trigger after existing message handlers:

```python
# Phase 1 passive scan — triggered by Dashboard when H10 stays connected
if msg.get("type") == "passive_scan_start":
    _rf_row = await db.get_rf_calibration(user_id)
    if _rf_row and _rf_row["confidence_tag"] in ("DRAFT", "UNVALIDATED"):
        asyncio.create_task(
            _run_phase1_passive_scan(
                websocket, user_id, _rr_buffer, _rf_row
            )
        )
```

- [ ] **Step 5.6: Add Phase 2 session hook**

After the `cal_active` block (in the section that sets up the session loop variables), add Phase 2 state initialization:

```python
# Phase 2 state — load RF row, enable RSA measurement during first 90s
PHASE2_WINDOW_S = 90.0
_phase2_active = False
_phase2_rsa_window_start: float | None = None
_rf_row_p2 = None
if not cal_active:  # Phase 2 only runs in real sessions, not during Phase 0
    try:
        _rf_row_p2 = await db.get_rf_calibration(user_id)
        if _rf_row_p2 and _rf_row_p2["confidence_tag"] in ("DRAFT", "REFINED"):
            _phase2_active = True
            _phase2_rsa_window_start = time.time()
    except Exception:
        pass
```

Inside the **1Hz session loop** after HRV metrics are computed (after `metrics = proc.compute()` or equivalent), add:

```python
# Phase 2: measure RSA amplitude during first 90s of session
if _phase2_active and _phase2_rsa_window_start is not None:
    if time.time() - _phase2_rsa_window_start >= PHASE2_WINDOW_S:
        _phase2_active = False   # stop measuring — one measurement per session
        _rsa = compute_rsa_amplitude(_rr_buffer, rf_bpm)

        try:
            _rf_row_now = await db.get_rf_calibration(user_id)
            _sessions_at_rf = int((_rf_row_now or {}).get("sessions_at_rf") or 0)
            _current_tag = (_rf_row_now or {}).get("confidence_tag", "DRAFT")

            if _rsa >= PHASE2_RSA_THRESHOLD:
                _sessions_at_rf += 1

            if _sessions_at_rf >= PHASE2_SESSIONS_TO_CONFIRM and _current_tag != "CONFIRMED":
                _current_tag = "CONFIRMED"

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
            pass  # DB failure must not degrade session
```

- [ ] **Step 5.7: Verify main.py still imports cleanly**

```bash
cd C:\Users\user\Desktop\mission_alive && python -c "from backend.main import app; print('import ok')"
```

Expected output: `import ok`

- [ ] **Step 5.8: Run all backend tests**

```bash
python -m pytest backend/tests/ -v --tb=short 2>&1 | tail -30
```

Expected: all tests pass. Fix any failures before proceeding.

- [ ] **Step 5.9: Commit**

```bash
git add backend/main.py
git commit -m "feat(calibration): Phase 0 single-frequency 90s block with synthesised resp, Phase 1 passive scan coroutine, Phase 2 RSA session hook"
```

---

## Task 6: Fix `frontend/src/audio/breath_actuator.js` I:E ratio

**Files:**
- Modify: `frontend/src/audio/breath_actuator.js`

One surgical change: replace `halfMs = periodMs / 2` with correct 40/60 split using static class constants.

- [ ] **Step 6.1: Apply I:E ratio fix**

Replace the entire `_cycle()` method and add static class constants:

```javascript
// Add BEFORE the constructor:
static INHALE_RATIO = 0.4;   // 40% inhale — parasympathetic correct
static EXHALE_RATIO = 0.6;   // 60% exhale — extended exhale activates vagal tone

// Replace _cycle() method entirely:
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

Also update `setRF` and `start` bounds to match the new clinical range:

```javascript
// In start():
this._rfBpm = Math.max(4.5, Math.min(6.5, rfBpm));   // was 4.0 / 8.5

// In setRF():
this._rfBpm = Math.max(4.5, Math.min(6.5, rfBpm));   // was 4.0 / 8.5
```

- [ ] **Step 6.2: Verify build passes**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds with no errors.

- [ ] **Step 6.3: Commit**

```bash
git add frontend/src/audio/breath_actuator.js
git commit -m "fix(audio): correct I:E ratio to 40% inhale / 60% exhale in BreathActuator._cycle; update RF bounds to clinical 4.5-6.5"
```

---

## Task 7: Fix `frontend/src/pages/Calibration.jsx` — I:E ratio + orb sync + audio integration

**Files:**
- Modify: `frontend/src/pages/Calibration.jsx`

Four changes: I:E ratio swap, CSS keyframe peak at 40%, BreathActuator init with `requestAnimationFrame` sync, cleanup on unmount.

- [ ] **Step 7.1: Fix I:E ratio in computed values (line ~205-207)**

Replace:
```jsx
const inhaleS = (periodS * 0.6).toFixed(2);
const exhaleS = (periodS * 0.4).toFixed(2);
```

With:
```jsx
const inhaleS = (periodS * 0.4).toFixed(2);   // 40% inhale — parasympathetic correct
const exhaleS = (periodS * 0.6).toFixed(2);   // 60% exhale — extended exhale = vagal tone
```

- [ ] **Step 7.2: Fix CSS keyframe `calBreathe` — peak at 40% of period**

In the `<style>` block, replace the existing `@keyframes calBreathe` with:

```css
@keyframes calBreathe {
  0%   { transform: scale(0.72); opacity: 0.55; }
  40%  { transform: scale(1.15); opacity: 1.00; }
  100% { transform: scale(0.72); opacity: 0.55; }
}
```

This places the peak (full inhale) at 40% of the animation period, matching the corrected I:E ratio.

- [ ] **Step 7.3: Add BreathActuator import and ref**

At the top of `Calibration.jsx`, add the import:

```jsx
import { BreathActuator } from '../audio/breath_actuator.js';
```

Add `actuatorRef` to the existing refs block (near `wsRef`, `fusionRef`, etc.):

```jsx
const actuatorRef = useRef(null);
```

- [ ] **Step 7.4: Start BreathActuator in sync with orb on first cal frame**

In `handleMsg`, after the block that processes a `cal` frame, find where `setStatus('sweeping')` is called (inside the WS `open` handler). After that `setStatus` call, add:

```jsx
setStatus('sweeping');
// Start audio on next frame so React has committed the orb animation.
// requestAnimationFrame ensures orb CSS and audio tone start in the same frame.
requestAnimationFrame(() => {
    if (!actuatorRef.current) {
        actuatorRef.current = new BreathActuator();
    }
    // target_bpm comes from the first cal frame received immediately after cal_start
    // Use msg.target_bpm if available; fallback to state targetBpm
    actuatorRef.current.start(msg.target_bpm ?? targetBpm);
});
```

Wait — the `setStatus('sweeping')` is in the WS `open` handler, which fires before the first cal frame. The actual target_bpm arrives in the first `cal` frame message. Move the audio start to `handleMsg` when `msg.cal === true` AND audio not yet started:

```jsx
// In handleMsg, inside the `if (msg.cal === true)` block, after setTargetBpm:
if (typeof msg.target_bpm === 'number') {
    setTargetBpm(msg.target_bpm);
    // Sync audio start to first cal frame — only once
    if (!actuatorRef.current) {
        requestAnimationFrame(() => {
            actuatorRef.current = new BreathActuator();
            actuatorRef.current.start(msg.target_bpm);
        });
    } else {
        actuatorRef.current.setRF(msg.target_bpm);
    }
}
```

- [ ] **Step 7.5: Stop BreathActuator on unmount and on cal_done**

In the existing `useEffect` cleanup return:

```jsx
return () => {
    cancelled = true;
    clearInterval(sendIvRef.current);
    try { wsRef.current?.close(); } catch (_) {}
    actuatorRef.current?.stop();  // ADD THIS LINE
    // Do NOT stop fusion — it carries into the session
};
```

In `handleMsg` when `msg.cal_done === true`, before the `setTimeout(() => onLocked(...))` call:

```jsx
if (msg.cal_done === true) {
    // ... existing setRfBpm, setStatus calls ...
    clearInterval(sendIvRef.current);
    try { wsRef.current?.close(); } catch (_) {}
    actuatorRef.current?.stop();   // ADD THIS LINE — stop audio on cal complete
    setTimeout(() => onLocked(bpm, locked), 1200);
}
```

- [ ] **Step 7.6: Verify build passes**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 7.7: Commit**

```bash
git add frontend/src/pages/Calibration.jsx
git commit -m "fix(calibration-ui): correct I:E to 40/60, CSS keyframe peak at 40%, sync BreathActuator start to first cal frame via requestAnimationFrame, stop audio on unmount/cal_done"
```

---

## Task 8: Create `frontend/src/pages/Dashboard.jsx` — Phase 1 passive scan

**Files:**
- Create: `frontend/src/pages/Dashboard.jsx`

New component. Displays `rf_bpm` and `confidence_tag`, runs Phase 1 passive scan when H10 is connected and calibration is not yet CONFIRMED.

- [ ] **Step 8.1: Create `Dashboard.jsx`**

Create `frontend/src/pages/Dashboard.jsx`:

```jsx
/**
 * Dashboard — shows RF calibration status and runs Phase 1 passive scan.
 *
 * Phase 1: when H10 is connected and confidence_tag is UNVALIDATED or DRAFT,
 * opens a background WS and sends {"type": "passive_scan_start"}.
 * Shows "personalising" pill while scan runs.
 * Shows "Your breathing profile just updated" toast (2s) on improvement.
 *
 * Props:
 *   cfg      — {session, backendMode, timezone, sensorMode}
 *   rfRow    — {rf_bpm, confidence_tag} from rf_calibration Supabase table (nullable)
 *   h10Connected — boolean
 *   onStartSession — () => void
 */
import { useEffect, useRef, useState } from 'react';
import { WSClient } from '../utils/ws_client.js';
import { supabase } from '../lib/supabase.js';

// ---------------------------------------------------------------------------
// Phase 1 passive scan hook
// ---------------------------------------------------------------------------
function usePassiveScan({ rfTag, h10Connected, session, backendMode, timezone }) {
    const [scanning, setScanning] = useState(false);
    const [scanImproved, setScanImproved] = useState(false);
    const wsRef = useRef(null);
    const hasScannedRef = useRef(false);   // run only once per Dashboard mount

    useEffect(() => {
        if (!h10Connected) return;
        if (!rfTag || !['UNVALIDATED', 'DRAFT'].includes(rfTag)) return;
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
                        if (msg.improved === true) setScanImproved(true);
                        try { wsRef.current?.close(); } catch (_) {}
                    }
                },
                { timezone, noReconnect: true }
            );
            wsRef.current = ws;
            ws.connect();

            // Wait for WS to open, then send passive_scan_start
            const bindOpen = () => {
                if (!ws.ws) { setTimeout(bindOpen, 20); return; }
                ws.ws.addEventListener('open', () => {
                    ws.send({ type: 'passive_scan_start' });
                });
            };
            bindOpen();
        }

        startScan().catch(console.warn);

        return () => {
            try { wsRef.current?.close(); } catch (_) {}
        };
    }, [h10Connected, rfTag]);  // eslint-disable-line react-hooks/exhaustive-deps

    return { scanning, scanImproved, dismissImproved: () => setScanImproved(false) };
}

// ---------------------------------------------------------------------------
// Scan-improved toast (auto-dismisses after 2s)
// ---------------------------------------------------------------------------
function ScanImprovedToast({ onDismiss }) {
    useEffect(() => {
        const t = setTimeout(onDismiss, 2000);
        return () => clearTimeout(t);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div style={{
            position: 'fixed', bottom: 56, right: 16, left: 16, margin: '0 auto',
            maxWidth: 320,
            background: 'rgba(0,208,132,0.15)',
            border: '1px solid rgba(0,208,132,0.4)',
            borderRadius: 12, padding: '10px 16px',
            fontSize: 13, color: 'rgba(0,208,132,0.95)',
            backdropFilter: 'blur(8px)',
            textAlign: 'center',
            animation: 'fadeInUp 300ms ease',
        }}>
            Your breathing profile just updated
        </div>
    );
}

// ---------------------------------------------------------------------------
// Confidence tag pill
// ---------------------------------------------------------------------------
function ConfidencePill({ tag }) {
    const colors = {
        UNVALIDATED: 'rgba(239,159,39,0.8)',
        DRAFT:       'rgba(124,111,247,0.8)',
        REFINED:     'rgba(0,208,132,0.8)',
        CONFIRMED:   'rgba(0,208,132,1.0)',
    };
    const color = colors[tag] ?? 'rgba(255,255,255,0.4)';
    return (
        <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase', color,
            border: `1px solid ${color}`,
            borderRadius: 6, padding: '2px 7px',
        }}>
            {tag ?? '—'}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Dashboard component
// ---------------------------------------------------------------------------
export default function Dashboard({ cfg, rfRow, h10Connected, onStartSession }) {
    const { session, backendMode, timezone } = cfg ?? {};

    const { scanning, scanImproved, dismissImproved } = usePassiveScan({
        rfTag: rfRow?.confidence_tag,
        h10Connected: !!h10Connected,
        session,
        backendMode,
        timezone,
    });

    return (
        <div style={{
            minHeight: '100dvh',
            background: 'var(--bg)',
            color: 'var(--text)',
            display: 'flex',
            flexDirection: 'column',
            padding: '24px 20px',
        }}>
            <style>{`
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(8px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>

            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 22, marginBottom: 4 }}>
                Dashboard
            </div>

            {/* RF calibration status card */}
            {rfRow && (
                <div style={{
                    marginTop: 24,
                    padding: '16px 18px',
                    background: 'var(--surface, rgba(255,255,255,0.04))',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 14,
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Resonance Frequency
                        </span>
                        <ConfidencePill tag={rfRow.confidence_tag} />
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-head)', fontVariantNumeric: 'tabular-nums' }}>
                        {rfRow.rf_bpm?.toFixed(1)} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-dim)' }}>bpm</span>
                    </div>
                </div>
            )}

            {/* Start session button */}
            <button
                onClick={onStartSession}
                style={{
                    marginTop: 32,
                    width: '100%',
                    padding: '16px 0',
                    background: 'var(--primary, #7C6FF7)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 14,
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: 'pointer',
                }}
            >
                Start Session
            </button>

            {/* Phase 1 passive scan pill */}
            {scanning && (
                <div style={{
                    position: 'fixed', bottom: 24, right: 16,
                    background: 'rgba(124,111,247,0.15)',
                    border: '1px solid rgba(124,111,247,0.3)',
                    borderRadius: 20, padding: '6px 14px',
                    fontSize: 11, color: 'rgba(124,111,247,0.9)',
                    backdropFilter: 'blur(8px)',
                    pointerEvents: 'none',
                }}>
                    personalising
                </div>
            )}

            {scanImproved && <ScanImprovedToast onDismiss={dismissImproved} />}
        </div>
    );
}
```

- [ ] **Step 8.2: Verify build passes**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 8.3: Commit**

```bash
git add frontend/src/pages/Dashboard.jsx
git commit -m "feat(dashboard): Phase 1 passive scan subscriber — personalising pill, scan-improved toast, RF confidence display"
```

---

## Task 9: Phase 0 one-time guard in `App.jsx`

**Files:**
- Modify: `frontend/src/App.jsx`

Add a Supabase check: if `rf_calibration` row exists for the current user, skip the Calibration screen and go straight to the dashboard (or session).

- [ ] **Step 9.1: Locate the screen routing logic in `App.jsx`**

Find where `App.jsx` decides to show the `calibration` screen. It will look like a `setScreen('calibration')` call or a `screen === 'calibration'` branch.

- [ ] **Step 9.2: Add rf_calibration check before showing Calibration**

In the function that decides whether to show Calibration (typically called after profile setup completes), add:

```jsx
// Before navigating to calibration, check if rf_calibration row already exists
async function checkAndNavigateToCalibration() {
    if (supabase) {
        try {
            const userId = (await supabase.auth.getUser()).data.user?.id;
            if (userId) {
                const { data: rfRow } = await supabase
                    .from('rf_calibration')
                    .select('rf_bpm, confidence_tag')
                    .eq('user_id', userId)
                    .single();

                if (rfRow?.rf_bpm) {
                    // Phase 0 already done — use stored rf_bpm
                    setCfg(prev => ({ ...prev, rfBpm: rfRow.rf_bpm, rfConfidence: rfRow.confidence_tag }));
                    setScreen('dashboard');   // or whichever screen follows calibration
                    return;
                }
            }
        } catch (_) {
            // Network failure — fall through to calibration
        }
    }
    setScreen('calibration');
}
```

Replace bare `setScreen('calibration')` calls with `checkAndNavigateToCalibration()`.

Note: `supabase` is already imported in `App.jsx`. The exact screen name following calibration depends on the existing App routing — check the current code and use the matching screen name (likely `'session'`, `'dashboard'`, or `'home'`).

- [ ] **Step 9.3: Verify build passes**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 9.4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(app): skip Phase 0 calibration if rf_calibration row already exists in Supabase"
```

---

## Task 10: Full verification checklist

Run all checks from the spec's §15 Verification Checklist before merging.

- [ ] **Step 10.1: Run full backend test suite**

```bash
cd C:\Users\user\Desktop\mission_alive && python -m pytest backend/tests/ -v 2>&1 | tail -40
```

Expected: all pass.

- [ ] **Step 10.2: Run spec verification assertions manually**

```bash
python -c "
from backend.rf_calibration import compute_prior_rf_bpm, compute_rsa_amplitude
import numpy as np

# §15 checks
assert compute_prior_rf_bpm('male', 175) == 5.5, 'male 175 failed'
assert compute_prior_rf_bpm('female', 165) == 6.0, 'female 165 failed'
assert compute_prior_rf_bpm('male', 190) == 4.5, 'male 190 failed'

# RSA insufficient data
assert compute_rsa_amplitude([800.0]*10, 6.0) == 0.0, 'rsa short data failed'
assert compute_rsa_amplitude([800.0]*30, 6.0) == 0.0, 'rsa short duration failed'

# RSA known amplitude ≥ 8
rf_bpm = 5.0; fs = 4.0; dur = 120.0
t = np.arange(0, dur, 1/fs)
hr = 60.0 + 5.0*np.sin(2*np.pi*(rf_bpm/60)*t)
rr = list((60.0/hr)*1000)
amp = compute_rsa_amplitude(rr, rf_bpm)
assert amp >= 8.0, f'rsa known amplitude failed: {amp}'

print('ALL §15 BACKEND ASSERTIONS PASSED')
"
```

Expected output: `ALL §15 BACKEND ASSERTIONS PASSED`

- [ ] **Step 10.3: Verify frontend build is clean**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 10.4: Manual smoke test — Phase 0 flow**

Start backend and frontend locally:

```bash
# Terminal 1:
cd C:\Users\user\Desktop\mission_alive && python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Terminal 2:
cd C:\Users\user\Desktop\mission_alive\frontend && npm run dev -- --host 0.0.0.0
```

On phone or desktop:
1. Open app → complete ProfileSetup if needed.
2. Verify Calibration screen shows at first launch.
3. Verify orb breathes at 40% peak — count: should peak before the halfway point of each cycle.
4. Listen: audio inhale tone should be shorter than exhale silence (40/60 split).
5. Wait ~90s → `cal_done` message → locked confirmation shown.
6. Reload app → verify Calibration screen is skipped (goes to dashboard/session directly).

- [ ] **Step 10.5: Commit final state tag**

```bash
git add -A
git commit -m "chore: calibration progressive RF discovery — all tasks complete, spec §15 verified"
git tag calibration-v2.0
```

---

## Rollback Plan

If Phase 0 WS handler produces regressions in integration (e.g., cal_done never fires):

1. The only surgical change to the WS handler is inside `if cal_active:` — the session path is unchanged.
2. Revert `main.py` to pre-task-5 commit: `git revert HEAD~N --no-edit` where N covers Task 5 commits.
3. `rf_calibration.py` changes (Task 2) are purely additive — no rollback needed unless tests fail.
4. Migration 002 is non-destructive (CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS) — cannot roll back the schema addition without a DROP, which requires a manual Supabase intervention.

---

## Constants Quick Reference

| Constant | Value | File |
|----------|-------|------|
| `RF_SEARCH_MIN` | 4.5 bpm | `rf_calibration.py` |
| `RF_SEARCH_MAX` | 6.5 bpm | `rf_calibration.py` |
| `CAL_DWELL_S` / `CAL_CAP_S` | 90.0 s | `main.py` (Phase 0) |
| `PHASE0_COHERENCE_DRAFT` | 0.6 | `main.py` (from MODE_CALIBRATION_CONFIG) |
| `PHASE1_WINDOW_S` | 30.0 s | `rf_calibration.py` |
| `PHASE1_MIN_COHERENCE_IMPROVEMENT` | 0.10 (10%) | `rf_calibration.py` |
| `PHASE2_RSA_THRESHOLD` | 8.0 bpm | `rf_calibration.py` |
| `PHASE2_SESSIONS_TO_CONFIRM` | 3 | `rf_calibration.py` |
| `INHALE_RATIO` | 0.4 | `breath_actuator.js` (static) |
| `EXHALE_RATIO` | 0.6 | `breath_actuator.js` (static) |
| `RSA_MIN_CYCLES` | 6 | `rf_calibration.py` (in `compute_rsa_amplitude`) |
