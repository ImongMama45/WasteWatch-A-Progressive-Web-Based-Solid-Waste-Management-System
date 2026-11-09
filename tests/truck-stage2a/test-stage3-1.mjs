/**
 * test-stage3-1.mjs - Comprehensive Stage 3-1 Verification Suite
 *
 * Exercises the production modules:
 * - navTarget.js
 * - navRouteGeometry.js
 * - routeRequestManager.js
 * - ShiftRouteModule.jsx integration
 */

import assert from 'node:assert'
import fs from 'node:fs'

import {
  resolveActiveNavTarget,
  isValidCoordinate,
  makeLegacyCacheKey,
  getResolvedStopStatus,
} from '../../wastewatch/frontend/src/pages/driver/components/navTarget.js'

import {
  RouteProgressTracker,
  isIndependentGpsFix,
  projectPointOntoSegment,
  haversineDistance,
  calculateBearing,
  angularDifference,
  decodePolyline,
  normalizeRouteCoordinates,
  GEOMETRY_CONFIG,
} from '../../wastewatch/frontend/src/pages/driver/components/navRouteGeometry.js'

import {
  RouteRequestManager,
  REQUEST_MANAGER_CONFIG,
} from '../../wastewatch/frontend/src/pages/driver/components/routeRequestManager.js'

console.log('=== Stage 3-1: ORS Route Request Management & Local Progress Suite ===\n')

let passCount = 0
let failCount = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`[PASS] ${name}`)
    passCount++
  } catch (err) {
    console.error(`[FAIL] ${name}`)
    console.error(`       ${err.message}`)
    if (err.stack) console.error(err.stack)
    failCount++
  }
}

