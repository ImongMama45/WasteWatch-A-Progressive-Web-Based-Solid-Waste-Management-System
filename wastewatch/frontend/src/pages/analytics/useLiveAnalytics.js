import { useState, useEffect } from 'react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { analyticsCache } from '../../api/analyticsCache'

const TTL = 30_000

export function useLiveAnalytics({ selectedBarangay, dateFrom, dateTo }) {
  const { user } = useAuth()
  const [state, setState] = useState({ raw: null, loading: true, error: null })

  useEffect(() => {
    const p = new URLSearchParams()
    if (selectedBarangay && selectedBarangay !== 'all') p.set('barangay_id', selectedBarangay)
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    const key = `${user?.id}|${p}`
    const hit = analyticsCache.get(key)
    if (hit && Date.now() - hit.t < TTL) {
      setState({ raw: hit.data, loading: false, error: null })
      return
    }
    const ctrl = new AbortController()
    setState(s => ({ ...s, loading: true, error: null }))   // keep s.raw visible
    api.get(`/api/analytics/live/?${p}`, { signal: ctrl.signal })
      .then(res => {
        analyticsCache.set(key, { t: Date.now(), data: res.data })
        setState({ raw: res.data, loading: false, error: null })
      })
      .catch(err => {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return
        setState(s => ({ raw: null, loading: false,
          error: err.response?.data?.detail || 'Could not load live data.' }))
      })
    return () => ctrl.abort()
  }, [user?.id, selectedBarangay, dateFrom, dateTo])

  return state
}
