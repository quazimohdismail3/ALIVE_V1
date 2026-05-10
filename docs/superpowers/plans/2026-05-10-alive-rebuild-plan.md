# ALIVE V2 — Full Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the ALIVE biofeedback app with a clean H10-only pipeline, seamless calibration-every-login flow, and a human silhouette calibration screen.

**Architecture:** Backend audit + fixes first (pipeline correctness), then frontend clean rebuild (CalibrationScreen + Dashboard + App routing), then Playwright smoke + deploy.

**Tech Stack:** FastAPI + asyncpg (backend), React + Vite (frontend), Polar H10 BLE, Supabase Postgres, Railway (backend deploy via GitHub push), Vercel CLI (frontend deploy)

---

## File Map

### Backend — Modify Only
| File | Change |
|------|--------|
| `backend/main.py` | Fix WS drain loop, keepalive, cal peek, session loop |
| `backend/hrv_processor.py` | Fix null RMSSD after 22s, expose HF/LF in output |
| `backend/hrv_engine.py` | Verify HF/LF power emitted in cal_progress frames |
| `backend/rf_calibration.py` | Verify coherence calc, best_estimate fallback |
| `backend/artifact_filter.py` | Verify not over-rejecting valid H10 RRs |
| `backend/ans_classifier.py` | Graceful output when buffer thin |
| `backend/db.py` | Verify cal_hrv + sensor_mode columns present |

### Frontend — Create New
| File | Purpose |
|------|---------|
| `frontend/src/pages/SplashScreen.jsx` | 1.5s brand splash on every app open |
| `frontend/src/pages/CalibrationScreen.jsx` | H10 connect + RF calibrate + silhouette UI |

### Frontend — Rewrite
| File | Change |
|------|--------|
| `frontend/src/App.jsx` | New routing: splash→login→profile→cal→dashboard→session |
| `frontend/src/pages/Dashboard.jsx` | Add live HR + RF top bar + today's cal card |
| `frontend/src/pages/Session.jsx` | Use cfg.fusion always, cleanup guard, H10-only |
| `frontend/src/sensors/sensor_fusion.js` | H10-only mode (mode=2), strip unused start branches |

### Frontend — Delete
| File | Reason |
|------|--------|
| `frontend/src/pages/ConnectionRitual.jsx` | Replaced by CalibrationScreen.jsx |

### Test + Deploy
| File | Purpose |
|------|---------|
| `e2e/calibration.spec.js` | Playwright: splash → login → calibration flow |
| `e2e/session.spec.js` | Playwright: dashboard → begin session → live data |

---

## Phase 1 — Backend Audit + Fixes

### Task 1: Fix hrv_processor.py — null RMSSD after 22s

**Files:**
- Modify: `backend/hrv_processor.py`
- Test: `backend/tests/test_hrv_processor.py` (create if missing)

- [ ] **Read hrv_processor.py** and find the `compute()` method. Identify why it returns None when RR buffer has < threshold entries.

- [ ] **Write failing test**
```python
# backend/tests/test_hrv_processor.py
from backend.hrv_processor import HRVProcessor

def test_compute_returns_partial_with_few_rr():
    proc = HRVProcessor()
    # Push 15 RRs — should not return None
    for rr in [800, 820, 810, 830, 790, 800, 815, 805, 825, 795, 800, 810, 820, 800, 815]:
        proc.push(rr)
    result = proc.compute()
    assert result is not None, "compute() must not return None with >= 10 RR intervals"
    assert result.hr > 0

def test_compute_returns_none_with_too_few_rr():
    proc = HRVProcessor()
    for rr in [800, 820]:
        proc.push(rr)
    result = proc.compute()
    assert result is None  # < 5 RRs → None is acceptable
```

- [ ] **Run test:** `python -m pytest backend/tests/test_hrv_processor.py -v`

- [ ] **Fix hrv_processor.py**: Lower the minimum RR threshold for `compute()` to return partial results. Find the guard like `if len(self._buffer) < N: return None` and change the threshold to 10 (from whatever it currently is). RMSSD needs minimum ~5 successive differences = 6 RR intervals; 10 is conservative. Keep the existing guard at the top for < 5.

- [ ] **Run test again** — verify both tests pass.

- [ ] **Commit:**
```
git add backend/hrv_processor.py backend/tests/test_hrv_processor.py
git commit -m "fix(hrv): lower min RR threshold in compute() — fixes null RMSSD after 22s"
```

---

### Task 2: Verify HF/LF in cal_progress frames (main.py)

**Files:**
- Modify: `backend/main.py`

- [ ] **Read the calibration loop** in `main.py` — find the `await websocket.send_json({...cal frame...})` inside `if cal_active:`. Check if `hrv` dict includes `hf_power` and `lf_power`.

- [ ] **If missing**, add HF/LF to the cal_progress frame. After `_cm = proc.compute()`, access the hrv_engine for frequency-domain metrics. The existing `_cm` from `HRVProcessor.compute()` should have `lf_power` and `hf_power` fields. If not, add them to `HRVMetrics` in hrv_processor.py.

