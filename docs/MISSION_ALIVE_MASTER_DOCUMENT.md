# MISSION ALIVE — THE COMPLETE DOCUMENT
### Everything about what we're building, how it works, and where it goes
### Last updated: 2026-05-05 | Version: V1.0 shipped, V2 in progress

---

> **How to use this document:**
> Read it top to bottom once. Then use the section headers as a reference.
> Every major piece of the system is explained — what it is, why it exists,
> how it connects to everything else, and what it does wrong right now.

---

## PART 1: WHAT ARE WE BUILDING?

### The one-sentence version

Mission Alive is a biofeedback app that measures your nervous system in real-time and plays music specifically designed, second-by-second, to move you toward calm.

### The longer version

Most wellness apps play "calming music" and hope for the best. This app does something different: it **measures** your nervous system state (via heart rate variability), **classifies** what state you're in (anxious, calm, shutdown, etc.), then uses a control algorithm — the same kind used in aerospace engineering — to **choose** exactly which music parameters will most effectively move your nervous system toward the target state.

The music isn't pre-composed. It's **synthesized in real-time** from 16 parameters (tempo, warmth, binaural beat frequency, silence ratio, etc.) that the backend is updating every second based on your physiology.

This is a genuine closed-loop biofeedback system. The loop is:

```
Your heart → RR intervals → HRV metrics → nervous system state
→ distance from target → music parameters → sound → your ears
→ physiological change → your heart (loop repeats every 1 second)
```

### The science behind it

**Heart Rate Variability (HRV):** Your heart doesn't beat at perfectly regular intervals. The variation in timing between heartbeats (measured in milliseconds) is a direct readout of your autonomic nervous system. High variation = healthy, parasympathetic, calm. Low variation = stressed, fatigued, sympathetic dominance.

**Polyvagal Theory (Stephen Porges, 1994):** The autonomic nervous system has three states, not two:
1. **Ventral Vagal** — safe and connected. Social, present, calm.
2. **Sympathetic** — mobilized. Fight/flight/focus (can be healthy or stressed).
3. **Dorsal Vagal** — shutdown/freeze. Numb, collapsed, dissociated.

The app detects which state you're in and plays music to guide you toward the appropriate goal.

**Resonance Frequency (RF):** Every person has a personal breathing rate (usually 4–7 breaths/minute, much slower than the normal 12–20) at which their heart rate and breathing synchronize perfectly — a state called HRV coherence. Breathing at your RF maximizes vagal tone, reduces cortisol, and produces a subjective sense of deep calm. The app finds YOUR frequency during the calibration phase, because it varies by 1–2 bpm between people.

---

## PART 2: THE TECHNOLOGY STACK

### What technology runs where

```
User's Phone (browser)                 Your Laptop / Cloud
┌─────────────────────┐               ┌──────────────────────┐
│                     │               │                      │
│   React app         │◄─WebSocket───►│   Python/FastAPI     │
│   (Vite + JSX)      │               │   backend            │
│                     │               │                      │
│   Sensors:          │               │   HRV math           │
│   - Rear camera     │               │   ANS classifier     │
│   - Bluetooth H10   │               │   MPC optimizer      │
│   - Microphone      │               │   Music engine       │
│   - Front camera    │               │   Safety layer       │
│                     │               │                      │
│   Audio:            │               │   Writes to:         │
│   Tone.js synth     │               │   Supabase Postgres  │
│                     │               │                      │
└─────────────────────┘               └──────────────────────┘

Hosted:                                Hosted:
Vercel (CDN, global)                  Railway (persistent server)
                                       Supabase (database + auth)
```

### Why each technology was chosen

**FastAPI (Python)** — The HRV math (RMSSD, DFA, MPC) is most naturally written in Python with NumPy/SciPy. FastAPI gives us HTTP + WebSocket in one server with very low overhead.

**React (Vite)** — Fast development, component reuse, the whole industry knows it. Vite makes local development with HTTPS easy (required for Bluetooth and camera).

**WebSocket** — Not HTTP. The session loop sends data every 500ms and receives frames every 1 second for 10 minutes. HTTP request/response would add unnecessary overhead and latency. WebSocket is a persistent phone-call-style connection.

**Supabase** — Auth + Postgres in one service. Row Level Security means users can never see each other's data, even if the client key is public. We don't have to build login from scratch.

**Tone.js** — Browser-native audio synthesis. Generates the therapeutic music directly on the phone using Web Audio API. No MP3 files to download. No latency from a server. Parameters update in 2-second smooth ramps.

**Railway** — WebSockets need a real persistent server, not serverless functions (which terminate after each request). Railway runs a real Python process continuously, giving HTTPS automatically.

**Vercel** — The frontend is just static files (HTML/CSS/JS) after compilation. Vercel serves these from a global CDN, so the page loads fast anywhere.

---

## PART 3: THE FULL PIPELINE — HOW DATA FLOWS

This is the most important thing to understand. Every piece of code in this project exists to serve one of these stages.

```
POLAR H10 / PHONE CAMERA / MICROPHONE
         │
         │  Raw electrical signal / light / audio
         ▼
   SENSOR LAYER (frontend/src/sensors/)
         │
         │  RR intervals (milliseconds between heartbeats)
         │  Respiratory amplitude (0-1)
         ▼
   ARTIFACT FILTER (backend/artifact_filter.py)
         │
         │  Cleaned RR intervals (ectopic beats rejected)
         ▼
   HRV PROCESSOR (backend/hrv_processor.py)
         │
         │  RMSSD, SDNN, HR, DFA alpha1, SVI, SD1, SD2
         │  + rf_hz (breathing rate extracted from RR via RSA)
         ▼
   STATE ESTIMATION (backend/state_estimation.py)
         │
         │  7D autonomic vector: [arousal, valence, stability,
         │  coherence, autonomic_balance, recovery_rate, rf_hz]
         ▼
   ANS CLASSIFIER (backend/ans_classifier.py)
         │
         │  Polyvagal state + RF confidence tag:
         │  "ventral_vagal" + RESONANT / PARASYMPATHETIC /
         │  ENTRAINING / DYSREGULATED
         ▼
   AFFECT CLASSIFIER (backend/affect_classifier.py)
         │
         │  Emotion quadrant: arousal × valence
         ▼
   VS SCORE ENGINE (backend/vs_score.py)
         │
         │  Composite 0-100 score
         ▼
   SESSION MANAGER (backend/session_manager.py)
         │
         │  Current arc phase (ACKNOWLEDGE/SLOW/ANCHOR/RELEASE)
         ▼
   SAFETY SUPERVISOR (backend/safety.py)
         │
         │  Is it safe to proceed? Or activate fallback?
         ▼
   MPC OPTIMIZER (backend/mpc_optimizer.py)
    + FORWARD MODEL (backend/forward_model.py)
         │
         │  16 music parameters (the "recipe" for the next sound)
         ▼
   MUSIC ENGINE (backend/music_engine.py)
         │  (validates + structures the params)
         ▼
   WEBSOCKET → FRONTEND
         │
         ▼
   TONE.JS AUDIO SYNTHESIS (frontend/src/audio/session_audio.js)
         │
         ▼
   SOUND → USER'S EARS
         │
         ▼  (physiology changes)
   BACK TO SENSOR LAYER  ◄─────────────────────────────────┘
```

