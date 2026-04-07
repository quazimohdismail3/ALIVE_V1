// WHOOP strap — uses the standard BLE Heart Rate Service when worn.
// Motion artifact is higher than Polar H10; we emit a warning flag.

const HRM_SERVICE = 'heart_rate'
const HRM_CHAR = 'heart_rate_measurement'

export class WhoopBLE {
  constructor() {
    this.device = null
    this.char = null
    this.onRr = null
    this.onMotionWarning = null
    this._lastRr = null
    this._jumpStreak = 0
  }
  async connect(onRr, onMotionWarning) {
    this.onRr = onRr
    this.onMotionWarning = onMotionWarning
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'WHOOP' }, { services: [HRM_SERVICE] }],
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
      if (this._lastRr != null) {
        const jump = Math.abs(rrMs - this._lastRr) / this._lastRr
        if (jump > 0.3) {
          this._jumpStreak++
          if (this._jumpStreak >= 3 && this.onMotionWarning) this.onMotionWarning()
        } else {
          this._jumpStreak = 0
        }
      }
      this._lastRr = rrMs
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
