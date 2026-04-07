import React, { useState } from 'react'

const SESSIONS = [
  { id: 'calm',      name: 'Calm',       copy: 'The storm has passed. Let\u2019s settle.',         color: 'var(--ventral)' },
  { id: 'energy',    name: 'Energy',     copy: 'Move without the alarm.',                          color: 'var(--sympathetic-h)' },
  { id: 'focus',     name: 'Focus',      copy: 'Your mind, pointed like a beam.',                  color: 'var(--sympathetic-h)' },
  { id: 'recovery',  name: 'Recovery',   copy: 'You gave a lot. Come back.',                       color: 'var(--ventral)' },
  { id: 'presence',  name: 'Presence',   copy: 'No destination. Just here.',                       color: 'var(--ventral)' },
  { id: 'adhd_flow', name: 'ADHD Flow',  copy: 'Channel it before it scatters.',                   color: 'var(--sympathetic-h)' },
]

const DURATIONS = [
  { label: '10 min', value: 600 },
  { label: '20 min', value: 1200 },
  { label: 'Open',   value: 3600 },
]

export default function SessionPicker({ initial, onCancel, onConfirm }) {
  const [session, setSession] = useState(initial.session)
  const [duration, setDuration] = useState(initial.duration_s || 600)

  const canStart = session !== null

  return (
    <div className="screen">
      <div className="display" style={{ fontSize: 22, marginBottom: 24 }}>What does your body need?</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {SESSIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setSession(s.id)}
            className="card state-color"
            style={{
              textAlign: 'left',
              borderLeftColor: s.color,
              opacity: session && session !== s.id ? 0.4 : 1,
              background: session === s.id ? 'var(--bg-elevated)' : 'var(--bg-surface)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{s.name}</div>
            <div className="secondary" style={{ fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>{s.copy}</div>
          </button>
        ))}
      </div>

      <div className="secondary" style={{ fontSize: 11, letterSpacing: '0.1em', margin: '28px 0 10px' }}>DURATION</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {DURATIONS.map(d => (
          <button
            key={d.value}
            className={'pill state-color ' + (duration === d.value ? 'active' : '')}
            style={{ flex: 1 }}
            onClick={() => setDuration(d.value)}
          >{d.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 32 }}>
        <button className="btn-ghost btn state-color" style={{ flex: 1 }} onClick={onCancel}>Back</button>
        <button
          className="btn state-color"
          style={{ flex: 2 }}
          disabled={!canStart}
          onClick={() => onConfirm({ ...initial, session, duration_s: duration })}
        >Start</button>
      </div>
    </div>
  )
}
