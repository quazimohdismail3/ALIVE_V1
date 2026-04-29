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
  const { start, stop, sensorStatus, error } = useSensorFusion();
  const { acquire } = useWakeLock();
  const [step, setStep]         = useState(1);
  const [bleStatus, setBleStatus] = useState('idle'); // idle|scanning|paired|error
  const previewRef               = useRef(null);
  const streamRef                = useRef(null);

  const needsCamera = cfg?.mode === 1 || cfg?.mode === 3;
  const needsBLE    = cfg?.mode === 2 || cfg?.mode === 3;

  // Step 1: request camera permission + preview
  useEffect(() => {
    if (!needsCamera) return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        streamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
      })
      .catch(() => {});

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [needsCamera]);

  async function proceedToStep2() {
    setStep(2);
    if (!needsBLE) {
      // No BLE — start sensors and go straight to session
      await start(cfg.mode);
      await acquire();
    }
  }

  async function pairBLE() {
    setBleStatus('scanning');
    try {
      // SensorFusion.start() handles BLE pairing internally
      await start(cfg.mode);
      setBleStatus('paired');
      await acquire();
    } catch (e) {
      setBleStatus('error');
    }
  }

  async function beginSession() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    onReady({ ...cfg, timezone });
  }

  const sensorReady = sensorStatus === 'ready';
  const canBegin = needsBLE ? (bleStatus === 'paired' && sensorReady) : sensorReady || !needsCamera;

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
              {cfg?.mode !== 2 && (
                <PermRow label="Microphone" ok={false} note="Breath detection" />
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

            <button
              onClick={beginSession}
              disabled={!canBegin && needsBLE}
              className="touch-target"
              style={{
                width: '100%', background: 'var(--primary)', color: '#fff',
                border: 'none', borderRadius: 14, padding: 16,
                fontWeight: 700, fontSize: 16, cursor: 'pointer',
                opacity: (!canBegin && needsBLE) ? 0.4 : 1,
                transition: 'opacity 200ms',
              }}
            >
              Begin Session
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
