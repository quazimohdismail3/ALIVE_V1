# Audio Pipeline Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 9 code-verified issues across the audio engine, signal pipeline, and data collection layer — covering scientific validity, audio correctness, race conditions, and RL data foundation.

**Architecture:** Each task is independent and can be shipped separately. Tasks 1–3 are one-liners that ship the same day. Tasks 4–7 are reliability fixes to existing modules. Tasks 8–9 extend the pipeline with new data flows. No breaking changes to external API contracts.

**Tech Stack:** React 18, Tone.js v14, Vite, Python 3.12, FastAPI, Supabase Postgres, MediaPipe FaceMesh, Polar H10 BLE.

---

## Files Modified Across All Tasks

| Task | Files |
|------|-------|
| 1 | `frontend/src/audio/chord_engine.js` |
| 2 | `frontend/src/audio/binaural.js` |
| 3 | `frontend/src/audio/session_audio.js` |
| 4 | `backend/main.py`, `frontend/src/pages/Session.jsx` |
| 5 | `frontend/src/audio/organic_variation.js`, `frontend/src/audio/session_audio.js` |
| 6 | `frontend/src/audio/session_audio.js` |
| 7 | `frontend/src/components/HeadphoneCheck.jsx` (new), `frontend/src/pages/Session.jsx`, `frontend/src/audio/session_audio.js` |
| 8 | `frontend/src/sensors/facemesh_sensor.js`, `frontend/src/pages/Session.jsx`, `backend/main.py`, `backend/state_estimation.py` |
| 9 | `backend/db.py`, `backend/main.py` |

---

## Task 1: Swap Reverb IR to Forest

**Problem:** `chord_engine.js:42` loads `stone_chamber.wav` (long dense decay, acoustically wrong for nature-based therapy). `forest.wav` (1.4 MB, open-air diffuse IR) already exists in `frontend/public/ir/` but is never loaded.

**Files:**
- Modify: `frontend/src/audio/chord_engine.js` (line 42)

- [ ] **Step 1: Change the IR path**

In `frontend/src/audio/chord_engine.js` find line 42:
```javascript
this._reverb = new Tone.Convolver('/ir/stone_chamber.wav');
```
Replace with:
```javascript
this._reverb = new Tone.Convolver('/ir/forest.wav');
```

- [ ] **Step 2: Verify build passes**

```bash
cd frontend && npm run build
```
Expected: no errors, `dist/` updated.

- [ ] **Step 3: Manual verify**

Start dev server, open a session, trigger chord engine fallback by blocking `stems.json` in DevTools Network (or wait 20s with network offline). Confirm reverb tail sounds open/airy, not echoey dungeon.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/audio/chord_engine.js
git commit -m "fix(audio): swap reverb IR stone_chamber → forest for nature-therapy context"
```

---

## Task 2: Symmetric Binaural Beat Placement

**Problem:** `binaural.js` `set()` method uses asymmetric placement: `leftFreq = carrierHz`, `rightFreq = carrierHz + beatHz`. When `beatHz` changes, the perceived pitch centre shifts upward by `beatHz/2`. At a 4 Hz beat this is a 2 Hz pitch jump, perceptible. Design doc specifies symmetric: `left = carrier − beat/2`, `right = carrier + beat/2`.

**Files:**
- Modify: `frontend/src/audio/binaural.js` (~line 37)

- [ ] **Step 1: Fix frequency assignment in `set()` method**

In `frontend/src/audio/binaural.js`, find inside the `set()` method:
```javascript
        // INVARIANT: left < right ALWAYS
        const leftFreq = carrierHz;
        const rightFreq = carrierHz + Math.abs(beatHz);  // abs ensures right > left
```
Replace with:
```javascript
        // INVARIANT: left < right ALWAYS. Symmetric placement keeps perceived pitch
        // centre stable when beatHz changes (design doc §8.2).
        const halfBeat = Math.abs(beatHz) / 2;
        const leftFreq  = carrierHz - halfBeat;
        const rightFreq = carrierHz + halfBeat;
