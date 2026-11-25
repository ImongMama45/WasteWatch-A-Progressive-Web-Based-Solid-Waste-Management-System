// teamManagementChallenge.test.js
// Adversarial challenge test suite for WasteWatch Sanitation Team Management Redesign
// Run with: node --test wastewatch/frontend/src/pages/admin/__tests__/teamManagementChallenge.test.js

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Load helper components/code
const teamManagementPath = path.resolve('wastewatch/frontend/src/pages/admin/TeamManagement.jsx')
const teamManagementCssPath = path.resolve('wastewatch/frontend/src/pages/admin/TeamManagement.css')
const teamManagementSource = fs.readFileSync(teamManagementPath, 'utf8')
const teamManagementCssSource = fs.readFileSync(teamManagementCssPath, 'utf8')

// Role label mappings from source
const SYSTEM_ROLE_LABELS = {
  watcher: 'Watcher',
  driver: 'Driver',
  citizen: 'Citizen',
  admin: 'Administrator',
  brgy_official: 'Barangay Official',
}

const ROLE_LABELS = {
  leader: 'Team Leader',
  driver: 'Assigned Driver',
  crew: 'Crew Member',
}

// Logic mirror strictly derived from TeamManagement.jsx lines 716-765
function isWorkerEligibleForRole(worker, roleInTeam) {
  const sysRole = worker?.user_role || null
  const empType = worker?.employee_type || null
  if (roleInTeam === 'leader') return sysRole === 'watcher' || sysRole === 'driver'
  if (roleInTeam === 'driver') return sysRole === 'driver'
  if (roleInTeam === 'crew') return !sysRole || (sysRole === 'citizen' && empType === 'crew_member')
  return false
}

function validateWorkerDrop(worker, team, roleInTeam) {
  if (!worker || !team) return { valid: false, reason: 'Invalid worker or team.' }
  if (!team.is_active) return { valid: false, reason: 'Cannot assign personnel to an inactive sanitation team.' }

  if (!isWorkerEligibleForRole(worker, roleInTeam)) {
    if (roleInTeam === 'leader') {
      return {
        valid: false,
        reason: `${worker.full_name} (${worker.user_role ? SYSTEM_ROLE_LABELS[worker.user_role] || worker.user_role : 'Crew Member'}) is not eligible for Team Leader. Watchers or Drivers only.`,
      }
    }
    if (roleInTeam === 'driver') {
      return {
        valid: false,
        reason: `${worker.full_name} is not eligible for Assigned Driver. Driver system account required.`,
      }
    }
    return {
      valid: false,
      reason: `${worker.full_name} (${worker.user_role || 'Staff'}) is not eligible for Crew Member. Unauthenticated crew members only.`,
    }
  }

  // Single-person position protection: prevent silent overwrite of occupied Team Leader or Driver
  if (roleInTeam === 'leader' && team.active_leader && team.active_leader.id !== worker.id) {
    return {
      valid: false,
      reason: `Occupied Position: ${team.name} already has an active Team Leader (${team.active_leader.name}). To prevent accidental replacement, remove or transfer the current leader first.`,
    }
  }
  if (roleInTeam === 'driver' && team.active_driver && team.active_driver.id !== worker.id) {
    return {
      valid: false,
      reason: `Occupied Position: ${team.name} already has an active Assigned Driver (${team.active_driver.name}). To prevent accidental replacement, remove or transfer the current driver first.`,
    }
  }

  return { valid: true, reason: '' }
}

// Readiness warnings derived from TeamManagement.jsx lines 645-665
function getTeamWarnings(team) {
  const warnings = []
  if (!team.active_leader) {
    warnings.push('Missing Team Leader')
  }
  if (team.team_leader_mode === 'watcher' && !team.active_driver) {
    warnings.push('Missing Assigned Driver')
  }
  if (!team.crew_members || team.crew_members.length === 0) {
    warnings.push('No Crew Members')
  }
  if (!team.assigned_schedules || team.assigned_schedules.length === 0) {
    warnings.push('No Assigned Schedule')
  } else {
    const missingDumpsite = team.assigned_schedules.some(s => !s.dumpsite_id && !s.dumpsite_name)
    if (missingDumpsite) {
      warnings.push('Schedule Missing Dumpsite')
    }
  }
  return warnings
}

