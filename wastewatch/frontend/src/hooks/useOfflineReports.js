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
const DB_VERSION = 3
const STORE_NAME = 'reports'

const MAX_RETRY = 3

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => reject(e.target.error)
  })
}

async function idbGetAll() {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const store = tx.objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(record) {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.put(record)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
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
  }, [currentOwnerId])

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
      photo: fields.photo || null, // base64
      createdAt: new Date().toISOString(),
      status: 'pending',
      syncedAt: null,
      retryCount: 0,
    }
    await idbPut(record)
    setReports(prev => [record, ...prev])
    return record
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

      if (report.latitude != null && !isNaN(report.latitude)) formData.append('latitude', report.latitude)
      if (report.longitude != null && !isNaN(report.longitude)) formData.append('longitude', report.longitude)

      if (report.photo) {
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
      await idbPut(updated)
      return updated
    } catch (err) {
      console.error(`[useOfflineReports] Failed to sync report ${report.id}:`, err.response?.data || err.message)
      const retryCount = (report.retryCount || 0) + 1
      const status = retryCount >= MAX_RETRY ? 'failed' : 'pending'
      const updated = { ...report, status, retryCount }
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
      const all = await idbGetAll()
      // Only sync reports belonging to the CURRENT session user
      const pending = all.filter(r =>
        r.status === 'pending' &&
        String(r.ownerId || 'anonymous') === currentOwnerId
      )

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
  }, [isOnline, pushReport, currentOwnerId])

  // ── Retry a single failed report ─────────────────────────────────────────────
  const retryReport = useCallback(async (id) => {
    // GUARD: Block retry for anonymous sessions
    if (currentOwnerId === 'anonymous') {
      notify({ variant: 'error-outline', message: 'Mangyaring mag-login para i-retry ang pag-sync ng report.' })
      return
    }

    const all = await idbGetAll()
    const report = all.find(r => r.id === id)
    // Guard: check ownership before retrying
    const rOwner = report?.ownerId ? String(report.ownerId) : 'anonymous'
    if (!report || !isOnline || rOwner !== currentOwnerId) return

    const resetted = { ...report, status: 'pending', retryCount: 0 }
    await idbPut(resetted)
    const result = await pushReport(resetted)
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

  return { reports, addReport, retryReport, syncAll, isSyncing, pendingCount, failedCount }
}
