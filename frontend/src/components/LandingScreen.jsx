import React, { useEffect, useState } from 'react'
import { store } from '../store/sessionStore.js'
import SensorSelector from './SensorSelector.jsx'
import WhoopDashboard from './WhoopDashboard.jsx'

export default function LandingScreen({ onBegin, onOpenHistory, setAnsState }) {
  const [s, setS] = useState(store.get())
  useEffect(() => store.subscribe(setS), [])
  useEffect(() => { setAnsState('ventral_vagal') }, [setAnsState])

  const tagline = s.last_insight || 'Tune your nervous system.'
  const recent = (s.history || []).slice(0, 3)

  return (
    <div className="screen">
      <div style={{ textAlign: 'center', padding: '48px 0 36px' }}>
        <div className="display" style={{ fontSize: 32, letterSpacing: '0.12em' }}>MISSION ALIVE</div>
        <div className="secondary" style={{ marginTop: 14, fontStyle: s.last_insight ? 'italic' : 'normal' }}>
          {tagline}
        </div>
      </div>

      <WhoopDashboard />

      <div style={{ marginTop: 28 }}>
        <SensorSelector
          value={s.sensor_mode}
          onChange={(m) => store.set({ sensor_mode: m })}
        />
      </div>

      <button className="btn state-color" style={{ marginTop: 32 }} onClick={onBegin}>Begin</button>

      {recent.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <div className="secondary" style={{ fontSize: 11, letterSpacing: '0.1em', marginBottom: 12 }}>RECENT</div>
          {recent.map((h, i) => (
            <div key={i} className="card state-color" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span className="secondary">{new Date(h.ts).toLocaleDateString()}</span>
                <span className="mono">{h.delta_rmssd >= 0 ? '↑' : '↓'} {Math.abs(h.delta_rmssd).toFixed(0)}ms</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 6 }}>{h.session}</div>
              {h.insight && <div className="secondary" style={{ fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>{h.insight}</div>}
            </div>
          ))}
        </div>
      )}

      <button className="btn-ghost btn state-color" style={{ marginTop: 24, height: 44 }} onClick={onOpenHistory}>
        All sessions
      </button>
    </div>
  )
}