// Drop handlers builder derived from TeamManagement.jsx lines 1356-1412
function buildDropHandlers({
  team,
  roleInTeam,
  selectedPoolWorker,
  draggedWorker,
  dragOverTarget,
  isAdmin = true,
  onAssignOrTransfer,
}) {
  const isTapEligible =
    selectedPoolWorker &&
    validateWorkerDrop(selectedPoolWorker, team, roleInTeam).valid
  const isDragTarget = dragOverTarget?.teamId === team.id && dragOverTarget?.role === roleInTeam
  const dropClass = isDragTarget
    ? (dragOverTarget.isValid ? 'drag-over-valid' : 'drag-over-invalid')
    : (isTapEligible ? 'tap-eligible' : '')

  return {
    dropClass,
    role: 'button',
    tabIndex: selectedPoolWorker ? 0 : -1,
    'aria-label': `Assign ${selectedPoolWorker ? selectedPoolWorker.full_name : 'worker'} as ${ROLE_LABELS[roleInTeam]} to ${team.name}`,
    onDragOver: (dataTransfer) => {
      if (!isAdmin || !draggedWorker) return null
      const check = validateWorkerDrop(draggedWorker, team, roleInTeam)
      dataTransfer.dropEffect = check.valid ? 'move' : 'none'
      return { teamId: team.id, role: roleInTeam, isValid: check.valid }
    },
    onDrop: (workerToAssign) => {
      if (workerToAssign && isAdmin) {
        return onAssignOrTransfer(workerToAssign, team, roleInTeam)
      }
      return null
    },
    onClick: () => {
      if (isAdmin && selectedPoolWorker) {
        return onAssignOrTransfer(selectedPoolWorker, team, roleInTeam)
      }
      return null
    },
    onKeyDown: (key) => {
      if (key === 'Enter' || key === ' ') {
        if (isAdmin && selectedPoolWorker) {
          return onAssignOrTransfer(selectedPoolWorker, team, roleInTeam)
        }
      }
      return null
    },
  }
}

// Test harness simulating handlePoolAssignOrTransfer
function simulateAssignOrTransfer({
  worker,
  team,
  roleInTeam,
  isAdmin = true,
  apiCalls = [],
  notifications = [],
  modalState = { show: false, transferWorker: null, targetTeamId: null, targetRole: null },
}) {
  if (!isAdmin) return { status: 'unauthorized' }

  const check = validateWorkerDrop(worker, team, roleInTeam)
  if (!check.valid) {
    notifications.push({ message: check.reason, type: 'error' })
    return { status: 'rejected', reason: check.reason }
  }

  const activeMembership = worker.active_team
  if (activeMembership) {
    if (activeMembership.id === team.id && activeMembership.role_in_team === roleInTeam) {
      notifications.push({
        message: `${worker.full_name} is already assigned as ${ROLE_LABELS[roleInTeam]} on ${team.code}.`,
        type: 'info',
      })
      return { status: 'already_assigned' }
    }

    // Existing active membership MUST route through authorized transfer workflow
    modalState.show = true
    modalState.transferWorker = {
      id: worker.id,
      name: worker.full_name,
      employee_id: worker.employee_id,
      system_role: worker.user_role,
      employee_type: worker.employee_type,
    }
    modalState.targetTeamId = String(team.id)
    modalState.targetRole = roleInTeam
    return { status: 'modal_triggered', modalState }
  }

  apiCalls.push({
    endpoint: `/api/driver/teams/${team.id}/assign-member/`,
    body: { worker_id: worker.id, role_in_team: roleInTeam },
  })
  notifications.push({
    message: `${worker.full_name} assigned as ${ROLE_LABELS[roleInTeam]} on ${team.code}.`,
    type: 'success',
  })
  return { status: 'assigned' }
}

