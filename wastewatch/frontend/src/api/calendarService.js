/**
 * src/api/calendarService.js
 * ---------------------------
 * Shared client service for WasteWatch Calendar API.
 * Endpoint: GET /api/calendar/entries/
 *
 * Implements strict ISO/Asia:Manila date normalization,
 * query parameter validation, typed error mapping, and pagination handling.
 *
 * STRICT ICONOGRAPHY: No emojis.
 */

import api from './client.js'

export const MANILA_TIMEZONE = 'Asia/Manila'

/**
 * Custom error class wrapping Calendar API failures with explicit error codes.
 */
export class CalendarServiceError extends Error {
  constructor(message, { status = null, code = 'unknown_error', details = null, originalError = null } = {}) {
    super(message)
    this.name = 'CalendarServiceError'
    this.status = status
    this.code = code
    this.details = details
    this.originalError = originalError
    this.isCapacityError = (status === 503 || code === 'capacity_limit_exceeded')
    this.isNetworkError = (code === 'network_error')
    this.isValidationError = (status === 400 || code === 'validation_error' || code === 'invalid_date_range')
  }
}

/**
 * Formats a Date object or ISO string to 'YYYY-MM-DD' anchored to Asia/Manila.
 * Accepts existing 'YYYY-MM-DD' strings directly.
 *
 * @param {Date|string} dateInput
 * @returns {string} Formatted 'YYYY-MM-DD' date string
 */
export function formatToManilaDateString(dateInput) {
  if (!dateInput) return null

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed
    }
  }

  const dateObj = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
    throw new CalendarServiceError(
      `Invalid date input provided to calendar service: ${dateInput}`,
      { code: 'invalid_date_format', status: 400 }
    )
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(dateObj)
}

/**
 * Retrieves calendar entries from GET /api/calendar/entries/.
 *
 * @param {Object} options
 * @param {string|Date} options.startDate - Start of query window (inclusive)
 * @param {string|Date} options.endDate - End of query window (inclusive)
 * @param {string|number} [options.barangayId] - Barangay PK or 'citywide'
 * @param {string} [options.source] - 'municipal_event' | 'collection_schedule' | 'news_item' | 'emergency_alert' | 'all'
 * @param {string} [options.category] - Source-specific category filter
 * @param {string} [options.status] - Status filter (e.g. 'published', 'scheduled')
 * @param {boolean} [options.includeNotices=false] - Whether to include announcements & emergency alerts
 * @param {number} [options.page=1] - 1-based page index (if paginated)
 * @param {number} [options.pageSize=20] - Page size between 1 and 50
 * @param {boolean} [options.paginate=true] - Set false for unpaginated responses (max 31 days)
 * @returns {Promise<{ results: Array, count: number, totalPages: number|null, currentPage: number|null, pageSize: number|null, next: string|null, previous: string|null, paginated: boolean }>}
 */
export async function getCalendarEntries(options = {}) {
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
    page,
    pageSize,
    page_size,
    paginate,
  } = options

  const resolvedStartDate = start_date || startDate
  const resolvedEndDate = end_date || endDate

  if (!resolvedStartDate || !resolvedEndDate) {
    throw new CalendarServiceError(
      'Both start_date and end_date are required to query calendar entries.',
      { code: 'missing_date_range', status: 400 }
    )
  }

  const formattedStart = formatToManilaDateString(resolvedStartDate)
  const formattedEnd = formatToManilaDateString(resolvedEndDate)

  const params = {
    start_date: formattedStart,
    end_date: formattedEnd,
  }

  const resolvedBarangay = barangay_id ?? barangayId
  if (resolvedBarangay !== undefined && resolvedBarangay !== null && resolvedBarangay !== '') {
    params.barangay_id = resolvedBarangay
  }

  if (source && source !== 'all') {
    params.source = source
  }

  if (category && category !== 'all') {
    params.category = category
  }

  if (status && status !== 'all') {
    params.status = status
  }

  const resolvedNotices = include_notices ?? includeNotices
  if (resolvedNotices !== undefined && resolvedNotices !== null) {
    params.include_notices = Boolean(resolvedNotices)
  }

  const resolvedPaginate = paginate
  if (resolvedPaginate !== undefined && resolvedPaginate !== null) {
    params.paginate = Boolean(resolvedPaginate)
  }

  if (page != null) {
    params.page = Number(page)
  }

  const resolvedPageSize = page_size ?? pageSize
  if (resolvedPageSize != null) {
    params.page_size = Number(resolvedPageSize)
  }

  try {
    const response = await api.get('/api/calendar/entries/', { params })
    const data = response.data || {}

    const isPaginated = data.paginated !== false && !Array.isArray(data) && (data.results !== undefined)
    const rawResults = Array.isArray(data)
      ? data
      : Array.isArray(data.results)
      ? data.results
      : []

    return {
      results: rawResults,
      count: data.count ?? rawResults.length,
      totalPages: data.total_pages ?? (isPaginated ? 1 : null),
      currentPage: data.current_page ?? (isPaginated ? (params.page || 1) : null),
      pageSize: data.page_size ?? (isPaginated ? (params.page_size || 20) : rawResults.length),
      next: data.next ?? null,
      previous: data.previous ?? null,
      paginated: isPaginated,
    }
  } catch (err) {
    if (err.response) {
      const respStatus = err.response.status
      const respData = err.response.data || {}

      if (respStatus === 503 || respData.error === 'capacity_limit_exceeded') {
        throw new CalendarServiceError(
          respData.detail || 'The municipal calendar service is temporarily busy due to high query volume. Please try again shortly.',
          {
            status: 503,
            code: 'capacity_limit_exceeded',
            details: respData,
            originalError: err,
          }
        )
      }

      if (respStatus === 400) {
        const errorDetail = typeof respData === 'string'
          ? respData
          : respData.detail || respData.date_range || respData.paginate || Object.values(respData)[0] || 'Invalid calendar request parameters.'
        throw new CalendarServiceError(
          String(errorDetail),
          {
            status: 400,
            code: respData.error || 'validation_error',
            details: respData,
            originalError: err,
          }
        )
      }

      throw new CalendarServiceError(
        respData.detail || `Server returned error (${respStatus}) while retrieving calendar entries.`,
        {
          status: respStatus,
          code: respData.error || 'server_error',
          details: respData,
          originalError: err,
        }
      )
    }

    // Network failure (no response from server)
    throw new CalendarServiceError(
      'Unable to connect to the calendar service. Please check your internet connection.',
      {
        status: null,
        code: 'network_error',
        details: null,
        originalError: err,
      }
    )
  }
}
