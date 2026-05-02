# Mission Alive — Master Consolidation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full app redesign — always-on sensor streaming with live status + auto-reconnect, new user flow (Landing → Auth → Calibration → Dashboard → Session → Insight), and progressive RF discovery.

**Architecture:** SensorContext singleton holds all sensors as useRefs so BLE/WS never restart on navigation. BleH10 reconnects indefinitely with exponential backoff and falls back to rPPG on repeated failure. Live sensor status visible on every screen via upgraded SensorStatusBar reading from context.

**Tech Stack:** React 18, Vite, FastAPI, Supabase Postgres, Tone.js, Web Bluetooth API, WebAudio API

---

## Migration Conflict Resolution

**One migration file. Two plans named it 002. Resolved here:**

```
backend/migrations/002_rf_schema.sql   ← everything RF + calibration_done
```

Contents:
1. `user_profiles` columns: `calibration_done`, `rf_bpm`, `rf_confidence_tag`, `rf_rsa_amplitude`
2. `rf_calibration` table (state machine: UNVALIDATED→DRAFT→REFINED→CONFIRMED)
3. RLS policies on `rf_calibration`

The Active Session plan's separate migration for `user_profiles` RF columns is dropped — those live in 002.

---

## Implementation Order (hard dependency chain)

```
Phase 1: Sensor Architecture + Reconnect + Live Status    ← BLOCKS ALL
    │
Phase 2: Auth + Landing + Migration 002                   ← BLOCKS 3A, 3B
    ├── Phase 3A: Calibration (Progressive RF)
    └── Phase 3B: Dashboard
              │
         Phase 4: Active Session + Phase 2 RF
              │
         Phase 5: Insight Additions
```

---

## New Requirements (not in individual plans)

### Sensor Reconnect Strategy
- BleH10: remove 5-attempt cap → retry indefinitely; delay: `min(1000 * 2^(attempt-1), 30000)ms`
- BleH10: expose `onStatusChange(status: 'connected'|'reconnecting'|'failed')` callback
- BreathMic: expose `onStatusChange(status: 'active'|'error'|'unavailable')` callback
- BreathMic: auto-retry on mic error after 5s (once)

### Fallback on BLE Failure
- After 3 consecutive reconnect failures → SensorContext sets `bleStatus = 'fallback_rppg'`
- SensorFusion mode switches from 2/3 → 1 (rPPG) automatically
- User sees amber banner: "H10 unavailable — using phone camera for HR"
- Continues reconnecting in background every 30s

### Live Sensor Status UI
- `SensorStatusBar` reads `bleStatus`, `micStatus` from `useSensorContext()` — not props
- Dot states: green=connected, amber+pulse=reconnecting, red=failed, grey=unavailable
- Show HR value from `latestRR` when BLE connected
- Visible on: Dashboard (sticky top), Calibration (top bar), Session (top bar)

---

## Phase 1: Sensor Architecture + Reconnect + Live Status

### Files
| Action | Path |
|--------|------|
| Create | `frontend/src/context/SensorContext.jsx` |
| Modify | `frontend/src/sensors/ble_h10.js` |
| Modify | `frontend/src/sensors/breath_mic.js` |
| Modify | `frontend/src/components/SensorStatusBar.jsx` |
| Modify | `frontend/src/App.jsx` |
| Modify | `backend/main.py` |
| Modify | `frontend/public/sw.js` (or create if absent) |
| Create | `frontend/src/hooks/useSensorFrame.js` |
| Create | `frontend/src/context/SensorContext.test.jsx` |

---

### Task 1: Upgrade BleH10 — indefinite reconnect + status callback

**Files:**
- Modify: `frontend/src/sensors/ble_h10.js`

- [ ] **Step 1: Verify existing reconnect caps at 5**

```bash
grep -n "attempt > 5\|attempt > 3" frontend/src/sensors/ble_h10.js
```
Expected: one line showing `attempt > 5`

- [ ] **Step 2: Rewrite ble_h10.js with status callback + indefinite reconnect**

Replace the full file:

```js
// frontend/src/sensors/ble_h10.js
export class BleH10Sensor {
    constructor() {
        this.rrBuffer = [];
        this.accelBuffer = [];
        this._device = null;
        this._server = null;
        this._connected = false;
        this._stopped = false;
        this._listenerBound = false;
        this._reconnectAttempt = 0;
        this._onStatusChange = null; // (status: 'connected'|'reconnecting'|'failed'|'fallback') => void
    }

    onStatusChange(cb) {
        this._onStatusChange = cb;
        return this;
    }

    _emit(status) {
        if (this._onStatusChange) this._onStatusChange(status);
    }

    async start() {
        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: ['heart_rate'] },
                    { namePrefix: 'Polar' },
                ],
                optionalServices: ['heart_rate']
            });
            this._device = device;
            this._stopped = false;
            this._reconnectAttempt = 0;

            device.addEventListener('gattserverdisconnected', () => {
                this._connected = false;
                if (!this._stopped) {
                    this._emit('reconnecting');
                    this._reconnect(1);
                }
            });

            await this._connect();
        } catch (err) {
            console.warn('[H10] start failed:', err);
            this._emit('failed');
        }
    }

    async _connect() {
        if (!this._device) return;
        const server = await this._device.gatt.connect();
        this._server = server;
        const service = await server.getPrimaryService('heart_rate');
        const char = await service.getCharacteristic('heart_rate_measurement');
        await char.startNotifications();
        this._char = char;
        if (!this._listenerBound) {
            char.addEventListener('characteristicvaluechanged', (e) => this._onData(e.target.value));
            this._listenerBound = true;
        }
        this._connected = true;
        this._reconnectAttempt = 0;
        this._emit('connected');
    }

    // Indefinite reconnect — no attempt cap. Delay caps at 30s.
    // After 3 failures, emits 'fallback' so SensorContext can switch to rPPG.
    async _reconnect(attempt = 1) {
        if (this._stopped) return;
        this._reconnectAttempt = attempt;
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        await new Promise(r => setTimeout(r, delay));
        if (this._stopped) return;
        try {
            await this._connect();
        } catch (e) {
            console.warn(`[H10] reconnect attempt ${attempt} failed:`, e);
            if (attempt === 3) this._emit('fallback');
            this._reconnect(attempt + 1);
        }
    }

    stop() {
        this._stopped = true;
        this._connected = false;
        try { if (this._device?.gatt?.connected) this._device.gatt.disconnect(); } catch(_) {}
    }

    _onData(data) {
        const view = new DataView(data.buffer);
        const flags = view.getUint8(0);
        const hr16bit = (flags & 0x01) !== 0;
        const rrPresent = (flags & 0x10) !== 0;
        if (!rrPresent) return;
        let offset = 1 + (hr16bit ? 2 : 1);
        const eePresent = (flags & 0x08) !== 0;
        if (eePresent) offset += 2;
        while (offset + 2 <= data.byteLength) {
            const rr_1024 = view.getUint16(offset, true);
            const rr_ms = (rr_1024 / 1024) * 1000;
            if (rr_ms > 300 && rr_ms < 2000) {
                this.rrBuffer.push(rr_ms);
                if (this.rrBuffer.length > 200) this.rrBuffer.shift();
            }
            offset += 2;
        }
    }

    isConnected() { return !!this._connected; }
    getReconnectAttempt() { return this._reconnectAttempt; }
    getLatestRR() { return { rr_ms: [...this.rrBuffer], confidence: 0.95, source: 'h10' }; }
    getLatestAccel() { return { signal: [...this.accelBuffer], fs: 25.0 }; }
}
```

- [ ] **Step 3: Verify no syntax errors**

```bash
cd C:/Users/user/Desktop/mission_alive/frontend && node --input-type=module < /dev/null 2>&1 || npx --yes acorn --ecma2020 --module src/sensors/ble_h10.js > /dev/null && echo "OK"
```
Expected: OK (or no error output)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/sensors/ble_h10.js
git commit -m "feat(sensor): indefinite BLE reconnect + status callback"
```

---

### Task 2: Upgrade BreathMic — status callback + auto-retry

**Files:**
- Modify: `frontend/src/sensors/breath_mic.js`

- [ ] **Step 1: Add status callback and retry to BreathMicSensor**

Add these changes to `breath_mic.js` (keep all existing logic, add below):

```js
// frontend/src/sensors/breath_mic.js
// WebAudio FFT → dominant 0.1–0.5Hz band → breath rate (6–30 bpm)
export class BreathMicSensor {
    constructor() {
        this.latest = null;
        this.running = false;
        this._intervalId = null;
        this._sampleId = null;
        this._respAmpBuffer = [];
        this._onStatusChange = null; // (status: 'active'|'error'|'unavailable') => void
    }