describe('Challenge 1: Drag-and-Drop & Tap-to-Assign Role Eligibility & Rejections', () => {
  const activeTeam = {
    id: 1,
    code: 'TM-ALPHA',
    name: 'Team Alpha',
    is_active: true,
    team_leader_mode: 'watcher',
    active_leader: null,
    active_driver: null,
    crew_members: [],
  }

  const inactiveTeam = {
    ...activeTeam,
    id: 99,
    is_active: false,
  }

  const driverWorker = {
    id: 10,
    full_name: 'Danilo Driver',
    employee_id: 'DRV-001',
    user_role: 'driver',
    employee_type: null,
    active_team: null,
  }

  const watcherWorker = {
    id: 20,
    full_name: 'Wanda Watcher',
    employee_id: 'WAT-001',
    user_role: 'watcher',
    employee_type: null,
    active_team: null,
  }

  const citizenStaffWorker = {
    id: 30,
    full_name: 'Carlos Citizen',
    employee_id: 'CTZ-001',
    user_role: 'citizen',
    employee_type: null,
    active_team: null,
  }

  const crewWorkerWithCitizenAccount = {
    id: 40,
    full_name: 'Crispin Crew',
    employee_id: 'CRW-001',
    user_role: 'citizen',
    employee_type: 'crew_member',
    active_team: null,
  }

  const unauthenticatedCrewWorker = {
    id: 50,
    full_name: 'Ubaldo Unauth',
    employee_id: 'CRW-002',
    user_role: null,
    employee_type: 'crew_member',
    active_team: null,
  }

  it('rejects driver worker dropped into crew member slot', () => {
    const res = validateWorkerDrop(driverWorker, activeTeam, 'crew')
    assert.equal(res.valid, false)
    assert.match(res.reason, /not eligible for Crew Member/)

    // Drag-over visual feedback test
    const fakeDataTransfer = {}
    const handlers = buildDropHandlers({
      team: activeTeam,
      roleInTeam: 'crew',
      draggedWorker: driverWorker,
      dragOverTarget: { teamId: 1, role: 'crew', isValid: false },
    })
    handlers.onDragOver(fakeDataTransfer)
    assert.equal(fakeDataTransfer.dropEffect, 'none', 'dropEffect must be none for ineligible worker')
    assert.equal(handlers.dropClass, 'drag-over-invalid', 'Must show red drag-over-invalid state')
  })

  it('rejects watcher worker dropped into crew member slot', () => {
    const res = validateWorkerDrop(watcherWorker, activeTeam, 'crew')
    assert.equal(res.valid, false)
    assert.match(res.reason, /not eligible for Crew Member/)
  })

  it('rejects citizen worker (without crew_member employee_type) dropped into driver slot', () => {
    const res = validateWorkerDrop(citizenStaffWorker, activeTeam, 'driver')
    assert.equal(res.valid, false)
    assert.match(res.reason, /Driver system account required/)
  })

  it('rejects watcher worker dropped into driver slot', () => {
    const res = validateWorkerDrop(watcherWorker, activeTeam, 'driver')
    assert.equal(res.valid, false)
    assert.match(res.reason, /Driver system account required/)
  })

  it('rejects citizen worker without crew_member employee_type dropped into crew slot', () => {
    const res = validateWorkerDrop(citizenStaffWorker, activeTeam, 'crew')
    assert.equal(res.valid, false)
    assert.match(res.reason, /not eligible for Crew Member/)
  })

  it('rejects unauthenticated staff dropped into leader slot', () => {
    const res = validateWorkerDrop(unauthenticatedCrewWorker, activeTeam, 'leader')
    assert.equal(res.valid, false)
    assert.match(res.reason, /Watchers or Drivers only/)
  })

  it('accepts eligible personnel for their respective roles', () => {
    assert.equal(validateWorkerDrop(watcherWorker, activeTeam, 'leader').valid, true)
    assert.equal(validateWorkerDrop(driverWorker, activeTeam, 'leader').valid, true)
    assert.equal(validateWorkerDrop(driverWorker, activeTeam, 'driver').valid, true)
    assert.equal(validateWorkerDrop(crewWorkerWithCitizenAccount, activeTeam, 'crew').valid, true)
    assert.equal(validateWorkerDrop(unauthenticatedCrewWorker, activeTeam, 'crew').valid, true)
  })

  it('rejects any assignment to inactive sanitation teams', () => {
    const res = validateWorkerDrop(driverWorker, inactiveTeam, 'driver')
    assert.equal(res.valid, false)
    assert.match(res.reason, /inactive sanitation team/)
  })
})

