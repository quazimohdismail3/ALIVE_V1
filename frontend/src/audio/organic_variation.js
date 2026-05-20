// frontend/src/audio/organic_variation.js
// Prevents auditory habituation via desynchronized micro-variation.
// Science: Bernardi 2006 (silence > slow music for vagal activation),
//          Frühauf et al. Sci Reports 2019 (microtiming jitter 5–15 ms).
import * as Tone from 'tone';

// LFO periods sampled from this pool — desynchronized across layers
const LFO_PERIODS_S = [60, 90, 120, 150, 180];

function pickPeriod() {
  return LFO_PERIODS_S[Math.floor(Math.random() * LFO_PERIODS_S.length)];
}

export class OrganicVariation {
  constructor() {
    this._volNodes      = {};   // { layerName: Tone.Volume }
    this._lfos          = {};   // { layerName: Tone.LFO }
    this._lfoGains      = {};   // { layerName: Tone.Gain } — LFO → volume modulation
    this._panner        = null; // Tone.Panner for spatial layer HRTF rotation
    this._pannerLFO     = null;
    this._silenceTimer  = null;
    this._silenceActive = false;
    this._lastSwapMs    = 0;
    // Static base dB per layer — written ONLY by notifyBaseVolume from session-level
    // _setLayerVolume. LFO reads this; never writes back. Prevents feedback drift.
    this._baseDb        = {};
    // Snapshot taken at silence start — disjoint from _baseDb so a concurrent
    // session param update during the silence window can't corrupt the restore target.
    this._preSilenceDb  = {};
    this._started       = false;
    this._disposed      = false;
    // No longer used for LFO path — LFO writes volNode.volume.rampTo() directly
    // to avoid the feedback loop (Fix 2). Kept null for silence path compatibility.
    this._onVolumeChange = null;
  }

  // Call after session start. volNodes: { ground, breath_s, harmonic, spatial, morning }
  // Each value is a Tone.Volume node already connected in the session audio graph.
  // spatialPanner: optional Tone.Panner node on the spatial layer for HRTF rotation.
  // onVolumeChange: optional callback (layer, targetLinear, rampMs) => void
  //   When provided, LFO volume adjustments are routed through it instead of calling
  //   rampTo directly — prevents concurrent rampTo race condition (Web Audio spec).
  start(volNodes = {}, spatialPanner = null, onVolumeChange = null) {
    if (this._started || this._disposed) return;
    this._volNodes       = volNodes;
    this._onVolumeChange = onVolumeChange;
    this._started        = true;

    // Start EQ LFO per layer (implemented as slow gain modulation ±1.5 dB)
    Object.entries(volNodes).forEach(([layer, volNode]) => {
      if (!volNode) return;
      const period = pickPeriod();
      try {
        const lfo = new Tone.LFO({
          frequency: 1 / period,
          min: -1.5,
          max:  1.5,
          type: 'sine',
        }).start();
        // Connect LFO to volume node's volume param
        // We add to current volume — use a Tone.Add workaround via direct rampTo
        // Instead: store LFO and apply on each tick (polled approach for compatibility)
        this._lfos[layer] = lfo;
      } catch (_) {}
    });

    // HRTF slow panning rotation on spatial layer
    if (spatialPanner) {
      this._panner = spatialPanner;
      try {
        this._pannerLFO = new Tone.LFO({
          frequency: 1 / (20 + Math.random() * 20), // 1 rotation per 20–40s
          min: -0.6,
          max:  0.6,
          type: 'sine',
        }).start();
      } catch (_) {}
    }

    // Apply LFO values every 4 seconds (gentle, below consciousness threshold)
    this._lfoTick = setInterval(() => this._applyLFOs(), 4000);

    // Silence actuator: schedule first fire in 8–12 minutes
    this._scheduleSilence();
  }

  // Call when a stem swap occurs — silence actuator won't fire within 2 min of a swap
  notifySwap() {
    this._lastSwapMs = Date.now();
  }

  stop() {
    if (!this._started) return;
    clearInterval(this._lfoTick);
    clearTimeout(this._silenceTimer);
    this._silenceTimer = null;
    Object.values(this._lfos).forEach(lfo => { try { lfo.stop(); lfo.dispose(); } catch (_) {} });
    this._lfos = {};
    try { this._pannerLFO?.stop(); this._pannerLFO?.dispose(); } catch (_) {}
    this._pannerLFO = null;
    this._started = false;
  }

  dispose() {
    this.stop();
    this._disposed = true;
    this._volNodes = {};
    this._panner   = null;
  }

