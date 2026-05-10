// frontend/src/pages/SplashScreen.jsx
import { useEffect } from 'react'

export default function SplashScreen({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#0A0A0F',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    }}>
      <style>{`
        @keyframes splashFadeIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes splashPulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1; }
        }
      `}</style>
      <div style={{
        fontFamily: 'var(--font-head, system-ui)',
        fontWeight: 700,
        fontSize: 48,
        letterSpacing: '-0.04em',
        color: '#fff',
        animation: 'splashFadeIn 0.6s ease forwards',
      }}>
        ALIVE
      </div>
      <div style={{
        fontSize: 13,
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        animation: 'splashPulse 1.5s ease infinite',
      }}>
        Autonomic regulation
      </div>
    </div>
  )
}
