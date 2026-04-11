import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useApp } from '../context/AppContext.jsx'
import { ToneEngine } from '../engines/toneEngine.js'
import { store } from '../store/sessionStore.js'
import CosmicBackground from './CosmicBackground.jsx'
import '../styles/session.css'

const TIER_GROUPS = [
  { label: 'TEMPORAL',   params: ['bpm', 'rhythmic_complexity', 'beat_regularity', 'silence_ratio'] },
  { label: 'HARMONIC',   params: ['key_mode', 'harmonic_tension', 'chord_complexity', 'voice_range_presence'] },
  { label: 'TIMBRAL',    params: ['brightness', 'roughness', 'warmth', 'spatial_width'] },
  { label: 'BIOLOGICAL', params: ['soma_carrier_hz', 'binaural_beat_hz', 'breath_sync_ratio', 'micro_variation'] },
]

const TIER_COLORS = ['#2563EB', '#7C3AED', '#F59E0B', '#00C9A7']

const PARAM_SHORT = {
  bpm: 'bpm', rhythmic_complexity: 'rhy', beat_regularity: 'reg', silence_ratio: 'sil',
  key_mode: 'key', harmonic_tension: 'tns', chord_complexity: 'chd', voice_range_presence: 'vox',
  brightness: 'brt', roughness: 'rgh', warmth: 'wrm', spatial_width: 'wid',
  soma_carrier_hz: 'som', binaural_beat_hz: 'bin', breath_sync_ratio: 'brs', micro_variation: 'mic',
}

const ANS_LABELS = {
  ventral_vagal:       { label: 'Recovering',   sub: 'Parasympathetic — rest & restore' },
  healthy_sympathetic: { label: 'Energized',     sub: 'Healthy activation — in the zone' },
  anxious_sympathetic: { label: 'Activated',     sub: 'High arousal — music is calming' },
  dorsal_vagal:        { label: 'Withdrawing',   sub: 'Low tone — gentle stimulation active' },
  burnout_rigidity:    { label: 'Rigid',         sub: 'Burnout pattern — recovery mode' },
}

const QUADRANT_NAMES = {
  Q1: 'Activated Joy',
  Q2: 'Tense Focus',
  Q3: 'Withdrawn',
  Q4: 'Elevated Calm',
}

function normParam(name, value) {
  if (value == null) return 0
  if (name === 'bpm') return Math.max(0, Math.min(1, (value - 50) / 80))
  if (name === 'binaural_beat_hz') return Math.max(0, Math.min(1, value / 30))
  if (name === 'soma_carrier_hz') return Math.max(0, Math.min(1, (value - 30) / 100))
  if (name === 'key_mode') return value / 2
  return Math.max(0, Math.min(1, value))
}

const ease = [0.16, 1, 0.3, 1]

