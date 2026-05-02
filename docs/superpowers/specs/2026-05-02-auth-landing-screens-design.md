# Auth + Landing Screens — Design Spec

**Date:** 2026-05-02  
**Author:** Architect review, Mission Alive V2  
**Status:** DRAFT — awaiting review before implementation

---

## Overview

The app currently has no marketing landing page: unauthenticated users see `LoginScreen` immediately, and `Landing.jsx` is actually a session card grid (the dashboard). This spec adds a true `LandingPage.jsx` for unauthenticated visitors, renames `Landing.jsx` → `Dashboard.jsx`, wires a correct first-time-user gate into `App.jsx`, adds a `sex` field to `ProfileSetup` (already present but needs RF formula wired to `calibration_done` flags), and extends the Supabase schema with `calibration_done`, `rf_bpm`, and `rf_confidence_tag` on `user_profiles`.

The `sex` field already exists in `ProfileSetup.jsx` (step 3 of 7) and is already accepted by `PUT /api/profile`. The primary gaps are: (1) no LandingPage, (2) no `calibration_done` gate in App.jsx, (3) no `calibration_done`/`rf_confidence_tag` columns in `user_profiles`, and (4) the RF formula is computed inside the calibration WebSocket session but never persisted back to the profile.

---

## Screen Inventory (before vs after)

| # | Before | File | Role | After |
|---|--------|------|------|-------|
| 1 | LandingPage | _(missing)_ | _(unauthenticated marketing page)_ | **NEW** `LandingPage.jsx` |
| 2 | LoginScreen | `LoginScreen.jsx` | Tabbed sign-in / sign-up | No change |
| 3 | Landing | `Landing.jsx` | Session card grid + circadian badges | **RENAME** → `Dashboard.jsx` |
| 4 | ProfileSetup | `ProfileSetup.jsx` | 7-step health metrics wizard | Sex field already exists; wire RF formula output to `calibration_done` |
| 5 | Setup | `Setup.jsx` | Sensor mode picker | No change |
| 6 | Calibration | `Calibration.jsx` | RF breathing calibration | On completion: persist `rf_bpm`, set `calibration_done=true` |
| 7 | Session | `Session.jsx` | Live biofeedback session | No change |
| 8 | Insight | `Insight.jsx` | Post-session insight cards | No change |

**File renames:**
- `frontend/src/pages/Landing.jsx` → `frontend/src/pages/Dashboard.jsx`
- `frontend/src/pages/Landing.module.css` → `frontend/src/pages/Dashboard.module.css` (if it exists)
- All import references in `App.jsx` updated accordingly

---

## Routing Logic (state machine)

### Screen states in App.jsx

```
'landing_page'   — unauthenticated marketing page (NEW)
'login'          — Supabase email auth (existing LoginScreen)
'profile_setup'  — first-time health metrics wizard
'calibration'    — RF breathing calibration
'dashboard'      — session card grid (renamed from 'landing')
'setup'          — sensor mode picker
'session'        — live session
'insight'        — post-session insights
```

### Auth + first-time gate logic

```
useAuth() resolves
├── user === null (unauthenticated)
│   └── screen = 'landing_page'   ← NEW: show LandingPage
│
└── user present
    ├── profile === undefined      → spinner (loading)
    ├── profileErr !== null        → error screen + retry
    ├── profile === null           → screen = 'profile_setup'
    └── profile present
        ├── profile.calibration_done === false  → screen = 'calibration'  ← NEW gate
        └── profile.calibration_done === true   → screen = 'dashboard'
```

### Full navigation flow

```
[Unauthenticated]
  LandingPage
    → CTA "Get started" → LoginScreen
    → CTA "Sign in" → LoginScreen (login tab)

[Auth success — first time]
  → ProfileSetup (profile null gate)
    → onComplete → Calibration (calibration_done=false gate)
      → onComplete (rf_bpm saved, calibration_done set) → Dashboard

[Auth success — returning, calibration done]
  → Dashboard (direct)

[Session flow]
  Dashboard → Setup → Calibration → Session → Insight → Dashboard

[Session discard]
  Session → Dashboard (onDiscard)
```

