/**
 * hooks/useEmergencyAlerts.js
 * ---------------------------
 * Fetches active emergency alerts.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from './useOnline'
import api from '../api/client'

const LS_KEY = 'ww_emergency_alerts'

export function useEmergencyAlerts() {
  const isOnline = useOnline()
  const fetchingRef = useRef(false)
  const [isFromCache, setIsFromCache] = useState(false)

  const [alerts, setAlerts] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      const list = Array.isArray(parsed) ? parsed : (parsed?.results || [])
      return list
    } catch {
      return []
    }
  })

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!isOnline) {
      if (alerts.length > 0) setIsFromCache(true)
      return
    }
    if (fetchingRef.current) return
    fetchingRef.current = true
    setIsRefreshing(true)
    setError(null)
    try {
      const res = await api.get('/api/news/alerts/')
      if (res && res.data !== undefined) {
        const normalized = Array.isArray(res.data)
          ? res.data
          : Array.isArray(res.data?.results)
          ? res.data.results
          : []
        setAlerts(normalized)
        localStorage.setItem(LS_KEY, JSON.stringify(normalized))
        setIsFromCache(false)
        setError(null)
      }
    } catch (err) {
      console.error('Failed to fetch emergency alerts:', err)
      setError(err)
      if (alerts.length > 0) setIsFromCache(true)
    } finally {
      setIsRefreshing(false)
      fetchingRef.current = false
    }
  }, [isOnline, alerts.length])

  useEffect(() => {
    refresh()
  }, [refresh])

  const isOfflineCached = !isOnline && isFromCache && alerts.length > 0

  return { alerts, isRefreshing, error, refresh, isOfflineCached }
}
