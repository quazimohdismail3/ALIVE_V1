// frontend/src/pages/Dashboard.jsx
// Post-auth dashboard: history + recommendations + session launcher
import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useSensorContext } from '../context/SensorContext.jsx'
import { getSessions, getRecommendations } from '../lib/api.js'
import { SensorStatusBar } from '../components/SensorStatusBar.jsx'

// ── Circadian logic (matches backend/context/circadian.py) ─────────────────
const SESSION_CIRCADIAN_FIT = {
  find_your_calm:    { best: [20, 22], decent: [12, 20] },
  wind_down:         { best: [21, 24], decent: [18, 24] },
  morning_emergence: { best: [5, 9],   decent: [9, 11] },
}

function circadianBadge(sessionId) {
  const fit = SESSION_CIRCADIAN_FIT[sessionId]
  if (!fit) return null
  const h = new Date().getHours()
  const inBest   = h >= fit.best[0]   && h <= fit.best[1]
  const inDecent = h >= fit.decent[0] && h <= fit.decent[1]
  if (inBest)   return { label: 'Best now',  color: '#00D084' }
  if (inDecent) return { label: 'Decent',    color: '#EF9F27' }
  return { label: 'Not ideal', color: '#7A7A96' }
}

// ── Session types ────────────────────────────────────────────────────────────
const SESSIONS = [
  { id: 'find_your_calm',    label: 'Find Your Calm',      icon: '🌊', duration: '10 min',
    desc: 'Guide your nervous system from activation into regulated stillness.' },
  { id: 'wind_down',         label: 'Wind Down',           icon: '🌙', duration: '15 min',
    desc: 'Prepare body and mind for deep, restorative sleep.' },
  { id: 'morning_emergence', label: 'Morning Emergence',   icon: '☀️', duration: '10 min',
    desc: 'Activate healthy sympathetic tone for focused, energised presence.' },
]

// ── Sensor modes ─────────────────────────────────────────────────────────────
const MODES = [
  { sensorMode: 1, backendMode: 1, key: 'phone',    label: 'Phone Only',      badge: 'Medium confidence',
    desc: 'Rear camera rPPG + mic. No hardware needed.' },
  { sensorMode: 2, backendMode: 2, key: 'h10',      label: 'Polar H10',       badge: 'High confidence',
    desc: 'ECG-grade RR intervals. Cleanest HRV signal.' },
  { sensorMode: 3, backendMode: 3, key: 'combined', label: 'Phone + Polar H10', badge: 'Highest confidence', star: true,
    desc: 'All sensors combined. Best science.' },
]

// ── Sub-components ────────────────────────────────────────────────────────────
function SessionHistoryCard({ session }) {
  const date = session.started_at
    ? new Date(session.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—'
  const durationMin = session.duration_s ? Math.round(session.duration_s / 60) : null
  const rmssd = session.rmssd_median ? Math.round(session.rmssd_median) : null

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, padding: '12px 14px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {session.session_type?.replace(/_/g, ' ') ?? 'Session'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{date}</div>
      </div>
      <div style={{ display: 'flex', gap: 16, textAlign: 'right' }}>
        {durationMin !== null && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{durationMin}m</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>duration</div>
          </div>
        )}
        {rmssd !== null && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#7C6FF7' }}>{rmssd}</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>RMSSD ms</div>
          </div>
        )}
      </div>
    </div>
  )
}

