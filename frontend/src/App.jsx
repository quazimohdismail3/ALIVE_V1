import React, { useCallback, useEffect, useState } from 'react'
import { store } from './store/sessionStore.js'
import LandingScreen from './components/LandingScreen.jsx'
import SessionPicker from './components/SessionPicker.jsx'
import CalibrationScreen from './components/CalibrationScreen.jsx'
import MainSession from './components/MainSession.jsx'
import SessionEnd from './components/SessionEnd.jsx'
import HistoryPanel from './components/HistoryPanel.jsx'

const STAGES = ['landing', 'picker', 'calibration', 'session', 'end']

export default function App() {
  const [stage, setStage] = useState('landing')
  const [ansState, setAnsState] = useState('ventral_vagal')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selection, setSelection] = useState({
    session: null,
    duration_s: 600,
    sensor_mode: store.get().sensor_mode,
  })
  const [finalFrame, setFinalFrame] = useState(null)
  const [startFrame, setStartFrame] = useState(null)

  useEffect(() => store.subscribe(() => {}), [])

  const goLanding = useCallback(() => setStage('landing'), [])
  const goPicker = useCallback(() => setStage('picker'), [])
  const goCalibration = useCallback((sel) => {
    setSelection(sel)
    store.set({ sensor_mode: sel.sensor_mode, last_session_type: sel.session })
    setStage('calibration')
  }, [])
  const goSession = useCallback(() => setStage('session'), [])
  const goEnd = useCallback((start, end) => {
    setStartFrame(start)
    setFinalFrame(end)
    setStage('end')
  }, [])

  return (
    <div className="app" data-state={ansState}>
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
        <CalibrationScreen
          selection={selection}
          onDone={goSession}
        />
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
          endFrame={finalFrame}
          onReturn={goLanding}
        />
      )}
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