    onStatusChange(cb) {
        this._onStatusChange = cb;
        return this;
    }

    _emit(status) {
        if (this._onStatusChange) this._onStatusChange(status);
    }

    async start() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const src = ctx.createMediaStreamSource(stream);
            this.analyser = ctx.createAnalyser();
            this.analyser.fftSize = 8192;
            src.connect(this.analyser);
            this.running = true;
            this._emit('active');
            this._intervalId = setInterval(() => this._update(), 5000);
            this._sampleId = setInterval(() => this._sampleBandAmp(), 250);
            this._update();
        } catch (err) {
            console.warn('BreathMic start failed:', err);
            if (err.name === 'NotAllowedError') {
                this._emit('unavailable');
            } else {
                this._emit('error');
                // Auto-retry once after 5s for transient errors
                setTimeout(() => { if (!this.running) this.start(); }, 5000);
            }
        }
    }

    stop() {
        this.running = false;
        if (this._intervalId) clearInterval(this._intervalId);
        if (this._sampleId) clearInterval(this._sampleId);
    }

    _sampleBandAmp() {
        if (!this.running || !this.analyser) return;
        const buf = new Float32Array(this.analyser.frequencyBinCount);
        this.analyser.getFloatFrequencyData(buf);
        const sr = this.analyser.context.sampleRate;
        const binHz = sr / this.analyser.fftSize;
        const loIdx = Math.max(0, Math.floor(0.1 / binHz));
        const hiIdx = Math.min(buf.length - 1, Math.ceil(0.5 / binHz));
        let sumLin = 0, n = 0;
        for (let i = loIdx; i <= hiIdx; i++) {
            sumLin += Math.pow(10, buf[i] / 10);
            n++;
        }
        const amp = Math.sqrt(Math.max(0, n > 0 ? sumLin / n : 0));
        this._respAmpBuffer.push(amp);
        if (this._respAmpBuffer.length > 240) this._respAmpBuffer.shift();
    }

    getRespAmplitudeSample() {
        return this._respAmpBuffer.length > 0
            ? this._respAmpBuffer[this._respAmpBuffer.length - 1]
            : 0;
    }

    _update() {
        if (!this.running || !this.analyser) return;
        const buf = new Float32Array(this.analyser.frequencyBinCount);
        this.analyser.getFloatFrequencyData(buf);
        const sr = this.analyser.context.sampleRate;
        const binHz = sr / this.analyser.fftSize;
        const loIdx = Math.max(0, Math.floor(0.1 / binHz));
        const hiIdx = Math.min(buf.length - 1, Math.ceil(0.5 / binHz));
        let peak = -Infinity, peakIdx = loIdx;
        for (let i = loIdx; i <= hiIdx; i++) {
            if (buf[i] > peak) { peak = buf[i]; peakIdx = i; }
        }
        const breath_rate_bpm = Math.max(6, Math.min(30, peakIdx * binHz * 60));
        this.latest = {
            breath_rate_bpm,
            regularity: peak > -60 ? 0.7 : 0.3,
            rf_compliance: 0.5,
            confidence: peak > -50 ? 0.75 : 0.3
        };
    }

    getLatestReading() { return this.latest || null; }
    isReady() { return this.running && this.latest != null; }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/sensors/breath_mic.js
git commit -m "feat(sensor): mic status callback + auto-retry on error"
```

---

### Task 3: Create SensorContext.jsx

**Files:**
- Create: `frontend/src/context/SensorContext.jsx`

- [ ] **Step 1: Create the file**

```jsx
// frontend/src/context/SensorContext.jsx
import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { BleH10Sensor } from '../sensors/ble_h10.js'
import { BreathMicSensor } from '../sensors/breath_mic.js'
import { SensorFusion } from '../sensors/sensor_fusion.js'
import { supabase } from '../lib/supabase.js'

