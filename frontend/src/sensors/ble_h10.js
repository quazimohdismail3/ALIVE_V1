// frontend/src/sensors/ble_h10.js
export class BleH10Sensor {
    constructor() {
        this.rrBuffer = [];
        this.accelBuffer = [];
        this._device = null;
        this._server = null;
    }

    async start() {
        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Polar H10' }],
                optionalServices: ['heart_rate']
            });
            this._device = device;
            const server = await device.gatt.connect();
            this._server = server;
            // Standard HR GATT: service 0x180D, char 0x2A37 (Heart Rate Measurement)
            // RR intervals are in 1/1024s units within the HR measurement packet
            const service = await server.getPrimaryService('heart_rate');
            const char = await service.getCharacteristic('heart_rate_measurement');
            await char.startNotifications();
            char.addEventListener('characteristicvaluechanged', (e) => this._onData(e.target.value));
        } catch (err) {
            console.warn('H10 start failed (non-fatal):', err);
        }
    }

    stop() {
        try { if (this._device?.gatt?.connected) this._device.gatt.disconnect(); } catch(_) {}
    }

    _onData(data) {
        // HR GATT 0x2A37: byte 0 = flags
        //   bit 0: HR format (0=uint8, 1=uint16)
        //   bit 4: RR intervals present
        const view = new DataView(data.buffer);
        const flags = view.getUint8(0);
        const hr16bit = (flags & 0x01) !== 0;
        const rrPresent = (flags & 0x10) !== 0;
        if (!rrPresent) return;
        // Skip flags byte + HR value byte(s)
        let offset = 1 + (hr16bit ? 2 : 1);
        while (offset + 1 < data.byteLength) {
            const rr_1024 = view.getUint16(offset, true);
            const rr_ms = (rr_1024 / 1024) * 1000;
            if (rr_ms > 300 && rr_ms < 2000) {
                this.rrBuffer.push(rr_ms);
                if (this.rrBuffer.length > 200) this.rrBuffer.shift();
            }
            offset += 2;
        }
    }

    getLatestRR() {
        return { rr_ms: [...this.rrBuffer], confidence: 0.95, source: 'h10' };
    }

    getLatestAccel() {
        return { signal: [...this.accelBuffer], fs: 25.0 };
    }
}
