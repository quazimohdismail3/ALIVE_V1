# Dashboard Redesign — Design Spec
**Date:** 2026-05-02  
**Status:** Draft  
**Version gate:** V2 (blocks V2.10 real-user testing)  
**Depends on:** Sensor Architecture spec (SensorContext), Auth/Landing spec (rename Landing→Dashboard)

---

## 1. Context and Constraints

### What exists today
`Landing.jsx` (127 lines, useState router) is both marketing shell and post-login screen. It holds a MODES array, sensor config card UI with circadian badges, and a "Start Session" flow that builds the `cfg` object passed downstream. It does **not** show session history, HRV state, or RF status.

App.jsx routing state machine: `login → landing → setup → calibration → session → insight`  
After this spec: `login → dashboard → setup → calibration → session → insight`

### What must be preserved
- V2 design tokens: `--vs-low:#E24B4A`, `--vs-mid:#EF9F27`, `--vs-good:#1D9E75`, `--vs-peak:#534AB7`
- Fonts: Outfit (headings), DM Sans (body), Figtree (numeric/metric)
- `v2-card` CSS class pattern used across InsightCard, HrvMetrics, etc.
- `cfg` object shape passed to Setup → Calibration → Session (do not break)
- `InsightCard` component — reuse as-is for history cards

### What must NOT happen
- Do not re-implement the full HRV chart (CoherenceBar, AffectQuadrant) — live strip only
- Do not add RAG/AI recommendations — rule-based only (project decision, RAG deferred to Phase 2)
- Do not tune HRV/ANS params — UNTUNED until real H10 data (LIVE STATE TABLE)
- Do not touch Session.jsx, Calibration.jsx, or the pipeline

---

## 2. Component Map

### New files
| File | Role |
|------|------|
| `frontend/src/pages/Dashboard.jsx` | Main component (replaces Landing.jsx role post-auth) |
| `frontend/src/components/RFStatusBadge.jsx` | RF confidence display + tap modal |
| `frontend/src/components/SessionHistoryCard.jsx` | Single history card row |
| `frontend/src/components/RecommendationCard.jsx` | Single recommendation card |
| `frontend/src/components/LiveHRVStrip.jsx` | HR + connection status strip |
| `frontend/src/hooks/useSessionHistory.js` | Fetches GET /api/sessions, manages loading/error state |
| `frontend/src/hooks/useRecommendations.js` | Fetches GET /api/recommendations, manages state |

### Renamed/modified files
| File | Change |
|------|--------|
| `frontend/src/pages/Landing.jsx` | Rename to `Dashboard.jsx`; gut interior; keep `cfg` build logic |
| `frontend/src/App.jsx` | Change `'landing'` screen case → `'dashboard'`; import Dashboard |
| `backend/main.py` | Add `GET /api/sessions` and `GET /api/recommendations` routes |

### Reused as-is
- `frontend/src/components/InsightCard.jsx` — used inside SessionHistoryCard
- `frontend/src/utils/circadian.js` — `getCurrentCircadianPhase()` used in recommendation rules
- `frontend/src/lib/api.js` — add `getSessions()` and `getRecommendations()` fetch wrappers

---

## 3. Dashboard Layout

```
┌─────────────────────────────────────────┐
│  [LiveHRVStrip]   ❤ 62 bpm  ● H10 ON  │  ← top bar, always visible if connected
├─────────────────────────────────────────┤
│  Good evening, Ismail                   │  ← greeting via circadian phase
│  [RFStatusBadge]  Draft RF: 5.5 bpm    │  ← tappable
├─────────────────────────────────────────┤
│  RECOMMENDED                            │
│  [RecommendationCard]  Focus · 15 min  │  ← 1–2 cards
│  [RecommendationCard]  Calm  · 10 min  │
├─────────────────────────────────────────┤
│  [  ▶  START SESSION  ]                │  ← full-width CTA
├─────────────────────────────────────────┤
│  RECENT SESSIONS                        │
│  [SessionHistoryCard] × 5–10           │
└─────────────────────────────────────────┘
```