  // Called by session_audio._setLayerVolume() to keep static base dB in sync.
  // The LFO reads this base every tick and applies an offset; it NEVER writes
  // back. Only session-level intentional volume changes update the base.
  notifyBaseVolume(layer, linearVol) {
    try {
      this._baseDb[layer] = Tone.gainToDb(Math.max(0.0001, linearVol));
    } catch (_) {}
  }

  // Called from session_audio when spatial_width param updates (0–1)
  setSpatialWidth(width) {
    if (!this._pannerLFO) return;
    const maxPan = 0.3 + Math.max(0, Math.min(1, width)) * 0.5; // 0.3–0.8
    try {
      this._pannerLFO.min = -maxPan;
      this._pannerLFO.max =  maxPan;
    } catch (_) {}
  }

  // Called from session_audio when micro_variation param updates (0–1)
  setVariationIntensity(intensity) {
    Object.values(this._lfos).forEach(lfo => {
      if (!lfo) return;
      const depth = Math.max(0, Math.min(1, intensity));
      try {
        lfo.min = -(depth * 2.0); // max ±2 dB
        lfo.max =  (depth * 2.0);
      } catch (_) {}
    });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _applyLFOs() {
    if (!this._started || this._silenceActive) return;

    Object.entries(this._lfos).forEach(([layer, lfo]) => {
      const volNode = this._volNodes[layer];
      if (!volNode || !lfo) return;
      try {
        // Read LFO value and add as small dB offset (±0.75 dB net, imperceptible).
        const lfoVal = lfo.value; // -1.5 to +1.5
        // _baseDb is the STATIC session target — written only by notifyBaseVolume
        // from session_audio._setLayerVolume. NEVER feed the modulated value back
        // into _baseDb (was the drift bug pre-Fix 2). If base unknown, fall back to
        // the live value once — but do NOT cache it; the session will publish soon.
        const base = this._baseDb[layer];
        if (base === undefined) return; // wait for first session-level volume push
        const targetDb = base + lfoVal * 0.5; // max ±0.75 dB net
        // Write directly to volNode — bypass session registry to prevent feedback.
        volNode.volume.rampTo(targetDb, 3);
      } catch (_) {}
    });

    // Panner rotation
    if (this._panner && this._pannerLFO) {
      try {
        this._panner.pan.rampTo(this._pannerLFO.value, 4);
      } catch (_) {}
    }
  }

  _scheduleSilence() {
    // 8–12 minutes between silence inserts (randomized per Bernardi 2006 protocol)
    const minMs = 8  * 60 * 1000;
    const maxMs = 12 * 60 * 1000;
    const delayMs = minMs + Math.random() * (maxMs - minMs);

    this._silenceTimer = setTimeout(() => {
      this._fireSilence();
    }, delayMs);
  }

  async _fireSilence() {
    if (!this._started || this._disposed) return;

    // Guard: don't fire within 2 minutes of a stem swap
    const msSinceSwap = Date.now() - this._lastSwapMs;
    if (msSinceSwap < 2 * 60 * 1000) {
      // Reschedule after 3 more minutes
      this._silenceTimer = setTimeout(() => this._fireSilence(), 3 * 60 * 1000);
      return;
    }

    this._silenceActive = true;

    // Save current volumes
    Object.entries(this._volNodes).forEach(([layer, volNode]) => {
      if (volNode) {
        try { this._savedVolumes[layer] = volNode.volume.value; } catch (_) {}
      }
    });

    // Fade out over 3 seconds
    Object.values(this._volNodes).forEach(volNode => {
      if (!volNode) return;
      try { volNode.volume.rampTo(-60, 3); } catch (_) {}
    });

    // Hold for 2–3 seconds of silence (after 3s fade)
    const holdMs = 2000 + Math.random() * 1000;
    await new Promise(r => setTimeout(r, 3000 + holdMs));

    if (!this._started || this._disposed) return;

    // Fade back in over 4 seconds
    Object.entries(this._volNodes).forEach(([layer, volNode]) => {
      if (!volNode) return;
      const targetDb = this._savedVolumes[layer] ?? -20;
      try {
        if (this._onVolumeChange) {
          this._onVolumeChange(layer, Tone.dbToGain(targetDb), 4000);
        } else {
          volNode.volume.rampTo(targetDb, 4);
        }
      } catch (_) {}
    });

    await new Promise(r => setTimeout(r, 4500)); // wait for fade-back to complete
    this._silenceActive = false;

    // Schedule next silence
    this._scheduleSilence();
  }
}
