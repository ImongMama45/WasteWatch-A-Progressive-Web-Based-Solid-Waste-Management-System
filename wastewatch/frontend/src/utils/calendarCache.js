/**
 * src/utils/calendarCache.js
 * ---------------------------
 * Persistent client-side read-cache for WasteWatch Public Calendar responses.
 * Backed by IndexedDB store 'calendar_entries_cache' in wastewatch_db (v8).
 *
 * Implements:
 *  - Deterministic parameter normalization and scope-isolated cache key generation.
 *  - Configurable Time-To-Live (default 15 minutes) with stale-while-revalidate fallback.
 *  - Fail-closed security boundary: positively established public-only visibility required.
 *  - Deep payload inspection: rejects any administrative drafts, archived, or inactive entries.
 *  - Non-destructive operation (preserves all existing v7 offline queue stores).
 *
 * STRICT ICONOGRAPHY: ZERO emojis; SVG icons only.
 */

import { openDB, CALENDAR_CACHE_STORE } from './idbSchema.js'
import { formatToManilaDateString } from '../api/calendarService.js'

export const DEFAULT_CALENDAR_TTL_MS = 15 * 60 * 1000 // 15 minutes default TTL

export const ALLOWED_PUBLIC_EVENT_STATUSES = new Set(['published', 'cancelled', 'completed'])

/**
 * Normalizes query parameters into a consistent schema for cache key generation and storage.
 * Handles snake_case vs camelCase and string vs boolean representations.
 *
 * @param {Object} params
 * @returns {Object} Normalized parameters
 */
export function normalizeCalendarParams(params = {}) {
  const rawStart = params.start_date || params.startDate
  const rawEnd = params.end_date || params.endDate

  let startDate = null
  let endDate = null

  try {
    startDate = formatToManilaDateString(rawStart)
    endDate = formatToManilaDateString(rawEnd)
  } catch {
    startDate = rawStart ? String(rawStart).trim() : null
    endDate = rawEnd ? String(rawEnd).trim() : null
  }

  const rawBarangay = params.barangay_id !== undefined ? params.barangay_id : params.barangayId
  let barangayId = null
  let scope = 'citywide'

  if (rawBarangay !== undefined && rawBarangay !== null && rawBarangay !== '') {
    const bStr = String(rawBarangay).trim().toLowerCase()
    if (bStr !== 'citywide' && bStr !== 'null') {
      const parsedNum = Number(bStr)
      if (!Number.isNaN(parsedNum)) {
        barangayId = parsedNum
        scope = 'barangay'
      } else {
        barangayId = bStr
        scope = 'barangay'
      }
    }
  }

  const rawSource = params.source ? String(params.source).trim().toLowerCase() : 'all'
  const source = rawSource === '' ? 'all' : rawSource

  const rawCategory = params.category ? String(params.category).trim().toLowerCase() : null
  const category = (rawCategory && rawCategory !== 'all') ? rawCategory : null

  const rawStatus = params.status ? String(params.status).trim().toLowerCase() : null
  const status = (rawStatus && rawStatus !== 'all') ? rawStatus : null

  const rawNotices = params.include_notices !== undefined ? params.include_notices : params.includeNotices
  const includeNotices = Boolean(
    rawNotices === true || rawNotices === 'true' || rawNotices === 1 || rawNotices === '1'
  )

  const rawPaginate = params.paginate
  const paginate = (rawPaginate === undefined || rawPaginate === null)
    ? true
    : Boolean(rawPaginate === true || rawPaginate === 'true' || rawPaginate === 1 || rawPaginate === '1')

  const rawPage = params.page != null ? Number(params.page) : null
  const page = (rawPage && !Number.isNaN(rawPage) && rawPage > 0) ? rawPage : (paginate ? 1 : null)

  const rawPageSize = params.page_size != null ? Number(params.page_size) : (params.pageSize != null ? Number(params.pageSize) : null)
  const pageSize = (rawPageSize && !Number.isNaN(rawPageSize) && rawPageSize > 0) ? rawPageSize : (paginate ? 20 : null)

  return {
    startDate,
    endDate,
    barangayId,
    scope,
    source,
    category,
    status,
    includeNotices,
    paginate,
    page,
    pageSize,
  }
}