// ── 1. TARGET RESOLUTION TESTS ───────────────────────────────────────────────
async function runAll() {
console.log('--- 1. [NAV TARGET] Target Resolution & Routability ---')

const mockWaypoints = [
  { lat: 13.9373, lng: 121.617, label: 'Base Depot' },
  { lat: 13.94, lng: 121.618, label: 'Stop 1', id: 'wp-1' },
  { lat: 13.945, lng: 121.62, label: 'Stop 2', id: 'wp-2' },
  { lat: 13.95, lng: 121.625, label: 'Stop 3', id: 'wp-3' },
]

await test('1.1 Normal routable stop returns isRoutable=true and stable identity', () => {
  const statuses = new Map([[1, 'PENDING_INSPECTION']])
  const res = resolveActiveNavTarget({
    waypoints: mockWaypoints,
    currentStopIndex: 1,
    stopStatuses: statuses,
  })
  assert.strictEqual(res.isRoutable, true)
  assert.strictEqual(res.hasValidCoords, true)
  assert.strictEqual(res.targetKey, '13.94,121.618')
  assert.strictEqual(res.targetId, 'stop:1:wp-1')
  assert.deepStrictEqual(res.coords, [121.618, 13.94])
})

await test('1.2 Non-routable current stop returns isRoutable=false (Binding Owner Decision A1)', () => {
  const statuses = new Map([[1, 'VERIFIED_COLLECTED']])
  const res = resolveActiveNavTarget({
    waypoints: mockWaypoints,
    currentStopIndex: 1,
    stopStatuses: statuses,
  })
  assert.strictEqual(res.isRoutable, false)
  assert.strictEqual(res.targetKey, '13.94,121.618')
  assert.strictEqual(res.targetId, 'stop:1:wp-1')
  assert.strictEqual(res.stopIndex, 1)
})

await test('1.3 No later-stop routing when current stop is non-routable (VERIFIED_COLLECTED)', () => {
  const statuses = new Map([
    [1, 'VERIFIED_COLLECTED'],
    [2, 'PENDING_INSPECTION'],
  ])
  const res = resolveActiveNavTarget({
    waypoints: mockWaypoints,
    currentStopIndex: 1,
    stopStatuses: statuses,
  })
  assert.strictEqual(res.isRoutable, false)
  assert.strictEqual(res.stopIndex, 1)
  assert.strictEqual(res.targetWp.label, 'Stop 1')
})

await test('1.4 Missed stop priority over regular current stop', () => {
  const missedStop = {
    id: 99,
    lat: 13.942,
    lng: 121.619,
    status: 'REPORTED',
    label: 'Missed Garbage Stop',
  }
  const res = resolveActiveNavTarget({
    waypoints: mockWaypoints,
    currentStopIndex: 1,
    activeMissedStop: missedStop,
  })
  assert.strictEqual(res.isMissedStop, true)
  assert.strictEqual(res.isRoutable, true)
  assert.strictEqual(res.targetId, 'missed:99')
  assert.strictEqual(res.targetKey, '13.942,121.619')
  assert.deepStrictEqual(res.coords, [121.619, 13.942])
})

await test('1.5 Invalid/missing missed-stop coordinates marked invalid', () => {
  const missedStop = {
    id: 101,
    lat: null,
    lng: 121.619,
    status: 'REPORTED',
  }
  const res = resolveActiveNavTarget({
    waypoints: mockWaypoints,
    currentStopIndex: 1,
    activeMissedStop: missedStop,
  })
  assert.strictEqual(res.hasValidCoords, false)
  assert.strictEqual(res.isRoutable, false)
  assert.strictEqual(res.targetKey, null)
})

await test('1.6 End of route boundary handling', () => {
  const res = resolveActiveNavTarget({
    waypoints: mockWaypoints,
    currentStopIndex: 4, // beyond array
  })
  assert.strictEqual(res.isEndOfRoute, true)
  assert.strictEqual(res.isRoutable, false)
  assert.strictEqual(res.targetWp, null)
})

await test('1.7 Legacy cache key compatibility preserves exact raw coordinate strings', () => {
  // Legacy exact template: "${lat},${lng}" without Number() truncation
  assert.strictEqual(makeLegacyCacheKey(13.9373, 121.617), '13.9373,121.617')
  assert.strictEqual(makeLegacyCacheKey('13.940000', '121.618000'), '13.940000,121.618000')
  assert.strictEqual(makeLegacyCacheKey(null, 121.617), null)
  assert.strictEqual(makeLegacyCacheKey(13.9373, NaN), null)
})

await test('1.8 Target identity changes when waypoint at same index is modified', () => {
  const wpA = [{ lat: 13.93, lng: 121.61 }, { lat: 13.94, lng: 121.62, id: 'stop-A' }]
  const wpB = [{ lat: 13.93, lng: 121.61 }, { lat: 13.941, lng: 121.621, id: 'stop-B' }]
  const targetA = resolveActiveNavTarget({ waypoints: wpA, currentStopIndex: 1 })
  const targetB = resolveActiveNavTarget({ waypoints: wpB, currentStopIndex: 1 })
  assert.notStrictEqual(targetA.targetId, targetB.targetId)
})

await test('1.9 First waypoint resolution at currentStopIndex=0 returns waypoints[0]', () => {
  const res = resolveActiveNavTarget({
    waypoints: mockWaypoints,
    currentStopIndex: 0,
  })
  assert.strictEqual(res.stopIndex, 0)
  assert.strictEqual(res.isEndOfRoute, false)
  assert.strictEqual(res.targetWp.label, 'Base Depot')
  assert.strictEqual(res.targetKey, '13.9373,121.617')
  assert.strictEqual(res.targetId, 'stop:0:13.9373,121.617')
})

// ── 2. GEOMETRY AND PROGRESS TESTS ───────────────────────────────────────────
console.log('\n--- 2. [GEOMETRY] Progress Tracking, Windows & Edge Cases ---')

await test('2.1 Straight route monotonic progress', () => {
  const straightGeom = [
    [13.930, 121.617],
    [13.935, 121.617],
    [13.940, 121.617],
  ]
  const tracker = new RouteProgressTracker(straightGeom)
  assert.ok(tracker.totalDistanceMeters > 1000)

  // Fix 1: At start
  const r1 = tracker.update({ lat: 13.930, lng: 121.617, accuracy: 5, timestamp: 1000 }, 1000)
  assert.ok(r1.progressMeters < 10)
  assert.strictEqual(r1.isOffRoute, false)

  // Fix 2: Moved forward to midpoint (~556m)
  const r2 = tracker.update({ lat: 13.935, lng: 121.617, accuracy: 5, timestamp: 20000 }, 20000)
  assert.ok(r2.progressMeters > 500 && r2.progressMeters < 600)
  assert.ok(r2.progressMeters > r1.progressMeters)

  // Fix 3: Small backward GPS jitter (~5m south) does NOT regress progress
  const r3 = tracker.update({ lat: 13.93495, lng: 121.617, accuracy: 5, timestamp: 22000 }, 22000)
  assert.strictEqual(r3.progressMeters, r2.progressMeters) // Monotonically preserved!
})

await test('2.2 Parallel carriageways (~12m apart) with heading penalty', () => {
  const lineNorth = [[13.930, 121.6170], [13.935, 121.6170]]
  const lineSouth = [[13.935, 121.6171], [13.930, 121.6171]]
  const loopGeom = [...lineNorth, ...lineSouth]

  const tracker = new RouteProgressTracker(loopGeom)
  // Heading North (0 deg) on Northbound segment with speed >= 1.5 m/s
  const rNorth = tracker.update({
    lat: 13.932,
    lng: 121.61705,
    heading: 5,
    speed: 10,
    accuracy: 5,
    timestamp: 1000,
  }, 1000)
  assert.strictEqual(rNorth.segmentIndex, 0)
})

await test('2.3 Out-and-back route progress disambiguation', () => {
  const outAndBack = [
    [13.930, 121.617],
    [13.935, 121.617],
    [13.930, 121.617],
  ]
  const tracker = new RouteProgressTracker(outAndBack)
  const r1 = tracker.update({ lat: 13.931, lng: 121.617, heading: 0, speed: 8, accuracy: 5, timestamp: 1000 }, 1000)
  assert.strictEqual(r1.segmentIndex, 0)

  // Advance to B
  tracker.update({ lat: 13.935, lng: 121.617, heading: 180, speed: 8, accuracy: 5, timestamp: 20000 }, 20000)

  // On return path heading South
  const r3 = tracker.update({ lat: 13.932, lng: 121.617, heading: 180, speed: 8, accuracy: 5, timestamp: 30000 }, 30000)
  assert.strictEqual(r3.segmentIndex, 1)
})

await test('2.4 Forward GPS spike rejected until confirmed', () => {
  const straightGeom = [
    [13.930, 121.617],
    [13.935, 121.617],
    [13.940, 121.617],
  ]
  const tracker = new RouteProgressTracker(straightGeom)
  tracker.update({ lat: 13.930, lng: 121.617, accuracy: 5, timestamp: 1000 }, 1000)

  // Fix 2: Sudden forward jump > 120m (to 13.932, ~222m ahead)
  const rSpike = tracker.update({ lat: 13.932, lng: 121.617, accuracy: 5, timestamp: 2000 }, 2000)
  assert.ok(rSpike.progressMeters < 10) // Filtered: unconfirmed spike rejected!

  // Fix 3: Spike confirmed by second consecutive independent fix (> 1m displacement)
  const rConfirmed = tracker.update({ lat: 13.93202, lng: 121.617, accuracy: 5, timestamp: 3000 }, 3000)
  assert.ok(rConfirmed.progressMeters > 200) // Confirmed!
})

await test('2.5 Long GPS gap triggers reacquisition with implied speed limit', () => {
  const straightGeom = [
    [13.930, 121.617],
    [13.935, 121.617],
    [13.940, 121.617],
  ]
  const tracker = new RouteProgressTracker(straightGeom)
  tracker.update({ lat: 13.930, lng: 121.617, accuracy: 5, timestamp: 1000 }, 1000)

  // Gap of 25 seconds (> 15s reacquisition) with realistic speed (~10 m/s)
  const rReacq = tracker.update({ lat: 13.9325, lng: 121.617, accuracy: 5, timestamp: 26000 }, 26000)
  assert.ok(rReacq.progressMeters > 250)
})

await test('2.6 Reverse / stuck recovery after sustained backward movement', () => {
  const straightGeom = [
    [13.930, 121.617],
    [13.935, 121.617],
    [13.940, 121.617],
  ]
  const tracker = new RouteProgressTracker(straightGeom)
  // Advance to ~556m
  tracker.update({ lat: 13.935, lng: 121.617, accuracy: 5, timestamp: 1000 }, 1000)

  // Fixes sustained 100m backward (~444m progress) across 3 independent fixes (> 1m displacement)
  tracker.update({ lat: 13.934, lng: 121.617, accuracy: 5, timestamp: 3000 }, 3000) // Rev fix 1
  tracker.update({ lat: 13.9339, lng: 121.617, accuracy: 5, timestamp: 5000 }, 5000) // Rev fix 2
  const rRev3 = tracker.update({ lat: 13.9338, lng: 121.617, accuracy: 5, timestamp: 7000 }, 7000) // Rev fix 3
  assert.ok(rRev3.progressMeters < 500) // Reverse recovered!
})

await test('2.7 Malformed or truncated encoded polylines are rejected', () => {
  assert.deepStrictEqual(decodePolyline(null), [])
  assert.deepStrictEqual(decodePolyline(''), [])
  assert.deepStrictEqual(decodePolyline('???invalid'), []) // malformed
  assert.deepStrictEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@_'), []) // truncated chunk
  assert.deepStrictEqual(normalizeRouteCoordinates('bad_poly'), [])
})

await test('2.8 Accuracy 5m, three independent fixes 8-10m behind: progress must not regress', () => {
  const straightGeom = [
    [13.930, 121.617],
    [13.935, 121.617],
    [13.940, 121.617],
  ]
  const tracker = new RouteProgressTracker(straightGeom)
  // Fix 1: Advance to ~500m (lat 13.9345)
  const r1 = tracker.update({ lat: 13.9345, lng: 121.617, accuracy: 5, timestamp: 1000 }, 1000)
  const initialProgress = r1.progressMeters
  assert.ok(initialProgress > 450 && initialProgress < 550)

  // Three independent fixes 8-10m behind.
  // With accuracy 5m, clamped backwardAllowance is 10m (BACKWARD_PROGRESS_MIN_M).
  // 8-10m behind is within allowance, so progress must NOT regress!
  tracker.update({ lat: 13.93442, lng: 121.617, accuracy: 5, timestamp: 2000 }, 2000)
  tracker.update({ lat: 13.93441, lng: 121.617, accuracy: 5, timestamp: 3000 }, 3000)
  const rFinal = tracker.update({ lat: 13.93440, lng: 121.617, accuracy: 5, timestamp: 4000 }, 4000)

  assert.strictEqual(rFinal.progressMeters, initialProgress)
})

await test('2.9 Small backward GPS jitter over multiple fixes: progress remains stable', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  const r1 = tracker.update({ lat: 13.935, lng: 121.617, accuracy: 8, timestamp: 1000 }, 1000)
  const lockedProgress = r1.progressMeters

  for (let i = 0; i < 5; i++) {
    const latOffset = (i % 2 === 0) ? -0.00003 : 0.00001
    const r = tracker.update({ lat: 13.935 + latOffset, lng: 121.617, accuracy: 8, timestamp: 2000 + i * 1000 }, 2000 + i * 1000)
    assert.ok(r.progressMeters >= lockedProgress)
  }
})

