// Mission Alive — service worker (V2)
// V1: PWA install shell. V2: adds Background Sync for page-kill session finalize.
const CACHE = 'mission-alive-v1'
const CORE = ['/', '/index.html', '/manifest.json']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(()=>{}))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', e => {
  // Network-first for all requests; fall back to cache only when offline.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
})

// Background Sync — fires POST /api/session/finalize when page is killed mid-session.
// SensorContext registers a pending session via postMessage('REGISTER_SESSION').
self.addEventListener('sync', (event) => {
  if (event.tag === 'hrv-flush') {
    event.waitUntil(flushSession())
  }
})

async function flushSession() {
  const pending = await getPendingSession()
  if (!pending) return
  try {
    await fetch(`${pending.apiUrl}/api/session/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: pending.sessionId, final_hrv: pending.hrv ?? {} })
    })
    await clearPendingSession()
  } catch (e) {
    console.warn('[SW] hrv-flush failed, will retry on next sync:', e)
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'REGISTER_SESSION') {
    const req = indexedDB.open('mission-alive-sw', 1)
    req.onupgradeneeded = (e) => e.target.result.createObjectStore('pending')
    req.onsuccess = (e) => {
      const tx = e.target.result.transaction('pending', 'readwrite')
      tx.objectStore('pending').put(event.data.payload, 'session')
    }
  }
  if (event.data?.type === 'CLEAR_SESSION') {
    clearPendingSession()
  }
})

function getPendingSession() {
  return new Promise((resolve) => {
    const req = indexedDB.open('mission-alive-sw', 1)
    req.onupgradeneeded = (e) => e.target.result.createObjectStore('pending')
    req.onsuccess = (e) => {
      const tx = e.target.result.transaction('pending', 'readonly')
      const get = tx.objectStore('pending').get('session')
      get.onsuccess = () => resolve(get.result ?? null)
      get.onerror   = () => resolve(null)
    }
    req.onerror = () => resolve(null)
  })
}

function clearPendingSession() {
  return new Promise((resolve) => {
    const req = indexedDB.open('mission-alive-sw', 1)
    req.onsuccess = (e) => {
      const tx = e.target.result.transaction('pending', 'readwrite')
      tx.objectStore('pending').delete('session')
      tx.oncomplete = resolve
      tx.onerror    = resolve
    }
    req.onerror = resolve
  })
}
