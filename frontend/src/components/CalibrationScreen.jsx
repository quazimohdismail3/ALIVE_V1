import React, { useEffect, useState } from 'react'

const MESSAGES = [
  { t: 0,  text: 'Reading your rhythm...' },
  { t: 10, text: 'Tuning to you...' },
  { t: 25, text: 'Almost there...' },
  { t: 30, text: 'Baseline captured.' },
]

const DURATION_S = 30

export default function CalibrationScreen({ selection, onDone }) {
  const [elapsed, setElapsed] = useState(0)
  const [msgIdx, setMsgIdx] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const iv = setInterval(() => {
      const e = (Date.now() - start) / 1000
      setElapsed(e)
      // Find the latest message whose t <= e
      let idx = 0
      for (let i = 0; i < MESSAGES.length; i++) if (MESSAGES[i].t <= e) idx = i
      setMsgIdx(idx)
      if (e >= DURATION_S) {
        clearInterval(iv)
        setTimeout(onDone, 800)
      }
    }, 100)
    return () => clearInterval(iv)
  }, [onDone])

  const progress = Math.min(1, elapsed / DURATION_S)
  const circumference = 2 * Math.PI * 70

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '85vh' }}>
      <div style={{ position: 'absolute', top: 20, right: 20 }}>
        <div className="pill" style={{ fontSize: 11 }}>
          {selection.sensor_mode === 'simulator' ? 'Simulating' : (selection.sensor_mode === 'polar' ? 'Polar H10' : 'WHOOP BLE')}
        </div>
      </div>

      <div style={{ position: 'relative', width: 240, height: 240 }}>
        <svg width="240" height="240" style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
          <circle cx="120" cy="120" r="70" fill="rgba(0,201,167,0.08)" stroke="var(--state)" strokeWidth="1.5" className="state-color" />
          <circle
            cx="120"
            cy="120"
            r="70"
            fill="none"
            stroke="var(--state)"
            strokeWidth="2"
            className="state-color"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 150ms linear' }}
          />
        </svg>
        <div className="breathe" style={{
          position: 'absolute', top: 50, left: 50, width: 140, height: 140,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,201,167,0.12), transparent 70%)',
        }} />
      </div>

      <div className="secondary state-color" style={{ marginTop: 40, fontSize: 14, textAlign: 'center', minHeight: 24, transition: 'opacity 400ms ease' }}>
        {MESSAGES[msgIdx].text}
      </div>
    </div>
  )
}
