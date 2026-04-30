// frontend/src/sensors/sensor_fusion.js
// Activates correct sensors per mode. All failures silent.
import { BleH10Sensor } from './ble_h10.js';
import { ContactRPPGSensor } from './contact_rppg.js';
import { FaceMeshSensor } from './facemesh_sensor.js';
import { BlazePoseSensor } from './blazepose_sensor.js';
import { BreathMicSensor } from './breath_mic.js';
import { MotionGate } from './motion_gate.js';

export class SensorFusion {
    constructor(mode) {
        this.mode = mode;
        this.sensors = {};
        this.motionGate = new MotionGate();
    }

    async start({ externalRearStream = null } = {}) {
        this.motionGate.start();
        // Track handed-off rear stream so we can release it on stop().
        this._rearStream = externalRearStream;
        try {
            // BLE H10 — modes 2 and 3
            if (this.mode === 2 || this.mode === 3) {
                this.sensors.h10 = new BleH10Sensor();
                await this.sensors.h10.start();
            }
            // Rear-cam fingertip rPPG — mode 1 only (rear cam + torch can't coexist with front cam)
            if (this.mode === 1) {
                this.sensors.rppg = new ContactRPPGSensor();
                await this.sensors.rppg.start(externalRearStream);
            }
            // Mic — all modes (resp signal for RF coherence)
            this.sensors.mic = new BreathMicSensor();
            await this.sensors.mic.start();
            // Front-cam stack — combined mode only (single shared stream for face + pose)
            if (this.mode === 3) {
                try {
                    this._frontStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'user', width: 320, height: 240 }
                    });
                    this.sensors.facemesh = new FaceMeshSensor();
                    await this.sensors.facemesh.start(this._frontStream);
                    this.sensors.pose = new BlazePoseSensor();
                    await this.sensors.pose.start(this._frontStream);
                } catch (e) {
                    console.warn('Front-cam stack failed (non-fatal):', e);
                }
            }
        } catch (err) {
            console.warn('SensorFusion start error (non-fatal):', err);
        }
    }

    stop() {
        Object.values(this.sensors).forEach(s => { try { s.stop(); } catch(_) {} });
        try { this.motionGate.stop(); } catch(_) {}
        // Stop the shared front-camera stream we created in combined mode
        try { if (this._frontStream) this._frontStream.getTracks().forEach(t => t.stop()); } catch(_) {}
        this._frontStream = null;
        // Release the rear stream handed off from Setup (rPPG sensor doesn't own it)
        try { if (this._rearStream) this._rearStream.getTracks().forEach(t => t.stop()); } catch(_) {}
        this._rearStream = null;
    }

    getTorchStatus() {
        if (this.mode !== 1) return null;
        return !!this.sensors.rppg?.torchAvailable;
    }

    getReading() {
        const gated = this.motionGate.shouldGate();
        const breath = this.sensors.mic?.getLatestReading() || null;
        const resp_amp = this.sensors.mic?.getRespAmplitudeSample?.() ?? 0;
        return {
            rr: this.sensors.h10?.getLatestRR() || this.sensors.rppg?.getLatestRR() || null,
            face: gated ? null : (this.sensors.facemesh?.getLatestReading() || null),
            pose: gated ? null : (this.sensors.pose?.getLatestReading() || null),
            breath,
            resp_bpm: breath?.breath_rate_bpm ?? null,
            resp_amp,
            mode: this.mode,
        };
    }
}
