# Implementation Plan: Frontend V2 — Mission Alive
**Date:** 2026-04-30  
**Spec:** `docs/superpowers/specs/2026-04-30-frontend-v2-design.md`  
**Execution:** Each phase is self-contained. Run in order. Never skip.

---

## Phase 0: Documentation Discovery (READ BEFORE ANY CODE)

**Before writing a single line, read these files in full:**

| File | Why |
|---|---|
| `docs/superpowers/specs/2026-04-30-frontend-v2-design.md` | Master spec — all contracts, tokens, hook interfaces |
| `backend/main.py` | WS route, auth handshake, frame format, discard logic |
| `backend/session_manager.py` | SESSION_ARCS keys, arc phase names |
| `backend/hrv_simulator.py` | PROFILES dict keys |
| `backend/vs_score.py` | VS_COLOR_BANDS exact hex values |
| `backend/ans_classifier.py` | ANS state strings |
| `frontend/src/audio/session_audio.js` | SessionAudio API: start(), updateRF(), updateState(), stop() |
| `frontend/src/sensors/sensor_fusion.js` | SensorFusion API: start(), stop(), getReading() |
| `frontend/src/sensors/contact_rppg.js` | getLatestRR() return shape |
| `frontend/src/sensors/ble_h10.js` | getLatestRR() return shape |
| `frontend/src/utils/ws_client.js` | WSClient constructor, connect(), send(), close() |
| `frontend/src/context/AuthContext.jsx` | useAuth() shape: {user, session, loading} |
| `frontend/src/styles/global.css` | Existing CSS vars — do not conflict |

**Allowed APIs (confirmed from source, do not invent):**
```
WSClient(session, mode, authToken, onMessage) — 4 args
SensorFusion(mode) — 1 arg; .start(), .stop(), .getReading()
SessionAudio(sessionType) — 1 arg; .start(rfBpm), .updateRF(bpm), .updateState(phase, ansState, bool), .stop()
supabase.auth.getSession() → { data: { session: { access_token } } }
navigator.wakeLock.request('screen') → WakeLockSentinel | throws
Intl.DateTimeFormat().resolvedOptions().timeZone → string
navigator.bluetooth.requestDevice({filters, optionalServices}) → BluetoothDevice
```

**Anti-patterns — never do these:**
- `new WSClient(sessionId, ...)` — first arg must be session profile name, not a token-timestamp
- `ws.send({rr_ms: x})` — must be `ws.send({rr: x})`
- `msg.type === 'state_update'` — backend never sends this type
- `mode=1` — never. Simulator retired.
- Inline hex colors — use CSS vars from spec Section 2
- `useNavigate` — app uses state machine, not React Router
- Import from `frontend/src/components/` — being deleted
- Import from `frontend/src/engines/` — being deleted

---

## Phase 1: Backend Fixes (4 files, ~21 lines total)

**Goal:** Session names resolve correctly, latent state computed, timezone respected.

### 1A — `backend/hrv_simulator.py` — add 3 profile aliases

Find `PROFILES: dict[str, list[Phase]] = {` (line ~30).  
Add three aliases pointing to existing profile data:

```python
# After existing profiles, add aliases for arc-name lookup:
PROFILES["find_your_calm"] = PROFILES["calm"]
PROFILES["wind_down"]      = PROFILES["recovery"]  
PROFILES["morning_emergence"] = PROFILES["energy"]
```

### 1B — `backend/session_manager.py` — add SESSION_ARCS aliases

Find `SESSION_ARCS = {` dict. Add aliases after the closing `}`:

```python
SESSION_ARCS["calm"]     = SESSION_ARCS["find_your_calm"]
SESSION_ARCS["recovery"] = SESSION_ARCS["wind_down"]
SESSION_ARCS["energy"]   = SESSION_ARCS["morning_emergence"]
```

### 1C — `backend/main.py` — accept timezone from WS auth message

Find: `user_id = user_claims["sub"]`  
Add after it:

```python
user_timezone = auth_msg.get("timezone", "UTC")
```

Find: `circadian_ctx = get_circadian_context("UTC")`  
Replace with:

```python
circadian_ctx = get_circadian_context(user_timezone)
```

### 1D — `backend/main.py` — fix latent_extractor.compute() call

Find: `ls = latent_extractor.compute(metrics, mode=current_mode)`

The actual signature is:
`compute(hrv_metrics: dict, face_features: dict, pose_features: dict, context: dict, mode: int)`

Replace with:
```python
ls = latent_extractor.compute(
    metrics.to_dict(),
    face_features={},    # populated Phase E (future)
    pose_features={},    # populated Phase E (future)
    context=circadian_ctx,
    mode=current_mode,
)
```

**Verification:**
- [ ] `grep -n "find_your_calm\|wind_down\|morning_emergence" backend/hrv_simulator.py` → 3 results
- [ ] `grep -n "find_your_calm\|wind_down\|morning_emergence" backend/session_manager.py` → 3+ results
- [ ] `grep -n "user_timezone" backend/main.py` → 2 results (set + passed to circadian)
- [ ] `grep -n "latent_extractor.compute" backend/main.py` → call has 5 args
- [ ] `python -m pytest backend/tests/ -v` → 32/32 pass

---

## Phase 2: Global CSS — Design Tokens + Animation System

**Goal:** Single CSS source of truth. All new pages use vars, zero inline hex.

**File:** `frontend/src/styles/global.css`

**Action:** Append the following to the END of the existing file (do not replace existing vars):