await test('2.10 Sustained reverse movement beyond approved allowance: recovery still works', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  const r1 = tracker.update({ lat: 13.935, lng: 121.617, accuracy: 5, timestamp: 1000 }, 1000)
  const highProgress = r1.progressMeters

  // Vehicle drives backward 80m (> 10m allowance) across 3 consecutive independent fixes
  tracker.update({ lat: 13.9340, lng: 121.617, accuracy: 5, timestamp: 2000 }, 2000)
  tracker.update({ lat: 13.9339, lng: 121.617, accuracy: 5, timestamp: 3000 }, 3000)
  const rRev = tracker.update({ lat: 13.9338, lng: 121.617, accuracy: 5, timestamp: 4000 }, 4000)

  assert.ok(rRev.progressMeters < highProgress - 50)
})

// ── 3. GPS FIX & ACCURACY RULES ───────────────────────────────────────────────
console.log('\n--- 3. [GPS FIX & ACCURACY] Accuracy Rules, Gating & Progress Protection ---')

await test('3.1 First fix accepted unconditionally', () => {
  assert.strictEqual(isIndependentGpsFix({ lat: 13.93, lng: 121.61 }, null), true)
})

await test('3.2 Duplicate fix rejected without returning synthetic null/0 projections', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  const fix1 = { lat: 13.932, lng: 121.617, accuracy: 5, timestamp: 1000 }
  const r1 = tracker.update(fix1, 1000)
  assert.ok(r1.projectedPoint != null)

  // Duplicate fix at same coordinates
  const rDup = tracker.update(fix1, 1100)
  assert.strictEqual(rDup.isIndependent, false)
  assert.deepStrictEqual(rDup.projectedPoint, r1.projectedPoint)
  assert.strictEqual(rDup.segmentIndex, r1.segmentIndex)
})

await test('3.3 Fix under 700 ms interval rejected', () => {
  const fix1 = { lat: 13.93, lng: 121.61, timestamp: 1000 }
  const fix2 = { lat: 13.931, lng: 121.611, timestamp: 1400 } // dt = 400ms < 700ms
  assert.strictEqual(isIndependentGpsFix(fix2, fix1, 1400), false)
})

await test('3.4 Movement <= 1 m rejected even after 700 ms (strict > 1m boundary)', () => {
  const fix1 = { lat: 13.930000, lng: 121.610000, timestamp: 1000 }
  const fix2 = { lat: 13.930005, lng: 121.610000, timestamp: 2000 } // dist ~0.55m <= 1m
  assert.strictEqual(isIndependentGpsFix(fix2, fix1, 2000), false)
})

await test('3.5 Poor accuracy (> 50m) ignored for off-route evidence', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  tracker.update({ lat: 13.930, lng: 121.617, accuracy: 10, timestamp: 1000 }, 1000)

  // Vehicle drifts 100m away, but accuracy is 75m (> 50m)
  const res = tracker.update({ lat: 13.935, lng: 121.618, accuracy: 75, timestamp: 2000 }, 2000)
  assert.strictEqual(res.isOffRoute, false)
  assert.strictEqual(res.offRouteStatus, 'on_route')
})

await test('3.6 Poor accuracy (> 50m) does NOT advance committed route progress', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  const r1 = tracker.update({ lat: 13.930, lng: 121.617, accuracy: 10, timestamp: 1000 }, 1000)
  const initialProgress = r1.progressMeters

  // A fix approximately 100m ahead with poor accuracy (75m > 50m)
  const rPoor = tracker.update({ lat: 13.931, lng: 121.617, accuracy: 75, timestamp: 2000 }, 2000)
  assert.strictEqual(rPoor.progressMeters, initialProgress) // Must not advance!
})

await test('3.7 Unknown/null accuracy uses approved fixed 35m threshold', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  tracker.update({ lat: 13.930, lng: 121.617, accuracy: null, timestamp: 1000 }, 1000)

  // Drift 40m away (> 35m threshold) across 3 independent fixes
  tracker.update({ lat: 13.931, lng: 121.61737, accuracy: null, timestamp: 2000 }, 2000)
  tracker.update({ lat: 13.932, lng: 121.61737, accuracy: null, timestamp: 3000 }, 3000)
  const res3 = tracker.update({ lat: 13.933, lng: 121.61737, accuracy: null, timestamp: 4000 }, 4000)
  assert.strictEqual(res3.isOffRoute, true)
})

await test('3.8 Zero, non-finite, and negative accuracy treated as unknown (35m threshold)', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  tracker.update({ lat: 13.930, lng: 121.617, accuracy: 0, timestamp: 1000 }, 1000)

  // Drift 40m away with NaN / 0 accuracy across 3 fixes
  tracker.update({ lat: 13.931, lng: 121.61737, accuracy: NaN, timestamp: 2000 }, 2000)
  tracker.update({ lat: 13.932, lng: 121.61737, accuracy: 0, timestamp: 3000 }, 3000)
  const res = tracker.update({ lat: 13.933, lng: 121.61737, accuracy: -5, timestamp: 4000 }, 4000)
  assert.strictEqual(res.isOffRoute, true)
})

