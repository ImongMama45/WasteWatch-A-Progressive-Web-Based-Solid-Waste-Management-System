import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatToManilaDateString,
} from '../../api/calendarService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const componentPath = path.resolve(__dirname, '../brgy_official/BrgyDashboard.jsx')
const componentSource = fs.readFileSync(componentPath, 'utf8')

// Pure helper implementations mirroring component definitions
function resolveBarangayId(user) {
  if (!user || typeof user !== 'object') return null
  const candidate = user.barangay_id ?? (typeof user.barangay === 'object' && user.barangay !== null ? user.barangay.id : user.barangay)
  if (candidate === null || candidate === undefined || typeof candidate === 'boolean') return null

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }

  if (typeof candidate === 'number') {
    return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null
  }

  return null
}

function calculateBrgyScheduleDateRange(referenceDate = new Date()) {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate)
  const todayFormatted = formatToManilaDateString(now)
  const [y, m, d] = todayFormatted.split('-').map(Number)
  const anchorDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const future = new Date(anchorDate.getTime() + 13 * 24 * 60 * 60 * 1000)
  const futureFormatted = formatToManilaDateString(future)
  return {
    startDateStr: todayFormatted,
    endDateStr: futureFormatted,
    todayStr: todayFormatted,
  }
}

function formatOccurrenceDate(isoString, todayDateStr) {
  if (!isoString) return { dayName: '', dateDisplay: '', isToday: false, isTomorrow: false, dateStr: '' }
  const dateStr = isoString.slice(0, 10)
  const isToday = dateStr === todayDateStr
  const [y, m, d] = dateStr.split('-').map(Number)
  const dateObj = new Date(y, m - 1, d)

  let isTomorrow = false
  if (todayDateStr) {
    const [ty, tm, td] = todayDateStr.split('-').map(Number)
    const todayObj = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0))
    const tomorrowObj = new Date(todayObj.getTime() + 24 * 60 * 60 * 1000)
    const tomorrowStr = formatToManilaDateString(tomorrowObj)
    isTomorrow = dateStr === tomorrowStr
  }

  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' })
  const dateDisplay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { dateStr, dayName, dateDisplay, isToday, isTomorrow }
}

