import { useState } from 'react';

/**
 * DiscardSheet — bottom sheet to confirm session discard.
 * Two-step: first tap shows warning, confirm tap fires onDiscard.
 */
export function DiscardSheet({ onDiscard, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 40px',
        animation: 'fadeSlideUp 240ms ease-out',
      }}>
        <div style={{ width: 36, height: 4, background: 'var(--surface-2)', borderRadius: 2, margin: '0 auto 20px' }} />

        <h3 style={{ color: 'var(--danger)', fontFamily: 'var(--font-head)', fontWeight: 700, marginBottom: 8 }}>
          Discard this session?
        </h3>
        <p style={{ color: '#7A7A96', fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
          {confirmed
            ? 'This cannot be undone. Your biometric data for this session will not be saved.'
            : 'Your progress will not be saved and you\'ll return to the home screen.'}
        </p>

        {!confirmed ? (
          <button
            onClick={() => setConfirmed(true)}
            className="touch-target"
            style={{
              width: '100%', background: 'var(--danger)', color: '#fff',
              border: 'none', borderRadius: 12, padding: '14px', fontWeight: 600,
              fontSize: 16, cursor: 'pointer', marginBottom: 12,
            }}
          >
            Discard Session
          </button>
        ) : (
          <button
            onClick={onDiscard}
            className="touch-target"
            style={{
              width: '100%', background: 'var(--danger)', color: '#fff',
              border: 'none', borderRadius: 12, padding: '14px', fontWeight: 700,
              fontSize: 16, cursor: 'pointer', marginBottom: 12,
            }}
          >
            Yes, Discard Permanently
          </button>
        )}

        <button
          onClick={onCancel}
          style={{
            width: '100%', background: 'transparent', color: '#7A7A96',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '14px',
            fontSize: 16, cursor: 'pointer',
          }}
        >
          Keep Going
        </button>
      </div>
    </div>
  );
}