Scroll: the full page scrolls. LiveHRVStrip and greeting are sticky at top. CTA stays above history.

---

## 4. Component Specs

### 4.1 `Dashboard.jsx`

**Props:** same as current Landing.jsx — `{ onStart, user, profile }` — so App.jsx change is minimal.

**State:**
```js
const { sessions, loading: sessionsLoading } = useSessionHistory(10)
const { recommendations } = useRecommendations()
const { latestHRV, latestRR, rfBpm, rfConfidenceTag, isConnected } = useSensorContext()
```

**Mount effect (background RF scan trigger):**
```js
useEffect(() => {
  if (!isConnected) return
  if (rfConfidenceTag === 'CONFIRMED') return
  // rfConfidenceTag is UNVALIDATED or DRAFT → trigger passive scan
  wsRef.current?.send(JSON.stringify({ type: 'rf_background_scan' }))
}, [isConnected, rfConfidenceTag])
```
`wsRef` is the shared SensorContext WebSocket ref — Dashboard does not open its own WS.

**Session type picker:** on "Start Session" tap → `setPickerOpen(true)` → renders `SessionTypePicker` inline overlay (three cards: Focus, Calm, Flow) → on pick → `onStart({ ...cfg, sessionType })`.

**App.jsx change:**
```js
// Before:
case 'landing': return <Landing onStart={...} />
// After:
case 'dashboard': return <Dashboard onStart={...} user={user} profile={profile} />
```
Also update `setScreen('landing')` → `setScreen('dashboard')` in ProfileSetup onComplete and discard path.

---

### 4.2 `LiveHRVStrip`

**Props:** `{ hr, rr, isConnected }`  
Consumed from SensorContext in Dashboard, passed down as props.

**Render logic:**
```jsx
// isConnected = false:
<div class="hrv-strip hrv-strip--offline">
  <span class="hrv-dot hrv-dot--grey" />
  <span>H10 not connected</span>
</div>

// isConnected = true, hr available:
<div class="hrv-strip hrv-strip--live">
  <span class="hrv-dot hrv-dot--pulse" />   // CSS pulse animation, #1D9E75
  <span class="hrv-bpm">{hr}</span>
  <span class="hrv-unit">bpm</span>
</div>
```

**No HRV metrics displayed here** — just HR and connection status. Full RMSSD is Session-screen only.

**CSS:** `.hrv-dot--pulse` uses `animation: hrv-pulse 1s ease-in-out infinite` — opacity 1→0.4→1. Period matches ~1Hz WS frame rate visually but is CSS-only (no JS timer).

---

### 4.3 `RFStatusBadge`

**Props:** `{ rfBpm, rfConfidenceTag }` — sourced from SensorContext in Dashboard.

**States and display text:**

| `rfConfidenceTag` | Badge text | Badge color |
|---|---|---|
| `UNVALIDATED` | Estimating RF… | `#7A7A96` (muted) |
| `DRAFT` | Draft RF: `{rfBpm}` bpm | `#EF9F27` (--vs-mid) |
| `REFINED` | Refining… `{rfBpm}` bpm | `#1D9E75` (--vs-good) |
| `CONFIRMED` | RF locked: `{rfBpm}` bpm ✓ | `#534AB7` (--vs-peak) |

`rfBpm` displayed to 1 decimal place only when tag is DRAFT, REFINED, or CONFIRMED.

**Tap behavior:** `setModalOpen(true)` → inline modal (not a route change).

**Modal content** (static, no data fetch):
```
What is RF?
Your Resonant Frequency (RF) is the breathing rate that
produces peak heart rate variability — typically 4.5–7 bpm.
We estimate it passively while you use the app.
[DRAFT/UNVALIDATED]: Still collecting data.
[CONFIRMED]: Locked after 3+ validated sessions.
```

**Implementation:** `<RFStatusBadge>` is self-contained with its own `useState(false)` for modal open state. No context needed beyond props.

