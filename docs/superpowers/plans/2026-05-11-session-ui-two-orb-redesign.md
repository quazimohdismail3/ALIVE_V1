# Session UI Two-Orb Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-orb session screen with two stacked orbs (target RF pace + live breathing rate), full-screen ANS color background, and a resonance flash-lock moment.

**Architecture:** Pure front-end change — two files only. No new components, no backend changes. All live data already flows via existing CSS variables (`--rf-calibrated-period`, `--rf-measured-period`, `--ambient`). Switch from absolute-positioned orbs to flex-flow layout to fix centering.

**Tech Stack:** React 18, Tone.js (unchanged), CSS animations, `color-mix()` (Chromium 111+, Firefox 113+, Safari 16.2+)

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/styles/global.css` | New `orbPulse` keyframe · update `ambient-bg` opacity/position · add `.in-resonance` modifier · add `resonanceFlash` keyframe |
| `frontend/src/pages/Session.jsx` | Add `justLocked` state + `useEffect` · replace three absolute orbs with two-orb flex stack · add bottom strip · remove 280px spacer · remove unused `color`/`rfPer` vars |

---

## Task 1: CSS — keyframes and ambient-bg

**Files:**
- Modify: `frontend/src/styles/global.css:378-394`

- [ ] **Step 1: Replace `vsPulse` keyframe and `ambient-bg` in global.css**

Find this block (lines 378–401):

```css
/* ── VS orb ─────────────────────────────────────────────────────────────── */
.vs-orb {
  border-radius: 50%;
  animation: vsPulse var(--vs-period, 2s) ease-in-out infinite;
}
@keyframes vsPulse {
  0%, 100% { transform: scale(1);    opacity: 0.9; }
  50%       { transform: scale(1.06); opacity: 1;   }
}

/* ── RF breath ring ─────────────────────────────────────────────────────── */
.breath-ring {
  border-radius: 50%;
  animation: breatheRing var(--rf-period, 10s) ease-in-out infinite;
}
@keyframes breatheRing {
  0%   { transform: scale(0.92); opacity: 0.5; }
  50%  { transform: scale(1.08); opacity: 1;   }
  100% { transform: scale(0.92); opacity: 0.5; }
}
```

Replace with:

```css
/* ── Orb pulse (both target + live orbs) ────────────────────────────────── */
@keyframes orbPulse {
  0%, 100% { transform: scale(0.87); }
  50%       { transform: scale(1.13); }
}

/* ── Resonance flash — fires once on lock ───────────────────────────────── */
@keyframes resonanceFlash {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}
```

- [ ] **Step 2: Update `.ambient-bg` to be centered and stronger**

Find:
```css
.ambient-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(ellipse 80% 60% at 50% 20%, color-mix(in srgb, var(--ambient) 12%, transparent), transparent 70%);
  transition: background 1200ms ease;
}
```

Replace with:
```css
.ambient-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(ellipse 150% 120% at 50% 50%, color-mix(in srgb, var(--ambient) 20%, transparent), transparent 70%);
  transition: background 1200ms ease;
}
.in-resonance .ambient-bg {
  background: radial-gradient(ellipse 150% 120% at 50% 50%, color-mix(in srgb, var(--ambient) 45%, transparent), transparent 70%);
}
```

- [ ] **Step 3: Verify build passes**

```bash
cd frontend && npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/global.css
git commit -m "style(session): orbPulse keyframe, resonanceFlash, stronger ambient-bg"
```

---

## Task 2: Session.jsx — justLocked state and useEffect

**Files:**
- Modify: `frontend/src/pages/Session.jsx`

- [ ] **Step 1: Add `justLocked` state after existing useState declarations**

Find the block where other state is declared (around line 50–65). Add after the last `useState` line:

```js
const [justLocked, setJustLocked] = useState(false);
```

- [ ] **Step 2: Add useEffect that fires flash on resonance lock**

Add this `useEffect` after the existing CSS variable effect (around line 100, after the `useEffect` that sets `--vs-period`, `--rf-period` etc.):

```js
// Fire one-shot flash when breathing locks to RF resonance
useEffect(() => {
  if (!inResonance) return;
  setJustLocked(true);
  const t = setTimeout(() => setJustLocked(false), 1000);
  return () => clearTimeout(t);
}, [inResonance]);
```

- [ ] **Step 3: Verify build passes**

```bash
cd frontend && npm run build
```

Expected: no errors. (No visible UI change yet — `justLocked` not rendered yet.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Session.jsx
git commit -m "feat(session): justLocked state for resonance flash trigger"
```

---

## Task 3: Session.jsx — replace three-orb layout with two-orb flex stack

**Files:**
- Modify: `frontend/src/pages/Session.jsx:255-270` (vars block) and `frontend/src/pages/Session.jsx:262-315` (three orb divs)

- [ ] **Step 1: Replace the computed vars block**

