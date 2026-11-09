/**
 * driverFlowGuard.js
 * ------------------
 * Fail-closed eligibility evaluation, toast formatting, dev-reset gating,
 * and cancellable entry-guard lifecycle for DriverRouteFlow.
 */

export const VALID_FLOW_PHASES = Object.freeze([
  'assignment',
  'navigate_to_base',
  'confirm_start',
  'checkin',
  'shiftroute',
  'end_shift',
])

const DEFAULT_BLOCK_MESSAGE = "Today's collection shift is unavailable."
const DEFAULT_ELIGIBILITY_ERROR =
  'Unable to verify shift eligibility right now. Check your connection and retry, or return to the dashboard.'

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatShiftTimeWindow(previousShift) {
  if (!isPlainObject(previousShift)) return null
  if (!previousShift.started_at || !previousShift.ended_at) return null

  const startDate = new Date(previousShift.started_at)
  const endDate = new Date(previousShift.ended_at)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null
  }

  const startLbl = startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
  const endLbl = endDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${startLbl} - ${endLbl}`
}

/**
 * Formats the warning toast shown when `/driver/flow` entry is blocked.
 * Only appends `(Last shift: ...)` when `block_reason === 'shift_already_ended'`.
 */
export function buildShiftBlockedToastMessage(data) {
  const baseMessage =
    typeof data?.block_message === 'string' && data.block_message.trim()
      ? data.block_message.trim()
      : DEFAULT_BLOCK_MESSAGE

  if (data?.block_reason === 'shift_already_ended') {
    const windowLabel = formatShiftTimeWindow(data.previous_shift_today)
    if (windowLabel) {
      return `${baseMessage} (Last shift: ${windowLabel})`
    }
  }

  return baseMessage
}

/**
 * Strictly validates the `/api/driver/shift/current/` payload.
 * Fails closed (`outcome: 'error'`) whenever the payload is missing, non-object,
 * contains an invalid `active_shift`, or omits/malforms boolean `can_start_shift`.
 */
export function evaluateShiftEligibilityResponse(data) {
  if (!isPlainObject(data)) {
    return {
      outcome: 'error',
      reason: 'malformed_payload',
      errorMessage: DEFAULT_ELIGIBILITY_ERROR,
    }
  }

  if (!Object.prototype.hasOwnProperty.call(data, 'active_shift')) {
    return {
      outcome: 'error',
      reason: 'missing_active_shift',
      errorMessage: DEFAULT_ELIGIBILITY_ERROR,
    }
  }

  const truckPreviousShifts = Array.isArray(data.truck_previous_shifts_today)
    ? data.truck_previous_shifts_today
    : []
  const canDevReset = typeof data.can_dev_reset === 'boolean' ? data.can_dev_reset : null

  const shift = data.active_shift
  if (shift !== null) {
    if (
      !isPlainObject(shift) ||
      shift.id === null ||
      shift.id === undefined ||
      shift.id === '' ||
      typeof shift.status !== 'string' ||
      !VALID_FLOW_PHASES.includes(shift.status)
    ) {
      return {
        outcome: 'error',
        reason: 'malformed_active_shift',
        errorMessage: 'Received an invalid shift state from the server. Please retry.',
      }
    }

    return {
      outcome: 'resume',
      activeShift: shift,
      phase: shift.status,
      clearSession: !['shiftroute', 'end_shift'].includes(shift.status),
      truckPreviousShifts,
      canDevReset,
    }
  }

  if (typeof data.can_start_shift !== 'boolean') {
    return {
      outcome: 'error',
      reason: 'invalid_can_start_shift',
      errorMessage: DEFAULT_ELIGIBILITY_ERROR,
    }
  }

  if (data.can_start_shift === false) {
    return {
      outcome: 'blocked',
      blockReason: typeof data.block_reason === 'string' ? data.block_reason : null,
      toastMessage: buildShiftBlockedToastMessage(data),
      truckPreviousShifts,
      canDevReset: false,
    }
  }

  return {
    outcome: 'eligible',
    phase: 'assignment',
    truckPreviousShifts,
    canDevReset,
  }
}

/**
 * Determines whether the destructive DEV reset control may be enabled in the UI.
 * Backend `IsAppAdmin` + `DEBUG` enforcement remains mandatory regardless.
 */
export function canUseDevShiftReset({
  isDevEnv,
  activeShift,
  user,
  canDevReset = null,
  isBusy = false,
}) {
  if (!isDevEnv || isBusy) return false
  if (!isPlainObject(activeShift) || activeShift.id === null || activeShift.id === undefined || activeShift.id === '') {
    return false
  }
  if (typeof canDevReset === 'boolean') {
    return canDevReset === true
  }
  return Boolean(user && (user.role === 'admin' || user.is_staff === true))
}

/**
 * Executes the cancellable `/api/driver/shift/current/` check and transitions
 * `DriverRouteFlow` state strictly fail-closed.
 */
export function runShiftEligibilityCheck({
  fetchCurrentShift,
  onStateChange,
  onBlocked,
  clearSessionData,
}) {
  let cancelled = false
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null

  onStateChange({
    status: 'loading',
    phase: null,
    activeShift: null,
    truckPreviousShifts: [],
    canDevReset: false,
    errorMessage: null,
  })

  const isStale = () => cancelled || Boolean(controller?.signal?.aborted)

  let requestPromise
  try {
    requestPromise = Promise.resolve(
      fetchCurrentShift(controller ? { signal: controller.signal } : {})
    )
  } catch (syncErr) {
    requestPromise = Promise.reject(syncErr)
  }

  requestPromise
    .then(response => {
      if (isStale()) return

      const evaluation = evaluateShiftEligibilityResponse(response?.data)
      if (evaluation.outcome === 'resume') {
        if (evaluation.clearSession && typeof clearSessionData === 'function') {
          clearSessionData()
        }
        onStateChange({
          status: 'ready',
          phase: evaluation.phase,
          activeShift: evaluation.activeShift,
          truckPreviousShifts: evaluation.truckPreviousShifts,
          canDevReset: evaluation.canDevReset,
          errorMessage: null,
        })
        return
      }

      if (evaluation.outcome === 'eligible') {
        if (typeof clearSessionData === 'function') {
          clearSessionData()
        }
        onStateChange({
          status: 'ready',
          phase: 'assignment',
          activeShift: null,
          truckPreviousShifts: evaluation.truckPreviousShifts,
          canDevReset: evaluation.canDevReset,
          errorMessage: null,
        })
        return
      }

      if (evaluation.outcome === 'blocked') {
        if (typeof clearSessionData === 'function') {
          clearSessionData()
        }
        onStateChange({
          status: 'blocked',
          phase: null,
          activeShift: null,
          truckPreviousShifts: evaluation.truckPreviousShifts,
          canDevReset: false,
          errorMessage: null,
        })
        if (typeof onBlocked === 'function') {
          onBlocked({
            blockReason: evaluation.blockReason,
            toastMessage: evaluation.toastMessage,
          })
        }
        return
      }

      onStateChange({
        status: 'error',
        phase: null,
        activeShift: null,
        truckPreviousShifts: [],
        canDevReset: false,
        errorMessage: evaluation.errorMessage || DEFAULT_ELIGIBILITY_ERROR,
      })
    })
    .catch(err => {
      if (isStale()) return
      const serverMsg =
        typeof err?.response?.data?.error === 'string' && err.response.data.error.trim()
          ? err.response.data.error.trim()
          : DEFAULT_ELIGIBILITY_ERROR
      onStateChange({
        status: 'error',
        phase: null,
        activeShift: null,
        truckPreviousShifts: [],
        canDevReset: false,
        errorMessage: serverMsg,
      })
    })

  return function cancelEligibilityCheck() {
    cancelled = true
    if (controller) {
      try {
        controller.abort()
      } catch {
        // Ignore abort errors on older runtimes
      }
    }
  }
}

/**
 * Authoritative phase progression helper (Finding M2).
 * Ensures local displayed phase never advances if the backend rejects
 * the status transition.
 */
export async function advanceFlowPhase({
  nextPhase,
  activeShift,
  updateShiftStatus,
  handleStaleShift,
  onPhaseChanged,
  onError,
  isDevSkip = false,
}) {
  if (activeShift) {
    try {
      const res = await updateShiftStatus({
        shiftId: activeShift.id,
        nextPhase,
        devSkip: isDevSkip,
      })
      const updatedStatus = res?.status || nextPhase
      const updatedOpStatus = res?.op_status || activeShift.op_status
      if (typeof onPhaseChanged === 'function') {
        onPhaseChanged({ status: updatedStatus, opStatus: updatedOpStatus })
      }
      return { success: true, status: updatedStatus }
    } catch (err) {
      if (typeof handleStaleShift === 'function' && handleStaleShift(err)) {
        return { success: false, stale: true }
      }
      const errMsg =
        err?.response?.data?.error ||
        (isDevSkip ? 'Phase transition rejected by server.' : 'Unable to update shift status. Please try again.')
      if (typeof onError === 'function') {
        onError(errMsg)
      }
      return { success: false, error: errMsg }
    }
  } else {
    if (typeof onPhaseChanged === 'function') {
      onPhaseChanged({ status: nextPhase, opStatus: null })
    }
    return { success: true, status: nextPhase }
  }
}
