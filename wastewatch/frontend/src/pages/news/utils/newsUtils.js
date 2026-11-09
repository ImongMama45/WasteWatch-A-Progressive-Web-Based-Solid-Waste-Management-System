/**
 * pages/news/utils/newsUtils.js
 * ------------------------------
 * Pure utilities for filtering, sorting, scope resolution, cache isolation,
 * and scoped fetch execution for news and announcements.
 * Zero emojis.
 */

import {
  matchesCategory,
  selectFeaturedAnnouncement,
  calculateReadingTime,
  estimateReadingTime,
  getCategoryLabel,
  ANNOUNCEMENT_CATEGORIES,
  CATEGORY_TABS,
} from './newsConfig.js'

export {
  matchesCategory,
  selectFeaturedAnnouncement,
  calculateReadingTime,
  estimateReadingTime,
  getCategoryLabel,
  ANNOUNCEMENT_CATEGORIES,
  CATEGORY_TABS,
}

export const BASE_CACHE_KEY = 'ww_news_items'

/**
 * Normalizes barangay API response shapes:
 * - Plain array: [...]
 * - Paginated response: { results: [...] }
 * Preserves all records without turning paginated responses into empty lists.
 */
export function normalizeBarangayList(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.results)) return data.results
  return []
}

/**
 * Generates a stable scope signature string to prevent unnecessary refetches
 * and dependency churn across component re-renders.
 */
export function createScopeSignature(options) {
  if (typeof options === 'object' && options !== null) {
    const bId =
      options.barangayId !== undefined && options.barangayId !== null && options.barangayId !== ''
        ? String(options.barangayId)
        : ''
    const isCityWide =
      options.cityWide === true || options.cityWide === 'true' || bId === 'city_wide'
    return isCityWide ? 'city_wide' : bId && bId !== 'all' ? `brgy_${bId}` : 'all'
  }
  if (typeof options === 'string' || typeof options === 'number') {
    const s = String(options).trim()
    if (s === 'city_wide') return 'city_wide'
    if (s !== '' && s !== 'all') return `brgy_${s}`
  }
  return 'all'
}

/**
 * Calculates human-readable count breakdown reconciling category total (with hero)
 * and feed count (with hero exclusion when hero card is displayed).
 */
export function calculateFeedCountBreakdown({ totalScopedCount = 0, feedCount = 0, showHero = false }) {
  if (showHero) {
    return {
      text: `${feedCount} in feed · 1 featured above (${totalScopedCount} total)`,
      feedCount,
      featuredCount: 1,
      totalCount: totalScopedCount,
    }
  }
  return {
    text: `${feedCount} ${feedCount === 1 ? 'notice' : 'notices'}`,
    feedCount,
    featuredCount: 0,
    totalCount: feedCount,
  }
}

/**
 * Deterministically resolves the feed presentation state:
 * - INITIAL_LOADING: request in flight and no items loaded yet
 * - READY: valid items ready for display (including background refreshes)
 * - EMPTY: request completed successfully but 0 matching notices
 * - ERROR: request failed with no cached fallback
 * - OFFLINE: offline with no cached data
 */
export function resolveFeedDisplayState({
  items = [],
  filteredCount = 0,
  isLoading = false,
  error = null,
  isOnline = true,
}) {
  const hasLoadedData = (items || []).length > 0

  if (error && !hasLoadedData) {
    return 'ERROR'
  }
  if (!isOnline && !hasLoadedData) {
    return 'OFFLINE'
  }
  if (isLoading && !hasLoadedData) {
    return 'INITIAL_LOADING'
  }
  if (filteredCount === 0) {
    return 'EMPTY'
  }
  return 'READY'
}

/**
 * Resolves the visual accent precedence for announcement cards:
 * Precedence: Emergency > High Priority > Pinned > Standard.
 *
 * 1. Emergency: type === 'emergency' or category in ['Emergency', 'Emergencies']
 * 2. High Priority: priority === 'high'
 * 3. Pinned: is_pinned === true
 * 4. Standard: neutral border
 *
 * Preserves all underlying attributes; returns deterministic styling tokens.
 */
