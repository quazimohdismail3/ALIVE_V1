// frontend/src/hooks/useSensorFrame.js
import { useEffect, useRef } from 'react'
import { useSensorContext } from '../context/SensorContext.jsx'

/**
 * Subscribe to a typed WS frame from SensorContext.
 * Callback fires on each matching frame. Uses a stable ref so the caller
 * doesn't need to memoize cb — the latest version is always called.
 *
 * @param {string} type - WS frame type to subscribe to, or '*' for all frames
 * @param {function} cb - called with the parsed frame object
 */
export function useSensorFrame(type, cb) {
    const { subscribeFrame } = useSensorContext()
    const cbRef = useRef(cb)
    cbRef.current = cb
    useEffect(() => {
        const stableCb = (msg) => cbRef.current(msg)
        return subscribeFrame(type, stableCb)
    }, [type, subscribeFrame])
}