const SensorCtx = createContext(null)

// bleStatus: 'idle'|'connected'|'reconnecting'|'fallback_rppg'|'failed'|'unavailable'
// micStatus: 'idle'|'active'|'error'|'unavailable'
// wsStatus:  'idle'|'open'|'closed'|'error'

export function SensorProvider({ children }) {
    // Sensor singletons — never recreated
    const bleRef    = useRef(null)
    const micRef    = useRef(null)
    const fusionRef = useRef(null)
    const wsRef     = useRef(null)
    const wsFrameCbsRef = useRef({}) // { [type]: Set<callback> }

    const [bleStatus, setBleStatus] = useState('idle')
    const [micStatus, setMicStatus] = useState('idle')
    const [wsStatus,  setWsStatus]  = useState('idle')
    const [latestRR,  setLatestRR]  = useState(null)
    const [rfBpm,     setRfBpm]     = useState(null)
    const [rfLocked,  setRfLocked]  = useState(false)

    // Derive live HR from RR for UI display
    const latestHR = latestRR && latestRR.length > 0
        ? Math.round(60000 / latestRR[latestRR.length - 1])
        : null

    // Poll RR from BLE sensor at 1Hz for context state
    useEffect(() => {
        const id = setInterval(() => {
            if (bleRef.current?.isConnected()) {
                const reading = bleRef.current.getLatestRR()
                if (reading?.rr_ms?.length > 0) setLatestRR(reading.rr_ms)
            }
        }, 1000)
        return () => clearInterval(id)
    }, [])

    const requestBle = useCallback(async () => {
        if (bleRef.current) return // already initialised
        const h10 = new BleH10Sensor()
        h10.onStatusChange((status) => {
            if (status === 'connected')   setBleStatus('connected')
            if (status === 'reconnecting') setBleStatus('reconnecting')
            if (status === 'fallback')    setBleStatus('fallback_rppg')
            if (status === 'failed')      setBleStatus('failed')
        })
        bleRef.current = h10
        setBleStatus('reconnecting')
        await h10.start()
    }, [])

    const startMic = useCallback(async () => {
        if (micRef.current?.isReady()) return
        const mic = new BreathMicSensor()
        mic.onStatusChange((status) => {
            setMicStatus(status)
        })
        micRef.current = mic
        await mic.start()
        setMicStatus('active')
    }, [])

    const initWS = useCallback((url) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current
        const ws = new WebSocket(url)
        wsRef.current = ws
        ws.onopen  = () => setWsStatus('open')
        ws.onclose = () => setWsStatus('closed')
        ws.onerror = () => setWsStatus('error')
        ws.onmessage = (e) => {
            let msg
            try { msg = JSON.parse(e.data) } catch { return }
            const type = msg.type
            if (!type) return
            // Update context state for known types
            if (type === 'session_frame' || type === 'cal_progress') {
                if (msg.rf_bpm != null) setRfBpm(msg.rf_bpm)
                if (msg.rf_locked != null) setRfLocked(!!msg.rf_locked)
            }
            // Dispatch to frame subscribers
            const cbs = wsFrameCbsRef.current[type]
            if (cbs) cbs.forEach(cb => cb(msg))
            const allCbs = wsFrameCbsRef.current['*']
            if (allCbs) allCbs.forEach(cb => cb(msg))
        }
        return ws
    }, [])

    const sendWS = useCallback((obj) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(obj))
        }
    }, [])

    const subscribeFrame = useCallback((type, cb) => {
        if (!wsFrameCbsRef.current[type]) wsFrameCbsRef.current[type] = new Set()
        wsFrameCbsRef.current[type].add(cb)
        return () => wsFrameCbsRef.current[type]?.delete(cb)
    }, [])

    const value = {
        // status
        bleStatus, micStatus, wsStatus,
        // live data
        latestRR, latestHR, rfBpm, rfLocked,
        // refs (for screens that need direct access)
        bleRef, micRef, fusionRef, wsRef,
        // actions
        requestBle, startMic, initWS, sendWS, subscribeFrame,
    }

    return <SensorCtx.Provider value={value}>{children}</SensorCtx.Provider>
}