export function resolveCardAccentPrecedence(item = {}) {
  if (!item || typeof item !== 'object') {
    return {
      accent: 'standard',
      borderColor: '#e2e8f0',
      badgeLabel: null,
    }
  }

  const cat = typeof item.category === 'string' ? item.category.trim().toLowerCase() : ''
  const isEmergency =
    item.type === 'emergency' ||
    item.category === 'Emergency' ||
    item.category === 'Emergencies' ||
    cat === 'emergency' ||
    cat === 'emergencies'
  if (isEmergency) {
    return {
      accent: 'emergency',
      borderColor: '#dc2626',
      badgeLabel: 'Emergency',
    }
  }

  if (item.priority === 'high') {
    return {
      accent: 'high_priority',
      borderColor: '#d97706',
      badgeLabel: 'High Priority',
    }
  }

  const isPinned = Boolean(item.is_pinned ?? item.isPinned)
  if (isPinned) {
    return {
      accent: 'pinned',
      borderColor: '#16a34a',
      badgeLabel: 'Pinned',
    }
  }

  return {
    accent: 'standard',
    borderColor: '#e2e8f0',
    badgeLabel: null,
  }
}

/**
 * Normalizes an EmergencyAlert record into an advisory item with an explicit source discriminator.
 */
export function normalizeEmergencyAlert(alert) {
  if (!alert || typeof alert !== 'object') return null
  return {
    source: 'alert',
    id: String(alert.id),
    title: String(alert.title || '').trim(),
    body: String(alert.body || '').trim(),
    date: alert.date || '',
    is_active: alert.is_active !== false,
    urgencyLevel: 'emergency',
  }
}

/**
 * Normalizes an urgent NewsItem record into an advisory item with an explicit source discriminator.
 */
export function normalizeUrgentNewsItem(item) {
  if (!item || typeof item !== 'object') return null
  const cat = typeof item.category === 'string' ? item.category.trim().toLowerCase() : ''
  const isEmergencyCategory =
    cat === 'emergency' ||
    cat === 'emergencies' ||
    item.category === 'Emergency' ||
    item.category === 'Emergencies'
  const isEmergency = item.type === 'emergency' || isEmergencyCategory
  const isHigh = item.priority === 'high'
  const isPinned = Boolean(item.is_pinned ?? item.isPinned)

  const urgencyLevel = isEmergency
    ? 'emergency'
    : isHigh
    ? 'high_priority'
    : isPinned
    ? 'pinned'
    : 'standard'

  return {
    source: 'news',
    id: String(item.id),
    title: String(item.title || '').trim(),
    body: String(item.description || item.body || '').trim(),
    date: item.date || '',
    barangayName:
      item.barangay_name ||
      (typeof item.barangay === 'string' ? item.barangay : null) ||
      (item.barangay && typeof item.barangay === 'object' ? item.barangay.name : null) ||
      'City-Wide',
    category: item.category != null ? item.category : 'Advisories',
    priority: item.priority != null ? item.priority : 'low',
    type: item.type != null ? item.type : 'news',
    isPinned,
    urgencyLevel,
    rawItem: item,
  }
}

/**
 * Resolves visual theme tokens for active advisories:
 * Emergency > High Priority > Pinned > Standard.
 */
export function resolveAdvisoryUrgencyTheme(advisory) {
  if (!advisory || typeof advisory !== 'object') {
    return {
      urgencyLevel: 'standard',
      accentColor: '#64748b',
      bg: '#ffffff',
      border: '#e2e8f0',
      leftBorderColor: '#cbd5e1',
      badgeBg: '#f1f5f9',
      badgeColor: '#475569',
      titleColor: '#0f172a',
      badgeLabel: 'Advisory',
      actionLabel: 'View Notice',
    }
  }

  const cat = typeof advisory.category === 'string' ? advisory.category.trim().toLowerCase() : ''
  const isEmergency =
    advisory.urgencyLevel === 'emergency' ||
    advisory.source === 'alert' ||
    advisory.type === 'emergency' ||
    advisory.category === 'Emergency' ||
    advisory.category === 'Emergencies' ||
    cat === 'emergency' ||
    cat === 'emergencies'

  if (isEmergency) {
    return {
      urgencyLevel: 'emergency',
      accentColor: '#dc2626',
      bg: '#fff1f2',
      border: '#fecdd3',
      leftBorderColor: '#dc2626',
      badgeBg: '#ffe4e6',
      badgeColor: '#be123c',
      titleColor: '#9f1239',
      badgeLabel: advisory.source === 'alert' ? 'Critical Emergency Alert' : 'Emergency Advisory',
      actionLabel: advisory.source === 'alert' ? 'View Directive' : 'View Advisory',
    }
  }

  const isHigh =
    advisory.urgencyLevel === 'high_priority' ||
    advisory.priority === 'high'

  if (isHigh) {
    return {
      urgencyLevel: 'high_priority',
      accentColor: '#d97706',
      bg: '#fffbeb',
      border: '#fde68a',
      leftBorderColor: '#d97706',
      badgeBg: '#fef3c7',
      badgeColor: '#b45309',
      titleColor: '#92400e',
      badgeLabel: 'Urgent Service Notice',
      actionLabel: 'View Advisory',
    }
  }

  const isPinned =
    advisory.urgencyLevel === 'pinned' ||
    Boolean(advisory.isPinned ?? advisory.is_pinned)

  if (isPinned) {
    return {
      urgencyLevel: 'pinned',
      accentColor: '#16a34a',
      bg: '#f0fdf4',
      border: '#bbf7d0',
      leftBorderColor: '#16a34a',
      badgeBg: '#dcfce7',
      badgeColor: '#15803d',
      titleColor: '#166534',
      badgeLabel: 'Pinned Advisory',
      actionLabel: 'View Advisory',
    }
  }

  return {
    urgencyLevel: 'standard',
    accentColor: '#64748b',
    bg: '#ffffff',
    border: '#e2e8f0',
    leftBorderColor: '#cbd5e1',
    badgeBg: '#f1f5f9',
    badgeColor: '#475569',
    titleColor: '#0f172a',
    badgeLabel: 'Notice',
    actionLabel: 'View Notice',
  }
}

