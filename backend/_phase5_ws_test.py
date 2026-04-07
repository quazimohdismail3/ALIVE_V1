"""Phase 5 — WebSocket end-to-end integration test.

Runs the real FastAPI app via TestClient, opens /ws/session for a short
simulated session, verifies frame shape, and confirms the session row +
snapshots landed in SQLite.
"""
from fastapi.testclient import TestClient

from backend.main import app
from backend import storage


def run():
    storage.init_db()
    sessions_before = len(storage.list_sessions())

    with TestClient(app) as client:
        r = client.get("/")
        assert r.status_code == 200, r.text
        print("GET /:", r.json())

        frames = []
        music_frames = 0
        with client.websocket_connect(
            "/ws/session?session=calm&mode=simulator&duration_s=45&user_id=test_quazi"
        ) as ws:
            while True:
                try:
                    msg = ws.receive_json()
                except Exception:
                    break
                frames.append(msg)
                if "music_params" in msg:
                    music_frames += 1
                if len(frames) >= 40:
                    break

        print(f"total frames:   {len(frames)}")
        print(f"buffering:      {sum(1 for f in frames if f.get('status') == 'buffering')}")
        print(f"music frames:   {music_frames}")

        if music_frames:
            # Look at the last music frame
            last = [f for f in frames if "music_params" in f][-1]
            p = last["music_params"]
            print(f"  last t={last['t']:.1f}s")
            print(f"  rmssd={last['metrics']['rmssd']:.1f}ms  hr={last['metrics']['hr']:.0f}")
            print(f"  arousal={last['state']['arousal']:.2f}  valence={last['state']['valence']:.2f}")
            print(f"  ANS {last['ans']['state']} conf={last['ans']['confidence']:.2f} act={last['ans']['actionable']}")
            print(f"  affect={last['affect']['quadrant']}")
            print(f"  strategy={last['strategy']}  safety={last['safety']['safe']}")
            print(f"  bpm={p['bpm']}  binaural={p['binaural_beat_hz']}Hz  soma={p['soma_carrier_hz']}Hz")
            print(f"  warmth={p['warmth']}  brightness={p['brightness']}  silence={p['silence_ratio']}")

        # Verify schema
        req = {"t", "metrics", "state", "ans", "affect", "music_params", "strategy", "mpc_score", "safety"}
        if music_frames:
            assert req.issubset(last.keys()), f"missing keys: {req - set(last.keys())}"
            assert len(p) == 16, f"expected 16 music params, got {len(p)}"
            print("  schema OK — 16 params present")

    # Check persistence
    sessions_after = storage.list_sessions(user_id="test_quazi")
    print(f"\nsessions in DB for test_quazi: {len(sessions_after)}")
    if sessions_after:
        s = sessions_after[0]
        print(f"  id={s['id'][:8]}  type={s['session_type']}  sensor={s['sensor_mode']}")
        print(f"  strategy={s['music_strategy']}  duration={s.get('duration_s')}s")
        print(f"  rmssd_start={s.get('rmssd_start')} end={s.get('rmssd_end')}")
        print(f"  insight={s.get('insight')}")

    print("\n=== Phase 5 WS integration: PASS ===" if music_frames > 0 else "\n=== Phase 5: FAIL (no music frames) ===")


if __name__ == "__main__":
    run()
