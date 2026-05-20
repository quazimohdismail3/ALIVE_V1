# V3 ANS/Affect Classification Pipeline — Architecture Spec

**Date:** 2026-05-20  
**Status:** Draft — not approved for implementation until V2 complete  
**Scope:** Four subsystems replacing/augmenting V2 classifier stack  
**Prerequisite gate:** V2.1–V2.10 complete, ≥3 real H10 sessions per user in prod

---

## Context

V2 pipeline:

```
RR → HRVProcessor → HRVMetrics
         ↓ (parallel)
     StateEstimator.update()  →  StateVector (6D, EMA)
     ANSClassifier.classify()  →  ANSClassification (5 polyvagal)
     AffectClassifier          →  AffectClassification (Russell Q1–Q4)
         ↓
     MPCOptimizer  →  ForwardModel._EFFECTS (static)  →  14 music params
```

V2 known ceilings: forward model is hand-coded and never updates; state smoother is fixed-alpha EMA with no state memory; DFA is a 6-scale approximation; valence is proxied from SD1/SD2 with no ground truth; RMSSD baseline is config, not personal.

---

## Subsystem 1: Personal Forward Model

### Goal

Replace `forward_model._EFFECTS` with a per-user linear regression matrix that learns which music parameters actually moved the user's RMSSD over the following 60 seconds.

### Interface Contract

```python
# forward_model.py — new signature, drop-in compatible
def predict_delta(params: dict, current: StateVector, user_id: str) -> StateVector: ...

# model_store.py — new module
def get_effect_matrix(user_id: str) -> EffectMatrix:
    """Returns personal matrix if ≥10 sessions exist, else population prior."""

def recompute_effect_matrix(user_id: str, session_rows: list[dict]) -> EffectMatrix: ...
```

`EffectMatrix` is a 14×6 float array (14 music params × 6 state dims) stored as JSON in Supabase `user_profiles.effect_matrix`.

### Algorithm

After each session:

1. Pull `session_snapshots` rows for this user: columns `music_params` (JSON), `hrv_metrics` (JSON), `recorded_at`.
2. For each snapshot row `i`, look ahead 60 seconds: compute `δRMSSD = RMSSD(t+60s) − RMSSD(t)`.
3. For each of the 14 music params `p`, run `OLS(δRMSSD ~ p_norm)` across all rows with valid look-ahead. Record `β_p`.
4. Repeat for each of the 6 state dimensions (using normalized analogues of δarousal, δstability, etc. where derivable from RMSSD/DFA/SD1/SD2 history).
5. Populate `EffectMatrix[p, d] = β_p_d`.

Cold start: if `n_sessions < 10`, blend:

```
M_effective = α * M_personal + (1 − α) * M_prior
α = n_sessions / 10   # 0.0 at session 0, 1.0 at session 10
```

`M_prior` = existing `_EFFECTS` table (hardcoded, still version-controlled).

Update cadence: triggered server-side at `POST /sessions/{id}/close`. Async task, does not block session close. Recompute over all sessions, not incremental (session count is small, < 100, for years).

### Data Requirements

- `session_snapshots.music_params`: already stored as JSON blob — verify all 14 param names match `_norm()` keys in `forward_model.py`.
- `session_snapshots.hrv_metrics`: already stored — needs `rmssd` field present in every row.
- Minimum 10 sessions × average 60 snapshots/session = 600 rows to fit. OLS is fast; scipy.stats.linregress per (param, dim) pair.
- New column: `user_profiles.effect_matrix JSONB DEFAULT NULL`.
- New column: `user_profiles.effect_matrix_sessions_count INT DEFAULT 0`.

### Validation Criteria

- `predict_delta()` unit test: given population prior, output matches V2 within floating point.
- Integration test: after injecting 10 synthetic sessions with known correlations, `EffectMatrix` coefficients recover direction (sign) correctly in ≥10/14 params.
- A/B metric (V3 prod): δRMSSD per session improves vs V2 baseline after personal model activates. Measure at n=10 users.

### Migration from V2

1. Add `effect_matrix` + `effect_matrix_sessions_count` columns to `user_profiles` (nullable, no default). All existing users default to population prior.
2. Add `model_store.py` module with `get_effect_matrix()` and `recompute_effect_matrix()`.
3. Change `forward_model.predict_delta()` signature to accept `user_id`, fetch matrix via `model_store.get_effect_matrix()`.
4. Wire `recompute_effect_matrix()` call into session close handler in `api/sessions.py`.
5. `_EFFECTS` stays in `forward_model.py` as `_PRIOR_EFFECTS` — used by cold-start blend.

---

## Subsystem 2: HMM State Estimation

### Goal

Replace fixed-alpha EMA in `StateEstimator` with a Hidden Markov Model over the 5 polyvagal states, enabling physiologically informed state transitions and reducing false-state flicker at state boundaries.

