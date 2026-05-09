// frontend/src/audio/session_audio.js
// ISO-bridge adaptive audio engine with 5-layer stem loading.
// ISO Principle (Altshuler 1948): bridge = current + α × (target − current)
// Binaural glide 45s minimum (Thaut 2015).
// Oscillator fallback stays active if stems fail to load (IndexedDB cache miss + fetch fail).
import * as Tone from 'tone';
import { BinauralGenerator } from './binaural.js';
import { BreathActuator } from './breath_actuator.js';
import { StemLayer } from './stem_layer.js';
import { stemLoader } from './stem_loader.js';
import { SESSIONS } from '../config/sessions.js';

// INVARIANT: all param changes use 2000ms ramp minimum (enforced in BinauralGenerator/BreathActuator)
// INVARIANT: binaural glide minimum 45000ms (entrainment requires 45–60s per Thaut 2015)
const BINAURAL_GLIDE_MS = 45000;

// Scale intervals (semitones from root): 0=minor, 1=major, 2=lydian
const SCALE_INTERVALS = [
  [0, 3, 7, 10],  // minor 7th
  [0, 4, 7, 11],  // major 7th
  [0, 4, 8, 11],  // lydian maj7
];

// State confirmation gate: ANS must hold direction before α adapts
const CONFIRM_MS_STRESS = 8000;   // 8s for sympathetic direction
const CONFIRM_MS_CALM   = 25000;  // 25s for parasympathetic direction

function carrierToMidi(hz) {
  return Math.round(12 * Math.log2(hz / 440) + 69) + 12;
}

export class SessionAudio {
  constructor(sessionType) {
    this.sessionType = sessionType;
    this._sessionCfg = SESSIONS[sessionType] ?? SESSIONS.find_your_calm;

    // Core oscillator layers (always active)
    this.binaural = new BinauralGenerator();
    this.breath   = new BreathActuator();

    // Fallback harmonic pad (PolySynth — active until harmonic stem loads)
    this._pad    = null;
    this._reverb = null;

    // Stem layers (progressive — load async, fallback = silent if absent)
    this._stems = {
      ground:   new StemLayer(), // tibetan bowl / drone
      breath_s: new StemLayer(), // wind / flute texture (separate from breath guide)
      harmonic: new StemLayer(), // string pad / choir
      spatial:  new StemLayer(), // rain / forest
      morning:  new StemLayer(), // bright piano (morning_emergence only)
    };

    this._currentPhase   = null;
    this._rfBpm          = 6;
    this._started        = false;
    this._stemsStarted   = false;
    this._lastParams     = null;

    // ISO bridge state
    this._ansState    = { arousal: 0.5, valence: 0.5, stability: 0.5, coherence: 0.5 };
    this._phaseTarget = null;
    this._alpha       = 0.0;
    this._lastAnsDir  = null;
    this._ansDirSince = 0;
  }

