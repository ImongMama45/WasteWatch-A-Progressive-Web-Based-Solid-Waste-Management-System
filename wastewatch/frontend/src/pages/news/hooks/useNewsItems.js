/**
 * pages/news/hooks/useNewsItems.js
 * --------------------------------
 * Fetches news items from the API with scope-aware filtering:
 * - All Lucena City: /api/news/items/ (no filter parameters)
 * - Specific Barangay: /api/news/items/?barangay_id=<id>
 * - Citywide Only: /api/news/items/?city_wide=true
 *
 * Guarantees scope isolation:
 * - Immediately switches displayed items to the newly requested scope's cache (or []) during render.
 * - Previous-scope data is never rendered under a new scope.
 * - Clears errors belonging to prior scopes.
 * - Discards stale responses and cancels in-flight requests on scope switch and unmount.
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
  // across ordinary component renders (search query typing, category tab click, modal toggle)
  const scopeSignature = createScopeSignature(options)

  // Memoize params and scopeKey strictly based on the stable scope signature
  // Guarantees params and scopeKey object identity stability across ordinary component renders
  const { params, scopeKey } = useMemo(() => {
    return resolveScopeParams(options)
  }, [scopeSignature])

  const requestIdRef = useRef(0)
  const isMountedRef = useRef(true)
  const activeControllerRef = useRef(null)
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey

  // Data and error states are strictly keyed by scopeKey
  const [dataState, setDataState] = useState(() => ({
    scopeKey,
    items: readScopeCache(scopeKey),
  }))

  const [errorState, setErrorState] = useState(() => ({
    scopeKey,
    error: null,
  }))

  const [isRefreshing, setIsRefreshing] = useState(false)

  // Synchronous scope adjustment during render:
  // If scopeKey changed since last render, immediately reset to that scope's cache (or [])
  // and clear any error from the previous scope. Executes before paint.
  if (dataState.scopeKey !== scopeKey) {
    setDataState({
      scopeKey,
      items: readScopeCache(scopeKey),
    })
  }

  if (errorState.scopeKey !== scopeKey) {
    setErrorState({
      scopeKey,
      error: null,
    })
  }

  // Derive active items and error strictly for current scopeKey
  const activeItems = dataState.scopeKey === scopeKey
    ? dataState.items
    : readScopeCache(scopeKey)

  const activeError = errorState.scopeKey === scopeKey ? errorState.error : null

  const refresh = useCallback(
    async (signal) => {
      if (!isOnline) return

      // Abort previous in-flight request if this is a manual or new refresh
      if (!signal) {
        activeControllerRef.current?.abort()
        const newController = new AbortController()
        activeControllerRef.current = newController
        signal = newController.signal
      }

      const currentReqId = ++requestIdRef.current
      const currentScopeKey = scopeKey
      setIsRefreshing(true)

      const result = await executeScopedFetch({
        apiClient: api,
        params,
        signal,
        isValidRequest: () =>
          isMountedRef.current &&
          currentReqId === requestIdRef.current &&
          scopeKeyRef.current === currentScopeKey,
        onCommit: (normalized) => {
          if (!isMountedRef.current) return
          setDataState({ scopeKey: currentScopeKey, items: normalized })
          setErrorState({ scopeKey: currentScopeKey, error: null })
          writeScopeCache(currentScopeKey, normalized)
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
      }
      return result
    },
    [isOnline, params, scopeKey]
  )

  useEffect(() => {
    isMountedRef.current = true
    const controller = new AbortController()
    activeControllerRef.current = controller

    refresh(controller.signal)

    return () => {
      isMountedRef.current = false
      controller.abort()
    }
  }, [refresh])

  return {
    items: activeItems,
    loading: isRefreshing,
    isRefreshing,
    error: activeError,
    refresh: () => refresh(),
  }
}
