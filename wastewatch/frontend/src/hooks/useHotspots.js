/**
 * hooks/useHotspots.js
 * --------------------
 * Fetches garbage hotspots for the Admin panel.
 */

import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

export function useHotspots() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/watcher/hotspots/')
      setItems(res.data)
      setError(null)
    } catch (err) {
      setError('Failed to fetch hotspots')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, loading, error, refresh }
}