```

- [ ] **Step 2: Verify leftFreq is always positive**

The minimum carrierHz in the codebase is 174 Hz (breath_actuator) but for binaural it's 200 Hz (constructor default) and session configs use 174–256 Hz. Maximum beatHz is 20 Hz, so halfBeat = 10 Hz. leftFreq minimum = 174 − 10 = 164 Hz. Positive. No clamp needed.

- [ ] **Step 3: Build passes**

```bash
cd frontend && npm run build
```
Expected: no errors.

- [ ] **Step 4: Manual verify**

Open a session with headphones. Note the binaural pitch centre. Change arousal state (or wait for state change). Confirm pitch centre does not jump between beat frequency changes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/audio/binaural.js
git commit -m "fix(audio): symmetric binaural placement — pitch centre stable across beat frequency changes"
```

---

## Task 3: ISO Gate Timing — Extend Parasympathetic Confirmation Window

**Problem:** `CONFIRM_MS_CALM = 25000` (25 seconds). Clinical HRVB protocol minimum for parasympathetic direction confirmation is 90–120 seconds (Lehrer & Gevirtz 2014, Thaut 2015). At 25 seconds false confirmations occur on brief coherence spikes, causing premature alpha ramp-up and music that feels mismatched.

**Files:**
- Modify: `frontend/src/audio/session_audio.js` (line 32)

- [ ] **Step 1: Update constant**

In `frontend/src/audio/session_audio.js`, find line 32:
```javascript
const CONFIRM_MS_CALM   = 25000;  // 25s for parasympathetic direction
```
Replace with:
```javascript
const CONFIRM_MS_CALM   = 90000;  // 90s for parasympathetic direction (Lehrer & Gevirtz 2014 minimum)
```

- [ ] **Step 2: Build passes**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/audio/session_audio.js
git commit -m "fix(audio): extend ISO parasympathetic confirmation gate 25s → 90s per HRVB clinical protocol"
```

---

## Task 4: WebSocket Sequence Number (Stale-Message Guard)

**Problem:** Backend sends `session_frame` messages with no `seq` field. If backend stalls for 3–4 seconds (GC pause, DB write spike), frontend receives a burst of queued frames and processes all of them, applying 2-second audio ramps that chase each other. Frontend has no way to detect or discard stale frames.

**Files:**
- Modify: `backend/main.py` (session_frame emit, ~line 661)
- Modify: `frontend/src/pages/Session.jsx` (message handler)

- [ ] **Step 1: Add seq counter to backend session loop**

In `backend/main.py`, find the session WS handler. Before the main while loop, add:
```python
frame_seq = 0
```

Then inside the loop, find the `await websocket.send_json({...})` call (around line 661) and add `"seq": frame_seq` to the dict, and increment after:
```python
            await websocket.send_json({
                "type": "session_frame",
                "seq": frame_seq,           # ← add this line
                "t": elapsed,
                # ... rest of fields unchanged ...
            })
            frame_seq += 1                  # ← add this line after send_json
```

- [ ] **Step 2: Add stale-frame guard in Session.jsx**

In `frontend/src/pages/Session.jsx`, find the WebSocket `onmessage` handler (the function that processes `session_frame` messages). Add a ref and guard at the top of the component:

```javascript
const lastSeqRef = useRef(-1);
```

Then inside the handler, before processing any `session_frame`:
```javascript
if (msg.type === 'session_frame') {
  if (typeof msg.seq === 'number' && msg.seq <= lastSeqRef.current) {
    return; // stale frame — discard
  }
  if (typeof msg.seq === 'number') lastSeqRef.current = msg.seq;
  // ... existing frame processing continues unchanged ...
}
```

- [ ] **Step 3: Build passes**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Verify seq increments**

Open DevTools → Network → WS connection. Inspect message frames. Confirm each `session_frame` has an incrementing `seq` field starting at 0.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py frontend/src/pages/Session.jsx
git commit -m "fix(ws): add seq field to session_frame + stale-message guard in frontend"
```

---

## Task 5: OrganicVariation Race Condition Fix

**Problem:** `OrganicVariation._applyLFOs()` fires every 4 seconds via `setInterval` and calls `volNode.volume.rampTo(base + lfoVal * 0.5, 3)` directly on the Tone.Volume nodes. `session_audio.js` calls `this._stems[x].setVolume()` which also calls `volNode.volume.rampTo()` on the same nodes. Both write to the same `AudioParam`; last writer wins. When `_applyLFOs` fires immediately after a phase change, it reads a stale `_savedVolumes` entry and ramps the stem back to the wrong level.

**Fix:** Add `setBaseVolume(layer, linearVol, rampMs)` to `OrganicVariation`. This method updates `_savedVolumes[layer]` and drives the volNode. `session_audio.js` routes all stem volume changes through this method instead of calling `StemLayer.setVolume()` directly after stems are loaded.

