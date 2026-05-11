// frontend/src/components/HeadphoneCheck.jsx
// Plays a 10 Hz binaural test tone (left 195 Hz / right 205 Hz) for 3 s on mount.
// Asks the user whether they can hear the pulsing — gates binaural activation.
import { useEffect, useRef } from 'react';
import * as Tone from 'tone';

export function HeadphoneCheck({ onConfirm }) {
  const cleanupRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function playTest() {
      try {
        await Tone.start();

        const merge  = new Tone.Merge().toDestination();
        const gainL  = new Tone.Gain(0.15).connect(merge, 0, 0); // left channel
        const gainR  = new Tone.Gain(0.15).connect(merge, 0, 1); // right channel
        const oscL   = new Tone.Oscillator(195, 'sine').connect(gainL);
        const oscR   = new Tone.Oscillator(205, 'sine').connect(gainR);

        oscL.start();
        oscR.start();

        cleanupRef.current = () => {
          try { oscL.stop(); oscL.dispose(); } catch (_) {}
          try { oscR.stop(); oscR.dispose(); } catch (_) {}
          try { gainL.dispose(); }            catch (_) {}
          try { gainR.dispose(); }            catch (_) {}
          try { merge.dispose(); }            catch (_) {}
        };

        // Auto-stop after 3 seconds
        setTimeout(() => {
          if (!cancelled && cleanupRef.current) {
            cleanupRef.current();
            cleanupRef.current = null;
          }
        }, 3000);
      } catch (_) {
        // Audio context blocked — still show the UI; user can confirm/deny
      }
    }

    playTest();

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  const overlay = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.75)',
    zIndex: 1000,
  };

  const card = {
    background: '#111',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '16px',
    padding: '36px 32px',
    maxWidth: '360px',
    width: '90%',
    textAlign: 'center',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
  };

  const heading = {
    fontSize: '1.25rem',
    fontWeight: 600,
    marginBottom: '10px',
  };

  const subtext = {
    fontSize: '0.9rem',
    color: 'rgba(255,255,255,0.55)',
    marginBottom: '28px',
    lineHeight: 1.5,
  };

  const btnRow = {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  };

  const btnYes = {
    padding: '12px',
    borderRadius: '10px',
    border: 'none',
    background: 'rgba(100, 220, 160, 0.18)',
    color: '#7effc0',
    fontSize: '0.95rem',
    cursor: 'pointer',
    fontWeight: 500,
  };

  const btnNo = {
    padding: '12px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '0.9rem',
    cursor: 'pointer',
  };

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={heading}>Are you wearing headphones?</div>
        <div style={subtext}>
          You should hear a subtle pulsing tone inside your head.
          Binaural beats require headphones — they have no effect on speakers.
        </div>
        <div style={btnRow}>
          <button style={btnYes} onClick={() => onConfirm(true)}>
            Yes, I can hear it
          </button>
          <button style={btnNo} onClick={() => onConfirm(false)}>
            No / using speakers
          </button>
        </div>
      </div>
    </div>
  );
}
