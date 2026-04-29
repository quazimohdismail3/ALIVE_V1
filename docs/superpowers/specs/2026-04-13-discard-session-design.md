
# Discard Session — Design Spec
**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** Add a third "Discard session" option to the live session exit modal

---

## Problem

The `ExitConfirmModal` in `LiveSessionScreen.jsx` offers two choices when the user taps "Pause experience":
- **End & save** — closes WebSocket, backend writes final metrics, navigates to `/insights`
- **Keep going** — dismisses modal, session continues

There is no way to abandon a session without saving it. Users who started a bad session (wrong profile, accidental start) have no clean exit.

---

## Decision

**Soft abandon:** skip `finish_session()` on the backend (no final metrics written), keep raw snapshots in DB, navigate back to `/connect`.

Not a hard delete — snapshots are preserved for debugging. Session row remains in DB without final metrics.

---

## Architecture

### Signal mechanism: WebSocket `{"cmd": "discard"}` (Option A)

Frontend sends a discard command over the existing WebSocket connection before closing it. Backend sets a `discard_flag` and skips `finish_session()` in the `finally` block. No new endpoints, no schema changes.

---

## Frontend Changes (`LiveSessionScreen.jsx`)

### 1. New ref — discard intent flag
```js
const discardRef = useRef(false)
```
Set to `true` before closing WS on discard, so `ws.onclose` can navigate differently.

### 2. `ExitConfirmModal` — add `onDiscard` prop + button
- New prop: `onDiscard`
- New button between "End & save" and "Keep going":
  - Label: **Discard session**
  - Style: ghost with red text (`#ef4444`) — destructive visual signal
  - `minHeight: 44`, full width, same border radius as "Keep going"
- Backdrop tap remains mapped to `onCancel` (no accidental discard)

### 3. Call site — wire `onDiscard` handler
```jsx
<ExitConfirmModal
  onConfirm={() => {
    setShowExitModal(false)
    wsRef.current?.close()
  }}
  onCancel={() => setShowExitModal(false)}
  onDiscard={() => {
    setShowExitModal(false)
    discardRef.current = true
    wsRef.current?.send(JSON.stringify({ cmd: 'discard' }))
    wsRef.current?.close()
  }}
/>
```

### 4. `ws.onclose` — branch on discard intent
```js
ws.onclose = () => {
  if (!cancelled) {
    setStartFrame(startFrameRef.current)
    setEndFrame(frameRef.current)
    if (discardRef.current) {
      navigate('/connect')
    } else {
      navigate('/insights')
    }
  }
}
```

---

## Backend Changes (`backend/main.py`)

### 1. Add discard flag (near line 113)
```python
discard_flag = False
```

### 2. Simulator loop — non-blocking message peek (top of each cycle)
```python
try:
    raw = await asyncio.wait_for(websocket.receive_text(), timeout=0)
    if json.loads(raw).get("cmd") == "discard":
        discard_flag = True
        raise WebSocketDisconnect()
except (asyncio.TimeoutError, Exception):
    pass
```
Place this before the RR acquisition block so it's checked every ~1s cycle.

### 3. Real-sensor loop — add `elif` branch in the message reader
```python
elif msg.get("cmd") == "discard":
    discard_flag = True
    raise WebSocketDisconnect()
```

### 4. `finally` block — conditional `finish_session()`
```python
finally:
    if not discard_flag and last_state is not None and rmssd_start is not None:
        # ... existing finish_session() call unchanged ...
```

---

## Data Outcome

| Action | Session row | Snapshots | Final metrics | Navigation |
|---|---|---|---|---|
| End & save | ✅ kept | ✅ kept | ✅ written | `/insights` |
| Discard | ✅ kept | ✅ kept | ❌ skipped | `/connect` |

---

## What This Does NOT Change

- `ReconnectFailedModal` — unaffected
- Session snapshot logging — continues unchanged during session
- `finish_session()` logic — unchanged, just conditionally skipped
- Any other navigation flows

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/components/LiveSessionScreen.jsx` | Add `discardRef`, update `ExitConfirmModal` + call site + `ws.onclose` |
| `backend/main.py` | Add `discard_flag`, simulator peek, real-sensor branch, `finally` guard |
