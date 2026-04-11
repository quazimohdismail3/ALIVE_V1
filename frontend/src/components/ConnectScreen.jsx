import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../context/AppContext.jsx'
import { PolarH10BLE } from '../engines/polarH10BLE.js'
import { WhoopBLE } from '../engines/whoopBLE.js'
import { store } from '../store/sessionStore.js'
import CosmicBackground from './CosmicBackground.jsx'
import FlowingWaves from './FlowingWaves.jsx'
import '../styles/connect.css'

const MIN_RR_TO_CONTINUE = 8

const SENSORS = [
  {
    id: 'polar',
    name: 'Polar H10',
    sub: 'Chest strap · RR-grade precision',
    needsBle: true,
    icon: '❤️',
    cls: 'polar',
  },
  {
    id: 'whoop',
    name: 'WHOOP Strap',
    sub: 'Your daily baseline',
    needsBle: true,
    icon: '⌚',
    cls: 'whoop',
  },
  {
    id: 'simulator',
    name: 'Simulator',
    sub: 'No device · demo mode',
    needsBle: false,
    icon: '〜',
    cls: 'sim',
  },
]

const ease = [0.16, 1, 0.3, 1]

export default function ConnectScreen() {
  const navigate = useNavigate()
  const { setBle, setSensorMode } = useApp()

  const [selected, setSelected] = useState(store.get().sensor_mode || 'simulator')
  const [bleStatus, setBleStatus] = useState({ status: 'idle', phase: '', error: null, rrCount: 0 })
  const bleRef = useRef(null)

  const webBtOk = typeof navigator !== 'undefined'
    && typeof window !== 'undefined'
    && window.isSecureContext
    && !!navigator.bluetooth

  useEffect(() => () => {
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
    if (bleRef.current) { try { bleRef.current.disconnect?.() } catch {} }
    bleRef.current = null
    setBleStatus({ status: 'idle', error: null, rrCount: 0 })
    setSelected(id)
    store.set({ sensor_mode: id })
  }

  const handleConnect = async () => {
    if (!selected || selected === 'simulator') return
    const ble = buildBle(selected)
    bleRef.current = ble
    if (ble.onStatusChange) {
      ble.onStatusChange(setBleStatus)
    } else {
      setBleStatus({ status: 'requesting', error: null, rrCount: 0 })
    }
    try {
      await ble.connect(
        () => {
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
    setSensorMode(selected)
    setBle(bleRef.current)
    navigate('/calibrate')
  }

  // Phase-specific button label
  const connectBtnLabel = () => {
    if (bleStatus.status === 'connected') return '● Connected'
    if (bleStatus.status === 'requesting') {
      if (bleStatus.phase === 'connecting') return 'Connecting to device…'
      if (bleStatus.phase === 'subscribing') return 'Subscribing to HR…'
      return 'Searching…'
    }
    if (bleStatus.status === 'error') return 'Retry connect'
    return `Pair ${sensorMeta?.name}`
  }

  // Phase-specific status sub-text
  const statusText = () => {
    if (bleStatus.status === 'connected')
      return `RR received: ${bleStatus.rrCount}${bleStatus.rrCount >= MIN_RR_TO_CONTINUE ? ' ✓' : ` / ${MIN_RR_TO_CONTINUE}`}`
    if (bleStatus.status === 'error')
      return <span style={{ color: 'var(--accent-rose)', whiteSpace: 'pre-wrap' }}>{bleStatus.error || 'Connection failed'}</span>
    if (bleStatus.status === 'requesting') {
      if (bleStatus.phase === 'discovering') return 'Select your Polar H10 from the list above'
      if (bleStatus.phase === 'connecting') return 'Selected — opening GATT channel…'
      if (bleStatus.phase === 'subscribing') return 'Enabling RR notifications…'
    }
    if (bleStatus.status === 'disconnected') return 'Disconnected'
    return 'Wet electrodes · wear strap · tap Pair'
  }

  return (
    <motion.div
      className="connect-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease } }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.4 } }}
    >
      <CosmicBackground />

      {/* Back */}
      <button className="back-arrow" aria-label="Back" onClick={() => navigate('/')}>←</button>

      {/* Flowing waveform band */}
      <div className="connect-waves">
        <FlowingWaves
          colors={['var(--accent-amber)', 'var(--accent-rose)', 'var(--accent-purple)']}
          opacity={0.3}
          height={48}
        />
      </div>

      {/* Headline */}
      <motion.div
        className="connect-headline"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease, delay: 0.15 } }}
      >
        Connect<br />Your body.
      </motion.div>

      <motion.div
        className="connect-desc"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.8, delay: 0.3 } }}
      >
        Your nervous system is already broadcasting. A sensor just lets us listen closer —
        and shape music that actually responds to what's happening inside you.
      </motion.div>

      {/* BLE unavailable warning */}
      {!webBtOk && (
        <div className="connect-ble-warn">
          <strong style={{ color: 'var(--accent-rose)' }}>Bluetooth unavailable.</strong>{' '}
          Web Bluetooth requires <code>https://</code> or <code>localhost</code>.
          On iPhone, use the <strong>Bluefy</strong> browser. Simulator still works.
        </div>
      )}

      {/* Device selection card */}
      <motion.div
        className="connect-devices"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease, delay: 0.4 } }}
      >
        <div className="connect-devices-header">Choose how to listen</div>
        <div className="connect-devices-sub">Connect a device or continue without one.</div>

        {SENSORS.map((s, i) => {
          const isSel = selected === s.id
          const disabled = s.needsBle && !webBtOk

          return (
            <motion.button
              key={s.id}
              className={`device-row ${s.cls}${isSel ? ' selected' : ''}`}
              disabled={disabled}
              onClick={() => handlePickSensor(s.id)}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: disabled ? 0.35 : 1, x: 0, transition: { duration: 0.5, ease, delay: 0.5 + i * 0.1 } }}
              whileHover={{ x: 4, backgroundColor: 'var(--bg-card-hover)' }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="device-icon">{s.icon}</div>
              <div style={{ flex: 1 }}>
                <div className="device-name">{s.name}</div>
                <div className="device-sub">{s.sub}</div>
              </div>
              <span className="device-chevron">›</span>
            </motion.button>
          )
        })}

        {/* Inline BLE pairing panel */}
        <AnimatePresence>
          {sensorMeta?.needsBle && webBtOk && (
            <motion.div
              className="connect-pair-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto', transition: { duration: 0.4, ease } }}
              exit={{ opacity: 0, height: 0 }}
            >
              <button
                className={`connect-pair-btn${bleStatus.status === 'connected' ? ' connected' : ''}`}
                onClick={handleConnect}
                disabled={bleStatus.status === 'requesting' || bleStatus.status === 'connected'}
              >
                {connectBtnLabel()}
              </button>
              <div className="connect-pair-status">{statusText()}</div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="connect-divider">or</div>

        <button className="connect-no-device" onClick={() => { handlePickSensor('simulator'); navigate('/calibrate') }}>
          Continue without device
        </button>

        {/* Privacy badges */}
        <div className="connect-badges">
          <span className="connect-badge">🔒 Private — your data stays with you</span>
          <span className="connect-badge">🛡️ HIPAA-grade encryption</span>
        </div>
      </motion.div>

      {/* Continue button */}
      <motion.button
        className="connect-continue-btn"
        disabled={!canContinue}
        onClick={goContinue}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease, delay: 0.8 } }}
        whileTap={{ scale: 0.97 }}
      >
        Continue →
      </motion.button>

      {/* Privacy section */}
      <motion.div
        className="connect-privacy"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.8, delay: 1.0 } }}
      >
        <motion.div
          className="connect-privacy-icon"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          🛡️
        </motion.div>
        <div className="connect-privacy-title">Your nervous system is private.</div>
        <div className="connect-privacy-sub">Anonymous and encrypted.</div>
        <div className="connect-privacy-note">No data is stored automatically.</div>
      </motion.div>
    </motion.div>
  )
}
