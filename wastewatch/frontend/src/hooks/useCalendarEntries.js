/**
 * src/hooks/useCalendarEntries.js
 * --------------------------------
 * Reusable React hook and state session manager for fetching and managing
 * WasteWatch Calendar entries from GET /api/calendar/entries/.
 *
 * Integrated with IndexedDB persistent read-cache (wastewatch_db v8):
 *  - Cache-first, network-refresh lifecycle: immediate cached results on mount.
 *  - Offline fallback: retains and indicates stale cached data on network error.
 *  - Strict fail-closed security boundary:
 *      * Admin & staff callers skip public cache reads and writes.
 *      * Anonymous visitors and verified public roles use public cache.
 *      * Unverified/unknown caller contexts fail closed (no cache writes).
 *  - Race condition & request cancellation protection (tokens, unmount guards).
 *  - Non-flickering background refresh.
 *
 * STRICT ICONOGRAPHY: No emojis.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getCalendarEntries, CalendarServiceError } from '../api/calendarService.js'
import {
  getCalendarCacheEntry,
  setCalendarCacheEntry,
  isCacheablePublicQuery,
  normalizeCalendarParams,
  CANONICAL_PUBLIC_ROLES,
} from '../utils/calendarCache.js'
import { useAuth } from '../context/calendarAuthBridge.js'

export { CANONICAL_PUBLIC_ROLES }

/**
 * Evaluates caller authorization context for calendar cache interactions.
 * Admin and staff callers are strictly prohibited from public cache reads and writes.
 * Anonymous and verified public roles are permitted.
 * Unknown or unverified caller contexts fail closed.
 *
 * @param {*} user - User object from AuthContext or caller options
 * @returns {{ isPublic: boolean, isAdmin: boolean, isVerified: boolean, user: Object|null|undefined, reason?: string }}
 */
export function evaluateCalendarCallerContext(user) {
  if (user === undefined) {
    return {
      isPublic: false,
      isAdmin: false,
      isVerified: false,
      user: undefined,
      reason: 'unverified_caller_context',
    }
  }

  if (user === null) {
    // Anonymous / unauthenticated visitor is positively verified public
    return {
      isPublic: true,
      isAdmin: false,
      isVerified: true,
      user: null,
    }
  }

  if (typeof user === 'object' && user !== null) {
    // Fail closed if user object itself indicates an unresolved/loading auth session
    if (user.loading === true) {
      return {
        isPublic: false,
        isAdmin: false,
        isVerified: false,
        user: undefined,
        reason: 'unresolved_auth_session',
      }
    }

    const role = String(user.role || '').toLowerCase()
    const isStaff = Boolean(user.is_staff)

    if (role === 'admin' || isStaff) {
      return {
        isPublic: false,
        isAdmin: true,
        isVerified: true,
        user,
        reason: 'caller_is_admin',
      }
    }

    if (CANONICAL_PUBLIC_ROLES.has(role)) {
      return {
        isPublic: true,
        isAdmin: false,
        isVerified: true,
        user,
      }
    }

    return {
      isPublic: false,
      isAdmin: false,
      isVerified: false,
      user,
      reason: 'unknown_caller_role',
    }
  }

  return {
    isPublic: false,
    isAdmin: false,
    isVerified: false,
    user: undefined,
    reason: 'invalid_caller_context',
  }
}

/**
 * Pure session controller encapsulating asynchronous lifecycle,
 * state transitions, stale-request protection, unmount cancellation,
 * and IndexedDB persistent cache synchronization.
 */
