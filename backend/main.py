"""FastAPI entry — routes, WebSocket session stream, CORS.

Run: uvicorn backend.main:app --reload
WebSocket: ws://localhost:8000/ws/session?session=calm&mode=simulator
"""
from __future__ import annotations
import asyncio
import json
import time
from typing import Optional

import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import storage, whoop_api
from .rf_calibration import BayesianRFOptimizer, compute_coherence_at_frequency, MODE_CALIBRATION_CONFIG
from .affect_classifier import classify as classify_affect
from .ans_classifier import classify as classify_ans
from .artifact_filter import ArtifactFilter
from .config import CONTROL_HZ
from .hrv_processor import HRVProcessor
from .hrv_simulator import HRVSimulator, PROFILES
from .mpc_optimizer import optimize
from .safety import SAFE_FALLBACK_PARAMS, SafetySupervisor
from .state_dynamics import StateDynamics
from .state_estimation import StateEstimator
from .trajectory_planner import Trajectory


app = FastAPI(title="Mission Alive API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    storage.init_db()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return {
        "name": "Mission Alive",
        "version": "1.0.0",
        "sessions": list(PROFILES.keys()),
        "strategy_b_enabled": False,
    }


@app.get("/sessions")
def list_sessions(user_id: Optional[str] = None):
    return {"sessions": storage.list_sessions(user_id=user_id)}


@app.get("/whoop/auth_url")
def whoop_auth_url():
    if not whoop_api.is_configured():
        return {"configured": False}
    return {"configured": True, "url": whoop_api.auth_url()}


@app.get("/whoop/daily")
async def whoop_daily(access_token: str):
    if not whoop_api.is_configured():
        raise HTTPException(status_code=503, detail="WHOOP not configured")
    return await whoop_api.daily_metrics(access_token)


