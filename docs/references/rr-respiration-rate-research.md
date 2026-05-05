# RR-Derived Respiration Rate — Research Reference

**Researched:** 2026-05-06  
**Status:** Pre-implementation reference (V2.1+ gated — needs real H10 data)  
**Scope:** How to measure actual breathing rate from RR intervals, why personal RF matters, how music entrains breathing, and how this all connects to the Mission Alive closed loop.

---

## 1. Core Mechanism: Why RR Intervals Encode Breathing

**Respiratory Sinus Arrhythmia (RSA)** — breathing modulates heart rate rhythmically. Heart rate rises during inhalation, drops during exhalation. This rhythm imprints breathing frequency directly onto the RR interval time series. The mechanism is vagally mediated: during inhalation, vagal efference to the SA node is inhibited (HR rises); during exhalation, it resumes (HR drops).

This means: **the RR series is a frequency-domain proxy for breathing**. Extract the oscillation frequency → you have respiratory rate. No chest belt, no microphone, no accelerometer required.

RSA amplitude is maximized when breathing is near 0.1 Hz (6 BPM). This is why measuring RF from the RR series is self-reinforcing: the signal is loudest when the user is in the therapeutic target state.

---

## 2. The Three Resonance Layers (Vaschillo's Model)

Vaschillo identified that the cardiovascular system has **two baroreflex closed loops** with distinct resonance frequencies:

| Loop | Delay | Resonance |
|---|---|---|
| Heart rate baroreflex | ~5s (10s period) | **0.1 Hz — RSA** |
| Vascular tone baroreflex | ~15s (33s period) | ~0.03 Hz |

Mission Alive targets the HR loop (0.1 Hz). Breathing at this frequency maximally stimulates the baroreflex → largest RSA amplitude → greatest baroreflex gain improvement. This is the scientific mechanism behind resonance frequency breathing.

**Source:** [Vaschillo Tribute — Three Baroreflex Loops, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9088144/)

---

## 3. Why Personal RF Is Not Always 6 BPM — Individual Differences

**Adult RF range: 4.5–7.0 BPM** (not a constant 6 BPM).

Lehrer's clinical protocol: test 4.5–6.5 BPM in 0.5 BPM steps, find the rate producing maximum RSA amplitude. Individual RF is determined by:
- **Body size**: taller people, men → lower RF (larger vascular tree, longer baroreflex loop)
- **Baseline heart rate**: higher average IBI → lower RF (correlated)
- **ANS state**: acute stress shifts RF

**Iizawa 2024 continuous formula** (better than 3-bucket height prior):
```
Male:   RF = 17.90 − 0.07 × height_cm  (R² = 0.55)
Female: RF = 15.88 − 0.06 × height_cm  (R² = 0.55)
```

**RF is not stable session-to-session**: changed in **66.7% of participants** in one-week test-retest under identical conditions. RF must be reassessed each session, not just once at onboarding.

