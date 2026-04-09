import React, { useEffect, useRef, useState } from 'react'
import { PolarH10BLE } from '../engines/polarH10BLE.js'
import { WhoopBLE } from '../engines/whoopBLE.js'
import { store } from '../store/sessionStore.js'

const MIN_RR_TO_CONTINUE = 8

const SENSORS = [
  {
    id: 'polar',
    name: 'Polar H10',
    sub: 'Chest strap · RR-grade',
    needsBle: true,
    icon: PolarIcon,
  },
  {
    id: 'whoop',
    name: 'WHOOP',
    sub: 'Wrist strap · BLE',
    needsBle: true,
    icon: WhoopIcon,
  },
  {
    id: 'simulator',
    name: 'Simulator',
    sub: 'No device · demo mode',
    needsBle: false,
    icon: SimIcon,
  },
]

export default function ConnectScreen({ onBack, onContinue }) {
  const [selected, setSelected] = useState(store.get().sensor_mode || 'simulator')
  const [bleStatus, setBleStatus] = useState({ status: 'idle', error: null, rrCount: 0 })
  const bleRef = useRef(null)

  // Secure context check — Web Bluetooth requires HTTPS or localhost.
  const webBtOk = typeof navigator !== 'undefined'
    && typeof window !== 'undefined'
    && window.isSecureContext
    && !!navigator.bluetooth

  // Clean up any lingering BLE instance if the user switches sensors.
  useEffect(() => () => {
    // on unmount, if we built a BLE that wasn't handed off, disconnect it.
    if (bleRef.current && !bleRef.current.__handedOff) {
      bleRef.current.disconnect?.()
    }
  }, [])

  const buildBle = (id) => {
    if (id === 'polar') return new PolarH10BLE()
    if (id === 'whoop') return new WhoopBLE()
    return null
  }

  const handlePickSensor = (id) => {
    // Tear down previous BLE if any
    if (bleRef.current && bleRef.current !== null) {
      try { bleRef.current.disconnect?.() } catch {}
    }
    bleRef.current = null
    setBleStatus({ status: 'idle', error: null, rrCount: 0 })
    setSelected(id)
    store.set({ sensor_mode: id })
  }

  const handleConnect = async () => {
    if (!selected || selected === 'simulator') return
    const ble = buildBle(selected)
    bleRef.current = ble
    // PolarH10BLE has a rich status listener; WhoopBLE doesn't yet.
    if (ble.onStatusChange) {
      ble.onStatusChange(setBleStatus)
    } else {
      setBleStatus({ status: 'requesting', error: null, rrCount: 0 })
    }
    try {
      // Temporary sink until the session/dashboard re-points onRr.
      await ble.connect(
        () => {
          // for WhoopBLE (no listener), count RRs manually
          if (!ble.onStatusChange) {
            setBleStatus(s => ({ ...s, status: 'connected', rrCount: (s.rrCount || 0) + 1 }))
          }
        },
        () => {},
      )
      if (!ble.onStatusChange) setBleStatus(s => ({ ...s, status: 'connected' }))
    } catch (e) {
      if (!ble.onStatusChange) {
        setBleStatus({ status: 'error', error: e?.message || String(e), rrCount: 0 })
      }
    }
  }

  const sensorMeta = SENSORS.find(s => s.id === selected)
  const isSim = selected === 'simulator'
  const canContinue = isSim || (
    bleStatus.status === 'connected' && (bleStatus.rrCount || 0) >= MIN_RR_TO_CONTINUE
  )

  const goContinue = () => {
    if (bleRef.current) bleRef.current.__handedOff = true
    onContinue({ sensor_mode: selected, ble: bleRef.current })
  }

  return (
    <div className="screen cosmic-bg dim" style={{ minHeight: '100dvh', position: 'relative', padding: '72px 20px 40px' }}>
      <button className="back-arrow" aria-label="Back" onClick={onBack}>←</button>

      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div className="display" style={{ fontSize: 28, letterSpacing: '-0.01em' }}>Connect your body.</div>
        <div className="secondary" style={{ fontSize: 13, marginTop: 8 }}>Pick a sensor to begin listening.</div>
      </div>

      {!webBtOk && (
        <div style={{
          background: 'rgba(232,98,42,0.08)', border: '1px solid rgba(232,98,42,0.25)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 12, lineHeight: 1.5,
        }}>
          <strong style={{ color: 'var(--sympathetic-a)' }}>Bluetooth unavailable.</strong>{' '}
          Web Bluetooth requires <span className="mono">https://</span> or <span className="mono">localhost</span>.
          On iPhone, use the <strong>Bluefy</strong> browser. Simulator still works.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SENSORS.map(s => {
          const isSel = selected === s.id
          const disabled = s.needsBle && !webBtOk
          const Icon = s.icon
          return (
            <button
              key={s.id}
              disabled={disabled}
              onClick={() => handlePickSensor(s.id)}
              className="state-color"
              style={{
                background: isSel ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                border: `1px solid ${isSel ? 'var(--state)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 14,
                padding: '16px 18px',
                display: 'flex', alignItems: 'center', gap: 14,
                opacity: disabled ? 0.35 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                color: 'var(--text-primary)',
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(0,201,167,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{s.name}</div>
                <div className="secondary" style={{ fontSize: 11, marginTop: 2 }}>{s.sub}</div>
              </div>
              {isSel && <span style={{ color: 'var(--state)', fontSize: 18 }}>●</span>}
            </button>
          )
        })}
      </div>

      {/* Inline connect panel for selected BLE sensor */}
      {sensorMeta && sensorMeta.needsBle && webBtOk && (
        <div style={{ marginTop: 20, padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12 }}>
          <div className="secondary" style={{ fontSize: 10, letterSpacing: '0.15em', marginBottom: 10 }}>PAIRING</div>
          <button
            onClick={handleConnect}
            disabled={bleStatus.status === 'requesting' || bleStatus.status === 'connected'}
            style={{
              width: '100%', padding: '12px', borderRadius: 10,
              background: bleStatus.status === 'connected' ? 'rgba(0,201,167,0.12)' : 'transparent',
              border: `1px solid ${bleStatus.status === 'connected' ? 'var(--state)' : 'rgba(255,255,255,0.12)'}`,
              color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer', minHeight: 44,
            }}
          >
            {bleStatus.status === 'connected' ? 'Connected ●'
              : bleStatus.status === 'requesting' ? 'Searching…'
              : bleStatus.status === 'error' ? 'Retry connect'
              : `Pair ${sensorMeta.name}`}
          </button>
          <div className="secondary mono" style={{ fontSize: 10, marginTop: 10, minHeight: 14, textAlign: 'center' }}>
            {bleStatus.status === 'connected' && `RR received: ${bleStatus.rrCount}${bleStatus.rrCount >= MIN_RR_TO_CONTINUE ? ' ✓' : ` / ${MIN_RR_TO_CONTINUE}`}`}
            {bleStatus.status === 'error' && `Error: ${bleStatus.error || 'failed'}`}
            {bleStatus.status === 'requesting' && 'Waiting for device…'}
            {bleStatus.status === 'disconnected' && 'Disconnected'}
            {bleStatus.status === 'idle' && 'Wet electrodes · wear strap · tap Pair'}
          </div>
        </div>
      )}

      <button
        className="btn state-color"
        style={{ marginTop: 28 }}
        disabled={!canContinue}
        onClick={goContinue}
      >
        Continue
      </button>
    </div>
  )
}

function PolarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="9" width="18" height="6" rx="1.5" stroke="var(--state)" strokeWidth="1.5" className="state-color" />
      <path d="M8 12h2l1-2 1 4 1-2h3" stroke="var(--state)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="state-color" />
    </svg>
  )
}
function WhoopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="6" stroke="var(--state)" strokeWidth="1.5" className="state-color" />
      <path d="M4 12h2M18 12h2M12 4v2M12 18v2" stroke="var(--state)" strokeWidth="1.2" strokeLinecap="round" className="state-color" />
    </svg>
  )
}
function SimIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 14c2-4 4-4 6 0s4 4 6 0 4-4 4 0" stroke="var(--state)" strokeWidth="1.5" strokeLinecap="round" className="state-color" />
    </svg>
  )
}
