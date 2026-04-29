import { useState } from 'react'
import './styles/global.css'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import LoginScreen from './pages/LoginScreen.jsx'
import Landing from './pages/Landing.jsx'
import Session from './pages/Session.jsx'
import Report from './pages/Report.jsx'

function AppRoutes() {
  const { user, loading } = useAuth()
  const [screen, setScreen] = useState('landing')
  const [cfg, setCfg] = useState(null)
  const [reportData, setReportData] = useState(null)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: '#0a0a0f' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #6c63ff', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!user) return <LoginScreen />

  if (screen === 'session' && cfg) {
    return (
      <Session
        {...cfg}
        onEnd={(data) => {
          setReportData(data || null)
          setScreen('report')
        }}
      />
    )
  }
  if (screen === 'report') {
    return (
      <Report
        sessionData={reportData}
        onDone={() => { setReportData(null); setScreen('landing') }}
      />
    )
  }
  return <Landing onStart={(c) => { setCfg(c); setScreen('session') }} />
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
