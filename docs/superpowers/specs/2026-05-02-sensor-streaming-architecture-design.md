# Sensor Streaming Architecture — Design Spec

**Version:** 0.1-draft  
**Date:** 2026-05-02  
**Author:** Architecture session — Mission Alive  
**Status:** For review before implementation

---

## Overview

The current architecture creates and destroys sensor connections at screen boundaries: BLE connects in Setup, disconnects after Session, and the WebSocket is torn down and re-opened at Calibration → Session handoff. This causes dropped RR intervals during navigation, a second camera grab risk when Calibration falls back to creating its own SensorFusion, and no continuous HRV signal between screens. The redesign promotes sensors and the WebSocket to application-level singletons managed outside the screen router, so any screen can subscribe to a live stream that started once at auth time and never stops while the app is open.

---

## Current Problems

**P1 — BLE disconnect on navigation.** `BleH10Sensor` (`frontend/src/sensors/ble_h10.js`) connects inside the Setup/Calibration flow and is torn down at session end. Navigating back to Landing drops the Bluetooth connection entirely. Every new session starts with a fresh BLE scan and `requestDevice()` dialog.

**P2 — SensorFusion created per screen.** `Calibration.jsx` contains the fallback: `const fusion = existingFusion ?? new SensorFusion(sensorMode ?? 1)`. If `cfg.fusion` is null or arrives late, a second `SensorFusion` instance calls `getUserMedia` while the first may still hold the camera — a double camera-grab that races on mobile WebKit.

**P3 — WebSocket is per-screen.** `WSClient` is instantiated in `Calibration.jsx` with `noReconnect:true` and in `Session.jsx` without it. Between calibration end (`cal_done` → WS close) and session start (new WS open), there is a connection gap. Any RR intervals arriving in that window are silently lost. The backend must also re-authenticate on every new connection (10 s JWT timeout each time).

**P4 — No continuous inter-screen signal.** The dashboard / Landing screen currently has no access to live HRV. Calibration Phase 1 (passive baseline scan) cannot subscribe to the RR stream because it does not exist at that point in the flow.

**P5 — SensorStatusBar receives hard-coded props.** `Session.jsx` passes `sensorStatus="ready"` (a string literal) and `mode={undefined}`, so the status bar always shows Face+Pose as green regardless of actual sensor state. There is no global sensor status that any screen can read.

**P6 — Service worker is a minimal install shell.** `frontend/public/sw.js` (19 lines) does network-first fetch passthrough only. It has no knowledge of sensors, WS state, or background streaming. Web Bluetooth is not accessible from service workers — this gap has no current mitigation.

**P7 — `useWSSession` timezone dead code.** The hook stores `client._timezone` after `onopen` has already fired; the timezone never reaches the backend auth payload. This is currently masked because `Session.jsx` bypasses the hook and instantiates `WSClient` directly.

---

## Architecture

### SensorContext shape

A new React context, `SensorContext`, is the single source of truth for all sensor state. It is created once at app mount (inside `AuthProvider`, after auth resolves) and never torn down.

```
SensorContext value shape:
{
  // Connection state
  bleStatus:    'idle' | 'scanning' | 'connected' | 'error',
  micStatus:    'idle' | 'active' | 'denied' | 'error',
  wsStatus:     'idle' | 'connecting' | 'auth' | 'live' | 'reconnecting' | 'error',

  // Live data — updated at 1 Hz from the persistent WS frame, or directly
  // from the BLE notification callback at ~1 Hz RR flush
  latestRR: {
    rr_ms:      number[],   // last N RR intervals (capped at 60, same as existing rrBuffer)
    confidence: number,     // 0.0–1.0; 0.95 hardcoded for H10, derived for rPPG
    source:     'h10' | 'rppg' | null,
    ts:         number,     // Date.now() of last update
  } | null,

  latestHRV: {
    rmssd:      number | null,
    sdnn:       number | null,
    hr_bpm:     number | null,
    sqi:        number | null,   // 0.0–1.0 signal quality index
    ts:         number,
  } | null,

  latestResp: {
    breath_rate_bpm: number | null,
    resp_amp:        number | null,   // raw 4 Hz band amplitude
    ts:              number,
  } | null,

  // Session / calibration state surfaced from WS frames
  rfBpm:      number | null,    // locked resonance frequency; null until cal_done
  rfLocked:   boolean,

  // Imperative handles — screens call these, do not manage connections themselves
  requestBle:  () => Promise<void>,   // triggers BLE scan if not connected
  startMic:    () => Promise<void>,   // triggers mic permission if not active
  sendWS:      (payload: object) => void,   // send on the persistent WS; no-op if not OPEN
}
```