---

### 4.4 `SessionHistoryCard`

**Props:**
```ts
{
  id: string
  created_at: string        // ISO-8601
  duration_s: number        // seconds
  vs_score_avg: number | null   // 0–100, null if unavailable
  rmssd_avg: number | null      // milliseconds, null if unavailable
  session_type: string      // 'focus' | 'calm' | 'flow'
}
```

**Renders using `InsightCard` pattern** (reuse `v2-card` class):
```jsx
<div class="v2-card session-history-card" onClick={() => onTap(id)}>
  <div class="shc-left">
    <div class="shc-type-badge">{SESSION_ICON[session_type]}</div>
  </div>
  <div class="shc-body">
    <div class="shc-date">{formatRelativeDate(created_at)}</div>
    <div class="shc-meta">
      {formatDuration(duration_s)} · {session_type}
    </div>
  </div>
  <div class="shc-right">
    {vs_score_avg != null && (
      <div class="shc-vs" style={{ color: vsColor(vs_score_avg) }}>
        {Math.round(vs_score_avg)}
      </div>
    )}
    {rmssd_avg != null && (
      <div class="shc-rmssd">{Math.round(rmssd_avg)} ms</div>
    )}
  </div>
</div>
```

**SESSION_ICON map:** `{ focus: '🎯', calm: '🌊', flow: '✨' }` — no emoji if user `prefers-reduced-motion` (use text label instead).

**`formatRelativeDate(iso)`:** "Today", "Yesterday", "Mon 28 Apr" — use `Intl.DateTimeFormat`.

**`formatDuration(s)`:** "8 min", "12 min" — `Math.round(s / 60) + ' min'`.

**`vsColor(score)`:** score < 40 → `--vs-low`, 40–69 → `--vs-mid`, 70–89 → `--vs-good`, ≥90 → `--vs-peak`.

**Tap:** `onTap(id)` → App.jsx sets `screen = 'insight'` with `insightSessionId = id`. Insight.jsx must accept a session ID prop to load historical data (this is a separate spec concern — stub for now).

**Empty state** (no sessions yet):
```jsx
<div class="shc-empty">
  No sessions yet. Start your first session above.
</div>
```

---

### 4.5 `RecommendationCard`

**Props:**
```ts
{
  session_type: 'focus' | 'calm' | 'flow'
  duration_min: number
  reason: string    // short label: "Morning window", "Recovery needed", "Time for a check-in"
  cta: string       // "Start Focus" | "Start Calm" | "Start Flow"
}
```

**Renders:**
```jsx
<div class="v2-card rec-card" onClick={() => onStart({ sessionType: session_type, durationMin: duration_min })}>
  <div class="rec-type">{session_type}</div>
  <div class="rec-duration">{duration_min} min</div>
  <div class="rec-reason">{reason}</div>
  <button class="rec-cta">{cta}</button>
</div>
```

Tapping the card is equivalent to tapping the CTA — both call `onStart` with pre-filled session type.

---

### 4.6 `useSessionHistory(limit = 10)`

```js
export function useSessionHistory(limit = 10) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getSessions(limit)             // from lib/api.js
      .then(data => { if (!cancelled) setSessions(data) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [limit])

  return { sessions, loading, error }
}
```

---

### 4.7 `useRecommendations()`

```js
export function useRecommendations() {
  const [recommendations, setRecommendations] = useState([])

  useEffect(() => {
    getRecommendations()           // from lib/api.js
      .then(setRecommendations)
      .catch(() => setRecommendations([]))  // silent fail — no recommendations shown
  }, [])

  return { recommendations }
}
```

Silent fail: if the endpoint is unreachable, the section simply does not render. No error UI.

---

## 5. API Contracts

### 5.1 `GET /api/sessions`

**Auth:** Bearer JWT (same pattern as GET /api/baseline — use `get_current_user` dependency).

**Query params:** `?limit=10` (default 10, max 20).

