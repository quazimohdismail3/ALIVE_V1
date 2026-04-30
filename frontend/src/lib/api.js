import { supabase } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function authHeaders() {
  if (!supabase) return {}
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function getProfile() {
  const headers = await authHeaders()
  const r = await fetch(`${API_URL}/api/profile`, { headers })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`getProfile failed: ${r.status}`)
  return r.json()
}

export async function putProfile(profile) {
  const headers = {
    ...(await authHeaders()),
    'Content-Type': 'application/json',
  }
  const r = await fetch(`${API_URL}/api/profile`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(profile),
  })
  if (!r.ok) {
    const detail = await r.text()
    throw new Error(`putProfile failed: ${r.status} ${detail}`)
  }
  return r.json()
}
