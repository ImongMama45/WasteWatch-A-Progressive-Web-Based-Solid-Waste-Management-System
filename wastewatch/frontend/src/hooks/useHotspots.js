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

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await api.get('/api/watcher/hotspots/')
      const mapped = res.data.map(h => {
        let pType = 'Mixed';
        if (h.name) {
          if (h.name.includes('—')) pType = h.name.split('—')[1].trim();
          else if (h.name.includes('-')) pType = h.name.split('-')[1].trim();
          else pType = h.name;
        }
        return {
          ...h,
          count: h.report_count || 0,
          type: pType,
          status: h.severity || 'low',
          ago: (h.created_at || h.last_detected) ? new Date(h.created_at || h.last_detected).toLocaleString() : '—'
        }
      })
      setItems(mapped)
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
