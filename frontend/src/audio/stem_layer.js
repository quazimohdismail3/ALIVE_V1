// frontend/src/audio/stem_layer.js
// Wraps Tone.Player for one stem layer. Looping, crossfade, graceful degradation.
import * as Tone from 'tone';

export class StemLayer {
  constructor() {
    this._player  = null;
    this._volNode = new Tone.Volume(-60).toDestination();
    this._loaded  = false;
    this._playing = false;
  }

  // audioBuffer: decoded AudioBuffer from StemLoader, or null (stay silent)
  async load(audioBuffer) {
    if (!audioBuffer) return;
    try {
      this._player = new Tone.Player({
        url:    audioBuffer,
        loop:   true,
        fadeIn: 2.0,
        fadeOut: 2.0,
      }).connect(this._volNode);
      await Tone.loaded();
      this._loaded = true;
    } catch (_) {
      this._player = null;
      this._loaded = false;
    }
  }

  start() {
    if (!this._loaded || !this._player) return;
    try {
      if (!this._playing) {
        this._player.start();
        this._playing = true;
      }
    } catch (_) {}
  }

  stop() {
    if (!this._player) return;
    try {
      this._player.stop();
      this._playing = false;
    } catch (_) {}
  }

  // vol: 0.0–1.0, rampMs: minimum 2000
  setVolume(vol, rampMs = 2000) {
    const db = vol <= 0.001 ? -60 : Tone.gainToDb(Math.max(0.001, vol));
    this._volNode.volume.rampTo(db, Math.max(rampMs, 2000) / 1000);
  }

  get isLoaded() { return this._loaded; }

  get volNode()   { return this._volNode; }

  dispose() {
    try { this._player?.dispose(); } catch (_) {}
    try { this._volNode.dispose(); } catch (_) {}
    this._loaded  = false;
    this._playing = false;
  }
}
