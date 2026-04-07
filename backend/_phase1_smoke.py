"""Phase 1 smoke test — runs the simulator → filter → processor → state pipeline."""
from backend.hrv_simulator import HRVSimulator
from backend.artifact_filter import ArtifactFilter
from backend.hrv_processor import HRVProcessor
from backend.state_estimation import StateEstimator
from backend.state_dynamics import StateDynamics
from backend.ans_classifier import classify as classify_ans
from backend.affect_classifier import classify as classify_affect
from backend.safety import SafetySupervisor


def run(profile: str, n: int = 200):
    sim = HRVSimulator(profile, seed=7)
    flt = ArtifactFilter()
    proc = HRVProcessor()
    est = StateEstimator()
    dyn = StateDynamics()
    safety = SafetySupervisor()

    last_print = None
    accepted_count = 0
    for i in range(n):
        rr = sim.next_rr()
        r = flt.push(rr)
        if r.accepted is None:
            continue
        accepted_count += 1
        proc.push(r.accepted)
        m = proc.compute()
        if m is None:
            continue
        state = est.update(m)
        ans = classify_ans(m, state.rmssd_norm)
        affect = classify_affect(m, state.rmssd_norm)
        sstatus = safety.check(m, state)
        last_print = (i, m, state, ans, affect, sstatus, r.sqi)

    assert last_print is not None, f"never produced metrics for {profile}"
    i, m, state, ans, affect, sstatus, sqi = last_print
    print(f"--- {profile} ---  cycles={i+1}  accepted={accepted_count}  sqi={sqi:.2f}")
    print(f"  RMSSD={m.rmssd:6.1f}  HR={m.hr:5.1f}  SD1/SD2={m.sd1_sd2_ratio:.2f}  SVI={m.svi:.3f}  DFA={m.dfa_alpha1:.2f}")
    print(f"  state arousal={state.arousal:.2f} valence={state.valence:.2f} stab={state.stability:.2f} coh={state.coherence:.2f}")
    print(f"  ANS  {ans.state} (conf={ans.confidence:.2f})  actionable={ans.actionable}")
    print(f"  Affect {affect.quadrant}  arousal={affect.arousal:.2f} valence={affect.valence:.2f}")
    print(f"  Safety safe={sstatus.safe} reason={sstatus.reason}")


if __name__ == "__main__":
    for p in ("calm", "energy", "focus", "recovery", "presence", "adhd_flow"):
        run(p)
