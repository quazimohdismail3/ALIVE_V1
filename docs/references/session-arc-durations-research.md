# Session Arc Durations — Scientific Reference Library

Mission Alive structures each session into discrete phases (baseline → active RF work → integration/release) and assigns breathing protocols, binaural beat frequencies, and minimum durations per phase. The three session types — Find Your Calm (stress-reduction, daytime), Wind Down (sleep onset, evening), and Morning Emergence (activation, morning) — have different autonomic targets and therefore different phase arcs. This file documents all scientific papers consulted when designing those arcs: phase durations, breathing ratios, binaural entrainment frequencies, and session minimums for each type.

---

## Summary Table

| # | Paper | Year | Primary Contribution |
|---|-------|------|----------------------|
| 1 | Lehrer & Gevirtz / Frontiers Psychology | 2014 | RF breathing mechanics: 10-min minimum, 5.5 bpm default, 40:60 I:E ratio |
| 2 | Laborde et al. / Applied Psychophysiology | 2020 | RF assessment protocol: 2-min dwell, 5-min baseline standard |
| 3 | Dessy et al. / Applied Psychophysiology | 2023 | Multi-session gains; 10-min active minimum; baseline → active → integration arc |
| 4 | PMC 12145584 systematic review | 2025 | Binaural beat entrainment: theta best supported; alpha for relaxed alertness; low beta for activation |
| 5 | Jirakittayakorn et al. / PMC 8636003 | 2021 | Theta → drowsiness/pre-sleep; low beta (13–15 Hz) for controlled activation |
| 6 | Jeong et al. / Nature Sci Reports | 2020 | 30-min slow breathing + music before sleep; 4-7-8 ratio validated for sleep onset |
| 7 | Balban et al. / PMC 8656666 | 2021 | Single slow-breathing session improves acute HRV; cyclic sighing strongest for morning mood |
| 8 | Tsai et al. / PMC 6361823 | 2018 | Extended exhale (4:8) reduces sympathetic activation; sleep onset within 10–20 min |
| 9 | PMC 12341363 | 2025 | Box breathing (4:4:4:4) for focus/activation; cyclic sighing beats box for acute anxiety |
| 10 | PMC 12082064 | 2025 | Clinical HRVB arc: 5-min baseline → active → 3–10-min integration; integration often omitted in apps |

---

## Paper 1 — Lehrer & Gevirtz (2014)

**Citation:** Lehrer, P.M., & Gevirtz, R. (2014). Heart rate variability biofeedback: how and why does it work? *Frontiers in Psychology*, 5, 756.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC4104929/

**Key finding:** RF breathing at 4.5–6.5 bpm produces the largest RSA amplitude and baroreflex gain of any breathing intervention studied. Minimum 10 minutes of active RF breathing is required for a measurable acute HRV shift. Population mode is 5.5 bpm (5s inhale / 5s exhale). A prolonged exhale ratio (40:60 inhale:exhale) increases parasympathetic bias relative to equal-ratio breathing.

**Applied to project:** Establishes the 10-minute floor for the active RF phase in all three session types. Sets the default RF at 5.5 bpm and the default breathing ratio at 40:60 (inhale:exhale) in BreathActuator. Informs session minimum durations: no session type falls below 15 minutes total (baseline + active + integration).

---

## Paper 2 — Laborde et al. (2020)

**Citation:** Laborde, S., et al. (2020). A Practical Guide to Resonance Frequency Assessment for Heart Rate Variability Biofeedback. *Applied Psychophysiology and Biofeedback*.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC7578229/

**Key finding:** Validated RF assessment protocol specifies testing the 4.5–6.5 bpm range in 0.5 bpm steps with a 2-minute dwell at each frequency, using RSA amplitude as the identification metric. Individual RF is stable across sessions but varies with posture and arousal state. A 5-minute resting baseline before the active phase is the clinical standard.

**Applied to project:** Informs the calibration phase structure used by the Bayesian RF optimizer — the 90-second dwell time in the current implementation is acknowledged as below the 2-minute clinical minimum and flagged for extension. The 5-minute resting baseline recommendation is the basis for the SETTLE phase duration in all three session arcs.

---

## Paper 3 — Dessy et al. (2023)

**Citation:** Dessy et al. (2023). Methods for Heart Rate Variability Biofeedback: A Systematic Review and Guidelines. *Applied Psychophysiology and Biofeedback*.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC10412682/

**Key finding:** Multi-session RMSSD gains of 10–20% emerge reliably only after 4–6 weeks of daily practice; a single session does not reliably lift resting RMSSD. The minimum effective single-session active RF breathing duration is 10 minutes. The clinically validated session structure is: baseline → active RF work → integration.

