// frontend/src/utils/ws_client.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_URL = API_URL.replace('https://', 'wss://').replace('http://', 'ws://');

export class WSClient {
    constructor(sessionId, mode, onMessage) {
        this.sessionId = sessionId;
        this.mode = mode;
        this.onMessage = onMessage;
        this.ws = null;
        this._reconnectDelay = 1000;
        this._closed = false;
    }

    connect() {
        if (this._closed) return;
        this.ws = new WebSocket(`${WS_URL}/ws/${this.sessionId}?mode=${this.mode}`);
        this.ws.onmessage = (e) => {
            try { this.onMessage(JSON.parse(e.data)); } catch(_) {}
        };
        this.ws.onclose = () => {
            if (!this._closed) {
                setTimeout(() => this.connect(), this._reconnectDelay);
                this._reconnectDelay = Math.min(this._reconnectDelay * 2, 10000);
            }
        };
        this.ws.onopen = () => { this._reconnectDelay = 1000; };
    }

    send(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    close() {
        this._closed = true;
        try { this.ws?.close(); } catch(_) {}
    }
}
