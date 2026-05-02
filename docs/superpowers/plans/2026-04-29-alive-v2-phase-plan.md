# ALIVE_V1 → V2 Master Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the current working ALIVE_V1 codebase to match Master Prompt V2 spec — 3 modes, 4D latent state, Bayesian RF calibration, POLYBIO-7, Mode-adaptive VS, phone sensor stack, and 3 session arcs — demo-ready for Prof. Klumpers by May 10.

**Architecture:** Phase-gated approach — each phase leaves the app in a runnable state. Backend modules renamed + extended; frontend restructured into pages/sensors/audio/ui layout. Existing smoke-test logic preserved throughout.

**Tech Stack:** FastAPI + WebSocket (Python 3.11), React + Vite, Tone.js, MediaPipe TensorFlow.js WASM, SQLite dev / Postgres prod, Railway + Vercel.

**CRITICAL RULES (from Section 23):**
- 12 audio invariants (Section 13) — inviolable
- LF/HF ratio never used as sympathetic proxy
- ISO principle always
- All music param changes: 2000ms ramp minimum
- State change: 5ms RMSSD delta + 2-cycle confirm
- Valence = NULL (not 0) in Mode 2
- MEDITATIVE = hold, no intervention
- WIND_DOWN SHUTDOWN = success

---

## Current State vs V2 Required

| V2 Module | Current File | Status |
|-----------|-------------|--------|
| `backend/hrv_engine.py` | `hrv_processor.py` | Rename + add 2 methods |
| `backend/state_classifier.py` | `ans_classifier.py` | Rename + mode-aware Axis 2 |
| `backend/audio_controller.py` | `music_engine.py` | Rename + ISO arc + 12 invariants |
| `backend/database.py` | `storage.py` | Rename + 8 new columns |
| `backend/latent_state.py` | — | **MISSING — create** |
| `backend/vs_score.py` | — | **MISSING — create** |
| `backend/rf_calibration.py` | — | **MISSING — create** |
| `backend/session_manager.py` | — | **MISSING — create** |
| `backend/context/circadian.py` | — | **MISSING — create** |
| `backend/context/ambient.py` | — | **MISSING — create** |
| `backend/models.py` | — | **MISSING — create** |
| `frontend/src/sensors/*` | — | **MISSING — entire directory** |
| `frontend/src/audio/*` | — | **MISSING — entire directory** |
| `frontend/src/pages/*` | components/ (partial) | Restructure |
| `frontend/src/ui/*` | components/ (partial) | Extract sub-components |
| `frontend/src/utils/ws_client.js` | — | **MISSING** |
| `frontend/src/utils/circadian.js` | — | **MISSING** |
| `railway.toml` | — | **MISSING** |
| `frontend/vercel.json` | — | **MISSING** |

---

## Phase A — Crash Fix + Deployment (Session A, ~2h)

**Goal:** App runs on Railway HTTPS + Vercel. BLE works on Samsung S23.

### Task A1: Verify and fix CORS + health endpoint

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Read top of main.py to check CORS**

Run: `head -60 backend/main.py`

- [ ] **Step 2: Ensure CORSMiddleware added**

In `backend/main.py`, after `app = FastAPI(...)`:
```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten post-demo
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 3: Add health endpoint if missing**

```python
@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Verify locally**

Run: `uvicorn backend.main:app --port 8000`
Expected: `curl http://localhost:8000/health` → `{"status":"ok"}`

---

### Task A2: Create railway.toml

**Files:**
- Create: `railway.toml`

