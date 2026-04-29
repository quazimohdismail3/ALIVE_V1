from backend.latent_state import LatentStateExtractor, LatentStateVector

ext = LatentStateExtractor()

def test_mode2_valence_is_null():
    hrv = {"rmssd": 45, "lf_coherence_at_rf": 0.7, "sample_entropy": 1.2,
           "sd1": 25, "sd2": 50, "signal_quality": 0.9}
    r = ext.compute(hrv, {}, {}, {"circadian_score": 0.6}, mode=2)
    assert r.valence is None

def test_mode1_valence_present():
    hrv = {"rmssd": 45, "sample_entropy": 1.2, "sd1": 25, "sd2": 50}
    face = {"valence_proxy": 0.4, "ear": 0.28}
    r = ext.compute(hrv, face, {}, {}, mode=1)
    assert r.valence is not None

def test_high_rmssd_low_arousal():
    hrv = {"rmssd": 80, "sample_entropy": 1.5, "sd1": 40, "sd2": 80}
    r = ext.compute(hrv, {}, {}, {}, mode=2)
    assert r.arousal < 0.5

def test_return_type():
    r = ext.compute({"rmssd": 45}, {}, {}, {}, mode=2)
    assert isinstance(r, LatentStateVector)

def test_mode3_has_h10_and_rppg():
    r = ext.compute({}, {}, {}, {}, mode=3)
    assert "h10" in r.activeModalities
    assert "rppg" in r.activeModalities
