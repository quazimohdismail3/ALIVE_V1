# Implementation Plan — Three-Mode Functional

**Spec:** `docs/superpowers/specs/2026-04-30-three-mode-functional-design.md`

## Phase 0 — Cross-cutting bug fixes (low risk, no behavior change)

- [ ] 0.1 `backend/main.py`: fix `session_manager.current_phase` (method) accessed as attribute in snapshot write — call `session_manager.current_phase()`
- [ ] 0.2 `backend/main.py`: track current cycle phase string in local var to avoid double-call

**Verify:** `python -m pytest backend/tests` (if any) + `python -m uvicorn backend.main:app` boots

## Phase 1 — Backend: accept resp samples + cal protocol

- [ ] 1.1 `backend/main.py` ws/session: parse `resp_amp` (float) and append to `_resp_buffer`; cap buffer at 500
- [ ] 1.2 Add `cal_active` state machine. On `{type: "cal_start"}` from client → enter cal mode
- [ ] 1.3 Cal loop: 30s dwell per `target_bpm`, compute coherence at end of dwell, observe in optimizer, pick next; total cap = 120s
- [ ] 1.4 Emit `{cal: true, target_bpm, dwell_remaining, coherence_so_far}` once per second during cal
- [ ] 1.5 On lock OR cap → emit `{cal_done: true, rf_bpm, rf_locked}` and exit cal mode
- [ ] 1.6 During cal, do NOT run MPC / music_params / VS — only HRV + coherence
- [ ] 1.7 During session (post-cal), use the locked `rf_bpm` and continue normal frame stream

**Verify:** Manual WS test client sends `{type:"cal_start"}` then RR + resp_amp; receives `cal:true` frames then `cal_done`.

## Phase 2 — Frontend: extend sensor payload + RF carry-through

- [ ] 2.1 `sensors/breath_mic.js`: add `getRespAmplitudeSample()` returning latest 0.1–0.5Hz band amplitude (single float, units arbitrary but stable)
- [ ] 2.2 `sensors/sensor_fusion.js`: extend `getReading()` to include `resp_bpm`, `resp_amp`
- [ ] 2.3 `pages/Session.jsx` send loop: include `resp_bpm`, `resp_amp` in WS payload alongside `rr`
- [ ] 2.4 `pages/Session.jsx`: read `cfg.rfBpm` and pass to `SessionAudio.start(rfBpm)`

**Verify:** `npm run build` passes; manual test sends frames, browser console shows resp_amp non-zero.

## Phase 3 — Calibration screen

- [ ] 3.1 `pages/Calibration.jsx` — **NEW**. Props: `cfg, fusion, onLocked(rfBpm), onSkip`
  - Opens WS via WSClient (same path as Session); sends `cal_start` after auth_ok
  - Polls `fusion.getReading()` every 500ms, sends `{rr, resp_amp}` over WS
  - Reads `cal:true` frames → animates breathing orb at `target_bpm` (inhale 60% / exhale 40% of cycle)
  - On `cal_done` → calls `onLocked(rf_bpm)`
  - Skip button always available (passes default 5.5)
- [ ] 3.2 `App.jsx`: add `'calibration'` screen
  - Setup `onReady` → screen='calibration', cfg includes `fusion`
  - Calibration `onLocked(rfBpm)` → cfg += `{rfBpm, rfLocked: true}`, screen='session'
  - Calibration `onSkip` → cfg += `{rfBpm: 5.5, rfLocked: false}`, screen='session'

**Verify:** Walk through flow on dev server: pick mode → setup → calibration plays orb → session screen carries rfBpm.

## Phase 4 — Camera-stream consolidation

- [ ] 4.1 `sensors/sensor_fusion.js`: when mode 3 (combined), acquire ONE front-cam `MediaStream` and pass to FaceMesh + BlazePose
- [ ] 4.2 `sensors/facemesh_sensor.js`: accept optional `stream` arg, skip `getUserMedia` if provided
- [ ] 4.3 `sensors/blazepose_sensor.js`: same
- [ ] 4.4 Mode 1 (Phone Only): rPPG starts in calibration (rear cam + torch); face/pose stack disabled until V3 (out of scope here — Phone Only doesn't activate front cam this round)
- [ ] 4.5 `sensors/contact_rppg.js`: sample center 100×100 of full-res frame (not 20×20 downscale); compute SNR-based confidence

**Verify:** No "track in use" errors; rPPG produces RR within 30s of fingertip placement.

## Phase 5 — Mode-specific wiring

- [ ] 5.1 Mode 1 (Phone Only): SensorFusion starts rPPG + mic + motion_gate. NO face/pose this round.
- [ ] 5.2 Mode 2 (H10 Only): SensorFusion starts BLE H10 + mic + motion_gate. NO camera.
- [ ] 5.3 Mode 3 (Combined): SensorFusion starts BLE H10 + mic + face + pose (front-cam shared) + motion_gate.
- [ ] 5.4 `Setup.jsx`: needsCamera = mode 1 only (Phone Only); needsBLE = mode 2 or 3; needsFrontCam = mode 3.
  - Phone Only: Step 1 = camera + torch test, Step 2 = "Begin Calibration"
  - H10 Only: Step 1 = pair BLE, Step 2 = "Begin Calibration"
  - Combined: Step 1 = pair BLE + check front cam, Step 2 = "Begin Calibration"

**Verify:** Each mode passes the verification in its own walk-through.

## Phase 6 — End-to-end smoke test

- [ ] 6.1 Build clean: `npm run build` (frontend) + `python -m uvicorn backend.main:app` (backend)
- [ ] 6.2 Phone-only walk-through on phone (rear cam, fingertip): VS score evolves
- [ ] 6.3 H10-only walk-through (real device): RR → HRV → music adapts
- [ ] 6.4 Combined walk-through: all sensor dots green; coherence locks
- [ ] 6.5 Push to main → Vercel + Railway deploy; verify on production URL

## Push policy

After each phase passes verification, commit + push to `main` (per project memory rule). Auto-deploys.

## Out of scope this round

- User profile / height-prior for RF
- Polar PMD accel respiration
- Phone-Only with front-cam face/pose (camera arbitration with rear-cam rPPG too messy in one round)
- WHOOP integration
