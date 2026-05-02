# Insight + Report Screen Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three self-contained UI additions to `Insight.jsx` — RF Confidence Bar, Session vs Baseline card, and a Copy-to-Clipboard share button — all sharing a single `GET /api/baseline` fetch.

**Architecture:** A single `useEffect` on mount fetches `GET /api/baseline` and stores it in a `baseline` local state variable; both the RF bar and the baseline InsightCard read from that same state, so there is exactly one network call. All logic lives inline in `Insight.jsx`; no new files or backend endpoints are required.

**Tech Stack:** React (useState, useEffect), existing `InsightCard` component, `navigator.clipboard`, `frontend/src/lib/api.js` (add `getBaseline`), existing `GET /api/baseline` FastAPI endpoint.

---

## Task 1 — Add `getBaseline()` to api.js

**File:** `frontend/src/lib/api.js`

**Success criteria:** `getBaseline()` is exported; it fetches `/api/baseline` with auth headers and returns the parsed JSON; it follows the exact same pattern as `getProfile()`.

- [ ] Open `frontend/src/lib/api.js`.
- [ ] Append the following function after `putProfile`:

```js
export async function getBaseline() {
  const headers = await authHeaders()
  const r = await fetch(`${API_URL}/api/baseline`, { headers })
  if (!r.ok) throw new Error(`getBaseline failed: ${r.status}`)
  return r.json()
}
```

- [ ] Verify the file still parses: `cd frontend && npx tsc --noEmit` (or `npm run build` — expected: no new errors).
- [ ] Commit: `git add frontend/src/lib/api.js && git commit -m "feat(api): add getBaseline() client helper"`

---

## Task 2 — RF Confidence Bar

**File:** `frontend/src/pages/Insight.jsx`

**Success criteria:**
- Bar renders when `data.rf_bpm != null`; absent when null.
- Tag and fill percentage match `n_sessions_used` at all four thresholds (0 → UNVALIDATED 25%, 1–2 → DRAFT 50%, 3–4 → REFINED 75%, 5+ → CONFIRMED 100%).
- CONFIRMED shows accent color `#1D9E75`; all others use `var(--primary)`.
- "Done" button regression: still calls `onDone()`.

### 2a — Add `baseline` state + `useEffect` fetch

In `Insight.jsx`, add `useState` to the existing import and import `getBaseline`:

```js
import { useEffect, useState } from 'react';
// ...existing imports...
import { getBaseline } from '../lib/api.js';
```

Inside the `Insight` component, after the existing `useWakeLock` line and before the existing `useEffect`, add:

```js
const [baseline, setBaseline] = useState(null);

useEffect(() => {
  getBaseline()
    .then(setBaseline)
    .catch(() => {}); // non-critical; degrade silently
}, []);
```

### 2b — Add `tagFromSessionCount` helper + `SESSION_LABEL` map

Add these two items at module scope (before the component), alongside the existing `R_CODES` and `NEXT_SESSION` maps:

```js
const SESSION_LABEL = {
  find_your_calm:    'Find Your Calm',
  wind_down:         'Wind Down',
  morning_emergence: 'Morning Emergence',
};

function tagFromSessionCount(n) {
  if (n === 0) return { tag: 'UNVALIDATED', pct: 25,  nextIn: null };
  if (n <= 2)  return { tag: 'DRAFT',       pct: 50,  nextIn: 3 - n };
  if (n <= 4)  return { tag: 'REFINED',     pct: 75,  nextIn: 5 - n };
  return              { tag: 'CONFIRMED',   pct: 100, nextIn: null };
}
```

### 2c — Render the RF Confidence Bar

Place this block **after the metrics grid `</div>` and before the recommendation code block**, inside the main return:

```jsx
{/* RF Confidence Bar — only when rf_bpm is present */}
{rf_bpm != null && (
  <div className="v2-card fade-slide-up" style={{ marginBottom: 16 }}>
    <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
      Breathing Frequency
    </div>
    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
      Your breathing frequency · {rf_bpm.toFixed(1)} bpm
    </div>
    {(() => {
      const n = baseline?.n_sessions_used ?? 0;
      const { tag, pct, nextIn } = tagFromSessionCount(n);
      const isConfirmed = tag === 'CONFIRMED';
      const fillColor = isConfirmed ? '#1D9E75' : 'var(--primary)';
      return (
        <>
          <div style={{ background: 'var(--surface-2)', borderRadius: 3, height: 6, marginBottom: 8, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: fillColor, borderRadius: 3, transition: 'width 0.6s ease' }} />
          </div>
          <div style={{ fontSize: 12, color: isConfirmed ? '#1D9E75' : 'var(--text-dim)' }}>
            {isConfirmed
              ? 'CONFIRMED ✓'
              : `${tag} — refines over your next ${nextIn} session${nextIn === 1 ? '' : 's'}`}
          </div>
        </>
      );
    })()}
  </div>
)}
```

- [ ] Make the above changes to `Insight.jsx`.
- [ ] Manually verify in browser: start a session with RF lock → go to Insight → bar appears. Start a session without RF lock → bar absent.
- [ ] `npm run build` in `frontend/` — expected: exits 0, no new warnings.
- [ ] Commit: `git add frontend/src/pages/Insight.jsx && git commit -m "feat(insight): add RF confidence bar (Option A, session-count tag)"`

---

## Task 3 — Session vs Baseline InsightCard (5th card)

