import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useApp } from '../context/AppContext.jsx'
import CosmicBackground from './CosmicBackground.jsx'
import FlowingWaves from './FlowingWaves.jsx'
import { store } from '../store/sessionStore.js'
import '../styles/splash.css'

const ease = [0.16, 1, 0.3, 1]

const fadeUp = (delay = 0) => ({
  initial:  { opacity: 0, y: 20 },
  animate:  { opacity: 1, y: 0, transition: { duration: 0.8, ease, delay } },
})

export default function SplashScreen() {
  const navigate = useNavigate()
  const { setAnsState } = useApp()

  useEffect(() => { setAnsState('ventral_vagal') }, [setAnsState])

  const lastInsight = store.get().last_insight

  return (
    <motion.div
      className="splash-wrapper"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.4 } }}
      transition={{ duration: 0.5 }}
    >
      <CosmicBackground />

      <div className="splash-card glass-card">
        {/* "Listening…" label */}
        <motion.div className="splash-listening" {...fadeUp(0.3)}>
          Let vagus create the magic…
        </motion.div>

        {/* Flowing waveform */}
        <motion.div
          className="splash-waves"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 1, delay: 0.5 } }}
        >
          <FlowingWaves
            colors={['var(--accent-teal)', 'var(--accent-amber)', 'var(--accent-purple)']}
            opacity={0.45}
            height={56}
          />
        </motion.div>

        {/* Headline */}
        <motion.div className="splash-headline" {...fadeUp(0.8)}>
          Listen to<br />your body.
        </motion.div>

        {/* Body copy */}
        <motion.div className="splash-body" {...fadeUp(1.2)}>
          {lastInsight
            ? `"${lastInsight}"`
            : 'Your heart, breath, and nervous system are already shaping sound.'}
        </motion.div>

        <motion.div className="splash-sub" {...fadeUp(1.4)}>
          No two sessions will ever sound the same.
        </motion.div>

        {/* CTA */}
        <motion.div
          style={{ width: '100%' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.8, ease, delay: 1.8 } }}
        >
          <button
            className="splash-cta"
            onClick={() => navigate('/connect')}
          >
            ✦ Let's begin
          </button>
        </motion.div>

        {/* Footer */}
        <motion.div className="splash-footer" {...fadeUp(2.0)}>
          🔒 Just your signal.
        </motion.div>
      </div>
    </motion.div>
  )
}
