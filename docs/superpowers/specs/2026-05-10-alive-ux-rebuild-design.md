# ALIVE V2 — Full UX + Pipeline Rebuild Design
**Date:** 2026-05-10  
**Status:** Approved  
**Approach:** Backend audit first (Option C) → Clean frontend rebuild (Option B)

---

## 1. Problem Statement

Current app has 5 critical failures:
1. Session creates new BLE sensor without user gesture → zero RR data every session
2. ConnectionRitual mixes BLE connect + calibration + session launch → messy, hard to debug
3. Every session re-runs calibration (user must recalibrate every time)
4. No clean fusion handoff from calibration to session
5. Backend HRV metrics go null after ~22s (RR buffer drain bug)

**Goal:** Seamless flow: open app → connect H10 once → calibrate once per login → dashboard with live HR → sessions work reliably.

---

## 2. Screen Flow

```
App open
  └─ SplashScreen (1.5s — ALIVE brand)
       └─ [not signed in]  → LoginScreen
       └─ [signed in, no profile] → ProfileSetup
       └─ [signed in, has profile] → CalibrationScreen

LoginScreen
  └─ Sign in / Sign up (email + password)
  └─ On success → ProfileSetup (if no profile) OR CalibrationScreen

ProfileSetup (first-time only)
  └─ Fields: name, age, sex, height (cm), weight (kg), resting HR (bpm)
  └─ On complete → CalibrationScreen

CalibrationScreen — "Connect Your Body"  ← EVERY LOGIN
  └─ Phase 1: BLE connect
       └─ "Connect Polar H10" button (requestBle — user gesture)
       └─ Retry loop shown if fails
  └─ Phase 2: Calibrating
       └─ Sends {type:"cal_start"} to /ws/session?mode=2
       └─ Streams RR via drainNew() every 500ms
       └─ Backend sweeps RF 5.0–7.0 bpm in 25s dwells (max 50s total)
       └─ Visual: human silhouette (breathes at RF, heart glows at HR)
       └─ Progressive reveal: progress bar → RMSSD+HR at n_rr≥30 → artifact rate
       └─ Rotating autonomic phrases
  └─ Phase 3: cal_done (auto-proceed, no tap needed)
       └─ Stores: rfBpm, rfLocked, rmssd to profile (patchProfileCalibration)
       └─ Passes cfg={rfBpm, rfLocked, fusion, sensorMode:2, backendMode:2} to App
       └─ App navigates to Dashboard immediately

Dashboard  ← home screen after every calibration
  └─ Always visible: H10 status dot + live HR + RF + coherence (top bar)
  └─ 7-day RMSSD trend chart (mini sparkline)
  └─ Today's calibration card (RMSSD, RF, baseline comparison)
  └─ Session cards (Find Your Calm, Wind Down, Morning Emergence)
  └─ "Begin Session" → Session (passes cfg.fusion from calibration)

Session  ← H10 only, no phone sensors
  └─ Uses fusion from cfg (already started, already connected to BLE)
  └─ Sends {type:"session_start"} — skips backend calibration phase
  └─ RR via fusionRef.current.drainNew() every 500ms
  └─ H10 reconnect banner if bleStatus !== 'connected' (never pauses session)
  └─ Music starts here (not during calibration)
  └─ End → Insight
  └─ Discard → Dashboard

Insight → Dashboard (BLE stays live)
```

---

## 3. Sensor Architecture

### H10 Only (hardcoded for now)
- `sensorMode = 2`, `backendMode = 2` everywhere. No mode picker exposed to user.
- All phone sensors disabled: no rPPG, no camera, no mic, no face mesh, no pose.
- SensorFusion.start() in H10 mode only activates `sensors.h10`.

### BLE Lifecycle
```
SensorContext (global, never destroyed)
  └─ bleRef: BleH10Sensor instance
  └─ bleStatus: 'idle'|'connected'|'reconnecting'|'failed'
  └─ requestBle() — must be called from user gesture (CalibrationScreen button)
  └─ Auto-reconnect: indefinite retry, delay caps at 30s (already in ble_h10.js)
```

### Fusion Handoff Pattern
```
CalibrationScreen
  └─ Creates: new SensorFusion(2, { externalBle: bleRef.current })
  └─ Calls: fusion.start()
  └─ On cal_done: calls onReady({ rfBpm, rfLocked, fusion, sensorMode:2, backendMode:2 })

App.jsx
  └─ setCfg(readyCfg) — cfg.fusion = started fusion instance
  └─ setScreen('dashboard')

Dashboard
  └─ Does not use fusion (H10 data visible via SensorContext.latestRR/latestHR)

Session
  └─ const fusion = cfg.fusion (never creates new one)
  └─ fusionRef.current = fusion
  └─ Does NOT call fusion.start() (already started)
  └─ On cleanup: fusion.stop() only if we created it (cfg.fusion means we didn't)
```

---

## 4. CalibrationScreen Visual Design

### Silhouette SVG
- Full-body outline (head + torso + arms + legs), ~200px tall
- Breathe animation: `scale(0.95 → 1.05)` at `60/target_bpm` second period (60% inhale, 40% exhale)
- Chest glow: radial gradient centered at heart position, pulses on each HR update
  - `scale(1 → 1.4 → 1)` in 300ms when new HR value arrives from H10
