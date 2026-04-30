import { useEffect, useRef, useState } from 'react';
import { WSClient } from '../utils/ws_client.js';
import { supabase } from '../lib/supabase.js';
import { SensorFusion } from '../sensors/sensor_fusion.js';

/**
 * Calibration — adaptive RF sweep with paced breathing guide.
 *
 * Flow:
 *  1. Open WS, send {type:"cal_start"}
 *  2. Stream RR + resp_amp every 500ms while backend sweeps target frequencies
 *  3. Animate breathing orb at current target_bpm (60% inhale / 40% exhale of cycle)
 *  4. On {cal_done} → onLocked(rf_bpm)
 *  5. Skip available any time → onLocked(5.5, false)
 */
export default function Calibration({ cfg, onLocked, onSkip }) {
  const { session, backendMode, timezone, fusion: existingFusion, sensorMode } = cfg ?? {};

  const [targetBpm, setTargetBpm]       = useState(5.5);
  const [coherence, setCoherence]       = useState(0);
  const [dwellRem, setDwellRem]         = useState(30);
  const [elapsed, setElapsed]           = useState(0);
  const [status, setStatus]             = useState('connecting'); // connecting | sweeping | locked | timeout | error
  const [rfBpm, setRfBpm]               = useState(null);

  const wsRef     = useRef(null);
  const fusionRef = useRef(null);
  const sendIvRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    async function go() {
      let authToken = 'dev';
      if (supabase) {
        const { data: { session: supa } } = await supabase.auth.getSession();
        if (supa?.access_token) authToken = supa.access_token;
      }
      if (cancelled) return;

      // Setup must hand off a started fusion via cfg.fusion. Creating a second
      // fusion here would re-grab the rear camera stream and break torch + RR.
      if (!existingFusion) {
        console.error('[Calibration] missing fusion handoff from Setup — aborting');
        setStatus('error');
        return;
      }
      const fusion = existingFusion;
      fusionRef.current = fusion;

      const ws = new WSClient(
        session ?? 'find_your_calm',
        backendMode ?? 2,
        authToken,
        handleMsg,
        { timezone, noReconnect: true }
      );
      wsRef.current = ws;
      ws.connect();

      // Wait for WS open then send cal_start
      const openWait = setInterval(() => {
        if (ws.ws?.readyState === WebSocket.OPEN) {
          ws.send({ type: 'cal_start' });
          clearInterval(openWait);
          setStatus('sweeping');

          // Start streaming RR + resp_amp
          sendIvRef.current = setInterval(() => {
            const r = fusion.getReading();
            if (!r) return;
            const rrs = Array.isArray(r.rr?.rr_ms) ? r.rr.rr_ms.slice(-5) : [];
            rrs.forEach(rr => ws.send({ rr, resp_amp: r.resp_amp ?? 0 }));
            if (rrs.length === 0 && (r.resp_amp ?? 0) > 0) {
              ws.send({ resp_amp: r.resp_amp });
            }
          }, 500);
        }
      }, 50);
    }

    function handleMsg(msg) {
      if (msg.type === 'auth_ok') return;
      if (msg.cal === true) {
        if (typeof msg.target_bpm === 'number') setTargetBpm(msg.target_bpm);
        if (typeof msg.coherence_so_far === 'number') setCoherence(msg.coherence_so_far);
        if (typeof msg.dwell_remaining === 'number') setDwellRem(Math.round(msg.dwell_remaining));
        if (typeof msg.elapsed === 'number') setElapsed(msg.elapsed);
      }
      if (msg.cal_done === true) {
        const bpm = msg.rf_bpm ?? 5.5;
        const locked = !!msg.rf_locked;
        setRfBpm(bpm);
        setStatus(locked ? 'locked' : 'timeout');
        // Stop streaming and close WS immediately so it cannot reconnect during the 1.2s pause
        clearInterval(sendIvRef.current);
        try { wsRef.current?.close(); } catch (_) {}
        // Brief pause so user sees the lock event, then advance
        setTimeout(() => onLocked(bpm, locked), 1200);
      }
    }

    go().catch((e) => {
      console.warn('Calibration start failed:', e);
      setStatus('error');
    });

    return () => {
      cancelled = true;
      clearInterval(sendIvRef.current);
      try { wsRef.current?.close(); } catch (_) {}
      // Do NOT stop fusion — it carries into the session
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Breathing orb: 60% inhale / 40% exhale of period
  const periodS = 60 / Math.max(targetBpm, 3.5);
  const inhaleS = (periodS * 0.6).toFixed(2);
  const exhaleS = (periodS * 0.4).toFixed(2);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes calBreathe {
          0%   { transform: scale(0.7); opacity: 0.6; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.7); opacity: 0.6; }
        }
      `}</style>

      <div style={{ padding: '24px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 20 }}>Calibration</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Finding your resonance frequency</div>
        </div>
        <button
          onClick={onSkip}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-dim)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
        >
          Skip
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
        <div
          style={{
            width: 220, height: 220, borderRadius: '50%',
            background: `radial-gradient(circle, rgba(124,111,247,0.35) 0%, transparent 70%)`,
            border: `2px solid rgba(124,111,247,0.5)`,
            boxShadow: '0 0 60px rgba(124,111,247,0.25)',
            animation: status === 'sweeping' || status === 'connecting'
              ? `calBreathe ${(parseFloat(inhaleS) + parseFloat(exhaleS)).toFixed(2)}s ease-in-out infinite`
              : 'none',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 32, color: '#7C6FF7', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {targetBpm.toFixed(1)}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            breaths / min
          </div>
        </div>

        <div style={{ marginTop: 32, textAlign: 'center', minHeight: 60 }}>
          {status === 'connecting' && (
            <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>Connecting…</div>
          )}
          {status === 'sweeping' && (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                Breathe with the orb
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                Inhale {inhaleS}s · Exhale {exhaleS}s
              </div>
            </>
          )}
          {status === 'locked' && (
            <div style={{ color: 'var(--locked, #00D084)', fontSize: 18, fontWeight: 700 }}>
              Locked at {rfBpm?.toFixed(1)} bpm ✓
            </div>
          )}
          {status === 'timeout' && (
            <div style={{ color: 'var(--warn, #EF9F27)', fontSize: 14 }}>
              Using best estimate {rfBpm?.toFixed(1)} bpm
            </div>
          )}
          {status === 'error' && (
            <div style={{ color: 'var(--danger, #E24B4A)', fontSize: 14 }}>
              Calibration error — tap Skip
            </div>
          )}
        </div>
      </div>

      {/* Progress strip */}
      <div style={{ padding: '0 20px 32px', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>Coherence</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {(coherence * 100).toFixed(0)}%
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--surface-2, #1a1a24)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${(coherence * 100).toFixed(0)}%`,
            background: coherence >= 0.6 ? 'var(--locked, #00D084)' : 'var(--primary, #7C6FF7)',
            transition: 'width 800ms ease, background 600ms ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, color: 'var(--text-dim)', fontSize: 11 }}>
          <span>Dwell: {dwellRem}s</span>
          <span>Elapsed: {Math.round(elapsed)}s / 120s</span>
        </div>
      </div>
    </div>
  );
}
