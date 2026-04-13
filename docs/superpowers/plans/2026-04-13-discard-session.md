# Discard Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Discard session" button to the live session exit modal that abandons the session without writing final metrics, leaving raw snapshots in the DB.

**Architecture:** Frontend sends `{"cmd": "discard"}` over the existing WebSocket before closing it. Backend sets a `discard_flag` boolean and skips `finish_session()` in the `finally` block. Navigation goes to `/connect` instead of `/insights` on discard.

**Tech Stack:** React 18 + React Router, FastAPI + asyncio WebSocket, SQLite (via `storage.py`)

---

## File Map

| File | Change |
|---|---|
| `backend/main.py` | Add `discard_flag`, simulator non-blocking peek, real-sensor `elif` branch, `finally` guard |
| `frontend/src/components/LiveSessionScreen.jsx` | Add `discardRef`, update `ws.onclose`, update `ExitConfirmModal` component + call site |

---

### Task 1: Backend — add `discard_flag` and simulator non-blocking peek

**Files:**
- Modify: `backend/main.py:114-130`

- [ ] **Step 1: Add `discard_flag = False` after `fallback_triggered`**

In `backend/main.py`, find the block of session-level vars (around line 114). After the line `fallback_triggered = False`, add:

```python
    discard_flag = False
```

The block should now read:
```python
    traj: Trajectory | None = None
    prev_params: dict | None = None
    t_start = time.time()
    rmssd_start: float | None = None
    last_state = None
    last_ans = None
    fallback_triggered = False
    discard_flag = False
    state_dom_counter: dict[str, int] = {}
```

- [ ] **Step 2: Add non-blocking message peek at the top of the simulator cycle**

In `backend/main.py`, inside the `try: while True:` loop, the cycle starts with:
```python
            cycle_t0 = time.time()
            elapsed = cycle_t0 - t_start
            if elapsed >= duration_s:
                break

            # --- RR acquisition: ~1s of beats
            rrs: list[float] = []
            if sim is not None:
```

Replace that block with:
```python
            cycle_t0 = time.time()
            elapsed = cycle_t0 - t_start
            if elapsed >= duration_s:
                break

            # --- Check for discard/control messages (non-blocking, both modes)
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=0)
                msg_ctrl = json.loads(raw)
                if msg_ctrl.get("cmd") == "discard":
                    discard_flag = True
                    raise WebSocketDisconnect()
            except asyncio.TimeoutError:
                pass

            # --- RR acquisition: ~1s of beats
            rrs: list[float] = []
            if sim is not None:
```

- [ ] **Step 3: Verify the file looks correct**

Run:
```bash
cd C:/Users/user/Desktop/mission_alive
python -c "import ast; ast.parse(open('backend/main.py').read()); print('syntax OK')"
```
Expected: `syntax OK`

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: add discard_flag and simulator non-blocking message peek"
```

---

### Task 2: Backend — real-sensor discard branch + `finally` guard

**Files:**
- Modify: `backend/main.py:133-145` (real-sensor loop)
- Modify: `backend/main.py:213` (finally block)

- [ ] **Step 1: Add `elif` discard branch in the real-sensor message reader**

In `backend/main.py`, find the real-sensor receive block:
```python
                        msg = json.loads(raw)
                        if "rr" in msg:
                            rrs.append(float(msg["rr"]))
                        elif msg.get("cmd") == "stop":
                            raise WebSocketDisconnect()
```

Replace with:
```python
                        msg = json.loads(raw)
                        if "rr" in msg:
                            rrs.append(float(msg["rr"]))
                        elif msg.get("cmd") == "stop":
                            raise WebSocketDisconnect()
                        elif msg.get("cmd") == "discard":
                            discard_flag = True
                            raise WebSocketDisconnect()
```

- [ ] **Step 2: Guard `finish_session()` with `not discard_flag`**

In `backend/main.py`, find the `finally` block:
```python
    finally:
        # Finalize session record
        if last_state is not None and rmssd_start is not None:
```

Replace with:
```python
    finally:
        # Finalize session record (skipped on discard — snapshots kept, no final metrics)
        if not discard_flag and last_state is not None and rmssd_start is not None:
```

- [ ] **Step 3: Verify syntax**

```bash
cd C:/Users/user/Desktop/mission_alive
python -c "import ast; ast.parse(open('backend/main.py').read()); print('syntax OK')"
```
Expected: `syntax OK`

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: skip finish_session on discard, real-sensor discard branch"
```

---

### Task 3: Frontend — add `discardRef` and update `ws.onclose`

**Files:**
- Modify: `frontend/src/components/LiveSessionScreen.jsx:69` (refs block)
- Modify: `frontend/src/components/LiveSessionScreen.jsx:122` (ws.onclose)

- [ ] **Step 1: Add `discardRef` after `wsRef`**

In `LiveSessionScreen.jsx`, find:
```js
  const wsRef = useRef(null)
  const startFrameRef = useRef(null)
```

Replace with:
```js
  const wsRef = useRef(null)
  const discardRef = useRef(false)
  const startFrameRef = useRef(null)
```

- [ ] **Step 2: Update `ws.onclose` to branch on `discardRef.current`**

In `LiveSessionScreen.jsx`, find:
```js
      ws.onclose = () => {
        if (!cancelled) {
          setStartFrame(startFrameRef.current)
          setEndFrame(frameRef.current)
          navigate('/insights')
        }
      }
```

