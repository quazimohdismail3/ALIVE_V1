# H10 Gold Standard + Personal Baselines + Stats — Design Spec

**Date:** 2026-04-30
**Author:** Lead architect (Mission Alive)
**Scope:** P1–P4 implementation plan covering Supabase migration, profile capture, calibration HRV harvest, Bayesian baseline math, control loop retune, and full Stats/Insights surface.
**Related memory:**
- `reference_psyche-design-language.md` — UX system (read first)
- `project_rag-deferred-phase2.md` — insights are rule-based for ship; RAG deferred
- `feedback_subtle-ui-pulsating.md` — internal control values stay backstage
- Memory #1317 — body-as-music-generator (NON-NEGOTIABLE)
- `v2-roadmap.md` — V2.8/V2.9 lineage

---

## 1. Architecture overview

```
                            ┌────────────────────────────────────┐
                            │  Supabase Postgres (RLS per user)  │
                            │  + Auth (already wired)            │
                            ├────────────────────────────────────┤
                            │  user_profiles                     │
                            │  user_baselines                    │
                            │  sessions                          │
                            │  session_rr_segments               │
                            │  session_metric_snapshots          │
                            │  insight_events                    │
                            └────────────────────────────────────┘
                                         ▲
                                         │  asyncpg
                                         │
   Frontend (React)                Backend (FastAPI)
   ─────────────────                ────────────────
   LoginScreen ✓                    /ws/session  (extended)
   ProfileSetup (NEW)               /api/profile (GET/PUT)
   Landing (touched)                /api/baseline (GET, recompute on session-end)
   Setup (touched)                  /api/sessions (GET list + per-session detail)
   Calibration (psyche §3.5)        /api/insights (GET rule-based)
     ├ RF sweep (existing)
     └ HRV harvest (NEW)
   Session (coupling cues)
   Stats (NEW)
   SessionDetail (NEW, w/ Soundscape)
   Insight (extended)
```

### Module boundaries

**Backend (Python, FastAPI):**
- `db.py` — extend with profile/baseline/sessions tables, asyncpg
- `baseline_engine.py` — NEW. Cold-start (Umetani+Nunan), Bayesian update, quality gating, walk-forward 14d
- `hrv_processor.py` — extend: emit per-cycle artifact_rate, mean_sqi, hr_drift_bpm
- `rf_calibration.py` — calibration loop returns final HRVMetrics + quality block
- `config.py` — add baseline tunables, dynamic-alpha thresholds, mark new control gains UNTUNED
- `state_estimation.py` — replace static EMA with dynamic alpha gate
- `insight_engine.py` — extend rule library R1–R10 with citations
- `main.py` — wire endpoints, persist baseline-relevant fields on session end

**Frontend (React, Vite):**
- `pages/ProfileSetup.jsx` — NEW. Post-signup wizard (one-question-per-screen)
- `pages/Stats.jsx` — NEW. Full stats surface
- `pages/SessionDetail.jsx` — NEW. Drill-down + Soundscape ribbons + tap-to-scrub
- `pages/Calibration.jsx` — extend per psyche §3.5
- `pages/Session.jsx` — add coupling cues (music ribbon, R-peak HR scale, one-time hint)
- `pages/Insight.jsx` — extend R1–R10
- `components/RecoveryDial.jsx`, `BaselineBandChart.jsx`, `StateRhythmChart.jsx`, `SoundscapeRibbons.jsx`, `ContributorBars.jsx`, `MoodTap.jsx`, `SessionRow.jsx` — NEW
- `lib/api.js` — NEW thin client over fetch + supabase JWT

### Reuse (do not rebuild)
- `BreathingOrb.jsx`, `CosmicBackground.jsx`, `FlowingWaves.jsx`, design system tokens, R-code framework in Insight.jsx, HrvChart pattern.

### Decision: per CLAUDE.md hardware-first rule
P3 control retune lands UNTUNED-marked behind feature flag `CONTROL_V2_ENABLED`. Hardware gate (≥3 H10 sessions) before flag removal.

---

