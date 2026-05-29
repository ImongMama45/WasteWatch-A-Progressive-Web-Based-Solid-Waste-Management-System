/**
 * hooks/useEscalations.js
 * ------------------------
 * Fetches and manages escalations for the Admin panel.
 */

import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

export function useEscalations() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/watcher/escalations/')
      setItems(res.data)
      setError(null)
    } catch (err) {
      setError('Failed to fetch escalations')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveEscalation = async (id, data) => {
    try {
      const res = await api.patch(`/api/watcher/escalations/${id}/`, data)
      setItems(prev => prev.map(e => e.id === id ? res.data : e))
      return { ok: true }
    } catch (err) {
      console.error(err)
      return { ok: false, error: err.response?.data || 'Failed to save escalation' }
    }
  }

  const resolveEscalation = async (id) => {
    try {
      const res = await api.post(`/api/watcher/escalations/${id}/resolve/`)
      setItems(prev => prev.map(e => e.id === id ? res.data : e))
      return { ok: true }
    } catch (err) {
      console.error(err)
      return { ok: false, error: 'Failed to resolve escalation' }
    }
  }

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, loading, error, refresh, saveEscalation, resolveEscalation }
}
