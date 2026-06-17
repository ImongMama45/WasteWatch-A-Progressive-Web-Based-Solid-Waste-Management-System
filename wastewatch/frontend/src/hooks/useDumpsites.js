/**
 * hooks/useDumpsites.js
 * ---------------------
 * Fetches and manages dumpsites for the Admin panel.
 */

import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

export function useDumpsites() {
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/dumpsite/dumpsites/')
      setSites(res.data)
      setError(null)
    } catch (err) {
      setError('Failed to fetch dumpsites')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveSite = async (id, data) => {
    try {
      if (id) {
        const res = await api.patch(`/api/dumpsite/dumpsites/${id}/`, data)
        setSites(prev => prev.map(s => s.id === id ? res.data : s))
        return { ok: true, data: res.data }
      } else {
        const res = await api.post('/api/dumpsite/dumpsites/', data)
        setSites(prev => [...prev, res.data])
        return { ok: true, data: res.data }
      }
    } catch (err) {
      console.error(err)
      return { ok: false, error: err.response?.data || 'Failed to save site' }
    }
  }

  const deleteSite = async (id) => {
    try {
      await api.delete(`/api/dumpsite/dumpsites/${id}/`)
      setSites(prev => prev.filter(s => s.id !== id))
      return { ok: true }
    } catch (err) {
      console.error(err)
      return { ok: false, error: 'Failed to delete site' }
    }
  }

  const createAccount = async (siteId, accountData) => {
    try {
      const res = await api.post(`/api/dumpsite/dumpsites/${siteId}/create-account/`, accountData)
      return { ok: true, data: res.data }
    } catch (err) {
      console.error(err)
      return { ok: false, error: err.response?.data?.error || 'Failed to create account' }
    }
  }

  useEffect(() => {
    refresh()
  }, [refresh])

  return { sites, loading, error, refresh, saveSite, deleteSite, createAccount }
}