/**
 * Normalizes scope options into DRF query parameters and a scope key.
 */
export function resolveScopeParams(options) {
  if (typeof options === 'object' && options !== null) {
    const { barangayId, cityWide } = options
    if (cityWide === true || cityWide === 'true' || barangayId === 'city_wide') {
      return { params: { city_wide: 'true' }, scopeKey: 'city_wide' }
    }
    if (
      barangayId !== undefined &&
      barangayId !== null &&
      barangayId !== '' &&
      barangayId !== 'all'
    ) {
      return { params: { barangay_id: String(barangayId) }, scopeKey: `brgy_${barangayId}` }
    }
    return { params: {}, scopeKey: 'all' }
  }

  if (typeof options === 'string' || typeof options === 'number') {
    const s = String(options).trim()
    if (s === 'city_wide') {
      return { params: { city_wide: 'true' }, scopeKey: 'city_wide' }
    }
    if (s !== '' && s !== 'all') {
      return { params: { barangay_id: s }, scopeKey: `brgy_${s}` }
    }
  }

  return { params: {}, scopeKey: 'all' }
}

export function getScopeCacheKey(scopeKey) {
  return `${BASE_CACHE_KEY}_${scopeKey}`
}

/**
 * Reads cached items strictly for the requested scopeKey.
 * Prevents data leakage between different barangay scopes.
 */
export function readScopeCache(scopeKey, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return []
  const cacheKey = getScopeCacheKey(scopeKey)
  try {
    const raw =
      storage.getItem(cacheKey) ||
      (scopeKey === 'all' ? storage.getItem(BASE_CACHE_KEY) : null)
    if (raw) {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : (parsed?.results || [])
    }
  } catch {
    // Storage read / parse error handled safely
  }
  return []
}

/**
 * Writes cached items strictly for the requested scopeKey.
 */
export function writeScopeCache(scopeKey, data, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return
  const cacheKey = getScopeCacheKey(scopeKey)
  try {
    storage.setItem(cacheKey, JSON.stringify(data))
    if (scopeKey === 'all') {
      storage.setItem(BASE_CACHE_KEY, JSON.stringify(data))
    }
  } catch {
    // Storage quota exceeded or disabled
  }
}

/**
 * Pure async fetch-and-commit execution logic for news items.
 * Normalizes array and paginated payloads, isolates errors, respects request validity,
 * and handles cancellation safely.
 *
 * @param {Object} options
 * @param {Function|Object} options.apiClient - Function (url, cfg) => Promise or object with .get()
 * @param {Object} [options.params] - URL query parameters
 * @param {AbortSignal} [options.signal] - AbortSignal
 * @param {Function} [options.isValidRequest] - () => boolean: returns false if superseded or aborted
 * @param {Function} [options.onCommit] - (items: Array) => void: callback to commit validated normalized items
 * @param {Function} [options.onError] - (err: Error) => void: callback on genuine fetch failure
 * @param {Function} [options.isCancel] - (err: Error) => boolean: predicate for aborted requests
 * @returns {Promise<{ committed: boolean, items?: Array, error?: any, canceled?: boolean, stale?: boolean }>}
 */
