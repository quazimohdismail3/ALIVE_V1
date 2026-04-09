import React, { useEffect, useMemo, useRef, useState } from 'react'
import { RrProcessor } from '../engines/rrProcessor.js'
import { store } from '../store/sessionStore.js'
import HistoryPanel from './HistoryPanel.jsx'

const SESSIONS = [
  { id: 'calm',      name: 'Calm',      copy: 'The storm has passed.',        color: 'var(--ventral)' },
  { id: 'energy',    name: 'Energy',    copy: 'Move without the alarm.',      color: 'var(--sympathetic-h)' },
  { id: 'focus',     name: 'Focus',     copy: 'A mind pointed like a beam.',  color: 'var(--sympathetic-h)' },
  { id: 'recovery',  name: 'Recovery',  copy: 'You gave a lot. Come back.',   color: 'var(--ventral)' },
  { id: 'presence',  name: 'Presence',  copy: 'No destination. Just here.',   color: 'var(--ventral)' },
  { id: 'adhd_flow', name: 'ADHD Flow', copy: 'Channel it before it scatters.', color: 'var(--sympathetic-h)' },
]
const DURATIONS = [
  { label: '10 min', value: 600 },
  { label: '20 min', value: 1200 },
  { label: 'Open',   value: 3600 },
]

