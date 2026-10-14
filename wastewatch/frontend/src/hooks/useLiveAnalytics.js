import { useState, useEffect } from 'react'
import api from '../api/client'

const cache = new Map() // key -> { t, data }
const CACHE_TTL = 30_000 // 30 seconds

export function useLiveAnalytics({ selectedBarangay, dateFrom, dateTo }) {
  const [state, setState] = useState({ raw: null, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    const p = new URLSearchParams()
    if (selectedBarangay && selectedBarangay !== 'all') p.set('barangay_id', selectedBarangay)
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    const key = p.toString()
    const hit = cache.get(key)
    if (hit && Date.now() - hit.t < CACHE_TTL) {
      setState({ raw: hit.data, loading: false, error: null })
      return
    }
    setState(s => ({ ...s, loading: true, error: null }))
    api.get(`/api/analytics/live/?${key}`)
      .then(res => {
        cache.set(key, { t: Date.now(), data: res.data })
        if (!cancelled) setState({ raw: res.data, loading: false, error: null })
      })
      .catch(() => { if (!cancelled) setState({ raw: null, loading: false, error: 'Could not load live data.' }) })
    return () => { cancelled = true }
  }, [selectedBarangay, dateFrom, dateTo])
  return state
}
