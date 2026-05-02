// frontend/src/pages/LandingPage.jsx
// Unauthenticated marketing screen. Shown before login.
import { useState } from 'react'
import LoginScreen from './LoginScreen.jsx'

export default function LandingPage() {
    const [showLogin, setShowLogin] = useState(false)
    const [loginTab, setLoginTab]   = useState('login')

    if (showLogin) {
        return <LoginScreen initialTab={loginTab} />
    }

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '100dvh',
            background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'var(--font-body, sans-serif)',
            padding: '2rem', textAlign: 'center', gap: 0,
        }}>
            {/* Ambient orb */}
            <div style={{
                width: 160, height: 160, borderRadius: '50%',
                background: 'radial-gradient(circle at 40% 40%, rgba(124,111,247,0.35), rgba(29,158,117,0.12) 60%, transparent)',
                boxShadow: '0 0 80px rgba(124,111,247,0.2)',
                marginBottom: 40,
                animation: 'breathe 4s ease-in-out infinite',
            }} />

            {/* App name */}
            <div style={{
                fontFamily: 'var(--font-head)', fontWeight: 700,
                fontSize: 42, letterSpacing: '-0.04em', marginBottom: 8,
            }}>
                ALIVE
            </div>
            <div style={{
                color: 'var(--text-dim)', fontSize: 15, maxWidth: 280,
                lineHeight: 1.5, marginBottom: 48,
            }}>
                Biofeedback-guided breathing to regulate your nervous system
            </div>

            {/* Feature tiles */}
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: 12, maxWidth: 320, width: '100%', marginBottom: 48,
            }}>
                {[
                    { icon: '❤️', title: 'Polar H10', sub: 'ECG-grade HRV' },
                    { icon: '🌬️', title: 'Breathing guide', sub: 'Resonance tuned' },
                    { icon: '📊', title: 'RF calibration', sub: 'Personal baseline' },
                    { icon: '🎵', title: 'Adaptive music', sub: 'Real-time response' },
                ].map(({ icon, title, sub }) => (
                    <div key={title} style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 12, padding: '14px 12px', textAlign: 'left',
                    }}>
                        <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>
                    </div>
                ))}
            </div>

            {/* CTAs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 280 }}>
                <button
                    onClick={() => { setLoginTab('signup'); setShowLogin(true) }}
                    style={{
                        padding: '14px 0', borderRadius: 12, border: 'none',
                        background: '#7C6FF7', color: '#fff',
                        fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16,
                        cursor: 'pointer', letterSpacing: '-0.01em',
                    }}
                >
                    Get started
                </button>
                <button
                    onClick={() => { setLoginTab('login'); setShowLogin(true) }}
                    style={{
                        padding: '14px 0', borderRadius: 12,
                        border: '1px solid rgba(124,111,247,0.4)',
                        background: 'rgba(124,111,247,0.08)', color: '#7C6FF7',
                        fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 16,
                        cursor: 'pointer',
                    }}
                >
                    Sign in
                </button>
            </div>
        </div>
    )
}
