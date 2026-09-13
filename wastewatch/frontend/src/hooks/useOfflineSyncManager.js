/**
 * hooks/useOfflineSyncManager.js
 * --------------------------------
 * Priority-aware batch sync orchestrator.
 *
 * Priority order: critical(0) → high(1) → medium(2) → low(3)
 * Dedup guard: Set of in-flight IDs prevents double-posting
 * Batch size: MAX_BATCH items per sync cycle
 *
 * Exports: { syncNow, isSyncing, lastSyncAt, summary }
 * Used by: PublicDashboard to replace manual syncAll calls
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from './useOnline'
import { getQueue } from './useOfflineQueue'
import { useAuth } from '../context/AuthContext'
import { base64ToBlob } from '../utils/photoStorage'
import api from '../api/client'

// ─── Priority map ─────────────────────────────────────────────────────────────

const PRIORITY_MAP = { critical: 0, high: 1, medium: 2, low: 3 }
const MAX_BATCH = 5
const MAX_RETRY = 3

// ─── Endpoint registry ────────────────────────────────────────────────────────
// Maps queue store names to API endpoints + payload transformers

const ENDPOINTS = {
  reports: {
    url: '/api/watcher/reports/',
    transform: (r) => {
      const payload = {
        issue_type: r.issue_type || 'overflow',
        severity: r.severity || 'medium',
        description: r.description || '',
        address: r.address || '',
        created_at: r.createdAt,
      }
      if (r.latitude != null && !isNaN(r.latitude)) payload.latitude = Math.round(r.latitude * 1e6) / 1e6
      if (r.longitude != null && !isNaN(r.longitude)) payload.longitude = Math.round(r.longitude * 1e6) / 1e6
      return payload
    },
  },
  analytics_queue: {
    url: '/api/analytics/kpi/',
    transform: (r) => r.payload,
  },
  events_queue: {
    url: '/api/watcher/escalations/',
    transform: (r) => r.payload,
  },
  // Add these two entries inside the ENDPOINTS object,
  // after the existing events_queue entry:

  proof_submissions: {
    url: (r) => `/api/driver/stops/${r.stopId}/collect/`,
    isDynamic: true,
    transform: (r) => {
      const form = new FormData()
      form.append('photo', r.photo, r.photoName || 'proof.jpg')
      form.append('note', r.note || '')
      form.append('collected_at', r.collected_at || r.createdAt)
      if (r.lat) form.append('lat', r.lat)
      if (r.lng) form.append('lng', r.lng)
      return form
    },
  },

  inspection_submissions: {
    url: (r) => r.type === 'post_verify' 
      ? '/api/watcher/stop-validations/post-verify/' 
      : '/api/watcher/stop-validations/pre-inspect/',
    isDynamic: true,
    transform: (r) => {
      const form = new FormData()
      form.append('schedule_id', r.schedule_id)
      form.append('stop_order', r.stop_order)
      form.append('lat', r.lat)
      form.append('lng', r.lng)
      form.append('outcome', r.outcome)
      form.append('notes', r.notes || '')
      
      // Photos may be base64 strings (offline path) or Blobs (future direct path)
      ;(r.photos || []).forEach((photo, i) => {
        const blob = typeof photo === 'string'
          ? base64ToBlob(photo)
          : photo
        form.append(
          i === 0 ? 'photo' : `photo_${i + 1}`,
          blob,
          `inspect-${i}.jpg`
        )
      })
      return form
    },
  },
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineSyncManager() {
  const isOnline = useOnline()
  const { user } = useAuth()
  const inFlight = useRef(new Set())
  const syncingRef = useRef(false)

  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const [summary, setSummary] = useState({ synced: 0, failed: 0, remaining: 0 })

  const currentOwnerId = user?.id ? String(user.id) : null

  // ── Push a single item ──────────────────────────────────────────────────────
  // Replace the existing pushItem callback with this:
  const pushItem = useCallback(async (storeName, item) => {
    if (inFlight.current.has(item.id)) return null
    inFlight.current.add(item.id)

    const ep = ENDPOINTS[storeName]
    const queue = getQueue(storeName)

    try {
      if (ep) {
        const url = ep.isDynamic ? ep.url(item) : ep.url
        const payload = ep.transform(item)
        const isForm = payload instanceof FormData

        await api.post(url, payload, isForm
          ? { headers: { 'Content-Type': 'multipart/form-data' } }
          : {}
        )
      }
      await queue.updateItem(item.id, { status: 'synced', syncedAt: new Date().toISOString() })
      return { ok: true, id: item.id }
    } catch (err) {
      if (err.response?.status === 400) {
        console.warn('[SyncManager] Dropping queued item — already processed by server:', {
          stopOrder: item.stop_order,
          scheduleId: item.schedule_id,
          serverResponse: err.response?.data,
        })
        await queue.updateItem(item.id, { status: 'synced', syncedAt: new Date().toISOString() })
        return { ok: true, id: item.id }
      }
      
      const retryCount = (item.retryCount || 0) + 1
      const status = retryCount >= MAX_RETRY ? 'failed' : 'pending'
      await queue.updateItem(item.id, { status, retryCount })
      return { ok: false, id: item.id }
    } finally {
      inFlight.current.delete(item.id)
    }
  }, [])

  // ── Full sync cycle ─────────────────────────────────────────────────────────
  const syncNow = useCallback(async () => {
    if (!isOnline || syncingRef.current) return
    if (!currentOwnerId) {
      console.warn('[SyncManager] Skipping sync — no authenticated user.')
      return
    }
    syncingRef.current = true
    setIsSyncing(true)

    let totalSynced = 0
    let totalFailed = 0
    let totalRemain = 0

    try {
      for (const storeName of Object.keys(ENDPOINTS)) {
        const queue = getQueue(storeName)
        const all = await queue.getAll()

        // Sort by priority then severity
        // Replace the owner filter inside syncNow:
        const pending = all
          .filter(r => {
            if (r.status !== 'pending') return false
            // If no ownerId on the record, it was queued without auth — skip it
            if (!r.ownerId) return false
            return String(r.ownerId) === currentOwnerId
          })
          .sort((a, b) => {
            const pa = PRIORITY_MAP[a.severity] ?? a.priority ?? 2
            const pb = PRIORITY_MAP[b.severity] ?? b.priority ?? 2
            return pa - pb
          })

        totalRemain += pending.length

        // Process in batches
        for (let i = 0; i < pending.length; i += MAX_BATCH) {
          const batch = pending.slice(i, i + MAX_BATCH)
          const results = await Promise.all(batch.map(item => pushItem(storeName, item)))
          results.forEach(r => {
            if (!r) return
            if (r.ok) { totalSynced++; totalRemain-- }
            else { totalFailed++ }
          })
        }
      }

      setLastSyncAt(new Date())
      setSummary({ synced: totalSynced, failed: totalFailed, remaining: totalRemain - totalSynced })
    } catch (err) {
      console.error('[SyncManager] sync error:', err)
    } finally {
      setIsSyncing(false)
      syncingRef.current = false
    }
  }, [isOnline, pushItem, currentOwnerId])



  // ── Auto-sync on reconnect ──────────────────────────────────────────────────
  useEffect(() => {
    if (isOnline) syncNow()
  }, [isOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  return { syncNow, isSyncing, lastSyncAt, summary }
}


