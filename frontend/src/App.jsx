import { useState, useEffect } from 'react'
import './styles/global.css'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import LoginScreen from './pages/LoginScreen.jsx'
import ProfileSetup from './pages/ProfileSetup.jsx'
import { getProfile } from './lib/api.js'
import Landing from './pages/Landing.jsx'
import Setup from './pages/Setup.jsx'
import Calibration from './pages/Calibration.jsx'
import Session from './pages/Session.jsx'
import Insight from './pages/Insight.jsx'

/**
 * Screens: login → landing → setup → calibration → session → insight
 * Discard path: session → landing (bypasses insight)
 */
function AppRoutes() {
  const { user, loading } = useAuth()
  const [screen, setScreen]       = useState('landing')
  const [cfg, setCfg]             = useState(null)
  const [insightData, setInsightData] = useState(null)
  const [profile, setProfile]     = useState(undefined)  // undefined=loading, null=missing, obj=present

  useEffect(() => {
    if (!user) { setProfile(undefined); return }
    let cancelled = false
    ;(async () => {
      try {
        const p = await getProfile()
        if (!cancelled) setProfile(p)
      } catch (e) {
        console.error('profile fetch failed', e)
        if (!cancelled) setProfile(null)
      }
    })()
    return () => { cancelled = true }
  }, [user])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #7C6FF7', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!user) return <LoginScreen />

  if (profile === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #7C6FF7', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (profile === null) {
    return (
      <ProfileSetup
        onComplete={async () => {
          const p = await getProfile()
          setProfile(p)
          setScreen('landing')
        }}
      />
    )
  }

  switch (screen) {
    case 'setup':
      return (
        <Setup
          cfg={cfg}
          onReady={(readyCfg) => { setCfg(readyCfg); setScreen('calibration') }}
          onBack={() => setScreen('landing')}
        />
      )

    case 'calibration':
      return (
        <Calibration
          cfg={cfg}
          onLocked={(rfBpm, locked) => {
            setCfg({ ...cfg, rfBpm, rfLocked: !!locked })
            setScreen('session')
          }}
          onSkip={() => {
            setCfg({ ...cfg, rfBpm: 5.5, rfLocked: false })
            setScreen('session')
          }}
        />
      )

    case 'session':
      return (
        <Session
          cfg={cfg}
          onEnd={(data) => { setInsightData(data); setScreen('insight') }}
          onDiscard={() => { setCfg(null); setScreen('landing') }}
        />
      )

    case 'insight':
      return (
        <Insight
          data={insightData}
          onDone={() => { setInsightData(null); setCfg(null); setScreen('landing') }}
        />
      )

    default: // 'landing'
      return (
        <Landing
          onStart={(c) => { setCfg(c); setScreen('setup') }}
        />
      )
  }
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
