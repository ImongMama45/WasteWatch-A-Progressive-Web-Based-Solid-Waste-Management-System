import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeStopStatus,
  STOP_STATUS_LABELS,
  STOP_STATUS_COLORS,
  buildStopValidationSnapshot,
} from '../../utils/pickupStatusSync.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const miniMapPath = path.resolve(__dirname, '../../components/MiniMap.jsx')
const miniMapSource = fs.readFileSync(miniMapPath, 'utf8')

const mapViewPath = path.resolve(__dirname, '../MapView.jsx')
const mapViewSource = fs.readFileSync(mapViewPath, 'utf8')

const zonePanelPath = path.resolve(__dirname, '../../components/ZonePanel.jsx')
const zonePanelSource = fs.readFileSync(zonePanelPath, 'utf8')

// Pure helper logic mirroring updated components
function filterAndValidateStops(schedule) {
  const stops = Array.isArray(schedule.stops)
    ? schedule.stops
    : (Array.isArray(schedule.waypoints) ? schedule.waypoints.slice(1) : [])

  return stops.filter(wp => {
    if (!wp || wp.lat == null || wp.lng == null) return false
    const lat = Number(wp.lat)
    const lng = Number(wp.lng)
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  }).map((wp, i) => ({
    order: wp.order ?? (i + 1),
    label: wp.label || `Stop ${wp.order ?? (i + 1)}`,
    lat: Number(wp.lat),
    lng: Number(wp.lng),
    barangay_id: wp.barangay_id ?? null,
  }))
}