```css
/* ── Mission Alive V2 Design Tokens ────────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap');

:root {
  /* Backgrounds */
  --bg:           #0a0a0f;
  --surface:      #111118;
  --surface-alt:  #17171f;
  --border:       #222230;
  --border-muted: #1a1a28;

  /* Brand */
  --primary:      #534AB7;
  --primary-dim:  #3d358a;

  /* Coherence / locked state */
  --locked:       #00D084;
  --locked-dim:   #00a066;

  /* VS color bands — match backend vs_score.py VS_COLOR_BANDS exactly */
  --vs-low:       #E24B4A;   /* 0–30  shutdown/anxious */
  --vs-mid:       #EF9F27;   /* 31–55 stressed/activated */
  --vs-reg:       #1D9E75;   /* 56–75 regulated */
  --vs-flow:      #534AB7;   /* 76–100 flow/meditative */

  /* Text */
  --text:         #f0f0f5;
  --text-muted:   #6b6b80;
  --text-dim:     #3a3a50;

  /* Semantic */
  --warn:         #c8a040;
  --danger:       #e05555;

  /* Spacing rhythm */
  --r-sm: 8px;  --r-md: 12px;  --r-lg: 16px;  --r-xl: 20px;

  /* Typography */
  --font-head: 'Figtree', -apple-system, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;

  /* Animation defaults */
  --ambient:    #534AB7;   /* overridden by ANS state hooks */
  --vs-period:  2s;        /* overridden inline by VS band */
  --rf-bpm:     6;         /* overridden inline from WS frame */
}

/* ── ANS state → ambient color ─────────────────────────────────────────── */
[data-ans="ventral_vagal"]       { --ambient: #00D084; }
[data-ans="healthy_sympathetic"] { --ambient: #EF9F27; }
[data-ans="anxious_sympathetic"] { --ambient: #E24B4A; }
[data-ans="dorsal_vagal"]        { --ambient: #4A7FA5; }
[data-ans="burnout_rigidity"]    { --ambient: #7B5EA7; }

/* ── VS band → pulse period (applied via inline style on orb wrapper) ─── */
/* VS 0–30:   style="--vs-period:3s"  */
/* VS 31–55:  style="--vs-period:2s"  */
/* VS 56–75:  style="--vs-period:1.4s"*/
/* VS 76–100: style="--vs-period:0.8s"*/

/* ── Keyframes ─────────────────────────────────────────────────────────── */
@keyframes vsPulse {
  0%, 100% { transform: scale(1);    opacity: 1;    }
  50%       { transform: scale(1.04); opacity: 0.92; }
}
@keyframes breatheRing {
  0%, 100% { transform: scale(0.92); }
  50%       { transform: scale(1.0);  }
}
@keyframes rfBloom {
  0%   { box-shadow: 0 0 0 0   color-mix(in srgb, var(--locked) 60%, transparent); }
  70%  { box-shadow: 0 0 0 24px transparent; }
  100% { box-shadow: 0 0 0 0   transparent; }
}
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0);   }
}
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}

/* ── Animation utility classes ─────────────────────────────────────────── */
.vs-orb {
  animation: vsPulse var(--vs-period, 2s) ease-in-out infinite;
}
.breath-ring {
  animation: breatheRing calc(60000ms / var(--rf-bpm, 6)) ease-in-out infinite;
}
.rf-locked-bloom {
  animation: rfBloom 2s ease-out;
}
.fade-slide-up {
  animation: fadeSlideUp 0.25s ease-out forwards;
}
.ambient-bg {
  background: radial-gradient(ellipse 70% 50% at 50% 0%,
    color-mix(in srgb, var(--ambient) 12%, transparent),
    transparent 60%);
  transition: background 1200ms ease;
}

/* ── Reduced motion override ───────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .vs-orb, .breath-ring, .rf-locked-bloom, .fade-slide-up { animation: none !important; }
  .ambient-bg { transition: none; }
}

/* ── Touch target minimum ─────────────────────────────────────────────── */
.touch-target {
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Card pattern ──────────────────────────────────────────────────────── */
.v2-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 14px 16px;
}
.v2-card--active {
  border-color: var(--primary);
  background: var(--surface-alt);
}
.v2-card--warn {
  border-color: var(--warn);
  background: #110d00;
}
.v2-card--danger {
  border-color: var(--danger);
}
```

**Verification:**
- [ ] `grep -n "font-head\|--bg:\|--locked:\|vsPulse\|breatheRing" frontend/src/styles/global.css` → all present
- [ ] `npm run build` passes (no CSS import errors)
- [ ] `grep -rn "import.*global.css" frontend/src/main.jsx` → global.css imported at root

---

## Phase 3: New Hooks (4 files in `frontend/src/hooks/`)

Create directory: `frontend/src/hooks/`

### 3A — `useWSSession.js`

**Contract (from spec Section 8):**
```js
const { data, status, send, close, discard } = useWSSession({ session, mode, authToken, timezone })
// status: 'connecting'|'authenticating'|'buffering'|'live'|'low_sqi'|'ended'|'error'
// data: latest complete WS frame (null until first frame with 't' field)
```

**Implementation:**
- Uses `WSClient` from `../utils/ws_client.js` — constructor is `WSClient(session, mode, authToken, onMessage)`
- On `onopen`: WSClient already sends auth. Hook waits for `auth_ok` before setting status to `'authenticating'→'live'`
- Routes `msg.status === 'buffering'` → status `'buffering'`
- Routes `msg.status === 'low_sqi'` → status `'low_sqi'` (keep last data)
- Routes `'t' in msg` → setData(msg), status `'live'`
- `send(obj)` → `wsClientRef.current.send(obj)`
- `close()` → send `{cmd:'stop'}`, then `wsClientRef.current.close()`
- `discard()` → send `{cmd:'discard'}`, then `wsClientRef.current.close()`
- Cleanup on unmount: `wsClientRef.current?.close()`

**Pattern reference:** `frontend/src/utils/ws_client.js` — WSClient implementation to wrap.

### 3B — `useSensorFusion.js`

