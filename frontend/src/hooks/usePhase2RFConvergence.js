// frontend/src/hooks/usePhase2RFConvergence.js
// Listens for phase2_rf_update WS frames and persists improved RF to the user profile.
import { useCallback } from 'react'
import { useSensorFrame } from './useSensorFrame.js'
import { patchProfileCalibration } from '../lib/api.js'

export function usePhase2RFConvergence({ onRFUpdated } = {}) {
    const handleFrame = useCallback(async (msg) => {
        if (!msg.rf_locked) return
        try {
            await patchProfileCalibration({ rf_bpm: msg.rf_bpm, rf_locked: true })
            onRFUpdated?.(msg.rf_bpm)
        } catch (e) {
            console.warn('phase2 RF persist failed', e)
        }
    }, [onRFUpdated])

    useSensorFrame('phase2_rf_update', handleFrame)
}