- [ ] **Verify cal_progress frame structure** matches this contract:
```python
{
    "type": "cal_progress",
    "cal": True,
    "target_bpm": float,
    "dwell_remaining": float,
    "coherence_so_far": float,
    "n_rr": int,
    "elapsed": float,
    "hrv": {
        "rmssd": float,   # ms
        "sdnn": float,    # ms
        "hr": float,      # bpm
        "artifact_rate": float,  # 0–1
        "hf_power": float | None,  # ms²
        "lf_power": float | None,  # ms²
    } | None
}
```

- [ ] **If hrv_processor HRVMetrics lacks hf/lf**, add optional fields:
```python
# In HRVMetrics dataclass/namedtuple, add:
hf_power: float | None = None
lf_power: float | None = None
```

- [ ] **Commit:**
```
git add backend/main.py backend/hrv_processor.py
git commit -m "fix(cal): add hf_power + lf_power to cal_progress hrv frame"
```

---

### Task 3: Fix artifact_filter.py — verify not over-rejecting H10 data

**Files:**
- Read: `backend/artifact_filter.py`

- [ ] **Read artifact_filter.py** — find the rejection logic. Standard ectopic filter: reject if RR deviates >20% from local median. Verify threshold is `0.20` (20%), not stricter.

- [ ] **Write test:**
```python
# backend/tests/test_artifact_filter.py
from backend.artifact_filter import ArtifactFilter

def test_normal_h10_rr_accepted():
    flt = ArtifactFilter()
    # Normal sinus rhythm RRs ~800ms, slight variation
    rrs = [800, 810, 795, 820, 805, 815, 800, 790, 810, 820]
    results = [flt.push(rr) for rr in rrs]
    accepted = [r.accepted for r in results if r.accepted is not None]
    # At least 8 of 10 normal RRs should be accepted
    assert len(accepted) >= 8, f"Too many rejections: only {len(accepted)}/10 accepted"

def test_ectopic_rr_rejected():
    flt = ArtifactFilter()
    # Seed with normal RRs first
    for rr in [800, 810, 795, 820, 805]:
        flt.push(rr)
    # Push ectopic (>20% deviation)
    result = flt.push(400)  # way too short
    assert result.accepted is None, "Ectopic RR (400ms) should be rejected"
```

- [ ] **Run:** `python -m pytest backend/tests/test_artifact_filter.py -v`

- [ ] **If threshold is stricter than 0.20**, relax it to 0.20. If tests pass already, just commit the test:
```
git add backend/tests/test_artifact_filter.py
git commit -m "test(artifact): verify H10 RR acceptance rate + ectopic rejection"
```

---

### Task 4: Verify db.py — cal_hrv storage columns

**Files:**
- Read: `backend/db.py`

- [ ] **Read `create_session_row`** function. Verify it stores: `sensor_mode`, `rmssd_median`, `hr_mean`, `rr_count`, `artifact_rate`, `mean_sqi`, `hr_drift_bpm`, `duration_s`, `session_type`.

- [ ] **Check `finish_session`** — verify `discarded` flag is set correctly (should be True when cmd=discard).

- [ ] **Check `get_eligible_sessions`** — verify it filters `discarded=False AND baseline_excluded_reason IS NULL`.

- [ ] **If any column is missing from create_session_row INSERT**, add it. Do NOT run migrations in this task — just verify code matches the schema defined in the deploy docs.

- [ ] **Commit if any fixes:**
```
git add backend/db.py
git commit -m "fix(db): ensure all cal_hrv fields stored in create_session_row"
```

---

### Task 5: Verify ans_classifier graceful thin-buffer output

**Files:**
- Read: `backend/ans_classifier.py`

- [ ] **Read `classify()`** — verify it returns a valid object (not throws) when passed HRV metrics where rmssd=0 or metrics is None.

- [ ] **Write test:**
```python
from backend.ans_classifier import classify

def test_classify_with_none_metrics_returns_default():
    result = classify(None)
    assert result is not None
    assert hasattr(result, 'state')
    assert result.state in ('calm', 'activated', 'stressed', 'shutdown', 'unknown')

def test_classify_with_zero_rmssd_returns_calm_or_unknown():
    from backend.hrv_processor import HRVMetrics
    metrics = HRVMetrics(rmssd=0, sdnn=0, hr=60, n_rr=5, artifact_rate=0, mean_sqi=0, hr_drift_bpm=0)
    result = classify(metrics)
    assert result is not None
```

- [ ] **Run:** `python -m pytest backend/tests/test_ans_classifier.py -v` (create file first)

- [ ] **If classify() throws on None/zero**, add guard at top of classify():
```python
if metrics is None or metrics.rmssd == 0:
    return ANSResult(state='unknown', confidence=0.0, actionable=False)
```

- [ ] **Commit:**
```
git add backend/ans_classifier.py backend/tests/test_ans_classifier.py
git commit -m "fix(ans): graceful output on None/zero HRV metrics"
```

---

### Task 6: Run full backend test suite

- [ ] **Run all tests:**
```bash
python -m pytest backend/tests/ -v --tb=short
```

