// Mission Alive — minimal service worker for PWA install shell.
// V1: no aggressive caching; just make the app installable.
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
