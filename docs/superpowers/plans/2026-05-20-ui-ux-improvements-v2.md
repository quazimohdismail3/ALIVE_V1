# UI/UX Improvements V2 — Implementation Plan

**Branch:** `ui-ux-improvements-v2`
**Date:** 2026-05-20
**Scope:** 8 main items + per-screen quick wins, executed by 3 parallel coder agents (A/B/C).
**Constraint banner:**
- "Magic stays backstage" — no new user-facing numbers beyond HR/HRV. RF/coherence/dwell/confidence expressed as motion + color only.
- `:focus-visible` rules **before** component rules in CSS.
- Reduced-motion: `.screen { opacity: 1 }` must hold.
- `100dvh` not `100vh` everywhere.
- ExitConfirmModal pattern: `onConfirm` calls **only** `wsRef.close()`; `ws.onclose` fires `onExit`. Do not double-call.
- Surgical changes only — match existing inline-style idiom in each file. Do not refactor adjacent code.

---

## File Ownership Table (CRITICAL — no two agents touch the same file)

| File | Owner | Reason |
|------|-------|--------|
| `frontend/src/App.jsx` | **B only** | Adds `h10-intro` screen state, routes between profile-setup → h10-intro → calibration. |
| `frontend/src/pages/Session.jsx` | **A only** | Items 1, 2, tap-reveal RF coherence, target-orb subtitle. |
| `frontend/src/components/BreathPhaseLabel.jsx` | **A** (new) | Item 1 — phase-word component used by Session. |
| `frontend/src/components/ReconnectOverlay.jsx` | **A** (new) | Item 5 — shared overlay. Created by A, imported by both A (Session) and B (Calibration). |
| `frontend/src/pages/H10Intro.jsx` | **B** (new) | Item 3. |
| `frontend/src/pages/CalibrationScreen.jsx` | **B only** | Reconnect integration + HR bpm fontSize 9→11. |
| `frontend/src/pages/LoginScreen.jsx` | **B only** | Error mapping + tab active border 0.35→0.55. |
| `frontend/src/lib/authErrors.js` | **B** (new) | `mapAuthError(err)` helper. |
| `frontend/src/copy/index.js` | **B** (new) | Microcopy directory bootstrap (tiny stub re-export). |
| `frontend/src/copy/h10IntroCopy.js` | **B** (new) | Copy for H10Intro slide. |
| `frontend/src/pages/Dashboard.jsx` | **C only** | Item 7 (circadian default + "Best for this time of day" header). |
| `frontend/src/pages/Insight.jsx` | **C only** | Item 8 (ANS narrative + share copy with date+ANS). |
| `frontend/src/copy/insightTemplates.js` | **C** (new) | Lives in the same directory B creates. Different file → no edit conflict. |
| `frontend/src/pages/SplashScreen.jsx` | **C only** | Subtitle copy. |
| `frontend/src/pages/ProfileSetup.jsx` | **C only** | Move sex-norms one-liner above the choice. |
| `frontend/src/styles/global.css` | **C only** | Item 4 CSS hooks, reduced-motion fix, any new `@keyframes`. |

**Anti-conflict rules:**
- **A never edits App.jsx.** If A needs a new screen entry, document it here for B (none required — Session is already routed).
- **C never edits App.jsx.** Same.
- **A does not add new CSS to global.css.** A uses inline `<style>` or inline animation/transition strings inside Session/BreathPhaseLabel/ReconnectOverlay. If A wants a globally-defined keyframe, document the name here for C to add.
- **B creates `frontend/src/copy/` directory** with `index.js` (re-export stub) and `h10IntroCopy.js`. C's `insightTemplates.js` lands in the same directory but is a different file. If C runs before B (race), C must create the directory itself; both agents should use `mkdir -p` semantics (create-if-missing) and write fresh files.
- **ReconnectOverlay handoff:** A creates the new file. B imports `ReconnectOverlay` in CalibrationScreen.jsx by path `../components/ReconnectOverlay.jsx`. No edit conflict because the file did not previously exist and only A writes it.

---

## A — Coder A: Session screen

### A1. Item 1 — Breath phase label

**New file:** `frontend/src/components/BreathPhaseLabel.jsx`

