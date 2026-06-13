/**
 * hooks/useOfflineAnnouncements.js
 * ---------------------------------
 * Stale-while-revalidate cache for announcements.
 *
 * Strategy:
 *   1. Instantly return cached localStorage data (offline-ready, zero flash)
 *   2. When online: background-fetch fresh data → update cache + state
 *   3. Expose `isStale` (true if cache is >30 min old) and `lastFetched`
 *
 * Exports: { announcements, isStale, isRefreshing, lastFetched, refresh }
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from './useOnline'
import api from '../api/client'

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_KEY = 'ww_announcements_v2'
const LS_META_KEY = 'ww_announcements_meta'
const STALE_MS = 30 * 60 * 1000  // 30 minutes

const FALLBACK_ANNOUNCEMENTS = [
  {
    id: 1,
    title: 'CENRO Conducted 31-day Segregation Test',
    body: 'Lucena City CENRO strictly implements proper waste segregation. Let us unite and make Lucena clean!',
    image: 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&q=80&w=600',
    date: '2026-04-20',
  },
  {
    id: 2,
    title: 'New Garbage Collection Trucks Arrived',
    body: 'The local government procured 5 new garbage trucks to improve collection efficiency across all barangays.',
    image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&q=80&w=600',
    date: '2026-04-15',
  },
  {
    id: 3,
    title: 'Illegal Dumping Alert — Barangay 1',
    body: 'Multiple reports near 5th Ave. Residents please be vigilant and report any suspicious dumping activity.',
    image: 'https://images.unsplash.com/photo-1567174891668-5b08b0f3e80a?auto=format&fit=crop&q=80&w=600',
    date: '2026-04-10',
  },
]

// ─── localStorage helpers ─────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function readMeta() {
  try {
    const raw = localStorage.getItem(LS_META_KEY)
    return raw ? JSON.parse(raw) : { lastFetched: null }
  } catch {
    return { lastFetched: null }
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
    localStorage.setItem(LS_META_KEY, JSON.stringify({ lastFetched: Date.now() }))
  } catch {
    // quota exceeded — fail silently
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineAnnouncements() {
  const isOnline = useOnline()
  const fetchingRef = useRef(false)

  const cached = readCache()
  const meta = readMeta()
  const initial = cached || FALLBACK_ANNOUNCEMENTS
  const initialMeta = meta.lastFetched

  const [announcements, setAnnouncements] = useState(initial)
  const [lastFetched, setLastFetched] = useState(initialMeta)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const isStale = !lastFetched || (Date.now() - lastFetched > STALE_MS)

  // ── Background fetch ────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!isOnline || fetchingRef.current) return
    fetchingRef.current = true
    setIsRefreshing(true)
    try {
      const res = await api.get('/api/news/items/for-dashboard/')
      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
        writeCache(res.data)
        setAnnouncements(res.data)
        setLastFetched(Date.now())
      }
    } catch {
      // network error — keep showing cached data silently
    } finally {
      setIsRefreshing(false)
      fetchingRef.current = false
    }
  }, [isOnline])

  // ── Auto-refresh when online & stale ────────────────────────────────────────
  useEffect(() => {
    if (isOnline && isStale) refresh()
  }, [isOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  return { announcements, isStale, isRefreshing, lastFetched, refresh }
}
