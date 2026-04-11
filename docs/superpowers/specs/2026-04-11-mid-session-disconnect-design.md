# Mid-Session Polar H10 Disconnect — Design Spec
Date: 2026-04-11
CLAUDE.md task: V2.4 — Safety fallback: disconnect H10 mid-session → graceful degrade

## Summary

When the Polar H10 disconnects during an active session, the app auto-reconnects silently in the background (up to 5 attempts). Music keeps playing throughout. If all 5 attempts fail, a modal offers the user a choice to continue without sensor or end the session.

---

## Architecture

All reconnect logic lives in `PolarH10BLE`. `MainSession` is a pure UI consumer that reacts to emitted state. No new classes or files.

---

## PolarH10BLE Changes (`frontend/src/engines/polarH10BLE.js`)

### New state fields
- `this.reconnectAttempt = 0` — added to constructor
- `reconnectAttempt` — added to `_snapshot()` return object

### `_onDisconnected` rewritten
Currently: sets `status = 'disconnected'` and emits (3 lines).
New behaviour: async retry loop.

```
_onDisconnected = async () => {
  this.status = 'reconnecting'
  this._emit()

  for (let attempt = 1; attempt <= 5; attempt++) {
    this.reconnectAttempt = attempt
    this._emit()
    await sleep(2000)                          // 2s gap between attempts
    try {
      const server = await this._gattConnectWithTimeout(8000)
      const service = await server.getPrimaryService(HRM_SERVICE)
      this.char = await service.getCharacteristic(HRM_CHAR)
      await this.char.startNotifications()
      this.char.addEventListener('characteristicvaluechanged', this._handle)
      this.status = 'connected'
      this.reconnectAttempt = 0
      this._emit()
      return
    } catch {
      // continue to next attempt
    }
  }

  // exhausted
  this.status = 'error'
  this.error = 'reconnect_failed'
  this.reconnectAttempt = 0
  this._emit()
}
```

`sleep(ms)` is a local inline helper: `const sleep = ms => new Promise(r => setTimeout(r, ms))`.

`_gattConnectWithTimeout` is reused as-is — `this.device` is already paired so no `requestDevice` call needed.

---

## MainSession Changes (`frontend/src/components/MainSession.jsx`)

### Reconnect banner
Rendered when `bleStatus?.status === 'reconnecting'`. Non-blocking pill at top of screen.

```
"Reconnecting to H10… (2 / 5)"
```

- Color: `var(--sympathetic-a)` (amber/yellow)
- Does not block any session controls
- Disappears automatically when status returns to `'connected'`

### Exhaustion modal
Rendered when `bleStatus?.status === 'error' && bleStatus?.error === 'reconnect_failed'`.

```
Title: "Lost connection to H10"
Body:  "Couldn't reconnect after 5 attempts."
Button A: "Continue without sensor"  → dismiss modal, session keeps running
Button B: "End session"              → calls onExit
```

Follows the existing `ExitConfirmModal` pattern (inline state bool `showReconnectModal`).

---

## Data flow

```
H10 drops → gattserverdisconnected fires
  → _onDisconnected (async loop)
    → emits status='reconnecting', reconnectAttempt=N  →  MainSession shows banner
    → attempt succeeds                                 →  banner disappears, session continues
    → 5 attempts fail                                  →  emits status='error', error='reconnect_failed'
      → MainSession shows modal
        → "Continue" → modal gone, music holds at last params
        → "End"      → onExit
```

---

## What is NOT changing

- Music engine: no changes. Tone.js keeps playing last params throughout disconnect/reconnect.
- WebSocket: no changes. Backend continues at 1 Hz; RR gap is expected behaviour when sensor is out.
- `connect()` and `disconnect()` methods: unchanged.
- `_gattConnectWithTimeout`: unchanged, reused as-is.

---

## Constraints respected

- CLAUDE.md pipeline contract: "BLE/H10 | Mid-session disconnect | Graceful fallback to last known state" ✓
- Music never stops ✓
- No new files ✓
- No UI changes to ConnectScreen ✓