export default function DashboardScreen({ sensorMode, ble, onBack, onStartSession }) {
  const [hr, setHr] = useState(null)
  const [rmssd, setRmssd] = useState(null)
  const [beatMs, setBeatMs] = useState(1000)
  const [beatKey, setBeatKey] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pickerSession, setPickerSession] = useState(null)
  const procRef = useRef(null)
  const s = store.get()
  const history = (s.history || []).slice(0, 5)

  // Live HRV from real sensor OR simulator random-walk.
  useEffect(() => {
    const proc = new RrProcessor()
    procRef.current = proc

    // Metrics readout every 1s.
    const metricsIv = setInterval(() => {
      const m = proc.metrics()
      if (m) {
        setHr(m.hr)
        setRmssd(m.rmssd)
      }
    }, 1000)

    let simIv = null
    let currentRr = 1000 // 60 BPM baseline

    if (ble && ble.setOnRr) {
      // Real sensor: tap RRs off the existing BLE instance.
      ble.setOnRr((rr) => {
        proc.push(rr)
        const dur = Math.max(300, Math.min(1500, rr))
        setBeatMs(dur)
        setBeatKey(k => k + 1)
      })
    } else {
      // Simulator or no BLE: fake HRV-ish pulse, 58–64 BPM random walk.
      const scheduleNext = () => {
        const jitter = (Math.random() - 0.5) * 60 // ±30 ms
        currentRr = Math.max(935, Math.min(1035, currentRr + jitter)) // 58–64 BPM
        proc.push(currentRr)
        setBeatMs(currentRr)
        setBeatKey(k => k + 1)
        simIv = setTimeout(scheduleNext, currentRr)
      }
      scheduleNext()
    }

    return () => {
      clearInterval(metricsIv)
      if (simIv) clearTimeout(simIv)
      if (ble && ble.setOnRr) {
        ble.setOnRr(() => {}) // release the sink, don't disconnect
      }
    }
  }, [ble])

  const sensorLabel =
    sensorMode === 'polar' ? 'POLAR H10'
    : sensorMode === 'whoop' ? 'WHOOP'
    : 'SIMULATOR'

  return (
    <div className="screen cosmic-bg" style={{ minHeight: '100dvh', position: 'relative', padding: '24px 20px 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <button className="back-arrow" onClick={onBack} aria-label="Back">←</button>
        <div className="display" style={{ fontSize: 13, letterSpacing: '0.36em', color: 'var(--text-secondary)' }}>VAGUS</div>
        <div className="pill" style={{ fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--state)', boxShadow: '0 0 6px var(--state)' }} />
          {sensorLabel}
        </div>
        <div aria-hidden="true" style={{ width: 44 }} />
      </div>

      {/* Hero: beating heart */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', height: 280, marginBottom: 12 }}>
        <svg width="260" height="260" style={{ position: 'absolute' }}>
          <circle cx="130" cy="130" r="120" fill="none" stroke="var(--state)" strokeWidth="0.6" strokeDasharray="2 8" opacity="0.4" className="state-color" />
          <circle cx="130" cy="130" r="104" fill="none" stroke="var(--state)" strokeWidth="1" opacity="0.3" className="state-color" />
        </svg>
        <div
          key={beatKey}
          className="heart-pulse state-color"
          style={{ '--beat-duration': `${beatMs}ms`, filter: 'drop-shadow(0 0 14px var(--state))' }}
        >
          <HeartMark />
        </div>
        <div style={{ position: 'absolute', top: 40, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
          <div className="mono" style={{ fontSize: 54, fontWeight: 300, lineHeight: 1 }}>
            {hr != null ? Math.round(hr) : '—'}
          </div>
          <div className="secondary" style={{ fontSize: 10, letterSpacing: '0.2em', marginTop: 2 }}>BPM</div>
        </div>
        <div style={{ position: 'absolute', bottom: 34, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
          <div className="mono" style={{ fontSize: 18 }}>{rmssd != null ? Math.round(rmssd) : '—'}<span className="secondary" style={{ fontSize: 10, marginLeft: 4 }}>ms</span></div>
          <div className="secondary" style={{ fontSize: 9, letterSpacing: '0.2em' }}>RMSSD</div>
        </div>
      </div>

      {/* Session grid */}
      <div className="secondary" style={{ fontSize: 10, letterSpacing: '0.15em', marginTop: 4, marginBottom: 10 }}>WHAT DOES YOUR BODY NEED?</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {SESSIONS.map(sess => (
          <button
            key={sess.id}
            onClick={() => setPickerSession(sess)}
            className="state-color"
            style={{
              textAlign: 'left',
              background: 'var(--bg-surface)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderLeft: `3px solid ${sess.color}`,
              borderRadius: 12,
              padding: '12px 14px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500 }}>{sess.name}</div>
            <div className="secondary" style={{ fontSize: 10, marginTop: 4, fontStyle: 'italic' }}>{sess.copy}</div>
          </button>
        ))}
      </div>

      {/* History strip */}
      {history.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="secondary" style={{ fontSize: 10, letterSpacing: '0.15em', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>RECENT</span>
            <button onClick={() => setHistoryOpen(true)} className="secondary" style={{
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              fontSize: 10, cursor: 'pointer', letterSpacing: '0.1em',
              padding: '10px 12px', minHeight: 44, display: 'flex', alignItems: 'center'
            }}>ALL →</button>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {history.map((h, i) => (
              <div key={i} style={{
                flexShrink: 0, minWidth: 120, background: 'var(--bg-surface)',
                border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '10px 12px',
              }}>
                <div className="secondary mono" style={{ fontSize: 9 }}>{new Date(h.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                <div style={{ fontSize: 12, marginTop: 4, textTransform: 'capitalize' }}>{h.session}</div>
                <div className="mono" style={{ fontSize: 11, marginTop: 2, color: h.delta_rmssd >= 0 ? 'var(--ventral)' : 'var(--sympathetic-a)' }}>
                  {h.delta_rmssd >= 0 ? '↑' : '↓'} {Math.abs(h.delta_rmssd).toFixed(0)}ms
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
      {pickerSession && (
        <DurationSheet
          session={pickerSession}
          onCancel={() => setPickerSession(null)}
          onPick={(duration_s) => {
            setPickerSession(null)
            onStartSession({ session: pickerSession.id, duration_s, sensor_mode: sensorMode })
          }}
        />
      )}
    </div>
  )
}

function DurationSheet({ session, onCancel, onPick }) {
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      animation: 'enter 300ms ease forwards',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430, background: 'var(--bg-surface)',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '20px 20px 32px',
      }}>
        <div style={{ width: 40, height: 4, background: 'var(--text-ghost)', borderRadius: 2, margin: '0 auto 18px' }} />
        <div className="display" style={{ fontSize: 20 }}>{session.name}</div>
        <div className="secondary" style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic', marginBottom: 22 }}>{session.copy}</div>
        <div className="secondary" style={{ fontSize: 10, letterSpacing: '0.15em', marginBottom: 10 }}>DURATION</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {DURATIONS.map(d => (
            <button
              key={d.value}
              onClick={() => onPick(d.value)}
              className="pill state-color"
              style={{ flex: 1, background: 'var(--bg-elevated)' }}
            >{d.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function HeartMark() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
      <defs>
        <linearGradient id="heart-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#6EE7D2" />
          <stop offset="100%" stopColor="#00C9A7" />
        </linearGradient>
      </defs>
      <path
        d="M60 100
           C 20 76, 8 52, 22 34
           C 34 19, 52 22, 60 40
           C 68 22, 86 19, 98 34
           C 112 52, 100 76, 60 100 Z"
        fill="url(#heart-grad)" opacity="0.92"
      />
      <path
        d="M60 100
           C 20 76, 8 52, 22 34
           C 34 19, 52 22, 60 40
           C 68 22, 86 19, 98 34
           C 112 52, 100 76, 60 100 Z"
        fill="none" stroke="#E8EDF2" strokeWidth="0.6" opacity="0.3"
      />
    </svg>
  )
}