export default function LiveSessionScreen() {
  const navigate = useNavigate()
  const { selection, ble, setAnsState, setStartFrame, setEndFrame } = useApp()

  const [frame, setFrame] = useState(null)
  const [timeLeft, setTimeLeft] = useState(selection?.duration_s ?? 600)
  const [hrvSeries, setHrvSeries] = useState([])
  const [rrPairs, setRrPairs] = useState([])
  const [bleStatus, setBleStatus] = useState(ble ? { status: ble.status, rrCount: ble.rrCount, lastRrAt: ble.lastRrAt } : null)
  const [beaconStale, setBeaconStale] = useState(false)
  const [beatKey, setBeatKey] = useState(0)
  const [beatMs, setBeatMs] = useState(1000)
  const [showExitModal, setShowExitModal] = useState(false)
  const [showReconnectModal, setShowReconnectModal] = useState(false)
  const toneRef = useRef(null)
  const bleRef = useRef(null)
  const wsRef = useRef(null)
  const startFrameRef = useRef(null)
  const frameRef = useRef(null)
  const prevRrRef = useRef(null)

  const rrSink = (ws) => (rr) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ rr }))
    const prev = prevRrRef.current
    prevRrRef.current = rr
    setBeatMs(Math.max(300, Math.min(1500, rr)))
    setBeatKey(k => k + 1)
    if (prev != null) {
      setRrPairs(p => {
        const next = [...p, [prev, rr]]
        return next.length > 120 ? next.slice(-120) : next
      })
    }
  }

  useEffect(() => {
    let cancelled = false

    async function setup() {
      toneRef.current = new ToneEngine()
      await toneRef.current.start()
      toneRef.current.setSession(selection?.session ?? 'calm')

      const userId = store.get().user_id
      const url = `/ws/session?session=${selection?.session ?? 'calm'}&mode=${selection?.sensor_mode ?? 'simulator'}&duration_s=${selection?.duration_s ?? 600}&user_id=${encodeURIComponent(userId)}`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onmessage = (ev) => {
        if (cancelled) return
        const msg = JSON.parse(ev.data)
        if (msg.status === 'buffering' || msg.error) return
        if (!startFrameRef.current) { startFrameRef.current = msg }
        frameRef.current = msg
        setFrame(msg)
        if (msg.state) {
          setHrvSeries(prev => {
            const next = [...prev, msg.metrics.rmssd]
            return next.slice(-60)
          })
        }
        if (msg.ans?.actionable) {
          setAnsState(msg.ans.state)
          toneRef.current.setAnsState(msg.ans.state)
        }
        if (msg.music_params) {
          toneRef.current.apply(msg.music_params)
        }
      }

      ws.onclose = () => {
        if (!cancelled) {
          setStartFrame(startFrameRef.current)
          setEndFrame(frameRef.current)
          navigate('/insights')
        }
      }

      if (ble && (selection?.sensor_mode === 'polar' || selection?.sensor_mode === 'whoop')) {
        bleRef.current = ble
        if (ble.setOnRr) ble.setOnRr(rrSink(ws))
        else ble.onRr = rrSink(ws)
      }
    }

    setup()
    const iv = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000)
    return () => {
      cancelled = true
      clearInterval(iv)
      if (wsRef.current) wsRef.current.close()
      if (bleRef.current && bleRef.current.setOnRr) bleRef.current.setOnRr(() => {})
      if (toneRef.current) toneRef.current.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ble) return
    const unsub = ble.onStatusChange((snap) => {
      setBleStatus(snap)
      if (snap.status === 'error' && snap.error === 'reconnect_failed') {
        setShowReconnectModal(true)
      }
    })
    return () => unsub()
  }, [ble])

  useEffect(() => {
    if (!ble) return
    const iv = setInterval(() => {
      setBeaconStale(ble.lastRrAt > 0 && Date.now() - ble.lastRrAt > 3000)
    }, 1000)
    return () => clearInterval(iv)
  }, [ble])

  // Derived values
  const ansState = frame?.ans?.state || 'ventral_vagal'
  const ansLabel = ANS_LABELS[ansState] ?? { label: 'Calibrating', sub: 'Reading your state…' }
  const mins = Math.floor(timeLeft / 60)
  const secs = Math.floor(timeLeft % 60).toString().padStart(2, '0')
  const hr = frame?.metrics?.hr
  const rmssd = frame?.metrics?.rmssd
  const sqi = frame?.metrics?.sqi
  const sd1 = frame?.metrics?.sd1
  const sd2 = frame?.metrics?.sd2
  const affectArousal = frame?.affect?.arousal
  const affectValence = frame?.affect?.valence
  const quadrant = QUADRANT_NAMES[frame?.affect?.quadrant] ?? frame?.affect?.quadrant ?? null
  const fitScore = frame?.mpc_score != null
    ? Math.max(0, Math.min(1, 1 - frame.mpc_score))
    : null
  const strategy = frame?.strategy

  const bpm = frame?.music_params?.bpm
  const tempoText = bpm == null ? '—'
    : bpm < 65 ? 'very slow'
    : bpm < 80 ? 'slowing'
    : bpm < 95 ? 'steady'
    : bpm < 110 ? 'lifting'
    : 'elevated'
  const harmTension = frame?.music_params?.harmonic_tension
  const harmonyText = harmTension == null ? '—'
    : harmTension < 0.3 ? 'deepening'
    : harmTension < 0.6 ? 'balanced'
    : 'brightening'
  const roughness = frame?.music_params?.roughness ?? 0
  const warmth = frame?.music_params?.warmth ?? 0
  const textureText = frame?.music_params == null ? '—'
    : roughness < 0.3 && warmth > 0.5 ? 'warm, smooth'
    : roughness > 0.6 ? 'complex, textured'
    : warmth > 0.6 ? 'warm'
    : 'neutral'

  return (
    <motion.div
      className="session-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease } }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.4 } }}
    >
      <CosmicBackground />

      {/* TOP BAR */}
      <div className="session-topbar">
        <button
          className="session-back-btn"
          onClick={() => setShowExitModal(true)}
          aria-label="End session"
        >‹</button>

        <div className="session-state-info">
          <div className="session-state-label">{ansLabel.label}</div>
          <div className="session-state-sub">{ansLabel.sub}</div>
        </div>

        <span className="session-timer">{mins}:{secs}</span>

        <MiniOrb hr={hr} beatMs={beatMs} beatKey={beatKey} />
      </div>

      {/* Sensor beacon + safe-mode pill */}
      <div className="session-beacons">
        <SensorBeacon mode={selection?.sensor_mode ?? 'simulator'} bleStatus={bleStatus}
                      stale={beaconStale} sqi={sqi} />
        {strategy === 'safe' && (
          <span className="pill" style={{ fontSize: 9, opacity: 0.7 }}>SAFE MODE</span>
        )}
      </div>

      {/* Hook line */}
      <div className="session-hook">Live music composed by your body</div>

      {/* HERO: Cosmic Ribbon Wave */}
      <div className="session-hero">
        <CosmicRibbonWave rmssd={rmssd} />
      </div>

      {/* PARAMETER MAPPING */}
      <div className="session-params">
        {[
          { left: 'Heart',     right: 'Tempo',   value: tempoText },
          { left: 'HRV',       right: 'Harmony', value: harmonyText },
          { left: 'Stability', right: 'Texture', value: textureText },
        ].map(({ left, right, value }) => (
          <div key={left} className="session-param-row">
            <div className="session-param-left">
              <span>{left}</span>
              <span className="session-param-arrow">→</span>
              <span>{right}</span>
            </div>
            <span className="session-param-value state-color" style={{ color: 'var(--state)' }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* MINI-CARDS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10,
                    padding: '10px 20px', flexShrink: 0 }}>
        <MiniCard title="POINCARÉ">
          <PoincareMini pairs={rrPairs} sd1={sd1} sd2={sd2} />
        </MiniCard>
        <MiniCard title="AROUSAL·VALENCE">
          <AvMini arousal={affectArousal} valence={affectValence} quadrant={quadrant} />
        </MiniCard>
        <MiniCard title="MUSIC FIT">
          <MpcMini score={fitScore} />
        </MiniCard>
      </div>

      {/* HRV TRAJECTORY */}
      <div className="session-hrv-section">
        <HRVTrajectoryStrip series={hrvSeries} />
      </div>

      {/* MUSIC PARAM TIERS */}
      {TIER_GROUPS.map((tier, ti) => (
        <div key={tier.label} className="session-tier-section" style={{ paddingBottom: 0 }}>
          <div className="session-tier-label"
               style={{ borderColor: TIER_COLORS[ti] }}>
            {tier.label}
          </div>
          <div className="session-tier-bars">
            {tier.params.map(p => {
              const val = frame?.music_params?.[p]
              return (
                <div key={p} title={val != null ? `${p}: ${typeof val === 'number' ? val.toFixed(2) : val}` : p}>
                  <div className="param-bar">
                    <span style={{ width: `${normParam(p, val) * 100}%` }} />
                  </div>
                  <div className="session-param-short">{PARAM_SHORT[p]}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Reconnect banner — non-blocking, shown during auto-reconnect attempts */}
      {bleStatus?.status === 'reconnecting' && (
        <div className="session-reconnect-banner">
          Reconnecting to H10… ({bleStatus.reconnectAttempt} / 5)
        </div>
      )}

      {/* BOTTOM BUTTON */}
      <button
        className="session-pause-btn"
        onClick={() => setShowExitModal(true)}
      >
        Pause experience
      </button>

      {/* Exit confirm modal */}
      {showExitModal && (
        <ExitConfirmModal
          onConfirm={() => {
            setShowExitModal(false)
            wsRef.current?.close()
          }}
          onCancel={() => setShowExitModal(false)}
        />
      )}

      {/* Reconnect exhaustion modal */}
      {showReconnectModal && (
        <ReconnectFailedModal
          onContinue={() => setShowReconnectModal(false)}
          onEnd={() => {
            setShowReconnectModal(false)
            wsRef.current?.close()
          }}
        />
      )}
    </motion.div>
  )
}

// ─── MiniOrb ──────────────────────────────────────────────────────────────────
function MiniOrb({ hr, beatMs, beatKey }) {
  return (
    <div style={{ width: 48, height: 48, position: 'relative', flexShrink: 0 }}
         key={beatKey}>
      <svg width="48" height="48" viewBox="0 0 48 48" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="mo-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="var(--state)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--state)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="24" cy="24" r="22"
                fill="url(#mo-glow)"
                className="heart-pulse state-color"
                style={{ '--beat-duration': `${beatMs ?? 800}ms`,
                         transformOrigin: '24px 24px' }} />
        <circle cx="24" cy="24" r="19"
                fill="var(--bg-deep)"
                stroke="var(--state)" strokeWidth="1" strokeOpacity="0.6"
                className="state-color" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-mono)', fontSize: 12,
                    fontWeight: 500, color: 'var(--text-primary)',
                    pointerEvents: 'none' }}>
        {hr != null ? Math.round(hr) : '—'}
      </div>
    </div>
  )
}

// ─── CosmicRibbonWave ─────────────────────────────────────────────────────────
function CosmicRibbonWave({ rmssd }) {
  const amp = Math.min(1, Math.max(0.2, (rmssd ?? 40) / 80))

  const strands = [
    { id: 'crw-s0', y: 112, c1: amp * 52, c2: -(amp * 52), color: '#7C3AED', w: 2.5, op: 0.55, dur: '5s',   begin: '0s'   },
    { id: 'crw-s1', y: 118, c1: -(amp * 42), c2: amp * 38,  color: '#2563EB', w: 2,   op: 0.45, dur: '7s',   begin: '1s'   },
    { id: 'crw-s2', y: 104, c1: amp * 58,  c2: -(amp * 30), color: '#0EA5E9', w: 1.5, op: 0.38, dur: '4.5s', begin: '1.5s' },
    { id: 'crw-s3', y: 115, c1: -(amp * 28), c2: amp * 44,  color: '#F59E0B', w: 1,   op: 0.30, dur: '6s',   begin: '2s'   },
  ]

  const makeD = (s, sign = 1) =>
    `M 0,${s.y} C 108,${s.y + s.c1 * sign} 322,${s.y + s.c2 * sign} 430,${s.y}`

  const makeFill = (s, sign = 1) =>
    `${makeD(s, sign)} L 430,220 L 0,220 Z`

  const centerD = makeD(strands[0])

  return (
    <div style={{ position: 'relative', width: '100%', height: 220,
                  overflow: 'hidden', flexShrink: 0,
                  background: 'linear-gradient(180deg, rgba(6,10,14,0) 0%, rgba(12,18,24,0.4) 100%)' }}>
      <svg width="100%" height="220" viewBox="0 0 430 220"
           preserveAspectRatio="xMidYMid slice" style={{ display: 'block' }}>
        <defs>
          {strands.map((s, i) => (
            <linearGradient key={`crw-g${i}`} id={`crw-g${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={s.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
          <path id="crw-center" d={centerD} fill="none" />
        </defs>

        {[...strands].reverse().map((s, ri) => {
          const i = strands.length - 1 - ri
          const d1 = makeD(s, 1)
          const d2 = makeD(s, -1)
          const f1 = makeFill(s, 1)
          const f2 = makeFill(s, -1)
          const ks = '0.45 0.05 0.55 0.95;0.45 0.05 0.55 0.95'
          return (
            <g key={s.id}>
              <path d={f1} fill={`url(#crw-g${i})`} opacity={s.op * 0.7}>
                <animate attributeName="d"
                  values={`${f1};${f2};${f1}`}
                  dur={s.dur} begin={s.begin}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keyTimes="0;0.5;1"
                  keySplines={ks} />
              </path>
              <path d={d1} fill="none" stroke={s.color} strokeWidth={s.w}
                    strokeLinecap="round" opacity={s.op}>
                <animate attributeName="d"
                  values={`${d1};${d2};${d1}`}
                  dur={s.dur} begin={s.begin}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keyTimes="0;0.5;1"
                  keySplines={ks} />
              </path>
            </g>
          )
        })}

        <circle r="3" fill="rgba(255,255,255,0.85)"
                style={{ filter: 'drop-shadow(0 0 5px #7C3AED) drop-shadow(0 0 2px white)' }}>
          <animateMotion dur="4.5s" repeatCount="indefinite" begin="0s" calcMode="paced"
                         fill="freeze">
            <mpath href="#crw-center" />
          </animateMotion>
        </circle>
      </svg>

      <div style={{ position: 'absolute', inset: 0, display: 'flex',
                    flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 10, pointerEvents: 'none' }}>
        <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15,
                      fontFamily: 'var(--font-display)', textAlign: 'center', lineHeight: 1.4,
                      textShadow: '0 0 32px rgba(0,0,0,0.95), 0 2px 8px rgba(0,0,0,0.8)' }}>
          ◈ Composing in real time...
        </div>
      </div>
    </div>
  )
}

// ─── HRVTrajectoryStrip ───────────────────────────────────────────────────────
function HRVTrajectoryStrip({ series }) {
  const w = 350, h = 52

  const header = (
    <div className="session-hrv-header">
      <span>HRV TRAJECTORY</span>
      {series.length > 0 && (
        <span className="state-color" style={{ color: 'var(--state)' }}>
          {Math.round(series[series.length - 1])} ms
        </span>
      )}
    </div>
  )

  if (!series.length) {
    return (
      <div>
        {header}
        <div style={{ height: h, background: 'rgba(255,255,255,0.02)', borderRadius: 4 }} />
      </div>
    )
  }

  const last = series[series.length - 1]
  const min = Math.min(...series)
  const max = Math.max(...series)
  const range = Math.max(max - min, 1)

  const trend = series.length >= 10
    ? (series[series.length - 1] - series[series.length - 10]) / 10
    : 0
  const trendText = trend > 0.5
    ? 'Moving toward recovery →'
    : trend < -0.5
    ? 'Stress building — breathe ↓'
    : 'Holding steady ·'

  const pts = series.map((v, i) => ({
    x: (i / (series.length - 1 || 1)) * w,
    y: h - ((v - min) / range) * h * 0.80 - h * 0.10,
  }))

  let curvePath = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const midX = (prev.x + curr.x) / 2
    curvePath += ` C ${midX},${prev.y} ${midX},${curr.y} ${curr.x},${curr.y}`
  }
  const fillPath = `${curvePath} L ${w},${h} L 0,${h} Z`
  const lastPt = pts[pts.length - 1]

  return (
    <div>
      {header}
      <div style={{ position: 'relative' }}>
        <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}
             preserveAspectRatio="none" role="img"
             aria-label={`HRV trajectory — ${Math.round(last)} ms RMSSD`}>
          <defs>
            <linearGradient id="hrv-traj-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--state)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--state)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fillPath} fill="url(#hrv-traj-grad)" />
          <path d={curvePath} fill="none" stroke="var(--state)" strokeWidth="1.5"
                strokeLinecap="round" className="state-color" />
          <circle cx={lastPt.x} cy={lastPt.y} r="2.5"
                  fill="var(--state)" className="state-color"
                  style={{ filter: 'drop-shadow(0 0 3px var(--state))' }} />
        </svg>
      </div>
      <div style={{ fontSize: 10, marginTop: 3, opacity: 0.65, color: 'var(--text-secondary)' }}>
        {trendText}
      </div>
    </div>
  )
}

// ─── ExitConfirmModal ─────────────────────────────────────────────────────────
function ExitConfirmModal({ onConfirm, onCancel }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430,
          background: '#0e0e1a',
          border: '1px solid var(--border-subtle)',
          borderBottom: 'none',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '20px 20px calc(env(safe-area-inset-bottom, 0px) + 32px)',
        }}
      >
        <div style={{
          width: 40, height: 4, background: 'var(--border-medium)',
          borderRadius: 2, margin: '0 auto 20px',
        }} />
        <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-display)', marginBottom: 8 }}>
          End session?
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 28, lineHeight: 1.5 }}>
          Your progress will be saved up to this point.
        </div>
        <button
          onClick={onConfirm}
          style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                   background: 'var(--gradient-purple-blue)', color: '#fff',
                   fontSize: 15, fontWeight: 500, cursor: 'pointer', marginBottom: 10, minHeight: 44 }}>
          End &amp; save
        </button>
        <button
          onClick={onCancel}
          style={{ width: '100%', padding: '14px', borderRadius: 12,
                   border: '1px solid var(--border-medium)', background: 'transparent',
                   color: 'var(--text-secondary)', fontSize: 15, cursor: 'pointer', minHeight: 44 }}>
          Keep going
        </button>
      </div>
    </div>
  )
}

