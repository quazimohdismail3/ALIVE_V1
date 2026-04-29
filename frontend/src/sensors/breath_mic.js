// frontend/src/sensors/breath_mic.js
// WebAudio FFT → dominant 0.1–0.5Hz band → breath rate (6–30 bpm)
// Also exposes raw band-amplitude samples for backend RF coherence.
export class BreathMicSensor {
    constructor() {
        this.latest = null;
        this.running = false;
        this._intervalId = null;
        this._sampleId = null;
        this._respAmpBuffer = [];   // recent band-power samples (~4 Hz)
    }

    async start() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const src = ctx.createMediaStreamSource(stream);
            this.analyser = ctx.createAnalyser();
            this.analyser.fftSize = 8192;
            src.connect(this.analyser);
            this.running = true;
            this._intervalId = setInterval(() => this._update(), 5000);
            this._sampleId = setInterval(() => this._sampleBandAmp(), 250); // ~4 Hz
            this._update();
        } catch (err) {
            console.warn('BreathMic start failed (non-fatal):', err);
        }
    }

    stop() {
        this.running = false;
        if (this._intervalId) clearInterval(this._intervalId);
        if (this._sampleId) clearInterval(this._sampleId);
    }

    _sampleBandAmp() {
        if (!this.running || !this.analyser) return;
        const buf = new Float32Array(this.analyser.frequencyBinCount);
        this.analyser.getFloatFrequencyData(buf);
        const sr = this.analyser.context.sampleRate;
        const binHz = sr / this.analyser.fftSize;
        const loIdx = Math.max(0, Math.floor(0.1 / binHz));
        const hiIdx = Math.min(buf.length - 1, Math.ceil(0.5 / binHz));
        let sumLin = 0;
        let n = 0;
        for (let i = loIdx; i <= hiIdx; i++) {
            // dB → linear power
            sumLin += Math.pow(10, buf[i] / 10);
            n++;
        }
        const meanLin = n > 0 ? sumLin / n : 0;
        // Use sqrt(power) → amplitude. Stable, non-negative.
        const amp = Math.sqrt(Math.max(0, meanLin));
        this._respAmpBuffer.push(amp);
        if (this._respAmpBuffer.length > 240) this._respAmpBuffer.shift();
    }

    /** Returns the most recent respiration band amplitude sample, or 0 if none. */
    getRespAmplitudeSample() {
        return this._respAmpBuffer.length > 0
            ? this._respAmpBuffer[this._respAmpBuffer.length - 1]
            : 0;
    }

    _update() {
        if (!this.running || !this.analyser) return;
        const buf = new Float32Array(this.analyser.frequencyBinCount);
        this.analyser.getFloatFrequencyData(buf);
        const sr = this.analyser.context.sampleRate;
        const binHz = sr / (this.analyser.fftSize);
        const loIdx = Math.max(0, Math.floor(0.1 / binHz));
        const hiIdx = Math.min(buf.length - 1, Math.ceil(0.5 / binHz));
        let peak = -Infinity, peakIdx = loIdx;
        for (let i = loIdx; i <= hiIdx; i++) {
            if (buf[i] > peak) { peak = buf[i]; peakIdx = i; }
        }
        const breath_rate_bpm = Math.max(6, Math.min(30, peakIdx * binHz * 60));
        this.latest = {
            breath_rate_bpm,
            regularity: peak > -60 ? 0.7 : 0.3,
            rf_compliance: 0.5, // filled by audio engine when RF is known
            confidence: peak > -50 ? 0.75 : 0.3
        };
    }

    getLatestReading() {
        return this.latest || { breath_rate_bpm: 12, rf_compliance: 0.5, confidence: 0 };
    }
}
