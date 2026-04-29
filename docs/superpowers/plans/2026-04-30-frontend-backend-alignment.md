# Plan: Frontend ↔ Backend Alignment + UI Redesign
**Date:** 2026-04-30  
**Status:** READY TO EXECUTE  
**Scope:** Fix 3 critical WS bugs, delete 14 orphaned components, redesign 4 screens to match alive-v2 backend data contracts + clinical dark aesthetic

---

## Phase 0: Audit Summary (COMPLETE)

### Backend facts (alive-v2 main branch)

**Backend PROFILES** (`backend/hrv_simulator.py:30–67`):
```
"calm" | "energy" | "focus" | "recovery" | "presence" | "adhd_flow"
```

**WebSocket URL:** `ws://host/ws/session?session=<PROFILE>&mode=<1|2|3>`  
**Auth:** First message → `{"type":"auth","token":"<jwt>"}`  
**RR input (real-sensor mode):** `{"rr": <float_ms>}` (field name is `rr`, value in ms)  
**Control messages:** `{"cmd":"stop"}` | `{"cmd":"discard"}`

**WS output frame fields:**
```
t, metrics, state, ans{state,confidence,actionable},
affect{arousal,valence,quadrant}, vs{vs,confidence,...},
music_params, strategy, mpc_score, safety{safe,reason},
rf_locked, rf_bpm, rf_coherence, session_phase, session_type
```

**REST endpoint:** `POST /api/session/end` — expects `SessionEndRequest` model

### Frontend facts

**Active pages** (used in App.jsx): `Landing`, `Session`, `Report`, `LoginScreen`  
**Active UI** (used in Session.jsx): `VsDisplay`, `BreathRing`, `CoherenceBar`, `PhaseIndicator`  
**Active sensors:** `SensorFusion` → `ble_h10`, `breath_mic`, `contact_rppg`, `facemesh_sensor`, `blazepose_sensor`, `motion_gate`

**Orphaned (safe to delete — 0 imports from App.jsx):**
```
frontend/src/components/AnimatedNumber.jsx
frontend/src/components/BreathingOrb.jsx
frontend/src/components/CalibrationScreen.jsx
frontend/src/components/ConnectScreen.jsx
frontend/src/components/CosmicBackground.jsx
frontend/src/components/DashboardScreen.jsx
frontend/src/components/FlowingWaves.jsx
frontend/src/components/HistoryPanel.jsx
frontend/src/components/InsightsScreen.jsx
frontend/src/components/LiveSessionScreen.jsx
frontend/src/components/MainSession.jsx
frontend/src/components/SessionEnd.jsx
frontend/src/components/SplashScreen.jsx
frontend/src/components/WhoopDashboard.jsx
```
Also orphaned engines: `polarH10BLE.js`, `rrProcessor.js`, `toneEngine.js`, `spotifyEngine.js`, `whoopBLE.js`, `whoopEngine.js`

### Critical bugs

| # | Bug | Location | Impact |
|---|-----|----------|--------|
| B1 | Frontend sends `{type:"rr_interval", rr_ms:float}` — backend reads `msg["rr"]` only | `Session.jsx:81–84` | Real-sensor RR data never reaches backend |
| B2 | WSClient first param used as `?session=` query string but Session.jsx passes `${token}-${Date.now()}` | `Session.jsx:55`, `ws_client.js:28` | Backend always falls back to `"calm"` regardless of user choice |
| B3 | Landing.jsx session options (`find_your_calm`, `wind_down`, `morning_emergence`) don't match backend PROFILES | `Landing.jsx:8–12` | User session choice silently ignored |

### Design system (from ui-ux-pro-max)
- **Style:** Clinical minimal dark — high contrast, no decoration, data-first
- **Fonts:** Figtree (headings) + Inter/system-ui (body data)
- **Color tokens (dark theme):**
  - bg: `#0a0a0f`
  - surface: `#111118`
  - surface-alt: `#17171f`
  - border: `#222230`
  - primary: `#534AB7` (purple — brand)
  - coherence-locked: `#00D084` (green — locked/success state)
  - coherence-unlocked: `#2a2a40`
  - text-primary: `#f0f0f5`
  - text-muted: `#6b6b80`
  - warn: `#c8a040`
  - danger: `#e05555`
