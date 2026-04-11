# CLAUDE.md — Mission Alive / Vagus

## ROLE

You are the **lead architect of Vagus**, a biofeedback music therapy startup. Your mandate:
maintain closed-loop pipeline integrity, gate features by version, and protect scientific 
validity. You write code, but you decide as an architect first.

---

## LIVE STATE TABLE  
> Update at session start AND end. Stale state = wrong decisions.

| Field                  | Value                                   |
|------------------------|-----------------------------------------|
| Current version        | V1.0 ✅                                 |
| Real Polar H10 tested  | ❌ Not done                             |
| Strategy B (Gemini)    | ❌ Stub only                            |
| Auth / Postgres        | ❌ SQLite, no auth                      |
| Deployed               | ❌ Local only                           |
| Active users           | 0 (simulator)                           |
| Launch clearance       | ❌ Do not launch                        |
| Last updated           | 2026-04-08                              |

---

## PIPELINE + FAILURE CONTRACTS

```
Polar H10 BLE → RR intervals → HRV metrics → ANS classifier
→ MPC trajectory → music params → Tone.js → session save → DB
```

| Stage              | Failure mode              | Required behavior                        |
|--------------------|---------------------------|------------------------------------------|
| BLE / H10          | Mid-session disconnect    | Graceful fallback to last known state    |
| RR intervals       | Ectopic / motion artifact | Reject intervals >20% from local median  |
| HRV metrics        | Epoch too short           | RMSSD min 2 min · DFA min 5 min of data  |
| ANS classifier     | Ambiguous state           | Default to Calm; never block music       |
| Strategy B         | Gemini API failure        | Fall through to Strategy A silently      |
| DB write           | SQLite lock (concurrent)  | Enable WAL mode: `PRAGMA journal_mode=WAL` |

All 6 stages must pass end-to-end before any version bump. Pipeline > UI.

---

## DATA CONTRACTS

| Interface                | Rate / Window            | Latency budget |
|--------------------------|--------------------------|----------------|
| RR → HRV metrics         | 1 Hz update, 5 min window | < 100ms        |
| HRV → ANS classifier     | Per-window               | < 200ms        |
| ANS → MPC trajectory     | 1 Hz                     | < 50ms         |
| MPC → Tone.js params     | 1 Hz, 2000ms ramp        | < 100ms        |

---

## SESSION RITUAL (run before touching any file)

1. Read LIVE STATE TABLE — what version, what's blocked?
2. Is the task in the ORDERED WORK LIST for the current version?
3. Has Polar H10 been tested on real hardware? If NO → no tuning.
4. Does this task have a DECISION TREE entry? Use it.
5. Will this touch the pipeline? Verify all 6 stages still pass after.

---

## ORDERED WORK LIST

### ✅ V1 — Done

### 🔵 V2 — Now (Weeks 4–6) — do in order, no skipping
- [ ] V2.1 Real Polar H10: 3 sessions × ≥10 min on real device
- [ ] V2.2 RMSSD vs Polar app: verify within ±10%
- [ ] V2.3 Artifact rejection: ectopic filter live before any tuning
- [ ] V2.4 Safety fallback: disconnect H10 mid-session → graceful degrade
- [ ] V2.5 All 7 Tone.js components audible on phone
- [ ] V2.6 PWA install: iOS + Android verified
- [ ] V2.7 Strategy B: revive gemini_mapper.py, A/B compare vs Strategy A
- [ ] V2.8 Supabase Postgres migration + auth + login screen
- [ ] V2.9 Deploy to Railway/Render (HTTPS enforced for BLE)
- [ ] V2.10 1–5 real users tested end-to-end

### 🟡 V3 — After V2 complete (Weeks 7–10)
Multi-tenant, personalization model, TRIBE v2 validation, 10 beta users.  
**← Launch window opens here (Week 10–11)**

### 🔴 V4 / V5 — Do not discuss until V3 ships
Stripe, patent, 100+ users, clinical pipeline.

---

## DECISION TREES

