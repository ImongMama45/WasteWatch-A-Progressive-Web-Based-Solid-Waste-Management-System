/**
 * allocationShiftFlow.test.js
 * ---------------------------
 * Regression tests for Round 5B.2 Phase B4 allocation-aware workflow,
 * dumpsite base resolution, DRF error formatting, and zero-emoji compliance.
 *
 * Run with:
 *   node --test src/pages/driver/__tests__/allocationShiftFlow.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getApiErrorMessage } from '../../../utils/notificationHelpers.js'
import {
  resolveScheduleDumpsiteOrigin,
  resolveScheduleReturnDestination,
} from '../../../utils/routeBaseHelpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SRC_DIR = path.resolve(__dirname, '..', '..', '..')

function readSrc(relPath) {
  return fs.readFileSync(path.join(SRC_DIR, relPath), 'utf8')
}

test('Round 5B.2 Phase B4 — Allocation-aware shift flow & error surfacing', async (t) => {
  await t.test('1. getApiErrorMessage surfaces DRF field-keyed allocation/team/truck/worker errors', () => {
    const err = {
      response: {
        status: 400,
        data: {
          allocation_id: ['Allocation #77 does not match the active schedule.'],
          worker_id: ['Worker Juan Cruz is already participating in another active shift.'],
        },
      },
    }
    const formatted = getApiErrorMessage(err)
    assert.match(formatted, /Allocation id: Allocation #77 does not match the active schedule\./)
    assert.match(formatted, /Worker id: Worker Juan Cruz is already participating in another active shift\./)
  })

  await t.test('2. routeBaseHelpers resolves dumpsite_detail before legacy waypoints[0]', () => {
    const schedWithDumpsite = {
      id: 10,
      dumpsite_detail: {
        id: 5,
        name: 'Lucena Sanitary Landfill',
        latitude: 13.991,
        longitude: 121.651,
      },
      waypoints: [
        { lat: 13.9, lng: 121.6, label: 'Legacy City Hall' },
        { lat: 13.95, lng: 121.62, label: 'Stop 1' },
      ],
    }

    const origin = resolveScheduleDumpsiteOrigin(schedWithDumpsite)
    const ret = resolveScheduleReturnDestination(schedWithDumpsite)
    assert.equal(origin?.label, 'Lucena Sanitary Landfill')
    assert.equal(origin?.lat, 13.991)
    assert.equal(ret?.label, 'Lucena Sanitary Landfill')
    assert.equal(ret?.lng, 121.651)
  })

  await t.test('3. AssignmentModule fetches preallocated-truck, gates start, sends allocation_id, and notifies siblings', () => {
    const src = readSrc('pages/driver/components/AssignmentModule.jsx')
    assert.match(src, /getPreallocatedTruck\(schedule\.id\)/)
    assert.match(src, /allocation_id:\s*allocation\.id/)
    assert.match(src, /!isAllocationReady/)
    assert.match(src, /window\.dispatchEvent\(new Event\('ww_shift_updated'\)\)/)
    assert.match(src, /getApiErrorMessage\(err/)
  })

  await t.test('4. CheckInModule sends schedule_id/allocation_id, has no bare startShift() or dead localStorage check', () => {
    const src = readSrc('pages/driver/components/CheckInModule.jsx')
    assert.match(src, /schedule_id:\s*resolvedScheduleId/)
    assert.match(src, /startPayload\.allocation_id\s*=\s*resolvedAllocationId/)
    assert.doesNotMatch(src, /ww_shift_start_/)
    assert.doesNotMatch(src, /\bstartShift\s*\(/)
    assert.match(src, /syncShiftPayload\(res\.data\)/)
    assert.match(src, /getApiErrorMessage\(err/)
  })

  await t.test('5. DriverDashboard tracks allocationLoading/allocationError, in-flight starting lock, desktop CTA parity, and desktop inline error visibility', () => {
    const src = readSrc('pages/dashboard/DriverDashboard.jsx')
    assert.match(src, /allocationLoading/)
    assert.match(src, /allocationError/)
    assert.match(src, /getPreallocatedTruck\(schedule\.id\)/)
    assert.match(src, /const \[starting,\s*setStarting\] = useState\(false\)/)
    assert.match(src, /startShift\(\{\s*scheduleId:\s*schedule\.id,\s*allocationId:\s*allocation\.id\s*\}\)/)
    assert.match(src, /getApiErrorMessage\(err/)
    assert.match(src, /\[\s*user\?\.id,\s*activeScheduleId,\s*applyScheduleMatch\s*\]/)

    // Desktop CTA (#driver-desktop-cta) shares exact gating and label parity with #driver-main-cta
    assert.match(src, /const isStartBlocked = Boolean\([\s\S]*?!isScheduleReady[\s\S]*?allocationLoading[\s\S]*?Boolean\(allocationError\)[\s\S]*?!allocation\?\.id/)
    assert.match(src, /const isCtaDisabled = Boolean\(starting \|\| loading \|\| isStartBlocked\)/)
    assert.match(src, /id="driver-main-cta"[\s\S]*?disabled=\{isCtaDisabled\}[\s\S]*?<span>\{ctaLabel\}<\/span>/)
    assert.match(src, /id="driver-desktop-cta"[\s\S]*?disabled=\{isCtaDisabled\}[\s\S]*?<span>\{ctaLabel\}<\/span>/)

    // Allocation summary and inline error banner must render outside .status-card-mobile-only so desktop sees them
    const mobileIdx = src.indexOf('className="status-card-mobile-only"')
    const allocSummaryIdx = src.indexOf('id="driver-allocation-summary"')
    const allocErrIdx = src.indexOf('id="driver-allocation-error"')
    assert.ok(mobileIdx > 0 && allocSummaryIdx > 0 && allocErrIdx > 0)
    assert.ok(allocSummaryIdx < mobileIdx, 'Allocation summary should be rendered outside .status-card-mobile-only')
    assert.ok(allocErrIdx < mobileIdx, 'Allocation error banner should be rendered outside .status-card-mobile-only')
  })

  await t.test('6. useShiftTimer tracks allocationId and rejects bare startShift() calls', () => {
    const src = readSrc('hooks/useShiftTimer.js')
    assert.match(src, /allocationId:\s*null/)
    assert.match(src, /shift\.allocation_id \?\? shift\.allocation \?\? null/)
    assert.match(src, /if\s*\(\s*scheduleId\s*==\s*null\s*&&\s*allocationId\s*==\s*null\s*\)/)
    assert.match(src, /syncShiftPayload/)
  })

  await t.test('7. RouteOverview, NavigateToBaseModule, and EndShiftModule remove s.driver filter & resolve dumpsite base first', () => {
    const routeOverviewSrc = readSrc('pages/driver/RouteOverview.jsx')
    assert.doesNotMatch(routeOverviewSrc, /String\(s\.driver\)\s*===\s*String\(user\.id\)/)

    const navBaseSrc = readSrc('pages/driver/components/NavigateToBaseModule.jsx')
    assert.match(navBaseSrc, /resolveScheduleDumpsiteOrigin\(match\)/)

    const endShiftSrc = readSrc('pages/driver/components/EndShiftModule.jsx')
    assert.match(endShiftSrc, /resolveScheduleReturnDestination\(match\)/)
  })

  await t.test('8. TeamManagement Tab 2 transfer preserves worker_system_role / worker_employee_type and all modified files have zero emojis', () => {
    const teamMgmtSrc = readSrc('pages/admin/TeamManagement.jsx')
    assert.match(teamMgmtSrc, /worker_system_role/)
    assert.match(teamMgmtSrc, /worker_employee_type/)

    const crewBoardSrc = readSrc('components/CrewAttendanceBoard.jsx')
    assert.doesNotMatch(crewBoardSrc, /can_submit_attendance:\s*Boolean\(user\?\.role\s*===\s*'driver'\)/)
    assert.doesNotMatch(crewBoardSrc, /is_driver_team_leader:\s*Boolean\(user\?\.role\s*===\s*'driver'\)/)

    const emojiRegex = /[\u{1F300}-\u{1FAFF}]/u
    const filesToScan = [
      'utils/driverSchedule.js',
      'pages/driver/RouteOverview.jsx',
      'hooks/useShiftTimer.js',
      'pages/driver/components/AssignmentModule.jsx',
      'pages/driver/components/CheckInModule.jsx',
      'pages/dashboard/DriverDashboard.jsx',
      'pages/driver/components/NavigateToBaseModule.jsx',
      'pages/driver/components/EndShiftModule.jsx',
      'pages/admin/TeamManagement.jsx',
      'components/CrewAttendanceBoard.jsx',
    ]
    for (const rel of filesToScan) {
      const content = readSrc(rel)
      assert.equal(emojiRegex.test(content), false, `Emoji found in ${rel}`)
    }
  })
})