### Interface Contract

```python
class HMMStateEstimator:
    """Drop-in replacement for StateEstimator."""
    def update(self, m: HRVMetrics) -> StateVector: ...
    def reset(self) -> None: ...
    def current_state_probs(self) -> dict[str, float]: ...  # new, for UI
```

Same `update(metrics) → StateVector` signature. `StateVector` fields unchanged. Internal HMM state is not exposed to MPC.

### Algorithm

**Architecture:** 5-state discrete HMM with continuous Gaussian emissions. Online forward algorithm (not Viterbi — latency budget 50ms per cycle).

**Emission model:** Each state `k` has a Gaussian distribution over the 3-D observation `o = (RMSSD_norm, DFA_alpha1, LF/HF_norm)`. Parameters `μ_k` (3D mean) and `Σ_k` (diagonal covariance) are initialized from physiology literature:

| State | RMSSD_norm μ | DFA μ | LF/HF μ |
|---|---|---|---|
| ventral_vagal | 0.75 | 1.0 | 1.5 |
| healthy_sympathetic | 0.45 | 1.0 | 2.5 |
| anxious_sympathetic | 0.25 | 0.7 | 4.0 |
| dorsal_vagal | 0.20 | 0.5 | 1.2 |
| burnout_rigidity | 0.15 | 0.4 | 1.0 |

Diagonal covariances initialized to `σ=0.15` for all dimensions (covers typical within-state spread).

**Transition matrix `A` (5×5):** Physiologically informed priors. Key constraints:
- `ventral → dorsal` one-step probability: 0.01 (rare; must pass through sympathetic activation).
- `ventral → healthy_sympathetic`: 0.15 (common during arousal).
- Self-transitions: 0.80–0.90 (states persist for tens of seconds at 1Hz update).
- `burnout_rigidity → any`: 0.02/state other than self (clinically rigid state).

**Online forward pass:** At each 1Hz tick, update belief state `α_t` via:

```
α_t(k) ∝ b_k(o_t) * Σ_j α_{t-1}(j) * A[j,k]
```

Normalize to sum to 1. `StateVector` is computed as expectation over `α_t`:

```python
sv.arousal = Σ_k α_t(k) * μ_arousal[k]
```

where `μ_arousal[k]` is the arousal centroid for each state (mapped from existing `_bell` centers in `ans_classifier.py`).

**Personal adaptation (after 20 sessions):** Re-estimate `μ_k` per dimension using user's historical HRV metrics labeled by the current classifier. Do not adapt `A` (too little data; physiology-constrained). Store personalized `μ_k` in `user_profiles.hmm_emission_means JSONB`.

### Data Requirements

- No new per-session storage. HMM runs in-process, stateful per WebSocket connection.
- New column: `user_profiles.hmm_emission_means JSONB DEFAULT NULL` (5×3 float array).
- New column: `user_profiles.hmm_sessions_count INT DEFAULT 0`.

### Validation Criteria

- Smoke test: feed 200-step synthetic RR sequence with ground-truth state transitions; HMM must track correct state within 5 steps on 90% of transitions.
- Regression: `StateVector` output remains in V2 range (0–1 per dimension) for all inputs.
- Latency: forward pass must complete in < 5ms for 5 states (trivially met with numpy dot).
- Flicker metric: measure state transition rate on real session data; HMM should produce ≥ 40% fewer transitions than EMA at same true-state change rate.

### Migration from V2

1. Implement `HMMStateEstimator` in new file `hmm_state_estimator.py`.
2. Existing `StateEstimator` in `state_estimation.py` stays untouched.
3. Feature flag in `config.py`: `USE_HMM_ESTIMATOR: bool = False`. Flip to True after validation.
4. `session_manager.py` instantiates estimator via factory function gated on flag.
5. Delete `StateEstimator` only after HMM passes prod validation on 5+ real users.

---

## Subsystem 3: RSA Amplitude Fusion

### Goal

Compute true Respiratory Sinus Arrhythmia (RSA) amplitude — the RR oscillation at the user's personal respiratory frequency — and add it as a first-class `HRVMetrics` field and ANS classifier signal.

### Interface Contract

```python
# hrv_processor.py — HRVMetrics gains one new field:
@dataclass
class HRVMetrics:
    ...
    rsa_amplitude_ms: float | None = None   # peak-to-trough RR oscillation at rf_hz ± 0.02 Hz
```

ANS classifier gains RSA pathway:

```python
# ans_classifier.py
def classify(m: HRVMetrics, ...) -> ANSClassification:
    # existing bell-curve scoring unchanged
    # RSA modifier applied post-scoring:
    if m.rsa_amplitude_ms is not None:
        _apply_rsa_evidence(s, m.rsa_amplitude_ms, m.rmssd)
```

### Algorithm

