// Mission Alive — Tone.js audio engine (Strategy A).
//
// 7 components, all param changes ramp over 2000ms. Zero clicks, ever.
//
// CRITICAL rules (never regress):
//   - Binaural: LEFT = lower freq, RIGHT = higher (left + offset)
//   - Dorian scale ratio 1.414 (tritone) excluded
//   - Low RMSSD → SLOWER tempo (spec — not the opposite)
//
// Components:
//   1. SOMA carrier   — sub-audible grounding tone, hard-left, gain 0.08
//   2. Binaural beats — L/R split, gain 0.12
//   3. Melodic voice  — triangle synth + reverb + filter, scale-walks
//   4. Harmonic pad   — PolySynth sine chords
//   5. Rhythmic pulse — MembraneSynth + Sequence (Energy/ADHD only)
//   6. Vocal texture  — FM synth (Anxious Sympathetic / Recovery only)
//   7. Master chain   — Compressor → Reverb → Volume(-10dB)

import * as Tone from 'tone'

const RAMP = 2.0 // seconds — 2000ms everywhere

// Safe scale intervals. Dorian-ish minor scale. Tritone (ratio ≈ 1.414) excluded.
const SCALE_RATIOS = [1, 9/8, 6/5, 4/3, 3/2, 5/3, 9/5, 2]

export class ToneEngine {
  constructor() {
    this.started = false
    this.session = 'calm'
    this.ansState = 'ventral_vagal'
    this.params = null
    this._melodyTimer = null
  }