Context is provided by `SensorProvider` in `frontend/src/context/SensorContext.jsx` (new file). It wraps all existing sensor class instances as module-level singletons (not React state), so re-renders never cause them to be garbage-collected.

Internal singletons held by `SensorProvider` (not exposed in context value):
- `_bleH10`: instance of `BleH10Sensor` from `frontend/src/sensors/ble_h10.js`
- `_breathMic`: instance of `BreathMicSensor` from `frontend/src/sensors/breath_mic.js`
- `_sensorFusion`: instance of `SensorFusion` from `frontend/src/sensors/sensor_fusion.js`
- `_wsClient`: instance of `WSClient` from `frontend/src/utils/ws_client.js`

These four objects are created once at `SensorProvider` mount and stored in `useRef`s, never in `useState`. React state is used only for the context value fields that screens need to re-render from.

---

### BLE lifecycle

**Where BLE init lives:** BLE init is triggered by a user gesture inside the `SensorProvider`, called by the auth-success path in `App.jsx`. The exact hook point is the `onProfileReady` callback that currently transitions from `ProfileSetup` to `'landing'` — at that moment the user has just tapped "Save", which satisfies the user-gesture requirement for `navigator.bluetooth.requestDevice()`.

Concretely:

1. `AuthContext` resolves → `App.jsx` fetches profile → profile is non-null → `App.jsx` calls `sensorContext.requestBle()` once.
2. `requestBle()` calls `_bleH10.start()`. On success: sets `bleStatus: 'connected'`, registers the RR flush callback (see below). On failure: sets `bleStatus: 'error'`, surfaces a retry button in `SensorStatusBar`.
3. If the user navigates to Landing, Setup, Calibration, Session, or Insight — `bleStatus` stays `'connected'`. The H10 GATT notification stream runs uninterrupted.
4. `_bleH10` is only stopped if the user explicitly taps "Disconnect device" (a new action in settings, V3 scope) or the page is unloaded.

**RR flush callback:** `BleH10Sensor._onData()` currently accumulates into `rrBuffer`. The new design adds a flush callback: every 1 s (via a `setInterval` inside `SensorProvider`), the provider reads `_bleH10.getLatestRR()`, stores it in the `latestRR` context field, and forwards the array to `_wsClient.send({ type: 'rr_frame', rr_ms: [...], source: 'h10' })`. This replaces the per-screen polling loop in `Calibration.jsx` and `Session.jsx`.

**Mid-session disconnect:** On `gattserverdisconnected` event, `bleStatus` → `'scanning'`, RR flush stops. The WS continues. After reconnect (automatic via `BluetoothDevice.watchAdvertisements` if supported, or manual re-pair prompt), RR flush resumes. Pipeline contract: backend already handles gaps — session keeps running on resp_amp alone until RR resumes.

---

### WebSocket multiplexing

**Decision: single WS with `type` field on every frame.** Separate WebSocket per feature (one for calibration, one for session) was the current implicit approach and is the root cause of P3. A single persistent connection with a message-type field is simpler, eliminates the re-auth cost, and aligns with how the backend already branches (`cal_active` flag from the first `cal_start` message).

The persistent WS connects once, immediately after BLE init succeeds (or in parallel if BLE fails — WS is not gated on BLE). It sends auth on `onopen` as today. After `auth_ok`, the connection stays open indefinitely; the backend must be updated to not close after `cal_done` or end-of-session.

**Upstream frame types (frontend → backend):**

