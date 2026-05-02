# RF Calibration — Scientific Reference Library

Mission Alive is a vagus nerve HRV biofeedback app that guides users through slow-paced breathing at their personal resonance frequency (RF) — the breathing rate (typically 4.5–6.5 bpm) at which heart rate variability amplitude peaks via baroreflex resonance. Accurate RF identification is critical: breathing at the wrong rate produces sub-optimal autonomic benefit. This file documents all scientific papers consulted for the RF calibration redesign, which replaces a coarse 3-bucket height prior with a validated regression formula and a Progressive RF Discovery protocol.

---

## Summary Table

| # | Paper | Year | Primary Contribution |
|---|-------|------|----------------------|
| 1 | Iizawa et al. | 2024 | Validated regression formula: RF from sex + height (R² 0.47–0.55) |
| 2 | Lehrer & Gevirtz / Frontiers 2020 | 2014 / 2020 | Clinical RF assessment protocol: 4.5–6.5 bpm range, 2-min dwell |
| 3 | PMC 11310264 | 2024 | RCT: 1:1 vs 1:2 I:E ratio shows no significant HRV difference |
| 4 | Vaschillo et al. / PMC 5575449 | 2017 | RF physiology: baroreflex + RSA resonance; 5.5 bpm as population mode |
| 5 | PubMed 24380741 | 2014 | 5.5 bpm at 1:1 I:E increases HRV; no clear benefit to extending exhale |
| 6 | J Applied Physiology 2013 | 2013 | I:E ratio does not significantly affect spectral HRV measurement accuracy |
| 7 | Nature Sci Reports 2021 | 2021 | RF is session-variable in 66.7% of participants; correlated with RR interval |
| 8 | Max Frenzel (N=1) | n.d. | Optimal I:E ≈ 0.35 (35/65) in one individual; ratio may be personal |
| 9 | PMC 8924557 | 2022 | RF breathing produces measurably greater HRV than non-resonant paced breathing |

---

## Paper 1 — Iizawa et al. (2024)

**Citation:** Iizawa, M., et al. (2024). Estimation of resonance frequency of heart rate variability biofeedback using anthropometric variables. *Applied Psychophysiology and Biofeedback*. https://doi.org/10.1007/s10484-023-09602-5

**URLs:**
- https://pmc.ncbi.nlm.nih.gov/articles/PMC10869367/
- https://link.springer.com/article/10.1007/s10484-023-09602-5

**Key finding:** A published regression model predicts personal RF from sex and height alone with moderate accuracy. Age reached significance in univariate analysis but dropped out of the final multivariate model (p = 0.516). Resting HR was not retained in the final model.

- Male:   RF = 17.90 − 0.07 × height_cm
- Female: RF = 15.88 − 0.06 × height_cm
- R² = 0.55 (males), 0.47 (females)
- Prediction error: ±0.5 bpm (1 standard deviation)
- Sample: 122 healthy adults aged 20–85 years

**Applied to project:** Replaces the coarse 3-bucket height prior (`short / medium / tall → 6.0 / 5.5 / 5.0 bpm`) in `rf_calibration.py` with this continuous formula. Requires adding a `sex` field to `ProfileSetup`. The formula output becomes the starting point for the Progressive RF Discovery sweep; ±0.5 bpm error informs the convergence tolerance.

---

## Paper 2 — Lehrer & Gevirtz (2014) / Frontiers Neuroscience (2020)

**Citation:** Lehrer, P., & Gevirtz, R. (2014). Heart rate variability biofeedback: How and why does it work? *Frontiers in Psychology*, 5, 756. Reviewed and extended in: Shaffer, F., & Meehan, Z. M. (2020). A practical guide to resonance frequency assessment for heart rate variability biofeedback. *Frontiers in Neuroscience*, 14, 570400.

**URLs:**
- https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2020.570400/full
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7578229/

**Key finding:** Clinically established RF assessment protocol:
- Test breathing rates: 6.5, 6.0, 5.5, 5.0, 4.5 bpm, stepping down in 0.5 bpm increments
- Dwell time at each step: ~2 minutes of paced breathing + 2 minutes rest
- RF population range: 4.5–6.5 bpm for healthy adults
- Primary metric: RSA amplitude (peak-to-trough HR per breath cycle); secondary: LF power peak in HRV spectrum
- Longer exhalation (1:2 I:E) is often recommended but not definitively proven superior to 1:1 in RCTs

