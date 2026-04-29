# Frontend V2 Design Spec — Mission Alive
**Date:** 2026-04-30  
**Status:** APPROVED  
**Scope:** Complete frontend redesign matching alive-v2 backend. 6 screens, living UI, modular hooks, audio wired, discard flow, insight debrief.

---

## 1. Context & Constraints

### Backend facts (locked — do not invent)
- **WS endpoint:** `ws://host/ws/session?session=<PROFILE>&mode=<2|3>`
- **Auth:** first WS message must be `{"type":"auth","token":"<jwt>","timezone":"<tz>"}`
- **RR input (real sensor):** `{"rr": <float_ms>}` — field name is `rr`, value in ms
- **Control:** `{"cmd":"stop"}` | `{"cmd":"discard"}`
- **Mode=1 retired:** never send mode=1. Simulator removed from user flow.
- **WS output frame fields:** `t, metrics, state, ans{state,confidence,actionable,scores}, affect{arousal,valence,quadrant}, vs{vs,confidence,components_used,mode}, music_params{bpm,rhythmic_complexity,beat_regularity,silence_ratio,key_mode,harmonic_tension,chord_complexity,voice_range_presence,brightness,roughness,warmth,spatial_width,soma_carrier_hz,binaural_beat_hz,breath_sync_ratio,micro_variation}, strategy, mpc_score, safety{safe,reason}, rf_locked, rf_bpm, rf_coherence, session_phase, session_type`
- **Status frames:** `{"status":"buffering","n_rr":N}` | `{"status":"low_sqi","sqi":float}`
- **REST:** `POST /api/session/end` with `SessionEndRequest` model

### Session profiles (3 active)
| Frontend label | WS param | Arc phases |
|---|---|---|
| Find Your Calm | `find_your_calm` | ACKNOWLEDGE→SLOW→ANCHOR→RELEASE |
| Wind Down | `wind_down` | MEET→DECELERATE→DEEPEN→DISSOLVE→MONITOR |
| Morning Emergence | `morning_emergence` | ORIENT→ACTIVATE→ENERGIZE→PRIME |

### Sensor modes
| Frontend label | backend mode | Sensors activated |
|---|---|---|
| Phone Only | `2` | ContactRPPG (rear cam + torch) + FaceMesh (front cam) + BlazePose + BreathMic |
| Polar H10 | `2` | BleH10 only |
| Phone + Polar H10 | `3` | BleH10 + FaceMesh + BlazePose + BreathMic (rPPG replaced by H10) |

### ANS states (from backend `ans_classifier.py`)
```
ventral_vagal | healthy_sympathetic | anxious_sympathetic | dorsal_vagal | burnout_rigidity
```

### VS color bands (from backend `vs_score.py`)
```
0–30:   #E24B4A  (shutdown/anxious)
31–55:  #EF9F27  (stressed/activated)
56–75:  #1D9E75  (regulated)
76–100: #534AB7  (flow/meditative)
```

---

## 2. Design Philosophy: The Living UI

Every visual element responds to physiological signal. No static screens during session.

| Signal source | Drives |
|---|---|
| `ans.state` | `--ambient` color (full-screen glow shifts over 1200ms) |
| `vs.vs` | `--vs-period` CSS var → orb pulse frequency |
| `rf_bpm` | `--rf-bpm` CSS var → breath ring animation speed (pure CSS) |
| `rf_locked` | Ring color purple→green + bloom keyframe |
| `rf_coherence` | Background particle opacity |
| `session_phase` | Layout transition (fade+slide) |

