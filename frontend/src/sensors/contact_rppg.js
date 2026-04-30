// frontend/src/sensors/contact_rppg.js
// Fingertip rPPG. Rear camera. Torch enabled.
// Samples a centered ROI from the camera frame (where fingertip should sit).
// Confidence is signal-driven (peak-to-baseline ratio over recent window).
export class ContactRPPGSensor {
    constructor() {
        this.fs = 30;
        this.buffer = [];
        this.rrBuffer = [];
        this.running = false;
        this.stream = null;
        this._lastPeak = null;
        this._roiSize = 100;
        this._snr = 0;
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
            canvas.width = this._roiSize;
            canvas.height = this._roiSize;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const track = this.stream.getVideoTracks()[0];
            try {
                const caps = track.getCapabilities ? track.getCapabilities() : {};
                if (caps.torch) {
                    await track.applyConstraints({ advanced: [{ torch: true }] });
                    console.log('[rPPG] torch enabled');
                } else {
                    console.warn('[rPPG] torch capability not available on this track');
                }
            } catch (e) { console.warn('[rPPG] torch applyConstraints failed:', e); }
            this.running = true;
            const self = this;
            function loop() {
                if (!self.running) return;
                const vw = video.videoWidth || self._roiSize;
                const vh = video.videoHeight || self._roiSize;
                const sx = Math.max(0, (vw - self._roiSize) / 2);
                const sy = Math.max(0, (vh - self._roiSize) / 2);
                try {
                    ctx.drawImage(video, sx, sy, self._roiSize, self._roiSize, 0, 0, self._roiSize, self._roiSize);
                } catch (_) {
                    requestAnimationFrame(loop);
                    return;
                }
                const px = ctx.getImageData(0, 0, self._roiSize, self._roiSize).data;
                let r = 0, g = 0, n = 0;
                for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; n++; }
                const chrom = g > 0 ? (r / n) / (g / n) : 1;
                self.buffer.push({ v: chrom, t: Date.now() });
                if (self.buffer.length > 300) self.buffer.shift();
                self._detectRR();
                self._updateSNR();
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

    _updateSNR() {
        if (this.buffer.length < 90) { this._snr = 0; return; }
        const vals = this.buffer.slice(-90).map(b => b.v);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
        const std = Math.sqrt(variance);
        // SNR proxy: how strong is variation relative to baseline. Clamp to [0,1].
        // A finger-on-torch pulse typically gives chrom variance > 0.001.
        if (variance < 1e-6) { this._snr = 0; return; }
        const snr = Math.min(1, Math.max(0, (std / Math.max(mean, 1e-6)) * 30));
        this._snr = snr;
    }

    _quality() {
        if (this.rrBuffer.length < 5) return Math.min(0.3, this._snr);
        const mean = this.rrBuffer.reduce((a, b) => a + b, 0) / this.rrBuffer.length;
        const inRange = (mean > 400 && mean < 1500) ? 1 : 0;
        return Math.max(0, Math.min(1, 0.3 + 0.6 * this._snr * inRange));
    }

    getLatestRR() {
        return { rr_ms: [...this.rrBuffer], confidence: this._quality(), source: 'rppg' };
    }
}