| `type` field | Payload fields | When sent |
|---|---|---|
| `auth` | `token`, `timezone` | Automatic on every WS open (existing) |
| `rr_frame` | `rr_ms[]`, `source`, `session_id` | Every 1 s from SensorProvider flush loop |
| `resp_frame` | `resp_amp`, `breath_rate_bpm`, `session_id` | Every 500 ms from SensorProvider mic flush |
| `cal_start` | `session_id`, `mode` | Once, when user enters Calibration screen |
| `cal_skip` | `session_id` | Once, when user taps Skip in Calibration |
| `session_start` | `session_id`, `rf_bpm`, `rf_locked`, `mode` | Once, when Session screen mounts |
| `session_end` | `session_id`, `reason` (`'complete'`\|`'discard'`) | Once, on session teardown |
| `cmd` | `cmd` string | Existing; pause/resume commands |

`session_id` is included on all data frames so the backend can gate metric computation to the correct session boundary. The backend must ignore `rr_frame` and `resp_frame` unless a session is active; it currently does this implicitly via `cal_active` — explicit session scoping is needed.

**Downstream frame types (backend → frontend):**

| `type` field | When emitted | Consumer |
|---|---|---|
| `auth_ok` | After JWT validated | SensorProvider → sets `wsStatus: 'live'` |
| `cal_progress` | 1 Hz during calibration | Calibration screen via context subscription |
| `cal_done` | When RF locked or timeout | Calibration screen; SensorProvider stores `rfBpm`, `rfLocked` |
| `session_frame` | 1 Hz during session | Session screen via context subscription; also updates `latestHRV` in context |
| `status` | Buffering / low SQI events | SensorStatusBar via context |
| `error` | Auth failure, bad frame | SensorProvider → sets `wsStatus: 'error'` |

Note: the existing backend emits `{cal: true, ...}` frames — these need a `type` field added. This is a backend breaking change requiring a coordinated frontend+backend deploy.

**Message routing in SensorProvider:** The persistent `WSClient.onMessage` callback in `SensorProvider` reads `msg.type` and dispatches:
- `auth_ok` → updates `wsStatus`
- `cal_progress` / `cal_done` → updates `rfBpm`, `rfLocked`, fires a `calProgressRef` callback if registered
- `session_frame` → updates `latestHRV` context state, fires a `sessionFrameRef` callback if registered
- `status` → updates `wsStatus` or a `sensorWarning` field
- `error` → updates `wsStatus: 'error'`

Screens register frame callbacks via `useSensorFrame(type, callback)` hook (new, thin — just stores callback in a ref registered on the context). This avoids prop-drilling and avoids re-renders from every 1 Hz frame.

---

### Background mode strategy

**Hard constraint: Web Bluetooth is not accessible from service workers.** The existing `sw.js` cannot hold or continue a GATT connection. This is a platform limitation across all browsers (2026-05-02 status: no browser implements BT in SW). Background BLE streaming is therefore impossible in a true service-worker sense.

**Chosen fallback strategy: Page Visibility API + Wake Lock.**

The existing `frontend/src/hooks/useWakeLock.js` already acquires a wake lock during sessions. The strategy extends this:

1. `SensorProvider` registers a `document.addEventListener('visibilitychange', ...)` handler.
2. When `document.hidden === false` (app in foreground): normal 1 Hz RR flush, full WS send.
3. When `document.hidden === true` (app backgrounded on mobile):
   - Wake lock is NOT released (wake lock must already be held before background transition; acquiring it after is blocked).
   - The 1 Hz flush loop continues in the foreground thread if the browser allows script execution while the page is hidden. On iOS Safari PWA, background script runs for approximately 30 s then is throttled. On Android Chrome, background execution is more permissive.
   - BLE GATT notifications continue to fire because the notification is registered on the `BluetoothRemoteGATTCharacteristic`, not a timer — browser throttling does not drop GATT events in most tested cases.
   - The WS connection stays open (no explicit close on visibility change). If the WS drops (server timeout), `WSClient` auto-reconnects with exponential backoff on re-foreground.
   - RR intervals that arrived during background but were not flushed are buffered in `_bleH10.rrBuffer` (cap: 200 entries, ~3 min at 60 bpm). On re-foreground, the next flush sends the backlog.