function RecommendationCard({ rec }) {
  const iconMap = { onboarding: '🎯', recovery: '💚', streak: '🔥' }
  return (
    <div style={{
      background: 'rgba(124,111,247,0.07)', border: '1px solid rgba(124,111,247,0.18)',
      borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 20 }}>{iconMap[rec.type] ?? '💡'}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{rec.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.4 }}>{rec.body}</div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ onStart, hasCalibrated = false, savedRfBpm = 5.5 }) {
  const { user, signOut } = useAuth()
  const { latestRR, bleStatus, requestBle } = useSensorContext()

  const [sessions, setSessions]             = useState([])
  const [recs, setRecs]                     = useState([])
  const [loadingData, setLoadingData]       = useState(true)
  const [modeKey, setModeKey]               = useState('h10')
  const [sessionId, setSessionId]           = useState('find_your_calm')

  const latestHR = latestRR.length > 0
    ? Math.round(60000 / latestRR[latestRR.length - 1])
    : null

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [s, r] = await Promise.all([getSessions(5), getRecommendations()])
        if (!cancelled) { setSessions(s); setRecs(r) }
      } catch (_) {
        // non-critical — dashboard still works without history
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const badges = useMemo(() => {
    const out = {}
    SESSIONS.forEach(s => { out[s.id] = circadianBadge(s.id) })
    return out
  }, [])

  const selectedMode = MODES.find(m => m.key === modeKey) ?? MODES[1]

  function handleStart(skipCalibration = false) {
    onStart({
      session: sessionId,
      sensorMode: selectedMode.sensorMode,
      backendMode: selectedMode.backendMode,
      ...(skipCalibration && { skipCalibration: true, rfBpm: savedRfBpm, rfLocked: false }),
    })
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', position: 'relative', overflow: 'hidden' }}>
      <div className="ambient-bg" />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 480, margin: '0 auto', padding: '48px 20px 40px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em' }}>ALIVE</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 2 }}>Autonomic regulation</div>
          </div>
          <button
            onClick={signOut}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-dim)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>

        {/* Live sensor status — rfLocked not relevant on Dashboard, hide it */}
        <div style={{ marginBottom: 32 }}>
          <SensorStatusBar rfLocked={null} sqi={null} />
        </div>

        {/* Recommendations */}
        {recs.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              For you
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recs.map((r, i) => <RecommendationCard key={i} rec={r} />)}
            </div>
          </div>
        )}

        {/* Session history */}
        {!loadingData && sessions.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              Recent sessions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessions.map(s => <SessionHistoryCard key={s.id} session={s} />)}
            </div>
          </div>
        )}

        {/* Session picker */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Session
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SESSIONS.map(s => {
              const badge  = badges[s.id]
              const active = sessionId === s.id
              return (
                <div
                  key={s.id}
                  onClick={() => setSessionId(s.id)}
                  className="touch-target"
                  style={{
                    padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                    border: `1.5px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.06)'}`,
                    background: active ? 'rgba(124,111,247,0.12)' : 'var(--surface)',
                    transition: 'border-color 200ms, background 200ms',
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                  }}
                >
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{s.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{s.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.duration}</span>
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 3, lineHeight: 1.4 }}>{s.desc}</div>
                    {badge && (
                      <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4, background: `${badge.color}18`, border: `1px solid ${badge.color}40`, borderRadius: 6, padding: '2px 8px' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: badge.color }} />
                        <span style={{ color: badge.color, fontSize: 10, fontWeight: 600 }}>{badge.label}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Mode picker */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Sensor mode
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {MODES.map(m => {
              const active = modeKey === m.key
              return (
                <div
                  key={m.key}
                  onClick={() => setModeKey(m.key)}
                  style={{
                    padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                    border: `1.5px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.06)'}`,
                    background: active ? 'rgba(124,111,247,0.10)' : 'var(--surface)',
                    transition: 'border-color 200ms, background 200ms',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{m.label}{m.star ? ' ✦' : ''}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 2 }}>{m.desc}</div>
                  <div style={{ color: 'var(--primary)', fontSize: 11, marginTop: 3 }}>{m.badge}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Connect H10 CTA — shown when H10/combined mode selected and not yet connected */}
        {(modeKey === 'h10' || modeKey === 'combined') && bleStatus !== 'connected' && (
          <button
            onClick={requestBle}
            disabled={bleStatus === 'reconnecting'}
            style={{
              width: '100%', background: 'transparent', color: '#7C6FF7',
              border: '1.5px solid rgba(124,111,247,0.5)', borderRadius: 12, padding: '12px',
              fontWeight: 600, fontSize: 14, cursor: bleStatus === 'reconnecting' ? 'not-allowed' : 'pointer',
              marginBottom: 12, opacity: bleStatus === 'reconnecting' ? 0.6 : 1,
            }}
          >
            {bleStatus === 'reconnecting' ? 'Connecting to H10…' : 'Connect Polar H10'}
          </button>
        )}

        {/* Begin Session CTA */}
        <button
          onClick={() => handleStart(false)}
          className="touch-target fade-slide-up"
          style={{
            width: '100%', background: 'var(--primary)', color: '#fff',
            border: 'none', borderRadius: 14, padding: '16px', fontWeight: 700,
            fontSize: 17, cursor: 'pointer', fontFamily: 'var(--font-head)',
            letterSpacing: '-0.01em', boxShadow: '0 0 24px rgba(124,111,247,0.35)',
          }}
        >
          Begin Session
        </button>

        {/* Quick Start — skip re-calibration for returning users */}
        {hasCalibrated && (
          <button
            onClick={() => handleStart(true)}
            style={{
              width: '100%', background: 'transparent', color: 'var(--text-dim)',
              border: 'none', padding: '10px', fontSize: 13, cursor: 'pointer',
              marginTop: 4,
            }}
          >
            Quick Start — use last RF ({savedRfBpm.toFixed(1)} bpm)
          </button>
        )}

        {user?.email && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, marginTop: 20 }}>
            {user.email}
          </div>
        )}
      </div>
    </div>
  )
}