**Response:**
```json
[
  {
    "id": "uuid",
    "created_at": "2026-04-30T14:22:00Z",   // ISO-8601, from started_at epoch
    "duration_s": 487.3,
    "vs_score_avg": 72.4,                    // null if unavailable (SQLite fallback)
    "rmssd_avg": 54.2,                       // null if unavailable
    "session_type": "focus"
  }
]
```

**Backend implementation notes:**

Two DB paths — gate on `DATABASE_URL` like all other Postgres paths:

**Postgres path (DATABASE_URL set):**
```python
# db.py already has sessions table with peak_vs, final_vs, rmssd
# vs_score_avg = (peak_vs + final_vs) / 2 if both present, else whichever is non-null
rows = await db.get_sessions(user_id, limit)
return [_format_session_row(r) for r in rows]
```

**SQLite fallback path:**
```python
rows = storage.list_sessions(user_id=user_id, limit=limit)
# SQLite sessions table has: rmssd_start, rmssd_end, duration_s, session_type, started_at
# rmssd_avg = (rmssd_start + rmssd_end) / 2 if both non-null, else None
# vs_score_avg = None (not stored in SQLite schema)
```

**`_format_session_row(row)` helper:**
```python
def _format_session_row(row: dict) -> dict:
    rmssd_start = row.get("rmssd_start") or row.get("rmssd")
    rmssd_end = row.get("rmssd_end")
    rmssd_vals = [v for v in [rmssd_start, rmssd_end] if v is not None]
    rmssd_avg = sum(rmssd_vals) / len(rmssd_vals) if rmssd_vals else None

    peak_vs = row.get("peak_vs")
    final_vs = row.get("final_vs")
    vs_vals = [v for v in [peak_vs, final_vs] if v is not None]
    vs_avg = sum(vs_vals) / len(vs_vals) if vs_vals else None

    started_at = row.get("started_at") or row.get("created_at")
    created_at_iso = (
        datetime.utcfromtimestamp(started_at).isoformat() + "Z"
        if isinstance(started_at, (int, float)) else str(started_at)
    )

    return {
        "id": row["id"],
        "created_at": created_at_iso,
        "duration_s": row.get("duration_s"),
        "vs_score_avg": round(vs_avg, 1) if vs_avg is not None else None,
        "rmssd_avg": round(rmssd_avg, 1) if rmssd_avg is not None else None,
        "session_type": row.get("session_type", "unknown"),
    }
```

**Route registration in main.py:**
```python
@app.get("/api/sessions")
async def get_sessions(
    limit: int = Query(10, ge=1, le=20),
    user=Depends(get_current_user),
):
    user_id = user["sub"]
    if os.environ.get("DATABASE_URL"):
        rows = await db.get_sessions(user_id, limit)
    else:
        rows = storage.list_sessions(user_id=user_id, limit=limit)
    return [_format_session_row(dict(r)) for r in rows]
```

**`db.get_sessions()` — add to db.py:**
```python
async def get_sessions(user_id: str, limit: int = 10) -> list[dict]:
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, started_at, duration_s, peak_vs, final_vs, rmssd,
                      session_type
               FROM sessions
               WHERE user_id = $1
               ORDER BY started_at DESC
               LIMIT $2""",
            user_id, limit
        )
        return [dict(r) for r in rows]
```

---

### 5.2 `GET /api/recommendations`

**Auth:** Bearer JWT.

**Response:**
```json
[
  {
    "session_type": "focus",
    "duration_min": 15,
    "reason": "Morning window",
    "cta": "Start Focus"
  },
  {
    "session_type": "calm",
    "duration_min": 10,
    "reason": "Recovery needed",
    "cta": "Start Calm"
  }
]
```

Maximum 2 items. May return 0 items (empty array) — UI handles gracefully.

**Rule logic (Python, in main.py or a new `backend/recommendations.py`):**

