# Auth + Landing Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a true `LandingPage.jsx` for unauthenticated visitors, rename `Landing.jsx` → `Dashboard.jsx`, wire a `calibration_done` first-time gate into `App.jsx`, add three columns to `user_profiles`, and expose a `PATCH /api/profile/calibration` endpoint that persists RF results after the onboarding calibration run.

**Architecture:** The existing auth flow sends unauthenticated users straight to `LoginScreen`; this plan inserts a marketing page before that and adds a post-profile-setup calibration gate. The backend gains a single new endpoint writing to `user_profiles`; the frontend gains a new page component and two prop extensions (`initialTab` on `LoginScreen`, `isOnboarding` on `Calibration`). No other files are structurally changed — all edits are surgical additions.

**Tech Stack:** React 18 + Vite, FastAPI + asyncpg + Supabase Postgres (RLS), CSS Modules (no new UI library — inline SVGs for feature icons).

**Reference spec:** `docs/superpowers/specs/2026-05-02-auth-landing-screens-design.md`
**Design language:** `~/.claude/projects/C--Users-user-Desktop-mission-alive/memory/reference_psyche-design-language.md`

**Cross-spec dependency note:** This plan creates migration `002_user_profiles_calibration_fields.sql`, which adds columns to `user_profiles` only. A separate Calibration spec will add the `rf_calibration` table — that must be migration `003`. Do NOT merge those two migrations or number them the same.

---

## File Map

**Backend — create:**
- `backend/migrations/002_user_profiles_calibration_fields.sql` — adds `calibration_done`, `rf_bpm`, `rf_confidence_tag` to `user_profiles`
- `backend/tests/test_calibration_patch.py` — unit + integration tests for new endpoint

**Backend — modify:**
- `backend/db.py` — extend `Profile` dataclass; extend `get_profile()` SELECT; add `set_calibration_done()`
- `backend/api/profile.py` — extend `ProfileOut`; add `CalibrationPatch` model; add `PATCH /profile/calibration`

**Frontend — create:**
- `frontend/src/pages/LandingPage.jsx` — unauthenticated marketing screen
- `frontend/src/pages/LandingPage.module.css` — scoped styles for LandingPage
- `frontend/src/pages/Dashboard.jsx` — rename of `Landing.jsx` (content unchanged)
- `frontend/src/pages/Dashboard.module.css` — rename of `Landing.module.css` if present (Landing has no CSS module — confirmed not present; skip)

**Frontend — modify:**
- `frontend/src/lib/api.js` — add `patchProfileCalibration()`
- `frontend/src/pages/LoginScreen.jsx` — add `initialTab` prop
- `frontend/src/pages/ProfileSetup.jsx` — update "done" step microcopy only
- `frontend/src/pages/Calibration.jsx` — add `isOnboarding` prop + conditional `onComplete` behaviour
- `frontend/src/App.jsx` — update imports (Landing → Dashboard); add `landing_page` screen; add `calibration_done` gate; wire `isOnboarding` to Calibration; wire `initialTab` to LoginScreen from LandingPage

**Frontend — delete:**
- `frontend/src/pages/Landing.jsx` — replaced by `Dashboard.jsx`

---

## Task 1: DB Migration — user_profiles calibration columns

**Files:**
- Create: `backend/migrations/002_user_profiles_calibration_fields.sql`

- [ ] **Step 1: Write the migration SQL**

Create `backend/migrations/002_user_profiles_calibration_fields.sql`:

```sql
-- 002_user_profiles_calibration_fields.sql
-- Adds RF calibration tracking columns to user_profiles.
-- Idempotent — safe to re-run (all statements use IF NOT EXISTS / DO $$ guards).
-- Does NOT add rf_calibration table — that is migration 003 (Calibration spec).

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
  'DRAFT = unlocked after phase 0; REFINED = rf_locked=true; CONFIRMED = 3+ locked sessions (V3).';
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with the SQL above (project inferred from `SUPABASE_PROJECT_REF` env var). Verify with `mcp__supabase__list_migrations` that `002` appears.

- [ ] **Step 3: Verify columns exist**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_profiles'
  AND column_name IN ('calibration_done', 'rf_bpm', 'rf_confidence_tag');
```
Expected: 3 rows returned. `calibration_done` default `false`, not nullable. `rf_bpm` and `rf_confidence_tag` nullable.