RSA computation added to `HRVProcessor._metrics()`, requires `rf_hz` to already be computed:

```python
def _rsa_amplitude(rr_uniform: np.ndarray, rf_hz: float, fs: float = 4.0) -> float | None:
    """Band-pass RR signal around rf_hz ± 0.02 Hz, measure peak-to-trough amplitude."""
    lo = max(0.05, rf_hz - 0.02)
    hi = min(0.45, rf_hz + 0.02)
    if lo >= hi:
        return None
    b, a = butter(2, [lo, hi], btype='band', fs=fs)
    filtered = filtfilt(b, a, rr_uniform)
    return float(np.max(filtered) - np.min(filtered))  # ms
```

Requires at least 30s of data (same gate as `rf_hz`). Returns `None` when `rf_hz` is `None`.

**ANS classifier RSA evidence rules:**

| Condition | Effect |
|---|---|
| RSA > 8ms AND RMSSD_norm > 0.6 | `ventral_vagal` score × 1.25 (stronger evidence) |
| RSA > 8ms AND RMSSD_norm < 0.4 | `entraining` tag (RSP-vagal dissociation); flag in `confidence_tag` as `"RSP_DISSOCIATION"` |
| RSA < 3ms AND rf_hz not None | Suppresses `ventral_vagal` score × 0.8 (low RSA at known RF = weak vagal drive) |

Thresholds (8ms, 3ms) are UNTUNED until ≥3 real H10 sessions with concurrent respiratory data. Mark with `# UNTUNED` comment.

### Data Requirements

- `HRVMetrics.rsa_amplitude_ms` added as nullable float — backward compatible (existing serialization uses `asdict()`; new field auto-included).
- No new Supabase columns required. `session_snapshots.hrv_metrics` JSON already captures full `HRVMetrics` dict.
- For RSA thresholds tuning: need sessions with ground-truth respiratory data (H10 ACC channel or separate respiratory belt). Flag in V3 backlog.

### Validation Criteria

- Unit test: synthetic RR with known 0.1Hz sinusoidal oscillation at 10ms amplitude → `rsa_amplitude_ms` returns value within ±2ms.
- ANS test: RSA=15ms, RMSSD_norm=0.7 → `ventral_vagal` score higher than equivalent input without RSA.
- RSP dissociation case: RSA=12ms, RMSSD_norm=0.3 → `confidence_tag == "RSP_DISSOCIATION"`.
- No regression: RSA=None → classifier output identical to V2.

### Migration from V2

1. Add `rsa_amplitude_ms: float | None = None` to `HRVMetrics` dataclass.
2. Add `_rsa_amplitude()` static method to `HRVProcessor`; call in `_metrics()` after `rf_hz` is computed.
3. Pass `rsa_amplitude_ms` through to `ans_classifier.classify()` (extend function signature).
4. Add RSA evidence rules to `classify()` behind `if m.rsa_amplitude_ms is not None:` guard.
5. Update `test_hrv_processor.py` and `test_ans_classifier.py`.

---

## Subsystem 4: Affect Ground Truth Collection

### Goal

Break the fundamental V2 limitation: HRV cannot distinguish Q3 (calm-negative) from Q4 (stressed-negative). Collect sparse subjective labels during sessions to build a personal valence classifier.

### Interface Contract

**Frontend (React):**

```typescript
// AffectPrompt component — appears during active session
interface AffectPromptEvent {
  session_id: string;
  snapshot_id: string;
  label: "positive" | "negative";  // user tap
  timestamp_ms: number;
}
// POST /sessions/{id}/affect_label
```

**Backend:**

```python
# affect_label stored in session_snapshots row nearest to prompt timestamp
# affect_classifier.py gains new function:
def build_personal_valence_model(user_id: str, labeled_rows: list[dict]) -> ValenceModel | None:
    """Logistic regression on (RMSSD_norm, DFA_alpha1) → positive/negative.
    Returns None if < 30 labeled rows (5 sessions × ~6 prompts)."""
```

### Algorithm

**Prompt UX:**
- Trigger: every 120 seconds of active session, after first 3 minutes (avoid disrupting initial calibration).
- Display: two buttons ("Better" / "Worse") with 3-second auto-dismiss. No label = `null`.
- Store `affect_label` on the `session_snapshots` row with closest `recorded_at` to prompt time. Backfill is safe; prompt timing is logged server-side.

**Personal valence model:**

Features: `[RMSSD_norm, DFA_alpha1]` (both already in `session_snapshots.hrv_metrics`).  
Labels: `positive=1, negative=0` from `affect_label` column.  
Model: `sklearn.linear_model.LogisticRegression` with L2 regularization `C=1.0`.  
Training gate: ≥30 labeled rows. Below threshold, fall back to V2 SD1/SD2 proxy.  
Update cadence: same async hook as forward model (session close).  
Storage: `user_profiles.personal_valence_model JSONB` — serialized as `{"coef": [...], "intercept": float, "n_labeled": int}`.

