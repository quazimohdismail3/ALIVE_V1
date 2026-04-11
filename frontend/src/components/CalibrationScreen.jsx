import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useApp } from '../context/AppContext.jsx'
import CosmicBackground from './CosmicBackground.jsx'
import '../styles/calibration.css'

const DURATION_S = 30

const STAGES = [
  { t: 3,  label: 'Signal acquired' },
  { t: 12, label: 'RR intervals captured' },
  { t: 26, label: 'Baseline ready' },
]

const MESSAGES = [
  { t: 0,  text: 'Breathe naturally.' },
  { t: 8,  text: 'Stay relaxed and still.' },
  { t: 18, text: 'Nearly done.' },
  { t: 28, text: 'Baseline captured.' },
]

const ease = [0.16, 1, 0.3, 1]

export default function CalibrationScreen() {
  const navigate = useNavigate()
  const { ble, sensorMode } = useApp()
  const selection = { sensor_mode: sensorMode }
  const onBack = () => navigate('/connect')
  const onDone = () => navigate('/dashboard')

  const [elapsed, setElapsed]   = useState(0)
  const [hr, setHr]             = useState(null)
  const [rrCount, setRrCount]   = useState(0)
  const [beatKey, setBeatKey]   = useState(0)
  const [beatMs, setBeatMs]     = useState(900)
  const rrCountRef = useRef(0)

  // Timer
  useEffect(() => {
    const start = Date.now()
    const iv = setInterval(() => {
      const e = (Date.now() - start) / 1000
      setElapsed(e)
      if (e >= DURATION_S) {
        clearInterval(iv)
        setTimeout(onDone, 700)
      }
    }, 100)
    return () => clearInterval(iv)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // RR source: real BLE or local simulator
  useEffect(() => {
    const onRr = (rr) => {
      rrCountRef.current += 1
      setRrCount(rrCountRef.current)
      setHr(Math.round(60000 / rr))
      setBeatMs(Math.max(400, Math.min(1400, rr)))
      setBeatKey(k => k + 1)
    }

    if (ble && ble.setOnRr) {
      ble.setOnRr(onRr)
      return () => ble.setOnRr(() => {})
    }

    let active = true
    const emit = () => {
      if (!active) return
      const rr = 820 + (Math.random() - 0.5) * 130
      onRr(rr)
      setTimeout(emit, rr)
    }
    setTimeout(emit, 850)
    return () => { active = false }
  }, [ble]) // eslint-disable-line react-hooks/exhaustive-deps

  const progress = Math.min(1, elapsed / DURATION_S)
  const circumf  = 2 * Math.PI * 68
  const msgIdx   = MESSAGES.reduce((acc, m, i) => m.t <= elapsed ? i : acc, 0)

  const sensorLabel =
    selection.sensor_mode === 'simulator' ? 'SIM'
    : selection.sensor_mode === 'polar' ? 'Polar H10'
    : 'WHOOP'

  return (
    <motion.div
      className="calib-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease } }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.4 } }}
    >
      <CosmicBackground />

      <button className="back-arrow" aria-label="Back" onClick={onBack}>←</button>

      <div className="calib-sensor-pill">{sensorLabel}</div>

      <div className="calib-title">Calibrating</div>

      {/* Beating orb */}
      <div
        key={beatKey}
        className="heart-pulse calib-orb-wrap"
        style={{ '--beat-duration': `${beatMs}ms` }}
      >
        {/* Progress arc */}
        <svg
          width="200" height="200"
          style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}
          aria-hidden="true"
        >
          <circle cx="100" cy="100" r="68"
            fill="rgba(45,212,191,0.05)"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1.5"
          />
          <circle cx="100" cy="100" r="68"
            fill="none"
            stroke="var(--accent-teal)"
            strokeWidth="2"
            strokeDasharray={circumf}
            strokeDashoffset={circumf * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 150ms linear' }}
          />
        </svg>

        {/* Glow */}
        <div className="breathe calib-orb-glow" />

        {/* HR value */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="calib-hr-value" aria-live="polite">
            {hr ?? '—'}
          </div>
          <div className="calib-hr-label">BPM</div>
        </div>
      </div>

      {/* RR count */}
      <div className="calib-rr-count">{rrCount} RR intervals</div>

      {/* Stage checklist */}
      <div className="calib-stages">
        {STAGES.map(stage => {
          const done = elapsed >= stage.t
          return (
            <div
              key={stage.label}
              className="calib-stage-row"
              style={{ opacity: done ? 1 : 0.22 }}
            >
              <div
                className="calib-stage-dot"
                style={{
                  border: done ? 'none' : '1px solid rgba(255,255,255,0.18)',
                  background: done ? 'var(--accent-teal)' : 'transparent',
                }}
              >
                {done && (
                  <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
                    <polyline
                      points="1.5,4.5 3.5,6.5 7.5,2"
                      stroke="var(--bg-void)"
                      strokeWidth="1.6"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <span className="calib-stage-label">{stage.label}</span>
            </div>
          )
        })}
      </div>

      <div className="calib-message" aria-live="polite">
        {MESSAGES[msgIdx].text}
      </div>

      {/* Bottom progress bar */}
      <div className="calib-progress-bar">
        <div className="calib-progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>
    </motion.div>
  )
}
