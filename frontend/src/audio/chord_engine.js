// frontend/src/audio/chord_engine.js
// Procedural harmonic pad — continuous, ANS-adaptive, voice-leading on phase change.
// Fades out when harmonic stem loads (stem takes over).
//
// Extension points (V3+):
//   • Swap _buildNotes() for richer voicing strategy
//   • Add ArpeggiatorLayer that reads _rootMidi/_keyMode
//   • Add ModulationLFO for slow vibrato/tremolo
//   • Add more scale modes to SCALE_INTERVALS
import * as Tone from 'tone';

const SCALE_INTERVALS = [
  [0, 3, 7, 10], // minor 7th
  [0, 4, 7, 11], // major 7th
  [0, 4, 8, 11], // lydian maj7
];

// Spread voicing across two octaves — avoids muddy low cluster
const VOICE_SPREADS = [0, 12, 7, 24];

function hzToMidi(hz) {
  return Math.round(12 * Math.log2(hz / 440) + 69) + 12;
}

export class ChordEngine {
  constructor() {
    this._reverb      = null;
    this._pad         = null;
    this._volNode     = null;
    this._started     = false;
    this._active      = false;
    this._rootMidi    = hzToMidi(256);
    this._keyMode     = 1;
    this._tension     = 0.3;
    this._evolveTimer = null;
  }

  // Call before _applyPhase. await required (Tone.Reverb.generate is async).
  async start(rootHz = 256, keyMode = 1) {
    this._rootMidi = hzToMidi(rootHz);
    this._keyMode  = Math.min(2, Math.max(0, Math.round(keyMode)));

    this._reverb  = new Tone.Reverb({ decay: 7, wet: 0.6 });
    await this._reverb.generate();
    this._volNode = new Tone.Volume(-24);
    this._pad     = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope:   { attack: 3.5, decay: 1.5, sustain: 0.7, release: 6.0 },
    });
    this._pad.connect(this._volNode);
    this._volNode.connect(this._reverb);
    this._reverb.toDestination();

    this._started = true;
    this._active  = true;
    this._strikeChord(false);

    // Organic re-voicing every 30s — keeps pad breathing between phase changes
    this._evolveTimer = setInterval(() => {
      if (this._active) this._evolveVoicing();
    }, 30_000);
  }

  // Called every 1Hz from updateMusicParams. Re-voices only if root/mode actually changed.
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

  // Called on phase transition — re-voices chord to reflect new carrier/mode
  refresh() {
    if (!this._started || !this._active) return;
    this._voiceLead();
  }

  // Called when harmonic stem finishes loading — chord engine steps back
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
    this._started = false;
    this._active  = false;
  }

  dispose() {
    this.stop();
    try { this._pad?.dispose();     } catch (_) {}
    try { this._volNode?.dispose(); } catch (_) {}
    try { this._reverb?.dispose();  } catch (_) {}
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _buildNotes() {
    const intervals = SCALE_INTERVALS[this._keyMode];
    const count     = this._tension > 0.55 ? 4 : 3;
    return intervals.slice(0, count).map((semitones, i) =>
      Tone.Frequency(this._rootMidi + semitones + VOICE_SPREADS[i], 'midi').toNote()
    );
  }

  // Initial or post-refresh strike — staggered attack for organ-like bloom
  _strikeChord(release = true) {
    if (!this._pad || !this._active) return;
    try {
      const notes  = this._buildNotes();
      const offset = release ? 0.7 : 0.1;
      if (release) this._pad.releaseAll('+0.5');
      notes.forEach((n, i) => this._pad.triggerAttack(n, `+${offset + i * 0.12}`));
    } catch (_) {}
  }

  // Phase change: release over 1.5s, re-attack new chord — smooth voice leading
  _voiceLead() {
    if (!this._pad || !this._active) return;
    try {
      this._pad.releaseAll('+1.5');
      const notes = this._buildNotes();
      notes.forEach((n, i) => this._pad.triggerAttack(n, `+${2.0 + i * 0.25}`));
    } catch (_) {}
  }

  // Breath-pulse: release one voice, re-trigger after a 2.4s gap
  _evolveVoicing() {
    if (!this._pad || !this._active) return;
    try {
      const notes = this._buildNotes();
      const note  = notes[Math.floor(Math.random() * notes.length)];
      this._pad.triggerRelease(note, '+0.1');
      this._pad.triggerAttack(note, '+2.5');
    } catch (_) {}
  }
}
