/**
 * test-navcamera-lifecycle.mjs
 * Deterministic queued-frame lifecycle test for NavCamera (Stage 2D-B1).
 * Verifies all required behavioral criteria without mocked rAF truncation.
 */
import { NavCamera } from '../../wastewatch/frontend/src/pages/driver/components/navCamera.js'

// Deterministic rAF queue mock
let nextRafId = 1
const queuedCallbacks = new Map()
let allowCancellation = true
let mockTime = 1000

globalThis.performance = {
  now: () => mockTime,
}

globalThis.requestAnimationFrame = (cb) => {
  const id = nextRafId++
  queuedCallbacks.set(id, cb)
  return id
}

globalThis.cancelAnimationFrame = (id) => {
  if (allowCancellation) {
    queuedCallbacks.delete(id)
  }
}

function frame(dt = 16) {
  mockTime += dt
  // Snapshot current queue so frames scheduled inside a callback wait for next tick
  const current = Array.from(queuedCallbacks.entries())
  queuedCallbacks.clear()
  for (const [id, cb] of current) {
    cb(mockTime)
  }
}

function flushFrames(maxCount = 150, dt = 16) {
  let executed = 0
  while (queuedCallbacks.size > 0 && executed < maxCount) {
    frame(dt)
    executed++
  }
  return executed
}

function queueSize() {
  return queuedCallbacks.size
}

function clearQueue() {
  queuedCallbacks.clear()
}

function createMockEnv() {
  const calls = {
    panTo: [],
    setLatLng: [],
    invalidateSize: 0,
  }

  const viewportEl = {
    style: {
      webkitMaskImage: 'none',
      maskImage: 'none',
    },
    getBoundingClientRect: () => ({ width: 390, height: 784, top: 0, left: 0, right: 390, bottom: 784 }),
  }

  const mapEl = {
    style: {
      width: '100%',
      height: '100%',
      transform: 'none',
      transition: 'none',
      left: '0px',
      top: '0px',
      transformOrigin: '50% 50%',
    },
  }

  const wrapperEl = {
    className: 'ww-truck-sprite-wrapper',
    style: {
      transform: 'none',
      transition: 'none',
    },
  }

  const markerEl = {
    querySelector: (sel) => {
      if (sel.includes('ww-truck-sprite-wrapper') || sel.includes('ww-3d-truck-wrapper')) return wrapperEl
      return null
    },
  }

  const map = {
    invalidateSize: () => { calls.invalidateSize++ },
    panTo: (latlng, opts) => { calls.panTo.push({ latlng, opts }) },
    dragging: { enable: () => {}, disable: () => {} },
    touchZoom: { enable: () => {}, disable: () => {} },
    scrollWheelZoom: { enable: () => {}, disable: () => {} },
    doubleClickZoom: { enable: () => {}, disable: () => {} },
    boxZoom: { enable: () => {}, disable: () => {} },
  }

  const marker = {
    getElement: () => markerEl,
    setLatLng: (latlng) => { calls.setLatLng.push(latlng) },
  }

  return {
    viewportEl,
    mapEl,
    wrapperEl,
    getMap: () => map,
    getMarker: () => marker,
    calls,
  }
}

const results = []
function assert(name, condition, extra = '') {
  const status = condition ? 'PASS' : 'FAIL'
  results.push({ name, pass: !!condition, extra })
  console.log(`[${status}] ${name}${extra ? ' -- ' + extra : ''}`)
}

console.log('=== NavCamera Deterministic Queued-Frame Lifecycle Suite ===\n')

// -----------------------------------------------------------------------------
// Check 1: Live camera animates toward its target using actual queued frames
// -----------------------------------------------------------------------------
clearQueue()
const env1 = createMockEnv()
const cam1 = new NavCamera(env1)
assert('1.1 Instance initializes with _destroyed = false', cam1._destroyed === false)

cam1.setTargetHeading(90)
assert('1.2 setTargetHeading enqueues exactly 1 animation frame', queueSize() === 1 && cam1._raf !== 0)
assert('1.3 Target heading is 90 before frames run', cam1.targetH === 90 && cam1.h === 0)

frame(16)
assert('1.4 First frame execution advances heading towards target', cam1.h > 0 && cam1.h < 90)
assert('1.5 Next frame is scheduled while unsettled', queueSize() === 1)

const framesUsed = flushFrames(150, 16)
assert('1.6 Camera converges to target within queued frames', cam1.h === 90 && cam1.settled() === true, `frames: ${framesUsed}`)
assert('1.7 rAF loop self-terminates upon settling', queueSize() === 0 && cam1._raf === 0)