**Commit checkpoint:** `git add backend/migrations/002_user_profiles_calibration_fields.sql && git commit -m "feat(db): add calibration_done/rf_bpm/rf_confidence_tag to user_profiles"`

---

## Task 2: Backend — extend db.py

**Files:**
- Modify: `backend/db.py`

- [ ] **Step 1: Extend `Profile` dataclass**

In `backend/db.py`, the `Profile` dataclass (around line 134) currently has:
```python
@dataclass
class Profile:
    user_id:    str
    age:        int
    sex:        str
    height_cm:  int
    weight_kg:  Optional[Decimal]
    resting_hr: Optional[int]
```

Add the three new fields (with defaults so existing call sites don't break):
```python
@dataclass
class Profile:
    user_id:             str
    age:                 int
    sex:                 str
    height_cm:           int
    weight_kg:           Optional[Decimal]
    resting_hr:          Optional[int]
    calibration_done:    bool             = False
    rf_bpm:              Optional[float]  = None
    rf_confidence_tag:   Optional[str]    = None
```

- [ ] **Step 2: Extend `get_profile()` SELECT**

Change the SQL in `get_profile()` from:
```python
select user_id::text, age, sex, height_cm, weight_kg, resting_hr
from public.user_profiles
where user_id = $1
```
to:
```python
select user_id::text, age, sex, height_cm, weight_kg, resting_hr,
       calibration_done, rf_bpm, rf_confidence_tag
from public.user_profiles
where user_id = $1
```

No other changes to the function — `Profile(**dict(row))` unpacks by name so the new columns resolve automatically.

- [ ] **Step 3: Add `set_calibration_done()` function**

Append after `upsert_profile()` in `backend/db.py`:

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

- [ ] **Step 4: Manual verify**

Start backend locally (`uvicorn backend.main:app --port 8000`), call `GET /api/profile` for an authenticated user — response must not 500. If profile row exists, confirm `calibration_done` field appears in JSON (even as `false`).

**Commit checkpoint:** `git add backend/db.py && git commit -m "feat(db): extend Profile dataclass + get_profile SELECT + set_calibration_done"`

---

## Task 3: Backend — extend profile.py API

**Files:**
- Modify: `backend/api/profile.py`

- [ ] **Step 1: Extend `ProfileOut`**

Add three fields to the existing `ProfileOut` Pydantic model:
```python
class ProfileOut(BaseModel):
    age:               int
    sex:               str
    height_cm:         int
    weight_kg:         Optional[float] = None
    resting_hr:        Optional[int]   = None
    calibration_done:  bool            = False   # NEW
    rf_bpm:            Optional[float] = None    # NEW
    rf_confidence_tag: Optional[str]   = None    # NEW
```

- [ ] **Step 2: Update `get_profile()` handler return**

In the `get_profile` handler, add the three new fields to the `ProfileOut(...)` constructor call:
```python
return ProfileOut(
    age=profile.age,
    sex=profile.sex,
    height_cm=profile.height_cm,
    weight_kg=float(profile.weight_kg) if profile.weight_kg is not None else None,
    resting_hr=profile.resting_hr,
    calibration_done=profile.calibration_done,          # NEW
    rf_bpm=float(profile.rf_bpm) if profile.rf_bpm is not None else None,  # NEW
    rf_confidence_tag=profile.rf_confidence_tag,        # NEW
)
```

Note: `PUT /api/profile` returns `ProfileOut(**body.model_dump())` — body does not include the new fields, so they will default to `False`/`None`. This is acceptable: `PUT` is for profile metadata, not calibration state.

- [ ] **Step 3: Add `CalibrationPatch` model and `PATCH /profile/calibration` endpoint**

Append to `backend/api/profile.py` after the `put_profile` function:

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
        weight_kg=float(profile.weight_kg) if profile.weight_kg is not None else None,
        resting_hr=profile.resting_hr,
        calibration_done=profile.calibration_done,
        rf_bpm=float(profile.rf_bpm) if profile.rf_bpm is not None else None,
        rf_confidence_tag=profile.rf_confidence_tag,
    )
