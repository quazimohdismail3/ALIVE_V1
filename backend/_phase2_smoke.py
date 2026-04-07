"""Phase 2 smoke test — full control loop without the WebSocket.

Runs the simulator → filter → processor → state → dynamics → MPC → music_engine
pipeline for a short calm session and prints the final music params.
"""
from backend.affect_classifier import classify as classify_affect
from backend.ans_classifier import classify as classify_ans
from backend.artifact_filter import ArtifactFilter
from backend.hrv_processor import HRVProcessor
from backend.hrv_simulator import HRVSimulator
from backend.mpc_optimizer import optimize
from backend.safety import SAFE_FALLBACK_PARAMS, SafetySupervisor
from backend.state_dynamics import StateDynamics
from backend.state_estimation import StateEstimator
from backend.trajectory_planner import Trajectory
from backend.insight_engine import SessionSummary, generate_insight
from backend import storage


def run(session: str, n_rr: int = 400, duration_s: float = 600.0):
    sim = HRVSimulator(session, seed=11)
    flt = ArtifactFilter()
    proc = HRVProcessor()
    est = StateEstimator()
    dyn = StateDynamics()
    safety = SafetySupervisor()
    traj = None
    prev_params = None
    rmssd_start = None
    last = None
    dom = {}
    fallback = False

    for i in range(n_rr):
        rr = sim.next_rr()
        r = flt.push(rr)
        if r.accepted is None:
            continue
        proc.push(r.accepted)
        m = proc.compute()
        if m is None:
            continue
        state = est.update(m)
        if traj is None:
            traj = Trajectory(session=session, duration_s=duration_s, start=state)
            rmssd_start = m.rmssd
        elapsed = (i / n_rr) * duration_s
        target = traj.target_at(elapsed)
        ans = classify_ans(m, state.rmssd_norm)
        aff = classify_affect(m, state.rmssd_norm)
        dom[ans.state] = dom.get(ans.state, 0) + 1
        st = safety.check(m, state)
        if st.fallback_active:
            fallback = True
            params = dict(SAFE_FALLBACK_PARAMS)
            strat = "safe"
            score = 0.0
        else:
            dyn.step(state, target, dt=1.0)
            params, strat, score = optimize(state, target, session, prev_params)
            prev_params = params
        last = (m, state, ans, aff, params, strat, score)

    assert last is not None
    m, state, ans, aff, params, strat, score = last
    print(f"=== {session} ===")
    print(f"  RMSSD start={rmssd_start:.1f} end={m.rmssd:.1f}  dRMSSD={m.rmssd - rmssd_start:+.1f}ms")
    print(f"  state arousal={state.arousal:.2f} valence={state.valence:.2f} stab={state.stability:.2f} coh={state.coherence:.2f}")
    print(f"  ANS {ans.state} (conf {ans.confidence:.2f})  strategy={strat}  mpc_score={score:.3f}")
    print(f"  music: bpm={params['bpm']:.0f}  binaural={params['binaural_beat_hz']:.1f}Hz  soma={params['soma_carrier_hz']:.0f}Hz")
    print(f"        warmth={params['warmth']:.2f} brightness={params['brightness']:.2f} silence={params['silence_ratio']:.2f}")

    dominant = max(dom, key=dom.get)
    summary = SessionSummary(
        session=session, duration_s=duration_s,
        rmssd_start=rmssd_start, rmssd_end=m.rmssd,
        arousal_start=0.5, arousal_end=state.arousal,
        dominant_state=dominant, fallback_triggered=fallback,
        sensor_mode="simulator",
    )
    print(f"  insight: {generate_insight(summary)}")


if __name__ == "__main__":
    storage.init_db()
    for s in ("calm", "energy", "focus", "recovery", "presence", "adhd_flow"):
        run(s)
