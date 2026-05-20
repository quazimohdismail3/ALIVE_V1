// frontend/src/audio/session_audio.js
// ISO-bridge adaptive audio engine with 5-layer stem loading + procedural chord engine.
// ISO Principle (Altshuler 1948): bridge = current + α × (target − current)
// Binaural glide 45s minimum (Thaut 2015).
//
// AUDIO HIERARCHY (loudest to quietest):
//   1. spatial stems  (forest ambience — dominant natural layer)
//   2. breath stems   (birds/wind — nature texture)
//   3. harmonic stems (ether vox — pad support)
//   4. binaural layer (subliminal −50 dB, masked by stems)
//   5. chord engine   (silent unless harmonic stem fails to load after 20s)
//   6. breath guide   (subtle 174Hz sine, 25% of configured volume)
//   7. ground drone   (muted — dungeon_drone semantically wrong; ChordEngine handles ground when needed)
//
// Startup guarantee: ALL synthetic layers start at −60 dB (silent).
// Natural stems fade in over 8s once loaded. No explosive onset.
import * as Tone from 'tone';
import { BinauralGenerator } from './binaural.js';
import { BreathActuator }    from './breath_actuator.js';
import { StemLayer }         from './stem_layer.js';
import { StemLayerPair }     from './stem_layer_pair.js';
import { stemLoader }        from './stem_loader.js';
import { ChordEngine }       from './chord_engine.js';
import { OrganicVariation }  from './organic_variation.js';
import { SESSIONS }          from '../config/sessions.js';

// INVARIANT: all param changes use 2000ms ramp minimum (enforced in BinauralGenerator/BreathActuator)
// INVARIANT: binaural glide minimum 45000ms (entrainment requires 45–60s per Thaut 2015)
const BINAURAL_GLIDE_MS = 45000;

// State confirmation gate: ANS must hold direction before α adapts
const CONFIRM_MS_STRESS = 8000;   // 8s for sympathetic direction
const CONFIRM_MS_CALM   = 90000;  // 90s for parasympathetic direction (Lehrer & Gevirtz 2014 HRVB minimum ~2-3 min; 90s conservative interim)

// If harmonic stem not loaded within this window → activate chord engine as quiet fallback
const CHORD_FALLBACK_MS = 20000;

export class SessionAudio {
  constructor(sessionType, { binauralEnabled = true } = {}) {
    this.sessionType      = sessionType;
    this._sessionCfg      = SESSIONS[sessionType] ?? SESSIONS.find_your_calm;
    this._binauralEnabled = binauralEnabled;

    // Core oscillator layers (always active, start silent)
    this.binaural = new BinauralGenerator();
    this.breath   = new BreathActuator();

    // Procedural harmonic pad — silent until harmonic stem fails to load
    this._chord = new ChordEngine();

    // Stem layers. Perceptually-dominant layers (breath_s/harmonic/spatial) are
    // StemLayerPair so they can rotate between manifest alternates as soon as the
    // pool has 2+ stems — defends against auditory cortex habituation (~8-10 min).
    // Ground (muted) and morning (single-stem-only) stay as plain StemLayer.
    this._stems = {
      ground:   new StemLayer(),     // low-freq drone (muted — dungeon wrong for HRV)
      breath_s: new StemLayerPair(), // wind/nature (prominent, benefits from rotation)
      harmonic: new StemLayerPair(), // ambient pad (rotates as ANS shifts)
      spatial:  new StemLayerPair(), // forest/rain (dominant natural layer, rotates)
      morning:  new StemLayer(),     // bright pad (morning_emergence only)
    };

    this._currentPhase  = null;
    this._rfBpm         = 6;
    this._started       = false;
    this._stemsStarted  = false;
    this._lastParams    = null;

    // ISO bridge state
    this._ansState    = { arousal: 0.5, valence: 0.5, stability: 0.5, coherence: 0.5 };
    this._phaseTarget = null;
    this._alpha       = 0.0;
    this._lastAnsDir  = null;
    this._ansDirSince = 0;

    // SOMA carrier — DISABLED: 3 detuned sines caused intermodulation distortion (buzzy)
    this._soma     = [];
    this._somaGain = null;
    this._somaLFO  = null;

    // Organic variation (EQ LFO, silence actuator, HRTF rotation)
    this._organic = new OrganicVariation();

    // Session arc + circadian context
    this._sessionStartMs = 0;
    this._arcPhase       = 'ENTRAIN'; // ENTRAIN | SHIFT | INTEGRATE
    this._circadian      = 'midday';  // morning | midday | evening

    // Fallback timer — activates chord engine if harmonic stem doesn't load
    this._chordFallbackTimer = null;

    // Base volume registry — source of truth for all stem target volumes (linear 0-1)
    // Prevents OrganicVariation LFO from reading mid-ramp values as base
    this._baseVolumes = {};

    // Biometric gate: cumulative seconds of sustained coherence >= 0.5
    this._coherentSeconds = 0;
  }

