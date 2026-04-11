import React, { createContext, useContext, useState } from 'react'

export const AppContext = createContext(null)

export function AppProvider({ children }) {
  // BLE instance + sensor mode — persists across all routes
  const [ble, setBle] = useState(null)
  const [sensorMode, setSensorMode] = useState('simulator')

  // ANS state — drives polyvagal color theming on the root div
  const [ansState, setAnsState] = useState('ventral_vagal')

  // Session data — set before navigating to /session, read in /insights
  const [selection, setSelection] = useState(null)
  const [startFrame, setStartFrame] = useState(null)
  const [endFrame, setEndFrame] = useState(null)

  return (
    <AppContext.Provider value={{
      ble, setBle,
      sensorMode, setSensorMode,
      ansState, setAnsState,
      selection, setSelection,
      startFrame, setStartFrame,
      endFrame, setEndFrame,
    }}>
      {children}
    </AppContext.Provider>
  )
}

/** Convenience hook — throws if used outside AppProvider */
export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
