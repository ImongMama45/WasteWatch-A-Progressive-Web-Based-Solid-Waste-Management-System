import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import api from '../client.js'
import {
  formatToManilaDateString,
  getCalendarEntries,
  CalendarServiceError,
} from '../calendarService.js'

describe('calendarService — API Client Unit Tests', () => {
  let originalGet

  beforeEach(() => {
    originalGet = api.get
  })

  afterEach(() => {
    api.get = originalGet
  })

  describe('formatToManilaDateString', () => {
    it('returns valid YYYY-MM-DD string unchanged', () => {
      assert.equal(formatToManilaDateString('2026-11-10'), '2026-11-10')
      assert.equal(formatToManilaDateString('  2026-12-25  '), '2026-12-25')
    })

    it('formats Date object into YYYY-MM-DD in Asia/Manila time', () => {
      // 2026-11-10T00:00:00Z is 08:00 AM on Nov 10 in Manila (UTC+8)
      const dateUtc = new Date('2026-11-10T00:00:00Z')
      assert.equal(formatToManilaDateString(dateUtc), '2026-11-10')
    })

    it('returns null for empty date input', () => {
      assert.equal(formatToManilaDateString(null), null)
      assert.equal(formatToManilaDateString(undefined), null)
      assert.equal(formatToManilaDateString(''), null)
    })

    it('throws CalendarServiceError on invalid date input', () => {
      assert.throws(
        () => formatToManilaDateString('not-a-date'),
        (err) => err instanceof CalendarServiceError && err.code === 'invalid_date_format'
      )
    })
  })

  describe('getCalendarEntries — Parameter Construction', () => {
    it('requires both start_date and end_date', async () => {
      await assert.rejects(
        () => getCalendarEntries({ startDate: '2026-11-01' }),
        (err) => err instanceof CalendarServiceError && err.code === 'missing_date_range'
      )
      await assert.rejects(
        () => getCalendarEntries({ endDate: '2026-11-07' }),
        (err) => err instanceof CalendarServiceError && err.code === 'missing_date_range'
      )
    })

    it('constructs correct query parameters and calls GET /api/calendar/entries/', async () => {
      let interceptedUrl = null
      let interceptedParams = null

      api.get = async (url, config) => {
        interceptedUrl = url
        interceptedParams = config.params
        return {
          data: {
            count: 1,
            total_pages: 1,
            current_page: 1,
            page_size: 20,
            next: null,
            previous: null,
            results: [{ id: 'event_1', title: 'Clean-up Drive' }],
          },
        }
      }

      const response = await getCalendarEntries({
        startDate: '2026-11-01',
        endDate: '2026-11-07',
        barangayId: 5,
        source: 'municipal_event',
        category: 'cleanup',
        status: 'published',
        includeNotices: true,
        page: 2,
        pageSize: 15,
        paginate: true,
      })

      assert.equal(interceptedUrl, '/api/calendar/entries/')
      assert.deepEqual(interceptedParams, {
        start_date: '2026-11-01',
        end_date: '2026-11-07',
        barangay_id: 5,
        source: 'municipal_event',
        category: 'cleanup',
        status: 'published',
        include_notices: true,
        paginate: true,
        page: 2,
        page_size: 15,
      })
      assert.equal(response.count, 1)
      assert.equal(response.results.length, 1)
      assert.equal(response.currentPage, 1) // from backend response
      assert.equal(response.paginated, true)
    })

    it('handles unpaginated response structure (?paginate=false)', async () => {
      api.get = async () => ({
        data: {
          count: 2,
          paginated: false,
          results: [
            { id: 'event_1', title: 'Event 1' },
            { id: 'event_2', title: 'Event 2' },
          ],
        },
      })

      const response = await getCalendarEntries({
        startDate: '2026-11-01',
        endDate: '2026-11-07',
        paginate: false,
      })

      assert.equal(response.paginated, false)
      assert.equal(response.count, 2)
      assert.equal(response.results.length, 2)
    })
  })

  describe('getCalendarEntries — Error Handling', () => {
    it('handles HTTP 400 validation error', async () => {
      api.get = async () => {
        const error = new Error('Bad Request')
        error.response = {
          status: 400,
          data: {
            date_range: 'Inverted date range: start_date must be on or before end_date.',
            error: 'invalid_date_range',
          },
        }
        throw error
      }

      await assert.rejects(
        () => getCalendarEntries({ startDate: '2026-11-10', endDate: '2026-11-01' }),
        (err) => {
          assert.equal(err instanceof CalendarServiceError, true)
          assert.equal(err.status, 400)
          assert.equal(err.code, 'invalid_date_range')
          assert.match(err.message, /Inverted date range/)
          assert.equal(err.isValidationError, true)
          return true
        }
      )
    })

    it('distinguishes HTTP 503 capacity limit error', async () => {
      api.get = async () => {
        const error = new Error('Service Unavailable')
        error.response = {
          status: 503,
          data: {
            detail: 'Global calendar capacity exceeded limit of 1000 records.',
            error: 'capacity_limit_exceeded',
          },
        }
        throw error
      }

      await assert.rejects(
        () => getCalendarEntries({ startDate: '2026-11-01', endDate: '2026-11-30' }),
        (err) => {
          assert.equal(err instanceof CalendarServiceError, true)
          assert.equal(err.status, 503)
          assert.equal(err.code, 'capacity_limit_exceeded')
          assert.equal(err.isCapacityError, true)
          assert.match(err.message, /Global calendar capacity exceeded/)
          return true
        }
      )
    })

    it('distinguishes network failure (no response from server)', async () => {
      api.get = async () => {
        const networkError = new Error('Network Error')
        networkError.response = undefined // no response object
        throw networkError
      }

      await assert.rejects(
        () => getCalendarEntries({ startDate: '2026-11-01', endDate: '2026-11-07' }),
        (err) => {
          assert.equal(err instanceof CalendarServiceError, true)
          assert.equal(err.status, null)
          assert.equal(err.code, 'network_error')
          assert.equal(err.isNetworkError, true)
          assert.match(err.message, /Unable to connect to the calendar service/)
          return true
        }
      )
    })
  })
})
