import React from 'react'
import { motion } from 'framer-motion'

const STATE_COLORS = {
  ventral_vagal:      'var(--accent-teal)',
  healthy_sympathetic:'var(--accent-amber)',
  anxious_sympathetic:'var(--accent-rose)',
  dorsal_vagal:       'var(--accent-purple)',
  burnout_rigidity:   'var(--accent-purple)',
}

/**
 * Reusable breathing/pulsing orb for HRV display.
 *
 * Props:
 *   hrvValue   – number to display (rmssd or hr)
 *   label      – label below value (e.g. "HRV" or "BPM")
 *   stateKey   – ANS state string (maps to glow color)
 *   size       – 'large' (280px) | 'small' (60px)
 */
export default function BreathingOrb({
  hrvValue,
  label = 'HRV',
  stateKey = 'ventral_vagal',
  size = 'large',
}) {
  const isLarge = size === 'large'
  const dim = isLarge ? 280 : 60
  const glowColor = STATE_COLORS[stateKey] ?? 'var(--accent-teal)'
  const fontSize  = isLarge ? 56 : 16
  const labelSize = isLarge ? 12 : 8

  return (
    <motion.div
      animate={{ scale: [1, 1.04, 1] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        width: dim,
        height: dim,
        borderRadius: '50%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {/* Outer glow ring */}
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        border: `1px solid ${glowColor}`,
        opacity: 0.25,
        transition: 'border-color 8s ease',
      }} />

      {/* Middle ring */}
      {isLarge && (
        <div style={{
          position: 'absolute',
          inset: 16,
          borderRadius: '50%',
          border: `1px solid ${glowColor}`,
          opacity: 0.15,
          transition: 'border-color 8s ease',
        }} />
      )}

      {/* Core glow */}
      <div style={{
        position: 'absolute',
        inset: isLarge ? 32 : 8,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${glowColor}22 0%, transparent 70%)`,
        transition: 'background 8s ease',
      }} />

      {/* Center content */}
      <div style={{ position: 'relative', textAlign: 'center', zIndex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: fontSize,
          lineHeight: 1,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
        }}>
          {hrvValue != null ? Math.round(hrvValue) : '—'}
        </div>
        <div style={{
          fontSize: labelSize,
          color: 'var(--text-muted)',
          letterSpacing: '0.15em',
          marginTop: 4,
        }}>
          {label}
        </div>
      </div>
    </motion.div>
  )
}