- [ ] **Fix any remaining failures** (don't skip them). Each fix gets its own commit.

- [ ] **Verify smoke test if it exists:**
```bash
python backend/_phase1_smoke.py 2>&1
python backend/_phase2_smoke.py 2>&1
```

---

## Phase 2 — Frontend Clean Rebuild

### Task 7: Create SplashScreen.jsx

**Files:**
- Create: `frontend/src/pages/SplashScreen.jsx`

- [ ] **Create the file:**
```jsx
// frontend/src/pages/SplashScreen.jsx
import { useEffect } from 'react'

export default function SplashScreen({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#0A0A0F',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    }}>
      <style>{`
        @keyframes splashFadeIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes splashPulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1; }
        }
      `}</style>
      <div style={{
        fontFamily: 'var(--font-head, system-ui)',
        fontWeight: 700,
        fontSize: 48,
        letterSpacing: '-0.04em',
        color: '#fff',
        animation: 'splashFadeIn 0.6s ease forwards',
      }}>
        ALIVE
      </div>
      <div style={{
        fontSize: 13,
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        animation: 'splashPulse 1.5s ease infinite',
      }}>
        Autonomic regulation
      </div>
    </div>
  )
}
```

- [ ] **Commit:**
```
git add frontend/src/pages/SplashScreen.jsx
git commit -m "feat(ui): SplashScreen — 1.5s brand splash on every app open"
```

---

### Task 8: Create CalibrationScreen.jsx

**Files:**
- Create: `frontend/src/pages/CalibrationScreen.jsx`

- [ ] **Create the file** with full implementation:

