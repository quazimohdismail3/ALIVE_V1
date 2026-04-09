import React, { useEffect } from 'react'
import { store } from '../store/sessionStore.js'

export default function SessionEnd({ selection, startFrame, endFrame, onReturn, onNewSession }) {
  const rmStart = startFrame?.metrics?.rmssd ?? 0
  const rmEnd = endFrame?.metrics?.rmssd ?? rmStart
  const delta = rmEnd - rmStart
  const arStart = startFrame?.state?.arousal ?? startFrame?.arousal ?? 0
  const arEnd = endFrame?.state?.arousal ?? endFrame?.arousal ?? arStart

  const insight = deriveInsight(selection.session, delta, arEnd - arStart)

  useEffect(() => {
    store.pushHistory({
      ts: Date.now(),
      session: selection.session,
      duration_s: selection.duration_s,
      sensor_mode: selection.sensor_mode,
      delta_rmssd: delta,
      insight,
    })
    store.set({ last_insight: insight })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="screen cosmic-bg dim" style={{ minHeight: '100dvh', padding: '64px 24px 40px' }}>
      <div className="display" style={{ fontSize: 24, textAlign: 'center', letterSpacing: '-0.01em' }}>Session complete.</div>

      {/* Delta hero */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 36, marginBottom: 28 }}>
        <DeltaRing start={rmStart} end={rmEnd} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginBottom: 28 }}>
        <Stat label="Start" value={rmStart} unit="ms" sub="rmssd" />
        <div style={{ fontSize: 28, color: delta >= 0 ? 'var(--ventral)' : 'var(--sympathetic-a)' }}>
          {delta >= 0 ? '↑' : '↓'}
        </div>
        <Stat label="End" value={rmEnd} unit="ms" sub="rmssd" />
      </div>

      <div className="mono secondary" style={{ fontSize: 11, textAlign: 'center', marginBottom: 32 }}>
        Δ {delta >= 0 ? '+' : ''}{delta.toFixed(1)}ms · {Math.round(selection.duration_s / 60)} min · {selection.sensor_mode}
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderLeft: '3px solid var(--state)',
        borderRadius: 10,
        padding: '18px 18px 20px',
        marginBottom: 36,
      }}>
        <div className="secondary" style={{ fontSize: 9, letterSpacing: '0.18em', marginBottom: 8 }}>INSIGHT</div>
        <div className="display" style={{ fontSize: 16, fontStyle: 'italic', lineHeight: 1.4 }}>{insight}</div>
      </div>

      <button className="btn state-color" onClick={onReturn}>Save & return</button>
      <button className="btn btn-ghost state-color" style={{ marginTop: 10 }} onClick={onNewSession}>New session</button>
    </div>
  )
}

function Stat({ label, value, unit, sub }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="secondary" style={{ fontSize: 9, letterSpacing: '0.15em' }}>{label.toUpperCase()}</div>
      <div className="mono" style={{ fontSize: 22, marginTop: 6 }}>
        {Math.round(value)}<span className="secondary" style={{ fontSize: 10, marginLeft: 3 }}>{unit}</span>
      </div>
      <div className="secondary" style={{ fontSize: 9, marginTop: 2 }}>{sub}</div>
    </div>
  )
}

function DeltaRing({ start, end }) {
  // Simple ring chart: outer = end RMSSD, inner faint = start.
  // Scale to a 0–100ms reference window.
  const REF = 100
  const sPct = Math.max(0, Math.min(1, start / REF))
  const ePct = Math.max(0, Math.min(1, end / REF))
  const r = 64
  const c = 2 * Math.PI * r
  return (
    <svg width="180" height="180" viewBox="0 0 180 180">
      <circle cx="90" cy="90" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
      <circle
        cx="90" cy="90" r={r} fill="none"
        stroke="rgba(255,255,255,0.18)" strokeWidth="3"
        strokeDasharray={`${sPct * c} ${c}`}
        transform="rotate(-90 90 90)"
        strokeLinecap="round"
      />
      <circle
        cx="90" cy="90" r={r} fill="none"
        stroke="var(--state)" strokeWidth="6"
        strokeDasharray={`${ePct * c} ${c}`}
        transform="rotate(-90 90 90)"
        strokeLinecap="round"
        className="state-color"
      />
      <text x="90" y="92" textAnchor="middle" className="mono" style={{ fontSize: 28, fill: 'var(--text-primary)' }}>
        {Math.round(end)}
      </text>
      <text x="90" y="110" textAnchor="middle" className="mono" style={{ fontSize: 9, fill: 'var(--text-secondary)', letterSpacing: '0.15em' }}>
        RMSSD MS
      </text>
    </svg>
  )
}

function deriveInsight(session, d_rm, d_ar) {
  if (d_rm >= 20) return 'Your nervous system opened. RMSSD lifted meaningfully — that\u2019s a real shift.'
  if (d_rm >= 10) return 'You moved toward regulation. The parasympathetic came online.'
  if (d_rm >= 5)  return 'Small but real. Your body found its way closer.'
  if ((session === 'calm' || session === 'recovery' || session === 'presence') && d_ar <= -0.15)
    return 'Arousal dropped. You let go of something you\u2019d been holding.'
  if ((session === 'energy' || session === 'adhd_flow') && d_ar >= 0.15)
    return 'Clean activation. You mobilized without the alarm.'
  if (session === 'focus' && Math.abs(d_ar) < 0.1 && d_rm > -5)
    return 'You held the line. Attention stayed — no drift, no crash.'
  if (d_rm <= -15) return 'Your system pushed back today. That\u2019s information — notice what came up.'
  return 'Session complete. Showing up is the practice.'
}