  async start(rfBpm = 6) {
    await Tone.start();
    this._rfBpm          = rfBpm;
    this._sessionStartMs = Date.now();
    this._circadian      = this._getCircadianContext();

    // Binaural starts at −50 dB (subliminal) — no further ramp needed
    if (this._binauralEnabled) this.binaural.start();

    // Breath guide starts at −60 dB (silent), ramps when phase applies it
    this.breath.start(rfBpm);

    // Chord engine initialises silently — does NOT play until activateFallback() called
    const firstPhase = Object.keys(this._sessionCfg.phases)[0];
    const firstCfg   = this._sessionCfg.phases[firstPhase];
    await this._chord.start(firstCfg?.carrier ?? 256, 1, this.sessionType);

    this._applyPhase(firstPhase, false);
    this._started = true;

    // Load stems non-blocking — all synthetics remain silent/subliminal throughout
    this._loadStems();
  }

  stop() {
    clearTimeout(this._chordFallbackTimer);
    this._chordFallbackTimer = null;
    try { this.binaural.stop(); } catch (_) {}
    try { this.breath.stop();   } catch (_) {}
    this._chord.stop();
    this._chord.dispose();
    Object.values(this._stems).forEach(l => { try { l.stop();    } catch (_) {} });
    Object.values(this._stems).forEach(l => { try { l.dispose(); } catch (_) {} });
    try { this._organic.stop();    } catch (_) {}
    try { this._organic.dispose(); } catch (_) {}
    this._soma.forEach(osc => { try { osc.stop(); osc.dispose(); } catch (_) {} });
    this._soma = [];
    try { this._somaLFO?.stop(); this._somaLFO?.dispose(); } catch (_) {}
    try { this._somaGain?.dispose(); } catch (_) {}
    this._somaLFO  = null;
    this._somaGain = null;
    this._started  = false;
  }

  updateRF(rfBpm) {
    this._rfBpm = Math.max(4, Math.min(8.5, rfBpm));
    this.breath.setRF(this._rfBpm);
  }

  // Called every 1Hz — wires backend music_params + ANS state
  updateMusicParams(params, affect) {
    if (!this._started || !params) return;
    this._lastParams = params;
    this._updateArc();

    // ISO bridge: update current ANS estimate from backend affect data
    // msg.affect = { arousal, valence, quadrant } — keys are NOT prefixed with "affect_"
    const arousal = affect?.arousal ?? params.arousal ?? null;
    const valence = affect?.valence ?? params.valence ?? null;
    if (arousal !== null) this._ansState.arousal = arousal;
    if (valence !== null) this._ansState.valence = valence;

    // Biometric gate: track cumulative coherent seconds (update cadence = ~1s)
    const coherenceVal = params.coherence ?? params.vs_score ?? null;
    if (coherenceVal !== null) {
      if (coherenceVal >= 0.5) this._coherentSeconds += 1;
      else                      this._coherentSeconds  = 0;
    }

    // Binaural: bridge-blended beat, 45s glide.
    // CARRIER FIX (Oster 1973): binaural_carrier_hz MUST be in ITD perception range
    // (100–1500 Hz). Never use soma_carrier_hz (40–60 Hz) here — sub-100 collapses
    // the beat percept into two subaudible thumps.
    const beatHz    = params.binaural_beat_hz ?? null;
    const phaseCarrier = this._sessionCfg.phases?.[this._currentPhase]?.carrier;
    const carrierHz = params.binaural_carrier_hz
                   ?? (phaseCarrier && phaseCarrier >= 100 ? phaseCarrier : 432);
    if (beatHz !== null) {
      const targetBeat = this._phaseTarget?.binaural ?? beatHz;
      const bridgeBeat = this._isoBridge(beatHz, targetBeat);
      this.binaural.set(bridgeBeat, carrierHz, BINAURAL_GLIDE_MS);
    }

    // Chord engine: full 7-param update (only has effect if chord is active as fallback)
    this._chord.setParams({
      keyMode:    params.key_mode,
      rootHz:     params.soma_carrier_hz,
      tension:    params.harmonic_tension,
      presence:   params.voice_range_presence ?? 0.4,
      brightness: params.brightness,
      warmth:     params.warmth,
      roughness:  params.roughness,
    });

    // Organic variation: spatial width + micro-variation intensity (1Hz live update)
    if (params.spatial_width   !== undefined) this._organic.setSpatialWidth(params.spatial_width);
    if (params.micro_variation !== undefined) this._organic.setVariationIntensity(params.micro_variation);

    // BPM → Tone.Transport (8s ramp — slow enough to avoid perceptible tempo jumps)
    // Formula (backend): 55 + rmssd_norm×15 + arousal×8, capped 50-75 BPM therapeutic.
    const bpm = params.bpm ?? null;
    if (bpm !== null) {
      try { Tone.getTransport().bpm.rampTo(Math.max(40, Math.min(120, bpm)), 8); } catch (_) {}
    }

    // Stem layer volumes driven by ANS scalars
    this._applyStemVolumesMusicParams(params);
    this._updateAlpha();
    this._maybeRotateStems();
  }

