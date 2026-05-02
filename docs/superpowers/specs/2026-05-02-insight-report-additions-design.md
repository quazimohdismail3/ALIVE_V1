# Design Spec: Insight + Report Screen Additions
**Date:** 2026-05-02  
**Scope:** Additions only — do not redesign existing Insight.jsx or Report.jsx  
**Size:** Small (3 UI additions + 1 API field + 2 backend wires)

---

## What Already Exists (Do Not Touch)

**`Insight.jsx`** — fully functional:
- VS score hero (peak + final, color-coded)
- Narrative debrief paragraph (intro + retention + avg RMSSD)
- 2×2 InsightCard grid: Duration, Avg RMSSD, RF Lock, Dominant ANS
- Recommendation code block (R1–R5 by dominant ANS state)
- Next session card
- "Done" button → `onDone()` → `App.jsx` sets screen to `'landing'`

**`Report.jsx`** — separate simpler page, dark-mode only:
- R1 (VS summary), R2 (RMSSD change), R8 (arc journey), R16 (skill transfer)
- Conditional R15 (mode 1 signal quality warning), R17 (circadian mismatch)
- "New session" button → `onDone()`
- **Note:** Report.jsx is NOT in the App.jsx routing. `screen='insight'` routes to `Insight.jsx`. Report.jsx appears to be a legacy/parallel component — confirm with owner whether it should be deprecated or wired. Do not add features to it in this sprint.

**`InsightCard.jsx`** — accepts `{ icon, title, value, sub, accent }`. The `sub` prop exists but is unused in the current grid. No changes needed.

**Navigation:** `onDone` in Insight.jsx already goes to `'landing'` (Dashboard), not back to Session. This is correct. No change needed.

---

## Current Data Available at Insight Screen

`insightData` (built by `useSessionAccum.summarize()`, passed via `App.jsx → Session → Insight`):

```js
{
  peak_vs, final_vs, skill_transfer,   // integers
  avg_rmssd,                           // integer ms, or null
  dominant_ans,                        // string key or null
  rf_locked,                           // bool
  rf_bpm,                              // float or null (last frame value)
  session_phase, session_type,
  duration_s, frames_total,
  circadian_phase, circadian_fit,      // both null currently
}
```

**What is NOT currently available at Insight:**
- User's RMSSD baseline (`rmssd_mean`, `rmssd_sd`, `source`) — not fetched
- `rfConfidenceTag` (UNVALIDATED / DRAFT / REFINED / CONFIRMED) — not in profile schema
- Session count (to determine tag) — not in summary

---

## Additions

### 1. RF Confidence Progress Bar

**Where:** Bottom of `Insight.jsx`, above the "Done" button.

**Condition:** Render only if `data.rf_bpm != null`.

**Confidence tag logic:** The tag (UNVALIDATED / DRAFT / REFINED / CONFIRMED) is not yet stored anywhere. The backend saves `rf_bpm` per session to the `sessions` table but does NOT store it in the user profile. The profile schema (`backend/api/profile.py`) has no RF fields at all.

**Two implementation options — pick one before building:**

**Option A (simpler, no new backend work):** Derive tag from session count already stored in the baseline row. `GET /api/baseline` already returns `n_sessions_used`. Map:
- 0 sessions → UNVALIDATED (25%)
- 1–2 sessions → DRAFT (50%)  
- 3–4 sessions → REFINED (75%)
- 5+ sessions → CONFIRMED (100%)

This is an approximation but requires zero new backend work.

**Option B (correct, small backend work):** Add `rf_bpm` and `rf_confidence_tag` fields to the user profile. Backend saves best-session RF after each session that achieves `rf_locked=True`. Tag uses the same mapping above, but driven by `n_sessions_with_rf_locked` rather than all baseline sessions.

**Recommendation: Option A for this sprint.** Wire Option B when Calibration screen gets its own redesign.

**Component to add:** `RFConfidenceBar` — inline in `Insight.jsx`, not extracted to a component file unless it exceeds ~30 lines.

**Spec for Option A:**

```jsx
// In Insight.jsx, after the metrics grid, before the recommendation block
// Fetch baseline on mount: GET /api/baseline (already exists)
// insightData.rf_bpm must be non-null to render

function tagFromSessionCount(n) {
  if (n === 0) return { tag: 'UNVALIDATED', pct: 25, nextIn: null };
  if (n <= 2)  return { tag: 'DRAFT',       pct: 50, nextIn: 3 - n };
  if (n <= 4)  return { tag: 'REFINED',     pct: 75, nextIn: 5 - n };
  return              { tag: 'CONFIRMED',   pct: 100, nextIn: null };
}
```

**Display:**
```
Your breathing frequency · 5.5 bpm
[████████░░░░░░░░] 50%
DRAFT — refines over your next 2 sessions
```
If CONFIRMED: show "CONFIRMED ✓" in accent color, no sub-line.

**Data fetch:** Add a `useEffect` in `Insight.jsx` that calls `GET /api/baseline` on mount. Store result in local state `baseline`. The existing `GET /api/baseline` endpoint already exists in `backend/api/baseline.py` and returns `{ rmssd_mean, rmssd_sd, rmssd_min, rmssd_max, source, n_sessions_used, posterior_precision }`.

**Styling:** Match existing `v2-card` wrapper. Progress bar: `height: 6px`, `border-radius: 3px`, background `var(--surface-2)`, fill `var(--primary)` (or `#1D9E75` for CONFIRMED). Width: 100% of card, capped at content area.

---

### 2. Session vs Baseline InsightCard

**Where:** Add as a 5th card in the existing 2×2 InsightCard grid (making it 3-column or wrapping to a 3rd row). Simplest: make it a full-width card below the 2×2 grid in its own row.