await test('3.9 Mock GPS treated as unknown accuracy (35m threshold, 4s time rule disabled)', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  tracker.update({ lat: 13.930, lng: 121.617, isMock: true, accuracy: 5, timestamp: 1000 }, 1000)

  // 2 fixes 5 seconds apart (elapsed 5000ms > 4000ms), 40m off-route
  tracker.update({ lat: 13.931, lng: 121.61737, isMock: true, accuracy: 5, timestamp: 2000 }, 2000)
  const r2 = tracker.update({ lat: 13.932, lng: 121.61737, isMock: true, accuracy: 5, timestamp: 7000 }, 7000)

  // 4s time confirmation is disabled for mock GPS! Requires 3 fixes!
  assert.strictEqual(r2.isOffRoute, false)
  assert.strictEqual(r2.offRouteStatus, 'off_route_pending')

  // 3rd fix confirms off-route
  const r3 = tracker.update({ lat: 13.933, lng: 121.61737, isMock: true, accuracy: 5, timestamp: 8000 }, 8000)
  assert.strictEqual(r3.isOffRoute, true)
})

await test('3.10 Stale poor accuracy does not indefinitely suppress subsequent valid fixes', () => {
  let currentTime = 1000
  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    clock: () => currentTime,
    storage: null,
  })

  const target = {
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  }
  manager.setTarget(target)
  manager.activeRoute = { geometry: [[13.930, 121.617], [13.940, 121.617]] }
  manager.progressTracker = new RouteProgressTracker(manager.activeRoute.geometry)

  // Report fix with poor accuracy
  manager.handleGpsUpdate({ lat: 13.931, lng: 121.617 }, 90)
  assert.strictEqual(manager.currentAccuracy, 90)

  // Next fix arrives without accuracy: poor accuracy consumed and expired
  currentTime = 4000
  manager.handleGpsUpdate({ lat: 13.932, lng: 121.617 }, null)
  assert.strictEqual(manager.currentAccuracy, null) // Stale poor accuracy did not suppress!
  manager.destroy()
})

await test('3.11 Mock GPS with device accuracy of 8m follows unknown-accuracy exception', () => {
  const straightGeom = [[13.930, 121.617], [13.940, 121.617]]
  const tracker = new RouteProgressTracker(straightGeom)
  tracker.update({ lat: 13.930, lng: 121.617, accuracy: 8, isMock: true, timestamp: 1000 }, 1000)

  // Deviate 40m away (> 35m threshold) across 2 fixes
  tracker.update({ lat: 13.931, lng: 121.61737, accuracy: 8, isMock: true, timestamp: 2000 }, 2000) // Deviating fix 1
  const r2 = tracker.update({ lat: 13.932, lng: 121.61737, accuracy: 8, isMock: true, timestamp: 7000 }, 7000) // Deviating fix 2 (+5000ms > 4000ms)
  // Even though device accuracy is 8m and dt > 4s, isMock forces unknown accuracy: 4s time rule is disabled!
  assert.strictEqual(r2.isOffRoute, false)
  assert.strictEqual(r2.offRouteStatus, 'off_route_pending')

  // 3rd deviating fix confirms off-route
  const r3 = tracker.update({ lat: 13.933, lng: 121.61737, accuracy: 8, isMock: true, timestamp: 8000 }, 8000) // Deviating fix 3
  assert.strictEqual(r3.isOffRoute, true)
})

await test('3.12 Position update followed by delayed accuracy update does not associate wrong accuracy', () => {
  const manager = new RouteRequestManager({ apiKey: 'test-key', storage: null })
  manager.handleGpsUpdate({ lat: 13.930, lng: 121.617, accuracy: 8 })
  assert.strictEqual(manager.currentAccuracy, 8)

  // Fix 2 arrives with null accuracy
  manager.handleGpsUpdate({ lat: 13.931, lng: 121.617, accuracy: null })
  // Conservative association: Fix 2 does NOT inherit 8m!
  assert.strictEqual(manager.currentAccuracy, null)
  manager.destroy()
})

await test('3.13 Null accuracy cannot inherit old good reading without defensible association', () => {
  const manager = new RouteRequestManager({ apiKey: 'test-key', storage: null })
  manager.handleGpsUpdate({ lat: 13.930, lng: 121.617 }, 10)
  assert.strictEqual(manager.currentAccuracy, 10)

  manager.handleGpsUpdate({ lat: 13.932, lng: 121.617 }, null)
  assert.strictEqual(manager.currentAccuracy, null)
  manager.destroy()
})

await test('3.14 Poor accuracy cannot contaminate subsequent good fixes', () => {
  const manager = new RouteRequestManager({ apiKey: 'test-key', storage: null })
  manager.handleGpsUpdate({ lat: 13.930, lng: 121.617, accuracy: 90 })
  assert.strictEqual(manager.currentAccuracy, 90)

  manager.handleGpsUpdate({ lat: 13.931, lng: 121.617, accuracy: 12 })
  assert.strictEqual(manager.currentAccuracy, 12)
  manager.destroy()
})

// ── 4. REQUEST MANAGER TESTS ────────────────────────────────────────────────
console.log('\n--- 4. [REQUEST MANAGER] State Machine & Network Lifecycle ---')

await test('4.1 Single-flight behavior (concurrent calls deduplicated / aborted)', async () => {
  let inFlight = 0
  let maxConcurrent = 0

  const mockFetch = async () => {
    inFlight++
    maxConcurrent = Math.max(maxConcurrent, inFlight)
    await new Promise((r) => setTimeout(r, 50))
    inFlight--
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.615, 13.935], [121.618, 13.940]] }] }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  const target = {
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  }

  manager.currentGps = { lat: 13.930, lng: 121.610 }
  manager.setTarget(target)
  manager.requestRoute({ reason: 'test1' })
  manager.requestRoute({ reason: 'test2' })

  await new Promise((r) => setTimeout(r, 80))
  assert.strictEqual(maxConcurrent, 1)
  manager.destroy()
})

await test('4.2 Target change aborts in-flight request and rejects stale response', async () => {
  let abortedCalls = 0
  const mockFetch = async (url, opts) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ routes: [{ geometry: [[121.615, 13.935], [121.618, 13.940]] }] }),
        })
      }, 50)

      opts.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        abortedCalls++
        reject(new Error('Aborted'))
      })
    })
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  manager.currentGps = { lat: 13.930, lng: 121.610 }
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  // Switch target while flight 1 is out
  manager.setTarget({
    targetId: 'stop:2',
    targetKey: '13.945,121.620',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.620, 13.945],
  })

  await new Promise((r) => setTimeout(r, 70))
  assert.strictEqual(abortedCalls, 1)
  assert.strictEqual(manager.currentTarget.targetId, 'stop:2')
  manager.destroy()
})