```python
from datetime import datetime, timezone
import math

def build_recommendations(
    sessions: list[dict],          # from get_sessions() or list_sessions(), already sorted DESC
    baseline_rmssd: float | None,  # from db.get_baseline() or None
    client_tz_offset_hours: float = 0,
) -> list[dict]:
    """
    Rule-based recommendations. Returns 0–2 dicts.
    No ML. No RAG. Pure logic.
    """
    now_local_hour = (datetime.now(timezone.utc).hour + client_tz_offset_hours) % 24
    recs = []

    # --- Rule 1: Circadian window ---
    # MORNING_RISE (6–9) or PEAK (9–12) → recommend Focus
    if 6 <= now_local_hour < 12:
        recs.append({
            "session_type": "focus",
            "duration_min": 15,
            "reason": "Morning window",
            "cta": "Start Focus",
            "_priority": 1,
        })
    # EVENING_WIND (18–21) → recommend Calm
    elif 18 <= now_local_hour < 21:
        recs.append({
            "session_type": "calm",
            "duration_min": 10,
            "reason": "Wind down",
            "cta": "Start Calm",
            "_priority": 1,
        })
    # NIGHT (21–6) → recommend Calm, shorter
    elif now_local_hour >= 21 or now_local_hour < 6:
        recs.append({
            "session_type": "calm",
            "duration_min": 7,
            "reason": "Late evening",
            "cta": "Start Calm",
            "_priority": 1,
        })
    # AFTERNOON_PEAK (15–18) → recommend Flow
    elif 15 <= now_local_hour < 18:
        recs.append({
            "session_type": "flow",
            "duration_min": 12,
            "reason": "Afternoon energy",
            "cta": "Start Flow",
            "_priority": 1,
        })
    # POST_LUNCH_DIP (13–15) → recommend Calm
    elif 13 <= now_local_hour < 15:
        recs.append({
            "session_type": "calm",
            "duration_min": 10,
            "reason": "Post-lunch reset",
            "cta": "Start Calm",
            "_priority": 1,
        })

    # --- Rule 2: Time since last session ---
    # If no sessions in last 24h → add a "check-in" nudge (second slot only)
    last_session_age_h = None
    if sessions:
        last_started = sessions[0].get("started_at") or sessions[0].get("created_at")
        if isinstance(last_started, (int, float)):
            last_session_age_h = (datetime.now(timezone.utc).timestamp() - last_started) / 3600
        elif isinstance(last_started, str):
            # ISO string — parse it
            try:
                ts = datetime.fromisoformat(last_started.replace("Z", "+00:00")).timestamp()
                last_session_age_h = (datetime.now(timezone.utc).timestamp() - ts) / 3600
            except ValueError:
                pass

    if last_session_age_h is None or last_session_age_h > 24:
        # No recent session — nudge a short calm if we don't already have calm in slot 1
        if not any(r["session_type"] == "calm" for r in recs):
            recs.append({
                "session_type": "calm",
                "duration_min": 10,
                "reason": "Time for a check-in",
                "cta": "Start Calm",
                "_priority": 2,
            })

    # --- Rule 3: RMSSD vs baseline (recovery indicator) ---
    # Requires: baseline_rmssd is known AND last session has rmssd_avg/rmssd_end
    if baseline_rmssd and sessions:
        last_rmssd = sessions[0].get("rmssd_avg") or sessions[0].get("rmssd_end")
        if last_rmssd is not None:
            ratio = last_rmssd / baseline_rmssd
            # ratio < 0.85 → RMSSD meaningfully suppressed → recommend recovery Calm
            if ratio < 0.85 and len(recs) < 2:
                recs.append({
                    "session_type": "calm",
                    "duration_min": 10,
                    "reason": "Recovery needed",
                    "cta": "Start Calm",
                    "_priority": 3,
                })
            # ratio >= 0.90 and morning → upgrade focus rec to longer if present
            elif ratio >= 0.90 and 6 <= now_local_hour < 12:
                for r in recs:
                    if r["session_type"] == "focus":
                        r["duration_min"] = 20
                        r["reason"] = "Strong baseline — full focus block"

    # Deduplicate: if two calm recs, keep only the higher-priority one
    seen_types = set()
    deduped = []
    for r in sorted(recs, key=lambda x: x["_priority"]):
        if r["session_type"] not in seen_types:
            seen_types.add(r["session_type"])
            deduped.append({k: v for k, v in r.items() if k != "_priority"})

    return deduped[:2]
```