### CSS animation tokens
```css
/* ANS state → ambient color (root-level cascade) */
[data-ans="ventral_vagal"]       { --ambient: #00D084; }
[data-ans="healthy_sympathetic"] { --ambient: #EF9F27; }
[data-ans="anxious_sympathetic"] { --ambient: #E24B4A; }
[data-ans="dorsal_vagal"]        { --ambient: #4A7FA5; }
[data-ans="burnout_rigidity"]    { --ambient: #7B5EA7; }

/* VS score → pulse period (set via inline style on data attribute) */
/* VS 0–30:   --vs-period: 3.0s */
/* VS 31–55:  --vs-period: 2.0s */
/* VS 56–75:  --vs-period: 1.4s */
/* VS 76–100: --vs-period: 0.8s */

/* RF BPM → breath ring (set via inline style) */
.breath-ring {
  animation: breathe calc(60000ms / var(--rf-bpm, 6)) ease-in-out infinite;
}

/* Locked bloom */
@keyframes rfBloom {
  0%   { box-shadow: 0 0 0 0 var(--locked); }
  70%  { box-shadow: 0 0 0 24px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

/* Reduced motion: disable all except color transitions */
@media (prefers-reduced-motion: reduce) {
  .breath-ring, .vs-orb, .ambient-bg { animation: none; }
}
```

### Design tokens
```css
:root {
  --bg:           #0a0a0f;
  --surface:      #111118;
  --surface-alt:  #17171f;
  --border:       #222230;
  --primary:      #534AB7;
  --primary-dim:  #3d358a;
  --locked:       #00D084;
  --locked-dim:   #00a066;
  --text:         #f0f0f5;
  --text-muted:   #6b6b80;
  --text-dim:     #3a3a50;
  --warn:         #c8a040;
  --danger:       #e05555;
  --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 20px;
  --font-head: 'Figtree', -apple-system, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;
}
```

---

## 3. Screen Architecture

```
App state machine (useState in App.jsx):
  'login' → 'landing' → 'setup' → 'session' → 'insight'
                                       ↓
                                   'discard' → 'landing'
```

No React Router. State machine in App.jsx with `screen` + `cfg` + `sessionResult` state.

### App.jsx state shape
```js
const [screen, setScreen] = useState('landing')
const [cfg, setCfg] = useState(null)         // { mode, session }
const [sessionResult, setSessionResult] = useState(null) // accumulated session data
```

---

## 4. Landing Screen (`pages/Landing.jsx`)

### Responsibilities
- Session type selection (3 options)
- Sensor mode selection (3 options)
- Circadian fit badges (client-side, no API)
- Emit: `onStart({ mode, session })`

### Circadian fit (client-side)
```js
// Matches backend SESSION_CIRCADIAN_FIT table exactly
const SESSION_CIRCADIAN_FIT = {
  find_your_calm: { MORNING_RISE:0.9, PEAK:0.7, POST_LUNCH_DIP:1.0, AFTERNOON_PEAK:0.7, EVENING_WIND:0.8, NIGHT:0.5 },
  wind_down:      { EVENING_WIND:1.0, NIGHT:1.0, POST_LUNCH_DIP:0.7, AFTERNOON_PEAK:0.3, PEAK:0.2, MORNING_RISE:0.1 },
  morning_emergence: { MORNING_RISE:1.0, PEAK:0.5, POST_LUNCH_DIP:0.2, AFTERNOON_PEAK:0.2, EVENING_WIND:0.1, NIGHT:0.1 },
}
const CIRCADIAN_PHASES = { MORNING_RISE:[6,9], PEAK:[9,12], POST_LUNCH_DIP:[13,15], AFTERNOON_PEAK:[15,18], EVENING_WIND:[18,21], NIGHT:[21,6] }
```
Fit ≥ 0.8 → green badge "Best now". Fit 0.5–0.79 → amber "Decent". Fit < 0.5 → dim "Not ideal".

### Session cards
Each card: name (600 16px Figtree) + description (12px muted) + circadian badge + best-time hint.

| Session | Description | Best time hint |
|---|---|---|
| Find Your Calm | Slow. Breathe. Restore. | Afternoon or evening |
| Wind Down | Prepare for deep rest. | Evening or night |
| Morning Emergence | Activate. Rise. Prime. | 6–9am |

### Mode cards
| Mode | Label | Desc | Badge color |
|---|---|---|---|
| Phone Only | Phone Only | Camera + mic. No hardware. | amber (MEDIUM) |
| Polar H10 | Polar H10 | ECG-grade RR. Cleanest HRV. | green (HIGH) |
| Phone + H10 | Phone + Polar H10 | All sensors. Best science. ❆ | green (HIGHEST) |

