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
                optionalServices: ['fb005c80-02e7-f387-1cad-8acd2d8df0c8']
            });
            this._device = device;
            const server = await device.gatt.connect();
            this._server = server;
            const service = await server.getPrimaryService('fb005c80-02e7-f387-1cad-8acd2d8df0c8');
            const char = await service.getCharacteristic('fb005c81-02e7-f387-1cad-8acd2d8df0c8');
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
        // H10 PMD RR format: bytes 0-1 = flags, then RR pairs in 1/1024s units
        const view = new DataView(data.buffer);
        for (let i = 2; i < data.byteLength - 1; i += 2) {
            const rr_1024 = view.getUint16(i, true);
            const rr_ms = (rr_1024 / 1024) * 1000;
            if (rr_ms > 300 && rr_ms < 2000) {
                this.rrBuffer.push(rr_ms);
                if (this.rrBuffer.length > 200) this.rrBuffer.shift();
            }
        }
    }

    getLatestRR() {
        return { rr_ms: [...this.rrBuffer], confidence: 0.95, source: 'h10' };
    }

    getLatestAccel() {
        return { signal: [...this.accelBuffer], fs: 25.0 };
    }
}
