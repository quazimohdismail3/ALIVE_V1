# Mission Alive — Manual Testing Checklist
**Version:** V2 in progress  
**Last updated:** 2026-05-10

Use this before every push and after every real H10 session. Work top to bottom.
Mark ✅ pass / ❌ fail / ⚠️ degraded.

---

## 0. Before You Start

| # | Check | Expected |
|---|-------|----------|
| 0.1 | Backend running on Railway | `https://<railway-url>/health` returns `{"status":"ok"}` |
| 0.2 | Frontend deployed on Vercel | App loads, no blank screen |
| 0.3 | Phone connected to internet | HTTPS required for BLE |
| 0.4 | Headphones plugged in | Binaural beats only work in headphones (L ≠ R) |
| 0.5 | Polar H10 strapped to chest, wet | Belt seated below pectorals |

---

## 1. Auth Screen

| # | Action | Expected |
|---|--------|----------|
| 1.1 | Open app on phone | Landing / login screen appears |
| 1.2 | Log in with email | Redirected to Dashboard, no error |
| 1.3 | Refresh page | Still logged in (session persists via Supabase) |
| 1.4 | Sign out | Returns to login screen |

---

## 2. Dashboard (Session Picker)

| # | Action | Expected |
|---|--------|----------|
| 2.1 | Open Dashboard | Three session cards visible: Find Your Calm ◎, Wind Down ◑, Morning Emergence ◐ |
| 2.2 | Check time of day | Correct circadian badge shows on each card (Best now / Decent / Not ideal) |
| 2.3 | Tap a session card | Card highlights with coloured border (teal / indigo / gold) |
| 2.4 | Look at duration chips | Each card shows its own duration options (not a global picker) |
| 2.5 | Find Your Calm chips | Shows 15 min, 25 min, 40 min |
| 2.6 | Wind Down chips | Shows 20 min, 30 min, 45 min |
| 2.7 | Morning Emergence chips | Shows 10 min, 18 min, 25 min |
| 2.8 | Tap a duration chip | Chip highlights in session colour |
| 2.9 | Switch session card | Duration resets to first option of new session |
| 2.10 | Sensor mode picker | Phone Only / Polar H10 / Combined visible |
| 2.11 | Select Polar H10 | "Connect Polar H10" button appears |
| 2.12 | Select Phone Only | Connect button disappears |
| 2.13 | Tap Begin Session | Navigates to Connection / Calibration screen |

---

## 3. Connection Ritual + Calibration

