# Mission Alive

Closed-loop bioadaptive music for the autonomic nervous system.

Read HRV → estimate 6D autonomic state → plan a nonlinear trajectory →
optimize 16 music parameters via MPC → generate adaptive audio through
Tone.js → measure physiological response → close the loop.

## V1 status

Tag: `v1.0-mission-alive-loop-alive`

- Backend (Python 3.11 / FastAPI / SQLite)
  - HRV pipeline: simulator → artifact filter → dual-window processor
  - 6D state estimation (RMSSD-central, personal normalization, EMA smoothing)
  - Parallel L3 polyvagal + L4 Russell circumplex classifiers
  - Second-order PD dynamics (Kp=0.15, Kd=0.8)
  - MPC optimizer (12 candidates, forward model + smoothness penalty)
  - Music engine **Strategy A** (16 params, deterministic nonlinear mapping)
  - **Strategy B stubbed** for reproducibility + offline-capability
  - Safety supervisor with 3-trigger fallback
  - Insight engine (14 rules)
  - WebSocket `/ws/session` 1Hz control loop
- Frontend (Vite + React + Tone.js + PWA)
  - 7-component audio engine with 2000ms ramps (no clicks)
  - Binaural L=lower, R=higher (spec-critical invariant)
  - Dorian tritone excluded (spec-critical invariant)
  - Tempo: low RMSSD → slower (spec-critical invariant)
  - Web Bluetooth: Polar H10 + WHOOP
  - 5-stage state machine: landing → picker → calibration → session → end
  - Design system: DM Serif Display / DM Sans / JetBrains Mono, state-driven CSS

## Run locally

```bash
# Backend
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173 on a mobile-sized viewport (390px).

## Tests

```bash
# Pipeline smoke (all 6 profiles)
python -m backend._phase1_smoke
python -m backend._phase2_smoke

# End-to-end WebSocket + DB persistence
python -m backend._phase5_ws_test
```

## Environment

Copy `.env.example` to `.env` and fill in any optional keys (WHOOP/Spotify).
`GEMINI_API_KEY` is **not** required in V1.

## Architecture decisions

- **Path A (SaaS from day 1):** multi-tenant fields (`user_id`, `sensor_mode`,
  `music_strategy`) are present in the V1 schema even though V1 is single-user local.
- **Strategy B stubbed:** Strategy A is reproducible (same input → same output)
  which is required for the V1 closed-loop physiological claims.
  `gemini_mapper.map_state_to_params()` returns `None`; `music_engine` falls
  through to Strategy A. Revive in V1.5 by implementing the stub.
- **RMSSD is central and non-negotiable.** Normalization is personal
  percentile only (52–122 ms for the reference subject), never population norms.
- **Polyvagal + Russell run in parallel**, never sequential.

## Critical invariants (never reintroduce bugs)

1. Binaural: LEFT = lower freq, RIGHT = higher
2. Dorian scale: ratio 1.414 (tritone) excluded
3. Tempo: low RMSSD → slower tempo (more stillness)
4. RMSSD normalization: personal percentile only
5. ΔRMSSD ≥ 5 ms threshold + 2-cycle confirmation before state change
6. All music param changes ramp 2000 ms (no clicks)
7. No LF/HF ratio as sympathetic proxy (Billman 2013)
8. No linear trajectory interpolation