### Interactions
- Card tap: select (border + bg change, 150ms transition)
- Both session + mode must be selected to enable CTA
- Default: session=find_your_calm, mode=2 (H10)

---

## 5. Setup Screen (`pages/Setup.jsx`)

### Responsibilities
- Request browser permissions per mode
- Initialize SensorFusion
- Show per-sensor status + live preview
- Acquire WakeLock (phone/combined modes)
- Capture timezone
- Unlock "Begin Session" when signal ready
- Pass initialized fusion ref to Session

### Sensor init sequence (parallel, not serial)
```
mode=Phone Only:
  → ContactRPPGSensor.start()     (rear cam, torch, getUserMedia)
  → FaceMeshSensor.start()        (front cam, MediaPipe)
  → BlazePoseSensor.start()       (same front cam stream)
  → BreathMicSensor.start()       (getUserMedia audio)

mode=H10:
  → BleH10Sensor.start()          (navigator.bluetooth.requestDevice)

mode=Phone+H10:
  → BleH10Sensor.start()          (BLE)
  → FaceMeshSensor.start()        (front cam)
  → BlazePoseSensor.start()       (front cam)
  → BreathMicSensor.start()       (mic)
  NOTE: no ContactRPPG — H10 is the RR source
```

### Per-sensor status states
`idle → requesting → connected | failed`

Connected: green checkmark + live reading preview  
Failed: amber warning + "Tap to retry" — never blocks Begin

### rPPG UX detail
- Show rear camera canvas (20×20 scaled up to ~80×80 preview)
- Overlay text: "Place fingertip firmly over lens"
- Torch indicator: 🔦 activates automatically
- Buffer fill: `[████░░░░░░] 14/30 RR intervals` (animates as data arrives)
- Connected when ≥ 10 RR intervals in buffer

### H10 UX detail
- "Scanning for Polar H10…" spinner
- If device found: device name card + "Tap to pair"
- Pairing: "Connecting…" → "✓ Polar H10 · 68 bpm"
- No device found after 15s: "Device not found. Retry | Skip"

### Unlock condition
```js
const ready =
  (mode === 2 && source === 'phone' && rppgBuffer >= 10) ||
  (mode === 2 && source === 'h10'   && h10Connected && h10RRCount >= 5) ||
  (mode === 3 && h10Connected && h10RRCount >= 5) ||
  anyRRSourceActive // graceful degradation
```

### WakeLock + timezone
```js
// WakeLock — acquired in Setup, released in Insight
const wakeLock = await navigator.wakeLock.request('screen').catch(() => null)

// Timezone — captured once, sent in WS auth message
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
```

### Props out
```js
onReady({ fusionRef, wakeLockRef, timezone })
```

---

## 6. Session Screen (`pages/Session.jsx`)

### Responsibilities
- Open WebSocket, complete auth handshake
- Drive SensorFusion → send RR intervals
- Route every WS frame to UI + audio
- Accumulate VS history, peak, phases
- Handle discard flow
- On end: collect summary → navigate to Insight

### WS connection via `useWSSession` hook
```js
const { data, status, send, close, discard } = useWSSession({
  session: cfg.session,    // profile name (NOT a token or sessionId)
  mode: cfg.mode,          // 2 or 3
  authToken,               // from supabase.auth.getSession()
  timezone,                // from Setup
})
```

### RR sending (fixed — correct format)
```js
// Every 500ms, via useSensorFusion polling interval
const reading = fusion.getReading()
if (reading?.rr?.rr_ms?.length > 0) {
  reading.rr.rr_ms.slice(-5).forEach(rr => send({ rr }))  // {rr: float} only
}
// sensor_update messages removed — backend ignores them
```

