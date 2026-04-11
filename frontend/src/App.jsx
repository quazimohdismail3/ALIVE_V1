import React from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { AppProvider, useApp } from './context/AppContext.jsx'
import './styles/global.css'

import SplashScreen from './components/SplashScreen.jsx'
import ConnectScreen from './components/ConnectScreen.jsx'
import CalibrationScreen from './components/CalibrationScreen.jsx'
import DashboardScreen from './components/DashboardScreen.jsx'
import LiveSessionScreen from './components/LiveSessionScreen.jsx'
import InsightsScreen from './components/InsightsScreen.jsx'

function AnimatedRoutes() {
  const location = useLocation()
  const { ansState } = useApp()

  return (
    <div className="app" data-state={ansState}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/"          element={<SplashScreen />} />
          <Route path="/connect"   element={<ConnectScreen />} />
          <Route path="/calibrate" element={<CalibrationScreen />} />
          <Route path="/dashboard" element={<DashboardScreen />} />
          <Route path="/session"   element={<LiveSessionScreen />} />
          <Route path="/insights"  element={<InsightsScreen />} />
        </Routes>
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AnimatedRoutes />
      </AppProvider>
    </BrowserRouter>
  )
}
