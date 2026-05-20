import { useEffect, useState } from 'react';

export function ReconnectOverlay({
  visible,
  onManualRetry,
  retryAttempt = 0,
  maxRetries = 3,
}) {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  if (!visible) return null;

  const exhausted = retryAttempt >= maxRetries;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reconnecting to Polar H10"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 150,
        minHeight: '100dvh',
        background: 'rgba(10,10,15,0.78)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 360,
          width: '100%',
          background: 'rgba(20,20,28,0.92)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: 24,
          textAlign: 'center',
          color: '#E8E8F0',
          boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            margin: '0 auto 16px',
            ...(reduced
              ? { background: '#7C6FF7' }
              : {
                  border: '3px solid #7C6FF7',
                  borderTopColor: 'transparent',
                  animation: 'spin 0.9s linear infinite',
                }),
          }}
        />
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '0.02em',
            marginBottom: 8,
          }}
        >
          {exhausted ? 'Connection lost' : 'Reconnecting to Polar H10'}
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'rgba(232,232,240,0.65)',
            lineHeight: 1.45,
            marginBottom: 20,
          }}
        >
          {exhausted
            ? 'We held your session, but the strap didn’t come back. Try a manual retry, or end the session.'
            : `Attempt ${retryAttempt}/${maxRetries} — keep the strap on your chest. We’re holding your session.`}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={() => onManualRetry?.({ end: false })}
            style={{
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid rgba(124,111,247,0.6)',
              background: 'rgba(124,111,247,0.18)',
              color: '#E8E8F0',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.02em',
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            Retry now
          </button>
          <button
            onClick={() => onManualRetry?.({ end: true })}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent',
              color: 'rgba(232,232,240,0.7)',
              fontSize: 13,
              cursor: 'pointer',
              minHeight: 40,
            }}
          >
            End session
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReconnectOverlay;