4. The service worker (`sw.js`) is upgraded to:
   - Intercept `visibilitychange` via a `clients.matchAll` + `postMessage` channel so the SW knows when the page is backgrounded.
   - Hold a Background Sync registration (`sync` event) tagged `'hrv-flush'` — if the page is killed mid-session, the SW can fire a one-shot HTTP POST to `POST /api/session/finalize` with the last known session_id, so the backend can mark the session as interrupted rather than leaving it open.
   - The SW does NOT attempt to maintain the WS or BLE. It only handles the session-finalize cleanup.

5. **Camera sensors (rPPG, FaceMesh, BlazePose) stop on background.** Camera access requires a visible page on all mobile platforms. `SensorProvider` pauses these sensors on `visibilitychange: hidden` and resumes on `visibilitychange: visible`. This does not affect H10 mode sessions where camera is not the primary RR source.

6. **Documented limitation:** On iOS Safari in PWA standalone mode, background script execution beyond 30 s is throttled. A user who backgrounds the app for more than 30 s during a session will have a gap in resp_amp data. RR intervals from BLE will backfill on resume. The UI should show a "Session paused — tap to resume" banner when re-foregrounded after a gap > 30 s.

---

## Component/File Changes

**New files:**

| File | Purpose |
|---|---|
| `frontend/src/context/SensorContext.jsx` | `SensorProvider` + `useSensor()` hook + `useSensorFrame(type, cb)` hook |

**Modified files:**

| File | Change |
|---|---|
| `frontend/src/App.jsx` | Wrap `AppRoutes` with `<SensorProvider>` inside `<AuthProvider>`. Remove `cfg.fusion` passing — fusion is no longer a prop. Call `sensorContext.requestBle()` in the profile-ready callback. |
| `frontend/src/pages/Setup.jsx` | Remove `SensorFusion` instantiation. Remove `getFusion()` / stream handoff. Read sensor mode selection and write it to `SensorContext` via a setter. CTA button still navigates to Calibration. |
| `frontend/src/pages/Calibration.jsx` | Remove `WSClient` instantiation. Remove `SensorFusion` fallback creation. Remove 500 ms polling loop. Subscribe to `cal_progress` and `cal_done` frames via `useSensorFrame`. Send `cal_start` via `sensorContext.sendWS({ type: 'cal_start', ... })` on mount. On `cal_done`, read `rfBpm`/`rfLocked` from context and call `onLocked`. |
| `frontend/src/pages/Session.jsx` | Remove `WSClient` instantiation. Remove `SensorFusion` creation/reuse. Subscribe to `session_frame` via `useSensorFrame`. Send `session_start` on mount, `session_end` on teardown. Read live HRV from `latestHRV` context. |
| `frontend/src/components/SensorStatusBar.jsx` | Read `bleStatus`, `micStatus`, `wsStatus`, `sqi`, `rfLocked` from `useSensor()` directly — no props needed. Fix the mode/sensor-dot display bug (Face+Pose only shown when `sensorMode === 3`). |
| `frontend/src/utils/ws_client.js` | Add `type` field to auth frame (already exists). No other changes — `WSClient` is correct as-is; `SensorProvider` just holds it differently. |
| `frontend/src/hooks/useWakeLock.js` | Expose `isHeld` boolean. `SensorProvider` reads this to decide whether to show the background-gap banner. |
| `frontend/public/sw.js` | Add Background Sync registration for `'hrv-flush'`. Add `postMessage` channel for visibility state. Keep network-first fetch unchanged. |
| `frontend/src/sensors/ble_h10.js` | Add `onDisconnect(cb)` registration so `SensorProvider` can respond to `gattserverdisconnected`. No other changes to parsing logic — GATT fixes from commit 1245 are correct. |

**Deleted behavior (not deleted files):**
- `cfg.fusion` prop passing through App → Setup → Calibration → Session: removed entirely.
- Per-screen `WSClient` construction: removed from Calibration.jsx and Session.jsx.
- Per-screen `SensorFusion` construction or reuse: removed from Calibration.jsx, Setup.jsx, Session.jsx.
- `noReconnect: true` on Calibration WSClient: no longer needed (single persistent WS).

