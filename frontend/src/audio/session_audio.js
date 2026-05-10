// frontend/src/audio/session_audio.js
// ISO-bridge adaptive audio engine with 5-layer stem loading + procedural chord engine.
// ISO Principle (Altshuler 1948): bridge = current + α × (target − current)
// Binaural glide 45s minimum (Thaut 2015).
// Oscillator + chord engine always-on; stems load progressively and take over layers.
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

export class SessionAudio {
  constructor(sessionType) {
    this.sessionType  = sessionType;
    this._sessionCfg  = SESSIONS[sessionType] ?? SESSIONS.find_your_calm;

    // Core oscillator layers (always active)
    this.binaural = new BinauralGenerator();
    this.breath   = new BreathActuator();

    // Procedural harmonic pad — always active, fades out when harmonic stem loads
    this._chord = new ChordEngine();

    // Stem layers (progressive — load async, fallback = chord engine / silent if absent)
    this._stems = {
      ground:   new StemLayer(), // low-freq drone texture
      breath_s: new StemLayer(), // wind / nature texture (separate from breath guide)
      harmonic: new StemLayer(), // ambient pad — takes over from _chord when loaded
      spatial:  new StemLayer(), // forest / rain
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

    // SOMA carrier (3 detuned sub-bass oscillators + amplitude LFO)
    this._soma     = [];
    this._somaGain = null;
    this._somaLFO  = null;

    // Organic variation (EQ LFO, silence actuator, HRTF rotation)
    this._organic = new OrganicVariation();

    // Session arc + circadian context
    this._sessionStartMs = 0;
    this._arcPhase       = 'ENTRAIN'; // ENTRAIN | SHIFT | INTEGRATE
    this._circadian      = 'midday';  // morning | midday | evening
  }

  async start(rfBpm = 6) {
    await Tone.start();
    this._rfBpm          = rfBpm;
    this._sessionStartMs = Date.now();
    this._circadian      = this._getCircadianContext();
    this.binaural.start();
    this.breath.start(rfBpm);
    this._startSomaCarrier();

    // Chord engine needs carrier from first phase to set root pitch
    const firstPhase = Object.keys(this._sessionCfg.phases)[0];
    const firstCfg   = this._sessionCfg.phases[firstPhase];
    await this._chord.start(firstCfg?.carrier ?? 256, 1, this.sessionType);

    this._applyPhase(firstPhase, false);
    this._started = true;

    // Load stems non-blocking — oscillator + chord keep playing throughout
    this._loadStems();
  }

  stop() {
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

    // Chord engine: update root/mode/tension/presence every 1Hz
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
        Object.values(this._stems).forEach(l => l.start());

        // Harmonic stem loaded → chord engine steps back
        if (this._stems.harmonic.isLoaded) {
          this._chord.fadeOut(3000);
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
      // Network/parse error — chord engine + oscillator fallback already running
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
    this.breath.setVolume(cfg.breathVol > 0 ? cfg.breathVol : 0.001, 2000);
    if (cfg.breathRate) this.breath.setRF(cfg.breathRate);

    // Chord engine re-voices to reflect phase's carrier/mode shift
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

    this._stems.ground.setVolume(Math.max(0.05, coh * calm * 0.7), 4000);
    this._stems.breath_s.setVolume(cfg.breathVol > 0 ? cfg.breathVol * 0.6 : 0.001, 2000);
    this._stems.harmonic.setVolume(calm * 0.5, 3000);
    this._stems.spatial.setVolume(isMorning ? 0.001 : calm * 0.3, 4000);

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
      this._stems.harmonic.setVolume(presence * 0.6, 2000);
    }
  }

  // ── Phase 1B additions ──────────────────────────────────────────────────────

  _startSomaCarrier() {
    const SOMA_HZ = { find_your_calm: 60, wind_down: 60, morning_emergence: 52 };
    const baseHz  = SOMA_HZ[this.sessionType] ?? 60;
    const freqs   = [baseHz - 1, baseHz, baseHz + 1.5];

    try {
      this._somaGain = new Tone.Volume(-26);
      this._somaGain.toDestination();

      this._soma = freqs.map(f => {
        const osc = new Tone.Oscillator({ type: 'sine', frequency: f });
        osc.connect(this._somaGain);
        osc.start();
        return osc;
      });

      // 0.02 Hz LFO (50s cycle) — slow breathing sensation on carrier
      this._somaLFO = new Tone.LFO({ frequency: 0.02, min: -30, max: -22, type: 'sine' }).start();
      this._somaLFO.connect(this._somaGain.volume);
    } catch (_) {
      // SOMA carrier is additive — any failure is silent degradation
    }
  }

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
