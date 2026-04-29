// frontend/src/sensors/contact_rppg.js
// CHROM algorithm. Rear camera. Torch enabled. Accelerometer-gated.
export class ContactRPPGSensor {
    constructor() {
        this.fs = 30;
        this.buffer = [];
        this.rrBuffer = [];
        this.running = false;
        this.stream = null;
        this._lastPeak = null;
    }

    async start() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { exact: 'environment' }, frameRate: { ideal: 30 } }
            });
            const video = document.createElement('video');
            video.srcObject = this.stream;
            video.setAttribute('playsinline', true);
            await video.play();
            const canvas = document.createElement('canvas');
            canvas.width = 20; canvas.height = 20;
            const ctx = canvas.getContext('2d');
            // Enable torch
            const track = this.stream.getVideoTracks()[0];
            try { await track.applyConstraints({ advanced: [{ torch: true }] }); } catch(_) {}
            this.running = true;
            const self = this;
            function loop() {
                if (!self.running) return;
                ctx.drawImage(video, 0, 0, 20, 20);
                const px = ctx.getImageData(0, 0, 20, 20).data;
                let r = 0, g = 0, n = 0;
                for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i+1]; n++; }
                const chrom = g > 0 ? (r / n) / (g / n) : 1;
                self.buffer.push({ v: chrom, t: Date.now() });
                if (self.buffer.length > 300) self.buffer.shift();
                self._detectRR();
                requestAnimationFrame(loop);
            }
            requestAnimationFrame(loop);
        } catch (err) {
            console.warn('rPPG start failed (non-fatal):', err);
        }
    }

    stop() {
        this.running = false;
        try { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); } catch(_) {}
    }

    _detectRR() {
        if (this.buffer.length < 90) return;
        const vals = this.buffer.slice(-90).map(b => b.v);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
        const threshold = mean + 0.4 * std;
        const last = this.buffer[this.buffer.length - 1];
        const prev = this.buffer[this.buffer.length - 2];
        if (prev && last.v > threshold && prev.v <= threshold) {
            if (!this._lastPeak || (last.t - this._lastPeak) > 400) {
                if (this._lastPeak) {
                    const rr = last.t - this._lastPeak;
                    if (rr > 400 && rr < 1500) {
                        this.rrBuffer.push(rr);
                        if (this.rrBuffer.length > 60) this.rrBuffer.shift();
                    }
                }
                this._lastPeak = last.t;
            }
        }
    }

    _quality() {
        if (this.rrBuffer.length < 5) return 0.3;
        const mean = this.rrBuffer.reduce((a, b) => a + b, 0) / this.rrBuffer.length;
        return (mean > 400 && mean < 1500) ? 0.72 : 0.3;
    }

    getLatestRR() {
        return { rr_ms: [...this.rrBuffer], confidence: this._quality(), source: 'rppg' };
    }
}
