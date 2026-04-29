# Three-Mode Functional Design — Phone / H10 / Combined

**Date:** 2026-04-30
**Owner:** Quazi M. Ismail
**Status:** Approved (B path: adaptive RF sweep)

## Goal

Make all three sensor modes — Phone Only, Polar H10 Only, Phone + H10 — fully functional end-to-end:
sensor input → backend pipeline → music + biofeedback → session insight. Add an explicit
calibration screen that performs an adaptive RF (resonance frequency) sweep before the session.

## Non-Goals

- Polar PMD accel-based respiration (deferred — mic is sole respiration source for now)
- Profile-based RF priors using user height (uses default 5.5 bpm prior until profile UI exists)
- Improvements unrelated to the three-mode pipeline

## Architecture

### Screen flow (current → new)

```
login → landing → setup → calibration → session → insight
                                ▲ NEW
```

### Sensor activation rules

| Mode | Rear cam | Front cam | Mic | BLE H10 |
|------|----------|-----------|-----|---------|
| 1 — Phone Only | rPPG (fingertip + torch) | — | resp | — |
| 2 — H10 Only   | — | — | resp | RR |
| 3 — Combined   | — | FaceMesh + BlazePose (shared stream) | resp | RR |

**Hard rule:** never two `getUserMedia` calls per face direction at the same time. Front-cam stream
is acquired once and shared with FaceMesh + BlazePose via track cloning.

### Data flow per session second

```
SensorFusion.getReading() → {rr, resp_bpm, resp_amp, face, pose, breath}
        │
        ▼ WS send (every 500ms)
backend ws/session
   ├─ ArtifactFilter.push(rr) → HRVProcessor
   ├─ _resp_buffer.append(resp_amp)        # NEW: was always zeros
   ├─ during calibration: BayesianRFOptimizer.observe(target_bpm, coherence)
   ├─ during session: VS score, MPC, music params
   └─ emit frame → frontend
```

### Calibration protocol (new)

1. Frontend mounts `Calibration.jsx`. Sends `{type: "cal_start"}` over WS.
2. Backend enters cal mode. For each candidate `target_bpm` (initial 5.5):
   - Sends frame `{cal: true, target_bpm, t_remaining, coherence_so_far}`
   - Frontend renders breathing orb at `target_bpm` for 30s
   - Backend collects RR + resp_amp, computes coherence at target_bpm
   - `BayesianRFOptimizer.observe()` — picks next bpm or locks
3. Lock condition: coherence ≥ `min_coherence_lock` (mode-specific from `MODE_CALIBRATION_CONFIG`).
4. Cap at 120s total. On lock OR cap → backend emits `{cal_done: true, rf_bpm, rf_locked}`.
5. Frontend transitions to `Session.jsx` carrying locked `rf_bpm`. Session audio breath pacer
   starts at this rate.

## Changes by file

### Frontend

- `pages/Calibration.jsx` — **NEW**. Breathing orb at `target_bpm`, progress bar, lock event flash.
- `pages/Session.jsx` — receive `rf_bpm` from cfg, pass to `SessionAudio.start(rfBpm)`.
- `pages/Setup.jsx` — `onReady` no longer triggers session; triggers calibration.
- `App.jsx` — add `'calibration'` screen state. Routes: setup→calibration→session.
- `pages/Landing.jsx` — unchanged.
- `sensors/sensor_fusion.js` — extended:
  - mode 1: rear-cam rPPG only, no front-cam stack until session
  - mode 2: H10 + mic only
  - mode 3: H10 + front-cam (shared track) + mic
  - `getReading()` returns `{rr, resp_bpm, resp_amp, face, pose}`
- `sensors/contact_rppg.js` — sample center 100×100 ROI; SNR-based confidence.
- `sensors/breath_mic.js` — expose `getRespAmplitudeSample()` returning recent dB bandpass amplitude
  (raw signal sample for backend coherence, not just bpm).
- `sensors/facemesh_sensor.js` + `blazepose_sensor.js` — accept optional shared `MediaStream` (do
  not call `getUserMedia` if provided).
- `utils/ws_client.js` — unchanged (already supports arbitrary payloads).

### Backend

- `main.py` ws/session:
  - Accept `resp_bpm` and `resp_amp` in incoming WS messages, push to `_resp_buffer`.
  - Calibration phase gating: while `cal: true` from client, run RF sweep with shorter dwell
    (30s/freq), emit `cal: true` frames; once locked, emit `{cal_done: true}` and exit cal phase.
  - Fix `session_manager.current_phase` (method) used as attribute when writing snapshot.
- `rf_calibration.py` — unchanged (logic is correct).

## Failure modes

| Failure | Behavior |
|---------|----------|
| rPPG signal too noisy | confidence < 0.4 → backend treats as low_sqi, frontend warns user "stay still" |
| Mic permission denied | resp_amp absent → RF stays at default 5.5 bpm prior, never locks; session still runs |
| H10 mid-session disconnect | last RR buffer used; session continues at last known state |
| Calibration timeout (>120s) | use best-so-far `rf_bpm`, mark `rf_locked: false`, session proceeds with prior |

## Success criteria

- Phone Only: enters Setup → Calibration → Session. Sees VS score evolve, ANS state updates, music adapts.
- H10 Only: BLE pair → Calibration → Session. RR-driven HRV; coherence locks if resp signal good.
- Combined: BLE pair + camera → Calibration → Session. All sensors emit; VS score uses ≥4 components.
- All three modes: no console errors, no blank screens, session ends with insight summary.

## Decisions log

- **B (adaptive RF sweep)** chosen over single-freq or implicit cal — backend already has Bayesian
  optimizer; matches V1 vision (RF is core mechanism).
- Mic-only respiration for now (no PMD accel) — simpler; revisit if mic proves unreliable in noise.
- Single calibration screen for all modes (DRY) — mode-specific tuning lives in
  `MODE_CALIBRATION_CONFIG`.