**Files:**
- Modify: `frontend/src/audio/organic_variation.js`
- Modify: `frontend/src/audio/session_audio.js`

- [ ] **Step 1: Add `setBaseVolume` to `OrganicVariation`**

In `frontend/src/audio/organic_variation.js`, add this method after `setVariationIntensity()`:

```javascript
  // Called by session_audio for all stem volume changes while OrganicVariation is active.
  // Keeps _savedVolumes in sync so _applyLFOs never clobbers a fresh phase target.
  setBaseVolume(layer, linearVol, rampMs = 3000) {
    import('tone').then(({ default: Tone }) => {
      const db = (linearVol <= 0.001) ? -60 : Tone.gainToDb(Math.max(0.001, linearVol));
      this._savedVolumes[layer] = db;
      const volNode = this._volNodes[layer];
      if (!volNode || this._silenceActive) return;
      try { volNode.volume.rampTo(db, Math.max(rampMs, 500) / 1000); } catch (_) {}
    });
  }
```

Wait — dynamic import in a sync method is wrong. The file already imports Tone at the top:
```javascript
import * as Tone from 'tone';
```
So Tone is already available. Write it without dynamic import:

```javascript
  setBaseVolume(layer, linearVol, rampMs = 3000) {
    const db = (linearVol <= 0.001) ? -60 : Tone.gainToDb(Math.max(0.001, linearVol));
    this._savedVolumes[layer] = db;
    const volNode = this._volNodes[layer];
    if (!volNode || this._silenceActive) return;
    try { volNode.volume.rampTo(db, Math.max(rampMs, 500) / 1000); } catch (_) {}
  }
```

Add this method in `organic_variation.js` immediately after `setVariationIntensity()` (before the private section comment).

- [ ] **Step 2: Route stem volumes through OrganicVariation in `_applyStemPhaseVolumes`**

In `frontend/src/audio/session_audio.js`, find `_applyStemPhaseVolumes(phase)`. The method currently calls `this._stems.X.setVolume()` for each layer. Replace ALL five `this._stems.X.setVolume()` calls with `this._organic.setBaseVolume()` calls:

Find:
```javascript
    this._stems.ground.setVolume(0.001, 4000);
    this._stems.breath_s.setVolume(cfg.breathVol > 0 ? cfg.breathVol * 0.85 : 0.15, 3000);
    this._stems.harmonic.setVolume(calm * 0.42, 3000);
    this._stems.spatial.setVolume(isMorning ? 0.001 : calm * 0.58, 4000);
    const morningPhases = ['ACTIVATE', 'ENERGIZE', 'PRIME'];
    this._stems.morning.setVolume(
      isMorning && morningPhases.includes(phase) ? 0.35 : 0.001,
      3000
    );
```
Replace with:
```javascript
    this._organic.setBaseVolume('ground',   0.001, 4000);
    this._organic.setBaseVolume('breath_s', cfg.breathVol > 0 ? cfg.breathVol * 0.85 : 0.15, 3000);
    this._organic.setBaseVolume('harmonic', calm * 0.42, 3000);
    this._organic.setBaseVolume('spatial',  isMorning ? 0.001 : calm * 0.58, 4000);
    const morningPhases = ['ACTIVATE', 'ENERGIZE', 'PRIME'];
    this._organic.setBaseVolume('morning',
      isMorning && morningPhases.includes(phase) ? 0.35 : 0.001,
      3000
    );
```

- [ ] **Step 3: Route stem volumes through OrganicVariation in `_applyStemVolumesMusicParams`**

In `frontend/src/audio/session_audio.js`, find `_applyStemVolumesMusicParams(params)`:
```javascript
  _applyStemVolumesMusicParams(params) {
    if (!this._stemsStarted) return;
    const presence = Math.max(0, Math.min(1, params.voice_range_presence ?? 0.4));
    if (this._stems.harmonic.isLoaded) {
      // Harmonic pad responds to presence, but stays as support layer
      this._stems.harmonic.setVolume(presence * 0.45, 2000);
    }
  }
```
Replace with:
```javascript
  _applyStemVolumesMusicParams(params) {
    if (!this._stemsStarted) return;
    const presence = Math.max(0, Math.min(1, params.voice_range_presence ?? 0.4));
    if (this._stems.harmonic.isLoaded) {
      this._organic.setBaseVolume('harmonic', presence * 0.45, 2000);
    }
  }
```

