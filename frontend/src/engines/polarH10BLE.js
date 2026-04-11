// Polar H10 — Heart Rate Service (0x180D), Heart Rate Measurement char (0x2A37).
// RR intervals come packed in the HRM notification payload, units 1/1024 s.
// Web Bluetooth required; only works over HTTPS or localhost.
//
// Must be invoked from a real user gesture (button click) — browsers block
// navigator.bluetooth.requestDevice() from async effects.

const HRM_SERVICE = 'heart_rate'
const HRM_CHAR = 'heart_rate_measurement'
const sleep = ms => new Promise(r => setTimeout(r, ms))

function _friendlyBleError(e) {
  const msg = e?.message || String(e)
  if (msg.includes('GATT Server is disconnected') || msg.includes('Cannot retrieve services'))
    return 'H10 dropped the connection during setup. Make sure the Polar Beat app (or Garmin) is closed — H10 can only connect to one device at a time. Press the H10 button once to wake it, then tap Retry.'
  if (msg.includes('User cancelled') || msg.includes('chooser'))
    return 'Device picker cancelled. Tap Pair to try again.'
  if (msg.includes('timed out') || msg.includes('Connection timed out'))
    return 'Connection timed out. Press the H10 button once to re-enter pairing mode, then tap Retry.'
  return msg
}

export class PolarH10BLE {
  constructor() {
    this.device = null
    this.char = null
    this.onRr = null
    this.status = 'idle' // idle | requesting | connected | reconnecting | disconnected | error
    this.phase = ''      // 'discovering' | 'connecting' | 'subscribing' | ''
    this.error = null
    this.lastRrAt = 0
    this.rrCount = 0
    this.reconnectAttempt = 0
    this._reconnecting = false // guard against re-entrant disconnect events
    this._statusListeners = new Set()
  }

  onStatusChange(cb) {
    this._statusListeners.add(cb)
    cb(this._snapshot())
    return () => this._statusListeners.delete(cb)
  }

  _snapshot() {
    return {
      status: this.status,
      phase: this.phase,
      error: this.error,
      rrCount: this.rrCount,
      lastRrAt: this.lastRrAt,
      reconnectAttempt: this.reconnectAttempt,
    }
  }

  _emit() {
    const snap = this._snapshot()
    this._statusListeners.forEach(l => l(snap))
  }

  setOnRr(onRr) { this.onRr = onRr }

  async _gattConnectWithTimeout(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          'Connection timed out. Press the H10 button once to re-enter pairing mode, then tap Retry.'
        ))
      }, timeoutMs)
      this.device.gatt.connect().then(
        (server) => { clearTimeout(timer); resolve(server) },
        (err)    => { clearTimeout(timer); reject(err) },
      )
    })
  }

  async connect(onRr) {
    if (onRr) this.onRr = onRr
    this.status = 'requesting'
    this.phase = 'discovering'
    this.error = null
    this._emit()
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Polar' }],
        optionalServices: [HRM_SERVICE],
      })
      this.device.addEventListener('gattserverdisconnected', this._onDisconnected)

      this.phase = 'connecting'
      this._emit()
      let server = await this._gattConnectWithTimeout(8000)

      this.phase = 'subscribing'
      this._emit()

      // H10 can drop the link immediately if it's bonded to another device.
      // Re-connect once before attempting service discovery.
      if (!server.connected) {
        server = await this._gattConnectWithTimeout(8000)
      }

      const service = await server.getPrimaryService(HRM_SERVICE)
      this.char = await service.getCharacteristic(HRM_CHAR)
      await this.char.startNotifications()
      this.char.addEventListener('characteristicvaluechanged', this._handle)

      this.status = 'connected'
      this.phase = ''
      this._emit()
      return true
    } catch (e) {
      this.status = 'error'
      this.phase = ''
      this.error = _friendlyBleError(e)
      this._emit()
      throw e
    }
  }

  _cleanupChar() {
    if (this.char) {
      this.char.removeEventListener('characteristicvaluechanged', this._handle)
      try { this.char.stopNotifications() } catch {}
      this.char = null
    }
  }

  _onDisconnected = async () => {
    // If we're in the middle of initial connect(), don't start a reconnect loop —
    // connect() has its own error handling.
    if (this.status === 'requesting') return

    // Guard against re-entrant calls — if gattserverdisconnected fires again
    // while we're already in a reconnect loop, ignore it.
    if (this._reconnecting) return
    this._reconnecting = true

    // Clean up the old characteristic so we don't leak listeners
    this._cleanupChar()

    this.status = 'reconnecting'
    this._emit()

    for (let attempt = 1; attempt <= 7; attempt++) {
      this.reconnectAttempt = attempt
      this._emit()

      // Exponential backoff: 1.5s, 2s, 3s, 4s, 5s, 5s, 5s
      const delay = Math.min(1500 * Math.pow(1.3, attempt - 1), 5000)
      await sleep(delay)

      try {
        const server = await this._gattConnectWithTimeout(10000)

        // Small settle delay — H10 GATT needs a moment after reconnect
        await sleep(500)

        if (!server.connected) continue

        const service = await server.getPrimaryService(HRM_SERVICE)
        this.char = await service.getCharacteristic(HRM_CHAR)
        await this.char.startNotifications()
        this.char.addEventListener('characteristicvaluechanged', this._handle)
        this.status = 'connected'
        this.reconnectAttempt = 0
        this._reconnecting = false
        this._emit()
        return
      } catch {
        // Clean up partial state before retrying
        this._cleanupChar()
      }
    }

    // All attempts exhausted
    this.status = 'error'
    this.error = 'reconnect_failed'
    this.reconnectAttempt = 0
    this._reconnecting = false
    this._emit()
  }

  _handle = (event) => {
    const v = event.target.value
    const flags = v.getUint8(0)
    const hr16 = (flags & 0x01) !== 0
    let idx = hr16 ? 3 : 2
    const rrPresent = (flags & 0x10) !== 0
    if (!rrPresent) return
    while (idx + 1 < v.byteLength) {
      const raw = v.getUint16(idx, true)
      idx += 2
      const rrMs = (raw / 1024) * 1000
      this.lastRrAt = Date.now()
      this.rrCount += 1
      this.onRr && this.onRr(rrMs)
    }
    this._emit()
  }

  async disconnect() {
    this._reconnecting = true // prevent reconnect loop from firing during teardown
    try {
      this._cleanupChar()
      if (this.device) {
        this.device.removeEventListener('gattserverdisconnected', this._onDisconnected)
        if (this.device.gatt.connected) this.device.gatt.disconnect()
      }
    } catch {}
    this.device = null
    this.char = null
    this._reconnecting = false
    this.status = 'disconnected'
    this._emit()
  }
}