export function useSensorContext() {
    const ctx = useContext(SensorCtx)
    if (!ctx) throw new Error('useSensorContext must be inside SensorProvider')
    return ctx
}
```

- [ ] **Step 2: Create useSensorFrame hook**

```js
// frontend/src/hooks/useSensorFrame.js
import { useEffect, useRef } from 'react'
import { useSensorContext } from '../context/SensorContext.jsx'

/**
 * Subscribe to a WS frame type. Callback fires on each matching frame.
 * Uses a stable ref so callers don't need to memoize cb.
 */
export function useSensorFrame(type, cb) {
    const { subscribeFrame } = useSensorContext()
    const cbRef = useRef(cb)
    cbRef.current = cb
    useEffect(() => {
        const stableCb = (msg) => cbRef.current(msg)
        return subscribeFrame(type, stableCb)
    }, [type, subscribeFrame])
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/context/SensorContext.jsx frontend/src/hooks/useSensorFrame.js
git commit -m "feat(sensor): SensorContext singleton + useSensorFrame hook"
```

---

### Task 4: Upgrade SensorStatusBar to read live from context

**Files:**
- Modify: `frontend/src/components/SensorStatusBar.jsx`

- [ ] **Step 1: Rewrite SensorStatusBar**

```jsx
// frontend/src/components/SensorStatusBar.jsx
import { useSensorContext } from '../context/SensorContext.jsx'

const DOT_STYLE = {
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
    display: 'inline-block',
}

function StatusDot({ status }) {
    // status: 'connected'|'active' → green
    //         'reconnecting' → amber pulsing
    //         'fallback_rppg' → amber solid
    //         'failed'|'error'|'unavailable'|'closed' → red
    //         'idle'|'open' → grey
    const color = {
        connected:     '#00D084',
        active:        '#00D084',
        open:          '#00D084',
        reconnecting:  '#EF9F27',
        fallback_rppg: '#EF9F27',
        failed:        '#E24B4A',
        error:         '#E24B4A',
        unavailable:   '#E24B4A',
        closed:        '#E24B4A',
        idle:          '#555',
    }[status] ?? '#555'
    const pulse = status === 'reconnecting'
    return (
        <div style={{
            ...DOT_STYLE,
            background: color,
            boxShadow: color !== '#555' ? `0 0 6px ${color}` : 'none',
            animation: pulse ? 'pulse-dot 1s ease-in-out infinite' : 'none',
        }} />
    )
}

export function SensorStatusBar({ rfLocked, sqi }) {
    const { bleStatus, micStatus, latestHR } = useSensorContext()

    const bleLabel = bleStatus === 'fallback_rppg'
        ? 'rPPG (H10 fallback)'
        : bleStatus === 'reconnecting'
        ? `H10 (retry…)`
        : 'H10'

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <StatusDot status={bleStatus} />
                <span style={{ color: '#7A7A96', fontSize: 12 }}>{bleLabel}</span>
                {latestHR && bleStatus === 'connected' && (
                    <span style={{ color: '#fff', fontSize: 12, marginLeft: 2 }}>
                        {latestHR} bpm
                    </span>
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <StatusDot status={micStatus} />
                <span style={{ color: '#7A7A96', fontSize: 12 }}>Mic</span>
            </div>
            {rfLocked != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <StatusDot status={rfLocked ? 'connected' : 'reconnecting'} />
                    <span style={{ color: '#7A7A96', fontSize: 12 }}>RF{rfLocked ? ' ✓' : '…'}</span>
                </div>
            )}
            {sqi != null && (
                <div style={{ color: sqi >= 0.75 ? '#00D084' : '#EF9F27', fontSize: 12 }}>
                    SQI {Math.round(sqi * 100)}%
                </div>
            )}
            {bleStatus === 'fallback_rppg' && (
                <div style={{ fontSize: 11, color: '#EF9F27', background: 'rgba(239,159,39,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                    H10 unavailable — using phone camera
                </div>
            )}
        </div>
    )
}
```

Add to global CSS (or existing animation block):

```css
/* In frontend/src/styles/global.css — add to existing keyframe block */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
```

- [ ] **Step 2: Verify existing callers of SensorStatusBar still compile**

```bash
grep -r "SensorStatusBar" frontend/src --include="*.jsx" --include="*.js"
```

For each caller: check they pass `rfLocked` and/or `sqi` as props only — the `mode` and `sensorStatus` props are removed. Update callers to drop those props.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SensorStatusBar.jsx frontend/src/styles/global.css
git commit -m "feat(ui): SensorStatusBar reads live from SensorContext, shows reconnect state"
```

---

### Task 5: Wrap App.jsx in SensorProvider + trigger BLE after profile

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Add SensorProvider import and wrap**

In `App.jsx`, change `export default function App()`:

```jsx
import { SensorProvider } from './context/SensorContext.jsx'

export default function App() {
    return (
        <AuthProvider>
            <SensorProvider>
                <AppRoutes />
            </SensorProvider>
        </AuthProvider>
    )
}
```

- [ ] **Step 2: Trigger BLE + mic after profile loads**

In `AppRoutes`, import `useSensorContext` and add effect:

```jsx
import { useSensorContext } from './context/SensorContext.jsx'

function AppRoutes() {
    // ... existing state ...
    const { requestBle, startMic } = useSensorContext()

    // Trigger BLE + mic once profile is confirmed present (user gesture already satisfied)
    useEffect(() => {
        if (profile && typeof profile === 'object') {
            startMic()
            // BLE requires a fresh user gesture — triggered from a button tap in Setup or ProfileSetup
            // Do NOT call requestBle() here (no user gesture in useEffect)
        }
    }, [profile, startMic])

    // ... rest of component unchanged ...
}
```

Note: `requestBle()` must be called from a button click handler, not `useEffect`. Wire it to the "Connect H10" button in Setup.jsx or a dedicated "Connect Sensor" button on Dashboard.

- [ ] **Step 3: Run dev server, verify no console errors**

```bash
cd C:/Users/user/Desktop/mission_alive/frontend && npm run dev
```
Expected: dev server starts, no "useSensorContext must be inside SensorProvider" errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(app): wrap in SensorProvider, trigger mic on profile load"
```

---

### Task 6: Backend — typed WS frames + persistent connection + ping-pong

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Read current WS send sites**

```bash
grep -n "send_json\|websocket.send" backend/main.py | head -40
```

- [ ] **Step 2: Add `type` field to all downstream frames**

In `main.py`, find every `await websocket.send_json({...})` call in the WS handler and add `"type"` field:

```python
# cal_progress frame — add type
await websocket.send_json({
    "type": "cal_progress",
    "t": t, "rf_bpm": ..., "coherence": ..., "phase": ...
})

# cal_done frame — add type, do NOT close WS after this
await websocket.send_json({
    "type": "cal_done",
    "rf_bpm": best_bpm, "rf_locked": True, "confidence_tag": tag
})
# REMOVE any: await websocket.close() after cal_done

# session_frame — add type
await websocket.send_json({
    "type": "session_frame",
    "t": t, "vs": ..., "rf_bpm": ..., ...
})

# session_end frame — add type, do NOT close WS after this
await websocket.send_json({
    "type": "session_end",
    "peak_vs": ..., "final_vs": ..., ...
})
# REMOVE any: await websocket.close() after session_end

# error frame
await websocket.send_json({"type": "error", "msg": "..."})
```

- [ ] **Step 3: Add ping-pong keepalive**

Add 30s ping-pong task inside the WS handler (runs concurrently with main loop):

```python
async def _keepalive(ws: WebSocket):
    """Send ping every 30s to keep WS alive through proxies."""
    while True:
        await asyncio.sleep(30)
        try:
            await ws.send_json({"type": "ping"})
        except Exception:
            return

# Inside ws_session, after auth_ok:
asyncio.create_task(_keepalive(websocket))
```

- [ ] **Step 4: Add POST /api/session/finalize endpoint**

```python
class FinalizeRequest(BaseModel):
    session_id: str
    final_hrv: dict = {}

@app.post("/api/session/finalize")
async def finalize_session(req: FinalizeRequest):
    """Background Sync fallback — called by SW when page is killed mid-session."""
    # Best-effort: update session end timestamp if row exists
    if os.environ.get("DATABASE_URL") and req.session_id:
        try:
            await db.mark_session_finalized(req.session_id)
        except Exception:
            pass
    return {"finalized": True}
```

- [ ] **Step 5: Run backend tests**

```bash
cd C:/Users/user/Desktop/mission_alive && python -m pytest backend/tests/ -v -x 2>&1 | tail -20
```
Expected: all existing tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/main.py
git commit -m "feat(backend): typed WS frames, persistent connection, ping-pong keepalive"
```

---

### Task 7: Service Worker — Background Sync for page-kill finalize

**Files:**
- Modify/Create: `frontend/public/sw.js`

- [ ] **Step 1: Check if sw.js exists**

```bash
ls frontend/public/sw.js 2>/dev/null || echo "NOT FOUND"
```

- [ ] **Step 2: Add Background Sync handler**

Add to existing `sw.js` (or create if absent):

```js
// frontend/public/sw.js
// Existing service worker content preserved. Add Background Sync below.

const API_URL = self.registration.scope.replace(/\/$/, '') + '/api'  // relative base

self.addEventListener('sync', (event) => {
    if (event.tag === 'hrv-flush') {
        event.waitUntil(flushSession())
    }
})

async function flushSession() {
    const pending = await getPendingSession()
    if (!pending) return
    try {
        await fetch(`${pending.apiUrl}/api/session/finalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: pending.sessionId, final_hrv: pending.hrv })
        })
        await clearPendingSession()
    } catch (e) {
        console.warn('[SW] hrv-flush failed:', e)
    }
}

