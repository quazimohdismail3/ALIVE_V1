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
import { stemLoader }        from './stem_loader.js';
import { ChordEngine }       from './chord_engine.js';
import { OrganicVariation }  from './organic_variation.js';
import { SESSIONS }          from '../config/sessions.js';

// INVARIANT: all param changes use 2000ms ramp minimum (enforced in BinauralGenerator/BreathActuator)
// INVARIANT: binaural glide minimum 45000ms (entrainment requires 45–60s per Thaut 2015)
const BINAURAL_GLIDE_MS = 45000;

// State confirmation gate: ANS must hold direction before α adapts
const CONFIRM_MS_STRESS = 8000;   // 8s for sympathetic direction
const CONFIRM_MS_CALM   = 25000;  // 25s for parasympathetic direction

// If harmonic stem not loaded within this window → activate chord engine as quiet fallback
const CHORD_FALLBACK_MS = 20000;

export class SessionAudio {
  constructor(sessionType) {
    this.sessionType  = sessionType;
    this._sessionCfg  = SESSIONS[sessionType] ?? SESSIONS.find_your_calm;

    // Core oscillator layers (always active, start silent)
    this.binaural = new BinauralGenerator();
    this.breath   = new BreathActuator();

    // Procedural harmonic pad — silent until harmonic stem fails to load
    this._chord = new ChordEngine();

    // Stem layers (progressive — load async, fallback = chord engine / silent if absent)
    this._stems = {
      ground:   new StemLayer(), // low-freq drone texture (muted — dungeon wrong for HRV)
      breath_s: new StemLayer(), // wind / nature texture (separate from breath guide)
      harmonic: new StemLayer(), // ambient pad — takes over from _chord when loaded
      spatial:  new StemLayer(), // forest / rain (dominant natural layer)
      morning:  new StemLayer(), // bright pad (morning_emergence only)
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
  }

  async start(rfBpm = 6) {
    await Tone.start();
    this._rfBpm          = rfBpm;
    this._sessionStartMs = Date.now();
    this._circadian      = this._getCircadianContext();

    // Binaural starts at −50 dB (subliminal) — no further ramp needed
    this.binaural.start();

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
  updateMusicParams(params) {
    if (!this._started || !params) return;
    this._lastParams = params;
    this._updateArc();

    // ISO bridge: update current ANS estimate from backend affect data
    const arousal = params.affect_arousal ?? params.arousal ?? null;
    const valence = params.affect_valence ?? params.valence ?? null;
    if (arousal !== null) this._ansState.arousal = arousal;
    if (valence !== null) this._ansState.valence = valence;

    // Binaural: bridge-blended beat, 45s glide
    const beatHz    = params.binaural_beat_hz ?? null;
    const carrierHz = params.soma_carrier_hz  ?? null;
    if (beatHz !== null && carrierHz !== null) {
      const targetBeat = this._phaseTarget?.binaural ?? beatHz;
      const bridgeBeat = this._isoBridge(beatHz, targetBeat);
      this.binaural.set(bridgeBeat, carrierHz, BINAURAL_GLIDE_MS);
    }

    // Chord engine: update params (only has effect if chord is active as fallback)
    this._chord.setParams({
      keyMode:  params.key_mode,
      rootHz:   params.soma_carrier_hz,
      tension:  params.harmonic_tension,
      presence: params.voice_range_presence ?? 0.4,
    });

    // Stem layer volumes driven by ANS scalars
    this._applyStemVolumesMusicParams(params);
    this._updateAlpha();
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
      if (!res.ok) return;
      const manifest = await res.json();

      const loads = [
        stemLoader.load(manifest.ground?.url,   'ground')
          .then(buf => this._stems.ground.load(buf)),
        stemLoader.load(manifest.breath?.url,   'breath')
          .then(buf => this._stems.breath_s.load(buf)),
        stemLoader.load(manifest.harmonic?.url, 'harmonic')
          .then(buf => this._stems.harmonic.load(buf)),
        stemLoader.load(manifest.spatial?.url,  'spatial')
          .then(buf => this._stems.spatial.load(buf)),
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
        this._organic.start({
          ground:   this._stems.ground.volNode,
          breath_s: this._stems.breath_s.volNode,
          harmonic: this._stems.harmonic.volNode,
          spatial:  this._stems.spatial.volNode,
          morning:  this._stems.morning.volNode,
        });
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
    if (dir === 'toward') this._alpha = Math.min(0.6, this._alpha + 0.05);
    else                  this._alpha = Math.max(0.0, this._alpha - 0.1);
  }

  _applyPhase(phase, _rmssdFalling) {
    const cfg = this._sessionCfg.phases?.[phase];
    if (!cfg) return;
    this._currentPhase = phase;
    this._phaseTarget  = cfg.isoTarget ?? null;
    this.binaural.set(cfg.binaural, cfg.carrier, BINAURAL_GLIDE_MS);

    // Breath guide: scale to 25% of configured volume — subtle hint, not dominant tone
    // Research: breath guide should be felt as invitation, not heard as buzzing sine
    const scaledBreathVol = (cfg.breathVol ?? 0) * 0.25;
    this.breath.setVolume(scaledBreathVol > 0.005 ? scaledBreathVol : 0.001, 4000);
    if (cfg.breathRate) this.breath.setRF(cfg.breathRate);

    // Chord engine re-voices only if it has been activated as fallback
    this._chord.refresh();

    if (this._stemsStarted) this._applyStemPhaseVolumes(phase);
  }

  // Stem volumes driven by phase config (static ANS target for this phase)
  _applyStemPhaseVolumes(phase) {
    const cfg = this._sessionCfg.phases?.[phase];
    if (!cfg) return;
    const t    = cfg.isoTarget ?? {};
    const calm = 1 - (t.arousal ?? 0.5);
    const coh  = t.coherence ?? 0.5;
    const isMorning = this.sessionType === 'morning_emergence';

    // Ground drone (dungeon_drone_cc0.ogg) — muted. Semantically wrong for HRV therapy.
    // ChordEngine handles tonal ground layer if stems fail (via activateFallback).
    this._stems.ground.setVolume(0.001, 4000);

    // Breath/nature texture (birds_wind) — prominent natural layer
    // Research (Annerstedt 2013, Miyazaki 2014): nature sounds are the active vagal ingredient.
    this._stems.breath_s.setVolume(cfg.breathVol > 0 ? cfg.breathVol * 0.85 : 0.15, 3000);

    // Harmonic pad (ether_vox) — support layer, below spatial
    this._stems.harmonic.setVolume(calm * 0.42, 3000);

    // Spatial / forest — dominant natural layer (highest volume)
    this._stems.spatial.setVolume(isMorning ? 0.001 : calm * 0.58, 4000);

    const morningPhases = ['ACTIVATE', 'ENERGIZE', 'PRIME'];
    this._stems.morning.setVolume(
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
      this._stems.harmonic.setVolume(presence * 0.45, 2000);
    }
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
    if      (elapsedMin < 8)  this._arcPhase = 'ENTRAIN';
    else if (elapsedMin < 20) this._arcPhase = 'SHIFT';
    else                      this._arcPhase = 'INTEGRATE';
  }
}
