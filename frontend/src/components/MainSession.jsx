import React, { useEffect, useRef, useState } from 'react'
import { ToneEngine } from '../engines/toneEngine.js'
import { store } from '../store/sessionStore.js'

const STATE_MESSAGES = {
  ventral_vagal: "You're here.",
  healthy_sympathetic: 'Moving well.',
  anxious_sympathetic: 'Something activated.',
  dorsal_vagal: 'Deep stillness.',
  burnout_rigidity: 'Holding the anchor.',
}

const TIER_GROUPS = [
  { label: 'TEMPORAL', params: ['bpm', 'rhythmic_complexity', 'beat_regularity', 'silence_ratio'] },
  { label: 'HARMONIC', params: ['key_mode', 'harmonic_tension', 'chord_complexity', 'voice_range_presence'] },
  { label: 'TIMBRAL',  params: ['brightness', 'roughness', 'warmth', 'spatial_width'] },
  { label: 'BIOLOGICAL', params: ['soma_carrier_hz', 'binaural_beat_hz', 'breath_sync_ratio', 'micro_variation'] },
]

const PARAM_SHORT = {
  bpm: 'bpm', rhythmic_complexity: 'rhy', beat_regularity: 'reg', silence_ratio: 'sil',
  key_mode: 'key', harmonic_tension: 'tns', chord_complexity: 'chd', voice_range_presence: 'vox',
  brightness: 'brt', roughness: 'rgh', warmth: 'wrm', spatial_width: 'wid',
  soma_carrier_hz: 'som', binaural_beat_hz: 'bin', breath_sync_ratio: 'brs', micro_variation: 'mic',
}

function normParam(name, value) {
  if (value == null) return 0
  if (name === 'bpm') return Math.max(0, Math.min(1, (value - 50) / 80))
  if (name === 'binaural_beat_hz') return Math.max(0, Math.min(1, value / 30))
  if (name === 'soma_carrier_hz') return Math.max(0, Math.min(1, (value - 30) / 100))
  if (name === 'key_mode') return value / 2
  return Math.max(0, Math.min(1, value))
}