// ─── ReconnectFailedModal ─────────────────────────────────────────────────────
function ReconnectFailedModal({ onContinue, onEnd }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 430,
          background: '#0e0e1a',
          border: '1px solid var(--border-subtle)',
          borderBottom: 'none',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '20px 20px calc(env(safe-area-inset-bottom, 0px) + 32px)',
        }}
      >
        <div style={{
          width: 40, height: 4, background: 'var(--border-medium)',
          borderRadius: 2, margin: '0 auto 20px',
        }} />
        <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-display)', marginBottom: 8 }}>
          Lost connection to H10
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 28, lineHeight: 1.5 }}>
          Couldn't reconnect after 5 attempts. Music is still playing — you can continue without the sensor, or end the session.
        </div>
        <button
          onClick={onContinue}
          style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                   background: 'var(--gradient-purple-blue)', color: '#fff',
                   fontSize: 15, fontWeight: 500, cursor: 'pointer', marginBottom: 10, minHeight: 44 }}>
          Continue without sensor
        </button>
        <button
          onClick={onEnd}
          style={{ width: '100%', padding: '14px', borderRadius: 12,
                   border: '1px solid var(--border-medium)', background: 'transparent',
                   color: 'var(--text-secondary)', fontSize: 15, cursor: 'pointer', minHeight: 44 }}>
          End session
        </button>
      </div>
    </div>
  )
}

