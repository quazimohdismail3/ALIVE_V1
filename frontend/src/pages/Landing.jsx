import { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

// Circadian fit table — matches backend context/circadian.py SESSION_CIRCADIAN_FIT
const SESSION_CIRCADIAN_FIT = {
  find_your_calm:    { best: [20, 22], decent: [12, 20], label: 'Evening best' },
  wind_down:         { best: [21, 24], decent: [18, 24], label: 'Night best' },
  morning_emergence: { best: [5, 9],   decent: [9, 11],  label: 'Morning best' },
};

function getHourLocal() {
  return new Date().getHours();
}

function circadianBadge(sessionId) {
  const fit = SESSION_CIRCADIAN_FIT[sessionId];
  if (!fit) return null;
  const h = getHourLocal();
  const inBest   = h >= fit.best[0]   && h <= fit.best[1];
  const inDecent = h >= fit.decent[0] && h <= fit.decent[1];
  if (inBest)   return { label: 'Best now', color: '#00D084' };
  if (inDecent) return { label: 'Decent',   color: '#EF9F27' };
  return { label: 'Not ideal', color: '#7A7A96' };
}

const SESSIONS = [
  {
    id: 'find_your_calm',
    label: 'Find Your Calm',
    desc: 'Guide your nervous system from activation into regulated stillness.',
    icon: '🌊',
    duration: '10 min',
  },
  {
    id: 'wind_down',
    label: 'Wind Down',
    desc: 'Prepare body and mind for deep, restorative sleep.',
    icon: '🌙',
    duration: '15 min',
  },
  {
    id: 'morning_emergence',
    label: 'Morning Emergence',
    desc: 'Activate healthy sympathetic tone for focused, energised presence.',
    icon: '☀️',
    duration: '10 min',
  },
];

// sensorMode: used by SensorFusion (1=rPPG+sensors, 2=H10 only, 3=H10+sensors)
// backendMode: sent to backend WS (1=simulator[unused], 2=real sensor, 3=real+polar)
const MODES = [
  {
    sensorMode: 1,
    backendMode: 2,
    label: 'Phone Only',
    desc: 'Rear camera rPPG + face + pose + mic. No hardware needed.',
    badge: 'Medium confidence',
  },
  {
    sensorMode: 2,
    backendMode: 2,
    label: 'Polar H10',
    desc: 'ECG-grade RR intervals. Cleanest HRV signal.',
    badge: 'High confidence',
    key: 'h10',
  },
  {
    sensorMode: 3,
    backendMode: 3,
    label: 'Phone + Polar H10',
    desc: 'All sensors combined. Best science.',
    badge: 'Highest confidence',
    star: true,
    key: 'combined',
  },
];

const MODE_KEYS = ['phone', 'h10', 'combined'];

export default function Landing({ onStart }) {
  const { user, signOut } = useAuth();
  const [modeKey, setModeKey]     = useState('phone');
  const [sessionId, setSessionId] = useState('find_your_calm');

  const selectedMode = MODES.find(m => (m.key ?? 'phone') === modeKey) ?? MODES[0];

  const badges = useMemo(() => {
    const out = {};
    SESSIONS.forEach(s => { out[s.id] = circadianBadge(s.id); });
    return out;
  }, []);

  function handleStart() {
    onStart({
      session: sessionId,
      sensorMode: selectedMode.sensorMode,
      backendMode: selectedMode.backendMode,
    });
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', position: 'relative', overflow: 'hidden' }}>
      <div className="ambient-bg" />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 480, margin: '0 auto', padding: '48px 20px 40px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em' }}>ALIVE</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 2 }}>Autonomic regulation</div>
          </div>
          <button
            onClick={signOut}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-dim)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>

        {/* Session picker */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Session
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SESSIONS.map(s => {
              const badge   = badges[s.id];
              const active  = sessionId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => setSessionId(s.id)}
                  className="touch-target"
                  style={{
                    padding: '14px 16px',
                    borderRadius: 14,
                    cursor: 'pointer',
                    border: `1.5px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.06)'}`,
                    background: active ? 'rgba(124,111,247,0.12)' : 'var(--surface)',
                    transition: 'border-color 200ms, background 200ms',
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                    minHeight: 'auto',
                  }}
                >
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{s.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{s.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{s.duration}</span>
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 3, lineHeight: 1.4 }}>{s.desc}</div>
                    {badge && (
                      <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4, background: `${badge.color}18`, border: `1px solid ${badge.color}40`, borderRadius: 6, padding: '2px 8px' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: badge.color }} />
                        <span style={{ color: badge.color, fontSize: 10, fontWeight: 600 }}>{badge.label}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mode picker */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Sensor mode
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {MODES.map(m => {
              const mk     = m.key ?? 'phone';
              const active = modeKey === mk;
              return (
                <div
                  key={mk}
                  onClick={() => setModeKey(mk)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    border: `1.5px solid ${active ? 'var(--primary)' : 'rgba(255,255,255,0.06)'}`,
                    background: active ? 'rgba(124,111,247,0.10)' : 'var(--surface)',
                    transition: 'border-color 200ms, background 200ms',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {m.label}{m.star ? ' ✦' : ''}
                  </div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 2 }}>{m.desc}</div>
                  <div style={{ color: 'var(--primary)', fontSize: 11, marginTop: 3 }}>{m.badge}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleStart}
          className="touch-target fade-slide-up"
          style={{
            width: '100%', background: 'var(--primary)', color: '#fff',
            border: 'none', borderRadius: 14, padding: '16px', fontWeight: 700,
            fontSize: 17, cursor: 'pointer', fontFamily: 'var(--font-head)',
            letterSpacing: '-0.01em',
            boxShadow: '0 0 24px rgba(124,111,247,0.35)',
          }}
        >
          Begin Session
        </button>

        {user?.email && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, marginTop: 20 }}>
            {user.email}
          </div>
        )}
      </div>
    </div>
  );
}