export async function executeScopedFetch({
  apiClient,
  params = {},
  signal,
  isValidRequest = () => true,
  onCommit,
  onError,
  isCancel = err => err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED',
}) {
  try {
    const res = typeof apiClient === 'function'
      ? await apiClient('/api/news/items/', { params, signal })
      : await apiClient.get('/api/news/items/', { params, signal })

    // Stale check after await: discard if superseded
    if (!isValidRequest()) {
      return { committed: false, stale: true }
    }

    if (res && res.data !== undefined) {
      const raw = res.data
      const normalized = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.results)
        ? raw.results
        : []

      onCommit?.(normalized)
      return { committed: true, items: normalized }
    }

    return { committed: false }
  } catch (err) {
    // Check if cancelled
    if (signal?.aborted || isCancel(err)) {
      return { committed: false, canceled: true }
    }

    // Stale error check
    if (!isValidRequest()) {
      return { committed: false, stale: true, error: err }
    }

    onError?.(err)
    return { committed: false, error: err }
  }
}

/**
 * Filter news items by category and search query.
 * Category matching uses item.category exclusively (never item.type).
 */
export function filterNews(items = [], category = 'All', search = '') {
  const q = (search || '').toLowerCase().trim()

  return (items || []).filter(item => {
    if (!item) return false

    // Category match uses item.category exclusively via matchesCategory
    if (!matchesCategory(item.category, category)) {
      return false
    }

    if (!q) return true

    // Safe search match (title, description/body, barangay, valid category)
    const title = (item.title || '').toLowerCase()
    const desc = (item.description || item.body || '').toLowerCase()
    const brgy = (
      item.barangay_name ||
      (typeof item.barangay === 'string' ? item.barangay : '') ||
      (item.barangay && typeof item.barangay === 'object' ? item.barangay.name || '' : '')
    ).toLowerCase()

    // Correction 5: Only search category if item actually has a non-empty, valid category string.
    // Missing, null, or undefined category must never default to "All Notices" for search matching.
    let categoryMatch = false
    if (item.category && typeof item.category === 'string' && item.category.trim() !== '') {
      const rawCat = item.category.trim().toLowerCase()
      const label = getCategoryLabel(item.category)
      const validLabel = label && label.toLowerCase() !== 'all notices' ? label.toLowerCase() : ''
      categoryMatch = rawCat.includes(q) || (validLabel ? validLabel.includes(q) : false)
    }

    return (
      title.includes(q) ||
      desc.includes(q) ||
      brgy.includes(q) ||
      categoryMatch
    )
  })
}

/**
 * Sort news items for standard feed display:
 * 1. Emergency type first
 * 2. High priority next
 * 3. Pinned items
 * 4. Date descending
 */
export function sortNews(items = []) {
  return [...(items || [])].sort((a, b) => {
    // 1. Emergency type first
    const aEmergency = a.type === 'emergency' ? 1 : 0
    const bEmergency = b.type === 'emergency' ? 1 : 0
    if (aEmergency !== bEmergency) return bEmergency - aEmergency

    // 2. High priority next
    const aHigh = a.priority === 'high' ? 1 : 0
    const bHigh = b.priority === 'high' ? 1 : 0
    if (aHigh !== bHigh) return bHigh - aHigh

    // 3. Pinned
    const aPinned = Boolean(a.is_pinned ?? a.isPinned) ? 1 : 0
    const bPinned = Boolean(b.is_pinned ?? b.isPinned) ? 1 : 0
    if (aPinned !== bPinned) return bPinned - aPinned

    // 4. Date descending
    const dateA = a.date ? new Date(a.date).getTime() : 0
    const dateB = b.date ? new Date(b.date).getTime() : 0
    const validA = Number.isFinite(dateA) ? dateA : 0
    const validB = Number.isFinite(dateB) ? dateB : 0
    if (validB !== validA) return validB - validA

    const idA = Number(a.id) || 0
    const idB = Number(b.id) || 0
    return idB - idA
  })
}

/**
 * Builds a clean canonical article share permalink.
 * Retains exact deployment origin and pathname (supporting custom deployment sub-paths).
 * Encodes strictly '?article=<id>', discarding temporary discovery filters and alert conflicts.
 */
export function buildArticleShareUrl(articleId, currentPath = null, currentOrigin = null) {
  if (!articleId) return ''
  const origin = currentOrigin || (typeof window !== 'undefined' ? window.location.origin : '')
  const pathname = currentPath || (typeof window !== 'undefined' ? window.location.pathname : '/announcements')

  const base = origin || 'http://localhost'
  const url = new URL(pathname, base)
  url.search = `?article=${encodeURIComponent(String(articleId))}`
  return url.toString()
}