### WS frame routing (every frame)
```js
if (msg.status === 'buffering') { setStatus('buffering'); return }
if (msg.status === 'low_sqi')   { setStatus('low_sqi');   return }
if (!('t' in msg))              { return }  // unknown frame

setData(msg)                                              // reactive UI update
sessionAudio.updateRF(msg.rf_bpm)                        // audio sync
if (msg.session_phase !== prevPhaseRef.current) {
  sessionAudio.updateState(msg.session_phase, msg.ans.state, false)
  prevPhaseRef.current = msg.session_phase
}
const vsVal = msg.vs?.vs ?? 0
if (vsVal > peakVsRef.current) peakVsRef.current = vsVal
vsHistoryRef.current = [...vsHistoryRef.current.slice(-120), vsVal]
```

### Layout (top → bottom)
```
SensorStatusBar          ← per-sensor icon + SQI + ⋮ menu
PhaseIndicator           ← phase label + arc progress dots
VS Orb                   ← pulsating, color-coded, sparkline below
BreathRing               ← CSS-animated at rf_bpm rate, green if locked
CoherenceBar             ← liquid fill, --locked color when rf_locked
AnsState | AffectQuadrant ← side by side (50/50)
HrvMetrics (collapsible) ← RMSSD, HR, DFA, SD1, SD2
MusicParams (collapsible)← BPM, key, binaural hz, warmth/brightness bars
End & Save button        ← primary, bottom
```

### Safety fallback display
When `safety.fallback_active`: amber banner above VS orb: "Safety mode active — music stabilising"

### Discard flow
- ⋮ menu (top right, 44×44 tap target) → bottom sheet
- Sheet options: "End & Save" (primary) / separator / "Discard Session" (danger color)
- Discard → confirm sheet: "Raw signal data is kept. Insights won't be generated." → [Continue] [Yes, discard]
- On confirm: `send({cmd:'discard'})` → `close()` → `setScreen('landing')`
- On normal end: collect summary → `setScreen('insight')`

### Session summary shape (passed to Insight)
```js
{
  session_type: string,
  mode: int,
  peak_vs: int,
  final_vs: int,
  rf_locked: bool,
  rf_bpm: float,
  rf_lock_epoch_s: int | null,
  vs_history: number[],          // full session sparkline
  phases_completed: array,       // from session_manager via WS
  hrv_summary: {
    rmssd_start: float,
    rmssd_end: float,
    dfa_start: float,
    dfa_end: float,
  },
  circadian_phase: string,
  circadian_fit_score: float,
  duration_s: int,
}
```

---

## 7. Insight Screen (`pages/Insight.jsx`)

### Responsibilities
- Full post-session debrief narrative
- VS arc chart (sparkline of full session)
- Phase timeline (visual journey)
- HRV delta (start → end)
- R-code insight cards
- RF calibration result
- Next-session recommendation
- "Start New Session" CTA
- Release WakeLock

### Sections (in order)

**Header**
Session name + duration + date/time. Formatted: "Find Your Calm · 12 min · Today 3:42 PM"

**Session Arc (SessionTimeline)**
Horizontal dot trail. Each dot = a phase. Dot grows on completion. Timestamp below. VS score at phase exit shown as small number above dot.

**Nervous System Score**
Two metrics side by side:
- Peak VS: large number + color band label
- Skill Transfer Score: `final_vs / peak_vs * 100`% as percentage bar

**HRV Shift**
`RMSSD: 42ms → 68ms ↑ +62%` and `DFA: 0.96 → 0.81 ↓ -0.15`
Arrow color: green if improved toward session target, amber if not.

**VS History sparkline**
Full-session line chart. X=time, Y=VS 0–100. Color-coded by band.

**Insight Cards (InsightCard component)**
| Code | Condition | Content |
|---|---|---|
| R1 | always | "Nervous system reached {peak_vs}/100 harmony. Final: {final_vs}/100." |
| R2 | rmssd_start available | "HRV: {rmssd_start}ms → {rmssd_end}ms" |
| R8 | phases_completed.length > 0 | Arc journey narrative |
| R16 | peak_vs > 0 | Skill transfer narrative |
| RF | rf_locked | "Resonant frequency: {rf_bpm} BPM locked at {rf_lock_epoch_s}s" |
| R15 | mode phone-only (no H10) | Phone-sensor caveat (amber card) |
| R17 | circadian_fit_score < 0.4 | Timing mismatch (amber card) |