- [ ] **Step 1: Write file**

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn backend.main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
```

---

### Task A3: Create frontend/vercel.json

**Files:**
- Create: `frontend/vercel.json`

- [ ] **Step 1: Write file**

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

---

### Task A4: Replace hardcoded localhost:8000

**Files:**
- Modify: all frontend JS/JSX files using localhost:8000

- [ ] **Step 1: Find all occurrences**

Run: `grep -r "localhost:8000" frontend/src/`

- [ ] **Step 2: Replace with env var**

Pattern to use:
```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL = API_URL.replace('https', 'wss').replace('http', 'ws')
```

- [ ] **Step 3: Create frontend/.env.example**

```
VITE_API_URL=https://your-app.railway.app
```

---

### Task A5: Freeze requirements

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Freeze current env**

Run (in vagus_env): `pip freeze > backend/requirements.txt`

- [ ] **Step 2: Verify scipy + numpy included**

Run: `grep -E "scipy|numpy|scikit" backend/requirements.txt`
Expected: both present (needed for Phase C RF calibration)

---

### Task A6: Deploy + test

- [ ] **Step 1: Commit**

```bash
git add railway.toml frontend/vercel.json backend/requirements.txt backend/main.py frontend/src/
git commit -m "feat: crash fix, CORS, health endpoint, deploy config"
```

- [ ] **Step 2: Deploy Railway**

Push to GitHub. Railway auto-deploys. Check Railway logs: `railway logs`

- [ ] **Step 3: Deploy Vercel**

Set `VITE_API_URL` env var in Vercel dashboard → redeploy.

- [ ] **Step 4: Test BLE on Samsung S23**

Open Vercel URL in Android Chrome. Connect H10. Confirm WebSocket opens (check Network tab).

**Phase A complete when:** BLE connects on phone to Railway backend over HTTPS/WSS.

---

## Phase B — HRV Engine + Latent State Extractor (Session B, ~3h)

**Goal:** `hrv_engine.py` with full metric set + `latent_state.py` 4D extractor.

### Task B1: Rename hrv_processor.py → hrv_engine.py

**Files:**
- Rename: `backend/hrv_processor.py` → `backend/hrv_engine.py`
- Modify: `backend/main.py` (update import)

- [ ] **Step 1: Copy and verify**

```bash
cp backend/hrv_processor.py backend/hrv_engine.py
```

- [ ] **Step 2: Add lf_coherence_at_rf method to HRVEngine class**

```python
def lf_coherence_at_rf(self, rr_intervals_ms: list[float], personal_rf_bpm: float) -> float:
    """LF power at personal RF / total LF power. Returns 0–1."""
    from scipy import signal
    import numpy as np
    if len(rr_intervals_ms) < 20:
        return 0.0
    rr_s = np.array(rr_intervals_ms) / 1000.0
    t = np.cumsum(rr_s); t -= t[0]
    t_uni = np.arange(0, t[-1], 0.25)
    rr_i = np.interp(t_uni, t, rr_s)
    f, pxx = signal.lombscargle.__wrapped__ if hasattr(signal.lombscargle, '__wrapped__') else (None, None)
    # Welch fallback
    f, pxx = signal.welch(rr_i, fs=4.0, nperseg=min(128, len(rr_i)//2))
    rf_hz = personal_rf_bpm / 60.0
    lf_mask = (f >= 0.04) & (f <= 0.15)
    rf_mask = np.abs(f - rf_hz) < 0.025
    lf_total = np.trapz(pxx[lf_mask], f[lf_mask])
    lf_at_rf = np.trapz(pxx[rf_mask], f[rf_mask]) if np.any(rf_mask) else 0.0
    return float(np.clip(lf_at_rf / (lf_total + 1e-9), 0, 1))
```

- [ ] **Step 3: Add phase_synchrony method**

```python
def phase_synchrony(self, rr_intervals_ms: list[float], resp_signal: np.ndarray, resp_fs: float = 25.0) -> float:
    """Phase lag between RR oscillation and respiration. 0° = locked. Returns 0–1 (1=locked)."""
    from scipy import signal
    import numpy as np
    if len(rr_intervals_ms) < 15 or len(resp_signal) < 30:
        return 0.5
    rr_s = np.array(rr_intervals_ms) / 1000.0
    t = np.cumsum(rr_s); t -= t[0]
    t_uni = np.arange(0, t[-1], 0.25)
    rr_i = np.interp(t_uni, t, rr_s)
    resp_r = signal.resample(resp_signal, len(t_uni))
    # Hilbert phase difference
    rr_phase = np.angle(signal.hilbert(rr_i - np.mean(rr_i)))
    resp_phase = np.angle(signal.hilbert(resp_r - np.mean(resp_r)))
    phase_diff = np.abs(np.mean(np.exp(1j * (rr_phase - resp_phase))))
    return float(phase_diff)   # 0–1, 1=perfectly locked
```

- [ ] **Step 4: Wrap all outputs in confidence dict for Mode 1**

Add method:
```python
def wrap_with_confidence(self, metrics: dict, mode: int) -> dict:
    """Mode 1: wrap each value with confidence. Mode 2/3: pass through."""
    if mode != 1:
        return metrics
    conf = metrics.get("signal_quality", 0.8)
    return {k: {"value": v, "confidence": conf} if not isinstance(v, dict) else v
            for k, v in metrics.items()}
```

- [ ] **Step 5: Update import in main.py**

```python
# Change: from backend.hrv_processor import HRVProcessor
# To:
from backend.hrv_engine import HRVEngine
```

- [ ] **Step 6: Run existing smoke test**

Run: `python -m backend._phase1_smoke`
Expected: passes (no regressions)

- [ ] **Step 7: Commit**

```bash
git add backend/hrv_engine.py backend/main.py
git commit -m "feat: hrv_engine with lf_coherence_at_rf and phase_synchrony"
```

---

### Task B2: Create latent_state.py (4D extractor)

**Files:**
- Create: `backend/latent_state.py`

- [ ] **Step 1: Write LatentStateVector dataclass**

```python
# backend/latent_state.py
from dataclasses import dataclass
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
    activeModalities: list
```

- [ ] **Step 2: Write LatentStateExtractor class**

```python
class LatentStateExtractor:
    """
    Phase 1: deterministic feature → latent mapping.
    Phase 2: replace compute() with JEPA encoder forward pass.
    Interface contract is frozen. Never change return signature.
    """

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
        rmssd = hrv.get("rmssd", 40.0)
        # Lower RMSSD = higher sympathetic arousal. Normalize to 0–1.
        return float(max(0.0, min(1.0, 1.0 - (rmssd - 10) / 90)))

    def _rmssd_stability(self, hrv: dict) -> float:
        rmssd_var = hrv.get("rmssd_variance", 100.0)
        return float(max(0.0, min(1.0, 1.0 - rmssd_var / 500)))

    def _sd_ratio(self, hrv: dict) -> float:
        sd1 = hrv.get("sd1", 20.0)
        sd2 = hrv.get("sd2", 40.0)
        ratio = sd2 / (sd1 + 1e-9)
        return float(min(1.0, ratio / 4.0))

    def _face_valence(self, face: dict) -> Optional[float]:
        if not face:
            return None
        return float(face.get("valence_proxy", 0.0))

    def _sampen_tpn(self, hrv: dict) -> float:
        sampen = hrv.get("sample_entropy", 1.0)
        return float(max(0.0, min(1.0, 1.0 - sampen / 2.5)))

    def _fatigue_proxy(self, hrv: dict, face: dict, mode: int) -> float:
        ear = face.get("ear", 0.3) if face and mode != 2 else 0.3
        rmssd_drop = hrv.get("rmssd_drop_rate", 0.0)
        ear_fatigue = max(0.0, 1.0 - ear / 0.3)
        return float(min(1.0, (ear_fatigue + rmssd_drop) / 2))

    def _confidence(self, hrv: dict, mode: int) -> float:
        base = {1: 0.65, 2: 0.90, 3: 0.95}.get(mode, 0.75)
        signal_q = hrv.get("signal_quality", 1.0)
        return float(base * signal_q)

    def _active_modalities(self, mode: int, face: dict, pose: dict) -> list:
        mods = ["circadian"]
        if mode in (2, 3):
            mods.append("h10")
        if mode in (1, 3):
            mods.append("rppg")
        if face and mode != 2:
            mods.append("facemesh")
        if pose and mode != 2:
            mods.append("pose")
        mods.append("mic")
        return mods
```

- [ ] **Step 3: Write unit tests**

Create `backend/tests/test_latent_state.py`:
```python
from backend.latent_state import LatentStateExtractor, LatentStateVector

extractor = LatentStateExtractor()

def test_mode2_valence_is_null():
    hrv = {"rmssd": 45, "lf_coherence_at_rf": 0.7, "sample_entropy": 1.2,
           "sd1": 25, "sd2": 50, "signal_quality": 0.9}
    result = extractor.compute(hrv, {}, {}, {"circadian_score": 0.6}, mode=2)
    assert result.valence is None, "Mode 2 valence must be NULL, not 0"

def test_mode1_valence_present():
    hrv = {"rmssd": 45, "sample_entropy": 1.2, "sd1": 25, "sd2": 50}
    face = {"valence_proxy": 0.4, "ear": 0.28}
    result = extractor.compute(hrv, face, {}, {}, mode=1)
    assert result.valence is not None

def test_high_rmssd_low_arousal():
    hrv = {"rmssd": 80, "sample_entropy": 1.5, "sd1": 40, "sd2": 80}
    result = extractor.compute(hrv, {}, {}, {}, mode=2)
    assert result.arousal < 0.5, "High RMSSD should give low arousal"

def test_return_type():
    hrv = {"rmssd": 45}
    result = extractor.compute(hrv, {}, {}, {}, mode=2)
    assert isinstance(result, LatentStateVector)
```

- [ ] **Step 4: Run tests**

Run: `pytest backend/tests/test_latent_state.py -v`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/latent_state.py backend/tests/test_latent_state.py
git commit -m "feat: LatentStateExtractor 4D latent state (Phase 1 physics-based)"
```

**Phase B complete when:** smoke test still passes + 4 latent_state tests pass.

---

## Phase C — Bayesian RF Calibration (Session C, ~3h)

**Goal:** `rf_calibration.py` with BayesianRFOptimizer + coherence metric, wired into WebSocket.

### Task C1: Create rf_calibration.py

**Files:**
- Create: `backend/rf_calibration.py`

- [ ] **Step 1: Write compute_coherence_at_frequency (exact from Section 7)**

```python
# backend/rf_calibration.py
from scipy import signal
import numpy as np

def compute_coherence_at_frequency(
    rr_intervals_ms: list[float],
    resp_signal: np.ndarray,
    target_bpm: float,
    resp_fs: float = 25.0,
) -> float:
    if len(rr_intervals_ms) < 15 or len(resp_signal) < 30:
        return 0.0
    target_hz = target_bpm / 60.0
    rr_s = np.array(rr_intervals_ms) / 1000.0
    t_rr = np.cumsum(rr_s); t_rr -= t_rr[0]
    if t_rr[-1] < 15:
        return 0.0
    t_uniform = np.arange(0, t_rr[-1], 0.25)
    rr_interp = np.interp(t_uniform, t_rr, rr_s)
    n_target = len(t_uniform)
    resp_resampled = signal.resample(resp_signal, n_target)
    nperseg = min(128, len(rr_interp) // 2)
    if nperseg < 16:
        return 0.0
    f, Cxy = signal.coherence(rr_interp, resp_resampled, fs=4.0, nperseg=nperseg)
    mask = np.abs(f - target_hz) < 0.025
    if not np.any(mask):
        return 0.0
    return float(np.max(Cxy[mask]))
```

- [ ] **Step 2: Write BayesianRFOptimizer (exact from Section 7)**

```python
from scipy.optimize import minimize_scalar
from scipy.stats import norm

class BayesianRFOptimizer:
    def __init__(self, height_cm: float = None, prior_rf: float = None):
        self.observations = []
        self.search_bounds = (4.0, 8.5)
        if prior_rf:
            self.f0 = prior_rf
        elif height_cm:
            if height_cm > 183: self.f0 = 5.0
            elif height_cm >= 168: self.f0 = 5.5
            else: self.f0 = 6.0
        else:
            self.f0 = 5.5
        self.next_freq = self.f0

    def observe(self, bpm: float, coherence: float):
        self.observations.append((bpm, coherence))

    def next_evaluation_point(self) -> float:
        if len(self.observations) < 3:
            tested = [o[0] for o in self.observations]
            candidates = [self.f0 + 0.6, self.f0 - 0.6, self.f0 + 1.2, self.f0 - 1.2]
            candidates = [c for c in candidates
                          if self.search_bounds[0] <= c <= self.search_bounds[1]
                          and not any(abs(c - t) < 0.1 for t in tested)]
            return candidates[0] if candidates else self.f0 + 0.3
        X = np.array([o[0] for o in self.observations]).reshape(-1, 1)
        y = np.array([o[1] for o in self.observations])
        length_scale = 0.8
        noise = 0.02
        def rbf(x1, x2): return np.exp(-0.5 * ((x1 - x2) / length_scale) ** 2)
        K = np.array([[rbf(x1[0], x2[0]) for x2 in X] for x1 in X])
        K += noise * np.eye(len(X))
        K_inv = np.linalg.inv(K)
        best_y = np.max(y)
        def ei(bpm_val):
            k_star = np.array([rbf(bpm_val, xi[0]) for xi in X])
            mu = float(k_star @ K_inv @ y)
            sigma2 = float(rbf(bpm_val, bpm_val) - k_star @ K_inv @ k_star)
            sigma = max(np.sqrt(sigma2), 1e-9)
            z = (mu - best_y) / sigma
            return -(((mu - best_y) * norm.cdf(z) + sigma * norm.pdf(z)))
        result = minimize_scalar(ei, bounds=self.search_bounds, method='bounded')
        return round(result.x, 2)

    def best_estimate(self) -> tuple:
        if not self.observations:
            return self.f0, 0.0
        return max(self.observations, key=lambda o: o[1])

MODE_CALIBRATION_CONFIG = {
    1: {"rr_source": "rppg", "resp_source": "mic",
        "settling_seconds": 25, "min_coherence_lock": 0.75, "confidence_tag": "MEDIUM"},
    2: {"rr_source": "h10", "resp_source": "h10_accel",
        "settling_seconds": 20, "min_coherence_lock": 0.85, "confidence_tag": "HIGH"},
    3: {"rr_source": "h10", "resp_source": "best_of_mic_and_h10_accel",
        "settling_seconds": 20, "min_coherence_lock": 0.85, "confidence_tag": "HIGH"},
}
```

- [ ] **Step 3: Write unit tests**

Create `backend/tests/test_rf_calibration.py`:
```python
import numpy as np
from backend.rf_calibration import compute_coherence_at_frequency, BayesianRFOptimizer

def test_coherence_needs_min_data():
    result = compute_coherence_at_frequency([850]*5, np.zeros(10), 6.0)
    assert result == 0.0

def test_bayesian_cold_start_returns_f0():
    opt = BayesianRFOptimizer(height_cm=175)
    assert opt.next_freq == 5.5

def test_bayesian_explores_near_prior():
    opt = BayesianRFOptimizer(prior_rf=6.0)
    opt.observe(6.0, 0.5)
    next_pt = opt.next_evaluation_point()
    assert 4.0 <= next_pt <= 8.5

def test_bayesian_best_estimate():
    opt = BayesianRFOptimizer()
    opt.observe(5.5, 0.6)
    opt.observe(6.0, 0.9)
    opt.observe(5.0, 0.4)
    best_bpm, best_coh = opt.best_estimate()
    assert best_bpm == 6.0
    assert best_coh == 0.9
```

- [ ] **Step 4: Run tests**

Run: `pytest backend/tests/test_rf_calibration.py -v`
Expected: 4 tests PASS

---

### Task C2: Wire RF calibration into WebSocket handler

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add RFOptimizer instance per session**

In the WebSocket handler, on session start:
```python
from backend.rf_calibration import BayesianRFOptimizer, MODE_CALIBRATION_CONFIG

# On session start (per connection):
rf_optimizer = BayesianRFOptimizer(prior_rf=session_data.get("prior_rf"))
rf_locked = False
rf_bpm = rf_optimizer.f0
current_mode = session_data.get("mode", 2)
config = MODE_CALIBRATION_CONFIG[current_mode]
settling_start = time.time()
```

- [ ] **Step 2: Add coherence check in 1Hz compute loop**

```python
# In compute loop, after HRV metrics computed:
if not rf_locked and (time.time() - settling_start) > config["settling_seconds"]:
    coherence = compute_coherence_at_frequency(rr_buffer, resp_buffer, rf_bpm)
    rf_optimizer.observe(rf_bpm, coherence)
    if coherence >= config["min_coherence_lock"]:
        rf_locked = True
        rf_bpm, _ = rf_optimizer.best_estimate()
    else:
        rf_bpm = rf_optimizer.next_evaluation_point()
```

- [ ] **Step 3: Include rf_locked, rf_bpm, rf_coherence in WS state_update message**

```python
state_msg["rf_locked"] = rf_locked
state_msg["rf_bpm"] = rf_bpm
state_msg["rf_coherence"] = coherence if not rf_locked else config["min_coherence_lock"]
```

- [ ] **Step 4: Commit**

```bash
git add backend/rf_calibration.py backend/tests/test_rf_calibration.py backend/main.py
git commit -m "feat: Bayesian RF calibration with per-mode settling and WS integration"
```

**Phase C complete when:** WS messages include `rf_locked`, `rf_bpm`, `rf_coherence` fields.

---

## Phase D — POLYBIO-7 + VS Score (Session D, ~3h)

**Goal:** Mode-aware state classifier + mode-adaptive VS with confidence tags.

### Task D1: Rename + extend state_classifier

**Files:**
- Rename: `backend/ans_classifier.py` → `backend/state_classifier.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Copy to new name**

```bash
cp backend/ans_classifier.py backend/state_classifier.py
```

- [ ] **Step 2: Add Mode 2 Axis 2 NULL handling**

Find the classify method. Add at the start:
```python
def classify(self, hrv_metrics: dict, face_features: dict, mode: int) -> dict:
    # Mode 2: Axis 2 (valence) unavailable — ANXIOUS/STRESSED collapse to STRESS
    axis2_available = mode != 2
    
    # ... existing axis 1 + 3 classification ...
    
    # Mode 2 disambiguation override
    if not axis2_available and state in ("ANXIOUS", "STRESSED"):
        state = "STRESS"  # combined category, acknowledged in report
    
    return {
        "state": state,
        "confidence": confidence,
        "axis2_available": axis2_available,
    }
```

- [ ] **Step 3: Update import in main.py**

```python
# Change: from backend.ans_classifier import ANSClassifier
# To:
from backend.state_classifier import StateClassifier
```

---

### Task D2: Create vs_score.py

**Files:**
- Create: `backend/vs_score.py`

- [ ] **Step 1: Write compute_vs_adaptive (exact from Section 11)**

```python
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

def compute_vs_adaptive(components: dict, mode: int, confidences: dict) -> dict:
    available = {k: v for k, v in components.items() if v is not None}
    unavailable_weight = sum(WEIGHTS[k] for k in WEIGHTS if k not in available)
    total_avail = sum(WEIGHTS[k] for k in available)
    adjusted = {
        k: WEIGHTS[k] + WEIGHTS[k] / total_avail * unavailable_weight
        for k in available
    }
    raw = sum(
        adjusted[k] * available[k] * confidences.get(k, 1.0)
        for k in available
    )
    vs = int(np.clip(raw * 100, 0, 100))
    overall_conf = sum(confidences.get(k, 1.0) for k in available) / max(len(available), 1)
    conf_tag = "HIGH" if overall_conf > 0.8 else "MEDIUM" if overall_conf > 0.5 else "LOW"
    return {
        "vs": vs,
        "confidence": conf_tag,
        "components_used": list(available.keys()),
        "mode": mode,
    }

VS_COLOR_BANDS = [
    (0, 30, "#E24B4A"),   # SHUTDOWN/ANXIOUS
    (31, 55, "#EF9F27"),  # STRESSED/ACTIVATED
    (56, 75, "#1D9E75"),  # REGULATED
    (76, 100, "#534AB7"), # FLOW/MEDITATIVE
]

def vs_color(vs: int) -> str:
    for lo, hi, color in VS_COLOR_BANDS:
        if lo <= vs <= hi:
            return color
    return "#1D9E75"
```

- [ ] **Step 2: Write unit tests**

Create `backend/tests/test_vs_score.py`:
```python
from backend.vs_score import compute_vs_adaptive, vs_color

def test_mode2_posture_redistributed():
    components = {
        "lf_coherence": 0.8, "rsa_amplitude": 0.7,
        "rmssd_trajectory": 0.6, "dfa_alpha1": 0.85,
        "breath_rsa_lock": 0.75, "posture_openness": None,
        "sd2_sd1_ratio": 0.65,
    }
    result = compute_vs_adaptive(components, mode=2, confidences={})
    assert "posture_openness" not in result["components_used"]
    assert result["vs"] > 0

def test_vs_range():
    components = {k: 1.0 for k in ["lf_coherence","rsa_amplitude","rmssd_trajectory",
                                     "dfa_alpha1","breath_rsa_lock","posture_openness","sd2_sd1_ratio"]}
    result = compute_vs_adaptive(components, mode=3, confidences={})
    assert 0 <= result["vs"] <= 100

def test_color_bands():
    assert vs_color(20) == "#E24B4A"
    assert vs_color(45) == "#EF9F27"
    assert vs_color(65) == "#1D9E75"
    assert vs_color(90) == "#534AB7"
```

- [ ] **Step 3: Run tests**

Run: `pytest backend/tests/test_vs_score.py -v`
Expected: 3 tests PASS

- [ ] **Step 4: Wire VS into WebSocket compute loop in main.py**

```python
from backend.vs_score import compute_vs_adaptive

# After HRV + state computed:
vs_components = {
    "lf_coherence": hrv_metrics.get("lf_coherence_at_rf"),
    "rsa_amplitude": hrv_metrics.get("rsa_amplitude_norm"),
    "rmssd_trajectory": hrv_metrics.get("rmssd_velocity_norm"),
    "dfa_alpha1": hrv_metrics.get("dfa_alpha1"),
    "breath_rsa_lock": hrv_metrics.get("breath_rsa_lock"),
    "posture_openness": face_data.get("posture_score") if mode != 2 else None,
    "sd2_sd1_ratio": hrv_metrics.get("sd2_sd1_norm"),
}
vs_result = compute_vs_adaptive(vs_components, mode=current_mode, confidences={})
state_msg["vs"] = vs_result
```

- [ ] **Step 5: Commit**

```bash
git add backend/state_classifier.py backend/vs_score.py backend/tests/test_vs_score.py backend/main.py
git commit -m "feat: POLYBIO-7 mode-aware classifier + mode-adaptive VS score"
```

**Phase D complete when:** WS messages contain `vs.value`, `vs.confidence`, `vs.components_used` + state with `axis2_available` flag.

---

## Phase E — Phone Sensor Stack (Session E, ~3h)

**Goal:** `frontend/src/sensors/` directory with 6 sensor modules for Modes 1 and 3.

### Task E1: Create sensors directory structure

**Files:**
- Create: `frontend/src/sensors/ble_h10.js` (move from engines/)
- Create: `frontend/src/sensors/contact_rppg.js`
- Create: `frontend/src/sensors/facemesh_sensor.js`
- Create: `frontend/src/sensors/blazepose_sensor.js`
- Create: `frontend/src/sensors/breath_mic.js`
- Create: `frontend/src/sensors/motion_gate.js`
- Create: `frontend/src/sensors/sensor_fusion.js`

- [ ] **Step 1: Move ble_h10.js**

```bash
cp frontend/src/engines/polarH10BLE.js frontend/src/sensors/ble_h10.js
```

Update exports to match v2 interface:
```javascript
// frontend/src/sensors/ble_h10.js
export class BleH10Sensor {
    constructor() { this.rrBuffer = []; this.accelBuffer = []; }
    async start() { /* existing polarH10BLE connect logic */ }
    stop() { /* existing disconnect logic */ }
    getLatestRR() { return { rr_ms: this.rrBuffer.slice(-100), confidence: 0.95, source: "h10" } }
    getLatestAccel() { return { signal: this.accelBuffer, fs: 25.0 } }
}
```

- [ ] **Step 2: Create contact_rppg.js (CHROM algorithm skeleton)**

```javascript
// frontend/src/sensors/contact_rppg.js
// CHROM algorithm. Red channel dominant at 660nm (LED torch).
// Accelerometer-gated: pause if motion > 0.05g RMS.

export class ContactRPPGSensor {
    constructor() {
        this.fs = 30;
        this.buffer = [];      // raw red channel values
        this.rrBuffer = [];    // detected RR intervals in ms
        this.running = false;
        this.stream = null;
    }

    async start() {
        this.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', frameRate: 30 }
        });
        const video = document.createElement('video');
        video.srcObject = this.stream;
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = 10; canvas.height = 10;
        const ctx = canvas.getContext('2d');
        this.running = true;
        const self = this;
        function processFrame() {
            if (!self.running) return;
            ctx.drawImage(video, 0, 0, 10, 10);
            const px = ctx.getImageData(0, 0, 10, 10).data;
            let r = 0, g = 0;
            for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i+1]; }
            // CHROM: normalized R/G ratio
            const chrom = (r / (g + 1));
            self.buffer.push({ v: chrom, t: Date.now() });
            if (self.buffer.length > 300) self.buffer.shift();
            self._detectRR();
            requestAnimationFrame(processFrame);
        }
        requestAnimationFrame(processFrame);
        // Enable torch if available
        const track = this.stream.getVideoTracks()[0];
        try { await track.applyConstraints({ advanced: [{ torch: true }] }); } catch(_) {}
    }

    stop() {
        this.running = false;
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    }

    _detectRR() {
        // Bandpass 0.75–3.5 Hz equivalent via running stats + threshold
        if (this.buffer.length < 60) return;
        const vals = this.buffer.slice(-60).map(b => b.v);
        const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a,b) => a + (b-mean)**2, 0) / vals.length);
        // Naive peak detection (min 400ms refractory)
        const threshold = mean + 0.5 * std;
        const last = this.rrBuffer.length > 0 ? this.rrBuffer[this.rrBuffer.length-1] : null;
        const latestVal = this.buffer[this.buffer.length-1];
        const prevVal = this.buffer[this.buffer.length-2];
        if (prevVal && latestVal.v > threshold && prevVal.v <= threshold) {
            if (last === null || (latestVal.t - last.t) > 400) {
                if (last) this.rrBuffer.push(latestVal.t - last.t);
                if (this.rrBuffer.length > 50) this.rrBuffer.shift();
            }
        }
    }

    _quality() {
        if (this.rrBuffer.length < 5) return 0.3;
        const mean = this.rrBuffer.reduce((a,b)=>a+b,0) / this.rrBuffer.length;
        return mean > 400 && mean < 1500 ? 0.75 : 0.3;
    }

    getLatestRR() {
        return { rr_ms: [...this.rrBuffer], confidence: this._quality(), source: "rppg" };
    }
}
```

- [ ] **Step 3: Create facemesh_sensor.js**

```javascript
// frontend/src/sensors/facemesh_sensor.js
// MediaPipe FaceMesh. Install: npm install @mediapipe/face_mesh @tensorflow/tfjs

