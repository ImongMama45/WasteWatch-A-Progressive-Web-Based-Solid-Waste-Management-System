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
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : (parsed?.results || [])
    } catch {
      return []
    }
  })

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!isOnline || fetchingRef.current) return
    fetchingRef.current = true
    setIsRefreshing(true)
    setError(null)
    try {
      const res = await api.get('/api/news/spotlights/')
      if (res && res.data !== undefined) {
        const normalized = Array.isArray(res.data)
          ? res.data
          : Array.isArray(res.data?.results)
          ? res.data.results
          : []
        setSpotlights(normalized)
        localStorage.setItem(LS_KEY, JSON.stringify(normalized))
        setError(null)
      }
    } catch (err) {
      console.error('Failed to fetch barangay spotlights:', err)
      setError(err)
    } finally {
      setIsRefreshing(false)
      fetchingRef.current = false
    }
  }, [isOnline])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { spotlights, isRefreshing, error, refresh }
}
