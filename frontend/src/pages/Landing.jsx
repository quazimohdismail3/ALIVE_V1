// frontend/src/pages/Landing.jsx
import { useState } from 'react';

const MODES = [
    { id: 1, label: 'Phone Only',         desc: 'Camera + mic. No hardware needed.', badge: 'Medium confidence' },
    { id: 2, label: 'Polar H10 Only',     desc: 'ECG-grade RR. Cleanest HRV.',       badge: 'High confidence' },
    { id: 3, label: 'Phone + Polar H10',  desc: 'All sensors. Best science.',         badge: 'Highest confidence', star: true },
];

const SESSIONS = [
    { id: 'find_your_calm',    label: 'Find Your Calm' },
    { id: 'wind_down',         label: 'Wind Down' },
    { id: 'morning_emergence', label: 'Morning Emergence' },
];

const inputStyle = {
    display: 'block', width: '100%', padding: '12px 14px',
    marginBottom: 20, fontSize: 16, borderRadius: 10,
    border: '1px solid #2a2a2a', background: '#111', color: '#fff',
    boxSizing: 'border-box',
};

export default function Landing({ onStart }) {
    const [mode, setMode] = useState(2);
    const [token, setToken] = useState('');
    const [session, setSession] = useState('find_your_calm');

    const valid = token.trim().length > 0;

    return (
        <div style={{ padding: '40px 24px', maxWidth: 480, margin: '0 auto',
                      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', color: '#fff',
                      minHeight: '100dvh', background: '#0a0a0a', boxSizing: 'border-box' }}>
            <div style={{ marginBottom: 36 }}>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>ALIVE</div>
                <div style={{ color: '#444', fontSize: 14, marginTop: 4 }}>Autonomic regulation</div>
            </div>

            <label style={{ fontSize: 12, color: '#555', letterSpacing: '0.06em',
                            textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Access token
            </label>
            <input value={token} onChange={e => setToken(e.target.value)}
                   placeholder="klumpers-radboud"
                   style={inputStyle} />

            <label style={{ fontSize: 12, color: '#555', letterSpacing: '0.06em',
                            textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Session
            </label>
            <select value={session} onChange={e => setSession(e.target.value)} style={inputStyle}>
                {SESSIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>

            <label style={{ fontSize: 12, color: '#555', letterSpacing: '0.06em',
                            textTransform: 'uppercase', display: 'block', marginBottom: 12 }}>
                Sensor mode
            </label>
            {MODES.map(m => (
                <div key={m.id} onClick={() => setMode(m.id)}
                     style={{ padding: '14px 16px', marginBottom: 10, borderRadius: 12,
                              cursor: 'pointer', userSelect: 'none',
                              border: `2px solid ${mode === m.id ? '#534AB7' : '#1e1e1e'}`,
                              background: mode === m.id ? '#0f0d1a' : '#111',
                              transition: 'border-color 0.15s, background 0.15s' }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {m.label}{m.star ? ' ❆' : ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{m.desc}</div>
                    <div style={{ fontSize: 11, color: '#534AB7', marginTop: 4 }}>{m.badge}</div>
                </div>
            ))}

            <button disabled={!valid} onClick={() => onStart({ mode, token, session })}
                    style={{ width: '100%', padding: 16, fontSize: 16, fontWeight: 600,
                             borderRadius: 12, marginTop: 20,
                             background: valid ? '#534AB7' : '#1a1a1a',
                             color: valid ? '#fff' : '#444',
                             border: 'none', cursor: valid ? 'pointer' : 'not-allowed',
                             transition: 'background 0.2s' }}>
                Begin Session
            </button>
        </div>
    );
}