Behavioral spec:
- Reads `--rf-measured-period` (fallback to `--rf-calibrated-period`, fallback to `10s`) on each animation frame via `requestAnimationFrame`.
- Maintains a `startTime` ref; on each frame compute `t = ((now - startTime) / 1000) % period`.
- Phase map (4-7-8 style symmetric breath, simplified to a 4-phase resonance pattern):
  - `0 .. 0.40 * period` → "Inhale"
  - `0.40 .. 0.50 * period` → "Hold"
  - `0.50 .. 0.90 * period` → "Exhale"
  - `0.90 .. 1.00 * period` → "Pause"
- When period changes (CSS var update), reset `startTime` to keep transitions smooth.
- Renders a single `<div>` with the current phase word. Style passed via prop `color` (the ansColor from Session). Uppercase, letter-spacing 0.18em, fontSize 10, lineHeight 1, transition `color 800ms ease, opacity 600ms ease`. minHeight 14 (matches existing gap area).
- Pure component, no external state, no lifecycle leaks (cleanup `cancelAnimationFrame` on unmount).
- Respects `prefers-reduced-motion` — when reduced, render the phase word but skip the animation timing; default to "Breathe" word.

**Edit:** `frontend/src/pages/Session.jsx`
- Add import line near other component imports: `import { BreathPhaseLabel } from '../components/BreathPhaseLabel.jsx';`
- Locate the "Gap indicator / resonance label" block (Session.jsx lines ~349–359).
- Replace the inner expression so the *non-resonance* branch renders `<BreathPhaseLabel color={ansColor} />` instead of the `↓ X.X off` / `↑ X.X off` string.
- Keep `inResonance` branch — but item 2 changes that copy (see A2).

Acceptance test:
- During session, when breathing rate differs from target, label cycles Inhale → Hold → Exhale → Pause synced to the inner orb's expand/contract.
- No off-by-X.X bpm number visible anywhere in that gap row.
- Color tracks ANS color smoothly on state change.

### A2. Item 2 — Resonance lock micro-celebration

**Edit:** `frontend/src/pages/Session.jsx`
- Line 285: change `setTimeout(() => setJustLocked(false), 1000)` → `setTimeout(() => setJustLocked(false), 3000)`.
- Line 298: change resonanceFlash animation duration from `1000ms` → `3000ms` (and a gentler easing — `ease-in-out`).
- In the gap-indicator block (~350–359), when `inResonance` is true, render text "Resonance. Stay here." instead of just "RESONANCE". Lowercase-period style; keep letter-spacing 0.1em, textTransform uppercase off for this string (use natural case). Set fontSize 11.
- Add a sustained orb halo: while `justLocked`, the *live orb* `boxShadow` should hold at the locked value (already conditional on `inResonance`). Add `transition: 'box-shadow 1200ms ease, border-color 1200ms ease, transform 1200ms ease'` (already partially there). Add a subtle additional inner highlight via inline `outline: 1px solid ${ansColor}33` while `inResonance && justLocked`.

Acceptance test:
- On lock, glow holds for 3s (visually verifiable by stopwatch).
- "Resonance. Stay here." appears, fades out with normal label transitions.
- 5s cooldown still applies between flashes.

### A3. Item — Tap-to-reveal RF coherence (cross-cutting #7 within Session only)

**Edit:** `frontend/src/pages/Session.jsx`
- Add state `const [showAdvanced, setShowAdvanced] = useState(false);`
- The "RF coherence bar" block (~489–509) is currently always-rendered when `frame.rf_coherence != null`. Wrap it: render only when `showAdvanced` is true.
- Above (or in place of) it when `!showAdvanced` and `frame?.rf_coherence != null`, render a tiny "…" button (24x24 circular, `background: rgba(255,255,255,0.06)`, `color: var(--text-dim)`, `fontSize: 14`) centered. onClick → `setShowAdvanced(true)`.
- Once revealed, optionally render a small "Hide" link below the bar that toggles back.

Acceptance test: RF coherence row is hidden by default. Tap "…" → it slides into view. Magic stays backstage by default.

### A4. Target orb subtitle

**Edit:** `frontend/src/pages/Session.jsx`
- Inside the "Target orb" container (line 333–347), below the existing `target` label or alongside it, add one extra `<div>` below the orb (not inside it — keep the orb circle visually clean). Position: directly above the gap-indicator (around line 348). Text: "Your calibrated resonance frequency."
- Style: fontSize 10, color `rgba(255,255,255,0.32)`, textAlign center, marginTop -8 (snug under orb), letterSpacing 0.02em, textTransform none.
- Only render when `frame?.rf_calibrated_hz` is present.

