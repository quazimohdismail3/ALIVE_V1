import { useState, useEffect } from 'react'
import LandingScreen from './components/LandingScreen.jsx'
import SessionPicker from './components/SessionPicker.jsx'
import CalibrationScreen from './components/CalibrationScreen.jsx'
import MainSession from './components/MainSession.jsx'
import SessionEnd from './components/SessionEnd.jsx'
import HistoryPanel from './components/HistoryPanel.jsx'
import { store } from './store/sessionStore.js'

export default function App() {
  const [stage, setStage] = useState('landing')
  const [selection, setSelection] = useState(() => {
    const s = store.get()
    return {
      session: s.last_session_type || 'calm',
      duration_s: 600,
      sensor_mode: s.sensor_mode || 'simulator',
    }
  })
  const [ansState, setAnsState] = useState('ventral_vagal')
  const [startFrame, setStartFrame] = useState(null)
  const [endFrame, setEndFrame] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => store.subscribe((s) => {
    setSelection(sel => ({ ...sel, sensor_mode: s.sensor_mode }))
  }), [])

  const goLanding = () => {
    setStartFrame(null)
    setEndFrame(null)
    setStage('landing')
  }
  const goPicker = () => setStage('picker')
  const goCalibration = (sel) => {
    setSelection(sel)
    store.set({
      last_session_type: sel.session,
      sensor_mode: sel.sensor_mode,
    })
    setStage('calibration')
  }
  const goSession = () => setStage('session')
  const goEnd = (s, e) => {
    setStartFrame(s)
    setEndFrame(e)
    setStage('end')
  }

  return (
    <div className="vagus-app" data-state={ansState}>
      {stage === 'landing' && (
        <LandingScreen
          onBegin={goPicker}
          onOpenHistory={() => setHistoryOpen(true)}
          setAnsState={setAnsState}
        />
      )}
      {stage === 'picker' && (
        <SessionPicker
          initial={selection}
          onCancel={goLanding}
          onConfirm={goCalibration}
        />
      )}
      {stage === 'calibration' && (
        <CalibrationScreen selection={selection} onDone={goSession} />
      )}
      {stage === 'session' && (
        <MainSession
          selection={selection}
          setAnsState={setAnsState}
          onExit={goEnd}
        />
      )}
      {stage === 'end' && (
        <SessionEnd
          selection={selection}
          startFrame={startFrame}
          endFrame={endFrame}
          onReturn={goLanding}
        />
      )}
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
