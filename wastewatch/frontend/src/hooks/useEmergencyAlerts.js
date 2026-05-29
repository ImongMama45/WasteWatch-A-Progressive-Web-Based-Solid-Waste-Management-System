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

  const [alerts, setAlerts] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    if (!isOnline || fetchingRef.current) return
    fetchingRef.current = true
    setIsRefreshing(true)
    try {
      const res = await api.get('/api/news/alerts/')
      if (res.data) {
        setAlerts(res.data)
        localStorage.setItem(LS_KEY, JSON.stringify(res.data))
      }
    } catch (err) {
      console.error('Failed to fetch emergency alerts:', err)
    } finally {
      setIsRefreshing(false)
      fetchingRef.current = false
    }
  }, [isOnline])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { alerts, isRefreshing, refresh }
}