Acceptance test: subtitle visible under the upper orb in the first ~5s of session; copy is exactly "Your calibrated resonance frequency."

### A5. Item 5 — Reconnect overlay (Session side)

**New file:** `frontend/src/components/ReconnectOverlay.jsx`

Component contract:
- Props: `{ visible, onManualRetry, retryAttempt, maxRetries }`
- Renders fixed-position full-screen overlay (z-index 150, below tooltips at 200), translucent `rgba(10,10,15,0.78)`, backdrop-filter blur(8px).
- Centered card: small spinner (use same border-spin trick as App.jsx loading), heading "Reconnecting to Polar H10", subtext "Attempt {retryAttempt}/{maxRetries} — keep the strap on your chest. We're holding your session."
- "Retry now" button (manual retry), and "End session" secondary button (calls `onManualRetry({ end: true })` so parent decides).
- Respects reduced-motion: spinner becomes a static dot if `prefers-reduced-motion`.
- Use `minHeight: '100dvh'`.

**Edit:** `frontend/src/pages/Session.jsx`
- Add state: `const [reconnecting, setReconnecting] = useState(false);` and `const [retryAttempt, setRetryAttempt] = useState(0);`
- In WS setup (~137), attach `ws.ws.onclose` handler that:
  - Distinguishes user-initiated close (cleanup path, where `wsRef.current` becomes null in `cleanup()`) from mid-session close. Use a ref `userClosedRef` set to true in `cleanup()` and `endSession()`.
  - If not user-initiated and `bleStatus !== 'failed'` (and elapsed < sessionDurationS), set `reconnecting = true`, kick off retry with backoff 1s/2s/4s up to 3 attempts.
- Retry path: re-call the same WS setup logic (extract into a `connectWs()` local function inside `startSession` so the close handler can recall it).
- On retry success (`auth_ok` received), `setReconnecting(false)` and `setRetryAttempt(0)`.
- On 3 failed attempts, leave overlay visible with manual-retry button only.
- Manual retry button: resets retryAttempt to 0, calls `connectWs()`.
- DO NOT call `cleanup()` during reconnect — keep `fusionRef`, `audioRef`, `timerRef` alive (audio can be paused via `audioRef.current?.pause?.()` — if no pause method exists, skip; do not break audio).
- Render `<ReconnectOverlay visible={reconnecting} onManualRetry={...} retryAttempt={retryAttempt} maxRetries={3} />` near the DiscardSheet at the bottom of the JSX.

Acceptance test:
- Manually kill backend mid-session → overlay appears within 1s, auto-retry once backend restarts → overlay disappears, session continues from prior elapsed time, audio resumes.
- User-initiated end (End → button) does NOT show overlay.

### A6. CSS vars A may want C to add to global.css

None required — A uses inline animation strings or component-local `<style>` blocks (matches Session.jsx idiom).

---

## B — Coder B: Onboarding & Errors

### B1. Item 3 — Pre-calibration H10 explainer

**New file:** `frontend/src/pages/H10Intro.jsx`

Behavior:
- Single-page calm slide. Background `#0A0A0F`, centered card layout matching CalibrationScreen.jsx connect-phase style.
- Hero icon (📡 or use the same outlined-body SVG simplified). Title "Meet your Polar H10". Subtitle "A chest strap that listens to your heartbeat — the only signal sensitive enough to map your nervous system."
- 3 bullets (with subtle dot icons):
  1. **Wet the electrodes** — a few drops of water on the inside strip improves contact.
  2. **Strap below your chest** — snug, not tight. Just under the pectoral line.
  3. **Stay still for the first minute** — your resonance frequency takes ~60 seconds to find.
- Primary CTA "Connect H10" → calls `onContinue()`.
- Secondary link "I've used this before — skip" → also `onContinue()` but writes `localStorage.setItem('h10_intro_seen', '1')`.
- Top-right "Skip" link for explicit skip with persistence.
- Use `100dvh`, accept `onContinue` prop only.

**New file:** `frontend/src/copy/index.js`

```js
// Microcopy directory bootstrap. Single source of truth for user-facing strings
// that live outside of any one screen. Add named exports here as the catalog grows.
export * from './h10IntroCopy.js';
```