**Next Session Recommendation**
Client-side logic:
- `final_vs > 70` → "Excellent session. Try {same_session} again tomorrow at {optimal_time}."
- `final_vs 50–70` → "Good progress. Consistency builds regulation. Same time tomorrow."
- `final_vs < 50` → "Shorter session may work better. Try 5 min of {session_type}."
- Also uses current circadian phase to suggest session type alignment.

**CTA**
"Start New Session" → `setScreen('landing')` + clear sessionResult + release WakeLock

---

## 8. Modular Architecture

### Directory structure
```
frontend/src/
├── pages/
│   ├── LoginScreen.jsx        auth form (Supabase)
│   ├── Landing.jsx            session + mode config
│   ├── Setup.jsx              sensor init + permission flow [NEW]
│   ├── Session.jsx            live session orchestrator
│   └── Insight.jsx            post-session debrief [NEW]
│
├── ui/                        stateless display components (props → JSX only)
│   ├── VsDisplay.jsx          VS number + color + sparkline
│   ├── BreathRing.jsx         CSS-animated ring (rf_bpm, locked)
│   ├── CoherenceBar.jsx       liquid fill bar (coherence, locked)
│   ├── PhaseIndicator.jsx     phase label + arc dots
│   ├── AnsState.jsx           state label + 5-bar scores [NEW]
│   ├── AffectQuadrant.jsx     2D arousal/valence grid [NEW]
│   ├── HrvMetrics.jsx         collapsible metrics row [NEW]
│   ├── MusicParams.jsx        collapsible music param bars [NEW]
│   ├── SensorStatusBar.jsx    per-sensor health icons [NEW]
│   ├── InsightCard.jsx        styled R-code card [NEW]
│   ├── SessionTimeline.jsx    arc phase dot trail [NEW]
│   └── DiscardSheet.jsx       bottom sheet + confirm [NEW]
│
├── hooks/                     reusable stateful logic, no JSX
│   ├── useWSSession.js        WS open/auth/message/close [NEW]
│   ├── useSensorFusion.js     sensor lifecycle + polling [NEW]
│   ├── useWakeLock.js         screen wake lock [NEW]
│   └── useSessionAccum.js     accumulate VS history, peaks, phases [NEW]
│
├── sensors/                   unchanged (already modular)
├── audio/                     unchanged
├── utils/ws_client.js         unchanged (bug fixes applied)
├── lib/supabase.js
├── context/AuthContext.jsx
└── styles/global.css          extended with animation tokens
```

### Hook contracts (interfaces frozen — internals swappable)

```js
// useWSSession — owns WS lifecycle
const { data, status, send, close, discard } = useWSSession({ session, mode, authToken, timezone })
// data: latest complete WS frame (null until first frame)
// status: 'connecting'|'authenticating'|'buffering'|'live'|'low_sqi'|'ended'|'error'
// send(obj): sends JSON if WS open
// close(): sends {cmd:'stop'}, closes WS
// discard(): sends {cmd:'discard'}, closes WS

// useSensorFusion — owns sensor lifecycle
const { ready, sqi, fusionRef, start, stop } = useSensorFusion(mode)
// ready: bool — at least one RR source active with data
// sqi: float 0–1 — current signal quality
// fusionRef.current: SensorFusion instance

// useWakeLock — screen wake lock
const { active, acquire, release } = useWakeLock()

// useSessionAccum — accumulates session metrics across WS frames
const { vsHistory, peakVs, firstRmssd, latestRmssd, firstDfa, latestDfa } = useSessionAccum(data)
```

---

## 9. Audio Wiring

Session.jsx must wire audio on every WS frame. Currently completely disconnected.