## 2. Data model (Supabase Postgres)

```sql
-- 1. Profile (one row per auth user)
create table user_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  age              int  not null check (age between 13 and 100),
  sex              text not null check (sex in ('male','female','prefer_not_to_say')),
  height_cm        int  not null check (height_cm between 100 and 230),
  weight_kg        numeric(5,2),
  resting_hr       int check (resting_hr between 30 and 120),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 2. Baseline (recomputed after each accepted session)
create table user_baselines (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  rmssd_mean           numeric(6,2) not null,
  rmssd_sd             numeric(6,2) not null,
  rmssd_min            numeric(6,2) not null,
  rmssd_max            numeric(6,2) not null,
  hr_rest_mean         numeric(5,2),
  source               text not null check (source in ('cold_start','blended','personal')),
  n_sessions_used      int not null default 0,
  posterior_precision  numeric(10,4) not null,
  window_start         timestamptz,
  updated_at           timestamptz default now()
);

-- 3. Sessions (extends current SQLite schema)
create table sessions (
  session_id           uuid primary key,
  user_id              uuid not null references auth.users(id) on delete cascade,
  session_type         text not null,
  sensor_mode          int  not null,
  started_at           timestamptz not null,
  ended_at             timestamptz,
  duration_s           int,
  rmssd_start          numeric(6,2),
  rmssd_end            numeric(6,2),
  rmssd_median         numeric(6,2),
  rmssd_z              numeric(5,2),
  recovery_score       int check (recovery_score between 0 and 100),
  hr_mean              numeric(5,2),
  arousal_start        numeric(4,3),
  arousal_end          numeric(4,3),
  dominant_state       text,
  state_distribution   jsonb,
  rf_bpm               numeric(4,2),
  rf_locked            boolean,
  rr_count             int,
  artifact_rate        numeric(4,3),
  mean_sqi             numeric(4,3),
  hr_drift_bpm         numeric(5,2),
  baseline_eligible    boolean not null default false,
  baseline_excluded_reason text,
  baseline_weight      numeric(4,3),
  music_strategy       text,
  fallback_triggered   boolean default false,
  insight              text,
  post_mood            int check (post_mood between 1 and 5),
  discarded            boolean default false
);
create index sessions_user_started on sessions(user_id, started_at desc);

-- 4. RR segments
create table session_rr_segments (
  session_id   uuid not null references sessions(session_id) on delete cascade,
  t_offset_s   int  not null,
  rr_chunk     jsonb not null,
  primary key (session_id, t_offset_s)
);

-- 5. Per-cycle metric snapshots
create table session_metric_snapshots (
  session_id   uuid not null references sessions(session_id) on delete cascade,
  t_offset_s   int  not null,
  metrics_json jsonb not null,
  state_json   jsonb,
  params_json  jsonb,
  primary key (session_id, t_offset_s)
);

-- 6. Insight events
create table insight_events (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid references sessions(session_id) on delete cascade,
  rule_id      text not null,
  payload      jsonb not null,
  rendered     text not null,
  created_at   timestamptz default now()
);
create index insight_events_user_time on insight_events(user_id, created_at desc);

-- RLS
alter table user_profiles      enable row level security;
alter table user_baselines     enable row level security;
alter table sessions           enable row level security;
alter table session_rr_segments enable row level security;
alter table session_metric_snapshots enable row level security;
alter table insight_events     enable row level security;
-- policies: select/insert/update/delete where user_id = auth.uid()
-- (rr_segments + snapshots: join via session ownership)
```

**Storage budget:** session_rr_segments at 30s chunks of ~30 RR @ 8 bytes ≈ 5 KB/session → 500 KB / 100 sessions / user. Affordable on Supabase free tier.

**SQLite migration:** archive existing local SQLite DB; do not migrate (pre-launch, no real users). Fresh schema in Supabase.

---

## 3. Calibration rework + HRV harvest

### Backend WS protocol extension