  // ANS state → rotation bucket string for StemLayerPair selectStem()
  _ansBucket() {
    const a = this._ansState.arousal ?? 0.5;
    if (a < 0.35)      return 'parasympathetic';
    else if (a > 0.65) return 'sympathetic';
    else               return 'transitioning';
  }

  // Trigger stem rotation across pair-backed layers. Pair has its own 2-min hold
  // guard and skips if pool < 2 — safe to call every tick.
  _maybeRotateStems() {
    if (!this._stemsStarted) return;
    const bucket = this._ansBucket();
    ['breath_s', 'harmonic', 'spatial'].forEach(layer => {
      const stem = this._stems[layer];
      if (stem && typeof stem.rotate === 'function') {
        stem.rotate(bucket, 3.0).catch(() => {}); // fire-and-forget
      }
    });
  }

  updateState(phase, polybioState, rmssdFalling) {
    if (!this._started) return;
    if (polybioState === 'MEDITATIVE') return; // INVARIANT: never intervene during MEDITATIVE
    if (phase === this._currentPhase) return;

    const phaseCfg = this._sessionCfg.phases?.[phase];
    if (!phaseCfg) return;

    this._phaseTarget = phaseCfg.isoTarget ?? null;
    this._alpha = 0.0; // reset — meet user where they are on phase change

    this._applyPhase(phase, rmssdFalling);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  async _loadStems() {
    try {
      await stemLoader.init();
      const res = await fetch('/stems/stems.json');
      if (!res.ok) throw new Error(`stems.json ${res.status}`);
      const manifest = await res.json();

      // Populate rotation pools on pair-backed layers. Pool size 1 = rotation no-op.
      this._stems.breath_s.setPool?.(manifest.breath?.stems  ?? []);
      this._stems.harmonic.setPool?.(manifest.harmonic?.stems ?? []);
      this._stems.spatial.setPool?.(manifest.spatial?.stems  ?? []);

      // Initial-stem load. StemLayerPair.load matches StemLayer.load(buf) signature
      // when called with an AudioBuffer + stemId. Pair tracks the id internally.
      const breathInitial   = manifest.breath?.stems?.[0]?.id   ?? null;
      const harmonicInitial = manifest.harmonic?.stems?.[0]?.id ?? null;
      const spatialInitial  = manifest.spatial?.stems?.[0]?.id  ?? null;

      const loads = [
        stemLoader.load(manifest.ground?.url,   'ground')
          .then(buf => this._stems.ground.load(buf)),
        stemLoader.load(manifest.breath?.url,   'breath')
          .then(buf => this._stems.breath_s.load(buf, breathInitial)),
        stemLoader.load(manifest.harmonic?.url, 'harmonic')
          .then(buf => this._stems.harmonic.load(buf, harmonicInitial)),
        stemLoader.load(manifest.spatial?.url,  'spatial')
          .then(buf => this._stems.spatial.load(buf, spatialInitial)),
        stemLoader.load(manifest.morning?.url,  'morning')
          .then(buf => this._stems.morning.load(buf)),
      ];
      await Promise.allSettled(loads);

      if (this._started && !this._stemsStarted) {
        this._stemsStarted = true;

        // Stems start at -60 dB (StemLayer default) and ramp up via _applyStemPhaseVolumes
        Object.values(this._stems).forEach(l => l.start());

        // Harmonic stem loaded → chord engine stays silent (it was never active)
        if (this._stems.harmonic.isLoaded) {
          // Chord is already silent — this just ensures it stays silent and cleans up timer
          clearTimeout(this._chordFallbackTimer);
          this._chordFallbackTimer = null;
          this._chord.fadeOut(0); // ensure inactive flag set
        }

        if (this._currentPhase) this._applyStemPhaseVolumes(this._currentPhase);

        // Start organic variation after stems are running
        this._organic.start(
          {
            ground:   this._stems.ground.volNode,
            breath_s: this._stems.breath_s.volNode,
            harmonic: this._stems.harmonic.volNode,
            spatial:  this._stems.spatial.volNode,
            morning:  this._stems.morning.volNode,
          },
          null, // spatialPanner — not wired yet
          // onVolumeChange callback: routes OrganicVariation rampTo through _baseVolumes registry
          (layer, targetLinear, rampMs) => this._setLayerVolume(layer, targetLinear, rampMs)
        );
      }
    } catch (_) {
      // Network/parse error — chord fallback will activate via timer below
    }

    // Fallback: if harmonic stem didn't load, activate chord engine after timeout
    // This ensures there is SOME harmonic sound even if stems are unavailable
    if (this._started && !this._chordFallbackTimer) {
      this._chordFallbackTimer = setTimeout(() => {
        if (this._started && !this._stems.harmonic.isLoaded) {
          this._chord.activateFallback(8000);
        }
        this._chordFallbackTimer = null;
      }, CHORD_FALLBACK_MS);
    }
  }

  _isoBridge(current, target) {
    return current + this._alpha * (target - current);
  }

  _updateAlpha() {
    if (!this._phaseTarget) return;
    const { arousal: ta, valence: tv } = this._phaseTarget;
    const dist = Math.abs(this._ansState.arousal - ta) + Math.abs(this._ansState.valence - tv);
    const dir  = dist < 0.4 ? 'toward' : 'away';
    const now  = Date.now();
    if (dir !== this._lastAnsDir) { this._lastAnsDir = dir; this._ansDirSince = now; return; }
    const elapsed   = now - this._ansDirSince;
    const confirmMs = dir === 'away' ? CONFIRM_MS_STRESS : CONFIRM_MS_CALM;
    if (elapsed < confirmMs) return;
    // Arc-aware alpha ceiling: ENTRAIN meets the user gently (low α), SHIFT moves
    // them, INTEGRATE locks them at the parasympathetic target. Was hard-capped at
    // 0.6 so the full target was never reached in 30-45 min sessions.
    // UNTUNED: re-validate progression curve against real Polar H10 (CLAUDE.md V2.1).
    const aCap = this._arcPhase === 'INTEGRATE' ? 0.95
               : this._arcPhase === 'SHIFT'     ? 0.80
               :                                  0.50; // ENTRAIN
    if (dir === 'toward') this._alpha = Math.min(aCap, this._alpha + 0.05);
    else                  this._alpha = Math.max(0.0, this._alpha - 0.1);
  }

  _applyPhase(phase, _rmssdFalling) {
    const cfg = this._sessionCfg.phases?.[phase];
    if (!cfg) return;
    this._currentPhase = phase;
    this._phaseTarget  = cfg.isoTarget ?? null;
    // Guard: never let phase config push binaural carrier below 100Hz (Oster 1973).
    const safeCarrier = (cfg.carrier && cfg.carrier >= 100) ? cfg.carrier : 432;
    this.binaural.set(cfg.binaural, safeCarrier, BINAURAL_GLIDE_MS);

    // Breath guide: scale to 25% of configured volume — subtle hint, not dominant tone
    // Research: breath guide should be felt as invitation, not heard as buzzing sine
    const scaledBreathVol = (cfg.breathVol ?? 0) * 0.25;
    this.breath.setVolume(scaledBreathVol > 0.005 ? scaledBreathVol : 0.001, 4000);
    if (cfg.breathRate) this.breath.setRF(cfg.breathRate);

    // Chord engine re-voices only if it has been activated as fallback
    this._chord.refresh();

    if (this._stemsStarted) this._applyStemPhaseVolumes(phase);
  }

  // Stem volumes driven by phase config (static ANS target for this phase) +
  // session arc (ENTRAIN nature-forward, INTEGRATE harmonic-forward).
  // Research: auditory cortex adapts in seconds — varying the balance over the arc
  // is the cheapest habituation defence we have until StemLayerPair rotation is live.
  _applyStemPhaseVolumes(phase) {
    const cfg = this._sessionCfg.phases?.[phase];
    if (!cfg) return;
    const t    = cfg.isoTarget ?? {};
    const calm = 1 - (t.arousal ?? 0.5);
    const coh  = t.coherence ?? 0.5;
    const isMorning = this.sessionType === 'morning_emergence';

    // Arc shaping: scalar 0..1 representing arc progression.
    // ENTRAIN: nature dominant (forest/wind front). INTEGRATE: harmonic forward (pad up).
    // UNTUNED: re-validate balance once real Polar H10 sessions exist.
    const arcScale = { ENTRAIN: 0.0, SHIFT: 0.5, INTEGRATE: 1.0 }[this._arcPhase] ?? 0.0;
    const natureMul   = 1.0 - 0.35 * arcScale;  // 1.00 → 0.65
    const harmonicMul = 1.0 + 0.55 * arcScale;  // 1.00 → 1.55

    // Ground drone (dungeon_drone_cc0.ogg) — muted. Semantically wrong for HRV therapy.
    // ChordEngine handles tonal ground layer if stems fail (via activateFallback).
    this._setLayerVolume('ground', 0.001, 4000);

    // Breath/nature texture (birds_wind) — prominent natural layer
    // Research (Annerstedt 2013, Miyazaki 2014): nature sounds are the active vagal ingredient.
    const breathBase = cfg.breathVol > 0 ? cfg.breathVol * 0.85 : 0.15;
    this._setLayerVolume('breath_s', breathBase * natureMul, 3000);

    // Harmonic pad (ether_vox) — climbs from support to co-equal across arc
    this._setLayerVolume('harmonic', Math.min(0.85, calm * 0.42 * harmonicMul), 3000);

    // Spatial / forest — dominant natural layer (highest volume)
    this._setLayerVolume('spatial', isMorning ? 0.001 : calm * 0.58 * natureMul, 4000);

    const morningPhases = ['ACTIVATE', 'ENERGIZE', 'PRIME'];
    this._setLayerVolume('morning',
      isMorning && morningPhases.includes(phase) ? 0.35 : 0.001,
      3000
    );
  }

  // Fine-grained stem adjustments driven by live backend music_params (1Hz)
  _applyStemVolumesMusicParams(params) {
    if (!this._stemsStarted) return;
    const presence = Math.max(0, Math.min(1, params.voice_range_presence ?? 0.4));
    if (this._stems.harmonic.isLoaded) {
      // Harmonic pad responds to presence, but stays as support layer
      this._setLayerVolume('harmonic', presence * 0.45, 2000);
    }
  }

  // Centralised stem volume setter — all stem volume changes MUST go through here.
  // Stores the target in _baseVolumes so OrganicVariation reads a stable base,
  // not a mid-ramp value (fixes concurrent rampTo race per Web Audio spec).
  _setLayerVolume(layer, targetLinear, rampMs) {
    const stem = this._stems[layer];
    if (!stem) return;
    this._baseVolumes[layer] = targetLinear;
    stem.setVolume(targetLinear, rampMs);
    // Keep OrganicVariation's dB base registry in sync so LFO ticks read the correct base
    this._organic.notifyBaseVolume(layer, targetLinear);
  }

  // ── Phase 1B additions (arc, circadian) ────────────────────────────────────

  _getCircadianContext() {
    const h = new Date().getHours();
    if (h >= 5  && h < 10) return 'morning';
    if (h >= 18 && h < 23) return 'evening';
    return 'midday';
  }

  _updateArc() {
    if (!this._sessionStartMs) return;
    const elapsedMin = (Date.now() - this._sessionStartMs) / 60000;
    const prev = this._arcPhase;

    if (this._arcPhase === 'ENTRAIN') {
      // Biometric gate: require 60s sustained coherence >= 0.5 after 8 min
      // Hard fallback at 12 min regardless of coherence (timer-only sessions / no coherence data)
      const bioGate  = elapsedMin >= 8 && this._coherentSeconds >= 60;
      const hardFall = elapsedMin >= 12;
      if (bioGate || hardFall) this._arcPhase = 'SHIFT';
    } else if (this._arcPhase === 'SHIFT') {
      if (elapsedMin >= 20) this._arcPhase = 'INTEGRATE';
    }
    // INTEGRATE is terminal — no transition out

    // Arc transition → re-apply stem volumes so the arc actually moves the balance.
    if (prev !== this._arcPhase && this._stemsStarted && this._currentPhase) {
      this._applyStemPhaseVolumes(this._currentPhase);
    }
  }
}