**Route in main.py:**
```python
@app.get("/api/recommendations")
async def get_recommendations(
    client_tz_offset: float = Query(0.0, ge=-12, le=14),
    user=Depends(get_current_user),
):
    user_id = user["sub"]
    # Fetch sessions (last 5 sufficient for rules)
    if os.environ.get("DATABASE_URL"):
        sessions = await db.get_sessions(user_id, limit=5)
    else:
        sessions = storage.list_sessions(user_id=user_id, limit=5)

    # Fetch baseline RMSSD (optional — rules degrade gracefully without it)
    baseline_rmssd = None
    if os.environ.get("DATABASE_URL"):
        try:
            b = await db.get_baseline(user_id)
            baseline_rmssd = b.get("rmssd_mean") if b else None
        except Exception:
            pass

    return build_recommendations(
        sessions=[dict(r) for r in sessions],
        baseline_rmssd=baseline_rmssd,
        client_tz_offset_hours=client_tz_offset,
    )
```

**Frontend call** (in `lib/api.js`):
```js
export async function getRecommendations(session) {
  const tzOffsetHours = -(new Date().getTimezoneOffset()) / 60
  return apiFetch(`/api/recommendations?client_tz_offset=${tzOffsetHours}`, { session })
}
```

---

### 5.3 WebSocket: `rf_background_scan`

**Client → server:**
```json
{ "type": "rf_background_scan" }
```

Sent once on Dashboard mount if `rfConfidenceTag` ∈ `{UNVALIDATED, DRAFT}` and H10 is connected. The existing WS session (`/ws/session`) handles this during calibration phase — the background scan fires the same optimizer path but outside a full session.

**Server → client (streaming updates):**
```json
{
  "type": "rf_background_update",
  "rf_bpm": 5.6,
  "rf_coherence": 0.42,
  "rf_confidence_tag": "DRAFT",
  "n_observations": 4
}
```

Sent whenever `rf_optimizer.observe()` produces a new best estimate.

**Server final (scan complete or confidence locked):**
```json
{
  "type": "rf_background_update",
  "rf_bpm": 5.5,
  "rf_coherence": 0.78,
  "rf_confidence_tag": "CONFIRMED",
  "n_observations": 12,
  "locked": true
}
```

**Backend handling:** Add `elif msg_type == "rf_background_scan":` branch in the existing WS `async for` loop in `ws_session()`. Run the existing `BayesianRFOptimizer` sweep on incoming RR data. Reuse `compute_coherence_at_frequency` from `rf_calibration.py`. No new process, no new WS connection.

**`rfConfidenceTag` mapping from `n_observations` and `rf_coherence`:**
```python
def _rf_confidence_tag(rf_locked: bool, rf_coherence: float, n_obs: int) -> str:
    if rf_locked and rf_coherence >= 0.7:
        return "CONFIRMED"
    if n_obs >= 6 and rf_coherence >= 0.5:
        return "REFINED"
    if n_obs >= 2:
        return "DRAFT"
    return "UNVALIDATED"
```

**SensorContext** receives `rf_background_update` frames and updates `rfBpm` + `rfConfidenceTag` state. RFStatusBadge re-renders reactively.

---

## 6. `lib/api.js` additions

```js
// Add alongside existing apiFetch calls:

export async function getSessions(limit = 10) {
  // session = Supabase session object (has access_token)
  // apiFetch already handles auth header injection
  return apiFetch(`/api/sessions?limit=${limit}`)
}

export async function getRecommendations() {
  const tzOffsetHours = -(new Date().getTimezoneOffset()) / 60
  return apiFetch(`/api/recommendations?client_tz_offset=${tzOffsetHours}`)
}
```