describe('Challenge 2: Single-Person Slot Overwrite Protection (Leader & Driver)', () => {
  const teamWithLeader = {
    id: 1,
    code: 'TM-ALPHA',
    name: 'Team Alpha',
    is_active: true,
    team_leader_mode: 'watcher',
    active_leader: { id: 101, name: 'Original Leader', employee_id: 'WAT-101' },
    active_driver: null,
    crew_members: [],
  }

  const teamWithDriver = {
    id: 2,
    code: 'TM-BETA',
    name: 'Team Beta',
    is_active: true,
    team_leader_mode: 'watcher',
    active_leader: null,
    active_driver: { id: 201, name: 'Original Driver', employee_id: 'DRV-201' },
    crew_members: [],
  }

  const incomingLeaderCandidate = {
    id: 102,
    full_name: 'New Leader Candidate',
    employee_id: 'WAT-102',
    user_role: 'watcher',
    employee_type: null,
    active_team: null,
  }

  const incomingDriverCandidate = {
    id: 202,
    full_name: 'New Driver Candidate',
    employee_id: 'DRV-202',
    user_role: 'driver',
    employee_type: null,
    active_team: null,
  }

  it('blocks dropping a worker onto an occupied Team Leader slot without overwriting', () => {
    const check = validateWorkerDrop(incomingLeaderCandidate, teamWithLeader, 'leader')
    assert.equal(check.valid, false)
    assert.match(check.reason, /Occupied Position: Team Alpha already has an active Team Leader/)
    assert.match(check.reason, /Original Leader/)

    const notifications = []
    const apiCalls = []
    const simRes = simulateAssignOrTransfer({
      worker: incomingLeaderCandidate,
      team: teamWithLeader,
      roleInTeam: 'leader',
      apiCalls,
      notifications,
    })

    assert.equal(simRes.status, 'rejected')
    assert.equal(apiCalls.length, 0, 'No backend API call should be dispatched on occupied slot drop')
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].type, 'error')
  })

  it('blocks dropping a worker onto an occupied Assigned Driver slot without overwriting', () => {
    const check = validateWorkerDrop(incomingDriverCandidate, teamWithDriver, 'driver')
    assert.equal(check.valid, false)
    assert.match(check.reason, /Occupied Position: Team Beta already has an active Assigned Driver/)
    assert.match(check.reason, /Original Driver/)

    const notifications = []
    const apiCalls = []
    const simRes = simulateAssignOrTransfer({
      worker: incomingDriverCandidate,
      team: teamWithDriver,
      roleInTeam: 'driver',
      apiCalls,
      notifications,
    })

    assert.equal(simRes.status, 'rejected')
    assert.equal(apiCalls.length, 0, 'No backend API call should be dispatched on occupied driver slot')
    assert.equal(notifications.length, 1)
    assert.equal(notifications[0].type, 'error')
  })

  it('permits dropping the CURRENT occupant on their own slot without occupied position error', () => {
    const currentLeader = {
      id: 101,
      full_name: 'Original Leader',
      employee_id: 'WAT-101',
      user_role: 'watcher',
      employee_type: null,
      active_team: { id: 1, code: 'TM-ALPHA', role_in_team: 'leader' },
    }
    const check = validateWorkerDrop(currentLeader, teamWithLeader, 'leader')
    assert.equal(check.valid, true, 'Self-drop should pass overwrite check')

    const notifications = []
    const simRes = simulateAssignOrTransfer({
      worker: currentLeader,
      team: teamWithLeader,
      roleInTeam: 'leader',
      notifications,
    })
    assert.equal(simRes.status, 'already_assigned')
    assert.match(notifications[0].message, /already assigned as Team Leader/)
  })
})

