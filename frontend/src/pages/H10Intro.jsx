import { H10_INTRO_COPY } from '../copy/h10IntroCopy.js'

export default function H10Intro({ onContinue }) {
  const markSeenAndContinue = () => {
    try { localStorage.setItem('h10_intro_seen', '1') } catch (_) {}
    onContinue?.()
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#0A0A0F',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top-right skip */}
      <button
        onClick={markSeenAndContinue}
        style={{
          position: 'absolute', top: 18, right: 18,
          background: 'none', border: 'none',
          color: 'rgba(255,255,255,0.45)', fontSize: 13,
          cursor: 'pointer', padding: '6px 10px',
        }}
      >
        Skip
      </button>

      {/* Ambient halo (matches CalibrationScreen idiom) */}
      <div style={{
        position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)',
        width: 320, height: 320, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,111,247,0.10) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        width: '100%', maxWidth: 480, padding: '64px 24px 40px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          width: 88, height: 88, borderRadius: '50%',
          background: 'rgba(124,111,247,0.10)',
          border: '1.5px solid rgba(124,111,247,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 38, marginBottom: 20,
        }}>
          📡
        </div>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontFamily: 'var(--font-head, system-ui)', fontWeight: 700,
            fontSize: 26, letterSpacing: '-0.02em',
          }}>
            {H10_INTRO_COPY.title}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.55)', fontSize: 14,
            marginTop: 10, lineHeight: 1.5, maxWidth: 360,
          }}>
            {H10_INTRO_COPY.subtitle}
          </div>
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
          {H10_INTRO_COPY.bullets.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{
                flexShrink: 0,
                width: 8, height: 8, borderRadius: '50%',
                background: 'rgba(124,111,247,0.65)',
                marginTop: 6,
              }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 2 }}>
                  {b.title}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                  {b.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onContinue}
          style={{
            background: 'rgba(124,111,247,0.18)',
            border: '1.5px solid rgba(124,111,247,0.45)',
            borderRadius: 14, padding: '14px 44px',
            color: '#7C6FF7', fontWeight: 700, fontSize: 16,
            cursor: 'pointer', minHeight: 44, width: '100%', maxWidth: 320,
          }}
        >
          {H10_INTRO_COPY.cta}
        </button>

        <button
          onClick={markSeenAndContinue}
          style={{
            marginTop: 14,
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,0.45)', fontSize: 13,
            textDecoration: 'underline', cursor: 'pointer',
            padding: '6px 10px',
          }}
        >
          {H10_INTRO_COPY.skip}
        </button>
      </div>
    </div>
  )
}