**Contract:**
```js
const { ready, sqi, fusionRef, start, stop } = useSensorFusion(mode)
// ready: bool — at least one RR source has data
// sqi: float 0–1 — latest signal quality from rPPG or H10
// fusionRef.current: SensorFusion instance
```

**Implementation:**
- Creates `new SensorFusion(mode)` from `../sensors/sensor_fusion.js`
- `start()` → calls `fusion.start()` (async), sets running state
- `stop()` → calls `fusion.stop()`
- Exposes `fusionRef` so Session can poll `fusionRef.current.getReading()`
- `ready`: checks `fusionRef.current.getReading()?.rr?.rr_ms?.length > 0`
- `sqi`: reads from `fusionRef.current.sensors.rppg?._quality()` or fixed 0.95 for H10

**Pattern reference:** `frontend/src/sensors/sensor_fusion.js` — SensorFusion.start(), stop(), getReading()

### 3C — `useWakeLock.js`

**Contract:**
```js
const { active, acquire, release } = useWakeLock()
```

**Implementation:**
```js
import { useState, useRef } from 'react'

export function useWakeLock() {
  const [active, setActive] = useState(false)
  const lockRef = useRef(null)

  async function acquire() {
    try {
      lockRef.current = await navigator.wakeLock.request('screen')
      lockRef.current.addEventListener('release', () => setActive(false))
      setActive(true)
    } catch (_) {}  // not supported or denied — never crash
  }

  function release() {
    try { lockRef.current?.release() } catch (_) {}
    setActive(false)
    lockRef.current = null
  }

  return { active, acquire, release }
}
```

### 3D — `useSessionAccum.js`

**Contract:**
```js
const { vsHistory, peakVs, firstRmssd, latestRmssd, firstDfa, latestDfa, phases } = useSessionAccum(data)
// data: latest WS frame from useWSSession (null or frame object)
```

**Implementation:**
- `vsHistory`: `useRef([])` — appends `data.vs?.vs ?? 0` each frame, max 600 entries (10 min at 1Hz)
- `peakVs`: `useRef(0)` — updates when `vsVal > peak`
- `firstRmssd`: `useRef(null)` — set once on first frame with metrics
- `latestRmssd`: mirrors `data.metrics?.rmssd ?? null`
- `firstDfa`: `useRef(null)` — set once
- `latestDfa`: mirrors `data.metrics?.dfa_alpha1 ?? null`
- `phases`: `useRef([])` — appends new entry when `data.session_phase` changes
- Returns snapshot object (recomputed each render from refs)

**Verification for Phase 3:**
- [ ] `ls frontend/src/hooks/` → 4 files
- [ ] `grep -n "export function useWSSession" frontend/src/hooks/useWSSession.js` → found
- [ ] `grep -n "export function useSensorFusion" frontend/src/hooks/useSensorFusion.js` → found
- [ ] `grep -n "export function useWakeLock" frontend/src/hooks/useWakeLock.js` → found
- [ ] `grep -n "export function useSessionAccum" frontend/src/hooks/useSessionAccum.js` → found
- [ ] `npm run build` passes

---

## Phase 4: New UI Components (8 files in `frontend/src/ui/`)

Each component: **pure display, zero logic, props → JSX only.**  
Each has a 44px minimum touch target where interactive.

### 4A — `AnsState.jsx`

**Props:** `{ state: string, confidence: float, scores: object }`  
**Renders:**
- State label (string from ANS_LABELS lookup)
- Confidence percentage
- 5 horizontal micro-bars (one per ANS state, height proportional to score)
- Color: `--ambient` CSS var (inherits from parent `data-ans` attribute)

```js
const ANS_LABELS = {
  ventral_vagal: 'Ventral Vagal',
  healthy_sympathetic: 'Activated',
  anxious_sympathetic: 'Anxious',
  dorsal_vagal: 'Dorsal',
  burnout_rigidity: 'Burnout',
}
const ANS_ORDER = ['ventral_vagal','healthy_sympathetic','anxious_sympathetic','dorsal_vagal','burnout_rigidity']
```

### 4B — `AffectQuadrant.jsx`

**Props:** `{ arousal: float, valence: float, quadrant: string }`  
**Renders:**
- Quadrant label (Q1=Excited, Q2=Tense, Q3=Depressed, Q4=Calm)
- Arousal value with ↕ arrow
- Valence value with ↔ arrow
- 2D mini-grid (60×60px SVG): dot positioned at (valence, arousal) coordinates

```js
const Q_LABELS = { Q1:'Excited', Q2:'Tense', Q3:'Depressed', Q4:'Calm' }
```

### 4C — `HrvMetrics.jsx`

**Props:** `{ metrics: object, defaultOpen: bool }`  
**Renders:** Collapsible section. Toggle = 44px tap target.  
Fields: `RMSSD: {rmssd}ms · HR: {hr}bpm · DFA: {dfa_alpha1} · SD1: {sd1}ms · SD2: {sd2}ms · SVI: {svi}`  
All values from `metrics.to_dict()` field names (exact — see backend audit).

### 4D — `MusicParams.jsx`

**Props:** `{ params: object, defaultOpen: bool }`  
**Renders:** Collapsible section.  
Always shown: `{bpm} BPM · {key_mode===0?'Minor':key_mode===1?'Major':'Lydian'} · Binaural: {binaural_beat_hz}Hz`  
Bar rows (label + fill bar 0–1): `warmth`, `brightness`, `spatial_width`, `silence_ratio`  
Bar fill uses `--primary` color.

### 4E — `SensorStatusBar.jsx`

**Props:** `{ sensors: object, sqi: float, onMenu: fn }`  
**Renders:**
- Per-active-sensor icon + dot color (green=connected, amber=degraded, red=failed)
- SQI percentage `SQI: {Math.round(sqi*100)}%`
- ⋮ menu button (44×44 touch target) → calls `onMenu()`