**New file:** `frontend/src/copy/h10IntroCopy.js`

```js
export const H10_INTRO_COPY = {
  title: 'Meet your Polar H10',
  subtitle: 'A chest strap that listens to your heartbeat — the only signal sensitive enough to map your nervous system.',
  bullets: [
    { title: 'Wet the electrodes', body: 'A few drops of water on the inside strip improves contact.' },
    { title: 'Strap below your chest', body: 'Snug, not tight. Just under the pectoral line.' },
    { title: 'Stay still for the first minute', body: 'Your resonance frequency takes about 60 seconds to find.' },
  ],
  cta: 'Connect H10',
  skip: 'I’ve used this before — skip',
};
```

**Edit:** `frontend/src/App.jsx`
- Add import: `import H10Intro from './pages/H10Intro.jsx';`
- Replace the post-profile routing effect (~71-78) so that when profile resolves non-null:
  - If `localStorage.getItem('h10_intro_seen') === '1'` → `setScreen('calibration')`
  - Else → `setScreen('h10-intro')`
- Also in ProfileSetup's `onComplete` (~107-114): after `setProfile(p)`, route to `h10-intro` (if not seen) else `calibration`. Extract into a helper `routeAfterProfile(p)`.
- Add a new screen branch between profile-setup and calibration: `if (screen === 'h10-intro') return <H10Intro onContinue={() => { try { localStorage.setItem('h10_intro_seen', '1') } catch (_) {} ; setScreen('calibration') }} />`

Acceptance test:
- First-time signup → after ProfileSetup, see H10Intro → Connect H10 → CalibrationScreen.
- Sign out, log back in → ProfileSetup is skipped (profile exists), H10Intro is also skipped (localStorage flag), go straight to CalibrationScreen.
- Clear localStorage → H10Intro appears again.

### B2. Item 5 — Reconnect overlay (Calibration side)

**Edit:** `frontend/src/pages/CalibrationScreen.jsx`
- Import: `import { ReconnectOverlay } from '../components/ReconnectOverlay.jsx';` (A creates this file).
- Use the existing `bleStatus === 'reconnecting'` derived state. Render `<ReconnectOverlay visible={bleStatus === 'reconnecting' && phase === 'calibrating'} retryAttempt={1} maxRetries={3} onManualRetry={() => requestBle()} />`.
- On the WS `addEventListener('error', …)` branch (line ~92), instead of immediately going to `phase === 'error'`, first try one auto-reconnect (re-instantiate WSClient with same args). If that fails, then set phase to 'error'. Implementation: add a ref `wsRetryCountRef = useRef(0)`; on error, if `wsRetryCountRef.current < 1`, increment and recall `startCalibration()` after 1s; otherwise set the error phase.

Acceptance test: Kill backend during calibration → overlay appears, calibration WS reconnects, calibration resumes without losing collected RR.

### B3. CalibrationScreen HR label fontSize

**Edit:** `frontend/src/pages/CalibrationScreen.jsx` line 260
- `fontSize="9"` → `fontSize="11"` on the `bpm` text element under the heart SVG.

### B4. Item 6 — LoginScreen error mapping

**New file:** `frontend/src/lib/authErrors.js`

```js
// Map Supabase auth error codes / messages to user-friendly copy.
// Falls back to original message when no mapping matches.
const MAP = [
  { match: /Invalid login credentials/i, msg: 'That email or password didn’t match. Try again.' },
  { match: /Email not confirmed/i, msg: 'Check your inbox to confirm your email before signing in.' },
  { match: /User already registered/i, msg: 'An account with that email already exists. Try signing in.' },
  { match: /rate limit/i, msg: 'Too many attempts. Wait a minute and try again.' },
  { match: /Password should be at least/i, msg: 'Password needs at least 6 characters.' },
  { match: /Unable to validate email address/i, msg: 'That email address doesn’t look right.' },
  { match: /network|fetch/i, msg: 'Network hiccup. Check your connection and retry.' },
];

export function mapAuthError(err) {
  if (!err) return null;
  const msg = typeof err === 'string' ? err : (err.message ?? String(err));
  for (const entry of MAP) {
    if (entry.match.test(msg)) return entry.msg;
  }
  return msg;
}
```

