"""FastAPI entry — routes, WebSocket session stream, CORS.

Run: uvicorn backend.main:app --reload
WebSocket: ws://localhost:8000/ws/session?session=calm&mode=1
  mode: 1=simulator, 2=phone, 3=polar_h10
"""
from __future__ import annotations
import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Optional, List

import numpy as np
import sentry_sdk
from pydantic import BaseModel
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.asyncpg import AsyncPGIntegration

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .auth import validate_token, AuthError
from . import db, whoop_api
from .rf_calibration import BayesianRFOptimizer, compute_coherence_at_frequency, MODE_CALIBRATION_CONFIG
from .affect_classifier import classify as classify_affect
from .ans_classifier import classify as classify_ans
from .vs_score import compute_vs_adaptive
from .state_classifier import StateClassifier
from .latent_state import LatentStateExtractor
from .artifact_filter import ArtifactFilter
from .config import CONTROL_HZ
from .hrv_processor import HRVProcessor
from .hrv_simulator import HRVSimulator, PROFILES
from .mpc_optimizer import optimize
from .safety import SAFE_FALLBACK_PARAMS, SafetySupervisor
from .state_dynamics import StateDynamics
from .state_estimation import StateEstimator
from .trajectory_planner import Trajectory
from .session_manager import SessionManager
from .context.circadian import get_circadian_context, session_circadian_fit


_SENTRY_DSN = os.environ.get("SENTRY_DSN")
_ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")

if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        environment=_ENVIRONMENT,
        traces_sample_rate=0.2,
        integrations=[FastApiIntegration(), AsyncPGIntegration()],
    )


