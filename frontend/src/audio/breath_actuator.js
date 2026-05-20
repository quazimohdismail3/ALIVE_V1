// frontend/src/audio/breath_actuator.js
// Breath guide tone at personal RF. Sine wave with slow attack/release.
import * as Tone from 'tone';

export class BreathActuator {
    constructor() {
        this._synth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 1.8, decay: 0, sustain: 1, release: 1.8 },
        }).toDestination();
        this._synth.volume.value = -60;
        this._rfBpm = 6;
        this._ieFraction = 0.4; // inhale fraction of cycle; 0.4 = 40/60 I:E default
        this._running = false;
        this._timeout = null;
    }

    start(rfBpm) {
        this._rfBpm = Math.max(4, Math.min(8.5, rfBpm));
        this._running = true;
        this._cycle();
    }

    stop() {
        this._running = false;
        if (this._timeout) clearTimeout(this._timeout);
        try { this._synth.triggerRelease(); } catch(_) {}
    }

    setRF(rfBpm) {
        this._rfBpm = Math.max(4, Math.min(8.5, rfBpm));
    }

    // breath_sync_ratio 0..1: 0.5 = default 40/60, 0.9 = more exhale-dominant (parasympathetic)
    setIERatio(breathSyncRatio) {
        this._ieFraction = Math.max(0.25, Math.min(0.5, 0.4 - (breathSyncRatio - 0.5) * 0.15));
    }

    setVolume(vol, rampMs = 2000) {
        const db = vol <= 0.001 ? -60 : Tone.gainToDb(vol);
        this._synth.volume.rampTo(db, Math.max(rampMs, 2000) / 1000);
    }

    _cycle() {
        if (!this._running) return;
        const periodMs  = (60 / this._rfBpm) * 1000;
        const inhaleMs  = periodMs * this._ieFraction;
        const exhaleMs  = periodMs * (1 - this._ieFraction);
        try { this._synth.triggerAttack(174); } catch(_) {}
        this._timeout = setTimeout(() => {
            try { this._synth.triggerRelease(); } catch(_) {}
            this._timeout = setTimeout(() => this._cycle(), exhaleMs);
        }, inhaleMs);
    }
}
