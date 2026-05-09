# Plan: Natural Music Engine + Dashboard Redesign
**Date:** 2026-05-09  
**Status:** Implementing

## Goal
Replace oscillator synthesis with ISO-bridge ANS audio engine. Redesign Dashboard to Oura/Whoop-style session picker. Add real-time HRV chart to live session screen. Add RF lock display to Calibration.

## Scientific Grounding
- **ISO Principle (Altshuler 1948)**: Music matches current ANS state, leads to target — never jumps directly.
- **ISO Bridge**: `bridge = current + α × (target − current)` where α rises when ANS moves toward target, falls when resisting.
- **Binaural entrainment latency**: 45–60s glide required (Thaut 2015) — current 2s ramp is wrong.
- **Polyvagal (Porges)**: 85–300Hz prosodic range activates ventral vagal complex → drives instrument selection.
- **State confirmation gate**: 8s stress direction, 25s calm direction, ±0.08 hysteresis.

## Architecture Summary
```
SESSIONS config → Dashboard card picker
         ↓
Calibration (RF lock per session) → rf_bpm locked
         ↓
Session (WS frames @ 1Hz)
  ├── HrvChart (canvas, 1Hz RMSSD points)
  ├── RF display row
  └── SessionAudio
        ├── ISO bridge: α-adaptive layer blend
        ├── BinauralGenerator (45s glide)
        └── BreathActuator (RF-locked)
```

## Tasks

### Task 1: Modular Session Config
**File**: `frontend/src/config/sessions.js`  
**Purpose**: Single source of truth for all session types — durations, phase arcs, ISO targets, circadian fit.

```js
export const SESSIONS = {
  find_your_calm: {
    id: 'find_your_calm', label: 'Find Your Calm', icon: '◎', colorKey: 'teal',
    description: 'Shift from activation to balance. Science-backed RF breathing + alpha entrainment.',
    durations: [
      { label: '15 min', value: 900, description: 'Quick reset' },
      { label: '25 min', value: 1500, description: 'Full protocol' },
      { label: '40 min', value: 2400, description: 'Deep practice' },
    ],
    circadian: { best: [20, 22], decent: [12, 20] },
    phases: {
      ACKNOWLEDGE: { durationFraction: 0.15, binaural: 10, carrier: 174, breathVol: 0.0, breathRate: null,
        isoTarget: { arousal: 0.65, valence: 0.4, stability: 0.35, coherence: 0.25 },
        copy: 'Your heart is slightly activated. The music is meeting you here.' },
      SLOW:        { durationFraction: 0.30, binaural: 8.5, carrier: 174, breathVol: 0.2, breathRate: 5.5,
        isoTarget: { arousal: 0.45, valence: 0.55, stability: 0.55, coherence: 0.45 } },
      ANCHOR:      { durationFraction: 0.35, binaural: 7.5, carrier: 256, breathVol: 0.4, breathRate: 5.5,
        isoTarget: { arousal: 0.3, valence: 0.7, stability: 0.7, coherence: 0.65 } },
      RELEASE:     { durationFraction: 0.20, binaural: 6, carrier: 256, breathVol: 0.2, breathRate: 5.5,
        isoTarget: { arousal: 0.2, valence: 0.8, stability: 0.8, coherence: 0.8 } },
    },
  },
  wind_down: {
    id: 'wind_down', label: 'Wind Down', icon: '◑', colorKey: 'indigo',
    description: 'Prepare body and mind for deep, restorative sleep.',
    durations: [
      { label: '20 min', value: 1200, description: 'Light wind-down' },
      { label: '30 min', value: 1800, description: 'Full protocol' },
      { label: '45 min', value: 2700, description: 'Deep sleep prep' },
    ],
    circadian: { best: [21, 24], decent: [18, 24] },
    phases: {
      MEET:       { durationFraction: 0.15, binaural: 10, carrier: 174, breathVol: 0.1,
        isoTarget: { arousal: 0.5, valence: 0.5, stability: 0.4, coherence: 0.3 } },
      DECELERATE: { durationFraction: 0.25, binaural: 6, carrier: 174, breathVol: 0.1,
        isoTarget: { arousal: 0.35, valence: 0.6, stability: 0.55, coherence: 0.5 } },
      DEEPEN:     { durationFraction: 0.30, binaural: 4, carrier: 128, breathVol: 0.1,
        isoTarget: { arousal: 0.2, valence: 0.65, stability: 0.7, coherence: 0.65 } },
      DISSOLVE:   { durationFraction: 0.20, binaural: 2, carrier: 128, breathVol: 0.0,
        isoTarget: { arousal: 0.1, valence: 0.7, stability: 0.85, coherence: 0.8 } },
      MONITOR:    { durationFraction: 0.10, binaural: 1.5, carrier: 128, breathVol: 0.0,
        isoTarget: { arousal: 0.05, valence: 0.7, stability: 0.9, coherence: 0.9 } },
    },
  },
  morning_emergence: {
    id: 'morning_emergence', label: 'Morning Emergence', icon: '◐', colorKey: 'gold',
    description: 'Activate healthy sympathetic tone for focused, energised presence.',
    durations: [
      { label: '10 min', value: 600, description: 'Quick activation' },
      { label: '18 min', value: 1080, description: 'Full protocol' },
      { label: '25 min', value: 1500, description: 'Deep activation' },
    ],
    circadian: { best: [5, 9], decent: [9, 11] },
    phases: {
      ORIENT:   { durationFraction: 0.20, binaural: 6, carrier: 256, breathVol: 0.0,
        isoTarget: { arousal: 0.3, valence: 0.5, stability: 0.6, coherence: 0.5 } },
      ACTIVATE: { durationFraction: 0.35, binaural: 10, carrier: 396, breathVol: 0.2,
        isoTarget: { arousal: 0.55, valence: 0.65, stability: 0.65, coherence: 0.6 } },
      ENERGIZE: { durationFraction: 0.30, binaural: 12, carrier: 432, breathVol: 0.3,
        isoTarget: { arousal: 0.7, valence: 0.75, stability: 0.7, coherence: 0.7 } },
      PRIME:    { durationFraction: 0.15, binaural: 12, carrier: 432, breathVol: 0.3,
        isoTarget: { arousal: 0.75, valence: 0.8, stability: 0.75, coherence: 0.75 } },
    },
  },
};

export function getPhaseOrder(sessionId) { return Object.keys(SESSIONS[sessionId]?.phases ?? {}); }
export function getPhaseTarget(sessionId, phaseName) { return SESSIONS[sessionId]?.phases[phaseName]?.isoTarget ?? null; }
export function getDurations(sessionId) { return SESSIONS[sessionId]?.durations ?? []; }
export function getSessionList() { return Object.values(SESSIONS); }
```