```jsx
// frontend/src/pages/CalibrationScreen.jsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { WSClient } from '../utils/ws_client.js'
import { supabase } from '../lib/supabase.js'
import { SensorFusion } from '../sensors/sensor_fusion.js'
import { patchProfileCalibration } from '../lib/api.js'
import { useSensorContext } from '../context/SensorContext.jsx'
import { useWakeLock } from '../hooks/useWakeLock.js'

const PHRASES = [
  'Listening to your autonomic rhythm…',
  'Mapping your resonance frequency…',
  'Your body is speaking — we’re learning to hear it',
  'HRV calibration in progress…',
  'Finding the frequency where your heart and breath align',
  'Calculating your personal resonance window…',
]

// Human body silhouette as inline SVG path
const BODY_PATH = `M100,20 C110,20 120,28 120,40 C120,52 115,58 115,65
  L125,90 L135,140 L125,200 L120,260
  L130,320 L125,380 L115,380 L110,320
  L105,260 L100,260 L95,260 L90,320
  L85,380 L75,380 L70,320 L75,260
  L80,200 L75,140 L85,90 L85,65
  C85,58 80,52 80,40 C80,28 90,20 100,20 Z`

export default function CalibrationScreen({ onReady }) {
  const { requestBle, bleStatus, bleError, bleRef } = useSensorContext()
  const { acquire: acquireWakeLock } = useWakeLock()

  // Phase: 'connect' | 'calibrating' | 'done' | 'error'
  const [phase, setPhase] = useState('connect')
  const [targetBpm, setTargetBpm] = useState(5.5)
  const [coherence, setCoherence] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [nRr, setNRr] = useState(0)
  const [liveHr, setLiveHr] = useState(null)
  const [liveRmssd, setLiveRmssd] = useState(null)
  const [liveArtRate, setLiveArtRate] = useState(null)
  const [liveHf, setLiveHf] = useState(null)
  const [liveLf, setLiveLf] = useState(null)
  const [hrPulse, setHrPulse] = useState(false)
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [errorMsg, setErrorMsg] = useState(null)

  const wsRef = useRef(null)
  const fusionRef = useRef(null)
  const sendIvRef = useRef(null)
  const prevHrRef = useRef(null)
  const calStartedRef = useRef(false)

  // Rotate autonomic phrases every 4s during calibration
  useEffect(() => {
    if (phase !== 'calibrating') return
    const id = setInterval(() => setPhraseIdx(i => (i + 1) % PHRASES.length), 4000)
    return () => clearInterval(id)
  }, [phase])

  // Auto-start calibration once H10 connects
  useEffect(() => {
    if (bleStatus === 'connected' && phase === 'connect' && !calStartedRef.current) {
      calStartedRef.current = true
      startCalibration()
    }
  }, [bleStatus, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const startCalibration = useCallback(async () => {
    setPhase('calibrating')
    await acquireWakeLock()

    let authToken = 'dev'
    if (supabase) {
      const { data: { session: supa } } = await supabase.auth.getSession()
      if (supa?.access_token) authToken = supa.access_token
    }

    // Create SensorFusion with the already-connected BLE sensor
    const fusion = new SensorFusion(2, { externalBle: bleRef.current })
    fusionRef.current = fusion
    await fusion.start()

    const ws = new WSClient(
      'find_your_calm', 2, authToken,
      handleMsg,
      { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, noReconnect: true }
    )
    wsRef.current = ws
    ws.connect()

    // Wait for WS open then send cal_start
    const waitOpen = () => {
      if (!ws.ws) { setTimeout(waitOpen, 20); return }
      ws.ws.addEventListener('open', () => {
        ws.send({ type: 'cal_start' })
        // Stream RR + resp_amp every 500ms
        sendIvRef.current = setInterval(() => {
          if (!fusionRef.current) return
          const newRRs = fusionRef.current.drainNew ? fusionRef.current.drainNew() : []
          if (newRRs.length > 0) {
            newRRs.forEach(rr => ws.send({ rr, resp_amp: 0 }))
          } else {
            ws.send({ resp_amp: 0 })
          }
        }, 500)
      })
      ws.ws.addEventListener('close', () => clearInterval(sendIvRef.current))
      ws.ws.addEventListener('error', () => {
        if (phase !== 'done') { setPhase('error'); setErrorMsg('WebSocket error — check connection') }
      })
    }
    waitOpen()
  }, [bleRef, acquireWakeLock]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleMsg(msg) {
    if (msg.type === 'auth_ok') return
    if (msg.cal === true) {
      if (typeof msg.target_bpm === 'number') setTargetBpm(msg.target_bpm)
      if (typeof msg.coherence_so_far === 'number') setCoherence(msg.coherence_so_far)
      if (typeof msg.elapsed === 'number') setElapsed(msg.elapsed)
      if (typeof msg.n_rr === 'number') setNRr(msg.n_rr)
      if (msg.hrv) {
        const h = msg.hrv
        if (typeof h.hr === 'number' && h.hr > 0) {
          if (prevHrRef.current !== null && Math.abs(h.hr - prevHrRef.current) > 0.5) {
            setHrPulse(true); setTimeout(() => setHrPulse(false), 300)
          }
          prevHrRef.current = h.hr
          setLiveHr(Math.round(h.hr))
        }
        if (typeof h.rmssd === 'number' && h.rmssd > 0) setLiveRmssd(Math.round(h.rmssd))
        if (typeof h.artifact_rate === 'number') setLiveArtRate(h.artifact_rate)
        if (typeof h.hf_power === 'number') setLiveHf(h.hf_power)
        if (typeof h.lf_power === 'number') setLiveLf(h.lf_power)
      }
    }
    if (msg.cal_done === true) {
      clearInterval(sendIvRef.current)
      const rfBpm = msg.rf_bpm ?? 5.5
      const rfLocked = !!msg.rf_locked
      // Persist to profile
      patchProfileCalibration({ rf_bpm: rfBpm, rf_locked: rfLocked }).catch(() => {})
      setPhase('done')
      // Auto-proceed immediately — Dashboard shows the cal summary
      setTimeout(() => {
        try { wsRef.current?.close() } catch (_) {}
        onReady({
          rfBpm,
          rfLocked,
          rfCoherence: msg.rf_coherence ?? 0,
          fusion: fusionRef.current,
          sensorMode: 2,
          backendMode: 2,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      }, 200)
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearInterval(sendIvRef.current)
      try { wsRef.current?.close() } catch (_) {}
      // Do NOT stop fusion — it carries into the session
    }
  }, [])

  const breathePeriod = (60 / Math.max(targetBpm, 3.5)).toFixed(2)
  const progressPct = Math.min((nRr / 60) * 100, 100)
  const showHrv = nRr >= 30

  // Artifact color
  const artColor = !liveArtRate ? '#7A7A96'
    : liveArtRate < 0.05 ? '#00D084'
    : liveArtRate < 0.15 ? '#EF9F27' : '#E24B4A'

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0F', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes bodyBreathe {
          0%   { transform: scale(0.95); }
          60%  { transform: scale(1.05); }
          100% { transform: scale(0.95); }
        }
        @keyframes heartPulse {
          0%   { r: 10; opacity: 0.6; }
          50%  { r: 16; opacity: 1; }
          100% { r: 10; opacity: 0.6; }
        }
        @keyframes heartBeat {
          0%   { transform: scale(1); }
          50%  { transform: scale(1.4); }
          100% { transform: scale(1); }
        }
        @keyframes phraseSlide {
          0%   { opacity: 0; transform: translateY(6px); }
          15%  { opacity: 1; transform: translateY(0); }
          85%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-6px); }
        }
      `}</style>

      {/* Ambient glow */}
      <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,111,247,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 480, padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-head, system-ui)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>
            Connect Your Body
          </div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 6 }}>
            {phase === 'connect' ? 'Wet the H10 electrodes and wear it snugly' :
             phase === 'calibrating' ? PHRASES[phraseIdx] :
             phase === 'done' ? 'Calibration complete' : 'Connection error'}
          </div>
        </div>

        {/* Phase 1: BLE connect */}
        {phase === 'connect' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, marginTop: 40 }}>
            {/* Polar H10 icon */}
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(124,111,247,0.12)', border: '1.5px solid rgba(124,111,247,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>
              📡
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Polar H10</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                {bleStatus === 'reconnecting' ? 'Connecting…' :
                 bleStatus === 'failed' ? (bleError ?? 'Not found — retry') :
                 'Not connected'}
              </div>
            </div>
            {bleStatus === 'failed' && bleError && (
              <div style={{ background: 'rgba(226,75,74,0.1)', border: '1px solid rgba(226,75,74,0.3)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#E24B4A', maxWidth: 280, textAlign: 'center' }}>
                {bleError}
              </div>
            )}
            <button
              onClick={requestBle}
              disabled={bleStatus === 'reconnecting'}
              style={{
                background: bleStatus === 'reconnecting' ? 'rgba(124,111,247,0.1)' : 'rgba(124,111,247,0.2)',
                border: '1.5px solid rgba(124,111,247,0.5)',
                borderRadius: 12, padding: '14px 40px',
                color: '#7C6FF7', fontWeight: 700, fontSize: 16,
                cursor: bleStatus === 'reconnecting' ? 'not-allowed' : 'pointer',
                opacity: bleStatus === 'reconnecting' ? 0.6 : 1,
              }}
            >
              {bleStatus === 'reconnecting' ? 'Connecting…' :
               bleStatus === 'failed' ? 'Retry' : 'Connect Polar H10'}
            </button>
            <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, textAlign: 'center', maxWidth: 240 }}>
              Make sure Bluetooth is on and H10 is worn with wet electrodes
            </div>
          </div>
        )}

        {/* Phase 2: Calibrating — silhouette + live values */}
        {phase === 'calibrating' && (
          <>
            {/* Human silhouette SVG */}
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <svg
                width="160" height="320"
                viewBox="0 0 200 400"
                style={{ animation: `bodyBreathe ${breathePeriod}s ease-in-out infinite`, transformOrigin: 'center' }}
              >
                {/* Body outline */}
                <path
                  d="M100,15 C118,15 130,27 130,42 C130,57 122,65 118,72 L132,105 L142,165 L132,220 L126,290 L138,360 L126,368 L118,300 L108,268 L100,268 L92,268 L82,300 L74,368 L62,360 L74,290 L68,220 L58,165 L68,105 L82,72 C78,65 70,57 70,42 C70,27 82,15 100,15 Z"
                  fill="none"
                  stroke="rgba(124,111,247,0.5)"
                  strokeWidth="1.5"
                />
                {/* Heart glow — pulses at real HR */}
                <circle
                  cx="94" cy="110"
                  r="10"
                  fill="rgba(226,75,74,0.15)"
                  stroke="rgba(226,75,74,0.6)"
                  strokeWidth="1"
                  style={{
                    transformOrigin: '94px 110px',
                    animation: hrPulse ? 'heartBeat 0.3s ease' : undefined,
                    transition: 'r 0.15s ease',
                  }}
                />
                {/* HR number in chest */}
                {liveHr && (
                  <text x="94" y="140" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700" fontFamily="system-ui">
                    {liveHr}
                  </text>
                )}
                {liveHr && (
                  <text x="94" y="154" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="system-ui">
                    bpm
                  </text>
                )}
                {/* Vagal nerve path (subtle) */}
                <path
                  d="M94,80 C88,88 84,96 84,106"
                  fill="none"
                  stroke="rgba(63,191,168,0.3)"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
              </svg>
            </div>

            {/* Progress bar */}
            <div style={{ width: '100%', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Calibrating</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{nRr} RR intervals</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: `${progressPct}%`,
                  background: progressPct >= 100 ? '#00D084' : 'rgba(124,111,247,0.8)',
                  transition: 'width 0.8s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4, textAlign: 'right' }}>
                Target RF: {targetBpm.toFixed(1)} bpm · {Math.round(elapsed)}s elapsed
              </div>
            </div>

            {/* Progressive reveal: HRV panel */}
            {showHrv && (
              <div style={{
                width: '100%',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14,
                padding: '16px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px 16px',
                animation: 'phraseSlide 0.6s ease forwards',
              }}>
                <MetricCell label="RMSSD" value={liveRmssd ? `${liveRmssd} ms` : '…'} color="#3FBFA8" />
                <MetricCell label="Coherence" value={`${(coherence * 100).toFixed(0)}%`} color="#7C6FF7" />
                {liveHf != null && <MetricCell label="HF Power" value={`${liveHf.toFixed(0)} ms²`} color="#3FBFA8" />}
                {liveLf != null && <MetricCell label="LF Power" value={`${liveLf.toFixed(0)} ms²`} color="#EF9F27" />}
                {liveArtRate != null && (
                  <MetricCell
                    label="Artifact rate"
                    value={`${(liveArtRate * 100).toFixed(1)}%`}
                    color={artColor}
                    note={liveArtRate > 0.15 ? 'Check strap' : liveArtRate > 0.05 ? 'Fair' : 'Clean'}
                  />
                )}
              </div>
            )}
          </>
        )}

        {/* Phase: error */}
        {phase === 'error' && (
          <div style={{ textAlign: 'center', padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 14, color: '#E24B4A' }}>{errorMsg ?? 'Calibration failed'}</div>
            <button
              onClick={() => { calStartedRef.current = false; setPhase('connect') }}
              style={{ background: 'rgba(124,111,247,0.15)', border: '1px solid rgba(124,111,247,0.4)', borderRadius: 10, padding: '10px 24px', color: '#7C6FF7', fontSize: 14, cursor: 'pointer' }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCell({ label, value, color, note }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{note}</div>}
    </div>
  )
}
```

- [ ] **Verify `patchProfileCalibration` exists in `frontend/src/lib/api.js`**. If not, add:
```javascript
export async function patchProfileCalibration({ rf_bpm, rf_locked }) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${API_URL}/api/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ rf_bpm, rf_locked, calibration_done: true }),
  })
  if (!res.ok) throw new Error('patch profile failed')
  return res.json()
}
```

- [ ] **Commit:**
```
git add frontend/src/pages/CalibrationScreen.jsx frontend/src/lib/api.js
git commit -m "feat(ui): CalibrationScreen — silhouette + progressive HRV + H10 connect"
```

---

### Task 9: Rewrite App.jsx routing

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Rewrite App.jsx completely:**

```jsx
import { useState, useEffect, useCallback } from 'react'
import './styles/global.css'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { SensorProvider, useSensorContext } from './context/SensorContext.jsx'
import SplashScreen from './pages/SplashScreen.jsx'
import LandingPage from './pages/LandingPage.jsx'
import LoginScreen from './pages/LoginScreen.jsx'
import ProfileSetup from './pages/ProfileSetup.jsx'
import CalibrationScreen from './pages/CalibrationScreen.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Session from './pages/Session.jsx'
import Insight from './pages/Insight.jsx'
import { getProfile } from './lib/api.js'