**Edit:** `frontend/src/pages/LoginScreen.jsx`
- Import `mapAuthError` from `../lib/authErrors.js`.
- Replace every `setError(error.message)` with `setError(mapAuthError(error))`.
- Tab active border: line 126 `borderColor: 'rgba(255,255,255,0.35)'` → `'rgba(255,255,255,0.55)'`.

Acceptance test: type wrong password → see "That email or password didn't match. Try again." Sign up with existing email → see "An account with that email already exists. Try signing in."

---

## C — Coder C: Dashboard, Insight, polish, CSS

### C1. Item 7 — Dashboard circadian default

**Edit:** `frontend/src/pages/Dashboard.jsx`
- Compute "recommended" session at mount based on hour-of-day:
  - 5–11h → `morning_emergence`
  - 12–17h → `find_your_calm`
  - 18–23h → `wind_down`
  - 0–4h → `wind_down`
- After `SESSION_LIST` derived (~89), compute `RECOMMENDED_ID` and initialize `sessionId` state to it (instead of `SESSION_LIST[0].id`). Use the existing `circadianBadge()` to confirm it has a "Best now" fit for the hour; if not, fall back to first.
- Above the session-picker list (~242-244), add a small badge row: "Best for this time of day" with a subtle dot. Style: fontSize 10, color `#00D084`, letterSpacing 0.08em, textTransform uppercase, marginBottom 8. Only show if a recommended session exists for current hour.
- Do NOT change the existing "Best now" per-card badges (they stay).
- If `recs[]` from `getRecommendations()` has a `recommended_session_id`, prefer that over the hour-based default. Defensive: wrap in try/check.

Acceptance test: open dashboard at 9am → "Morning Emergence" is pre-selected and a "Best for this time of day" header appears above the chips. Open at 8pm → "Wind Down" is pre-selected.

### C2. Item 8 — Insight ANS-aware narrative

**New file:** `frontend/src/copy/insightTemplates.js`

```js
// Template selection keyed on dominant_ans + ans_trajectory.
// trajectory: 'improved' | 'declined' | 'stable'

export const INSIGHT_TEMPLATES = {
  ventral_vagal: {
    improved:  'You moved into ventral vagal — safety and connection mode. Your nervous system found its anchor.',
    stable:    'You held ventral vagal throughout. This is the state your body wants to remember.',
    declined:  'You started in ventral vagal but drifted. That’s information — your body needs the input it had at the start.',
  },
  healthy_sympathetic: {
    improved:  'Your activation softened into healthy engagement — alert without strain.',
    stable:    'Steady healthy activation. Your sympathetic system is working with you, not against you.',
    declined:  'Activation climbed during the session. Note what triggered it; that’s where the work is.',
  },
  anxious_sympathetic: {
    improved:  'Anxious activation eased as you breathed. That softening is the skill.',
    stable:    'Anxious activation held throughout. Try a shorter session next, or pair this with movement.',
    declined:  'Activation grew during the session. Not failure — signal. Tomorrow, start gentler.',
  },
  dorsal_vagal: {
    improved:  'You lifted out of dorsal shutdown. Gentle re-engagement — well-paced.',
    stable:    'You stayed in dorsal vagal. Sometimes rest is the work. Try light movement before the next session.',
    declined:  'You dropped deeper into dorsal during the session. Your body needs recovery before this practice.',
  },
  burnout_rigidity: {
    improved:  'Some flexibility returned. Rigidity loosens slowly — this is real progress.',
    stable:    'Rigidity held. Rest is priority. Skip tomorrow if you can.',
    declined:  'Rigidity deepened. This is a stop signal, not a try-harder signal.',
  },
};

export function pickInsightCopy(dominant_ans, ans_trajectory = 'stable') {
  const states = INSIGHT_TEMPLATES[dominant_ans];
  if (!states) return null;
  return states[ans_trajectory] ?? states.stable;
}
```

**Edit:** `frontend/src/pages/Insight.jsx`
- Import: `import { pickInsightCopy } from '../copy/insightTemplates.js';`
- Compute trajectory from summary data: prefer `data.ans_trajectory` if backend provides it; else derive simple rule from `peak_vs` vs `final_vs`:
  - `final_vs >= peak_vs - 5` → `'stable'`
  - `final_vs > peak_vs` → `'improved'` (rare)
  - `peak_vs - final_vs >= 10` → `'declined'`
  - else `'stable'`