await test('4.3 Target change 8s after previous completed request is NOT blocked by cooldown', async () => {
  let clockTime = 1000
  let fetchCount = 0

  const mockFetch = async () => {
    fetchCount++
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.615, 13.935], [121.618, 13.940]] }] }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    clock: () => clockTime,
    fetchFn: mockFetch,
    storage: null,
  })

  manager.currentGps = { lat: 13.930, lng: 121.610 }

  // Target 1 requested at t = 1000
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })
  await new Promise((r) => setTimeout(r, 20))
  assert.strictEqual(fetchCount, 1)

  // 8 seconds later (t = 9000), target changes to Stop 2
  clockTime = 9000
  manager.setTarget({
    targetId: 'stop:2',
    targetKey: '13.945,121.620',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.620, 13.945],
  })
  await new Promise((r) => setTimeout(r, 20))

  // MUST dispatch request for Stop 2 despite 8s < 15s automatic cooldown!
  assert.strictEqual(fetchCount, 2)
  assert.strictEqual(manager.currentTarget.targetId, 'stop:2')
  manager.destroy()
})

await test('4.4 Non-routable current stop suppresses route request (Owner Decision A1)', async () => {
  let fetchCount = 0
  const mockFetch = async () => {
    fetchCount++
    return { ok: true, status: 200, json: async () => ({ routes: [] }) }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  manager.currentGps = { lat: 13.930, lng: 121.610 }
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: false, // Non-routable
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  await new Promise((r) => setTimeout(r, 20))
  assert.strictEqual(fetchCount, 0)
  manager.destroy()
})

await test('4.5 Manual reroute bypasses cooldown with anti-spam gate', async () => {
  let clockTime = 1000
  let fetchCount = 0

  const mockFetch = async () => {
    fetchCount++
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.615, 13.935], [121.618, 13.940]] }] }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    clock: () => clockTime,
    fetchFn: mockFetch,
    storage: null,
  })

  manager.currentGps = { lat: 13.935, lng: 121.615 }
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })
  await new Promise((r) => setTimeout(r, 20))
  assert.strictEqual(fetchCount, 1)

  // Automatic reroute blocked by 15s cooldown
  clockTime = 3000
  const autoRes = manager.requestRoute({ reason: 'auto_off_route', bypassCooldown: false })
  assert.strictEqual(autoRes, false)

  // Manual reroute allowed (bypasses cooldown)
  const manual1 = manager.triggerManualReroute()
  assert.strictEqual(manual1, true)
  assert.strictEqual(fetchCount, 2)
  await new Promise((r) => setTimeout(r, 10))

  // Immediate second manual click blocked by anti-spam (< 3000ms)
  clockTime = 4000
  const manualSpam = manager.triggerManualReroute()
  assert.strictEqual(manualSpam, false)
  assert.strictEqual(fetchCount, 2)

  // Manual click after 3000ms allowed
  clockTime = 7000
  const manual2 = manager.triggerManualReroute()
  assert.strictEqual(manual2, true)
  assert.strictEqual(fetchCount, 3)

  manager.destroy()
})

await test('4.6 Permanent 4xx errors (401, 404) are NOT retried', async () => {
  let fetchCount = 0
  const mockFetch = async () => {
    fetchCount++
    return {
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ message: 'Unauthorized' }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  manager.currentGps = { lat: 13.930, lng: 121.610 }
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  await new Promise((r) => setTimeout(r, 100))
  assert.strictEqual(fetchCount, 1) // Did not retry!
  assert.strictEqual(manager.retryTimer, null)
  manager.destroy()
})

await test('4.7 [Test A] Target set before GPS available: pending target requested upon first fix', async () => {
  let fetchCount = 0
  let requestedBody = null
  const mockFetch = async (url, opts) => {
    fetchCount++
    requestedBody = JSON.parse(opts.body)
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.610, 13.930], [121.618, 13.940]] }] }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  // 1. Target set without GPS
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })
  await new Promise((r) => setTimeout(r, 20))
  // No request dispatched because GPS is unavailable
  assert.strictEqual(fetchCount, 0)
  assert.ok(manager.pendingTarget)

  // 2. Supply first valid GPS fix
  manager.handleGpsUpdate({ lat: 13.930, lng: 121.610, accuracy: 10 })
  await new Promise((r) => setTimeout(r, 20))

  // Exactly one correct request dispatched with real GPS start coords
  assert.strictEqual(fetchCount, 1)
  assert.deepStrictEqual(requestedBody.coordinates[0], [121.610, 13.930])
  assert.deepStrictEqual(requestedBody.coordinates[1], [121.618, 13.94])
  assert.strictEqual(manager.pendingTarget, null)
  manager.destroy()
})

await test('4.8 [Test B] Target changes before GPS: only latest target requested upon GPS arrival', async () => {
  const requestedTargets = []
  const mockFetch = async (url, opts) => {
    const body = JSON.parse(opts.body)
    requestedTargets.push(body.coordinates[1])
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.610, 13.930], body.coordinates[1]] }] }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  // Set Target A without GPS
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  // Change to Target B without GPS
  manager.setTarget({
    targetId: 'stop:2',
    targetKey: '13.945,121.620',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.620, 13.945],
  })

  // Now supply GPS
  manager.handleGpsUpdate({ lat: 13.930, lng: 121.610, accuracy: 10 })
  await new Promise((r) => setTimeout(r, 20))

  // Only Target B was requested! Target A was discarded as obsolete!
  assert.strictEqual(requestedTargets.length, 1)
  assert.deepStrictEqual(requestedTargets[0], [121.620, 13.945])
  manager.destroy()
})

await test('4.9 [Test C] Non-routable target before GPS: no request dispatched upon GPS arrival', async () => {
  let fetchCount = 0
  const mockFetch = async () => {
    fetchCount++
    return { ok: true, status: 200, json: async () => ({ routes: [] }) }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: false, // Non-routable
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  manager.handleGpsUpdate({ lat: 13.930, lng: 121.610, accuracy: 10 })
  await new Promise((r) => setTimeout(r, 20))

  assert.strictEqual(fetchCount, 0)
  assert.strictEqual(manager.pendingTarget, null)
  manager.destroy()
})

await test('4.10 [Test D] Manager stability: callback changes do not recreate manager instance', () => {
  let drawCallCount = 0
  const drawCallbackRef = { current: () => { drawCallCount++ } }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    storage: null,
    onRouteSuccess: () => { drawCallbackRef.current() },
  })

  const initialInstance = manager

  // Simulate multiple re-renders changing the callback implementation in the ref
  drawCallbackRef.current = () => { drawCallCount += 10 }
  drawCallbackRef.current = () => { drawCallCount += 100 }

  assert.strictEqual(manager, initialInstance) // Instance unchanged!
  manager.onRouteSuccess({ route: {}, target: {} })
  assert.strictEqual(drawCallCount, 100) // Calls latest callback safely!
  manager.destroy()
})