**Applied to project:** Session duration minimums: Find Your Calm minimum 15 minutes (5 baseline + 10 active), standard 25 minutes, extended 40 minutes. The baseline → active → integration arc is the canonical phase structure for all three session types in Mission Alive. Single-session copy does not overclaim resting RMSSD improvement.

---

## Paper 4 — Binaural Beat Therapy and ANS Regulation (2025)

**Citation:** Recent systematic review. PMC12145584.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC12145584/

**Key finding:** Evidence for binaural beat entrainment is mixed overall, but theta induction (4–7 Hz) within 10 minutes is the most consistently supported effect across studies. Entrainment latency: brainwaves require approximately 30 seconds to begin phase-locking to a new target frequency. Alpha beats (8–10 Hz) are associated with relaxed alertness. Low beta beats (13–15 Hz) support cognitive activation without inducing over-arousal.

**Applied to project:** Per-session binaural frequency assignments: Find Your Calm uses alpha (8–10 Hz); Wind Down uses theta (4–6 Hz) fading to delta (1–3 Hz) in the sleep descent phase; Morning Emergence uses low beta (13–15 Hz). The 30-second entrainment latency sets the minimum binaural glide time in BinauralGenerator at 45–60 seconds to allow overlap between the outgoing and incoming frequency.

---

## Paper 5 — Jirakittayakorn et al. (2021)

**Citation:** Jirakittayakorn, N., et al. (2021). Personalized Theta and Beta Binaural Beats for EEG-based Neurofeedback. PMC8636003.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC8636003/

**Key finding:** Theta binaural beats (4–7 Hz) are consistently associated with cortical quieting, increased drowsiness, and pre-sleep states across subjects. Beta binaural beats (13–30 Hz) are associated with cognitive activation; the lower end of the range (13–15 Hz) is appropriate for controlled morning activation because it avoids the heightened arousal and anxiety risk associated with higher beta (20–30 Hz).

**Applied to project:** Morning Emergence binaural arc: 13–15 Hz (low beta) during the activation phase, transitioning to 10 Hz (alpha) during the settle phase. Wind Down binaural arc: begins in theta (4–6 Hz) during the descent phase and can slide toward delta (1–3 Hz) at the boundary of the dissolve phase if sleep onset is the session goal.

---

## Paper 6 — Jeong et al. (2020)

**Citation:** Jeong, Y.J., et al. (2020). Effect of Slow Breathing and Music on Polysomnographic Sleep Measures. *Scientific Reports*, 10, 7846.

**URL:** https://www.nature.com/articles/s41598-020-64218-7

**Key finding:** 30 minutes of slow breathing (4–6 bpm) before sleep, combined with calm music, improved polysomnographic sleep measures including shorter sleep onset latency and increased slow-wave sleep percentage. The extended exhale pattern (4 in / 7–8 out — the 4-7-8 technique) is clinically validated for sleep onset facilitation.

**Applied to project:** Wind Down session minimum total duration set at 30 minutes. The 4:7–8 breathing ratio (inhale 4 counts, hold 7, exhale 8) is the protocol for the DISSOLVE phase of the Wind Down arc, which targets sleep onset. Music selection in Wind Down matches the low-tempo, low-arousal profile described in this paper.

---

## Paper 7 — Balban et al. (2021)

**Citation:** Balban, M.Y., et al. (2021). Brief structured respiration practices enhance mood and reduce physiological arousal. PMC8656666.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC8656666/

**Key finding:** A single session of slow paced breathing at 6 cycles per minute produces measurable acute HRV improvement in most participants. Cyclic sighing (double nasal inhale followed by a long, extended exhale) shows the strongest evidence for mood improvement and HRV stabilization immediately post-waking. Five minutes is sufficient for the cyclic sighing effect to be detectable.

**Applied to project:** Morning Emergence activation phase opens with 2–3 minutes of cyclic sighing before transitioning to RF breathing. Morning session minimum duration is set at 10 minutes (3 cyclic sighing + 7 RF breathing). Cyclic sighing is implemented in BreathActuator as a distinct breath pattern separate from standard paced breathing.

---

## Paper 8 — Tsai et al. (2018)

**Citation:** Tsai, H.J., et al. (2018). Self-Regulation of Breathing as Adjunctive Treatment for Insomnia. PMC6361823.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC6361823/

