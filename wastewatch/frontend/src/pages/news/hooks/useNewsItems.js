/**
 * pages/news/hooks/useNewsItems.js
 * --------------------------------
 * Fetches news items from the API with scope-aware filtering and server-side pagination:
 * - All Lucena City: /api/news/items/ (no filter parameters)
 * - Specific Barangay: /api/news/items/?barangay_id=<id>
 * - Citywide Only: /api/news/items/?city_wide=true
 *
 * Feed Performance Features:
 * - Server-side pagination with default page_size=10, selectable 10, 20, 30.
 * - Deterministic deduplication on subsequent page loads.
 * - 60s lightweight polling using /api/news/items/latest-check/.
 * - Visibility-aware: pauses polling when tab is hidden, resumes on visible.
 * - Non-intrusive 'hasNewContent' flag: preserves scroll and reading state.
 * - Exponential backoff on polling network errors.
 * - Scope isolation: clears errors, cancels in-flight requests on scope switch.
 * Zero emojis.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import axios from 'axios'
import { useOnline } from '../../../hooks/useOnline'
import api from '../../../api/client'
import {
  resolveScopeParams,
  createScopeSignature,
  executeScopedFetch,
  readScopeCache,
  writeScopeCache,
  getScopeCacheKey,
  BASE_CACHE_KEY,
} from '../utils/newsUtils'

export {
  resolveScopeParams,
  createScopeSignature,
  executeScopedFetch,
  readScopeCache,
  writeScopeCache,
  getScopeCacheKey,
  BASE_CACHE_KEY,
}

export function useNewsItems(options) {
  const isOnline = useOnline()

  // Generate stable scope signature string to prevent unnecessary refetches
  const scopeSignature = createScopeSignature(options)

  const { params, scopeKey } = useMemo(() => {
    return resolveScopeParams(options)
  }, [scopeSignature])

  const requestIdRef = useRef(0)
  const isMountedRef = useRef(true)
  const activeControllerRef = useRef(null)
  const isPollingRef = useRef(false)
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey

  const latestSeenRef = useRef({ id: null, timestamp: null, count: 0, alertId: null })
  const lastCheckTimeRef = useRef(Date.now())
  const backoffDelayRef = useRef(60000)

  // Data and error states strictly keyed by scopeKey
  const [dataState, setDataState] = useState(() => ({
    scopeKey,
    items: readScopeCache(scopeKey),
  }))

  const [errorState, setErrorState] = useState(() => ({
    scopeKey,
    error: null,
  }))

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasNewContent, setHasNewContent] = useState(false)

  // Synchronous scope adjustment during render:
  if (dataState.scopeKey !== scopeKey) {
    setDataState({
      scopeKey,
      items: readScopeCache(scopeKey),
    })
    setCurrentPage(1)
    setHasNewContent(false)
  }

  if (errorState.scopeKey !== scopeKey) {
    setErrorState({
      scopeKey,
      error: null,
    })
  }

  const activeItems = dataState.scopeKey === scopeKey
    ? dataState.items
    : readScopeCache(scopeKey)

  const activeError = errorState.scopeKey === scopeKey ? errorState.error : null

  // Fetch a specific page
  const fetchPage = useCallback(
    async (pageToLoad = 1, size = pageSize, signal) => {
      if (!isOnline) return

      if (pageToLoad === 1) {
        if (!signal) {
          activeControllerRef.current?.abort()
          const newController = new AbortController()
          activeControllerRef.current = newController
          signal = newController.signal
        }
        setIsRefreshing(true)
      } else {
        setLoadingMore(true)
      }

      const currentReqId = ++requestIdRef.current
      const currentScopeKey = scopeKey

      const queryParams = {
        ...params,
        page: pageToLoad,
        page_size: size,
      }

      const result = await executeScopedFetch({
        apiClient: api,
        params: queryParams,
        signal,
        isValidRequest: () =>
          isMountedRef.current &&
          currentReqId === requestIdRef.current &&
          scopeKeyRef.current === currentScopeKey,
        onCommit: (normalized, meta = {}) => {
          if (!isMountedRef.current) return
          const total = typeof meta.total === 'number' ? meta.total : normalized.length

          if (pageToLoad === 1) {
            setDataState({ scopeKey: currentScopeKey, items: normalized })
            setErrorState({ scopeKey: currentScopeKey, error: null })
            setTotalCount(total)
            setCurrentPage(1)
            setHasMore(Boolean(meta.hasNext))
            setHasNewContent(false)
            writeScopeCache(currentScopeKey, normalized)

            if (normalized.length > 0) {
              latestSeenRef.current = {
                id: normalized[0].id,
                timestamp: normalized[0].updated_at || null,
                count: total,
                alertId: latestSeenRef.current.alertId,
              }
            } else {
              latestSeenRef.current = { id: null, timestamp: null, count: total, alertId: latestSeenRef.current.alertId }
            }
          } else {
            // Deduplicate subsequent pages by id
            setDataState(prev => {
              const seen = new Set(prev.items.map(i => i.id))
              const fresh = normalized.filter(i => !seen.has(i.id))
              return {
                scopeKey: currentScopeKey,
                items: [...prev.items, ...fresh],
              }
            })
            setTotalCount(total)
            setCurrentPage(pageToLoad)
            setHasMore(Boolean(meta.hasNext))
          }
        },
        onError: (err) => {
          if (!isMountedRef.current) return
          console.error('Failed to fetch news items:', err)
          setErrorState({ scopeKey: currentScopeKey, error: err })
        },
        isCancel: (err) => axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED',
      })

      if (isMountedRef.current && currentReqId === requestIdRef.current) {
        setIsRefreshing(false)
        setLoadingMore(false)
      }
      return result
    },
    [isOnline, params, scopeKey, pageSize]
  )

  // Scope or pageSize change loads page 1
  useEffect(() => {
    isMountedRef.current = true
    const controller = new AbortController()
    activeControllerRef.current = controller

    fetchPage(1, pageSize, controller.signal)

    return () => {
      isMountedRef.current = false
      controller.abort()
    }
  }, [fetchPage, scopeKey, pageSize])

  // Load next page
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return
    await fetchPage(currentPage + 1, pageSize)
  }, [hasMore, loadingMore, currentPage, pageSize, fetchPage])

  // Refresh (page 1)
  const refresh = useCallback(
    async (signal) => {
      return await fetchPage(1, pageSize, signal)
    },
    [fetchPage, pageSize]
  )

  // Change page size (10, 20, 30)
  const changePageSize = useCallback((newSize) => {
    const clamped = Math.min(30, Math.max(10, Number(newSize) || 10))
    setPageSize(clamped)
  }, [])

  // Load new content
  const loadNewContent = useCallback(async () => {
    setHasNewContent(false)
    await fetchPage(1, pageSize)
  }, [fetchPage, pageSize])

  // Lightweight 60s polling
  useEffect(() => {
    let timerId = null

    const checkLatest = async () => {
      if (
        !isMountedRef.current ||
        isPollingRef.current ||
        !isOnline ||
        document.visibilityState !== 'visible'
      ) {
        scheduleNext(backoffDelayRef.current)
        return
      }

      isPollingRef.current = true
      try {
        const res = await api.get('/api/news/items/latest-check/', { params })
        if (!isMountedRef.current) return

        backoffDelayRef.current = 60000
        lastCheckTimeRef.current = Date.now()

        const {
          latest_news_id,
          news_count,
          latest_alert_id,
        } = res.data || {}

        const prev = latestSeenRef.current

        if (prev.id !== null && latest_news_id !== undefined && latest_news_id > prev.id) {
          setHasNewContent(true)
        } else if (prev.count > 0 && typeof news_count === 'number' && news_count > prev.count) {
          setHasNewContent(true)
        } else if (prev.alertId !== null && latest_alert_id !== undefined && latest_alert_id > prev.alertId) {
          setHasNewContent(true)
        }

        if (latest_alert_id !== undefined) {
          latestSeenRef.current.alertId = latest_alert_id
        }
      } catch (err) {
        console.warn('News latest-check error, backing off:', err?.message)
        backoffDelayRef.current = Math.min(180000, Math.round(backoffDelayRef.current * 1.5))
      } finally {
        isPollingRef.current = false
        scheduleNext(backoffDelayRef.current)
      }
    }

    const scheduleNext = (delayMs) => {
      clearTimeout(timerId)
      timerId = setTimeout(checkLatest, delayMs)
    }

    scheduleNext(60000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastCheckTimeRef.current
        if (elapsed >= 50000) {
          checkLatest()
        } else {
          scheduleNext(Math.max(10000, 60000 - elapsed))
        }
      } else {
        clearTimeout(timerId)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(timerId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [params, isOnline])

  return {
    items: activeItems,
    loading: isRefreshing,
    isRefreshing,
    error: activeError,
    totalCount,
    currentPage,
    pageSize,
    setPageSize: changePageSize,
    hasMore,
    loadingMore,
    hasNewContent,
    loadNewContent,
    loadMore,
    refresh,
  }
}