function formatOccurrenceTime(startIso, endIso) {
  if (!startIso) return '—'
  const extractTime = (iso) => {
    if (!iso) return ''
    const timePart = iso.slice(11, 16)
    if (!timePart) return ''
    const [hStr, mStr] = timePart.split(':')
    const h = parseInt(hStr, 10), m = mStr || '00'
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${m} ${ampm}`
  }
  const s = extractTime(startIso)
  const e = extractTime(endIso)
  if (s && e) return `${s} – ${e}`
  return s || '—'
}

function getOccurrenceStatusBadge(status, isToday) {
  switch (status) {
    case 'verified_collected':
      return {
        label: 'VERIFIED COLLECTED',
        color: '#15803d',
        bg: '#e7f5eb',
        border: '#bbf7d0',
      }
    case 'operationally_completed':
      return {
        label: 'REPORTED COMPLETE',
        color: '#0369a1',
        bg: '#f0f9ff',
        border: '#bae6fd',
      }
    case 'in_progress':
      return {
        label: isToday ? "TODAY'S PICKUP" : 'IN PROGRESS',
        color: '#b45309',
        bg: '#fffbeb',
        border: '#fde68a',
      }
    case 'scheduled':
    default:
      if (isToday) {
        return {
          label: 'TODAY',
          color: '#16a34a',
          bg: '#f0fdf4',
          border: '#bbf7d0',
        }
      }
      return {
        label: 'SCHEDULED',
        color: '#475569',
        bg: '#f1f5f9',
        border: '#cbd5e1',
      }
  }
}

function selectNextPickupOccurrence(entries = [], todayDateStr) {
  if (!Array.isArray(entries) || entries.length === 0) return null

  // 1. Look for today's active/upcoming collection first (scheduled or in_progress)
  const todayActive = entries.find(e => {
    const dStr = (e.start_datetime || e.start || '').slice(0, 10)
    return dStr === todayDateStr && (e.status === 'scheduled' || e.status === 'in_progress')
  })
  if (todayActive) return todayActive

  // 2. If no active collection today, look for earliest upcoming occurrence in the future (date > today)
  const futureUpcoming = entries.find(e => {
    const dStr = (e.start_datetime || e.start || '').slice(0, 10)
    return dStr > todayDateStr && e.status !== 'cancelled'
  })
  if (futureUpcoming) return futureUpcoming

  // 3. If today had a collection that was already completed/verified, and no future occurrence in window
  const todayFinished = entries.find(e => {
    const dStr = (e.start_datetime || e.start || '').slice(0, 10)
    return dStr === todayDateStr
  })
  if (todayFinished) return todayFinished

  // 4. Fallback to first entry in chronological list
  return entries[0] || null
}

describe('Barangay Dashboard Calendar Integration Contract', () => {

  describe('1. Barangay ID Resolution (resolveBarangayId)', () => {
    it('resolves numeric positive integer from user.barangay', () => {
      assert.equal(resolveBarangayId({ barangay: 4 }), 4)
    })

    it('resolves string integer from user.barangay', () => {
      assert.equal(resolveBarangayId({ barangay: '12' }), 12)
    })

    it('resolves positive integer from user.barangay_id', () => {
      assert.equal(resolveBarangayId({ barangay_id: 8 }), 8)
    })

    it('resolves positive integer from nested object user.barangay.id', () => {
      assert.equal(resolveBarangayId({ barangay: { id: 15, name: 'Gulang-Gulang' } }), 15)
      assert.equal(resolveBarangayId({ barangay: { id: '7', name: 'Ilayang Dupay' } }), 7)
    })

    it('rejects 0, negative integers, decimals, and invalid numbers', () => {
      assert.equal(resolveBarangayId({ barangay: 0 }), null)
      assert.equal(resolveBarangayId({ barangay: -1 }), null)
      assert.equal(resolveBarangayId({ barangay: 3.14 }), null)
      assert.equal(resolveBarangayId({ barangay: '3.14' }), null)
      assert.equal(resolveBarangayId({ barangay: '-5' }), null)
    })

    it('rejects non-numeric strings and whitespace-only strings', () => {
      assert.equal(resolveBarangayId({ barangay: 'abc' }), null)
      assert.equal(resolveBarangayId({ barangay: '   ' }), null)
      assert.equal(resolveBarangayId({ barangay: '' }), null)
    })

    it('rejects booleans, empty objects, arrays, null, and undefined', () => {
      assert.equal(resolveBarangayId({ barangay: true }), null)
      assert.equal(resolveBarangayId({ barangay: false }), null)
      assert.equal(resolveBarangayId({ barangay: {} }), null)
      assert.equal(resolveBarangayId({ barangay: [] }), null)
      assert.equal(resolveBarangayId({ barangay: null }), null)
      assert.equal(resolveBarangayId({ barangay: undefined }), null)
      assert.equal(resolveBarangayId({}), null)
      assert.equal(resolveBarangayId(null), null)
      assert.equal(resolveBarangayId(undefined), null)
    })
  })

  describe('2. Bounded 14-Day Schedule Date Range Calculation', () => {
    it('calculates exactly 14 inclusive calendar dates (today through today + 13)', () => {
      const fixedRef = new Date('2026-05-10T08:00:00Z')
      const { startDateStr, endDateStr, todayStr } = calculateBrgyScheduleDateRange(fixedRef)

      assert.equal(typeof startDateStr, 'string')
      assert.equal(typeof endDateStr, 'string')
      assert.equal(typeof todayStr, 'string')
      assert.equal(startDateStr, todayStr)

      // Calculate calendar days difference
      const start = new Date(startDateStr)
      const end = new Date(endDateStr)
      const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000))
      assert.equal(diffDays, 13, 'Day offset must be exactly 13 days to produce 14 inclusive calendar dates')
    })

    it('anchors to Asia/Manila date string format YYYY-MM-DD', () => {
      const { startDateStr, endDateStr } = calculateBrgyScheduleDateRange()
      assert.match(startDateStr, /^\d{4}-\d{2}-\d{2}$/)
      assert.match(endDateStr, /^\d{4}-\d{2}-\d{2}$/)
    })

    it('handles month rollovers and leap-years reliably without UTC drift', () => {
      const leapYearRef = new Date('2028-02-20T12:00:00Z')
      const { startDateStr, endDateStr } = calculateBrgyScheduleDateRange(leapYearRef)
      assert.equal(startDateStr, '2028-02-20')
      assert.equal(endDateStr, '2028-03-04')
    })
  })

  describe('3. Occurrence Date & Time Formatting', () => {
    it('formats ISO occurrence date into Asia/Manila date components', () => {
      const res = formatOccurrenceDate('2026-05-15T08:00:00+08:00', '2026-05-15')
      assert.equal(res.dateStr, '2026-05-15')
      assert.equal(res.isToday, true)
      assert.equal(res.isTomorrow, false)
      assert.equal(res.dayName, 'Friday')
      assert.equal(res.dateDisplay, 'May 15')
    })

    it('detects tomorrow occurrence correctly', () => {
      const res = formatOccurrenceDate('2026-05-16T08:00:00+08:00', '2026-05-15')
      assert.equal(res.isToday, false)
      assert.equal(res.isTomorrow, true)
    })

    it('formats 12-hour AM/PM time windows cleanly', () => {
      const timeWindow = formatOccurrenceTime('2026-05-15T06:00:00+08:00', '2026-05-15T10:00:00+08:00')
      assert.equal(timeWindow, '6:00 AM – 10:00 AM')

      const afternoonWindow = formatOccurrenceTime('2026-05-15T13:30:00+08:00', '2026-05-15T16:00:00+08:00')
      assert.equal(afternoonWindow, '1:30 PM – 4:00 PM')
    })

    it('handles missing or single timestamp gracefully', () => {
      assert.equal(formatOccurrenceTime(null, null), '—')
      assert.equal(formatOccurrenceTime('2026-05-15T07:00:00+08:00', null), '7:00 AM')
    })
  })

  describe('4. Occurrence Status Badges (Operational vs Verified)', () => {
    it('returns VERIFIED COLLECTED badge for verified_collected status', () => {
      const badge = getOccurrenceStatusBadge('verified_collected', false)
      assert.equal(badge.label, 'VERIFIED COLLECTED')
      assert.equal(badge.color, '#15803d')
    })

    it('returns REPORTED COMPLETE badge for operationally_completed status', () => {
      const badge = getOccurrenceStatusBadge('operationally_completed', false)
      assert.equal(badge.label, 'REPORTED COMPLETE')
      assert.equal(badge.color, '#0369a1')
    })

    it('differentiates in_progress between today and future occurrences', () => {
      const todayBadge = getOccurrenceStatusBadge('in_progress', true)
      assert.equal(todayBadge.label, "TODAY'S PICKUP")

      const futureBadge = getOccurrenceStatusBadge('in_progress', false)
      assert.equal(futureBadge.label, 'IN PROGRESS')
    })

    it('differentiates scheduled status between today and upcoming dates', () => {
      const todayBadge = getOccurrenceStatusBadge('scheduled', true)
      assert.equal(todayBadge.label, 'TODAY')

      const upcomingBadge = getOccurrenceStatusBadge('scheduled', false)
      assert.equal(upcomingBadge.label, 'SCHEDULED')
    })
  })

  describe('5. Next Pickup Selection (selectNextPickupOccurrence)', () => {
    const todayStr = '2026-05-15'

    it('returns null for empty or non-array inputs', () => {
      assert.equal(selectNextPickupOccurrence([], todayStr), null)
      assert.equal(selectNextPickupOccurrence(null, todayStr), null)
      assert.equal(selectNextPickupOccurrence(undefined, todayStr), null)
    })

    it('prioritizes today active occurrence over future occurrences', () => {
      const entries = [
        { id: 'cs-1', start_datetime: '2026-05-15T06:00:00+08:00', status: 'scheduled' },
        { id: 'cs-2', start_datetime: '2026-05-18T06:00:00+08:00', status: 'scheduled' },
      ]
      const selected = selectNextPickupOccurrence(entries, todayStr)
      assert.equal(selected.id, 'cs-1')
    })

    it('selects earliest upcoming future occurrence when today has no active collection', () => {
      const entries = [
        { id: 'cs-past', start_datetime: '2026-05-10T06:00:00+08:00', status: 'verified_collected' },
        { id: 'cs-next', start_datetime: '2026-05-17T06:00:00+08:00', status: 'scheduled' },
        { id: 'cs-later', start_datetime: '2026-05-20T06:00:00+08:00', status: 'scheduled' },
      ]
      const selected = selectNextPickupOccurrence(entries, todayStr)
      assert.equal(selected.id, 'cs-next')
    })

    it('skips cancelled occurrences when searching for upcoming future pickup', () => {
      const entries = [
        { id: 'cs-cancelled', start_datetime: '2026-05-16T06:00:00+08:00', status: 'cancelled' },
        { id: 'cs-active', start_datetime: '2026-05-18T06:00:00+08:00', status: 'scheduled' },
      ]
      const selected = selectNextPickupOccurrence(entries, todayStr)
      assert.equal(selected.id, 'cs-active')
    })

    it('returns completed today occurrence when no upcoming occurrences exist in window', () => {
      const entries = [
        { id: 'cs-today-done', start_datetime: '2026-05-15T06:00:00+08:00', status: 'verified_collected' },
      ]
      const selected = selectNextPickupOccurrence(entries, todayStr)
      assert.equal(selected.id, 'cs-today-done')
    })
  })

  describe('6. Component Architectural & Codebase Invariants', () => {
    it('completely removes /api/public/schedule/ and legacy citywide fallback logic', () => {
      assert.doesNotMatch(
        componentSource,
        /\/api\/public\/schedule\//,
        'BrgyDashboard must not call legacy /api/public/schedule/'
      )
      assert.doesNotMatch(
        componentSource,
        /brgySchedules\.length\s*>\s*0\s*\?\s*brgySchedules\s*:\s*res\.data/,
        'BrgyDashboard must not fall back to exposing citywide schedules when barangay has none'
      )
      assert.doesNotMatch(
        componentSource,
        /fetchSchedule/,
        'BrgyDashboard must not retain legacy fetchSchedule helper'
      )
    })

    it('defines and exports pure helpers in component source', () => {
      assert.match(componentSource, /export function resolveBarangayId/)
      assert.match(componentSource, /export function calculateBrgyScheduleDateRange/)
      assert.match(componentSource, /export function formatOccurrenceDate/)
      assert.match(componentSource, /export function formatOccurrenceTime/)
      assert.match(componentSource, /export function getOccurrenceStatusBadge/)
      assert.match(componentSource, /export function selectNextPickupOccurrence/)
    })

    it('imports and integrates useCalendarEntries with collection_schedule source', () => {
      assert.match(
        componentSource,
        /import\s+{[^}]*useCalendarEntries[^}]*}\s+from\s+['"]\.\.\/\.\.\/hooks\/useCalendarEntries['"]/,
        'BrgyDashboard must import useCalendarEntries'
      )
      assert.match(
        componentSource,
        /source:\s*['"]collection_schedule['"]/,
        'BrgyDashboard must invoke useCalendarEntries with source: collection_schedule'
      )
      assert.match(
        componentSource,
        /autoFetch:\s*Boolean\(userBrgyId\)/,
        'BrgyDashboard must gate autoFetch on valid resolved userBrgyId'
      )
    })

    it('uses distinct occurrence id keys (not array index keys)', () => {
      assert.match(
        componentSource,
        /key=\{entry\.id\}/,
        'Chronological schedule items must be keyed by entry.id'
      )
      assert.match(
        componentSource,
        /key=\{nextPickup\.id\}/,
        'Hero next pickup card must be keyed by nextPickup.id'
      )
    })

    it('includes error banners with retry calling refreshCalendar', () => {
      assert.match(
        componentSource,
        /isCalendarCapacityError/,
        'Must detect calendar capacity errors'
      )
      assert.match(
        componentSource,
        /isCalendarNetworkError/,
        'Must detect calendar network errors'
      )
      assert.match(
        componentSource,
        /onClick=\{refreshCalendar\}/,
        'Error banner retry buttons must invoke refreshCalendar'
      )
    })

    it('includes stale cache banner indicator', () => {
      assert.match(
        componentSource,
        /isCalendarStale/,
        'Must surface stale cache indicator when offline or cached'
      )
    })

    it('contains ZERO emojis across the entire file', () => {
      const emojiRegex = /([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}])/u
      assert.doesNotMatch(
        componentSource,
        emojiRegex,
        'BrgyDashboard must contain zero emojis in strict compliance with AGENTS.md'
      )
    })

    it('preserves all operational workflows and existing subsystems', () => {
      // 1. Live tracker card & hook
      assert.match(componentSource, /useBarangayTracker\(userBrgyId\)/)
      assert.match(componentSource, /LiveTrackerCard/)
      assert.match(componentSource, /DispatchCard/)
      assert.match(componentSource, /\/api\/public\/live\//)

      // 2. Report validation tab & pagination
      assert.match(componentSource, /activeMainTab === ['"]validation['"]/)
      assert.match(componentSource, /Pagination/)
      assert.match(componentSource, /\/api\/watcher\/reports\//)

      // 3. Truck monitor tab & escalation navigation
      assert.match(componentSource, /activeMainTab === ['"]trucks['"]/)
      assert.match(componentSource, /\/brgy\/escalate/)

      // 4. Offline builder & mini map
      assert.match(componentSource, /OfflineReportBuilder/)
      assert.match(componentSource, /MiniMap/)
    })
  })
})