  async start() {
    if (this.started) return
    await Tone.start()

    // --- Master chain (built first)
    this.masterVolume = new Tone.Volume(-10).toDestination()
    this.masterReverb = new Tone.Reverb({ decay: 6, wet: 0.35 }).connect(this.masterVolume)
    this.masterComp = new Tone.Compressor(-18, 3).connect(this.masterReverb)
    await this.masterReverb.generate()

    // --- 1. SOMA carrier (hard left, very quiet — grounding substrate)
    this.somaPan = new Tone.Panner(-1).connect(this.masterComp)
    this.somaGain = new Tone.Gain(0.08).connect(this.somaPan)
    this.somaOsc = new Tone.Oscillator({ frequency: 52, type: 'sine' }).connect(this.somaGain)

    // --- 2. Binaural beats (hard L/R split). LEFT = lower freq.
    this.binLPan = new Tone.Panner(-1).connect(this.masterComp)
    this.binRPan = new Tone.Panner(1).connect(this.masterComp)
    this.binLGain = new Tone.Gain(0.12).connect(this.binLPan)
    this.binRGain = new Tone.Gain(0.12).connect(this.binRPan)
    this.binLOsc = new Tone.Oscillator({ frequency: 220, type: 'sine' }).connect(this.binLGain)
    this.binROsc = new Tone.Oscillator({ frequency: 230, type: 'sine' }).connect(this.binRGain)

    // --- 3. Melodic voice
    this.melodyFilter = new Tone.Filter({ frequency: 2000, type: 'lowpass' }).connect(this.masterComp)
    this.melodyReverb = new Tone.Reverb({ decay: 5, wet: 0.55 }).connect(this.melodyFilter)
    await this.melodyReverb.generate()
    this.melodySynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.2, decay: 0.3, sustain: 0.4, release: 1.2 },
      volume: -8,
    }).connect(this.melodyReverb)

    // --- 4. Harmonic pad
    this.padReverb = new Tone.Reverb({ decay: 8, wet: 0.8 }).connect(this.masterComp)
    await this.padReverb.generate()
    this.padGain = new Tone.Gain(0.15).connect(this.padReverb)
    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 2.5, decay: 1.5, sustain: 0.9, release: 5 },
      volume: -12,
    }).connect(this.padGain)

    // --- 5. Rhythmic pulse (only for energy / adhd_flow — gain 0 otherwise)
    this.pulseGain = new Tone.Gain(0).connect(this.masterComp)
    this.pulseKick = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 4,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.0 },
    }).connect(this.pulseGain)

    // --- 6. Vocal texture (FM — anxious sympathetic / recovery only)
    this.vocalGain = new Tone.Gain(0).connect(this.masterComp)
    this.vocalLFO = new Tone.LFO(0.15, -5, 5).start()
    this.vocalSynth = new Tone.FMSynth({
      harmonicity: 1.5,
      modulationIndex: 2.5,
      envelope: { attack: 1.5, decay: 0.5, sustain: 0.8, release: 3 },
      volume: -14,
    }).connect(this.vocalGain)
    this.vocalLFO.connect(this.vocalSynth.detune)

    // Start oscillators
    this.somaOsc.start()
    this.binLOsc.start()
    this.binROsc.start()

    this.started = true
  }

  setSession(session) {
    this.session = session
    this._updateComponentGains()
  }

  setAnsState(ansState) { this.ansState = ansState }

  apply(params) {
    if (!this.started) return
    this.params = params
    const now = Tone.now()

    // 1. SOMA carrier
    this.somaOsc.frequency.rampTo(params.soma_carrier_hz || 52, RAMP)

    // 2. Binaural — LEFT = lower freq, RIGHT = LEFT + offset
    const base = 220
    const beat = Math.max(0, params.binaural_beat_hz || 0)
    this.binLOsc.frequency.rampTo(base, RAMP)
    this.binROsc.frequency.rampTo(base + beat, RAMP)

    // 3. Melodic voice — filter cutoff from brightness, reverb wet from spatial_width
    const cutoff = 200 + (params.brightness || 0.3) * 8000
    this.melodyFilter.frequency.rampTo(cutoff, RAMP)
    this.melodyReverb.wet.rampTo(0.4 + (params.spatial_width || 0.5) * 0.5, RAMP)

    // 4. Harmonic pad — chord by key_mode
    // key_mode: 0=minor, 1=major, 2=lydian/suspend
    // Only retrigger if it changed
    if (this._lastKeyMode !== params.key_mode) {
      this._lastKeyMode = params.key_mode
      const root = 'C3'
      const chords = {
        0: ['C3', 'Eb3', 'G3'],
        1: ['C3', 'E3', 'G3', 'B3'],
        2: ['C3', 'G3', 'D4'],
      }
      const chord = chords[params.key_mode] || chords[1]
      this.padSynth.releaseAll()
      this.padSynth.triggerAttack(chord, now + 0.05)
    }
    this.padGain.gain.rampTo(0.15 * (1 - (params.silence_ratio || 0.3) * 0.5), RAMP)

    // 5. Rhythmic pulse — BPM + only active for energy/adhd_flow
    Tone.Transport.bpm.rampTo(params.bpm || 60, RAMP)
    this._updateComponentGains()

    // 6. Vocal texture — handled in _updateComponentGains

    // Melody scheduling (once started)
    if (!this._melodyTimer) this._startMelody()
  }

  _updateComponentGains() {
    if (!this.started) return
    const p = this.params || {}

    // Rhythmic pulse only for mobilization sessions
    const pulseOn = this.session === 'energy' || this.session === 'adhd_flow'
    this.pulseGain.gain.rampTo(pulseOn ? 0.25 : 0.0, RAMP)
    if (pulseOn && !this._pulseLoop) {
      this._pulseLoop = new Tone.Loop((time) => {
        this.pulseKick.triggerAttackRelease('C2', '8n', time)
      }, '4n').start(0)
      Tone.Transport.start()
    } else if (!pulseOn && this._pulseLoop) {
      this._pulseLoop.stop(); this._pulseLoop.dispose(); this._pulseLoop = null
    }

    // Vocal texture: anxious sympathetic OR recovery session
    const vocalOn =
      this.ansState === 'anxious_sympathetic' || this.session === 'recovery'
    const vocalGain = vocalOn ? 0.1 * (p.voice_range_presence ?? 0.3) : 0.0
    this.vocalGain.gain.rampTo(vocalGain, RAMP)
  }

  _startMelody() {
    const scheduleNext = () => {
      if (!this.started) return
      const p = this.params || {}
      const silenceRatio = p.silence_ratio ?? 0.3
      if (Math.random() > silenceRatio) {
        // Pick next note by session direction
        const dir = this._melodyDirection()
        this._melodyStep = ((this._melodyStep ?? 0) + dir + SCALE_RATIOS.length) % SCALE_RATIOS.length
        const ratio = SCALE_RATIOS[this._melodyStep]
        const freq = 220 * ratio
        const jitter = (p.micro_variation || 0.1) * 30 * (Math.random() - 0.5)
        this.melodySynth.triggerAttackRelease(freq, '2n', `+${0.02 + jitter / 1000}`)
      }
      const interval = 60 / Math.max(30, (p.bpm || 60) / 2) // ~half-time
      this._melodyTimer = setTimeout(scheduleNext, interval * 1000)
    }
    scheduleNext()
  }

  _melodyDirection() {
    // Descend for anxious/recovery; ascend for energy peak; else random walk.
    if (this.ansState === 'anxious_sympathetic' || this.session === 'recovery') return -1
    if (this.session === 'energy') return 1
    return Math.random() > 0.5 ? 1 : -1
  }

  async stop() {
    if (!this.started) return
    if (this._melodyTimer) { clearTimeout(this._melodyTimer); this._melodyTimer = null }
    if (this._pulseLoop) { this._pulseLoop.stop(); this._pulseLoop.dispose(); this._pulseLoop = null }
    try {
      Tone.Transport.stop()
      this.padSynth.releaseAll()
      this.somaOsc.stop('+0.1')
      this.binLOsc.stop('+0.1')
      this.binROsc.stop('+0.1')
    } catch {}
    this.started = false
  }
}
