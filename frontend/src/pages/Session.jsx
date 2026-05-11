import { useEffect, useRef, useState, useCallback } from 'react';
import { WSClient } from '../utils/ws_client.js';
import { supabase } from '../lib/supabase.js';
import { SessionAudio } from '../audio/session_audio.js';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { useSessionAccum } from '../hooks/useSessionAccum.js';
import { usePhase2RFConvergence } from '../hooks/usePhase2RFConvergence.js';
import { AnsState } from '../components/AnsState.jsx';
import { HrvChart } from '../components/HrvChart.jsx';
import { HrvMetrics } from '../components/HrvMetrics.jsx';
import { MusicParams } from '../components/MusicParams.jsx';
import { SensorStatusBar } from '../components/SensorStatusBar.jsx';
import { SessionTimeline } from '../components/SessionTimeline.jsx';
import { DiscardSheet } from '../components/DiscardSheet.jsx';
import { SensorFusion } from '../sensors/sensor_fusion.js';
import { useSensorContext } from '../context/SensorContext.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
// (vsColor removed — VS orb no longer rendered)

const SESSION_TIPS = {
  'VS Score': 'Vagal Synchrony score (0–100). Measures how well your nervous system is regulating right now. 0–30 = shutdown/anxious, 31–55 = stressed, 56–75 = regulated, 76–100 = flow state. Derived from HRV complexity, heart-breath coherence, and autonomic balance.',
  'RF': 'Resonance Frequency breathing. Your personal RF is the breath rate that maximizes heart rate variability amplitude — found during calibration. Breathing at this rate entrains your baroreflex loop and boosts parasympathetic tone. Orange = still converging, green = locked.',
  'RMSSD': 'Root mean square of successive RR-interval differences (ms). The primary HRV metric. Higher RMSSD = stronger vagal (parasympathetic) activity = better autonomic health. Below 20 ms: low. 20–50 ms: moderate. Above 50 ms: robust.',
  'RF Coherence': 'How synchronized your current breathing rate is with your calibrated resonance frequency. Higher = your HRV amplitude is being maximized by the breath-heart entrainment loop. Target: above 0.6 for therapeutic benefit.',
};