- Color: `rgba(124, 111, 247, 0.6)` outline, `rgba(226, 75, 74, 0.8)` heart glow

### Progressive Reveal
| Condition | Shows |
|-----------|-------|
| Phase 1 (BLE connecting) | Connect button, H10 pairing instructions |
| Phase 2, n_rr < 30 | Silhouette + progress bar + "Collecting data…" |
| Phase 2, n_rr ≥ 30 | + Live HR, RMSSD (fade in) |
| Phase 2, cal_done | Auto-proceed to Dashboard |

### Rotating Autonomic Phrases (cycle every 4s)
1. "Listening to your autonomic rhythm…"
2. "Mapping your resonance frequency…"
3. "Your body is speaking — we're learning to hear it"
4. "HRV calibration in progress…"
5. "Finding the frequency where your heart and breath align"

### Artifact Display
- Small badge: `Artifact rate: X%` — green if <5%, amber if 5–15%, red if >15%
- Shown once n_rr ≥ 20

---

## 5. Dashboard Live Values

**Top status bar (always visible while H10 connected):**
- H10 dot (green=connected, amber=reconnecting, grey=idle)
- Live HR: `XX bpm` (updates per RR interval)
- RF: `X.X bpm` (from last calibration, static)
- Coherence: `XX%` (live, from SensorContext — requires active session OR background WS — use SensorContext polling for now)

**Note on coherence outside session:** For V2, coherence is only computed during a live session WS. On Dashboard, show RF value from profile only. Coherence shown as "—" until session starts.

---

## 6. Backend Audit Scope

Full audit of every backend file before frontend rebuild. Fix anything found.

| File | Audit Focus |
|------|------------|
| `main.py` | WS drain loop correctness, cal peek timeout (8s enough?), session loop timing, keepalive, discard path |
| `hrv_processor.py` | Why RMSSD goes null after ~22s. Min buffer size. compute() returning None. |
| `hrv_engine.py` | HF/LF power available in cal_progress? Output format. |
| `rf_calibration.py` | Coherence computation correct for 25s dwells. `best_estimate()` fallback. |
| `artifact_filter.py` | Ectopic rejection. Not too aggressive (rejects valid H10 data). |
| `db.py` | cal_hrv storage. All columns present. sensor_mode stored. |
| `ans_classifier.py` | Graceful output when RR buffer thin (<30 RR). |
| `hrv_simulator.py` | Should be disabled (sim=0 everywhere). Verify. |
| `session_manager.py` | Session phase transitions. |
| `vs_score.py` | Score when HRV metrics partially null. |

---

## 7. Frontend File Changes

### Delete
- `frontend/src/pages/ConnectionRitual.jsx` (has encoding corruption + tangled concerns)

### Create
- `frontend/src/pages/CalibrationScreen.jsx` (new, clean, silhouette + progressive HRV)
- `frontend/src/pages/SplashScreen.jsx` (1.5s brand splash)

### Rewrite
- `frontend/src/App.jsx` — new routing: splash → login → profile → calibration → dashboard → session
- `frontend/src/pages/Dashboard.jsx` — add live HR + RF top bar, today's cal card

### Modify
- `frontend/src/sensors/sensor_fusion.js` — H10-only mode, strip unused sensor branches (keep structure, just don't start them when mode=2)
- `frontend/src/pages/Session.jsx` — use cfg.fusion, never create new fusion, cleanup guard

---

## 8. Data Contracts (unchanged from CLAUDE.md)

| Interface | Rate | Latency |
|-----------|------|---------|
| RR → HRV metrics | 1Hz update, 5min window | <100ms |
| HRV → ANS classifier | Per-window | <200ms |
| ANS → MPC trajectory | 1Hz | <50ms |
| MPC → Tone.js params | 1Hz, 2000ms ramp | <100ms |

---

## 9. Success Criteria

- [ ] H10 connects, calibration runs 30–90s, RF locked
- [ ] Dashboard shows live HR updating every beat
- [ ] Session starts immediately, live RMSSD visible within 30s
- [ ] H10 drop during session → banner → auto-reconnects → data resumes
- [ ] No ghost values (HR shows "--" not stale number when H10 disconnected)
- [ ] Build passes: `npm run build` zero errors
- [ ] Backend smoke test: `python -m pytest backend/tests/ -q` passes
- [ ] Deployed to Railway + Vercel with no crashes

---

## 10. Execution Order

```
Phase 1 — Backend audit + fixes (parallel, 3 agents)
  Agent A: main.py + hrv_processor.py + hrv_engine.py
  Agent B: rf_calibration.py + artifact_filter.py + ans_classifier.py + vs_score.py  
  Agent C: db.py + session_manager.py + api/sessions.py

Phase 2 — Frontend clean rebuild (parallel, 3 agents)
  Agent D: CalibrationScreen.jsx (new) + SplashScreen.jsx (new)
  Agent E: App.jsx routing rewrite + Dashboard.jsx live values
  Agent F: Session.jsx fusion handoff cleanup + sensor_fusion.js H10-only

Phase 3 — Integration + build + test
  Run npm run build
  Run pytest
  Smoke test end-to-end on device
  Push + deploy
```
