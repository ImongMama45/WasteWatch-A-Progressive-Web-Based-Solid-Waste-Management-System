/**
 * test-stage2d-c.mjs
 * Verification suite for Stage 2D-C:
 * Viewport and Window Resize Architecture Correction.
 *
 * Categorized into:
 *  1. [NavCamera Unit] Mock ResizeObserver and Fake Timers Unit Suite (Checks 1-19 + Zero-Size Regression)
 *  2. [Model Sync] Component State Synchronization on Viewport Resize
 *  3. [Production Source] Direct Static Analysis of NavCamera & ShiftRouteModule.jsx
 *  4. [Mutation Self-Check] Self-verification of static analysis against defective fixtures (reusing exact rule functions)
 *
 * Zero emojis per project guidelines.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NavCamera } from '../../wastewatch/frontend/src/pages/driver/components/navCamera.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const behaviorResults = []
const modelResults = []
const staticResults = []
const mutationResults = []

function assertBehavior(name, condition, extra = '') {
  const status = condition ? 'PASS' : 'FAIL'
  behaviorResults.push({ name, pass: !!condition, extra })
  console.log(`[${status}] ${name}${extra ? ' -- ' + extra : ''}`)
}

function assertModel(name, condition, extra = '') {
  const status = condition ? 'PASS' : 'FAIL'
  modelResults.push({ name, pass: !!condition, extra })
  console.log(`[${status}] ${name}${extra ? ' -- ' + extra : ''}`)
}

function assertStatic(name, condition, extra = '') {
  const status = condition ? 'PASS' : 'FAIL'
  staticResults.push({ name, pass: !!condition, extra })
  console.log(`[${status}] ${name}${extra ? ' -- ' + extra : ''}`)
}

function assertMutation(name, condition, extra = '') {
  const status = condition ? 'PASS' : 'FAIL'
  mutationResults.push({ name, pass: !!condition, extra })
  console.log(`[${status}] ${name}${extra ? ' -- ' + extra : ''}`)
}

console.log('=== Stage 2D-C: Viewport & Resize Architecture Verification Suite ===\n')

// =============================================================================
// Helper: Deterministic Fake Clock for debounced timer control
// =============================================================================
class FakeClock {
  constructor() {
    this.now = 0
    this.timers = new Map()
    this.nextId = 1
    this.origSetTimeout = null
    this.origClearTimeout = null
  }

  install() {
    this.origSetTimeout = globalThis.setTimeout
    this.origClearTimeout = globalThis.clearTimeout
    globalThis.setTimeout = (fn, ms) => {
      const id = this.nextId++
      this.timers.set(id, { fn, time: this.now + (Number(ms) || 0) })
      return id
    }
    globalThis.clearTimeout = (id) => {
      this.timers.delete(id)
    }
  }

  uninstall() {
    if (this.origSetTimeout) globalThis.setTimeout = this.origSetTimeout
    if (this.origClearTimeout) globalThis.clearTimeout = this.origClearTimeout
  }

  advance(ms) {
    this.now += ms
    const due = []
    for (const [id, timer] of this.timers.entries()) {
      if (timer.time <= this.now) {
        due.push({ id, fn: timer.fn })
      }
    }
    due.sort((a, b) => a.id - b.id)
    for (const item of due) {
      if (this.timers.has(item.id)) {
        this.timers.delete(item.id)
        item.fn()
      }
    }
  }

  get pendingCount() {
    return this.timers.size
  }

  reset() {
    this.timers.clear()
    this.now = 0
  }
}

// Polyfill minimal rAF loop for Node environment
let nextRafId = 1
const queuedCallbacks = new Map()
globalThis.performance = globalThis.performance || { now: () => Date.now() }
globalThis.requestAnimationFrame = (cb) => {
  const id = nextRafId++
  queuedCallbacks.set(id, cb)
  return id
}
globalThis.cancelAnimationFrame = (id) => {
  queuedCallbacks.delete(id)
}

// =============================================================================
// Helper: Mock ResizeObserver
// =============================================================================
class MockResizeObserver {
  constructor(cb) {
    this.cb = cb
    this.observed = []
    this.disconnected = false
    MockResizeObserver.instances.push(this)
  }

  observe(target) {
    if (this.disconnected) return
    this.observed.push(target)
    if (MockResizeObserver.autoNotifyInitial) {
      this.trigger()
    }
  }

  unobserve(target) {
    this.observed = this.observed.filter(t => t !== target)
  }

  disconnect() {
    this.disconnected = true
    this.observed = []
  }

  trigger(customRect) {
    if (this.disconnected) return
    const entries = this.observed.map(target => ({
      target,
      contentRect: customRect || (target.getBoundingClientRect ? target.getBoundingClientRect() : { width: 0, height: 0 }),
    }))
    this.cb(entries)
  }
}
MockResizeObserver.instances = []
MockResizeObserver.autoNotifyInitial = true

// Mock Window with event listeners
const windowListeners = new Map()
globalThis.window = globalThis.window || {}
globalThis.window.addEventListener = (event, handler) => {
  if (!windowListeners.has(event)) windowListeners.set(event, new Set())
  windowListeners.get(event).add(handler)
}
globalThis.window.removeEventListener = (event, handler) => {
  if (windowListeners.has(event)) {
    windowListeners.get(event).delete(handler)
  }
}
function triggerWindowEvent(event) {
  if (windowListeners.has(event)) {
    for (const handler of Array.from(windowListeners.get(event))) {
      handler()
    }
  }
}

// Helper: Mock DOM Environment for NavCamera
function createMockEnv(initialWidth = 390, initialHeight = 784) {
  let width = initialWidth
  let height = initialHeight

  const calls = {
    panTo: [],
    setLatLng: [],
    invalidateSize: 0,
    invalidateSizeOpts: [],
    enabledHandlers: new Set(),
    disabledHandlers: new Set(),
  }

  const viewportEl = {
    style: {
      webkitMaskImage: 'none',
      maskImage: 'none',
    },
    getBoundingClientRect: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
    }),
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
    style: { transform: 'none', transition: 'none' },
  }

  const markerEl = {
    querySelector: () => wrapperEl,
  }

  const createHandler = (name) => ({
    enable: () => { calls.enabledHandlers.add(name); calls.disabledHandlers.delete(name) },
    disable: () => { calls.disabledHandlers.add(name); calls.enabledHandlers.delete(name) },
  })

  const map = {
    invalidateSize: (opts) => {
      calls.invalidateSize++
      calls.invalidateSizeOpts.push(opts)
    },
    panTo: (latlng, opts) => { calls.panTo.push({ latlng, opts }) },
    dragging: createHandler('dragging'),
    touchZoom: createHandler('touchZoom'),
    scrollWheelZoom: createHandler('scrollWheelZoom'),
    doubleClickZoom: createHandler('doubleClickZoom'),
    boxZoom: createHandler('boxZoom'),
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
    setSize: (newW, newH) => { width = newW; height = newH },
    getSize: () => ({ width, height }),
  }
}

// =============================================================================
// SECTION 1: [NAVCAMERA UNIT] Mock ResizeObserver & Fake Timers Suite
// Required Checks 1 through 19 + Zero-Size Viewport Regression Check
// =============================================================================
console.log('--- 1. [NAVCAMERA UNIT] Mock ResizeObserver & Fake Timers Suite ---')

const clock = new FakeClock()
clock.install()
globalThis.ResizeObserver = MockResizeObserver

// Check 1: Initial observer notification is ignored
MockResizeObserver.instances = []
MockResizeObserver.autoNotifyInitial = true
const env1 = createMockEnv(390, 784)
const cam1 = new NavCamera({ ...env1, debounceMs: 120 })
assertBehavior('1.1 Initial observer notification is ignored (no timer scheduled)',
  clock.pendingCount === 0,
  `Pending timers: ${clock.pendingCount}`
)

// Check 2: Valid 3D resize recalculates geometry
cam1.setTargetPosition(13.9314, 121.6172)
cam1.setMode('3D')
const initial3DWidth = env1.mapEl.style.width
const initial3DLeft = env1.mapEl.style.left
env1.setSize(600, 700)
MockResizeObserver.instances[0].trigger()
assertBehavior('1.2a Viewport resize triggers a debounce timer', clock.pendingCount === 1)
clock.advance(130)
assertBehavior('1.2b Valid 3D resize recalculates geometry',
  env1.mapEl.style.width !== initial3DWidth && env1.mapEl.style.left !== initial3DLeft && cam1.mode === '3D',
  `Initial W: ${initial3DWidth}, New W: ${env1.mapEl.style.width}`
)

// Check 3: Portrait-to-landscape resize updates dimensions and pivot
const portraitTop = env1.mapEl.style.top
env1.setSize(844, 390) // landscape
MockResizeObserver.instances[0].trigger()
clock.advance(130)
const landscapeTop = env1.mapEl.style.top
assertBehavior('1.3 Portrait-to-landscape resize updates dimensions and pivot',
  portraitTop !== landscapeTop && cam1.mode === '3D',
  `Portrait top: ${portraitTop}, Landscape top: ${landscapeTop}`
)

// Check 4: Landscape-to-portrait resize updates dimensions and pivot
env1.setSize(390, 844) // back to portrait
MockResizeObserver.instances[0].trigger()
clock.advance(130)
assertBehavior('1.4 Landscape-to-portrait resize updates dimensions and pivot',
  env1.mapEl.style.top !== landscapeTop && cam1.mode === '3D',
  `New portrait top: ${env1.mapEl.style.top}`
)

// Check 5: Multiple notifications produce one trailing resize operation
const invalidatesBeforeBurst = env1.calls.invalidateSize
env1.setSize(400, 800); MockResizeObserver.instances[0].trigger()
clock.advance(30)
env1.setSize(410, 810); MockResizeObserver.instances[0].trigger()
clock.advance(30)
env1.setSize(420, 820); MockResizeObserver.instances[0].trigger()
clock.advance(50) // total 110ms elapsed from first, 50ms from last
assertBehavior('1.5a Burst notifications reset timer without executing prematurely',
  env1.calls.invalidateSize === invalidatesBeforeBurst && clock.pendingCount === 1
)
clock.advance(80) // total 130ms elapsed from last notification
assertBehavior('1.5b Multiple notifications produce exactly one trailing resize operation',
  env1.calls.invalidateSize === invalidatesBeforeBurst + 1
)

// Check 6: Changes below the 2px threshold are ignored
env1.setSize(421, 820) // 1px change in width (< 2px threshold)
MockResizeObserver.instances[0].trigger()
assertBehavior('1.6 Changes below the 2px threshold are ignored (no timer scheduled)',
  clock.pendingCount === 0
)

// Check 7: 2D resize calls only invalidateSize()
const env2D = createMockEnv(390, 784)
const cam2D = new NavCamera({ ...env2D, debounceMs: 120 })
cam2D.setMode('2D')
cam2D.setTargetPosition(13.9314, 121.6172)
env2D.calls.invalidateSize = 0
env2D.calls.panTo = []
env2D.setSize(500, 600)
MockResizeObserver.instances[MockResizeObserver.instances.length - 1].trigger()
clock.advance(130)
assertBehavior('1.7 2D resize calls only invalidateSize()',
  env2D.calls.invalidateSize === 1,
  `InvalidateSize called ${env2D.calls.invalidateSize} times`
)

// Check 8: 2D resize never calls _layout() or panTo()
assertBehavior('1.8 2D resize never calls _layout() or panTo()',
  env2D.calls.panTo.length === 0 && env2D.mapEl.style.transform === 'none' && env2D.mapEl.style.width === '100%',
  `panTo calls: ${env2D.calls.panTo.length}, transform: ${env2D.mapEl.style.transform}`
)

// Check 9: 2D resize preserves camera mode and follow state
cam2D.follow = false // simulated manual pan
env2D.setSize(520, 620)
MockResizeObserver.instances[MockResizeObserver.instances.length - 1].trigger()
clock.advance(130)
assertBehavior('1.9 2D resize preserves camera mode and follow state (preserves manual panning)',
  cam2D.mode === '2D' && cam2D.follow === false
)

// Check 10 (Zero-Size Viewport Regression): 0x0 viewport handling in 3D and 2D
// 10A. 3D zero-size notification
const envZero = createMockEnv(390, 784)
let zeroModeEvents = []
const camZero = new NavCamera({
  ...envZero,
  debounceMs: 120,
  onModeChange: (m) => zeroModeEvents.push(m),
})
camZero.setMode('3D')
const mapWidthBeforeZero = envZero.mapEl.style.width
const mapLeftBeforeZero = envZero.mapEl.style.left
const mapTopBeforeZero = envZero.mapEl.style.top
const mapTransformBeforeZero = envZero.mapEl.style.transform

let zeroLayoutCalls = 0
let zeroApplyCalls = 0
const origZeroLayout = camZero._layout
const origZeroApply = camZero.apply
camZero._layout = function(...args) { zeroLayoutCalls++; return origZeroLayout.apply(this, args) }
camZero.apply = function(...args) { zeroApplyCalls++; return origZeroApply.apply(this, args) }

// Send 0x0 notification delivered through observer
envZero.setSize(0, 0)
const zeroObserver = MockResizeObserver.instances[MockResizeObserver.instances.length - 1]
zeroObserver.trigger()
clock.advance(130)

assertBehavior('1.10a Zero-size notification in 3D leaves mode as 3D (no demotion)',
  camZero.mode === '3D',
  `Current mode: ${camZero.mode}`
)
assertBehavior('1.10b Zero-size notification does not alter existing map container dimensions or offsets',
  envZero.mapEl.style.width === mapWidthBeforeZero &&
  envZero.mapEl.style.left === mapLeftBeforeZero &&
  envZero.mapEl.style.top === mapTopBeforeZero &&
  envZero.mapEl.style.transform === mapTransformBeforeZero
)
assertBehavior('1.10c Zero-size notification does not invoke mode-change callback',
  zeroModeEvents.length === 0,
  `Notifications: ${JSON.stringify(zeroModeEvents)}`
)
assertBehavior('1.10d Zero-size notification in 3D does not call _layout() or apply()',
  zeroLayoutCalls === 0 && zeroApplyCalls === 0,
  `_layout calls: ${zeroLayoutCalls}, apply calls: ${zeroApplyCalls}`
)

// 10B. Valid resize restoration after zero-size
envZero.setSize(600, 700)
zeroObserver.trigger()
clock.advance(130)

assertBehavior('1.10e Valid nonzero resize notification resumes normal 3D resize handling and recalculates geometry',
  camZero.mode === '3D' &&
  envZero.mapEl.style.width !== mapWidthBeforeZero &&
  zeroLayoutCalls > 0 &&
  zeroApplyCalls > 0 &&
  zeroModeEvents.length === 0
)

// 10C. 2D zero-size notification
const env2DZero = createMockEnv(390, 784)
let zero2DModeEvents = []
const cam2DZero = new NavCamera({
  ...env2DZero,
  debounceMs: 120,
  onModeChange: (m) => zero2DModeEvents.push(m),
})
cam2DZero.setMode('2D')
cam2DZero.setTargetPosition(13.9314, 121.6172)
env2DZero.calls.invalidateSize = 0
env2DZero.calls.panTo = []

let zero2DLayoutCalls = 0
let zero2DApplyCalls = 0
const orig2DLayout = cam2DZero._layout
const orig2DApply = cam2DZero.apply
cam2DZero._layout = function(...args) { zero2DLayoutCalls++; return orig2DLayout.apply(this, args) }
cam2DZero.apply = function(...args) { zero2DApplyCalls++; return orig2DApply.apply(this, args) }

// Send 0x0 notification delivered through observer in 2D
env2DZero.setSize(0, 0)
const zero2DObserver = MockResizeObserver.instances[MockResizeObserver.instances.length - 1]
zero2DObserver.trigger()
clock.advance(130)

assertBehavior('1.10f Zero-size notification in 2D leaves mode as 2D',
  cam2DZero.mode === '2D'
)
assertBehavior('1.10g Zero-size notification in 2D does not call map.invalidateSize()',
  env2DZero.calls.invalidateSize === 0,
  `invalidateSize calls: ${env2DZero.calls.invalidateSize}`
)
assertBehavior('1.10h Zero-size notification in 2D does not trigger pan or layout operation',
  env2DZero.calls.panTo.length === 0 && zero2DLayoutCalls === 0 && zero2DApplyCalls === 0,
  `panTo calls: ${env2DZero.calls.panTo.length}, _layout calls: ${zero2DLayoutCalls}`
)
assertBehavior('1.10i Zero-size notification in 2D does not invoke mode-change callback',
  zero2DModeEvents.length === 0
)

// Check 10 (Original): Oversized 3D resize demotes to 2D
const envDowngrade = createMockEnv(390, 784)
let modeChangeNotified = []
const camDowngrade = new NavCamera({
  ...envDowngrade,
  debounceMs: 120,
  onModeChange: (m) => modeChangeNotified.push(m),
})
camDowngrade.setMode('3D')
envDowngrade.setSize(3000, 3000) // oversized viewport (> 1400px half-size)
MockResizeObserver.instances[MockResizeObserver.instances.length - 1].trigger()
clock.advance(130)
assertBehavior('1.10j Oversized 3D resize demotes to 2D',
  camDowngrade.mode === '2D',
  `Current mode: ${camDowngrade.mode}`
)

// Check 11: onModeChange('2D') is called exactly once for a real demotion
assertBehavior('1.11 onModeChange(\'2D\') is called exactly once for a real demotion',
  modeChangeNotified.length === 1 && modeChangeNotified[0] === '2D',
  `Notifications: ${JSON.stringify(modeChangeNotified)}`
)
// Subsequent resize while in 2D does NOT trigger another mode change
envDowngrade.setSize(3200, 3200)
MockResizeObserver.instances[MockResizeObserver.instances.length - 1].trigger()
clock.advance(130)
assertBehavior('1.11b Subsequent resize in 2D does not trigger duplicate onModeChange',
  modeChangeNotified.length === 1
)

// Check 12: Valid 3D resize does not produce a false mode-change notification
const envValid3D = createMockEnv(390, 784)
let falseModeNotified = []
const camValid3D = new NavCamera({
  ...envValid3D,
  debounceMs: 120,
  onModeChange: (m) => falseModeNotified.push(m),
})
camValid3D.setMode('3D')
envValid3D.setSize(844, 390)
MockResizeObserver.instances[MockResizeObserver.instances.length - 1].trigger()
clock.advance(130)
assertBehavior('1.12 Valid 3D resize does not produce a false mode-change notification',
  falseModeNotified.length === 0 && camValid3D.mode === '3D',
  `Mode notifications: ${falseModeNotified.length}`
)

// Check 13: destroy() cancels a pending timer
const envDestroy = createMockEnv(390, 784)
const camDestroy = new NavCamera({ ...envDestroy, debounceMs: 120 })
envDestroy.setSize(600, 700)
const lastObserver = MockResizeObserver.instances[MockResizeObserver.instances.length - 1]
lastObserver.trigger()
assertBehavior('1.13a Timer is pending before destroy()', clock.pendingCount === 1)
camDestroy.destroy()
assertBehavior('1.13b destroy() cancels a pending timer', clock.pendingCount === 0)

// Check 14: destroy() disconnects ResizeObserver
assertBehavior('1.14 destroy() disconnects ResizeObserver', lastObserver.disconnected === true)

// Check 15: Late observer notifications after destruction do nothing
const invalidatesBeforeLate = envDestroy.calls.invalidateSize
lastObserver.trigger()
clock.advance(200)
assertBehavior('1.15 Late observer notifications after destruction do nothing',
  envDestroy.calls.invalidateSize === invalidatesBeforeLate && clock.pendingCount === 0
)

// Check 16: Window fallback works when ResizeObserver is unavailable
delete globalThis.ResizeObserver
windowListeners.clear()
const envFallback = createMockEnv(390, 784)
const camFallback = new NavCamera({ ...envFallback, debounceMs: 120 })
assertBehavior('1.16a Window fallback registers one resize listener when ResizeObserver unavailable',
  (windowListeners.get('resize')?.size || 0) === 1
)
envFallback.setSize(700, 800)
triggerWindowEvent('resize')
assertBehavior('1.16b Window resize event schedules fallback debounce timer', clock.pendingCount === 1)
clock.advance(130)
assertBehavior('1.16c Window fallback executes resize operation', envFallback.calls.invalidateSize > 0)

// Check 17: The fallback listener is removed during destruction
camFallback.destroy()
assertBehavior('1.17 Fallback window resize listener is removed during destruction',
  (windowListeners.get('resize')?.size || 0) === 0
)
// Restore ResizeObserver for subsequent tests
globalThis.ResizeObserver = MockResizeObserver

// Check 18: Resize during heading animation does not reset heading or create a second animation loop
const envHeading = createMockEnv(390, 784)
const camHeading = new NavCamera({ ...envHeading, debounceMs: 120 })
camHeading.setMode('3D')
camHeading.setTargetHeading(90)
const initialRaf = camHeading._raf
assertBehavior('1.18a Heading animation initiates one rAF loop', initialRaf !== 0)
camHeading.step(50) // advance partially
const intermediateHeading = camHeading.h
assertBehavior('1.18b Camera heading is in-flight', intermediateHeading > 0 && intermediateHeading < 90)

// Resize fires mid-animation
envHeading.setSize(600, 700)
camHeading.handleResize()
assertBehavior('1.18c Resize during heading animation preserves in-flight heading',
  Math.abs(camHeading.h - intermediateHeading) < 1e-4,
  `Heading before: ${intermediateHeading}, after: ${camHeading.h}`
)
assertBehavior('1.18d Resize during heading animation does not create a second animation loop',
  camHeading._raf === initialRaf
)

// Check 19: A fresh NavCamera instance works normally after a previous instance is destroyed
camHeading.destroy()
const envFresh = createMockEnv(390, 784)
const camFresh = new NavCamera({ ...envFresh, debounceMs: 120 })
camFresh.setMode('3D')
envFresh.setSize(844, 390)
MockResizeObserver.instances[MockResizeObserver.instances.length - 1].trigger()
clock.advance(130)
assertBehavior('1.19 A fresh NavCamera instance works normally after a previous instance is destroyed',
  camFresh.mode === '3D' && envFresh.mapEl.style.width !== '100%' && !camFresh._destroyed
)
camFresh.destroy()

clock.uninstall()

// =============================================================================
// SECTION 2: [MODEL SYNC] Component State Synchronization on Viewport Resize
// =============================================================================
console.log('\n--- 2. [MODEL SYNC] Component State Synchronization on Viewport Resize ---')
console.log('// NOTE: Tests in Section 2 verify the state machine model synchronization contract.')

function createSimulatedModule(initialIs3D = false) {
  let is3D = initialIs3D
  const onModeChange = (mode) => {
    if (mode === '2D') {
      is3D = false
    }
  }
  return {
    getState: () => ({ is3D }),
    onModeChange,
  }
}

// 2.1 When resize keeps 3D mode, is3D remains true
const modSync = createSimulatedModule(true)
const envSync = createMockEnv(390, 784)
const camSync = new NavCamera({
  ...envSync,
  onModeChange: modSync.onModeChange,
})
camSync.setMode('3D')
envSync.setSize(844, 390) // valid landscape
camSync.handleResize()
assertModel('2.1 [Model Sync] is3D state model remains true when 3D mode is maintained across resize',
  modSync.getState().is3D === true
)

// 2.2 When resize causes 3D downgrade to 2D, is3D is synchronized to false
envSync.setSize(3000, 3000) // oversized
camSync.handleResize()
assertModel('2.2 [Model Sync] is3D state model synchronizes to false when oversized resize downgrades camera to 2D',
  modSync.getState().is3D === false
)

// 2.3 When resize occurs in 2D, is3D remains false
const modSync2D = createSimulatedModule(false)
const envSync2D = createMockEnv(390, 784)
const camSync2D = new NavCamera({
  ...envSync2D,
  onModeChange: modSync2D.onModeChange,
})
camSync2D.setMode('2D')
envSync2D.setSize(500, 600)
camSync2D.handleResize()
assertModel('2.3 [Model Sync] is3D state model remains false when resizing in 2D mode',
  modSync2D.getState().is3D === false
)

// =============================================================================
// SECTION 3: [PRODUCTION SOURCE] Direct Static Analysis of NavCamera & ShiftRouteModule.jsx
// =============================================================================
console.log('\n--- 3. [PRODUCTION SOURCE] Direct Static Analysis ---')

const navCameraPath = path.resolve(__dirname, '../../wastewatch/frontend/src/pages/driver/components/navCamera.js')
const shiftRouteModulePath = path.resolve(__dirname, '../../wastewatch/frontend/src/pages/driver/components/ShiftRouteModule.jsx')

const navCameraSource = fs.readFileSync(navCameraPath, 'utf8')
const shiftRouteSource = fs.readFileSync(shiftRouteModulePath, 'utf8')

/**
 * Robust balanced delimiter scanner that skips strings, template literals,
 * single-line comments, and block comments.
 */