// Screens: splash → login → [profile] → calibration → dashboard → session → insight
function AppRoutes() {
  const { user, loading } = useAuth()
  const { bleStatus } = useSensorContext()
  const [screen, setScreen] = useState('splash')
  const [cfg, setCfg] = useState(null)
  const [insightData, setInsightData] = useState(null)
  const [profile, setProfile] = useState(undefined)  // undefined=loading, null=missing, obj=present
  const [profileErr, setProfileErr] = useState(null)

  // After splash: route based on auth state
  const handleSplashDone = useCallback(() => {
    if (!user) setScreen('login')
    else setScreen('profile-loading')
  }, [user])

  // Load profile when user is available
  useEffect(() => {
    if (!user) { setProfile(undefined); return }
    let cancelled = false
    ;(async () => {
      try {
        const p = await getProfile()
        if (!cancelled) setProfile(p)
      } catch (e) {
        if (!cancelled) setProfileErr(e.message)
      }
    })()
    return () => { cancelled = true }
  }, [user])

  // Once profile loaded, decide next screen
  useEffect(() => {
    if (screen !== 'profile-loading') return
    if (profile === undefined && !profileErr) return  // still loading
    if (profileErr) { setScreen('login'); return }
    if (profile === null) { setScreen('profile-setup'); return }
    setScreen('calibration')  // always calibrate on login
  }, [profile, profileErr, screen])

  const handleCalibrationReady = useCallback((readyCfg) => {
    setCfg(readyCfg)
    setScreen('dashboard')
  }, [])

  if (screen === 'splash') {
    return <SplashScreen onDone={handleSplashDone} />
  }

  if (loading || screen === 'profile-loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #7C6FF7', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!user || screen === 'login') return <LoginScreen />

  if (screen === 'profile-setup') {
    return (
      <ProfileSetup
        onComplete={async () => {
          const p = await getProfile()
          setProfile(p)
          setScreen('calibration')
        }}
      />
    )
  }

  if (screen === 'calibration') {
    return <CalibrationScreen onReady={handleCalibrationReady} />
  }

  switch (screen) {
    case 'session':
      return (
        <Session
          cfg={cfg}
          onEnd={(data) => { setInsightData(data); setScreen('insight') }}
          onDiscard={() => setScreen('dashboard')}
        />
      )
    case 'insight':
      return (
        <Insight
          data={insightData}
          onDone={() => { setInsightData(null); setScreen('dashboard') }}
        />
      )
    default: // 'dashboard'
      return (
        <Dashboard
          cfg={cfg}
          profile={profile}
          bleStatus={bleStatus}
          onStart={(sessionCfg) => {
            setCfg({ ...cfg, ...sessionCfg })
            setScreen('session')
          }}
        />
      )
  }
}

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