Sensor icons (text-based, no emoji):
- H10: `H10`
- rPPG: `CAM`
- Mic: `MIC`
- Face: `FACE`

### 4F — `InsightCard.jsx`

**Props:** `{ id: string, content: string, warn: bool, icon: string }`  
**Renders:** Card with `id` label (10px uppercase muted) + content (14px, line-height 1.5).  
`warn=true` → `.v2-card--warn` class. Default → `.v2-card`.

### 4G — `SessionTimeline.jsx`

**Props:** `{ phases: array, currentPhase: string }`  
`phases` shape: `[{phase: string, duration_s: int, vs_at_exit: int}]`  

**Renders:** Horizontal dot trail.
- Each completed phase: filled dot + phase name below + duration below that
- Current phase: pulsing dot (`.vs-orb` class, 1s period)
- Future phases: empty dot (dim)
- Between dots: connecting line

### 4H — `DiscardSheet.jsx`

**Props:** `{ open: bool, onClose: fn, onDiscard: fn, onEnd: fn }`  
**Renders:** Bottom sheet (position fixed, bottom 0, full width, max 480px centered).  
Sheet content:
```
[End & Save]           ← primary button, --primary bg
──────────────────────
[Discard Session]      ← danger color, --danger text

─── confirm state (after discard tap) ───
"Raw signal data is kept.
 Insights won't be generated."
[Continue session]  [Yes, discard]
```
Backdrop: `rgba(0,0,0,0.6)`, tap to dismiss.  
`onDiscard()` called only on "Yes, discard" confirmation.

**Verification for Phase 4:**
- [ ] `ls frontend/src/ui/` → 12 files (4 existing + 8 new)
- [ ] Each new file: `grep -n "export default" frontend/src/ui/AnsState.jsx` etc. → found
- [ ] `npm run build` passes

---

## Phase 5: App.jsx State Machine + Cleanup

### 5A — Update `frontend/src/App.jsx`

**New state machine:**
```js
import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import LoginScreen from './pages/LoginScreen.jsx'
import Landing from './pages/Landing.jsx'
import Setup from './pages/Setup.jsx'
import Session from './pages/Session.jsx'
import Insight from './pages/Insight.jsx'

function AppRoutes() {
  const { user, loading } = useAuth()
  const [screen, setScreen] = useState('landing')
  const [cfg, setCfg] = useState(null)          // { mode, session }
  const [sessionResult, setSessionResult] = useState(null)
  const [setupData, setSetupData] = useState(null)  // { timezone, wakeLockRef }

  if (loading) return <LoadingSpinner />
  if (!user) return <LoginScreen />

  if (screen === 'setup' && cfg)
    return <Setup
      cfg={cfg}
      onReady={(data) => { setSetupData(data); setScreen('session') }}
      onBack={() => setScreen('landing')}
    />

  if (screen === 'session' && cfg)
    return <Session
      cfg={cfg}
      setupData={setupData}
      onEnd={(result) => { setSessionResult(result); setScreen('insight') }}
      onDiscard={() => { setScreen('landing'); setCfg(null); setSessionResult(null) }}
    />

  if (screen === 'insight')
    return <Insight
      result={sessionResult}
      cfg={cfg}
      onDone={() => { setScreen('landing'); setCfg(null); setSessionResult(null) }}
      wakeLockRef={setupData?.wakeLockRef}
    />

  return <Landing onStart={(c) => { setCfg(c); setScreen('setup') }} />
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>
}
```

**LoadingSpinner (inline, no component file):**
```jsx
function LoadingSpinner() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
                  minHeight:'100dvh', background:'var(--bg)' }}>
      <div style={{ width:36, height:36, borderRadius:'50%',
                    border:'3px solid var(--primary)', borderTopColor:'transparent',
                    animation:'spin 0.8s linear infinite' }} />
    </div>
  )
}
```

### 5B — Delete orphaned files

```bash
# Delete entire components/ directory (14 orphaned files)
rm -rf frontend/src/components/

# Delete old engines/ directory (6 orphaned files)
rm -rf frontend/src/engines/

# Delete old context that no longer exists
rm frontend/src/context/AppContext.jsx

# Delete old store if present
rm -rf frontend/src/store/
```

**Verify nothing imports deleted files:**
```bash
grep -rn "from.*components/" frontend/src/pages frontend/src/ui frontend/src/hooks
grep -rn "from.*engines/" frontend/src/pages frontend/src/ui frontend/src/hooks
grep -rn "AppContext" frontend/src/
```
All → zero results.

**Verification for Phase 5:**
- [ ] `ls frontend/src/components/` → directory not found
- [ ] `ls frontend/src/engines/` → directory not found
- [ ] `grep -rn "AppContext\|sessionStore" frontend/src/` → zero results
- [ ] `npm run build` passes

---

## Phase 6: Landing Page Rewrite (`frontend/src/pages/Landing.jsx`)

**Full rewrite.** Reference spec Section 4.

### Data contracts out
```js
onStart({ mode: 2|3, session: 'find_your_calm'|'wind_down'|'morning_emergence' })
// NO token field — auth handled by Supabase
```

### Session config (exact IDs — these are WS query params)
```js
const SESSIONS = [
  { id: 'find_your_calm',    label: 'Find Your Calm',    desc: 'Slow. Breathe. Restore.',      bestTime: 'Afternoon or evening' },
  { id: 'wind_down',         label: 'Wind Down',         desc: 'Prepare for deep rest.',        bestTime: 'Evening or night' },
  { id: 'morning_emergence', label: 'Morning Emergence', desc: 'Activate. Rise. Prime.',        bestTime: '6–9am' },
]
```

