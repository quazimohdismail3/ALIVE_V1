# Session UI — Two-Orb Redesign

**Date:** 2026-05-11  
**Status:** Approved  
**Files affected:** `frontend/src/pages/Session.jsx`, `frontend/src/styles/global.css`

---

## Problem

Current session UI has three overlapping orbs with 6% scale pulse — below human visual perception threshold (~20%). Orbs are not centered. ANS state color only affects a 12%-opacity ambient background. No clear resonance reward signal.

---

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Layout | Stacked vertical | Meditative feel; live orb visually "chases" target |
| Orb count | 2 (no VS orb) | Clean signal-to-noise; VS moves to bottom strip |
| Scale swing | 26% (0.87 → 1.13) | Viscerally perceptible; below this = invisible |
| Resonance payoff | Flash + sustained lock | Discrete reward moment + ongoing confirmation |
| ANS color | Full background + badge | Felt peripherally, not just read |

---

## Visual Specification

### Two Orbs — Stacked

**Target orb** (top): calibrated RF pace — ghost-like, transparent, the guide.
- Size: 130×130px
- Border: 2px, ANS color at 35% opacity
- Glow: `box-shadow` at 15% opacity
- Pulse: `vsPulse` at `--rf-calibrated-period` CSS var
- Label: "TARGET" · number: calibrated RF in br/min
- Style: dim — intentionally subordinate

**Live orb** (bottom): measured breathing rate — bright, alive, the real signal.
- Size: 130×130px
- Border: 2px, ANS color at 60–80% opacity
- Glow: stronger `box-shadow`, pulses with scale
- Pulse: `vsPulse` at `--rf-measured-period` CSS var
- Label: "BREATHING" · number: live `rf_hz × 60` in br/min
- Style: vivid — the thing the user is controlling

**Gap indicator** (between orbs): small text showing `|target − live|` in br/min.  
Example: `↓ 0.8 off`. Disappears when `inResonance`.

### Scale Animation

Both orbs use same keyframe, different periods:
```css
@keyframes orbPulse {
  0%, 100% { transform: scale(0.87); }
  50%       { transform: scale(1.13); }
}
```
Glow `box-shadow` also animates with scale on the live orb.

### Resonance State (`inResonance = |rf_hz − rf_calibrated_hz| < 0.008 Hz`)

1. **Flash**: single radial gradient overlay at full opacity, fades in 300ms, out 700ms — fires once on lock. Implementation: `useEffect` watches `inResonance`; on `false→true` transition, sets `justLocked=true` via `useState`, clears after 1000ms with `setTimeout`. Flash overlay renders only when `justLocked`.
2. **Sustained**: both orbs shift to ANS state color (same hue). Background saturates to 45% opacity (from ~20%). 
3. **Label**: `RESONANCE` text appears between orbs, replacing gap indicator.
4. **Exit**: when `inResonance` becomes false, everything reverts over 1200ms transition.

### ANS State — Screen Color

Background: `radial-gradient(ellipse 150% 120% at 50% 50%, <ANS_COLOR> at 20–45% opacity, #0B0B16)`.
- Normal: 20% opacity
- Resonance: 45% opacity
- Transition: `1200ms ease`

ANS colors (existing): ventral_vagal `#00D084` · healthy_sympathetic `#EF9F27` · anxious_sympathetic `#E24B4A` · dorsal_vagal `#534AB7` · burnout_rigidity `#7A7A96` · default `#7C6FF7`.

### Bottom Strip (replaces VS orb)

Three items: HR bpm · ANS state badge · RMSSD ms.
- ANS badge: small pill, border + text color = ANS color.
- VS score: removed from prominent display (still available in session stats).

### Header (unchanged)
Session name · H10 status pill · Exit button.

---

## What Gets Removed

| Removed | Replacement |
|---------|-------------|
| VS score orb (200px center orb) | VS number in bottom strip |
| Outer ghost ring (240px border) | Target orb (full orb, same data) |
| Inner measured ring (220px dashed border) | Live orb (full orb, same data) |
| `in-resonance` CSS class on wrapper | Flash overlay + color shift on both orbs |

---

## CSS Variables Used

| Variable | Set by | Meaning |
|----------|--------|---------|
| `--rf-calibrated-period` | Session.jsx per frame | Target orb pulse period (seconds) |
| `--rf-measured-period` | Session.jsx per frame | Live orb pulse period (seconds) |
| `--ambient` | Global CSS via `data-ans` attr | ANS state color |

All three already set correctly in current code — no backend changes needed.

---

## Files to Change

### `frontend/src/pages/Session.jsx`
- Replace three-orb JSX block with two-orb stacked layout
- Add gap indicator (conditional on `!inResonance`)
- Add resonance flash overlay div (conditional on `inResonance`)
- Move VS score to bottom strip
- Add ANS badge to bottom strip
- Keep all CSS variable assignments unchanged

### `frontend/src/styles/global.css`
- Replace `vsPulse` keyframe: scale 0.87→1.13 (was 1.0→1.06)
- Replace `breatheRing` with `orbPulse` (same keyframe, applied to both orbs)
- Add `.orb-live` glow animation (box-shadow pulses with scale)
- Update `.ambient-bg`: increase opacity range to 20–45%
- Add `@keyframes resonanceFlash` for the one-shot overlay
- Add `.in-resonance` modifier: color transition on orbs + flash trigger

---

## Success Criteria

- [ ] Target orb pulses at calibrated RF rate (matches old ghost ring behavior)
- [ ] Live orb pulses at measured RF rate (matches old dashed ring behavior)
- [ ] Scale swing visually perceptible — feels like breathing
- [ ] Background color shifts with ANS state, readable in peripheral vision
- [ ] Resonance flash fires once on lock, then sustains green glow
- [ ] Gap indicator shows numeric distance when not in resonance
- [ ] VS score still visible in bottom strip
- [ ] No pipeline changes — all data already flowing via existing CSS vars
