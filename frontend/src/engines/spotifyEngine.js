// Spotify OAuth (PKCE) + Recommendations + Web Playback SDK stubs.
// V1 uses the Web API for track recommendations; playback requires the
// Spotify Web Playback SDK (loaded lazily on first play).

const AUTH_URL = 'https://accounts.spotify.com/authorize'
const API = 'https://api.spotify.com/v1'
const SCOPES = 'user-read-private user-read-email user-modify-playback-state streaming'

function rand(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}
async function sha256(text) {
  const enc = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', enc)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export async function beginAuth(clientId, redirectUri) {
  const verifier = rand(96)
  const challenge = await sha256(verifier)
  sessionStorage.setItem('sp_verifier', verifier)
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
  })
  window.location.href = `${AUTH_URL}?${params}`
}

export async function exchangeCode(clientId, redirectUri, code) {
  const verifier = sessionStorage.getItem('sp_verifier')
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!r.ok) throw new Error('token exchange failed')
  return r.json()
}

// Session → Spotify recommendation seeds
const SEEDS = {
  calm:      { target_energy: 0.2, target_valence: 0.55, target_tempo: 68, seed_genres: 'ambient,chill' },
  energy:    { target_energy: 0.8, target_valence: 0.7,  target_tempo: 118, seed_genres: 'electronic,house' },
  focus:     { target_energy: 0.5, target_valence: 0.5, target_tempo: 92, seed_genres: 'study,ambient' },
  recovery:  { target_energy: 0.15, target_valence: 0.7, target_tempo: 62, seed_genres: 'ambient,piano' },
  presence:  { target_energy: 0.1, target_valence: 0.6, target_tempo: 58, seed_genres: 'ambient,classical' },
  adhd_flow: { target_energy: 0.55, target_valence: 0.6, target_tempo: 100, seed_genres: 'electronic,drum-and-bass' },
}

export async function fetchRecommendations(accessToken, session) {
  const seeds = SEEDS[session] || SEEDS.calm
  const params = new URLSearchParams({ limit: '5', ...seeds })
  const r = await fetch(`${API}/recommendations?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) return []
  const j = await r.json()
  return (j.tracks || []).map(t => ({
    id: t.id,
    name: t.name,
    artist: t.artists?.[0]?.name || '',
    uri: t.uri,
    albumArt: t.album?.images?.[0]?.url || null,
  }))
}

export async function playTrack(accessToken, uri) {
  await fetch(`${API}/me/player/play`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] }),
  })
}