// -----------------------------------------------------------------------------
// Check 2: Destroying a camera from a real 3D state resets DOM styles and cancels pending frame
// -----------------------------------------------------------------------------
clearQueue()
allowCancellation = true
const env2 = createMockEnv()
const cam2 = new NavCamera(env2)
cam2.setTargetPosition(14.0, 121.0)
cam2.setMode('3D')

// Verify genuine 3D state applied to DOM and frame scheduled
const is3DStyleApplied = env2.mapEl.style.width !== '100%' && env2.mapEl.style.transform.includes('perspective')
assert('2.1 Real 3D layout and matrix transform applied before destruction', is3DStyleApplied)
assert('2.2 Animation frame queued prior to destruction', queueSize() === 1 && cam2._raf !== 0)

cam2.destroy()
assert('2.3 destroy() marks _destroyed = true', cam2._destroyed === true)
assert('2.4 destroy() cancels pending animation frame in queue', queueSize() === 0)
assert('2.5 destroy() clears controller _raf to 0', cam2._raf === 0)
assert('2.6 destroy() resets mapEl.style.transform to "none"', env2.mapEl.style.transform === 'none')
assert('2.7 destroy() resets mapEl dimensions to "100%" and offsets to "0px"',
  env2.mapEl.style.width === '100%' && env2.mapEl.style.height === '100%' &&
  env2.mapEl.style.left === '0px' && env2.mapEl.style.top === '0px')
assert('2.8 destroy() resets viewport mask image to "none"',
  env2.viewportEl.style.maskImage === 'none' && env2.viewportEl.style.webkitMaskImage === 'none')

// -----------------------------------------------------------------------------
// Check 3: Calling destroy() a second time does not alter DOM after sentinel assigned
// -----------------------------------------------------------------------------
env2.mapEl.style.transform = 'translateX(77px)'
env2.mapEl.style.width = '333px'
cam2.destroy()
assert('3.1 Second destroy() does not alter mapEl.style.transform sentinel', env2.mapEl.style.transform === 'translateX(77px)')
assert('3.2 Second destroy() does not alter mapEl.style.width sentinel', env2.mapEl.style.width === '333px')
assert('3.3 Instance remains permanently destroyed', cam2._destroyed === true)

// -----------------------------------------------------------------------------
// Check 4: An already-queued callback after destruction cannot mutate map or marker
// -----------------------------------------------------------------------------
clearQueue()
const env4 = createMockEnv()
const cam4 = new NavCamera(env4)
cam4.setTargetPosition(14.5, 121.5)
cam4.setTargetHeading(180)
assert('4.1 Frame queued before destruction', queueSize() === 1)

// Disable cancelAnimationFrame so the queued callback remains in flight across destroy()
allowCancellation = false
cam4.destroy()
assert('4.2 Frame remains in queue due to simulated in-flight race', queueSize() === 1)

// Snapshot call counts and styles before running the orphaned frame
const panCountBefore = env4.calls.panTo.length
const setLatLngCountBefore = env4.calls.setLatLng.length
env4.mapEl.style.transform = 'translateX(12px)'
env4.wrapperEl.style.transform = 'translateY(12px)'

// Execute the orphaned callback
frame(16)
allowCancellation = true

assert('4.3 Orphaned callback exits cleanly without calling map.panTo', env4.calls.panTo.length === panCountBefore)
assert('4.4 Orphaned callback exits cleanly without calling marker.setLatLng', env4.calls.setLatLng.length === setLatLngCountBefore)
assert('4.5 Orphaned callback does not mutate mapEl transform', env4.mapEl.style.transform === 'translateX(12px)')
assert('4.6 Orphaned callback does not mutate marker wrapper transform', env4.wrapperEl.style.transform === 'translateY(12px)')
assert('4.7 Orphaned callback schedules no further frames', queueSize() === 0 && cam4._raf === 0)

// -----------------------------------------------------------------------------
// Check 5: Unsettled targets, destruction, and step() guard sensitivity
// -----------------------------------------------------------------------------
clearQueue()
allowCancellation = true
const env5 = createMockEnv()
const cam5 = new NavCamera(env5)

// 1. Give active position target
cam5.setTargetPosition(14.0, 121.0)
// 2. Give unsettled heading target
cam5.setTargetHeading(90)
// 3. Confirm pending frame exists before destruction
assert('5.1 Frame pending before destruction with unsettled targets', queueSize() === 1 && cam5._raf !== 0)

// 4. Destroy camera
cam5.destroy()
assert('5.2 destroy() marks _destroyed = true and cancels pending frame', cam5._destroyed === true && queueSize() === 0 && cam5._raf === 0)