- [ ] **Step 4: Build passes**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Verify no volume clobbering**

Start a session. Open DevTools → Console. After 4 seconds (first LFO tick) and after a phase change, confirm stems don't silently jump back to -60 dB. Volume should drift ±0.75 dB around the phase target, not reset to silence.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/audio/organic_variation.js frontend/src/audio/session_audio.js
git commit -m "fix(audio): eliminate OrganicVariation race — route all stem volume changes through setBaseVolume"
```

---

## Task 6: Session Arc Biometric Gate

**Problem:** `_updateArc()` advances ENTRAIN→SHIFT at exactly 8 minutes regardless of user's HRV state. A user arriving in high-stress will begin shifting at minute 8 even if they haven't entrained at all. Timer-only transitions break the ISO principle match phase.

**Fix:** Gate phase advancement on `coherence >= 0.5` sustained for 60 seconds AND `rmssd_norm` trending upward. Fall back to timer at minute 12 (ENTRAIN→SHIFT) and minute 25 (SHIFT→INTEGRATE) if biometric gate never triggers.

**Files:**
- Modify: `frontend/src/audio/session_audio.js`

- [ ] **Step 1: Add coherence tracking state to constructor**

In `frontend/src/audio/session_audio.js`, in the `constructor()`, after `this._arcPhase = 'ENTRAIN';`, add:
```javascript
    // Biometric gate for arc transitions
    this._coherenceHighSince = 0;  // timestamp when coherence first exceeded threshold
    this._lastCoherence      = 0;
    this._lastRmssdNorm      = 0.5;