/**
 * Builds a deterministic, collision-free cache key accounting for all response-affecting query parameters.
 *
 * @param {Object} params
 * @returns {string} Cache key
 */
export function buildCalendarCacheKey(params = {}) {
  const norm = normalizeCalendarParams(params)

  const startPart = norm.startDate || 'none'
  const endPart = norm.endDate || 'none'
  const brgyPart = norm.scope === 'barangay' ? String(norm.barangayId) : 'citywide'
  const srcPart = norm.source || 'all'
  const catPart = norm.category || 'none'
  const stPart = norm.status || 'none'
  const noticePart = norm.includeNotices ? '1' : '0'
  const pagPart = norm.paginate ? '1' : '0'
  const pagePart = norm.page != null ? String(norm.page) : 'none'
  const sizePart = norm.pageSize != null ? String(norm.pageSize) : 'none'

  return `cal:s=${startPart}:e=${endPart}:b=${brgyPart}:src=${srcPart}:c=${catPart}:st=${stPart}:n=${noticePart}:p=${pagPart}:${pagePart}:${sizePart}`
}

/**
 * Validates whether query parameters request public-safe criteria.
 * Rejects explicit queries for 'draft' or 'archived' lifecycle states.
 *
 * @param {Object} normalized
 * @returns {boolean} True if query parameters are public-safe
 */
export function isCacheablePublicQuery(normalized) {
  if (normalized.status) {
    const st = String(normalized.status).trim().toLowerCase()
    if (st === 'draft' || st === 'archived') {
      return false
    }
  }
  return true
}

export const CANONICAL_PUBLIC_ROLES = new Set([
  'citizen',
  'watcher',
  'driver',
  'dumpsite',
  'brgy_official',
])

/**
 * Verifies that the caller's authorization context positively establishes public-only visibility.
 * Rejects administrator sessions and unverified/unknown visibility contexts (fail-closed).
 *
 * @param {Object} options
 * @returns {{ isPublic: boolean, reason?: string }}
 */
export function verifyPublicVisibilityContext(options = {}) {
  // If caller explicitly passes a user object, inspect role
  if (options.user !== undefined) {
    if (options.user === null) {
      // Unauthenticated / Anonymous visitor is strictly public
      return { isPublic: true }
    }
    if (typeof options.user === 'object' && options.user !== null) {
      // Fail closed if caller is an auth session object that is still loading
      if (options.user.loading === true) {
        return { isPublic: false, reason: 'unresolved_auth_session' }
      }

      const role = String(options.user.role || '').toLowerCase()
      const isStaff = Boolean(options.user.is_staff)
      if (role === 'admin' || isStaff) {
        return { isPublic: false, reason: 'caller_is_admin' }
      }
      if (CANONICAL_PUBLIC_ROLES.has(role)) {
        return { isPublic: true }
      }
      return { isPublic: false, reason: 'unknown_caller_role' }
    }
    return { isPublic: false, reason: 'invalid_user_context' }
  }

  // If explicitly declared by caller as public
  if (options.visibility === 'public' || options.isPublicCaller === true) {
    return { isPublic: true }
  }

  // Fail closed if caller identity or visibility context was not positively established
  return { isPublic: false, reason: 'unverified_visibility_context' }
}

/**
 * Performs deep inspection of response entries to guarantee zero privileged records enter the cache.
 * Even if caller claims public context, any presence of draft, archived, inactive, or cancelled
 * records halts the cache write.
 *
 * @param {Array} entries
 * @returns {{ isPublicOnly: boolean, reason?: string }}
 */
