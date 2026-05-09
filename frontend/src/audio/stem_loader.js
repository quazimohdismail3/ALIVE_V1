// frontend/src/audio/stem_loader.js
// Progressive stem loader with IndexedDB content-hash cache.
// Returns null on any failure — oscillator fallback stays active until stems load.
import * as Tone from 'tone';

const DB_NAME = 'mission-alive-stems-v1';
const STORE   = 'stems';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = () => reject(req.error);
  });
}

async function idbGet(db, key) {
  return new Promise(resolve => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = () => resolve(null);
  });
}

async function idbPut(db, key, data) {
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, data });
    tx.oncomplete = resolve;
    tx.onerror    = resolve; // non-critical
  });
}

class StemLoader {
  constructor() {
    this._db    = null;
    this._ready = false;
  }

  async init() {
    try {
      this._db    = await openDB();
      this._ready = true;
    } catch (_) {
      // IndexedDB unavailable (private browsing?) — fetches still work, no cache
    }
  }

  // Returns decoded AudioBuffer, or null (oscillator fallback stays active)
  async load(url, cacheKey) {
    if (!url) return null;
    const rawCtx = Tone.context.rawContext;

    // 1. Try cache first
    if (this._ready && this._db) {
      const cached = await idbGet(this._db, cacheKey);
      if (cached?.data) {
        try {
          // slice() copies the ArrayBuffer — decodeAudioData detaches the original
          const buf = await rawCtx.decodeAudioData(cached.data.slice(0));
          return buf;
        } catch (_) { /* corrupt cache entry — re-fetch below */ }
      }
    }

    // 2. Fetch
    try {
      const resp  = await fetch(url, { mode: 'cors' });
      if (!resp.ok) return null;
      const bytes = await resp.arrayBuffer();

      // Cache the raw bytes (decoded buffer can't be stored in IDB)
      if (this._ready && this._db) {
        await idbPut(this._db, cacheKey, bytes.slice(0));
      }

      return await rawCtx.decodeAudioData(bytes);
    } catch (_) {
      return null; // network or decode failure — oscillator fallback
    }
  }
}

export const stemLoader = new StemLoader();
