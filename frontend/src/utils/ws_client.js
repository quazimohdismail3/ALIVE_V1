// ws_client.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL = API_URL.replace('https://', 'wss://').replace('http://', 'ws://')

export class WSClient {
  constructor(session, mode, authToken, onMessage, { timezone, noReconnect, durationS, rfBpm } = {}) {
    this.session = session
    this.mode = mode
    this.authToken = authToken
    this.onMessage = onMessage
    this.timezone = timezone || 'UTC'
    this.noReconnect = !!noReconnect
    this.durationS = durationS ?? null
    this.rfBpm = rfBpm ?? 0
    this.ws = null
    this._reconnectDelay = 1000
    this._closed = false
  }

  connect() {
    if (this._closed) return
    const durParam = this.durationS && this.durationS > 0 ? `&duration_s=${this.durationS}` : ''
    const rfParam = this.rfBpm > 0 ? `&cal_rf_bpm=${this.rfBpm.toFixed(2)}` : ''
    const url = `${WS_URL}/ws/session?session=${this.session}&mode=${this.mode}${durParam}${rfParam}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._reconnectDelay = 1000
      try {
        this.ws.send(JSON.stringify({ type: 'auth', token: this.authToken, timezone: this.timezone }))
      } catch (err) {
        console.error('[WSClient] auth send failed:', err)
        this._wsState = 'error'
      }
    }

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'auth_ok') { this.onMessage(msg); return; }
        this.onMessage(msg)
      } catch (_) {
        console.error('[WSClient] message parse failed, raw:', e.data)
      }
    }

    this.ws.onclose = () => {
      if (this._closed || this.noReconnect) return
      setTimeout(() => this.connect(), this._reconnectDelay)
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 10000)
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data))
      } catch (err) {
        console.error('[WSClient] send failed:', err)
        this._wsState = 'error'
      }
    }
  }

  close() {
    this._closed = true
    try { this.ws?.close() } catch (_) {}
  }
}