// ─── SensorBeacon ─────────────────────────────────────────────────────────────
function SensorBeacon({ mode, bleStatus, stale, sqi }) {
  let color = 'var(--text-secondary)'
  const label = mode === 'simulator' ? 'SIM' : mode.toUpperCase()
  if (mode === 'polar' && bleStatus) {
    if (bleStatus.status === 'connected' && !stale) color = '#00c9a7'
    else if (stale) color = '#e25555'
    else if (bleStatus.status === 'error' || bleStatus.status === 'disconnected') color = '#e25555'
  } else if (mode === 'simulator' && sqi != null) {
    color = sqi >= 0.8 ? '#00c9a7' : sqi >= 0.5 ? '#d1a54a' : '#e25555'
  }
  return (
    <span className="pill" style={{ fontSize: 9, display: 'inline-flex',
                                     alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%',
                     background: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
      {sqi != null && (
        <span style={{ opacity: 0.6, marginLeft: 4 }}>SQI {Math.round(sqi * 100)}</span>
      )}
    </span>
  )
}

// ─── MiniCard ─────────────────────────────────────────────────────────────────
function MiniCard({ title, children }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 8, padding: 8, minHeight: 90,
                  display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--text-muted)',
                    marginBottom: 4 }}>{title}</div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center',
                    justifyContent: 'center' }}>{children}</div>
    </div>
  )
}