```

- [ ] **Step 4: Verify endpoint exists**

Run backend and check `GET http://localhost:8000/docs` — confirm `PATCH /api/profile/calibration` is listed. Curl test:
```bash
curl -X PATCH http://localhost:8000/api/profile/calibration \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"rf_bpm": 5.8, "rf_locked": false}'
```
Expected: `200` with `calibration_done: true`, `rf_confidence_tag: "DRAFT"`.

**Commit checkpoint:** `git add backend/api/profile.py && git commit -m "feat(api): extend ProfileOut + add PATCH /profile/calibration endpoint"`

---

## Task 4: Backend tests

**Files:**
- Create: `backend/tests/test_calibration_patch.py`

- [ ] **Step 1: Write tests**

Create `backend/tests/test_calibration_patch.py`:

```python
"""Tests for PATCH /api/profile/calibration endpoint."""
import pytest

# Unit test: confidence tag derivation
@pytest.mark.parametrize("rf_locked,expected_tag", [
    (False, "DRAFT"),
    (True, "REFINED"),
])
def test_confidence_tag_derivation(rf_locked, expected_tag):
    tag = "REFINED" if rf_locked else "DRAFT"
    assert tag == expected_tag


# Unit test: rf_bpm validation bounds
@pytest.mark.parametrize("rf_bpm,valid", [
    (3.0, True),
    (5.5, True),
    (10.0, True),
    (2.9, False),
    (10.1, False),
])
def test_rf_bpm_bounds(rf_bpm, valid):
    from pydantic import ValidationError
    from backend.api.profile import CalibrationPatch
    if valid:
        m = CalibrationPatch(rf_bpm=rf_bpm, rf_locked=False)
        assert m.rf_bpm == rf_bpm
    else:
        with pytest.raises(ValidationError):
            CalibrationPatch(rf_bpm=rf_bpm, rf_locked=False)
```

- [ ] **Step 2: Run tests**

```bash
cd C:\Users\user\Desktop\mission_alive
python -m pytest backend/tests/test_calibration_patch.py -v
```

Expected: all tests pass.

**Commit checkpoint:** `git add backend/tests/test_calibration_patch.py && git commit -m "test(api): calibration patch confidence tag + rf_bpm bounds"`

---

## Task 5: Frontend — api.js `patchProfileCalibration`

**Files:**
- Modify: `frontend/src/lib/api.js`

- [ ] **Step 1: Add function**

Append to `frontend/src/lib/api.js`:

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

