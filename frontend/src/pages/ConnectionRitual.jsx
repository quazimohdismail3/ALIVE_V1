import { useEffect, useRef, useState, useCallback } from 'react'
import { WSClient } from '../utils/ws_client.js'
import { supabase } from '../lib/supabase.js'
import { SensorFusion } from '../sensors/sensor_fusion.js'
import { patchProfileCalibration } from '../lib/api.js'
import { useSensorContext } from '../context/SensorContext.jsx'

/**
 * ConnectionRitual â€” unified permissions + sensor init + RF calibration ceremony.
 *
 * Replaces the two-step Setup â†’ Calibration flow.
 * Phases: idle â†’ permissions â†’ initialising â†’ calibrating â†’ locked | error
 */
export default function ConnectionRitual({ cfg, onReady, onBack, isOnboarding = false }) {
  const { session, sensorMode, backendMode, timezone } = cfg ?? {}
  const needsH10 = sensorMode === 2 || sensorMode === 3

  const { requestBle, bleStatus, bleError, bleRef } = useSensorContext()

  // Permission state
  const [permMic, setPermMic]   = useState(false)
  const [permCam, setPermCam]   = useState(false)
  const [permPending, setPermPending] = useState(false)

  // Phase
  const [phase, setPhase] = useState('idle')

  // Calibration state
  const [targetBpm, setTargetBpm] = useState(5.5)
  const [coherence, setCoherence] = useState(0)
  const [dwellRem, setDwellRem]   = useState(30)
  const [elapsed, setElapsed]     = useState(0)
  const [liveHr, setLiveHr]       = useState(null)
  const [rfBpm, setRfBpm]         = useState(null)

  // BLE error banner — shown when BLE fails at any phase
  const [bleErrorMsg, setBleErrorMsg] = useState(null)

  // Refs
  const wsRef          = useRef(null)
  const fusionRef      = useRef(null)
  const sendIvRef      = useRef(null)
  const gotCalFrameRef = useRef(false)
  const startedCalRef  = useRef(false)
  const startedInitRef = useRef(false)

  // â”€â”€â”€ handleMsg defined with useCallback so it's stable across the cal useEffect â”€â”€â”€
  const handleMsg = useCallback((msg) => {
    if (msg.type === 'auth_ok') return
    if (msg.cal === true) {
      gotCalFrameRef.current = true
      if (typeof msg.target_bpm === 'number')       setTargetBpm(msg.target_bpm)
      if (typeof msg.coherence_so_far === 'number') setCoherence(msg.coherence_so_far)
      if (typeof msg.dwell_remaining === 'number')  setDwellRem(Math.round(msg.dwell_remaining))
      if (typeof msg.elapsed === 'number')          setElapsed(msg.elapsed)
      if (msg.hrv?.hr != null)                      setLiveHr(msg.hrv.hr)
    }
    if (msg.cal_done === true) {
      const bpm    = msg.rf_bpm ?? 5.5
      const locked = !!msg.rf_locked
      setRfBpm(bpm)
      setPhase('locked')
      clearInterval(sendIvRef.current)
      try { wsRef.current?.close() } catch (_) {}
      if (isOnboarding) {
        patchProfileCalibration({ rf_bpm: bpm, rf_locked: locked }).catch(console.warn)
      }
      setTimeout(() => onReady({ ...cfg, fusion: fusionRef.current, rfBpm: bpm, rfLocked: locked }), 1200)
    }
  }, [cfg, isOnboarding, onReady])

  // â”€â”€â”€ Phase: permissions â€” triggered by button tap (handleBegin) â”€â”€â”€
  const handleBegin = useCallback(async () => {
    setPhase('permissions')
    setPermPending(true)

    const tasks = []

    // BLE must be requested from within user gesture
    if (needsH10) {
      tasks.push(
        requestBle().catch((e) => { console.warn('[ConnectionRitual] BLE request failed:', e) })
      )
    }

    if (!needsH10) {
      tasks.push(
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(() => setPermMic(true))
          .catch((e) => { console.warn('[ConnectionRitual] mic denied:', e) })
      )
    }

    tasks.push(
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => {
          setPermCam(true)
          // Release immediately â€” SensorFusion will re-acquire the stream
          stream.getTracks().forEach(t => t.stop())
        })
        .catch((e) => { console.warn('[ConnectionRitual] camera denied:', e) })
    )

    await Promise.allSettled(tasks)
    setPermPending(false)
    setPhase('initialising')
  }, [needsH10, requestBle])

  // â”€â”€â”€ BLE failure detection â”€â”€â”€
  // If BLE fails (device not found, pairing cancelled, mid-session drop) surface
  // an error banner. During calibration a 'failed' or 'fallback_rppg' status means
  // no RR intervals will arrive; show the banner so the user knows to act.
  useEffect(() => {
    if (!needsH10) return
    if (bleStatus === 'failed') {
      setBleErrorMsg(bleError ?? 'Polar H10 not found — check Bluetooth and pairing')
    } else if (bleStatus === 'fallback_rppg') {
      setBleErrorMsg('Polar H10 disconnected — retrying automatically…')
    } else if (bleStatus === 'reconnecting') {
      setBleErrorMsg('Polar H10 reconnecting…')
    } else if (bleStatus === 'connected') {
      setBleErrorMsg(null)
    }
  }, [bleStatus, bleError, needsH10])

  // â”€â”€â”€ Phase: initialising â”€â”€â”€
  useEffect(() => {
    if (phase !== 'initialising') return
    if (startedInitRef.current) return
    startedInitRef.current = true
    let cancelled = false

    async function init() {
      try {
        const fusion = new SensorFusion(sensorMode ?? 1, { externalBle: bleRef.current ?? null })
        await fusion.start()
        if (cancelled) { fusion.stop?.(); return }
        fusionRef.current = fusion
        if (cfg?.skipCalibration) {
          // Quick Start -- skip RF sweep, use saved rfBpm
          setPhase('locked')
          setTimeout(() => onReady({ ...cfg, fusion, rfBpm: cfg.rfBpm ?? 5.5, rfLocked: cfg.rfLocked ?? false }), 800)
        } else {
          setPhase('calibrating')
        }
      } catch (e) {
        console.warn('[ConnectionRitual] SensorFusion.start failed:', e)
        if (!cancelled) setPhase('error')
      }
    }

    init()

    return () => { cancelled = true }
  }, [phase, sensorMode])

  // â”€â”€â”€ Phase: calibrating â”€â”€â”€
  useEffect(() => {
    if (phase !== 'calibrating') return
    if (startedCalRef.current) return
    startedCalRef.current = true
    let cancelled = false

    async function startCal() {
      let authToken = 'dev'
      if (supabase) {
        const { data: { session: supa } } = await supabase.auth.getSession()
        if (supa?.access_token) authToken = supa.access_token
      }
      if (cancelled) return

      const ws = new WSClient(
        session ?? 'find_your_calm',
        backendMode ?? 2,
        authToken,
        handleMsg,
        { timezone, noReconnect: true }
      )
      wsRef.current = ws
      ws.connect()

      const bindLifecycle = () => {
        if (!ws.ws) { setTimeout(bindLifecycle, 20); return }

        ws.ws.addEventListener('open', () => {
          ws.send({ type: 'cal_start' })

          sendIvRef.current = setInterval(() => {
            const fusion = fusionRef.current
            if (!fusion) { ws.send({ resp_amp: 0 }); return }
            const r = fusion.getReading?.()
            if (!r) { ws.send({ resp_amp: 0 }); return }
            const rrs = Array.isArray(r.rr?.rr_ms) ? r.rr.rr_ms.slice(-5) : []
            if (rrs.length > 0) {
              rrs.forEach(rr => ws.send({ rr, resp_amp: r.resp_amp ?? 0 }))
            } else {
              ws.send({ resp_amp: r.resp_amp ?? 0 })
            }
          }, 500)
        })

        ws.ws.addEventListener('error', (e) => {
          console.warn('[ConnectionRitual] WS error:', e)
          if (!gotCalFrameRef.current && !cancelled) setPhase('error')
        })

        ws.ws.addEventListener('close', (e) => {
          console.warn('[ConnectionRitual] WS closed code=', e.code)
          clearInterval(sendIvRef.current)
        })
      }
      bindLifecycle()
    }

    startCal().catch((e) => {
      console.warn('[ConnectionRitual] startCal failed:', e)
      if (!cancelled) setPhase('error')
    })

    return () => {
      cancelled = true
      clearInterval(sendIvRef.current)
      try { wsRef.current?.close() } catch (_) {}
    }
  }, [phase, session, backendMode, timezone, handleMsg])

  // â”€â”€â”€ Global cleanup â”€â”€â”€
  useEffect(() => {
    return () => {
      clearInterval(sendIvRef.current)
      try { wsRef.current?.close() } catch (_) {}
      fusionRef.current?.stop?.()
    }
  }, [])

  // â”€â”€â”€ Skip â”€â”€â”€
  function handleSkip() {
    clearInterval(sendIvRef.current)
    try { wsRef.current?.close() } catch (_) {}
    onReady({ ...cfg, fusion: fusionRef.current, rfBpm: cfg?.rfBpm ?? 5.5, rfLocked: false })
  }

  // â”€â”€â”€ Retry from error â”€â”€â”€
  function handleRetry() {
    startedInitRef.current = false
    startedCalRef.current  = false
    gotCalFrameRef.current = false
    setPermMic(false)
    setPermCam(false)
    setTargetBpm(5.5)
    setCoherence(0)
    setDwellRem(30)
    setElapsed(0)
    setLiveHr(null)
    setRfBpm(null)
    setPhase('idle')
  }

  // â”€â”€â”€ Breathing orb timing â”€â”€â”€
  const periodS   = 60 / Math.max(targetBpm, 3.5)
  const inhaleS   = (periodS * 0.4).toFixed(2)
  const exhaleS   = (periodS * 0.6).toFixed(2)
  const breatheDur = periodS.toFixed(2)

  const isCalibrating = phase === 'calibrating'
  const isLocked      = phase === 'locked'

  // Breath phase cue — syncs with CSS animation cycle
  const [breathPhase, setBreathPhase] = useState('inhale')
  useEffect(() => {
    if (!isCalibrating) return
    const iv = setInterval(() => {
      const periodMs = periodS * 1000
      const t = (Date.now() % periodMs) / periodMs
      setBreathPhase(t < 0.4 ? 'inhale' : 'exhale')
    }, 250)
    return () => clearInterval(iv)
  }, [isCalibrating, periodS])

  // Rotating guidance tips, one every 12 seconds
  const CAL_TIPS = [
    "Breathe naturally — don't force the rhythm",
    "Your heart rate variability guides the search",
    "Slow breath activates your vagus nerve",
    "Keep still and let your body lead",
    "Each breath narrows your resonance point",
  ]
  const [tipIndex, setTipIndex] = useState(0)
  useEffect(() => {
    if (!isCalibrating) return
    const iv = setInterval(() => setTipIndex(i => (i + 1) % CAL_TIPS.length), 12000)
    return () => clearInterval(iv)
  }, [isCalibrating])

  const orbColor = isLocked
    ? 'rgba(0,208,132,0.35)'
    : 'rgba(124,111,247,0.35)'
  const orbBorder = isLocked
    ? 'rgba(0,208,132,0.55)'
    : 'rgba(124,111,247,0.5)'
  const orbGlow = isLocked
    ? '0 0 60px rgba(0,208,132,0.3)'
    : '0 0 60px rgba(124,111,247,0.25)'

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <style>{`
        @keyframes ritualBreathe {
          0%   { transform: scale(0.7); opacity: 0.6; }
          40%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.7); opacity: 0.6; }
        }
        @keyframes ritualLockedPulse {
          0%   { transform: scale(1.0); opacity: 0.9; }
          50%  { transform: scale(1.06); opacity: 1; }
          100% { transform: scale(1.0); opacity: 0.9; }
        }
        @keyframes ritualSpinner {
          to { transform: rotate(360deg); }
        }
        @keyframes ritualFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* â”€â”€ Top bar â”€â”€ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 0' }}>
        <button
          onClick={onBack}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 22, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}
          aria-label="Back"
        >
          â†
        </button>

        {/* Skip â€” only shown during calibration */}
        {isCalibrating && (
          <button
            onClick={handleSkip}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-dim)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            Skip
          </button>
        )}
      </div>

      {/* â•â•â•â•â•â•â•â•â•â• Phase: idle â•â•â•â•â•â•â•â•â•â• */}
      {phase === 'idle' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px 48px', animation: 'ritualFadeIn 400ms ease' }}>
          <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 28, textAlign: 'center', margin: '0 0 10px' }}>
            Connect your body
          </h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 15, textAlign: 'center', margin: '0 0 40px', lineHeight: 1.6 }}>
            Listen to the pulse
          </p>

          {/* Permission checklist */}
          <div style={{ width: '100%', maxWidth: 340, marginBottom: 40, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!needsH10 && <PermRow label="Microphone" status="unchecked" note="Breath coherence" />}
            <PermRow label="Camera" status="unchecked" note="Heart rate (rPPG)" />
            {needsH10 && (
              <PermRow label="Polar H10" status="unchecked" note="BLE heart sensor" />
            )}
          </div>

          <button
            onClick={handleBegin}
            style={{
              width: '100%', maxWidth: 340,
              background: 'var(--primary, #7C6FF7)',
              color: '#fff', border: 'none', borderRadius: 16,
              padding: '18px 0', fontWeight: 700, fontSize: 17,
              cursor: 'pointer',
              boxShadow: '0 0 32px rgba(124,111,247,0.35)',
              transition: 'box-shadow 200ms',
            }}
          >
            Begin
          </button>
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â• Phase: permissions â•â•â•â•â•â•â•â•â•â• */}
      {phase === 'permissions' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px 48px', animation: 'ritualFadeIn 300ms ease' }}>
          <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 24, textAlign: 'center', margin: '0 0 8px' }}>
            Requesting access
          </h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', margin: '0 0 36px' }}>
            Allow each prompt to continue
          </p>

          <div style={{ width: '100%', maxWidth: 340, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!needsH10 && (
              <PermRow
                label="Microphone"
                status={permMic ? 'done' : (permPending ? 'pending' : 'unchecked')}
                note="Breath coherence"
              />
            )}
            <PermRow
              label="Camera"
              status={permCam ? 'done' : (permPending ? 'pending' : 'unchecked')}
              note="Heart rate (rPPG)"
            />
            {needsH10 && (
              <PermRow
                label="Polar H10"
                status={bleStatus === 'connected' ? 'done' : (permPending ? 'pending' : 'unchecked')}
                note="BLE heart sensor"
              />
            )}
          </div>
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â• Phase: initialising â•â•â•â•â•â•â•â•â•â• */}
      {phase === 'initialising' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px 48px', animation: 'ritualFadeIn 300ms ease' }}>
          <div
            style={{
              width: 180, height: 180, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(124,111,247,0.25) 0%, transparent 70%)',
              border: '2px solid rgba(124,111,247,0.4)',
              boxShadow: '0 0 48px rgba(124,111,247,0.2)',
              animation: `ritualBreathe 4s ease-in-out infinite`,
            }}
          />
          <p style={{ marginTop: 28, color: 'var(--text-dim)', fontSize: 15, textAlign: 'center' }}>
            Initialising sensorsâ€¦
          </p>
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â• Phase: calibrating â•â•â•â•â•â•â•â•â•â• */}
      {isCalibrating && (() => {
        const CAL_CAP_S = 120
        const progressPct = Math.min(1, elapsed / CAL_CAP_S)
        const R = 116
        const circ = 2 * Math.PI * R
        const dashOffset = circ * (1 - progressPct)
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px 0', animation: 'ritualFadeIn 400ms ease' }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 22, textAlign: 'center', margin: '12px 0 20px' }}>
              Finding your resonance
            </h2>

            {/* Progress ring + breathing orb */}
            <div style={{ position: 'relative', width: 248, height: 248, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* SVG progress arc */}
              <svg width="248" height="248" style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
                <circle cx="124" cy="124" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                <circle
                  cx="124" cy="124" r={R} fill="none"
                  stroke={coherence >= 0.6 ? '#00D084' : '#7C6FF7'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={dashOffset}
                  style={{ transition: 'stroke-dashoffset 900ms ease, stroke 600ms ease' }}
                />
              </svg>

              {/* Breathing orb */}
              <div
                style={{
                  width: 220, height: 220, borderRadius: '50%',
                  background: `radial-gradient(circle, ${orbColor} 0%, transparent 70%)`,
                  border: `2px solid ${orbBorder}`,
                  boxShadow: orbGlow,
                  animation: `ritualBreathe ${breatheDur}s ease-in-out infinite`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {/* Breath phase cue */}
                <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(124,111,247,0.7)', marginBottom: 4, fontWeight: 600 }}>
                  {breathPhase === 'inhale' ? 'Inhale' : 'Exhale'}
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 28, color: '#7C6FF7', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {targetBpm.toFixed(1)}
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  breaths/min
                </div>
                {liveHr !== null ? (
                  <div style={{ marginTop: 8, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                    <span style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{Math.round(liveHr)}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 3 }}>bpm HR</span>
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
                    waiting for HR...
                  </div>
                )}
              </div>
            </div>

            {/* Timing cue */}
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                {inhaleS}s in &middot; {exhaleS}s out
              </div>
            </div>

            {/* Rotating tip — fades between messages */}
            <div style={{ marginTop: 18, textAlign: 'center', minHeight: 36, padding: '0 12px' }}>
              <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.5, margin: 0, transition: 'opacity 600ms ease' }}>
                {CAL_TIPS[tipIndex]}
              </p>
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Coherence + time progress */}
            <div style={{ width: '100%', maxWidth: 480, padding: '0 0 32px', boxSizing: 'border-box' }}>
              {/* Coherence bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>Coherence</span>
                <span style={{ color: 'var(--text-dim)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  {(coherence * 100).toFixed(0)}%
                </span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(coherence * 100).toFixed(0)}%`,
                  background: coherence >= 0.6 ? '#00D084' : 'var(--primary, #7C6FF7)',
                  transition: 'width 800ms ease, background 600ms ease',
                  borderRadius: 4,
                }} />
              </div>

              {/* Time progress bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 }}>
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                  {dwellRem > 0 ? `Next sweep in ${dwellRem}s` : 'Analysing pattern…'}
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(elapsed)}s / 2 min
                </span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(progressPct * 100).toFixed(1)}%`,
                  background: 'rgba(124,111,247,0.5)',
                  transition: 'width 900ms linear',
                  borderRadius: 4,
                }} />
              </div>
            </div>
          </div>
        )
      })()}

      {/* â•â•â•â•â•â•â•â•â•â• Phase: locked â•â•â•â•â•â•â•â•â•â• */}
      {isLocked && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px 48px', animation: 'ritualFadeIn 400ms ease' }}>
          <div
            style={{
              width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,208,132,0.35) 0%, transparent 70%)',
              border: '2px solid rgba(0,208,132,0.55)',
              boxShadow: '0 0 60px rgba(0,208,132,0.3)',
              animation: 'ritualLockedPulse 2s ease-in-out infinite',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{ fontSize: 36, lineHeight: 1 }}>âœ“</div>
          </div>
          <div style={{ marginTop: 28, textAlign: 'center' }}>
            <div style={{ color: '#00D084', fontSize: 20, fontWeight: 700 }}>
              Connected âœ“
            </div>
            {rfBpm !== null && (
              <div style={{ color: 'rgba(0,208,132,0.8)', fontSize: 15, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                {rfBpm.toFixed(1)} bpm resonance locked
              </div>
            )}
          </div>
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â• Phase: error â•â•â•â•â•â•â•â•â•â• */}
      {phase === 'error' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px 48px', animation: 'ritualFadeIn 300ms ease' }}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>âš ï¸</div>
          <div style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 8 }}>
            Connection error
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', marginBottom: 36 }}>
            Check sensor and try again
          </div>
          <div style={{ display: 'flex', gap: 14, width: '100%', maxWidth: 320 }}>
            <button
              onClick={handleRetry}
              style={{
                flex: 1, background: 'var(--primary, #7C6FF7)', color: '#fff',
                border: 'none', borderRadius: 12, padding: '14px 0',
                fontWeight: 600, fontSize: 15, cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              onClick={handleSkip}
              style={{
                flex: 1, background: 'transparent', color: 'var(--text-dim)',
                border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '14px 0',
                fontWeight: 600, fontSize: 15, cursor: 'pointer',
              }}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* BLE error banner — visible across all phases when H10 is required but failed */}
      {needsH10 && bleErrorMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          maxWidth: 340, width: 'calc(100% - 48px)',
          background: 'rgba(226,75,74,0.15)', border: '1px solid rgba(226,75,74,0.45)',
          borderRadius: 12, padding: '12px 16px',
          color: '#E24B4A', fontSize: 13, textAlign: 'center', lineHeight: 1.5,
          zIndex: 100, animation: 'ritualFadeIn 300ms ease',
        }}>
          {bleErrorMsg}
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ PermRow helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// status: 'unchecked' | 'pending' | 'done'
function PermRow({ label, status, note }) {
  const isDone    = status === 'done'
  const isPending = status === 'pending'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 22, height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isDone && (
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#00D084', boxShadow: '0 0 8px #00D084' }} />
        )}
        {isPending && (
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2px solid rgba(124,111,247,0.3)',
            borderTopColor: '#7C6FF7',
            animation: 'ritualSpinner 700ms linear infinite',
          }} />
        )}
        {!isDone && !isPending && (
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
        )}
      </div>
      <span style={{ fontSize: 14, flex: 1 }}>{label}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{note}</span>
    </div>
  )
}

