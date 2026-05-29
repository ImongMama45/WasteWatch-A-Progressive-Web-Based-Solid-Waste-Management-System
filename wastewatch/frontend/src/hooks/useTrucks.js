/**
 * hooks/useTrucks.js
 * -------------------
 * Fetches and manages trucks for the Admin panel.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'

export function useTrucks() {
  const [trucks, setTrucks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/driver/trucks/')
      setTrucks(res.data)
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
        setTrucks(prev => prev.map(t => t.id === id ? res.data : t))
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
      setTrucks(prev => prev.filter(t => t.id !== id))
      return { ok: true }
    } catch (err) {
      console.error(err)
      return { ok: false, error: 'Failed to delete truck' }
    }
  }

  useEffect(() => {
    refresh()
  }, [refresh])

  return { trucks, loading, error, refresh, saveTruck, deleteTruck }
}