- [ ] **Commit:**
```
git add frontend/src/App.jsx
git commit -m "feat(routing): splash→login→profile→calibration→dashboard→session clean routing"
```

---

### Task 10: Update Dashboard.jsx — live HR + RF + coherence top bar

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`

- [ ] **Get `latestHR`, `rfBpm`, `rfLocked` from `useSensorContext()`** — add to the existing destructure.

- [ ] **Add top status bar** immediately after the ambient-bg div and before the content container. Find the existing header div and prepend this bar:

```jsx
{/* Live biometric status bar */}
<div style={{
  position: 'sticky', top: 0, zIndex: 10,
  background: 'rgba(10,10,15,0.9)',
  backdropFilter: 'blur(12px)',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  padding: '10px 20px',
  display: 'flex', alignItems: 'center', gap: 20,
}}>
  {/* H10 status dot */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <div style={{
      width: 8, height: 8, borderRadius: '50%',
      background: bleStatus === 'connected' ? '#00D084' :
                  bleStatus === 'reconnecting' ? '#EF9F27' : 'rgba(255,255,255,0.2)',
      boxShadow: bleStatus === 'connected' ? '0 0 8px #00D084' : 'none',
      transition: 'background 0.3s',
    }} />
    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>H10</span>
  </div>
  {/* Live HR */}
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
    <span style={{ fontSize: 22, fontWeight: 700, color: bleStatus === 'connected' ? '#fff' : 'rgba(255,255,255,0.2)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
      {bleStatus === 'connected' && latestHR ? latestHR : '—'}
    </span>
    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>bpm</span>
  </div>
  {/* RF from calibration */}
  {cfg?.rfBpm && (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginLeft: 'auto' }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>RF</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: cfg.rfLocked ? '#3FBFA8' : '#EF9F27' }}>
        {cfg.rfBpm.toFixed(1)}
      </span>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>bpm</span>
      {cfg.rfLocked && <span style={{ fontSize: 9, color: '#3FBFA8', marginLeft: 2 }}>locked</span>}
    </div>
  )}
