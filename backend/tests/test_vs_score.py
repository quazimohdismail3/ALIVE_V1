from backend.vs_score import compute_vs_adaptive, vs_color


def test_all_available():
    components = {k: 0.8 for k in ["lf_coherence","rsa_amplitude","rmssd_trajectory",
                                     "dfa_alpha1","breath_rsa_lock","posture_openness","sd2_sd1_ratio"]}
    r = compute_vs_adaptive(components, mode=3, confidences={})
    assert 0 <= r["vs"] <= 100
    assert r["confidence"] == "HIGH"
    assert len(r["components_used"]) == 7


def test_mode2_posture_redistributed():
    components = {
        "lf_coherence": 0.8, "rsa_amplitude": 0.7, "rmssd_trajectory": 0.6,
        "dfa_alpha1": 0.85, "breath_rsa_lock": 0.75,
        "posture_openness": None, "sd2_sd1_ratio": 0.65,
    }
    r = compute_vs_adaptive(components, mode=2, confidences={})
    assert "posture_openness" not in r["components_used"]
    assert r["vs"] > 0


def test_empty_components():
    r = compute_vs_adaptive({}, mode=2, confidences={})
    assert r["vs"] == 0


def test_vs_range_clipped():
    components = {k: 1.0 for k in ["lf_coherence","rsa_amplitude","rmssd_trajectory",
                                     "dfa_alpha1","breath_rsa_lock","posture_openness","sd2_sd1_ratio"]}
    r = compute_vs_adaptive(components, mode=3, confidences={})
    assert r["vs"] == 100


def test_color_bands():
    assert vs_color(20) == "#E24B4A"
    assert vs_color(45) == "#EF9F27"
    assert vs_color(65) == "#1D9E75"
    assert vs_color(90) == "#534AB7"


def test_low_confidence_components():
    components = {"lf_coherence": 0.5, "rsa_amplitude": 0.5}
    r = compute_vs_adaptive(components, mode=2, confidences={"lf_coherence": 0.3, "rsa_amplitude": 0.3})
    assert r["confidence"] == "LOW"
