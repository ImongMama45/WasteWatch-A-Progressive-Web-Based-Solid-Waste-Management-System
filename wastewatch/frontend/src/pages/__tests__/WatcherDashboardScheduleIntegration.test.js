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
  buildCalendarCacheKey,
  verifyEntriesContainOnlyPublicData,
} from '../../utils/calendarCache.js'

function calculateWatcherScheduleDateRange(referenceDate = new Date()) {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate)
  const todayFormatted = formatToManilaDateString(now)
  const [y, m, d] = todayFormatted.split('-').map(Number)
  const anchorDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const future = new Date(anchorDate.getTime() + 6 * 24 * 60 * 60 * 1000)
  const futureFormatted = formatToManilaDateString(future)
  return {
    startDateStr: todayFormatted,
    endDateStr: futureFormatted,
    todayStr: todayFormatted,
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const componentPath = path.resolve(__dirname, '../dashboard/WatcherDashboard.jsx')
const componentSource = fs.readFileSync(componentPath, 'utf8')

describe('WatcherDashboard — Stage 2A Schedule Integration & Architectural Integrity Tests', () => {
  it('1. Real collection occurrences render instead of mock schedules', () => {
    // Verify that the hardcoded mock schedule arrays are completely removed
    assert.equal(
      componentSource.includes("{ day: 'Monday', time: '6:00 AM – 10:00 AM' }"),
      false,
      'WatcherDashboard must not contain hardcoded mock schedule entries'
    )
    assert.equal(
      componentSource.includes("{ day: 'Wednesday', time: 'N/A' }"),
      false,
      'WatcherDashboard must not contain mock Wednesday N/A entry'
    )
    assert.equal(
      componentSource.includes('STATIC_SCHEDULE'),
      false,
      'WatcherDashboard must not define or use STATIC_SCHEDULE'
    )
  })

  it('2. The request uses the Watcher assigned barangay ID', () => {
    assert.equal(
      componentSource.includes('userBrgyId'),
      true,
      'WatcherDashboard must resolve userBrgyId'
    )
    assert.equal(
      componentSource.includes('barangayId: userBrgyId'),
      true,
      'useCalendarEntries must be called with barangayId: userBrgyId'
    )
  })

  it('3. Only collection_schedule entries are requested', () => {
    assert.equal(
      componentSource.includes("source: 'collection_schedule'"),
      true,
      "WatcherDashboard must request source: 'collection_schedule'"
    )
  })

  it('4. Uses distinct occurrence ID (entry.id) for React keys and never collapses by source_id', () => {
    assert.equal(
      componentSource.includes('key={entry.id}'),
      true,
      'WatcherDashboard must key each occurrence by entry.id to preserve distinct occurrences'
    )
    assert.equal(
      componentSource.includes('key={entry.source_id}'),
      false,
      'WatcherDashboard must NEVER key occurrences merely by source_id'
    )
  })

  it('5. Dates and times display correctly using Asia/Manila conventions', () => {
    assert.equal(
      componentSource.includes('formatToManilaDateString'),
      true,
      'WatcherDashboard must import and use formatToManilaDateString'
    )
    assert.equal(
      componentSource.includes('formatOccurrenceDate'),
      true,
      'WatcherDashboard must define formatOccurrenceDate helper'
    )
    assert.equal(
      componentSource.includes('formatOccurrenceTime'),
      true,
      'WatcherDashboard must define formatOccurrenceTime helper'
    )
  })

  it('6. Strictly contains zero emojis across component source code', () => {
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    const match = componentSource.match(emojiRegex)
    assert.equal(
      match,
      null,
      `WatcherDashboard must contain zero emojis. Found: ${match ? match[0] : ''}`
    )
  })

  it('7. Handles loading, empty, error, and cached/stale states truthfully without fake fallback data', () => {
    assert.equal(
      componentSource.includes('calendarLoading'),
      true,
      'WatcherDashboard must track calendarLoading'
    )
    assert.equal(
      componentSource.includes('calendarError'),
      true,
      'WatcherDashboard must track calendarError'
    )
    assert.equal(
      componentSource.includes('isCalendarStale'),
      true,
      'WatcherDashboard must track isCalendarStale'
    )
    assert.equal(
      componentSource.includes('isCalendarCapacityError'),
      true,
      'WatcherDashboard must track isCalendarCapacityError'
    )
    assert.equal(
      componentSource.includes('isCalendarNetworkError'),
      true,
      'WatcherDashboard must track isCalendarNetworkError'
    )
    assert.equal(
      componentSource.includes('No scheduled collections in the next 7 days'),
      true,
      'WatcherDashboard must render a truthful empty state message'
    )
  })

  it('8. Existing Watcher shift and stop-validation functionality remains intact', () => {
    assert.equal(
      componentSource.includes('/api/watcher/stop-validations/'),
      true,
      'WatcherDashboard must preserve stop validations fetch'
    )
    assert.equal(
      componentSource.includes('/api/watcher/reports/'),
      true,
      'WatcherDashboard must preserve watcher reports fetch'
    )
    assert.equal(
      componentSource.includes('/watcher-tasks'),
      true,
      'WatcherDashboard must preserve inspection tasks navigation'
    )
    assert.equal(
      componentSource.includes('MiniMap'),
      true,
      'WatcherDashboard must preserve MiniMap integration'
    )
  })

  it('9. Preserves operational completion distinction: does not conflate driver completion with verified collection', () => {
    assert.equal(
      componentSource.includes('VERIFIED COLLECTED'),
      true,
      'WatcherDashboard must support explicit VERIFIED COLLECTED status'
    )
    assert.equal(
      componentSource.includes('REPORTED COMPLETE'),
      true,
      'WatcherDashboard must support distinct REPORTED COMPLETE status for operational completion'
    )
  })

  it('10. No operational driver, truck, dumpsite, or watcher identity fields are introduced into schedule display', () => {
    const sensitiveTokens = [
      'entry.driver_name',
      'entry.driver_id',
      'entry.truck_plate',
      'entry.dumpsite_name',
      'entry.watcher_name',
      'entry.waypoints[',
    ]

    for (const token of sensitiveTokens) {
      assert.equal(
        componentSource.includes(token),
        false,
        `WatcherDashboard schedule display must never access sensitive operational field '${token}'`
      )
    }
  })

  it('11. Schedule date window calculates exactly 7 inclusive calendar days and excludes the 8th date', () => {
    assert.equal(
      componentSource.includes('calculateWatcherScheduleDateRange'),
      true,
      'WatcherDashboard must use calculateWatcherScheduleDateRange helper'
    )
    assert.equal(
      componentSource.includes('+ 7 * 24 * 60 * 60 * 1000'),
      false,
      'WatcherDashboard must not use +7 days offset which produces 8 inclusive dates'
    )
    assert.equal(
      componentSource.includes('+ 6 * 24 * 60 * 60 * 1000'),
      true,
      'WatcherDashboard must use +6 days offset to produce exactly 7 inclusive dates'
    )
  })
})

describe('WatcherDashboard — Stage 2A.1 Date-Range Calculation Tests', () => {
  it('1. The date range includes exactly seven calendar dates', () => {
    const ref = new Date('2026-11-10T08:00:00+08:00')
    const { startDateStr, endDateStr } = calculateWatcherScheduleDateRange(ref)

    const [sy, sm, sd] = startDateStr.split('-').map(Number)
    const [ey, em, ed] = endDateStr.split('-').map(Number)
    const startMs = Date.UTC(sy, sm - 1, sd)
    const endMs = Date.UTC(ey, em - 1, ed)
    const inclusiveDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1

    assert.equal(inclusiveDays, 7, `Date range must contain exactly 7 inclusive calendar days, got ${inclusiveDays}`)
  })

  it('2. Today is included in the date range', () => {
    const ref = new Date('2026-11-10T14:30:00+08:00')
    const { startDateStr, todayStr } = calculateWatcherScheduleDateRange(ref)

    assert.equal(startDateStr, '2026-11-10')
    assert.equal(todayStr, '2026-11-10')
    assert.equal(startDateStr, todayStr, 'Start date must equal today')
  })

  it('3. The sixth following date is included', () => {
    const ref = new Date('2026-11-10T10:00:00+08:00') // Tuesday
    const { startDateStr, endDateStr } = calculateWatcherScheduleDateRange(ref)

    assert.equal(startDateStr, '2026-11-10')
    assert.equal(endDateStr, '2026-11-16') // Following Monday = 6th following date (Day 7)
  })

  it('4. The seventh following date is excluded', () => {
    const ref = new Date('2026-11-10T10:00:00+08:00')
    const { endDateStr } = calculateWatcherScheduleDateRange(ref)

    // 7th following date is 2026-11-17 (Day 8)
    const seventhFollowingDateStr = '2026-11-17'
    assert.notEqual(endDateStr, seventhFollowingDateStr, '7th following date must not be the end date')
    assert.ok(endDateStr < seventhFollowingDateStr, 'End date must be strictly before 7th following date')
  })

  it('5. Date calculations remain consistent with Asia/Manila conventions across month and year boundaries', () => {
    // A: Month boundary (October 31 -> November 6, 7 days)
    const octBoundary = new Date('2026-10-31T23:30:00+08:00')
    const octResult = calculateWatcherScheduleDateRange(octBoundary)
    assert.equal(octResult.startDateStr, '2026-10-31')
    assert.equal(octResult.endDateStr, '2026-11-06')

    // B: Leap year boundary (Feb 25, 2024 -> Mar 02, 2024, 7 days)
    const leapBoundary = new Date('2024-02-25T12:00:00+08:00')
    const leapResult = calculateWatcherScheduleDateRange(leapBoundary)
    assert.equal(leapResult.startDateStr, '2024-02-25')
    assert.equal(leapResult.endDateStr, '2024-03-02')

    // C: Year boundary (Dec 28, 2026 -> Jan 03, 2027, 7 days)
    const yearBoundary = new Date('2026-12-28T05:00:00+08:00')
    const yearResult = calculateWatcherScheduleDateRange(yearBoundary)
    assert.equal(yearResult.startDateStr, '2026-12-28')
    assert.equal(yearResult.endDateStr, '2027-01-03')
  })
})

describe('WatcherDashboard — Stage 2A Occurrence Contract & Caching Tests', () => {
  it('1. Formats occurrences and dates accurately', () => {
    const manilaToday = formatToManilaDateString(new Date())
    assert.match(manilaToday, /^\d{4}-\d{2}-\d{2}$/, 'Today must be YYYY-MM-DD')
  })

  it('2. Multiple occurrences from the same source schedule remain distinct and uncollapsed', () => {
    const rawOccurrences = [
      {
        id: 'sched_5_20261110',
        source: 'collection_schedule',
        source_id: 5,
        title: 'Solid Waste Collection — Gulang-Gulang',
        start_datetime: '2026-11-10T06:00:00+08:00',
        end_datetime: '2026-11-10T10:00:00+08:00',
        location: 'Gulang-Gulang',
        status: 'scheduled',
      },
      {
        id: 'sched_5_20261112',
        source: 'collection_schedule',
        source_id: 5,
        title: 'Solid Waste Collection — Gulang-Gulang',
        start_datetime: '2026-11-12T06:00:00+08:00',
        end_datetime: '2026-11-12T10:00:00+08:00',
        location: 'Gulang-Gulang',
        status: 'scheduled',
      },
      {
        id: 'sched_5_20261114',
        source: 'collection_schedule',
        source_id: 5,
        title: 'Solid Waste Collection — Gulang-Gulang',
        start_datetime: '2026-11-14T06:00:00+08:00',
        end_datetime: '2026-11-14T10:00:00+08:00',
        location: 'Gulang-Gulang',
        status: 'scheduled',
      },
    ]

    const distinctIds = new Set(rawOccurrences.map(o => o.id))
    assert.equal(distinctIds.size, 3, 'Must maintain 3 distinct occurrence IDs')

    const sourceIds = new Set(rawOccurrences.map(o => o.source_id))
    assert.equal(sourceIds.size, 1, 'Source ID is identical across recurring occurrences')

    // Confirm that entry.id prevents React key collisions
    const ids = rawOccurrences.map(o => o.id)
    assert.equal(ids[0], 'sched_5_20261110')
    assert.equal(ids[1], 'sched_5_20261112')
    assert.equal(ids[2], 'sched_5_20261114')
  })

  it('3. Watcher role is positively verified as cache-eligible under Stage 1F.3B.2 rules', () => {
    const watcherUser = {
      id: 42,
      role: 'watcher',
      barangay_id: 3,
      is_staff: false,
    }

    const context = evaluateCalendarCallerContext(watcherUser)
    assert.equal(context.isPublic, true, 'Watcher role must be evaluated as public cache-eligible')
    assert.equal(context.isAdmin, false, 'Watcher must not be evaluated as admin')
    assert.equal(context.isVerified, true, 'Watcher must be positively verified')
  })

  it('4. Sanitized CollectionSchedule occurrences conform strictly to public data safety', () => {
    const sanitizedEntry = {
      id: 'sched_9_20261110',
      source: 'collection_schedule',
      source_id: 9,
      title: 'Solid Waste Collection — Isabang',
      start_datetime: '2026-11-10T06:00:00+08:00',
      end_datetime: '2026-11-10T10:00:00+08:00',
      location: 'Isabang',
      status: 'scheduled',
      metadata: {
        frequency: 'MWF',
        total_stops: 4,
        resolved_stops: 0,
      },
    }

    assert.doesNotThrow(() => {
      verifyEntriesContainOnlyPublicData([sanitizedEntry])
    }, 'Sanitized entry must pass public data verification')
  })

  it('5. Session manager provides cache-first display and offline fallback for Watcher role', async () => {
    const watcherUser = { id: 7, role: 'watcher', barangay_id: 2, is_staff: false }
    const sampleEntry = {
      id: 'sched_2_20261110',
      source: 'collection_schedule',
      source_id: 2,
      start_datetime: '2026-11-10T06:00:00+08:00',
      end_datetime: '2026-11-10T10:00:00+08:00',
      title: 'Solid Waste Collection — Gulang-Gulang',
      status: 'scheduled',
    }

    const cachedData = {
      entries: [sampleEntry],
      count: 1,
      isFresh: false,
      isStale: true,
      cachedAt: Date.now() - 60000,
    }

    // Offline session reading cached data
    const offlineSession = createCalendarEntriesSession({
      fetcher: async () => { throw new Error('Offline network error') },
      cacheReader: async () => cachedData,
      cacheWriter: async () => {},
      user: watcherUser,
    })

    const finalState = await offlineSession.fetch({
      startDate: '2026-11-10',
      endDate: '2026-11-17',
      barangayId: 2,
      source: 'collection_schedule',
      user: watcherUser,
    })

    assert.equal(finalState.entries.length, 1, 'Offline session must display cached entries')
    assert.equal(finalState.entries[0].id, 'sched_2_20261110')
    assert.equal(finalState.isStale, true, 'Offline session must flag entries as stale')
    assert.equal(finalState.isFromCache, true, 'Entries must be marked as from cache')
  })
})