export default function MainSession({ selection, ble, setAnsState, onExit, onBack }) {
  const [frame, setFrame] = useState(null)
  const [timeLeft, setTimeLeft] = useState(selection.duration_s)
  const [hrvSeries, setHrvSeries] = useState([])
  const [rrPairs, setRrPairs] = useState([]) // [[rr_i, rr_i+1], ...] last ~120
  const [bleStatus, setBleStatus] = useState(ble ? { status: ble.status, rrCount: ble.rrCount, lastRrAt: ble.lastRrAt } : null)
  const [beaconStale, setBeaconStale] = useState(false)
  const [beatKey, setBeatKey] = useState(0)
  const [beatMs, setBeatMs] = useState(1000)
  const toneRef = useRef(null)
  const bleRef = useRef(null)
  const wsRef = useRef(null)
  const startFrameRef = useRef(null)
  const frameRef = useRef(null)
  const prevRrRef = useRef(null)

  // Shared RR sink: forwards to WS AND maintains a local Poincaré buffer.
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
      toneRef.current.setSession(selection.session)

      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const host = location.host
      const userId = store.get().user_id
      const url = `${proto}://${host}/ws/session?session=${selection.session}&mode=${selection.sensor_mode}&duration_s=${selection.duration_s}&user_id=${encodeURIComponent(userId)}`
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

      ws.onclose = () => { if (!cancelled) onExit(startFrameRef.current, frameRef.current) }

      // Reuse the pre-connected BLE instance from ConnectScreen. The
      // connect step is mandatory upstream now, so no auto-pair fallback.
      if (ble && (selection.sensor_mode === 'polar' || selection.sensor_mode === 'whoop')) {
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
      // Release the RR sink but DO NOT disconnect — Dashboard keeps using it.
      if (bleRef.current && bleRef.current.setOnRr) bleRef.current.setOnRr(() => {})
      if (toneRef.current) toneRef.current.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe to BLE status for the live beacon (polar only).
  useEffect(() => {
    if (!ble) return
    const unsub = ble.onStatusChange(setBleStatus)
    return () => unsub()
  }, [ble])

  // Stale-RR beacon: red if no RR for >3s.
  useEffect(() => {
    if (!ble) return
    const iv = setInterval(() => {
      setBeaconStale(ble.lastRrAt > 0 && Date.now() - ble.lastRrAt > 3000)
    }, 1000)
    return () => clearInterval(iv)
  }, [ble])

  const state = frame?.ans?.state || 'ventral_vagal'
  const stateMsg = STATE_MESSAGES[state] || 'Listening...'
  const conf = frame?.ans?.confidence
  const mins = Math.floor(timeLeft / 60)
  const secs = Math.floor(timeLeft % 60).toString().padStart(2, '0')
  const hr = frame?.metrics?.hr
  const rmssd = frame?.metrics?.rmssd
  const sqi = frame?.metrics?.sqi
  const sd1 = frame?.metrics?.sd1
  const sd2 = frame?.metrics?.sd2
  const arousal = frame?.arousal
  const valence = frame?.valence
  const quadrant = frame?.quadrant
  const mpcScore = frame?.mpc_score
  const strategy = frame?.strategy

  return (
    <div className="screen" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', fontSize: 12 }}>
        <button
          onClick={() => {
            if (window.confirm('End session and return to dashboard?')) {
              wsRef.current?.close()
              onExit(startFrameRef.current, frameRef.current)
            }
          }}
          style={{ background: 'none', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', fontSize: 18 }}
          aria-label="Back"
        >←</button>
        <span className="secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>{selection.session}</span>
        <span className="mono">{mins}:{secs}</span>
      </div>

      {/* Sensor beacon + safe-mode pill */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 4 }}>
        <SensorBeacon mode={selection.sensor_mode} bleStatus={bleStatus} stale={beaconStale} sqi={sqi} />
        {strategy === 'safe' && <span className="pill" style={{ fontSize: 9, opacity: 0.7 }}>SAFE MODE</span>}
      </div>

      {/* Hero: CosmicOrb */}
      <CosmicOrb
        beatMs={beatMs}
        beatKey={beatKey}
        hr={hr}
        rmssd={rmssd}
        stateMsg={stateMsg}
        conf={conf}
      />

      {/* Row: Poincaré · Arousal-Valence · MPC */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '0 20px', marginBottom: 10 }}>
        <MiniCard title="POINCARÉ">
          <PoincareMini pairs={rrPairs} sd1={sd1} sd2={sd2} />
        </MiniCard>
        <MiniCard title="AROUSAL·VALENCE">
          <AvMini arousal={arousal} valence={valence} quadrant={quadrant} />
        </MiniCard>
        <MiniCard title="MUSIC FIT">
          <MpcMini score={mpcScore} />
        </MiniCard>
      </div>

      {/* HRV trend strip */}
      <div style={{ padding: '0 20px', marginBottom: 4 }}>
        <HrvChart series={hrvSeries} />
      </div>

      {/* Music params */}
      <div style={{ padding: '10px 20px 20px' }}>
        {TIER_GROUPS.map(tier => (
          <div key={tier.label} style={{ marginBottom: 8 }}>
            <div className="secondary" style={{ fontSize: 9, letterSpacing: '0.15em', marginBottom: 3 }}>{tier.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {tier.params.map(p => {
                const val = frame?.music_params?.[p]
                return (
                  <div key={p} title={val != null ? `${p}: ${typeof val === 'number' ? val.toFixed(2) : val}` : p}>
                    <div className="param-bar">
                      <span style={{ width: `${normParam(p, val) * 100}%` }} />
                    </div>
                    <div className="secondary mono" style={{ fontSize: 8, marginTop: 2, textAlign: 'center', opacity: 0.5 }}>{PARAM_SHORT[p]}</div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CosmicOrb({ beatMs, beatKey, hr, rmssd, stateMsg, conf }) {
  const stars = Array.from({ length: 12 }, (_, i) => {
    const angle = i * 137.508 * (Math.PI / 180)
    return {
      x: 130 + 90 * Math.cos(angle),
      y: 130 + 90 * Math.sin(angle),
      r: i % 3 === 0 ? 1.2 : 0.8,
      op: 0.3 + (i % 4) * 0.1,
    }
  })

  const tendrils = Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60) * (Math.PI / 180)
    const cpx = 130 + 55 * Math.cos(a - 0.3)
    const cpy = 130 + 55 * Math.sin(a - 0.3)
    const ex  = 130 + 82 * Math.cos(a)
    const ey  = 130 + 82 * Math.sin(a)
    return { id: `co-t${i}`, d: `M130,130 Q${cpx.toFixed(2)},${cpy.toFixed(2)} ${ex.toFixed(2)},${ey.toFixed(2)}` }
  })

  return (
    <div
      key={beatKey}
      className="heart-pulse"
      style={{
        '--beat-duration': `${beatMs}ms`,
        height: '34vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', position: 'relative',
      }}
    >
      <svg
        width="260" height="260"
        className="state-color"
        role="img"
        aria-label={`Biofeedback orb — ${hr != null ? Math.round(hr) + ' BPM' : 'waiting for signal'}`}
      >
        <defs>
          <radialGradient id="co-orb-fill" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="var(--state)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--state)" stopOpacity="0" />
          </radialGradient>
          {tendrils.map(t => (
            <path key={t.id} id={t.id} d={t.d} fill="none" />
          ))}
        </defs>

        {/* Star field — golden-angle spacing */}
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#E8EDF2" opacity={s.op} />
        ))}

        {/* Outer dashed cosmic ring */}
        <circle cx="130" cy="130" r="120" fill="none" stroke="var(--state)"
          strokeWidth="1" strokeDasharray="4 6" opacity="0.35" />

        {/* Slowly rotating orbital ring */}
        <g>
          <animateTransform attributeName="transform" type="rotate"
            from="0 130 130" to="360 130 130" dur="30s" repeatCount="indefinite" />
          <circle cx="130" cy="130" r="106" fill="none" stroke="var(--state)"
            strokeWidth="0.6" strokeDasharray="8 14" opacity="0.20" />
        </g>

        {/* Nerve tendrils — visible strokes */}
        {tendrils.map(t => (
          <path key={t.id + '-v'} d={t.d} stroke="var(--state)" strokeWidth="0.8"
            fill="none" opacity="0.35" strokeLinecap="round" />
        ))}

        {/* Nerve tendril traveling dots */}
        {tendrils.map((t, i) => (
          <circle key={t.id + '-d'} r="1.5" fill="var(--state)" opacity="0.7" className="state-color">
            <animateMotion dur={`${2 + i * 0.4}s`} repeatCount="indefinite"
              begin={`${i * 0.5}s`} calcMode="paced">
              <mpath href={`#${t.id}`} />
            </animateMotion>
          </circle>
        ))}

        {/* Orb glow fill */}
        <circle cx="130" cy="130" r="88" fill="url(#co-orb-fill)" />

        {/* Breathing ring */}
        <circle cx="130" cy="130" r="88" fill="rgba(0,201,167,0.04)"
          stroke="var(--state)" strokeWidth="1.5"
          className="breathe state-color"
          style={{ transformOrigin: '130px 130px' }} />

        {/* Core dark circle */}
        <circle cx="130" cy="130" r="52" fill="var(--bg-deep)"
          stroke="var(--state)" strokeWidth="1" opacity="0.9" />

        {/* HeartMark centered in 260×260 — 120×120 heart, offset by (130-60)=70 */}
        <g transform="translate(70,70)">
          <HeartMarkSession />
        </g>
      </svg>

      {/* Metric overlays */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div className="mono" style={{ fontSize: 44, lineHeight: 1, fontWeight: 300 }}>
          {hr != null ? Math.round(hr) : '—'}
          <span className="secondary" style={{ fontSize: 11, marginLeft: 6 }}>BPM</span>
        </div>
        <div className="secondary mono" style={{ fontSize: 12, marginTop: 4 }}>
          RMSSD {rmssd != null ? Math.round(rmssd) : '—'} ms
        </div>
        <div className="secondary" style={{ fontSize: 11, marginTop: 10, textAlign: 'center' }}>
          <span aria-live="polite">{stateMsg}</span>
          {conf != null && <span style={{ opacity: 0.6 }}> · {Math.round(conf * 100)}%</span>}
        </div>
      </div>
    </div>
  )
}

function HeartMarkSession() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
      <defs>
        <linearGradient id="heart-grad-session" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#6EE7D2" />
          <stop offset="100%" stopColor="#00C9A7" />
        </linearGradient>
      </defs>
      <path
        d="M60 100 C20 76,8 52,22 34 C34 19,52 22,60 40 C68 22,86 19,98 34 C112 52,100 76,60 100 Z"
        fill="url(#heart-grad-session)" opacity="0.92"
      />
      <path
        d="M60 100 C20 76,8 52,22 34 C34 19,52 22,60 40 C68 22,86 19,98 34 C112 52,100 76,60 100 Z"
        fill="none" stroke="#E8EDF2" strokeWidth="0.6" opacity="0.3"
      />
    </svg>
  )
}

function SensorBeacon({ mode, bleStatus, stale, sqi }) {
  let color = 'var(--text-secondary)'
  let label = mode === 'simulator' ? 'SIM' : mode.toUpperCase()
  if (mode === 'polar' && bleStatus) {
    if (bleStatus.status === 'connected' && !stale) color = '#00c9a7'
    else if (stale) color = '#e25555'
    else if (bleStatus.status === 'error' || bleStatus.status === 'disconnected') color = '#e25555'
  } else if (mode === 'simulator' && sqi != null) {
    color = sqi >= 0.8 ? '#00c9a7' : sqi >= 0.5 ? '#d1a54a' : '#e25555'
  }
  return (
    <span className="pill" style={{ fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
      {sqi != null && <span style={{ opacity: 0.6, marginLeft: 4 }}>SQI {Math.round(sqi * 100)}</span>}
    </span>
  )
}

function MiniCard({ title, children }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 8, minHeight: 90, display: 'flex', flexDirection: 'column' }}>
      <div className="secondary" style={{ fontSize: 8, letterSpacing: '0.1em', marginBottom: 4 }}>{title}</div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  )
}

function PoincareMini({ pairs, sd1, sd2 }) {
  if (!pairs.length) return <span className="secondary" style={{ fontSize: 9 }}>—</span>
  const w = 80, h = 70
  const flat = pairs.flat()
  const min = Math.min(...flat), max = Math.max(...flat)
  const range = Math.max(max - min, 1)
  const sx = (v) => ((v - min) / range) * (w - 8) + 4
  const sy = (v) => h - (((v - min) / range) * (h - 8) + 4)
  const cx = sx((min + max) / 2)
  const cy = sy((min + max) / 2)
  // crude ellipse scale from sd1/sd2 (ms) onto px: share the range
  const px = (w - 8) / range
  const rx = sd2 != null ? Math.min(w / 2, sd2 * px) : 0
  const ry = sd1 != null ? Math.min(h / 2, sd1 * px) : 0
  return (
    <svg width={w} height={h}>
      {pairs.map(([a, b], i) => (
        <circle key={i} cx={sx(a)} cy={sy(b)} r={1.2} fill="var(--state)" opacity={0.5 + (i / pairs.length) * 0.5} className="state-color" />
      ))}
      {rx > 0 && ry > 0 && (
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="var(--state)" strokeWidth="1" opacity="0.4" transform={`rotate(-45 ${cx} ${cy})`} className="state-color" />
      )}
    </svg>
  )
}

function AvMini({ arousal, valence, quadrant }) {
  const w = 80, h = 70
  const x = valence != null ? valence * (w - 8) + 4 : null
  const y = arousal != null ? (1 - arousal) * (h - 8) + 4 : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={w} height={h}>
        <line x1={w / 2} y1={4} x2={w / 2} y2={h - 4} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <line x1={4} y1={h / 2} x2={w - 4} y2={h / 2} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        {x != null && y != null && (
          <circle cx={x} cy={y} r={4} fill="var(--state)" className="state-color" />
        )}
      </svg>
      <div className="secondary" style={{ fontSize: 8, marginTop: 2, textTransform: 'uppercase', opacity: 0.6 }}>{quadrant || '—'}</div>
    </div>
  )
}

function MpcMini({ score }) {
  const pct = score != null ? Math.max(0, Math.min(1, score)) : 0
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="mono" style={{ fontSize: 20, fontWeight: 300 }}>
        {score != null ? Math.round(pct * 100) : '—'}
      </div>
      <div style={{ width: '90%', height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--state)' }} className="state-color" />
      </div>
    </div>
  )
}

function HrvChart({ series }) {
  if (!series.length) return null
  const w = 350, h = 80
  const min = Math.min(...series)
  const max = Math.max(...series)
  const range = Math.max(max - min, 1)
  const lastVal = series[series.length - 1]

  const zone = lastVal >= 50 ? 'optimal' : lastVal >= 30 ? 'building' : 'low'
  const zoneColor = lastVal >= 50 ? '#00C9A7' : lastVal >= 30 ? '#F5A623' : '#E8622A'
  const zoneOpacity = lastVal >= 50 ? 0.12 : 0.10

  const pts = series.map((v, i) => ({
    x: (i / (series.length - 1 || 1)) * w,
    y: h - ((v - min) / range) * h * 0.82 - h * 0.09,
  }))

  // Smooth cubic bezier path
  let curvePath = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const midX = (prev.x + curr.x) / 2
    curvePath += ` C ${midX},${prev.y} ${midX},${curr.y} ${curr.x},${curr.y}`
  }
  const fillPath = `${curvePath} L ${pts[pts.length - 1].x},${h} L 0,${h} Z`
  const lastPt = pts[pts.length - 1]

  return (
    <div style={{ position: 'relative' }}>
      <svg
        width="100%" height={h}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`HRV trend — ${zone}, ${Math.round(lastVal)} ms RMSSD`}
      >
        <defs>
          <linearGradient id="hrv-fill-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--state)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--state)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Zone background */}
        <rect x="0" y="0" width={w} height={h} fill={zoneColor} opacity={zoneOpacity} rx="4" />

        {/* Gradient fill */}
        <path d={fillPath} fill="url(#hrv-fill-grad)" />

        {/* Smooth curve */}
        <path d={curvePath} fill="none" stroke="var(--state)" strokeWidth="1.5"
          strokeLinecap="round" className="state-color" />

        {/* Live dot at end */}
        <circle
          cx={lastPt.x} cy={lastPt.y} r="3"
          fill="var(--state)" className="state-color"
          style={{ filter: 'drop-shadow(0 0 4px var(--state))' }}
        />
      </svg>

      {/* Zone label */}
      <div className="secondary mono" style={{
        position: 'absolute', bottom: 3, left: 4,
        fontSize: 10, opacity: 0.6, pointerEvents: 'none',
      }}>
        {zone} · {Math.round(lastVal)}ms
      </div>
    </div>
  )
}