| # | Action | Expected |
|---|--------|----------|
| 3.1 | BLE connect prompt appears | Browser asks permission for Bluetooth |
| 3.2 | Pair Polar H10 | Status shows "connected" |
| 3.3 | H10 disconnected mid-calibration | Error surface, graceful fallback (no crash) |
| 3.4 | Breathing orb animates | Orb expands/contracts at ~5.5 bpm (target pace) |
| 3.5 | HR shown inside orb | Live beats per minute from H10 |
| 3.6 | HRV panel after ~30 RR | RMSSD, HR, artifact rate visible |
| 3.7 | Calibration completes | "RF Locked" card appears with value (e.g., `5.3 bpm`) |
| 3.8 | RF locked value colour | Teal (#3FBFA8) — indicates locked state |
| 3.9 | Skip calibration | Falls through with RF = 5.5 bpm default |
| 3.10 | "Begin Session" | Navigates to Session screen |

---

## 4. Live Session Screen

### 4a. Vitals + Phase Display

| # | Action | Expected |
|---|--------|----------|
| 4.1 | Session starts | Elapsed timer starts from 0 |
| 4.2 | VS score visible | Number 0–100, coloured (purple ≥76, green ≥56, amber ≥31, red <31) |
| 4.3 | ANS state shown | "ventral vagal" / "healthy sympathetic" / etc. |
| 4.4 | Session phase shown | ACKNOWLEDGE → SLOW → ANCHOR → RELEASE (for Find Your Calm) |
| 4.5 | Phase copy text | Phase descriptions visible (if implemented) |

### 4b. RF Row

| # | Action | Expected |
|---|--------|----------|
| 4.6 | RF row visible | Shows dot + "RF" label + value in bpm |
| 4.7 | RF dot colour | Teal = locked, amber = estimating |
| 4.8 | RF locked label | "locked" text appears when rf_locked = true |
| 4.9 | RF value changes | Value updates as backend refines estimate |

### 4c. HRV Chart

| # | Action | Expected |
|---|--------|----------|
| 4.10 | After ~2 RR intervals | HRV chart canvas appears (no chart until 2+ points) |
| 4.11 | Chart animates | Line grows left to right over time (1Hz updates) |
| 4.12 | RMSSD label | Current RMSSD value in ms shown in top right of chart |
| 4.13 | Chart colour | Teal (#3FBFA8) line + gradient fill |
| 4.14 | After 3 min | Chart rolls to show last 180 points (3 min window) |

### 4d. Audio — Binaural Beats (headphones required)

| # | Action | Expected |
|---|--------|----------|
| 4.15 | First audio (auth_ok) | Sound begins within 2s of session start |
| 4.16 | Binaural beats audible | Pulsing/beating sensation in headphones (L + R slightly different) |
| 4.17 | Beat frequency per phase (Find Your Calm) | ACKNOWLEDGE: ~10Hz · SLOW: ~8.5Hz · ANCHOR: ~7.5Hz · RELEASE: ~6Hz |
| 4.18 | Binaural glide | Beat frequency does NOT jump — glides over ~45s (sounds smooth) |
| 4.19 | Carrier shifts with phase | ACKNOWLEDGE/SLOW: 174Hz base · ANCHOR/RELEASE: 256Hz base |

### 4e. Audio — Breath Guide Tone

| # | Action | Expected |
|---|--------|----------|
| 4.20 | Breath tone audible | Soft sine wave pulse, in/out rhythm |
| 4.21 | I:E ratio | Inhale shorter, exhale longer (40:60 split) |
| 4.22 | Tone frequency | 174Hz (low, sub-bass feel in headphones) |
| 4.23 | Breath absent in first phase | ACKNOWLEDGE breathVol = 0 → breath tone silent initially |
| 4.24 | Breath fades in at SLOW phase | Volume ramps from 0 to 0.2 over 2s |

### 4f. Audio — Harmonic Pad / Stems

| # | Action | Expected |
|---|--------|----------|
| 4.25 | Pad audible | Warm chord playing under binaural (triangle wave or stem) |
| 4.26 | If stems downloaded | Chord replaced by stem (choir/strings) — more natural, less synthetic |
| 4.27 | If stems NOT downloaded | PolySynth triangle pad still plays (oscillator fallback) |
| 4.28 | Chord on phase change | New chord plays on every phase transition |
| 4.29 | Ground layer | Bowl/drone texture audible if stem loaded (low, constant) |
| 4.30 | Spatial layer | Rain/nature ambient if stem loaded (background texture) |
| 4.31 | Morning layer | Piano pad audible ONLY during morning_emergence, ACTIVATE+ phases |

### 4g. Session End

| # | Action | Expected |
|---|--------|----------|
| 4.32 | Duration expires | Session auto-ends, shows summary |
| 4.33 | Manual exit | Discard sheet appears (swipe/button) |
| 4.34 | Confirm exit | Returns to Dashboard |
| 4.35 | Session saved | Appears in "Recent sessions" on next Dashboard load |

---

## 5. Sensor Failure Paths

| # | Scenario | Expected behaviour |
|---|----------|-------------------|
| 5.1 | H10 disconnects mid-session | UI shows BLE error, music continues, does not crash |
| 5.2 | No RR for 30s | Buffering / low_sqi status shown, HRV chart pauses |
| 5.3 | App goes to background (iOS) | WakeLock may release; audio continues (browser-dependent) |
| 5.4 | Network drop | WS reconnects; session recovers |

---

## 6. PWA + Mobile

| # | Check | Expected |
|---|-------|----------|
| 6.1 | iOS Safari — Add to Home Screen | App installs as PWA |
| 6.2 | Android Chrome — Add to Home Screen | App installs as PWA |
| 6.3 | Landscape orientation | UI not broken (no horizontal scroll) |
| 6.4 | Font sizes readable | No clipping on small screens (375px wide min) |

---

## 7. Backend + Data

| # | Check | Expected |
|---|-------|----------|
| 7.1 | `GET /health` | `{"status":"ok"}` |
| 7.2 | Session saves to DB | `supabase → sessions` table has new row after session |
| 7.3 | `GET /api/sessions` | Returns last N sessions |
| 7.4 | `GET /api/recommendations` | Returns at least one rec (onboarding type) |
| 7.5 | Calibration result saved | `user_profiles.rf_bpm` updated after calibration |

---

## 8. What Is UNTUNED Right Now

These are known placeholders that require real session data before they can be set correctly.  
**Do not treat these as bugs — they are scientifically gated.**

| Parameter | Current value | Status | How to tune |
|-----------|--------------|--------|-------------|
| **W_RF** (RF engine weight) | 0.0 | ❌ UNTUNED | Run ≥3 sessions × ≥10 min on real H10. Compare rf_bpm from backend vs Polar app. Adjust W_RF in `backend/rf_engine.py` until within ±10%. |
| **ISO bridge α ceiling** | 0.6 | ⚠️ Heuristic | After 5+ real sessions, check if α=0.6 convergence is too fast (user resists) or too slow (no pull). Target: user notices gentle guidance, not forcing. |
| **α direction threshold** | 0.4 (arousal+valence dist) | ⚠️ Heuristic | Log `_totalDist` per session. If "toward" fires too often → raise threshold. If never fires → lower. Tune after V2.1–V2.3. |
| **ANS classifier thresholds** | Defaults from `backend/ans_classifier.py` | ⚠️ Sim-tuned | Validate against real H10 RMSSD. RMSSD avg ~38ms real vs ~65ms sim — classifiers may be miscalibrated. Recheck zone boundaries after V2.2. |
| **State confirmation gate** | 8s stress / 25s calm | ⚠️ Literature value | Reasonable starting point (Lehrer 2010). Adjust if phase transitions feel jerky (lower) or unresponsive (raise). |
| **Stem layer volumes** | Ground: coherence×calm×0.7, Spatial: calm×0.3 | ⚠️ First-listen estimate | Do a full 25-min session with headphones and note if any layer is too loud/soft. Adjust multipliers in `_applyStemPhaseVolumes()` in `session_audio.js`. |
| **Binaural carrier frequencies** | 174Hz / 256Hz / 432Hz | ⚠️ Literature-based | Solfeggio frequencies (no strong RCT evidence). If users report discomfort, try 200Hz / 300Hz / 440Hz. Tune with user feedback. |
| **RMSSD artifact rejection** | >20% from local median | ⚠️ Standard value | Validate with real H10 ectopic beats. If too aggressive → losing valid beats. If too loose → artifacts contaminate RMSSD. |
| **Breath guide I:E ratio** | 40:60 | ✅ Clinical literature | Well-established for RSA. Do not change unless there is clinical reason. |
| **RF sweep range** | 4–8.5 bpm | ✅ Standard HRV RF range | Correct for most adults. Narrow to 4.5–7 if outliers dominate. |

---

## 9. What "Tuned" Looks Like

When V2.1–V2.3 are complete (3+ real H10 sessions):

1. **Compare RMSSD**: App RMSSD vs Polar app RMSSD — should be within ±10%. Log both.
2. **Compare RF**: App locked RF vs Polar breathing app — should feel natural at detected rate.
3. **Check ANS zones**: After a 25-min calm session, end state should be ventral_vagal or healthy_sympathetic — not dorsal_vagal (too sedated) or anxious_sympathetic (no effect).
4. **Subjective report**: Ask user: Did the music feel like it was following you or fighting you? If fighting → lower α. If no pull at all → raise α ceiling or lower confirmation gate.
5. **Chart shape**: HRV chart should trend upward during ANCHOR/RELEASE phases. Flat or downward = something wrong in pipeline.

---

## 10. Known Limitations (Not Bugs)

- **Stems play via oscillator fallback** until `public/stems/{layer}/*.mp3` files are downloaded and Freesound full-quality downloads are obtained (requires free Freesound account).
- **No stem tuning** to specific carrier frequencies (174/256/432Hz) — bowl recordings are at natural pitch, not frequency-matched. Use for texture only, not entrainment.
- **iOS audio unlock**: iOS requires a user tap before Web Audio starts. Session begins correctly after the "Begin Session" button tap.
- **WakeLock on iOS**: Not supported in iOS ≤15. Screen may dim during long sessions.
- **BLE on iOS**: Only works in Safari (not Chrome on iOS). Tell users to use Safari.