**Applied to project:** Sets the clinical benchmark for dwell time — our current 30-second dwell is well below the 2-minute minimum needed for reliable RSA amplitude measurement. Sets the correct search bounds for the RF sweep (4.5–6.5 bpm vs the previously wider 4.0–8.5 bpm range). Step size of 0.5 bpm matches clinical practice.

---

## Paper 3 — PMC 11310264 (2024)

**Citation:** (Authors pending full retrieval.) (2024). Do longer exhalations increase heart rate variability during slow-paced breathing? *[Journal pending]*. PMC ID: 11310264.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC11310264/

**Key finding:** RCT comparing 1:1 vs 1:2 inhale:exhale ratio at 6 bpm:
- No significant difference in HRV time-domain metrics (RMSSD, SDNN), frequency-domain metrics (LF, HF power), or nonlinear metrics
- N = 26 (original study) and N = 16 (replication) both confirmed null result
- Clinical recommendation: 1:1 I:E is valid; client preference and comfort should guide the choice

**Applied to project:** Supports switching from the current 60/40 inhale-dominant cue to a 40/60 exhale-dominant cue as a practical improvement for user guidance quality (parasympathetic activation is linked to expiration), without overclaiming that 1:2 is physiologically required. The null result also confirms that I:E ratio does not confound RSA amplitude measurement, which is the core metric for RF identification.

---

## Paper 4 — Vaschillo et al. / PMC 5575449 (2017)

**Citation:** Vaschillo, E. G., Vaschillo, B., & Lehrer, P. M. (2017). Characteristics of resonance in heart rate variability stimulated by biofeedback. *Frontiers in Public Health*, 5, 222.

**URLs:**
- https://pmc.ncbi.nlm.nih.gov/articles/PMC5575449/
- https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2017.00222/full

**Key finding:** Mechanism of RF breathing:
- At resonance frequency, RSA oscillations (respiratory sinus arrhythmia) and baroreflex oscillations constructively reinforce each other, producing maximum HRV amplitude
- 5.5 bpm is associated with the highest LF peak amplitude at the population level
- Adult RF range confirmed as 4.5–6.5 bpm

**Applied to project:** Provides the physiological rationale for why RF precision matters (constructive resonance vs. partial or no resonance). Confirms 5.5 bpm as the population mode — consistent with the Iizawa formula output for an approximately 175 cm male. Supports RSA amplitude (peak-trough HR per cycle) as the primary metric in the RF sweep scorer, over simpler LF power.

---

## Paper 5 — PubMed 24380741 (2014)

**Citation:** Paprika, D., Gingl, Z., Rudas, L., & Zöllei, E. (2014). Hemodynamic effects of slow-paced breathing at 0.1 Hz in resting adults: A repeated measures study. *Journal of Clinical Monitoring and Computing*, 28(5), 485–492. (Approximate — verify against abstract.)

**URLs:**
- https://www.sciencedirect.com/science/article/abs/pii/S0167876013003346
- https://pubmed.ncbi.nlm.nih.gov/24380741/

**Key finding:** Breathing at 5.5 bpm with a 1:1 (equal) I:E ratio produced greater HRV increases than other tested breathing patterns. No definitive evidence that extending exhalation beyond 1:1 further increases HRV.

**Applied to project:** Supports adopting 40/60 (slightly exhale-dominant) as a safe, directionally correct improvement over the current 60/40, while not requiring 1:2 or beyond. The 5.5 bpm finding aligns with the population-mode estimate from Iizawa et al. and Vaschillo et al.

---

## Paper 6 — Journal of Applied Physiology (2013)

**Citation:** Cooke, W. H., Cox, J. F., Diedrich, A. M., Taylor, J. A., Beightol, L. A., Ames, J. E., & Eckberg, D. L. (2013). Controlled breathing protocols probe human autonomic cardiovascular rhythms. *Journal of Applied Physiology*, 114(9), 1393–1401 (citation approximate — verify against doi below).

**URL:** https://journals.physiology.org/doi/full/10.1152/japplphysiol.00163.2013

**Key finding:** Spectral HRV indexes are not significantly influenced by I:E ratio during slow-paced breathing. The I:E setting is not a necessary parameter to control when measuring spectral HRV during slow-paced breathing protocols.

