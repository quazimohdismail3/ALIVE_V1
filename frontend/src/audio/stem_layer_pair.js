// frontend/src/audio/stem_layer_pair.js
// A/B crossfade pair for seamless stem rotation.
// Science: HRV response latency 2–4 min → 2-min hold between swaps.
//          3-second crossfade = sweet spot for ambient stems.
//
// Architecture:
//   - Pair owns a single session-level bus (_busVol → destination). LFO + session
//     volume control target the bus.
//   - Two inner StemLayers (_active, _standby) route into the bus. They handle
//     crossfade only (drop active to 0, raise standby to 1).
//   - Pair is API-compatible with StemLayer (start/setVolume/isLoaded/volNode/dispose)
//     so session_audio can use it as a drop-in replacement.
import * as Tone               from 'tone';
import { StemLayer  }          from './stem_layer.js';
import { stemLoader }          from './stem_loader.js';

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
    // Bus = session-level fader. Starts silent so caller controls fade-in.
    this._busVol  = new Tone.Volume(-60).toDestination();

    // Inner stems route into the bus, not directly to destination.
    this._active  = new StemLayer(this._busVol);
    this._standby = new StemLayer(this._busVol);

    this._activeStemId  = null;
    this._standbyStemId = null;
    this._recentIds     = [];      // last 3 played stem IDs
    this._swapping      = false;
    this._started       = false;
    this._lastSwapMs    = 0;
    this._pool          = [];      // [{id, url, energy, valence}] — set by setPool()

    // Callbacks
    this.onSwap = null; // called after each swap completes (stemId)
  }

  // Drop-in API compat with StemLayer ─────────────────────────────────────────

  get isLoaded() { return this._active.isLoaded; }
  get volNode()  { return this._busVol; }
  get lastSwapMs() { return this._lastSwapMs; }
  get activeStemId() { return this._activeStemId; }

  // Set the pool of swappable stems for this layer.
  // Pool items: { id, url, energy, valence }
  setPool(pool) {
    this._pool = Array.isArray(pool) ? pool.filter(s => s?.id && s?.url) : [];
  }

  // Load initial stem into active layer. Compatible with StemLayer.load(buf):
  // accepts an AudioBuffer OR { url, stemId } for explicit pool loading.
  async load(audioBufferOrSpec, stemIdOpt) {
    if (audioBufferOrSpec && typeof audioBufferOrSpec === 'object' && audioBufferOrSpec.url) {
      const { url, id } = audioBufferOrSpec;
      const buf = await stemLoader.load(url, id);
      if (!buf) return;
      await this._active.load(buf);
      if (this._active.isLoaded) this._activeStemId = id;
      return;
    }
    // AudioBuffer path (matches StemLayer.load) — caller must pass id separately
    await this._active.load(audioBufferOrSpec);
    if (this._active.isLoaded && stemIdOpt) this._activeStemId = stemIdOpt;
  }

  // Start active stem at unity; ramp bus from -60dB to 0dB so audio is audible
  // even before _applyStemPhaseVolumes fires (defensive — if phase config or
  // _currentPhase is missing, bus would otherwise stay at -60dB forever).
  // Subsequent pair.setVolume() calls override this default.
  start() {
    if (!this._active.isLoaded) return;
    this._active.setVolume(1.0, 200);
    this._active.start();
    // Ramp bus from -60dB → 0dB over 3s so stems become audible.
    try { this._busVol.volume.rampTo(0, 3); } catch (_) {}
    this._started = true;
  }

  stop() {
    try { this._active.stop();  } catch (_) {}
    try { this._standby.stop(); } catch (_) {}
    this._started = false;
  }

  // Bus volume = session-level loudness. Compatible with StemLayer.setVolume.
  setVolume(vol, rampMs = 2000) {
    const db = vol <= 0.001 ? -60 : Tone.gainToDb(Math.max(0.001, vol));
    try { this._busVol.volume.rampTo(db, Math.max(rampMs, 2000) / 1000); } catch (_) {}
  }

  dispose() {
    this.stop();
    try { this._active.dispose();  } catch (_) {}
    try { this._standby.dispose(); } catch (_) {}
    try { this._busVol.dispose();  } catch (_) {}
    this._swapping = false;
  }

  // Rotation API ─────────────────────────────────────────────────────────────

  // Attempt to rotate to a new stem based on ANS state.
  // Returns true if swap fires. Skipped if pool < 2, swapping in flight, or hold guard.
  async rotate(ansState = 'transitioning', durationS = 3.0) {
    if (this._swapping || !this._started) return false;
    // 2-min hold after last swap (HRV response latency, 2–4 min)
    const msSinceSwap = Date.now() - this._lastSwapMs;
    if (this._lastSwapMs > 0 && msSinceSwap < 2 * 60 * 1000) return false;
    if (!this._pool || this._pool.length < 2) return false; // no alternates

    const pick = this._selectStem(ansState);
    if (!pick || pick.id === this._activeStemId) return false;

    // Preload into standby
    const buf = await stemLoader.load(pick.url, pick.id);
    if (!buf) return false;
    await this._standby.load(buf);
    if (!this._standby.isLoaded) return false;
    this._standbyStemId = pick.id;

    return await this._executeSwap(durationS);
  }

  // Internal stem selection — cosine similarity to ANS target, exclude recent.
  _selectStem(ansState = 'transitioning') {
    if (!this._pool?.length) return null;
    const target = ANS_TARGETS[ansState] ?? ANS_TARGETS.transitioning;

    const candidates = this._pool.filter(s => !this._recentIds.includes(s.id) && s.id !== this._activeStemId);
    const pool = candidates.length > 0 ? candidates : this._pool.filter(s => s.id !== this._activeStemId);
    if (pool.length === 0) return null;

    const scored = pool.map(s => ({
      stem: s,
      score: cosineSimilarity([s.energy ?? 0.5, s.valence ?? 0.5], target),
    }));
    scored.sort((a, b) => b.score - a.score);

    const topScore = scored[0].score;
    const eligible = scored.filter(s => s.score >= topScore - 0.05);
    const winner   = eligible[Math.floor(Math.random() * eligible.length)];
    return winner ? winner.stem : null;
  }

  async _executeSwap(durationS = 3.0) {
    if (this._swapping) return false;
    this._swapping = true;
    const rampS = Math.max(2.0, durationS);

    // Standby starts at 0 and rides up; active rides down. Bus stays untouched.
    this._standby.setVolume(0.001, 100);
    await new Promise(r => setTimeout(r, 50));
    this._standby.start();
    this._standby.setVolume(1.0, rampS * 1000);
    this._active.setVolume(0.001, rampS * 1000);

    await new Promise(r => setTimeout(r, (rampS + 0.3) * 1000));

    // Swap references
    if (this._activeStemId) {
      this._recentIds.push(this._activeStemId);
      if (this._recentIds.length > 3) this._recentIds.shift();
    }
    const oldActive  = this._active;
    this._active     = this._standby;
    this._activeStemId  = this._standbyStemId;
    this._standbyStemId = null;

    // Release old active (rebuild a fresh standby slot)
    try { oldActive.stop();    } catch (_) {}
    try { oldActive.dispose(); } catch (_) {}
    this._standby = new StemLayer(this._busVol);

    this._lastSwapMs = Date.now();
    this._swapping   = false;

    if (this.onSwap) {
      try { this.onSwap(this._activeStemId); } catch (_) {}
    }
    return true;
  }
}
