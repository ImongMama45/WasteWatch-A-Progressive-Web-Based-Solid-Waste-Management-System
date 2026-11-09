import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

// KEEP IN SYNC WITH backend/watcher/models.py InterventionStatus
const ACTIVE_STATUS_MAP = {
  dispatch: 'created,acknowledged',
  flag: 'flagged,acknowledged',
}

export function useInterventions(type) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { 
    let cancelled = false;

    const fetchItems = async () => {
      setLoading(true)
      try {
        const res = await api.get('/api/watcher/interventions/', {
          params: { type, status: ACTIVE_STATUS_MAP[type] }
        })
        if (!cancelled) setItems(res.data)
      } catch (err) {
        if (!cancelled) console.error('[useInterventions] fetch failed', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchItems()

    const interval = setInterval(fetchItems, 30000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [type])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/watcher/interventions/', {
        params: { type, status: ACTIVE_STATUS_MAP[type] }
      })
      setItems(res.data)
    } catch (err) {
      console.error('[useInterventions] fetch failed', err)
    } finally {
      setLoading(false)
    }
  }, [type])

  return { items, loading, refresh }
}