// IDB helpers — store pending session across page kill
async function getPendingSession() {
    return new Promise((resolve) => {
        const req = indexedDB.open('mission-alive-sw', 1)
        req.onupgradeneeded = (e) => e.target.result.createObjectStore('pending')
        req.onsuccess = (e) => {
            const tx = e.target.result.transaction('pending', 'readonly')
            const get = tx.objectStore('pending').get('session')
            get.onsuccess = () => resolve(get.result ?? null)
        }
        req.onerror = () => resolve(null)
    })
}

async function clearPendingSession() {
    return new Promise((resolve) => {
        const req = indexedDB.open('mission-alive-sw', 1)
        req.onsuccess = (e) => {
            const tx = e.target.result.transaction('pending', 'readwrite')
            tx.objectStore('pending').delete('session')
            tx.oncomplete = resolve
        }
        req.onerror = resolve
    })
}

self.addEventListener('message', (event) => {
    if (event.data?.type === 'REGISTER_SESSION') {
        const req = indexedDB.open('mission-alive-sw', 1)
        req.onsuccess = (e) => {
            const tx = e.target.result.transaction('pending', 'readwrite')
            tx.objectStore('pending').put(event.data.payload, 'session')
        }
    }
    if (event.data?.type === 'CLEAR_SESSION') {
        clearPendingSession()
    }
})
```

- [ ] **Step 3: Commit**

```bash
git add frontend/public/sw.js
git commit -m "feat(sw): Background Sync hrv-flush for page-kill session finalize"
```

---

## Phase 2: Auth + Landing + Migration 002

> See full individual plan: `docs/superpowers/plans/2026-05-02-auth-landing-screens-plan.md`
> Key coordination: migration 002 file below supersedes what individual plan specifies.

### Task 8: Migration 002 — consolidated RF schema

**Files:**
- Create: `backend/migrations/002_rf_schema.sql`

- [ ] **Step 1: Create migration file**

```sql
-- backend/migrations/002_rf_schema.sql
-- Consolidated RF schema migration.
-- Covers: user_profiles RF columns + rf_calibration state machine table.
-- All statements idempotent. No DROPs.