### Circadian fit (client-side, no API call)
```js
const SESSION_CIRCADIAN_FIT = {
  find_your_calm: { MORNING_RISE:0.9, PEAK:0.7, POST_LUNCH_DIP:1.0, AFTERNOON_PEAK:0.7, EVENING_WIND:0.8, NIGHT:0.5 },
  wind_down:      { EVENING_WIND:1.0, NIGHT:1.0, POST_LUNCH_DIP:0.7, AFTERNOON_PEAK:0.3, PEAK:0.2, MORNING_RISE:0.1 },
  morning_emergence: { MORNING_RISE:1.0, PEAK:0.5, POST_LUNCH_DIP:0.2, AFTERNOON_PEAK:0.2, EVENING_WIND:0.1, NIGHT:0.1 },
}
const CIRCADIAN_PHASES = [
  { name:'MORNING_RISE',    range:[6,9]  },
  { name:'PEAK',            range:[9,12] },
  { name:'POST_LUNCH_DIP',  range:[13,15]},
  { name:'AFTERNOON_PEAK',  range:[15,18]},
  { name:'EVENING_WIND',    range:[18,21]},
  { name:'NIGHT',           range:[21,6] },  // wraps midnight
]

function getCurrentPhase() { /* hour-based lookup */ }
function getFitBadge(fit) {
  if (fit >= 0.8) return { label: 'Best now',  color: 'var(--locked)' }
  if (fit >= 0.5) return { label: 'Decent',    color: 'var(--warn)'   }
  return            { label: 'Not ideal', color: 'var(--text-dim)' }
}
```

### Mode config
```js
const MODES = [
  { id: 2, source: 'phone', label: 'Phone Only',        desc: 'Camera + mic. No hardware.', badge: 'MEDIUM', badgeColor: 'var(--warn)' },
  { id: 2, source: 'h10',   label: 'Polar H10',         desc: 'ECG-grade RR. Cleanest HRV.', badge: 'HIGH',   badgeColor: 'var(--locked)' },
  { id: 3, source: 'both',  label: 'Phone + Polar H10', desc: 'All sensors. Best science.', badge: 'HIGHEST', badgeColor: 'var(--locked)', star: true },
]
const [modeSource, setModeSource] = useState('h10')  // default
```

### Style rules
- Cards: `.v2-card` / `.v2-card--active` CSS classes
- Active card: `border: 2px solid var(--primary)`, `background: var(--surface-alt)`
- Touch targets: all cards ≥ 44px height
- Header: `font-family: var(--font-head)`, "ALIVE" 26px 700, tagline 14px muted
- CTA disabled state: `opacity: 0.4, cursor: not-allowed`

**Verification:**
- [ ] `grep -n "find_your_calm\|wind_down\|morning_emergence" frontend/src/pages/Landing.jsx` → 3 results
- [ ] `grep -n "token" frontend/src/pages/Landing.jsx` → zero results (token input removed)
- [ ] `grep -n "onStart" frontend/src/pages/Landing.jsx` → called with `{mode, session}` only

---

## Phase 7: Setup Screen (new — `frontend/src/pages/Setup.jsx`)

**Reference:** Spec Section 5.

### Props
```js
Setup({ cfg: {mode, session}, onReady: fn({ timezone, wakeLockRef }), onBack: fn })
```

### State
```js
const [step, setStep] = useState('init')   // 'init' | 'ready'
const [sensorStatus, setSensorStatus] = useState({
  rppg: 'idle',    // 'idle'|'requesting'|'connected'|'failed'
  face: 'idle',
  mic:  'idle',
  h10:  'idle',
})
const [rppgCount, setRppgCount] = useState(0)   // RR intervals in buffer
const [h10Hr, setH10Hr] = useState(null)         // live BPM from H10
const [sqi, setSqi] = useState(0)
const fusionRef = useRef(null)
const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock()
const wakeLockRef = useRef(null)
```

### Init sequence
On mount, call `initSensors()`:

```js
async function initSensors() {
  const fusion = new SensorFusion(cfg.mode)
  fusionRef.current = fusion

  // Acquire wake lock for camera modes
  if (cfg.mode !== 2_h10_only) {
    await acquire()
  }

  // Start all sensors (parallel via Promise.allSettled)
  await fusion.start()

  // Poll for status every 500ms
  const poll = setInterval(() => {
    const reading = fusion.getReading()
    // Update per-sensor status based on sensor instances
    if (fusion.sensors.rppg) {
      const rr = fusion.sensors.rppg.getLatestRR()
      setRppgCount(rr.rr_ms.length)
      setSensorStatus(s => ({...s, rppg: rr.rr_ms.length > 0 ? 'connected' : 'requesting'}))
    }
    if (fusion.sensors.h10) {
      const rr = fusion.sensors.h10.getLatestRR()
      if (rr.rr_ms.length > 0) {
        const hr = Math.round(60000 / rr.rr_ms[rr.rr_ms.length - 1])
        setH10Hr(hr)
        setSensorStatus(s => ({...s, h10: 'connected'}))
      }
    }
    // Update ready state
    setReady(computeReady(fusion, cfg.mode))
  }, 500)

  return () => clearInterval(poll)
}
```

### Ready computation
```js
function computeReady(fusion, mode) {
  const h10Rr = fusion.sensors.h10?.getLatestRR()?.rr_ms?.length ?? 0
  const rppgRr = fusion.sensors.rppg?.getLatestRR()?.rr_ms?.length ?? 0
  if (mode === 3)    return h10Rr >= 5
  if (mode === 2 && fusion.sensors.h10) return h10Rr >= 5
  if (mode === 2 && fusion.sensors.rppg) return rppgRr >= 10
  return false
}
```

### Timezone capture
```js
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
```

### onReady call
```js
function handleBegin() {
  onReady({ timezone, wakeLockRef, fusionRef })
}
```

