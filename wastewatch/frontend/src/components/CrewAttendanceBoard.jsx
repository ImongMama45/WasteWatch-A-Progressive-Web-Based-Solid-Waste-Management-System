import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  Edit3,
  AlertTriangle,
  RefreshCw,
  History,
  Info,
  X,
  Truck,
  MapPin,
  Calendar,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import { getApiErrorMessage } from '../utils/notificationHelpers'
import {
  ALLOWED_ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_META,
  normalizeAttendanceDetail,
  normalizeAttendanceStatus,
} from '../utils/crewAttendanceHelpers'
import {
  getWatcherDeploymentDetail,
  submitWatcherDeploymentAttendance,
  submitWatcherAttendanceCorrection,
} from '../api/watcherAttendanceApi'
import {
  getTeamRoster,
  getShiftRosterSnapshot,
  getShiftAttendance,
  submitDeploymentAttendance,
  submitShiftAttendance,
  submitShiftAttendanceCorrection,
} from '../api/driverWorkflowApi'
import { formatReadinessErrorLabel } from '../utils/routeBaseHelpers'

function formatTimestamp(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function StatusBadge({ status }) {
  const normalized = normalizeAttendanceStatus(status)
  const meta = normalized ? ATTENDANCE_STATUS_META[normalized] : null
  if (!meta) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 9px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          background: '#f1f5f9',
          color: '#475569',
          border: '1px solid #cbd5e1',
        }}
      >
        {status || 'UNKNOWN'}
      </span>
    )
  }

  const Icon =
    normalized === 'PRESENT'
      ? CheckCircle2
      : normalized === 'ABSENT'
        ? XCircle
        : Clock

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: meta.bg,
        color: meta.color,
        border: `1px solid ${meta.border}`,
      }}
    >
      <Icon size={12} />
      {meta.label}
    </span>
  )
}

