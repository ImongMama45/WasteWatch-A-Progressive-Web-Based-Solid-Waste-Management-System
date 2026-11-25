/**
 * watcherRouteScope.test.js
 * -------------------------
 * Targeted unit tests for Stage 5A Watcher route scoping, coverage labels,
 * 403 error surfacing, and zero-emoji compliance.
 *
 * Run with:
 *   node --test src/pages/watcher/__tests__/watcherRouteScope.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeAuthorizedStops,
  getRouteCoverageLabel,
  extractStopActionError,
} from '../watcherRouteHelpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WATCHER_DIR = path.resolve(__dirname, '..')

test('Stage 5A - Cross-barangay stop normalization preserves all backend-authorized stops', () => {
  const backendStops = [
    {
      id: 1,
      schedule_id: 10,
      stop_order: 1,
      barangay_id: 101,
      barangay_name: 'Isabang',
      barangay_names: 'Isabang, Gulang-Gulang',
      lat: 13.932,
      lng: 121.612,
      current_status: 'PENDING_INSPECTION',
    },
    {
      id: 2,
      schedule_id: 10,
      stop_order: 2,
      barangay_id: 202,
      barangay_name: 'Gulang-Gulang',
      barangay_names: 'Isabang, Gulang-Gulang',
      lat: 13.945,
      lng: 121.625,
      current_status: 'PENDING_INSPECTION',
    },
    {
      id: 3,
      schedule_id: 10,
      stop_order: 3,
      barangay_id: null,
      barangay_name: null,
      barangay_names: 'Isabang, Gulang-Gulang',
      pre_validation_latitude: 13.951,
      pre_validation_longitude: 121.631,
      current_status: 'PENDING_INSPECTION',
    },
  ]

  // Must preserve all 3 stops regardless of user.barangay (e.g. Brgy 101 or null)
  const normalized = normalizeAuthorizedStops(backendStops)
  assert.equal(normalized.length, 3)
  assert.deepEqual(
    normalized.map((s) => s.id),
    [1, 2, 3]
  )
  assert.equal(normalized[2].lat, 13.951)
  assert.equal(normalized[2].lng, 121.631)
})

test('Stage 5A - Route coverage label summarizes deduplicated route barangays cleanly', () => {
  const singleStop = [{ barangay_name: 'Isabang', barangay_names: 'Isabang' }]
  assert.equal(getRouteCoverageLabel(singleStop), 'Isabang')

  const multiStops = [
    { barangay_name: 'Isabang', barangay_names: 'Isabang, Gulang-Gulang' },
    { barangay_name: 'Gulang-Gulang', barangay_names: 'Isabang, Gulang-Gulang' },
    { barangay_name: 'Market View', barangay_names: 'Isabang, Gulang-Gulang, Market View' },
  ]
  assert.equal(getRouteCoverageLabel(multiStops), 'Isabang, Gulang-Gulang, Market View')

  const manyStops = [
    { barangay_name: 'Brgy 1' },
    { barangay_name: 'Brgy 2' },
    { barangay_name: 'Brgy 3' },
    { barangay_name: 'Brgy 4' },
  ]
  assert.equal(getRouteCoverageLabel(manyStops), 'Brgy 1, Brgy 2 +2 more')

  const unmappedStops = [{ id: 1, barangay_name: null, barangay_names: '' }]
  assert.equal(getRouteCoverageLabel(unmappedStops), 'Assigned Route')
  assert.equal(getRouteCoverageLabel([], 'Assigned Route'), 'Assigned Route')
  assert.equal(getRouteCoverageLabel([], ''), '')
})

test('Stage 5A - Overlay 403 and validation error extraction surfaces backend messages', () => {
  const err403 = { response: { status: 403, data: { error: 'Not authorized for this stop.' } } }
  assert.equal(extractStopActionError(err403), 'Not authorized for this stop.')

  const errDetail = { response: { status: 403, data: { detail: 'Authentication credentials were not provided.' } } }
  assert.equal(extractStopActionError(errDetail), 'Authentication credentials were not provided.')

  const errUnknown = { response: { status: 500, data: {} } }
  assert.equal(extractStopActionError(errUnknown), 'Server error. Please try again.')
})

test('Stage 5A - Modified watcher files have no client-side user.barangay stop filter and zero emojis', () => {
  const filesToCheck = [
    path.join(WATCHER_DIR, 'WatcherMapTaskModule.jsx'),
    path.join(WATCHER_DIR, 'WatcherTasksHub.jsx'),
    path.join(WATCHER_DIR, 'watcherRouteHelpers.js'),
    path.join(WATCHER_DIR, 'components', 'PreInspectionOverlay.jsx'),
    path.join(WATCHER_DIR, 'components', 'PostCollectionOverlay.jsx'),
  ]

  // Match Unicode Extended Pictographic / emoji codepoints
  const emojiRegex = /\p{Extended_Pictographic}/u

  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf8')
    assert.equal(
      emojiRegex.test(content),
      false,
      `Expected zero emojis in ${path.basename(filePath)}`
    )
  }

  const mapModuleContent = fs.readFileSync(path.join(WATCHER_DIR, 'WatcherMapTaskModule.jsx'), 'utf8')
  assert.equal(
    /allStops\.filter\s*\(/.test(mapModuleContent),
    false,
    'WatcherMapTaskModule.jsx must not client-filter backend-authorized allStops'
  )
  assert.equal(
    mapModuleContent.includes('No barangay assigned'),
    false,
    'WatcherMapTaskModule.jsx must not display "No barangay assigned"'
  )
})
