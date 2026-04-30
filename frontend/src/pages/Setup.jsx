import { useState, useEffect, useRef } from 'react';
import { useSensorFusion } from '../hooks/useSensorFusion.js';
import { useWakeLock } from '../hooks/useWakeLock.js';

/**
 * Setup — two-step sensor initialisation before session starts.
 *
 * Step 1: permissions check + camera preview (rPPG modes)
 * Step 2: BLE pairing (H10 modes only) or readiness confirmation
 *
 * On ready: calls onReady({ ...cfg, timezone })
 */
export default function Setup({ cfg, onReady, onBack }) {
  const { start, stop, sensorStatus, error, getFusion } = useSensorFusion();
  const { acquire } = useWakeLock();
  const [step, setStep]         = useState(1);
  const [bleStatus, setBleStatus] = useState('idle'); // idle|scanning|paired|error
  const previewRef               = useRef(null);
  const streamRef                = useRef(null);

  const needsCamera = cfg?.sensorMode === 1 || cfg?.sensorMode === 3;
  const needsBLE    = cfg?.sensorMode === 2 || cfg?.sensorMode === 3;

  // Step 1: request camera permission + preview
  useEffect(() => {
    if (!needsCamera) return;
    let cancelled = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, frameRate: { ideal: 30 } }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
      })
      .catch((e) => { console.warn('[Setup] preview camera failed:', e); });

    return () => {
      cancelled = true;
      // Only stop here if not handed to fusion; fusion takes ownership on Continue.
      if (streamRef.current && !streamRef.current._handedOff) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [needsCamera]);

  async function proceedToStep2() {
    // Detach preview <video> but KEEP the stream — pass it to ContactRPPGSensor so the
    // SAME track is reused (re-acquiring rear cam right after release breaks torch on Android).
    if (previewRef.current) previewRef.current.srcObject = null;
    const handoffStream = streamRef.current;
    if (handoffStream) handoffStream._handedOff = true;
    setStep(2);
    if (!needsBLE) {
      await start(cfg.sensorMode, { externalRearStream: handoffStream });
      await acquire();
    }
  }

  async function pairBLE() {
    setBleStatus('scanning');
    try {
      const handoffStream = streamRef.current;
      if (handoffStream) handoffStream._handedOff = true;
      await start(cfg.sensorMode, { externalRearStream: handoffStream });
      setBleStatus('paired');
      await acquire();
    } catch (e) {
      setBleStatus('error');
    }
  }

  async function beginSession() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    onReady({ ...cfg, timezone, fusion: getFusion() });
  }

  const sensorReady = sensorStatus === 'ready';
  const canBegin = needsBLE ? (bleStatus === 'paired' && sensorReady) : sensorReady;
  const torchStatus = sensorReady && cfg?.sensorMode === 1 ? getFusion()?.getTorchStatus?.() : null;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 0' }}>
        <button
          onClick={onBack}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 22, cursor: 'pointer', padding: '4px 8px' }}
        >
          ←
        </button>
        <div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 17 }}>Setup</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Step {step} of {needsBLE ? 2 : 2}</div>
        </div>
        {/* progress dots */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[1, 2].map(n => (
            <div key={n} style={{ width: 8, height: 8, borderRadius: '50%', background: step >= n ? 'var(--primary)' : 'var(--surface-2)' }} />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, padding: '28px 20px 40px', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {step === 1 && (
          <>
            <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 24, marginBottom: 8 }}>
              {needsCamera ? 'Position your camera' : 'Ready to connect'}
            </h2>
            <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              {needsCamera
                ? 'Rest your fingertip gently on the rear camera. Keep still during the session.'
                : 'We\'ll connect your Polar H10 in the next step.'}
            </p>

            {needsCamera && (
              <div style={{ borderRadius: 16, overflow: 'hidden', background: 'var(--surface)', marginBottom: 24, aspectRatio: '4/3', position: 'relative' }}>
                <video
                  ref={previewRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {/* rPPG sample overlay */}
                <div style={{
                  position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '4px 12px',
                  color: 'var(--locked)', fontSize: 12, fontWeight: 600,
                }}>
                  Camera active — finger on lens
                </div>
              </div>
            )}

            <div className="v2-card" style={{ marginBottom: 24 }}>
              <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>Permissions needed</div>
              {needsCamera && (
                <PermRow label="Camera" ok={!!streamRef.current} note="Rear camera for rPPG" />
              )}
              <PermRow label="Microphone" ok={false} note="Breath / RF coherence" />
              {cfg?.sensorMode === 3 && (
                <PermRow label="Front Camera" ok={false} note="Face + posture (combined mode)" />
              )}
            </div>

            <button
              onClick={proceedToStep2}
              className="touch-target"
              style={{ width: '100%', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 14, padding: 16, fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
            >
              Continue →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 24, marginBottom: 8 }}>
              {needsBLE ? 'Connect Polar H10' : 'All set'}
            </h2>
            <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              {needsBLE
                ? 'Wet the electrodes on your Polar H10 and wear it snugly. Then tap Connect.'
                : 'Your sensors are initialising. Tap Begin when ready.'}
            </p>

            {needsBLE && (
              <div className="v2-card" style={{ marginBottom: 24, textAlign: 'center', padding: '28px 20px' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📡</div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {bleStatus === 'idle'    && 'Polar H10 not connected'}
                  {bleStatus === 'scanning' && 'Scanning…'}
                  {bleStatus === 'paired'  && <span style={{ color: 'var(--locked)' }}>Connected ✓</span>}
                  {bleStatus === 'error'   && <span style={{ color: 'var(--danger)' }}>Connection failed</span>}
                </div>
                {bleStatus !== 'paired' && (
                  <button
                    onClick={pairBLE}
                    disabled={bleStatus === 'scanning'}
                    style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: 8, opacity: bleStatus === 'scanning' ? 0.6 : 1 }}
                  >
                    {bleStatus === 'scanning' ? 'Scanning…' : bleStatus === 'error' ? 'Retry' : 'Connect'}
                  </button>
                )}
              </div>
            )}

            {!needsBLE && sensorStatus === 'starting' && (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-dim)' }}>
                Initialising sensors…
              </div>
            )}

            {error && (
              <div style={{ background: 'rgba(226,75,74,0.12)', border: '1px solid rgba(226,75,74,0.3)', borderRadius: 12, padding: 14, marginBottom: 16, color: 'var(--danger)', fontSize: 14 }}>
                {error}
              </div>
            )}

            {torchStatus === false && (
              <div style={{ background: 'rgba(239,159,39,0.12)', border: '1px solid rgba(239,159,39,0.3)', borderRadius: 12, padding: 14, marginBottom: 16, color: 'var(--warn, #EF9F27)', fontSize: 13, lineHeight: 1.5 }}>
                Flashlight not available on this browser. Fingertip rPPG needs torch — use Chrome on Android, or pair a Polar H10 (Combined / H10 mode).
              </div>
            )}
            {torchStatus === true && (
              <div style={{ background: 'rgba(0,208,132,0.10)', border: '1px solid rgba(0,208,132,0.3)', borderRadius: 12, padding: 12, marginBottom: 16, color: 'var(--locked, #00D084)', fontSize: 13 }}>
                Flashlight on — rest fingertip on rear lens.
              </div>
            )}

            <button
              onClick={beginSession}
              disabled={!canBegin}
              className="touch-target"
              style={{
                width: '100%', background: 'var(--primary)', color: '#fff',
                border: 'none', borderRadius: 14, padding: 16,
                fontWeight: 700, fontSize: 16, cursor: 'pointer',
                opacity: !canBegin ? 0.4 : 1,
                transition: 'opacity 200ms',
              }}
            >
              {sensorStatus === 'starting' ? 'Initialising sensors…' : 'Begin Calibration'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PermRow({ label, ok, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? 'var(--locked)' : 'var(--text-dim)', boxShadow: ok ? '0 0 6px var(--locked)' : 'none' }} />
      <span style={{ fontSize: 14, flex: 1 }}>{label}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{note}</span>
    </div>
  );
}
