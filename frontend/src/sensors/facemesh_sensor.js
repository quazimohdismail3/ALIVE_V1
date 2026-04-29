// frontend/src/sensors/facemesh_sensor.js
// MediaPipe FaceMesh. CDN loaded. 15fps on S23.
export class FaceMeshSensor {
    constructor() {
        this.latest = null;
        this.running = false;
        this.stream = null;
    }

    async start(sharedStream = null) {
        try {
            const { FaceMesh } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js');
            this.faceMesh = new FaceMesh({ locateFile: f =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
            this.faceMesh.setOptions({
                maxNumFaces: 1, refineLandmarks: false,
                minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
            });
            this.faceMesh.onResults(r => this._onResults(r));
            // Use shared stream if provided (combined mode) — never duplicate getUserMedia
            if (sharedStream) {
                this._ownsStream = false;
                this.stream = sharedStream;
            } else {
                this._ownsStream = true;
                this.stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: 320, height: 240 }
                });
            }
            const video = document.createElement('video');
            video.srcObject = this.stream;
            video.setAttribute('playsinline', true);
            await video.play();
            this.running = true;
            const self = this;
            async function loop() {
                if (!self.running) return;
                try { await self.faceMesh.send({ image: video }); } catch(_) {}
                setTimeout(loop, 67); // ~15fps
            }
            loop();
        } catch (err) {
            console.warn('FaceMesh start failed (non-fatal):', err);
        }
    }

    stop() {
        this.running = false;
        // Only tear down the stream if we created it
        try { if (this._ownsStream && this.stream) this.stream.getTracks().forEach(t => t.stop()); } catch(_) {}
    }

    _ear(lm, pts) {
        const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
        return (d(pts[1], pts[5]) + d(pts[2], pts[4])) / (2 * d(pts[0], pts[3]));
    }

    _onResults(results) {
        if (!results.multiFaceLandmarks?.[0]) return;
        const lm = results.multiFaceLandmarks[0];
        const earL = this._ear(lm, [33, 160, 158, 133, 153, 144]);
        const earR = this._ear(lm, [362, 385, 387, 263, 373, 380]);
        const ear = (earL + earR) / 2;
        const valence_proxy = Math.min(1, Math.max(-1, (lm[291].y - lm[61].y) * 10));
        const arousal_proxy = Math.min(1, Math.max(0, Math.abs(lm[19].y - lm[1].y) * 5));
        this.latest = {
            ear, blink_rate_pm: ear < 0.2 ? 1 : 0,
            valence_proxy, arousal_proxy,
            facial_tension: Math.max(0, 1 - ear / 0.3),
            confidence: 0.85
        };
    }

    getLatestReading() {
        return this.latest || { ear: 0.3, valence_proxy: 0, arousal_proxy: 0.5, confidence: 0 };
    }
}
