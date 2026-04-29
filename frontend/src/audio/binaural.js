// frontend/src/audio/binaural.js
// INVARIANT: left oscillator frequency ALWAYS lower than right. No exceptions.
import * as Tone from 'tone';

export class BinauralGenerator {
    constructor() {
        // Panner nodes to separate L and R channels
        this._leftPan = new Tone.Panner(-1).toDestination();
        this._rightPan = new Tone.Panner(1).toDestination();
        this._leftOsc = new Tone.Oscillator({ type: 'sine' }).connect(this._leftPan);
        this._rightOsc = new Tone.Oscillator({ type: 'sine' }).connect(this._rightPan);
        this._carrier = 200;
        this._beat = 7.5;
        this._vol = new Tone.Volume(-12).toDestination();
    }

    start() {
        this._leftOsc.start();
        this._rightOsc.start();
        this._apply(0);
    }

    stop() {
        try { this._leftOsc.stop(); this._rightOsc.stop(); } catch(_) {}
    }

    // 2000ms minimum ramp — invariant from Section 13
    set(beatHz, carrierHz = 200, rampMs = 2000) {
        if (beatHz <= 0) { this.setVolume(0, rampMs); return; }
        const rampS = Math.max(rampMs, 2000) / 1000;
        // INVARIANT: left < right ALWAYS
        const leftFreq = carrierHz;
        const rightFreq = carrierHz + Math.abs(beatHz);  // abs ensures right > left
        this._leftOsc.frequency.rampTo(leftFreq, rampS);
        this._rightOsc.frequency.rampTo(rightFreq, rampS);
        this._carrier = carrierHz;
        this._beat = beatHz;
    }

    _apply(rampMs) {
        this.set(this._beat, this._carrier, rampMs);
    }

    setVolume(vol, rampMs = 2000) {
        const db = vol <= 0 ? -60 : Tone.gainToDb(Math.max(0.001, vol));
        this._leftOsc.volume.rampTo(db, Math.max(rampMs, 2000) / 1000);
        this._rightOsc.volume.rampTo(db, Math.max(rampMs, 2000) / 1000);
    }
}
