// Minimal localStorage-backed store. V1 is single-tenant but user_id is
// seeded from day 1 so the schema matches the multi-tenant V3 backend.

const KEY = 'mission_alive_store_v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch {}
}

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID()
  return 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const defaults = {
  user_id: null,
  sensor_mode: 'simulator',   // simulator | polar | whoop
  last_session_type: null,
  last_insight: null,
  history: [],                // local cache of session summaries
  whoop_token: null,
  spotify_token: null,
}

let state = load() || { ...defaults }
if (!state.user_id) { state.user_id = uuid(); save(state) }

const listeners = new Set()

export const store = {
  get() { return state },
  set(patch) {
    state = { ...state, ...patch }
    save(state)
    listeners.forEach(l => l(state))
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  pushHistory(entry) {
    state = { ...state, history: [entry, ...state.history].slice(0, 50) }
    save(state)
    listeners.forEach(l => l(state))
  },
  reset() { state = { ...defaults, user_id: uuid() }; save(state) },
}
