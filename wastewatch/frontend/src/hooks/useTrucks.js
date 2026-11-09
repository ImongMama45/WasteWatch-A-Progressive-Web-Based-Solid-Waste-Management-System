/**
 * hooks/useTrucks.js
 * -------------------
 * Fetches and manages trucks for the Admin panel.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'

function normalizeTrucksPayload(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  return []
}

export function useTrucks(defaultParams = null) {
  const [trucks, setTrucks] = useState([])
  const [pagination, setPagination] = useState({ count: 0, total_pages: 1, current_page: 1, page_size: 10, summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const defaultParamsRef = useRef(defaultParams)

  const refresh = useCallback(async (params) => {
    setLoading(true)
    try {
      const res = await api.get('/api/driver/trucks/', { params: params || defaultParamsRef.current || {} })
      setTrucks(normalizeTrucksPayload(res.data))
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
      setError('Failed to fetch trucks')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveTruck = async (id, data) => {
    try {
      if (id) {
        const res = await api.patch(`/api/driver/trucks/${id}/`, data)
        setTrucks(prev => prev.map(t => String(t.id) === String(id) ? res.data : t))
      } else {
        const res = await api.post('/api/driver/trucks/', data)
        setTrucks(prev => [...prev, res.data])
      }
      return { ok: true }
    } catch (err) {
      console.error(err)
      return { ok: false, error: err.response?.data || 'Failed to save truck' }
    }
  }

  const deleteTruck = async (id) => {
    try {
      await api.delete(`/api/driver/trucks/${id}/`)
      setTrucks(prev => prev.filter(t => String(t.id) !== String(id)))
      return { ok: true }
    } catch (err) {
      console.error(err)
      return { ok: false, error: 'Failed to delete truck' }
    }
  }

  useEffect(() => {
    refresh()
  }, [refresh])

  return { trucks, pagination, loading, error, refresh, saveTruck, deleteTruck }
}