async function postSessionEnd(summary) {
  try {
    await fetch(`${API_URL}/api/session/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: `session-${Date.now()}`,
        session_type: summary.session_type,
        mode: summary.mode,
        peak_vs: summary.peak_vs,
        final_vs: summary.final_vs,
        phases_completed: [],
        hrv_summary: {},
        circadian_phase: summary.circadian_phase ?? 'UNKNOWN',
        circadian_fit_score: 0.5,
      }),
    });
  } catch (_) {}
}

const ANS_COLORS = {
  ventral_vagal: '#00D084',
  healthy_sympathetic: '#EF9F27',
  anxious_sympathetic: '#E24B4A',
  dorsal_vagal: '#534AB7',
  burnout_rigidity: '#7A7A96',
};

const ANS_LABELS = {
  ventral_vagal: 'Ventral',
  healthy_sympathetic: 'Healthy',
  anxious_sympathetic: 'Anxious',
  dorsal_vagal: 'Dorsal',
  burnout_rigidity: 'Burnout',
};

export default function Session({ cfg, onEnd, onDiscard }) {
  const { session, sensorMode, backendMode, timezone, rfBpm, durationS } = cfg ?? {};
  const sessionDurationS = durationS ?? 600;
  const { bleRef, bleStatus } = useSensorContext();
  const { acquire, release } = useWakeLock();
  const { push: accumPush, summarize, reset: accumReset } = useSessionAccum();
  usePhase2RFConvergence();

  const [frame, setFrame]           = useState(null);
  const [wsStatus, setWsStatus]     = useState('connecting');
  const [showDiscard, setShowDiscard] = useState(false);
  const [elapsed, setElapsed]       = useState(0);
  const [lastStatus, setLastStatus] = useState(null); // {status, n_rr, t} from backend buffering / low_sqi
  const [sensorReady, setSensorReady] = useState(false);
  const [hrvPoints, setHrvPoints]   = useState([]);
  const [activeTip, setActiveTip]   = useState(null);
  const [justLocked, setJustLocked] = useState(false);

  const wsRef       = useRef(null);
  const fusionRef   = useRef(null);
  const audioRef    = useRef(null);
  const timerRef    = useRef(null);
  const sendIvRef   = useRef(null);
  const startTimeRef = useRef(null);

  // Apply ANS state + VS period to root for CSS cascade
  useEffect(() => {
    const root = document.documentElement;
    if (frame?.ans?.state) root.setAttribute('data-ans', frame.ans.state);
    if (frame?.vs?.vs != null) {
      const period = Math.max(0.8, 3 - (frame.vs.vs / 100) * 2);
      root.style.setProperty('--vs-period', `${period.toFixed(2)}s`);
    }
    if (frame?.rf_bpm) {
      const rfPeriod = 60 / frame.rf_bpm;
      root.style.setProperty('--rf-period', `${rfPeriod.toFixed(1)}s`);
    }
    // Ghost ring: calibrated personal RF period
    const calHz = frame?.rf_calibrated_hz ?? 0.1;
    root.style.setProperty('--rf-calibrated-period', `${(1 / calHz).toFixed(2)}s`);
    // Inner orb: measured breathing rate period (null → remove so fallback applies)
    if (frame?.rf_hz) {
      root.style.setProperty('--rf-measured-period', `${(1 / frame.rf_hz).toFixed(2)}s`);
    } else {
      root.style.removeProperty('--rf-measured-period');
    }
  }, [frame]);

  // Cleanup CSS on unmount
  useEffect(() => {
    return () => {
      document.documentElement.removeAttribute('data-ans');
      document.documentElement.style.removeProperty('--vs-period');
      document.documentElement.style.removeProperty('--rf-period');
      document.documentElement.style.removeProperty('--rf-calibrated-period');
      document.documentElement.style.removeProperty('--rf-measured-period');
    };
  }, []);

  // Main session lifecycle
  useEffect(() => {
    let cancelled = false;
    accumReset();

    async function startSession() {
      // Get Supabase JWT
      let authToken = 'dev';
      if (supabase) {
        const { data: { session: supa } } = await supabase.auth.getSession();
        if (supa?.access_token) authToken = supa.access_token;
      }

      if (cancelled) return;

      // B2 fix: pass cfg.session (not token+timestamp) as first arg
      const ws = new WSClient(session, backendMode ?? 2, authToken, handleWsMessage, { timezone, durationS: sessionDurationS, rfBpm: rfBpm ?? 0 });
      ws.connect();
      // Tell backend this is a session WS (not calibration), avoids 2s peek timeout
      const flushSentinel = setInterval(() => {
        if (ws.ws?.readyState === WebSocket.OPEN) {
          ws.send({ type: 'session_start' });
          clearInterval(flushSentinel);
        }
      }, 50);
      wsRef.current = ws;

      // Setup must hand off a started fusion. If absent (direct nav / refresh)
      // we still create one, but flag sensorReady=false until a real reading arrives.
      const fusion = cfg?.fusion ?? new SensorFusion(sensorMode ?? 1, { externalBle: bleRef.current });
      fusionRef.current = fusion;
      if (!cfg?.fusion) fusion.start().catch(() => {});
      setSensorReady(!!cfg?.fusion);

      // Audio
      const audio = new SessionAudio(session);
      audioRef.current = audio;

      // WakeLock
      await acquire();

      // Elapsed timer
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const e = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsed(e);
        if (sessionDurationS > 0 && e >= sessionDurationS) endSession(false);
      }, 1000);

      // RR + resp_amp send loop
      sendIvRef.current = setInterval(() => {
        if (!fusionRef.current) return;
        const newRRs = fusionRef.current.drainNew ? fusionRef.current.drainNew() : [];
        const reading = fusionRef.current.getReading();
        const respAmp = reading?.resp_amp ?? 0;
        if (newRRs.length > 0) {
          if (!sensorReady) setSensorReady(true);
          newRRs.forEach(rr => ws.send({ rr, resp_amp: respAmp }));
        } else if (respAmp > 0) {
          ws.send({ resp_amp: respAmp });
        }
      }, 500);
    }

    startSession();

    return () => {
      cancelled = true;
      cleanup(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // B4 fix: route on 't' in msg not msg.type === 'state_update'
  function handleWsMessage(msg) {
    if (msg.type === 'auth_ok') {
      setWsStatus('live');
      // Start audio with locked RF from calibration (fallback to msg.rf_bpm or 6)
      audioRef.current?.start(rfBpm ?? msg.rf_bpm ?? 6).catch(() => {});
      return;
    }
    if (msg.status) {
      // buffering / low_sqi — surface to UI so user can see RR are flowing
      setLastStatus(msg);
      return;
    }
    if ('t' in msg) {
      setFrame(msg);
      setLastStatus(null);
      accumPush(msg);

      if (msg.metrics?.rmssd > 0) {
        setHrvPoints(prev => {
          const next = [...prev, { t: msg.t, rmssd: msg.metrics.rmssd }];
          return next.length > 180 ? next.slice(-180) : next; // max 3 min window
        });
      }

      // Wire audio updates every frame
      if (audioRef.current?._started) {
        if (msg.rf_bpm) audioRef.current.updateRF(msg.rf_bpm);
        if (msg.music_params) audioRef.current.updateMusicParams(msg.music_params, msg.affect);
        if (msg.session_phase && msg.ans?.state) {
          audioRef.current.updateState(msg.session_phase, msg.ans.state, false);
        }
      }
    }
  }

  function cleanup(sendStop) {
    clearInterval(timerRef.current);
    clearInterval(sendIvRef.current);
    if (sendStop) wsRef.current?.send({ cmd: 'stop' });
    wsRef.current?.close();
    wsRef.current = null;
    if (!cfg?.fusion) fusionRef.current?.stop?.();  // only stop if we created it
    fusionRef.current = null;
    audioRef.current?.stop?.();
    audioRef.current = null;
    release();
  }

  async function endSession(discard = false) {
    if (discard) {
      wsRef.current?.send({ cmd: 'discard' });
      await new Promise(r => setTimeout(r, 250)); // give backend time to receive discard before WS closes
      cleanup(false);
      onDiscard();
      return;
    }
    cleanup(true);
    const summary = summarize() ?? {
      peak_vs: 0, final_vs: 0, skill_transfer: 0,
      avg_rmssd: null, dominant_ans: 'unknown',
      rf_locked: false, rf_bpm: rfBpm ?? 5.5,
      duration_s: elapsed,
    };
    summary.session_type = session;
    summary.mode = backendMode ?? sensorMode ?? 1;
    await postSessionEnd(summary);
    onEnd(summary);
  }

  const rfHz           = frame?.rf_hz ?? null;
  const rfCalibratedHz = frame?.rf_calibrated_hz ?? 0.1;
  const inResonance    = rfHz !== null && Math.abs(rfHz - rfCalibratedHz) < 0.008;

  // ANS color for inline styles (mirrors --ambient CSS variable)
  const ansColor = ANS_COLORS[frame?.ans?.state] ?? '#7C6FF7';
  const ansLabel = ANS_LABELS[frame?.ans?.state] ?? 'Calibrating';

  // Fire one-shot flash when breathing locks to RF resonance
  useEffect(() => {
    if (!inResonance) return;
    setJustLocked(true);
    const t = setTimeout(() => setJustLocked(false), 1000);
    return () => clearTimeout(t);
  }, [inResonance]);

  return (
    <div className={inResonance ? 'in-resonance' : undefined} style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="ambient-bg" />

      {/* Resonance flash — one-shot on lock */}
      {justLocked && (
        <div style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1,
          background: `radial-gradient(circle at 50% 50%, ${ansColor}40, transparent 60%)`,
          animation: 'resonanceFlash 1000ms ease-out forwards',
        }} />
      )}

      {/* Header row */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 0' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {session?.replace(/_/g, ' ')}
        </div>
        {bleStatus === 'connected' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#00D084' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00D084', boxShadow: '0 0 6px #00D084' }} />
            H10
          </div>
        ) : bleStatus === 'reconnecting' ? (
          <div style={{ fontSize: 11, color: '#EF9F27' }}>H10 reconnecting…</div>
        ) : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowDiscard(true)}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-dim)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            ✕ Discard
          </button>
          <button
            onClick={() => endSession(false)}
            style={{ background: 'rgba(124,111,247,0.15)', border: '1px solid rgba(124,111,247,0.3)', color: 'var(--primary)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            End →
          </button>
        </div>
      </div>

      {/* Two-orb stack — target RF + live breathing */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, position: 'relative', zIndex: 2 }}>
        {/* Target orb — calibrated RF pace */}
        <div style={{
          width: 130, height: 130, borderRadius: '50%',
          background: `radial-gradient(circle, ${ansColor}22 0%, transparent 70%)`,
          border: `2px solid ${ansColor}55`,
          boxShadow: `0 0 40px ${ansColor}22`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          animation: 'orbPulse var(--rf-calibrated-period, 10s) ease-in-out infinite',
        }}>
          <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: `${ansColor}88`, marginBottom: 2 }}>target</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: `${ansColor}bb`, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {frame?.rf_calibrated_hz ? (rfCalibratedHz * 60).toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 8, color: `${ansColor}66` }}>br / min</div>
        </div>

        {/* Gap indicator / resonance label */}
        <div style={{
          fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
          color: inResonance ? `${ansColor}cc` : 'rgba(255,255,255,0.2)',
          transition: 'color 800ms ease',
          minHeight: 14,
        }}>
          {inResonance
            ? 'RESONANCE'
            : rfHz ? `↓ ${Math.abs((rfHz - rfCalibratedHz) * 60).toFixed(1)} off` : ''}
        </div>

        {/* Live orb — measured breathing rate */}
        <div style={{
          width: 130, height: 130, borderRadius: '50%',
          background: `radial-gradient(circle, ${ansColor}44 0%, transparent 70%)`,
          border: `2px solid ${ansColor}${inResonance ? 'cc' : '88'}`,
          boxShadow: `0 0 ${inResonance ? 80 : 55}px ${ansColor}${inResonance ? '55' : '33'}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          animation: 'orbPulse var(--rf-measured-period, 10s) ease-in-out infinite',
          transition: 'box-shadow 1200ms ease, border-color 1200ms ease',
        }}>
          <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: `${ansColor}bb`, marginBottom: 2 }}>breathing</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: `${ansColor}ee`, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {rfHz ? (rfHz * 60).toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 8, color: `${ansColor}88` }}>br / min</div>
        </div>
      </div>

      {/* Bottom strip — HR | ANS badge | RMSSD */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 28px 20px', position: 'relative', zIndex: 2,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
            {frame?.metrics?.hr ? Math.round(frame.metrics.hr) : '—'}
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>HR bpm</div>
        </div>
        <div style={{
          fontSize: 9, color: `${ansColor}dd`, border: `1px solid ${ansColor}44`,
          borderRadius: 20, padding: '4px 14px', textTransform: 'uppercase', letterSpacing: '0.1em',
          transition: 'color 1200ms ease, border-color 1200ms ease',
        }}>
          {ansLabel}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
            {frame?.metrics?.rmssd ? Math.round(frame.metrics.rmssd) : '—'}
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>RMSSD ms</div>
        </div>
      </div>

      {/* Content panels */}
      <div style={{ position: 'relative', zIndex: 2, padding: '0 20px', maxWidth: 480, margin: '0 auto' }}>

        {/* ANS state */}
        <div className="v2-card fade-slide-up" style={{ marginBottom: 12 }}>
          {frame?.ans ? (
            <AnsState state={frame.ans.state} confidence={frame.ans.confidence} actionable={frame.ans.actionable} />
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              {wsStatus === 'connecting'
                ? 'Connecting…'
                : bleStatus === 'reconnecting'
                  ? 'H10 reconnecting — keep strap on chest…'
                  : bleStatus === 'failed'
                    ? 'H10 disconnected — check strap'
                    : lastStatus?.status === 'low_sqi'
                      ? `Low signal quality (SQI ${(lastStatus.sqi * 100).toFixed(0)}%)`
                      : lastStatus?.status === 'buffering'
                        ? `Buffering HRV — ${lastStatus.n_rr ?? 0} RR collected, need ~30`
                        : 'Buffering HRV data…'}
            </div>
          )}
        </div>

        {/* RF display row */}
        {frame?.rf_bpm && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', marginTop: 12,
            background: 'rgba(255,255,255,0.03)', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: frame.rf_locked ? '#3FBFA8' : '#EF9F27', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>RF</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{frame.rf_bpm.toFixed(1)} bpm</span>
            {frame.rf_locked && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#3FBFA8' }}>locked</span>}
            <button onClick={() => setActiveTip('RF')} style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>?</button>
          </div>
        )}

        {/* Real-time HRV chart */}
        {hrvPoints.length >= 2 && (
          <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>RMSSD</span>
                <button onClick={() => setActiveTip('RMSSD')} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: 700, lineHeight: 1, padding: 0 }}>?</button>
              </div>
              {frame?.metrics?.rmssd > 0 && (
                <span style={{ fontSize: 13, fontWeight: 700, color: '#3FBFA8' }}>{Math.round(frame.metrics.rmssd)} ms</span>
              )}
            </div>
            <HrvChart points={hrvPoints} width={248} height={64} colorHex="#3FBFA8" />
          </div>
        )}

        {/* HRV metrics */}
        <div className="v2-card fade-slide-up" style={{ marginBottom: 12 }}>
          <HrvMetrics metrics={frame?.metrics} />
        </div>

        {/* Timeline */}
        <div className="v2-card fade-slide-up" style={{ marginBottom: 12 }}>
          <SessionTimeline
            currentPhase={frame?.session_phase}
            sessionType={session}
            elapsed={elapsed}
            duration={sessionDurationS || 600}
          />
        </div>

        {/* Music + sensor row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="v2-card">
            <div style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Music</div>
            <MusicParams params={frame?.music_params} strategy={frame?.strategy} />
          </div>
          <div className="v2-card">
            <div style={{ color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Sensors</div>
            <SensorStatusBar rfLocked={frame?.rf_locked} />
          </div>
        </div>

        {/* RF coherence bar */}
        {frame?.rf_coherence != null && (
          <div className="v2-card fade-slide-up" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>RF Coherence</span>
                <button onClick={() => setActiveTip('RF Coherence')} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: 700, lineHeight: 1, padding: 0 }}>?</button>
              </div>
              <span style={{ color: frame.rf_locked ? 'var(--locked)' : 'var(--warn)', fontSize: 12, fontWeight: 600 }}>
                {frame.rf_locked ? `Locked · ${frame.rf_bpm?.toFixed(1)} bpm` : `Calibrating · ${frame.rf_bpm?.toFixed(1)} bpm`}
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4,
                width: `${(frame.rf_coherence * 100).toFixed(0)}%`,
                background: frame.rf_locked ? 'var(--locked)' : 'var(--warn)',
                transition: 'width 800ms ease, background 600ms ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Tooltip popup */}
      {activeTip && (
        <div onClick={() => setActiveTip(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200, padding: '0 0 32px' }}>
          <div style={{ background: '#1A1A2E', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: '20px 24px', maxWidth: 360, width: '90%' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 8 }}>{activeTip}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.62)', lineHeight: 1.55 }}>{SESSION_TIPS[activeTip] ?? 'No description available.'}</div>
            <button onClick={() => setActiveTip(null)} style={{ marginTop: 16, background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 10, color: '#fff', padding: '8px 20px', fontSize: 13, cursor: 'pointer', width: '100%' }}>Got it</button>
          </div>
        </div>
      )}

      {/* Discard sheet */}
      {showDiscard && (
        <DiscardSheet
          onDiscard={() => endSession(true)}
          onCancel={() => setShowDiscard(false)}
        />
      )}
    </div>
  );
}