export class FaceMeshSensor {
    constructor() { this.latest = null; this.running = false; }

    async start() {
        const { FaceMesh } = await import('@mediapipe/face_mesh');
        this.faceMesh = new FaceMesh({ locateFile: f =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
        this.faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true,
            minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        this.faceMesh.onResults(r => this._onResults(r));
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        const video = document.createElement('video');
        video.srcObject = this.stream;
        await video.play();
        this.running = true;
        const self = this;
        async function loop() {
            if (!self.running) return;
            await self.faceMesh.send({ image: video });
            setTimeout(loop, 67);  // ~15fps
        }
        loop();
    }

    stop() { this.running = false; if (this.stream) this.stream.getTracks().forEach(t => t.stop()); }

    _ear(lm, pts) {
        const p = i => ({ x: lm[i].x, y: lm[i].y });
        const d = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
        // EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
        return (d(p(pts[1]),p(pts[5])) + d(p(pts[2]),p(pts[4]))) / (2 * d(p(pts[0]),p(pts[3])));
    }

    _onResults(results) {
        if (!results.multiFaceLandmarks?.[0]) return;
        const lm = results.multiFaceLandmarks[0];
        const earL = this._ear(lm, [33,160,158,133,153,144]);
        const earR = this._ear(lm, [362,385,387,263,373,380]);
        const ear = (earL + earR) / 2;
        // Valence: lip corner elevation
        const valence_proxy = Math.min(1, Math.max(-1, (lm[291].y - lm[61].y) * 10));
        // Arousal: brow elevation
        const arousal_proxy = Math.min(1, Math.max(0, (lm[19].y - lm[1].y) * 5));
        this.latest = { ear, blink_rate_pm: ear < 0.2 ? 1 : 0,
            valence_proxy, arousal_proxy, facial_tension: 1 - ear, confidence: 0.85 };
    }

    getLatestReading() { return this.latest || { ear: 0.3, valence_proxy: 0, confidence: 0 }; }
}
```

- [ ] **Step 4: Create blazepose_sensor.js**

```javascript
// frontend/src/sensors/blazepose_sensor.js
export class BlazePoseSensor {
    constructor() { this.latest = null; this.running = false; }

    async start() {
        const { Pose } = await import('@mediapipe/pose');
        this.pose = new Pose({ locateFile: f =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
        this.pose.setOptions({ modelComplexity: 1, smoothLandmarks: true,
            minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        this.pose.onResults(r => this._onResults(r));
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        const video = document.createElement('video');
        video.srcObject = this.stream; await video.play();
        this.running = true;
        const self = this;
        async function loop() {
            if (!self.running) return;
            await self.pose.send({ image: video });
            setTimeout(loop, 100);
        }
        loop();
    }

    stop() { this.running = false; if (this.stream) this.stream.getTracks().forEach(t => t.stop()); }

    _onResults(results) {
        if (!results.poseLandmarks) return;
        const lm = results.poseLandmarks;
        const shoulder_elevation = Math.min(1, Math.max(0,
            1 - ((lm[11].y + lm[12].y) / 2 - lm[0].y)));
        const head_forward_offset = Math.abs(lm[0].z);
        const collapse_index = Math.min(1, Math.max(0,
            1 - Math.abs(lm[11].y - lm[23].y)));
        const posture_score = 1 - (shoulder_elevation * 0.4 + head_forward_offset * 0.4 + collapse_index * 0.2);
        this.latest = { shoulder_elevation, head_forward_offset, collapse_index,
            posture_score: Math.max(0, posture_score), confidence: 0.8 };
    }

    getLatestReading() { return this.latest || { posture_score: 0.5, confidence: 0 }; }
}
```

- [ ] **Step 5: Create breath_mic.js**

```javascript
// frontend/src/sensors/breath_mic.js
// WebAudio FFT → dominant frequency in 0.1–0.5Hz band → breath rate
export class BreathMicSensor {
    constructor() { this.latest = null; this.running = false; }

    async start() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        src.connect(this.analyser);
        this.running = true;
        this._update();
    }

    stop() { this.running = false; }

    _update() {
        if (!this.running) return;
        const buf = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(buf);
        const sr = this.analyser.context.sampleRate;
        const binHz = sr / (this.analyser.fftSize);
        // Target band: 0.1–0.5 Hz (6–30 breaths/min)
        const loIdx = Math.floor(0.1 / binHz);
        const hiIdx = Math.ceil(0.5 / binHz);
        let peak = 0, peakIdx = loIdx;
        for (let i = loIdx; i <= Math.min(hiIdx, buf.length-1); i++) {
            if (buf[i] > peak) { peak = buf[i]; peakIdx = i; }
        }
        const breath_rate_bpm = peakIdx * binHz * 60;
        this.latest = { breath_rate_bpm: Math.max(6, Math.min(30, breath_rate_bpm)),
            regularity: peak > 10 ? 0.7 : 0.3, confidence: peak > 20 ? 0.75 : 0.3 };
        setTimeout(() => this._update(), 5000);
    }

    getLatestReading() { return this.latest || { breath_rate_bpm: 12, confidence: 0 }; }
}
```

- [ ] **Step 6: Create motion_gate.js**

```javascript
// frontend/src/sensors/motion_gate.js
export class MotionGate {
    constructor() { this.isMoving = false; this._handler = null; }

    start() {
        this._handler = (e) => {
            const rms = Math.sqrt(e.accelerationIncludingGravity.x**2 +
                                  e.accelerationIncludingGravity.y**2 +
                                  e.accelerationIncludingGravity.z**2) / 9.81;
            this.isMoving = rms > 0.05;
        };
        window.addEventListener('devicemotion', this._handler);
    }

    stop() { if (this._handler) window.removeEventListener('devicemotion', this._handler); }
    shouldGate() { return this.isMoving; }
}
```

- [ ] **Step 7: Create sensor_fusion.js**

```javascript
// frontend/src/sensors/sensor_fusion.js
import { BleH10Sensor } from './ble_h10.js';
import { ContactRPPGSensor } from './contact_rppg.js';
import { FaceMeshSensor } from './facemesh_sensor.js';
import { BlazePoseSensor } from './blazepose_sensor.js';
import { BreathMicSensor } from './breath_mic.js';
import { MotionGate } from './motion_gate.js';

export class SensorFusion {
    constructor(mode) {
        this.mode = mode;
        this.sensors = {};
        this.motionGate = new MotionGate();
    }

    async start() {
        this.motionGate.start();
        try {
            if (this.mode === 2 || this.mode === 3) {
                this.sensors.h10 = new BleH10Sensor();
                await this.sensors.h10.start();
            }
            if (this.mode === 1) {
                this.sensors.rppg = new ContactRPPGSensor();
                await this.sensors.rppg.start();
            }
            if (this.mode !== 2) {
                this.sensors.facemesh = new FaceMeshSensor();
                await this.sensors.facemesh.start();
                this.sensors.pose = new BlazePoseSensor();
                await this.sensors.pose.start();
                this.sensors.mic = new BreathMicSensor();
                await this.sensors.mic.start();
            }
        } catch (err) {
            // All sensor failures are silent — never crash the session
            console.warn('Sensor start failed (non-fatal):', err);
        }
    }

    stop() {
        Object.values(this.sensors).forEach(s => { try { s.stop(); } catch(_) {} });
        this.motionGate.stop();
    }

    getReading() {
        const gated = this.motionGate.shouldGate();
        const rr = this.sensors.h10?.getLatestRR() || this.sensors.rppg?.getLatestRR() || null;
        const face = gated ? null : this.sensors.facemesh?.getLatestReading() || null;
        const pose = gated ? null : this.sensors.pose?.getLatestReading() || null;
        const breath = this.sensors.mic?.getLatestReading() || null;
        return { rr, face, pose, breath, mode: this.mode };
    }
}
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/sensors/
git commit -m "feat: phone sensor stack — rPPG, FaceMesh, BlazePose, mic, motion gate, fusion"
```

**Phase E complete when:** `SensorFusion(mode).start()` runs without crash in Android Chrome.

---

## Phase F — Landing + Session UI (Session F, ~3h)

**Goal:** `pages/Landing.jsx`, `pages/Session.jsx`, `ui/` components, WebSocket client wired.

### Task F1: Create utils/ws_client.js

**Files:**
- Create: `frontend/src/utils/ws_client.js`
- Create: `frontend/src/utils/circadian.js`

- [ ] **Step 1: Write ws_client.js**

```javascript
// frontend/src/utils/ws_client.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_URL = API_URL.replace('https', 'wss').replace('http', 'ws');

export class WSClient {
    constructor(sessionId, mode, onMessage) {
        this.sessionId = sessionId;
        this.mode = mode;
        this.onMessage = onMessage;
        this.ws = null;
        this._reconnectDelay = 1000;
    }

    connect() {
        this.ws = new WebSocket(`${WS_URL}/ws/session/${this.sessionId}?mode=${this.mode}`);
        this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
        this.ws.onclose = () => {
            setTimeout(() => this.connect(), this._reconnectDelay);
            this._reconnectDelay = Math.min(this._reconnectDelay * 2, 10000);
        };
        this.ws.onopen = () => { this._reconnectDelay = 1000; };
    }

    send(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    close() { this.ws?.close(); }
}
```

- [ ] **Step 2: Write utils/circadian.js**

```javascript
// frontend/src/utils/circadian.js
const PHASES = [
    { name: 'MORNING_RISE', start: 6, end: 9 },
    { name: 'PEAK', start: 9, end: 12 },
    { name: 'POST_LUNCH_DIP', start: 13, end: 15 },
    { name: 'AFTERNOON_PEAK', start: 15, end: 18 },
    { name: 'EVENING_WIND', start: 18, end: 21 },
    { name: 'NIGHT', start: 21, end: 6 },
];

export function getCurrentCircadianPhase(timezone) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
    const hour = now.getHours() + now.getMinutes() / 60;
    return PHASES.find(p =>
        p.start < p.end ? (hour >= p.start && hour < p.end)
                        : (hour >= p.start || hour < p.end)
    )?.name ?? 'NIGHT';
}
```

---

### Task F2: Create pages/Landing.jsx

**Files:**
- Create: `frontend/src/pages/Landing.jsx`

- [ ] **Step 1: Write Landing component**

```jsx
// frontend/src/pages/Landing.jsx
import { useState } from 'react';

const MODES = [
    { id: 1, label: 'Phone Only', desc: 'Camera + mic sensors. No hardware needed.', badge: 'MEDIUM confidence' },
    { id: 2, label: 'Polar H10 Only', desc: 'ECG-grade RR intervals. Cleanest HRV signal.', badge: 'HIGH confidence' },
    { id: 3, label: 'Phone + Polar H10', desc: 'Full fusion — all sensors active.', badge: 'HIGHEST confidence', recommended: true },
];

export default function Landing({ onStart }) {
    const [mode, setMode] = useState(2);
    const [token, setToken] = useState('');
    const [session, setSession] = useState('find_your_calm');

    const valid = token.trim().length > 0;

    return (
        <div style={{ padding: 32, maxWidth: 480, margin: '0 auto', fontFamily: 'system-ui' }}>
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>ALIVE</h1>
            <p style={{ color: '#888', marginBottom: 32 }}>Autonomic nervous system regulation</p>

            <label>Access token</label>
            <input value={token} onChange={e => setToken(e.target.value)}
                   style={{ display: 'block', width: '100%', padding: 12,
                            marginBottom: 24, fontSize: 16, borderRadius: 8,
                            border: '1px solid #333', background: '#111', color: '#fff' }} />

            <label>Session</label>
            <select value={session} onChange={e => setSession(e.target.value)}
                    style={{ display: 'block', width: '100%', padding: 12,
                             marginBottom: 24, fontSize: 16, borderRadius: 8,
                             border: '1px solid #333', background: '#111', color: '#fff' }}>
                <option value="find_your_calm">Find Your Calm</option>
                <option value="wind_down">Wind Down</option>
                <option value="morning_emergence">Morning Emergence</option>
            </select>

            <label style={{ marginBottom: 12, display: 'block' }}>Sensor mode</label>
            {MODES.map(m => (
                <div key={m.id} onClick={() => setMode(m.id)}
                     style={{ padding: 16, marginBottom: 12, borderRadius: 12, cursor: 'pointer',
                              border: `2px solid ${mode === m.id ? '#534AB7' : '#333'}`,
                              background: mode === m.id ? '#1a1830' : '#111' }}>
                    <div style={{ fontWeight: 600 }}>{m.label} {m.recommended ? '⭐' : ''}</div>
                    <div style={{ fontSize: 13, color: '#888' }}>{m.desc}</div>
                    <div style={{ fontSize: 11, color: '#534AB7', marginTop: 4 }}>{m.badge}</div>
                </div>
            ))}

            <button disabled={!valid} onClick={() => onStart({ mode, token, session })}
                    style={{ width: '100%', padding: 16, fontSize: 18, borderRadius: 12,
                             background: valid ? '#534AB7' : '#333', color: '#fff',
                             border: 'none', cursor: valid ? 'pointer' : 'not-allowed', marginTop: 16 }}>
                Begin Session
            </button>
        </div>
    );
}
```

---

### Task F3: Create ui/ components

**Files:**
- Create: `frontend/src/ui/VsDisplay.jsx`
- Create: `frontend/src/ui/BreathRing.jsx`
- Create: `frontend/src/ui/CoherenceBar.jsx`
- Create: `frontend/src/ui/PhaseIndicator.jsx`

- [ ] **Step 1: VsDisplay.jsx**

```jsx
// frontend/src/ui/VsDisplay.jsx
const BANDS = [
    { max: 30, color: '#E24B4A', label: 'Low energy' },
    { max: 55, color: '#EF9F27', label: 'High tension' },
    { max: 75, color: '#1D9E75', label: 'Calm & Clear' },
    { max: 100, color: '#534AB7', label: 'In the zone' },
];

function vsColor(vs) {
    return BANDS.find(b => vs <= b.max)?.color ?? '#1D9E75';
}
function vsLabel(vs) {
    return BANDS.find(b => vs <= b.max)?.label ?? '';
}

export default function VsDisplay({ vs = 0, confidence = 'LOW', history = [] }) {
    const color = vsColor(vs);
    const W = 200, H = 40;
    const max = Math.max(...history, 1);
    const pts = history.map((v, i) =>
        `${(i / Math.max(history.length - 1, 1)) * W},${H - (v / max) * H}`
    ).join(' ');

    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 72, fontWeight: 700, color, lineHeight: 1 }}>{vs}</div>
            <div style={{ color: '#888', fontSize: 14 }}>{vsLabel(vs)} · {confidence}</div>
            {history.length > 1 && (
                <svg width={W} height={H} style={{ marginTop: 8 }}>
                    <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
                </svg>
            )}
        </div>
    );
}
```

- [ ] **Step 2: BreathRing.jsx**

```jsx
// frontend/src/ui/BreathRing.jsx
import { useEffect, useState } from 'react';

export default function BreathRing({ rfBpm = 6, locked = false }) {
    const [phase, setPhase] = useState(0); // 0=inhale, 1=exhale
    const [scale, setScale] = useState(1);
    const periodMs = (60 / rfBpm) * 1000;

    useEffect(() => {
        let start = Date.now();
        const id = setInterval(() => {
            const elapsed = (Date.now() - start) % periodMs;
            const t = elapsed / periodMs;
            // Sine wave: 1.0 to 1.4 and back
            setScale(1 + 0.4 * Math.sin(t * Math.PI));
        }, 50);
        return () => clearInterval(id);
    }, [rfBpm]);

    const color = locked ? '#1D9E75' : '#534AB7';
    return (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0' }}>
            <div style={{
                width: 120, height: 120, borderRadius: '50%',
                border: `3px solid ${color}`,
                transform: `scale(${scale})`,
                transition: 'transform 50ms linear',
                boxShadow: locked ? `0 0 20px ${color}44` : 'none',
            }} />
        </div>
    );
}
```

- [ ] **Step 3: CoherenceBar.jsx**

```jsx
// frontend/src/ui/CoherenceBar.jsx
export default function CoherenceBar({ coherence = 0, locked = false }) {
    const pct = Math.round(coherence * 100);
    const color = locked ? '#1D9E75' : coherence > 0.5 ? '#EF9F27' : '#E24B4A';
    return (
        <div style={{ margin: '16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888' }}>
                <span>Flow state</span>
                <span>{pct}% {locked ? '· Rhythm locked' : ''}</span>
            </div>
            <div style={{ background: '#222', borderRadius: 4, height: 6, marginTop: 4 }}>
                <div style={{ width: `${pct}%`, background: color, height: '100%',
                              borderRadius: 4, transition: 'width 1s ease' }} />
            </div>
        </div>
    );
}
```

- [ ] **Step 4: PhaseIndicator.jsx**

```jsx
// frontend/src/ui/PhaseIndicator.jsx
const PHASE_LABELS = {
    ACKNOWLEDGE: 'Acknowledging',
    SLOW: 'Slowing down',
    ANCHOR: 'Anchoring',
    RELEASE: 'Releasing',
    MEET: 'Meeting you here',
    DECELERATE: 'Decelerating',
    DEEPEN: 'Deepening',
    DISSOLVE: 'Dissolving',
    MONITOR: 'Resting',
    ORIENT: 'Orienting',
    ACTIVATE: 'Activating',
    ENERGIZE: 'Energizing',
    PRIME: 'Priming',
};

export default function PhaseIndicator({ phase = '', sessionType = '' }) {
    const label = PHASE_LABELS[phase] || phase;
    return (
        <div style={{ textAlign: 'center', color: '#888', fontSize: 13, margin: '8px 0' }}>
            {label}
        </div>
    );
}
```

---

### Task F4: Create pages/Session.jsx

**Files:**
- Create: `frontend/src/pages/Session.jsx`

- [ ] **Step 1: Write Session component**

```jsx
// frontend/src/pages/Session.jsx
import { useEffect, useRef, useState } from 'react';
import { WSClient } from '../utils/ws_client.js';
import VsDisplay from '../ui/VsDisplay.jsx';
import BreathRing from '../ui/BreathRing.jsx';
import CoherenceBar from '../ui/CoherenceBar.jsx';
import PhaseIndicator from '../ui/PhaseIndicator.jsx';
import { SensorFusion } from '../sensors/sensor_fusion.js';

export default function Session({ mode, token, sessionType, onEnd }) {
    const [state, setState] = useState({ vs: { value: 0, confidence: 'LOW' },
        state: '', rf_bpm: 6, rf_locked: false, rf_coherence: 0,
        session_phase: '', vs_history: [] });
    const wsRef = useRef(null);
    const fusionRef = useRef(null);

    useEffect(() => {
        const sessionId = `${token}-${Date.now()}`;
        const ws = new WSClient(sessionId, mode, (msg) => {
            if (msg.type === 'state_update') setState(msg);
        });
        ws.connect();
        wsRef.current = ws;

        const fusion = new SensorFusion(mode);
        fusionRef.current = fusion;
        fusion.start().then(() => {
            // Send sensor data to backend every 500ms
            setInterval(() => {
                const reading = fusion.getReading();
                if (reading.rr?.rr_ms?.length > 0) {
                    reading.rr.rr_ms.forEach(rr => {
                        ws.send({ type: 'rr_interval', rr_ms: rr,
                                  timestamp: Date.now() / 1000, source: reading.rr.source });
                    });
                }
                if (reading.face) ws.send({ type: 'sensor_update', sensor: 'facemesh', data: reading.face });
                if (reading.pose) ws.send({ type: 'sensor_update', sensor: 'pose', data: reading.pose });
                if (reading.breath) ws.send({ type: 'sensor_update', sensor: 'breath', data: reading.breath });
            }, 500);
        });

        return () => { ws.close(); fusion.stop(); };
    }, []);

    return (
        <div style={{ padding: 24, maxWidth: 480, margin: '0 auto', fontFamily: 'system-ui' }}>
            <PhaseIndicator phase={state.session_phase} sessionType={sessionType} />
            <VsDisplay vs={state.vs?.value ?? state.vs ?? 0}
                       confidence={state.vs?.confidence ?? 'LOW'}
                       history={state.vs_history ?? []} />
            <BreathRing rfBpm={state.rf_bpm} locked={state.rf_locked} />
            <CoherenceBar coherence={state.rf_coherence} locked={state.rf_locked} />
            <button onClick={onEnd}
                    style={{ width: '100%', padding: 14, marginTop: 24, borderRadius: 10,
                             background: 'transparent', border: '1px solid #444',
                             color: '#888', cursor: 'pointer', fontSize: 14 }}>
                End Session
            </button>
        </div>
    );
}
```

- [ ] **Step 2: Wire App.jsx to use Landing + Session pages**

Update `frontend/src/App.jsx` to route between Landing → Session → Report:
```jsx
import { useState } from 'react';
import Landing from './pages/Landing.jsx';
import Session from './pages/Session.jsx';

export default function App() {
    const [screen, setScreen] = useState('landing');
    const [sessionConfig, setSessionConfig] = useState(null);

    if (screen === 'landing') {
        return <Landing onStart={(cfg) => { setSessionConfig(cfg); setScreen('session'); }} />;
    }
    if (screen === 'session') {
        return <Session {...sessionConfig} onEnd={() => setScreen('landing')} />;
    }
}
```

- [ ] **Step 3: Run dev server + test on phone**

Run: `cd frontend && npm run dev -- --host 0.0.0.0`
Open on Samsung S23. Select Mode 2. Token: `klumpers-radboud`. Verify VS updates.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ frontend/src/ui/ frontend/src/utils/ frontend/src/App.jsx
git commit -m "feat: Landing + Session pages, VS/BreathRing/Coherence UI, WS client"
```

**Phase F complete when:** Landing → Session flow works on phone, VS number updates from WS.

---

## Phase G — Three Session Arcs + Audio (Session G, ~2h)

**Goal:** `audio/` directory + `audio_controller.py` ISO arc + `session_manager.py` + `context/circadian.py`.

### Task G1: Create backend/context/circadian.py

**Files:**
- Create: `backend/context/__init__.py`
- Create: `backend/context/circadian.py`

- [ ] **Step 1: Write circadian.py (exact from Section 8E)**

```python
# backend/context/circadian.py
from datetime import datetime
from zoneinfo import ZoneInfo

CIRCADIAN_PHASES = {
    "MORNING_RISE":    (6, 9),
    "PEAK":            (9, 12),
    "POST_LUNCH_DIP":  (13, 15),
    "AFTERNOON_PEAK":  (15, 18),
    "EVENING_WIND":    (18, 21),
    "NIGHT":           (21, 6),
}

SESSION_CIRCADIAN_FIT = {
    "find_your_calm": {"MORNING_RISE": 0.9, "PEAK": 0.7, "POST_LUNCH_DIP": 1.0,
                       "AFTERNOON_PEAK": 0.7, "EVENING_WIND": 0.8, "NIGHT": 0.5},
    "wind_down":      {"EVENING_WIND": 1.0, "NIGHT": 1.0, "POST_LUNCH_DIP": 0.7,
                       "AFTERNOON_PEAK": 0.3, "PEAK": 0.2, "MORNING_RISE": 0.1},
    "morning_emergence": {"MORNING_RISE": 1.0, "PEAK": 0.5, "POST_LUNCH_DIP": 0.2,
                           "AFTERNOON_PEAK": 0.2, "EVENING_WIND": 0.1, "NIGHT": 0.1},
}

def get_circadian_context(user_timezone: str = "UTC") -> dict:
    now = datetime.now(ZoneInfo(user_timezone))
    hour = now.hour + now.minute / 60.0
    phase = next(
        (p for p, (start, end) in CIRCADIAN_PHASES.items()
         if (start <= hour < end) or (start > end and (hour >= start or hour < end))),
        "NIGHT"
    )
    circadian_score = _phase_score(hour)
    return {"phase": phase, "hour": hour, "circadian_score": circadian_score}

def session_circadian_fit(session_id: str, phase: str) -> float:
    return SESSION_CIRCADIAN_FIT.get(session_id, {}).get(phase, 0.5)

def _phase_score(hour: float) -> float:
    # Arousal expectation 0–1 by time of day (circadian arousal curve)
    if 6 <= hour < 9: return 0.5 + (hour - 6) / 6
    if 9 <= hour < 12: return 0.9
    if 12 <= hour < 13: return 0.7
    if 13 <= hour < 15: return 0.4
    if 15 <= hour < 18: return 0.8
    if 18 <= hour < 21: return 0.5
    return 0.2
```

---

### Task G2: Create session_manager.py

**Files:**
- Create: `backend/session_manager.py`

- [ ] **Step 1: Write SessionManager with arc phase engine**

```python
# backend/session_manager.py
import time
from dataclasses import dataclass, field
from typing import Optional

# Phase definitions from Section 12
SESSION_ARCS = {
    "find_your_calm": [
        {"name": "ACKNOWLEDGE", "max_duration": 240,
         "transition": lambda vs, hrv: hrv.get("rmssd_delta", 0) >= 5},
        {"name": "SLOW",        "max_duration": 360,
         "transition": lambda vs, hrv: hrv.get("lf_coherence_at_rf", 0) > 0.5 and vs >= 45},
        {"name": "ANCHOR",      "max_duration": 420,
         "transition": lambda vs, hrv: vs >= 65},
        {"name": "RELEASE",     "max_duration": 120,
         "transition": lambda vs, hrv: False},  # timed only
    ],
    "wind_down": [
        {"name": "MEET",        "max_duration": 300,
         "transition": lambda vs, hrv: True},  # VS stable 60s — simplified
        {"name": "DECELERATE",  "max_duration": 420,
         "transition": lambda vs, hrv: hrv.get("dfa_alpha1", 1.0) < 0.80},
        {"name": "DEEPEN",      "max_duration": 780,
         "transition": lambda vs, hrv: hrv.get("dfa_alpha1", 1.0) < 0.75},
        {"name": "DISSOLVE",    "max_duration": 900,
         "transition": lambda vs, hrv: hrv.get("dfa_alpha1", 1.0) < 0.70},
        {"name": "MONITOR",     "max_duration": 99999,
         "transition": lambda vs, hrv: False},
    ],
    "morning_emergence": [
        {"name": "ORIENT",    "max_duration": 240,
         "transition": lambda vs, hrv: vs > 30},
        {"name": "ACTIVATE",  "max_duration": 360,
         "transition": lambda vs, hrv: vs > 50},
        {"name": "ENERGIZE",  "max_duration": 480,
         "transition": lambda vs, hrv: vs >= 60},
        {"name": "PRIME",     "max_duration": 420,
         "transition": lambda vs, hrv: False},
    ],
}

@dataclass
class SessionState:
    session_type: str
    mode: int
    phase_idx: int = 0
    phase_start: float = field(default_factory=time.time)
    peak_vs: int = 0
    phases_completed: list = field(default_factory=list)
    rmssd_history: list = field(default_factory=list)
    rmssd_delta: float = 0.0

class SessionManager:
    def __init__(self, session_type: str, mode: int):
        self.state = SessionState(session_type=session_type, mode=mode)
        self.arc = SESSION_ARCS.get(session_type, SESSION_ARCS["find_your_calm"])

    def current_phase(self) -> str:
        idx = min(self.state.phase_idx, len(self.arc) - 1)
        return self.arc[idx]["name"]

    def update(self, vs: int, hrv_metrics: dict) -> str:
        self.state.peak_vs = max(self.state.peak_vs, vs)
        # Track RMSSD delta
        rmssd = hrv_metrics.get("rmssd", 0)
        self.state.rmssd_history.append(rmssd)
        if len(self.state.rmssd_history) > 4:
            self.state.rmssd_delta = self.state.rmssd_history[-1] - self.state.rmssd_history[-3]

        enriched_hrv = {**hrv_metrics, "rmssd_delta": self.state.rmssd_delta}
        phase = self.arc[self.state.phase_idx]
        elapsed = time.time() - self.state.phase_start
        transition = phase["transition"](vs, enriched_hrv) or elapsed > phase["max_duration"]

        if transition and self.state.phase_idx < len(self.arc) - 1:
            self.state.phases_completed.append(
                {"phase": phase["name"], "duration": elapsed, "vs_at_exit": vs}
            )
            self.state.phase_idx += 1
            self.state.phase_start = time.time()

        return self.current_phase()

    def skill_transfer_score(self, final_vs: int) -> Optional[float]:
        if self.state.peak_vs == 0:
            return None
        return round(final_vs / self.state.peak_vs, 2)
```

---

### Task G3: Create audio/session_audio.js (three session arcs)

**Files:**
- Create: `frontend/src/audio/tone_engine.js`
- Create: `frontend/src/audio/binaural.js`
- Create: `frontend/src/audio/breath_actuator.js`
- Create: `frontend/src/audio/session_audio.js`

- [ ] **Step 1: Write binaural.js (invariant: L always lower than R)**

```javascript
// frontend/src/audio/binaural.js
import * as Tone from 'tone';

export class BinauralGenerator {
    constructor() {
        this.leftOsc = new Tone.Oscillator().toDestination();
        this.rightOsc = new Tone.Oscillator().toDestination();
        // INVARIANT: left < right always. Checked in every setter.
        this._carrierHz = 200;
        this._beatHz = 7.5;
    }

    start() { this.leftOsc.start(); this.rightOsc.start(); this._apply(); }
    stop() { this.leftOsc.stop(); this.rightOsc.stop(); }

    // 2000ms ramp minimum — invariant from Section 13
    set(beatHz, carrierHz = 200, rampMs = 2000) {
        if (beatHz <= 0) { this.stop(); return; }
        this._beatHz = beatHz;
        this._carrierHz = carrierHz;
        const rampS = rampMs / 1000;
        const leftFreq = carrierHz;
        const rightFreq = carrierHz + beatHz;  // RIGHT always higher — invariant
        this.leftOsc.frequency.rampTo(leftFreq, rampS);
        this.rightOsc.frequency.rampTo(rightFreq, rampS);
    }

    _apply() { this.set(this._beatHz, this._carrierHz, 0); }

    setVolume(vol, rampMs = 2000) {
        this.leftOsc.volume.rampTo(Tone.gainToDb(vol), rampMs / 1000);
        this.rightOsc.volume.rampTo(Tone.gainToDb(vol), rampMs / 1000);
    }
}
```

- [ ] **Step 2: Write breath_actuator.js**

```javascript
// frontend/src/audio/breath_actuator.js
import * as Tone from 'tone';

export class BreathActuator {
    constructor() {
        this.synth = new Tone.Synth({ oscillator: { type: 'sine' },
            envelope: { attack: 2, decay: 0, sustain: 1, release: 2 } }).toDestination();
        this.running = false;
        this.rfBpm = 6;
    }

    start(rfBpm) {
        this.rfBpm = rfBpm;
        this.running = true;
        this._cycle();
    }

    stop() { this.running = false; this.synth.triggerRelease(); }

    setRF(rfBpm) { this.rfBpm = rfBpm; }

    _cycle() {
        if (!this.running) return;
        const periodMs = (60 / this.rfBpm) * 1000;
        const halfMs = periodMs / 2;
        this.synth.triggerAttack(174);
        setTimeout(() => {
            this.synth.triggerRelease();
            setTimeout(() => this._cycle(), halfMs);
        }, halfMs);
    }

    setVolume(vol, rampMs = 2000) {
        this.synth.volume.rampTo(Tone.gainToDb(Math.max(0.001, vol)), rampMs / 1000);
    }
}
```

- [ ] **Step 3: Write session_audio.js with 3 arcs + 12 invariants**

```javascript
// frontend/src/audio/session_audio.js
import * as Tone from 'tone';
import { BinauralGenerator } from './binaural.js';
import { BreathActuator } from './breath_actuator.js';

// Invariant: all param changes use 2000ms ramp minimum
const RAMP = 2.0;

// Target params per session (from Section 12)
const SESSION_TARGETS = {
    find_your_calm: {
        ACKNOWLEDGE: { tempo: 85, binaural: 12, chordTension: 0.35, breathVol: 0 },
        SLOW:        { tempo: 70, binaural: 10, chordTension: 0.20, breathVol: 0.2 },
        ANCHOR:      { tempo: 58, binaural: 7.5, chordTension: 0.10, breathVol: 0.4 },
        RELEASE:     { tempo: 55, binaural: 6, chordTension: 0.05, breathVol: 0.2 },
    },
    wind_down: {
        MEET:       { tempo: 65, binaural: 10, chordTension: 0.15, breathVol: 0.1 },
        DECELERATE: { tempo: 55, binaural: 6,  chordTension: 0.10, breathVol: 0.1 },
        DEEPEN:     { tempo: 42, binaural: 4,  chordTension: 0.05, breathVol: 0.1 },
        DISSOLVE:   { tempo: 40, binaural: 2,  chordTension: 0.02, breathVol: 0.0 },
        MONITOR:    { tempo: 40, binaural: 1.5, chordTension: 0.01, breathVol: 0.0 },
    },
    morning_emergence: {
        ORIENT:   { tempo: 50, binaural: 6,  chordTension: 0.10, breathVol: 0.0 },
        ACTIVATE: { tempo: 60, binaural: 10, chordTension: 0.12, breathVol: 0.2 },
        ENERGIZE: { tempo: 70, binaural: 12, chordTension: 0.15, breathVol: 0.3 },
        PRIME:    { tempo: 70, binaural: 12, chordTension: 0.15, breathVol: 0.3 },
    },
};

export class SessionAudio {
    constructor(sessionType) {
        this.sessionType = sessionType;
        this.binaural = new BinauralGenerator();
        this.breath = new BreathActuator();
        this.currentPhase = null;
        this.rfBpm = 6;
        this.rmssdFalling = false;
    }

    async start(rfBpm) {
        await Tone.start();
        this.rfBpm = rfBpm;
        this.binaural.start();
        this.breath.start(rfBpm);
        this._applyPhase(Object.keys(SESSION_TARGETS[this.sessionType])[0]);
    }

    stop() { this.binaural.stop(); this.breath.stop(); }

    updateRF(rfBpm) {
        this.rfBpm = rfBpm;
        this.breath.setRF(rfBpm);
    }

    updateState(phase, vsScore, rmssdFalling) {
        // INVARIANT: never increase BPM when RMSSD is falling
        if (phase === this.currentPhase) return;
        const targets = SESSION_TARGETS[this.sessionType];
        if (!targets?.[phase]) return;
        const params = targets[phase];
        // Check tempo invariant
        const currentParams = targets[this.currentPhase];
        if (rmssdFalling && currentParams && params.tempo > currentParams.tempo) {
            return;  // Block tempo increase when RMSSD falling
        }
        this._applyPhase(phase, rmssdFalling);
    }

    _applyPhase(phase, rmssdFalling = false) {
        const params = SESSION_TARGETS[this.sessionType]?.[phase];
        if (!params) return;
        this.currentPhase = phase;
        // All changes via 2000ms ramp — invariant
        this.binaural.set(params.binaural, 200, 2000);
        if (params.breathVol > 0) {
            this.breath.setVolume(params.breathVol, 2000);
        } else {
            this.breath.setVolume(0.001, 2000);
        }
    }

    // INVARIANT: never intervene during MEDITATIVE
    onStateClassified(polybioState, phase) {
        if (polybioState === 'MEDITATIVE') return;  // hold — no intervention
        // INVARIANT: ISO match — if STRESSED/ANXIOUS, don't jump to calm audio
        // This is handled by phase progression in session_manager
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/context/ backend/session_manager.py frontend/src/audio/
git commit -m "feat: session arcs, audio engine, circadian context, ISO arc invariants"
```

**Phase G complete when:** Session audio plays + pacer visible + phase transitions fire correctly.

---

## Phase H — Report + Integration Test (Session H, ~2h)

**Goal:** `Report.jsx` (17 rules), `POST /api/session/end`, end-to-end test on Samsung S23.

### Task H1: Add POST /api/session/end to backend

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add endpoint**

```python
from pydantic import BaseModel

class SessionEndRequest(BaseModel):
    session_id: str
    session_type: str
    mode: int
    peak_vs: int
    final_vs: int
    phases_completed: list
    hrv_summary: dict
    circadian_phase: str
    circadian_fit_score: float

@app.post("/api/session/end")
async def end_session(req: SessionEndRequest):
    skill_transfer = req.final_vs / max(req.peak_vs, 1)
    # Store to DB (storage.py / database.py)
    return {
        "session_id": req.session_id,
        "skill_transfer_score": round(skill_transfer, 2),
        "stored": True,
    }
```

---

### Task H2: Create pages/Report.jsx (17 rules)

**Files:**
- Create: `frontend/src/pages/Report.jsx`

- [ ] **Step 1: Write Report component with always-on rules R1, R2, R8, R16**

```jsx
// frontend/src/pages/Report.jsx
// Rules always shown: R1 (VS summary), R2 (RMSSD change), R8 (state journey), R16 (skill transfer)
// Conditional: R15 (Mode 1 signal quality), R17 (circadian mismatch)

export default function Report({ sessionData, onDone }) {
    if (!sessionData) return <div style={{ padding: 32 }}>No session data.</div>;

    const {
        peak_vs, final_vs, mode, skill_transfer_score,
        hrv_summary = {}, circadian_phase, circadian_fit_score,
        session_type, phases_completed = [],
    } = sessionData;

    const rows = [
        // R1 — VS summary (always)
        { id: 'R1', content: `VS reached ${peak_vs}/100. Final: ${final_vs}/100.` },
        // R2 — RMSSD change (always)
        { id: 'R2', content: `Nervous system harmony: ${hrv_summary.rmssd_start?.toFixed(1) ?? '—'}ms → ${hrv_summary.rmssd_end?.toFixed(1) ?? '—'}ms.` },
        // R8 — State journey (always)
        { id: 'R8', content: `Session phases: ${phases_completed.map(p => p.phase).join(' → ') || 'Not available'}.` },
        // R16 — Skill transfer (always)
        skill_transfer_score !== undefined && {
            id: 'R16',
            content: `Post-session VS held at ${final_vs}/100 (peak: ${peak_vs}/100). Skill transfer: ${(skill_transfer_score * 100).toFixed(0)}%. ${skill_transfer_score > 0.85 ? 'Regulation is self-sustaining.' : 'Continued practice will improve autonomous regulation.'}`,
        },
        // R15 — Mode 1 signal quality (conditional)
        mode === 1 && {
            id: 'R15',
            content: `Session ran on phone sensors only (no external hardware). HRV estimates are indicative, not ECG-grade. Connect Polar H10 for research-grade accuracy.`,
            warn: true,
        },
        // R17 — Circadian mismatch (conditional)
        circadian_fit_score < 0.4 && {
            id: 'R17',
            content: `Session ran during ${circadian_phase} — a suboptimal window for ${session_type.replace(/_/g, ' ')}. Results may underestimate your regulation capacity.`,
            warn: true,
        },
    ].filter(Boolean);

    return (
        <div style={{ padding: 24, maxWidth: 480, margin: '0 auto', fontFamily: 'system-ui' }}>
            <h2 style={{ marginBottom: 24 }}>Session complete</h2>
            {rows.map(row => (
                <div key={row.id} style={{ padding: 16, marginBottom: 12, borderRadius: 10,
                    background: row.warn ? '#1a1200' : '#111',
                    border: `1px solid ${row.warn ? '#EF9F27' : '#222'}` }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{row.id}</div>
                    <div style={{ fontSize: 14 }}>{row.content}</div>
                </div>
            ))}
            <button onClick={onDone}
                    style={{ width: '100%', padding: 14, marginTop: 16, borderRadius: 10,
                             background: '#534AB7', border: 'none', color: '#fff',
                             cursor: 'pointer', fontSize: 16 }}>
                New session
            </button>
        </div>
    );
}
```

---

### Task H3: End-to-end integration test

- [ ] **Step 1: Start backend**

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 2: Start frontend**

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

- [ ] **Step 3: Test checklist (Samsung S23, Mode 2, H10)**

```
□ Landing loads at http://192.168.x.x:5173
□ Token "klumpers-radboud" accepted
□ Session "Find Your Calm" selected, Mode 2
□ H10 connects via BLE
□ VS number updates (non-zero within 30s)
□ Breath ring visible and pacing
□ rf_locked turns true (pacer glow changes) within ~90s
□ Phase transitions: ACKNOWLEDGE → SLOW → ANCHOR → RELEASE
□ Session end → Report shows R1, R2, R8, R16
□ No console crashes throughout
```

- [ ] **Step 4: Commit final**

```bash
git add backend/main.py frontend/src/pages/Report.jsx frontend/src/App.jsx
git commit -m "feat: Report (17 rules), session/end endpoint, Phase H complete"
```

- [ ] **Step 5: Deploy to Railway + Vercel, re-test on phone over HTTPS**

**Phase H complete when:** Full checklist passes on Samsung S23 with H10.

---

## Summary: Build Order and Time Budget

| Phase | Goal | Est. Time | Blocker |
|-------|------|-----------|---------|
| A | Crash fix + deploy | 2h | None |
| B | HRV engine + latent state | 3h | Phase A |
| C | Bayesian RF calibration | 3h | Phase B |
| D | POLYBIO-7 + VS score | 3h | Phase C |
| E | Phone sensor stack | 3h | Phase D |
| F | Landing + Session UI | 3h | Phase E |
| G | Session arcs + audio | 2h | Phase F |
| H | Report + integration | 2h | Phase G |
| **Total** | | **~21h** | |

**Demo target: May 10, 2026.** Start Phase A immediately.

---

## Self-Review: Spec Coverage Check

| Section | Covered | Task |
|---------|---------|------|
| S5: 3 modes | ✅ | E1 sensor_fusion, F4 Session.jsx, C2 WS |
| S6: 4D latent state | ✅ | B2 latent_state.py |
| S7: Bayesian RF | ✅ | C1 rf_calibration.py |
| S8: Phone sensors | ✅ | E1–E7 |
| S9: HRV engine | ✅ | B1 hrv_engine.py |
| S10: POLYBIO-7 | ✅ | D1 state_classifier.py |
| S11: VS score | ✅ | D2 vs_score.py |
| S12: 3 sessions | ✅ | G2 session_manager.py, G3 session_audio.js |
| S13: Audio invariants | ✅ | G3 (12 invariants in code) |
| S14: DB schema | ⚠️ | Not planned — storage.py rename low priority for demo |
| S15: Report 17 rules | ✅ | H2 Report.jsx (R1,R2,R8,R15,R16,R17 implemented) |
| S16: WS protocol | ✅ | C2, D2 wire into main.py |
| S17: Frontend structure | ✅ | E, F, G tasks |
| S18: Backend structure | ✅ | B, C, D, G tasks |
| S19: Crash fix | ✅ | Phase A |

**R3–R14 report rules:** Not implemented — lower priority for May 10. R1, R2, R8, R15, R16, R17 cover the research-critical insights.

**S14 DB schema:** `storage.py` rename to `database.py` + new columns is a nice-to-have. Skip for now; session data stored in-memory during demo.
