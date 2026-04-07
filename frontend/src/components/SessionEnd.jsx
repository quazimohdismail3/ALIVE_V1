import React, { useEffect } from 'react'
import { store } from '../store/sessionStore.js'

export default function SessionEnd({ selection, startFrame, endFrame, onReturn }) {
  const rmStart = startFrame?.metrics?.rmssd ?? 0
  const rmEnd = endFrame?.metrics?.rmssd ?? rmStart
  const delta = rmEnd - rmStart
  const arStart = startFrame?.state?.arousal ?? 0
  const arEnd = endFrame?.state?.arousal ?? arStart

  // Generate local insight (fallback; backend writes its own to db)
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
    <div className="screen">
      <div className="display" style={{ fontSize: 26, textAlign: 'center', marginTop: 48 }}>Session complete.</div>

      <div className="card state-color" style={{ marginTop: 32, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          <Column label="Start" rm={rmStart} ar={arStart} />
          <div style={{ fontSize: 24, alignSelf: 'center', color: delta >= 0 ? 'var(--ventral)' : 'var(--sympathetic-a)' }}>
            {delta >= 0 ? '↑' : '↓'}
          </div>
          <Column label="End" rm={rmEnd} ar={arEnd} />
        </div>
        <div className="mono secondary" style={{ fontSize: 11, marginTop: 16, textAlign: 'center' }}>
          Δ {delta >= 0 ? '+' : ''}{delta.toFixed(1)}ms · {Math.round(selection.duration_s / 60)} min · {selection.sensor_mode}
        </div>
      </div>

      <div className="display" style={{
        marginTop: 32,
        fontSize: 16,
        fontStyle: 'italic',
        borderLeft: '3px solid var(--state)',
        paddingLeft: 16,
      }}>
        {insight}
      </div>

      <button className="btn state-color" style={{ marginTop: 40 }} onClick={onReturn}>Save & Return</button>
    </div>
  )
}

function Column({ label, rm, ar }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="secondary" style={{ fontSize: 10, letterSpacing: '0.15em' }}>{label.toUpperCase()}</div>
      <div className="mono" style={{ fontSize: 18, marginTop: 6 }}>{rm.toFixed(0)}</div>
      <div className="secondary" style={{ fontSize: 10 }}>rmssd</div>
      <div className="mono" style={{ fontSize: 12, marginTop: 8 }}>{ar.toFixed(2)}</div>
      <div className="secondary" style={{ fontSize: 10 }}>arousal</div>
    </div>
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
