import { useEffect } from 'react';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { InsightCard } from '../components/InsightCard.jsx';

// Recommendation codes by dominant ANS state
const R_CODES = {
  ventral_vagal:       { code: 'R1', msg: 'Ventral vagal dominance achieved. Repeat within 48h to consolidate.' },
  healthy_sympathetic: { code: 'R2', msg: 'Healthy activation with good vagal tone. Try Find Your Calm next.' },
  anxious_sympathetic: { code: 'R3', msg: 'Elevated sympathetic drive. Wind Down session recommended tonight.' },
  dorsal_vagal:        { code: 'R4', msg: 'Dorsal shutdown detected. Gentle movement before next session.' },
  burnout_rigidity:    { code: 'R5', msg: 'Rigidity pattern. Rest priority — session tomorrow, not today.' },
};

// Next session recommendation
const NEXT_SESSION = {
  find_your_calm:    { next: 'wind_down',         label: 'Wind Down', reason: 'Consolidate today\'s calm into sleep.' },
  wind_down:         { next: 'morning_emergence',  label: 'Morning Emergence', reason: 'Pair night regulation with morning activation.' },
  morning_emergence: { next: 'find_your_calm',     label: 'Find Your Calm', reason: 'Balance activation with mid-day regulation.' },
};

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function vsColor(vs) {
  if (vs >= 76) return '#534AB7';
  if (vs >= 56) return '#1D9E75';
  if (vs >= 31) return '#EF9F27';
  return '#E24B4A';
}

function vsLabel(vs) {
  if (vs >= 76) return 'Peak regulation';
  if (vs >= 56) return 'Good regulation';
  if (vs >= 31) return 'Moderate regulation';
  return 'Early stage';
}

