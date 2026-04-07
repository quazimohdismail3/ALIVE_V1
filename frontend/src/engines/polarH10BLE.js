// Polar H10 — Heart Rate Service (0x180D), Heart Rate Measurement char (0x2A37).
// RR intervals come packed in the HRM notification payload, units 1/1024 s.
// Web Bluetooth required; only works over HTTPS or localhost.

const HRM_SERVICE = 'heart_rate'
const HRM_CHAR = 'heart_rate_measurement'

export class PolarH10BLE {
  constructor() {
    this.device = null
    this.char = null
    this.onRr = null
  }
  async connect(onRr) {
    this.onRr = onRr
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HRM_SERVICE] }],
      optionalServices: [HRM_SERVICE],
    })
    const server = await this.device.gatt.connect()
    const service = await server.getPrimaryService(HRM_SERVICE)
    this.char = await service.getCharacteristic(HRM_CHAR)
    await this.char.startNotifications()
    this.char.addEventListener('characteristicvaluechanged', this._handle)
    return true
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
      this.onRr && this.onRr(rrMs)
    }
  }
  async disconnect() {
    try {
      if (this.char) {
        this.char.removeEventListener('characteristicvaluechanged', this._handle)
        await this.char.stopNotifications()
      }
      if (this.device && this.device.gatt.connected) this.device.gatt.disconnect()
    } catch {}
    this.device = null
    this.char = null
  }
}
