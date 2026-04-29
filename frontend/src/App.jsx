import { useState } from 'react'
import './styles/global.css'
import Landing from './pages/Landing.jsx'
import Session from './pages/Session.jsx'
import Report from './pages/Report.jsx'

export default function App() {
  const [screen, setScreen] = useState('landing')
  const [cfg, setCfg] = useState(null)
  const [reportData, setReportData] = useState(null)

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
