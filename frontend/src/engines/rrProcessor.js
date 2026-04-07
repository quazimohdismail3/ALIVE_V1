// Local RR → HRV metrics. Raw biometric data NEVER leaves the device —
// only computed metrics go over the wire to the backend.
//
// This is the client-side twin of backend/hrv_processor.py. Needed so:
//  (a) the UI can show immediate feedback without waiting for server round-trip
//  (b) raw RR data stays local
// The backend also computes from received RRs for the authoritative loop.

const ABS_MIN = 300, ABS_MAX = 2000, REL_MAX = 0.25
const SHORT = 30

export class RrProcessor {
  constructor() {
    this.buf = []
    this.lastAccepted = null
  }
  push(rrMs) {
    if (rrMs < ABS_MIN || rrMs > ABS_MAX) return false
    if (this.lastAccepted != null) {
      const d = Math.abs(rrMs - this.lastAccepted) / this.lastAccepted
      if (d > REL_MAX) return false
    }
    this.lastAccepted = rrMs
    this.buf.push(rrMs)
    if (this.buf.length > 180) this.buf.shift()
    return true
  }
  ready() { return this.buf.length >= SHORT }
  metrics() {
    if (!this.ready()) return null
    const rr = this.buf.slice(-SHORT)
    const diffs = []
    for (let i = 1; i < rr.length; i++) diffs.push(rr[i] - rr[i-1])
    const rmssd = Math.sqrt(diffs.reduce((a,b)=>a+b*b,0) / diffs.length)
    const meanRr = rr.reduce((a,b)=>a+b,0) / rr.length
    const variance = rr.reduce((a,b)=>a+(b-meanRr)**2,0) / rr.length
    const sdnn = Math.sqrt(variance)
    const sd1 = rmssd / Math.SQRT2
    const sd2 = Math.sqrt(Math.max(0, 2*sdnn*sdnn - sd1*sd1))
    const hr = 60000 / meanRr
    return { rmssd, sdnn, sd1, sd2, sd1_sd2_ratio: sd1 / Math.max(sd2, 0.01), mean_rr: meanRr, hr }
  }
  reset() { this.buf = []; this.lastAccepted = null }
}