**File:** `frontend/src/pages/Insight.jsx`

**Success criteria:**
- Card renders only when both `baseline?.rmssd_mean != null` and `data.avg_rmssd != null`.
- `source === 'cold_start'` → sub reads "vs population estimate"; otherwise "vs your baseline".
- Positive delta → accent `#1D9E75`; negative → `#EF9F27`.
- Value format: `"42ms (+18%)"` or `"38ms (−5%)"`.
- The existing 2×2 grid cards are untouched.

### 3a — Compute delta values

Inside the `Insight` component, after the existing destructuring block, add:

```js
// Baseline delta — only defined when both values are present
const baselineDelta = baseline?.rmssd_mean != null && avg_rmssd != null
  ? (() => {
      const delta = avg_rmssd - baseline.rmssd_mean;
      const pct   = Math.round((delta / baseline.rmssd_mean) * 100);
      const sign  = delta >= 0 ? '+' : '';
      return { delta, pct, sign, accent: delta >= 0 ? '#1D9E75' : '#EF9F27' };
    })()
  : null;
```

### 3b — Render the baseline InsightCard

Place this block **after the closing `</div>` of the metrics grid** (the `gridTemplateColumns: '1fr 1fr'` div) and **before the RF Confidence Bar block added in Task 2**:

```jsx
{/* Session vs Baseline — full-width 5th card */}
{baselineDelta != null && (
  <div style={{ marginBottom: 12 }}>
    <InsightCard
      icon="📊"
      title="vs Baseline"
      value={`${avg_rmssd}ms (${baselineDelta.sign}${baselineDelta.pct}%)`}
      sub={baseline.source === 'cold_start' ? 'vs population estimate' : 'vs your baseline'}
      accent={baselineDelta.accent}
    />
  </div>
)}
```

- [ ] Make the above changes to `Insight.jsx`.
- [ ] Manually verify: with a cold-start baseline the sub reads "vs population estimate"; with a personal baseline the sub reads "vs your baseline"; when `avg_rmssd` is null (mode 1 fallback) the card is absent.
- [ ] `npm run build` — expected: exits 0.
- [ ] Commit: `git add frontend/src/pages/Insight.jsx && git commit -m "feat(insight): add session-vs-baseline InsightCard"`

---

## Task 4 — Share Button (Copy to Clipboard)

**File:** `frontend/src/pages/Insight.jsx`

**Success criteria:**
- Button labeled "Copy insight" copies the formatted string to clipboard on click.
- Label changes to "Copied ✓" for 2 seconds then resets to "Copy insight".
- Output string matches spec format: `Mission Alive · {label} · {dur}m · VS {peak_vs} · RMSSD {rmssd}{delta} · RF {rf}`.
- Button uses outlined secondary style (not filled).
- "Done" button position and behaviour are unchanged.

### 4a — Add `copied` state

Add a second piece of local state alongside `baseline`:

```js
const [copied, setCopied] = useState(false);
```

### 4b — Add `buildShareText` helper at module scope

Place alongside the other module-scope helpers (`tagFromSessionCount`, `SESSION_LABEL`):

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

### 4c — Add `handleCopy` handler inside the component

```js
function handleCopy() {
  navigator.clipboard.writeText(buildShareText(data, baseline));
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
}
```

### 4d — Render the share button

Place this block **after the Next Session card and before the Done CTA button**, replacing the existing `{/* Done CTA */}` comment block structure. Keep the Done button exactly as-is immediately after:

```jsx
{/* Share — copy to clipboard */}
<button
  onClick={handleCopy}
  className="touch-target"
  style={{
    width: '100%', background: 'transparent', color: 'var(--primary)',
    border: '1.5px solid var(--primary)', borderRadius: 14, padding: '14px',
    fontWeight: 600, fontSize: 15, cursor: 'pointer',
    fontFamily: 'var(--font-head)', letterSpacing: '-0.01em',
    marginBottom: 12,
  }}
>
  {copied ? 'Copied ✓' : 'Copy insight'}
</button>
```

- [ ] Make the above changes to `Insight.jsx`.
- [ ] Manually verify in browser: click "Copy insight" → paste into Notes — confirm format. Button label flips to "Copied ✓" and resets after 2s.
- [ ] Verify "Done" button still navigates to Landing.
- [ ] `npm run build` — expected: exits 0.
- [ ] Commit: `git add frontend/src/pages/Insight.jsx && git commit -m "feat(insight): add copy-to-clipboard share button"`

---

## Final Verification Checklist

Run after all 4 tasks are committed:

- [ ] `npm run build` in `frontend/` — exits 0, no new warnings.
- [ ] RF bar: renders when `rf_bpm != null`, hidden when null.
- [ ] RF bar tag thresholds: n=0 → UNVALIDATED 25%, n=1 → DRAFT 50%, n=3 → REFINED 75%, n=5 → CONFIRMED 100%.
- [ ] Baseline card: renders when `baseline.rmssd_mean` and `avg_rmssd` both present; absent otherwise.
- [ ] `source === 'cold_start'` shows "vs population estimate" sub-label.
- [ ] Copy button writes correct string; "Copied ✓" shows for 2s then resets.
- [ ] Single `GET /api/baseline` call on mount (check Network tab — one request).
- [ ] "Done" button still routes to Landing screen.
- [ ] No `.env` or secrets in any changed file.
