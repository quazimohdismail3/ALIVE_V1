import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    if (!supabase) { setError('Supabase not configured.'); return }
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
    // on success AuthContext fires onAuthStateChange → App re-renders to Landing
  }

  async function handleForgotPassword() {
    if (!supabase) { setError('Supabase not configured.'); return }
    if (!email) { setError('Enter your email first.'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) setError(error.message)
    else setResetSent(true)
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100dvh',
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: 'var(--font-head, sans-serif)', padding: '2rem',
    }}>
      <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.03em' }}>ALIVE</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>Autonomic regulation</div>
      </div>

      <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '320px' }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={inputStyle}
        />
        {error && <p style={{ color: '#ff6b6b', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
        {resetSent && <p style={{ color: '#6bffb8', fontSize: '0.85rem', margin: 0 }}>Reset email sent.</p>}
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" onClick={handleForgotPassword} style={linkStyle}>
          Forgot password?
        </button>
      </form>
    </div>
  )
}

const inputStyle = {
  background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
  color: 'var(--text)', fontSize: '1rem', padding: '0.85rem 1rem',
  outline: 'none', width: '100%', boxSizing: 'border-box',
  minHeight: '44px',
}

const buttonStyle = {
  background: 'var(--primary)', border: 'none', borderRadius: '10px',
  color: '#fff', cursor: 'pointer', fontSize: '1rem', fontWeight: 700,
  padding: '0.85rem', width: '100%', minHeight: '44px',
}

const linkStyle = {
  background: 'none', border: 'none', color: 'var(--text-dim)',
  cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline',
}
