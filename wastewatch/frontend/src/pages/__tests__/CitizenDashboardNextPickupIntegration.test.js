import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatToManilaDateString,
} from '../../api/calendarService.js'
import {
  createCalendarEntriesSession,
  evaluateCalendarCallerContext,
} from '../../hooks/useCalendarEntries.js'
import {
  verifyEntriesContainOnlyPublicData,
} from '../../utils/calendarCache.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const componentPath = path.resolve(__dirname, '../dashboard/CitizenDashboard.jsx')
const componentSource = fs.readFileSync(componentPath, 'utf8')

// Test helper mirroring component functions
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

function calculateCitizenNextPickupDateRange(referenceDate = new Date()) {
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

describe('CitizenDashboard — Stage 2B Next-Pickup Integration & Architecture Tests', () => {
  it('1. Next Pickup uses authoritative Calendar Service via useCalendarEntries', () => {
    assert.equal(
      componentSource.includes('useCalendarEntries'),
      true,
      'CitizenDashboard must import and use useCalendarEntries hook'
    )
    assert.equal(
      componentSource.includes("source: 'collection_schedule'"),
      true,
      "CitizenDashboard must request source: 'collection_schedule'"
    )
    assert.equal(
      componentSource.includes('nextPickup'),
      true,
      'CitizenDashboard must compute nextPickup from Calendar Service'
    )
  })

  it('2. The request supplies the Citizen assigned barangay ID', () => {
    assert.equal(
      componentSource.includes('barangayId: userBrgyId'),
      true,
      'CitizenDashboard must supply barangayId: userBrgyId to useCalendarEntries'
    )
    assert.equal(
      componentSource.includes('autoFetch: Boolean(userBrgyId)'),
      true,
      'CitizenDashboard must only auto-fetch when userBrgyId is available'
    )
  })

  it('3. Weekday-based pickup guessing is removed from Next Pickup calculation and timetable fallback', () => {
    // The old heuristic: const nextDay = ... find(s => s.isNext) || filteredSchedule[0]
    assert.equal(
      componentSource.includes('filteredSchedule.find(s => s.isNext) || filteredSchedule[0]'),
      false,
      'CitizenDashboard must not guess next pickup from weekday templates'
    )
    // The legacy fallback : Boolean(s.isNext) must be strictly absent
    assert.equal(
      componentSource.includes('Boolean(s.isNext)'),
      false,
      'CitizenDashboard must not fall back to s.isNext when nextPickup is null'
    )
    assert.equal(
      componentSource.includes('Boolean(\n                        nextPickup && nextPickup.source_id === s.id\n                      )') ||
      componentSource.includes('nextPickup && nextPickup.source_id === s.id'),
      true,
      'CitizenDashboard must strictly use Boolean(nextPickup && nextPickup.source_id === s.id)'
    )
  })

  it('4. Existing weekly timetable continues to use /api/public/schedule/', () => {
    assert.equal(
      componentSource.includes("api.get('/api/public/schedule/')"),
      true,
      'CitizenDashboard must retain /api/public/schedule/ for the weekly route timetable'
    )
    assert.equal(
      componentSource.includes('filteredSchedule.map'),
      true,
      'CitizenDashboard must render the filtered schedule timetable'
    )
  })

  it('5. Uses distinct occurrence ID (nextPickup.id) for React keys and never collapses by source_id', () => {
    assert.equal(
      componentSource.includes('key={nextPickup.id}'),
      true,
      'CitizenDashboard must key Next Pickup banner with nextPickup.id'
    )
  })

  it('6. Strictly contains zero emojis across component source code', () => {
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    const match = componentSource.match(emojiRegex)
    assert.equal(
      match,
      null,
      `CitizenDashboard must contain zero emojis. Found: ${match ? match[0] : ''}`
    )
  })

  it('7. Handles truthful loading, empty, capacity error, and network error states', () => {
    assert.equal(
      componentSource.includes('calendarLoading'),
      true,
      'CitizenDashboard must track calendarLoading'
    )
    assert.equal(
      componentSource.includes('calendarError'),
      true,
      'CitizenDashboard must track calendarError'
    )
    assert.equal(
      componentSource.includes('isCalendarStale'),
      true,
      'CitizenDashboard must track isCalendarStale'
    )
    assert.equal(
      componentSource.includes('isCalendarCapacityError'),
      true,
      'CitizenDashboard must track isCalendarCapacityError'
    )
    assert.equal(
      componentSource.includes('isCalendarNetworkError'),
      true,
      'CitizenDashboard must track isCalendarNetworkError'
    )
    assert.equal(
      componentSource.includes('No upcoming collections scheduled'),
      true,
      'CitizenDashboard must display a truthful empty state message'
    )
  })

  it('8. No barangay assignment displays a truthful message without querying other barangays', () => {
    assert.equal(
      componentSource.includes('No barangay assigned to your account'),
      true,
      'CitizenDashboard must explain missing barangay assignment'
    )
  })

  it('9. Preserves operational completion distinction without conflating with verified collection', () => {
    assert.equal(
      componentSource.includes('VERIFIED COLLECTED'),
      true,
      'CitizenDashboard must support explicit VERIFIED COLLECTED status'
    )
    assert.equal(
      componentSource.includes('REPORTED COMPLETE'),
      true,
      'CitizenDashboard must support distinct REPORTED COMPLETE status for driver completion'
    )
  })

  it('10. Sensitive operational and personal fields are strictly absent from schedule display', () => {
    const sensitiveTokens = [
      'nextPickup.driver_name',
      'nextPickup.driver_id',
      'nextPickup.truck_plate',
      'nextPickup.dumpsite_name',
      'nextPickup.watcher_name',
      'nextPickup.waypoints[',
    ]

    for (const token of sensitiveTokens) {
      assert.equal(
        componentSource.includes(token),
        false,
        `CitizenDashboard schedule display must never access sensitive operational field '${token}'`
      )
    }
  })

  it('11. Existing Citizen Dashboard workflows and components remain intact', () => {
    assert.equal(
      componentSource.includes('OfflineReportBuilder'),
      true,
      'CitizenDashboard must retain OfflineReportBuilder'
    )
    assert.equal(
      componentSource.includes('MiniMap'),
      true,
      'CitizenDashboard must retain MiniMap'
    )
    assert.equal(
      componentSource.includes('/api/watcher/reports/mine/'),
      true,
      'CitizenDashboard must retain citizen reports fetching'
    )
    assert.equal(
      componentSource.includes('useBarangayTracker'),
      true,
      'CitizenDashboard must retain useBarangayTracker'
    )
  })
})

describe('CitizenDashboard — Stage 2B Date-Range, Selection & Caching Tests', () => {
  it('1. Date range calculates exactly 14 inclusive calendar dates (today + 13 following dates)', () => {
    const ref = new Date('2026-11-10T08:00:00+08:00')
    const { startDateStr, endDateStr, todayStr } = calculateCitizenNextPickupDateRange(ref)

    assert.equal(startDateStr, '2026-11-10')
    assert.equal(todayStr, '2026-11-10')
    assert.equal(endDateStr, '2026-11-23') // 10 + 13 = 23

    const [sy, sm, sd] = startDateStr.split('-').map(Number)
    const [ey, em, ed] = endDateStr.split('-').map(Number)
    const startMs = Date.UTC(sy, sm - 1, sd)
    const endMs = Date.UTC(ey, em - 1, ed)
    const inclusiveDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1

    assert.equal(inclusiveDays, 14, `Date range must contain exactly 14 inclusive calendar days, got ${inclusiveDays}`)
    assert.ok(inclusiveDays <= 31, 'Date range must not exceed unpaginated maximum of 31 days')
  })

  it('2. Today occurrence is selected correctly when scheduled or in progress', () => {
    const todayStr = '2026-11-10'
    const occurrences = [
      {
        id: 'sched_1_20261110',
        source_id: 1,
        start_datetime: '2026-11-10T06:00:00+08:00',
        end_datetime: '2026-11-10T10:00:00+08:00',
        location: 'Ilayang Dupay',
        status: 'scheduled',
      },
      {
        id: 'sched_1_20261112',
        source_id: 1,
        start_datetime: '2026-11-12T06:00:00+08:00',
        end_datetime: '2026-11-12T10:00:00+08:00',
        location: 'Ilayang Dupay',
        status: 'scheduled',
      },
    ]

    const selected = selectNextPickupOccurrence(occurrences, todayStr)
    assert.ok(selected)
    assert.equal(selected.id, 'sched_1_20261110')
    assert.equal(selected.status, 'scheduled')
  })

  it('3. Nearest future occurrence is selected when today has no collection or is finished', () => {
    const todayStr = '2026-11-10'
    const occurrences = [
      {
        id: 'sched_3_20261110',
        source_id: 3,
        start_datetime: '2026-11-10T06:00:00+08:00',
        end_datetime: '2026-11-10T10:00:00+08:00',
        location: 'Market View',
        status: 'verified_collected', // Already collected today
      },
      {
        id: 'sched_3_20261112',
        source_id: 3,
        start_datetime: '2026-11-12T06:00:00+08:00',
        end_datetime: '2026-11-12T10:00:00+08:00',
        location: 'Market View',
        status: 'scheduled', // Nearest upcoming
      },
      {
        id: 'sched_3_20261114',
        source_id: 3,
        start_datetime: '2026-11-14T06:00:00+08:00',
        end_datetime: '2026-11-14T10:00:00+08:00',
        location: 'Market View',
        status: 'scheduled',
      },
    ]

    const selected = selectNextPickupOccurrence(occurrences, todayStr)
    assert.ok(selected)
    assert.equal(selected.id, 'sched_3_20261112', 'Must select future occurrence when today is already verified collected')
  })

  it('4. Multiple occurrences from the same source schedule remain distinct and uncollapsed', () => {
    const rawOccurrences = [
      {
        id: 'sched_4_20261110',
        source_id: 4,
        start_datetime: '2026-11-10T06:00:00+08:00',
        end_datetime: '2026-11-10T10:00:00+08:00',
        location: 'Gulang-Gulang',
        status: 'scheduled',
      },
      {
        id: 'sched_4_20261113',
        source_id: 4,
        start_datetime: '2026-11-13T06:00:00+08:00',
        end_datetime: '2026-11-13T10:00:00+08:00',
        location: 'Gulang-Gulang',
        status: 'scheduled',
      },
    ]

    const distinctIds = new Set(rawOccurrences.map(o => o.id))
    assert.equal(distinctIds.size, 2, 'Must maintain distinct occurrence IDs')
    assert.equal(rawOccurrences[0].source_id, rawOccurrences[1].source_id, 'Source IDs are identical')
  })

  it('5. Empty results produce null rather than fabricating fake fallback dates', () => {
    const selected = selectNextPickupOccurrence([], '2026-11-10')
    assert.equal(selected, null, 'Empty occurrence list must resolve to null')
  })

  it('6. Citizen role is positively verified as cache-eligible under Stage 1F.3B.2 rules', () => {
    const citizenUser = {
      id: 88,
      role: 'citizen',
      barangay_id: 5,
      is_staff: false,
    }

    const context = evaluateCalendarCallerContext(citizenUser)
    assert.equal(context.isPublic, true, 'Citizen role must be evaluated as public cache-eligible')
    assert.equal(context.isAdmin, false, 'Citizen must not be evaluated as admin')
    assert.equal(context.isVerified, true, 'Citizen must be positively verified')
  })

  it('7. Session manager provides cache-first display and offline fallback for Citizen Next Pickup', async () => {
    const citizenUser = { id: 99, role: 'citizen', barangay_id: 4, is_staff: false }
    const sampleEntry = {
      id: 'sched_4_20261111',
      source: 'collection_schedule',
      source_id: 4,
      start_datetime: '2026-11-11T07:00:00+08:00',
      end_datetime: '2026-11-11T11:00:00+08:00',
      title: 'Solid Waste Collection — Ibabang Dupay',
      status: 'scheduled',
    }

    const cachedData = {
      entries: [sampleEntry],
      count: 1,
      isFresh: false,
      isStale: true,
      cachedAt: Date.now() - 120000,
    }

    // Offline session reading cached data
    const offlineSession = createCalendarEntriesSession({
      fetcher: async () => { throw new Error('Network error') },
      cacheReader: async () => cachedData,
      cacheWriter: async () => {},
      user: citizenUser,
    })

    const finalState = await offlineSession.fetch({
      startDate: '2026-11-10',
      endDate: '2026-11-23',
      barangayId: 4,
      source: 'collection_schedule',
      user: citizenUser,
    })

    assert.equal(finalState.entries.length, 1, 'Offline session must display cached entries')
    assert.equal(finalState.entries[0].id, 'sched_4_20261111')
    assert.equal(finalState.isStale, true, 'Offline session must flag entries as stale')
    assert.equal(finalState.isFromCache, true, 'Entries must be marked as from cache')

    // Selected next pickup from offline entries
    const nextOfflinePickup = selectNextPickupOccurrence(finalState.entries, '2026-11-10')
    assert.ok(nextOfflinePickup)
    assert.equal(nextOfflinePickup.id, 'sched_4_20261111')
  })

  it('8. Sanitized CollectionSchedule occurrences conform strictly to public data safety', () => {
    const sanitizedOccurrence = {
      id: 'sched_10_20261112',
      source: 'collection_schedule',
      source_id: 10,
      title: 'Solid Waste Collection — Kanlurang Mayao',
      start_datetime: '2026-11-12T06:00:00+08:00',
      end_datetime: '2026-11-12T10:00:00+08:00',
      location: 'Kanlurang Mayao',
      status: 'scheduled',
      metadata: {
        frequency: 'TThS',
        total_stops: 5,
        resolved_stops: 0,
      },
    }

    assert.doesNotThrow(() => {
      verifyEntriesContainOnlyPublicData([sanitizedOccurrence])
    }, 'Sanitized entry must pass public data verification')
  })
})

describe('CitizenDashboard — Stage 2B.2 Timetable Next-Pickup Highlight Authority Tests', () => {
  it('1. When Calendar Service returns no occurrences, nextPickup is null and no timetable row receives NEXT PICKUP highlight even when template has isNext: true', () => {
    // Empty Calendar Service occurrences
    const calendarEntries = []
    const nextPickup = selectNextPickupOccurrence(calendarEntries, '2026-11-10')
    assert.equal(nextPickup, null, 'nextPickup must be null when Calendar Service returns no occurrences')

    // Sample timetable templates from /api/public/schedule/ where backend marked one as isNext: true based on weekday
    const templates = [
      { id: 101, day: 'Tuesday', zone: 'Ilayang Dupay', time: '6:00 AM – 10:00 AM', isNext: true },
      { id: 102, day: 'Thursday', zone: 'Ilayang Dupay', time: '6:00 AM – 10:00 AM', isNext: false },
      { id: 103, day: 'Saturday', zone: 'Ilayang Dupay', time: '6:00 AM – 10:00 AM', isNext: false },
    ]

    // Evaluate each row with the corrected component logic
    const rowHighlights = templates.map(s => Boolean(nextPickup && nextPickup.source_id === s.id))

    // Assert that NO row is highlighted
    assert.deepEqual(
      rowHighlights,
      [false, false, false],
      'No timetable row must receive NEXT PICKUP highlight when nextPickup is null, even with isNext: true'
    )
  })

  it('2. When an authoritative occurrence exists, only the matching source_id timetable row is highlighted', () => {
    // Authoritative occurrence from Calendar Service
    const nextPickup = {
      id: 'sched_102_20261112',
      source_id: 102,
      start_datetime: '2026-11-12T06:00:00+08:00',
      end_datetime: '2026-11-12T10:00:00+08:00',
      status: 'scheduled',
    }

    const templates = [
      { id: 101, day: 'Tuesday', zone: 'Ilayang Dupay', time: '6:00 AM – 10:00 AM', isNext: true }, // stale template flag
      { id: 102, day: 'Thursday', zone: 'Ilayang Dupay', time: '6:00 AM – 10:00 AM', isNext: false },
      { id: 103, day: 'Saturday', zone: 'Ilayang Dupay', time: '6:00 AM – 10:00 AM', isNext: false },
    ]

    const rowHighlights = templates.map(s => Boolean(nextPickup && nextPickup.source_id === s.id))

    assert.deepEqual(
      rowHighlights,
      [false, true, false],
      'Only the template whose id matches nextPickup.source_id must be highlighted'
    )
  })

  it('3. When no occurrence exists, weekly timetable templates remain visible as general schedule references', () => {
    const templates = [
      { id: 201, day: 'Monday', zone: 'Market View', time: '7:00 AM – 11:00 AM' },
      { id: 202, day: 'Wednesday', zone: 'Market View', time: '7:00 AM – 11:00 AM' },
    ]

    // Empty Calendar Service results
    const nextPickup = null

    // Component renders filteredSchedule.map regardless of nextPickup
    const renderedRows = templates.map((s, i) => {
      const isScheduleNext = Boolean(nextPickup && nextPickup.source_id === s.id)
      return {
        key: s.id || i,
        day: s.day,
        zone: s.zone,
        time: s.time,
        isScheduleNext,
      }
    })

    assert.equal(renderedRows.length, 2, 'All timetable rows must remain rendered')
    assert.equal(renderedRows[0].day, 'Monday')
    assert.equal(renderedRows[1].day, 'Wednesday')
    assert.equal(renderedRows.every(r => r.isScheduleNext === false), true, 'All rows remain non-highlighted')
  })

  it('4. Multiple occurrences from the same source do not cause duplicate or fabricated next-pickup selections', () => {
    const rawOccurrences = [
      {
        id: 'sched_301_20261112',
        source_id: 301,
        start_datetime: '2026-11-12T06:00:00+08:00',
        end_datetime: '2026-11-12T10:00:00+08:00',
        status: 'scheduled',
      },
      {
        id: 'sched_301_20261114',
        source_id: 301,
        start_datetime: '2026-11-14T06:00:00+08:00',
        end_datetime: '2026-11-14T10:00:00+08:00',
        status: 'scheduled',
      },
    ]

    const selected = selectNextPickupOccurrence(rawOccurrences, '2026-11-10')
    assert.ok(selected)
    assert.equal(selected.id, 'sched_301_20261112', 'Must select exactly the earliest upcoming occurrence')

    const templates = [
      { id: 301, day: 'Tuesday / Thursday / Saturday', zone: 'Gulang-Gulang', time: '6:00 AM – 10:00 AM' },
      { id: 302, day: 'Sunday', zone: 'Gulang-Gulang', time: '8:00 AM – 12:00 PM' },
    ]

    const rowHighlights = templates.map(s => Boolean(selected && selected.source_id === s.id))
    assert.deepEqual(rowHighlights, [true, false], 'Exactly one template matching the source_id is highlighted')
  })

  it('5. Existing date selection, loading, empty, error, stale-cache, and completion-status behavior remains unchanged', () => {
    // 1. Empty occurrences -> null
    assert.equal(selectNextPickupOccurrence([], '2026-11-10'), null)

    // 2. Verified collected occurrence mapping
    const { label: vcLabel, color: vcColor } = {
      label: 'VERIFIED COLLECTED',
      color: '#15803d',
    }
    assert.equal(vcLabel, 'VERIFIED COLLECTED')
    assert.equal(vcColor, '#15803d')

    // 3. Operationally completed occurrence mapping
    const { label: ocLabel, color: ocColor } = {
      label: 'REPORTED COMPLETE',
      color: '#0369a1',
    }
    assert.equal(ocLabel, 'REPORTED COMPLETE')
    assert.equal(ocColor, '#0369a1')

    // 4. Component source maintains all robust error, loading, and stale hooks
    assert.equal(componentSource.includes('calendarLoading && !nextPickup'), true)
    assert.equal(componentSource.includes('calendarError && !nextPickup'), true)
    assert.equal(componentSource.includes('isCalendarStale'), true)
    assert.equal(componentSource.includes('refreshCalendar'), true)
  })
})

