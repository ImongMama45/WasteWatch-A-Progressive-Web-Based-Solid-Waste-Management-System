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
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import api from '../api/client'

// ─── IndexedDB helpers ─────────────────────────────────────────────────────────

const DB_NAME = 'wastewatch_db'
const DB_VERSION = 6
const STORE_NAME = 'reports'

const MAX_RETRY = 3

if (import.meta.env.DEV) {
  window.__wwResetIDB = () => indexedDB.deleteDatabase(DB_NAME)
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = e.target.result
      console.log(`[IDB] Upgrading from v${e.oldVersion} to v${e.newVersion}`)
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
        console.log('[IDB] Created object store:', STORE_NAME)
      }
    }

    req.onblocked = () => {
      console.error('[IDB] Blocked — another tab is holding an older DB connection open. Close other tabs of this app.')
    }

    req.onsuccess = (e) => {
      const db = e.target.result
      console.log('[IDB] Opened successfully. Stores:', Array.from(db.objectStoreNames))
      resolve(db)
    }

    req.onerror = (e) => {
      console.error('[IDB open] name:', e.target.error?.name, 'message:', e.target.error?.message)
      reject(e.target.error)
    }
  })
}

const LS_FALLBACK_KEY = 'ww_offline_reports_fallback'

function getLSFallback() {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function putLSFallback(record) {
  try {
    let items = getLSFallback()
    items = items.filter(i => i.id !== record.id)
    items.push(record)
    // Keep only last 3 to avoid QuotaExceeded (5MB limit)
    if (items.length > 3) items = items.slice(items.length - 3)
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(items))
    window.dispatchEvent(new CustomEvent('ww-idb-updated', { detail: { storeName: STORE_NAME } }))
  } catch (err) {
    console.warn('[IDB Fallback] LS full', err)
  }
}

async function idbGetAll() {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    return new Promise((resolve) => {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => {
        console.warn('[IDB] getAll error:', req.error)
        resolve(getLSFallback())
      }
    })
  } catch (err) {
    console.warn('[IDB] Failed to open/read DB, falling back to LS:', err.message)
    return getLSFallback()
  }
}

