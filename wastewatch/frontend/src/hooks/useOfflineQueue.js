/**
 * hooks/useOfflineQueue.js
 * -------------------------
 * Generic IndexedDB queue shared by all offline modules.
 * Each "store" is an object store in wastewatch_db.
 *
 * Exports a factory: getQueue(storeName) → { enqueue, getAll, updateItem, clearSynced, getStats }
 * Also exports useQueueStore(storeName) React hook for reactive state.
 */

const DB_NAME = 'wastewatch_db'
const DB_VERSION = 4   // v4: added proof_submissions + inspection_submissions

const STORES = ['reports', 'analytics_queue', 'events_queue', 'sync_log', 'proof_submissions', 'inspection_submissions']

// ─── IDB singleton ────────────────────────────────────────────────────────────

let _dbPromise = null

function openDB() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' })
          store.createIndex('status', 'status', { unique: false })
          store.createIndex('createdAt', 'createdAt', { unique: false })
          store.createIndex('priority', 'priority', { unique: false })
        }
      })
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => { _dbPromise = null; reject(e.target.error) }
  })
  return _dbPromise
}

// ─── Core IDB operations ──────────────────────────────────────────────────────

async function idbTx(storeName, mode, fn) {
  const db = await openDB()
  const tx = db.transaction(storeName, mode)
  const store = tx.objectStore(storeName)
  return new Promise((resolve, reject) => {
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ─── Queue factory ────────────────────────────────────────────────────────────

export function getQueue(storeName) {
  /**
   * Enqueue a new item. Adds metadata: id, status, retryCount, createdAt.
   * Priority: 0=critical 1=high 2=medium 3=low (lower = higher priority)
   */
  async function enqueue(data, priority = 2) {
    const record = {
      id: crypto.randomUUID(),
      ...data,
      status: 'pending',
      priority,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      syncedAt: null,
    }
    await idbTx(storeName, 'readwrite', s => s.put(record))
    return record
  }

  async function getAll() {
    const db = await openDB()
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    return new Promise((resolve, reject) => {
      const req = store.getAll()
      req.onsuccess = () => resolve(
        (req.result || []).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2) || a.createdAt.localeCompare(b.createdAt))
      )
      req.onerror = () => reject(req.error)
    })
  }

  async function updateItem(id, patch) {
    const db = await openDB()
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    return new Promise((resolve, reject) => {
      const getReq = store.get(id)
      getReq.onsuccess = () => {
        if (!getReq.result) return resolve(null)
        const updated = { ...getReq.result, ...patch }
        const putReq = store.put(updated)
        putReq.onsuccess = () => resolve(updated)
        putReq.onerror = () => reject(putReq.error)
      }
      getReq.onerror = () => reject(getReq.error)
    })
  }

  async function clearSynced() {
    const all = await getAll()
    const synced = all.filter(r => r.status === 'synced')
    await Promise.all(synced.map(r => idbTx(storeName, 'readwrite', s => s.delete(r.id))))
    return synced.length
  }

  async function getStats() {
    const all = await getAll()
    return {
      total: all.length,
      pending: all.filter(r => r.status === 'pending').length,
      synced: all.filter(r => r.status === 'synced').length,
      failed: all.filter(r => r.status === 'failed').length,
    }
  }

  return { enqueue, getAll, updateItem, clearSynced, getStats }
}

// ─── React hook wrapper ───────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'

export function useQueueStore(storeName) {
  const queue = getQueue(storeName)
  const [items, setItems] = useState([])
  const [stats, setStats] = useState({ total: 0, pending: 0, synced: 0, failed: 0 })

  const refresh = useCallback(async () => {
    const all = await queue.getAll()
    setItems(all)
    setStats({
      total: all.length,
      pending: all.filter(r => r.status === 'pending').length,
      synced: all.filter(r => r.status === 'synced').length,
      failed: all.filter(r => r.status === 'failed').length,
    })
  }, [storeName]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh() }, [refresh])

  const enqueue = useCallback(async (data, priority) => {
    const r = await queue.enqueue(data, priority)
    await refresh()
    return r
  }, [refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  const markSynced = useCallback(async (id) => {
    await queue.updateItem(id, { status: 'synced', syncedAt: new Date().toISOString() })
    await refresh()
  }, [refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  const markFailed = useCallback(async (id, retryCount) => {
    const status = retryCount >= 3 ? 'failed' : 'pending'
    await queue.updateItem(id, { status, retryCount })
    await refresh()
  }, [refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  return { items, stats, enqueue, markSynced, markFailed, refresh, queue }
}