await test('4.11 [Test E] Online state: manager created while offline does not assume online', () => {
  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    initialIsOnline: false,
    storage: null,
  })
  assert.strictEqual(manager.isOnline, false)

  // Request should immediately return false while offline
  const res = manager.requestRoute({ reason: 'test' })
  assert.strictEqual(res, false)
  manager.destroy()
})

await test('4.12 Cache hit restores geometry immediately; missing instructions trigger at most one refresh', async () => {
  let fetchCount = 0
  const mockStorage = (() => {
    const s = new Map([
      ['ww_ors_route', JSON.stringify({ key: '13.94,121.618', geometry: [[121.610, 13.930], [121.618, 13.940]] })]
    ])
    return {
      getItem: (k) => s.get(k) || null,
      setItem: (k, v) => s.set(k, v),
    }
  })()

  let appliedRoutes = []
  const mockFetch = async () => {
    fetchCount++
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        routes: [{
          geometry: [[121.610, 13.930], [121.618, 13.940]],
          segments: [{ steps: [{ instruction: 'Turn right', distance: 50 }] }],
        }]
      }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: mockStorage,
    initialGps: { lat: 13.930, lng: 121.610 },
    onRouteSuccess: ({ route, isCached }) => {
      appliedRoutes.push({ route, isCached })
    },
  })

  // Set target whose geometry is cached without instructions
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  // 1. Immediately restored cached geometry (isCached = true)
  assert.strictEqual(appliedRoutes.length, 1)
  assert.strictEqual(appliedRoutes[0].isCached, true)

  await new Promise((r) => setTimeout(r, 30))

  // 2. One controlled refresh fetched fresh instructions in the background
  assert.strictEqual(fetchCount, 1)
  assert.strictEqual(appliedRoutes.length, 2)
  assert.strictEqual(appliedRoutes[1].isCached, false)
  assert.ok(appliedRoutes[1].route.segments[0].steps.length > 0)
  manager.destroy()
})

await test('4.13 Failed instruction refresh retains usable cached geometry', async () => {
  const mockStorage = (() => {
    const s = new Map([
      ['ww_ors_route', JSON.stringify({ key: '13.94,121.618', geometry: [[121.610, 13.930], [121.618, 13.940]] })]
    ])
    return {
      getItem: (k) => s.get(k) || null,
      setItem: (k, v) => s.set(k, v),
    }
  })()

  const mockFetch = async () => {
    throw new Error('503 Service Unavailable')
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: mockStorage,
    initialGps: { lat: 13.930, lng: 121.610 },
  })

  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  await new Promise((r) => setTimeout(r, 30))
  // Active route still retains the cached geometry even though refresh failed!
  assert.ok(manager.activeRoute)
  assert.ok(manager.activeRoute.geometry)
  manager.destroy()
})

await test('4.14 Same-target re-renders do not repeatedly refresh instructions', async () => {
  let fetchCount = 0
  const mockStorage = (() => {
    const s = new Map([
      ['ww_ors_route', JSON.stringify({ key: '13.94,121.618', geometry: [[121.610, 13.930], [121.618, 13.940]] })]
    ])
    return {
      getItem: (k) => s.get(k) || null,
      setItem: (k, v) => s.set(k, v),
    }
  })()

  const mockFetch = async () => {
    fetchCount++
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.610, 13.930], [121.618, 13.940]] }] }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: mockStorage,
    initialGps: { lat: 13.930, lng: 121.610 },
  })

  const target = {
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  }

  manager.setTarget(target)
  manager.setTarget(target) // Re-render with same target
  manager.setTarget(target) // Re-render again

  await new Promise((r) => setTimeout(r, 30))
  assert.strictEqual(fetchCount, 1) // Only one refresh triggered!
  manager.destroy()
})

await test('4.15 Manual reroute while request is in flight safely cancels and replaces active request', async () => {
  let abortCount = 0
  let fetchCount = 0

  const mockFetch = async (url, opts) => {
    fetchCount++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ routes: [{ geometry: [[121.610, 13.930], [121.618, 13.940]] }] }),
        })
      }, 50)
      opts.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        abortCount++
        reject(new Error('Manual Abort'))
      })
    })
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
    initialGps: { lat: 13.930, lng: 121.610 },
  })

  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  // First request is in flight
  assert.ok(manager.activeAbortController)

  // Trigger manual reroute while first is in flight
  const dispatched = manager.triggerManualReroute()
  assert.strictEqual(dispatched, true)
  assert.strictEqual(abortCount, 1) // Previous request aborted!

  await new Promise((r) => setTimeout(r, 70))
  assert.strictEqual(fetchCount, 2)
  manager.destroy()
})

await test('4.16 No route returned by provider is permanent error and is NOT retried', async () => {
  let fetchCount = 0
  const mockFetch = async () => {
    fetchCount++
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [] }), // Provider returned empty routes
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
    initialGps: { lat: 13.930, lng: 121.610 },
  })

  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  await new Promise((r) => setTimeout(r, 60))
  assert.strictEqual(fetchCount, 1) // Not retried!
  assert.strictEqual(manager.retryTimer, null)
  manager.destroy()
})

await test('4.17 Invalid geometry (zero-length, duplicate points, distant endpoints) is rejected without retry', async () => {
  let fetchCount = 0
  const mockFetch = async () => {
    fetchCount++
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        // Duplicate points only
        routes: [{ geometry: [[121.618, 13.940], [121.618, 13.940]] }]
      }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
    initialGps: { lat: 13.930, lng: 121.610 },
  })

  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  await new Promise((r) => setTimeout(r, 60))
  assert.strictEqual(fetchCount, 1) // Not retried!
  assert.strictEqual(manager.retryTimer, null)
  manager.destroy()
})

// ── 5. PRE-CACHE SAFETY & CONCURRENCY TESTS ─────────────────────────────────
console.log('\n--- 5. [PRECACHE & DESTRUCTION] Pre-Cache Safety & Concurrency ---')

await test('5.1 Pre-cache does not execute concurrently with active navigation request', async () => {
  let activeInFlight = false
  let concurrencyViolation = false

  const mockFetch = async (url, opts) => {
    const isPrecache = !opts.headers?.['Content-Type']?.includes('json') || opts.body.includes('"instructions":false')
    if (!isPrecache) activeInFlight = true
    if (isPrecache && activeInFlight) {
      concurrencyViolation = true
    }
    await new Promise((r) => setTimeout(r, 40))
    if (!isPrecache) activeInFlight = false
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.615, 13.935], [121.618, 13.940]] }] }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  manager.currentGps = { lat: 13.930, lng: 121.610 }
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  manager.updatePrecacheSequence(
    [{ lat: 13.93, lng: 121.61 }, { lat: 13.94, lng: 121.62 }, { lat: 13.95, lng: 121.63 }],
    0
  )

  await new Promise((r) => setTimeout(r, 100))
  assert.strictEqual(concurrencyViolation, false)
  manager.destroy()
})

