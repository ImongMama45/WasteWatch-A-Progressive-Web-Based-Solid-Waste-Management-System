/**
 * src/utils/idbSchema.js
 * -----------------------
 * Single source of truth for the IndexedDB schema.
 * Both useOfflineQueue and useOfflineReports must import openDB from here.
 */

export const DB_NAME = 'wastewatch_db'
export const DB_VERSION = 7   // Bumped to v7 to ensure all missing stores are created for existing users

export const STORES = [
  'reports', 
  'analytics_queue', 
  'events_queue', 
  'sync_log', 
  'proof_submissions', 
  'inspection_submissions'
]

let _dbPromise = null

export function openDB() {
  if (_dbPromise) return _dbPromise

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = e.target.result
      console.log(`[IDB] Upgrading from v${e.oldVersion} to v${e.newVersion}`)
      
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' })
          store.createIndex('status', 'status', { unique: false })
          store.createIndex('createdAt', 'createdAt', { unique: false })
          store.createIndex('priority', 'priority', { unique: false })
          console.log('[IDB] Created object store:', name)
        }
      })
    }

    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => { 
      _dbPromise = null
      reject(e.target.error) 
    }
    
    req.onblocked = () => {
      console.error('[IDB] Blocked — another tab is holding an older DB connection open. Close other tabs of this app.')
    }
  })

  return _dbPromise
}
