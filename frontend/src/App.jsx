import { useState } from 'react'
import './styles/global.css'
import Landing from './pages/Landing.jsx'
import Session from './pages/Session.jsx'

export default function App() {
  const [screen, setScreen] = useState('landing')
  const [cfg, setCfg] = useState(null)

  if (screen === 'session' && cfg) {
    return <Session {...cfg} onEnd={() => { setCfg(null); setScreen('landing') }} />
  }
  return <Landing onStart={(c) => { setCfg(c); setScreen('session') }} />
}
