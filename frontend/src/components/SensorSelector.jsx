import React from 'react'

const MODES = [
  { id: 'simulator', label: 'Simulator' },
  { id: 'polar', label: 'Polar H10' },
  { id: 'whoop', label: 'WHOOP BLE' },
]

export default function SensorSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {MODES.map(m => (
        <button
          key={m.id}
          className={'pill state-color ' + (value === m.id ? 'active' : '')}
          onClick={() => onChange(m.id)}
          style={{ flex: 1 }}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
