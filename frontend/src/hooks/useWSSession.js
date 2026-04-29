import { useRef, useCallback, useState } from 'react';
import WSClient from '../utils/ws_client.js';

/**
 * useWSSession — manages a single WebSocket session lifecycle.
 *
 * Returns { connect, sendRR, sendCmd, disconnect, status }
 * status: 'idle' | 'connecting' | 'auth' | 'live' | 'closed' | 'error'
 */
export function useWSSession({ onFrame, onStatus, onClose }) {
  const wsRef   = useRef(null);
  const [status, setStatus] = useState('idle');

  const connect = useCallback(({ session, mode, token, timezone }) => {
    if (wsRef.current) wsRef.current.close();

    setStatus('connecting');

    const client = new WSClient(session, mode, token, (msg) => {
      if (msg.type === 'auth_ok') {
        setStatus('live');
        return;
      }
      if (msg.status) {
        onStatus?.(msg);
        return;
      }
      if ('t' in msg) {
        onFrame?.(msg);
      }
    });

    // Patch: inject timezone into auth payload
    const origOnOpen = client.ws?.onopen;
    if (client.ws) {
      client.ws.onclose = () => {
        setStatus('closed');
        onClose?.();
      };
      client.ws.onerror = () => setStatus('error');
    }

    // WSClient sends auth on open; we need to also send timezone
    // Override by wrapping send after auth_ok is confirmed above
    client._timezone = timezone || 'UTC';

    wsRef.current = client;
  }, [onFrame, onStatus, onClose]);

  const sendRR = useCallback((rrMs) => {
    wsRef.current?.send({ rr: rrMs });
  }, []);

  const sendCmd = useCallback((cmd) => {
    wsRef.current?.send({ cmd });
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('closed');
  }, []);

  return { connect, sendRR, sendCmd, disconnect, status, wsRef };
}