- Build narrative: prefer `pickInsightCopy(dominant_ans, trajectory)`. Fall back to existing `intro + retention + rmssd` line if no template matches.
- Render the new narrative as the leading sentence; keep `retention` and `avg_rmssd` lines after it (so we don't lose the metric mention).

**Share copy:**
- Replace the share text (~238) to include date + dominant ANS:
  ```
  ALIVE — ${dateStr}
  ${vsLabel(peak_vs)} • ${Math.round(peak_vs)} VS
  ANS: ${dominant_ans ? dominant_ans.replace(/_/g, ' ') : '—'}
  RF: ${rf_bpm ? rf_bpm.toFixed(1) + ' bpm' : '—'} • RMSSD: ${avg_rmssd ?? '—'} ms
  ```
- `dateStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })`.

Acceptance test: complete a session with `dominant_ans = anxious_sympathetic`, peak 70, final 55 → narrative is "Activation grew during the session. Not failure — signal. Tomorrow, start gentler." Share button on iOS shows the formatted multiline text with today's date.

### C3. SplashScreen subtitle

**Edit:** `frontend/src/pages/SplashScreen.jsx` line 47
- "Autonomic regulation" → "Tune your nervous system"

### C4. ProfileSetup sex-norms one-liner position

**Edit:** `frontend/src/pages/ProfileSetup.jsx` lines 60-76 (sex step)
- Move the `<p className={styles.subtle}>` (the Umetani/Nunan line) to render **above** the `<SegmentedChoice>`, but currently it's already above. Wait — re-read: line 62-64 is `<p>` (subtle), lines 65-73 are SegmentedChoice. The `<p>` is already above. The request "move the sex-norms one-liner above the choice" likely refers to keeping it visible/positioned more prominently. Action: ensure spacing keeps the `<p>` directly under the `<h2>` and above the choice with `marginTop: 4, marginBottom: 16` inline style override. If `styles.subtle` already produces correct spacing, add a wrapper `<div style={{ marginBottom: 12 }}>...</div>` around the `<p>` to ensure visual hierarchy.
- Verify visually no regression. If the team intended the one-liner to be repositioned, this is now an explicit "above the choice with breathing room" placement.

### C5. Item 4 — ANS cascade CSS hooks (no JS change)

**Edit:** `frontend/src/styles/global.css`

Append a new section near the bottom (after existing keyframes, before any `@media (prefers-reduced-motion)` block):

```css
/* ===========================================================
   ANS cascade hooks (item 4) — JS not yet wired.
   Session.jsx already sets <html data-ans="state_name">.
   Future: also set data-ans-intensity="low|med|high" from confidence.
   =========================================================== */

@keyframes ansVentralVagal {
  0%, 100% { filter: hue-rotate(0deg) saturate(1); }
  50%      { filter: hue-rotate(-2deg) saturate(1.04); }
}
@keyframes ansHealthySympathetic {
  0%, 100% { filter: hue-rotate(0deg) saturate(1); }
  50%      { filter: hue-rotate(4deg) saturate(1.06); }
}
@keyframes ansAnxiousSympathetic {
  0%, 100% { filter: hue-rotate(0deg) saturate(1); }
  50%      { filter: hue-rotate(8deg) saturate(1.12); }
}
@keyframes ansDorsalVagal {
  0%, 100% { filter: hue-rotate(0deg) saturate(0.94); }
  50%      { filter: hue-rotate(-6deg) saturate(0.90); }
}
@keyframes ansBurnoutRigidity {
  0%, 100% { filter: saturate(0.85) brightness(0.96); }
  50%      { filter: saturate(0.82) brightness(0.94); }
}

/* Wired by data-ans-intensity (future). When intensity is "high", the
   ambient-bg layer picks up the matching keyframe. No JS today. */
html[data-ans="ventral_vagal"][data-ans-intensity="high"]       .ambient-bg { animation: ansVentralVagal       18s ease-in-out infinite; }
html[data-ans="healthy_sympathetic"][data-ans-intensity="high"] .ambient-bg { animation: ansHealthySympathetic 14s ease-in-out infinite; }
html[data-ans="anxious_sympathetic"][data-ans-intensity="high"] .ambient-bg { animation: ansAnxiousSympathetic 10s ease-in-out infinite; }
html[data-ans="dorsal_vagal"][data-ans-intensity="high"]        .ambient-bg { animation: ansDorsalVagal        22s ease-in-out infinite; }
html[data-ans="burnout_rigidity"][data-ans-intensity="high"]    .ambient-bg { animation: ansBurnoutRigidity    24s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  html[data-ans-intensity] .ambient-bg { animation: none !important; }
}
```

### C6. Reduced-motion + 100dvh CSS audit

**Edit:** `frontend/src/styles/global.css`
- Locate any `@media (prefers-reduced-motion: reduce)` block. Ensure rule `.screen { opacity: 1 !important; }` exists. If absent, add it.
- If the file contains `100vh` literals anywhere, replace with `100dvh` (search globally).
- Ensure `:focus-visible` rules appear **before** any `.button`, `.touch-target`, or other component selector blocks. If ordering is wrong, move the `:focus-visible` block up.

### C7. CSS vars / keyframes requested by A

A may need a globally-defined keyframe for the BreathPhaseLabel hint pulse. **Skip unless A explicitly documents a name here.** A uses inline styles as the default per the conflict-guardrail.

---

## New files summary

| Path | Owner | Purpose |
|------|-------|---------|
| `frontend/src/components/BreathPhaseLabel.jsx` | A | Phase word component |
| `frontend/src/components/ReconnectOverlay.jsx` | A | Shared overlay for BLE/WS recovery |
| `frontend/src/pages/H10Intro.jsx` | B | Onboarding slide |
| `frontend/src/lib/authErrors.js` | B | Supabase error mapper |
| `frontend/src/copy/index.js` | B | Microcopy directory bootstrap |
| `frontend/src/copy/h10IntroCopy.js` | B | H10Intro strings |
| `frontend/src/copy/insightTemplates.js` | C | ANS-aware narrative templates |

---

## Test plan (Vercel preview, post-merge)

Phone (iOS Safari) + Desktop (Chrome):

1. **Splash → Login**
   - Subtitle reads "Tune your nervous system" (not "Autonomic regulation").
   - Active Sign in / Sign up tab border is visibly brighter (0.55 alpha).
   - Wrong password → friendly error copy, not raw Supabase message.

2. **ProfileSetup**
   - Sex step shows the Umetani/Nunan one-liner clearly above the male/female choice.

3. **H10Intro (first-time only)**
   - After ProfileSetup → H10Intro shows up with 3 bullets, CTA "Connect H10".
   - Tap "Skip" → goes to CalibrationScreen, doesn't show again next visit.

4. **CalibrationScreen**
   - HR bpm label under heart SVG reads at fontSize 11 (legibly larger).
   - Kill backend mid-calibration → ReconnectOverlay shows, auto-recovers.

5. **Session**
   - Phase word (Inhale/Hold/Exhale/Pause) cycles synced to inner orb.
   - No "↓ 0.3 off" number visible.
   - Target orb has subtitle "Your calibrated resonance frequency."
   - On resonance lock: halo holds 3s, copy reads "Resonance. Stay here."
   - RF coherence bar is hidden by default. Tap "…" → reveals.
   - Kill backend mid-session → ReconnectOverlay appears, auto-recovers, session continues.

6. **Dashboard**
   - At 9am: "Morning Emergence" pre-selected with "Best for this time of day" header above chips.
   - At 8pm: "Wind Down" pre-selected.

7. **Insight**
   - Narrative reflects dominant ANS + trajectory (run an "anxious + declining" sim to verify the "Activation grew" template).
   - Share button copy contains date + dominant ANS line.

8. **Reduced-motion check**
   - System setting → reduce motion. All `.screen` containers still visible (opacity 1). Phase label still cycles via text update, not animation.

9. **Pipeline integrity (non-UI)**
   - Run a full session end-to-end. Confirm `session_end` POST succeeds. Confirm WS reconnect did not corrupt accum state.

10. **Build gates**
    - `cd frontend && npm run build` passes.
    - `python -m pytest` (backend) still green.

---

## Notes for coder agents

- Start with the constraint banner. Re-read it before each commit.
- Use the existing inline-style idiom in each file. Do not migrate to CSS modules.
- One commit per item (A1/A2/B1/etc.) for easy revert. Conventional commit prefix: `feat(ui-v2):` or `fix(ui-v2):`.
- Push after each commit (per "Always push after changes" project rule).
- Do not touch any file not listed in your ownership column.