Find (lines ~254–261):
```js
  const vs      = frame?.vs?.vs ?? 0;
  const color   = vsColor(vs);
  const rfPer   = frame?.rf_bpm ? 60 / frame.rf_bpm : 10;

  const rfHz           = frame?.rf_hz ?? null;
  const rfCalibratedHz = frame?.rf_calibrated_hz ?? 0.1;
  const inResonance    = rfHz !== null && Math.abs(rfHz - rfCalibratedHz) < 0.008;
```

Replace with:
```js
  const vs      = frame?.vs?.vs ?? 0;
  const rfHz           = frame?.rf_hz ?? null;
  const rfCalibratedHz = frame?.rf_calibrated_hz ?? 0.1;
  const inResonance    = rfHz !== null && Math.abs(rfHz - rfCalibratedHz) < 0.008;

  // ANS color for inline styles (mirrors --ambient CSS variable)
  const ANS_COLORS = {
    ventral_vagal: '#00D084',
    healthy_sympathetic: '#EF9F27',
    anxious_sympathetic: '#E24B4A',
    dorsal_vagal: '#534AB7',
    burnout_rigidity: '#7A7A96',
  };
  const ansColor = ANS_COLORS[frame?.ans?.state] ?? '#7C6FF7';

  const ANS_LABELS = {
    ventral_vagal: 'Ventral',
    healthy_sympathetic: 'Healthy',
    anxious_sympathetic: 'Anxious',
    dorsal_vagal: 'Dorsal',
    burnout_rigidity: 'Burnout',
  };
  const ansLabel = ANS_LABELS[frame?.ans?.state] ?? 'Calibrating';
```

- [ ] **Step 2: Update outer container div — add flex layout and in-resonance class**

Find:
```jsx
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', position: 'relative', overflow: 'hidden' }}>
```

Replace with:
```jsx
    <div className={inResonance ? 'in-resonance' : undefined} style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
```

- [ ] **Step 3: Remove the three absolute-positioned orb divs, add flash overlay**

Find and remove this entire block (three orbs, ~lines 267–315):
```jsx
      {/* Living VS orb — pulses at VS-driven period */}
      <div className={inResonance ? 'in-resonance' : ''} style={{
        position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)',
        width: 200, height: 200, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
        border: `2px solid ${color}44`,
        boxShadow: `0 0 40px ${color}22`,
        animation: `vsPulse var(--vs-period, 2s) ease-in-out infinite`,
        transition: 'box-shadow 1200ms ease, border-color 1200ms ease',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 48, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {Math.round(vs)}
        </div>
        <div style={{ color: '#7A7A96', fontSize: 12, marginTop: 4 }}>VS score</div>
        <button onClick={() => setActiveTip('VS Score')} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>?</button>
      </div>

      {/* RF breath ring */}
      <div style={{
        position: 'absolute', top: 'calc(18% - 20px)', left: '50%', transform: 'translateX(-50%)',
        width: 240, height: 240, borderRadius: '50%',
        border: `1.5px solid ${frame?.rf_locked ? 'var(--locked)' : 'rgba(255,255,255,0.08)'}`,
        animation: `breatheRing var(--rf-calibrated-period, 10s) ease-in-out infinite`,
        pointerEvents: 'none',
        transition: 'border-color 1000ms ease',
      }} />

      {/* Measured RF inner ring — tracks actual breathing rate */}
      {rfHz && (
        <div style={{
          position: 'absolute', top: 'calc(18% - 10px)', left: '50%', transform: 'translateX(-50%)',
          width: 220, height: 220, borderRadius: '50%',
          border: `1px solid ${inResonance ? 'rgba(124,111,247,0.5)' : 'rgba(255,255,255,0.05)'}`,
          animation: `breatheRing var(--rf-measured-period, 10s) ease-in-out infinite`,
          pointerEvents: 'none',
          transition: 'border-color 800ms ease',
          boxShadow: inResonance ? '0 0 20px rgba(124,111,247,0.3)' : 'none',
        }} />
      )}
```

Replace with this flash overlay (place it right after `<div className="ambient-bg" />`):
```jsx
      {/* Resonance flash — one-shot on lock */}
      {justLocked && (
        <div style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1,
          background: `radial-gradient(circle at 50% 50%, ${ansColor}40, transparent 60%)`,
          animation: 'resonanceFlash 1000ms ease-out forwards',
        }} />
      )}
```

- [ ] **Step 4: Add two-orb stacked section after the header**