**Key finding:** Extended exhale breathing (4:8 ratio or the 4-7-8 technique) reduces sympathetic activation and cortisol markers, and facilitates sleep onset within 10–20 minutes in insomnia patients when combined with progressive muscle relaxation in a release phase. The physiological pathway is prolonged vagal tone via extended expiration.

**Applied to project:** Wind Down DISSOLVE phase uses the extended exhale protocol (4:7–8). Phase duration minimum is 5 minutes for a measurable effect; the standard DISSOLVE phase is set at 8 minutes. Progressive body scan/muscle relaxation guidance in the DISSOLVE phase is informed by the combined protocol described in this paper.

---

## Paper 9 — A52 Breath Method (2025)

**Citation:** PMC12341363.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC12341363/

**Key finding:** Box breathing (4:4:4:4 — equal inhale, hold, exhale, hold) is appropriate for activation and focus states and produces symmetric ANS activation by balancing sympathetic and parasympathetic drive. Cyclic sighing outperforms box breathing for acute anxiety reduction. Box breathing produces more cognitive clarity than pure parasympathetic-dominant breathing patterns.

**Applied to project:** Morning Emergence uses box breathing (4:4:4:4) in the activation phase after the cyclic sighing warm-up. Box breathing is not used in Wind Down (too activating) or Find Your Calm (too symmetric — the session targets parasympathetic dominance, not balance).

---

## Paper 10 — Harnessing HRV Biofeedback (2025)

**Citation:** PMC12082064.

**URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC12082064/

**Key finding:** The clinically validated HRVB session structure is: 5-minute resting baseline → active RF breathing work → 3–10 minute integration (no breathing cue, hold the parasympathetic state). The integration phase is clinically important for consolidating the autonomic shift and is frequently omitted in consumer app implementations. Alpha binaural beats (7–8 Hz) or silence are appropriate during integration; active breathing guidance should cease.

**Applied to project:** Find Your Calm RELEASE phase implements the integration phase: no binaural cue, low spatial audio, minimal breath guide, user holds attention on body. Integration phase is allocated 15–20% of total session duration (3 minutes in a 15-minute session, 5 minutes in a 25-minute session). This paper is the primary justification for building the RELEASE phase as a distinct phase rather than a hard session end.

---

## Notes on Evidence Quality

| Paper | Study type | N | Weight |
|-------|-----------|---|--------|
| Lehrer & Gevirtz 2014 | Mechanistic review | — | High — foundational clinical consensus |
| Laborde et al. 2020 | Systematic review + protocol | — | High — validated clinical assessment protocol |
| Dessy et al. 2023 | Systematic review + guidelines | — | High — defines session arc and minimums |
| PMC 12145584 2025 | Systematic review | — | Moderate — mixed evidence, theta effect best supported |
| Jirakittayakorn et al. 2021 | Controlled EEG study | — | Moderate — supports frequency range assignments |
| Jeong et al. 2020 | Controlled sleep study (PSG) | — | High — polysomnographic outcome, clinically validated 4-7-8 |
| Balban et al. 2021 | RCT | — | High — cyclic sighing vs. other patterns, replicated |
| Tsai et al. 2018 | Controlled clinical trial | — | High — insomnia population, measurable outcomes |
| PMC 12341363 2025 | Controlled breathing comparison | — | Moderate — box breathing characterisation |
| PMC 12082064 2025 | Clinical HRVB review | — | High — integration phase evidence; directly motivates RELEASE phase design |

---

## Session Arc Summary (Applied)

| Session type | Minimum | Standard | Phase arc | Breathing protocol | Binaural arc |
|---|---|---|---|---|---|
| Find Your Calm (daytime) | 15 min | 25 min | SETTLE 5 → DEEPEN 10–15 → RELEASE 3–5 | 40:60 I:E at personal RF (default 5.5 bpm) | Alpha 8–10 Hz → silence (RELEASE) |
| Wind Down (evening) | 30 min | 40 min | SETTLE 5 → DESCEND 15–20 → DISSOLVE 8+ | DESCEND: 40:60 RF breathing → DISSOLVE: 4:7–8 | Theta 4–6 Hz → delta 1–3 Hz (DISSOLVE) |
| Morning Emergence | 10 min | 20 min | ACTIVATE 3 → RF WORK 7–12 → SETTLE 3–5 | ACTIVATE: cyclic sighing then box 4:4:4:4 → RF WORK: 40:60 RF | Low beta 13–15 Hz (ACTIVATE) → alpha 10 Hz (SETTLE) |

---

*Last updated: 2026-05-09. Compiled for Mission Alive session arc design (V2/V3 scope).*
