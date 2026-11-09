/**
 * hooks/useEscalations.js
 * ------------------------
 * Fetches and manages escalations for the Admin panel.
 */

import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

function normalizeEscalationsPayload(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  return []
}

export function useEscalations() {
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ count: 0, total_pages: 1, current_page: 1, page_size: 10, summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async (params = {}, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await api.get('/api/watcher/escalations/', { params })
      setItems(normalizeEscalationsPayload(res.data))
      if (res.data && typeof res.data === 'object' && 'count' in res.data) {
        setPagination({
          count: res.data.count || 0,
          total_pages: res.data.total_pages || 1,
          current_page: res.data.current_page || 1,
          page_size: res.data.page_size || 10,
          summary: res.data.summary || null
        })
      }
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

  return { items, pagination, loading, error, refresh, saveEscalation, resolveEscalation }
}