```
WS open → auth_ok → cal_start
  Backend: Bayesian RF sweep (existing), HRVProcessor snapshots every 5s

Every 1s, backend emits:
  cal_progress {
    target_bpm, dwell_remaining, coherence_so_far, elapsed,    # existing
    hrv: { rmssd, hr, sdnn, sd1_sd2_ratio, n_rr },             # NEW (when n_rr ≥ MIN_RR)
    quality: { artifact_rate, mean_sqi }                        # NEW
  }

cal_done extended:
  cal_done {
    rf_bpm, rf_locked,                                          # existing
    cal_hrv: {                                                  # NEW final harvest
      rmssd_median, hr_mean, sdnn, sd1_sd2_ratio,
      rr_count, artifact_rate, mean_sqi,
      duration_s, mode
    }
  }
```

### Calibration as mini-session

If `mode==2 AND cal_hrv.rr_count ≥ 100 AND cal_hrv.mean_sqi ≥ 0.7`:
- Persist as `sessions` row with `session_type='calibration'`
- Mark `baseline_eligible=true`
- Bayesian update applies normally
- First good calibration alone can graduate user from cold_start → blended

### Calibration screen — psyche-grade (final)

Layout: CosmicBackground + BreathingOrb (HR centered, scales 1.00→1.025 on R-peak) + faded HRV panel (n_rr ≥ MIN_RR gate) + soft microcopy phase library + "Use defaults this time" / "Take a break" buttons.

Coupling: BreathActuator 174Hz audio blooms with `mean_sqi`; one-time hint "The tone is following your breath" after first valid HRV; haptic milestones on first reading + lock + done.

Microcopy phase library — see psyche-design-language memory.

Failure modes per pipeline contracts:
| Failure | Behavior |
|---------|----------|
| H10 disconnect mid-cal | safety frame, BleH10 backoff retry 3×, on fail → cal_done with rf_locked=false, no cal_hrv |
| Artifact rate >20% | cal_done emitted, baseline_eligible=false, reason=artifacts |
| User skips | RF=5.5 default, no harvest |
| n_rr <100 | cal_done emitted, baseline_eligible=false, reason=too_short |

---

## 4. Baseline math + control loop retune

### 4a. Cold-start prior

```python
def cold_start_prior(profile) -> Tuple[float, float]:
    """Returns (mean_rmssd_ms, sd_rmssd_ms).
    Refs: Umetani 1998, Nunan 2010 meta, Voss 2015, Aubert 2003, Koenig 2014.
    """
    age, sex, height_cm, weight_kg, resting_hr = unpack(profile)
    ln_mean = 4.5 - 0.025 * age
    if sex == "female":
        ln_mean += 0.15
    if resting_hr is not None:
        ln_mean += 0.01 * (60 - resting_hr)
    if weight_kg is not None and height_cm is not None:
        bmi = weight_kg / ((height_cm/100) ** 2)
        if bmi > 30:
            ln_mean -= 0.10
    sigma = 0.35
    mean = math.exp(ln_mean)
    sd   = mean * (math.exp(sigma) - 1.0) / 2
    return mean, sd
```

### 4b. Quality gating (two-layer)

```python
HARD_REJECT_RULES = [
    ("wrong_mode",  lambda s: s.sensor_mode != 2),
    ("too_short",   lambda s: s.rr_count < 300),       # cal: 100
    ("artifacts",   lambda s: s.artifact_rate > 0.20),
    ("low_sqi",     lambda s: s.mean_sqi < 0.6),
    ("hr_drift",    lambda s: s.hr_drift_bpm > 40),
]
def quality_check(s):
    for reason, rule in HARD_REJECT_RULES:
        if rule(s):
            return False, reason, 0.0
    w = (1 - s.artifact_rate) * s.mean_sqi * min(1.0, s.rr_count/600)
    return True, None, max(0.0, min(1.0, w))
```

### 4c. Bayesian posterior + walk-forward 14d

