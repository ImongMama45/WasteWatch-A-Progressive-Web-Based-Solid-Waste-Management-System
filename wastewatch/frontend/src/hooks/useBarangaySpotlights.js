/**
 * hooks/useBarangaySpotlights.js
 * ------------------------------
 * Fetches top-performing barangay spotlights.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from './useOnline'
import api from '../api/client'

const LS_KEY = 'ww_barangay_spotlights'

export function useBarangaySpotlights() {
  const isOnline = useOnline()
  const fetchingRef = useRef(false)

  const [spotlights, setSpotlights] = useState(() => {
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
      const res = await api.get('/api/news/spotlights/')
      if (res.data) {
        setSpotlights(res.data)
        localStorage.setItem(LS_KEY, JSON.stringify(res.data))
      }
    } catch (err) {
      console.error('Failed to fetch barangay spotlights:', err)
    } finally {
      setIsRefreshing(false)
      fetchingRef.current = false
    }
  }, [isOnline])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { spotlights, isRefreshing, refresh }
}
