/**
 * src/utils/idbSchema.js
 * -----------------------
 * Single source of truth for the IndexedDB schema.
 * All modules accessing wastewatch_db must import openDB from here.
 *
 * STRICT ICONOGRAPHY: ZERO emojis; SVG icons only.
 */

export const DB_NAME = 'wastewatch_db'
export const DB_VERSION = 8   // Bumped to v8: added calendar_entries_cache read-cache

export const CALENDAR_CACHE_STORE = 'calendar_entries_cache'

export const STORES = [
  'reports', 
  'analytics_queue', 
  'events_queue', 
  'sync_log', 
  'proof_submissions', 
  'inspection_submissions'
]

let _dbPromise = null

/**
 * Opens or retrieves the shared singleton IndexedDB connection to wastewatch_db.
 * Handles automatic schema migrations across versions safely.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not supported in this environment.'))
  }

  if (_dbPromise) return _dbPromise

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = e.target.result
      console.log(`[IDB] Upgrading from v${e.oldVersion} to v${e.newVersion}`)
      
      // 1. Maintain existing mutation outbox queues (v1-v7)
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' })
          store.createIndex('status', 'status', { unique: false })
          store.createIndex('createdAt', 'createdAt', { unique: false })
          store.createIndex('priority', 'priority', { unique: false })
          console.log('[IDB] Created queue object store:', name)
        }
      })

      // 2. Version 8: Dedicated persistent read-cache for Public Calendar Service
      if (!db.objectStoreNames.contains(CALENDAR_CACHE_STORE)) {
        const calStore = db.createObjectStore(CALENDAR_CACHE_STORE, { keyPath: 'cacheKey' })
        calStore.createIndex('cachedAt', 'cachedAt', { unique: false })
        calStore.createIndex('expiresAt', 'expiresAt', { unique: false })
        calStore.createIndex('scope', 'scope', { unique: false })
        calStore.createIndex('startDate', 'startDate', { unique: false })
        calStore.createIndex('endDate', 'endDate', { unique: false })
        console.log('[IDB] Created cache object store:', CALENDAR_CACHE_STORE)
      }
    }

    req.onsuccess = (e) => {
      const db = e.target.result

      // Listen for remote version upgrades (e.g. from another tab) and close gracefully
      db.onversionchange = () => {
        console.warn('[IDB] Database version changed remotely. Closing connection to permit upgrade.')
        try {
          db.close()
        } catch {}
        _dbPromise = null
      }

      db.onclose = () => {
        _dbPromise = null
      }

      resolve(db)
    }

    req.onerror = (e) => { 
      _dbPromise = null
      reject(e.target.error || new Error('Failed to open IndexedDB')) 
    }
    
    req.onblocked = (e) => {
      console.warn('[IDB] Database upgrade blocked by an existing open connection in another tab.', e)
    }
  })

  return _dbPromise
}

/**
 * Gracefully closes the active singleton database connection, if open.
 * Useful for tests and version change transitions.
 *
 * @returns {Promise<void>}
 */
export function closeDB() {
  if (_dbPromise) {
    return _dbPromise.then(db => {
      try {
        db.close()
      } catch {}
      _dbPromise = null
    }).catch(() => {
      _dbPromise = null
    })
  }
  return Promise.resolve()
}
