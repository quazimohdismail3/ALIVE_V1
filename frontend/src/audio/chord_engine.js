// frontend/src/audio/chord_engine.js
// Procedural harmonic pad — continuous, ANS-adaptive, voice-leading on phase change.
import * as Tone from 'tone';

const SCALE_INTERVALS = [
  [0, 3, 7, 10], // minor 7th
  [0, 4, 7, 11], // major 7th
  [0, 4, 8, 11], // lydian maj7
];

const VOICE_SPREADS = [0, 12, 7, 24];

function hzToMidi(hz) {
  return Math.round(12 * Math.log2(hz / 440) + 69) + 12;
}

export class ChordEngine {
  constructor() {
    this._reverb      = null;
    this._pad         = null;
    this._volNode     = null;
    this._noise       = null;
    this._noiseVol    = null;
    this._started     = false;
    this._active      = false;
    this._rootMidi    = hzToMidi(256);
    this._keyMode     = 1;
    this._tension     = 0.3;
    this._sessionType = 'find_your_calm';
    this._evolveTimer = null;
  }

  async start(rootHz = 256, keyMode = 1, sessionType = 'find_your_calm') {
    this._rootMidi    = hzToMidi(rootHz);
    this._keyMode     = Math.min(2, Math.max(0, Math.round(keyMode)));
    this._sessionType = sessionType;

    // Map session types to IR files (files may not exist yet — fallback handles it)
    const IR_MAP = {
      find_your_calm:    '/ir/stone_chamber.wav',
      wind_down:         '/ir/cathedral.wav',
      morning_emergence: '/ir/forest.wav',
    };
    const irUrl = IR_MAP[this._sessionType] ?? '/ir/stone_chamber.wav';

    try {
      this._reverb = new Tone.Convolver(irUrl);
      // Give it 3s to load; if it fails the wet is just 0 (dry signal)
      setTimeout(() => {
        if (this._reverb && this._reverb.wet) this._reverb.wet.value = 0.55;
      }, 3000);
    } catch (_) {
      this._reverb = new Tone.Reverb({ decay: 7, wet: 0.6 });
      await this._reverb.generate();
    }

    this._volNode = new Tone.Volume(-24);
    this._pad     = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 8,
      oscillator: { type: 'sine' },
      envelope: { attack: 3.5, decay: 1.5, sustain: 0.7, release: 6.0 },
      modulation: { type: 'triangle' },
      modulationEnvelope: { attack: 2.0, decay: 0.5, sustain: 0.8, release: 4.0 },
    });
    this._pad.connect(this._volNode);
    this._volNode.connect(this._reverb);
    this._reverb.toDestination();

    this._noise    = new Tone.Noise('pink');
    this._noiseVol = new Tone.Volume(-42);
    this._noise.connect(this._noiseVol);
    this._noiseVol.toDestination();
    this._noise.start();

    this._started = true;
    this._active  = true;
    this._strikeChord(false);

    this._evolveTimer = setInterval(() => {
      if (this._active) this._evolveVoicing();
    }, 10_000);
  }

  setParams({ keyMode, rootHz, tension, presence } = {}) {
    if (!this._started || !this._active) return;
    let reVoice = false;
    if (keyMode !== undefined) {
      const k = Math.min(2, Math.max(0, Math.round(keyMode)));
      if (k !== this._keyMode) { this._keyMode = k; reVoice = true; }
    }
    if (rootHz !== undefined) {
      const m = hzToMidi(rootHz);
      if (m !== this._rootMidi) { this._rootMidi = m; reVoice = true; }
    }
    if (tension  !== undefined) this._tension = tension;
    if (presence !== undefined) {
      const db = -30 + Math.max(0, Math.min(1, presence)) * 12;
      this._volNode?.volume.rampTo(db, 2);
    }
    if (reVoice) this._voiceLead();
  }

  refresh() {
    if (!this._started || !this._active) return;
    this._voiceLead();
  }

  fadeOut(ms = 3000) {
    if (!this._started) return;
    this._active = false;
    clearInterval(this._evolveTimer);
    this._evolveTimer = null;
    this._volNode?.volume.rampTo(-60, ms / 1000);
    this._pad?.releaseAll(`+${ms / 1000}`);
  }

  stop() {
    clearInterval(this._evolveTimer);
    this._evolveTimer = null;
    try { this._pad?.releaseAll('+0.5'); } catch (_) {}
    try { this._noise?.stop(); } catch (_) {}
    this._started = false;
    this._active  = false;
  }

  dispose() {
    this.stop();
    try { this._pad?.dispose();     } catch (_) {}
    try { this._volNode?.dispose(); } catch (_) {}
    try { this._reverb?.dispose();  } catch (_) {}
    try { this._noise?.dispose();    } catch (_) {}
    try { this._noiseVol?.dispose(); } catch (_) {}
  }

  _buildNotes() {
    const intervals = SCALE_INTERVALS[this._keyMode];
    const count     = this._tension > 0.55 ? 4 : 3;
    return intervals.slice(0, count).map((semitones, i) =>
      Tone.Frequency(this._rootMidi + semitones + VOICE_SPREADS[i], 'midi').toNote()
    );
  }

  _strikeChord(release = true) {
    if (!this._pad || !this._active) return;
    try {
      const notes  = this._buildNotes();
      const offset = release ? 0.7 : 0.1;
      if (release) this._pad.releaseAll('+0.5');
      notes.forEach((n, i) => {
        const jitter = (Math.random() - 0.5) * 0.25;
        this._pad.triggerAttack(n, `+${offset + i * 0.12 + jitter}`);
      });
    } catch (_) {}
  }

  _voiceLead() {
    if (!this._pad || !this._active) return;
    try {
      this._pad.releaseAll('+1.5');
      const notes = this._buildNotes();
      notes.forEach((n, i) => {
        const jitter = (Math.random() - 0.5) * 0.2;
        this._pad.triggerAttack(n, `+${2.0 + i * 0.25 + jitter}`);
      });
    } catch (_) {}
  }

  _evolveVoicing() {
    if (!this._pad || !this._active) return;
    try {
      const notes = this._buildNotes();
      // Release and retrigger a random subset (1-2 voices) with slight timing spread
      const count  = Math.random() > 0.5 ? 1 : 2;
      const picked = notes.sort(() => Math.random() - 0.5).slice(0, count);
      picked.forEach((note, i) => {
        this._pad.triggerRelease(note, `+${0.1 + i * 0.3}`);
        this._pad.triggerAttack(note, `+${2.2 + i * 0.4 + (Math.random() - 0.5) * 0.3}`);
      });
    } catch (_) {}
  }
}
