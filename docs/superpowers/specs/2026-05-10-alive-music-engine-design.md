# Alive Music Engine (AME) — Design Spec
**Date:** 2026-05-10  
**Status:** Draft — awaiting user approval  
**Author:** Research swarm (neuroscientist, psychoacoustic, music tech, ANS physiology, SW architecture agents)  
**References:** 5 parallel expert research agents, 30+ peer-reviewed papers cited

---

## Problem Statement

Current state: 5 audio layers, 1 stem each. Stems loop indefinitely. No ANS-driven selection, no variation, no organic humanness. After 5–10 minutes the brain habituates (auditory cortex adaptation: seconds scale; amygdala habituation: ~43 min plateau). The result is music that stops working therapeutically.

Goal: Music that is **ANS-driven** (responds to body state) AND **alive** (never identical loop, never robotic).

---

## Scientific Foundation

Key numbers from research — these drive every design decision:

| Parameter | Value | Source |
|-----------|-------|--------|
| Resonance phrase length | ~10 seconds | Bernardi 2006, 2009 |
| Optimal tempo | 50–65 BPM | Bretherton 2019, meta-analysis 2026 |
| Microtiming jitter (therapeutic) | 5–15 ms | Frühauf et al., Sci Reports 2019 |
| Binaural beat (parasympathetic) | 6 Hz @ 432–440 Hz carrier | PMC4231835 |
| Binaural beat (transitional) | 10 Hz @ 440 Hz carrier | PMC12145584 |
| Min session for RMSSD change | 20 minutes | Meta-analysis 2026, 24 RCTs |
| HRV response latency to music change | 2–4 minutes | Mechanistic + baroreflex literature |
| Minimum hold between music changes | 2–3 minutes | Practical implication |
| Amygdala habituation plateau | ~43 minutes | Oxford Cerebral Cortex |
| Optimal loudness | 60–70 dB SPL / –18 to –23 LUFS | PMID 10806471 |
| Dynamic range minimum | DR10+ | AES, startle reflex literature |
| Silence insert benefit | Exceeds slow music for relaxation | Bernardi 2006 |
| Spectral centroid (calming) | 80–300 Hz dominant, roll off >8 kHz | PMC4231835, psychoacoustic lit |

---

## Architecture Overview

```
HRV (Polar H10) → ANS Classifier → Session Arc Controller
                                          ↓
                              ┌───────────────────────┐
                              │  Alive Music Engine   │
                              │                       │
                              │  LayerPool[ground]    │ ← GenerativeDrone
                              │  LayerPool[breath]    │ ← RecordedStems (A/B pair)
                              │  LayerPool[harmonic]  │ ← RecordedStems (A/B pair)
                              │  LayerPool[spatial]   │ ← RecordedStems + HRTF
                              │  LayerPool[circadian] │ ← RecordedStems (time-aware)
                              │                       │
                              │  BinauralLayer        │ ← Generative, always on
                              │  OrganicVariationEng  │ ← EQ LFO, jitter, silence
                              │  SessionArcController │ ← 3-phase, circadian
                              └───────────────────────┘
                                          ↓
                                      Tone.js → Audio output
```

---

## Section 1: Layer Architecture