export default function CrewAttendanceBoard({
  mode = 'watcher', // 'watcher' | 'driver' | 'shift'
  scheduleId = null,
  shiftId = null,
  serviceDate = null,
  initialData = null,
  compact = false,
  onSubmitted = null,
  onCorrected = null,
}) {
  const { user } = useAuth()
  const { notify } = useNotification()

  const [loading, setLoading] = useState(!initialData)
  const [submitting, setSubmitting] = useState(false)
  const [rawDetail, setRawDetail] = useState(initialData || null)
  const [loadError, setLoadError] = useState(null)

  const [draftStatuses, setDraftStatuses] = useState({})
  const [draftNotes, setDraftNotes] = useState({})

  const [correctionTarget, setCorrectionTarget] = useState(null)
  const [correctionStatus, setCorrectionStatus] = useState('PRESENT')
  const [correctionReason, setCorrectionReason] = useState('')

  const showToast = useCallback(
    (message, variant = 'info') => {
      if (!notify) return
      const mapped =
        variant === 'error'
          ? 'error-soft'
          : variant === 'success'
            ? 'success'
            : 'neutral'
      notify({ message, variant: mapped })
    },
    [notify]
  )

  useEffect(() => {
    if (initialData) {
      setRawDetail(initialData)
      setLoading(false)
    }
  }, [initialData])

  const loadData = useCallback(async () => {
    if (mode === 'watcher' && !scheduleId) return
    if (mode === 'shift' && !shiftId && !scheduleId) return

    setLoading(true)
    setLoadError(null)
    try {
      let data = null
      if (mode === 'watcher') {
        data = await getWatcherDeploymentDetail(scheduleId, serviceDate)
      } else if (mode === 'driver') {
        data = await getTeamRoster({ scheduleId, date: serviceDate })
      } else if (mode === 'shift') {
        if (scheduleId) {
          try {
            data = await getTeamRoster({ scheduleId, date: serviceDate })
          } catch {
            data = null
          }
        }
        if (!data && shiftId) {
          const [snapshot, attendance] = await Promise.all([
            getShiftRosterSnapshot(shiftId).catch(() => null),
            getShiftAttendance(shiftId).catch(() => []),
          ])
          data = {
            has_team: Boolean(snapshot?.items?.length || attendance?.length),
            driver_shift_id: shiftId,
            roster: snapshot?.items || [],
            attendance_records: Array.isArray(attendance) ? attendance : [],
            attendance_submitted: Array.isArray(attendance) && attendance.length > 0,
            can_submit_attendance: false,
            is_driver_team_leader: false,
            leader_type: null,
          }
        }
      }
      setRawDetail(data)
    } catch (err) {
      const msg = getApiErrorMessage(err, 'Failed to load crew attendance data.')
      setLoadError(msg)
    } finally {
      setLoading(false)
    }
  }, [mode, scheduleId, shiftId, serviceDate, user?.role])

  useEffect(() => {
    if (!initialData) {
      loadData()
    }
  }, [initialData, loadData])

  const detail = useMemo(
    () => normalizeAttendanceDetail(rawDetail, user),
    [rawDetail, user]
  )

  // Seed draft defaults when unsubmitted roster loads
  useEffect(() => {
    if (detail.attendanceSubmitted || detail.roster.length === 0) return
    setDraftStatuses((prev) => {
      const next = { ...prev }
      let changed = false
      detail.roster.forEach((m) => {
        if (!next[m.worker_id]) {
          next[m.worker_id] = 'PRESENT'
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [detail.attendanceSubmitted, detail.roster])

  const allRosterMarked = useMemo(() => {
    if (detail.roster.length === 0) return false
    return detail.roster.every((m) =>
      ALLOWED_ATTENDANCE_STATUSES.includes(draftStatuses[m.worker_id])
    )
  }, [detail.roster, draftStatuses])

  const handleSubmitInitial = async (e) => {
    e.preventDefault()
    if (!detail.ownership.canSubmitInitial || !allRosterMarked || submitting) return

    const records = detail.roster.map((m) => ({
      worker_id: Number(m.worker_id),
      status: draftStatuses[m.worker_id] || 'PRESENT',
      ...(draftNotes[m.worker_id]?.trim()
        ? { notes: draftNotes[m.worker_id].trim() }
        : {}),
    }))

    setSubmitting(true)
    try {
      let res
      if (mode === 'watcher') {
        res = await submitWatcherDeploymentAttendance(
          scheduleId || detail.deployment?.schedule_id,
          {
            service_date: serviceDate || detail.deployment?.service_date,
            records,
          }
        )
      } else if (shiftId) {
        res = await submitShiftAttendance(shiftId, records)
      } else {
        res = await submitDeploymentAttendance({
          schedule_id: scheduleId || detail.deployment?.schedule_id,
          service_date: serviceDate || detail.deployment?.service_date,
          records,
        })
      }
      showToast('Initial crew attendance recorded and sealed.', 'success')
      await loadData()
      if (onSubmitted) onSubmitted(res)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to submit initial crew attendance.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitCorrection = async (e) => {
    e.preventDefault()
    if (!correctionTarget || !correctionReason.trim() || submitting) {
      showToast('Audit reason is required for attendance correction.', 'error')
      return
    }
    setSubmitting(true)
    try {
      let res
      if (mode === 'watcher') {
        res = await submitWatcherAttendanceCorrection(
          scheduleId || detail.deployment?.schedule_id,
          {
            service_date: serviceDate || detail.deployment?.service_date,
            attendance_record_id: correctionTarget.record_id,
            new_status: correctionStatus,
            reason: correctionReason.trim(),
          }
        )
      } else {
        const targetShiftId = shiftId || detail.deployment?.driver_shift_id || rawDetail?.driver_shift_id
        res = await submitShiftAttendanceCorrection(targetShiftId, {
          record_id: correctionTarget.record_id,
          corrected_status: correctionStatus,
          reason: correctionReason.trim(),
        })
      }
      showToast(
        `Attendance correction recorded for ${correctionTarget.worker_name}.`,
        'success'
      )
      setCorrectionTarget(null)
      setCorrectionReason('')
      await loadData()
      if (onCorrected) onCorrected(res)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to submit attendance correction.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: compact ? 20 : 32,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          color: '#64748b',
        }}
      >
        <RefreshCw size={22} className="animate-spin" color="#059669" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Loading crew attendance...</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div
        style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 14,
          padding: 16,
          color: '#991b1b',
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 4 }}>
          <AlertTriangle size={16} /> Unable to load crew attendance
        </div>
        <div style={{ marginBottom: 10 }}>{loadError}</div>
        <button
          type="button"
          onClick={loadData}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid #fca5a5',
            background: '#ffffff',
            color: '#991b1b',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  const dep = detail.deployment || {}
  const leaderName =
    dep.team_leader?.full_name ||
    dep.team_leader?.username ||
    (detail.ownership.isWatcherLed ? 'Watcher Team Leader' : 'Driver Team Leader')

  const hasReadinessBlocks =
    detail.isOperationallyReady === false || detail.readinessErrors.length > 0

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
      }}
    >
      {/* Header / Deployment Metadata */}
      <div
        style={{
          padding: compact ? '14px 16px' : '18px 20px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#059669',
                flexShrink: 0,
              }}
            >
              <Users size={19} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                {dep.team?.name || 'Sanitation Crew Attendance'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {dep.schedule_name || dep.barangay_name || 'Assigned Deployment'}
                {dep.service_date ? ` · ${dep.service_date}` : ''}
              </div>
            </div>
          </div>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              background: detail.attendanceSubmitted ? '#ecfdf5' : '#fffbeb',
              color: detail.attendanceSubmitted ? '#065f46' : '#92400e',
              border: `1px solid ${detail.attendanceSubmitted ? '#a7f3d0' : '#fde68a'}`,
            }}
          >
            {detail.attendanceSubmitted ? (
              <>
                <CheckCircle2 size={13} /> Submitted
              </>
            ) : (
              <>
                <Clock size={13} /> Pending Roll-Call
              </>
            )}
          </span>
        </div>

        {/* Metadata pills */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 12,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              color: '#334155',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '4px 9px',
            }}
          >
            <Shield size={12} color="#059669" />
            Leader: {leaderName} ({detail.ownership.isWatcherLed ? 'Watcher' : 'Driver'})
          </span>

          {dep.truck?.plate_number && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: '#334155',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '4px 9px',
              }}
            >
              <Truck size={12} color="#2563eb" />
              {dep.truck.plate_number}
            </span>
          )}

          {dep.dumpsite?.name && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: '#334155',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '4px 9px',
              }}
            >
              <MapPin size={12} color="#dc2626" />
              {dep.dumpsite.name}
            </span>
          )}

          {dep.start_time && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: '#334155',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '4px 9px',
              }}
            >
              <Calendar size={12} color="#64748b" />
              {dep.start_time}
              {dep.end_time ? ` - ${dep.end_time}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: compact ? '14px 16px' : '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Operational readiness blocker banner */}
        {hasReadinessBlocks && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              fontSize: 12,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>Deployment Not Ready:</strong>{' '}
              {detail.readinessErrors.length > 0
                ? detail.readinessErrors.map(formatReadinessErrorLabel).join(' ')
                : 'Assigned dumpsite and valid route allocation are required.'}
            </div>
          </div>
        )}

        {/* Saved attendance view */}
        {detail.attendanceSubmitted ? (
          <>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: 12,
                color: '#475569',
              }}
            >
              <div>
                Submitted by <strong>{detail.submittedByLabel || leaderName}</strong>
                {detail.submittedAt ? ` on ${formatTimestamp(detail.submittedAt)}` : ''}
              </div>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#059669',
                }}
              >
                <Shield size={12} /> Immutable Initial Record · Append-Only Corrections
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {detail.records.map((item) => (
                <div
                  key={item.record_id || item.worker_id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: '12px 14px',
                    background: '#ffffff',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                          {item.worker_name}
                        </span>
                        {item.employee_id && (
                          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>
                            {item.employee_id}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        <StatusBadge status={item.effective_status} />
                        {item.is_corrected && (
                          <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                            (Initial: {item.initial_status})
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                          Note: {item.notes}
                        </div>
                      )}
                    </div>

                    {detail.ownership.canSubmitCorrection && (
                      <button
                        type="button"
                        onClick={() => {
                          setCorrectionTarget(item)
                          setCorrectionStatus(
                            item.effective_status === 'PRESENT' ? 'ABSENT' : 'PRESENT'
                          )
                          setCorrectionReason('')
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '6px 11px',
                          borderRadius: 8,
                          border: '1px solid #a7f3d0',
                          background: '#ecfdf5',
                          color: '#065f46',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <Edit3 size={13} />
                        Correct
                      </button>
                    )}
                  </div>

                  {/* Full Append-Only Correction History */}
                  {item.corrections.length > 0 ? (
                    <div
                      style={{
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: '1px dashed #e2e8f0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#475569',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        <History size={12} /> Correction Audit Trail ({item.corrections.length})
                      </div>
                      {item.corrections.map((corr) => (
                        <div
                          key={corr.id}
                          style={{
                            background: '#fffbeb',
                            border: '1px solid #fde68a',
                            borderRadius: 8,
                            padding: '6px 10px',
                            fontSize: 12,
                            color: '#78350f',
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>
                            {corr.previous_status} → {corr.new_status}
                            <span style={{ fontWeight: 500, color: '#92400e' }}>
                              {' '}· by {corr.corrected_by_name}
                              {corr.corrected_at ? ` (${formatTimestamp(corr.corrected_at)})` : ''}
                            </span>
                          </div>
                          {corr.reason && (
                            <div style={{ marginTop: 2 }}>Reason: {corr.reason}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : item.latest_correction_reason ? (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '6px 10px',
                        borderRadius: 8,
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        fontSize: 12,
                        color: '#78350f',
                      }}
                    >
                      Correction reason: {item.latest_correction_reason}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : detail.ownership.canSubmitInitial && detail.roster.length > 0 ? (
          /* Initial Roll-Call Form (Authorized Resolved Team Leader Only) */
          <form onSubmit={handleSubmitInitial} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                fontSize: 12,
                color: '#065f46',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>Pre-Departure Roll-Call:</strong> Mark attendance for every assigned Crew Member below.
                {detail.ownership.isDriverLed
                  ? ' As the Driver Team Leader, you are excluded from the crew roll call.'
                  : ' Initial attendance can be submitted independently before the truck shift starts.'}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {detail.roster.map((member) => {
                const selectedStatus = draftStatuses[member.worker_id]
                return (
                  <div
                    key={member.worker_id}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: '12px 14px',
                      background: '#ffffff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                        gap: 8,
                      }}
                    >
                      <div>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
                          {member.full_name}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>
                          {member.role_in_team}
                        </span>
                      </div>
                      {member.employee_id && (
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>
                          {member.employee_id}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 6,
                        marginBottom: 8,
                      }}
                    >
                      {ALLOWED_ATTENDANCE_STATUSES.map((st) => {
                        const meta = ATTENDANCE_STATUS_META[st]
                        const active = selectedStatus === st
                        return (
                          <button
                            key={st}
                            type="button"
                            disabled={submitting || hasReadinessBlocks}
                            onClick={() =>
                              setDraftStatuses((prev) => ({
                                ...prev,
                                [member.worker_id]: st,
                              }))
                            }
                            style={{
                              padding: '7px 4px',
                              borderRadius: 8,
                              fontSize: 11.5,
                              fontWeight: 700,
                              border: `1px solid ${active ? meta.activeBg : '#cbd5e1'}`,
                              background: active ? meta.activeBg : '#f8fafc',
                              color: active ? '#ffffff' : '#475569',
                              cursor: submitting || hasReadinessBlocks ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {meta.label}
                          </button>
                        )
                      })}
                    </div>

                    <input
                      type="text"
                      maxLength={160}
                      placeholder="Optional note (e.g. arrived 10m late)..."
                      value={draftNotes[member.worker_id] || ''}
                      disabled={submitting || hasReadinessBlocks}
                      onChange={(e) =>
                        setDraftNotes((prev) => ({
                          ...prev,
                          [member.worker_id]: e.target.value,
                        }))
                      }
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        background: '#f8fafc',
                        fontSize: 12,
                        color: '#0f172a',
                      }}
                    />
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
              <button
                type="submit"
                disabled={submitting || !allRosterMarked || hasReadinessBlocks}
                style={{
                  padding: '10px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background:
                    submitting || !allRosterMarked || hasReadinessBlocks
                      ? '#cbd5e1'
                      : '#059669',
                  color:
                    submitting || !allRosterMarked || hasReadinessBlocks
                      ? '#64748b'
                      : '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor:
                    submitting || !allRosterMarked || hasReadinessBlocks
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {submitting ? 'Submitting Attendance...' : 'Confirm Initial Attendance'}
              </button>
            </div>
          </form>
        ) : (
          /* Read-Only Pending View (Driver on Watcher-led deployment, or non-leader / empty roster) */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                fontSize: 12.5,
                color: '#475569',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <Info size={16} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                {detail.ownership.isWatcherLed ? (
                  <>
                    <strong>Watcher-Led Crew Attendance:</strong> Initial roll-call is managed by the designated Watcher Team Leader ({leaderName}). You can view saved attendance and correction history here once submitted.
                  </>
                ) : detail.roster.length === 0 ? (
                  'No crew members are manifested on this team for this deployment.'
                ) : (
                  `Initial attendance has not been submitted yet. Designated Team Leader: ${leaderName}.`
                )}
              </div>
            </div>

            {detail.roster.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detail.roster.map((m) => (
                  <div
                    key={m.worker_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                      background: '#ffffff',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>{m.full_name}</span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Pending Roll-Call</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Light-theme Correction Modal */}
      {correctionTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setCorrectionTarget(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              border: '1px solid #e2e8f0',
              maxWidth: 440,
              width: '100%',
              padding: 20,
              boxShadow: '0 20px 45px rgba(15, 23, 42, 0.18)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 12,
                borderBottom: '1px solid #e2e8f0',
                marginBottom: 14,
              }}
            >
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                Append Attendance Correction
              </h4>
              <button
                type="button"
                onClick={() => setCorrectionTarget(null)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: 8,
                  width: 30,
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#475569',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 14 }}>
              <div>
                Crew Member: <strong style={{ color: '#0f172a' }}>{correctionTarget.worker_name}</strong>
              </div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                Current Status: <StatusBadge status={correctionTarget.effective_status} />
              </div>
            </div>

            <form onSubmit={handleSubmitCorrection} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#475569',
                    textTransform: 'uppercase',
                    marginBottom: 5,
                  }}
                >
                  New Attendance Status
                </label>
                <select
                  value={correctionStatus}
                  onChange={(e) => setCorrectionStatus(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#0f172a',
                    fontSize: 13,
                  }}
                >
                  {ALLOWED_ATTENDANCE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {ATTENDANCE_STATUS_META[st].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#475569',
                    textTransform: 'uppercase',
                    marginBottom: 5,
                  }}
                >
                  Audit Reason (Required)
                </label>
                <textarea
                  required
                  rows={3}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="Provide reason for amending attendance..."
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#0f172a',
                    fontSize: 13,
                    resize: 'vertical',
                  }}
                />
              </div>

              <div
                style={{
                  padding: '9px 11px',
                  borderRadius: 8,
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  fontSize: 11.5,
                  color: '#92400e',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 7,
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>This appends an immutable audit record linked to your account.</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setCorrectionTarget(null)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#334155',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#059669',
                    color: '#ffffff',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Submitting...' : 'Submit Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