### Transition triggers (exact)

| From | Trigger | To |
|------|---------|-----|
| LandingPage | CTA click | LoginScreen (set `screen='login'`) |
| LoginScreen | `onAuth()` called | App re-evaluates profile gate |
| ProfileSetup | `onComplete()` resolves | Re-fetch profile → Calibration if `calibration_done=false` |
| Calibration (first-time) | `onComplete({rf_bpm, rf_locked})` | Patch profile: `calibration_done=true`, `rf_bpm`, `rf_confidence_tag` → Dashboard |
| Calibration (in-session) | `onComplete(...)` | Pass `rfBpm` into `cfg` → Session (existing behavior) |
| Dashboard | "Start session" card click | Setup |
| Session | `onEnd(data)` | Insight |
| Session | `onDiscard()` | Dashboard |
| Insight | "Done" | Dashboard |

**Key distinction:** Calibration is called in two contexts — first-time onboarding gate, and per-session sensor warm-up. The `calibration_done` flag disambiguates. When `profile.calibration_done === false`, Calibration's `onComplete` must patch the profile before navigating. When `profile.calibration_done === true`, Calibration's `onComplete` only sets `cfg.rfBpm` (existing behavior, no profile patch needed).

---

## LandingPage Design

**File:** `frontend/src/pages/LandingPage.jsx`  
**CSS module:** `frontend/src/pages/LandingPage.module.css`

### Purpose
Marketing / welcome screen shown to unauthenticated users. Converts visitors to sign-ups. No session data, no auth calls on this screen.

### Layout

```
┌─────────────────────────────────────────────────────┐
│                  CosmicBackground                    │
│                                                     │
│         [Subtle breath animation — orb pulse]       │
│                                                     │
│              Mission Alive                          │  ← Outfit font, 2.4rem
│                                                     │
│     Personalized biofeedback breathing.             │  ← DM Sans, 1.1rem, 70% opacity
│     Powered by your heart.                          │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │          Get started free          [CTA]    │   │  ← #7C6FF7, full-width pill
│  └─────────────────────────────────────────────┘   │
│                                                     │
│         Already have an account? Sign in            │  ← text link, muted
│                                                     │
│  ───────────────── Features ─────────────────       │
│                                                     │
│  [Heart icon]  Real-time HRV         [Breath icon] │
│  tracks your nervous system           Guides you to │
│  via Polar H10 or phone camera        resonance     │
│                                                     │
│  [ANS icon]  Adapts to you           [Data icon]   │
│  learns your personal                saves every    │
│  resonance frequency                 session        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Visual language (matches psyche-design system)
- Background: `CosmicBackground` (existing component, reuse)
- Orb: small `BreathingOrb` at ~60% opacity, no label, purely ambient — magic stays backstage
- Colors: `--vs-peak: #534AB7` for CTA, text in `--foreground` / 70% opacity muted
- Fonts: `Outfit` for app name (display), `DM Sans` for tagline and body
- No HR numbers, no HRV metrics, no control values shown on this screen
- Motion: single 6s BreathingOrb pulse — no other animation

### Copy (exact strings)
```
App name:    "Mission Alive"
Tagline:     "Personalized biofeedback breathing.\nPowered by your heart."
CTA:         "Get started free"
Secondary:   "Already have an account? Sign in"

Feature tiles (icon + label + one-liner):
  1. "Real-time HRV" — "Tracks your nervous system via Polar H10 or phone camera"
  2. "Resonance breathing" — "Guides you to your personal breathing frequency"
  3. "Adapts over time" — "Learns your resonance from every session"
  4. "Session history" — "Saves HRV, ANS state, and insights after each session"
```

### Props
```jsx
<LandingPage
  onGetStarted={() => setScreen('login')}  // opens LoginScreen in signup tab
  onSignIn={() => setScreen('login')}      // opens LoginScreen in login tab
/>
```