@app.websocket("/ws/session")
async def ws_session(
    websocket: WebSocket,
    session: str = Query("calm"),
    mode: str = Query("simulator"),
    duration_s: float = Query(600.0),
    user_id: Optional[str] = Query(None),
):
    """1Hz control loop.

    Simulator mode generates RR internally. For real sensor modes (polar/whoop),
    the client sends computed RRs as JSON messages: {"rr": 812.5}.
    """
    await websocket.accept()

    if session not in PROFILES:
        await websocket.send_json({"error": f"unknown session {session}"})
        await websocket.close()
        return

    sid = storage.create_session(
        session_type=session,
        sensor_mode=mode,
        music_strategy="A",
        user_id=user_id,
    )

    sim = HRVSimulator(session) if mode == "simulator" else None
    flt = ArtifactFilter()
    proc = HRVProcessor()
    est = StateEstimator()
    dyn = StateDynamics()
    safety = SafetySupervisor()

    traj: Trajectory | None = None
    prev_params: dict | None = None
    t_start = time.time()
    rmssd_start: float | None = None
    last_state = None
    last_ans = None
    fallback_triggered = False
    discard_flag = False
    state_dom_counter: dict[str, int] = {}

    # RF calibration state — per-session, reset on each WebSocket connection
    rf_optimizer = BayesianRFOptimizer()  # default prior; no height/prior_rf without user profile
    rf_locked = False
    rf_bpm = rf_optimizer.f0
    rf_coherence = 0.0
    current_mode = 2  # default Mode 2 (H10); updated from session start message if available
    _rf_config = MODE_CALIBRATION_CONFIG[current_mode]
    _settling_start = t_start
    _rr_buffer: list[float] = []  # rolling buffer of accepted RR intervals for RF coherence
    _resp_buffer: list[float] = []  # placeholder; real resp from H10 accel or mic in future modes

    try:
        while True:
            cycle_t0 = time.time()
            elapsed = cycle_t0 - t_start
            if elapsed >= duration_s:
                break

            # --- Check for discard/control messages (non-blocking, both modes)
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=0)
                msg_ctrl = json.loads(raw)
                if msg_ctrl.get("cmd") == "discard":
                    discard_flag = True
                    raise WebSocketDisconnect()
            except asyncio.TimeoutError:
                pass

            # --- RR acquisition: ~1s of beats
            rrs: list[float] = []
            if sim is not None:
                t_target = cycle_t0 + 1.0
                while time.time() < t_target:
                    rr = sim.next_rr()
                    rrs.append(rr)
                    await asyncio.sleep(rr / 1000.0)
            else:
                # Real-sensor mode: receive RRs with a 1s timeout
                try:
                    while True:
                        raw = await asyncio.wait_for(
                            websocket.receive_text(), timeout=1.0
                        )
                        msg = json.loads(raw)
                        if "rr" in msg:
                            rrs.append(float(msg["rr"]))
                        elif msg.get("cmd") == "stop":
                            raise WebSocketDisconnect()
                        elif msg.get("cmd") == "discard":
                            discard_flag = True
                            raise WebSocketDisconnect()
                except asyncio.TimeoutError:
                    pass

            # --- Filter + metrics
            for rr in rrs:
                r = flt.push(rr)
                if r.accepted is not None:
                    proc.push(r.accepted)
                    _rr_buffer.append(r.accepted)

            metrics = proc.compute()
            if metrics is None:
                await websocket.send_json({"status": "buffering", "n_rr": len(proc.buf)})
                continue

            # --- State estimation
            state = est.update(metrics)
            if rmssd_start is None:
                rmssd_start = metrics.rmssd
                traj = Trajectory(session=session, duration_s=duration_s, start=state)

            target = traj.target_at(elapsed) if traj else state

            # --- RF calibration — runs during settling phase, stops once locked
            if not rf_locked:
                elapsed_since_settle = time.time() - _settling_start
                if elapsed_since_settle > _rf_config["settling_seconds"] and len(_rr_buffer) >= 15:
                    _resp_arr = np.array(_resp_buffer[-100:]) if _resp_buffer else np.zeros(50)
                    rf_coherence = compute_coherence_at_frequency(_rr_buffer[-60:], _resp_arr, rf_bpm)
                    rf_optimizer.observe(rf_bpm, rf_coherence)
                    if rf_coherence >= _rf_config["min_coherence_lock"]:
                        rf_locked = True
                        rf_bpm, _ = rf_optimizer.best_estimate()
                    else:
                        rf_bpm = rf_optimizer.next_evaluation_point()

            # --- Parallel classifiers
            ans = classify_ans(metrics, state.rmssd_norm)
            affect = classify_affect(metrics, state.rmssd_norm)
            state_dom_counter[ans.state] = state_dom_counter.get(ans.state, 0) + 1
            last_ans = ans
            last_state = state

            # --- Safety
            safety_status = safety.check(metrics, state)
            if safety_status.fallback_active:
                fallback_triggered = True
                best_params = dict(SAFE_FALLBACK_PARAMS)
                strategy = "safe"
                score = 0.0
            else:
                # --- Dynamics + MPC
                _steered = dyn.step(state, target, dt=1.0)
                best_params, strategy, score = optimize(
                    state=state, target=target, session=session, prev_params=prev_params
                )
                prev_params = best_params

            # --- Persist snapshot
            storage.log_snapshot(
                session_id=sid,
                t_offset=elapsed,
                metrics=metrics.to_dict(),
                state=state.to_dict(),
                params=best_params,
            )

            # --- Emit frame
            await websocket.send_json({
                "t": elapsed,
                "metrics": metrics.to_dict(),
                "state": state.to_dict(),
                "ans": {"state": ans.state, "confidence": ans.confidence, "actionable": ans.actionable},
                "affect": {"arousal": affect.arousal, "valence": affect.valence, "quadrant": affect.quadrant},
                "music_params": best_params,
                "strategy": strategy,
                "mpc_score": score,
                "safety": {"safe": safety_status.safe, "reason": safety_status.reason},
                "rf_locked": rf_locked,
                "rf_bpm": rf_bpm,
                "rf_coherence": rf_coherence,
            })

    except WebSocketDisconnect:
        pass
    finally:
        # Finalize session record (skipped on discard — snapshots kept, no final metrics)
        if not discard_flag and last_state is not None and rmssd_start is not None:
            from .insight_engine import SessionSummary, generate_insight
            dominant = max(state_dom_counter, key=state_dom_counter.get) if state_dom_counter else "unknown"
            summary = SessionSummary(
                session=session,
                duration_s=time.time() - t_start,
                rmssd_start=rmssd_start,
                rmssd_end=metrics.rmssd if metrics else rmssd_start,
                arousal_start=last_state.arousal,  # crude; frontend can pass true start
                arousal_end=last_state.arousal,
                dominant_state=dominant,
                fallback_triggered=fallback_triggered,
                sensor_mode=mode,
            )
            insight = generate_insight(summary)
            storage.finish_session(
                session_id=sid,
                rmssd_start=rmssd_start,
                rmssd_end=metrics.rmssd if metrics else rmssd_start,
                arousal_start=last_state.arousal,
                arousal_end=last_state.arousal,
                dominant_state=dominant,
                fallback_triggered=fallback_triggered,
                insight=insight,
            )
        try:
            await websocket.close()
        except Exception:
            pass