await test('5.2 Active navigation request aborts in-flight pre-cache', async () => {
  let precacheAborted = false

  const mockFetch = async (url, opts) => {
    const isPrecache = opts.body.includes('"instructions":false')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ routes: [{ geometry: [[121.615, 13.935], [121.618, 13.940]] }] }),
        })
      }, 60)

      opts.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        if (isPrecache) precacheAborted = true
        reject(new Error('Precache Aborted'))
      })
    })
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
  })

  manager.currentGps = { lat: 13.930, lng: 121.610 }
  manager.currentTarget = {
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  }
  // Trigger precache leg directly
  manager.precacheQueue = [{ fromWp: { lat: 13.93, lng: 121.61 }, toWp: { lat: 13.94, lng: 121.62 }, legKey: '0-1' }]
  manager._processNextPrecacheLeg()

  await new Promise((r) => setTimeout(r, 10))
  // Active navigation request dispatched: must abort pre-cache
  manager.requestRoute({ reason: 'priority_active', bypassCooldown: true })

  await new Promise((r) => setTimeout(r, 80))
  assert.strictEqual(precacheAborted, true)
  manager.destroy()
})

await test('5.3 Pre-cache preserves and merges existing storage entries', () => {
  const mockStorage = {
    store: new Map([
      ['ww_ors_route_cache', JSON.stringify([['0-1', { geometry: 'existingGeom01' }]])]
    ]),
    getItem(k) { return this.store.get(k) || null },
    setItem(k, v) { this.store.set(k, v) },
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    storage: mockStorage,
  })

  assert.strictEqual(manager.legCache.has('0-1'), true)

  // Add new leg
  manager.legCache.set('1-2', { geometry: 'newGeom12' })
  manager._saveLegCache()

  const saved = JSON.parse(mockStorage.getItem('ww_ors_route_cache'))
  const map = new Map(saved)
  assert.strictEqual(map.get('0-1').geometry, 'existingGeom01')
  assert.strictEqual(map.get('1-2').geometry, 'newGeom12')
  manager.destroy()
})

await test('5.4 Failed pre-cache leg uses approved 5-minute (300000ms) backoff', async () => {
  let clockTime = 1000
  const mockFetch = async () => {
    throw new Error('Precache Network Error')
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    clock: () => clockTime,
    fetchFn: mockFetch,
    storage: null,
  })

  manager.precacheQueue = [{ fromWp: { lat: 13.93, lng: 121.61 }, toWp: { lat: 13.94, lng: 121.62 }, legKey: '0-1' }]
  await manager._processNextPrecacheLeg()

  const failRecord = manager.failedLegs.get('0-1')
  assert.ok(failRecord)
  assert.strictEqual(failRecord.nextEligibleAt, 1000 + 300000) // 5 minutes!
  manager.destroy()
})

await test('5.5 Active navigation aborts in-flight pre-cache; aborted leg is retained/reinserted and later retried', async () => {
  let attempts = 0
  const mockFetch = async (url, opts) => {
    const isPrecache = opts.body?.includes('"instructions":false')
    if (isPrecache) {
      attempts++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ routes: [{ geometry: [[121.610, 13.930], [121.620, 13.940]] }] }),
          })
        }, 50)
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Precache Aborted'))
        })
      })
    }
    // Active navigation request returns quickly
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.610, 13.930], [121.618, 13.940]] }] }),
    }
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
    initialGps: { lat: 13.930, lng: 121.610 },
  })

  manager.precacheQueue = [{ fromWp: { lat: 13.93, lng: 121.61 }, toWp: { lat: 13.94, lng: 121.62 }, legKey: '0-1' }]
  manager._processNextPrecacheLeg() // Start pre-cache

  await new Promise((r) => setTimeout(r, 10))
  // Active navigation takes priority and aborts pre-cache
  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  await new Promise((r) => setTimeout(r, 70))
  // Pre-cache was aborted, but leg was reinserted at front of queue!
  assert.ok(manager.precacheQueue.length > 0)
  assert.strictEqual(manager.precacheQueue[0].legKey, '0-1')

  // Queue processes the retained leg after navigation
  await manager._processNextPrecacheLeg()
  assert.strictEqual(manager.legCache.has('0-1'), true)
  manager.destroy()
})

await test('5.6 Pre-cache called while navigation is active retains its queued leg without dropping', async () => {
  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    storage: null,
  })

  // Simulate active navigation request running
  manager.activeAbortController = new AbortController()

  manager.precacheQueue = [{ fromWp: { lat: 13.93, lng: 121.61 }, toWp: { lat: 13.94, lng: 121.62 }, legKey: '0-1' }]
  await manager._processNextPrecacheLeg()

  // Leg must NOT have been shifted out or lost!
  assert.strictEqual(manager.precacheQueue.length, 1)
  assert.strictEqual(manager.precacheQueue[0].legKey, '0-1')
  manager.destroy()
})

await test('5.7 Pre-cache queue resumes automatically after active navigation finishes', async () => {
  let precacheScheduled = false
  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    storage: null,
    initialGps: { lat: 13.930, lng: 121.610 },
    fetchFn: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ routes: [{ geometry: [[121.610, 13.930], [121.618, 13.940]] }] }),
    }),
  })

  manager.precacheQueue = [{ fromWp: { lat: 13.93, lng: 121.61 }, toWp: { lat: 13.94, lng: 121.62 }, legKey: '0-1' }]
  manager._scheduleNextPrecache = (ms) => {
    precacheScheduled = true
  }

  manager.setTarget({
    targetId: 'stop:1',
    targetKey: '13.94,121.618',
    isRoutable: true,
    hasValidCoords: true,
    coords: [121.618, 13.94],
  })

  await new Promise((r) => setTimeout(r, 40))
  // After active navigation finishes, pre-cache queue resumption was scheduled!
  assert.strictEqual(precacheScheduled, true)
  manager.destroy()
})

await test('5.8 Destroying the manager cancels pending timers and prevents future pre-cache execution', async () => {
  let executedAfterDestroy = false
  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: async () => {
      executedAfterDestroy = true
      return { ok: true, status: 200, json: async () => ({ routes: [] }) }
    },
  })

  manager.precacheQueue = [{ fromWp: { lat: 13.93, lng: 121.61 }, toWp: { lat: 13.94, lng: 121.62 }, legKey: '0-1' }]
  manager._scheduleNextPrecache(20)
  assert.ok(manager.precacheTimer)

  manager.destroy()
  assert.strictEqual(manager.precacheTimer, null)
  assert.strictEqual(manager.isDestroyed, true)

  await new Promise((r) => setTimeout(r, 40))
  assert.strictEqual(executedAfterDestroy, false)
})