### H10 UX (BLE scan)
- H10 sensor's `start()` triggers `navigator.bluetooth.requestDevice()` which opens browser BLE picker
- Setup shows "Scanning for Polar H10..." spinner until `h10Status === 'connected'`
- Shows live HR once connected: `"✓ Polar H10 · {h10Hr} bpm"`

### rPPG UX
- Show small canvas preview: `<canvas ref={previewRef} width={60} height={60} />`
- Overlay: "Place fingertip firmly over lens"
- Buffer progress: `[████░░░░] {rppgCount}/30`
- Connected when `rppgCount >= 10`

### Sensor status icons
```
IDLE:       dim gray dot
REQUESTING: amber spinning dot
CONNECTED:  green dot + reading
FAILED:     red X + "Tap to retry"
```

**Verification:**
- [ ] File exists: `frontend/src/pages/Setup.jsx`
- [ ] `grep -n "SensorFusion\|useWakeLock\|timezone" frontend/src/pages/Setup.jsx` → all present
- [ ] `grep -n "onReady" frontend/src/pages/Setup.jsx` → called with `{timezone, wakeLockRef, fusionRef}`
- [ ] `npm run build` passes

---

## Phase 8: Session Page Rewrite (`frontend/src/pages/Session.jsx`)

**Reference:** Spec Section 6. Fix all 6 bugs. Wire audio. Living UI.

### Props
```js
Session({ cfg: {mode, session}, setupData: {timezone, wakeLockRef, fusionRef}, onEnd: fn, onDiscard: fn })
```

### Hooks used
```js
const { user } = useAuth()
const { data, status, send, close, discard } = useWSSession({
  session: cfg.session,   // 'find_your_calm'|'wind_down'|'morning_emergence'
  mode: cfg.mode,         // 2 or 3
  authToken,              // from supabase.auth.getSession()
  timezone: setupData.timezone,
})
const { vsHistory, peakVs, firstRmssd, latestRmssd, firstDfa, latestDfa } = useSessionAccum(data)
```

### Auth token acquisition
```js
useEffect(() => {
  async function getToken() {
    if (supabase) {
      const { data: { session: s } } = await supabase.auth.getSession()
      setAuthToken(s?.access_token ?? null)
    }
  }
  getToken()
}, [])
```

### RR sending (bug B1 fixed)
```js
// Every 500ms via setInterval in useEffect
const reading = setupData.fusionRef.current?.getReading()
if (reading?.rr?.rr_ms?.length > 0) {
  reading.rr.rr_ms.slice(-5).forEach(rr => send({ rr }))  // {rr: float} ONLY
}
// No sensor_update messages. No face/pose sends.
```

### Audio wiring (bug B5 fixed)
```js
const audioRef = useRef(null)
const prevPhaseRef = useRef(null)

// Start audio after first live frame
useEffect(() => {
  if (status === 'live' && !audioRef.current) {
    audioRef.current = new SessionAudio(cfg.session)
    audioRef.current.start(data?.rf_bpm ?? 6)
  }
}, [status])

// Update audio on every frame
useEffect(() => {
  if (!data || !audioRef.current) return
  audioRef.current.updateRF(data.rf_bpm)
  if (data.session_phase && data.session_phase !== prevPhaseRef.current) {
    audioRef.current.updateState(data.session_phase, data.ans?.state, false)
    prevPhaseRef.current = data.session_phase
  }
}, [data])

// Stop on unmount
useEffect(() => () => { audioRef.current?.stop() }, [])
```

### VS period mapping (bug B4 fixed — CSS-driven animation)
```js
function vsToAnimPeriod(vs) {
  if (vs >= 76) return '0.8s'
  if (vs >= 56) return '1.4s'
  if (vs >= 31) return '2.0s'
  return '3.0s'
}
const vsVal = data?.vs?.vs ?? 0
const vsColor = vsVal >= 76 ? 'var(--vs-flow)' : vsVal >= 56 ? 'var(--vs-reg)' :
                vsVal >= 31 ? 'var(--vs-mid)'  : 'var(--vs-low)'
```

### Root element (ANS state data attribute)
```jsx
<div
  data-ans={data?.ans?.state ?? ''}
  style={{ minHeight:'100dvh', background:'var(--bg)', ...}}
>
  <div className="ambient-bg" style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none' }} />
  {/* all content above ambient-bg */}
</div>
```

### VS orb
```jsx
<div
  className="vs-orb"
  style={{ '--vs-period': vsToAnimPeriod(vsVal), color: vsColor }}
>
  <div style={{ fontSize:80, fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{vsVal}</div>
  <div style={{ fontSize:13, color:'var(--text-muted)' }}>{vsLabel} · {data?.vs?.confidence}</div>
</div>
```

### Breath ring (bug: currently uses rAF — keep existing BreathRing.jsx logic but pass CSS var)
```jsx
<div
  className="breath-ring"
  style={{
    '--rf-bpm': data?.rf_bpm ?? 6,
    width: 110, height: 110, borderRadius: '50%',
    border: `3px solid ${data?.rf_locked ? 'var(--locked)' : 'var(--primary)'}`,
    boxShadow: data?.rf_locked ? `0 0 24px color-mix(in srgb, var(--locked) 40%, transparent)` : 'none',
  }}
/>
```

### Discard flow
```jsx
const [menuOpen, setMenuOpen] = useState(false)

<SensorStatusBar
  sensors={setupData.fusionRef.current?.sensors ?? {}}
  sqi={data?.metrics ? /* compute from last sqi */ 0.8 : 0}
  onMenu={() => setMenuOpen(true)}
/>

<DiscardSheet
  open={menuOpen}
  onClose={() => setMenuOpen(false)}
  onEnd={() => {
    const result = buildResult()
    close()
    onEnd(result)
  }}
  onDiscard={() => {
    discard()
    onDiscard()
  }}
/>
```