---

## Backend Changes

**B1 — Add `type` field to all downstream frames.** Current backend emits `{cal: true, target_bpm, ...}` and `{t: elapsed, ...}`. Both need a `type` field: `"cal_progress"`, `"cal_done"`, `"session_frame"`, `"status"`, `"error"`. This is a required protocol change.

**B2 — Do not close WS after `cal_done`.** `backend/main.py` currently emits `cal_done` and then the WS closes (or transitions to session mode on the same connection). With a persistent single WS, the backend must keep the connection open after `cal_done` and wait for `session_start`. The session state machine in `main.py` needs a new state: `IDLE_BETWEEN_CAL_AND_SESSION`.

**B3 — Do not close WS after `session_end`.** Similarly, after `session_end` is received or session cleanup runs (`db.finish_session`), the WS must stay open. The user may start another session in the same app load. Backend transitions to `WAITING` state.

**B4 — Accept `type`-tagged upstream frames.** The backend currently detects calibration vs session mode by peeking the second message (`cal_start` / `session_start`, 2 s window). With the new protocol, every frame has a `type` field. The backend should dispatch on `msg['type']` rather than the peek-and-infer approach. The 2 s `cal_detect` timeout in `main.py` can be removed.

**B5 — Ignore `rr_frame` and `resp_frame` when no session is active.** The persistent WS sends RR/resp continuously. The backend must buffer or discard based on session state. Safe default: discard when `session_id` is None or does not match an open session.

**B6 — Session finalize endpoint for Background Sync.** New route: `POST /api/session/finalize` accepting `{ session_id, user_id }`. Marks the session as interrupted in the DB (sets `ended_at` to now, `status: 'interrupted'`) without requiring a WS connection. Called by the service worker Background Sync on page kill.

**B7 — Keep alive / ping-pong.** The persistent WS must not be killed by Railway's 60 s idle timeout. `WSClient` should send `{ type: 'ping' }` every 30 s when no data frames are being sent (i.e., between sessions). Backend responds `{ type: 'pong' }`. This replaces the current implicit keep-alive that relies on session data frames.

---

## Data Contracts (what flows where)

### RR intervals

```
BleH10Sensor._onData()          (GATT notification, ~1 Hz for H10)
  → rrBuffer (max 200 entries, in ble_h10.js)
  → SensorProvider flush loop   (setInterval 1000ms)
    → latestRR context state    (re-renders SensorStatusBar, any subscriber)
    → WSClient.send({ type: 'rr_frame', rr_ms: [...], source: 'h10', session_id })
      → backend main.py dispatch
        → HRVProcessor._rr_buffer (existing)
        → 1 Hz session loop → { type: 'session_frame', rmssd, sdnn, hr_bpm, sqi, ... }
          → WSClient.onMessage → latestHRV context state
```

### Respiration

```
BreathMicSensor._sampleBandAmp()   (setInterval 250ms, 4 Hz)
  → _respAmpBuffer (max 240 entries, ~60 s)
  → SensorProvider flush loop   (setInterval 500ms)
    → latestResp context state
    → WSClient.send({ type: 'resp_frame', resp_amp, breath_rate_bpm, session_id })
      → backend rf_calibration.py compute_coherence_at_frequency()
        (4 Hz upstream rate matches backend uniform resampling grid — invariant preserved)
```

### Calibration control flow

```
User enters Calibration screen
  → Calibration.jsx: sensorContext.sendWS({ type: 'cal_start', session_id, mode })
    → backend: cal_active=true, BayesianRFOptimizer starts
      → 1 Hz { type: 'cal_progress', target_bpm, coherence_so_far, dwell_remaining, n_rr }
        → useSensorFrame('cal_progress', cb) in Calibration.jsx → UI update (no re-render of parent)
      → on lock: { type: 'cal_done', rf_bpm, rf_locked: true }
        → SensorProvider stores rfBpm, rfLocked in context state
        → Calibration.jsx onLocked(rfBpm, rfLocked) → navigates to Session
```

