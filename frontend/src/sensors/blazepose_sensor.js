// frontend/src/sensors/blazepose_sensor.js
// MediaPipe BlazePose. 33 landmarks. Posture indices for ANS inference.
export class BlazePoseSensor {
    constructor() {
        this.latest = null;
        this.running = false;
        this.stream = null;
    }

    async start() {
        try {
            const { Pose } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js');
            this.pose = new Pose({ locateFile: f =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
            this.pose.setOptions({
                modelComplexity: 1, smoothLandmarks: true,
                minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
            });
            this.pose.onResults(r => this._onResults(r));
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: 320, height: 240 }
            });
            const video = document.createElement('video');
            video.srcObject = this.stream;
            video.setAttribute('playsinline', true);
            await video.play();
            this.running = true;
            const self = this;
            async function loop() {
                if (!self.running) return;
                try { await self.pose.send({ image: video }); } catch(_) {}
                setTimeout(loop, 100);
            }
            loop();
        } catch (err) {
            console.warn('BlazePose start failed (non-fatal):', err);
        }
    }

    stop() {
        this.running = false;
        try { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); } catch(_) {}
    }

    _onResults(results) {
        if (!results.poseLandmarks) return;
        const lm = results.poseLandmarks;
        const shoulder_elevation = Math.min(1, Math.max(0,
            1 - ((lm[11].y + lm[12].y) / 2 - lm[0].y)));
        const head_forward_offset = Math.min(1, Math.abs(lm[0].z || 0));
        const collapse_index = Math.min(1, Math.max(0,
            1 - Math.abs(lm[11].y - lm[23].y)));
        const posture_score = Math.max(0,
            1 - (shoulder_elevation * 0.4 + head_forward_offset * 0.4 + collapse_index * 0.2));
        this.latest = {
            shoulder_elevation, head_forward_offset, collapse_index,
            posture_score, confidence: 0.8
        };
    }

    getLatestReading() {
        return this.latest || { posture_score: 0.5, shoulder_elevation: 0.3, confidence: 0 };
    }
}
