import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useApp } from '../context/AppContext.jsx'
import { RrProcessor } from '../engines/rrProcessor.js'
import { store } from '../store/sessionStore.js'
import HistoryPanel from './HistoryPanel.jsx'
import BreathingOrb from './BreathingOrb.jsx'
import AnimatedNumber from './AnimatedNumber.jsx'
import CosmicBackground from './CosmicBackground.jsx'
import '../styles/dashboard.css'

const SESSIONS = [
  { id: 'calm',      name: '💚 Calm',      copy: 'The storm has passed.',          color: 'var(--ventral)' },
  { id: 'energy',    name: '🔥 Energy',    copy: 'Move without the alarm.',        color: 'var(--sympathetic-h)' },
  { id: 'focus',     name: '📘 Focus',     copy: 'A mind pointed like a beam.',    color: 'var(--sympathetic-h)' },
  { id: 'recovery',  name: '🌊 Recovery',  copy: 'You gave a lot. Come back.',     color: 'var(--ventral)' },
  { id: 'presence',  name: '✨ Presence',  copy: 'No destination. Just here.',     color: 'var(--ventral)' },
  { id: 'adhd_flow', name: '⚡ ADHD Flow', copy: 'Channel it before it scatters.', color: 'var(--sympathetic-h)' },
]

const DURATIONS = [
  { label: '10 min', value: 600 },
  { label: '20 min', value: 1200 },
  { label: 'Open',   value: 3600 },
]

// Music reaction flavor text per session type
const MUSIC_FLAVOR = {
  calm:      { name: 'Ambient Drift',    desc: 'Slow tempo · open harmonics · warm textures' },
  energy:    { name: 'Rhythmic Pulse',   desc: 'Rising BPM · bright tones · spatial width' },
  focus:     { name: 'Binaural Flow',    desc: 'Alpha entrainment · minimal complexity · coherent' },
  recovery:  { name: 'Vagal Resonance',  desc: 'Low carrier · breath sync · consonant chords' },
  presence:  { name: 'Lydian Space',     desc: 'Major mode · high coherence · soma 60Hz' },
  adhd_flow: { name: 'Anchored Drive',   desc: 'Dynamic rhythm · beta binaural · micro-variation' },
}

