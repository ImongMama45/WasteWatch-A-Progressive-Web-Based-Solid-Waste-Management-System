/**
 * test-stage2d-b2.mjs
 * Verification suite for Stage 2D-B2:
 * Touch Interaction Model A and Camera Mode Synchronization.
 *
 * Categorized into:
 *  1. [Model Specification] Touch Interaction Model A Contract
 *  2. [NavCamera Unit] and [Model Sync] Camera Mode Refusal & Synchronization
 *  3. [Production Source] Direct Static Analysis of ShiftRouteModule.jsx
 *  4. [Mutation Self-Check] Self-verification of static analysis against known-bad fixtures
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NavCamera } from '../../wastewatch/frontend/src/pages/driver/components/navCamera.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const results = []
const mutationResults = []

// Polyfill minimal browser globals for Node test environment
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

function assert(name, condition, extra = '') {
  const status = condition ? 'PASS' : 'FAIL'
  results.push({ name, pass: !!condition, extra })
  console.log(`[${status}] ${name}${extra ? ' -- ' + extra : ''}`)
}

function assertMutation(name, condition, extra = '') {
  const status = condition ? 'PASS' : 'FAIL'
  mutationResults.push({ name, pass: !!condition, extra })
  console.log(`[${status}] ${name}${extra ? ' -- ' + extra : ''}`)
}

console.log('=== Stage 2D-B2: Touch Interaction and Camera Mode Sync Suite ===\n')

// =============================================================================
// Helper: Mock DOM Environment for NavCamera
// =============================================================================
function createMockEnv(viewportWidth = 390, viewportHeight = 784) {
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
    getBoundingClientRect: () => ({
      width: viewportWidth,
      height: viewportHeight,
      top: 0,
      left: 0,
      right: viewportWidth,
      bottom: viewportHeight,
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

// =============================================================================
// SECTION 1: [MODEL SPECIFICATION] Touch Interaction Model A Contract
// =============================================================================
console.log('--- 1. [MODEL SPECIFICATION] Touch Interaction Model A Contract ---')
console.log('// NOTE: Tests in Section 1 and Section 2.2 execute against a simulated state machine')
console.log('// (createSimulatedModule) to verify the logic and state-transition contract of Model A.')
console.log('// Direct production component source verification is conducted in Section 3.\n')

function createSimulatedModule(initialIs3D = false, navCamera = null) {
  let is3D = initialIs3D
  const isFollowCamRef = { current: true }
  let isUserPanned = false
  const navCameraRef = { current: navCamera }

  // Handlers matching the state machine contract
  const onTouchStart = () => {
    if (!is3D) {
      isFollowCamRef.current = false
      isUserPanned = true
      if (navCameraRef.current) navCameraRef.current.follow = false
    }
  }

  const onMouseDown = () => {
    if (!is3D) {
      isFollowCamRef.current = false
      isUserPanned = true
      if (navCameraRef.current) navCameraRef.current.follow = false
    }
  }

  const onWheel = () => {
    if (!is3D) {
      isFollowCamRef.current = false
      isUserPanned = true
      if (navCameraRef.current) navCameraRef.current.follow = false
    }
  }

  const handleToggle3D = () => {
    isFollowCamRef.current = true
    isUserPanned = false

    if (navCameraRef.current) {
      navCameraRef.current.follow = true
      const targetMode = (navCameraRef.current.mode === '3D' || is3D) ? '2D' : '3D'
      const actualMode = navCameraRef.current.setMode(targetMode)
      is3D = (actualMode === '3D')
    } else {
      is3D = false
    }
    return is3D
  }

  return {
    getState: () => ({ is3D, isFollowCam: isFollowCamRef.current, isUserPanned }),
    setIs3D: (val) => { is3D = val },
    onTouchStart,
    onMouseDown,
    onWheel,
    handleToggle3D,
    navCameraRef,
  }
}

// 1.1 In 3D mode, touching or dragging does not switch to 2D
const env1 = createMockEnv(390, 784)
const cam1 = new NavCamera(env1)
cam1.setMode('3D')
const mod1 = createSimulatedModule(true, cam1)

mod1.onTouchStart()
assert('1.1 [Model] onTouchStart in 3D preserves is3D = true', mod1.getState().is3D === true)
assert('1.2 [Model] onTouchStart in 3D does not alter follow camera', mod1.getState().isFollowCam === true)
assert('1.3 [Model] onTouchStart in 3D does not alter user panned state', mod1.getState().isUserPanned === false)

mod1.onMouseDown()
assert('1.4 [Model] onMouseDown in 3D preserves is3D = true', mod1.getState().is3D === true)

mod1.onWheel()
assert('1.5 [Model] onWheel in 3D preserves is3D = true', mod1.getState().is3D === true)

// 1.2 In 2D mode, normal map interaction pauses follow cam and marks user panned
const mod2 = createSimulatedModule(false, cam1)
cam1.setMode('2D')
mod2.onTouchStart()
assert('1.6 [Model] onTouchStart in 2D pauses follow camera (isFollowCam = false)', mod2.getState().isFollowCam === false)
assert('1.7 [Model] onTouchStart in 2D sets isUserPanned = true', mod2.getState().isUserPanned === true)
assert('1.8 [Model] onTouchStart in 2D sets navCamera.follow = false', cam1.follow === false)

// 1.3 Explicit toggle switches between 3D and 2D
const env3 = createMockEnv(390, 784)
const cam3 = new NavCamera(env3)
const mod3 = createSimulatedModule(false, cam3)

// Toggle 2D -> 3D
mod3.handleToggle3D()
assert('1.9 [Model] Explicit toggle activates 3D mode when supported', mod3.getState().is3D === true && cam3.mode === '3D')
assert('1.10 [Model] Explicit toggle re-enables follow camera', mod3.getState().isFollowCam === true && cam3.follow === true)
assert('1.11 [Model] Explicit toggle resets isUserPanned to false', mod3.getState().isUserPanned === false)

// Toggle 3D -> 2D
mod3.handleToggle3D()
assert('1.12 [Model] Explicit toggle returns 3D to 2D mode', mod3.getState().is3D === false && cam3.mode === '2D')
assert('1.13 [Model] Explicit toggle in 2D retains follow camera active', mod3.getState().isFollowCam === true && cam3.follow === true)

// =============================================================================
// SECTION 2: [NAVCAMERA UNIT & MODEL SYNC] Refusal & Synchronization
// =============================================================================
console.log('\n--- 2. [NAVCAMERA UNIT & MODEL SYNC] Refusal & Synchronization ---')

// 2.1 Refusal due to oversized half-size limit (> 1400px)
const envOversized = createMockEnv(3000, 3000)
const camOversized = new NavCamera(envOversized)
const refusedMode1 = camOversized.setMode('3D')
assert('2.1 [NavCamera Unit] setMode refuses 3D on oversized viewport (> 1400px half-size)', refusedMode1 === '2D' && camOversized.mode === '2D')

// Model behavior when oversized refusal occurs
const modOversized = createSimulatedModule(false, camOversized)
modOversized.handleToggle3D()
assert('2.2 [Model] is3D state model remains false when 3D mode is refused by half-size limit', modOversized.getState().is3D === false)

// 2.2 Refusal due to zero-dimension viewport (0x0)
const envZero = createMockEnv(0, 0)
const camZero = new NavCamera(envZero)
const refusedMode2 = camZero.setMode('3D')
assert('2.3 [NavCamera Unit] setMode refuses 3D on 0x0 viewport', refusedMode2 === '2D' && camZero.mode === '2D')

// Model behavior when zero-dimension refusal occurs
const modZero = createSimulatedModule(false, camZero)
modZero.handleToggle3D()
assert('2.4 [Model] is3D state model remains false when 3D mode is refused on zero viewport', modZero.getState().is3D === false)

// 2.3 Refusal when navCameraRef.current is null
const modNullCam = createSimulatedModule(false, null)
modNullCam.handleToggle3D()
assert('2.5 [Model] is3D state model remains false when NavCamera controller is uninitialized', modNullCam.getState().is3D === false)

// =============================================================================
// SECTION 3: [PRODUCTION SOURCE] Direct Static Analysis of ShiftRouteModule.jsx
// =============================================================================
console.log('\n--- 3. [PRODUCTION SOURCE] Direct Static Analysis of ShiftRouteModule.jsx ---')

const shiftRouteModulePath = path.resolve(__dirname, '../../wastewatch/frontend/src/pages/driver/components/ShiftRouteModule.jsx')
const sourceCode = fs.readFileSync(shiftRouteModulePath, 'utf8')

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
 * Extracts a JSX attribute expression { ... } using balanced braces.
 */