```python
WINDOW_DAYS = 14

def recompute_baseline(user_id):
    profile = db.get_profile(user_id)
    mu_0, sd_0 = cold_start_prior(profile)
    var_0 = sd_0 ** 2
    tau_0 = 1.0 / var_0

    sessions = db.get_eligible_sessions(user_id, since=now() - 14d)
    tau_post = tau_0
    weighted_sum = mu_0 * tau_0
    for s in sessions:
        tau_i = s.baseline_weight / var_0
        tau_post     += tau_i
        weighted_sum += s.rmssd_median * tau_i
    mu_post  = weighted_sum / tau_post
    sd_post  = math.sqrt(1.0 / tau_post)

    n = len(sessions)
    source = "cold_start" if n == 0 else "blended" if n < 3 else "personal"

    return Baseline(
        rmssd_mean=mu_post, rmssd_sd=sd_post,
        rmssd_min=mu_post - sd_post, rmssd_max=mu_post + sd_post,
        source=source, n_sessions_used=n,
        posterior_precision=tau_post,
        window_start=now() - 14d,
    )
```

Prior never fully decays — anchors silently if user goes dark.

### 4d. Z-score + recovery

```python
def session_z(rmssd_session_median, baseline):
    return (rmssd_session_median - baseline.rmssd_mean) / baseline.rmssd_sd

def recovery_score(z):
    return int(round(100 / (1 + math.exp(-z)) ))  # z=-2→12, 0→50, +2→88
```

### 4e. Dynamic EMA alpha (replaces static 0.2)

```python
ALPHA_STABLE     = 0.10
ALPHA_TRANSITION = 0.45    # 0.3-0.5 spec range
VEL_THRESHOLD    = 0.05
VEL_BLEND_WIDTH  = 0.05

def dynamic_alpha(state_history):
    if len(state_history) < 4:
        return ALPHA_TRANSITION
    vel = sum(np.linalg.norm(state_history[-i] - state_history[-i-1])
              for i in range(1,4)) / 3.0
    s = 1.0 / (1.0 + math.exp(-(vel - VEL_THRESHOLD) / VEL_BLEND_WIDTH))
    return ALPHA_STABLE + (ALPHA_TRANSITION - ALPHA_STABLE) * s
```

### 4f. Sliding window validation (Q6 option C)

```python
# Layer A — RR-level
def validate_rr_window(rr_buffer_30):
    rmssd = compute_rmssd(rr_buffer_30)
    if not (SAFETY_RMSSD_LOW <= rmssd <= SAFETY_RMSSD_HIGH):
        return False, "rr_window_out_of_range"
    return True, None

# Layer B — state-level
def validate_state_delta(state_history_10):
    if len(state_history_10) < 2: return True, None
    delta = np.linalg.norm(state_history_10[-1] - state_history_10[-2])
    if delta > SAFETY_STATE_DELTA_MAX:
        return False, "state_delta_exceeds_max"
    return True, None
```

Both gates emit `safety` frame and trigger SafetySupervisor → SAFE_FALLBACK_PARAMS.

### 4g. Control loop retune — UNTUNED markers

```python
# config.py
# UNTUNED — pending ≥3 real H10 sessions (CLAUDE.md hardware-first decision tree)
KP_PROVISIONAL = 0.25                              # was 0.15
KD_PROVISIONAL = 0.40                              # was 0.8 (much less damping)
ALPHA_STABLE_PROVISIONAL     = 0.10
ALPHA_TRANSITION_PROVISIONAL = 0.45
EMA_ALPHA_DEFAULT_PROVISIONAL = 0.30

CONFIDENCE_GATE     = 0.75   # already correct
MIN_RR_FOR_METRICS  = 30     # already correct
```

Gated by `CONTROL_V2_ENABLED` feature flag until P3 acceptance passes.

### 4h. Per-cycle quality scalars

`HRVMetrics` adds: `artifact_rate`, `mean_sqi`, `hr_drift_bpm` — used by calibration `quality` block and session-end aggregates.

---

## 5. Stats + insights + screens

### 5a–5e. Stats.jsx zones

