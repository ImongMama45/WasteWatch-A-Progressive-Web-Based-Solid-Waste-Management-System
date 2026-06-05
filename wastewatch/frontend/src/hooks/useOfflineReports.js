/**
 * hooks/useOfflineReports.js
 * ---------------------------
 * IndexedDB-backed offline report queue for WasteWatch.
 *
 * DB:    wastewatch_db  (v1)
 * Store: reports
 *
 * Each record:
 * {
 *   id          : string   (crypto.randomUUID)
 *   wasteType   : 'biodegradable' | 'residual' | 'recyclable' | 'special'
 *   severity    : 'low' | 'medium' | 'high' | 'critical'
 *   notes       : string
 *   location    : { lat, lng, address }
 *   createdAt   : ISO string
 *   status      : 'pending' | 'synced' | 'failed'
 *   syncedAt    : ISO string | null
 *   retryCount  : number
 * }
 *
 * Exports: { reports, addReport, retryReport, syncAll, isSyncing, pendingCount, failedCount }
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from './useOnline'
import api from '../api/client'

// ─── IndexedDB helpers ─────────────────────────────────────────────────────────

const DB_NAME    = 'wastewatch_db'
const DB_VERSION = 1
const STORE      = 'reports'
const MAX_RETRY  = 3

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('status',    'status',    { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function idbGetAll() {
  const db      = await openDB()
  const tx      = db.transaction(STORE, 'readonly')
  const store   = tx.objectStore(STORE)
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror   = () => reject(req.error)
  })
}

async function idbPut(record) {
  const db    = await openDB()
  const tx    = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  return new Promise((resolve, reject) => {
    const req = store.put(record)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineReports() {
  const isOnline   = useOnline()
  const [reports,   setReports]   = useState([])
  const [isSyncing, setIsSyncing] = useState(false)
  const syncingRef = useRef(false)   // guard against double-firing

  // ── Load all reports from IDB on mount ──────────────────────────────────────
  useEffect(() => {
    idbGetAll()
      .then(rows => setReports(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))))
      .catch(err  => console.error('[useOfflineReports] load error:', err))
  }, [])

  // ── Add a new report (always queued locally first) ───────────────────────────
  const addReport = useCallback(async (fields) => {
    const record = {
      id         : crypto.randomUUID(),
      wasteType  : fields.wasteType  || 'residual',
      severity   : fields.severity   || 'medium',
      notes      : fields.notes      || '',
      location   : fields.location   || { lat: null, lng: null, address: 'Unknown' },
      createdAt  : new Date().toISOString(),
      status     : 'pending',
      syncedAt   : null,
      retryCount : 0,
    }
    await idbPut(record)
    setReports(prev => [record, ...prev])
    return record
  }, [])

  // ── Try to push one report to the backend ────────────────────────────────────
  const pushReport = useCallback(async (report) => {
    try {
      await api.post('/api/watcher/reports/', {
        waste_type : report.wasteType,
        severity   : report.severity,
        notes      : report.notes,
        latitude   : report.location?.lat,
        longitude  : report.location?.lng,
        address    : report.location?.address,
        created_at : report.createdAt,
      })
      const updated = { ...report, status: 'synced', syncedAt: new Date().toISOString() }
      await idbPut(updated)
      return updated
    } catch {
      const retryCount = (report.retryCount || 0) + 1
      const status     = retryCount >= MAX_RETRY ? 'failed' : 'pending'
      const updated    = { ...report, status, retryCount }
      await idbPut(updated)
      return updated
    }
  }, [])

  // ── Sync all pending reports ─────────────────────────────────────────────────
  const syncAll = useCallback(async () => {
    if (!isOnline || syncingRef.current) return
    syncingRef.current = true
    setIsSyncing(true)
    try {
      const all     = await idbGetAll()
      const pending = all.filter(r => r.status === 'pending')
      if (pending.length === 0) return

      const results = await Promise.all(pending.map(pushReport))
      // Merge results back into full list
      setReports(prev => {
        const map = Object.fromEntries(results.map(r => [r.id, r]))
        return prev
          .map(r => map[r.id] || r)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      })
    } catch (err) {
      console.error('[useOfflineReports] syncAll error:', err)
    } finally {
      setIsSyncing(false)
      syncingRef.current = false
    }
  }, [isOnline, pushReport])

  // ── Retry a single failed report ─────────────────────────────────────────────
  const retryReport = useCallback(async (id) => {
    const all    = await idbGetAll()
    const report = all.find(r => r.id === id)
    if (!report || !isOnline) return
    const resetted = { ...report, status: 'pending', retryCount: 0 }
    await idbPut(resetted)
    const result = await pushReport(resetted)
    setReports(prev =>
      prev.map(r => r.id === id ? result : r)
    )
  }, [isOnline, pushReport])

  // ── Auto-sync when coming back online ────────────────────────────────────────
  useEffect(() => {
    if (isOnline) syncAll()
  }, [isOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  const pendingCount = reports.filter(r => r.status === 'pending').length
  const failedCount  = reports.filter(r => r.status === 'failed').length

  return { reports, addReport, retryReport, syncAll, isSyncing, pendingCount, failedCount }
}