-- 1. user_profiles additions
alter table public.user_profiles
  add column if not exists calibration_done    boolean  not null default false,
  add column if not exists rf_bpm              numeric(4,2),
  add column if not exists rf_confidence_tag   text     check (rf_confidence_tag in ('UNVALIDATED','DRAFT','REFINED','CONFIRMED')),
  add column if not exists rf_rsa_amplitude    numeric(5,2);

-- 2. rf_calibration — one row per user, updated on each phase transition
create table if not exists public.rf_calibration (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  rf_bpm               numeric(4,2)  not null,
  confidence_tag       text          not null check (confidence_tag in ('UNVALIDATED','DRAFT','REFINED','CONFIRMED')),
  rsa_amplitude        numeric(5,2),
  n_phase2_sessions    int           not null default 0,
  last_coherence       numeric(4,3),
  updated_at           timestamptz   not null default now()
);

-- 3. RLS on rf_calibration
alter table public.rf_calibration enable row level security;

create policy if not exists "user reads own rf_calibration"
  on public.rf_calibration for select
  using (auth.uid() = user_id);

create policy if not exists "user writes own rf_calibration"
  on public.rf_calibration for all
  using (auth.uid() = user_id);

-- 4. Index for fast per-user lookups
create index if not exists rf_calibration_user_idx on public.rf_calibration(user_id);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Run in Supabase MCP:
```
mcp__supabase__apply_migration with name="002_rf_schema" and migration SQL above
```