**Principle:** Generative for tonal/drone (infinite variation, HRV precision). Recorded for nature/texture (authenticity non-negotiable — rain can't be synthesized convincingly).

| Layer | Type | Rationale |
|-------|------|-----------|
| `ground` | **Generative** (enhanced ChordEngine) | Infinite variation, no loop seam, millisecond HRV response, oscillators indistinguishable in drone context |
| `breath` | **Recorded stems** (3–5 per layer) | Rain/ocean/forest attack transients + room resonance are irreplaceable |
| `harmonic` | **Recorded stems** (3–5 per layer) | Crystal bowls, Tibetan bowls, string pads — physical resonance can't be synthesized |
| `spatial` | **Recorded stems** (3–5 per layer) + HRTF rotation | Room acoustics require real recordings; HRTF panning adds spatial novelty |
| `circadian` | **Recorded stems** (3–5 per layer, time-split) | Dawn birdsong (morning) / soft bells (evening) — circadian context-aware |
| `binaural` | **Generative** (new, always-on) | Requires Hz-precise tone pairs; oscillators mandatory |

### Ground layer enhancement (ChordEngine v2):
- Add pink noise bed layer (1/f spectrum) at –40 dB under drone
- Phrase cycle: trigger re-voice every **10 seconds** (not 30s as current) to entrain breathing
- Harmonic vocabulary: Lydian (raised 4th) and Dorian (minor + raised 6th) only; no tritone intervals ever
- Voice spreads stay; add slow attack randomization ±0.3s for humanness

---

## Section 2: Binaural Beat Layer (New Component)

New file: `frontend/src/audio/binaural_beat.js`

```
BinauralBeat {
  start()
  setParams({ ansState })  // called 1 Hz from session_audio
  stop()
  dispose()
}
```

**Parameter mapping:**

| ANS State | Beat Freq | Carrier | Mechanism |
|-----------|-----------|---------|-----------|
| `parasympathetic` | 6 Hz (theta) | 432 Hz | nHF-HRV increase (PMC4231835) |
| `transitioning` | 10 Hz (alpha) | 440 Hz | Alert-relaxed balance |
| `sympathetic` | 10 Hz (alpha) | 440 Hz | Gentle downregulation (not jarring) |

**Implementation:** Two Tone.js oscillators, frequency diff = beat freq, volume –30 dB (subliminal, not consciously audible). Always stereo (L: carrier, R: carrier + beat). Carrier must stay ≤1000 Hz (auditory system constraint for beat perception).

**Ramp rule:** Beat frequency changes ramp over 60 seconds — no sudden shifts that trigger the alerting reflex.

---

## Section 3: Organic Variation Engine (New Component)

New file: `frontend/src/audio/organic_variation.js`

Eliminates cortical adaptation without user-perceptible events. Four sub-systems:

### 3a. Microtiming Jitter
Apply ±5–15 ms random offset to stem playback start on each loop iteration via `Tone.Player.start("+offset")`. Bass/ground: ±5 ms. Harmonic/spatial: ±15 ms. Do not apply to binaural (defeats beat precision).

### 3b. EQ Filter Slow Sweep
Tone.js `Filter` node per layer. Cutoff frequency oscillates on a **sinusoidal LFO** with:
- Period: randomly sampled from [60s, 120s, 180s] per layer (desynchronized)
- Depth: ±0.3 octaves around layer center frequency
- Ground center: 200 Hz. Breath center: 800 Hz. Harmonic center: 1200 Hz. Spatial center: 600 Hz.

### 3c. Slow HRTF Rotation (Spatial layer only)
Panner node with slow azimuth sweep: 1 full rotation per 20–40 seconds (randomly sampled per session). Maintains spatial novelty without triggering the vestibulo-ocular alerting reflex.

### 3d. Silence Actuator
**Most powerful vagal actuator per Bernardi 2006.** Every 8–12 minutes (randomly sampled, per-session), fade all layers to –60 dB over 3 seconds, hold for 2–3 seconds, fade back over 4 seconds. The re-entry after silence heightens perceived salience and resets auditory adaptation.

Rules:
- Never during phase transition (wait until stable state, min 2 min since last stem swap)
- Max 1 silence per 8-minute window
- Do not silence binaural layer (subliminal — silence would be noticed)

---

## Section 4: A/B Crossfade + Stem Pool

### stems.json v2 Schema

```json
{
  "version": 2,
  "layers": {
    "breath": {
      "role": "nature_texture",
      "spectral_role": "mid",
      "stems": [
        {
          "id": "breath_rain_001",
          "url": "/stems/breath/rain_forest_cc0.ogg",
          "tier": "core",
          "energy": 0.2,
          "valence": 0.7,
          "spectral_brightness": "mid",
          "duration_s": 180,
          "loop": true,
          "license": "CC0",
          "source_id": "freesound:12345",
          "tags": ["rain", "forest", "parasympathetic"]
        }
      ]
    }
  }
}
```

**Tags drive selection** alongside `energy`/`valence` cosine similarity.

### ANS → (energy, valence) Target Map

| ANS State | energy | valence | Spectral brightness |
|-----------|--------|---------|---------------------|
| `parasympathetic` | 0.2 | 0.8 | low |
| `transitioning` | 0.4 | 0.6 | mid |
| `sympathetic` | 0.7 | 0.5 | mid-high |

### Stem Selection Algorithm

```
function selectStem(layer, ansState, recentlyPlayed[3]):
  target = ANS_TARGET_MAP[ansState]
  candidates = pool[layer].stems
    .filter(s => s.id not in recentlyPlayed)
    .filter(s => s.spectral_brightness === layer.spectral_role OR flexible)
  
  scores = candidates.map(s => cosineSimilarity([s.energy, s.valence], [target.energy, target.valence]))
  
  topScore = max(scores)
  eligible = candidates where score >= topScore - 0.05  // tie-break band
  return randomPick(eligible)
```

Cosine similarity preferred over Euclidean: direction of emotional vector matters more than magnitude.

### StemLayerPair (A/B Crossfade)

```
StemLayerPair {
  active: StemLayer      // playing
  standby: StemLayer     // preloaded, silent

  preload(stemId)        // decode buffer into standby, no-op if current
  swap(durationS = 3.0)  // simultaneous ramp: active → –60dB, standby → targetDb
                         // setTimeout(durationS * 1000 + 200, () => release(old))
  release(side)          // disconnect + dispose buffer
}
```

**3-second crossfade** — sweet spot for ambient stems (below 1s = audible cut; above 5s = smear).

**Trigger rules:**
1. ANS state changes → `preload()` immediately; `swap()` after standby decoded
2. If state changes again before swap completes → cancel pending swap, preload new target
3. Rotation (monotony) → swap regardless of ANS change, every 480–720s per layer (randomized to prevent sync)

**HRV debounce gate:** 8 seconds minimum between state-change events reaching the preload call. Lives in `session_audio.js`, not in `StemLayerPair` (keeps audio logic stateless re: HRV timing).

**2–3 minute hold:** After a swap, suppress further state-driven swaps for 2 minutes minimum. Matches HRV response latency; prevents thrashing.

---

## Section 5: Session Arc Controller

New logic in `session_audio.js`.

### 3-Phase Arc

| Phase | Duration | Music Target | Mechanism |
|-------|----------|--------------|-----------|
| **Entrain** | 0–8 min | Match current ANS state | ISO principle — start where user is, not where we want them |
| **Shift** | 8–20 min | Gradually move toward parasympathetic | Slow energy/valence drift, tempo nudge –2 BPM/min |
| **Integrate** | 20–45 min | Hold parasympathetic, maximize silence actuator | Stabilize gains, prevent habituation with timbral variation |

Phase boundaries tracked by session elapsed time. Phase advances regardless of HRV (don't wait for perfect RMSSD — advance the arc and let it pull the body).

### Circadian Context

Detect from `new Date().getHours()`:

| Time | Context | Adjustments |
|------|---------|-------------|
| 5–10 AM | `morning` | Major/Dorian mode, reduced silence inserts, energy baseline +0.1, expect RMSSD –20ms vs. evening |
| 10 AM–6 PM | `midday` | Default targets |
| 6–11 PM | `evening` | Minor/Lydian mode, longer silence inserts (3s), energy baseline –0.1, deepest parasympathetic targets |

**Circadian normalization:** Before evaluating HRV state, normalize RMSSD against time-of-day baseline. Morning RMSSD is typically 20–30 ms lower than evening for same individual. Without normalization, morning sessions always appear "stressed" even when user is calm.

---

## Section 6: Stem Download List

**Target:** ~8–12 MB additional audio (all CC0 or CC-BY). Download script: `scripts/download_stems.js`.

### Ground Layer (stays generative — no new stems needed)

### Breath Layer (currently: birds_wind_cc0.ogg)
Add 3 more:
- `rain_forest_cc0.ogg` — Freesound CC0 Nature category (search: "rain forest loop CC0")
- `ocean_waves_cc0.ogg` — Freesound CC0 (search: "ocean waves loopable CC0")  
- `stream_gentle_cc0.ogg` — Freesound CC0 (search: "stream babbling CC0 loop")

### Harmonic Layer (currently: ether_vox_ccby.mp3)
Add 3 more:
- `tibetan_bowl_cc0.ogg` — Freesound: search `tags:tibetan-bowl license:CC0` (multi-minute loopable)
- `crystal_bowl_cc0.ogg` — Freesound CC0 bowls category
- `string_pad_cc0.ogg` — Freesound CC0 ambient pad (or generate with ChordEngine extended)

### Spatial Layer (currently: forest_ambience_cc0.mp3)
Add 3 more:
- `cave_reverb_cc0.ogg` — OpenGameArt CC0 Background Ambience pack
- `cathedral_room_cc0.ogg` — Freesound CC0 room tone (search: "cathedral ambience CC0")
- `space_drone_nasa.ogg` — NASA Audio (nasa.gov/audio-and-ringtones/ — open use policy)

### Circadian Layer (currently: morning_ccby.mp3 — keep, add evening)
Add 2 more:
- `dawn_birdsong_cc0.ogg` — Freesound CC0 (search: "dawn chorus CC0 loop")
- `evening_bells_cc0.ogg` — Freesound CC0 soft bells (search: "soft bells ambient CC0")

**Total new stems: 11 files, estimated 8–15 MB**

### Download Script Design (`scripts/download_stems.js`)
- Reads `stems.json` v2
- Filters `tier === 'extended'`
- Fetches with exponential backoff (1s / 4s / 16s, 3 attempts)
- SHA-256 verify against manifest hash
- Max 3 concurrent downloads (respects Freesound rate limits)
- Progress: `[layer/id] n/total`
- `--dry-run` flag: print plan without downloading
- Non-zero exit on any failure (CI-safe)

---

## Section 7: Implementation Delta

Changes to existing files:

### `frontend/src/audio/session_audio.js`
- Import `BinauralBeat`, `OrganicVariation`, `SessionArcController`
- Replace `StemLayer` per layer with `StemLayerPair`
- Add 8s HRV debounce gate
- Add 2-min hold after swap
- Wire circadian context to arc controller

### `frontend/src/audio/stem_layer.js`
- No changes needed (StemLayerPair wraps two StemLayers)

### `frontend/src/audio/stem_loader.js`
- No changes needed (StemLayerPair reuses StemLoader)

### `frontend/src/audio/chord_engine.js` (ChordEngine v2)
- Change `_evolveTimer` from 30s to 10s (phrase-lock to 0.1 Hz breathing target)
- Add pink noise sub-layer (`Tone.Noise` type `pink`, –40 dB)
- Restrict `SCALE_INTERVALS` to Dorian and Lydian only (remove minor 7th index 0)
- Add startup jitter to `_strikeChord` (±0.3s per voice)

### `frontend/public/stems/stems.json`
- Migrate from v1 flat object to v2 `{ version: 2, layers: { ... } }` schema
- Add new stems as they are downloaded

### New files:
- `frontend/src/audio/binaural_beat.js` — BinauralBeat class
- `frontend/src/audio/organic_variation.js` — OrganicVariation class (EQ LFO, jitter, silence, HRTF)
- `frontend/src/audio/session_arc.js` — SessionArcController class
- `scripts/download_stems.js` — stem download + verify script

---

## Data Contracts

| Interface | Rate | Notes |
|-----------|------|-------|
| ANS state → StemLayerPair | On state change, 8s debounced | preload immediately, swap after decode |
| ANS state → BinauralBeat | 1 Hz, no debounce needed | frequency ramps over 60s internally |
| ANS state → OrganicVariation | On state change | EQ center shifts with state |
| Session time → SessionArcController | 1 Hz tick | phase advance based on elapsed time |
| Circadian hour → SessionArcController | Once at session start | mode/target adjustment |

---

## Success Criteria

A session is successful if:
- [ ] 30+ minute session produces no audible loop repeat (stem rotates before 10 min mark)
- [ ] ANS state change triggers stem preload within 1s
- [ ] Crossfade is perceptually seamless (no audible cut)
- [ ] Silence actuator fires once per 8–12 min window
- [ ] Binaural beat shifts on state change (ramps, no click)
- [ ] RMSSD trend is upward over 20-min session (validation against Polar Beat app)
- [ ] Circadian mode correctly selects morning vs. evening stems
- [ ] All stems CC0 or CC-BY with attribution in ATTRIBUTION.md
- [ ] Build size increase <15 MB (core bundled stems only)

---

## Out of Scope (V2 — defer to V3+)

- User-facing stem selection UI
- Stem rating/feedback loop (personalization)
- Server-side stem streaming infrastructure (Cloudflare R2)
- Per-user resonance frequency calibration (personalized 0.1 Hz target)
- AI-generated stems
- Stem community/marketplace