Pass `initialTab` prop to LoginScreen to pre-select the tab:
- "Get started" → `initialTab='signup'`
- "Sign in" → `initialTab='login'`

### LoginScreen change required
Add optional `initialTab` prop (`'login' | 'signup'`, default `'login'`) so LandingPage CTAs can deep-link to the correct tab. Internally: `const [mode, setMode] = useState(initialTab ?? 'login')`.

---

## ProfileSetup Changes (sex field + RF formula)

### Current state
`ProfileSetup.jsx` already has a `sex` step (step 3 of 7: `['hero', 'age', 'sex', 'height', 'weight', 'resting_hr', 'done']`). The field is already sent to `PUT /api/profile` with values `male | female | prefer_not_to_say`. No changes needed to ProfileSetup for the sex field itself — it is already implemented.

### RF formula wiring (new)
The RF formula is applied during Calibration as the prior for `BayesianRFOptimizer`. The formula constants by sex:

```
Male:              RF = 17.90 − 0.07 × height_cm
Female:            RF = 15.88 − 0.06 × height_cm
Prefer not to say: RF = 16.89 − 0.065 × height_cm   (average of male/female coefficients)
```

These constants are already used in `backend/baseline_engine.py`. No frontend formula computation needed — the backend WS calibration handler reads `profile.sex` and `profile.height_cm` to initialize `BayesianRFOptimizer`.

The change required here is: after Calibration completes the first time, the computed `rf_bpm` and `rf_confidence_tag` must be persisted back to `user_profiles`. This is currently NOT done — `rf_bpm` is only stored on the `sessions` row and the `rf_calibration` table, not on `user_profiles`.

### ProfileSetup "done" screen microcopy update
Current final screen says: "Your starting baseline is ready". Update to:

```
"Your breathing baseline is ready."
"We'll refine your resonance frequency as you complete sessions with your H10."
```

No structural change to the wizard — microcopy only.

---

## First-Time Gate Logic

### In App.jsx — augmented gate

Current gate (simplified):
```
if (profile === null) → show ProfileSetup
else → show screen (defaults to 'landing' / Dashboard)
```

New gate:
```javascript
// After profile fetch resolves:
if (profile === null) {
  setScreen('profile_setup')
} else if (!profile.calibration_done) {
  setScreen('calibration')           // first-time calibration gate
} else {
  setScreen('dashboard')
}
```

### Calibration context awareness

`Calibration.jsx` needs to know whether it's running as the first-time onboarding gate or as the normal per-session step. Pass a boolean prop:

```jsx
// First-time gate (from App.jsx gate logic)
<Calibration
  isOnboarding={true}
  onComplete={async ({ rf_bpm, rf_locked }) => {
    await patchProfileCalibration({ rf_bpm, rf_locked })  // NEW: patch user_profiles
    const p = await getProfile()
    setProfile(p)
    setScreen('dashboard')
  }}
/>

// Per-session (from Dashboard → Setup flow, existing)
<Calibration
  isOnboarding={false}
  cfg={cfg}
  onComplete={(rfResult) => {
    setCfg({ ...cfg, ...rfResult })
    setScreen('session')
  }}
/>
```

### New API call: `patchProfileCalibration`

Add to `frontend/src/lib/api.js`:
```javascript
export async function patchProfileCalibration({ rf_bpm, rf_locked }) {
  const headers = {
    ...(await authHeaders()),
    'Content-Type': 'application/json',
  }
  const r = await fetch(`${API_URL}/api/profile/calibration`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ rf_bpm, rf_locked }),
  })
  if (!r.ok) throw new Error(`patchProfileCalibration failed: ${r.status}`)
  return r.json()
}
```

---

## Supabase Schema Changes

### Table: `public.user_profiles`

Add three columns:

```sql
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS calibration_done   boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rf_bpm             float,
  ADD COLUMN IF NOT EXISTS rf_confidence_tag  text
    CHECK (rf_confidence_tag IN ('DRAFT', 'REFINED', 'CONFIRMED'));
```