- [ ] **Step 2: Verify build**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build
```

Expected: zero errors.

**Commit checkpoint:** `git add frontend/src/lib/api.js && git commit -m "feat(api-client): add patchProfileCalibration fetch helper"`

---

## Task 6: Frontend — LoginScreen `initialTab` prop

**Files:**
- Modify: `frontend/src/pages/LoginScreen.jsx`

- [ ] **Step 1: Add `initialTab` prop**

Change the component signature from:
```javascript
export default function LoginScreen() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
```
to:
```javascript
export default function LoginScreen({ initialTab = 'login' }) {
  const [mode, setMode] = useState(initialTab) // 'login' | 'signup'
```

That is the only change. All existing callers that pass no props continue to work (default `'login'`).

- [ ] **Step 2: Verify no runtime errors**

Run `npm run dev`, navigate to LoginScreen. Confirm tab defaults to "Sign in". No console errors.

**Commit checkpoint:** `git add frontend/src/pages/LoginScreen.jsx && git commit -m "feat(login): add initialTab prop for deep-linking from LandingPage"`

---

## Task 7: Frontend — ProfileSetup done-step microcopy

**Files:**
- Modify: `frontend/src/pages/ProfileSetup.jsx`

- [ ] **Step 1: Update the "done" card copy**

Find in `frontend/src/pages/ProfileSetup.jsx`:
```jsx
{current === 'done' && (
  <Card>
    <h1>Your starting baseline is ready</h1>
    <p>We'll refine it from your real H10 sessions over the next few days.</p>
    <PrimaryButton onClick={onComplete}>Continue</PrimaryButton>
  </Card>
)}
```

Replace with:
```jsx
{current === 'done' && (
  <Card>
    <h1>Your breathing baseline is ready.</h1>
    <p>We'll refine your resonance frequency as you complete sessions with your H10.</p>
    <PrimaryButton onClick={onComplete}>Continue</PrimaryButton>
  </Card>
)}
```

No structural change — two strings updated only.

**Commit checkpoint:** `git add frontend/src/pages/ProfileSetup.jsx && git commit -m "copy(profile-setup): update done-step microcopy to mention resonance frequency"`

---

## Task 8: Frontend — rename Landing.jsx → Dashboard.jsx

**Files:**
- Create: `frontend/src/pages/Dashboard.jsx` (copy of Landing.jsx with updated internal references)
- Delete: `frontend/src/pages/Landing.jsx`

- [ ] **Step 1: Copy Landing.jsx to Dashboard.jsx**

```bash
cp "C:/Users/user/Desktop/mission_alive/frontend/src/pages/Landing.jsx" \
   "C:/Users/user/Desktop/mission_alive/frontend/src/pages/Dashboard.jsx"
```

- [ ] **Step 2: Verify no self-references to "Landing" in the file**

```bash
grep -n "Landing" "C:/Users/user/Desktop/mission_alive/frontend/src/pages/Dashboard.jsx"
```

The component is exported as `export default function Landing(...)` — update to `export default function Dashboard(...)` if present. The internal function name must match the filename for React DevTools clarity.

Specifically, if the file contains:
```javascript
export default function Landing({ onStart }) {
```
Change to:
```javascript
export default function Dashboard({ onStart }) {
```

- [ ] **Step 3: Delete Landing.jsx**

```bash
rm "C:/Users/user/Desktop/mission_alive/frontend/src/pages/Landing.jsx"
```

Note: `Landing.module.css` does not exist (confirmed — no CSS module for Landing), so no CSS rename step needed.

- [ ] **Step 4: Verify build**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build
```

Expected: zero errors (App.jsx import will be fixed in Task 9).

**Commit checkpoint:** `git add frontend/src/pages/Dashboard.jsx && git rm frontend/src/pages/Landing.jsx && git commit -m "refactor(pages): rename Landing.jsx to Dashboard.jsx"`

---

## Task 9: Frontend — Calibration `isOnboarding` prop

**Files:**
- Modify: `frontend/src/pages/Calibration.jsx`

- [ ] **Step 1: Understand current Calibration signature**

Current signature (from file):
```javascript
export default function Calibration({ cfg, onLocked, onSkip }) {
```

`onLocked(rfBpm, locked)` fires on `{cal_done}` WS message.
`onSkip()` fires on skip button click.

- [ ] **Step 2: Add `isOnboarding` prop**

Change signature to:
```javascript
export default function Calibration({ cfg, onLocked, onSkip, isOnboarding = false, onComplete }) {
```

`isOnboarding` defaults to `false` so all existing callers (`App.jsx` `case 'calibration':`) are unaffected until App.jsx is updated in Task 10.

The `onComplete` prop is the onboarding-specific callback (receives `{rf_bpm, rf_locked}`). When `isOnboarding === false`, the existing `onLocked`/`onSkip` props handle navigation (no change to that path).

- [ ] **Step 3: Wire `isOnboarding` into the cal_done handler**

Find the section where `onLocked` is currently called on `{cal_done}` WS message. It will be a handler like:
```javascript
if (msg.type === 'cal_done') {
  setRfBpm(msg.rf_bpm)
  onLocked(msg.rf_bpm, msg.rf_locked)
}
```

Extend to:
```javascript
if (msg.type === 'cal_done') {
  setRfBpm(msg.rf_bpm)
  if (isOnboarding && onComplete) {
    onComplete({ rf_bpm: msg.rf_bpm, rf_locked: !!msg.rf_locked })
  } else {
    onLocked(msg.rf_bpm, msg.rf_locked)
  }
}
```

Similarly for the skip path (find `onSkip()` call):
```javascript
// Skip button handler — currently:
onSkip()
// Change to:
if (isOnboarding && onComplete) {
  onComplete({ rf_bpm: 5.5, rf_locked: false })
} else {
  onSkip()
}
```

- [ ] **Step 4: Verify existing session flow still works**

Run `npm run dev`, walk the full flow: Dashboard → Setup → Calibration → Session. Confirm no regressions. `isOnboarding` is `false` (default) on the session path so existing `onLocked`/`onSkip` fire as before.

**Commit checkpoint:** `git add frontend/src/pages/Calibration.jsx && git commit -m "feat(calibration): add isOnboarding prop + onComplete callback for first-time gate"`

---

## Task 10: Frontend — new LandingPage.jsx

**Files:**
- Create: `frontend/src/pages/LandingPage.jsx`
- Create: `frontend/src/pages/LandingPage.module.css`

- [ ] **Step 1: Create LandingPage.module.css**

Create `frontend/src/pages/LandingPage.module.css`:

```css
/* LandingPage.module.css */

.root {
  position: relative;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem 4rem;
  background: var(--bg, #0A0A0F);
  overflow: hidden;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  text-align: center;
  margin-bottom: 2.5rem;
  z-index: 1;
}

.orb {
  opacity: 0.6;
  pointer-events: none;
}

.appName {
  font-family: var(--font-head, 'Outfit', sans-serif);
  font-weight: 700;
  font-size: 2.4rem;
  letter-spacing: -0.03em;
  color: var(--foreground, #EEEEF2);
  margin: 0;
}

.tagline {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 1.1rem;
  line-height: 1.5;
  color: rgba(238, 238, 242, 0.7);
  max-width: 280px;
  white-space: pre-line;
  margin: 0;
}

.ctaGroup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  width: 100%;
  max-width: 340px;
  z-index: 1;
}

.ctaPrimary {
  width: 100%;
  padding: 0.9rem 1.5rem;
  background: var(--vs-peak, #534AB7);
  color: #fff;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.ctaPrimary:hover {
  opacity: 0.88;
}

.ctaPrimary:focus-visible {
  outline: 2px solid #7C6FF7;
  outline-offset: 3px;
}

.ctaSecondary {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 0.9rem;
  color: rgba(238, 238, 242, 0.5);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  padding: 0;
}

.ctaSecondary:focus-visible {
  outline: 2px solid #7C6FF7;
  outline-offset: 3px;
}

.features {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  width: 100%;
  max-width: 340px;
  margin-top: 2.5rem;
  z-index: 1;
}

.featureTile {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
}

.featureIcon {
  width: 24px;
  height: 24px;
  color: #7C6FF7;
}

.featureLabel {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--foreground, #EEEEF2);
  margin: 0;
}

.featureDesc {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 0.72rem;
  line-height: 1.4;
  color: rgba(238, 238, 242, 0.5);
  margin: 0;
}

@media (prefers-reduced-motion: reduce) {
  .orb {
    animation: none;
    opacity: 1;
  }
}
```

- [ ] **Step 2: Create LandingPage.jsx**

Create `frontend/src/pages/LandingPage.jsx`:

```jsx
import styles from './LandingPage.module.css'

// Inline SVG icons — no external icon library added
function IconHeart() {
  return (
    <svg className={styles.featureIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function IconWave() {
  return (
    <svg className={styles.featureIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12c1.5-3 3-4.5 4.5-4.5S9 9 10.5 9s3-3 4.5-3S18 9 19.5 9 22 6 22 6" />
    </svg>
  )
}

function IconRefresh() {
  return (
    <svg className={styles.featureIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function IconDatabase() {
  return (
    <svg className={styles.featureIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

// Minimal inline breath orb — no external component dependency
function AmbientOrb() {
  return (
    <div
      className={styles.orb}
      style={{
        width: 120,
        height: 120,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 40% 40%, rgba(124,111,247,0.35), rgba(83,74,183,0.12) 70%)',
        boxShadow: '0 0 60px rgba(124,111,247,0.18)',
        animation: 'breatheOrb 6s ease-in-out infinite',
      }}
    />
  )
}

const FEATURES = [
  {
    Icon: IconHeart,
    label: 'Real-time HRV',
    desc: 'Tracks your nervous system via Polar H10 or phone camera',
  },
  {
    Icon: IconWave,
    label: 'Resonance breathing',
    desc: 'Guides you to your personal breathing frequency',
  },
  {
    Icon: IconRefresh,
    label: 'Adapts over time',
    desc: 'Learns your resonance from every session',
  },
  {
    Icon: IconDatabase,
    label: 'Session history',
    desc: 'Saves HRV, ANS state, and insights after each session',
  },
]

/**
 * LandingPage — unauthenticated marketing screen.
 * Shown when user === null (before auth resolves to a session).
 *
 * @param {() => void} onGetStarted  CTA "Get started free" → LoginScreen (signup tab)
 * @param {() => void} onSignIn      "Sign in" link → LoginScreen (login tab)
 */
export default function LandingPage({ onGetStarted, onSignIn }) {
  return (
    <div className={styles.root}>
      {/* Keyframe injected once at module level — safe for CSS-in-JS-free setup */}
      <style>{`
        @keyframes breatheOrb {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.12); opacity: 0.75; }
        }
      `}</style>

      <div className={styles.hero}>
        <AmbientOrb />
        <h1 className={styles.appName}>Mission Alive</h1>
        <p className={styles.tagline}>
          {'Personalized biofeedback breathing.\nPowered by your heart.'}
        </p>
      </div>

      <div className={styles.ctaGroup}>
        <button
          type="button"
          className={styles.ctaPrimary}
          onClick={onGetStarted}
        >
          Get started free
        </button>
        <button
          type="button"
          className={styles.ctaSecondary}
          onClick={onSignIn}
        >
          Already have an account? Sign in
        </button>
      </div>

      <div className={styles.features}>
        {FEATURES.map(({ Icon, label, desc }) => (
          <div key={label} className={styles.featureTile}>
            <Icon />
            <p className={styles.featureLabel}>{label}</p>
            <p className={styles.featureDesc}>{desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build
```

Expected: zero errors. LandingPage not yet wired into App.jsx (done in Task 11) so it won't render yet.

**Commit checkpoint:** `git add frontend/src/pages/LandingPage.jsx frontend/src/pages/LandingPage.module.css && git commit -m "feat(ui): add LandingPage marketing screen for unauthenticated users"`

---

## Task 11: Frontend — App.jsx rewire (final assembly)

**Files:**
- Modify: `frontend/src/App.jsx`

This is the highest-risk task. Make changes in the exact order below. Verify build after each sub-step before continuing.

- [ ] **Step 1: Update imports**

Change:
```javascript
import Landing from './pages/Landing.jsx'
```
to:
```javascript
import LandingPage from './pages/LandingPage.jsx'
import Dashboard from './pages/Dashboard.jsx'
```

Also add the new API function:
```javascript
import { getProfile, patchProfileCalibration } from './lib/api.js'
```

- [ ] **Step 2: Change initial screen default**

Change:
```javascript
const [screen, setScreen] = useState('landing')
```
to:
```javascript
const [screen, setScreen] = useState('dashboard')
```

The `landing_page` screen is shown imperatively (when `!user`), not stored in the `screen` state variable. `dashboard` is the correct post-auth default.

- [ ] **Step 3: Replace the `!user` guard with LandingPage**

Change:
```javascript
if (!user) return <LoginScreen />
```
to:
```javascript
if (!user) return (
  <LandingPage
    onGetStarted={() => {
      setScreen('login')
    }}
    onSignIn={() => {
      setScreen('login')
    }}
  />
)
```

And add a new screen case for `'login'` (see Step 6). The `screen` state `'login'` is only reachable when `!user` is false (after `setScreen('login')` is called before auth resolves) — but to handle LandingPage → LoginScreen transition while still unauthenticated, we need the `!user` branch to also honour `screen === 'login'`. Update the guard:

```javascript
if (!user) {
  if (screen === 'login') {
    return <LoginScreen initialTab={loginInitialTab} />
  }
  return (
    <LandingPage
      onGetStarted={() => { setLoginInitialTab('signup'); setScreen('login') }}
      onSignIn={() => { setLoginInitialTab('login'); setScreen('login') }}
    />
  )
}
```

And add `loginInitialTab` state at the top of `AppRoutes`:
```javascript
const [loginInitialTab, setLoginInitialTab] = useState('login')
```

- [ ] **Step 4: Add `calibration_done` gate after profile loads**

Change:
```javascript
if (profile === null) {
  return (
    <ProfileSetup
      onComplete={async () => {
        const p = await getProfile()
        setProfile(p)
        setScreen('landing')
      }}
    />
  )
}
```
to:
```javascript
if (profile === null) {
  return (
    <ProfileSetup
      onComplete={async () => {
        const p = await getProfile()
        setProfile(p)
        // Gate resolves next render: if calibration_done=false, switch block
        // hits the calibration case; else goes to dashboard.
        setScreen(p?.calibration_done === false ? 'calibration_onboarding' : 'dashboard')
      }}
    />
  )
}

if (profile !== null && !profile.calibration_done && screen !== 'calibration_onboarding') {
  // Returning user whose calibration_done is still false (e.g. skipped previously)
  setScreen('calibration_onboarding')
}
```

Note: use `'calibration_onboarding'` as a distinct screen key so it doesn't conflict with the per-session `'calibration'` case.

- [ ] **Step 5: Add `calibration_onboarding` to the switch block**

Add before `case 'setup':`:
```javascript
case 'calibration_onboarding':
  return (
    <Calibration
      cfg={null}
      isOnboarding={true}
      onComplete={async ({ rf_bpm, rf_locked }) => {
        await patchProfileCalibration({ rf_bpm, rf_locked })
        const p = await getProfile()
        setProfile(p)
        setScreen('dashboard')
      }}
      onLocked={() => {}}
      onSkip={() => {
        // Allow skip — calibration_done stays false, gate re-fires on next login
        setScreen('dashboard')
      }}
    />
  )
```

- [ ] **Step 6: Update all `'landing'` references to `'dashboard'` in the switch block**

- `onBack={() => setScreen('landing')}` in Setup → `setScreen('dashboard')`
- `onDiscard={() => { setCfg(null); setScreen('landing') }}` in Session → `setScreen('dashboard')`
- `onDone={() => { setInsightData(null); setCfg(null); setScreen('landing') }}` in Insight → `setScreen('dashboard')`
- `default: // 'landing'` case → `default: // 'dashboard'`
- `return (<Landing onStart=.../>)` → `return (<Dashboard onStart=.../>)`

- [ ] **Step 7: Full build + smoke test**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build
```

Then `npm run dev`, open browser:
1. Logged-out state → LandingPage renders with orb + CTAs
2. Click "Get started free" → LoginScreen opens in signup tab
3. Click "Already have an account? Sign in" → LoginScreen opens in login tab
4. Log in with existing account (calibration_done=true) → Dashboard renders directly
5. Log in with new test account (calibration_done=false) → Calibration screen renders with onboarding context

**Commit checkpoint:**
```bash
git add frontend/src/App.jsx
git commit -m "feat(app): add LandingPage gate + calibration_done first-time flow + Landing→Dashboard rename"
```

---

## Task 12: E2E verification

- [ ] **Step 1: Full pipeline smoke test (manual)**

Walk the complete new-user flow end-to-end:
1. Open app in incognito (unauthenticated) → LandingPage appears
2. "Get started free" → LoginScreen (signup tab active)
3. Sign up with test email → confirm email → sign in
4. ProfileSetup wizard completes → done step shows new microcopy
5. Calibration (isOnboarding=true) runs → on complete: `PATCH /api/profile/calibration` called, profile row updated, `calibration_done=true`
6. Dashboard renders
7. Subsequent login → LandingPage (unauthenticated) → Login → Dashboard (direct, no calibration gate)

- [ ] **Step 2: Returning user with existing profile (calibration_done=true)**

Log in with seeded profile — should go straight to Dashboard, skipping both ProfileSetup and Calibration.

- [ ] **Step 3: Verify DB state**

After step 5 above, run via Supabase MCP:
```sql
SELECT user_id, calibration_done, rf_bpm, rf_confidence_tag
FROM public.user_profiles
WHERE calibration_done = true
LIMIT 5;
```

Expected: at least one row with `calibration_done=true`, `rf_bpm` between 3.0 and 10.0, `rf_confidence_tag` in `('DRAFT', 'REFINED')`.

- [ ] **Step 4: Build passes cleanly**

```bash
cd C:\Users\user\Desktop\mission_alive\frontend && npm run build
python -m pytest backend/tests/test_calibration_patch.py -v
```

Both must pass with zero errors.

**Final commit checkpoint:**
```bash
git add -A
git commit -m "feat(auth-landing): auth+landing screens redesign complete — LandingPage, Dashboard rename, calibration_done gate, PATCH /profile/calibration"
git push origin main
```

---

## Execution Order Summary

| Order | Task | Risk | Files |
|-------|------|------|-------|
| 1 | DB migration | Low | `migrations/002_...sql` |
| 2 | db.py extend | Low | `backend/db.py` |
| 3 | profile.py extend | Low | `backend/api/profile.py` |
| 4 | Backend tests | Low | `backend/tests/test_calibration_patch.py` |
| 5 | api.js helper | Low | `frontend/src/lib/api.js` |
| 6 | LoginScreen prop | Low | `LoginScreen.jsx` |
| 7 | ProfileSetup copy | Low | `ProfileSetup.jsx` |
| 8 | Landing → Dashboard rename | Low | `Dashboard.jsx`, delete `Landing.jsx` |
| 9 | Calibration isOnboarding | Medium | `Calibration.jsx` |
| 10 | LandingPage new | Low | `LandingPage.jsx`, `LandingPage.module.css` |
| 11 | App.jsx rewire | High | `App.jsx` |
| 12 | E2E verification | — | — |

---

## Rollback Notes

- If App.jsx rewire breaks the build, revert Task 11 in full — all prior tasks are independent and safe.
- The DB migration is idempotent; re-running it after rollback causes no harm.
- `Landing.jsx` is preserved in git history (Task 8 uses `git rm`) — recoverable via `git checkout HEAD~1 -- frontend/src/pages/Landing.jsx` if needed.

---

## Out of Scope (do not implement in this plan)

- `rf_confidence_tag = 'CONFIRMED'` — requires session count query; deferred to V3
- "Set up later" skip banner on Dashboard — open question in spec; not blocking; add as follow-up issue
- `rf_calibration` table — belongs in Calibration spec (migration 003), not here
- Any changes to `Session.jsx`, `Insight.jsx`, `Setup.jsx`, `HrvChart`, or the WebSocket pipeline
