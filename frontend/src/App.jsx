import React, { useState, useEffect, useCallback } from 'react'
import './styles/global.css'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { SensorProvider, useSensorContext } from './context/SensorContext.jsx'
import SplashScreen from './pages/SplashScreen.jsx'
import LandingPage from './pages/LandingPage.jsx'
import LoginScreen from './pages/LoginScreen.jsx'
import ProfileSetup from './pages/ProfileSetup.jsx'
import CalibrationScreen from './pages/CalibrationScreen.jsx'
import H10Intro from './pages/H10Intro.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Session from './pages/Session.jsx'
import Insight from './pages/Insight.jsx'
import { getProfile } from './lib/api.js'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('App error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F', color: '#E8E8F0', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong</div>
          <button onClick={() => this.setState({ hasError: false, error: null })} style={{ background: 'rgba(124,111,247,0.15)', border: '1px solid rgba(124,111,247,0.3)', color: '#7C6FF7', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function AppRoutes() {
  const { user, loading } = useAuth()
  const { bleStatus } = useSensorContext()
  const [screen, setScreen] = useState('splash')
  const [cfg, setCfg] = useState(null)
  const [insightData, setInsightData] = useState(null)
  const [profile, setProfile] = useState(undefined)
  const [profileErr, setProfileErr] = useState(null)

  const handleSplashDone = useCallback(() => {
    if (!user) setScreen('login')
    else setScreen('profile-loading')
  }, [user])

  // Load profile whenever user changes
  useEffect(() => {
    if (!user) { setProfile(undefined); setProfileErr(null); return }
    let cancelled = false
    setProfile(undefined)
    ;(async () => {
      try {
        const p = await getProfile()
        if (!cancelled) { setProfile(p); setProfileErr(null) }
      } catch (e) {
        if (!cancelled) setProfileErr(e.message)
      }
    })()
    return () => { cancelled = true }
  }, [user])

  const h10IntroSeen = () => {
    try { return localStorage.getItem('h10_intro_seen') === '1' } catch (_) { return false }
  }

  // Route once profile is loaded
  useEffect(() => {
    if (screen !== 'profile-loading') return
    if (profile === undefined && !profileErr) return
    if (profileErr) { setScreen('login'); return }
    if (profile === null) { setScreen('profile-setup'); return }
    setScreen(h10IntroSeen() ? 'calibration' : 'h10-intro')
  }, [profile, profileErr, screen])

  // When auth state changes after splash, re-route
  useEffect(() => {
    if (screen === 'splash') return
    if (!user && screen !== 'login') setScreen('login')
    if (user && screen === 'login') setScreen('profile-loading')
  }, [user, screen])

  const handleCalibrationReady = useCallback((readyCfg) => {
    setCfg(readyCfg)
    setScreen('dashboard')
  }, [])

  if (screen === 'splash') {
    return <SplashScreen onDone={handleSplashDone} />
  }

  if (loading || screen === 'profile-loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #7C6FF7', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!user || screen === 'login') return <LoginScreen />

  if (screen === 'profile-setup') {
    return (
      <ProfileSetup
        onComplete={async () => {
          const p = await getProfile()
          setProfile(p)
          setScreen(h10IntroSeen() ? 'calibration' : 'h10-intro')
        }}
      />
    )
  }

  if (screen === 'h10-intro') {
    return (
      <H10Intro
        onContinue={() => {
          try { localStorage.setItem('h10_intro_seen', '1') } catch (_) {}
          setScreen('calibration')
        }}
      />
    )
  }

  if (screen === 'calibration') {
    return <CalibrationScreen onReady={handleCalibrationReady} />
  }

  switch (screen) {
    case 'session':
      return (
        <Session
          cfg={cfg}
          onEnd={(data) => { setInsightData(data); setScreen('insight') }}
          onDiscard={() => setScreen('dashboard')}
        />
      )
    case 'insight':
      return (
        <Insight
          data={insightData}
          onDone={() => { setInsightData(null); setScreen('dashboard') }}
        />
      )
    default: // 'dashboard'
      return (
        <Dashboard
          cfg={cfg}
          profile={profile}
          bleStatus={bleStatus}
          onStart={(sessionCfg) => {
            setCfg(prev => ({ ...prev, ...sessionCfg }))
            setScreen('session')
          }}
        />
      )
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SensorProvider>
          <AppRoutes />
        </SensorProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