- **Touch targets:** ≥44px all interactive elements
- **Animation:** 150–250ms, transform/opacity only, respect `prefers-reduced-motion`
- **Typography scale:** 11 / 12 / 14 / 16 / 20 / 26 / 36px

---

## Phase 1: Fix Critical Bugs (30 min)

**Goal:** Backend receives correct data. No behavior changes — bugs only.

### 1A — Fix B3: Landing.jsx session options → match backend PROFILES

**File:** `frontend/src/pages/Landing.jsx`

Replace SESSIONS array:
```js
// OLD (wrong)
const SESSIONS = [
  { id: 'find_your_calm',    label: 'Find Your Calm' },
  { id: 'wind_down',         label: 'Wind Down' },
  { id: 'morning_emergence', label: 'Morning Emergence' },
];

// NEW (matches backend PROFILES exactly)
const SESSIONS = [
  { id: 'calm',       label: 'Find Your Calm',    desc: 'Slow the nervous system. Build stillness.' },
  { id: 'energy',     label: 'Energise',           desc: 'Activate arousal. Sharpen readiness.' },
  { id: 'focus',      label: 'Deep Focus',         desc: 'Narrow attention. Reduce cognitive noise.' },
  { id: 'recovery',   label: 'Recovery',           desc: 'Accelerate parasympathetic rebound.' },
  { id: 'presence',   label: 'Presence',           desc: 'Embodied awareness. Interoceptive clarity.' },
  { id: 'adhd_flow',  label: 'Flow State',         desc: 'Channel hyperarousal into flow.' },
];
```

### 1B — Fix B2: Session.jsx WSClient call — pass session profile name

**File:** `frontend/src/pages/Session.jsx`

```js
// OLD (wrong — passes a sessionId string as ?session= param)
const sessionId = `${token}-${Date.now()}`;
ws = new WSClient(sessionId, mode, authToken, (msg) => {...})

// NEW — pass the session profile name; keep sessionId only for local tracking
ws = new WSClient(session, mode, authToken, (msg) => {...})
```

Props destructure: `{ mode, token, session, onEnd }` — `session` is already available.

### 1C — Fix B1: RR sending format

**File:** `frontend/src/pages/Session.jsx`

```js
// OLD (wrong — backend ignores this)
ws.send({
  type: 'rr_interval', rr_ms: rr,
  timestamp: Date.now() / 1000, source: reading.rr.source
})

// NEW — backend reads msg["rr"] only
ws.send({ rr: rr })
```

Also fix: backend ignores `sensor_update` messages entirely — remove those sends (face/pose/breath). They're dead weight on the WebSocket.

**Verification checklist:**
- [ ] `grep -n "rr_ms" frontend/src/pages/Session.jsx` → zero results
- [ ] `grep -n "sensor_update" frontend/src/pages/Session.jsx` → zero results
- [ ] Backend PROFILES: `grep -n "calm\|energy\|focus\|recovery\|presence\|adhd_flow" frontend/src/pages/Landing.jsx` → all 6 present
- [ ] WSClient first arg in Session.jsx is `session` not a template string

---

## Phase 2: Global CSS Design Tokens + Fonts (20 min)

**Goal:** Single source of truth for all colors/spacing. Replace ad-hoc inline hex values.

**File:** `frontend/src/styles/global.css`