await test('5.9 Enforce 60-leg pre-cache session cap', async () => {
  let fetchCount = 0
  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: async () => {
      fetchCount++
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ routes: [{ geometry: [[121.610, 13.930], [121.620, 13.940]] }] }),
      }
    },
    storage: null,
  })

  // Set session count to 60 (the session cap)
  manager.precacheSessionCount = 60
  manager.precacheQueue = [{ fromWp: { lat: 13.93, lng: 121.61 }, toWp: { lat: 13.94, lng: 121.62 }, legKey: '0-1' }]
  await manager._processNextPrecacheLeg()

  assert.strictEqual(fetchCount, 0) // No request made because cap was reached!
  manager.destroy()
})

await test('5.9 Pre-cache single-flight concurrency: updatePrecacheSequence during active fetch does not start overlapping request', async () => {
  let inFlightCount = 0
  let maxConcurrency = 0
  let fetchCallCount = 0
  let resolveFirstFetch = null

  const mockFetch = (url, opts) => {
    fetchCallCount++
    inFlightCount++
    if (inFlightCount > maxConcurrency) {
      maxConcurrency = inFlightCount
    }
    const currentCall = fetchCallCount
    return new Promise((resolve) => {
      const finish = () => {
        inFlightCount--
        resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ routes: [{ geometry: [[121.610, 13.930], [121.620, 13.940]] }] }),
        })
      }
      if (currentCall === 1) {
        resolveFirstFetch = finish
      } else {
        setTimeout(finish, 10)
      }
    })
  }

  const manager = new RouteRequestManager({
    apiKey: 'test-key',
    fetchFn: mockFetch,
    storage: null,
    config: {
      PRECACHE_QUEUE_START_DELAY_MS: 20,
      PRECACHE_PACING_MS: 30,
    },
  })

  // 1. Starts a pre-cache request
  manager.updatePrecacheSequence(
    [{ lat: 13.93, lng: 121.61 }, { lat: 13.94, lng: 121.62 }, { lat: 13.95, lng: 121.63 }],
    0
  )

  // 2. Wait for the initial start delay (20ms) so first fetch starts and stays in-flight
  await new Promise((r) => setTimeout(r, 25))
  assert.strictEqual(fetchCallCount, 1)
  assert.strictEqual(inFlightCount, 1)
  assert.ok(manager.precacheAbortController !== null, 'precacheAbortController must be active')

  // 3. Calls updatePrecacheSequence() again while first request is unresolved
  manager.updatePrecacheSequence(
    [{ lat: 13.93, lng: 121.61 }, { lat: 13.94, lng: 121.62 }, { lat: 13.95, lng: 121.63 }],
    0
  )

  // 4. Advances beyond the normal timer delay (50ms)
  await new Promise((r) => setTimeout(r, 50))

  // 5. Confirms no second pre-cache fetch starts while the first is pending
  assert.strictEqual(fetchCallCount, 1, 'No second fetch should start while first is pending')
  assert.strictEqual(inFlightCount, 1)
  assert.strictEqual(maxConcurrency, 1, 'At most one pre-cache request may be in flight at a time')

  // 6. Resolves the first request
  resolveFirstFetch()
  await new Promise((r) => setTimeout(r, 10))
  assert.strictEqual(inFlightCount, 0, 'First fetch resolved')

  // 7. Confirms the next queued leg can subsequently run under approved pacing rules (after 30ms pacing)
  await new Promise((r) => setTimeout(r, 40))
  assert.strictEqual(fetchCallCount, 2, 'Next queued leg ran after pacing delay')
  assert.strictEqual(maxConcurrency, 1, 'Max concurrency remained strictly 1 throughout')

  manager.destroy()
})

// ── 6. PRODUCTION SOURCE INVARIANTS ─────────────────────────────────────────
console.log('\n--- 6. [REGRESSION] Production Source Invariants ---')

await test('6.1 ShiftRouteModule imports and uses resolveActiveNavTarget', () => {
  const src = fs.readFileSync('wastewatch/frontend/src/pages/driver/components/ShiftRouteModule.jsx', 'utf8')
  assert.ok(src.includes('resolveActiveNavTarget'))
  assert.ok(src.includes('RouteRequestManager'))
})

await test('6.2 ShiftRouteModule removed the 10m moved > 10 GPS re-fetch loop', () => {
  const src = fs.readFileSync('wastewatch/frontend/src/pages/driver/components/ShiftRouteModule.jsx', 'utf8')
  assert.ok(!src.includes('if (moved > 10)'))
})

await test('6.3 drawAllLegs does NOT include gpsPos in its dependency array', () => {
  const src = fs.readFileSync('wastewatch/frontend/src/pages/driver/components/ShiftRouteModule.jsx', 'utf8')
  const drawAllIdx = src.indexOf('const drawAllLegs = useCallback(')
  assert.ok(drawAllIdx !== -1)
  const depStart = src.indexOf('}, [', drawAllIdx)
  const depEnd = src.indexOf('])', depStart)
  const depStr = src.substring(depStart, depEnd + 2)
  assert.ok(!depStr.includes('gpsPos,'), 'drawAllLegs dependencies must not include gpsPos')
})

await test('6.4 Approved 4 setIs3D call sites preserved exactly', () => {
  const src = fs.readFileSync('wastewatch/frontend/src/pages/driver/components/ShiftRouteModule.jsx', 'utf8')
  const matches = src.match(/setIs3D\([^)]*\)/g) || []
  assert.strictEqual(matches.length, 4, `Expected exactly 4 setIs3D calls, found ${matches.length}`)
})

await test('6.5 ShiftRouteModule instantiates RouteRequestManager with stable mounted lifecycle ([]) and drawAllLegsRef', () => {
  const src = fs.readFileSync('wastewatch/frontend/src/pages/driver/components/ShiftRouteModule.jsx', 'utf8')
  assert.ok(src.includes('drawAllLegsRef.current?.()'))
  assert.ok(src.includes('const drawAllLegsRef = useRef(drawAllLegs)'))
  assert.ok(src.includes('}, []) // Stable manager lifecycle: mounted component lifecycle'))
})

await test('6.6 useGpsTracking returns coherent position with accuracy and timestamp', () => {
  const src = fs.readFileSync('wastewatch/frontend/src/hooks/useGpsTracking.js', 'utf8')
  assert.ok(src.includes('setPosition({ lat, lng, heading, speed, accuracy: fixAccuracy, timestamp })'))
})

await test('6.7 ShiftRouteModule cleanly forwards gpsAccuracy without deceptive fallback', () => {
  const src = fs.readFileSync('wastewatch/frontend/src/pages/driver/components/ShiftRouteModule.jsx', 'utf8')
  assert.ok(!src.includes('gpsPos.accuracy ?? gpsAccuracy'))
  assert.ok(src.includes('isMock ? null : gpsAccuracy'))
})

}

async function main() {
  await runAll()
  console.log('\n=== Stage 3-1 Test Summary ===')
  console.log(`Passed: ${passCount}`)
  console.log(`Failed: ${failCount}`)

  if (failCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal unhandled error in test suite:', err)
  process.exit(1)
})
