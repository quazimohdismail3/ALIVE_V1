// frontend/src/sensors/ble_h10.js
export class BleH10Sensor {
    constructor() {
        this.rrBuffer = [];
        this._rrQueue = []; // new RRs since last drainNew() — for WS sending
        this.accelBuffer = [];
        this._device = null;
        this._server = null;
        this._char = null;
        this._boundOnData = null; // stored so removeEventListener works on reconnect
        this._connected = false;
        this._stopped = false;
        this._reconnectAttempt = 0;
        this._onStatusChange = null; // (status: 'connected'|'reconnecting'|'failed'|'fallback') => void
    }

    onStatusChange(cb) {
        this._onStatusChange = cb;
        return this;
    }

    _emit(status) {
        if (this._onStatusChange) this._onStatusChange(status);
    }

    async start() {
        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: ['heart_rate'] },
                    { namePrefix: 'Polar' },
                ],
                optionalServices: ['heart_rate']
            });
            this._device = device;
            this._stopped = false;
            this._reconnectAttempt = 0;

            device.addEventListener('gattserverdisconnected', () => {
                this._connected = false;
                if (!this._stopped) {
                    this._emit('reconnecting');
                    this._reconnect(1);
                }
            });

            await this._connect();
        } catch (err) {
            console.warn('[H10] start failed:', err);
            this._lastError = err?.message ?? String(err);
            this._emit('failed');
            // Re-throw so callers (e.g. requestBle) can detect the failure.
            throw err;
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
        // Remove old listener before attaching new one — each reconnect gets a new char object
        // but without removeEventListener the old anonymous handler leaks, causing _onData to
        // fire N+1 times per beat after N reconnects, silently multiplying all RR values.
        if (this._char && this._boundOnData) {
            try { this._char.removeEventListener('characteristicvaluechanged', this._boundOnData); } catch (_) {}
        }
        this._char = char;
        this._boundOnData = (e) => this._onData(e.target.value);
        char.addEventListener('characteristicvaluechanged', this._boundOnData);
        this._connected = true;
        this._reconnectAttempt = 0;
        this._emit('connected');
    }

    // Indefinite reconnect — no attempt cap. Delay caps at 30s.
    // After 3 consecutive failures, emits 'fallback' so SensorContext can switch to rPPG.
    async _reconnect(attempt = 1) {
        if (this._stopped) return;
        this._reconnectAttempt = attempt;
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        await new Promise(r => setTimeout(r, delay));
        if (this._stopped) return;
        try {
            await this._connect();
        } catch (e) {
            console.warn(`[H10] reconnect attempt ${attempt} failed:`, e);
            if (attempt === 3) this._emit('fallback');
            this._reconnect(attempt + 1);
        }
    }

    stop() {
        this._stopped = true;
        this._connected = false;
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
        let offset = 1 + (hr16bit ? 2 : 1);
        const eePresent = (flags & 0x08) !== 0;
        if (eePresent) offset += 2;
        while (offset + 2 <= data.byteLength) {
            const rr_1024 = view.getUint16(offset, true);
            const rr_ms = (rr_1024 / 1024) * 1000;
            if (rr_ms > 300 && rr_ms < 2000) {
                this.rrBuffer.push(rr_ms);
                if (this.rrBuffer.length > 200) this.rrBuffer.shift();
                this._rrQueue.push(rr_ms);
            }
            offset += 2;
        }
    }

    isConnected() { return !!this._connected; }
    getReconnectAttempt() { return this._reconnectAttempt; }
    getLatestRR() { return { rr_ms: [...this.rrBuffer], confidence: 0.95, source: 'h10' }; }
    getLatestAccel() { return { signal: [...this.accelBuffer], fs: 25.0 }; }
    // Returns new RR intervals since last call and clears the queue.
    // Use this in send intervals instead of getLatestRR().slice(-N) to avoid sending duplicates.
    drainNew() { return this._rrQueue.splice(0); }
}