Both functions use the existing `apiFetch` wrapper that injects the Supabase JWT Bearer token. No new auth plumbing needed.

---

## 7. App.jsx Changes

Surgical — only two changes:

**1. Import:**
```js
// Remove: import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
```

**2. Screen case:**
```js
// Remove:
case 'landing': return <Landing onStart={handleStart} />

// Add:
case 'dashboard': return (
  <Dashboard
    onStart={handleStart}
    user={user}
    profile={profile}
  />
)
```

**3. All `setScreen('landing')` calls → `setScreen('dashboard')`:**
- ProfileSetup `onComplete` callback
- Session `onDiscard` callback
- Any "go home" nav in Insight

That's 3 string replacements. No logic changes.

---

## 8. Design Tokens and CSS

All new components use existing tokens. No new CSS variables.

**New CSS classes needed** (add to `App.css` or a new `dashboard.css`):

```css
/* LiveHRVStrip */
.hrv-strip { display: flex; align-items: center; gap: 8px; padding: 10px 16px;
             background: var(--surface-1); border-bottom: 1px solid var(--surface-2); }
.hrv-strip--offline { opacity: 0.5; }
.hrv-dot { width: 8px; height: 8px; border-radius: 50%; background: #7A7A96; }
.hrv-dot--pulse { background: var(--vs-good, #1D9E75);
                  animation: hrv-pulse 1s ease-in-out infinite; }
@keyframes hrv-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.hrv-bpm { font-family: Figtree, sans-serif; font-size: 18px; font-weight: 600;
           color: var(--text); font-variant-numeric: tabular-nums; }
.hrv-unit { font-size: 12px; color: #7A7A96; }

/* RFStatusBadge */
.rf-badge { display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 20px;
            background: var(--surface-2); cursor: pointer;
            font-size: 13px; font-weight: 500; }

/* SessionHistoryCard */
.session-history-card { display: flex; align-items: center; gap: 12px; cursor: pointer; }
.shc-left { flex-shrink: 0; }
.shc-body { flex: 1; min-width: 0; }
.shc-date { font-size: 13px; color: var(--text); font-weight: 500; }
.shc-meta { font-size: 11px; color: #7A7A96; margin-top: 2px; }
.shc-right { flex-shrink: 0; text-align: right; }
.shc-vs { font-family: Figtree, sans-serif; font-size: 20px; font-weight: 700;
          font-variant-numeric: tabular-nums; }
.shc-rmssd { font-size: 11px; color: #7A7A96; margin-top: 2px; }
.shc-empty { color: #7A7A96; font-size: 14px; text-align: center; padding: 24px 0; }

/* RecommendationCard */
.rec-card { cursor: pointer; }
.rec-type { font-size: 11px; color: #7A7A96; text-transform: uppercase;
            letter-spacing: 0.06em; margin-bottom: 2px; }
.rec-duration { font-family: Figtree, sans-serif; font-size: 22px; font-weight: 700;
                color: var(--text); }
.rec-reason { font-size: 13px; color: #7A7A96; margin-top: 4px; }
.rec-cta { margin-top: 12px; padding: 8px 16px; border-radius: 20px;
           background: #534AB7; color: #fff; border: none; cursor: pointer;
           font-size: 14px; font-weight: 600; }

/* Start Session CTA */
.dashboard-cta { width: 100%; padding: 16px; border-radius: 14px;
                 background: #534AB7; color: #fff; border: none;
                 font-size: 17px; font-weight: 700; cursor: pointer;
                 margin: 20px 0; }
```

---

## 9. Data Flow Diagram

