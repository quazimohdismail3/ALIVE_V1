import { useRef, useCallback } from 'react';

/**
 * useWakeLock — requests/releases screen wake lock.
 * Silently no-ops if API unavailable (desktop).
 */
export function useWakeLock() {
  const lockRef = useRef(null);

  const acquire = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      lockRef.current = await navigator.wakeLock.request('screen');
    } catch (_) {
      // not critical — session continues without lock
    }
  }, []);

  const release = useCallback(async () => {
    if (lockRef.current) {
      await lockRef.current.release().catch(() => {});
      lockRef.current = null;
    }
  }, []);

  return { acquire, release };
}