Every second, this entire chain runs. The backend does the math; the frontend makes the sound and shows the display.

---

## PART 4: EVERY FILE AND WHY IT EXISTS

### BACKEND (Python, runs on Railway)

#### `backend/main.py` — The front door
The FastAPI application entry point. Sets up:
- CORS (allows the browser to talk to this server from any origin)
- WebSocket handler at `/ws/session` — this is where the session loop lives
- HTTP routes: `POST /api/session/end`, `GET /health`
- Routers: delegates to `backend/api/` for profile and baseline endpoints

The WebSocket handler receives the JWT token in the first message, validates it via `auth.py`, then runs the entire pipeline loop for as long as the connection is open.

**Why WebSocket here specifically:** The session needs a 10-minute continuous bidirectional channel. WebSocket is the only browser technology that does this efficiently.

#### `backend/auth.py` — Identity verification
Takes the JWT (JSON Web Token) that Supabase issued to the user when they logged in, and verifies it is genuine. Extracts the user's UUID from the token. All data written to the database uses this UUID, guaranteeing data isolation.

The JWT is signed with a secret key that only Supabase has. The backend checks the signature. You cannot fake it.

**Known issue in history:** At one point, the `SUPABASE_JWT_SECRET` environment variable was accidentally set to the service key instead of the HS256 signing secret — this broke auth for several sessions. Fixed.

#### `backend/artifact_filter.py` — Noise rejection
Not every heartbeat the sensor records is real. Ectopic beats (premature contractions), sensor disconnects, and motion artifacts all produce false RR intervals. This module rejects any RR interval that is >20% different from the local median of the last several beats.

**Why this matters:** HRV metrics computed from contaminated data are garbage. The forward model and MPC optimizer can only work correctly if the input is clean. Garbage in, garbage out — and in a safety-sensitive application, garbage out means playing wrong music for a stressed nervous system.

#### `backend/hrv_processor.py` — The math engine
Takes the cleaned RR intervals and computes:
- **RMSSD**: Root Mean Square of Successive Differences. The #1 most clinically validated HRV metric. High = parasympathetic, low = sympathetic.
- **SDNN**: Standard deviation of all intervals. Overall HRV.
- **SD1/SD2**: Poincaré plot metrics. SD1 = short-term variability, SD2 = long-term.
- **DFA alpha1**: Detrended Fluctuation Analysis. Measures fractal complexity of the heart signal. ~1.0 is healthy. <0.75 is dangerous overload.
- **SVI**: Sympathovagal Variability Index. Catches slow drift that RMSSD misses.
- **HR**: Current heart rate in BPM.
- **rf_hz**: Actual breathing rate in Hz, extracted from RR series via Respiratory Sinus Arrhythmia (delegates to `rf_engine.py`). Returns `None` until 30s of clean data.

Requires a minimum data window:
- RMSSD: 2 minutes minimum
- DFA: 5 minutes minimum
- rf_hz: 30s minimum (session), 90s minimum (calibration)

Before these windows are filled, the backend uses conservative defaults.

#### `backend/rf_engine.py` — Breathing rate from the heartbeat alone *(spec: 2026-05-06)*
Extracts the user's current respiratory frequency from RR intervals using Welch Power Spectral Density. Works because breathing modulates heart rate rhythmically via Respiratory Sinus Arrhythmia — the RR series encodes the breathing oscillation. Finds peak in 0.07–0.40 Hz band (4.5–24 BPM).

Two outputs:
- `compute_rf()` → actual breathing rate in Hz for live session tracking and MPC state
- `as_resp_signal()` → synthetic respiratory signal, used as fallback input to `rf_calibration.py` when H10 accelerometer is unavailable (current Mode 2 gap)

Scientific basis: RR-derived RF correlates r=0.85 with gold-standard gas exchange at rest on Polar H10. No extra hardware beyond the H10 already in use.

#### `backend/state_estimation.py` — 6-dimensional nervous system model
Maps the HRV metrics to a 6-dimensional vector describing the person's current autonomic state:

```
[arousal, valence, stability, coherence, autonomic_balance, recovery_rate]
```

- **Arousal**: How activated/deactivated the system is (0=shutdown, 1=highly aroused)
- **Valence**: How positive/negative the state feels (0=negative, 1=positive)
- **Stability**: How stable the HRV is over time
- **Coherence**: How well heart rate is synchronized with breathing (RF coherence)
- **Autonomic_balance**: Ratio of parasympathetic to sympathetic activity
- **Recovery_rate**: Velocity of change toward calm

This vector is the "current position" in physiological space. The MPC optimizer uses it.

#### `backend/ans_classifier.py` — What state are you in right now?
Takes the 6D state vector and classifies it into one of 5 Polyvagal states using soft scoring (not hard cutoffs):

1. **ventral_vagal** — Calm, connected, safe. This is the goal for most sessions.
2. **healthy_sympathetic** — Activated but safe. Goal for morning_emergence.
3. **anxious_sympathetic** — Fight/flight mode. Needs gentle deceleration.
4. **dorsal_vagal** — Shutdown/freeze. Needs very careful grounding music.
5. **burnout_rigidity** — Clinical concern. RMSSD < 30ms absolute. Safety fallback activates.

Each state is scored 0–1, then the highest-confidence state is returned along with confidence. If confidence < 0.5, "unknown" is returned rather than a wrong guess.

