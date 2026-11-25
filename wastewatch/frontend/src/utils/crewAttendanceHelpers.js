/**
 * crewAttendanceHelpers.js
 * Pure normalization, status validation, and Team Leader ownership helpers
 * for Watcher-led (Case A) and Driver-led (Case B) Crew Attendance workflows.
 */

export const ALLOWED_ATTENDANCE_STATUSES = Object.freeze([
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
])

export const ATTENDANCE_STATUS_META = Object.freeze({
  PRESENT: {
    label: 'Present',
    bg: '#ecfdf5',
    border: '#a7f3d0',
    color: '#065f46',
    activeBg: '#059669',
  },
  ABSENT: {
    label: 'Absent',
    bg: '#fef2f2',
    border: '#fecaca',
    color: '#991b1b',
    activeBg: '#dc2626',
  },
  LATE: {
    label: 'Late',
    bg: '#fff7ed',
    border: '#fed7aa',
    color: '#9a3412',
    activeBg: '#ea580c',
  },
  EXCUSED: {
    label: 'Excused',
    bg: '#fffbeb',
    border: '#fde68a',
    color: '#92400e',
    activeBg: '#d97706',
  },
})

export function isAllowedAttendanceStatus(status) {
  return ALLOWED_ATTENDANCE_STATUSES.includes(String(status || '').toUpperCase())
}

export function normalizeAttendanceStatus(status, fallback = null) {
  const upper = String(status || '').trim().toUpperCase()
  return ALLOWED_ATTENDANCE_STATUSES.includes(upper) ? upper : fallback
}

export function formatSubmittedByLabel(submittedBy) {
  if (!submittedBy) return null
  if (typeof submittedBy === 'string') return submittedBy
  return (
    submittedBy.full_name ||
    submittedBy.name ||
    submittedBy.username ||
    submittedBy.email ||
    null
  )
}

export function resolveAttendanceOwnership(rawData, currentUser = null) {
  if (!rawData || typeof rawData !== 'object') {
    return {
      hasTeam: false,
      leaderType: null,
      isWatcherLed: false,
      isDriverLed: false,
      isCurrentUserLeader: false,
      canSubmitInitial: false,
      canSubmitCorrection: false,
      teamLeader: null,
    }
  }

  const deployment = rawData.deployment || {}
  const teamLeader = rawData.team_leader || deployment.team_leader || null
  const rawLeaderType =
    rawData.leader_type ||
    (rawData.is_watcher_led ? 'watcher' : null) ||
    (teamLeader?.role ? String(teamLeader.role).toLowerCase() : null) ||
    (rawData.is_driver_team_leader ? 'driver' : null)

  const leaderType =
    rawLeaderType === 'watcher' || rawLeaderType === 'driver' ? rawLeaderType : null
  const isWatcherLed = Boolean(rawData.is_watcher_led || leaderType === 'watcher')
  const isDriverLed = Boolean(
    !isWatcherLed && (leaderType === 'driver' || rawData.is_driver_team_leader)
  )

  const currentUserId = currentUser?.id != null ? String(currentUser.id) : null
  const leaderId = teamLeader?.id != null ? String(teamLeader.id) : null
  const matchesLeaderId = Boolean(currentUserId && leaderId && currentUserId === leaderId)

  const currentRole = currentUser?.role ? String(currentUser.role).toLowerCase() : null
  const isAdmin = Boolean(currentUser && (currentRole === 'admin' || currentUser.is_staff === true))

  const hasTeam =
    rawData.has_team !== undefined
      ? Boolean(rawData.has_team)
      : Boolean(rawData.team || deployment.team || (rawData.roster && rawData.roster.length > 0))

  const attendanceSubmitted = Boolean(
    rawData.attendance_submitted ||
      (Array.isArray(rawData.records) && rawData.records.length > 0) ||
      (Array.isArray(rawData.attendance_records) && rawData.attendance_records.length > 0) ||
      (Array.isArray(rawData.attendance) && rawData.attendance.length > 0)
  )

  // Only the resolved Team Leader may submit initial attendance; Admin cannot submit initial attendance on their behalf.
  let canSubmitInitial = false
  if (!attendanceSubmitted) {
    if (isAdmin) {
      canSubmitInitial = false
    } else if (currentRole === 'watcher') {
      canSubmitInitial = Boolean(
        isWatcherLed && (leaderId ? matchesLeaderId : rawData.can_submit_attendance !== false)
      )
    } else if (currentRole === 'driver') {
      canSubmitInitial = Boolean(
        hasTeam &&
          !isWatcherLed &&
          isDriverLed &&
          rawData.can_submit_attendance === true &&
          (!leaderId || matchesLeaderId)
      )
    } else if (rawData.can_submit_attendance === true) {
      canSubmitInitial = !isWatcherLed || matchesLeaderId
    }
  }

  const submittedById =
    rawData.submitted_by?.id != null
      ? String(rawData.submitted_by.id)
      : rawData.submitted_by_id != null
        ? String(rawData.submitted_by_id)
        : null

  const isOriginalSubmitter = Boolean(
    currentUserId &&
      ((submittedById && submittedById === currentUserId) ||
        (!submittedById && matchesLeaderId))
  )

  const canSubmitCorrection = Boolean(
    attendanceSubmitted &&
      (isAdmin ||
        isOriginalSubmitter ||
        (!submittedById && !leaderId && rawData.can_submit_attendance === true &&
          ((currentRole === 'watcher' && isWatcherLed) || (currentRole === 'driver' && isDriverLed))))
  )

  return {
    hasTeam,
    leaderType,
    isWatcherLed,
    isDriverLed,
    isCurrentUserLeader: matchesLeaderId || Boolean(rawData.can_submit_attendance && !isAdmin),
    canSubmitInitial,
    canSubmitCorrection,
    teamLeader,
  }
}