### Result object (passed to Insight)
```js
function buildResult() {
  return {
    session_type: cfg.session,
    mode: cfg.mode,
    peak_vs: peakVs,
    final_vs: data?.vs?.vs ?? 0,
    rf_locked: data?.rf_locked ?? false,
    rf_bpm: data?.rf_bpm ?? 0,
    rf_lock_epoch_s: null,  // track separately if needed
    vs_history: [...vsHistoryRef.current],
    phases_completed: phasesRef.current,
    hrv_summary: { rmssd_start: firstRmssd, rmssd_end: latestRmssd, dfa_start: firstDfa, dfa_end: latestDfa },
    circadian_phase: data?.metrics ? '' : '',  // from circadian_ctx in last frame (add if backend emits)
    circadian_fit_score: 0.5,  // default, update if backend emits
    duration_s: Math.floor((Date.now() - sessionStartRef.current) / 1000),
  }
}
```

**Verification:**
- [ ] `grep -n '{ rr }' frontend/src/pages/Session.jsx` → RR send uses `{rr}` not `{rr_ms}`
- [ ] `grep -n "rr_ms\|rr_interval\|sensor_update" frontend/src/pages/Session.jsx` → zero results
- [ ] `grep -n "state_update" frontend/src/pages/Session.jsx` → zero results
- [ ] `grep -n "cfg.session" frontend/src/pages/Session.jsx` → passed as first WSClient arg
- [ ] `grep -n "SessionAudio\|audioRef" frontend/src/pages/Session.jsx` → both present
- [ ] `grep -n "data-ans" frontend/src/pages/Session.jsx` → root div has it
- [ ] `grep -n "DiscardSheet\|onDiscard" frontend/src/pages/Session.jsx` → both present

---

## Phase 9: Insight Screen (new — `frontend/src/pages/Insight.jsx`)

**Reference:** Spec Section 7.

### Props
```js
Insight({ result: object, cfg: {mode, session}, onDone: fn, wakeLockRef: ref })
```

### On mount
```js
useEffect(() => {
  // Release wake lock — session is over
  try { wakeLockRef?.current?.release() } catch (_) {}

  // POST session end to backend
  postSessionEnd(result)
}, [])
```

### Post session end
```js
async function postSessionEnd(result) {
  try {
    await fetch(`${API_URL}/api/session/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: `session-${Date.now()}`,
        session_type: result.session_type,
        mode: result.mode,
        peak_vs: result.peak_vs,
        final_vs: result.final_vs,
        phases_completed: result.phases_completed,
        hrv_summary: result.hrv_summary,
        circadian_phase: result.circadian_phase,
        circadian_fit_score: result.circadian_fit_score,
      }),
    })
  } catch (_) {}
}
```

### Skill transfer score
```js
const skillTransfer = result.peak_vs > 0 ? Math.round((result.final_vs / result.peak_vs) * 100) : null
```

### VS color (from result.final_vs)
Use same `vsToColor()` helper as Session.

### Insight cards — R-codes (InsightCard component)
```js
const insights = []

// R1 — always
insights.push({ id:'R1', content:`Nervous system reached ${result.peak_vs}/100. Final: ${result.final_vs}/100.` })

// R2 — if rmssd data available
if (result.hrv_summary.rmssd_start) {
  const delta = result.hrv_summary.rmssd_end - result.hrv_summary.rmssd_start
  insights.push({ id:'R2', content:`HRV: ${result.hrv_summary.rmssd_start?.toFixed(1)}ms → ${result.hrv_summary.rmssd_end?.toFixed(1)}ms (${delta > 0 ? '+' : ''}${delta.toFixed(1)}ms)` })
}

// R8 — arc journey
if (result.phases_completed?.length > 0) {
  const journey = result.phases_completed.map(p => p.phase).join(' → ')
  insights.push({ id:'R8', content:`Session arc: ${journey}` })
}

// R16 — skill transfer
if (skillTransfer !== null) {
  const held = skillTransfer > 85
  insights.push({ id:'R16', content:`Skill transfer: ${skillTransfer}%. ${held ? 'Regulation is self-sustaining.' : 'Continued practice strengthens autonomous regulation.'}` })
}

// RF — if locked
if (result.rf_locked) {
  insights.push({ id:'RF', content:`Resonant frequency: ${result.rf_bpm?.toFixed(1)} BPM — your personal rhythm locked.` })
}

// R15 — phone-only caveat (mode 2, no H10)
if (result.mode === 2 && cfg.source !== 'h10') {
  insights.push({ id:'R15', warn:true, content:'Phone-only session. HRV estimates are indicative, not ECG-grade. Polar H10 gives research-grade accuracy.' })
}

// R17 — circadian mismatch
if (result.circadian_fit_score < 0.4) {
  insights.push({ id:'R17', warn:true, content:`Session ran at a suboptimal time for ${SESSION_LABELS[result.session_type]}. Best time: ${BEST_TIMES[result.session_type]}.` })
}
```

### Next session recommendation
```js
const SESSION_LABELS = { find_your_calm:'Find Your Calm', wind_down:'Wind Down', morning_emergence:'Morning Emergence' }
const BEST_TIMES = { find_your_calm:'afternoon or evening', wind_down:'evening or night', morning_emergence:'6–9am' }

function nextRec(result) {
  if (result.final_vs > 70) return `Excellent session. Try ${SESSION_LABELS[result.session_type]} again at ${BEST_TIMES[result.session_type]}.`
  if (result.final_vs >= 50) return `Good progress. Consistency builds regulation. Same time tomorrow.`
  return `Try a shorter session next time — 5 minutes of ${SESSION_LABELS[result.session_type]}.`
}
```

### VS History sparkline
```jsx
// Simple SVG polyline of vsHistory array
const W = 300, H = 60
const max = Math.max(...result.vs_history, 1)
const pts = result.vs_history.map((v, i) =>
  `${(i / Math.max(result.vs_history.length-1, 1)) * W},${H - (v/100)*H}`
).join(' ')
<svg width={W} height={H}>
  <polyline points={pts} fill="none" stroke={vsColor} strokeWidth={2} />
