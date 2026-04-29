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
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
    // on success AuthContext fires onAuthStateChange → App re-renders to Landing
  }

  async function handleForgotPassword() {
    if (!email) { setError('Enter your email first.'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) setError(error.message)
    else setResetSent(true)
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100dvh',
      background: '#0a0a0f', color: '#fff', fontFamily: 'sans-serif',
      padding: '2rem',
    }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '2rem', letterSpacing: '0.1em' }}>
        MISSION ALIVE
      </h1>

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
  background: '#1a1a2e', border: '1px solid #333', borderRadius: '8px',
  color: '#fff', fontSize: '1rem', padding: '0.75rem 1rem',
  outline: 'none', width: '100%', boxSizing: 'border-box',
}

const buttonStyle = {
  background: '#6c63ff', border: 'none', borderRadius: '8px',
  color: '#fff', cursor: 'pointer', fontSize: '1rem',
  padding: '0.75rem', width: '100%',
}

const linkStyle = {
  background: 'none', border: 'none', color: '#888',
  cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline',
}
