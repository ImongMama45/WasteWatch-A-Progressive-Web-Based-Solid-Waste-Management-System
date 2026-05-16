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
import api from '../api/client'

// ─── Priority map ─────────────────────────────────────────────────────────────

const PRIORITY_MAP = { critical: 0, high: 1, medium: 2, low: 3 }
const MAX_BATCH    = 5
const MAX_RETRY    = 3

// ─── Endpoint registry ────────────────────────────────────────────────────────
// Maps queue store names to API endpoints + payload transformers

const ENDPOINTS = {
  reports: {
    url       : '/api/reports/',
    transform : (r) => ({
      waste_type : r.wasteType,
      severity   : r.severity,
      notes      : r.notes,
      latitude   : r.location?.lat,
      longitude  : r.location?.lng,
      address    : r.location?.address,
      created_at : r.createdAt,
    }),
  },
  analytics_queue: {
    url       : '/api/analytics/sync/',
    transform : (r) => r.payload,
  },
  events_queue: {
    url       : '/api/events/sync/',
    transform : (r) => r.payload,
  },
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineSyncManager() {
  const isOnline    = useOnline()
  const inFlight    = useRef(new Set())
  const syncingRef  = useRef(false)

  const [isSyncing,  setIsSyncing]  = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const [summary,    setSummary]    = useState({ synced: 0, failed: 0, remaining: 0 })

  // ── Push a single item ──────────────────────────────────────────────────────
  const pushItem = useCallback(async (storeName, item) => {
    if (inFlight.current.has(item.id)) return null
    inFlight.current.add(item.id)

    const ep    = ENDPOINTS[storeName]
    const queue = getQueue(storeName)

    try {
      if (ep) {
        await api.post(ep.url, ep.transform(item))
      }
      await queue.updateItem(item.id, { status: 'synced', syncedAt: new Date().toISOString() })
      return { ok: true, id: item.id }
    } catch {
      const retryCount = (item.retryCount || 0) + 1
      const status     = retryCount >= MAX_RETRY ? 'failed' : 'pending'
      await queue.updateItem(item.id, { status, retryCount })
      return { ok: false, id: item.id }
    } finally {
      inFlight.current.delete(item.id)
    }
  }, [])

  // ── Full sync cycle ─────────────────────────────────────────────────────────
  const syncNow = useCallback(async () => {
    if (!isOnline || syncingRef.current) return
    syncingRef.current = true
    setIsSyncing(true)

    let totalSynced  = 0
    let totalFailed  = 0
    let totalRemain  = 0

    try {
      for (const storeName of Object.keys(ENDPOINTS)) {
        const queue = getQueue(storeName)
        const all   = await queue.getAll()

        // Sort by priority then severity
        const pending = all
          .filter(r => r.status === 'pending')
          .sort((a, b) => {
            const pa = PRIORITY_MAP[a.severity] ?? a.priority ?? 2
            const pb = PRIORITY_MAP[b.severity] ?? b.priority ?? 2
            return pa - pb
          })

        totalRemain += pending.length

        // Process in batches
        for (let i = 0; i < pending.length; i += MAX_BATCH) {
          const batch   = pending.slice(i, i + MAX_BATCH)
          const results = await Promise.all(batch.map(item => pushItem(storeName, item)))
          results.forEach(r => {
            if (!r) return
            if (r.ok)   { totalSynced++;  totalRemain-- }
            else        { totalFailed++ }
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
  }, [isOnline, pushItem])

  // ── Auto-sync on reconnect ──────────────────────────────────────────────────
  useEffect(() => {
    if (isOnline) syncNow()
  }, [isOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  return { syncNow, isSyncing, lastSyncAt, summary }
}
