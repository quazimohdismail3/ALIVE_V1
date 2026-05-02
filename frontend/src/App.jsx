import { useState, useEffect, useCallback } from 'react'
import './styles/global.css'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { SensorProvider, useSensorContext } from './context/SensorContext.jsx'
import LandingPage from './pages/LandingPage.jsx'
import LoginScreen from './pages/LoginScreen.jsx'
import ProfileSetup from './pages/ProfileSetup.jsx'
import { getProfile } from './lib/api.js'
import Dashboard from './pages/Dashboard.jsx'
import Session from './pages/Session.jsx'
import ConnectionRitual from './pages/ConnectionRitual.jsx'
import Insight from './pages/Insight.jsx'

/**
 * // Screens: login -> landing -> connection -> session -> insight
 * Discard path: session -> landing (bypasses insight)
  */
function AppRoutes() {
  const { user, loading } = useAuth()
  const { startMic } = useSensorContext()
  const [screen, setScreen]       = useState('landing')
  const [cfg, setCfg]             = useState(null)
  const [insightData, setInsightData] = useState(null)
  const [profile, setProfile]     = useState(undefined)  // undefined=loading, null=missing, obj=present
  const [profileErr, setProfileErr] = useState(null)
  const [profileRetry, setProfileRetry] = useState(0)

  useEffect(() => {
    if (!user) { setProfile(undefined); setProfileErr(null); return }
    let cancelled = false
    setProfile(undefined)
    setProfileErr(null)
    ;(async () => {
      try {
        const p = await getProfile()
        if (!cancelled) {
          setProfile(p)
          setProfileErr(null)
          // Start mic once we have a confirmed user â€” no gesture required for mic
          startMic()
        }
      } catch (e) {
        console.error('profile fetch failed', e)
        if (!cancelled) setProfileErr(e.message)
      }
    })()
    return () => { cancelled = true }
  }, [user, profileRetry, startMic])

  // First-time users must go through Setup (to init sensors/fusion) before Calibration
  useEffect(() => {
    if (profile && profile.calibration_done === false && screen === 'landing') {
      setCfg({ rfBpm: 5.5, rfLocked: false, session: 'find_your_calm', backendMode: 2, sensorMode: 2, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      setScreen('connection')
    }
  }, [profile, screen])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #7C6FF7', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!user) return <LandingPage />

  if (profile === undefined && !profileErr) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #7C6FF7', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (profileErr) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F', color: 'white', padding: '2rem', textAlign: 'center', gap: 12 }}>
        <div style={{ fontSize: 16, color: '#E24B4A' }}>Could not reach server</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', maxWidth: 280 }}>{profileErr}</div>
        <button onClick={() => setProfileRetry(r => r + 1)} style={{ marginTop: 8, padding: '8px 20px', background: 'rgba(124,111,247,0.15)', border: '1px solid rgba(124,111,247,0.4)', borderRadius: 8, color: '#7C6FF7', cursor: 'pointer', fontSize: 13 }}>Retry</button>
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

  const isOnboarding = profile?.calibration_done === false

  const handleConnectionReady = useCallback(async (readyCfg) => {
    setCfg(readyCfg)
    if (isOnboarding) {
      const p = await getProfile()
      setProfile(p)
      setScreen('landing')
    } else {
      setScreen('session')
    }
  }, [isOnboarding])

  switch (screen) {
    case 'connection':
      return (
        <ConnectionRitual
          cfg={cfg}
          isOnboarding={isOnboarding}
          onReady={handleConnectionReady}
          onBack={() => setScreen('landing')}
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
        <Dashboard
          hasCalibrated={profile?.calibration_done === true}
          savedRfBpm={profile?.rf_bpm ?? 5.5}
          onStart={(c) => { setCfg({ ...c, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); setScreen('connection') }}
        />
      )
  }
}

export default function App() {
  return (
    <AuthProvider>
      <SensorProvider>
        <AppRoutes />
      </SensorProvider>
    </AuthProvider>
  )
}


