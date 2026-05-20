// frontend/src/pages/Dashboard.jsx
// Post-auth dashboard: history + recommendations + session launcher
import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useSensorContext } from '../context/SensorContext.jsx'
import { getSessions, getRecommendations } from '../lib/api.js'
import { SensorStatusBar } from '../components/SensorStatusBar.jsx'
import { SESSIONS, getSessionList } from '../config/sessions.js'

// ── Color map for colorKey ────────────────────────────────────────────────────
const COLOR = {
  teal:   '#3FBFA8',
  indigo: '#7C6FF7',
  gold:   '#EF9F27',
}

// ── Circadian badge ───────────────────────────────────────────────────────────
function circadianBadge(sessionId) {
  const fit = SESSIONS[sessionId]?.circadian
  if (!fit) return null
  const h = new Date().getHours()
  const inBest   = h >= fit.best[0]   && h <= fit.best[1]
  const inDecent = h >= fit.decent[0] && h <= fit.decent[1]
  if (inBest)   return { label: 'Best now',  color: '#00D084' }
  if (inDecent) return { label: 'Decent',    color: '#EF9F27' }
  return { label: 'Not ideal', color: '#7A7A96' }
}

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
export default function Dashboard({ onStart, cfg, profile, bleStatus: bleStatusProp }) {
  const { user, signOut } = useAuth()
  const { latestRR, latestHR, bleStatus: bleStatusCtx } = useSensorContext()
  const bleStatus = bleStatusProp ?? bleStatusCtx

  const SESSION_LIST = useMemo(() => getSessionList(), [])

  // Circadian-default: hour-of-day → recommended session id.
  // 5–11h morning_emergence · 12–17h find_your_calm · 18–4h wind_down.
  const RECOMMENDED_ID = useMemo(() => {
    const h = new Date().getHours()
    let id
    if (h >= 5 && h <= 11) id = 'morning_emergence'
    else if (h >= 12 && h <= 17) id = 'find_your_calm'
    else id = 'wind_down'
    // Confirm the candidate exists in the session list; else fall back.
    return SESSION_LIST.some(s => s.id === id) ? id : SESSION_LIST[0].id
  }, [SESSION_LIST])

  const DEFAULT_SESSION_ID = RECOMMENDED_ID
  const DEFAULT_DURATION_S = (SESSIONS[RECOMMENDED_ID]?.durations?.[0]?.value) ?? SESSION_LIST[0].durations[0].value

  const [sessions, setSessions]       = useState([])
  const [recs, setRecs]               = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [sessionId, setSessionId]     = useState(DEFAULT_SESSION_ID)
  const [durationS, setDurationS]     = useState(DEFAULT_DURATION_S)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [s, r] = await Promise.all([getSessions(5), getRecommendations()])
        if (!cancelled) {
          setSessions(s); setRecs(r)
          // Backend-recommended session takes precedence over circadian default.
          try {
            const recId = Array.isArray(r) ? r.find(x => x?.recommended_session_id)?.recommended_session_id : null
            if (recId && SESSIONS[recId]) {
              setSessionId(recId)
              setDurationS(SESSIONS[recId].durations[0].value)
            }
          } catch (_) { /* defensive: ignore malformed recs */ }
        }
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
    SESSION_LIST.forEach(s => { out[s.id] = circadianBadge(s.id) })
    return out
  }, [])

  function handleSelectSession(id) {
    setSessionId(id)
    setDurationS(SESSIONS[id].durations[0].value)
  }

  function handleStart() {
    onStart({
      session: sessionId,
      sensorMode: 2,
      backendMode: 2,
      durationS,
    })
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', position: 'relative', overflow: 'hidden' }}>

      {/* Live biometric status bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(10,10,15,0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '10px 20px',
        display: 'flex', alignItems: 'center', gap: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: bleStatus === 'connected' ? '#00D084' :
                        bleStatus === 'reconnecting' ? '#EF9F27' : 'rgba(255,255,255,0.18)',
            boxShadow: bleStatus === 'connected' ? '0 0 8px rgba(0,208,132,0.6)' : 'none',
            transition: 'background 0.3s, box-shadow 0.3s',
          }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>H10</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          <span style={{
            fontSize: 24, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            color: bleStatus === 'connected' && latestHR ? '#fff' : 'rgba(255,255,255,0.18)',
          }}>
            {bleStatus === 'connected' && latestHR ? latestHR : '—'}
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)' }}>bpm</span>
        </div>
        {cfg?.rfBpm && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.32)' }}>RF</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: cfg.rfLocked ? '#3FBFA8' : '#EF9F27', fontVariantNumeric: 'tabular-nums' }}>
              {cfg.rfBpm.toFixed(1)}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)' }}>bpm</span>
            {cfg.rfLocked && <span style={{ fontSize: 9, color: '#3FBFA8', marginLeft: 1 }}>locked</span>}
          </div>
        )}
      </div>

      <div className="ambient-bg" />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 480, margin: '0 auto', padding: '32px 20px 40px' }}>

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

        {/* Live sensor status */}
        <div style={{ marginBottom: 16 }}>
          <SensorStatusBar rfLocked={cfg?.rfLocked ?? null} sqi={null} />
        </div>

        {/* Today's calibration card */}
        {cfg?.rfBpm && (
          <div style={{ marginBottom: 20, padding: '14px 16px', background: 'rgba(63,191,168,0.05)', border: '1px solid rgba(63,191,168,0.18)', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3FBFA8', boxShadow: '0 0 8px rgba(63,191,168,0.5)', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Today&apos;s calibration</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>
                RF {cfg.rfBpm.toFixed(1)} bpm
                {cfg.rfLocked
                  ? <span style={{ color: '#3FBFA8', marginLeft: 8 }}>Locked</span>
                  : <span style={{ color: '#EF9F27', marginLeft: 8 }}>Estimated</span>}
              </div>
            </div>
          </div>
        )}

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
          {/* "Best for this time of day" — only when the circadian default actually fits the current hour */}
          {badges[RECOMMENDED_ID]?.label === 'Best now' && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 10, color: '#00D084', letterSpacing: '0.08em',
              textTransform: 'uppercase', marginBottom: 8, fontWeight: 600,
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00D084' }} />
              Best for this time of day
            </div>
          )}
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Session
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SESSION_LIST.map(s => {
              const active      = sessionId === s.id
              const badge       = badges[s.id]
              const accentColor = COLOR[s.colorKey] ?? 'var(--primary)'

              return (
                <div
                  key={s.id}
                  onClick={() => handleSelectSession(s.id)}
                  className="touch-target"
                  style={{
                    padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                    border: `1.5px solid ${active ? accentColor : 'rgba(255,255,255,0.06)'}`,
                    background: active ? `${accentColor}1A` : 'var(--surface)',
                    transition: 'border-color 200ms, background 200ms',
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                  }}
                >
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{s.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Row 1: label + circadian badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{s.label}</span>
                      {badge && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, background: `${badge.color}18`, border: `1px solid ${badge.color}40`, borderRadius: 6, padding: '2px 8px' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: badge.color }} />
                          <span style={{ color: badge.color, fontSize: 10, fontWeight: 600 }}>{badge.label}</span>
                        </div>
                      )}
                    </div>

                    {/* Row 2: description */}
                    <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
                      {s.description}
                    </div>

                    {/* Row 3: duration chips */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                      {s.durations.map(d => {
                        const chipActive = active && durationS === d.value
                        return (
                          <button
                            key={d.value}
                            onClick={e => { e.stopPropagation(); if (!active) handleSelectSession(s.id); setDurationS(d.value) }}
                            style={{
                              padding: '4px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                              border: `1px solid ${chipActive ? accentColor : 'rgba(255,255,255,0.12)'}`,
                              background: chipActive ? `${accentColor}2A` : 'rgba(255,255,255,0.04)',
                              color: chipActive ? accentColor : 'var(--text-dim)',
                              fontWeight: chipActive ? 700 : 400,
                              transition: 'all 150ms ease',
                            }}
                          >
                            {d.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Begin Session CTA */}
        <button
          onClick={handleStart}
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

        {user?.email && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, marginTop: 20 }}>
            {user.email}
          </div>
        )}
      </div>
    </div>
  )
}