After the closing `</div>` of the header row, add:
```jsx
      {/* Two-orb stack — target RF + live breathing */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, position: 'relative', zIndex: 2 }}>
        {/* Target orb — calibrated RF pace */}
        <div style={{
          width: 130, height: 130, borderRadius: '50%',
          background: `radial-gradient(circle, ${ansColor}22 0%, transparent 70%)`,
          border: `2px solid ${ansColor}55`,
          boxShadow: `0 0 40px ${ansColor}22`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          animation: 'orbPulse var(--rf-calibrated-period, 10s) ease-in-out infinite',
        }}>
          <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: `${ansColor}88`, marginBottom: 2 }}>target</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: `${ansColor}bb`, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {(rfCalibratedHz * 60).toFixed(1)}
          </div>
          <div style={{ fontSize: 8, color: `${ansColor}66` }}>br / min</div>
        </div>

        {/* Gap indicator / resonance label */}
        <div style={{
          fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
          color: inResonance ? `${ansColor}cc` : 'rgba(255,255,255,0.2)',
          transition: 'color 800ms ease',
          minHeight: 14,
        }}>
          {inResonance
            ? 'RESONANCE'
            : rfHz ? `↓ ${Math.abs((rfHz - rfCalibratedHz) * 60).toFixed(1)} off` : ''}
        </div>

        {/* Live orb — measured breathing rate */}
        <div style={{
          width: 130, height: 130, borderRadius: '50%',
          background: `radial-gradient(circle, ${ansColor}44 0%, transparent 70%)`,
          border: `2px solid ${ansColor}${inResonance ? 'cc' : '88'}`,
          boxShadow: `0 0 ${inResonance ? 80 : 55}px ${ansColor}${inResonance ? '55' : '33'}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          animation: 'orbPulse var(--rf-measured-period, 10s) ease-in-out infinite',
          transition: 'box-shadow 1200ms ease, border-color 1200ms ease',
        }}>
          <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: `${ansColor}bb`, marginBottom: 2 }}>breathing</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: `${ansColor}ee`, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {rfHz ? (rfHz * 60).toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 8, color: `${ansColor}88` }}>br / min</div>
        </div>
      </div>

      {/* Bottom strip — HR | ANS badge | VS */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 28px 20px', position: 'relative', zIndex: 2,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
            {frame?.metrics?.hr ? Math.round(frame.metrics.hr) : '—'}
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>HR bpm</div>
        </div>
        <div style={{
          fontSize: 9, color: `${ansColor}dd`, border: `1px solid ${ansColor}44`,
          borderRadius: 20, padding: '4px 14px', textTransform: 'uppercase', letterSpacing: '0.1em',
          transition: 'color 1200ms ease, border-color 1200ms ease',
        }}>
          {ansLabel}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
            {frame?.metrics?.rmssd ? Math.round(frame.metrics.rmssd) : '—'}
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>RMSSD ms</div>
        </div>
      </div>
```

- [ ] **Step 5: Remove the 280px spacer from content panels**

Find:
```jsx
        {/* Spacer for orb */}
        <div style={{ height: 280 }} />
```

Delete those two lines.

- [ ] **Step 6: Verify build passes**

```bash
cd frontend && npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Session.jsx
git commit -m "feat(session): two-orb stacked layout — target RF + live breathing, flex centered"
```

---

## Task 4: Smoke test

**Files:** None — manual verification only.

- [ ] **Step 1: Start dev server**

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

- [ ] **Step 2: Open in browser and verify normal state**

Navigate to a session (use simulator / mode 2).

Expected:
- Two orbs stacked vertically, centered on screen
- Top orb: labeled "TARGET", pulses slowly (~10s period for 6 br/min default)
- Bottom orb: labeled "BREATHING", displays "—" until RF data flows, then a number
- Background has a subtle colored glow (purple default, changes with ANS state)
- Bottom strip shows HR | "Calibrating" badge | RMSSD
- No absolute-positioned orbs floating at top 18%

- [ ] **Step 3: Verify resonance state**

With simulator running, wait for `rf_hz` to approach `rf_calibrated_hz` within 0.008 Hz. Or temporarily lower the threshold in Session.jsx for testing: change `0.008` to `0.1`.

Expected on resonance:
- Flash overlay fires once (green/teal radial burst), fades out over 1s
- Both orbs brighten (border + glow intensify)
- Gap indicator changes from "↓ X.X off" to "RESONANCE"
- Background saturates visibly (green tint stronger)
- ANS badge turns teal

Revert the test threshold change if you made it.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Success Criteria Checklist

- [ ] Target orb pulses at `--rf-calibrated-period` (set from `rf_calibrated_hz` in existing CSS var effect)
- [ ] Live orb pulses at `--rf-measured-period` (set from `rf_hz` in existing CSS var effect)
- [ ] Scale swing is visually dramatic (0.87→1.13, not 1.0→1.06)
- [ ] Background color matches ANS state, transitions smoothly
- [ ] Resonance: flash fires once, then sustained glow + "RESONANCE" label
- [ ] Gap indicator shows numeric distance when not in resonance
- [ ] VS score visible in bottom strip
- [ ] RMSSD and HR in bottom strip
- [ ] `npm run build` passes clean
- [ ] No pipeline code touched (WebSocket, HRV, audio all unchanged)