Add/replace with:
```css
@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap');

:root {
  /* Background layers */
  --bg:           #0a0a0f;
  --surface:      #111118;
  --surface-alt:  #17171f;
  --border:       #222230;
  --border-muted: #1a1a28;

  /* Brand */
  --primary:      #534AB7;
  --primary-dim:  #3d358a;

  /* Coherence state */
  --locked:       #00D084;
  --locked-dim:   #00a066;
  --unlocked:     #2a2a40;

  /* Text */
  --text:         #f0f0f5;
  --text-muted:   #6b6b80;
  --text-dim:     #3a3a50;

  /* Semantic */
  --warn:         #c8a040;
  --danger:       #e05555;
  --success:      #00D084;

  /* Spacing */
  --r-sm:  8px;
  --r-md:  12px;
  --r-lg:  16px;
  --r-xl:  20px;

  /* Typography */
  --font-head: 'Figtree', -apple-system, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: 100dvh;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Verification checklist:**
- [ ] `npm run build` passes with no CSS import errors
- [ ] All 4 pages render on `localhost:5173` with dark background

---

## Phase 3: Redesign Landing Screen (45 min)

**File:** `frontend/src/pages/Landing.jsx`

**UX spec:**
- Header: wordmark "ALIVE" + tagline "Autonomic regulation"
- Section 1: Session type selector — card grid, 6 options, active state via `--primary` border
- Section 2: Mode selector — 3 options with confidence badge
- Section 3: Begin button — disabled until mode selected (always valid — remove token requirement since auth handles identity)
- Remove: access token input field (user is already authenticated via Supabase)
- Touch targets: ≥44px all cards
- Fonts: headings use `var(--font-head)`

**Data contract out (props to App.jsx):**
```js
onStart({ mode: int, session: string })
// No token needed — Session.jsx gets JWT from supabase.auth.getSession()
```

App.jsx must update: `setCfg(c)` — remove token from cfg spread.

**Session card design:**
- Active: `border: 2px solid var(--primary)`, `background: var(--surface-alt)`
- Inactive: `border: 2px solid var(--border)`, `background: var(--surface)`
- 3-row label stack: name (600 16px) + desc (12px muted) + session type badge

**Mode card design:**
- Same active/inactive pattern
- Confidence badge: `HIGH` = `var(--locked)`, `MEDIUM` = `var(--warn)`, `MEDIUM` default

**Verification checklist:**
- [ ] All 6 session options render with correct `id` values matching backend PROFILES
- [ ] Begin button calls `onStart({ mode, session })` (no token)
- [ ] Tap targets all ≥44px height
- [ ] No token input field visible

---

## Phase 4: Redesign Session Screen (60 min)

**File:** `frontend/src/pages/Session.jsx`

**UX spec — data hierarchy (top to bottom):**

```
[Phase indicator — thin label bar, session_type + session_phase]
[VS Score — large number 0–100, confidence badge]
[Breath Ring — animated circle, locked/unlocked state]
[Coherence bar — thin progress bar, rf_coherence 0–1]
[ANS state — small label: CALM / STRESSED / RECOVERING etc]
[Affect quadrant — 2-axis micro-display: arousal↕ valence↔]
[RF stats row — "6.2 BPM • locked" or "calibrating…"]
[End session — bottom, ghost button]
```

**Color language:**
- RF locked → `var(--locked)` (green) on ring + coherence bar + "locked" label
- RF unlocked → `var(--unlocked)` on ring, `var(--text-muted)` on label "calibrating…"
- VS ≥ 80 → text glow `var(--locked)`, VS < 40 → normal text
- Safety fallback active → `var(--warn)` banner above VS

**Animation rules:**
- Breath ring: `animation: breathe <(60/rfBpm)>s ease-in-out infinite` — CSS keyframes scale 0.92→1.0
- VS number: transition `0.6s` with `will-change: contents`
- Coherence bar: `transition: width 0.5s ease-out`
- Respect `prefers-reduced-motion` — disable breathe animation

**Props received:** `{ mode, session, onEnd }`  
Note: `token` prop no longer needed — JWT from `supabase.auth.getSession()` already handles auth.

**WSClient call (fixed from B2):**
```js
ws = new WSClient(session, mode, authToken, onMessage)
```

**Verification checklist:**
- [ ] VS score updates visually each WS frame
- [ ] Breath ring animates at `rf_bpm` rate
- [ ] Coherence bar fills 0→1 as `rf_coherence` changes
- [ ] Green color appears when `rf_locked === true`
- [ ] "End session" button triggers `onEnd(summary)` correctly

---

## Phase 5: Redesign Report Screen (30 min)

**File:** `frontend/src/pages/Report.jsx`

**UX spec:**
- Header: "Session complete" + session label
- Insight cards: keep R1/R2/R8/R16/R15/R17 logic — restyle only
- Card design: `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: var(--r-lg)`
- Warning cards: `border-color: var(--warn)`, `color: var(--warn)`
- VS summary card: display peak vs final as two large numbers side by side
- Skill transfer: show as percentage bar (0→100%) not just text
- "New session" CTA: full-width, `var(--primary)` bg, ≥44px height, `var(--font-head)` 600

**Missing helper:** `round2` is defined but `Report.jsx` uses it — keep it.

**Verification checklist:**
- [ ] All 6 insight types render correctly with mock data
- [ ] Warning cards styled differently from normal cards
- [ ] "New session" button returns to Landing

---

## Phase 6: Polish LoginScreen (15 min)

**File:** `frontend/src/pages/LoginScreen.jsx`

**UX fixes:**
- Apply CSS tokens: bg → `var(--bg)`, inputs → `var(--surface)` bg + `var(--border)` border
- Button: `var(--primary)` bg, ≥44px height, disabled state with `opacity: 0.5`
- Error messages: `var(--danger)` color, appear below the relevant field
- Null-guard: add `if (!supabase) return <div>...</div>` before form render (prevents TypeError in dev without env vars)

**Verification checklist:**
- [ ] Login renders without env vars (graceful "not configured" message)
- [ ] Successful login routes to Landing

---

## Phase 7: Delete Orphaned Files (10 min)

**Delete all of these** (confirmed 0 imports in App.jsx or any active page):

```bash
# components/
rm frontend/src/components/AnimatedNumber.jsx
rm frontend/src/components/BreathingOrb.jsx
rm frontend/src/components/CalibrationScreen.jsx
rm frontend/src/components/ConnectScreen.jsx
rm frontend/src/components/CosmicBackground.jsx
rm frontend/src/components/DashboardScreen.jsx
rm frontend/src/components/FlowingWaves.jsx
rm frontend/src/components/HistoryPanel.jsx
rm frontend/src/components/InsightsScreen.jsx
rm frontend/src/components/LiveSessionScreen.jsx
rm frontend/src/components/MainSession.jsx
rm frontend/src/components/SessionEnd.jsx
rm frontend/src/components/SplashScreen.jsx
rm frontend/src/components/WhoopDashboard.jsx