export function createCalendarEntriesSession({
  fetcher = getCalendarEntries,
  cacheReader = getCalendarCacheEntry,
  cacheWriter = setCalendarCacheEntry,
  user = undefined,
  getUser = null,
  auth = null,
  getAuth = null,
  onStateChange = () => { },
} = {}) {
  let requestId = 0
  let networkResolvedForReqId = 0
  let isMounted = true
  let currentState = {
    entries: [],
    loading: false,
    isRefreshing: false,
    isFromCache: false,
    isStale: false,
    lastUpdated: null,
    error: null,
    pagination: {
      count: 0,
      totalPages: null,
      currentPage: 1,
      pageSize: 20,
      next: null,
      previous: null,
      paginated: true,
    },
    isCapacityError: false,
    isNetworkError: false,
  }

  function setState(patch) {
    if (!isMounted) return
    currentState = { ...currentState, ...patch }
    currentState.isCapacityError = Boolean(
      currentState.error?.isCapacityError ||
      currentState.error?.status === 503 ||
      currentState.error?.code === 'capacity_limit_exceeded'
    )
    currentState.isNetworkError = Boolean(
      currentState.error?.isNetworkError ||
      currentState.error?.code === 'network_error'
    )
    onStateChange(currentState)
  }

  async function fetchEntries(options = {}, isBackgroundRefresh = false) {
    const { startDate, endDate, start_date, end_date } = options
    const resolvedStart = start_date || startDate
    const resolvedEnd = end_date || endDate

    if (!resolvedStart || !resolvedEnd) {
      setState({ loading: false, isRefreshing: false })
      return currentState
    }

    const currentReqId = ++requestId

    // Determine caller authorization (failing closed on unresolved session restoration)
    const resolvedAuth = options.auth !== undefined
      ? options.auth
      : (typeof getAuth === 'function' ? getAuth() : auth)
    let resolvedUser = options.user !== undefined
      ? options.user
      : (typeof getUser === 'function' ? getUser() : user)

    if (resolvedAuth?.loading) {
      resolvedUser = undefined
    }

    const callerAuth = evaluateCalendarCallerContext(resolvedUser)

    // Normalize parameters for query and cache key
    const normalizedParams = normalizeCalendarParams(options)
    const isQueryCacheable = isCacheablePublicQuery(normalizedParams)
    const isCacheEligible = callerAuth.isPublic && !callerAuth.isAdmin && isQueryCacheable

    let activeCachedData = null
    let cacheReadPromise = null

    // ── Phase 1: Cache Read Initiation (Concurrent with Network) ──
    if (isCacheEligible && !isBackgroundRefresh) {
      cacheReadPromise = Promise.resolve()
        .then(() => cacheReader(normalizedParams))
        .then((cached) => {
          // Verify this request is still active and network has not already resolved
          if (
            isMounted &&
            requestId === currentReqId &&
            networkResolvedForReqId !== currentReqId &&
            cached &&
            Array.isArray(cached.entries)
          ) {
            activeCachedData = cached
            const cachedPagination = cached.entry?.metadata?.pagination || {
              count: cached.count ?? cached.entries.length,
              totalPages: cached.entry?.metadata?.totalPages ?? (cached.entry?.paginate ? Math.ceil((cached.count || cached.entries.length) / (cached.entry?.pageSize || 20)) : 1),
              currentPage: cached.entry?.page ?? 1,
              pageSize: cached.entry?.pageSize ?? 20,
              next: cached.entry?.metadata?.next ?? null,
              previous: cached.entry?.metadata?.previous ?? null,
              paginated: cached.entry?.paginate ?? true,
            }

            setState({
              entries: cached.entries,
              loading: false,
              isRefreshing: true, // Network request is actively in flight
              isFromCache: true,
              isStale: Boolean(cached.isStale),
              lastUpdated: cached.cachedAt || null,
              pagination: cachedPagination,
              error: null,
            })
          }
          return cached
        })
        .catch((cacheErr) => {
          console.warn('[CalendarHook] Cache read failed; continuing with network fetch:', cacheErr)
          return null
        })
    }

    // Set initial loading state
    if (isBackgroundRefresh) {
      setState({ isRefreshing: true })
    } else {
      setState({ loading: true, error: null })
    }

    // ── Phase 2: Network API Fetch ──
    try {
      const response = await fetcher(options)

      // Guard against race conditions and component unmount
      if (!isMounted || requestId !== currentReqId) {
        return currentState
      }

      networkResolvedForReqId = currentReqId

      // Persist to public cache if eligible
      if (isCacheEligible) {
        try {
          const metadata = {
            count: response.count,
            totalPages: response.totalPages,
            currentPage: response.currentPage,
            pageSize: response.pageSize,
            next: response.next,
            previous: response.previous,
            paginated: response.paginated,
            pagination: {
              count: response.count,
              totalPages: response.totalPages,
              currentPage: response.currentPage,
              pageSize: response.pageSize,
              next: response.next,
              previous: response.previous,
              paginated: response.paginated,
            },
          }
          await cacheWriter(options, response.results, metadata, { user: callerAuth.user })
        } catch (cacheWriteErr) {
          console.warn('[CalendarHook] Cache write failed; network data preserved:', cacheWriteErr)
        }
      }

      // Update state with fresh network response
      setState({
        entries: response.results,
        loading: false,
        isRefreshing: false,
        isFromCache: false,
        isStale: false,
        lastUpdated: Date.now(),
        error: null,
        pagination: {
          count: response.count,
          totalPages: response.totalPages,
          currentPage: response.currentPage,
          pageSize: response.pageSize,
          next: response.next,
          previous: response.previous,
          paginated: response.paginated,
        },
      })
      return currentState
    } catch (err) {
      // Guard against race conditions and component unmount
      if (!isMounted || requestId !== currentReqId) {
        return currentState
      }

      // If activeCachedData is not yet populated, await any in-flight cache read
      if (!activeCachedData && cacheReadPromise) {
        try {
          const fallbackCached = await cacheReadPromise
          if (fallbackCached && Array.isArray(fallbackCached.entries)) {
            activeCachedData = fallbackCached
          }
        } catch {
          // Ignore cache read error on network failure
        }
      }

      // Offline fallback handling:
      if (activeCachedData && activeCachedData.entries) {
        setState({
          entries: activeCachedData.entries,
          loading: false,
          isRefreshing: false,
          isFromCache: true,
          isStale: Boolean(activeCachedData.isStale),
          error: err,
        })
      } else if (currentState.isFromCache && currentState.entries.length > 0) {
        setState({
          loading: false,
          isRefreshing: false,
          isFromCache: true,
          isStale: true,
          error: err,
        })
      } else {
        // No cache available: expose error state
        setState({
          loading: false,
          isRefreshing: false,
          isFromCache: false,
          error: err,
        })
      }
      return currentState
    }
  }

  function cancel() {
    isMounted = false
    requestId++
  }

  return {
    getState: () => currentState,
    fetch: fetchEntries,
    refresh: (options) => fetchEntries(options, true),
    cancel,
  }
}

