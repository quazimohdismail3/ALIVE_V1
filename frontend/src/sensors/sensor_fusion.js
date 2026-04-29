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

    async start() {
        this.motionGate.start();
        try {
            if (this.mode === 2 || this.mode === 3) {
                this.sensors.h10 = new BleH10Sensor();
                await this.sensors.h10.start();
            }
            if (this.mode === 1) {
                this.sensors.rppg = new ContactRPPGSensor();
                await this.sensors.rppg.start();
            }
            if (this.mode !== 2) {
                this.sensors.facemesh = new FaceMeshSensor();
                await this.sensors.facemesh.start();
                this.sensors.pose = new BlazePoseSensor();
                await this.sensors.pose.start();
                this.sensors.mic = new BreathMicSensor();
                await this.sensors.mic.start();
            }
        } catch (err) {
            // All sensor failures are silent — never crash the session
            console.warn('SensorFusion start error (non-fatal):', err);
        }
    }

    stop() {
        Object.values(this.sensors).forEach(s => { try { s.stop(); } catch(_) {} });
        try { this.motionGate.stop(); } catch(_) {}
    }

    getReading() {
        const gated = this.motionGate.shouldGate();
        return {
            rr: this.sensors.h10?.getLatestRR() || this.sensors.rppg?.getLatestRR() || null,
            face: gated ? null : (this.sensors.facemesh?.getLatestReading() || null),
            pose: gated ? null : (this.sensors.pose?.getLatestReading() || null),
            breath: this.sensors.mic?.getLatestReading() || null,
            mode: this.mode,
        };
    }
}