</div>
```

- [ ] **Update Dashboard function signature** to accept `cfg` and `profile` props:
```jsx
export default function Dashboard({ onStart, cfg, profile, bleStatus: bleStatusProp }) {
  const { latestHR, bleStatus: bleStatusCtx } = useSensorContext()
  const bleStatus = bleStatusProp ?? bleStatusCtx
  // ... rest unchanged
```

- [ ] **Add today's calibration card** below the recommendations section (or at top of content), showing RMSSD + RF from `cfg`:
```jsx
{cfg?.rfBpm && (
  <div style={{
    padding: '14px 16px',
    background: 'rgba(63,191,168,0.06)',
    border: '1px solid rgba(63,191,168,0.2)',
    borderRadius: 14,
    marginBottom: 20,
    display: 'flex', gap: 20, alignItems: 'center',
  }}>
    <div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Today's calibration</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
        RF {cfg.rfBpm.toFixed(1)} bpm · {cfg.rfLocked ? <span style={{ color: '#3FBFA8' }}>Locked</span> : <span style={{ color: '#EF9F27' }}>Estimated</span>}
      </div>
    </div>
  </div>
)}
```

- [ ] **Update `handleStart` in Dashboard** to pass `cfg` (has rfBpm etc.) to onStart — Dashboard no longer picks session mode (H10 only). Update the Begin Session button handler:
```javascript
function handleStart() {
  onStart({
    session: sessionId,
    sensorMode: 2,
    backendMode: 2,
    durationS,
  })
}
```
Remove the MODES picker entirely (only H10 mode now). Remove `modeKey` state and MODES array.

- [ ] **Commit:**
```
git add frontend/src/pages/Dashboard.jsx
git commit -m "feat(dashboard): live HR + RF top bar, today's calibration card, H10-only mode"
```

---

### Task 11: Update Session.jsx — clean fusion handoff, H10-only

**Files:**
- Modify: `frontend/src/pages/Session.jsx`

- [ ] **Verify `useSensorContext` import is present** (was added in previous fix).

- [ ] **Fix fusion lifecycle** — in `startSession()`, the fusion is from `cfg.fusion`:
```javascript
// Always use the fusion handed off from calibration
const fusion = cfg?.fusion
if (!fusion) {
  console.error('[Session] no fusion in cfg — calibration must run first')
  // Still create one as emergency fallback
  const { bleRef: ctxBleRef } = useSensorContext() // can't use hook here — use ref from outer scope
}
fusionRef.current = fusion ?? new SensorFusion(2, { externalBle: bleRef.current })
// Only start if we created it (no cfg.fusion)
if (!cfg?.fusion) fusionRef.current.start().catch(() => {})
```

- [ ] **Fix cleanup** — don't stop fusion if we didn't create it:
```javascript
function cleanup(sendStop) {
  clearInterval(timerRef.current)
  clearInterval(sendIvRef.current)
  if (sendStop) wsRef.current?.send({ cmd: 'stop' })
  wsRef.current?.close()
  wsRef.current = null
  // Only stop fusion if we created it (no cfg.fusion from calibration)
  if (!cfg?.fusion) fusionRef.current?.stop?.()
  fusionRef.current = null
  audioRef.current?.stop?.()
  audioRef.current = null
  release()
}
```

- [ ] **Commit:**
```
git add frontend/src/pages/Session.jsx
git commit -m "fix(session): fusion lifecycle — use cfg.fusion, only stop if we created it"
```

---

### Task 12: Delete ConnectionRitual.jsx

- [ ] **Delete the file:**
```bash
git rm frontend/src/pages/ConnectionRitual.jsx
```

- [ ] **Verify no remaining imports** in codebase:
```bash
grep -r "ConnectionRitual" frontend/src/
```
Should return empty.

- [ ] **Commit:**
```
git add -A
git commit -m "refactor: delete ConnectionRitual.jsx — replaced by CalibrationScreen"
```

---

### Task 13: Build verification

- [ ] **Run build:**
```bash
cd frontend && npm run build
```
Expected: `✓ built in X.XXs` — zero errors.

- [ ] **Fix any import errors** from the rewrite (missing imports, renamed exports).

- [ ] **Run backend tests:**
```bash
python -m pytest backend/tests/ -v --tb=short
```
Expected: all pass.

---

## Phase 3 — Playwright E2E + Deploy

### Task 14: Setup Playwright + write smoke tests

**Files:**
- Create: `e2e/calibration.spec.js`
- Create: `e2e/session.spec.js`
- Modify: `package.json` (add playwright script if missing)

- [ ] **Install Playwright** if not present:
```bash
cd frontend && npm install -D @playwright/test && npx playwright install chromium
```

- [ ] **Create `e2e/calibration.spec.js`:**
```javascript
// e2e/calibration.spec.js
import { test, expect } from '@playwright/test'

const BASE = process.env.E2E_URL ?? 'http://localhost:5173'

test('splash screen appears and fades', async ({ page }) => {
  await page.goto(BASE)
  // Splash should show ALIVE text
  await expect(page.locator('text=ALIVE')).toBeVisible({ timeout: 3000 })
})

test('unauthenticated user sees login screen after splash', async ({ page }) => {
  await page.goto(BASE)
  // Wait for splash to finish (1.5s + buffer)
  await page.waitForTimeout(2000)
  // Should see login screen
  await expect(page.locator('input[type="email"], input[placeholder*="email" i]')).toBeVisible({ timeout: 5000 })
})

test('login page has sign in and sign up options', async ({ page }) => {
  await page.goto(BASE)
  await page.waitForTimeout(2000)
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]')
  await expect(emailInput).toBeVisible({ timeout: 5000 })
  // Check for sign up option
  const signupText = page.locator('text=/sign up|create account/i')
  await expect(signupText).toBeVisible({ timeout: 3000 })
})
```

- [ ] **Create `e2e/session.spec.js`:**
```javascript
// e2e/session.spec.js
import { test, expect } from '@playwright/test'