**Sources:**  
- [Practical Guide to RF Assessment for HRVB — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7578229/)  
- [RF Not Stable Over Time — Scientific Reports 2021](https://www.nature.com/articles/s41598-021-87867-8)

---

## 4. Music Entrainment — How Tempo Drives Breathing

**Auditory-motor coupling** causes breathing to synchronize with periodic auditory stimuli:

| Music tempo | Entrainment ratio | Resulting breath rate |
|---|---|---|
| ~24 BPM | 1:4 | **6 BPM (0.1 Hz)** |
| ~48 BPM | 1:8 | **6 BPM (0.1 Hz)** |
| ~12 BPM | 1:2 | **6 BPM (0.1 Hz)** |

Tempo drives respiratory rate in proportion. Slower tempos produce 1:4 entrainment; faster tempos shift to 1:8.

**Singing/humming at 0.1 Hz** produces equivalent RSA changes to paced breathing at 0.1 Hz — mantra-like vocal patterns are particularly effective. Choral singing demands slow respiration and shows the highest HRV compared to humming or hymn singing.

**The musical cascade:** Music structure → respiratory rate → RSA amplitude → HRV → vagal tone. The cascade goes both ways: HR changes follow breathing phase, then blood pressure follows HR. This is the resonance loop.

**Sources:**  
- [Singing at 0.1 Hz — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9091602/)  
- [Music and Cardiovascular System — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8727633/)  
- [Music Structure Determines HRV of Singers — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3705176/)  
- [Effects of Perceived Musical Rhythm on Respiratory Pattern — J. Applied Physiology](https://journals.physiology.org/doi/abs/10.1152/jappl.1986.61.3.1185)  
- [HRV Coherence vs Resonance — ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0149763422000653)

---

## 5. Extracting RF from RR Intervals — Three Methods

### Method A: Welch PSD (recommended for Mission Alive)
```python
1. Collect RR intervals → resample to uniform 4 Hz time series
2. Welch PSD (smooths spectral noise from ectopic beats)
3. Find peak in 0.07–0.4 Hz band (covers 4.5–24 BPM)
4. Peak frequency × 60 = respiratory rate in BPM
```
**Note:** At personal RF near 0.1 Hz, peak is in LF band (0.07–0.15 Hz), not HF. Spectral search must include LF.

### Method B: FFT Peak (simpler, less robust)
Same but use raw FFT. More susceptible to ectopic artifacts. Acceptable if artifact rejection is already live.

### Method C: Bandpass Filter (real-time, streaming-friendly)
```python
1. Resample RR → 4 Hz
2. Bandpass 0.07–0.4 Hz
3. Filtered oscillation rate = breathing rate
4. Tracks instantaneously (no epoch averaging needed)
```
Best fit for Mission Alive's 1 Hz pipeline update loop. Latency: ~15s settling.

**Minimum window:** 30s for session live-tracking; 90s for calibration (= 6 complete cycles at 4.5 BPM).

---

## 6. Polar H10 Specific Validation

**Study:** Kubios HRV + Polar H10 vs. gold standard gas exchange (2022)

| Method | Correlation r | SEE |
|---|---|---|
| RR intervals only (RSA method) | **0.85** | 4.2 BPM |
| ECG waveform EDR | 0.95 | 2.6 BPM |

RR-only sufficient at rest and low-moderate exercise — exactly Mission Alive's use case (resonance sessions, resting calibration).

**Sources:**  
- [Estimation of RF Using Polar H10 — PubMed](https://pubmed.ncbi.nlm.nih.gov/36236256/)  
- [ResearchGate Full Paper](https://www.researchgate.net/publication/363737496)

---

## 7. Relevance to Existing rf_calibration.py Architecture

The existing `rf_calibration.py` uses **coherence between RR series and a separate respiratory signal** (mic or H10 accelerometer) to find personal RF. This approach requires a clean respiratory signal — currently broken in Mode 2 (H10 accelerometer not implemented; mic is fallback but noisy).

**RR-derived RF (this research) is complementary:**
- `rf_calibration.py` → measures COHERENCE between RR and resp signal → finds personal RF target
- `rf_engine.py` (proposed) → extracts breathing rate DIRECTLY from RR via RSA → measures actual real-time RF

In Mode 2 (H10 only), RR-derived RF can serve as the respiratory signal input to `rf_calibration.py`, replacing the missing H10 accelerometer. This fixes the known Mode 2 calibration failure without needing new hardware.

---

## 8. Clinical Constraints on Current Implementation (from Calibration Spec)

Known bugs in current calibration that affect RF accuracy:
- **I:E ratio inverted**: 60% inhale / 40% exhale (should be 40/60 — extended exhale activates parasympathetic)
- **CAL_DWELL_S = 30s**: clinically invalid; minimum is 90s (6 cycles at 4.5 BPM)
- **Search range 4.0–8.5 BPM**: clinical standard is 4.5–6.5 BPM
- **Height prior**: 3-bucket logic; Iizawa 2024 continuous formula is more accurate
- **Orb/audio out of phase**: no shared start signal → drift

These must be fixed before RF measurements are used for clinical decisions.

---

## 9. Sources — Full List

| Paper | URL |
|---|---|
| Practical Guide to RF Assessment for HRVB | [PMC 7578229](https://pmc.ncbi.nlm.nih.gov/articles/PMC7578229/) |
| RF Not Stable Over Time | [Scientific Reports 2021](https://www.nature.com/articles/s41598-021-87867-8) |
| Vaschillo — Three Baroreflex Loops | [PMC 9088144](https://pmc.ncbi.nlm.nih.gov/articles/PMC9088144/) |
| HRVB: How and Why It Works | [PMC 4104929](https://pmc.ncbi.nlm.nih.gov/articles/PMC4104929/) |
| HRVB Systematic Review & Guidelines | [PMC 10412682](https://pmc.ncbi.nlm.nih.gov/articles/PMC10412682/) |
| Singing at 0.1 Hz — RSA Equivalent | [PMC 9091602](https://pmc.ncbi.nlm.nih.gov/articles/PMC9091602/) |
| Music and ANS — Cardiovascular | [PMC 8727633](https://pmc.ncbi.nlm.nih.gov/articles/PMC8727633/) |
| Music Structure Determines HRV of Singers | [PMC 3705176](https://pmc.ncbi.nlm.nih.gov/articles/PMC3705176/) |
| HRV Coherence vs. Resonance | [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0149763422000653) |
| Global Study of Coherence Frequencies | [Scientific Reports 2025](https://www.nature.com/articles/s41598-025-87729-7) |
| Polar H10 RF Estimation | [PubMed 36236256](https://pubmed.ncbi.nlm.nih.gov/36236256/) |
| RR → Respiration Gist (Vallat) | [GitHub Gist](https://gist.github.com/raphaelvallat/55624e2eb93064ae57098dd96f259611) |
| ECG-Derived Respiratory Freq — MIT Ch.8 | [MIT PDF](https://www.mit.edu/~gari/ecgbook/ch8.pdf) |
| NeuroKit2 EDR Documentation | [NeuroKit2](https://neuropsychology.github.io/NeuroKit/examples/ecg_edr/ecg_edr.html) |
| don't-hold-your-breath (Polar H10 repo) | [GitHub](https://github.com/kieranabrennan/dont-hold-your-breath) |
| Vagal Neuromodulation Review 2025 | [PMC 12082064](https://pmc.ncbi.nlm.nih.gov/articles/PMC12082064/) |
| Rethinking Resonance Frequency | [BioSource Software](https://www.biosourcesoftware.com/post/rethinking-the-resonance-frequency-rf-part-1) |
| Baroreflex and Resonance (Vaschillo 2001) | [Springer](https://link.springer.com/article/10.1023/A:1014587304314) |