  async start(rfBpm = 6) {
    await Tone.start();
    this._rfBpm = rfBpm;
    this.binaural.start();
    this.breath.start(rfBpm);

    // Fallback harmonic pad — active immediately, replaced by stem when loaded
    try {
      this._reverb = new Tone.Reverb({ decay: 7, wet: 0.6 });
      await this._reverb.generate();
      this._pad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 3.5, decay: 1.5, sustain: 0.7, release: 6.0 },
      });
      this._pad.connect(this._reverb);
      this._reverb.toDestination();
      this._pad.volume.value = -24;
    } catch (_) {
      this._pad = null;
    }

    const firstPhase = Object.keys(this._sessionCfg.phases)[0];
    this._applyPhase(firstPhase, false);
    this._started = true;

    // Load stems non-blocking — oscillator layers keep playing throughout
    this._loadStems();
  }

  stop() {
    try { this.binaural.stop(); } catch (_) {}
    try { this.breath.stop(); } catch (_) {}
    try { this._pad?.releaseAll('+1'); } catch (_) {}
    Object.values(this._stems).forEach(l => { try { l.stop(); } catch (_) {} });
    Object.values(this._stems).forEach(l => { try { l.dispose(); } catch (_) {} });
    this._started = false;
  }

  updateRF(rfBpm) {
    this._rfBpm = Math.max(4, Math.min(8.5, rfBpm));
    this.breath.setRF(this._rfBpm);
  }

  // Called every 1Hz — wires backend music_params + ANS state
  updateMusicParams(params) {
    if (!this._started || !params) return;
    this._lastParams = params;

    // ISO bridge: update current ANS estimate from backend affect data
    const arousal = params.affect_arousal ?? params.arousal ?? null;
    const valence = params.affect_valence ?? params.valence ?? null;
    if (arousal !== null) this._ansState.arousal = arousal;
    if (valence !== null) this._ansState.valence = valence;

    // Binaural: bridge-blended beat, 45s glide
    const beatHz    = params.binaural_beat_hz ?? null;
    const carrierHz = params.soma_carrier_hz  ?? null;
    if (beatHz !== null && carrierHz !== null) {
      const targetBeat  = this._phaseTarget?.binaural ?? beatHz;
      const bridgeBeat  = this._isoBridge(beatHz, targetBeat);
      this.binaural.set(bridgeBeat, carrierHz, BINAURAL_GLIDE_MS);
    }

    // Fallback pad volume from voice_range_presence
    if (this._pad && !this._stems.harmonic.isLoaded) {
      const presence = Math.max(0, Math.min(1, params.voice_range_presence ?? 0.4));
      const db = -30 + presence * 12;
      this._pad.volume.rampTo(db, 2);
    }

    // Stem layer volumes driven by ANS scalars
    this._applyStemVolumesMusicParams(params);
    this._updateAlpha();
  }

  updateState(phase, polybioState, rmssdFalling) {
    if (!this._started) return;
    if (polybioState === 'MEDITATIVE') return;  // INVARIANT: never intervene during MEDITATIVE
    if (phase === this._currentPhase) return;

    const phaseCfg = this._sessionCfg.phases?.[phase];
    if (!phaseCfg) return;

    this._phaseTarget = phaseCfg.isoTarget ?? null;
    this._alpha = 0.0; // reset — meet user where they are on phase change

    this._applyPhase(phase, rmssdFalling);
    this._playPadChord();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  async _loadStems() {
    try {
      await stemLoader.init();
      const res      = await fetch('/stems/stems.json');
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
        // Silence pad fallback once harmonic stem loaded
        if (this._stems.harmonic.isLoaded && this._pad) {
          this._pad.volume.rampTo(-60, 2);
        }
        if (this._currentPhase) this._applyStemPhaseVolumes(this._currentPhase);
      }
    } catch (_) {
      // Network/parse error — oscillator fallback already running
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
    if (this._stemsStarted) this._applyStemPhaseVolumes(phase);
  }

  // Stem volumes driven by phase config (static ANS target for this phase)
  _applyStemPhaseVolumes(phase) {
    const cfg  = this._sessionCfg.phases?.[phase];
    if (!cfg) return;
    const t    = cfg.isoTarget ?? {};
    const calm = 1 - (t.arousal ?? 0.5);     // 0=active → 1=calm
    const coh  = t.coherence ?? 0.5;
    const isMorning = this.sessionType === 'morning_emergence';

    // Ground: always present, vol = coherence × calm × 0.7
    this._stems.ground.setVolume(Math.max(0.05, coh * calm * 0.7), 4000);

    // Breath stem: mirrors phase breathVol
    this._stems.breath_s.setVolume(cfg.breathVol > 0 ? cfg.breathVol * 0.6 : 0.001, 2000);

    // Harmonic: presence-driven — set base; updateMusicParams refines every 1Hz
    this._stems.harmonic.setVolume(calm * 0.5, 3000);

    // Spatial (rain/nature): calm sessions only
    this._stems.spatial.setVolume(isMorning ? 0.001 : calm * 0.3, 4000);

    // Morning piano: morning_emergence only, rises in ACTIVATE/ENERGIZE/PRIME phases
    const morningPhases = ['ACTIVATE', 'ENERGIZE', 'PRIME'];
    const morningVol = isMorning && morningPhases.includes(phase) ? 0.35 : 0.001;
    this._stems.morning.setVolume(morningVol, 3000);
  }

  // Fine-grained stem adjustments driven by live backend music_params (1Hz)
  _applyStemVolumesMusicParams(params) {
    if (!this._stemsStarted) return;
    const presence = Math.max(0, Math.min(1, params.voice_range_presence ?? 0.4));
    // Harmonic stem tracks voice_range_presence
    if (this._stems.harmonic.isLoaded) {
      this._stems.harmonic.setVolume(presence * 0.6, 2000);
    }
  }

  _playPadChord() {
    if (!this._pad || !this._started) return;
    if (this._stems.harmonic.isLoaded) return; // stem active — skip oscillator chord
    try {
      const mp      = this._lastParams;
      const keyMode = Math.min(2, Math.max(0, Math.round(mp?.key_mode ?? 1)));
      const carrier = mp?.soma_carrier_hz ?? 256;
      const tension = mp?.harmonic_tension ?? 0.3;
      const root    = carrierToMidi(carrier);
      const notes   = SCALE_INTERVALS[keyMode]
        .slice(0, tension > 0.55 ? 4 : 3)
        .map(i => Tone.Frequency(root + i, 'midi').toNote());
      this._pad.releaseAll('+0.5');
      notes.forEach((n, i) => this._pad.triggerAttack(n, `+${0.7 + i * 0.12}`));
    } catch (_) {}
  }
}
