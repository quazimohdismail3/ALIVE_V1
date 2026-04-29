import { useState } from 'react'
import './styles/global.css'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import LoginScreen from './pages/LoginScreen.jsx'
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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0A0A0F' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #7C6FF7', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!user) return <LoginScreen />

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