export default function Insight({ data, onDone }) {
  const { release } = useWakeLock();

  // Release wake lock — no longer need screen awake
  useEffect(() => {
    release();
  }, [release]);

  if (!data) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={onDone} style={{ color: 'var(--primary)', background: 'transparent', border: 'none', fontSize: 16, cursor: 'pointer' }}>
          Back to home
        </button>
      </div>
    );
  }

  const {
    peak_vs, final_vs, skill_transfer,
    avg_rmssd, dominant_ans,
    rf_locked, rf_bpm,
    session_phase, session_type, duration_s,
  } = data;

  const rCode   = R_CODES[dominant_ans];
  const nextSes = NEXT_SESSION[session_type];
  const peakColor = vsColor(peak_vs);
  const finalColor = vsColor(final_vs);

  // Narrative debrief
  const intro = peak_vs >= 56
    ? `You reached ${vsLabel(peak_vs)} during this session.`
    : `Your nervous system was finding its footing this session.`;

  const retention = skill_transfer != null
    ? skill_transfer >= 75
      ? 'You retained the majority of your regulation — strong skill transfer.'
      : skill_transfer >= 50
        ? 'Moderate skill transfer. Consistent practice will improve retention.'
        : 'The regulation faded quickly — normal early in training.'
    : null;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', overflowX: 'hidden' }}>
      {/* Ambient bg tinted to peak VS color */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${peakColor}10, transparent 60%)`,
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 480, margin: '0 auto', padding: '48px 20px 60px' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Session complete · {session_type?.replace(/_/g, ' ')}
          </div>
          <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 32, letterSpacing: '-0.03em', lineHeight: 1.1, margin: 0 }}>
            Insight
          </h1>
        </div>

        {/* VS score hero */}
        <div className="v2-card fade-slide-up" style={{ marginBottom: 16, textAlign: 'center', padding: '28px 20px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Vitality Score
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 32, marginBottom: 12 }}>
            <div>
              <div style={{ color: peakColor, fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 52, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(peak_vs)}
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4 }}>Peak</div>
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 24 }}>→</div>
            <div>
              <div style={{ color: finalColor, fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 52, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(final_vs)}
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4 }}>Final</div>
            </div>
          </div>
          {skill_transfer != null && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: `${peakColor}18`, border: `1px solid ${peakColor}40`,
              borderRadius: 8, padding: '4px 12px',
            }}>
              <span style={{ color: peakColor, fontWeight: 700, fontSize: 15 }}>{Math.round(skill_transfer)}%</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>skill transfer</span>
            </div>
          )}
        </div>

        {/* Narrative */}
        <div className="v2-card fade-slide-up" style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>What happened</div>
          <p style={{ color: 'var(--text)', fontSize: 15, lineHeight: 1.65, margin: 0 }}>
            {intro}
            {retention ? ` ${retention}` : ''}
            {avg_rmssd ? ` Mean RMSSD was ${avg_rmssd}ms.` : ''}
          </p>
        </div>

        {/* Metrics grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <InsightCard
            icon="⏱"
            title="Duration"
            value={formatDuration(duration_s ?? 0)}
            accent="var(--primary)"
          />
          <InsightCard
            icon="💓"
            title="Avg RMSSD"
            value={avg_rmssd ? `${avg_rmssd}ms` : '—'}
          />
          <InsightCard
            icon="🔒"
            title="RF Lock"
            value={rf_locked ? `${rf_bpm?.toFixed(1)} bpm` : 'Not locked'}
            accent={rf_locked ? 'var(--locked)' : undefined}
          />
          <InsightCard
            icon="🧠"
            title="Dominant ANS"
            value={dominant_ans ? dominant_ans.replace(/_/g, ' ') : '—'}
          />
        </div>

        {/* Recommendation code */}
        {rCode && (
          <div className="v2-card fade-slide-up" style={{ marginBottom: 16, borderColor: 'rgba(124,111,247,0.2)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: 'rgba(124,111,247,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, color: 'var(--primary)', fontSize: 13, flexShrink: 0,
              }}>
                {rCode.code}
              </div>
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Recommendation</div>
                <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.5 }}>{rCode.msg}</div>
              </div>
            </div>
          </div>
        )}

        {/* Next session */}
        {nextSes && (
          <div className="v2-card fade-slide-up" style={{ marginBottom: 32 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Next session</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{nextSes.label}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.4 }}>{nextSes.reason}</div>
          </div>
        )}

        {/* RF confidence bar */}
        {rf_bpm && (
          <div className="v2-card fade-slide-up" style={{ marginBottom: 16 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              Resonance frequency
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 18, color: rf_locked ? '#1D9E75' : 'var(--text)' }}>
                {rf_bpm.toFixed(1)} bpm
              </span>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                background: rf_locked ? 'rgba(29,158,117,0.12)' : 'rgba(239,159,39,0.12)',
                color: rf_locked ? '#1D9E75' : '#EF9F27',
                border: `1px solid ${rf_locked ? 'rgba(29,158,117,0.3)' : 'rgba(239,159,39,0.3)'}`,
              }}>
                {rf_locked ? 'Locked' : 'Estimated'}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.round(((rf_bpm - 4.5) / 2.0) * 100)}%`,
                background: rf_locked ? '#1D9E75' : '#EF9F27',
                borderRadius: 3,
                transition: 'width 600ms ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>4.5 bpm</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>6.5 bpm</span>
            </div>
          </div>
        )}

        {/* Done + Share CTAs */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={async () => {
              const text = `ALIVE session complete\n${vsLabel(peak_vs)} — ${Math.round(peak_vs)} VS\nRF: ${rf_bpm ? rf_bpm.toFixed(1) + ' bpm' : '—'} | RMSSD: ${avg_rmssd ?? '—'}ms`
              if (navigator.share) {
                try { await navigator.share({ text }) } catch (_) {}
              } else {
                try { await navigator.clipboard.writeText(text) } catch (_) {}
              }
            }}
            className="touch-target"
            style={{
              flex: '0 0 auto', background: 'rgba(124,111,247,0.12)', color: 'var(--primary)',
              border: '1px solid rgba(124,111,247,0.3)', borderRadius: 14, padding: '16px 20px',
              fontWeight: 600, fontSize: 15, cursor: 'pointer',
            }}
          >
            Share
          </button>
          <button
            onClick={onDone}
            className="touch-target"
            style={{
              flex: 1, background: 'var(--primary)', color: '#fff',
              border: 'none', borderRadius: 14, padding: '16px', fontWeight: 700,
              fontSize: 17, cursor: 'pointer', fontFamily: 'var(--font-head)',
              letterSpacing: '-0.01em', boxShadow: '0 0 24px rgba(124,111,247,0.35)',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