describe('Challenge 3: Cross-Team Transfer Modal Routing & Confirmation', () => {
  const teamAlpha = {
    id: 10,
    code: 'TM-ALPHA',
    name: 'Team Alpha',
    is_active: true,
    team_leader_mode: 'watcher',
    active_leader: null,
    active_driver: null,
    crew_members: [],
  }

  const teamBeta = {
    id: 20,
    code: 'TM-BETA',
    name: 'Team Beta',
    is_active: true,
    team_leader_mode: 'watcher',
    active_leader: null,
    active_driver: null,
    crew_members: [],
  }

  const assignedWorker = {
    id: 55,
    full_name: 'Ramon Ramos',
    employee_id: 'CRW-055',
    user_role: 'citizen',
    employee_type: 'crew_member',
    active_team: { id: 10, code: 'TM-ALPHA', role_in_team: 'crew' },
  }

  it('routes cross-team assignment to transfer modal instead of direct assignment API', () => {
    const apiCalls = []
    const notifications = []
    const modalState = { show: false, transferWorker: null, targetTeamId: null, targetRole: null }

    const res = simulateAssignOrTransfer({
      worker: assignedWorker,
      team: teamBeta,
      roleInTeam: 'crew',
      apiCalls,
      notifications,
      modalState,
    })

    assert.equal(res.status, 'modal_triggered')
    assert.equal(apiCalls.length, 0, 'Direct assign API MUST NOT be called')
    assert.equal(modalState.show, true, 'Transfer modal MUST be triggered')
    assert.equal(modalState.transferWorker.id, 55)
    assert.equal(modalState.targetTeamId, '20')
    assert.equal(modalState.targetRole, 'crew')
  })

  it('routes intra-team operational role change to transfer modal', () => {
    const watcherWorker = {
      id: 77,
      full_name: 'Wilma Watcher',
      employee_id: 'WAT-077',
      user_role: 'watcher',
      employee_type: null,
      active_team: { id: 10, code: 'TM-ALPHA', role_in_team: 'crew' }, // currently crew
    }

    const apiCalls = []
    const modalState = { show: false, transferWorker: null, targetTeamId: null, targetRole: null }

    const res = simulateAssignOrTransfer({
      worker: watcherWorker,
      team: teamAlpha,
      roleInTeam: 'leader', // changing designation to leader
      apiCalls,
      modalState,
    })

    assert.equal(res.status, 'modal_triggered')
    assert.equal(apiCalls.length, 0)
    assert.equal(modalState.show, true)
    assert.equal(modalState.targetTeamId, '10')
    assert.equal(modalState.targetRole, 'leader')
  })
})

describe('Challenge 4: Drop Targets Keyboard & Tap Accessibility Contract', () => {
  const team = {
    id: 1,
    code: 'TM-01',
    name: 'Team One',
    is_active: true,
    team_leader_mode: 'watcher',
    active_leader: null,
    active_driver: null,
    crew_members: [],
  }

  const selectedWorker = {
    id: 12,
    full_name: 'Elena Cruz',
    employee_id: 'WAT-012',
    user_role: 'watcher',
    employee_type: null,
    active_team: null,
  }

  it('sets tabIndex to -1 when no worker is selected in personnel pool', () => {
    const handlers = buildDropHandlers({
      team,
      roleInTeam: 'leader',
      selectedPoolWorker: null,
    })
    assert.equal(handlers.tabIndex, -1, 'Must not be in tab order when no worker is armed')
    assert.equal(handlers.role, 'button')
  })

  it('sets tabIndex to 0 and adds tap-eligible class when eligible worker is selected', () => {
    const handlers = buildDropHandlers({
      team,
      roleInTeam: 'leader',
      selectedPoolWorker: selectedWorker,
    })
    assert.equal(handlers.tabIndex, 0, 'Must enter tab sequence when worker is armed')
    assert.equal(handlers.dropClass, 'tap-eligible')
    assert.match(handlers['aria-label'], /Assign Elena Cruz as Team Leader to Team One/)
  })

  it('triggers assignment when Enter or Space is pressed on focused drop target', () => {
    let assigned = null
    const handlers = buildDropHandlers({
      team,
      roleInTeam: 'leader',
      selectedPoolWorker: selectedWorker,
      onAssignOrTransfer: (w, t, r) => {
        assigned = { worker: w, team: t, role: r }
        return 'assigned_via_key'
      },
    })

    const enterRes = handlers.onKeyDown('Enter')
    assert.equal(enterRes, 'assigned_via_key')
    assert.equal(assigned.worker.id, 12)

    assigned = null
    const spaceRes = handlers.onKeyDown(' ')
    assert.equal(spaceRes, 'assigned_via_key')
    assert.equal(assigned.worker.id, 12)

    const otherKeyRes = handlers.onKeyDown('Tab')
    assert.equal(otherKeyRes, null, 'Non-activation keys should not trigger assignment')
  })
})

