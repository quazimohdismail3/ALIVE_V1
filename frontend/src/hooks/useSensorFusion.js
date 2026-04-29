import { useRef, useState, useCallback } from 'react';
import { SensorFusion } from '../sensors/sensor_fusion.js';

/**
 * useSensorFusion — wraps SensorFusion lifecycle.
 *
 * mode: 1=rPPG+face+pose+mic, 2=H10 only, 3=H10+face+pose+mic
 * NOTE: frontend "Phone Only" sends mode=2 to backend (rPPG RR still forwarded as raw RR).
 *
 * Returns { start, stop, getReading, sensorStatus, error }
 * sensorStatus: 'idle' | 'starting' | 'ready' | 'error'
 */
export function useSensorFusion() {
  const fusionRef = useRef(null);
  const [sensorStatus, setSensorStatus] = useState('idle');
  const [error, setError] = useState(null);

  const start = useCallback(async (mode) => {
    setSensorStatus('starting');
    setError(null);
    try {
      const fusion = new SensorFusion(mode);
      await fusion.start();
      fusionRef.current = fusion;
      setSensorStatus('ready');
    } catch (e) {
      setError(e.message || 'Sensor start failed');
      setSensorStatus('error');
    }
  }, []);

  const stop = useCallback(() => {
    fusionRef.current?.stop?.();
    fusionRef.current = null;
    setSensorStatus('idle');
  }, []);

  const getReading = useCallback(() => {
    return fusionRef.current?.getReading?.() ?? null;
  }, []);

  return { start, stop, getReading, sensorStatus, error };
}