```js
// On session start (after auth_ok):
sessionAudioRef.current = new SessionAudio(cfg.session)
await sessionAudioRef.current.start(6)  // default RF until locked

// On every data frame:
sessionAudioRef.current.updateRF(data.rf_bpm)
if (data.session_phase !== prevPhaseRef.current) {
  sessionAudioRef.current.updateState(data.session_phase, data.ans?.state, false)
  prevPhaseRef.current = data.session_phase
}

// On session end / discard:
sessionAudioRef.current.stop()
```

**SessionAudio expects:** session type from `{find_your_calm, wind_down, morning_emergence}` — already matches.

---

## 10. Backend Changes Required

| File | Change | Why |
|---|---|---|
| `backend/hrv_simulator.py` | Add `find_your_calm`, `wind_down`, `morning_emergence` to PROFILES dict | Session lookup in main.py won't fall back to `calm` |
| `backend/session_manager.py` | Add SESSION_ARCS entries for `calm→find_your_calm`, `recovery→wind_down`, `energy→morning_emergence` aliases | session_profile from PROFILES matches arc lookup |
| `backend/main.py` | Parse `timezone` from WS auth message; pass to `get_circadian_context()` | Circadian context uses real user timezone |
| `backend/main.py` | Fix `latent_extractor.compute(metrics, mode=current_mode)` → correct 5-arg signature | Currently silently broken — latent state never computed |
| `backend/main.py` | Never call `HRVSimulator` when mode >= 2 (already the case) | Confirm no regression when session names change |

---

## 11. Critical Bug Fixes (from original audit)

| ID | Location | Bug | Fix |
|---|---|---|---|
| B1 | `Session.jsx:81` | Sends `{type:'rr_interval', rr_ms:float}` — backend reads `msg["rr"]` | Send `{rr: float}` only |
| B2 | `Session.jsx:55` | `WSClient(sessionId, mode, ...)` — uses token+timestamp as `?session=` | Pass `cfg.session` (profile name) |
| B3 | `Landing.jsx:8` | Session IDs `find_your_calm/wind_down/morning_emergence` were correct but blocked by PROFILES mismatch | Backend PROFILES fix resolves |
| B4 | `Session.jsx` | `msg.type === 'state_update'` check — backend never sends this type | Check `'t' in msg` instead |
| B5 | `Session.jsx` | Audio never started | Wire `SessionAudio` in Session.jsx |
| B6 | `main.py` | `latent_extractor.compute()` wrong signature | Fix call site |

---

## 12. Cleanup (orphaned files to delete)

Safe to delete — zero imports from any active page or hook:

```
frontend/src/components/   (entire directory — 14 files)
frontend/src/engines/      (entire directory — 6 files)
frontend/src/context/AppContext.jsx
frontend/src/store/        (if exists)
```

Audio and sensor directories: keep (active).

---

## 13. Verification Checklist

### Per phase
- [ ] `npm run build` passes zero errors
- [ ] `python -m pytest backend/tests/ -v` — 32/32 pass
- [ ] No `.env` or secrets in any changed file

### WS contract
- [ ] First outbound frame: `{"type":"auth","token":"...","timezone":"..."}`
- [ ] First inbound after auth: `{"type":"auth_ok"}`
- [ ] RR outbound: `{"rr": 850.0}` — not `rr_ms`, not `rr_interval`
- [ ] `?session=find_your_calm` (not a token-timestamp)
- [ ] `?mode=2` or `?mode=3` (never `?mode=1`)

### UI
- [ ] VS orb changes pulse period as VS changes bands
- [ ] Breath ring animates at correct BPM rate (CSS var update)
- [ ] Ring color shifts green when `rf_locked === true`
- [ ] Ambient background color shifts with ANS state (1200ms transition)
- [ ] Audio starts after auth_ok, updates on phase change, stops on end/discard
- [ ] Discard: no Insight screen shown, back to Landing
- [ ] WakeLock active during session for phone modes
- [ ] Insight screen shows all R-codes with correct conditional logic

### Accessibility
- [ ] All touch targets ≥ 44px
- [ ] `prefers-reduced-motion`: all animations disabled, color transitions kept
- [ ] Focus states visible on all interactive elements
- [ ] No info conveyed by color alone (text labels accompany all colored states)
