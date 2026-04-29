// ws_client.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL = API_URL.replace('https://', 'wss://').replace('http://', 'ws://')

export class WSClient {
  constructor(session, mode, authToken, onMessage) {
    this.session = session
    this.mode = mode
    this.authToken = authToken
    this.onMessage = onMessage
    this.ws = null
    this._reconnectDelay = 1000
    this._closed = false
  }

  connect() {
    if (this._closed) return
    const url = `${WS_URL}/ws/session?session=${this.session}&mode=${this.mode}`
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this._reconnectDelay = 1000
      this.ws.send(JSON.stringify({ type: 'auth', token: this.authToken }))
    }

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'auth_ok') return  // handshake complete, no-op
        this.onMessage(msg)
      } catch (_) {}
    }

    this.ws.onclose = () => {
      if (!this._closed) {
        setTimeout(() => this.connect(), this._reconnectDelay)
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, 10000)
      }
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  close() {
    this._closed = true
    try { this.ws?.close() } catch (_) {}
  }
}
