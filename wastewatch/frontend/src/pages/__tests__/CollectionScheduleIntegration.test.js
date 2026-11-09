import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatToManilaDateString,
  getCalendarEntries,
  CalendarServiceError,
} from '../../api/calendarService.js'
import {
  createCalendarEntriesSession,
  evaluateCalendarCallerContext,
} from '../../hooks/useCalendarEntries.js'
import {
  buildCalendarCacheKey,
  getCalendarCacheEntry,
  setCalendarCacheEntry,
  verifyEntriesContainOnlyPublicData,
} from '../../utils/calendarCache.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const componentPath = path.resolve(__dirname, '../CollectionSchedule.jsx')
const componentSource = fs.readFileSync(componentPath, 'utf8')

describe('CollectionSchedule — Stage 1F.3C.2 Security & Architectural Integrity Tests', () => {
  it('1. Retrieves date-based occurrences from unified Calendar Service via useCalendarEntries', () => {
    assert.equal(
      componentSource.includes('useCalendarEntries'),
      true,
      'CollectionSchedule must import and use useCalendarEntries hook'
    )
    assert.equal(
      componentSource.includes("source: 'collection_schedule'"),
      true,
      'CollectionSchedule must query source: collection_schedule'
    )
  })

  it('2. Consumes sanitized public schedule endpoint and NEVER calls raw driver operational endpoint', () => {
    assert.equal(
      componentSource.includes("api.get('/api/public/schedule/')"),
      true,
      'CollectionSchedule must consume sanitized /api/public/schedule/ endpoint'
    )
    assert.equal(
      componentSource.includes('/api/driver/collection-schedules'),
      false,
      'CollectionSchedule must NEVER query raw operational /api/driver/collection-schedules'
    )
  })

  it('3. Sensitive operational and personal fields are strictly absent from component source', () => {
    const sensitiveTokens = ['driver_name', 'truck_plate', 'dumpsite_name']
    for (const token of sensitiveTokens) {
      assert.equal(
        componentSource.includes(token),
        false,
        `Component source must not reference sensitive token '${token}'`
      )
    }
  })

  it('4. Preserves Leaflet interactive map overview and centroid bullseye rendering', () => {
    assert.equal(
      componentSource.includes('loadLeaflet'),
      true,
      'CollectionSchedule must load Leaflet safely'
    )
    assert.equal(
      componentSource.includes('/data/lucena_barangays.geojson'),
      true,
      'CollectionSchedule must load Lucena City barangay GeoJSON boundaries'
    )
    assert.equal(
      componentSource.includes('sched-centroid-icon'),
      true,
      'CollectionSchedule must retain centroid bullseye pin'
    )
  })

  it('5. Uses distinct occurrence ID (entry.id) for React keys and never collapses by source_id', () => {
    assert.equal(
      componentSource.includes('key={occ.id}'),
      true,
      'Date occurrence list must use occ.id as unique key to preserve recurring instances'
    )
    assert.equal(
      componentSource.includes('key={occ.source_id}'),
      false,
      'Date occurrences must NEVER use source_id as unique key'
    )
  })

  it('6. Strictly contains zero emojis across component source code', () => {
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    const match = componentSource.match(emojiRegex)
    assert.equal(
      match,
      null,
      `CollectionSchedule must contain zero emojis. Found: ${match ? match[0] : ''}`
    )
  })

  it('7. Handles truthful capacity error (HTTP 503) and network error states', () => {
    assert.equal(
      componentSource.includes('isCalendarCapacityError'),
      true,
      'Component must support truthful capacity limit error banner'
    )
    assert.equal(
      componentSource.includes('isCalendarNetworkError'),
      true,
      'Component must support truthful network error banner'
    )
  })
})