async function idbPut(record) {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    return new Promise((resolve) => {
      const req = store.put(record)
      req.onsuccess = () => {
        window.dispatchEvent(new CustomEvent('ww-idb-updated', { detail: { storeName: STORE_NAME } }))
        resolve({ ok: true, source: 'idb' })
      }
      req.onerror = () => {
        console.warn('[IDB] put error:', req.error)
        putLSFallback(record)
        resolve({ ok: false, source: 'localStorage' })
      }
    })
  } catch (err) {
    console.warn('[IDB] Failed to open/write DB, falling back to LS:', err.message)
    putLSFallback(record)
    return { ok: false, source: 'localStorage' }
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineReports() {
  const isOnline = useOnline()
  const { user } = useAuth()
  const { notify } = useNotification()
  const [reports, setReports] = useState([])
  const [isSyncing, setIsSyncing] = useState(false)
  const syncingRef = useRef(false)   // guard against double-firing

  // Current session owner ID ('anonymous' for guest)
  // Force to string to avoid number/string mismatch issues
  const currentOwnerId = (user && user.id) ? String(user.id) : 'anonymous'

  // ── Load reports from IDB (filtered by session) ─────────────────────────────
  useEffect(() => {
    // Clear immediately on ID change to avoid stale data flash
    setReports([])

    async function debugIDBState() {
      try {
        const db = await openDB()
        const tx = db.transaction(STORE_NAME, 'readonly')
        const count = await new Promise((res) => {
          const r = tx.objectStore(STORE_NAME).count()
          r.onsuccess = () => res(r.result)
        })
        console.log(`[IDB DEBUG] DB open OK. Record count in '${STORE_NAME}':`, count)
      } catch (err) {
        console.error('[IDB DEBUG] Failed:', err?.name, err?.message)
      }
    }
    
    debugIDBState()

    const loadReports = () => {
      idbGetAll()
        .then(rows => {
          // Strict filtering:
          // - If logged in: show only reports where ownerId matches user.id (as string)
          // - If guest: show only reports where ownerId === 'anonymous'
          const filtered = rows.filter(r => {
            const rOwner = r.ownerId ? String(r.ownerId) : 'anonymous'
            return rOwner === currentOwnerId
          })
          setReports(filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        })
        .catch(err => console.error('[useOfflineReports] load error:', err))
    }

    loadReports()

    const handleUpdate = (e) => {
      if (e.detail?.storeName === STORE_NAME) {
        loadReports()
      }
    }
    window.addEventListener('ww-idb-updated', handleUpdate)
    return () => window.removeEventListener('ww-idb-updated', handleUpdate)
  }, [currentOwnerId])

  // ── Helper: base64 to Blob ──────────────────────────────────────────────────
  function base64ToBlob(base64) {
    if (!base64) return null
    try {
      const parts = base64.split(';base64,')
      const contentType = parts[0].split(':')[1]
      const raw = window.atob(parts[1])
      const rawLength = raw.length
      const uInt8Array = new Uint8Array(rawLength)
      for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i)
      }
      return new Blob([uInt8Array], { type: contentType })
    } catch (e) {
      console.error('Failed to convert base64 to blob', e)
      return null
    }
  }

  // ── Try to push one report to the backend ────────────────────────────────────
  const pushReport = useCallback(async (report) => {
    try {
      const formData = new FormData()
      formData.append('issue_type', report.issue_type)
      formData.append('severity', report.severity)
      formData.append('description', report.description)
      formData.append('address', report.address || '')
      formData.append('created_at', report.createdAt || new Date().toISOString())

      if (report.latitude != null && !isNaN(report.latitude)) {
        formData.append('latitude', Number(report.latitude).toFixed(6))
      }
      if (report.longitude != null && !isNaN(report.longitude)) {
        formData.append('longitude', Number(report.longitude).toFixed(6))
      }

      if (report.photos && Array.isArray(report.photos) && report.photos.length > 0) {
        report.photos.forEach((base64, index) => {
          const blob = base64ToBlob(base64)
          if (blob) {
            const key = index === 0 ? 'image' : `image_${index + 1}`
            formData.append(key, blob, `report_${report.id}_${index}.jpg`)
          }
        })
      } else if (report.photo) {
        const blob = base64ToBlob(report.photo)
        if (blob) {
          formData.append('image', blob, `report_${report.id}.jpg`)
        }
      }

      const response = await api.post('/api/watcher/reports/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      console.log(`[useOfflineReports] Synced report ${report.id}`, response.data)

      const updated = { ...report, status: 'synced', syncedAt: new Date().toISOString() }
      try { await idbPut(updated) } catch (e) { console.warn('[pushReport] IDB put failed on success', e) }
      return updated
    } catch (err) {
      console.error(`[useOfflineReports] Failed to sync report ${report.id}:`, JSON.stringify(err.response?.data || err.message))
      
      // If it's a true API error, it'll have response or request. If it's an IDB error bubbling up, we ignore it.
      if (!err.response && !err.request && err.name === 'UnknownError') {
         // This is a lingering IDB error from somewhere, don't retry API.
         return { ...report, status: 'failed' }
      }

      const retryCount = (report.retryCount || 0) + 1
      const status = retryCount >= MAX_RETRY ? 'failed' : 'pending'
      const updated = { ...report, status, retryCount }
      try { await idbPut(updated) } catch (e) { console.warn('[pushReport] IDB put failed on error', e) }
      
      if (status === 'failed') throw err // Let the caller know it completely failed
      return updated
    }
  }, [])

  // ── Add a new report (always queued locally first) ───────────────────────────
  const addReport = useCallback(async (fields) => {
    const record = {
      id: crypto.randomUUID(),
      ownerId: currentOwnerId, // Explicit: '123' or 'anonymous'
      issue_type: fields.issue_type || 'overflow',
      severity: fields.severity || 'medium',
      description: fields.description || '',
      latitude: (typeof fields.latitude === 'number' && !isNaN(fields.latitude)) ? fields.latitude : null,
      longitude: (typeof fields.longitude === 'number' && !isNaN(fields.longitude)) ? fields.longitude : null,
      address: fields.address || 'Unknown',
      photo: fields.photo || null, // fallback for legacy
      photos: fields.photos || [], // array of base64 strings
      createdAt: new Date().toISOString(),
      status: 'pending',
      syncedAt: null,
      retryCount: 0,
    }
    const putRes = await idbPut(record)
    if (!putRes.ok) {
      console.warn(`[useOfflineReports] Warning: Report saved to ${putRes.source} instead of IDB.`)
    }
    setReports(prev => [record, ...prev])
    
    // Automatically try to sync immediately if online
    if (isOnline) {
      setTimeout(async () => {
        try {
          notify({ variant: 'success', message: 'Processing report...', duration: 2500, icon: 'sync' })
          const result = await pushReport(record)
          if (result.status === 'synced') {
            notify({ variant: 'success', message: 'Report successfully synced!', duration: 4500, icon: 'check_circle' })
          } else {
            notify({ variant: 'error-soft', message: 'Failed to sync report.', duration: 5500, icon: 'error' })
          }
          setReports(prev => prev.map(r => r.id === record.id ? result : r))
        } catch (e) {
          // errors handled in pushReport
        }
      }, 500)
    }

    return record
  }, [currentOwnerId, isOnline, pushReport, notify])



  // ── Sync all pending reports ─────────────────────────────────────────────────
  const syncAll = useCallback(async () => {
    if (!isOnline || syncingRef.current) return

    syncingRef.current = true
    setIsSyncing(true)
    try {
      const all = await idbGetAll()
      // Only sync reports belonging to the CURRENT session user
      const pending = all.filter(r =>
        r.status === 'pending' &&
        String(r.ownerId || 'anonymous') === currentOwnerId
      )

      if (pending.length === 0) return

      notify({ variant: 'success', message: `Processing ${pending.length} report(s)...`, duration: 2500, icon: 'sync' })

      const results = await Promise.all(pending.map(pushReport))
      
      const successCount = results.filter(r => r.status === 'synced').length
      const failCount = results.length - successCount

      if (successCount > 0) {
        notify({ variant: 'success', message: `Successfully synced ${successCount} report(s)!`, duration: 4500, icon: 'check_circle' })
      }
      if (failCount > 0) {
        notify({ variant: 'error-soft', message: `Failed to sync ${failCount} report(s).`, duration: 5500, icon: 'error' })
      }

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
  }, [isOnline, pushReport, currentOwnerId])

  // ── Retry a single failed report ─────────────────────────────────────────────
  const retryReport = useCallback(async (id) => {

    const all = await idbGetAll()
    const report = all.find(r => r.id === id)
    // Guard: check ownership before retrying
    const rOwner = report?.ownerId ? String(report.ownerId) : 'anonymous'
    if (!report || !isOnline || rOwner !== currentOwnerId) return

    const resetted = { ...report, status: 'pending', retryCount: 0 }
    await idbPut(resetted)
    
    notify({ variant: 'success', message: `Retrying report sync...`, duration: 2500, icon: 'sync' })
    
    const result = await pushReport(resetted)
    
    if (result.status === 'synced') {
      notify({ variant: 'success', message: `Report successfully synced!`, duration: 4500, icon: 'check_circle' })
    } else {
      notify({ variant: 'error-soft', message: `Failed to sync report.`, duration: 5500, icon: 'error' })
    }
    
    setReports(prev =>
      prev.map(r => r.id === id ? result : r)
    )
  }, [isOnline, pushReport, currentOwnerId, notify])

  // ── Auto-sync when coming back online ────────────────────────────────────────
  useEffect(() => {
    if (isOnline) syncAll()
  }, [isOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  const pendingCount = reports.filter(r => r.status === 'pending').length
  const failedCount = reports.filter(r => r.status === 'failed').length

  return { reports, addReport, retryReport, syncAll, isSyncing, pendingCount, failedCount, pushReport }
}
