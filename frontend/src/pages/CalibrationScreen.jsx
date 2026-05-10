// frontend/src/pages/CalibrationScreen.jsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { WSClient } from '../utils/ws_client.js'
import { supabase } from '../lib/supabase.js'
import { SensorFusion } from '../sensors/sensor_fusion.js'
import { patchProfileCalibration } from '../lib/api.js'
import { useSensorContext } from '../context/SensorContext.jsx'
import { useWakeLock } from '../hooks/useWakeLock.js'

const PHRASES = [
  'Listening to your autonomic rhythm…',
  'Mapping your resonance frequency…',
  'Your body is speaking — learning to hear it',
  'HRV calibration in progress…',
  'Finding the frequency where heart and breath align',
  'Calculating your personal resonance window…',
]

export default function CalibrationScreen({ onReady }) {
  const { requestBle, bleStatus, bleError, bleRef } = useSensorContext()
  const { acquire: acquireWakeLock } = useWakeLock()

  const [phase, setPhase] = useState('connect')
  const [targetBpm, setTargetBpm] = useState(5.5)
  const [coherence, setCoherence] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [nRr, setNRr] = useState(0)
  const [liveHr, setLiveHr] = useState(null)
  const [liveRmssd, setLiveRmssd] = useState(null)
  const [liveArtRate, setLiveArtRate] = useState(null)
  const [liveHf, setLiveHf] = useState(null)
  const [liveLf, setLiveLf] = useState(null)
  const [hrPulse, setHrPulse] = useState(false)
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [errorMsg, setErrorMsg] = useState(null)
  const [activeTooltip, setActiveTooltip] = useState(null)

  const wsRef = useRef(null)
  const fusionRef = useRef(null)
  const sendIvRef = useRef(null)
  const prevHrRef = useRef(null)
  const calStartedRef = useRef(false)

  // Rotate autonomic phrases every 4s during calibration
  useEffect(() => {
    if (phase !== 'calibrating') return
    const id = setInterval(() => setPhraseIdx(i => (i + 1) % PHRASES.length), 4000)
    return () => clearInterval(id)
  }, [phase])

  // Auto-start calibration once H10 connects
  useEffect(() => {
    if (bleStatus === 'connected' && phase === 'connect' && !calStartedRef.current) {
      calStartedRef.current = true
      startCalibration()
    }
  }, [bleStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  const startCalibration = useCallback(async () => {
    setPhase('calibrating')
    await acquireWakeLock().catch(() => {})

    let authToken = 'dev'
    if (supabase) {
      try {
        const { data: { session: supa } } = await supabase.auth.getSession()
        if (supa?.access_token) authToken = supa.access_token
      } catch (_) {}
    }

    const fusion = new SensorFusion(2, { externalBle: bleRef.current })
    fusionRef.current = fusion
    await fusion.start().catch(() => {})

    const ws = new WSClient(
      'find_your_calm', 2, authToken,
      handleMsg,
      { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, noReconnect: true }
    )
    wsRef.current = ws
    ws.connect()

    const waitOpen = () => {
      if (!ws.ws) { setTimeout(waitOpen, 20); return }
      ws.ws.addEventListener('open', () => {
        ws.send({ type: 'cal_start' })
        sendIvRef.current = setInterval(() => {
          if (!fusionRef.current) return
          const newRRs = fusionRef.current.drainNew ? fusionRef.current.drainNew() : []
          if (newRRs.length > 0) {
            newRRs.forEach(rr => ws.send({ rr, resp_amp: 0 }))
          } else {
            ws.send({ resp_amp: 0 })
          }
        }, 500)
      })
      ws.ws.addEventListener('close', () => clearInterval(sendIvRef.current))
      ws.ws.addEventListener('error', () => {
        clearInterval(sendIvRef.current)
        setPhase('error')
        setErrorMsg('WebSocket error — check connection and retry')
      })
    }
    waitOpen()
  }, [bleRef, acquireWakeLock]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleMsg(msg) {
    if (msg.type === 'auth_ok') return
    if (msg.cal === true) {
      if (typeof msg.target_bpm === 'number') setTargetBpm(msg.target_bpm)
      if (typeof msg.coherence_so_far === 'number') setCoherence(msg.coherence_so_far)
      if (typeof msg.elapsed === 'number') setElapsed(msg.elapsed)
      if (typeof msg.n_rr === 'number') setNRr(msg.n_rr)
      if (msg.hrv) {
        const h = msg.hrv
        if (typeof h.hr === 'number' && h.hr > 0) {
          if (prevHrRef.current !== null && Math.abs(h.hr - prevHrRef.current) > 0.5) {
            setHrPulse(true); setTimeout(() => setHrPulse(false), 300)
          }
          prevHrRef.current = h.hr
          setLiveHr(Math.round(h.hr))
        }
        if (typeof h.rmssd === 'number' && h.rmssd > 0) setLiveRmssd(Math.round(h.rmssd))
        if (typeof h.artifact_rate === 'number') setLiveArtRate(h.artifact_rate)
        if (typeof h.hf_power === 'number') setLiveHf(h.hf_power)
        if (typeof h.lf_power === 'number') setLiveLf(h.lf_power)
      }
    }
    if (msg.cal_done === true) {
      clearInterval(sendIvRef.current)
      const rfBpm = msg.rf_bpm ?? 5.5
      const rfLocked = !!msg.rf_locked
      patchProfileCalibration({ rf_bpm: rfBpm, rf_locked: rfLocked }).catch(() => {})
      setPhase('done')
      setTimeout(() => {
        try { wsRef.current?.close() } catch (_) {}
        onReady({
          rfBpm,
          rfLocked,
          rfCoherence: msg.rf_coherence ?? 0,
          fusion: fusionRef.current,
          sensorMode: 2,
          backendMode: 2,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      }, 200)
    }
  }

  useEffect(() => {
    return () => {
      clearInterval(sendIvRef.current)
      try { wsRef.current?.close() } catch (_) {}
    }
  }, [])

  const breathePeriod = (60 / Math.max(targetBpm, 3.5)).toFixed(2)
  const progressPct = Math.min((nRr / 60) * 100, 100)
  const showHrv = nRr >= 30
  const artColor = !liveArtRate ? '#7A7A96'
    : liveArtRate < 0.05 ? '#00D084'
    : liveArtRate < 0.15 ? '#EF9F27' : '#E24B4A'

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0F', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes bodyBreathe {
          0%   { transform: scale(0.95); }
          60%  { transform: scale(1.05); }
          100% { transform: scale(0.95); }
        }
        @keyframes heartBeat {
          0%   { transform: scale(1) translateZ(0); }
          50%  { transform: scale(1.5) translateZ(0); }
          100% { transform: scale(1) translateZ(0); }
        }
      `}</style>

      <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,111,247,0.10) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 480, padding: '40px 24px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-head, system-ui)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>
            Connect Your Body
          </div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 6, minHeight: 20, transition: 'opacity 0.5s' }}>
            {phase === 'connect' ? 'Wet the H10 electrodes and wear it snugly' :
             phase === 'calibrating' ? PHRASES[phraseIdx] :
             phase === 'done' ? 'Calibration complete — entering dashboard…' : 'Connection error'}
          </div>
        </div>

        {phase === 'connect' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, marginTop: 24 }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(124,111,247,0.10)', border: '1.5px solid rgba(124,111,247,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38 }}>
              📡
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Polar H10</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                {bleStatus === 'reconnecting' ? 'Connecting…' :
                 bleStatus === 'failed' ? (bleError ?? 'Not found — retry') : 'Not connected'}
              </div>
            </div>
            {bleStatus === 'failed' && bleError && (
              <div style={{ background: 'rgba(226,75,74,0.08)', border: '1px solid rgba(226,75,74,0.25)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#E24B4A', maxWidth: 280, textAlign: 'center' }}>
                {bleError}
              </div>
            )}
            <button
              onClick={requestBle}
              disabled={bleStatus === 'reconnecting'}
              style={{
                background: bleStatus === 'reconnecting' ? 'rgba(124,111,247,0.08)' : 'rgba(124,111,247,0.18)',
                border: '1.5px solid rgba(124,111,247,0.45)',
                borderRadius: 14, padding: '14px 44px',
                color: '#7C6FF7', fontWeight: 700, fontSize: 16,
                cursor: bleStatus === 'reconnecting' ? 'not-allowed' : 'pointer',
                opacity: bleStatus === 'reconnecting' ? 0.55 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              {bleStatus === 'reconnecting' ? 'Connecting…' :
               bleStatus === 'failed' ? 'Retry' : 'Connect Polar H10'}
            </button>
            <div style={{ color: 'rgba(255,255,255,0.22)', fontSize: 11, textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
              Make sure Bluetooth is on and H10 is worn with wet electrodes
            </div>
          </div>
        )}

        {phase === 'calibrating' && (
          <>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <svg
                width="140" height="280"
                viewBox="0 0 200 400"
                style={{ animation: `bodyBreathe ${breathePeriod}s ease-in-out infinite`, transformOrigin: 'center bottom', overflow: 'visible' }}
              >
                {/* Body outline — simplified human form */}
                <path
                  d="M100,18 C116,18 128,30 128,45 C128,60 120,68 116,76 L130,108 L140,168 L130,224 L124,292 L136,362 L122,366 L114,298 L106,266 L100,266 L94,266 L86,298 L78,366 L64,362 L76,292 L70,224 L60,168 L70,108 L84,76 C80,68 72,60 72,45 C72,30 84,18 100,18 Z"
                  fill="rgba(124,111,247,0.07)"
                  stroke="rgba(124,111,247,0.45)"
                  strokeWidth="1.5"
                />
                {/* Vagal nerve trace */}
                <path d="M94,72 C88,82 84,92 86,106" fill="none" stroke="rgba(63,191,168,0.25)" strokeWidth="1" strokeDasharray="3,4" />
                {/* Heart glow circle */}
                <circle
                  cx="93" cy="112"
                  r="11"
                  fill="rgba(226,75,74,0.12)"
                  stroke="rgba(226,75,74,0.55)"
                  strokeWidth="1.5"
                  style={{
                    transformOrigin: '93px 112px',
                    animation: hrPulse ? 'heartBeat 0.3s ease' : 'none',
                  }}
                />
                {/* HR display */}
                {liveHr && (
                  <>
                    <text x="100" y="148" textAnchor="middle" fill="#fff" fontSize="17" fontWeight="700" fontFamily="system-ui" letterSpacing="-0.5">{liveHr}</text>
                    <text x="100" y="162" textAnchor="middle" fill="rgba(255,255,255,0.38)" fontSize="9" fontFamily="system-ui">bpm</text>
                  </>
                )}
              </svg>
            </div>

            {/* Progress bar */}
            <div style={{ width: '100%', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>Calibrating RF</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>{nRr} RR · {Math.round(elapsed)}s</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, width: `${progressPct}%`, background: progressPct >= 100 ? '#00D084' : 'rgba(124,111,247,0.75)', transition: 'width 0.8s ease' }} />
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 3, textAlign: 'right' }}>
                Target: {targetBpm.toFixed(1)} bpm
              </div>
            </div>

            {showHrv && (
              <div style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                <MetricCell label="RMSSD" value={liveRmssd ? `${liveRmssd} ms` : '…'} color="#3FBFA8" onTip={setActiveTooltip} />
                <MetricCell label="Coherence" value={`${(coherence * 100).toFixed(0)}%`} color="#7C6FF7" onTip={setActiveTooltip} />
                <MetricCell label="RF Target" value={`${targetBpm.toFixed(1)} bpm`} color="#7C6FF7" onTip={setActiveTooltip} />
                {liveHf != null && <MetricCell label="HF Power" value={`${liveHf.toFixed(0)} ms²`} color="#3FBFA8" onTip={setActiveTooltip} />}
                {liveLf != null && <MetricCell label="LF Power" value={`${liveLf.toFixed(0)} ms²`} color="#EF9F27" onTip={setActiveTooltip} />}
                {liveArtRate != null && (
                  <MetricCell label="Artifact %" value={`${(liveArtRate * 100).toFixed(1)}%`} color={artColor} note={liveArtRate > 0.15 ? 'Check strap' : liveArtRate > 0.05 ? 'Fair signal' : 'Clean'} onTip={setActiveTooltip} />
                )}
              </div>
            )}
            {activeTooltip && (
              <div
                onClick={() => setActiveTooltip(null)}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200, padding: '0 0 32px' }}
              >
                <div style={{ background: '#1A1A2E', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, padding: '20px 24px', maxWidth: 360, width: '90%' }}
                     onClick={e => e.stopPropagation()}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 8 }}>{activeTooltip}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.62)', lineHeight: 1.55 }}>{METRIC_TIPS[activeTooltip] ?? 'No description available.'}</div>
                  <button onClick={() => setActiveTooltip(null)} style={{ marginTop: 16, background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 10, color: '#fff', padding: '8px 20px', fontSize: 13, cursor: 'pointer', width: '100%' }}>Got it</button>
                </div>
              </div>
            )}
          </>
        )}

        {phase === 'error' && (
          <div style={{ textAlign: 'center', padding: '32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 14, color: '#E24B4A', lineHeight: 1.5 }}>{errorMsg ?? 'Calibration failed'}</div>
            <button
              onClick={() => { calStartedRef.current = false; setPhase('connect'); setErrorMsg(null) }}
              style={{ background: 'rgba(124,111,247,0.12)', border: '1px solid rgba(124,111,247,0.35)', borderRadius: 10, padding: '10px 28px', color: '#7C6FF7', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const METRIC_TIPS = {
  'RMSSD': 'Root mean square of successive RR differences (ms). The primary HRV metric. Higher = stronger vagal (parasympathetic) tone. Your autonomic health baseline.',
  'Coherence': 'How rhythmically synchronized your heart rate is with your breathing cycle. Higher = more efficient autonomic balance. Peaks at your personal resonance frequency.',
  'RF Target': 'Resonance Frequency — the breathing rate (breaths/min) being tested right now. The app sweeps several frequencies to find the one that maximizes your HRV. Unique to your body.',
  'HF Power': 'High-frequency HRV power (0.15–0.4 Hz, ms²). Directly reflects parasympathetic nervous system activity. Higher = more vagal brake available.',
  'LF Power': 'Low-frequency HRV power (0.04–0.15 Hz, ms²). Reflects both sympathetic and parasympathetic tone, plus baroreceptor activity. Used to compute LF/HF balance.',
  'Artifact %': 'Fraction of heartbeat intervals flagged as noise (ectopic beats or motion artifact). Below 5% = clean signal. Above 15% = adjust strap fit or wet the electrodes.',
}

function MetricCell({ label, value, color, note, onTip }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        {onTip && METRIC_TIPS[label] && (
          <button
            onClick={() => onTip(label)}
            style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: 700, lineHeight: 1, padding: 0, flexShrink: 0 }}
          >?</button>
        )}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', marginTop: 2 }}>{note}</div>}
    </div>
  )
}
