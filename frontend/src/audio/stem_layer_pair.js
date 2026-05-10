// frontend/src/audio/stem_layer_pair.js
// A/B crossfade pair for seamless stem rotation.
// Science: HRV response latency 2–4 min → 2-min hold between swaps.
//          3-second crossfade = sweet spot for ambient stems.
import { StemLayer  } from './stem_layer.js';
import { stemLoader } from './stem_loader.js';

// ANS state → [energy, valence] target for cosine similarity selection
const ANS_TARGETS = {
  parasympathetic: [0.2, 0.8],
  transitioning:   [0.4, 0.6],
  sympathetic:     [0.7, 0.5],
};

function cosineSimilarity(a, b) {
  const dot  = a[0] * b[0] + a[1] * b[1];
  const magA = Math.sqrt(a[0] ** 2 + a[1] ** 2);
  const magB = Math.sqrt(b[0] ** 2 + b[1] ** 2);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export class StemLayerPair {
  constructor() {
    this._active  = new StemLayer();
    this._standby = new StemLayer();

    this._activeStemId  = null;
    this._standbyStemId = null;
    this._recentIds     = [];      // last 3 played stem IDs
    this._swapping      = false;
    this._targetVolume  = 0.0;    // current target (0.0–1.0) for active layer
    this._started       = false;
    this._lastSwapMs    = 0;

    // Callbacks
    this.onSwap = null; // called after each swap completes
  }

  // Load initial stem into active layer
  async loadInitial(url, stemId) {
    const buf = await stemLoader.load(url, stemId);
    if (!buf) return false;
    await this._active.load(buf);
    this._activeStemId = stemId;
    return this._active.isLoaded;
  }

  // Start active layer playback at given volume
  start(volume = 0.0) {
    if (!this._active.isLoaded) return;
    this._targetVolume = volume;
    this._active.start();
    this._active.setVolume(volume, 2000);
    this._started = true;
  }

  // Preload a stem into standby (non-blocking — call early, before swap)
  async preload(url, stemId) {
    if (!url || !stemId) return;
    if (stemId === this._standbyStemId) return; // already loaded
    const buf = await stemLoader.load(url, stemId);
    if (!buf) return;
    await this._standby.load(buf);
    this._standbyStemId = stemId;
  }

  // Execute crossfade from active → standby over durationS seconds
  // Returns true if swap happened, false if conditions not met
  async swap(durationS = 3.0) {
    if (this._swapping || !this._standby.isLoaded) return false;
    if (!this._started) return false;

    // 2-min hold after last swap
    const msSinceSwap = Date.now() - this._lastSwapMs;
    if (msSinceSwap < 2 * 60 * 1000) return false;

    this._swapping = true;
    const rampS = Math.max(2.0, durationS);

    // Standby: start silently, ramp up
    this._standby.start();
    this._standby.setVolume(0.001, 100);
    await new Promise(r => setTimeout(r, 50));
    this._standby.setVolume(this._targetVolume, rampS * 1000);

    // Active: ramp down
    this._active.setVolume(0.001, rampS * 1000);

    await new Promise(r => setTimeout(r, (rampS + 0.3) * 1000));

    // Swap references
    const oldActive  = this._active;
    this._active     = this._standby;
    this._standby    = oldActive;

    // Track recently played
    if (this._activeStemId) {
      this._recentIds.push(this._activeStemId);
      if (this._recentIds.length > 3) this._recentIds.shift();
    }
    this._activeStemId  = this._standbyStemId;
    this._standbyStemId = null;

    // Release old active (now standby)
    try { this._standby.stop(); } catch (_) {}
    try { this._standby.dispose(); } catch (_) {}
    this._standby = new StemLayer();

    this._lastSwapMs = Date.now();
    this._swapping   = false;

    if (this.onSwap) this.onSwap(this._activeStemId);
    return true;
  }

  // Select best stem from manifest pool based on ANS state
  // stems: array of { id, url, energy, valence } objects
  // ansState: 'parasympathetic' | 'transitioning' | 'sympathetic'
  // Returns { id, url } or null
  selectStem(stems, ansState = 'transitioning') {
    if (!stems?.length) return null;
    const target = ANS_TARGETS[ansState] ?? ANS_TARGETS.transitioning;

    // Exclude recently played
    const candidates = stems.filter(s => !this._recentIds.includes(s.id));
    const pool = candidates.length > 0 ? candidates : stems; // fallback if all recent

    // Score by cosine similarity
    const scored = pool.map(s => ({
      stem: s,
      score: cosineSimilarity(
        [s.energy ?? 0.5, s.valence ?? 0.5],
        target
      ),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Allow tie-break within 0.05 of top score
    const topScore = scored[0].score;
    const eligible = scored.filter(s => s.score >= topScore - 0.05);
    const winner   = eligible[Math.floor(Math.random() * eligible.length)];

    return winner ? { id: winner.stem.id, url: winner.stem.url } : null;
  }

  // Set volume on the active layer
  setVolume(vol, rampMs = 2000) {
    this._targetVolume = vol;
    this._active.setVolume(vol, rampMs);
  }

  get isLoaded() { return this._active.isLoaded; }

  get lastSwapMs() { return this._lastSwapMs; }

  stop() {
    try { this._active.stop();  } catch (_) {}
    try { this._standby.stop(); } catch (_) {}
    this._started = false;
  }

  dispose() {
    this.stop();
    try { this._active.dispose();  } catch (_) {}
    try { this._standby.dispose(); } catch (_) {}
    this._swapping = false;
  }
}
