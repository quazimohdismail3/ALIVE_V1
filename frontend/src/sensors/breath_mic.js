// frontend/src/sensors/breath_mic.js
// WebAudio FFT → dominant 0.1–0.5Hz band → breath rate (6–30 bpm)
export class BreathMicSensor {
    constructor() {
        this.latest = null;
        this.running = false;
        this._intervalId = null;
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
            this._update();
        } catch (err) {
            console.warn('BreathMic start failed (non-fatal):', err);
        }
    }

    stop() {
        this.running = false;
        if (this._intervalId) clearInterval(this._intervalId);
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