/**
 * Hook to retrieve calendar entries matching the specified filter criteria.
 *
 * @param {Object} options
 * @param {string|Date} options.startDate - Start of query window
 * @param {string|Date} options.endDate - End of query window
 * @param {string|number} [options.barangayId] - Barangay PK or 'citywide'
 * @param {string} [options.source] - e.g. 'municipal_event', 'collection_schedule'
 * @param {string} [options.category] - Event or schedule category
 * @param {string} [options.status] - Status filter
 * @param {boolean} [options.includeNotices=false] - Include news & emergency alerts
 * @param {number} [options.page=1] - 1-based page index
 * @param {number} [options.pageSize=20] - Page size (1-50)
 * @param {boolean} [options.paginate=true] - Whether to paginate
 * @param {boolean} [options.autoFetch=true] - Whether to fetch automatically on mount/change
 * @param {Object|null} [options.user] - Optional explicit user context for callers
 */
export function useCalendarEntries(options = {}) {
  const {
    startDate,
    endDate,
    start_date,
    end_date,
    barangayId,
    barangay_id,
    source,
    category,
    status,
    includeNotices,
    include_notices,
    page = 1,
    pageSize = 20,
    page_size,
    paginate = true,
    autoFetch = true,
    user: explicitUser,
    auth: explicitAuth,
  } = options

  // Resolve authentic caller user context
  let authContext = undefined
  let authContextUser = undefined
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const hookAuth = useAuth()
    authContext = hookAuth
  } catch {
    // Outside AuthProvider or unit testing environment
    authContext = undefined
  }

  const currentAuth = explicitAuth !== undefined ? explicitAuth : authContext

  if (currentAuth?.loading) {
    // Fail closed while authentication restoration is in flight
    authContextUser = undefined
  } else if (currentAuth) {
    authContextUser = currentAuth.user ?? null
  } else {
    authContextUser = undefined
  }

  const effectiveUser = explicitUser !== undefined ? explicitUser : authContextUser

  const resolvedStartDate = start_date || startDate
  const resolvedEndDate = end_date || endDate
  const resolvedBarangay = barangay_id ?? barangayId
  const resolvedNotices = include_notices ?? includeNotices ?? false
  const resolvedPageSize = page_size ?? pageSize

  // Memoize stable query key string to prevent infinite loops from inline object options
  const queryKey = useMemo(() => {
    return JSON.stringify({
      start: resolvedStartDate ? String(resolvedStartDate) : null,
      end: resolvedEndDate ? String(resolvedEndDate) : null,
      barangay: resolvedBarangay ?? null,
      source: source || null,
      category: category || null,
      status: status || null,
      includeNotices: Boolean(resolvedNotices),
      page: Number(page) || 1,
      pageSize: Number(resolvedPageSize) || 20,
      paginate: Boolean(paginate),
      userRole: effectiveUser?.role || (effectiveUser === null ? 'anonymous' : 'unverified'),
    })
  }, [
    resolvedStartDate,
    resolvedEndDate,
    resolvedBarangay,
    source,
    category,
    status,
    resolvedNotices,
    page,
    resolvedPageSize,
    paginate,
    effectiveUser,
  ])

  const [state, setState] = useState(() => ({
    entries: [],
    loading: autoFetch && Boolean(resolvedStartDate && resolvedEndDate),
    isRefreshing: false,
    isFromCache: false,
    isStale: false,
    lastUpdated: null,
    error: null,
    pagination: {
      count: 0,
      totalPages: null,
      currentPage: 1,
      pageSize: resolvedPageSize,
      next: null,
      previous: null,
      paginated: Boolean(paginate),
    },
    isCapacityError: false,
    isNetworkError: false,
  }))

  const sessionRef = useRef(null)
  if (!sessionRef.current) {
    sessionRef.current = createCalendarEntriesSession({
      fetcher: getCalendarEntries,
      cacheReader: getCalendarCacheEntry,
      cacheWriter: setCalendarCacheEntry,
      user: effectiveUser,
      getUser: () => effectiveUser,
      auth: currentAuth,
      getAuth: () => currentAuth,
      onStateChange: (updated) => setState({ ...updated }),
    })
  }

  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.cancel()
      }
    }
  }, [])

  useEffect(() => {
    if (!autoFetch) return
    sessionRef.current.fetch({
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      barangayId: resolvedBarangay,
      source,
      category,
      status,
      includeNotices: resolvedNotices,
      page,
      pageSize: resolvedPageSize,
      paginate,
      user: effectiveUser,
      auth: currentAuth,
    }, false)
  }, [
    queryKey,
    autoFetch,
    resolvedStartDate,
    resolvedEndDate,
    resolvedBarangay,
    source,
    category,
    status,
    resolvedNotices,
    page,
    resolvedPageSize,
    paginate,
    effectiveUser,
    currentAuth,
  ])

  const refresh = useCallback(() => {
    return sessionRef.current.refresh({
      startDate: resolvedStartDate,
      endDate: resolvedEndDate,
      barangayId: resolvedBarangay,
      source,
      category,
      status,
      includeNotices: resolvedNotices,
      page,
      pageSize: resolvedPageSize,
      paginate,
      user: effectiveUser,
      auth: currentAuth,
    })
  }, [
    resolvedStartDate,
    resolvedEndDate,
    resolvedBarangay,
    source,
    category,
    status,
    resolvedNotices,
    page,
    resolvedPageSize,
    paginate,
    effectiveUser,
    currentAuth,
  ])

  return {
    entries: state.entries,
    loading: state.loading,
    isRefreshing: state.isRefreshing,
    isFromCache: state.isFromCache,
    isStale: state.isStale,
    lastUpdated: state.lastUpdated,
    error: state.error,
    refresh,
    pagination: state.pagination,
    isCapacityError: state.isCapacityError,
    isNetworkError: state.isNetworkError,
  }
}