1. **Today** — RecoveryDial + RMSSD + baseline ± 1SD subtext + microcopy
2. **Last 14 days** — BaselineBandChart (line + ±1SD shaded band) + StateRhythmChart (5-color stacked area)
3. **Insights** — feed of top-N (≤4) by salience, R1–R10 templates with citations
4. **Sessions** — minimal Oura-style row list, tap → SessionDetail

### 5b. Recovery dial palette (NO clinical red)

| z | Score | Color | Microcopy |
|---|-------|-------|-----------|
| ≥+1 | 84–100 | Vibrant teal #3FBFA8 | "Open and ready" |
| 0..+1 | 50–84 | Soft teal #7DC2B5 | "Steady, in dialogue" |
| -1..0 | 27–50 | Warm peach #E8B963 | "Quietly recovering" |
| <-1 | 12–27 | Muted amber-grey #9C8A6E | "Your body's asking for rest today" |
| cold_start | — | Soft cyan-white | "Your baseline is forming — every session refines it" |

### 5e. Rule-based insight engine

Ten seed rules:
- R1 rmssd_trend_up
- R2 rmssd_trend_down
- R3 best_time_of_day
- R4 recovery_streak
- R5 baseline_locked
- R6 state_shift_ventral
- R7 rf_drift
- R8 session_dose_response
- R9 recovery_volatility
- R10 first_personal_session

Each template = numeric finding (units) + cited mechanism + behavioral framing. Salience = recency × magnitude × novelty. No repeat rule_id within 3 days.

### 5f. SessionDetail with Soundscape

RR series + HRV trajectory + ANS state strip + **Soundscape ribbons** (binaural Hz, carrier Hz, breath rate, all time-synced under RR series, tap-to-scrub plays 5s Tone.js offline-rendered audio from stored params_json) + vitals panel + baseline-eligibility transparency + per-session insight + closing line "This was your body's music."

### 5.5. Full screen catalog

See approved §5.5 in design conversation. Per-screen lineage:

| Screen | Lineage |
|--------|---------|
| Landing | Existing + Othership cinematic + Calm value prop. Tiny mini-recovery hero strip added |
| LoginScreen | Existing + post-signup redirect to ProfileSetup if profile null |
| ProfileSetup | NEW. Calm/Headspace one-question-per-screen cadence. age/sex/height required; weight + resting_hr optional |
| Setup | Existing + softened chrome + "We're connecting to your body" copy |
| Calibration | §3.5 final |
| Session | Existing + music-ribbon coupling cue + R-peak HR scale + one-time "music is following your breath" hint. Music params text panel removed |
| Stats | NEW. HRV4Training trend band + Oura contributors + Whoop weekly assessment + Welltory body-battery (sans clinical red) |
| SessionDetail | NEW. HeartMath waveform-as-feedback + Spotify scrub + Soundscape ribbons |
| Insight | Existing extended R1 → R1–R10. MoodTap (1-tap, optional, Sensate lineage) |

### 5g. API surface

```
GET  /api/profile          → 404 if missing → triggers ProfileSetup
PUT  /api/profile          → upsert + range validation
GET  /api/baseline         → current baseline (auto-recompute on stale window edge)
GET  /api/sessions?limit=20 → list (newest first), filter by mode/type
GET  /api/sessions/:id     → detail with rr_segments + snapshots + insight + scrub renderable
GET  /api/insights?limit=4 → top-N by salience
```

All RLS-gated by Supabase JWT.

---

## 6. Phasing + acceptance + risks

### Phases

| Phase | Branch | Scope | Gate |
|-------|--------|-------|------|
| P1 | `feat/p1-supabase-profile` | Supabase schema, RLS, asyncpg, /api/profile, ProfileSetup.jsx, archive SQLite | Profile E2E on prod, RLS verified, no SQLite reads |
| P2 | `feat/p2-baseline` | baseline_engine, HRVProcessor quality, calibration cal_hrv, Calibration.jsx psyche, /api/baseline, walk-forward | Calibration produces baseline, source can flip cold→blended→personal |
| P3 | `feat/p3-control-retune` | UNTUNED constants, dynamic_alpha, sliding window validators, SafetySupervisor wiring | ≥3 H10×10min sessions, oscillation count = 0, fallback values predefined |
| P4 | `feat/p4-stats-insights` | Stats.jsx, SessionDetail.jsx, all NEW components, R1–R10 extension, /api/sessions, /api/insights, Tone.js scrub | All charts render with fixtures, scrub plays correct audio, orphan cleanup, a11y verified |