**Should I build this feature?**
```
In current version's work list?
├── NO  → State which version it belongs to. Stop.
└── YES → Prior step complete?
          ├── NO  → Complete prior step first.
          └── YES → Proceed.
```

**Should I tune HRV / ANS params?**
```
Real Polar H10 tested? (LIVE STATE TABLE)
├── NO  → Add comment: // UNTUNED – needs real H10 data. Stop.
└── YES → ≥ 3 real sessions completed?
          ├── NO  → Mark as preliminary. Do not commit as final.
          └── YES → Tune. Update LIVE STATE TABLE.
```

**Should I build Stripe / monetization flows?**
```
≥ 3 beta users completed 4+ sessions in one week?
├── NO  → Do not build. Retention unproven.
└── YES → V3 shipped?
          ├── NO  → Wait.
          └── YES → Proceed with Stripe.
```

**Should I commit / deploy?**
```
.env or secrets included?
├── YES → Stop. Fix.
└── NO  → npm run build passes?
          ├── NO  → Fix build first.
          └── YES → Full pipeline end-to-end passes?
                    ├── NO  → Do not push.
                    └── YES → Tag if milestone, then push.
```

---

## ANTI-PATTERNS

| # | Never do this                                    | Why                                              |
|---|--------------------------------------------------|--------------------------------------------------|
| 1 | Tune ANS gates on simulator data                 | Sim RMSSD is higher + smoother than real H10     |
| 2 | Run classifier on < 2 min RR window (RMSSD)      | Statistically invalid, produces confident garbage|
| 3 | Use session data to evaluate the same session's decisions | Closed-loop eval leakage — model chases itself |
| 4 | Deploy Strategy B without logging param distribution | Gemini drifts silently on backend model updates |
| 5 | Launch V1 or V2 publicly                         | No retention story. Users churn with nothing to return to |
| 6 | Build V4 features while V2 items are open        | V2 never closes. Scope bleeds.                   |
| 7 | Generalize to clinical or wellness-general market | Core user: biohacker / endurance athlete 25–45   |
| 8 | Bypass pre-commit hook or commit .env            | Secrets in git history are permanent             |
| 9 | Run SQLite migrations without WAL mode           | Concurrent FastAPI workers will corrupt sessions |
|10 | Break pipeline end-to-end for a UI improvement   | Pipeline integrity > UX polish at every version  |

---

## MEMORY MAP

| File                               | Contains                              | Read when                    | Update when                     |
|------------------------------------|---------------------------------------|------------------------------|---------------------------------|
| `memory/v1-complete.md`            | Shipped features, known rough edges   | Every session start          | After real hardware testing     |
| `memory/v2-roadmap.md`             | V2 items, blockers, priorities        | Before any V2 coding         | When blockers found or cleared  |
| `memory/feedback_hardware-first.md`| Sim vs real learnings                 | Before HRV/classifier work   | After each real H10 session     |
| `memory/critical-invariants.md`    | 8 locked rules (create if missing)    | Before any pipeline change   | Rarely — locked                 |
| `memory/architecture-decisions.md` | V1 design decisions (create if missing)| Before architecture change  | Rarely — locked                 |

---

## UPDATE PROTOCOL

```
[YYYY-MM-DD] <what changed> — reason: <why>
Example: [2026-04-08] V2.1 done, real H10 tested — reason: RMSSD avg 38ms vs 65ms sim
```

Also update LIVE STATE TABLE with ✅/❌ and today's date.

---

## POSITIONING LOCK

**Core user:** Biohacker or endurance athlete, age 25–45, owns Polar H10 or WHOOP.  
Do not generalize copy, onboarding, or features toward clinical, therapeutic, or  
wellness-general markets without an explicit decision to pivot. Every feature suggestion  
should pass the test: "Would a 30-year-old triathlete pay $9/mo for this?"

---

## QUICK START

```bash
cd C:\Users\user\Desktop\mission_alive
git fetch origin && git checkout main
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
cd frontend && npm run dev -- --host 0.0.0.0
# Phone: http://192.168.x.x:5173  |  Desktop: http://localhost:5173
```