### What lives in context vs local screen state

| Data | Lives in | Rationale |
|---|---|---|
| `latestRR`, `latestHRV`, `latestResp` | SensorContext | Any screen may read; calibration phase 1 needs passive access |
| `bleStatus`, `micStatus`, `wsStatus` | SensorContext | SensorStatusBar reads from any screen |
| `rfBpm`, `rfLocked` | SensorContext | Session screen needs it; set once by cal_done |
| Calibration progress (`coherence_so_far`, `dwell_remaining`) | Local Calibration.jsx state | Only Calibration screen needs it |
| Session frame full payload (`vs_score`, `ans_state`, `mpc_score`) | Local Session.jsx state | Only Session screen renders these; pushing to context would re-render everything at 1 Hz |
| `insightData` | App.jsx local state | Post-session only; not needed during session |
| `cfg` (session_id, mode, timezone) | App.jsx local state | Routing concern, not sensor concern |

---

## Open Questions

**OQ1 — BLE requestDevice() gesture requirement.**  
`navigator.bluetooth.requestDevice()` requires a user gesture on every call — it cannot be triggered programmatically at auth time. The profile-save button tap is the proposed gesture, but this may be too early (user may not have the H10 nearby). Alternative: add an explicit "Connect H10" button on Landing screen that the user taps when ready. Decision needed before implementation.

**OQ2 — Mode selection timing.**  
Currently, sensor mode (Phone Only / H10 / Combined) is chosen on Setup screen, after which SensorFusion is started. With the persistent architecture, the mode must be known at `SensorProvider` init time, or the provider must support hot-switching modes. Hot-switching is complex (requires stopping/starting individual sensors). Proposed: lock mode at first BLE connect; show mode selector before the BLE connect step.

**OQ3 — Multiple sessions per app load.**  
The persistent WS design assumes the user can run multiple sessions without reloading. The backend's session state machine (B2, B3 above) needs to handle `session_start` arriving after a previous session has ended. Verify that `db.finish_session` and `HRVProcessor.reset()` are idempotent and can be called multiple times on the same WS connection.

**OQ4 — Background wake lock on iOS Safari.**  
`WakeLockSentinel` is released automatically by iOS when the app backgrounds. There is no way to prevent this. The 30 s background execution window is the real constraint. Quantify: how many RR intervals are typically lost in a 30 s background gap at 60 bpm? Answer: ~30 RR intervals (one per beat). This is within the `rrBuffer` cap (200) and will backfill on resume. Decide whether to surface this gap to the user as a data-quality warning in the session summary.

**OQ5 — `rPPG` mode and background.**  
In mode 1 (Phone Only, rPPG), the camera must be paused on background. This means the user effectively loses RR signal whenever the phone screens off. Mode 1 is not viable for background-continuous capture. Should the spec require H10 (mode 2 or 3) as a prerequisite for the background capture feature? Recommendation: yes — document mode 1 as foreground-only.

**OQ6 — Backend WS idle timeout on Railway.**  
Railway's default request timeout is 60 s for HTTP; WebSocket connections may be subject to a different limit. The 30 s ping-pong (B7) is the proposed mitigation. Verify the actual Railway WS idle timeout before implementing. If it is less than 30 s, reduce the ping interval accordingly.

**OQ7 — `useSensorFrame` callback stability.**  
`useSensorFrame(type, callback)` stores the callback in a ref registered on `SensorContext`. If `callback` is defined inline in a component, it will be a new function reference on every render. The hook must internally use `useCallback`-stable refs (store latest callback in a `useRef`, call the ref's current value) to avoid stale closures — the same stale-closure pattern already documented in project memory.

**OQ8 — Zustand vs SensorContext.**  
The existing `frontend/src/store/sessionStore.js` is a hand-rolled localStorage-backed store (52 lines). It currently holds `sensor_mode`, `user_id`, and session history. The new `SensorContext` will hold live sensor state. These should remain separate: `sessionStore` for persisted cross-session config, `SensorContext` for ephemeral in-memory sensor state. Do not merge them.
