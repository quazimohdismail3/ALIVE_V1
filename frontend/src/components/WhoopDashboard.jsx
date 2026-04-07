import React, { useEffect, useState } from 'react'
import { fetchDaily, getAuthUrl, toPills } from '../engines/whoopEngine.js'
import { store } from '../store/sessionStore.js'

export default function WhoopDashboard() {
  const [pills, setPills] = useState(null)
  const [configured, setConfigured] = useState(null)

  useEffect(() => {
    (async () => {
      const auth = await getAuthUrl()
      setConfigured(auth?.configured === true)
      const token = store.get().whoop_token
      if (token && auth?.configured) {
        const daily = await fetchDaily(token)
        setPills(toPills(daily))
      }
    })()
  }, [])

  if (configured === false) {
    return <div className="secondary" style={{ fontSize: 12, marginTop: 12 }}>WHOOP not configured</div>
  }
  if (!pills) {
    return <div className="secondary" style={{ fontSize: 12, marginTop: 12 }}>— — — — —</div>
  }

  const items = [
    { label: 'HRV', value: pills.hrv },
    { label: 'REC', value: pills.recovery },
    { label: 'RHR', value: pills.rhr },
    { label: 'SLP', value: pills.sleep },
    { label: 'RSP', value: pills.resp },
  ]
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
      {items.map(it => (
        <div key={it.label} className="pill" style={{ flex: 1, textAlign: 'center', padding: '10px 6px' }}>
          <div className="mono" style={{ fontSize: 14, color: 'var(--text-primary)' }}>{it.value}</div>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', marginTop: 2 }}>{it.label}</div>
        </div>
      ))}
    </div>
  )
}