export function verifyEntriesContainOnlyPublicData(entries = []) {
  if (!Array.isArray(entries)) {
    return { isPublicOnly: false, reason: 'invalid_entries_format' }
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      return { isPublicOnly: false, reason: 'invalid_entry_record' }
    }

    const source = entry.source || entry.entry_type

    // 1. MunicipalEvent status verification
    if (source === 'municipal_event') {
      const st = String(entry.status || '').toLowerCase()
      if (st === 'draft' || st === 'archived') {
        return { isPublicOnly: false, reason: `privileged_status_${st}` }
      }
      if (st && !ALLOWED_PUBLIC_EVENT_STATUSES.has(st)) {
        return { isPublicOnly: false, reason: `unauthorized_status_${st}` }
      }
    }

    // 2. NewsItem draft verification
    if (source === 'news_item') {
      if (entry.metadata?.is_published === false) {
        return { isPublicOnly: false, reason: 'unpublished_news_item' }
      }
    }

    // 3. EmergencyAlert inactive/archived verification
    if (source === 'emergency_alert') {
      if (entry.metadata?.is_active === false) {
        return { isPublicOnly: false, reason: 'inactive_emergency_alert' }
      }
    }

    // 4. CollectionSchedule cancelled verification
    if (source === 'collection_schedule') {
      if (entry.status === 'CANCELLED' || entry.metadata?.schedule_lifecycle === 'CANCELLED') {
        return { isPublicOnly: false, reason: 'cancelled_collection_schedule' }
      }
    }
  }

  return { isPublicOnly: true }
}

/**
 * Helper to run a transaction against CALENDAR_CACHE_STORE safely.
 */
async function withCacheStore(mode, callback) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(CALENDAR_CACHE_STORE, mode)
      const store = tx.objectStore(CALENDAR_CACHE_STORE)

      let result
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error || new Error('Calendar cache transaction failed'))
      tx.onabort = () => reject(tx.error || new Error('Calendar cache transaction aborted'))

      result = callback(store, tx)
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Retrieves a cached calendar response for the given query parameters.
 *
 * @param {Object} params - Query parameters matching the request
 * @param {Object} [options]
 * @param {number} [options.now] - Override current timestamp for testing
 * @returns {Promise<{ entry: Object, entries: Array, count: number, isFresh: boolean, isStale: boolean, cachedAt: number, expiresAt: number } | null>}
 */
export async function getCalendarCacheEntry(params = {}, options = {}) {
  const cacheKey = buildCalendarCacheKey(params)
  const now = options.now || Date.now()

  try {
    const record = await withCacheStore('readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(cacheKey)
        req.onsuccess = () => resolve(req.result || null)
        req.onerror = () => reject(req.error)
      })
    })

    if (!record) {
      return null
    }

    const isFresh = now <= record.expiresAt
    const isStale = !isFresh

    return {
      entry: record,
      entries: Array.isArray(record.entries) ? record.entries : [],
      count: record.count ?? (record.entries ? record.entries.length : 0),
      isFresh,
      isStale,
      cachedAt: record.cachedAt,
      expiresAt: record.expiresAt,
    }
  } catch (err) {
    console.warn('[CalendarCache] Failed to read from cache:', err)
    return null
  }
}

/**
 * Stores a normalized calendar response in the persistent cache.
 * Strictly enforces a fail-closed boundary:
 *  1. Query parameter validation.
 *  2. Caller authorization context validation (rejects admin / unverified contexts).
 *  3. Deep entry payload inspection (rejects drafts, archived, or unpublished records).
 * If any check fails, the write is completely skipped and no existing cache records are modified.
 *
 * @param {Object} params - Query parameters
 * @param {Array} entries - Normalized calendar entries
 * @param {Object} [metadata={}] - Additional response metadata (count, pagination, etc.)
 * @param {Object} [options={}] - Options (visibility, user, isPublicCaller, ttlMs, now)
 * @returns {Promise<Object|null>} Stored record or null if not cacheable
 */