# Old engines (replaced by sensors/)
rm frontend/src/engines/polarH10BLE.js
rm frontend/src/engines/rrProcessor.js
rm frontend/src/engines/toneEngine.js
rm frontend/src/engines/spotifyEngine.js
rm frontend/src/engines/whoopBLE.js
rm frontend/src/engines/whoopEngine.js

# Old context (replaced by AuthContext)
rm frontend/src/context/AppContext.jsx

# Old store (no longer used)
rm -rf frontend/src/store/
```

Also check and remove: `frontend/src/audio/` — not imported anywhere in active code.

**Verification checklist:**
- [ ] `npm run build` still passes after deletions
- [ ] `grep -r "AppContext\|sessionStore\|toneEngine\|rrProcessor" frontend/src/pages frontend/src/ui` → zero results

---

## Phase 8: End-to-End Verification (20 min)

```bash
# 1. Start backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 2. Start frontend
cd frontend && npm run dev -- --host 0.0.0.0

# 3. Check build
npm run build  # must pass zero errors

# 4. Run backend tests
python -m pytest backend/tests/ -v  # must pass 32/32
```

**Manual verification flow:**
1. Open `http://localhost:5173`
2. Login with Supabase credentials → reaches Landing
3. Select session + mode → press "Begin Session"
4. Session screen appears — wait for `auth_ok` then first WS frame
5. Confirm VS score updates, breath ring animates
6. End session → Report screen shows correct data
7. "New session" → back to Landing

**Browser DevTools checks:**
- WS frames: first outbound = `{"type":"auth","token":"..."}`, first inbound = `{"type":"auth_ok"}`
- Second+ outbound (real sensor mode): `{"rr": 850.0}` — NOT `rr_ms`
- WS URL: `?session=calm` (or whichever profile) — NOT `?session=token-1234567890`
- Zero 4xx/5xx from REST endpoints

---

## Anti-patterns (DO NOT)

- Do NOT add back `token` input to Landing — auth is handled by Supabase
- Do NOT use inline hex colors — use CSS vars
- Do NOT animate `width`/`height` — use `transform`/`opacity` only
- Do NOT import from `components/` folder — it is being deleted
- Do NOT use `useNavigate` — app uses state machine routing (no React Router)
- Do NOT add abstractions for single-use code
- Do NOT tune HRV/ANS params — no real H10 data yet (V2.1 prerequisite not complete)