```
SensorContext
  ├── latestHRV.hr ──────────────────────────→ LiveHRVStrip (hr prop)
  ├── isConnected ───────────────────────────→ LiveHRVStrip (isConnected prop)
  ├── rfBpm ─────────────────────────────────→ RFStatusBadge (rfBpm prop)
  ├── rfConfidenceTag ────────────────────────→ RFStatusBadge (rfConfidenceTag prop)
  │                                          → Dashboard useEffect (scan trigger)
  └── wsRef ─────────────────────────────────→ Dashboard useEffect (send rf_background_scan)

Dashboard
  ├── useSessionHistory(10) → GET /api/sessions → SessionHistoryCard × N
  ├── useRecommendations()  → GET /api/recommendations → RecommendationCard × 1-2
  └── onStart(cfg) ─────────────────────────→ App.jsx → screen='setup'

Backend
  GET /api/sessions
    ├── Postgres: db.get_sessions() → peak_vs, final_vs, rmssd
    └── SQLite:  storage.list_sessions() → rmssd_start, rmssd_end (no vs_score)

  GET /api/recommendations
    ├── db.get_sessions(limit=5) [or storage.list_sessions]
    ├── db.get_baseline() → rmssd_mean
    └── build_recommendations(sessions, baseline_rmssd, tz_offset) → list[dict]

  WS /ws/session
    ← rf_background_scan
    → rf_background_update (streaming, multiple frames)
    → rf_background_update { locked: true } (terminal)
```

---

## 10. Failure Modes and Fallbacks

| Failure | Expected behavior |
|---|---|
| GET /api/sessions fails | `sessions = []` → "No sessions yet" empty state. No error banner. |
| GET /api/recommendations fails | `recommendations = []` → section not rendered. Silent. |
| H10 not connected on mount | `isConnected = false` → no `rf_background_scan` sent. LiveHRVStrip shows offline state. |
| rfConfidenceTag = CONFIRMED on mount | No `rf_background_scan` sent. Badge shows locked state. |
| WS disconnected while on Dashboard | `isConnected = false` → LiveHRVStrip goes offline. No crash. |
| `vs_score_avg = null` (SQLite fallback) | SessionHistoryCard renders without VS number. RMSSD shown if available. |
| `rmssd_avg = null` | SessionHistoryCard renders with just date and duration. |
| `baseline_rmssd = null` (new user) | Rule 3 skipped. Rules 1 and 2 still apply. 1–2 circadian recs returned. |

---

## 11. Implementation Order

Do these in order. Each is independently testable.

1. **Backend: `GET /api/sessions`** — add route + `_format_session_row` + `db.get_sessions()`. Test: `curl -H "Authorization: Bearer $TOKEN" localhost:8000/api/sessions` returns array.

2. **Backend: `build_recommendations()` + `GET /api/recommendations`** — add to main.py or new `backend/recommendations.py`. Test: call with known sessions array and baseline, assert output shape.

3. **Frontend: `useSessionHistory` + `useRecommendations` hooks** — wire to API. Test: mock fetch, assert state updates.

4. **Frontend: `SessionHistoryCard`** — render with mock data. Visual check: date, duration, VS color, RMSSD.

5. **Frontend: `RecommendationCard`** — render with mock props. Tap calls onStart with correct sessionType.

6. **Frontend: `LiveHRVStrip`** — render connected/disconnected states. Pulse animation visible.

7. **Frontend: `RFStatusBadge`** — all 4 confidence tag states render correctly. Modal opens/closes.

8. **Frontend: `Dashboard.jsx`** — compose all components. Mount effect for RF scan trigger.

9. **App.jsx string replacements** — `'landing'` → `'dashboard'` (3 sites).

10. **End-to-end test** — Dashboard loads, history renders, recommendation shows, badge updates on H10 connect.

---

## 12. Out of Scope for This Spec

- Insight screen loading historical session data by ID (tap on SessionHistoryCard → Insight) — the `onTap(id)` call is wired but Insight.jsx changes are a separate spec.
- Session type picker UI details (Focus/Calm/Flow cards) — handled in Setup.jsx spec.
- PWA offline caching of session history — V2.6 scope.
- `SensorContext` implementation details — covered in Sensor Architecture spec.
- Any Stripe, monetization, or V4+ features.