- [ ] **Step 3: Verify columns exist**

```sql
select column_name, data_type from information_schema.columns
where table_name = 'user_profiles'
and column_name in ('calibration_done','rf_bpm','rf_confidence_tag','rf_rsa_amplitude');
```
Expected: 4 rows returned

- [ ] **Step 4: Commit migration file**

```bash
git add backend/migrations/002_rf_schema.sql
git commit -m "feat(db): migration 002 — rf_calibration table + user_profiles RF columns"
```

---

### Task 9–13: Auth + Landing screens

> Follow `docs/superpowers/plans/2026-05-02-auth-landing-screens-plan.md` Tasks 1–5 exactly.
> One adjustment: Task 1 in that plan is migration 002 — **skip it** (done in Task 8 above).
> Start from Task 2 (Backend db.py + profile.py).

---

## Phase 3A: Calibration (Progressive RF)

> Follow `docs/superpowers/plans/2026-05-02-calibration-progressive-rf-plan.md` exactly.
> One adjustment: migration 002 is already applied — skip any migration step in that plan.
> The rf_calibration table already exists from Task 8.

---

## Phase 3B: Dashboard (parallel with 3A)

> Follow `docs/superpowers/plans/2026-05-02-dashboard-design-plan.md` exactly.
> One adjustment: replace `useSensorContextStub()` with real `useSensorContext()` — Task 8 in that plan.

---

## Phase 4: Active Session + Phase 2 RF

> Follow `docs/superpowers/plans/2026-05-02-active-session-phase2-rf-plan.md` exactly.
> One adjustment: skip any migration that adds RF columns to user_profiles (done in migration 002).
> `compute_rsa_amplitude` may already exist from Phase 3A — check before adding.

---

## Phase 5: Insight Additions

> Follow `docs/superpowers/plans/2026-05-02-insight-report-additions-plan.md` exactly.
> No adjustments needed — no migration dependency.

---

## Global Success Criteria

- [ ] Single `requestDevice()` dialog per app load — BLE never re-requests
- [ ] BLE disconnect → SensorStatusBar shows amber "H10 (retry…)" within 2s
- [ ] After 3 BLE failures → amber banner "H10 unavailable — using phone camera"
- [ ] Mic permission denied → red Mic dot (not crash)
- [ ] WS stays open through cal_done and session_end screen transitions
- [ ] `calibration_done = false` user → routed to Calibration before Dashboard
- [ ] RF confidence bar in Insight shows correct tag from `n_sessions_used`
- [ ] `npm run build` passes with no new warnings
- [ ] `python -m pytest backend/tests/ -v` passes

---

## Implementation Notes

**Do not tune HRV/ANS params** — LIVE STATE TABLE shows no real H10 sessions yet. All new thresholds marked `# UNTUNED`.

**Do not touch Session.jsx music engine or ANS classifier** — pipeline stages beyond this scope.

**Migration 002 is idempotent** — safe to re-apply. Each `ALTER TABLE ADD COLUMN IF NOT EXISTS` is a no-op if column exists.
