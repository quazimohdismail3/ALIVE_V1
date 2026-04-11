import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useApp } from '../context/AppContext.jsx'
import { store } from '../store/sessionStore.js'
import CosmicBackground from './CosmicBackground.jsx'
import AnimatedNumber from './AnimatedNumber.jsx'
import '../styles/insights.css'

const ease = [0.16, 1, 0.3, 1]

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

export default function InsightsScreen() {
  const navigate = useNavigate()
  const { selection, startFrame, endFrame } = useApp()
  const savedRef = useRef(false)

  const rmStart = startFrame?.metrics?.rmssd ?? 0
  const rmEnd   = endFrame?.metrics?.rmssd ?? rmStart
  const delta   = rmEnd - rmStart
  const arStart = startFrame?.state?.arousal ?? startFrame?.arousal ?? 0
  const arEnd   = endFrame?.state?.arousal   ?? endFrame?.arousal   ?? arStart

  const insight = deriveInsight(selection?.session ?? 'calm', delta, arEnd - arStart)

  useEffect(() => {
    if (savedRef.current) return
    savedRef.current = true
    store.pushHistory({
      ts:           Date.now(),
      session:      selection?.session  ?? 'calm',
      duration_s:   selection?.duration_s ?? 600,
      sensor_mode:  selection?.sensor_mode ?? 'simulator',
      delta_rmssd:  delta,
      insight,
    })
    store.set({ last_insight: insight })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const deltaColor = delta >= 0 ? 'var(--accent-teal)' : 'var(--accent-rose)'

  return (
    <motion.div
      className="insights-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease } }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.4 } }}
    >
      <CosmicBackground />

      {/* Top */}
      <motion.div
        className="insights-top"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.7, ease, delay: 0.1 } }}
      >
        <div className="insights-tag">SESSION COMPLETE</div>
        <div className="insights-headline">Your system just stabilized.</div>
        <div className="insights-sub">
          {selection?.session ?? 'Recovery'} · {Math.round((selection?.duration_s ?? 600) / 60)} min
        </div>
      </motion.div>

      {/* Delta ring */}
      <motion.div
        className="insights-ring-wrap"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1, transition: { duration: 0.8, ease, delay: 0.2 } }}
      >
        <DeltaRing start={rmStart} end={rmEnd} />
      </motion.div>

      {/* Stats row */}
      <motion.div
        className="insights-stats"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease, delay: 0.35 } }}
      >
        <div className="insights-stat">
          <div className="insights-stat-label">START</div>
          <div className="insights-stat-value">
            <AnimatedNumber value={Math.round(rmStart)} duration={800} />
          </div>
          <div className="insights-stat-unit">MS</div>
        </div>

        <div className="insights-delta-arrow" style={{ color: deltaColor }}>
          {delta >= 0 ? '↑' : '↓'}
        </div>

        <div className="insights-stat">
          <div className="insights-stat-label">END</div>
          <div className="insights-stat-value">
            <AnimatedNumber value={Math.round(rmEnd)} duration={800} />
          </div>
          <div className="insights-stat-unit">MS</div>
        </div>
      </motion.div>

      {/* Meta line */}
      <motion.div
        className="insights-meta"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.6, delay: 0.45 } }}
      >
        Δ {delta >= 0 ? '+' : ''}{delta.toFixed(1)}ms · {Math.round((selection?.duration_s ?? 600) / 60)} min · {selection?.sensor_mode ?? 'simulator'}
      </motion.div>

      {/* Insight card */}
      <motion.div
        className="insights-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease, delay: 0.5 } }}
      >
        <div className="insights-card-tag">INSIGHT</div>
        <div className="insights-card-body">{insight}</div>
      </motion.div>

      {/* CTAs */}
      <motion.button
        className="insights-cta"
        onClick={() => navigate('/dashboard')}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease, delay: 0.6 } }}
        whileTap={{ scale: 0.97 }}
      >
        Return to Dashboard
      </motion.button>

      <motion.button
        className="insights-new-btn"
        onClick={() => navigate('/dashboard')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.6, delay: 0.7 } }}
        whileTap={{ scale: 0.97 }}
      >
        New session
      </motion.button>
    </motion.div>
  )
}

// ─── DeltaRing ────────────────────────────────────────────────────────────────
function DeltaRing({ start, end }) {
  const REF  = 100
  const sPct = Math.max(0, Math.min(1, start / REF))
  const ePct = Math.max(0, Math.min(1, end   / REF))
  const r    = 64
  const c    = 2 * Math.PI * r

  return (
    <svg width="180" height="180" viewBox="0 0 180 180">
      {/* Track */}
      <circle cx="90" cy="90" r={r}
              fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
      {/* Start arc (faint) */}
      <circle cx="90" cy="90" r={r}
              fill="none"
              stroke="rgba(255,255,255,0.18)" strokeWidth="3"
              strokeDasharray={`${sPct * c} ${c}`}
              transform="rotate(-90 90 90)"
              strokeLinecap="round" />
      {/* End arc (state color) */}
      <circle cx="90" cy="90" r={r}
              fill="none"
              stroke="var(--state)" strokeWidth="6"
              strokeDasharray={`${ePct * c} ${c}`}
              transform="rotate(-90 90 90)"
              strokeLinecap="round"
              className="state-color"
              style={{ transition: 'stroke-dasharray 1s ease-out' }} />
      {/* Center value */}
      <text x="90" y="88" textAnchor="middle"
            style={{ fontSize: 28, fill: 'var(--text-primary)',
                     fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {Math.round(end)}
      </text>
      <text x="90" y="108" textAnchor="middle"
            style={{ fontSize: 9, fill: 'var(--text-muted)',
                     fontFamily: 'var(--font-mono)', letterSpacing: '0.15em' }}>
        RMSSD MS
      </text>
    </svg>
  )
}