export async function setCalendarCacheEntry(params = {}, entries = [], metadata = {}, options = {}) {
  const normalized = normalizeCalendarParams(params)

  // 1. Check query parameter public eligibility
  if (!isCacheablePublicQuery(normalized)) {
    console.warn('[CalendarCache] Refusing to cache: Query requests privileged lifecycle status.')
    return null
  }

  // 2. Check caller authorization context (fail-closed)
  const authCheck = verifyPublicVisibilityContext(options)
  if (!authCheck.isPublic) {
    console.warn(`[CalendarCache] Refusing to cache: Visibility not positively established as public (${authCheck.reason}).`)
    return null
  }

  // 3. Deep entry payload inspection (defense-in-depth)
  const payloadCheck = verifyEntriesContainOnlyPublicData(entries)
  if (!payloadCheck.isPublicOnly) {
    console.warn(`[CalendarCache] Refusing to cache: Response contains privileged or non-public data (${payloadCheck.reason}).`)
    return null
  }

  const cacheKey = buildCalendarCacheKey(params)
  const now = options.now || Date.now()
  const ttlMs = options.ttlMs || DEFAULT_CALENDAR_TTL_MS
  const expiresAt = now + ttlMs

  const record = {
    cacheKey,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    barangayId: normalized.barangayId,
    scope: normalized.scope,
    source: normalized.source,
    category: normalized.category,
    status: normalized.status,
    includeNotices: normalized.includeNotices,
    paginate: normalized.paginate,
    page: normalized.page,
    pageSize: normalized.pageSize,

    entries: Array.isArray(entries) ? entries : [],
    count: Array.isArray(entries) ? entries.length : (metadata.count || 0),
    metadata: { ...metadata },

    cachedAt: now,
    expiresAt,
    schemaVersion: 1,
  }

  try {
    await withCacheStore('readwrite', (store) => {
      store.put(record)
    })
    return record
  } catch (err) {
    console.warn('[CalendarCache] Failed to write entry to cache:', err)
    throw err
  }
}

/**
 * Removes a specific cached entry by query parameters.
 *
 * @param {Object} params
 * @returns {Promise<boolean>}
 */
export async function deleteCalendarCacheEntry(params = {}) {
  const cacheKey = buildCalendarCacheKey(params)

  try {
    await withCacheStore('readwrite', (store) => {
      store.delete(cacheKey)
    })
    return true
  } catch (err) {
    console.warn('[CalendarCache] Failed to delete cache entry:', err)
    return false
  }
}

/**
 * Prunes expired calendar cache entries beyond a specified retention threshold.
 *
 * @param {Object} [options={}]
 * @param {number} [options.maxAgeMs=0] - Additional grace period past expiresAt before deletion
 * @param {number} [options.now] - Current timestamp override
 * @returns {Promise<{ prunedCount: number }>}
 */
export async function pruneExpiredCalendarCache(options = {}) {
  const now = options.now || Date.now()
  const maxAgeMs = options.maxAgeMs || 0
  const cutoff = now - maxAgeMs

  try {
    const prunedCount = await withCacheStore('readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll()
        req.onsuccess = () => {
          const records = req.result || []
          let count = 0
          records.forEach((record) => {
            if (record.expiresAt && record.expiresAt < cutoff) {
              store.delete(record.cacheKey)
              count++
            }
          })
          resolve(count)
        }
        req.onerror = () => reject(req.error)
      })
    })

    return { prunedCount }
  } catch (err) {
    console.warn('[CalendarCache] Prune operation failed:', err)
    return { prunedCount: 0 }
  }
}

/**
 * Clears all records from the calendar cache store without touching any other stores.
 *
 * @returns {Promise<boolean>}
 */
export async function clearCalendarCache() {
  try {
    await withCacheStore('readwrite', (store) => {
      store.clear()
    })
    return true
  } catch (err) {
    console.warn('[CalendarCache] Clear operation failed:', err)
    return false
  }
}