</svg>
```

**Verification:**
- [ ] File exists: `frontend/src/pages/Insight.jsx`
- [ ] `grep -n "postSessionEnd\|wakeLockRef" frontend/src/pages/Insight.jsx` → both present
- [ ] `grep -n "InsightCard\|SessionTimeline" frontend/src/pages/Insight.jsx` → both imported
- [ ] `grep -n "R1\|R2\|R8\|R16\|R15\|R17" frontend/src/pages/Insight.jsx` → all 6 present

---

## Phase 10: LoginScreen Polish (`frontend/src/pages/LoginScreen.jsx`)

Minimal changes — apply CSS vars, add null guard.

### Changes
1. Replace all inline hex colors with CSS vars:
   - `background: '#0a0a0f'` → `background: 'var(--bg)'`
   - `background: '#1a1a2e'` → `background: 'var(--surface)'`
   - `border: '1px solid #333'` → `border: '1px solid var(--border)'`
   - `background: '#6c63ff'` → `background: 'var(--primary)'`
2. Button height: add `height: '48px'` (≥44px touch target)
3. Null guard at top of component:
   ```js
   if (!supabase) return (
     <div style={{ padding:32, color:'var(--text-muted)', fontFamily:'var(--font-body)', background:'var(--bg)', minHeight:'100dvh' }}>
       Authentication not configured.
     </div>
   )
   ```
4. Error color: `color: '#ff6b6b'` → `color: 'var(--danger)'`

**Verification:**
- [ ] `grep -n "0a0a0f\|1a1a2e\|6c63ff\|ff6b6b" frontend/src/pages/LoginScreen.jsx` → zero results
- [ ] `grep -n "!supabase" frontend/src/pages/LoginScreen.jsx` → early return present

---

## Phase 11: End-to-End Verification

### Build checks
```bash
npm run build          # must pass, zero errors
python -m pytest backend/tests/ -v  # must pass 32/32
```

### File structure check
```bash
ls frontend/src/hooks/   # 4 files
ls frontend/src/ui/      # 12 files (4 + 8)
ls frontend/src/pages/   # 5 files: LoginScreen, Landing, Setup, Session, Insight
# components/ and engines/ must NOT exist
ls frontend/src/components/ 2>&1   # "No such file or directory"
ls frontend/src/engines/ 2>&1      # "No such file or directory"
```

### WS contract (Browser DevTools → Network → WS)
```
First outbound: {"type":"auth","token":"eyJ...","timezone":"Asia/Kolkata"}
First inbound:  {"type":"auth_ok"}
Outbound RR:    {"rr":847.5}   — NOT {rr_ms:...} NOT {type:"rr_interval",...}
WS URL:         ?session=find_your_calm&mode=2  — NOT ?session=token-1234567890
```

### UI animation check
```
□ VS orb pulses (rate changes with VS score)
□ Breath ring animates at rf_bpm rate
□ Ring turns green when rf_locked flips true
□ Background glow color shifts when ANS state changes
□ Audio plays after auth_ok
□ Audio phase transitions on session_phase changes
□ Discard → back to Landing (no Insight shown)
□ End & Save → Insight shown with correct data
□ WakeLock acquired during Setup (phone modes)
□ WakeLock released at Insight screen
```

### Accessibility check
```
□ All interactive elements ≥ 44px
□ prefers-reduced-motion: animations disabled in browser emulation
□ Color transitions still work with reduced motion
□ Focus rings visible on all buttons
```

### Grep anti-pattern check
```bash
grep -rn "rr_ms\|rr_interval\|state_update\|sensor_update" frontend/src/pages/ frontend/src/hooks/
# → zero results

grep -rn "mode.*=.*1\b" frontend/src/pages/ frontend/src/hooks/
# → zero results (no mode=1 anywhere)

grep -rn "from.*components/" frontend/src/
# → zero results

grep -rn "#0a0a\|#534AB7\|#00D084\|#E24B4A" frontend/src/pages/ frontend/src/ui/ frontend/src/hooks/
# → zero results (all colors must be CSS vars)
```

---

## Execution Order Summary

| Phase | Files | Est. time |
|---|---|---|
| 0 | Read docs | 10 min |
| 1 | 3 backend files (~21 lines) | 15 min |
| 2 | global.css append | 10 min |
| 3 | 4 hook files | 30 min |
| 4 | 8 UI component files | 45 min |
| 5 | App.jsx + delete orphans | 20 min |
| 6 | Landing.jsx rewrite | 25 min |
| 7 | Setup.jsx new file | 40 min |
| 8 | Session.jsx rewrite | 45 min |
| 9 | Insight.jsx new file | 35 min |
| 10 | LoginScreen.jsx polish | 10 min |
| 11 | Verification | 20 min |
| **Total** | | **~5.5 hours** |

## Context Handoff (for new chat sessions)

**State when this plan was written:**
- Backend: alive-v2 merged into main. Supabase auth + Postgres deployed. 32 tests passing.
- Frontend: App.jsx updated to Landing→Session→Report state machine with AuthProvider. 3 critical WS bugs present (B1/B2/B3). Audio disconnected. 14 components orphaned.
- Design spec: `docs/superpowers/specs/2026-04-30-frontend-v2-design.md` (committed)

**Commands to start backend:**
```bash
cd C:/Users/user/Desktop/mission_alive
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

**Commands to start frontend:**
```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

**Key files to read first in any new session:**
1. This plan file
2. `docs/superpowers/specs/2026-04-30-frontend-v2-design.md`
3. `backend/main.py` (WS route)
4. `frontend/src/utils/ws_client.js` (WSClient)