function extractJsxAttribute(source, attrName) {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*\\{`, 'g')
  const match = regex.exec(source)
  if (!match) {
    throw new Error(`Required JSX attribute "${attrName}" could not be located in source`)
  }
  const openBraceIdx = match.index + match[0].length - 1
  const extracted = extractBalanced(source, openBraceIdx, '{', '}').content.trim()
  if (!extracted) {
    throw new Error(`Extracted empty JSX attribute body for "${attrName}"`)
  }
  return extracted
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
 * Enumerates all useEffect blocks and checks whether any that depend on is3D call setMode.
 */
function findSetModeInIs3DEffects(source) {
  const regex = /\buseEffect\s*\(/g
  const violations = []
  let match
  while ((match = regex.exec(source)) !== null) {
    const openParenIdx = match.index + match[0].length - 1
    const { content: callArgs } = extractBalanced(source, openParenIdx, '(', ')')
    const lineNum = source.slice(0, match.index).split('\n').length

    // Check if the dependency array includes is3D
    const depMatch = callArgs.match(/,\s*\[([^\]]*)\]\s*$/s)
    if (depMatch) {
      const deps = depMatch[1].split(',').map(d => d.trim())
      if (deps.includes('is3D')) {
        // Look for any setMode invocation inside the effect callback
        if (/\.setMode\s*\(/.test(callArgs)) {
          violations.push({ line: lineNum, args: callArgs })
        }
      }
    }
  }
  return violations
}

// 3.1 Extract onTouchStart and verify no setIs3D
const touchStartBody = extractJsxAttribute(sourceCode, 'onTouchStart')
assert('3.1 [Prod Source] onTouchStart handler body extracted via balanced braces and does not call setIs3D',
  typeof touchStartBody === 'string' && touchStartBody.length > 0 && !touchStartBody.includes('setIs3D'),
  `Extracted ${touchStartBody.length} chars`
)

// 3.2 Extract onMouseDown and verify no setIs3D
const mouseDownBody = extractJsxAttribute(sourceCode, 'onMouseDown')
assert('3.2 [Prod Source] onMouseDown handler body extracted via balanced braces and does not call setIs3D',
  typeof mouseDownBody === 'string' && mouseDownBody.length > 0 && !mouseDownBody.includes('setIs3D'),
  `Extracted ${mouseDownBody.length} chars`
)

// 3.3 Extract onWheel and verify no setIs3D
const wheelBody = extractJsxAttribute(sourceCode, 'onWheel')
assert('3.3 [Prod Source] onWheel handler body extracted via balanced braces and does not call setIs3D',
  typeof wheelBody === 'string' && wheelBody.length > 0 && !wheelBody.includes('setIs3D'),
  `Extracted ${wheelBody.length} chars`
)

// 3.4 Enumerate every setIs3D call site
const setIs3DCalls = findSetIs3DCalls(sourceCode)
const APPROVED_ARGUMENTS = new Set(['false', 'actualMode === \'3D\'', 'actualMode === "3D"'])
const hasFunctionalUpdater = setIs3DCalls.some(c => c.arg.includes('=>') || c.arg.startsWith('function'))
const allCallsApproved = setIs3DCalls.length > 0 && setIs3DCalls.every(c => APPROVED_ARGUMENTS.has(c.arg))

assert('3.4 [Prod Source] All setIs3D call sites are enumerated and verified to have approved arguments (0 updater functions)',
  !hasFunctionalUpdater && allCallsApproved,
  `Found ${setIs3DCalls.length} calls: ${setIs3DCalls.map(c => `L${c.line}: ${c.raw}`).join('; ')}`
)

// 3.5 Verify exact approved call site count (mount refusal, onModeChange downgrade, toggle sync, toggle fallback)
assert('3.5 [Prod Source] Exactly 4 setIs3D call sites are approved mode transitions (no unapproved calls)',
  setIs3DCalls.length === 4 && setIs3DCalls.every(c => APPROVED_ARGUMENTS.has(c.arg)),
  `Found ${setIs3DCalls.length} approved calls`
)

// 3.6 Verify no useEffect depending on is3D calls setMode
const is3DSetModeViolations = findSetModeInIs3DEffects(sourceCode)
assert('3.6 [Prod Source] No useEffect with is3D in dependency array calls navCamera.setMode(...)',
  is3DSetModeViolations.length === 0,
  is3DSetModeViolations.length > 0 ? `Violations at lines: ${is3DSetModeViolations.map(v => v.line).join(', ')}` : '0 violations'
)

// 3.7 Verify onModeChange callback is configured on NavCamera to synchronize 2D demotion
const onModeChangeMatch = sourceCode.match(/onModeChange\s*:\s*\(([^)]*)\)\s*=>\s*\{([^}]*)\}/s)
const onModeChangeValid = !!onModeChangeMatch &&
  onModeChangeMatch[2].includes("mode === '2D'") &&
  onModeChangeMatch[2].includes('setIs3D(false)') &&
  !onModeChangeMatch[2].includes('=>')
assert('3.7 [Prod Source] onModeChange callback is configured on NavCamera to synchronize 2D demotion via setIs3D(false)',
  onModeChangeValid,
  onModeChangeMatch ? onModeChangeMatch[0].trim().replace(/\s+/g, ' ') : 'Not found'
)

// =============================================================================
// SECTION 4: [MUTATION SELF-CHECKS] Static Analysis Verification on Fixtures
// =============================================================================
console.log('\n--- 4. [MUTATION SELF-CHECKS] Static Analysis Verification on Fixtures ---')
console.log('// NOTE: Tests in Section 4 verify that the static analysis rules fail when presented')
console.log('// with known defective source fixtures. They do NOT test production code.\n')

// Fixture 1: Functional updater with custom parameter name (e.g., setIs3D(p => !p))
const fixture1 = `
  const handleToggle = () => {
    setIs3D(p => !p)
  }
`
const f1Calls = findSetIs3DCalls(fixture1)
const f1Detected = f1Calls.some(c => c.arg.includes('=>') || !APPROVED_ARGUMENTS.has(c.arg))
assertMutation('4.1 [Self-Check] Analysis detects functional updater with custom parameter name: setIs3D(p => !p)',
  f1Detected === true,
  `Detected argument: "${f1Calls[0]?.arg}"`
)

// Fixture 2: Old Effect 5c containing nested if blocks and setMode call
const fixture2 = `
  useEffect(() => {
    if (navCameraRef.current) {
      if (is3D) {
        navCameraRef.current.setMode('3D')
      } else {
        navCameraRef.current.setMode('2D')
      }
    }
  }, [is3D])
`
const f2Violations = findSetModeInIs3DEffects(fixture2)
assertMutation('4.2 [Self-Check] Analysis detects old effect 5c with nested if and setMode call inside [is3D] effect',
  f2Violations.length === 1,
  `Found ${f2Violations.length} violation(s)`
)

// Fixture 3: Earlier style={{...}} appearing before the map handlers
const fixture3 = `
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    <div
      ref={mapRef}
      onTouchStart={() => {
        if (!is3D) {
          isFollowCamRef.current = false
        }
      }}
      style={{ width: '100%', height: '100%' }}
    />
  </div>
`
const f3Body = extractJsxAttribute(fixture3, 'onTouchStart')
assertMutation('4.3 [Self-Check] Analysis correctly extracts onTouchStart when earlier style={{...}} appears before handler',
  f3Body.includes('isFollowCamRef.current = false') && !f3Body.includes('position: absolute'),
  `Extracted valid body: ${f3Body.length} chars`
)

// Fixture 4: A map touch handler that calls setIs3D(false)
const fixture4 = `
  <div
    ref={mapRef}
    onTouchStart={() => {
      setIs3D(false)
    }}
  />
`
const f4Body = extractJsxAttribute(fixture4, 'onTouchStart')
const f4DefectDetected = f4Body.includes('setIs3D')
assertMutation('4.4 [Self-Check] Analysis detects map touch handler that calls setIs3D(false)',
  f4DefectDetected === true,
  `Correctly identified setIs3D in handler`
)

// Fixture 5: onModeChange using functional updater setIs3D(prev => false)
const fixture5 = `
  navCameraRef.current = new NavCamera({
    onModeChange: (mode) => {
      if (mode === '2D') setIs3D(prev => false)
    }
  })
`
const f5Match = fixture5.match(/onModeChange\s*:\s*\(([^)]*)\)\s*=>\s*\{([^}]*)\}/s)
const f5HasUpdater = f5Match && /setIs3D\s*\(\s*(?:prev|previous|\([^)]*\))\s*=>/.test(f5Match[2])
assertMutation('4.5 [Self-Check] Analysis detects functional updater inside onModeChange callback fixture',
  f5HasUpdater === true,
  'Correctly identified functional updater inside onModeChange callback'
)

// =============================================================================
// Summary
// =============================================================================
const passedMain = results.filter(r => r.pass).length
const failedMain = results.filter(r => !r.pass).length
const passedMut = mutationResults.filter(r => r.pass).length
const failedMut = mutationResults.filter(r => !r.pass).length

console.log(`\n=== Verification Results ===`)
console.log(`Production & Model Checks : ${results.length} total, ${passedMain} passed, ${failedMain} failed`)
console.log(`Static Analysis Self-Checks: ${mutationResults.length} total, ${passedMut} passed, ${failedMut} failed`)

if (failedMain > 0 || failedMut > 0) {
  process.exit(1)
} else {
  process.exit(0)
}
