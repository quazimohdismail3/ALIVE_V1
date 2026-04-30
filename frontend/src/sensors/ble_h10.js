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
            // Filter on Heart Rate Service so any HR-advertising device qualifies, plus
            // namePrefix variants ("Polar H10", "Polar H10 ABC123") as a fallback path.
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: ['heart_rate'] },
                    { namePrefix: 'Polar' },
                ],
                optionalServices: ['heart_rate']
            });
            this._device = device;
            this._connected = false;
            this._stopped = false;

            // Reconnect handler — strap can drop briefly when wetness or contact dips.
            device.addEventListener('gattserverdisconnected', () => {
                this._connected = false;
                console.warn('[H10] disconnected — attempting reconnect');
                if (!this._stopped) this._reconnect();
            });

            await this._connect();
        } catch (err) {
            console.warn('H10 start failed (non-fatal):', err);
        }
    }

    async _connect() {
        if (!this._device) return;
        const server = await this._device.gatt.connect();
        this._server = server;
        // Standard HR GATT: service 0x180D, char 0x2A37 (Heart Rate Measurement).
        // RR intervals are in 1/1024s units within the HR measurement packet.
        const service = await server.getPrimaryService('heart_rate');
        const char = await service.getCharacteristic('heart_rate_measurement');
        await char.startNotifications();
        this._char = char;
        if (!this._listenerBound) {
            char.addEventListener('characteristicvaluechanged', (e) => this._onData(e.target.value));
            this._listenerBound = true;
        }
        this._connected = true;
    }

    async _reconnect(attempt = 1) {
        if (this._stopped || attempt > 5) return;
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
        await new Promise(r => setTimeout(r, delay));
        try {
            await this._connect();
        } catch (e) {
            console.warn(`[H10] reconnect attempt ${attempt} failed:`, e);
            this._reconnect(attempt + 1);
        }
    }

    stop() {
        this._stopped = true;
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
        // Skip flags byte + HR value byte(s).
        // Optionally: Energy Expended (uint16) if bit 3 set — skip it before RRs.
        let offset = 1 + (hr16bit ? 2 : 1);
        const eePresent = (flags & 0x08) !== 0;
        if (eePresent) offset += 2;
        // RR field is uint16; need 2 bytes available so offset + 2 must fit.
        while (offset + 2 <= data.byteLength) {
            const rr_1024 = view.getUint16(offset, true);
            const rr_ms = (rr_1024 / 1024) * 1000;
            if (rr_ms > 300 && rr_ms < 2000) {
                this.rrBuffer.push(rr_ms);
                if (this.rrBuffer.length > 200) this.rrBuffer.shift();
            }
            offset += 2;
        }
    }

    isConnected() {
        return !!this._connected;
    }

    getLatestRR() {
        return { rr_ms: [...this.rrBuffer], confidence: 0.95, source: 'h10' };
    }

    getLatestAccel() {
        return { signal: [...this.accelBuffer], fs: 25.0 };
    }
}