**Classifier integration:**

```python
# affect_classifier.py
def classify_valence(m: HRVMetrics, user_id: str) -> float:
    """Returns valence in [-1, 1]. Uses personal model if available, else V2 proxy."""
    model = get_personal_valence_model(user_id)
    if model and model.n_labeled >= 30:
        p_positive = model.predict_proba([RMSSD_norm, DFA_alpha1])
        return 2 * p_positive - 1  # map [0,1] → [-1,1]
    else:
        # V2 proxy: SD1/SD2 → valence (unchanged)
        return math.tanh(m.sd1_sd2_ratio * 3.0 - 1.0)
```

### Data Requirements

- New column: `session_snapshots.affect_label VARCHAR(8) DEFAULT NULL` (values: `positive`, `negative`, `null`).
- New API endpoint: `POST /sessions/{session_id}/affect_label` body `{snapshot_id, label}`.
- New column: `user_profiles.personal_valence_model JSONB DEFAULT NULL`.
- New column: `user_profiles.valence_labeled_count INT DEFAULT 0`.

### Validation Criteria

- Frontend: prompt appears exactly at 2-min mark (±5s); auto-dismisses in 3s; does not interrupt audio.
- Backend: label stored in correct snapshot row (nearest by timestamp, not next).
- Model: after injecting 30 synthetic labeled rows with known separability, logistic regression achieves > 70% cross-val accuracy.
- Fallback: if `personal_valence_model` is NULL, output is identical to V2 affect classifier.

### Migration from V2

1. Add `affect_label` column to `session_snapshots` via Supabase migration (nullable, no default).
2. Build `AffectPrompt` React component (3s auto-dismiss, no blocking animation).
3. Add `POST /sessions/{id}/affect_label` endpoint in `api/sessions.py`.
4. Add `build_personal_valence_model()` to `affect_classifier.py`; wire into session close hook.
5. Add `personal_valence_model` + `valence_labeled_count` columns to `user_profiles`.
6. Modify `affect_classifier.classify_valence()` to check personal model first.

---

## V3 Data Model — New Supabase Columns

### `user_profiles` table additions

| Column | Type | Default | Used by |
|---|---|---|---|
| `effect_matrix` | JSONB | NULL | Subsystem 1 (14×6 float array) |
| `effect_matrix_sessions_count` | INT | 0 | Subsystem 1 cold-start blend |
| `hmm_emission_means` | JSONB | NULL | Subsystem 2 (5×3 float array) |
| `hmm_sessions_count` | INT | 0 | Subsystem 2 adaptation gate |
| `personal_valence_model` | JSONB | NULL | Subsystem 4 (`{coef, intercept, n_labeled}`) |
| `valence_labeled_count` | INT | 0 | Subsystem 4 training gate |

### `session_snapshots` table additions

| Column | Type | Default | Used by |
|---|---|---|---|
| `affect_label` | VARCHAR(8) | NULL | Subsystem 4 (`positive`/`negative`) |

All additions are additive and nullable. No existing rows break. Apply as a single migration at V3 kickoff.

---

## Prioritized Build Order

**Gate: V2.1–V2.10 complete.**

1. **Subsystem 3 — RSA Amplitude** (1–2 days)  
   Purely additive to `HRVMetrics` and `ANSClassifier`. No data model changes. No UX. Ships as backend-only. Unblocked immediately after real H10 data is available for threshold validation. Highest scientific differentiation per line of code.

2. **Subsystem 4 — Affect Ground Truth** (3–4 days)  
   Data model migration first (1 migration, 1 column). Then `AffectPrompt` component (isolated, no pipeline coupling). Then session close hook. Starts accumulating labeled data immediately — the model itself is useless until 5+ sessions exist, but the *data collection* must start early. Begin as soon as V2 ships to real users.

3. **Subsystem 2 — HMM State Estimation** (4–5 days)  
   Highest implementation complexity. Requires careful validation against real session data to confirm HMM tracks states correctly before flag flip. Implement behind `USE_HMM_ESTIMATOR=False` flag; validate in parallel with Subsystem 4 data accumulation. Do not flip flag until 5 real users have produced session data for comparison.

4. **Subsystem 1 — Personal Forward Model** (3–4 days)  
   Depends on sufficient session history (≥10 per user). Cannot tune or validate until real users are in prod for 3–4 weeks. Implement the OLS logic and cold-start blend early; the personalized model activates automatically once the data threshold is crossed. Build first, useful later.

**V3 is complete when:** Subsystem 3 is validated on real H10 data, Subsystem 4 has collected ≥30 labels per user for 3+ users, and HMM flag is flipped in prod with no regression on `StateVector` output range.