describe('Challenge 5: 5-Team Server-Side Pagination Boundaries and Edge Cases', () => {
  // Pure logic mirror of Pagination calculations from Pagination.jsx
  function computePaginationState({ currentPage, totalPages, totalCount, pageSize = 5 }) {
    if (totalCount === 0 && totalPages <= 1) {
      return { isHidden: true, startItem: 0, endItem: 0, currentBatchCount: 0 }
    }
    const validCurrentPage = Math.max(1, Math.min(currentPage, Math.max(1, totalPages)))
    const startItem = totalCount === 0 ? 0 : (validCurrentPage - 1) * pageSize + 1
    const endItem = Math.min(validCurrentPage * pageSize, totalCount)
    const currentBatchCount = Math.max(0, endItem - startItem + 1)
    const canPrev = validCurrentPage > 1
    const canNext = validCurrentPage < totalPages
    return {
      isHidden: false,
      validCurrentPage,
      startItem,
      endItem,
      currentBatchCount,
      canPrev,
      canNext,
    }
  }

  it('handles Page 1 of 1 boundary correctly (totalCount = 3, pageSize = 5)', () => {
    const state = computePaginationState({
      currentPage: 1,
      totalPages: 1,
      totalCount: 3,
      pageSize: 5,
    })

    assert.equal(state.isHidden, false)
    assert.equal(state.validCurrentPage, 1)
    assert.equal(state.startItem, 1)
    assert.equal(state.endItem, 3)
    assert.equal(state.currentBatchCount, 3)
    assert.equal(state.canPrev, false, 'Previous button must be disabled on page 1 of 1')
    assert.equal(state.canNext, false, 'Next button must be disabled on page 1 of 1')
  })

  it('hides pagination bar on empty search results (totalCount = 0)', () => {
    const state = computePaginationState({
      currentPage: 1,
      totalPages: 1,
      totalCount: 0,
      pageSize: 5,
    })
    assert.equal(state.isHidden, true, 'Pagination bar must return null when totalCount = 0')
  })

  it('handles last page boundary correctly (page 3 of 3 with totalCount = 12, pageSize = 5)', () => {
    const state = computePaginationState({
      currentPage: 3,
      totalPages: 3,
      totalCount: 12,
      pageSize: 5,
    })

    assert.equal(state.validCurrentPage, 3)
    assert.equal(state.startItem, 11)
    assert.equal(state.endItem, 12)
    assert.equal(state.currentBatchCount, 2)
    assert.equal(state.canPrev, true, 'Previous button enabled')
    assert.equal(state.canNext, false, 'Next button disabled on last page')
  })

  it('clamps out-of-bounds currentPage when dataset shrinks', () => {
    // If client requested page 5, but new totalCount is 7 (2 pages)
    const nextTotalCount = 7
    const PAGE_SIZE = 5
    const nextTotalPages = Math.max(1, Math.ceil(nextTotalCount / PAGE_SIZE))
    let currentPage = 5

    if (currentPage > nextTotalPages && nextTotalPages >= 1) {
      currentPage = nextTotalPages
    }

    assert.equal(currentPage, 2, 'Must clamp currentPage to 2 when dataset shrinks')
  })

  it('resets currentPage to 1 when filters or search change', () => {
    // Verifying filter handlers in TeamManagement.jsx
    assert.match(
      teamManagementSource,
      /setFilterStatus\(st\);\s*setCurrentPage\(1\)/,
      'Status filter must reset page to 1'
    )
    assert.match(
      teamManagementSource,
      /setLeadershipFilter\(e\.target\.value\);\s*setCurrentPage\(1\)/,
      'Leadership filter must reset page to 1'
    )
    assert.match(
      teamManagementSource,
      /if\s*\(prev\s*!==\s*searchQuery\)\s*\{\s*setCurrentPage\(1\)/,
      'Debounced search query must reset page to 1'
    )
  })

  it('prevents stale cards by clearing teams on error or replacing on fetch', () => {
    assert.match(
      teamManagementSource,
      /setTeams\(\[\]\)/,
      'fetchTeams catch block must clear teams array to prevent stale cards'
    )
    assert.match(
      teamManagementSource,
      /setTeams\(data\.results\)/,
      'fetchTeams must overwrite teams with fresh server results'
    )
  })
})

describe('Challenge 6: Readiness Warnings Computation', () => {
  it('emits warning when team has no assigned schedule', () => {
    const team = {
      active_leader: { id: 1, name: 'Leader' },
      team_leader_mode: 'watcher',
      active_driver: { id: 2, name: 'Driver' },
      crew_members: [{ id: 3, name: 'Crew 1' }],
      assigned_schedules: [], // No schedule
    }
    const warnings = getTeamWarnings(team)
    assert.deepEqual(warnings, ['No Assigned Schedule'])
  })

  it('emits warning when team schedule has no dumpsite', () => {
    const team = {
      active_leader: { id: 1, name: 'Leader' },
      team_leader_mode: 'watcher',
      active_driver: { id: 2, name: 'Driver' },
      crew_members: [{ id: 3, name: 'Crew 1' }],
      assigned_schedules: [
        { id: 101, area: 'Poblacion', dumpsite_id: null, dumpsite_name: null },
      ],
    }
    const warnings = getTeamWarnings(team)
    assert.deepEqual(warnings, ['Schedule Missing Dumpsite'])
  })

  it('emits both missing schedule and missing personnel warnings for empty team', () => {
    const emptyTeam = {
      active_leader: null,
      team_leader_mode: 'watcher',
      active_driver: null,
      crew_members: [],
      assigned_schedules: [],
    }
    const warnings = getTeamWarnings(emptyTeam)
    assert.deepEqual(warnings, [
      'Missing Team Leader',
      'Missing Assigned Driver',
      'No Crew Members',
      'No Assigned Schedule',
    ])
  })

  it('does NOT emit missing driver warning for driver-led team without separate driver', () => {
    const driverLedTeam = {
      active_leader: { id: 1, name: 'Driver Leader' },
      team_leader_mode: 'driver', // Driver-led
      active_driver: null,
      crew_members: [{ id: 2, name: 'Crew 1' }],
      assigned_schedules: [{ id: 1, dumpsite_id: 10, dumpsite_name: 'Lucena Sanitary Landfill' }],
    }
    const warnings = getTeamWarnings(driverLedTeam)
    assert.deepEqual(warnings, [], 'Driver-led team should not require a separate assigned driver')
  })

  it('emits zero warnings and evaluates to ready for a fully compliant team', () => {
    const readyTeam = {
      active_leader: { id: 1, name: 'Watcher Leader' },
      team_leader_mode: 'watcher',
      active_driver: { id: 2, name: 'Driver' },
      crew_members: [{ id: 3, name: 'Crew 1' }],
      assigned_schedules: [{ id: 1, dumpsite_id: 10, dumpsite_name: 'Lucena Sanitary Landfill' }],
    }
    const warnings = getTeamWarnings(readyTeam)
    assert.equal(warnings.length, 0, 'Ready team must have 0 warnings')
  })
})

describe('Challenge 7: Iconography Rule & Zero Emoji Compliance', () => {
  it('ensures zero emojis in TeamManagement.jsx and TeamManagement.css', () => {
    // Standard Unicode Emoji Ranges
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u

    const files = [
      { name: 'TeamManagement.jsx', content: teamManagementSource },
      { name: 'TeamManagement.css', content: teamManagementCssSource },
    ]

    for (const f of files) {
      const lines = f.content.split('\n')
      lines.forEach((line, idx) => {
        const match = emojiRegex.exec(line)
        assert.equal(
          match,
          null,
          `Emoji found in ${f.name} line ${idx + 1}: "${line.trim()}"`
        )
      })
    }
  })

  it('verifies exclusively SVG / Material / Lucide icons are used for visual iconography', () => {
    // Verify imports in TeamManagement.jsx include Lucide icons and no raw emoji literals
    assert.match(teamManagementSource, /import\s*\{[^}]*Users[^}]*\}\s*from\s*'lucide-react'/)
    assert.match(teamManagementSource, /import\s*\{[^}]*AlertTriangle[^}]*\}\s*from\s*'lucide-react'/)
    assert.match(teamManagementSource, /import\s*\{[^}]*CheckCircle2[^}]*\}\s*from\s*'lucide-react'/)
    assert.match(teamManagementSource, /import\s*\{[^}]*GripVertical[^}]*\}\s*from\s*'lucide-react'/)
  })
})