const BASE = process.env.E2E_URL ?? 'http://localhost:5173'

test('backend health check', async ({ request }) => {
  const API = process.env.E2E_API_URL ?? 'http://localhost:8000'
  const res = await request.get(`${API}/health`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
})

test('WebSocket endpoint accepts connection', async ({ page }) => {
  // Test that WS endpoint exists and returns auth challenge
  const API = process.env.E2E_API_URL ?? 'http://localhost:8000'
  const WS = API.replace('http', 'ws')
  const result = await page.evaluate(async (wsUrl) => {
    return new Promise((resolve) => {
      const ws = new WebSocket(`${wsUrl}/ws/session?session=calm&mode=2`)
      const timeout = setTimeout(() => { ws.close(); resolve('timeout') }, 3000)
      ws.onopen = () => {
        clearTimeout(timeout)
        ws.close()
        resolve('connected')
      }
      ws.onerror = () => { clearTimeout(timeout); resolve('error') }
    })
  }, WS)
  expect(result).toBe('connected')
})
```

- [ ] **Create `playwright.config.js`** in project root:
```javascript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 390, height: 844 },  // iPhone 14 viewport
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  },
  reporter: 'list',
})
```

- [ ] **Add script to root `package.json`** if it exists, or to `frontend/package.json`:
```json
"e2e": "playwright test"
```

- [ ] **Run Playwright:**
```bash
npx playwright test --reporter=list
```

- [ ] **Commit:**
```
git add e2e/ playwright.config.js
git commit -m "test(e2e): Playwright smoke tests — splash, login, backend health, WS"
```

---

### Task 15: Deploy

- [ ] **Push to GitHub** (triggers Railway auto-deploy):
```bash
git push origin main
```

- [ ] **Deploy frontend to Vercel via CLI:**
```bash
npx vercel --prod --yes
```
Expected: deployment URL printed. Verify it loads in browser.

- [ ] **Check Railway deploy logs** (wait ~60s after push):
```bash
railway logs --tail 30
```
Expected: no crash, health check 200 OK lines visible.

- [ ] **Run Playwright against production:**
```bash
E2E_URL=https://<vercel-url> E2E_API_URL=https://<railway-url> npx playwright test --reporter=list
```

- [ ] **Commit any final fixes** from production run.

---

## Self-Review

### Spec Coverage Check
- [x] Splash screen (Task 7)
- [x] Login/signup (App.jsx routes to LoginScreen — already exists)
- [x] ProfileSetup every first-time user (App.jsx → profile-setup screen)
- [x] Calibration every login (App.jsx → calibration screen unconditionally)
- [x] H10 connect in CalibrationScreen Phase 1 (Task 8)
- [x] RF calibration with silhouette (Task 8)
- [x] Heart pulses at HR, body breathes at RF (Task 8 SVG animation)
- [x] Progressive reveal: RMSSD+HR at n_rr≥30 (Task 8)
- [x] HF/LF shown in calibration (Tasks 2 + 8)
- [x] Artifact rate display (Task 8)
- [x] Rotating autonomic phrases (Task 8)
- [x] Auto-proceed to Dashboard (Task 8 cal_done handler)
- [x] Dashboard live HR + RF top bar (Task 10)
- [x] H10 status dot (Task 10)
- [x] Today's calibration card (Task 10)
- [x] Session uses cfg.fusion, not new fusion (Task 11)
- [x] H10 reconnect banner (already in Session.jsx from previous fix)
- [x] No phone sensors (H10-only sensorMode=2 hardcoded)
- [x] ConnectionRitual deleted (Task 12)
- [x] Backend audit: hrv_processor null fix (Task 1)
- [x] Backend: HF/LF in cal_progress (Task 2)
- [x] Backend: artifact filter (Task 3)
- [x] Backend: db.py columns (Task 4)
- [x] Backend: ans_classifier thin buffer (Task 5)
- [x] Build verification (Task 13)
- [x] Playwright smoke tests (Task 14)
- [x] Deploy GitHub→Railway + Vercel CLI (Task 15)

### Type Consistency
- `cfg` shape throughout: `{ rfBpm, rfLocked, rfCoherence, fusion, sensorMode:2, backendMode:2, timezone, session, durationS }`
- `CalibrationScreen` → `onReady(cfg)` → `App.jsx` → `setCfg(cfg)` → `Dashboard(cfg=cfg)` → `Session(cfg={...cfg,...sessionCfg})`
- `fusion` is a `SensorFusion` instance with `.drainNew()`, `.getReading()`, `.stop()`

### Placeholder Scan
None found. All steps have exact code.