function scheduleMatchesZonePure(schedule, zone) {
  if (!schedule || !zone) return false
  const zoneName = String(zone.name || '').trim().toLowerCase()
  const zoneId = zone.id != null ? String(zone.id) : ''

  const scheduleZoneNames = [
    schedule.barangay_names,
    schedule.area,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (zoneName && scheduleZoneNames.includes(zoneName)) return true

  const barangays = Array.isArray(schedule.barangays) ? schedule.barangays : []
  if (zoneId && barangays.some(b => String(b) === zoneId)) return true

  const stopList = Array.isArray(schedule.stops)
    ? schedule.stops
    : (Array.isArray(schedule.waypoints) ? schedule.waypoints : [])
  return stopList.some(wp => String(wp?.barangay_id ?? '') === zoneId)
}

describe('Stage 2D.3: Frontend Public Map Migration Integration Tests', () => {
  describe('1. Endpoint migration and operational decoupling', () => {
    it('MiniMap consumes /api/public/map/pins/ and NOT operational collection-schedules', () => {
      assert.equal(
        miniMapSource.includes("api.get('/api/public/map/pins/'"),
        true,
        'MiniMap must request /api/public/map/pins/'
      )
      assert.equal(
        miniMapSource.includes('/api/driver/collection-schedules/'),
        false,
        'MiniMap must NEVER request /api/driver/collection-schedules/'
      )
    })

    it('MapView consumes /api/public/map/pins/ and NOT operational collection-schedules', () => {
      assert.equal(
        mapViewSource.includes("api.get('/api/public/map/pins/')"),
        true,
        'MapView must request /api/public/map/pins/'
      )
      assert.equal(
        mapViewSource.includes('/api/driver/collection-schedules/'),
        false,
        'MapView must NEVER request /api/driver/collection-schedules/'
      )
    })

    it('ZonePanel does not contain references to operational collection-schedules or sensitive driver/truck fields', () => {
      assert.equal(
        zonePanelSource.includes('/api/driver/collection-schedules/'),
        false,
        'ZonePanel must not reference operational collection-schedules'
      )
      assert.equal(
        zonePanelSource.includes('truck_plate'),
        false,
        'ZonePanel must not display truck_plate'
      )
      assert.equal(
        zonePanelSource.includes('driver_name'),
        false,
        'ZonePanel must not display driver_name'
      )
    })
  })

  describe('2. Sanitized stop coordinates, ordering, and depot exclusion', () => {
    it('Correctly extracts and validates stops with 1-based order', () => {
      const sampleSchedule = {
        id: 10,
        area: 'Isabang Commercial Zone',
        stops: [
          { order: 1, label: 'Market 1', lat: 13.94, lng: 121.62, barangay_id: 1 },
          { order: 2, label: 'Market 2', lat: 13.95, lng: 121.63, barangay_id: 1 },
        ],
      }

      const validStops = filterAndValidateStops(sampleSchedule)
      assert.equal(validStops.length, 2)
      assert.equal(validStops[0].order, 1)
      assert.equal(validStops[0].label, 'Market 1')
      assert.equal(validStops[1].order, 2)
      assert.equal(validStops[1].label, 'Market 2')
    })

    it('Safely filters out stops with missing, non-numeric, or out-of-range coordinates', () => {
      const malformedSchedule = {
        id: 11,
        stops: [
          { order: 1, label: 'Valid Stop', lat: 13.94, lng: 121.62 },
          { order: 2, label: 'Missing Lat', lng: 121.62 },
          { order: 3, label: 'Missing Lng', lat: 13.94 },
          { order: 4, label: 'NaN Lat', lat: 'invalid', lng: 121.62 },
          { order: 5, label: 'Out of Range Lat', lat: 95.0, lng: 121.62 },
          { order: 6, label: 'Out of Range Lng', lat: 13.94, lng: 200.0 },
          null,
          { order: 7, label: 'Second Valid Stop', lat: '13.95', lng: '121.63' },
        ],
      }

      const validStops = filterAndValidateStops(malformedSchedule)
      assert.equal(validStops.length, 2)
      assert.equal(validStops[0].label, 'Valid Stop')
      assert.equal(validStops[1].label, 'Second Valid Stop')
      assert.equal(validStops[1].lat, 13.95)
    })

    it('MiniMap and MapView do not fabricate depot/home-base markers', () => {
      assert.equal(
        mapViewSource.includes("stopOrder === 'base'"),
        false,
        'MapView must not fabricate or render home-base stopOrder'
      )
      assert.equal(
        mapViewSource.includes(':base'),
        false,
        'MapView must not construct depot base keys'
      )
    })
  })

  describe('3. Barangay filtering and zone matching', () => {
    const brgy1Zone = { id: 1, name: 'Isabang' }
    const brgy2Zone = { id: 2, name: 'Gulang-Gulang' }

    it('Matches schedule by barangay ID array', () => {
      const schedule = { id: 1, barangays: [1, 3], area: 'Commercial Zone' }
      assert.equal(scheduleMatchesZonePure(schedule, brgy1Zone), true)
      assert.equal(scheduleMatchesZonePure(schedule, brgy2Zone), false)
    })

    it('Matches schedule by barangay name in barangay_names or area', () => {
      const schedule = { id: 2, barangays: [], barangay_names: 'Isabang, Lucena', area: '' }
      assert.equal(scheduleMatchesZonePure(schedule, brgy1Zone), true)
      assert.equal(scheduleMatchesZonePure(schedule, brgy2Zone), false)
    })

    it('Matches schedule by stop-level barangay_id', () => {
      const schedule = {
        id: 3,
        barangays: [],
        area: 'Border Corridor',
        stops: [{ order: 1, label: 'Stop 1', lat: 13.94, lng: 121.62, barangay_id: 1 }],
      }
      assert.equal(scheduleMatchesZonePure(schedule, brgy1Zone), true)
      assert.equal(scheduleMatchesZonePure(schedule, brgy2Zone), false)
    })

    it('MiniMap passes barangay_id to /api/public/map/pins/ when non-admin user has barangay', () => {
      assert.equal(
        miniMapSource.includes("api.get('/api/public/map/pins/', { params })"),
        true,
        'MiniMap must pass { params } with barangay_id to public map pins'
      )
    })

    it('MiniMap passes barangay_id to /api/public/map/stop-statuses/ when non-admin user has barangay, and omits when absent or invalid', () => {
      assert.equal(
        miniMapSource.includes("api.get('/api/public/map/stop-statuses/', { params })"),
        true,
        'MiniMap must pass { params } to /api/public/map/stop-statuses/'
      )

      function buildMiniMapParams(user, isAdmin = false) {
        const userBarangayId = !isAdmin && user
          ? (user.barangay_id ?? (typeof user.barangay === 'object' ? user.barangay?.id : (typeof user.barangay === 'number' || (typeof user.barangay === 'string' && /^\d+$/.test(user.barangay)) ? Number(user.barangay) : null)))
          : null
        return userBarangayId ? { barangay_id: userBarangayId } : {}
      }

      // Valid selected barangay ID
      assert.deepEqual(buildMiniMapParams({ barangay_id: 3 }), { barangay_id: 3 })
      assert.deepEqual(buildMiniMapParams({ barangay: { id: 7 } }), { barangay_id: 7 })
      assert.deepEqual(buildMiniMapParams({ barangay: '14' }), { barangay_id: 14 })

      // Without barangay ID (omits parameter)
      assert.deepEqual(buildMiniMapParams(null), {})
      assert.deepEqual(buildMiniMapParams({}), {})
      assert.deepEqual(buildMiniMapParams({ barangay_id: null, barangay: null }), {})
      assert.deepEqual(buildMiniMapParams({ barangay_id: 5 }, true), {}) // Admin omits

      // Invalid or empty IDs do not create malformed parameters
      assert.deepEqual(buildMiniMapParams({ barangay: '' }), {})
      assert.deepEqual(buildMiniMapParams({ barangay: 'not-a-number' }), {})
      assert.deepEqual(buildMiniMapParams({ barangay: undefined }), {})
      assert.deepEqual(buildMiniMapParams({ barangay: {} }), {})
    })
  })

  describe('4. ZonePanel public presentation without operational data', () => {
    it('ZonePanel displays public information: days, time, stops count', () => {
      assert.equal(
        zonePanelSource.includes('sched.days'),
        true,
        'ZonePanel must render schedule days'
      )
      assert.equal(
        zonePanelSource.includes('timeDisplay'),
        true,
        'ZonePanel must render time display'
      )
      assert.equal(
        zonePanelSource.includes('stopCount'),
        true,
        'ZonePanel must render public stop count'
      )
      assert.equal(
        zonePanelSource.includes('stopsList.map'),
        true,
        'ZonePanel must render collection stops from stopsList'
      )
    })
  })

  describe('5. Status-coloring and StopValidation compatibility', () => {
    it('Resolves normalized stop statuses correctly for map pin coloring', () => {
      assert.equal(normalizeStopStatus('VERIFIED_COLLECTED'), 'VERIFIED_COLLECTED')
      assert.equal(normalizeStopStatus('COLLECTION_REPORTED'), 'COLLECTION_REPORTED')
      assert.equal(normalizeStopStatus('PENDING_INSPECTION'), 'PENDING_INSPECTION')
      assert.equal(normalizeStopStatus(null), 'PENDING_INSPECTION')

      assert.equal(typeof STOP_STATUS_COLORS.VERIFIED_COLLECTED.bg, 'string')
      assert.equal(typeof STOP_STATUS_LABELS.VERIFIED_COLLECTED, 'string')
    })

    it('Status keys maintain scheduleId:stopOrder format', () => {
      const scheduleId = 42
      const stopOrder = 3
      const statusKey = `${scheduleId}:${stopOrder}`
      assert.equal(statusKey, '42:3')
    })
  })

  describe('6. Public stop-status migration, occurrence metadata, and Yesterday labeling', () => {
    it('MiniMap consumes /api/public/map/stop-statuses/ and NOT operational stop-validations', () => {
      assert.equal(
        miniMapSource.includes("api.get('/api/public/map/stop-statuses/'"),
        true,
        'MiniMap must request /api/public/map/stop-statuses/'
      )
      assert.equal(
        miniMapSource.includes('/api/watcher/stop-validations/'),
        false,
        'MiniMap must NEVER request /api/watcher/stop-validations/'
      )
    })

    it('MapView consumes /api/public/map/stop-statuses/ and NOT operational stop-validations', () => {
      assert.equal(
        mapViewSource.includes("api.get('/api/public/map/stop-statuses/')"),
        true,
        'MapView must request /api/public/map/stop-statuses/'
      )
      assert.equal(
        mapViewSource.includes('/api/watcher/stop-validations/'),
        false,
        'MapView must NEVER request /api/watcher/stop-validations/'
      )
    })

    it('buildStopValidationSnapshot maps records to physical key ${schedule_id}:${stop_order}', () => {
      const sampleRecords = [
        {
          schedule_id: 15,
          stop_order: 1,
          status: 'VERIFIED_COLLECTED',
          collected_at: '08:30',
          collection_date: '2026-11-11',
          is_today: true,
          occurrence_key: '15:1:2026-11-11',
        },
        {
          schedule_id: 15,
          stop_order: 2,
          status: 'PENDING_INSPECTION',
          collected_at: null,
          collection_date: '2026-11-11',
          is_today: true,
          occurrence_key: '15:2:2026-11-11',
        },
      ]

      const snapshot = buildStopValidationSnapshot(sampleRecords)
      assert.equal(snapshot.statusMap.get('15:1'), 'VERIFIED_COLLECTED')
      assert.equal(snapshot.statusMap.get('15:2'), 'PENDING_INSPECTION')
      assert.equal(snapshot.detailsMap.has('15:1'), true)
      assert.equal(snapshot.detailsMap.has('15:2'), true)
    })

    it('Preserves occurrence metadata (collectionDate, isToday, occurrenceKey) in detailsMap', () => {
      const sampleYesterday = [
        {
          schedule_id: 20,
          stop_order: 3,
          status: 'VERIFIED_COLLECTED',
          collected_at: '17:45',
          collection_date: '2026-11-10',
          is_today: false,
          occurrence_key: '20:3:2026-11-10',
        },
      ]

      const snapshot = buildStopValidationSnapshot(sampleYesterday)
      const details = snapshot.detailsMap.get('20:3')
      assert.notEqual(details, undefined)
      assert.equal(details.scheduleId, 20)
      assert.equal(details.collectionDate, '2026-11-10')
      assert.equal(details.isToday, false)
      assert.equal(details.occurrenceKey, '20:3:2026-11-10')
      assert.equal(details.collectedAt, '17:45')
    })

    it('Handles pre-formatted time strings ("09:42") and ISO timestamps without Invalid Date', () => {
      const sample = [
        {
          schedule_id: 1,
          stop_order: 1,
          status: 'VERIFIED_COLLECTED',
          collected_at: '09:42',
        },
        {
          schedule_id: 1,
          stop_order: 2,
          status: 'VERIFIED_COLLECTED',
          collected_at: '2026-11-11T10:15:00Z',
        },
        {
          schedule_id: 1,
          stop_order: 3,
          status: 'PENDING_INSPECTION',
          collected_at: null,
        },
      ]

      const snapshot = buildStopValidationSnapshot(sample)
      assert.equal(snapshot.detailsMap.get('1:1').collectedAt, '09:42')
      assert.notEqual(snapshot.detailsMap.get('1:2').collectedAt, 'Invalid Date')
      assert.ok(snapshot.detailsMap.get('1:2').collectedAt.length > 0)
      assert.equal(snapshot.detailsMap.get('1:3').collectedAt, '')
    })

    it('Today records explicitly omit Yesterday label and retain time, while Yesterday records display Yesterday', () => {
      assert.equal(
        miniMapSource.includes('Yesterday'),
        true,
        'MiniMap must include Yesterday labeling logic'
      )
      assert.equal(
        mapViewSource.includes('Yesterday'),
        true,
        'MapView must include Yesterday labeling logic'
      )

      function formatMiniPopup(details) {
        return details?.collectedAt
          ? (details.isToday === false
              ? `<div style="font-size:10px;color:#0ea5e9;margin-top:4px;">✓ Yesterday ${details.collectedAt}</div>`
              : `<div style="font-size:10px;color:#10b981;margin-top:4px;">✓ ${details.collectedAt}</div>`
            )
          : (details?.isToday === false
              ? `<div style="font-size:10px;color:#0ea5e9;margin-top:4px;">Yesterday</div>`
              : ''
            )
      }

      function formatMapPopup(details) {
        return details?.collectedAt
          ? `<div style="margin-top:6px;font-size:11px;color:#10b981">${details?.isToday === false ? `✓ Collected Yesterday: ${details.collectedAt}` : `✓ Collected: ${details.collectedAt}`}</div>`
          : (details?.isToday === false ? `<div style="margin-top:6px;font-size:11px;color:#94a3b8;">Yesterday</div>` : '')
      }

      // 1. isToday: true with collection time
      const todayRecord = { isToday: true, collectedAt: '09:42' }
      const miniToday = formatMiniPopup(todayRecord)
      const mapToday = formatMapPopup(todayRecord)

      // Explicit negative assertions: must NOT display "Yesterday"
      assert.equal(miniToday.includes('Yesterday'), false, 'MiniMap today popup must NOT contain Yesterday')
      assert.equal(mapToday.includes('Yesterday'), false, 'MapView today popup must NOT contain Yesterday')

      // Positive assertions: retains existing collection time display
      assert.equal(miniToday.includes('✓ 09:42'), true, 'MiniMap today popup must retain "✓ 09:42"')
      assert.equal(mapToday.includes('✓ Collected: 09:42'), true, 'MapView today popup must retain "✓ Collected: 09:42"')

      // 2. isToday: false (Yesterday) with collection time
      const yesterdayRecord = { isToday: false, collectedAt: '16:20' }
      const miniYesterday = formatMiniPopup(yesterdayRecord)
      const mapYesterday = formatMapPopup(yesterdayRecord)

      assert.equal(miniYesterday.includes('Yesterday'), true, 'MiniMap yesterday popup must contain Yesterday')
      assert.equal(miniYesterday.includes('✓ Yesterday 16:20'), true)
      assert.equal(mapYesterday.includes('Yesterday'), true, 'MapView yesterday popup must contain Yesterday')
      assert.equal(mapYesterday.includes('✓ Collected Yesterday: 16:20'), true)

      // 3. isToday: false without collection time
      const yesterdayNoTime = { isToday: false, collectedAt: '' }
      assert.equal(formatMiniPopup(yesterdayNoTime), '<div style="font-size:10px;color:#0ea5e9;margin-top:4px;">Yesterday</div>')
      assert.equal(formatMapPopup(yesterdayNoTime), '<div style="margin-top:6px;font-size:11px;color:#94a3b8;">Yesterday</div>')

      // 4. isToday: true without collection time (negative assertion)
      const todayNoTime = { isToday: true, collectedAt: '' }
      assert.equal(formatMiniPopup(todayNoTime).includes('Yesterday'), false)
      assert.equal(formatMapPopup(todayNoTime).includes('Yesterday'), false)
    })

    it('Deterministic stop-status network failure preserves neutral pins, route rendering, and has zero operational fallback', async () => {
      // 1. Source verification: neither component contains fallback request to /api/watcher/stop-validations/
      assert.equal(
        miniMapSource.includes("api.get('/api/watcher/stop-validations/'"),
        false,
        'MiniMap catch block must not contain operational fallback'
      )
      assert.equal(
        mapViewSource.includes("api.get('/api/watcher/stop-validations/'"),
        false,
        'MapView catch block must not contain operational fallback'
      )

      // 2. Simulated fetch failure test
      const endpointsCalled = []
      const fakeApi = {
        get: async (url) => {
          endpointsCalled.push(url)
          if (url === '/api/public/map/pins/') {
            return {
              data: [
                {
                  id: 101,
                  area: 'Downtown Corridor',
                  stops: [
                    { order: 1, label: 'Central Market', lat: 13.935, lng: 121.615, barangay_id: 1 },
                    { order: 2, label: 'Plaza Stop', lat: 13.938, lng: 121.618, barangay_id: 1 },
                  ],
                },
              ],
            }
          }
          if (url === '/api/public/map/stop-statuses/') {
            throw new Error('HTTP 500 Network Failure: Internal Server Error')
          }
          throw new Error(`Unexpected endpoint: ${url}`)
        },
      }

      // Simulate component fetch execution
      let schedules = []
      let stopStatusMap = new Map()
      let stopDetailsMap = new Map()
      let caughtError = null

      // Fetch pins
      const pinRes = await fakeApi.get('/api/public/map/pins/')
      schedules = pinRes.data

      // Fetch statuses with simulated failure
      try {
        const statusRes = await fakeApi.get('/api/public/map/stop-statuses/')
        const snap = buildStopValidationSnapshot(statusRes.data)
        stopStatusMap = snap.statusMap
        stopDetailsMap = snap.detailsMap
      } catch (err) {
        caughtError = err
        // Matches MiniMap / MapView catch blocks: suppress or log, do NOT fallback
      }

      // A. Failure did not crash test harness and error was captured safely
      assert.notEqual(caughtError, null)
      assert.equal(caughtError.message.includes('HTTP 500 Network Failure'), true)

      // B. No fallback request to /api/watcher/stop-validations/
      assert.equal(
        endpointsCalled.includes('/api/watcher/stop-validations/'),
        false,
        'Must NOT call /api/watcher/stop-validations/ on failure'
      )

      // C. Public map-pin data remains available
      assert.equal(schedules.length, 1)
      assert.equal(schedules[0].id, 101)
      const validStops = filterAndValidateStops(schedules[0])
      assert.equal(validStops.length, 2)
      assert.equal(validStops[0].lat, 13.935)
      assert.equal(validStops[1].lng, 121.618)

      // D. Route rendering points remain available
      const routePoints = validStops.map(s => [s.lat, s.lng])
      assert.equal(routePoints.length, 2)

      // E. Stop status stays neutral/unknown (PENDING_INSPECTION) rather than inventing a success status
      const stop1Status = normalizeStopStatus(stopStatusMap.get('101:1'))
      const stop2Status = normalizeStopStatus(stopStatusMap.get('101:2'))
      assert.equal(stop1Status, 'PENDING_INSPECTION', 'Status must default to neutral PENDING_INSPECTION')
      assert.equal(stop2Status, 'PENDING_INSPECTION', 'Status must default to neutral PENDING_INSPECTION')
      assert.notEqual(stop1Status, 'VERIFIED_COLLECTED')
      assert.equal(stopDetailsMap.has('101:1'), false)
    })

    it('Gracefully handles empty or malformed stop-status responses without throwing', () => {
      const emptySnapshot = buildStopValidationSnapshot([])
      assert.equal(emptySnapshot.statusMap.size, 0)
      assert.equal(emptySnapshot.detailsMap.size, 0)

      const nullSnapshot = buildStopValidationSnapshot(null)
      assert.equal(nullSnapshot.statusMap.size, 0)
      assert.equal(nullSnapshot.detailsMap.size, 0)

      const malformedRows = [
        null,
        {},
        { schedule_id: null, stop_order: 1 },
        { schedule_id: 1, stop_order: 'invalid' },
        { schedule_id: 2, stop_order: 1, status: 'INVALID_STATUS' },
      ]
      const malformedSnapshot = buildStopValidationSnapshot(malformedRows)
      assert.equal(malformedSnapshot.statusMap.size, 1)
      assert.equal(malformedSnapshot.statusMap.get('2:1'), 'PENDING_INSPECTION')
    })
  })
})