const headingBefore5 = cam5.targetH // 90
const posBefore5 = cam5.targetPos   // { lat: 14.0, lng: 121.0 }
const modeBefore5 = cam5.mode       // '2D'
const panCountBeforeSetters = env5.calls.panTo.length
const markerCountBeforeSetters = env5.calls.setLatLng.length

// Setters called after destruction
cam5.setTargetHeading(270)
cam5.setTargetPosition(14.1, 121.2)
const returnedMode5 = cam5.setMode('3D')

assert('5.3 setTargetHeading() after destruction leaves targetH unchanged', cam5.targetH === headingBefore5)
assert('5.4 setTargetPosition() after destruction leaves targetPos unchanged',
  cam5.targetPos.lat === posBefore5.lat && cam5.targetPos.lng === posBefore5.lng)
assert('5.5 setMode() after destruction returns current mode and leaves mode unchanged', returnedMode5 === modeBefore5 && cam5.mode === modeBefore5)
assert('5.6 Setters after destruction schedule zero animation frames', queueSize() === 0 && cam5._raf === 0)
assert('5.7 Setters after destruction trigger zero map.panTo calls', env5.calls.panTo.length === panCountBeforeSetters)
assert('5.8 Setters after destruction trigger zero marker.setLatLng calls', env5.calls.setLatLng.length === markerCountBeforeSetters)

// Calling apply() directly after destruction must not mutate DOM
env5.mapEl.style.transform = 'translateX(55px)'
env5.wrapperEl.style.transform = 'translateY(55px)'
cam5.apply()
assert('5.9 Direct apply() after destruction does not mutate mapEl transform', env5.mapEl.style.transform === 'translateX(55px)')
assert('5.10 Direct apply() after destruction does not mutate marker wrapper transform', env5.wrapperEl.style.transform === 'translateY(55px)')

// Direct step() after destruction:
// Because targetH is 90 and h is 0, without the _destroyed guard in step(),
// step(16) would ease h toward 90, settled() would be false, step() would return true,
// and it would execute apply() and map.panTo().
const panCountBeforeStep = env5.calls.panTo.length
const setLatLngCountBeforeStep = env5.calls.setLatLng.length
const stepResult5 = cam5.step(16)
assert('5.11 Direct step() after destruction with unsettled targets returns false', stepResult5 === false)
assert('5.12 Direct step() after destruction does not call map.panTo', env5.calls.panTo.length === panCountBeforeStep)
assert('5.13 Direct step() after destruction does not call marker.setLatLng', env5.calls.setLatLng.length === setLatLngCountBeforeStep)

// -----------------------------------------------------------------------------
// Check 6: A fresh camera instance can animate and converge after previous destroyed
// -----------------------------------------------------------------------------
clearQueue()
const env6 = createMockEnv()
const cam6 = new NavCamera(env6)
assert('6.1 Fresh instance has _destroyed = false regardless of previous destruction', cam6._destroyed === false)

cam6.setTargetHeading(45)
flushFrames(150, 16)
assert('6.2 Fresh instance converges to 45 degrees', cam6.h === 45 && cam6.settled() === true)
assert('6.3 Fresh instance applies correct rotation to marker DOM', env6.wrapperEl.style.transform === 'rotate(45deg)')

cam6.destroy()
assert('6.4 Fresh instance destroys cleanly', cam6._destroyed === true && cam6._raf === 0 && queueSize() === 0)

// -----------------------------------------------------------------------------
// Check 7: When cancellation disabled, post-destruction callback exits without rescheduling
// Note: Check 7 exercises the queued callback together with the step() guard;
// it does not isolate the callback guard.
// Note: Destruction occurring synchronously inside an executing step() is deliberately
// not tested. The previously accepted low-severity trailing-frame limitation remains unchanged.
// -----------------------------------------------------------------------------
clearQueue()
const env7 = createMockEnv()
const cam7 = new NavCamera(env7)
cam7.setTargetHeading(60)
assert('7.1 Frame queued for active camera', queueSize() === 1)

allowCancellation = false
cam7.destroy()
assert('7.2 Frame remains queued with cancellation disabled', queueSize() === 1)

frame(16)
allowCancellation = true
assert('7.3 In-callback guard sets _raf = 0 and terminates without rescheduling', queueSize() === 0 && cam7._raf === 0)

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
const passed = results.filter(r => r.pass).length
const failed = results.filter(r => !r.pass).length
console.log(`\n=== Final Results: ${results.length} checks, ${passed} passed, ${failed} failed ===`)

if (failed > 0) {
  process.exit(1)
} else {
  process.exit(0)
}