**Condition:** Render only if `baseline?.rmssd_mean != null && data.avg_rmssd != null`.

**Data:** Uses the same `baseline` state fetched in Addition 1 above (single fetch, two consumers).

**Calculation:**
```js
const delta = data.avg_rmssd - baseline.rmssd_mean;
const pct   = Math.round((delta / baseline.rmssd_mean) * 100);
const sign  = delta >= 0 ? '+' : '';
// value: "42ms (+18%)"  or  "38ms (−5%)"
// accent: delta >= 0 ? '#1D9E75' : '#EF9F27'   (green up, amber down)
```

**Baseline source caveat:** When `baseline.source === 'cold_start'`, the baseline is a population prior, not personal data. Show `sub="vs population estimate"` instead of `sub="vs your baseline"` in that case.

**Component:** Use existing `InsightCard` as-is:
```jsx
<InsightCard
  icon="📊"
  title="vs Baseline"
  value={`${data.avg_rmssd}ms (${sign}${pct}%)`}
  sub={baseline.source === 'cold_start' ? 'vs population estimate' : 'vs your baseline'}
  accent={delta >= 0 ? '#1D9E75' : '#EF9F27'}
/>
```

**No new API endpoint needed.** `GET /api/baseline` already provides `rmssd_mean`. The session's `avg_rmssd` comes from `insightData`.

---

### 3. Share Card (Copy to Clipboard)

**Where:** Below the "Next session" card, above the "Done" button.

**Condition:** Always shown (no guard needed — session data is always present here).

**Component:** Inline in `Insight.jsx` — not a separate component.

**Format string:**
```
Mission Alive · {session_type_label} · {duration_min}m · VS {peak_vs} · RMSSD {avg_rmssd}ms{baseline_delta} · RF {rf_bpm}
```

Examples:
- `Mission Alive · Find Your Calm · 10m · VS 74 · RMSSD 42ms (+18%) · RF 5.5 bpm`
- `Mission Alive · Wind Down · 8m · VS 61 · RMSSD 38ms · RF —` (if no rf_bpm)

**Logic:**
```js
function buildShareText(data, baseline) {
  const label = SESSION_LABEL[data.session_type] ?? data.session_type ?? 'Session';
  const dur   = Math.round((data.duration_s ?? 0) / 60);
  const rmssd = data.avg_rmssd ? `${data.avg_rmssd}ms` : '—';
  let delta   = '';
  if (baseline?.rmssd_mean && data.avg_rmssd) {
    const pct = Math.round(((data.avg_rmssd - baseline.rmssd_mean) / baseline.rmssd_mean) * 100);
    delta = ` (${pct >= 0 ? '+' : ''}${pct}%)`;
  }
  const rf = data.rf_bpm ? `${data.rf_bpm.toFixed(1)} bpm` : '—';
  return `Mission Alive · ${label} · ${dur}m · VS ${data.peak_vs} · RMSSD ${rmssd}${delta} · RF ${rf}`;
}
```

**Button:**
```jsx
<button onClick={() => navigator.clipboard.writeText(buildShareText(data, baseline))}>
  Copy insight
</button>
```

Style: secondary style (outlined, not filled). Label changes to "Copied ✓" for 2s via `useState` then resets. No external calls, no social APIs.

---

## Files to Change

| File | Change |
|------|--------|
| `frontend/src/pages/Insight.jsx` | Add `useEffect` fetch of `GET /api/baseline`, local `baseline` state; add `RFConfidenceBar` section; add baseline InsightCard; add share button + `buildShareText` |
| `frontend/src/lib/api.js` | Add `getBaseline()` function (1 fetch call to `/api/baseline`) |
| `backend/api/profile.py` | No change (Option A) |
| `backend/api/baseline.py` | No change — endpoint already exists and returns `n_sessions_used` |
| `frontend/src/pages/Report.jsx` | No change — out of scope; confirm deprecation separately |
| `frontend/src/components/InsightCard.jsx` | No change — existing `sub` prop already supported |
| `frontend/src/App.jsx` | No change — `onDone → landing` navigation already correct |

---

## API Changes Required

None for Option A. The `GET /api/baseline` endpoint already exists and returns everything needed.

**Existing response shape** (confirmed from `backend/api/baseline.py`):
```json
{
  "rmssd_mean": 42.5,
  "rmssd_sd": 8.2,
  "rmssd_min": 34.3,
  "rmssd_max": 50.7,
  "source": "cold_start" | "blended" | "personal",
  "n_sessions_used": 2,
  "posterior_precision": 0.0148
}
```

---

## Success Criteria

1. RF bar renders when `rf_bpm != null`; does not render when null.
2. Tag and percentage match `n_sessions_used` mapping correctly at all 4 thresholds.
3. Baseline card renders when both `baseline.rmssd_mean` and `avg_rmssd` are present; absent otherwise.
4. `source === 'cold_start'` shows "vs population estimate" sub-label.
5. Copy button writes correct formatted string to clipboard; shows "Copied ✓" for 2s.
6. Single `GET /api/baseline` fetch, not two (both sections share same state).
7. "Done" button still routes to Landing (no regression).
8. `npm run build` passes with no new warnings.

---

## Out of Scope

- Report.jsx additions (separate decision needed on its role)
- Persisting `rf_bpm` to user profile (Option B — deferred to Calibration redesign)
- Social sharing (by design — clipboard only)
- SDNN / SD1 / SD2 / DFA display (already in existing HRV metrics component; not added to Insight)
- SessionTimeline (not currently rendered in Insight.jsx — separate addition if wanted)
