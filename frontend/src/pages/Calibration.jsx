import { useEffect, useRef, useState } from 'react';
import { WSClient } from '../utils/ws_client.js';
import { supabase } from '../lib/supabase.js';
import { SensorFusion } from '../sensors/sensor_fusion.js';
import { patchProfileCalibration } from '../lib/api.js';
import { useSensorContext } from '../context/SensorContext.jsx';

/**
 * Calibration — adaptive RF sweep with paced breathing guide.
 *
 * Psyche §3.5 additions (P2):
 *  - HR value displayed inside BreathingOrb; pulses on each HR update
 *  - Faded HRV panel shown only after n_rr >= 30 (RMSSD, HR, artifact rate)
 *  - One-time hint "The tone is following your breath" after first valid HRV
 *  - cal_hrv end display: final RMSSD + baseline update status
 *
 * Flow:
 *  1. Open WS, send {type:"cal_start"}
 *  2. Stream RR + resp_amp every 500ms while backend sweeps target frequencies
 *  3. Animate breathing orb at current target_bpm (60% inhale / 40% exhale of cycle)
 *  4. On {cal_done} → onLocked(rf_bpm)
 *  5. Skip available any time → onLocked(5.5, false)
 */
export default function Calibration({ cfg, onLocked, onSkip, isOnboarding = false }) {
  const { session, backendMode, timezone, fusion: existingFusion, sensorMode } = cfg ?? {};
  const needsH10 = sensorMode === 2 || sensorMode === 3;
  const { bleStatus, bleError, bleRef } = useSensorContext();

  const [targetBpm, setTargetBpm]         = useState(5.5);
  const [coherence, setCoherence]         = useState(0);
  const [dwellRem, setDwellRem]           = useState(30);
  const [elapsed, setElapsed]             = useState(0);
  const [status, setStatus]               = useState('connecting');
  const [rfBpm, setRfBpm]                 = useState(null);
  // P2: HRV quality scalars
  const [liveHr, setLiveHr]               = useState(null);
  const [liveRmssd, setLiveRmssd]         = useState(null);
  const [liveNRr, setLiveNRr]             = useState(0);
  const [liveArtRate, setLiveArtRate]     = useState(null);
  const [hrPulse, setHrPulse]             = useState(false);
  const [showHint, setShowHint]           = useState(false);
  const [calHrv, setCalHrv]               = useState(null);
  const [baselineEligible, setBaselineEligible] = useState(null);

  const wsRef            = useRef(null);
  const fusionRef        = useRef(null);
  const sendIvRef        = useRef(null);
  const startedRef       = useRef(false);
  const gotCalFrameRef   = useRef(false);
  const prevHrRef        = useRef(null);
  const hintShownRef     = useRef(false);

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

      const bindLifecycle = () => {
        if (!ws.ws) { setTimeout(bindLifecycle, 20); return; }
        ws.ws.addEventListener('open', () => {
          // ws_client.onopen sends auth first; we follow with cal_start in the same task.
          ws.send({ type: 'cal_start' });
          setStatus('sweeping');

          // Stream RR + resp_amp; always send a heartbeat so backend / connection is exercised.
          sendIvRef.current = setInterval(() => {
            const r = fusion.getReading?.();
            if (!r) { ws.send({ resp_amp: 0 }); return; }
            const rrs = bleRef.current?.drainNew?.() ?? [];
            if (rrs.length > 0) {
              rrs.forEach(rr => ws.send({ rr, resp_amp: r.resp_amp ?? 0 }));
            } else {
              ws.send({ resp_amp: r.resp_amp ?? 0 });
            }
          }, 500);
        });

        ws.ws.addEventListener('error', (e) => {
          console.warn('[Calibration] WS error:', e);
          if (!gotCalFrameRef.current) setStatus('error');
        });

        ws.ws.addEventListener('close', (e) => {
          console.warn('[Calibration] WS closed code=', e.code, 'reason=', e.reason);
          if (!gotCalFrameRef.current && status !== 'locked' && status !== 'timeout') {
            setStatus('error');
          }
          clearInterval(sendIvRef.current);
        });
      };
      bindLifecycle();
    }

    function handleMsg(msg) {
      if (msg.type === 'auth_ok') return;
      if (msg.cal === true) {
        gotCalFrameRef.current = true;
        if (typeof msg.target_bpm === 'number') setTargetBpm(msg.target_bpm);
        if (typeof msg.coherence_so_far === 'number') setCoherence(msg.coherence_so_far);
        if (typeof msg.dwell_remaining === 'number') setDwellRem(Math.round(msg.dwell_remaining));
        if (typeof msg.elapsed === 'number') setElapsed(msg.elapsed);

        // P2: n_rr always in cal frame
        if (typeof msg.n_rr === 'number') setLiveNRr(msg.n_rr);
        // P2: HRV quality scalars in cal frame under hrv key
        if (msg.hrv) {
          const h = msg.hrv;
          if (typeof h.hr === 'number') {
            if (prevHrRef.current !== null && Math.abs(h.hr - prevHrRef.current) > 0.5) {
              setHrPulse(true);
              setTimeout(() => setHrPulse(false), 300);
            }
            prevHrRef.current = h.hr;
            setLiveHr(h.hr);
          }
          if (typeof h.rmssd === 'number') setLiveRmssd(h.rmssd);
          if (typeof h.artifact_rate === 'number') setLiveArtRate(h.artifact_rate);

          // One-time hint after first valid HRV reading (n_rr >= 30)
          if (!hintShownRef.current && msg.n_rr >= 30) {
            hintShownRef.current = true;
            setShowHint(true);
            setTimeout(() => setShowHint(false), 4000);
          }
        }
      }
      if (msg.cal_done === true) {
        const bpm = msg.rf_bpm ?? 5.5;
        const locked = !!msg.rf_locked;
        setRfBpm(bpm);
        setStatus(locked ? 'locked' : 'timeout');
        if (msg.cal_hrv) setCalHrv(msg.cal_hrv);
        if (typeof msg.baseline_eligible === 'boolean') setBaselineEligible(msg.baseline_eligible);
        // Stop streaming and close WS immediately so it cannot reconnect during the 1.2s pause
        clearInterval(sendIvRef.current);
        try { wsRef.current?.close(); } catch (_) {}
        // Brief pause so user sees the lock event, then advance
        if (isOnboarding) {
          patchProfileCalibration({ rf_bpm: bpm, rf_locked: locked }).catch(console.warn);
        }
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

  // Breathing orb: 40% inhale / 60% exhale of period (clinically correct)
  const periodS = 60 / Math.max(targetBpm, 3.5);
  const inhaleS = (periodS * 0.4).toFixed(2);
  const exhaleS = (periodS * 0.6).toFixed(2);
  const showHrvPanel = liveNRr >= 30;
  const breatheDur = (parseFloat(inhaleS) + parseFloat(exhaleS)).toFixed(2);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes calBreathe {
          0%   { transform: scale(0.7); opacity: 0.6; }
          40%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.7); opacity: 0.6; }
        }
        @keyframes calHrPulse {
          0%   { transform: scale(1.00); }
          50%  { transform: scale(1.025); }
          100% { transform: scale(1.00); }
        }
        @keyframes calHintFade {
          0%   { opacity: 0; transform: translateY(4px); }
          15%  { opacity: 1; transform: translateY(0); }
          80%  { opacity: 1; }
          100% { opacity: 0; }
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
        {/* BreathingOrb — P2: HR inside, pulse on HR update */}
        <div
          style={{
            width: 220, height: 220, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(124,111,247,0.35) 0%, transparent 70%)',
            border: '2px solid rgba(124,111,247,0.5)',
            boxShadow: '0 0 60px rgba(124,111,247,0.25)',
            animation: (status === 'sweeping' || status === 'connecting')
              ? `calBreathe ${breatheDur}s ease-in-out infinite`
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
          {liveHr !== null && (
            <div style={{ marginTop: 10, animation: hrPulse ? 'calHrPulse 300ms ease-out' : 'none', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{Math.round(liveHr)}</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 3 }}>bpm</span>
            </div>
          )}
        </div>

        {showHint && (
          <div style={{ marginTop: 16, animation: 'calHintFade 4s ease forwards', color: 'rgba(124,111,247,0.9)', fontSize: 13, fontStyle: 'italic', textAlign: 'center' }}>
            The tone is following your breath
          </div>
        )}

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
            <>
              <div style={{ color: 'var(--locked, #00D084)', fontSize: 18, fontWeight: 700 }}>
                Locked at {rfBpm?.toFixed(1)} bpm ✓
              </div>
              {baselineEligible === true && (
                <div style={{ color: 'var(--locked, #00D084)', fontSize: 13, marginTop: 6, opacity: 0.85 }}>
                  Your baseline just updated
                </div>
              )}
              {calHrv?.rmssd_median != null && (
                <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>
                  RMSSD {Math.round(calHrv.rmssd_median)} ms
                </div>
              )}
              {rfBpm && (
                <div style={{
                  marginTop: 16,
                  padding: '16px',
                  background: 'rgba(63,191,168,0.08)',
                  border: '1.5px solid rgba(63,191,168,0.3)',
                  borderRadius: 14,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 11, color: '#3FBFA8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    RF Locked
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#3FBFA8', letterSpacing: '-0.02em' }}>
                    {rfBpm.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>breaths per minute</div>
                </div>
              )}
            </>
          )}
          {status === 'timeout' && (
            <>
              <div style={{ color: 'var(--warn, #EF9F27)', fontSize: 14 }}>
                Using best estimate {rfBpm?.toFixed(1)} bpm
              </div>
              {calHrv?.rmssd_median != null && (
                <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 4 }}>
                  RMSSD {Math.round(calHrv.rmssd_median)} ms
                </div>
              )}
            </>
          )}
          {status === 'error' && (
            <div style={{ color: 'var(--danger, #E24B4A)', fontSize: 14 }}>
              Calibration error — tap Skip
            </div>
          )}
          {/* BLE error: shown when H10 is required but connection failed or dropped */}
          {needsH10 && (bleStatus === 'failed' || bleStatus === 'fallback_rppg') && (
            <div style={{ marginTop: 8, color: 'var(--danger, #E24B4A)', fontSize: 13, textAlign: 'center' }}>
              {bleStatus === 'failed'
                ? (bleError ?? 'Polar H10 not found — check Bluetooth and pairing')
                : 'Polar H10 disconnected — using camera fallback'}
            </div>
          )}
        </div>

        {/* P2: Faded HRV panel — appears only when n_rr >= 30 */}
        {showHrvPanel && (
          <div style={{ marginTop: 16, padding: '10px 18px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 20, opacity: 0.7 }}>
            {liveRmssd !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Math.round(liveRmssd)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>RMSSD ms</div>
              </div>
            )}
            {liveHr !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Math.round(liveHr)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>HR bpm</div>
              </div>
            )}
            {liveArtRate !== null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{(liveArtRate * 100).toFixed(0)}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>artifact</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress strip — unchanged */}
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
          <span>Next sweep in: {dwellRem}s</span>
          <span>Elapsed: {Math.round(elapsed)}s · up to 2 min</span>
        </div>
      </div>
    </div>
  );
}