// ─── PoincareMini ─────────────────────────────────────────────────────────────
function PoincareMini({ pairs, sd1, sd2 }) {
  if (!pairs.length) return <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>—</span>
  const w = 80, h = 70
  const flat = pairs.flat()
  const min = Math.min(...flat), max = Math.max(...flat)
  const range = Math.max(max - min, 1)
  const sx = (v) => ((v - min) / range) * (w - 8) + 4
  const sy = (v) => h - (((v - min) / range) * (h - 8) + 4)
  const cx = sx((min + max) / 2)
  const cy = sy((min + max) / 2)
  const px = (w - 8) / range
  const rx = sd2 != null ? Math.min(w / 2, sd2 * px) : 0
  const ry = sd1 != null ? Math.min(h / 2, sd1 * px) : 0
  return (
    <svg width={w} height={h}>
      {pairs.map(([a, b], i) => (
        <circle key={i} cx={sx(a)} cy={sy(b)} r={1.2}
                fill="var(--state)" opacity={0.5 + (i / pairs.length) * 0.5}
                className="state-color" />
      ))}
      {rx > 0 && ry > 0 && (
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
                 fill="none" stroke="var(--state)" strokeWidth="1" opacity="0.4"
                 transform={`rotate(-45 ${cx} ${cy})`}
                 className="state-color" />
      )}
    </svg>
  )
}