### Column semantics

| Column | Type | Nullable | Default | Meaning |
|--------|------|----------|---------|---------|
| `calibration_done` | boolean | NOT NULL | false | True after the user completes their first RF calibration session. Gates the first-time onboarding flow. |
| `rf_bpm` | float | yes | null | Most recent best-estimate resonance frequency in BPM from `BayesianRFOptimizer`. Null until first calibration completes. Range: approximately 4.0–8.0 BPM. |
| `rf_confidence_tag` | text (enum) | yes | null | Confidence tier: `DRAFT` = one session, no lock; `REFINED` = rf_locked=true; `CONFIRMED` = 3+ sessions with rf_locked=true. |

### `rf_confidence_tag` computation logic

```
DRAFT:      calibration_done=true AND rf_locked=false
REFINED:    calibration_done=true AND rf_locked=true AND n_rf_locked_sessions < 3
CONFIRMED:  calibration_done=true AND rf_locked=true AND n_rf_locked_sessions >= 3
```

For V2, implement only DRAFT/REFINED distinction. CONFIRMED requires counting sessions, defer to V3.

### Migration file

Create: `backend/migrations/002_user_profiles_calibration_fields.sql`

```sql
-- 002_user_profiles_calibration_fields.sql
-- Adds calibration tracking columns to user_profiles.
-- Idempotent — safe to re-run.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS calibration_done   boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rf_bpm             float,
  ADD COLUMN IF NOT EXISTS rf_confidence_tag  text
    CHECK (rf_confidence_tag IN ('DRAFT', 'REFINED', 'CONFIRMED'));

COMMENT ON COLUMN public.user_profiles.calibration_done IS
  'True after first RF calibration completes. Gates first-time-user onboarding flow.';
COMMENT ON COLUMN public.user_profiles.rf_bpm IS
  'Best-estimate resonance frequency BPM from BayesianRFOptimizer. Null before first calibration.';
COMMENT ON COLUMN public.user_profiles.rf_confidence_tag IS
  'DRAFT = unlocked; REFINED = rf_locked=true; CONFIRMED = 3+ locked sessions.';
```

---

## Backend API Changes

### 1. `GET /api/profile` — extend ProfileOut

**File:** `backend/api/profile.py`

Add fields to `ProfileOut`:
```python
class ProfileOut(BaseModel):
    age:                int
    sex:                str
    height_cm:          int
    weight_kg:          Optional[float] = None
    resting_hr:         Optional[int]   = None
    calibration_done:   bool            = False   # NEW
    rf_bpm:             Optional[float] = None    # NEW
    rf_confidence_tag:  Optional[str]   = None    # NEW
```

Update `get_profile()` handler to return these fields from the DB row.

### 2. `db.get_profile()` — extend SELECT

**File:** `backend/db.py`

```python
# Change SELECT to include new columns:
select user_id::text, age, sex, height_cm, weight_kg, resting_hr,
       calibration_done, rf_bpm, rf_confidence_tag
from public.user_profiles
where user_id = $1
```

Return object must expose `.calibration_done`, `.rf_bpm`, `.rf_confidence_tag`.

### 3. `PATCH /api/profile/calibration` — new endpoint

**File:** `backend/api/profile.py`

```python
class CalibrationPatch(BaseModel):
    rf_bpm:    float = Field(..., ge=3.0, le=10.0)
    rf_locked: bool

@router.patch("/profile/calibration", response_model=ProfileOut)
async def patch_profile_calibration(
    body: CalibrationPatch,
    user_id: str = Depends(get_current_user),
) -> ProfileOut:
    tag = "REFINED" if body.rf_locked else "DRAFT"
    await db.set_calibration_done(
        user_id,
        rf_bpm=body.rf_bpm,
        rf_confidence_tag=tag,
    )
    profile = await db.get_profile(user_id)
    return ProfileOut(
        age=profile.age,
        sex=profile.sex,
        height_cm=profile.height_cm,
        weight_kg=float(profile.weight_kg) if profile.weight_kg else None,
        resting_hr=profile.resting_hr,
        calibration_done=profile.calibration_done,
        rf_bpm=float(profile.rf_bpm) if profile.rf_bpm else None,
        rf_confidence_tag=profile.rf_confidence_tag,
    )
```

