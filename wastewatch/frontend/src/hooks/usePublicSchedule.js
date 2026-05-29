/**
 * hooks/usePublicSchedule.js
 * --------------------------
 * Fetches general collection schedule for the Public Dashboard.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from './useOnline'
import api from '../api/client'

const LS_KEY = 'ww_public_schedule'

export function usePublicSchedule() {
  const isOnline = useOnline()
  const fetchingRef = useRef(false)

  const [schedule, setSchedule] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    if (!isOnline || fetchingRef.current) return
    fetchingRef.current = true
    setIsRefreshing(true)
    try {
      const res = await api.get('/api/public/schedule/')
      if (res.data) {
        setSchedule(res.data)
        localStorage.setItem(LS_KEY, JSON.stringify(res.data))
      }
    } catch (err) {
      console.error('Failed to fetch public schedule:', err)
    } finally {
      setIsRefreshing(false)
      fetchingRef.current = false
    }
  }, [isOnline])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { schedule, isRefreshing, refresh }
}
