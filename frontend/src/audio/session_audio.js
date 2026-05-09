// frontend/src/audio/session_audio.js
// Per-session ISO arc audio controller. Enforces all 12 audio invariants from Section 13.
import * as Tone from 'tone';
import { BinauralGenerator } from './binaural.js';
import { BreathActuator } from './breath_actuator.js';

// INVARIANT: all param changes use 2000ms ramp minimum (enforced in BinauralGenerator/BreathActuator)

const SESSION_PARAMS = {
    find_your_calm: {
        ACKNOWLEDGE: { binaural: 12, carrier: 174, breathVol: 0.0 },
        SLOW:        { binaural: 10, carrier: 174, breathVol: 0.2 },
        ANCHOR:      { binaural: 7.5, carrier: 256, breathVol: 0.4 },
        RELEASE:     { binaural: 6,  carrier: 256, breathVol: 0.2 },
    },
    wind_down: {
        MEET:       { binaural: 10, carrier: 174, breathVol: 0.1 },
        DECELERATE: { binaural: 6,  carrier: 174, breathVol: 0.1 },
        DEEPEN:     { binaural: 4,  carrier: 128, breathVol: 0.1 },
        DISSOLVE:   { binaural: 2,  carrier: 128, breathVol: 0.0 },
        MONITOR:    { binaural: 1.5, carrier: 128, breathVol: 0.0 },
    },
    morning_emergence: {
        ORIENT:   { binaural: 6,  carrier: 256, breathVol: 0.0 },
        ACTIVATE: { binaural: 10, carrier: 396, breathVol: 0.2 },
        ENERGIZE: { binaural: 12, carrier: 432, breathVol: 0.3 },
        PRIME:    { binaural: 12, carrier: 432, breathVol: 0.3 },
    },
};

// Scale intervals (semitones from root): 0=minor, 1=major, 2=lydian
const SCALE_INTERVALS = [
    [0, 3, 7, 10],  // minor 7th
    [0, 4, 7, 11],  // major 7th
    [0, 4, 8, 11],  // lydian maj7
];

function carrierToMidi(hz) {
    // One octave up from carrier to keep pad in comfortable mid range
    return Math.round(12 * Math.log2(hz / 440) + 69) + 12;
}

export class SessionAudio {
    constructor(sessionType) {
        this.sessionType = sessionType;
        this.binaural = new BinauralGenerator();
        this.breath = new BreathActuator();
        this._pad = null;
        this._reverb = null;
        this._currentPhase = null;
        this._rfBpm = 6;
        this._started = false;
        this._lastParams = null;
    }

    async start(rfBpm = 6) {
        await Tone.start();
        this._rfBpm = rfBpm;
        this.binaural.start();
        this.breath.start(rfBpm);

        // Pad synth: warm triangle-wave chords with long reverb tail
        try {
            this._reverb = new Tone.Reverb({ decay: 7, wet: 0.6 });
            await this._reverb.generate();
            this._pad = new Tone.PolySynth(Tone.Synth, {
                oscillator: { type: 'triangle' },
                envelope: { attack: 3.5, decay: 1.5, sustain: 0.7, release: 6.0 },
            });
            this._pad.connect(this._reverb);
            this._reverb.toDestination();
            this._pad.volume.value = -24;
        } catch (_) {
            this._pad = null;
        }

        const firstPhase = Object.keys(SESSION_PARAMS[this.sessionType] || SESSION_PARAMS.find_your_calm)[0];
        this._applyPhase(firstPhase, false);
        this._started = true;
    }

    stop() {
        try { this.binaural.stop(); } catch(_) {}
        try { this.breath.stop(); } catch(_) {}
        try {
            this._pad?.releaseAll('+1');
        } catch(_) {}
        this._started = false;
    }

    updateRF(rfBpm) {
        this._rfBpm = Math.max(4, Math.min(8.5, rfBpm));
        this.breath.setRF(this._rfBpm);
    }

    // Called every 1Hz session_frame — wires backend music_params live
    updateMusicParams(params) {
        if (!this._started || !params) return;
        this._lastParams = params;

        // Override binaural with ANS-personalised values from backend
        const beatHz = params.binaural_beat_hz ?? null;
        const carrierHz = params.soma_carrier_hz ?? null;
        if (beatHz !== null && carrierHz !== null) {
            this.binaural.set(beatHz, carrierHz, 2000);
        }

        // Pad presence: voice_range_presence drives volume (0→-30dB, 1→-18dB)
        if (this._pad) {
            const presence = Math.max(0, Math.min(1, params.voice_range_presence ?? 0.4));
            const db = -30 + presence * 12;
            this._pad.volume.rampTo(db, 2);
        }
    }

    updateState(phase, polybioState, rmssdFalling) {
        if (!this._started) return;
        // INVARIANT: never intervene during MEDITATIVE state
        if (polybioState === 'MEDITATIVE') return;

        if (phase === this._currentPhase) return;
        const params = SESSION_PARAMS[this.sessionType]?.[phase];
        if (!params) return;

        this._applyPhase(phase, rmssdFalling);
        // Play new harmonic chord when session phase transitions
        this._playPadChord();
    }

    _applyPhase(phase, rmssdFalling) {
        const params = SESSION_PARAMS[this.sessionType]?.[phase];
        if (!params) return;

        this._currentPhase = phase;
        // All changes via 2000ms ramp minimum — invariant enforced in sub-classes
        this.binaural.set(params.binaural, params.carrier, 2000);
        this.breath.setVolume(params.breathVol > 0 ? params.breathVol : 0.001, 2000);
    }

    _playPadChord() {
        if (!this._pad || !this._started) return;
        try {
            const mp = this._lastParams;
            const keyMode = Math.min(2, Math.max(0, Math.round(mp?.key_mode ?? 1)));
            const carrier = mp?.soma_carrier_hz ?? 256;
            const tension = mp?.harmonic_tension ?? 0.3;

            const rootMidi = carrierToMidi(carrier);
            const intervals = SCALE_INTERVALS[keyMode];
            // Low tension: triad (3 notes); high tension: 7th chord (4 notes)
            const notes = intervals.slice(0, tension > 0.55 ? 4 : 3).map(i =>
                Tone.Frequency(rootMidi + i, 'midi').toNote()
            );

            // Release current chord, stagger new notes for natural feel
            this._pad.releaseAll('+0.5');
            notes.forEach((n, i) => {
                this._pad.triggerAttack(n, `+${0.7 + i * 0.12}`);
            });
        } catch (_) {}
    }
}
