import { useEffect, useRef, useState, useCallback } from 'react';
import { WSClient } from '../utils/ws_client.js';
import { supabase } from '../lib/supabase.js';
import { SessionAudio } from '../audio/session_audio.js';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { useSessionAccum } from '../hooks/useSessionAccum.js';
import { AnsState } from '../components/AnsState.jsx';
import { HrvMetrics } from '../components/HrvMetrics.jsx';
import { MusicParams } from '../components/MusicParams.jsx';
import { SensorStatusBar } from '../components/SensorStatusBar.jsx';
import { SessionTimeline } from '../components/SessionTimeline.jsx';
import { DiscardSheet } from '../components/DiscardSheet.jsx';
import { SensorFusion } from '../sensors/sensor_fusion.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const SESSION_DURATION_S = 600;

// VS score → color band (matches backend vs_score.py)
function vsColor(vs) {
  if (vs >= 76) return '#534AB7';
  if (vs >= 56) return '#1D9E75';
  if (vs >= 31) return '#EF9F27';
  return '#E24B4A';
}

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

export default function Session({ cfg, onEnd, onDiscard }) {
  const { session, sensorMode, backendMode, timezone } = cfg ?? {};
  const { acquire, release } = useWakeLock();
  const { push: accumPush, summarize, reset: accumReset } = useSessionAccum();

  const [frame, setFrame]           = useState(null);
  const [wsStatus, setWsStatus]     = useState('connecting');
  const [showDiscard, setShowDiscard] = useState(false);
  const [elapsed, setElapsed]       = useState(0);

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
  }, [frame]);

  // Cleanup CSS on unmount
  useEffect(() => {
    return () => {
      document.documentElement.removeAttribute('data-ans');
      document.documentElement.style.removeProperty('--vs-period');
      document.documentElement.style.removeProperty('--rf-period');
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
      const ws = new WSClient(session, backendMode ?? 2, authToken, handleWsMessage, { timezone });
      ws.connect();
      wsRef.current = ws;

      // Reuse fusion from Setup (already has sensors started + BLE paired).
      // Only create a new one if cfg.fusion is absent (e.g., direct navigation).
      const fusion = cfg?.fusion ?? new SensorFusion(sensorMode ?? 1);
      fusionRef.current = fusion;
      if (!cfg?.fusion) fusion.start().catch(() => {});

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
        if (e >= SESSION_DURATION_S) endSession(false);
      }, 1000);

      // RR send loop — only sends real sensor RR data
      sendIvRef.current = setInterval(() => {
        const reading = fusion.getReading();
        if (!reading?.rr) return;
        const rrs = Array.isArray(reading.rr.rr_ms) ? reading.rr.rr_ms.slice(-5) : [];
        // B1 fix: send {rr: value} — backend reads msg["rr"]
        rrs.forEach(rr => ws.send({ rr }));
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
      // B5 fix: start audio after auth confirmed, with RF bpm
      audioRef.current?.start(msg.rf_bpm ?? 6).catch(() => {});
      return;
    }
    if (msg.status) {
      // buffering / low_sqi — not a data frame
      return;
    }
    if ('t' in msg) {
      setFrame(msg);
      accumPush(msg);

      // Wire audio updates every frame
      if (audioRef.current?._started) {
        if (msg.rf_bpm) audioRef.current.updateRF(msg.rf_bpm);
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
    fusionRef.current?.stop?.();
    fusionRef.current = null;
    audioRef.current?.stop?.();
    audioRef.current = null;
    release();
  }

  async function endSession(discard = false) {
    if (discard) {
      wsRef.current?.send({ cmd: 'discard' });
      cleanup(false);
      onDiscard();
      return;
    }
    cleanup(true);
    const summary = summarize();
    if (summary) {
      summary.session_type = session;
      summary.mode = mode;
      await postSessionEnd(summary);
    }
    onEnd(summary);
  }

  const vs      = frame?.vs?.vs ?? 0;
  const color   = vsColor(vs);
  const rfPer   = frame?.rf_bpm ? 60 / frame.rf_bpm : 10;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', position: 'relative', overflow: 'hidden' }}>
      <div className="ambient-bg" />

      {/* Living VS orb — pulses at VS-driven period */}
      <div style={{
        position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)',
        width: 200, height: 200, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
        border: `2px solid ${color}44`,
        boxShadow: `0 0 40px ${color}22`,
        animation: `vsPulse var(--vs-period, 2s) ease-in-out infinite`,
        transition: 'box-shadow 1200ms ease, border-color 1200ms ease',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 48, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {Math.round(vs)}
        </div>
        <div style={{ color: '#7A7A96', fontSize: 12, marginTop: 4 }}>VS score</div>
      </div>

      {/* RF breath ring */}
      <div style={{
        position: 'absolute', top: 'calc(18% - 20px)', left: '50%', transform: 'translateX(-50%)',
        width: 240, height: 240, borderRadius: '50%',
        border: `1.5px solid ${frame?.rf_locked ? 'var(--locked)' : 'rgba(255,255,255,0.08)'}`,
        animation: `breatheRing var(--rf-period, 10s) ease-in-out infinite`,
        pointerEvents: 'none',
        transition: 'border-color 1000ms ease',
      }} />

      {/* Header row */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 0' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {session?.replace(/_/g, ' ')}
        </div>
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

      {/* Content panels */}
      <div style={{ position: 'relative', zIndex: 2, padding: '0 20px', maxWidth: 480, margin: '0 auto' }}>
        {/* Spacer for orb */}
        <div style={{ height: 280 }} />

        {/* ANS state */}
        <div className="v2-card fade-slide-up" style={{ marginBottom: 12 }}>
          {frame?.ans ? (
            <AnsState state={frame.ans.state} confidence={frame.ans.confidence} actionable={frame.ans.actionable} />
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              {wsStatus === 'connecting' ? 'Connecting…' : 'Buffering HRV data…'}
            </div>
          )}
        </div>

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
            duration={SESSION_DURATION_S}
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
            <SensorStatusBar mode={mode} sensorStatus="ready" rfLocked={frame?.rf_locked} />
          </div>
        </div>

        {/* RF coherence bar */}
        {frame?.rf_coherence != null && (
          <div className="v2-card fade-slide-up" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>RF Coherence</span>
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
