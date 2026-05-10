// frontend/src/audio/chord_engine.js
// Procedural harmonic pad — FALLBACK ONLY. Silent on start; activated only when harmonic stem fails to load.
// When the harmonic stem loads, this engine stays silent and steps back.
// Science: triangle oscillator with slow attack avoids harsh onset (Stevens' Power Law).
//          Lydian + Dorian modes only — no tritone intervals (psychoacoustic safety).
import * as Tone from 'tone';

const SCALE_INTERVALS = [
  [0, 4, 7, 11], // major 7th (Ionian/major — balanced)
  [0, 4, 8, 11], // lydian maj7 (raised 4th — open, non-threatening)
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
    this._active      = false; // stays false until activateFallback() is called
    this._rootMidi    = hzToMidi(256);
    this._keyMode     = 1;
    this._tension     = 0.3;
    this._evolveTimer = null;
  }

  // Initialises the audio graph silently. Does NOT start playing.
  // Chord engine will remain at -60dB until activateFallback() is called.
  async start(rootHz = 256, keyMode = 1, _sessionType) {
    this._rootMidi = hzToMidi(rootHz);
    this._keyMode  = Math.min(1, Math.max(0, Math.round(keyMode)));

    // IR convolver — warmer than algorithmic reverb when chord does activate
    this._reverb = new Tone.Convolver('/ir/stone_chamber.wav');
    this._reverb.wet.value = 0.28;

    // Start completely silent — chord is a fallback, not primary sound
    this._volNode = new Tone.Volume(-60);
    this._pad     = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope:   { attack: 4.5, decay: 2.0, sustain: 0.6, release: 9.0 },
    });
    this._pad.connect(this._volNode);
    this._volNode.connect(this._reverb);
    this._reverb.toDestination();

    this._started = true;
    this._active  = false; // NOT active — waits for activateFallback()

    // Phrase re-voicing every 10s per design spec (entrains 0.1 Hz breathing frequency)
    this._evolveTimer = setInterval(() => {
      if (this._active) this._evolveVoicing();
    }, 10_000);
  }

  // Called only when harmonic stem fails to load after timeout.
  // Fades chord in slowly as a quiet background fallback.
  activateFallback(rampMs = 8000) {
    if (!this._started || this._active) return;
    this._active = true;
    this._strikeChord(false);
    // Fade in to a subliminal background level (not dominant)
    this._volNode.volume.rampTo(-46, rampMs / 1000);
  }

  setParams({ keyMode, rootHz, tension, presence } = {}) {
    if (!this._started || !this._active) return;
    let reVoice = false;

    if (keyMode !== undefined) {
      const k = Math.min(1, Math.max(0, Math.round(keyMode)));
      if (k !== this._keyMode) { this._keyMode = k; reVoice = true; }
    }
    if (rootHz !== undefined) {
      const m = hzToMidi(rootHz);
      if (m !== this._rootMidi) { this._rootMidi = m; reVoice = true; }
    }
    if (tension  !== undefined) this._tension = tension;
    if (presence !== undefined) {
      // Very quiet fallback range: -50 to -40 dB — pad should not dominate
      const db = -50 + Math.max(0, Math.min(1, presence)) * 10;
      this._volNode?.volume.rampTo(db, 2);
    }
    if (reVoice) this._voiceLead();
  }

  refresh() {
    if (!this._started || !this._active) return;
    this._voiceLead();
  }

  // Called when harmonic stem finishes loading — chord engine silences itself
  fadeOut(ms = 6000) {
    if (!this._started) return;
    this._active = false;
    clearInterval(this._evolveTimer);
    this._evolveTimer = null;
    this._volNode?.volume.rampTo(-60, ms / 1000);
    try { this._pad?.releaseAll(`+${ms / 1000}`); } catch (_) {}
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

  // Staggered attack for organ-like bloom — jitter per design spec
  _strikeChord(release = true) {
    if (!this._pad || !this._active) return;
    try {
      const notes  = this._buildNotes();
      const offset = release ? 1.2 : 0.5;
      if (release) this._pad.releaseAll('+0.8');
      // ±0.3s jitter per voice for humanness (per AME design spec)
      notes.forEach((n, i) => {
        const jitter = (Math.random() - 0.5) * 0.3;
        this._pad.triggerAttack(n, `+${offset + i * 0.2 + jitter}`);
      });
    } catch (_) {}
  }

  _voiceLead() {
    if (!this._pad || !this._active) return;
    try {
      this._pad.releaseAll('+2.0');
      const notes = this._buildNotes();
      notes.forEach((n, i) => {
        const jitter = (Math.random() - 0.5) * 0.3;
        this._pad.triggerAttack(n, `+${3.0 + i * 0.3 + jitter}`);
      });
    } catch (_) {}
  }

  // Release one voice, re-trigger after gap — single breath pulse (10s cycle)
  _evolveVoicing() {
    if (!this._pad || !this._active) return;
    try {
      const notes = this._buildNotes();
      const note  = notes[Math.floor(Math.random() * notes.length)];
      this._pad.triggerRelease(note, '+0.2');
      this._pad.triggerAttack(note, `+${2.5 + Math.random() * 0.5}`);
    } catch (_) {}
  }
}