### 4. `db.set_calibration_done()` — new async function

**File:** `backend/db.py`

```python
async def set_calibration_done(
    user_id: str,
    *,
    rf_bpm: float,
    rf_confidence_tag: str,
) -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            update public.user_profiles
            set calibration_done  = true,
                rf_bpm            = $2,
                rf_confidence_tag = $3,
                updated_at        = now()
            where user_id = $1
            """,
            uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
            rf_bpm,
            rf_confidence_tag,
        )
```

### 5. `PUT /api/profile` — no change needed

`sex` is already accepted. `ProfileIn` model and `upsert_profile()` already handle it.

---

## File Changes Summary

### New files
| File | Description |
|------|-------------|
| `frontend/src/pages/LandingPage.jsx` | Marketing/welcome page for unauthenticated users |
| `frontend/src/pages/LandingPage.module.css` | Styles for LandingPage |
| `backend/migrations/002_user_profiles_calibration_fields.sql` | Schema migration for new columns |

### Renamed files
| Old | New |
|-----|-----|
| `frontend/src/pages/Landing.jsx` | `frontend/src/pages/Dashboard.jsx` |
| `frontend/src/pages/Landing.module.css` | `frontend/src/pages/Dashboard.module.css` |

### Modified files
| File | Change |
|------|--------|
| `frontend/src/App.jsx` | Screen states updated; `calibration_done` gate added; import Landing → Dashboard; add `isOnboarding` Calibration prop logic |
| `frontend/src/lib/api.js` | Add `patchProfileCalibration()` function |
| `frontend/src/pages/LoginScreen.jsx` | Add `initialTab` prop (`'login' | 'signup'`, default `'login'`) |
| `frontend/src/pages/ProfileSetup.jsx` | Update "done" step microcopy only |
| `frontend/src/pages/Dashboard.jsx` | File rename only; no logic changes |
| `backend/api/profile.py` | Extend `ProfileOut` with 3 fields; add `PATCH /profile/calibration` endpoint |
| `backend/db.py` | Extend SELECT in `get_profile()`; add `set_calibration_done()` |

---

## Open Questions

1. **Calibration skip in onboarding?** Should the first-time calibration be skippable (e.g., "I'll do this later")? If skip is allowed, `calibration_done` stays false and the gate re-triggers on next login. Recommendation: allow skip with "Set up later" link, but show a persistent banner on Dashboard until done.

2. **`rf_confidence_tag = CONFIRMED` threshold.** Spec defines CONFIRMED as 3+ locked sessions but defers implementation. Where should session counting live — in `db.set_calibration_done()` (query `rf_calibration` count) or in a separate cron/background job? Recommendation: query count inline in `PATCH /profile/calibration`, bump tag atomically.

3. **LandingPage feature tile icons.** The spec uses placeholder icon descriptions. What icon library is already in use? The codebase shows no icon library import — inline SVGs or a new dependency (lucide-react) needed. Recommendation: inline SVGs, 4 simple shapes, no new dependency.

4. **Does `Landing.jsx` currently have a CSS module?** If `Landing.module.css` does not exist (styles are inline or in global.css), no rename is needed. Verify before executing.

5. **`isOnboarding` prop on Calibration.jsx — backward compatible?** Currently Calibration accepts `cfg` and `onComplete`. Adding `isOnboarding={false}` as default means no callers break. Confirm Calibration doesn't have PropTypes validation that would reject unknown props.

6. **RLS on `PATCH /profile/calibration`.** The endpoint uses `get_current_user` (JWT-scoped user_id) then writes only to that user's row. RLS policy (`auth.uid() = user_id`) enforces isolation at DB layer. No additional change needed, but confirm service-role vs anon-key usage in `db.py` pool credentials.