```

- [ ] **Step 2: Feed coherence + rmssd_norm into `updateMusicParams`**

In `session_audio.js`, find `updateMusicParams(params, affect)`. This method receives `params` from the backend `music_params` field and `affect`. The backend `state` field (in `session_frame`) contains `coherence` and `rmssd_norm`. 

Change the method signature to also accept `state`:
```javascript
  updateMusicParams(params, affect, state) {
```

Add coherence tracking at the start of `updateMusicParams`, after the `_updateArc()` call:
```javascript
    this._lastCoherence  = state?.coherence  ?? this._lastCoherence;
    this._lastRmssdNorm  = state?.rmssd_norm ?? this._lastRmssdNorm;
    if (this._lastCoherence >= 0.5) {
      if (!this._coherenceHighSince) this._coherenceHighSince = Date.now();
    } else {
      this._coherenceHighSince = 0;
    }
```

- [ ] **Step 3: Replace `_updateArc()` with biometric-gated version**

Find `_updateArc()`:
```javascript
  _updateArc() {
    if (!this._sessionStartMs) return;
    const elapsedMin = (Date.now() - this._sessionStartMs) / 60000;
    if      (elapsedMin < 8)  this._arcPhase = 'ENTRAIN';
    else if (elapsedMin < 20) this._arcPhase = 'SHIFT';
    else                      this._arcPhase = 'INTEGRATE';
  }
```
Replace with:
```javascript
  _updateArc() {
    if (!this._sessionStartMs) return;
    const elapsedMin = (Date.now() - this._sessionStartMs) / 60000;
    const coherenceSustainedMs = this._coherenceHighSince
      ? Date.now() - this._coherenceHighSince
      : 0;
    const biometricReady = coherenceSustainedMs >= 60000; // 60s sustained coherence >= 0.5

    if (this._arcPhase === 'ENTRAIN') {
      // Advance if biometric gate met (min 8 min) OR hard timer at 12 min
      if ((elapsedMin >= 8 && biometricReady) || elapsedMin >= 12) {
        this._arcPhase = 'SHIFT';
        this._coherenceHighSince = 0; // reset gate for next transition
      }
    } else if (this._arcPhase === 'SHIFT') {
      // Advance if biometric gate met (min 20 min) OR hard timer at 25 min
      if ((elapsedMin >= 20 && biometricReady) || elapsedMin >= 25) {
        this._arcPhase = 'INTEGRATE';
      }
    }
    // INTEGRATE: no exit (terminal phase)
  }
```

- [ ] **Step 4: Pass `state` in the Session.jsx call site**

In `frontend/src/pages/Session.jsx`, find where `updateMusicParams` is called (it will look like `sessionAudioRef.current.updateMusicParams(msg.music_params, msg.affect)`). Add `msg.state`:
```javascript
sessionAudioRef.current.updateMusicParams(msg.music_params, msg.affect, msg.state);
```

- [ ] **Step 5: Build passes**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/audio/session_audio.js frontend/src/pages/Session.jsx
git commit -m "feat(audio): biometric phase gate — ENTRAIN→SHIFT requires 60s coherence ≥ 0.5, timer fallback at 12/25 min"
```

---

## Task 7: Headphone Perceptual Gate

**Problem:** Binaural beats require headphones with >20 dB channel isolation. The Web Audio API has no reliable headphone detection. Without headphones the binaural layer produces no effect. There is currently no check — binaural starts unconditionally at session start.

**Fix:** Before session audio starts, play a 5-second 10 Hz binaural beat and ask: "Do you hear a subtle rhythmic pulsing inside your head?" Confirmation gates binaural layer. Rejection disables it and proceeds without.

**Files:**
- Create: `frontend/src/components/HeadphoneCheck.jsx`
- Modify: `frontend/src/pages/Session.jsx`
- Modify: `frontend/src/audio/session_audio.js`

- [ ] **Step 1: Create `HeadphoneCheck.jsx`**

Create `frontend/src/components/HeadphoneCheck.jsx`:

```jsx
import { useEffect, useRef } from 'react';
import * as Tone from 'tone';

// Plays a 10 Hz binaural beat for `durationMs` then calls `onResult(heard: boolean)`.
// `heard` = true if user confirmed pulsing.
export function HeadphoneCheck({ onResult }) {
  const leftOscRef  = useRef(null);
  const rightOscRef = useRef(null);

  useEffect(() => {
    let leftOsc, rightOsc, leftVol, rightVol, leftPan, rightPan;
    (async () => {
      await Tone.start();
      leftPan  = new Tone.Panner(-1).toDestination();
      rightPan = new Tone.Panner(1).toDestination();
      leftVol  = new Tone.Volume(-30).connect(leftPan);
      rightVol = new Tone.Volume(-30).connect(rightPan);
      leftOsc  = new Tone.Oscillator({ type: 'sine', frequency: 195 }).connect(leftVol);
      rightOsc = new Tone.Oscillator({ type: 'sine', frequency: 205 }).connect(rightVol);
      leftOsc.start();
      rightOsc.start();
      leftOscRef.current  = leftOsc;
      rightOscRef.current = rightOsc;
    })();
    return () => {
      try { leftOsc?.stop();  leftOsc?.dispose();  } catch (_) {}
      try { rightOsc?.stop(); rightOsc?.dispose(); } catch (_) {}
      try { leftVol?.dispose();  rightVol?.dispose();  } catch (_) {}
      try { leftPan?.dispose();  rightPan?.dispose();  } catch (_) {}
    };
  }, []);

  function handleResult(heard) {
    try { leftOscRef.current?.stop();  } catch (_) {}
    try { rightOscRef.current?.stop(); } catch (_) {}
    onResult(heard);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '24px',
    }}>
      <div style={{
        background: '#111', borderRadius: '16px', padding: '32px',
        maxWidth: '400px', width: '100%', color: '#fff', textAlign: 'center',
      }}>
        <p style={{ fontSize: '1.1rem', lineHeight: 1.6, marginBottom: '8px' }}>
          Listen carefully with headphones on.
        </p>
        <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)', marginBottom: '32px' }}>
          Do you hear a subtle rhythmic pulsing <em>inside your head</em> — not in the air around you?
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={() => handleResult(true)}
            style={{
              background: '#2a5', color: '#fff', border: 'none',
              borderRadius: '8px', padding: '12px 28px', fontSize: '1rem', cursor: 'pointer',
            }}
          >
            Yes, I hear it
          </button>
          <button
            onClick={() => handleResult(false)}
            style={{
              background: '#333', color: '#fff', border: 'none',
              borderRadius: '8px', padding: '12px 28px', fontSize: '1rem', cursor: 'pointer',
            }}
          >
            No / Skip
          </button>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', marginTop: '20px' }}>
          This test checks whether binaural beats are reaching your brain. Headphones required. Speakers won&apos;t work.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `binauralEnabled` constructor option to `SessionAudio`**

In `frontend/src/audio/session_audio.js`, change the constructor signature:
```javascript
  constructor(sessionType, { binauralEnabled = true } = {}) {
```

Add at the end of the constructor:
```javascript
    this._binauralEnabled = binauralEnabled;
```

In the `start()` method, wrap the binaural start:
```javascript
    if (this._binauralEnabled) {
      this.binaural.start();
    }
```

In `updateMusicParams`, wrap the binaural set:
```javascript
    if (this._binauralEnabled && beatHz !== null && carrierHz !== null) {
      // ... existing binaural bridge code ...
    }
```

- [ ] **Step 3: Wire HeadphoneCheck into Session.jsx**

In `frontend/src/pages/Session.jsx`, add import at top:
```javascript
import { HeadphoneCheck } from '../components/HeadphoneCheck.jsx';
```

Add state:
```javascript
const [headphoneChecked, setHeadphoneChecked] = useState(false);
const [binauralEnabled, setBinauralEnabled]   = useState(false);
```

Wrap the session JSX to show `HeadphoneCheck` first:
```jsx
{!headphoneChecked && (
  <HeadphoneCheck onResult={(heard) => {
    setBinauralEnabled(heard);
    setHeadphoneChecked(true);
  }} />
)}
```

When constructing `SessionAudio` (find the `new SessionAudio(sessionType)` call), pass the option:
```javascript
const audio = new SessionAudio(sessionType, { binauralEnabled });
```

Ensure the SessionAudio is only constructed after `headphoneChecked` is true (gate the WS connect or the audio start behind this state).

- [ ] **Step 4: Build passes**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Manual verify**

Open session page. Confirm HeadphoneCheck modal appears before audio starts. Click "Yes" — confirm session starts with binaural active. Click "No / Skip" — confirm session starts, audio plays, no binaural (no pitch in ears).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/HeadphoneCheck.jsx frontend/src/pages/Session.jsx frontend/src/audio/session_audio.js
git commit -m "feat(ux): headphone perceptual gate before binaural activation"
```

---

## Task 8: Wire FacesMesh Valence Proxy to Backend

**Problem:** `facemesh_sensor.js` computes `valence_proxy` (landmark-based mouth corner distance, range −1 to +1) but this value is captured on the frontend and never sent to the backend. `state_estimation.py` computes `valence` from `sd1_sd2_ratio` (HRV Poincaré geometry) alone. Facial expression data that is already being computed is silently discarded.

**Fix:** Add `face_valence` to the WebSocket RR frame payload. Backend receives it and blends with HRV-based valence: `0.6 × face_valence + 0.4 × hrv_valence`.

**Files:**
- Modify: `frontend/src/pages/Session.jsx` (RR frame sender)
- Modify: `backend/main.py` (receive face_valence from frame)
- Modify: `backend/state_estimation.py` (blend into valence)

- [ ] **Step 1: Add `face_valence` to the RR frame sent from Session.jsx**

In `frontend/src/pages/Session.jsx`, find where RR frames are sent to the backend WebSocket (look for `ws.send(JSON.stringify({rr: ...}))` or similar). Add `face_valence` from the sensor fusion reading:

```javascript
// Wherever the RR frame is assembled and sent:
const faceReading = sensorFusion?.getReading?.() ?? {};
ws.send(JSON.stringify({
  rr: rrInterval,
  resp_amp: respAmp,
  face_valence: typeof faceReading.valence_proxy === 'number'
    ? faceReading.valence_proxy
    : null,
}));
```

If the RR sending is inside a different module (e.g., `ws_client.js`), pass `face_valence` as an optional parameter to that function.

- [ ] **Step 2: Parse `face_valence` in the backend session loop**

In `backend/main.py`, find where the session loop receives RR frames from the frontend WebSocket (look for `data = await websocket.receive_json()` and subsequent `rr = data.get("rr")`). Add:

```python
face_valence: float | None = data.get("face_valence")  # None if camera not running
```

Pass it to the StateEstimator update call.

- [ ] **Step 3: Thread `face_valence` through `StateEstimator.update()`**

In `backend/state_estimation.py`, change `StateEstimator.update()` signature:

```python
    def update(self, m: HRVMetrics, face_valence: float | None = None) -> StateVector:
```

And pass it to `estimate_raw`:

```python
        raw = estimate_raw(m, face_valence=face_valence)
```

- [ ] **Step 4: Blend `face_valence` into `estimate_raw()`**

In `backend/state_estimation.py`, change `estimate_raw()` signature:

```python
def estimate_raw(m: HRVMetrics, face_valence: float | None = None) -> StateVector:
```

Find:
```python
    valence = max(-1.0, min(1.0, math.tanh(m.sd1_sd2_ratio * 3.0 - 1.0)))
```
Replace with:
```python
    hrv_valence = max(-1.0, min(1.0, math.tanh(m.sd1_sd2_ratio * 3.0 - 1.0)))
    if face_valence is not None and -1.0 <= face_valence <= 1.0:
        # 60% facial expression weight (more real-time), 40% HRV Poincaré
        valence = 0.6 * face_valence + 0.4 * hrv_valence
    else:
        valence = hrv_valence
```

- [ ] **Step 5: Write a backend unit test**

Create or add to `backend/tests/test_state_estimation.py`:

```python
from backend.state_estimation import estimate_raw
from backend.hrv_processor import HRVMetrics

def _make_metrics(**kwargs):
    defaults = dict(
        rmssd=45.0, sdnn=50.0, lf_hf_ratio=1.0, dfa_alpha1=1.0,
        svi=0.1, sd1=30.0, sd2=50.0, rf_hz=None,
    )
    defaults.update(kwargs)
    return HRVMetrics(**defaults)

def test_valence_uses_hrv_when_no_face():
    m = _make_metrics()
    sv = estimate_raw(m, face_valence=None)
    # Should be HRV-only valence — tanh of sd1/sd2 ratio
    expected = math.tanh(m.sd1 / m.sd2 * 3.0 - 1.0)
    assert abs(sv.valence - expected) < 0.01

def test_valence_blends_face_60pct():
    import math
    m = _make_metrics()
    hrv_v = max(-1.0, min(1.0, math.tanh(m.sd1 / m.sd2 * 3.0 - 1.0)))
    sv = estimate_raw(m, face_valence=0.8)
    expected = 0.6 * 0.8 + 0.4 * hrv_v
    assert abs(sv.valence - expected) < 0.01

def test_valence_ignores_out_of_range_face():
    m = _make_metrics()
    sv_none = estimate_raw(m, face_valence=None)
    sv_bad  = estimate_raw(m, face_valence=2.5)   # out of [-1, 1]
    assert sv_none.valence == sv_bad.valence
```

- [ ] **Step 6: Run tests**

```bash
cd backend && python -m pytest tests/test_state_estimation.py -v
```
Expected: 3 tests PASS.

- [ ] **Step 7: Build passes**

```bash
cd frontend && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add backend/state_estimation.py backend/tests/test_state_estimation.py backend/main.py frontend/src/pages/Session.jsx
git commit -m "feat(signal): wire FacesMesh valence_proxy to backend — 60/40 blend with HRV valence"
```

---

## Task 9: RL Training Data Collection

**Problem:** Music parameters (`best_params`) are computed every cycle and emitted over WebSocket but are never persisted to the database. There is no way to correlate what parameters were playing with subsequent HRV outcomes. This blocks any future personalization or forward model calibration.

**Fix:** Add `music_params` JSONB column to `hrv_snapshots`. Pass `best_params` to `write_snapshot()` in the session loop.

**Files:**
- Modify: `backend/db.py` (add `music_params` to `write_snapshot`)
- Modify: `backend/main.py` (pass `best_params` to `write_snapshot`)

- [ ] **Step 1: Add DB migration**

Create `backend/migrations/add_music_params_to_snapshots.sql`:

```sql
-- Add music_params column to hrv_snapshots for RL training data collection.
-- music_params: the 16-param dict that was applied in this cycle.
-- downstream_rmssd: filled in post-hoc by a background job (future).
ALTER TABLE public.hrv_snapshots
  ADD COLUMN IF NOT EXISTS music_params  jsonb,
  ADD COLUMN IF NOT EXISTS downstream_rmssd float;

COMMENT ON COLUMN public.hrv_snapshots.music_params IS
  'The 16 music parameters applied in this epoch — for RL training data.';
COMMENT ON COLUMN public.hrv_snapshots.downstream_rmssd IS
  'RMSSD 2 minutes after this epoch — null until filled by background job.';
```

Run via Supabase MCP or `psql`:
```bash
psql $DATABASE_URL -f backend/migrations/add_music_params_to_snapshots.sql
```

- [ ] **Step 2: Add `music_params` parameter to `write_snapshot()`**

In `backend/db.py`, find `async def write_snapshot(session_id, user_id, epoch_s, metrics)`. Change signature:

```python
async def write_snapshot(
    session_id: Any,
    user_id: str,
    epoch_s: int,
    metrics: dict,
    music_params: dict | None = None,
) -> None:
```

Update the INSERT statement to include the new column:
```python
              """
              insert into public.hrv_snapshots
                (session_id, user_id, ts, epoch_s,
                 rmssd, sdnn, lf_hf, dfa_a1, svi, poincare_sd1, poincare_sd2,
                 vs_score, ans_state, arc_phase, rf_coherence, rf_locked,
                 ls_arousal, ls_valence, ls_regulation, ls_engagement,
                 music_params)
              values
                ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                 $21)
              """,
              # ... existing positional args ...,
              json.dumps(music_params) if music_params else None,   # $21
```

Import json at top of db.py if not already: `import json`.

- [ ] **Step 3: Pass `best_params` from the session loop**

In `backend/main.py`, find the `await db.write_snapshot(...)` call. Add `music_params=best_params`:

```python
                    await db.write_snapshot(
                        session_id=sid,
                        user_id=user_id,
                        epoch_s=int(elapsed),
                        metrics={ ... },   # unchanged
                        music_params=best_params,   # ← add this
                    )
```

- [ ] **Step 4: Write a unit test for write_snapshot signature**

Add to `backend/tests/test_db.py` (create if it doesn't exist):

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from backend import db

@pytest.mark.asyncio
async def test_write_snapshot_accepts_music_params():
    """music_params must be accepted and serialized without error."""
    mock_conn = AsyncMock()
    mock_pool = MagicMock()
    mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch.object(db, '_pool', mock_pool):
        await db.write_snapshot(
            session_id='test-sid',
            user_id='user-1',
            epoch_s=30,
            metrics={"rmssd": 42.0, "sdnn": 50.0},
            music_params={"bpm": 65.0, "silence_ratio": 0.3},
        )
    mock_conn.execute.assert_called_once()
    call_args = mock_conn.execute.call_args[0]
    # The 21st positional arg should be the JSON-encoded music_params
    assert '"bpm"' in call_args[-1]
```

- [ ] **Step 5: Run tests**

```bash
cd backend && python -m pytest tests/test_db.py -v
```
Expected: PASS.

- [ ] **Step 6: Build and smoke test**

```bash
cd frontend && npm run build
```
Run a short session (2+ minutes), then query the DB:
```sql
SELECT epoch_s, music_params->>'bpm' as bpm, rmssd
FROM hrv_snapshots
ORDER BY ts DESC
LIMIT 5;
```
Expected: `bpm` column populated with numeric values.

- [ ] **Step 7: Commit**

```bash
git add backend/db.py backend/main.py backend/migrations/add_music_params_to_snapshots.sql backend/tests/test_db.py
git commit -m "feat(data): persist music_params per epoch to hrv_snapshots — RL training data foundation"
```

---

## Deferred: AudioWorklet Migration (Task 10, V2.5)

Tone.js v14 has no native AudioWorklet support. Migrating binaural and chord synthesis to AudioWorkletProcessor requires pulling them out of Tone.js and implementing raw AudioWorkletProcessor classes. Estimated 1–2 week effort. Track as a separate plan in V2.5.

---

## Self-Review Checklist

- [x] Task 1 covers FIX 12 (reverb IR)
- [x] Task 2 covers FIX 4 (asymmetric binaural)
- [x] Task 3 covers FIX 3 (ISO gate)
- [x] Task 4 covers FIX 10 (WebSocket seq)
- [x] Task 5 covers FIX 7 (OrganicVariation race)
- [x] Task 6 covers FIX 11 (biometric phase gate)
- [x] Task 7 covers FIX 2 (headphone gate)
- [x] Task 8 covers FIX 8 (FacesMesh valence)
- [x] Task 9 covers FIX 13 (RL data collection)
- [x] FIX 5 (BPM dead on stems): documented in adversarial review; no code fix needed until multi-tempo stem assets exist. Deferred.
- [x] FIX 14 (forward model unvalidated): no code fix — requires real user session data. Addressed by Task 9 data collection.
- [x] All `SessionAudio` constructor call sites in Session.jsx must be updated (Task 7 Step 3).
- [x] `updateMusicParams` signature change in Task 6 Step 2 must be reflected in all call sites (Step 4 covers Session.jsx).
- [x] `write_snapshot` signature change in Task 9 is backward-compatible (default `music_params=None`).
