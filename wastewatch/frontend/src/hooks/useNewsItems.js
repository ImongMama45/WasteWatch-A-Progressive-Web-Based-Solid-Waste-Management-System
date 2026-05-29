/**
 * hooks/useNewsItems.js
 * ---------------------
 * Fetches news items from the API.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from './useOnline'
import api from '../api/client'

const LS_KEY = 'ww_news_items'

export function useNewsItems() {
  const isOnline = useOnline()
  const fetchingRef = useRef(false)

  const [items, setItems] = useState(() => {
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
      const res = await api.get('/api/news/items/')
      if (res.data) {
        setItems(res.data)
        localStorage.setItem(LS_KEY, JSON.stringify(res.data))
      }
    } catch (err) {
      console.error('Failed to fetch news items:', err)
    } finally {
      setIsRefreshing(false)
      fetchingRef.current = false
    }
  }, [isOnline])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, isRefreshing, refresh }
}