const ease = [0.16, 1, 0.3, 1]

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function DashboardScreen() {
  const navigate = useNavigate()
  const { ble, sensorMode, ansState, setBle, setSelection: setAppSelection } = useApp()

  const onBack = () => { try { ble?.disconnect?.() } catch {} setBle(null); navigate('/') }
  const onStartSession = (sel) => { setAppSelection(sel); navigate('/session') }

  const [hr, setHr]             = useState(null)
  const [rmssd, setRmssd]       = useState(null)
  const [beatMs, setBeatMs]     = useState(1000)
  const [beatKey, setBeatKey]   = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pickerSession, setPickerSession] = useState(null)
  const [activeSession, setActiveSession] = useState(null)
  const procRef = useRef(null)

  const s = store.get()
  const history = (s.history || []).slice(0, 5)
  const lastSessionType = s.last_session_type || 'calm'
  const musicFlavor = MUSIC_FLAVOR[activeSession?.id ?? lastSessionType] ?? MUSIC_FLAVOR.calm

  const sensorLabel =
    sensorMode === 'polar' ? 'Polar H10'
    : sensorMode === 'whoop' ? 'WHOOP'
    : 'Simulator'

  // Live HRV from real sensor OR simulator random-walk
  useEffect(() => {
    const proc = new RrProcessor()
    procRef.current = proc
    const metricsIv = setInterval(() => {
      const m = proc.metrics()
      if (m) { setHr(m.hr); setRmssd(m.rmssd) }
    }, 1000)

    let simTimeout = null
    let currentRr = 1000

    if (ble && ble.setOnRr) {
      ble.setOnRr((rr) => {
        proc.push(rr)
        setBeatMs(Math.max(300, Math.min(1500, rr)))
        setBeatKey(k => k + 1)
      })
    } else {
      const scheduleNext = () => {
        const jitter = (Math.random() - 0.5) * 60
        currentRr = Math.max(935, Math.min(1035, currentRr + jitter))
        proc.push(currentRr)
        setBeatMs(currentRr)
        setBeatKey(k => k + 1)
        simTimeout = setTimeout(scheduleNext, currentRr)
      }
      scheduleNext()
    }

    return () => {
      clearInterval(metricsIv)
      if (simTimeout) clearTimeout(simTimeout)
      if (ble && ble.setOnRr) ble.setOnRr(() => {})
    }
  }, [ble])

  // Derive HRV trend from rmssd direction
  const trend = rmssd == null ? '—' : rmssd > 55 ? '↑' : rmssd > 40 ? '~' : '↓'
  const trendColor = rmssd == null ? 'var(--text-muted)'
    : rmssd > 55 ? 'var(--accent-teal)'
    : rmssd > 40 ? 'var(--accent-amber)'
    : 'var(--accent-rose)'

  return (
    <motion.div
      className="dash-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease } }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.4 } }}
    >
      <CosmicBackground />

      {/* Header */}
      <div className="dash-header">
        <button className="dash-header-icon" onClick={onBack} aria-label="Back to home">☰</button>
        <div className="dash-title">Vagus</div>
        <div className="dash-header-icon dash-bell" aria-label="Notifications">
          🔔
          <div className="dash-notif-dot" />
        </div>
      </div>

      {/* Greeting */}
      <motion.div
        className="dash-greeting"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease, delay: 0.1 } }}
      >
        <div className="dash-greeting-name">{getGreeting()}</div>
        <div className="dash-greeting-sub">Your body is the instrument.</div>
      </motion.div>

      {/* Connection status pill */}
      <motion.div
        className="dash-conn-pill"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.6, delay: 0.2 } }}
      >
        <div>
          <div className="dash-conn-pill-label">Your body drives the music in real time</div>
          <div className="dash-conn-sensor">
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-teal)', display: 'inline-block' }} />
            Connected · {sensorLabel}
          </div>
        </div>
        <div className="dash-live-badge">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-rose)', display: 'inline-block', animation: 'nerve-drift 1.5s ease-in-out infinite' }} />
          LIVE
        </div>
      </motion.div>

      {/* Central BreathingOrb */}
      <motion.div
        className="dash-orb-section"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1, transition: { duration: 0.8, ease, delay: 0.3 } }}
      >
        <div
          key={beatKey}
          className="heart-pulse"
          style={{ '--beat-duration': `${beatMs}ms` }}
        >
          <BreathingOrb
            hrvValue={rmssd}
            label="RMSSD"
            stateKey={ansState}
            size="large"
          />
        </div>
        <div className="dash-orb-loop-label">Body → Music → Body</div>
        <div className="dash-orb-loop-sub">● LIVE LOOP</div>
      </motion.div>

      {/* Stats row */}
      <motion.div
        className="dash-stats"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease, delay: 0.4 } }}
      >
        <div className="dash-stat">
          <div className="dash-stat-label">HR</div>
          <div className="dash-stat-value">
            <AnimatedNumber value={hr ?? 0} duration={800} />
          </div>
          <div className="dash-stat-unit">BPM</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-label">RMSSD</div>
          <div className="dash-stat-value">
            <AnimatedNumber value={rmssd ?? 0} duration={800} />
          </div>
          <div className="dash-stat-unit">MS</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-label">TREND</div>
          <div className="dash-stat-value" style={{ color: trendColor }}>{trend}</div>
          <div className="dash-stat-unit">HRV</div>
        </div>
      </motion.div>

      {/* Music reaction card */}
      <motion.div
        className="dash-music-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease, delay: 0.45 } }}
        whileHover={{ scale: 1.01 }}
      >
        <div className="dash-music-tag">MUSIC REACTION</div>
        <div className="dash-music-name">{musicFlavor.name}</div>
        <div className="dash-music-sub">{musicFlavor.desc}</div>
      </motion.div>

      {/* CTA card */}
      <motion.div
        className="dash-cta"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease, delay: 0.5 } }}
      >
        <div>
          <div className="dash-cta-label">Let your body<br />take over</div>
          <div className="dash-cta-sub">20 min recommended</div>
        </div>
        <motion.button
          className="dash-play-btn"
          onClick={() => {
            // Default to recovery session if none selected
            const sess = activeSession ?? SESSIONS.find(s => s.id === 'recovery')
            setPickerSession(sess)
          }}
          animate={{ boxShadow: ['0 0 20px rgba(167,139,250,0.4)', '0 0 36px rgba(167,139,250,0.7)', '0 0 20px rgba(167,139,250,0.4)'] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          whileTap={{ scale: 0.92 }}
        >
          ▶
        </motion.button>
      </motion.div>

      {/* Session type pills */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.6, delay: 0.55 } }}
      >
        <div className="dash-pills-label">SESSION TYPE</div>
        <div className="dash-pills-scroll">
          {SESSIONS.map((s, i) => (
            <motion.button
              key={s.id}
              className={`dash-pill-btn${activeSession?.id === s.id ? ' active' : ''}`}
              onClick={() => { setActiveSession(s); setPickerSession(s) }}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.4, ease, delay: 0.6 + i * 0.05 } }}
              whileTap={{ scale: 0.95 }}
            >
              {s.name}
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Previous sessions */}
      {history.length > 0 && (
        <motion.div
          className="dash-sessions"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.6, delay: 0.7 } }}
        >
          <div className="dash-sessions-header">
            <div className="dash-sessions-title">Previous Sessions</div>
            <button className="dash-sessions-see-all" onClick={() => setHistoryOpen(true)}>See All →</button>
          </div>
          {history.map((h, i) => (
            <motion.div
              key={i}
              className="dash-history-card"
              whileHover={{ scale: 1.01 }}
            >
              <div className="dash-history-left">
                <div className="dash-history-session">🔵 {h.session} Session</div>
                <div className="dash-history-meta">
                  {new Date(h.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {Math.round((h.duration_s || 600) / 60)} min
                </div>
              </div>
              <div>
                <div className="dash-history-delta" style={{ color: h.delta_rmssd >= 0 ? 'var(--accent-teal)' : 'var(--accent-rose)' }}>
                  {h.delta_rmssd >= 0 ? '+' : ''}{Math.round(h.delta_rmssd ?? 0)}ms
                </div>
                <div className="dash-history-delta-label">RMSSD Δ</div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}

      {pickerSession && (
        <DurationSheet
          session={pickerSession}
          sensorMode={sensorMode}
          onCancel={() => setPickerSession(null)}
          onPick={(duration_s) => {
            setPickerSession(null)
            onStartSession({ session: pickerSession.id, duration_s, sensor_mode: sensorMode })
          }}
        />
      )}
    </motion.div>
  )
}

function DurationSheet({ session, sensorMode, onCancel, onPick }) {
  return (
    <motion.div
      className="dur-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="dur-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
        onClick={e => e.stopPropagation()}
      >
        <div className="dur-sheet-handle" />
        <div className="dur-sheet-title">{session.name}</div>
        <div className="dur-sheet-copy">{session.copy}</div>
        <div className="dur-sheet-dur-label">DURATION</div>
        <div className="dur-sheet-btns">
          {DURATIONS.map(d => (
            <button
              key={d.value}
              className="dur-sheet-btn"
              onClick={() => onPick(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