// ─── AvMini ───────────────────────────────────────────────────────────────────
function AvMini({ arousal, valence, quadrant }) {
  const w = 80, h = 70
  const x = valence != null ? ((valence + 1) / 2) * (w - 8) + 4 : null
  const y = arousal != null ? (1 - (arousal + 1) / 2) * (h - 8) + 4 : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={w} height={h}>
        <line x1={w / 2} y1={4} x2={w / 2} y2={h - 4}
              stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <line x1={4} y1={h / 2} x2={w - 4} y2={h / 2}
              stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        {x != null && y != null && (
          <circle cx={x} cy={y} r={4} fill="var(--state)" className="state-color" />
        )}
      </svg>
      <div style={{ fontSize: 8, marginTop: 2, textTransform: 'uppercase',
                    opacity: 0.6, color: 'var(--text-muted)' }}>
        {quadrant || '—'}
      </div>
    </div>
  )
}

// ─── MpcMini ──────────────────────────────────────────────────────────────────
function MpcMini({ score }) {
  const pct = score != null ? Math.max(0, Math.min(1, score)) : null
  const scoreNum = pct != null ? Math.round(pct * 100) : null
  const color = scoreNum == null ? 'var(--text-muted)'
    : scoreNum >= 75 ? '#00C9A7'
    : scoreNum >= 50 ? '#F5A623'
    : '#E8622A'

  const R = 26
  const C = 2 * Math.PI * R
  const dash = pct != null ? pct * C : 0
  const gap = C - dash

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={R} fill="none"
                stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
        <circle cx="30" cy="30" r={R} fill="none"
                stroke={color} strokeWidth="4"
                strokeDasharray={`${dash} ${gap}`}
                strokeLinecap="round"
                transform="rotate(-90 30 30)"
                style={{ transition: 'stroke-dasharray 600ms ease-in-out' }} />
        <text x="30" y="30" textAnchor="middle" dominantBaseline="central"
              fill="var(--text-primary)"
              fontSize="11" fontFamily="var(--font-mono)" fontWeight="500">
          {scoreNum ?? '—'}
        </text>
      </svg>
    </div>
  )
}