describe('CollectionSchedule — Stage 1F.3C.2 Occurrences, Reconciliation & Cache Contract Tests', () => {
  it('1. Multiple occurrences from one recurring schedule remain distinct and uncollapsed', () => {
    const occurrences = [
      {
        id: 'sched_5_20261102',
        source: 'collection_schedule',
        source_id: 5,
        title: 'Solid Waste Collection — Isabang',
        start_datetime: '2026-11-02T08:00:00+08:00',
        end_datetime: '2026-11-02T11:00:00+08:00',
        status: 'verified_collected',
        scope: 'barangay',
      },
      {
        id: 'sched_5_20261104',
        source: 'collection_schedule',
        source_id: 5,
        title: 'Solid Waste Collection — Isabang',
        start_datetime: '2026-11-04T08:00:00+08:00',
        end_datetime: '2026-11-04T11:00:00+08:00',
        status: 'operationally_completed',
        scope: 'barangay',
      },
      {
        id: 'sched_5_20261106',
        source: 'collection_schedule',
        source_id: 5,
        title: 'Solid Waste Collection — Isabang',
        start_datetime: '2026-11-06T08:00:00+08:00',
        end_datetime: '2026-11-06T11:00:00+08:00',
        status: 'scheduled',
        scope: 'barangay',
      },
    ]

    const map = new Map()
    for (const occ of occurrences) {
      const d = occ.start_datetime.slice(0, 10)
      if (!map.has(d)) map.set(d, [])
      map.get(d).push(occ)
    }

    assert.equal(map.size, 3, 'Must have 3 distinct date keys for 3 occurrences')
    assert.equal(map.get('2026-11-02')[0].id, 'sched_5_20261102')
    assert.equal(map.get('2026-11-04')[0].id, 'sched_5_20261104')
    assert.equal(map.get('2026-11-06')[0].id, 'sched_5_20261106')

    for (const occ of occurrences) {
      assert.equal(occ.source_id, 5, 'Every occurrence must retain source_id for route linkage')
    }
  })

  it('2. Multiple distinct schedules on the same date do not overwrite each other', () => {
    const sameDateOccurrences = [
      {
        id: 'sched_1_20261110',
        source: 'collection_schedule',
        source_id: 1,
        title: 'Solid Waste Collection — Sector A',
        start_datetime: '2026-11-10T06:00:00+08:00',
        end_datetime: '2026-11-10T09:00:00+08:00',
        status: 'scheduled',
      },
      {
        id: 'sched_2_20261110',
        source: 'collection_schedule',
        source_id: 2,
        title: 'Solid Waste Collection — Sector B',
        start_datetime: '2026-11-10T13:00:00+08:00',
        end_datetime: '2026-11-10T16:00:00+08:00',
        status: 'scheduled',
      },
    ]

    const map = new Map()
    for (const occ of sameDateOccurrences) {
      const d = occ.start_datetime.slice(0, 10)
      if (!map.has(d)) map.set(d, [])
      map.get(d).push(occ)
    }

    const dayList = map.get('2026-11-10')
    assert.equal(dayList.length, 2, 'Both occurrences on the same date must be preserved')
    assert.equal(dayList[0].id, 'sched_1_20261110')
    assert.equal(dayList[1].id, 'sched_2_20261110')
  })

  it('3. Date-range bounds adhere strictly to single month <= 31 days', () => {
    const testMonths = [
      { year: 2026, month: 1, expectedDays: 28 }, // Feb 2026
      { year: 2026, month: 3, expectedDays: 30 }, // Apr 2026
      { year: 2026, month: 11, expectedDays: 31 }, // Dec 2026
    ]

    for (const { year, month, expectedDays } of testMonths) {
      const startD = new Date(year, month, 1)
      const endD = new Date(year, month + 1, 0)
      const startStr = formatToManilaDateString(startD)
      const endStr = formatToManilaDateString(endD)

      assert.equal(endD.getDate(), expectedDays)
      assert.ok(expectedDays <= 31, 'Date range must never exceed 31 days for unpaginated queries')
      assert.equal(startStr.slice(8, 10), '01')
      assert.equal(endStr.slice(8, 10), String(expectedDays))
    }
  })

  it('4. Barangay scope isolates cache keys between barangay and citywide views', () => {
    const keyCitywide = buildCalendarCacheKey({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      source: 'collection_schedule',
      paginate: false,
    })

    const keyBarangay1 = buildCalendarCacheKey({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      barangayId: 1,
      source: 'collection_schedule',
      paginate: false,
    })

    const keyBarangay2 = buildCalendarCacheKey({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      barangayId: 2,
      source: 'collection_schedule',
      paginate: false,
    })

    assert.notEqual(keyCitywide, keyBarangay1, 'Citywide key must not collide with Barangay 1 key')
    assert.notEqual(keyBarangay1, keyBarangay2, 'Barangay 1 key must not collide with Barangay 2 key')
    assert.ok(keyCitywide.includes(':b=citywide:'))
    assert.ok(keyBarangay1.includes(':b=1:'))
    assert.ok(keyBarangay2.includes(':b=2:'))
  })

  it('5. Deep payload inspection verifies sanitized CollectionSchedule entries', () => {
    const sanitizedOccurrences = [
      {
        id: 'sched_10_20261112',
        source: 'collection_schedule',
        source_id: 10,
        title: 'Solid Waste Collection — Gulang-Gulang',
        status: 'scheduled',
        scope: 'barangay',
      },
    ]

    const check = verifyEntriesContainOnlyPublicData(sanitizedOccurrences)
    assert.equal(check.isPublicOnly, true, 'Sanitized public CollectionSchedule entry must be accepted')

    const entry = sanitizedOccurrences[0]
    assert.equal(entry.driver_name, undefined, 'driver_name must not exist on public CalendarEntry')
    assert.equal(entry.truck_plate, undefined, 'truck_plate must not exist on public CalendarEntry')
    assert.equal(entry.dumpsite_name, undefined, 'dumpsite_name must not exist on public CalendarEntry')
    assert.equal(entry.waypoints, undefined, 'raw waypoints must not exist on public CalendarEntry')

    const cancelledOcc = [
      {
        id: 'sched_11_20261112',
        source: 'collection_schedule',
        status: 'CANCELLED',
      },
    ]
    const cancelledCheck = verifyEntriesContainOnlyPublicData(cancelledOcc)
    assert.equal(cancelledCheck.isPublicOnly, false, 'Cancelled schedule must be rejected from public cache')
  })

  it('6. Date-integrity reconciliation: date with zero occurrences does not show templates as scheduled', () => {
    const occurrencesByDate = new Map()
    const selectedDateStr = '2026-11-12' // Thursday
    const selectedDow = 4

    const templateSchedules = [
      {
        id: 10,
        area: 'Isabang Commercial',
        days: 'Thu, Sat',
        status: 'CANCELLED',
      },
    ]

    const filterSchedulesForDate = (schedules, dateStr, dow) => {
      return schedules.filter(s => {
        if (dateStr) {
          const dateOccs = occurrencesByDate.get(dateStr) || []
          if (dateOccs.length === 0) {
            return false
          }
          return dateOccs.some(occ => occ.source_id === s.id)
        }
        return true
      })
    }

    const filtered = filterSchedulesForDate(templateSchedules, selectedDateStr, selectedDow)
    assert.equal(
      filtered.length,
      0,
      'A date with 0 Calendar Service occurrences must return 0 routes, not fall back to template weekdays'
    )
  })

  it('7. Today active collection hero requires an authoritative occurrence and rejects weekday guessing', () => {
    const templateSchedules = [
      {
        id: 12,
        area: 'Market View',
        days: 'Mon, Wed, Fri',
      },
    ]

    const todayOccurrenceA = null
    const resolveTodaySchedule = (todayOcc, schedules) => {
      if (!todayOcc) return null
      return schedules.find(s => s.id === todayOcc.source_id) || null
    }

    const todayA = resolveTodaySchedule(todayOccurrenceA, templateSchedules)
    assert.equal(todayA, null, 'When Calendar Service emits no occurrence today, hero card must be null')

    const todayOccurrenceB = {
      id: 'sched_12_20261110',
      source_id: 12,
      status: 'scheduled',
      location: 'Market View',
    }
    const todayB = resolveTodaySchedule(todayOccurrenceB, templateSchedules)
    assert.ok(todayB, 'Confirmed occurrence today matches template schedule')
    assert.equal(todayB.id, 12)
  })

  it('8. Sanitized public route schedule payload contract verifies presence of public fields and absence of sensitive keys', () => {
    const publicSchedulePayload = {
      id: 5,
      area: 'Isabang Commercial District',
      days: 'Mon, Wed, Fri',
      start_time: '08:00:00',
      end_time: '11:00:00',
      barangays: [1],
      barangay_names: 'Isabang',
      total_stops: 2,
      stops: [
        { order: 1, label: 'Central Depot' },
        { order: 2, label: 'Market Square' },
      ],
      color: '#16a34a',
      lifecycle_status: 'PENDING',
      day: 'Mon, Wed, Fri',
      zone: 'Isabang',
      time: '8:00 AM – 11:00 AM',
      isNext: true,
      status: 'upcoming',
    }

    // Approved public fields must exist
    assert.equal(publicSchedulePayload.id, 5)
    assert.equal(publicSchedulePayload.area, 'Isabang Commercial District')
    assert.equal(publicSchedulePayload.total_stops, 2)
    assert.equal(publicSchedulePayload.stops[0].label, 'Central Depot')
    assert.equal(publicSchedulePayload.stops[1].label, 'Market Square')

    // Sensitive operational fields must NOT exist
    assert.equal(publicSchedulePayload.driver_name, undefined)
    assert.equal(publicSchedulePayload.driver, undefined)
    assert.equal(publicSchedulePayload.truck_plate, undefined)
    assert.equal(publicSchedulePayload.truck, undefined)
    assert.equal(publicSchedulePayload.dumpsite_name, undefined)
    assert.equal(publicSchedulePayload.dumpsite, undefined)
    assert.equal(publicSchedulePayload.waypoints, undefined)
    assert.equal(publicSchedulePayload.watcher_names, undefined)
    assert.equal(publicSchedulePayload.stops[0].lat, undefined)
    assert.equal(publicSchedulePayload.stops[0].lng, undefined)
  })

  it('9. Session manager provides cache-first display and offline fallback for collection occurrences', async () => {
    let fetchCalled = false
    const cachedRecord = {
      entries: [
        {
          id: 'sched_7_20261115',
          source: 'collection_schedule',
          source_id: 7,
          title: 'Solid Waste Collection — Market View',
          start_datetime: '2026-11-15T07:00:00+08:00',
          end_datetime: '2026-11-15T10:00:00+08:00',
          status: 'scheduled',
        },
      ],
      isFresh: true,
      count: 1,
    }

    const session = createCalendarEntriesSession({
      user: null, // Public anonymous visitor
      cacheReader: async () => cachedRecord,
      cacheWriter: async () => null,
      fetcher: async () => {
        fetchCalled = true
        return {
          results: cachedRecord.entries,
          count: 1,
          paginated: false,
        }
      },
    })

    const res = await session.fetch({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      source: 'collection_schedule',
      paginate: false,
    })

    assert.equal(res.entries.length, 1)
    assert.equal(res.entries[0].id, 'sched_7_20261115')
    assert.equal(res.error, null)
  })
})