function extractBalanced(source, startIndex, openChar, closeChar) {
  let depth = 0
  let inString = false
  let stringChar = ''
  let inLineComment = false
  let inBlockComment = false

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === stringChar) {
        inString = false
      }
      continue
    }

    if (ch === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true
      stringChar = ch
      continue
    }

    if (ch === openChar) {
      depth++
    } else if (ch === closeChar) {
      depth--
      if (depth === 0) {
        return { content: source.slice(startIndex + 1, i), endIndex: i }
      }
      if (depth < 0) {
        throw new Error(`Unbalanced closing delimiter ${closeChar} at index ${i}`)
      }
    }
  }
  throw new Error(`Unclosed delimiter ${openChar} starting at index ${startIndex}`)
}

/**
 * Enumerates all setIs3D call sites and extracts argument expressions via balanced parens.
 */
function findSetIs3DCalls(source) {
  const regex = /\bsetIs3D\s*\(/g
  const calls = []
  let match
  while ((match = regex.exec(source)) !== null) {
    const openParenIdx = match.index + match[0].length - 1
    const { content: argContent, endIndex } = extractBalanced(source, openParenIdx, '(', ')')
    const lineNum = source.slice(0, match.index).split('\n').length
    calls.push({
      line: lineNum,
      arg: argContent.trim(),
      raw: source.slice(match.index, endIndex + 1),
    })
  }
  return calls
}

/**
 * Reusable Rule 1: Checks if NavCamera.destroy() disconnects ResizeObserver.
 */
function checkObserverDisconnectInDestroy(source) {
  const match = source.match(/\bdestroy\s*\(\s*\)\s*\{/)
  if (!match) return false
  const openBraceIdx = match.index + match[0].length - 1
  const { content: body } = extractBalanced(source, openBraceIdx, '{', '}')
  return body.includes('this._resizeObserver.disconnect()') || body.includes('this._resizeObserver?.disconnect()')
}

/**
 * Reusable Rule 2: Checks that ResizeObserver and window fallback are mutually exclusive.
 */
function checkExclusiveObservation(source) {
  const match = source.match(/\b_initResizeObservation\s*\(\s*\)\s*\{/)
  if (!match) return false
  const openBraceIdx = match.index + match[0].length - 1
  const { content: body } = extractBalanced(source, openBraceIdx, '{', '}')
  const hasObserverCheck = /if\s*\(\s*typeof\s+ResizeObserver\s*!==\s*['"]undefined['"]\s*\)/.test(body)
  const hasElseIfWindow = /else\s+if\s*\(\s*typeof\s+window/.test(body)
  const hasUnconditionalWindowAdd = /window\.addEventListener\s*\(\s*['"]resize['"]/.test(body.replace(/else\s+if[\s\S]*/, ''))
  return hasObserverCheck && hasElseIfWindow && !hasUnconditionalWindowAdd
}

/**
 * Reusable Rule 3: Extracts the 2D branch inside handleResize() and inspects its exact calls.
 */
function check2DResizePath(source) {
  const handleResizeMatch = source.match(/\bhandleResize\s*\(\s*\)\s*\{/)
  if (!handleResizeMatch) return { pass: false, reason: 'handleResize not found' }
  const hrOpenBraceIdx = handleResizeMatch.index + handleResizeMatch[0].length - 1
  const { content: hrBody } = extractBalanced(source, hrOpenBraceIdx, '{', '}')

  const branchMatch = hrBody.match(/if\s*\(\s*this\.mode\s*===\s*['"]2D['"]\s*\)\s*\{/)
  if (!branchMatch) return { pass: false, reason: '2D branch not found in handleResize' }
  const bOpenBraceIdx = branchMatch.index + branchMatch[0].length - 1
  const { content: branchBody } = extractBalanced(hrBody, bOpenBraceIdx, '{', '}')

  const callsInvalidateSize = branchBody.includes('invalidateSize()')
  const callsLayout = branchBody.includes('_layout')
  const callsPanTo = branchBody.includes('panTo')
  const returnsEarly = branchBody.includes('return')

  return {
    pass: callsInvalidateSize && !callsLayout && !callsPanTo && returnsEarly,
    callsInvalidateSize,
    callsLayout,
    callsPanTo,
    returnsEarly,
    body: branchBody.trim(),
  }
}

/**
 * Reusable Rule 4: Extracts onModeChange callback from source and verifies no functional updaters.
 */
function checkOnModeChangeCallback(source) {
  const match = source.match(/\bonModeChange\s*:\s*\(([^)]*)\)\s*=>\s*\{/)
  if (!match) return { pass: false, reason: 'onModeChange callback not found' }
  const openBraceIdx = match.index + match[0].length - 1
  const { content: body } = extractBalanced(source, openBraceIdx, '{', '}')
  const callsSetIs3D = body.includes('setIs3D(false)')
  const hasFunctionalUpdater = /setIs3D\s*\(\s*(?:prev|previous|\([^)]*\))\s*=>/.test(body)
  return {
    pass: callsSetIs3D && !hasFunctionalUpdater,
    callsSetIs3D,
    hasFunctionalUpdater,
    body: body.trim(),
  }
}

/**
 * Reusable Rule 5: Enumerates all useEffect blocks and checks whether any body references ResizeObserver.
 */
function findIndependentResizeEffects(source) {
  const regex = /\buseEffect\s*\(/g
  const violations = []
  let match
  while ((match = regex.exec(source)) !== null) {
    const openParenIdx = match.index + match[0].length - 1
    const { content: callArgs } = extractBalanced(source, openParenIdx, '(', ')')
    if (callArgs.includes('ResizeObserver')) {
      const lineNum = source.slice(0, match.index).split('\n').length
      violations.push({ line: lineNum, body: callArgs.trim() })
    }
  }
  return violations
}

// 3.1 NavCamera creates and owns ResizeObserver observing viewportEl
const navCamHasObserver = navCameraSource.includes('new ResizeObserver(') &&
  navCameraSource.includes('.observe(this.viewportEl)')
assertStatic('3.1 [Prod Source] NavCamera creates and owns ResizeObserver observing its viewportEl', navCamHasObserver)

// 3.2 NavCamera has fallback window resize listener when ResizeObserver is unavailable
const navCamHasWindowFallback = navCameraSource.includes("window.addEventListener('resize', this._windowResizeHandler)") ||
  navCameraSource.includes('window.addEventListener("resize", this._windowResizeHandler)')
assertStatic('3.2 [Prod Source] NavCamera registers fallback window resize listener when ResizeObserver is unavailable', navCamHasWindowFallback)

// 3.3 NavCamera never registers both mechanisms simultaneously (via checkExclusiveObservation rule)
const navCamExclusive = checkExclusiveObservation(navCameraSource)
assertStatic('3.3 [Prod Source] NavCamera uses exclusive if-else to never register both observation mechanisms simultaneously', navCamExclusive)

// 3.4 NavCamera.destroy() disconnects ResizeObserver and removes fallback window resize listener (via checkObserverDisconnectInDestroy rule)
const navCamDisconnects = checkObserverDisconnectInDestroy(navCameraSource)
const navCamRemovesWindow = navCameraSource.includes('window.removeEventListener(\'resize\', this._windowResizeHandler)') ||
  navCameraSource.includes('window.removeEventListener("resize", this._windowResizeHandler)')
assertStatic('3.4 [Prod Source] NavCamera.destroy() disconnects ResizeObserver and removes window resize listener',
  navCamDisconnects && navCamRemovesWindow
)

// 3.5 NavCamera uses trailing timer debounce (clearTimeout & setTimeout)
const navCamUsesTrailingTimer = navCameraSource.includes('clearTimeout(this._resizeTimer)') &&
  navCameraSource.includes('setTimeout(') &&
  navCameraSource.includes('this.debounceMs')
assertStatic('3.5 [Prod Source] NavCamera implements trailing timer debounce resetting pending timer on repeated notifications', navCamUsesTrailingTimer)

// 3.6 NavCamera cancels pending debounce timer in destroy()
const navCamClearsTimerInDestroy = /destroy\s*\(\s*\)\s*\{[\s\S]*?clearTimeout\s*\(\s*this\._resizeTimer\s*\)/.test(navCameraSource)
assertStatic('3.6 [Prod Source] NavCamera.destroy() cancels pending resize debounce timer', navCamClearsTimerInDestroy)

// 3.7 NavCamera filters changes below 2px threshold
const navCamHas2pxThreshold = navCameraSource.includes('Math.abs(w - this._lastW) < 2') &&
  navCameraSource.includes('Math.abs(h - this._lastH) < 2')
assertStatic('3.7 [Prod Source] NavCamera filters initial notification and changes below 2px threshold', navCamHas2pxThreshold)

// 3.8 NavCamera 2D resize calls only map.invalidateSize() without _layout() or panTo() (via check2DResizePath rule)
const path2DAnalysis = check2DResizePath(navCameraSource)
assertStatic('3.8 [Prod Source] NavCamera 2D resize path calls only map.invalidateSize() and returns early without _layout() or panTo()',
  path2DAnalysis.pass,
  `InvalidateSize: ${path2DAnalysis.callsInvalidateSize}, Layout: ${path2DAnalysis.callsLayout}, PanTo: ${path2DAnalysis.callsPanTo}`
)

// 3.9 NavCamera invokes onModeChange('2D') only when 3D is demoted to 2D
const navCamInvokesOnModeChange = navCameraSource.includes("this.onModeChange('2D')") || navCameraSource.includes('this.onModeChange("2D")')
assertStatic('3.9 [Prod Source] NavCamera invokes onModeChange(\'2D\') on 3D-to-2D demotion', navCamInvokesOnModeChange)

// 3.10 ShiftRouteModule.jsx configures onModeChange callback on NavCamera
const shiftRoutePassesOnModeChange = shiftRouteSource.includes('onModeChange: (mode) => {') || shiftRouteSource.includes('onModeChange:(mode)=>{')
assertStatic('3.10 [Prod Source] ShiftRouteModule configures onModeChange callback when instantiating NavCamera', shiftRoutePassesOnModeChange)

// 3.11 ShiftRouteModule.jsx onModeChange callback calls setIs3D(false) without functional updaters (via checkOnModeChangeCallback rule)
const onModeChangeAnalysis = checkOnModeChangeCallback(shiftRouteSource)
assertStatic('3.11 [Prod Source] ShiftRouteModule onModeChange synchronizes 2D demotion via direct setIs3D(false) (0 functional updaters)',
  onModeChangeAnalysis.pass,
  onModeChangeAnalysis.body
)

// 3.12 ShiftRouteModule.jsx does NOT independently manage ResizeObserver in any useEffect (via findIndependentResizeEffects rule)
const independentResizeEffects = findIndependentResizeEffects(shiftRouteSource)
assertStatic('3.12 [Prod Source] ShiftRouteModule does NOT independently manage viewport resize observation in any useEffect',
  independentResizeEffects.length === 0,
  independentResizeEffects.length > 0 ? `Found ${independentResizeEffects.length} violation(s)` : '0 violations'
)

// 3.13 Exactly 4 setIs3D call sites exist in ShiftRouteModule.jsx (all approved mode transitions)
const setIs3DCalls = findSetIs3DCalls(shiftRouteSource)
const APPROVED_ARGUMENTS = new Set(['false', 'actualMode === \'3D\'', 'actualMode === "3D"'])
const allCallsApproved = setIs3DCalls.length === 4 && setIs3DCalls.every(c => APPROVED_ARGUMENTS.has(c.arg))
assertStatic('3.13 [Prod Source] Exactly 4 setIs3D call sites are approved mode transitions (no unapproved calls)',
  allCallsApproved,
  `Found ${setIs3DCalls.length} call(s): ${setIs3DCalls.map(c => `L${c.line}: ${c.raw}`).join('; ')}`
)

// =============================================================================
// SECTION 4: [MUTATION SELF-CHECKS] Static Analysis Verification on Fixtures
// Every mutation test invokes the exact same rule function used in Section 3.
// =============================================================================
console.log('\n--- 4. [MUTATION SELF-CHECKS] Static Analysis Verification on Fixtures ---')
console.log('// NOTE: Tests in Section 4 verify that the exact static analysis rules fail when presented')
console.log('// with known defective source fixtures. They do NOT test production code.\n')

// Fixture 1: Missing observer disconnect in destroy()
const fixtureMissingDisconnect = `
  destroy() {
    this._destroyed = true
    cancelAnimationFrame(this._raf)
  }
`
const f1RuleResult = checkObserverDisconnectInDestroy(fixtureMissingDisconnect)
assertMutation('4.1 [Self-Check] Rule checkObserverDisconnectInDestroy rejects fixture missing disconnect()',
  f1RuleResult === false,
  'Correctly identified missing disconnect'
)

// Fixture 2: Registering both ResizeObserver and window listener simultaneously
const fixtureSimultaneousRegistration = `
  _initResizeObservation() {
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {})
      this._resizeObserver.observe(this.viewportEl)
    }
    window.addEventListener('resize', this._windowResizeHandler)
  }
`
const f2RuleResult = checkExclusiveObservation(fixtureSimultaneousRegistration)
assertMutation('4.2 [Self-Check] Rule checkExclusiveObservation rejects fixture with simultaneous registration',
  f2RuleResult === false,
  'Correctly identified non-exclusive registration'
)

// Fixture 3: 2D resize calling _layout()
const fixture2DCallsLayout = `
  handleResize() {
    if (this.mode === '2D') {
      this._layout()
      return this.mode
    }
  }
`
const f3RuleResult = check2DResizePath(fixture2DCallsLayout)
assertMutation('4.3 [Self-Check] Rule check2DResizePath rejects fixture calling _layout() in 2D branch',
  f3RuleResult.pass === false,
  'Correctly identified 2D branch calling _layout'
)

// Fixture 4: Functional updater in onModeChange
const fixtureBadUpdater = `
  navCameraRef.current = new NavCamera({
    onModeChange: (mode) => {
      if (mode === '2D') setIs3D(prev => false)
    }
  })
`
const f4RuleResult = checkOnModeChangeCallback(fixtureBadUpdater)
assertMutation('4.4 [Self-Check] Rule checkOnModeChangeCallback rejects fixture with functional updater',
  f4RuleResult.pass === false,
  'Correctly identified functional updater'
)

// Fixture 5: ShiftRouteModule independently managing ResizeObserver in useEffect
const fixtureIndependentResize = `
  useEffect(() => {
    const observer = new ResizeObserver(() => navCameraRef.current?.handleResize())
    observer.observe(viewportRef.current)
  }, [])
`
const f5RuleResult = findIndependentResizeEffects(fixtureIndependentResize)
assertMutation('4.5 [Self-Check] Rule findIndependentResizeEffects rejects fixture with independent ResizeObserver in useEffect',
  f5RuleResult.length > 0,
  `Correctly identified violation at line ${f5RuleResult[0]?.line}`
)

// =============================================================================
// Summary
// =============================================================================
const passedBehavior = behaviorResults.filter(r => r.pass).length
const failedBehavior = behaviorResults.filter(r => !r.pass).length
const passedModel = modelResults.filter(r => r.pass).length
const failedModel = modelResults.filter(r => !r.pass).length
const passedStatic = staticResults.filter(r => r.pass).length
const failedStatic = staticResults.filter(r => !r.pass).length
const passedMut = mutationResults.filter(r => r.pass).length
const failedMut = mutationResults.filter(r => !r.pass).length

console.log(`\n=== Stage 2D-C Verification Results Summary ===`)
console.log(`NavCamera Behavior Checks   : ${behaviorResults.length} total, ${passedBehavior} passed, ${failedBehavior} failed`)
console.log(`Model Synchronization Tests : ${modelResults.length} total, ${passedModel} passed, ${failedModel} failed`)
console.log(`Production Source Checks    : ${staticResults.length} total, ${passedStatic} passed, ${failedStatic} failed`)
console.log(`Static Mutation Self-Checks : ${mutationResults.length} total, ${passedMut} passed, ${failedMut} failed`)

const totalFailures = failedBehavior + failedModel + failedStatic + failedMut
if (totalFailures > 0) {
  process.exit(1)
} else {
  process.exit(0)
}
