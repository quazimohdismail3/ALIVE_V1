from backend.ans_classifier import classify, ANSClassification


def test_classify_returns_result_with_none_metrics():
    result = classify(None)
    assert result is not None
    assert isinstance(result, ANSClassification)
    assert result.state in (
        "ventral_vagal",
        "healthy_sympathetic",
        "anxious_sympathetic",
        "dorsal_vagal",
        "burnout_rigidity",
    )
    assert result.confidence == 0.0


def test_classify_returns_result_with_valid_metrics():
    from backend.hrv_processor import HRVMetrics

    m = HRVMetrics(
        rmssd=45.0,
        sdnn=50.0,
        sd1=31.8,
        sd2=65.0,
        sd1_sd2_ratio=0.49,
        svi=0.03,
        dfa_alpha1=1.0,
        mean_rr=800.0,
        hr=75.0,
        n_rr=30,
        artifact_rate=0.05,
        mean_sqi=0.95,
        hr_drift_bpm=3.0,
    )
    result = classify(m, rmssd_norm=0.6)
    assert result is not None
    assert result.state in (
        "ventral_vagal",
        "healthy_sympathetic",
        "anxious_sympathetic",
        "dorsal_vagal",
        "burnout_rigidity",
    )
    assert 0.0 <= result.confidence <= 1.0
