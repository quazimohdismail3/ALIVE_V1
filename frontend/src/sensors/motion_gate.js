// frontend/src/sensors/motion_gate.js
// DeviceMotion gating: pause rPPG if motion > 0.05g RMS
export class MotionGate {
    constructor() {
        this.isMoving = false;
        this._handler = null;
    }

    start() {
        this._handler = (e) => {
            const g = e.accelerationIncludingGravity;
            if (!g) return;
            const rms = Math.sqrt((g.x || 0) ** 2 + (g.y || 0) ** 2 + (g.z || 0) ** 2) / 9.81;
            this.isMoving = rms > 0.05;
        };
        try {
            window.addEventListener('devicemotion', this._handler);
        } catch(_) {}
    }

    stop() {
        try { if (this._handler) window.removeEventListener('devicemotion', this._handler); } catch(_) {}
    }

    shouldGate() { return this.isMoving; }
}
