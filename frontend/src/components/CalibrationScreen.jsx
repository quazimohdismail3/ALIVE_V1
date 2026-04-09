import React, { useEffect, useState } from 'react'

// Pure tuning phase — baseline capture animation. Sensor pairing is
// handled upstream in ConnectScreen.
const MESSAGES = [
  { t: 0,  text: 'Reading your rhythm...' },
  { t: 10, text: 'Tuning in...' },
  { t: 22, text: 'Almost there...' },
  { t: 30, text: 'Baseline captured.' },
]
const DURATION_S = 30

export default function CalibrationScreen({ selection, onBack, onDone }) {
  const [elapsed, setElapsed] = useState(0)
  const [msgIdx, setMsgIdx] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const iv = setInterval(() => {
      const e = (Date.now() - start) / 1000
      setElapsed(e)
      let idx = 0
      for (let i = 0; i < MESSAGES.length; i++) if (MESSAGES[i].t <= e) idx = i
      setMsgIdx(idx)
      if (e >= DURATION_S) {
        clearInterval(iv)
        setTimeout(onDone, 700)
      }
    }, 100)
    return () => clearInterval(iv)
  }, [onDone])

  const progress = Math.min(1, elapsed / DURATION_S)
  const circumference = 2 * Math.PI * 70
  const sensorLabel =
    selection.sensor_mode === 'simulator' ? 'Simulating'
      : selection.sensor_mode === 'polar' ? 'Polar H10'
      : 'WHOOP'

  return (
    <div className="screen cosmic-bg dim" style={{ minHeight: '100dvh', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '72px 20px 40px' }}>
      <button className="back-arrow" aria-label="Back" onClick={onBack}>←</button>

      <div className="pill" style={{ fontSize: 11, position: 'absolute', top: 24, right: 20 }}>{sensorLabel}</div>

      <div style={{ position: 'relative', width: 240, height: 240 }}>
        <svg width="240" height="240" style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
          <circle cx="120" cy="120" r="70" fill="rgba(0,201,167,0.08)" stroke="var(--state)" strokeWidth="1.5" className="state-color" />
          <circle
            cx="120" cy="120" r="70" fill="none"
            stroke="var(--state)" strokeWidth="2" className="state-color"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 150ms linear' }}
          />
        </svg>
        <div className="breathe" style={{
          position: 'absolute', top: 50, left: 50, width: 140, height: 140,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,201,167,0.14), transparent 70%)',
        }} />
      </div>

      <div className="secondary state-color" style={{ marginTop: 40, fontSize: 14, textAlign: 'center', minHeight: 24, transition: 'opacity 400ms ease' }}>
        {MESSAGES[msgIdx].text}
      </div>
    </div>
  )
}
