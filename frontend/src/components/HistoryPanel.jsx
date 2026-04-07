import React, { useEffect, useState } from 'react'
import { store } from '../store/sessionStore.js'

export default function HistoryPanel({ onClose }) {
  const [s, setS] = useState(store.get())
  useEffect(() => store.subscribe(setS), [])
  const history = s.history || []

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'enter 400ms ease forwards',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430, maxHeight: '85vh', overflowY: 'auto',
          background: 'var(--bg-surface)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: '20px 20px 40px',
          animation: 'slideUp 400ms ease forwards',
        }}
      >
        <div style={{ width: 40, height: 4, background: 'var(--text-ghost)', borderRadius: 2, margin: '0 auto 20px' }} />
        <div className="display" style={{ fontSize: 22, marginBottom: 20 }}>Your record.</div>

        {history.length === 0 ? (
          <div className="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>Nothing yet. Your first session is waiting.</div>
        ) : (
          history.map((h, i) => (
            <div key={i} className="card state-color" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span className="secondary">{new Date(h.ts).toLocaleString()}</span>
                <span className="mono">{h.delta_rmssd >= 0 ? '↑' : '↓'}{Math.abs(h.delta_rmssd).toFixed(0)}ms</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 6 }}>{h.session} · {Math.round(h.duration_s/60)}min · {h.sensor_mode}</div>
              {h.insight && <div className="secondary" style={{ fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>{h.insight}</div>}
            </div>
          ))
        )}
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(40px); } to { transform: translateY(0); } }`}</style>
    </div>
  )
}
