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

export class SessionAudio {
    constructor(sessionType) {
        this.sessionType = sessionType;
        this.binaural = new BinauralGenerator();
        this.breath = new BreathActuator();
        this._currentPhase = null;
        this._rfBpm = 6;
        this._started = false;
    }

    async start(rfBpm = 6) {
        await Tone.start();
        this._rfBpm = rfBpm;
        this.binaural.start();
        this.breath.start(rfBpm);
        const firstPhase = Object.keys(SESSION_PARAMS[this.sessionType] || SESSION_PARAMS.find_your_calm)[0];
        this._applyPhase(firstPhase, false);
        this._started = true;
    }

    stop() {
        try { this.binaural.stop(); } catch(_) {}
        try { this.breath.stop(); } catch(_) {}
        this._started = false;
    }

    updateRF(rfBpm) {
        this._rfBpm = Math.max(4, Math.min(8.5, rfBpm));
        this.breath.setRF(this._rfBpm);
    }

    updateState(phase, polybioState, rmssdFalling) {
        if (!this._started) return;
        // INVARIANT: never intervene during MEDITATIVE state
        if (polybioState === 'MEDITATIVE') return;

        if (phase === this._currentPhase) return;
        const params = SESSION_PARAMS[this.sessionType]?.[phase];
        if (!params) return;

        this._applyPhase(phase, rmssdFalling);
    }

    _applyPhase(phase, rmssdFalling) {
        const params = SESSION_PARAMS[this.sessionType]?.[phase];
        if (!params) return;

        this._currentPhase = phase;
        // All changes via 2000ms ramp minimum — invariant enforced in sub-classes
        this.binaural.set(params.binaural, params.carrier, 2000);
        this.breath.setVolume(params.breathVol > 0 ? params.breathVol : 0.001, 2000);
    }
}