### Per-phase acceptance criteria (full list in §6b above) summarized:
- P1: 6 tables created, RLS isolated across users, ProfileSetup E2E, no SQLite paths
- P2: cold-start fixture suite passes, quality_check rejects 5 fixtures, Bayesian posterior verifiable, calibration psyche §3.5 shipped, first H10 cal graduates user
- P3: hardware gate — 3 sessions × 10min on real H10. **Oscillation count = 0** measured *both* objectively (no music param delta exceeds 1.5× ramp budget per cycle, logged via audio engine telemetry) *and* subjectively (user smoke yes/no — audio felt smooth). Sliding windows verified (Layer A triggers on motion test, Layer B triggers on forced startle). Dynamic alpha verified: stable phase shows alpha ≈ 0.10, transition phase shows alpha ≈ 0.30–0.45.
- P4: components render with fixtures (synthetic JSON shipped in `frontend/test/fixtures/`), Stats <800ms with 50 fixture sessions, BaselineBand smooth shifts (800ms ease), Tone.js scrub render <300ms, recovery dial color spectrum verified (no red anywhere), MoodTap optional and persists to `sessions.post_mood`, prefers-reduced-motion honored on every animated component, 14 orphans (per memory obs #960) deleted after import audit. Demo prerequisite: at least one P2-graduated user with ≥3 sessions in DB to populate trend chart meaningfully.

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| RLS misconfigured → cross-user leak | CRITICAL | Same-migration policies; pytest 2-user isolation test |
| asyncpg pool exhaustion on Railway | HIGH | Pool cap 5, 30s timeout, lifecycle close |
| Cold-start prior off for outliers | MEDIUM | Posterior overrides on first H10 cal |
| Music oscillation from less-damped Kp/Kd | MEDIUM | UNTUNED, hardware gate, fallback KP=0.20 KD=0.55 predefined |
| Tone.js scrub render hangs | LOW | 500ms timeout, fallback "preview unavailable" |
| Audio bloom feels gimmicky | LOW | Volume cap 0.3, a11y mute toggle, off for prefers-reduced-motion |
| Profile capture friction kills signup | MEDIUM | 3 required fields only, 6 cards, Calm/Headspace cadence |
| Orphan components hide breakage | LOW | Import audit grep before delete in P4 |

### Out of scope

- RAG / LLM insights — phase-2 (`project_rag-deferred-phase2.md`)
- Stripe / monetization — V4
- Multi-tenant — V3
- H10 accelerometer respiration — future
- WHOOP/Oura/Apple Health imports — future
- Push notifications, native shells — future

### Test strategy

| Layer | Tool | Coverage |
|-------|------|----------|
| Backend unit | pytest | baseline_engine math, quality_check, dynamic_alpha, sliding-window validators |
| Backend integration | pytest + asyncpg | RLS isolation, walk-forward correctness |
| Frontend component | dev fixtures | RecoveryDial, BaselineBandChart, SoundscapeRibbons, MoodTap |
| E2E manual | Real H10 | P3 hardware gate, full round-trip |
| Visual a11y | DevTools | prefers-reduced-motion, WCAG AA |

---

## 7. Open invariants to honor

From CLAUDE.md + memory:
- Hardware-first: no tuning HRV/ANS without real H10 data → P3 UNTUNED markers + flag
- Surgical changes: no refactoring unbroken adjacent code
- No backwards-compat shims for removed constants
- Always push to GitHub after each phase commit (Railway+Vercel auto-deploy)
- Update LIVE STATE TABLE in CLAUDE.md after each phase

---

## 8. Next step

Per brainstorming skill: this spec → writing-plans skill → 4 implementation plans (one per phase) → executing-plans per phase with hardware gate at P3.