Replace with:
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

- [ ] **Step 3: Verify build passes**

```bash
cd C:/Users/user/Desktop/mission_alive/frontend
npm run build 2>&1 | tail -5
```
Expected: `built in` with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LiveSessionScreen.jsx
git commit -m "feat: add discardRef, navigate to /connect on discard"
```

---

### Task 4: Frontend — update `ExitConfirmModal` component + call site

**Files:**
- Modify: `frontend/src/components/LiveSessionScreen.jsx:329` (call site)
- Modify: `frontend/src/components/LiveSessionScreen.jsx:556` (component)

- [ ] **Step 1: Add `onDiscard` prop + button to the `ExitConfirmModal` component**

In `LiveSessionScreen.jsx`, find the `ExitConfirmModal` function definition:
```js
function ExitConfirmModal({ onConfirm, onCancel }) {
```

Replace with:
```js
function ExitConfirmModal({ onConfirm, onCancel, onDiscard }) {
```

Then find the two existing buttons inside the component:
```jsx
        <button
          onClick={onConfirm}
          style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                   background: 'var(--gradient-purple-blue)', color: '#fff',
                   fontSize: 15, fontWeight: 500, cursor: 'pointer', marginBottom: 10, minHeight: 44 }}>
          End &amp; save
        </button>
        <button
          onClick={onCancel}
          style={{ width: '100%', padding: '14px', borderRadius: 12,
                   border: '1px solid var(--border-medium)', background: 'transparent',
                   color: 'var(--text-secondary)', fontSize: 15, cursor: 'pointer', minHeight: 44 }}>
          Keep going
        </button>
```

Replace with:
```jsx
        <button
          onClick={onConfirm}
          style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                   background: 'var(--gradient-purple-blue)', color: '#fff',
                   fontSize: 15, fontWeight: 500, cursor: 'pointer', marginBottom: 10, minHeight: 44 }}>
          End &amp; save
        </button>
        <button
          onClick={onDiscard}
          style={{ width: '100%', padding: '14px', borderRadius: 12,
                   border: '1px solid rgba(239,68,68,0.4)', background: 'transparent',
                   color: '#ef4444', fontSize: 15, cursor: 'pointer', marginBottom: 10, minHeight: 44 }}>
          Discard session
        </button>
        <button
          onClick={onCancel}
          style={{ width: '100%', padding: '14px', borderRadius: 12,
                   border: '1px solid var(--border-medium)', background: 'transparent',
                   color: 'var(--text-secondary)', fontSize: 15, cursor: 'pointer', minHeight: 44 }}>
          Keep going
        </button>
```

- [ ] **Step 2: Wire `onDiscard` at the call site**

In `LiveSessionScreen.jsx`, find the `ExitConfirmModal` usage:
```jsx
        <ExitConfirmModal
          onConfirm={() => {
            setShowExitModal(false)
            wsRef.current?.close()
          }}
          onCancel={() => setShowExitModal(false)}
        />
```

Replace with:
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

- [ ] **Step 3: Verify build passes**

```bash
cd C:/Users/user/Desktop/mission_alive/frontend
npm run build 2>&1 | tail -5
```
Expected: `built in` with no errors (no new warnings expected).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LiveSessionScreen.jsx
git commit -m "feat: add Discard session button to ExitConfirmModal"
```

---

### Task 5: Manual end-to-end verification

**No files to modify — verification only.**

- [ ] **Step 1: Start the backend**

```bash
cd C:/Users/user/Desktop/mission_alive
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 2: Start the frontend dev server**

```bash
cd C:/Users/user/Desktop/mission_alive/frontend
npm run dev -- --host 0.0.0.0
```
Open `http://localhost:5173` in a browser.

- [ ] **Step 3: Test "Discard session" flow**

1. Select any session profile and start a session (simulator mode)
2. Wait ~10 seconds so at least one snapshot is logged
3. Tap "Pause experience" — the modal should show 3 buttons: **End & save**, **Discard session**, **Keep going**
4. Tap **Discard session**
5. Verify: app navigates to `/connect` (not `/insights`)
6. Verify: backend terminal shows no insight generation / `finish_session` call

- [ ] **Step 4: Test "End & save" still works**

1. Start another session, wait ~10 seconds
2. Tap "Pause experience" → tap **End & save**
3. Verify: app navigates to `/insights`
4. Verify: backend terminal shows `finish_session` ran (no errors)

- [ ] **Step 5: Test "Keep going" still works**

1. Start a session, tap "Pause experience" → tap **Keep going**
2. Verify: modal dismisses, session continues uninterrupted

- [ ] **Step 6: Test backdrop tap still dismisses (no accidental discard)**

1. Tap "Pause experience", then tap the dark backdrop outside the sheet
2. Verify: modal dismisses, session continues (same as Keep going)

- [ ] **Step 7: Verify DB state after discard**

```bash
cd C:/Users/user/Desktop/mission_alive
python - <<'EOF'
import sqlite3, json
con = sqlite3.connect("backend/sessions.db")
rows = con.execute("SELECT id, session_type, completed_at, insight FROM sessions ORDER BY started_at DESC LIMIT 3").fetchall()
for r in rows:
    print(r)
con.close()
EOF
```
Expected: the most recent discard row has `completed_at = None` and `insight = None`. The previous "End & save" row has both populated.

- [ ] **Step 8: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: <describe what you fixed>"
```
(Skip if no fixes needed.)