**Applied to project:** Confirms that the RF sweep metric (RSA amplitude / LF power) is not confounded by the I:E ratio choice. Our measurement validity does not depend on precisely enforcing a 1:1 or 1:2 ratio during the sweep. The 40/60 cue is a user guidance choice, not a measurement requirement.

---

## Paper 7 — Nature Scientific Reports (2021)

**Citation:** Jorgensen, G., et al. (2021). Resonance frequency heart rate variability biofeedback: A description of heart rate variability, its inter-beat interval correlates, and test-retest reliability. *Scientific Reports*, 11, 9607. https://doi.org/10.1038/s41598-021-87867-8

**URL:** https://www.nature.com/articles/s41598-021-87867-8

**Key finding:** RF is not a fixed individual trait:
- RF changed between sessions in 66.7% of participants
- RF correlates with inter-beat interval (RR interval length), i.e., baseline heart rate
- Implication: RF should be re-assessed periodically rather than treated as a permanent individual constant

**Applied to project:** Directly justifies the Progressive RF Discovery architecture — session-embedded, lightweight re-assessment rather than a one-time calibration. Also informs the convergence logic: if a user's resting HR shifts significantly between sessions, prior RF estimates should be down-weighted. The RR-interval correlation suggests that heart-rate-normalised sweep scoring may improve cross-session stability (Phase 2 consideration).

---

## Paper 8 — Max Frenzel, PhD (N=1 Personal Experiment)

**Citation:** Frenzel, M. (n.d.). Determining the optimal inhale-to-exhale ratio for resonance breathing and HRV biofeedback training. *Medium / Yudemon* (blog post, not peer-reviewed).

**URL:** https://medium.com/yudemon/determining-the-optimal-inhale-to-exhale-ratio-for-resonance-breathing-and-hrv-biofeedback-training-34a76e4bf6dd

**Key finding (N=1 only — treat as directional signal, not evidence):**
- Author tested 11 I:E ratios systematically on himself
- Optimal ratio found: 0.35 (35% inhale / 65% exhale ≈ 1:1.86)
- 1:1 ratio produced ~25% lower HRV than his personal optimum
- Author notes the ratio may be highly personal, analogous to RF itself

**Applied to project:** Provides directional support for exhale-dominant breathing guidance. Weight: anecdote only — no statistical power. Does not override peer-reviewed null results (Papers 3, 5, 6). Cited here for transparency because it informed the initial decision to shift away from 60/40. Future personalised I:E tuning is a Phase 3 item, not current scope.

---

## Paper 9 — PMC 8924557 (2022)

**Citation:** (Authors pending full retrieval.) (2022). Effect of resonance frequency breathing on heart rate variability. PMC ID: 8924557.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC8924557/

**Key finding:** RF breathing produces measurably greater HRV improvements compared to non-resonant slow-paced breathing (i.e., slow breathing at rates that are close but not at an individual's RF). Breathing "near" RF is not equivalent to breathing at RF — precision matters.

**Applied to project:** Justifies the engineering investment in accurate RF identification. If approximate breathing rate were sufficient, the Progressive RF Discovery sweep would be unnecessary. This paper confirms it is not: a half-step error (0.5 bpm) from true RF produces sub-optimal HRV response, which is precisely the resolution of both the Iizawa formula error band and our sweep step size.

---

## Notes on Evidence Quality

| Paper | Study type | N | Weight |
|-------|-----------|---|--------|
| Iizawa et al. 2024 | Cross-sectional regression | 122 | High — peer-reviewed, specific formula |
| Lehrer/Frontiers 2020 | Clinical review + protocol | — | High — consensus clinical practice |
| PMC 11310264 2024 | RCT + replication | 26 + 16 | High — replicated null result |
| Vaschillo 2017 | Mechanistic + observational | — | High — establishes RF physiology |
| PubMed 24380741 2014 | Repeated-measures RCT | — | Moderate — supports 5.5 bpm |
| J Appl Physiol 2013 | Controlled experiment | — | Moderate — confirms I:E irrelevance for measurement |
| Sci Reports 2021 | Test-retest reliability study | — | High — directly motivates periodic re-assessment |
| Frenzel N=1 | Self-experiment, no controls | 1 | Low — directional signal only |
| PMC 8924557 2022 | RCT or observational | — | Moderate — confirms RF precision matters |

---

*Last updated: 2026-05-02. Compiled for Mission Alive RF calibration redesign (V2 scope).*