app = FastAPI(title="Mission Alive API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    if os.environ.get("DATABASE_URL"):
        await db.init_pool()


@app.on_event("shutdown")
async def shutdown():
    await db.close_pool()


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


class SessionEndRequest(BaseModel):
    session_id: str
    session_type: str
    mode: int
    peak_vs: int
    final_vs: int
    phases_completed: List[dict] = []
    hrv_summary: dict = {}
    circadian_phase: str = "UNKNOWN"
    circadian_fit_score: float = 0.5


@app.post("/api/session/end")
async def end_session(req: SessionEndRequest):
    skill_transfer = round(req.final_vs / max(req.peak_vs, 1), 2) if req.peak_vs > 0 else None
    return {
        "session_id": req.session_id,
        "skill_transfer_score": skill_transfer,
        "peak_vs": req.peak_vs,
        "final_vs": req.final_vs,
        "stored": True,
    }


@app.websocket("/ws/session")
async def ws_session(
    websocket: WebSocket,
    session: str = Query("calm"),
    mode: int = Query(1),
    duration_s: float = Query(600.0),
):
    """1Hz control loop. First message must be {"type":"auth","token":"<jwt>"}.

    mode: 1=simulator, 2=phone, 3=polar_h10
    """
    await websocket.accept()

    # --- Auth handshake (first message)
    try:
        auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
    except asyncio.TimeoutError:
        await websocket.close(1008)
        return
    if auth_msg.get("type") != "auth" or not auth_msg.get("token"):
        await websocket.close(1008)
        return
    try:
        user_claims = validate_token(auth_msg["token"])
    except AuthError:
        await websocket.close(1008)
        return
    user_id = user_claims["sub"]
    sentry_sdk.set_user({"id": user_id, "email": user_claims.get("email")})
    await websocket.send_json({"type": "auth_ok"})

    # Map mode int → simulator string for HRVSimulator (1=simulator, 2/3=real sensor)
    mode_str = "simulator" if mode == 1 else "polar"
    session_profile = session if session in PROFILES else "calm"

    # Create session row in Postgres (falls back gracefully if DB not configured)
    sid = None
    if os.environ.get("DATABASE_URL"):
        sid = await db.create_session(
            user_id=user_id,
            session_type=session_profile,
            mode=mode,
            device_label=auth_msg.get("device_label"),
        )

    sim = HRVSimulator(session_profile) if mode == 1 else None
    flt = ArtifactFilter()
    proc = HRVProcessor()
    est = StateEstimator()
    dyn = StateDynamics()
    safety = SafetySupervisor()
    state_classifier = StateClassifier()
    latent_extractor = LatentStateExtractor()

    traj: Trajectory | None = None
    prev_params: dict | None = None
    t_start = time.time()
    rmssd_start: float | None = None
    arousal_start: float | None = None
    last_state = None
    last_ans = None
    fallback_triggered = False
    discard_flag = False
    state_dom_counter: dict[str, int] = {}
    vs_result: dict = {}
    metrics = None

    # RF calibration state — per-session, reset on each WebSocket connection
    rf_optimizer = BayesianRFOptimizer()  # default prior; no height/prior_rf without user profile
    rf_locked = False
    rf_bpm = rf_optimizer.f0
    rf_coherence = 0.0
    current_mode = 2  # default Mode 2 (H10); updated from session start message if available
    _rf_config = MODE_CALIBRATION_CONFIG[current_mode]
    session_manager = SessionManager(session_type=session_profile, mode=current_mode)
    circadian_ctx = get_circadian_context("UTC")  # timezone from client in Phase H
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
            sqi = None
            for rr in rrs:
                r = flt.push(rr)
                sqi = r.sqi
                if r.accepted is not None:
                    proc.push(r.accepted)
                    _rr_buffer.append(r.accepted)

            metrics = proc.compute()
            if metrics is None:
                await websocket.send_json({"status": "buffering", "n_rr": len(proc.buf)})
                continue

            if sqi is not None and sqi < flt.sqi_threshold:
                await websocket.send_json({"status": "low_sqi", "sqi": round(sqi, 3)})
                continue

            # --- State estimation
            state = est.update(metrics)
            if rmssd_start is None:
                rmssd_start = metrics.rmssd
                traj = Trajectory(session=session_profile, duration_s=duration_s, start=state)

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

            # --- VS score (mode-adaptive; unavailable components get weight redistributed)
            # lf_coherence_at_rf, rsa_amplitude_norm, rmssd_velocity_norm filled Phase C/E
            # sd2_sd1_norm derived from existing Poincaré metrics
            _hrv_d = metrics.to_dict()
            _sd2 = _hrv_d.get("sd2", 0.0) or 0.0
            _sd1 = _hrv_d.get("sd1", 1.0) or 1.0
            _sd2_sd1_norm = min(1.0, (_sd2 / max(_sd1, 0.01)) / 3.0)  # normalize: ratio ~0–3 → 0–1
            vs_components = {
                "lf_coherence": _hrv_d.get("lf_coherence_at_rf"),      # filled Phase C
                "rsa_amplitude": _hrv_d.get("rsa_amplitude_norm"),      # filled Phase E
                "rmssd_trajectory": _hrv_d.get("rmssd_velocity_norm"),  # filled Phase E
                "dfa_alpha1": min(1.0, max(0.0, (_hrv_d.get("dfa_alpha1", 0.0) or 0.0) / 2.0)),
                "breath_rsa_lock": None,  # filled Phase E
                "posture_openness": None,  # filled Phase E
                "sd2_sd1_ratio": _sd2_sd1_norm,
            }
            vs_result = compute_vs_adaptive(vs_components, mode=current_mode, confidences={})
            current_phase = session_manager.update(vs_result.get("vs", 0), _hrv_d)

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
                    state=state, target=target, session=session_profile, prev_params=prev_params
                )
                prev_params = best_params

            # --- Persist snapshot
            if sid and os.environ.get("DATABASE_URL"):
                ls = latent_extractor.compute(metrics, mode=current_mode)
                await db.write_snapshot(
                    session_id=sid,
                    user_id=user_id,
                    epoch_s=int(elapsed),
                    metrics={
                        "rmssd": metrics.rmssd,
                        "sdnn": metrics.sdnn,
                        "lf_hf": metrics.lf_hf,
                        "dfa_a1": metrics.dfa_a1,
                        "svi": getattr(metrics, "svi", None),
                        "poincare_sd1": getattr(metrics, "poincare_sd1", None),
                        "poincare_sd2": getattr(metrics, "poincare_sd2", None),
                        "vs_score": vs_result.get("vs"),
                        "ans_state": last_ans,
                        "arc_phase": session_manager.current_phase,
                        "rf_coherence": rf_coherence,
                        "rf_locked": rf_locked,
                        "ls_arousal": ls.arousal,
                        "ls_valence": ls.valence,
                        "ls_regulation": ls.regulation,
                        "ls_engagement": ls.engagement,
                    },
                )

            # --- Emit frame
            await websocket.send_json({
                "t": elapsed,
                "metrics": metrics.to_dict(),
                "state": state.to_dict(),
                "ans": {"state": ans.state, "confidence": ans.confidence, "actionable": ans.actionable},
                "affect": {"arousal": affect.arousal, "valence": affect.valence, "quadrant": affect.quadrant},
                "vs": vs_result,
                "music_params": best_params,
                "strategy": strategy,
                "mpc_score": score,
                "safety": {"safe": safety_status.safe, "reason": safety_status.reason},
                "rf_locked": rf_locked,
                "rf_bpm": rf_bpm,
                "rf_coherence": rf_coherence,
                "session_phase": current_phase,
                "session_type": session_manager.state.session_type,
            })

    except WebSocketDisconnect:
        pass
    finally:
        # Finalize session record (skipped on discard — snapshots kept, no final metrics)
        if not discard_flag and last_state is not None and rmssd_start is not None and sid:
            if os.environ.get("DATABASE_URL"):
                elapsed_total = int(time.time() - t_start)
                final_vs_val = vs_result.get("vs", 0) if vs_result else 0
                peak_vs_val = max(
                    h.get("vs", 0) if isinstance(h, dict) else 0
                    for h in [{"vs": final_vs_val}]
                )
                await db.finish_session(
                    session_id=sid,
                    outcome={
                        "ended_at": datetime.now(timezone.utc).isoformat(),
                        "duration_s": elapsed_total,
                        "peak_vs": peak_vs_val,
                        "final_vs": final_vs_val,
                        "skill_transfer_score": final_vs_val / 100.0 if final_vs_val else None,
                        "rf_locked": rf_locked,
                        "rf_bpm": rf_bpm,
                        "rf_lock_epoch_s": getattr(rf_optimizer, "_lock_epoch", None),
                        "arc_phases_completed": session_manager.phases_completed,
                        "circadian_phase": circadian_ctx.get("phase"),
                        "circadian_fit_score": circadian_ctx.get("fit_score"),
                        "rr_total": len(_rr_buffer),
                        "rr_rejected": flt.rejected_count if hasattr(flt, "rejected_count") else None,
                        "sqi_mean": None,
                        "discarded": False,
                    },
                )
        try:
            await websocket.close()
        except Exception:
            pass