**Why soft scoring, not hard cutoffs:** The nervous system doesn't snap discretely between states. A person who is 60% ventral_vagal and 40% anxious_sympathetic should get music calibrated for the transition, not music for pure calm.

#### `backend/affect_classifier.py` — The emotion quadrant
Maps the state vector onto the valence–arousal plane (Russell's Circumplex Model of affect). Returns one of four quadrants:
- Q1: High arousal, high valence (excited, happy)
- Q2: High arousal, low valence (anxious, stressed)
- Q3: Low arousal, low valence (sad, depressed)
- Q4: Low arousal, high valence (calm, serene) ← the goal for find_your_calm

#### `backend/vs_score.py` — The composite health score
Computes the VS (Vital Synchrony) score: a single 0–100 number representing overall nervous system health in this moment.

**7 components**, each weighted by sensor mode:
- RMSSD score (highest weight)
- DFA alpha1 score
- RF coherence (how well breathing matches resonance frequency)
- Sympathovagal balance
- Recovery rate
- Posture openness (mode 3 only — from BlazePose)
- Facial valence proxy (mode 3 only — from FaceMesh)

**Mode-adaptive weights:** In Mode 1 (phone only), posture and face are unavailable, so their weights are redistributed to the HRV metrics. In Mode 3 (all sensors), all 7 components contribute.

Score interpretation:
- 0–30: SHUTDOWN (red) — system in severe stress or shutdown
- 31–55: STRESSED (orange) — sympathetic dominance
- 56–75: REGULATED (green) — healthy parasympathetic activity
- 76–100: FLOW (purple) — peak HRV coherence state

#### `backend/mpc_optimizer.py` — The music selection brain
Model Predictive Control: the algorithm that decides what music to play.

**How it works:**
1. Takes current 6D state and target 6D state (defined by session type + current arc phase)
2. Computes "error" = target - current (how far are we from goal?)
3. Generates 12 candidate music parameter sets (different combinations of BPM, warmth, binaural beat, etc.)
4. Runs the forward model on each candidate: "if I play *this* music, what state will the user be in 30 seconds from now?"
5. Picks the candidate that minimizes predicted error
6. Returns the winning 16 music parameters

**Why 12 candidates?** It's a stochastic search. Generating deterministic "optimal" music from physiology is unsolved. Instead: sample the space, predict consequences, pick best. 12 is enough to find a good option without being computationally expensive.

#### `backend/forward_model.py` — "If I play this, what happens?"
Predicts how a given set of music parameters will affect the physiological state over the next ~30 seconds. Currently hand-tuned based on music neuroscience research:
- Slow tempo (50–60 BPM) → reduces arousal
- High warmth (string-like timbre) → increases valence
- Low binaural beat (4–8 Hz, theta) → deepens parasympathetic tone
- High silence ratio → reduces arousal (pauses are therapeutic)
- Binaural beat matching RF → increases coherence

**Important caveat:** All parameters are marked `# UNTUNED` because they haven't been validated with real Polar H10 data yet. The model represents our best scientific guess, not measured calibration.

#### `backend/rf_calibration.py` — Finding your personal frequency
Runs the resonance frequency calibration procedure using Bayesian optimization:

1. Pick a starting frequency (e.g., 5.0 BPM)
2. Send it to frontend → user breathes at that rate for ~90 seconds
3. Compute coherence (correlation between RR signal and breathing signal at that frequency)
4. Use Gaussian Process Bayesian optimization to pick the next frequency to test
5. Repeat for 3–5 frequencies
6. Fit a curve to the (frequency, coherence) pairs
7. Find the peak — that's the RF

**Why Bayesian optimization?** We want to find the peak of a coherence curve with as few measurements as possible (each measurement takes 90 seconds of the user's time). Bayesian optimization is the mathematically correct way to find a function's peak with minimal evaluations.

**Why RF varies between people:** The natural frequency of the baroreflex (the pressure-regulation circuit that heart rate syncs to) varies by anatomy and conditioning. Athletes often have lower RF (~4.5 BPM); sedentary people higher (~6.5 BPM). The calibration finds yours.

#### `backend/session_manager.py` — The arc choreographer
Manages which phase of the session arc we're in, and what the target physiological state is for each phase. A session is not one monolithic 10-minute block — it's a choreographed arc:

**find_your_calm arc:**
- ACKNOWLEDGE (0–120s): Meet you where you are. Don't fight current state.
- SLOW (120–300s): Gently reduce sympathetic activation.
- ANCHOR (300–480s): Build parasympathetic tone. RF coherence target.
- RELEASE (480–600s): Consolidate. Hold the state. Gently conclude.

**wind_down arc:**
- MEET → DECELERATE → DEEPEN → DISSOLVE → MONITOR

**morning_emergence arc:**
- ORIENT → ACTIVATE → ENERGIZE → PRIME

Each phase has its own target state (different arousal/valence/coherence targets), and the MPC optimizer uses the phase's target to steer the music.

**Why a choreographed arc?** You can't just target "maximum calm" from the start — the music would feel jarring, disconnected from where the person actually is. Meeting them where they are first, then gradually steering, produces better physiological results and a better user experience.

#### `backend/safety.py` — The guardian
Runs every single cycle, before music parameters are sent to the frontend. Three triggers:

1. **RMSSD > 200ms**: Physiologically impossible for most adults. Means the sensor fell off or a motion artifact wasn't caught. Activates fallback.
2. **RMSSD < 15ms for 3+ consecutive cycles**: The nervous system is in extreme rigidity. Playing stimulating music here could be harmful. Activates very gentle fallback.
3. **State delta > 0.4/second**: State changed by 40% in one second. Cannot be physiological — it's artifact. Holds music steady.

Fallback parameters: `BPM=60, silence_ratio=0.7, warmth=0.9, brightness=0.2`. The safest, most grounding possible music.

**Design philosophy:** False positives (triggering fallback unnecessarily) are acceptable. False negatives (missing a real safety issue) are not.

#### `backend/baseline_engine.py` — Your personal history
Maintains a Bayesian running estimate of your personal RMSSD baseline, updated after each session. Uses a conjugate prior (Normal-inverse-gamma) for efficient Bayesian updating.

Why this matters: RMSSD norms vary enormously between people (normal range: 20–100ms). A raw RMSSD of 40ms is low for an athlete and healthy for a sedentary 60-year-old. The baseline engine turns raw RMSSD into a z-score relative to YOUR history — which is what makes the VS score and state classifier actually accurate for you specifically.

**Cold start:** For the first session, uses population priors. Updates get more accurate with each session.

#### `backend/db.py` — Database abstraction
All reads and writes to Supabase Postgres go through this module. Uses `asyncpg` for async Postgres connections. Implements:
- `upsert_profile` — create/update user profile
- `write_snapshot` — one row per second of session data
- `write_session` — final session row on completion
- `get_baseline` — retrieve Bayesian baseline for a user
- `update_baseline` — write updated baseline after session

Connection pooling is only initialized if `DATABASE_URL` environment variable exists at startup. In local dev without the env var, the backend runs without a database (useful for testing).

#### `backend/hrv_simulator.py` — Fake data for testing
Generates realistic synthetic RR intervals simulating a human in different physiological states. Used for:
- Running the full pipeline without a Polar H10
- Automated tests
- Demoing the app

The simulator can be configured to simulate different ANS states (stressed, calm, morning) with appropriate HRV characteristics.

#### `backend/context/` — Time and environment context
Two context modules that feed into session planning:
- `circadian.py`: Given timezone + current time, computes circadian phase (morning/afternoon/evening/night) which affects target state parameters.
- `ambient.py`: Placeholder for environmental context (light level, temperature) — not yet wired up.

#### `backend/api/` — HTTP REST endpoints
Three route files for non-WebSocket requests:
- `sessions.py`: CRUD for session records
- `profile.py`: User profile get/update (including calibration data)
- `baseline.py`: Baseline retrieval and manual override

#### `backend/tests/` — Automated test suite
Python tests using pytest:
- `test_auth.py` — JWT validation
- `test_baseline_engine.py` — Bayesian update math
- `test_db.py` — Database read/write
- `test_db_profile.py` — Profile upsert
- `test_latent_state.py` — State estimation
- `test_profile_api.py` — Profile API endpoints
- `test_rf_calibration.py` — Calibration math
- `test_vs_score.py` — VS score computation

---

### FRONTEND (React/Vite, runs in user's browser, hosted on Vercel)

#### `frontend/src/main.jsx` — The entry point
React's very first file. Mounts the entire app into the `<div id="root">` in index.html. Wraps everything in a Sentry error boundary so crashes are captured and reported.

#### `frontend/src/App.jsx` — The router and state machine
Controls which screen is showing. No URL-based routing — just a `screen` state variable. The screens in order:

```
[unauthenticated] LandingPage/LoginScreen
         ↓  (user logs in)
[landing] Landing.jsx — pick session type + sensor mode
         ↓  (user taps Begin Session)
[setup] Setup.jsx — initialize sensors
         ↓  (sensors ready)
[calibration] ConnectionRitual.jsx → Calibration.jsx
         ↓  (calibration done or skipped)
[session] Session.jsx — the 10-minute session
         ↓  (session ends)
[insight] Insight.jsx — post-session summary
         ↓  (user taps Done)
[landing] (loop back)
```

The `cfg` object is the shared configuration that passes forward through all screens:
```javascript
{
  session: "find_your_calm",  // which session type
  sensorMode: "polar",        // which sensor
  backendMode: 1,             // 1=rPPG, 2=H10, 3=combined
  rfBpm: 5.5,                 // filled after calibration
  rfLocked: false,            // did calibration succeed?
  timezone: "Asia/Kolkata",   // for circadian context
  fusion: <SensorFusion>      // the live sensor object
}
```

**Why state-based routing instead of React Router?** The app is linear (one path through screens), sensors need to stay alive between screens (SensorFusion hands off from Setup → Calibration → Session), and the screen flow has conditional logic that would be awkward in URL routes. State-based routing is simpler here.

#### `frontend/src/context/AuthContext.jsx` — Authentication state
Wraps the Supabase auth client. Any component can call `useAuth()` to get `{user, session, loading, signOut}`. The `session.access_token` is the JWT that gets sent to the backend WebSocket for authentication.

On load, automatically checks localStorage for a saved session (Supabase SDK does this). Users stay logged in across browser refreshes.

#### `frontend/src/pages/ConnectionRitual.jsx` — Pre-session onboarding
The "Finding Your Resonance" page that runs before calibration. Shows the user what's about to happen, connects to the backend WebSocket, and fires `onReady` when the connection is live and stable.

**Recent bug fixed here:** The `onReady` callback was being recreated on every render due to missing `useCallback` — the WebSocket would close and reopen mid-calibration. Fixed with `useCallback`.

#### `frontend/src/pages/Calibration.jsx` — RF calibration UI
Shows a pulsating breathing orb that animates at the frequency the backend is testing. The user breathes along with it. The orb expands for 60% of the cycle (inhale), contracts for 40% (exhale).

Streams `{rr: [...], resp_amp: float}` to backend every 500ms during calibration.

Uses `WSClient({noReconnect: true})` — if the connection drops during calibration, the data is useless anyway, so better to fail loud than silently reconnect with corrupt state.

#### `frontend/src/pages/Session.jsx` — The main session screen
The most complex page. Shows:
- SessionTimeline (arc phase progress bar)
- AnsState (current polyvagal state + color)
- HrvMetrics (RMSSD, SDNN, HR, DFA, SVI)
- VS score display with color band
- SensorStatusBar (signal quality)
- Breathing orb (animated at RF)

Every 500ms: reads from sensors, sends `{rr, resp_amp}` to backend.
Every ~1s: receives backend frame, updates all displays, calls `sessionAudio.updateParams()`.

Sets CSS custom properties `--vs-period`, `--rf-period`, `--ans-state` so animations respond to physiological state.

After 600 seconds: session ends, `useSessionAccum.summarize()` computes final stats, calls `onEnd(summary)`.

#### `frontend/src/pages/Dashboard.jsx` — Session history
Shows past sessions, trends, and the current user's baseline metrics. Links to the Begin Session flow.

#### `frontend/src/pages/Insight.jsx` — Post-session summary
Shows peak VS, RMSSD delta (did HRV improve?), dominant ANS state, and the AI-generated insight text from the backend. "Done" returns to Landing.

#### `frontend/src/pages/ProfileSetup.jsx` — First-time user setup
Collects name, age, weight (optional), resting HR. Used to seed the Bayesian baseline before any sessions have been run. Without this, the cold start uses population priors.

#### `frontend/src/sensors/sensor_fusion.js` — The sensor coordinator
Given a mode (1/2/3), starts the right sensors and provides a unified `getReading()`:
```javascript
{
  rr: float,          // RR interval in ms
  rr_confidence: 0-1, // how reliable
  resp_bpm: float,    // breathing rate
  resp_amp: float,    // breathing depth (0-1)
  face: {...} | null, // face landmarks (mode 3)
  pose: {...} | null, // body pose (mode 3)
  mode: 1|2|3
}
```

**Why one unified interface?** Session.jsx doesn't need to know which sensor is running. It just calls `getReading()` and gets data. This makes adding new sensors later easy — you don't rewrite Session.jsx.

#### `frontend/src/sensors/contact_rppg.js` — Camera heart rate
Extracts heartbeat timing from the phone's rear camera. The torch (flashlight) illuminates the fingertip. Blood absorbs green light differently than surrounding tissue. The camera's green channel changes intensity with each heartbeat. A bandpass filter (0.5–4 Hz) isolates the cardiac signal. Peak detection on the filtered signal gives RR intervals.

**Why green channel specifically?** Green light (~550nm wavelength) has the highest absorption contrast between oxygenated and deoxygenated hemoglobin, making heartbeat peaks most visible.

**Accuracy:** About 75% coherence threshold (versus 85% for Polar H10). Good enough for a session, not clinical grade.

#### `frontend/src/sensors/ble_h10.js` — Polar H10 ECG
Connects via Web Bluetooth (Bluetooth Low Energy). Subscribes to the Heart Rate GATT characteristic (0x2A37). Parses the binary packet to extract RR intervals. Handles the "energy_expended" byte skip (a common implementation bug in H10 integrations).

**Why H10 specifically?** It's the gold standard consumer-grade ECG chest strap. RR accuracy within ±1ms. Used in clinical HRV research. When the app gets to real user testing, H10 data is the ground truth.

#### `frontend/src/sensors/breath_mic.js` — Microphone breathing
Uses the microphone and Web Audio API AnalyserNode to detect breathing rate (0.1–0.5 Hz range in the FFT). Also computes `resp_amp` — the amplitude of each breath — which feeds into the breath actuator and the RF coherence calculation.

#### `frontend/src/sensors/facemesh_sensor.js` — Facial expression
Loads TensorFlow.js FaceMesh (468 landmarks). Extracts Eye Aspect Ratio and lip distance as a rough valence proxy. Active only in Mode 3. Gated by MotionGate — suppressed when the phone is moving.

#### `frontend/src/sensors/blazepose_sensor.js` — Body posture
MediaPipe BlazePose (33 landmarks). Computes posture_openness: how upright and open the body is. Feeds into VS score with 0.05 weight. The link between posture and vagal tone is physiologically grounded — hunched posture physically compresses the vagal pathway.

#### `frontend/src/audio/session_audio.js` — The music engine
Uses Tone.js (Web Audio API). Receives 16 music parameters per frame and applies them to:
- Polyphonic synthesizer (multiple simultaneous notes)
- Binaural beat oscillators (left/right channel offset)
- Master gain with breath modulation
- 2-second smooth ramps on all parameter changes (prevents jarring transitions)

The 16 parameters include: BPM, warmth, brightness, binaural_beat_hz, binaural_carrier_hz, silence_ratio, reverb_mix, chord_root, chord_mode, breath_sync_ratio, and several more.

#### `frontend/src/audio/binaural.js` — Binaural beats
Left ear oscillator = carrier_hz - beat_hz/2. Right ear = carrier_hz + beat_hz/2. Brain perceives a tone at the difference frequency. Example: 50Hz left + 54Hz right = perceived 4Hz beat (theta range). Used to entraining brainwave states toward the session goal.

Requires headphones to work. With speakers, both frequencies mix and cancel.

#### `frontend/src/audio/breath_actuator.js` — Music breathing with you
Maps the microphone's breath amplitude signal to a slow volume modulation. When your music "breathes" at the same rate as you, it reinforces the slow breathing pattern through auditory-physiological synchrony — the same mechanism the whole app is trying to strengthen.

#### `frontend/src/utils/ws_client.js` — WebSocket wrapper
Wraps native WebSocket into a class that handles:
- Auth handshake (first message = `{type: "auth", token: "eyJ..."}`)
- Automatic JSON parse/serialize
- Exponential backoff reconnection (1s, 2s, 4s, 8s, max 10s)
- Clean close without reconnect trigger

#### `frontend/src/store/sessionStore.js` — Local state storage
`localStorage`-backed store. Stores: user_id, sensor_mode, last_session_type, session history (last 50), OAuth tokens. Uses a publish/subscribe pattern so any component can `subscribe` to state changes.

**Important design note:** `user_id` is seeded from day 1 even though V1 is single-tenant. This means the database schema can stay constant when we add multi-user support in V3 — no migration needed.

---

## PART 5: THE DATABASE SCHEMA

Six Postgres tables in Supabase:

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `user_profiles` | Personal settings, biometric baseline | id, rmssd_baseline_mean, display_name, age |
| `user_baselines` | Bayesian HRV baseline per session type | rmssd_mean, rmssd_std, posterior_precision, n_sessions |
| `sessions` | One row per session | started_at, rmssd_start/end, peak_vs, rf_bpm, insight_text, outcome |
| `session_rr_segments` | Raw RR data in 30s chunks | segment_start_s, rr_ms (array), accepted (array) |
| `session_metric_snapshots` | 1Hz metric timeline | epoch_s, rmssd, vs_score, ans_state, latent_state |
| `insight_events` | Generated insight records | insight_type, insight_text, trigger_metric |

**Row Level Security:** Every table has `USING (user_id = auth.uid())`. Even if someone has the public Supabase key, they can only read/write their own rows.

---

## PART 6: THE AUTHENTICATION FLOW

```
User types email/password
        ↓
Frontend: supabase.auth.signInWithPassword()
        ↓
Supabase: validates credentials, issues JWT
  (JWT payload: {sub: "user-uuid", email: "...", exp: ...})
        ↓
JWT stored in localStorage by Supabase SDK
        ↓
AuthContext.jsx picks up auth state change
        ↓
User navigates to session, opens WebSocket
        ↓
First WS message: {type: "auth", token: "eyJhb..."}
        ↓
Backend auth.py: jwt.decode(token, SUPABASE_JWT_SECRET, ...)
  → validates signature → extracts user UUID
        ↓
All DB writes use this UUID
```

---

## PART 7: WHERE THE APP IS RIGHT NOW

### Current state: V1.0 shipped, V2 in progress

**What is working:**
- Full pipeline end-to-end with simulator
- Supabase auth (login, session, JWT)
- User profiles with `user_profiles` table
- ConnectionRitual → Calibration → Session → Insight flow
- All 7 Tone.js audio components
- Baseline engine (Bayesian RMSSD tracking)
- Session save to Supabase on completion
- Deployed: frontend on Vercel (`mission-alive.vercel.app`), backend on Railway
- React Error #310 fixed (the post-login crash)
- WebSocket stability fix (stale closure causing mid-calibration disconnect)
- RR-derived RF biofeedback spec written (2026-05-06) — f_engine.py design ready, gated on V2.1 hardware validation

**What is NOT working / not tested yet:**
- Real Polar H10 never tested (simulator only)
- HRV math not validated against real ECG data
- All forward model parameters are marked UNTUNED
- No real users
- RMSSD baseline is a personal estimate, not population-calibrated
- `SUPABASE_JWT_SECRET` was previously misconfigured (now fixed)
- Some API routes added to frontend (`/api/profile/calibration PATCH`) have no backend implementation

**Live State Table (from CLAUDE.md, as of 2026-04-30):**
- Current version: V1.0
- Real Polar H10 tested: Not yet
- Auth / Postgres: Working
- Deployed: Only locally (Railway/Vercel deployments were manual)
- Active users: 0 (simulator)
- Launch clearance: DO NOT LAUNCH

---

## PART 8: THE ROADMAP — WHERE IT CAN GO

### V2 (Next — Weeks 4–6): Real Hardware Validation

The entire V2 focus is making the app work with real sensor data before doing anything else. Every V2 task is blocked until the previous one is complete:

1. **V2.1 — Real H10 sessions**: 3 sessions × ≥10 minutes each on the actual Polar H10 chest strap, not the simulator.
2. **V2.2 — RMSSD validation**: Compare app's RMSSD calculation against Polar's own companion app. Must be within ±10% or the HRV math is wrong.
3. **V2.3 — Artifact rejection**: Test the ectopic filter on real ECG. The simulator doesn't generate realistic artifacts.
4. **V2.4 — Safety fallback**: Physically disconnect the H10 mid-session and confirm graceful degradation (last known state held, no crash).
5. **V2.5 — Full audio on phone**: All 7 Tone.js components audible on an actual phone speaker/headphone.
6. **V2.6 — PWA install**: iOS and Android users can install the app to home screen (requires service worker, manifest.json — both already exist).
7. **V2.8 — Supabase migration complete**: All sessions saving to Postgres correctly.
8. **V2.9 — Railway/Render deploy**: HTTPS enforced (required for BLE + camera from non-localhost).
9. **V2.10 — 1–5 real users**: End-to-end testing with actual human beings.

**Why this order strictly?** You cannot tune HRV parameters on simulator data. The forward model calibration requires real H10 sessions. Any V3 features built before V2 validation are built on sand.

### V3 (Weeks 7–10): The Beta and Launch Window

This is when the product becomes real:
- Multi-tenant (multiple users with isolated data)
- Personalization model (forward model coefficients updated per-user after each session)
- 10 beta users
- **This is when launch becomes possible (Week 10–11)**

### V4 / V5 (Do not discuss until V3 ships)

- Stripe billing / subscription
- 100+ users
- Clinical pipeline (research partnerships, IRB)
- Patent filing (the closed-loop HRV biofeedback + personalized music MPC architecture)

---

## PART 9: HOW EVERYTHING CONNECTS — THE DATA JOURNEY OF ONE HEARTBEAT

Let's trace a single heartbeat from sensor to sound.

1. **The beat happens.** Your heart contracts. Blood pumps into your capillaries.

2. **The H10 detects it.** The ECG electrodes on the chest strap detect the electrical impulse (R wave). The device records the timestamp.

3. **Bluetooth packet arrives.** The H10 sends a binary GATT packet to the browser. `ble_h10.js` parses it: extracts the RR interval (time since last beat) in milliseconds. Example: 923ms.

4. **SensorFusion bundles it.** Every 500ms, `sensor_fusion.js` calls `getLatestRR()` on the H10 sensor and packages it with the breathing amplitude from the mic sensor.

5. **Session.jsx sends it.** `{rr: [923, 887, 941], resp_amp: 0.72}` goes via WebSocket to the backend.

6. **Backend receives the batch.** The FastAPI WebSocket handler feeds each RR value to `artifact_filter.py`. 923ms is checked: is it within 20% of the recent median? Yes. Accepted.

7. **HRV processor accumulates.** The accepted RR values build up a rolling window. After 2 minutes, RMSSD is computable. After 5 minutes, DFA is computable.

8. **State estimation runs.** The HRV metrics are mapped to the 6D autonomic vector: `[arousal=0.31, valence=0.72, stability=0.68, coherence=0.71, autonomic_balance=0.63, recovery_rate=0.15]`.

9. **ANS classifier scores.** Given these metrics, what state is this person in? ventral_vagal scores 0.74, healthy_sympathetic 0.18, others < 0.1. State = "ventral_vagal" with confidence 0.74.

10. **VS score computed.** RMSSD=71 → 68/100 component score. DFA=0.94 → 72/100. RF coherence=0.71. Other components. Weighted sum: VS=69 (REGULATED band, green).

11. **Session manager checks arc.** We're at 340 seconds. That's the ANCHOR phase of find_your_calm. Target state: arousal=0.25, coherence=0.82.

12. **Safety supervisor runs.** RMSSD=71ms (well within 15–200ms safe range). State delta from last frame = 0.04 (well under 0.4 threshold). Safe = True.

13. **MPC optimizer fires.** Current = ventral_vagal, arousal=0.31, coherence=0.71. Target = arousal=0.25, coherence=0.82. Generate 12 candidate music param sets. For each: run forward model prediction. Candidate 7 scores best: `{bpm:52, binaural_beat_hz:4.2, warmth:0.83, silence_ratio:0.45, ...}`.

14. **Backend sends the frame.** JSON blob with all computed values goes back over WebSocket.

15. **Frontend receives it.** React state updates. All display components re-render with new values.

16. **AudioEngine updates.** `sessionAudio.updateParams({bpm:52, binaural_beat_hz:4.2, ...})`. Tone.js ramps all parameters over 2 seconds to new values.

17. **You hear different music.** Slightly slower, warmer, with a 4.2Hz binaural beat. This is designed to increase coherence and deepen parasympathetic tone.

18. **Your physiology responds.** Maybe. Probably. The effect builds over 2–3 minutes of sustained music in this direction.

19. **The next heartbeat is measured.** Loop repeats.

---

## PART 10: THE DECISIONS AND WHY THEY WERE MADE

### Why not a native iOS/Android app?

Web Bluetooth, Web Audio API, and camera access all work in Chrome on Android (and increasingly Safari on iOS). A PWA (Progressive Web App) can be installed to the home screen. Native apps would require two separate codebases, app store submissions, and Apple's stricter Bluetooth policies. For a pre-launch product, the web is much faster to iterate.

**Tradeoff:** Web Bluetooth is not supported in Safari on iOS. iPhone users cannot use the Polar H10 mode. They can only use Mode 1 (camera rPPG). This is a real limitation.

### Why WebSocket and not HTTP polling or Server-Sent Events?

The session is bidirectional: frontend sends sensor data up, backend sends processed frames down, at 1Hz for 10 minutes. SSE (Server-Sent Events) only goes one direction. HTTP polling would add ~50ms latency per request plus connection overhead. WebSocket is the right tool.

### Why SQLite was the original database (now replaced by Supabase Postgres)?

SQLite was the original database for local development. It required no setup, worked on any machine, and was sufficient for single-user testing. It was replaced with Supabase Postgres for V2 because:
1. Supabase provides auth (avoiding building login from scratch)
2. Row Level Security is critical for multi-user data isolation
3. Cloud hosting requires a proper database

The `mission_alive.db` file still exists in the repo — that's the old SQLite database. It's no longer used in production.

### Why Bayesian updating for the HRV baseline, not a simple rolling average?

A rolling average treats all sessions equally. A Bayesian approach maintains a probability distribution over the true mean and variance. It:
- Starts with a population prior when no user data exists (cold start)
- Updates with each new session, weighting by session quality
- Tracks `posterior_precision` — how confident the estimate is
- Can incorporate prior sessions even if they have different quality

This matters because a person's RMSSD baseline can change significantly over weeks. A simple rolling average would take too long to adapt to genuine change. The Bayesian estimate adapts faster with high-quality sessions and more slowly with noisy data.

### Why is the forward model hand-tuned and not learned from data?

At V1, there is no data. You need a model to get data; you need data to train a model. The hand-tuned forward model is based on published music neuroscience research and represents a reasonable prior. In V3, after accumulating real sessions across multiple users, we can fit the model coefficients from actual outcome data.

The `# UNTUNED` comments throughout the backend are not failures — they're honest markers of what needs to be validated once real H10 data exists.

---

## PART 11: THE COMPLETE FILE MAP (PRINT REFERENCE)

```
mission_alive/
├── backend/                    ← Python FastAPI server
│   ├── main.py                 ← Entry point, WebSocket, routes
│   ├── auth.py                 ← JWT validation
│   ├── config.py               ← Environment variables
│   ├── db.py                   ← Supabase Postgres read/write
│   ├── artifact_filter.py      ← RR noise rejection
│   ├── hrv_processor.py        ← RMSSD, SDNN, DFA, SVI math
│   ├── hrv_engine.py           ← HRV engine wrapper
│   ├── hrv_simulator.py        ← Fake sensor data for testing
│   ├── state_estimation.py     ← 6D autonomic vector
│   ├── ans_classifier.py       ← Polyvagal 5-state classifier
│   ├── affect_classifier.py    ← Valence/arousal quadrant
│   ├── vs_score.py             ← Composite 0-100 score
│   ├── latent_state.py         ← State dynamics math
│   ├── state_classifier.py     ← State classification wrapper
│   ├── state_dynamics.py       ← State change velocity
│   ├── rf_calibration.py       ← Bayesian RF finder
│   ├── session_manager.py      ← Arc phase choreographer
│   ├── safety.py               ← Safety supervisor
│   ├── mpc_optimizer.py        ← Music selection (MPC)
│   ├── forward_model.py        ← Physiology prediction
│   ├── music_engine.py         ← Music param validation
│   ├── insight_engine.py       ← Post-session insight text
│   ├── baseline_engine.py      ← Bayesian RMSSD baseline
│   ├── trajectory_planner.py   ← Session arc target states
│   ├── gemini_mapper.py        ← (Gemini API integration, unused)
│   ├── whoop_api.py            ← (Whoop sensor, not yet wired)
│   ├── storage.py              ← File storage abstraction
│   ├── context/
│   │   ├── circadian.py        ← Time-of-day context
│   │   └── ambient.py          ← Environment context (stub)
│   ├── api/
│   │   ├── profile.py          ← /api/profile routes
│   │   ├── sessions.py         ← /api/sessions routes
│   │   └── baseline.py         ← /api/baseline routes
│   ├── migrations/
│   │   └── 001_user_profiles_baselines.sql  ← DB schema
│   ├── tests/                  ← pytest test suite
│   └── requirements.txt        ← Python dependencies
│
├── frontend/                   ← React/Vite web app
│   ├── src/
│   │   ├── main.jsx            ← React entry point
│   │   ├── App.jsx             ← Screen router / state machine
│   │   ├── context/
│   │   │   ├── AuthContext.jsx ← Supabase auth state
│   │   │   └── SensorContext.jsx ← Sensor state (if used)
│   │   ├── pages/
│   │   │   ├── LandingPage.jsx ← Unauthenticated landing
│   │   │   ├── LoginScreen.jsx ← Login form
│   │   │   ├── Landing.jsx     ← Session picker (post-login)
│   │   │   ├── Dashboard.jsx   ← History + trends
│   │   │   ├── ProfileSetup.jsx ← First-time user setup
│   │   │   ├── Setup.jsx       ← Sensor initialization
│   │   │   ├── ConnectionRitual.jsx ← Pre-calibration onboarding
│   │   │   ├── Calibration.jsx ← RF calibration UI
│   │   │   ├── Session.jsx     ← Main 10-min session screen
│   │   │   ├── Insight.jsx     ← Post-session summary
│   │   │   └── Report.jsx      ← Detailed session report
│   │   ├── sensors/
│   │   │   ├── sensor_fusion.js  ← Coordinates all sensors
│   │   │   ├── contact_rppg.js   ← Camera heart rate
│   │   │   ├── ble_h10.js        ← Polar H10 BLE ECG
│   │   │   ├── breath_mic.js     ← Microphone breathing
│   │   │   ├── facemesh_sensor.js ← TF.js face landmarks
│   │   │   ├── blazepose_sensor.js ← MediaPipe body pose
│   │   │   └── motion_gate.js    ← Accelerometer gating
│   │   ├── audio/
│   │   │   ├── session_audio.js  ← Tone.js orchestrator
│   │   │   ├── binaural.js       ← Binaural beat generator
│   │   │   └── breath_actuator.js ← Music-breath sync
│   │   ├── hooks/
│   │   │   ├── useWSSession.js   ← WebSocket React hook
│   │   │   ├── useSensorFusion.js ← SensorFusion React hook
│   │   │   ├── useSessionAccum.js ← Frame accumulator
│   │   │   ├── useWakeLock.js    ← Screen-on lock
│   │   │   ├── usePhase2RFConvergence.js ← RF convergence hook
│   │   │   └── useSensorFrame.js ← Sensor frame hook
│   │   ├── components/
│   │   │   ├── AnsState.jsx      ← Polyvagal state display
│   │   │   ├── HrvMetrics.jsx    ← RMSSD/SDNN/HR/DFA/SVI cards
│   │   │   ├── MusicParams.jsx   ← 16-param music display
│   │   │   ├── SensorStatusBar.jsx ← Signal quality bar
│   │   │   ├── SessionTimeline.jsx ← Arc phase progress
│   │   │   ├── InsightCard.jsx   ← Insight text display
│   │   │   └── DiscardSheet.jsx  ← Session discard confirm
│   │   ├── ui/
│   │   │   ├── BreathRing.jsx    ← Breathing circle
│   │   │   ├── CoherenceBar.jsx  ← RF coherence bar
│   │   │   ├── PhaseIndicator.jsx ← Current phase label
│   │   │   └── VsDisplay.jsx     ← VS score with color band
│   │   ├── lib/
│   │   │   ├── api.js            ← HTTP API client
│   │   │   ├── supabase.js       ← Supabase client singleton
│   │   │   └── sentry.js         ← Error monitoring init
│   │   ├── utils/
│   │   │   ├── ws_client.js      ← WebSocket wrapper
│   │   │   └── circadian.js      ← Client-side circadian
│   │   ├── store/
│   │   │   └── sessionStore.js   ← localStorage state
│   │   └── styles/               ← CSS files per page
│   ├── vercel.json               ← SPA rewrite rule
│   ├── vite.config.js            ← Build + dev server config
│   └── package.json              ← npm dependencies
│
├── supabase/
│   └── migrations/001_initial_schema.sql  ← DB DDL
├── CLAUDE.md                     ← This project's AI instructions
├── railway.toml                  ← Railway deploy config
├── pytest.ini                    ← Python test config
└── README.md                     ← Project overview
```

---

## PART 12: THE OPEN QUESTIONS

These are things that are not resolved yet and will matter when V2 starts:

1. **Will the HRV math match the Polar app?** The RMSSD formula is standard, but edge cases in artifact rejection and window sizing could cause divergence. V2.2 validates this directly.

2. **What is the actual RF for the builder?** It hasn't been measured. The app defaults to 5.5 BPM but your personal RF may be different. V2.1 will find it.

8. **Mode 2 calibration never locks (rf_calibration.py):** _resp_buffer is always zeros because the H10 accelerometer is not implemented in the frontend. f_engine.as_resp_signal() (spec: 2026-05-06) fixes this by deriving a respiratory signal directly from the RR series. Implement f_engine.py first, then wire the fallback in f_calibration.py.

3. **Does the forward model direction make sense on real data?** All those `# UNTUNED` constants are educated guesses. The first real H10 sessions will reveal whether the music changes actually move HRV in the expected direction.

4. **SUPABASE_JWT_SECRET on Railway — is it correct?** This was misconfigured once. Needs verification before any real user data goes in.

5. **The `/api/profile/calibration PATCH` endpoint exists in the frontend but not the backend.** If the frontend calls it, it gets a 404. Needs to be added to `backend/api/profile.py`.

6. **The old SQLite DB (`mission_alive.db`)** still exists in the repo root. It's unused but shouldn't be committed. Should be gitignored.

7. **iPhone users cannot use Polar H10 mode.** Web Bluetooth is not supported in Safari iOS. The only workaround is a native iOS app or React Native. This is a real product decision that needs to be made before targeting iOS users.

---

## PART 13: GLOSSARY

| Term | Meaning |
|------|---------|
| ANS | Autonomic Nervous System — controls heart, breathing, digestion without conscious thought |
| Artifact | A fake reading from the sensor (caused by movement, loose contact, etc.) |
| BLE | Bluetooth Low Energy — the energy-efficient Bluetooth used by fitness devices |
| Binaural beat | Two slightly different frequencies (one per ear) create a perceived "beat" |
| DFA alpha1 | Fractal complexity of heart rate. ~1.0 = healthy. <0.75 = overload |
| GATT | Bluetooth protocol for data exchange between devices |
| HRV | Heart Rate Variability — variation in heartbeat timing (ms). High = healthy |
| JWT | JSON Web Token — signed identity token, like a cryptographic passport |
| MPC | Model Predictive Control — optimization that looks ahead before deciding |
| RF | Resonance Frequency — your personal breathing rate that maximizes HRV coherence |
| RMSSD | Root Mean Square of Successive Differences — the main HRV metric |
| rPPG | Remote Photoplethysmography — camera-based heart rate, no contact needed |
| RSA | Respiratory Sinus Arrhythmia — normal heart rate variation synced to breathing |
| SQI | Signal Quality Index — 0-1 reliability estimate for the current sensor signal |
| SVI | Sympathovagal Variability Index — catches slow HRV drift RMSSD misses |
| VS | Vital Synchrony — the app's composite 0-100 physiological health score |
| WebSocket | Persistent two-way connection between browser and server |

---

*This document covers the full Mission Alive codebase as of 2026-05-05.
To start: `python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000`
and `cd frontend && npm run dev -- --host 0.0.0.0`*
