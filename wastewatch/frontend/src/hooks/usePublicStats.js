/**
 * hooks/usePublicStats.js
 * -----------------------
 * Fetches aggregate community statistics for the Public Dashboard.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from './useOnline'
import api from '../api/client'

const LS_KEY = 'ww_public_stats'
const STALE_MS = 10 * 60 * 1000 // 10 minutes

export function usePublicStats() {
  const isOnline = useOnline()
  const fetchingRef = useRef(false)

  const [stats, setStats] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      return raw ? JSON.parse(raw) : {
        total_reports: 0,
        resolved_reports: 0,
        active_trucks: 0,
        hotspots: 0,
      }
    } catch {
      return {
        total_reports: 0,
        resolved_reports: 0,
        active_trucks: 0,
        hotspots: 0,
      }
    }
  })

  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    if (!isOnline || fetchingRef.current) return
    fetchingRef.current = true
    setIsRefreshing(true)
    try {
      const res = await api.get('/api/public/stats/')
      if (res.data) {
        setStats(res.data)
        localStorage.setItem(LS_KEY, JSON.stringify(res.data))
      }
    } catch (err) {
      console.error('Failed to fetch public stats:', err)
    } finally {
      setIsRefreshing(false)
      fetchingRef.current = false
    }
  }, [isOnline])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { stats, isRefreshing, refresh }
}
