// driverFlowGuard.test.js — Unit tests for DriverRouteFlow fail-closed entry guard
// Run with Node.js built-in test runner:
//   node --test wastewatch/frontend/src/utils/__tests__/driverFlowGuard.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceFlowPhase,
  buildShiftBlockedToastMessage,
  canUseDevShiftReset,
  evaluateShiftEligibilityResponse,
  runShiftEligibilityCheck,
} from '../driverFlowGuard.js'

test('DriverRouteFlow fail-closed entry guard (driverFlowGuard)', async t => {
  await t.test('1. Loading state is emitted synchronously before eligibility settles', async () => {
    const states = []
    let sessionClearCalls = 0
    let resolveFetch
    const pendingPromise = new Promise(resolve => {
      resolveFetch = resolve
    })

    runShiftEligibilityCheck({
      fetchCurrentShift: () => pendingPromise,
      onStateChange: s => states.push(s),
      onBlocked: () => assert.fail('Should not block on eligible response'),
      clearSessionData: () => {
        sessionClearCalls += 1
      },
    })

    assert.equal(states.length, 1)
    assert.equal(sessionClearCalls, 0, 'Should not clear session while still loading')
    assert.deepEqual(states[0], {
      status: 'loading',
      phase: null,
      activeShift: null,
      truckPreviousShifts: [],
      canDevReset: false,
      errorMessage: null,
    })

    resolveFetch({
      data: {
        active_shift: null,
        can_start_shift: true,
        can_dev_reset: false,
        truck_previous_shifts_today: [{ id: 101, truck_plate: 'WW-901' }],
      },
    })
    await pendingPromise
    await new Promise(r => setImmediate(r))

    assert.equal(states.length, 2)
    assert.equal(states[1].status, 'ready')
    assert.equal(states[1].phase, 'assignment')
    assert.equal(sessionClearCalls, 1)
  })

  await t.test('2. Explicit eligible response allows assignment or resumes valid active shift', async () => {
    const states = []
    let clearedCount = 0

    runShiftEligibilityCheck({
      fetchCurrentShift: async () => ({
        data: {
          active_shift: null,
          can_start_shift: true,
          can_dev_reset: false,
          truck_previous_shifts_today: [{ id: 88 }],
        },
      }),
      onStateChange: s => states.push(s),
      clearSessionData: () => {
        clearedCount += 1
      },
    })

    await new Promise(r => setImmediate(r))
    assert.equal(states.at(-1).status, 'ready')
    assert.equal(states.at(-1).phase, 'assignment')
    assert.equal(states.at(-1).activeShift, null)
    assert.equal(clearedCount, 1)

    const resumeEval = evaluateShiftEligibilityResponse({
      active_shift: { id: 55, status: 'shiftroute', truck_plate: 'WW-100' },
      can_start_shift: true,
      can_dev_reset: true,
      truck_previous_shifts_today: [],
    })
    assert.equal(resumeEval.outcome, 'resume')
    assert.equal(resumeEval.phase, 'shiftroute')
    assert.equal(resumeEval.clearSession, false)
    assert.equal(resumeEval.canDevReset, true)
  })

  await t.test('3. Explicit ineligible response blocks flow and only appends timestamp for shift_already_ended', async () => {
    const states = []
    const blockedEvents = []
    let clearedCount = 0

    const prevShift = {
      id: 188,
      started_at: '2026-11-07T08:00:00+08:00',
      ended_at: '2026-11-07T11:30:00+08:00',
    }

    runShiftEligibilityCheck({
      fetchCurrentShift: async () => ({
        data: {
          active_shift: null,
          can_start_shift: false,
          block_reason: 'shift_already_ended',
          block_message: "Today's shift for TRUCK WW-901 has already ended.",
          previous_shift_today: prevShift,
        },
      }),
      onStateChange: s => states.push(s),
      onBlocked: info => blockedEvents.push(info),
      clearSessionData: () => {
        clearedCount += 1
      },
    })

    await new Promise(r => setImmediate(r))
    assert.equal(states.at(-1).status, 'blocked')
    assert.equal(states.at(-1).phase, null)
    assert.equal(clearedCount, 1)
    assert.equal(blockedEvents.length, 1)
    assert.match(blockedEvents[0].toastMessage, /\(Last shift: /)

    // Unscheduled day and suspended blocks MUST NOT append unrelated previous shift window
    const unscheduledMsg = buildShiftBlockedToastMessage({
      block_reason: 'no_schedule_today',
      block_message: 'You have no scheduled collection duty for today.',
      previous_shift_today: prevShift,
    })
    assert.equal(unscheduledMsg, 'You have no scheduled collection duty for today.')

    const suspendedMsg = buildShiftBlockedToastMessage({
      block_reason: 'suspended',
      block_message: 'Your account is suspended. You cannot start a shift.',
      previous_shift_today: prevShift,
    })
    assert.equal(suspendedMsg, 'Your account is suspended. You cannot start a shift.')
  })

  await t.test('4. Network and 5xx failures fail closed into error state without mounting assignment', async () => {
    const states = []
    const serverError = new Error('Request failed with status code 500')
    serverError.response = { status: 500, data: { error: 'Database unavailable.' } }

    runShiftEligibilityCheck({
      fetchCurrentShift: async () => {
        throw serverError
      },
      onStateChange: s => states.push(s),
      onBlocked: () => assert.fail('5xx error must not look like normal block redirect'),
    })

    await new Promise(r => setImmediate(r))
    const finalState = states.at(-1)
    assert.equal(finalState.status, 'error')
    assert.equal(finalState.phase, null)
    assert.equal(finalState.activeShift, null)
    assert.equal(finalState.errorMessage, 'Database unavailable.')
  })

  await t.test('5. Missing or malformed eligibility responses fail closed', () => {
    const malformedPayloads = [
      null,
      undefined,
      'html error page',
      [],
      {},
      { can_start_shift: true }, // missing active_shift key
      { active_shift: null }, // missing can_start_shift
      { active_shift: null, can_start_shift: 'true' }, // non-boolean string
      { active_shift: null, can_start_shift: 1 }, // non-boolean number
      { active_shift: { id: null, status: 'shiftroute' }, can_start_shift: true }, // missing shift id
      { active_shift: { id: 9, status: 'unknown_phase' }, can_start_shift: true }, // unknown phase
    ]

    for (const payload of malformedPayloads) {
      const result = evaluateShiftEligibilityResponse(payload)
      assert.equal(result.outcome, 'error', `Expected fail-closed error for payload: ${JSON.stringify(payload)}`)
    }
  })

  await t.test('6. Effect cleanup cancels stale async responses before state, session, or toast side effects', async () => {
    const states = []
    let blockedCalled = false
    let sessionCleared = false
    let receivedSignal = null
    let resolveFetch

    const cancel = runShiftEligibilityCheck({
      fetchCurrentShift: ({ signal } = {}) => {
        receivedSignal = signal
        return new Promise(resolve => {
          resolveFetch = resolve
        })
      },
      onStateChange: s => states.push(s),
      onBlocked: () => {
        blockedCalled = true
      },
      clearSessionData: () => {
        sessionCleared = true
      },
    })

    assert.equal(states.length, 1)
    assert.equal(states[0].status, 'loading')

    // Simulate component unmount before HTTP response resolves
    cancel()
    assert.equal(receivedSignal?.aborted, true)

    resolveFetch({
      data: {
        active_shift: null,
        can_start_shift: false,
        block_reason: 'no_schedule_today',
        block_message: 'Stale response should be ignored.',
      },
    })
    await new Promise(r => setImmediate(r))

    assert.equal(states.length, 1, 'No post-unmount state updates allowed')
    assert.equal(blockedCalled, false, 'No post-unmount toast/redirect allowed')
    assert.equal(sessionCleared, false, 'No post-unmount session mutation allowed')
  })

  await t.test('7. Dev reset button requires DEV env, active shift, and explicit admin authorization', () => {
    // No active shift -> disabled even for admin in DEV
    assert.equal(
      canUseDevShiftReset({
        isDevEnv: true,
        activeShift: null,
        user: { role: 'admin' },
        canDevReset: true,
      }),
      false
    )

    // Ordinary driver with active shift -> disabled
    assert.equal(
      canUseDevShiftReset({
        isDevEnv: true,
        activeShift: { id: 10, status: 'shiftroute' },
        user: { role: 'driver' },
        canDevReset: false,
      }),
      false
    )

    // Ordinary driver when canDevReset omitted -> disabled
    assert.equal(
      canUseDevShiftReset({
        isDevEnv: true,
        activeShift: { id: 10, status: 'shiftroute' },
        user: { role: 'driver' },
        canDevReset: null,
      }),
      false
    )

    // Authorized admin in DEV with active shift and backend canDevReset=true -> enabled
    assert.equal(
      canUseDevShiftReset({
        isDevEnv: true,
        activeShift: { id: 10, status: 'shiftroute' },
        user: { role: 'admin' },
        canDevReset: true,
      }),
      true
    )

    // Production build (isDevEnv=false) -> always disabled
    assert.equal(
      canUseDevShiftReset({
        isDevEnv: false,
        activeShift: { id: 10, status: 'shiftroute' },
        user: { role: 'admin' },
        canDevReset: true,
      }),
      false
    )
  })

  await t.test('8. advanceFlowPhase does NOT advance local phase when backend rejects transition (Finding M2)', async () => {
    let localPhase = 'navigate_to_base'
    const errors = []

    const res = await advanceFlowPhase({
      nextPhase: 'shiftroute',
      activeShift: { id: 42, status: 'navigate_to_base', op_status: 'heading_to_start' },
      updateShiftStatus: async () => {
        const err = new Error('Invalid transition')
        err.response = { status: 400, data: { error: 'Invalid transition: navigate_to_base -> shiftroute' } }
        throw err
      },
      handleStaleShift: () => false,
      onPhaseChanged: ({ status }) => {
        localPhase = status
      },
      onError: msg => errors.push(msg),
    })

    assert.equal(res.success, false)
    assert.equal(localPhase, 'navigate_to_base', 'Local phase must NOT advance on rejected transition')
    assert.equal(errors.length, 1)
    assert.equal(errors[0], 'Invalid transition: navigate_to_base -> shiftroute')
  })

  await t.test('9. advanceFlowPhase advances phase and updates status when backend approves transition', async () => {
    let localPhase = 'navigate_to_base'
    let localOpStatus = 'heading_to_start'

    const res = await advanceFlowPhase({
      nextPhase: 'confirm_start',
      activeShift: { id: 42, status: 'navigate_to_base', op_status: 'heading_to_start' },
      updateShiftStatus: async ({ shiftId, nextPhase }) => {
        assert.equal(shiftId, 42)
        assert.equal(nextPhase, 'confirm_start')
        return { status: 'confirm_start', op_status: 'at_base' }
      },
      handleStaleShift: () => false,
      onPhaseChanged: ({ status, opStatus }) => {
        localPhase = status
        localOpStatus = opStatus
      },
      onError: () => assert.fail('Should not emit error on successful transition'),
    })

    assert.equal(res.success, true)
    assert.equal(res.status, 'confirm_start')
    assert.equal(localPhase, 'confirm_start')
    assert.equal(localOpStatus, 'at_base')
  })

  await t.test('10. advanceFlowPhase delegates 403 active shift closed to handleStaleShift', async () => {
    let staleHandled = false
    let phaseChanged = false

    const res = await advanceFlowPhase({
      nextPhase: 'confirm_start',
      activeShift: { id: 42, status: 'navigate_to_base' },
      updateShiftStatus: async () => {
        const err = new Error('Shift closed remotely')
        err.response = { status: 403, data: { detail: 'Active shift closed remotely' } }
        throw err
      },
      handleStaleShift: () => {
        staleHandled = true
        return true
      },
      onPhaseChanged: () => {
        phaseChanged = true
      },
      onError: () => assert.fail('Should not emit generic error when stale shift handled'),
    })

    assert.equal(res.success, false)
    assert.equal(res.stale, true)
    assert.equal(staleHandled, true)
    assert.equal(phaseChanged, false)
  })

  await t.test('11. advanceFlowPhase advances local phase without API call when no active shift exists', async () => {
    let localPhase = 'assignment'

    const res = await advanceFlowPhase({
      nextPhase: 'navigate_to_base',
      activeShift: null,
      updateShiftStatus: async () => assert.fail('Should not call API when no active shift'),
      handleStaleShift: () => false,
      onPhaseChanged: ({ status }) => {
        localPhase = status
      },
      onError: () => assert.fail('Should not emit error'),
    })

    assert.equal(res.success, true)
    assert.equal(res.status, 'navigate_to_base')
    assert.equal(localPhase, 'navigate_to_base')
  })
})