### Task 2: HrvChart Canvas Component
**File**: `frontend/src/components/HrvChart.jsx`  
**Purpose**: Real-time RMSSD line chart using canvas. Points accumulated externally, passed as props.

```jsx
// Uses canvas — no charting lib dependency
// Props: points [{t, rmssd}], width, height, colorHex
export function HrvChart({ points = [], width = 280, height = 80, colorHex = '#3FBFA8' }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    // draw gradient fill + line + current value dot
  }, [points, width, height, colorHex]);
  return <canvas ref={canvasRef} width={width} height={height} style={{ borderRadius: 8 }} />;
}
```

### Task 3: Stems Manifest
**File**: `frontend/public/stems/stems.json`  
**Purpose**: Placeholder manifest for progressive stem loading. Oscillator fallback active until stems load.

### Task 4: Dashboard Redesign
**File**: `frontend/src/pages/Dashboard.jsx`  
**Purpose**: Oura-style session picker — VS readiness hero, vitals strip, session cards with inline duration chips.
- Import `SESSIONS` from `../config/sessions.js`
- Remove old hardcoded SESSIONS array and DURATIONS array
- Duration chips inline per session card (not global picker)
- onStart receives `{ session: id, durationS, sensorMode, backendMode }`
- Keep existing: MODES picker, BLE connect CTA, Quick Start

### Task 5: Calibration Enhancement
**File**: `frontend/src/pages/Calibration.jsx`  
**Purpose**: Show locked RF value once calibration completes. Add sweep phase indicator.
- After `cal_done`, show `{rfBpm.toFixed(1)} bpm` in locked card
- Keep all existing logic intact — surgical addition only

### Task 6: Session Screen — HRV Chart + RF Row
**File**: `frontend/src/pages/Session.jsx`  
**Purpose**: Add real-time HRV graph and RF display row.
- Import `HrvChart`
- Accumulate `{t: frame.t, rmssd: frame.metrics?.rmssd}` points at 1Hz into state
- Render `<HrvChart points={hrvPoints} />` below phase display
- Render RF row: `{frame.rf_bpm?.toFixed(1)} bpm` with lock indicator

### Task 7: ISO Bridge Audio Engine
**File**: `frontend/src/audio/session_audio.js`  
**Purpose**: Full rewrite — ISO bridge model with α-adaptive convergence. Binaural glide 45s. Import SESSIONS config.
- Bridge formula: `bridge = current + α × (target − current)`
- α rises (faster pull) when ANS moves toward target, falls when resisting  
- Binaural layer glides at 45s; harmonic holds longest
- Keep oscillator fallback (no stems yet — stems.json is placeholder)
- Import `SESSIONS` from `../config/sessions.js`

### Task 8: Build Verification + Smoke Tests
- `npm run build` passes (no TypeScript — JS project, Vite)
- `python -m pytest` passes (backend unchanged)
- Manual checklist: BLE connect → calibration → session → audio plays → HRV chart animates → RF displays

## Dependency Order
```
Group 1 (parallel): sessions.js, HrvChart.jsx, stems.json, session_audio.js
Group 2 (parallel, after Group 1): Dashboard.jsx, Session.jsx, Calibration.jsx
Group 3: Build verification
```

## Success Criteria
- [ ] `sessions.js` exports SESSIONS with 3 session types, full ISO arc data
- [ ] `HrvChart` renders canvas with RMSSD line, no charting lib
- [ ] Dashboard shows session cards with inline duration chips per session
- [ ] Calibration shows locked RF value after `cal_done`
- [ ] Session screen shows HRV chart + RF row
- [ ] `session_audio.js` uses ISO bridge, 45s binaural glide
- [ ] `npm run build` passes
- [ ] `python -m pytest` passes
