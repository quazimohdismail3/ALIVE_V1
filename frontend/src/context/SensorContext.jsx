// frontend/src/context/SensorContext.jsx
import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { BleH10Sensor } from '../sensors/ble_h10.js'
import { BreathMicSensor } from '../sensors/breath_mic.js'

const SensorCtx = createContext(null)

// bleStatus: 'idle'|'connected'|'reconnecting'|'fallback_rppg'|'failed'|'unavailable'
// micStatus: 'idle'|'active'|'error'|'unavailable'
// wsStatus:  'idle'|'open'|'closed'|'error'

export function SensorProvider({ children }) {
    // Sensor singletons — stored in refs, never recreated on re-render
    const bleRef    = useRef(null)
    const micRef    = useRef(null)
    const wsRef     = useRef(null)
    const wsFrameCbsRef = useRef({}) // { [type]: Set<callback> }

    const [bleStatus, setBleStatus] = useState('idle')
    const [bleError,  setBleError]  = useState(null)  // human-readable error string, or null
    const [micStatus, setMicStatus] = useState('idle')
    const [wsStatus,  setWsStatus]  = useState('idle')
    const [latestRR,  setLatestRR]  = useState([])
    const [rfBpm,     setRfBpm]     = useState(null)
    const [rfLocked,  setRfLocked]  = useState(false)

    // Derive live HR from most recent RR interval
    const latestHR = latestRR.length > 0
        ? Math.round(60000 / latestRR[latestRR.length - 1])
        : null

    // Poll RR buffer from BLE sensor at 1Hz to update context state
    useEffect(() => {
        const id = setInterval(() => {
            if (bleRef.current?.isConnected()) {
                const reading = bleRef.current.getLatestRR()
                if (reading?.rr_ms?.length > 0) setLatestRR(reading.rr_ms)
            }
        }, 1000)
        return () => clearInterval(id)
    }, [])

    // requestBle MUST be called from a user gesture (button click).
    // Calling from useEffect will silently fail (Web Bluetooth requirement).
    const requestBle = useCallback(async () => {
        if (bleRef.current) return // already initialised — do not re-request
        const h10 = new BleH10Sensor()
        h10.onStatusChange((status) => {
            if (status === 'connected')    { setBleStatus('connected');    setBleError(null) }
            if (status === 'reconnecting') setBleStatus('reconnecting')
            if (status === 'fallback')     setBleStatus('fallback_rppg')
            if (status === 'failed')       { setBleStatus('failed'); setBleError(h10._lastError ?? 'BLE connection failed') }
        })
        bleRef.current = h10
        setBleStatus('reconnecting')
        setBleError(null)
        try {
            await h10.start()
        } catch (err) {
            // bleStatus/'failed' already set via onStatusChange; surface the error message.
            setBleError(err?.message ?? 'Polar H10 not found — check Bluetooth and pairing')
        }
    }, [])

    const startMic = useCallback(async () => {
        if (micRef.current?.isReady()) return // already running
        const mic = new BreathMicSensor()
        mic.onStatusChange((status) => {
            setMicStatus(status)
        })
        micRef.current = mic
        await mic.start()
    }, [])

    // initWS opens a persistent WebSocket. Safe to call multiple times — no-op if already open.
    const initWS = useCallback((url) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current
        const ws = new WebSocket(url)
        wsRef.current = ws
        ws.onopen  = () => setWsStatus('open')
        ws.onclose = () => setWsStatus('closed')
        ws.onerror = () => setWsStatus('error')
        ws.onmessage = (e) => {
            let msg
            try { msg = JSON.parse(e.data) } catch { return }
            const type = msg.type
            if (!type) return
            // Update context state for known frame types
            if (type === 'session_frame' || type === 'cal_progress') {
                if (msg.rf_bpm   != null) setRfBpm(msg.rf_bpm)
                if (msg.rf_locked != null) setRfLocked(!!msg.rf_locked)
            }
            if (type === 'phase2_rf_update' && msg.rf_bpm != null) {
                setRfBpm(msg.rf_bpm)
            }
            // Dispatch to all frame-type subscribers
            const cbs = wsFrameCbsRef.current[type]
            if (cbs) cbs.forEach(cb => cb(msg))
            const allCbs = wsFrameCbsRef.current['*']
            if (allCbs) allCbs.forEach(cb => cb(msg))
        }
        return ws
    }, [])

    const sendWS = useCallback((obj) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(obj))
        }
    }, [])

    // subscribeFrame returns an unsubscribe function
    const subscribeFrame = useCallback((type, cb) => {
        if (!wsFrameCbsRef.current[type]) wsFrameCbsRef.current[type] = new Set()
        wsFrameCbsRef.current[type].add(cb)
        return () => wsFrameCbsRef.current[type]?.delete(cb)
    }, [])

    const value = {
        // status
        bleStatus, bleError, micStatus, wsStatus,
        // live data
        latestRR, latestHR, rfBpm, rfLocked,
        // refs (for screens needing direct access)
        bleRef, micRef, wsRef,
        // actions
        requestBle, startMic, initWS, sendWS, subscribeFrame,
    }

    return <SensorCtx.Provider value={value}>{children}</SensorCtx.Provider>
}

export function useSensorContext() {
    const ctx = useContext(SensorCtx)
    if (!ctx) throw new Error('useSensorContext must be inside SensorProvider')
    return ctx
}