export function normalizeCorrectionsList(rawRecord) {
  const rawCorrections = Array.isArray(rawRecord?.corrections) ? rawRecord.corrections : []
  return rawCorrections.map((c, idx) => ({
    id: c.id ?? `corr-${idx}`,
    previous_status: normalizeAttendanceStatus(c.previous_status || c.old_status) || c.previous_status || '—',
    new_status: normalizeAttendanceStatus(c.new_status || c.corrected_status) || c.new_status || '—',
    reason: c.reason || '',
    corrected_by_name:
      c.corrected_by_name ||
      formatSubmittedByLabel(c.corrected_by) ||
      'Authorized Reviewer',
    corrected_at: c.corrected_at || c.created_at || null,
  }))
}

export function normalizeAttendanceDetail(rawData, currentUser = null) {
  if (!rawData || typeof rawData !== 'object') {
    return {
      deployment: null,
      roster: [],
      records: [],
      attendanceSubmitted: false,
      submittedBy: null,
      submittedByLabel: null,
      submittedAt: null,
      crewShiftId: null,
      isOperationallyReady: true,
      readinessErrors: [],
      ownership: resolveAttendanceOwnership(null, currentUser),
    }
  }

  const dep = rawData.deployment || {}
  const deployment = {
    schedule_id: dep.schedule_id ?? rawData.schedule_id ?? null,
    schedule_name: dep.schedule_name ?? rawData.schedule_name ?? null,
    barangay_name: dep.barangay_name ?? rawData.barangay_name ?? null,
    service_date: dep.service_date ?? rawData.service_date ?? null,
    start_time: dep.start_time ?? rawData.start_time ?? null,
    end_time: dep.end_time ?? rawData.end_time ?? null,
    team: dep.team ?? rawData.team ?? null,
    truck: dep.truck ?? rawData.truck ?? null,
    dumpsite: dep.dumpsite ?? rawData.dumpsite ?? null,
    team_leader: dep.team_leader ?? rawData.team_leader ?? null,
    driver_shift_id: dep.driver_shift_id ?? rawData.driver_shift_id ?? null,
    driver_shift_status: dep.driver_shift_status ?? rawData.driver_shift_status ?? null,
    is_operationally_ready:
      dep.is_operationally_ready !== undefined
        ? Boolean(dep.is_operationally_ready)
        : rawData.is_operationally_ready !== undefined
          ? Boolean(rawData.is_operationally_ready)
          : true,
    readiness_errors: Array.isArray(dep.readiness_errors)
      ? dep.readiness_errors
      : Array.isArray(rawData.readiness_errors)
        ? rawData.readiness_errors
        : [],
  }

  const rawRoster =
    (Array.isArray(rawData.roster) && rawData.roster) ||
    (Array.isArray(rawData.members) && rawData.members) ||
    (Array.isArray(rawData.crew_members) && rawData.crew_members) ||
    []

  const roster = rawRoster.map((m) => ({
    worker_id: m.worker_id ?? m.worker ?? m.id,
    full_name: m.full_name || m.worker_name || m.name || 'Crew Member',
    employee_id: m.employee_id || m.worker_employee_id || '',
    employee_type: m.employee_type || 'crew_member',
    role_in_team: m.role_in_team || m.role_in_roster || 'Crew Member',
  }))

  const rawRecords =
    (Array.isArray(rawData.records) && rawData.records) ||
    (Array.isArray(rawData.attendance_records) && rawData.attendance_records) ||
    (Array.isArray(rawData.attendance) && rawData.attendance) ||
    []

  const records = rawRecords.map((r) => {
    const corrections = normalizeCorrectionsList(r)
    const effective =
      normalizeAttendanceStatus(r.effective_status || r.status) ||
      r.effective_status ||
      r.status ||
      'PRESENT'
    const initial =
      normalizeAttendanceStatus(r.initial_status || r.status) ||
      r.initial_status ||
      effective
    const isCorrected =
      typeof r.is_corrected === 'boolean'
        ? r.is_corrected
        : corrections.length > 0 || (initial && effective && initial !== effective)

    return {
      id: r.id ?? r.record_id,
      record_id: r.record_id ?? r.id,
      worker_id: r.worker_id ?? r.worker,
      worker_name: r.worker_name || r.full_name || 'Crew Member',
      employee_id: r.employee_id || r.worker_employee_id || '',
      initial_status: initial,
      effective_status: effective,
      notes: r.notes || '',
      is_corrected: Boolean(isCorrected),
      latest_correction_reason:
        r.latest_correction_reason ||
        (corrections.length > 0 ? corrections[corrections.length - 1].reason : ''),
      corrections,
    }
  })

  const attendanceSubmitted = Boolean(rawData.attendance_submitted || records.length > 0)
  const submittedBy = rawData.submitted_by || null
  const submittedByLabel =
    formatSubmittedByLabel(submittedBy) ||
    rawData.submitted_by_name ||
    (attendanceSubmitted ? formatSubmittedByLabel(deployment.team_leader) : null)
  const submittedAt = rawData.submitted_at || null

  return {
    deployment,
    roster,
    records,
    attendanceSubmitted,
    submittedBy,
    submittedByLabel,
    submittedAt,
    crewShiftId: rawData.crew_shift_id ?? null,
    isOperationallyReady: deployment.is_operationally_ready,
    readinessErrors: deployment.readiness_errors,
    ownership: resolveAttendanceOwnership(
      { ...rawData, attendance_submitted: attendanceSubmitted },
      currentUser
    ),
  }
}
