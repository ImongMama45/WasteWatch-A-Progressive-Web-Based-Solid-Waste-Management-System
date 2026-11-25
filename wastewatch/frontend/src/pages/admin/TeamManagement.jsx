import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  Search,
  X,
  ArrowRightLeft,
  AlertTriangle,
  RefreshCw,
  Info,
  Trash2,
  Users,
  Shield,
  Calendar,
  ClipboardCheck,
  MapPin,
  Truck,
  CheckCircle2,
  Clock,
  Eye,
  UserCheck,
  GripVertical,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  XCircle,
  Edit3,
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import Pagination from '../../components/ui/Pagination'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import api from '../../api/client'
import { getApiErrorMessage } from '../../utils/notificationHelpers'
import './TeamManagement.css'

const PAGE_SIZE = 5

const ROLE_LABELS = {
  leader: 'Team Leader',
  driver: 'Driver',
  crew: 'Crew Member',
}

const SYSTEM_ROLE_LABELS = {
  watcher: 'Watcher',
  driver: 'Driver',
  crew_member: 'Crew (No Login)',
  citizen: 'Citizen (Crew)',
}

const POOL_FILTER_MAPPING = {
  all: '',
  available: 'available',
  watcher: 'watchers',
  driver: 'drivers',
  crew: 'crew',
}

function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * Admin Crew Attendance Inspection & Append-Only Correction Modal
 * Enforces municipal attendance protocol:
 * - Initial roll-call is performed strictly by the designated Team Leader (Watcher or Driver)
 * - Administrators can inspect attendance and submit append-only corrections with audit reasons
 */
function AdminCrewAttendanceModal({ shiftId, crewShiftId, shiftInfo, onClose, onActivityUpdated }) {
  const { notify } = useNotification()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [rosterSnapshot, setRosterSnapshot] = useState(null)
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [correctionTarget, setCorrectionTarget] = useState(null)
  const [correctionStatus, setCorrectionStatus] = useState('PRESENT')
  const [correctionReason, setCorrectionReason] = useState('')

  const showNotification = useCallback((message, type = 'info') => {
    const variant = type === 'error' ? 'error-soft' : type === 'success' ? 'success' : 'neutral'
    if (notify) {
      notify({ message, variant })
    }
  }, [notify])

  const fetchAttendanceData = useCallback(async () => {
    if (!shiftId && !crewShiftId) return
    setLoading(true)
    const baseUrl = shiftId
      ? `/api/driver/shift/${shiftId}`
      : `/api/driver/crew-shifts/${crewShiftId}`
    try {
      const [snapshotRes, attendanceRes] = await Promise.all([
        api.get(`${baseUrl}/roster-snapshot/`).catch(() => ({ data: null })),
        api.get(`${baseUrl}/attendance/`).catch(() => ({ data: [] })),
      ])
      setRosterSnapshot(snapshotRes.data)
      setAttendanceRecords(Array.isArray(attendanceRes.data) ? attendanceRes.data : [])
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to load attendance records'), 'error')
    } finally {
      setLoading(false)
    }
  }, [shiftId, crewShiftId, showNotification])

  useEffect(() => {
    fetchAttendanceData()
  }, [fetchAttendanceData])

  const handleCorrectionSubmit = async (e) => {
    e.preventDefault()
    if (!correctionReason.trim()) {
      showNotification('Mandatory audit reason is required for attendance correction.', 'error')
      return
    }

    const baseUrl = shiftId
      ? `/api/driver/shift/${shiftId}`
      : `/api/driver/crew-shifts/${crewShiftId}`

    setSubmitting(true)
    try {
      await api.post(`${baseUrl}/attendance-correction/`, {
        record_id: correctionTarget.record_id,
        corrected_status: correctionStatus,
        reason: correctionReason.trim(),
      })
      showNotification(`Attendance correction recorded for ${correctionTarget.worker_name}.`, 'success')
      setCorrectionTarget(null)
      setCorrectionReason('')
      await fetchAttendanceData()
      if (onActivityUpdated) onActivityUpdated()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to submit correction'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PRESENT':
        return (
          <span className="team-att-status present">
            <CheckCircle2 size={12} /> Present
          </span>
        )
      case 'ABSENT':
        return (
          <span className="team-att-status absent">
            <XCircle size={12} /> Absent
          </span>
        )
      case 'LATE':
        return (
          <span className="team-att-status late">
            <Clock size={12} /> Late
          </span>
        )
      case 'EXCUSED':
        return (
          <span className="team-att-status excused">
            <Clock size={12} /> Excused
          </span>
        )
      case 'SUBSTITUTE':
        return (
          <span className="team-att-status substitute">
            <UserCheck size={12} /> Substitute
          </span>
        )
      default:
        return <span className="team-att-status default">{status || '—'}</span>
    }
  }

  const hasRecorded = attendanceRecords.length > 0
  const leaderDisplay = shiftInfo?.crew_shift_info?.team_leader_username || shiftInfo?.driver_name || 'Designated Team Leader'

  return createPortal(
    <div className="team-modal-backdrop" onClick={onClose}>
      <div className="team-modal team-attendance-modal" onClick={(e) => e.stopPropagation()}>
        <div className="team-modal-header">
          <div className="team-modal-title-with-icon">
            <Users size={20} color="#059669" />
            <div>
              <h3 className="team-modal-title">Crew Attendance & Shift Verification</h3>
              <p className="team-modal-subtitle">
                {shiftId ? `Shift #${shiftId}` : `CrewShift #${crewShiftId}`} · Team: {shiftInfo?.team_code || 'Standard Roster'} · Started {formatDateTime(shiftInfo?.started_at)}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="team-modal-close" aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        <div className="team-modal-body team-att-body">
          {/* Municipal Attendance Protocol Banner */}
          <div className="team-alert-info">
            <Info size={16} className="team-alert-icon" />
            <div>
              <strong>Municipal Attendance Protocol:</strong> Initial roll-call attendance must be submitted by the designated Team Leader ({leaderDisplay}). Administrators may inspect records and submit append-only corrections with audit reasons.
            </div>
          </div>

          {loading ? (
            <div className="team-loading-state" style={{ padding: '36px 0' }}>
              <RefreshCw size={24} className="animate-spin" style={{ color: '#059669' }} />
              <p>Loading crew attendance data...</p>
            </div>
          ) : hasRecorded ? (
            /* Recorded View: Show immutable records and allow Admin append-only corrections */
            <div className="team-att-records-container">
              <div className="team-att-summary-strip">
                <span>Roster Manifest: <strong>{attendanceRecords.length} workers verified</strong></span>
                <span className="team-att-immutability-badge">
                  <Shield size={12} /> Immutability Protected (Append-Only)
                </span>
              </div>

              <div className="team-att-list">
                {attendanceRecords.map((item) => (
                  <div key={item.record_id} className="team-att-item">
                    <div className="team-att-item-info">
                      <div className="team-att-item-name-row">
                        <span className="team-att-worker-name">{item.worker_name}</span>
                        <span className="team-att-worker-id">{item.employee_id}</span>
                      </div>
                      <div className="team-att-status-row">
                        {getStatusBadge(item.effective_status)}
                        {item.is_corrected && (
                          <span className="team-att-amended-tag">
                            (Amended from {item.initial_status})
                          </span>
                        )}
                      </div>
                      {Array.isArray(item.corrections) && item.corrections.length > 0 ? (
                        <div className="team-att-reason-note" style={{ marginTop: 6 }}>
                          {item.corrections.map((corr) => (
                            <div key={corr.id} style={{ fontSize: 11.5, marginBottom: 2 }}>
                              <strong>#{corr.correction_sequence} ({corr.previous_status} to {corr.corrected_status}):</strong> "{corr.reason}" — {corr.corrected_by_name || corr.corrected_by_username || 'Admin'} ({formatDateTime(corr.corrected_at)})
                            </div>
                          ))}
                        </div>
                      ) : item.latest_correction_reason ? (
                        <div className="team-att-reason-note">
                          Audit note: "{item.latest_correction_reason}"
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setCorrectionTarget(item)
                        setCorrectionStatus(item.effective_status === 'PRESENT' ? 'ABSENT' : 'PRESENT')
                        setCorrectionReason('')
                      }}
                      className="team-att-correct-btn"
                    >
                      <Edit3 size={13} />
                      Append Correction
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : rosterSnapshot?.items && rosterSnapshot.items.length > 0 ? (
            /* Unrecorded View: Clarify that initial attendance is submitted by Team Leader, not Admin */
            <div className="team-att-pending-container">
              <div className="team-att-pending-banner">
                <AlertTriangle size={18} className="team-att-pending-icon" />
                <div>
                  <div className="team-att-pending-title">Initial Roll-Call Pending</div>
                  <div className="team-att-pending-desc">
                    Initial crew attendance has not yet been recorded for this deployment. Under municipal operational rules, the designated Team Leader ({leaderDisplay}) performs the initial check-in. Administrators cannot submit initial attendance on behalf of the leader, but may append authorized corrections once initial check-in is complete.
                  </div>
                </div>
              </div>

              <div className="team-att-roster-manifest">
                <div className="team-att-roster-title">
                  Manifested Crew Roster ({rosterSnapshot.items.length} members staged)
                </div>
                <div className="team-att-roster-items">
                  {rosterSnapshot.items.map((item) => (
                    <div key={item.id} className="team-att-roster-row">
                      <div>
                        <span className="team-att-roster-name">{item.worker_name}</span>
                        <span className="team-att-roster-id">{item.worker_employee_id}</span>
                      </div>
                      <span className="team-att-roster-role">
                        Role: {ROLE_LABELS[item.role_in_roster] || item.role_in_roster || 'Crew Member'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="team-empty-state" style={{ padding: '32px 16px' }}>
              <p className="team-empty-subtitle">No manifested crew roster snapshot recorded for this shift.</p>
            </div>
          )}
        </div>

        <div className="team-modal-actions">
          <button type="button" onClick={onClose} className="team-btn-cancel">
            Close Inspection
          </button>
        </div>

        {/* Append Correction Nested Form Overlay */}
        {correctionTarget && (
          <div className="team-modal-backdrop" style={{ zIndex: 60 }} onClick={() => setCorrectionTarget(null)}>
            <div className="team-modal team-correction-submodal" onClick={(e) => e.stopPropagation()}>
              <div className="team-modal-header">
                <h4 className="team-modal-title">Append Attendance Correction</h4>
                <button type="button" onClick={() => setCorrectionTarget(null)} className="team-modal-close">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCorrectionSubmit} className="team-modal-form">
                <div className="team-att-correction-meta">
                  Worker: <strong>{correctionTarget.worker_name}</strong> ({correctionTarget.employee_id})
                  <div>Current Status: {getStatusBadge(correctionTarget.effective_status)}</div>
                </div>

                <div className="team-form-group">
                  <label className="team-form-label">New Attendance Status *</label>
                  <select
                    value={correctionStatus}
                    onChange={(e) => setCorrectionStatus(e.target.value)}
                    className="team-form-select"
                  >
                    <option value="PRESENT">Present</option>
                    <option value="ABSENT">Absent</option>
                    <option value="LATE">Late</option>
                    <option value="EXCUSED">Excused</option>
                  </select>
                </div>

                <div className="team-form-group">
                  <label className="team-form-label">Mandatory Audit Reason *</label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Provide operational reason for amending sealed attendance..."
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    className="team-form-textarea"
                  />
                  <span className="team-form-hint">
                    This correction creates an append-only audit entry linked to your user account.
                  </span>
                </div>

                <div className="team-modal-actions">
                  <button type="button" onClick={() => setCorrectionTarget(null)} className="team-btn-cancel">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting} className="team-btn-primary">
                    {submitting ? 'Amending...' : 'Submit Correction'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export default function TeamManagement() {
  const { user } = useAuth()
  const { notify } = useNotification()
  const isAdmin = user?.role === 'admin' || user?.is_superuser || user?.is_staff
  const isOperator = user?.role === 'dumpsite'
  const canAllocateTruck = isAdmin || isOperator

  const showNotification = useCallback((message, type = 'info') => {
    const variant = type === 'error' ? 'error-soft' : type === 'success' ? 'success' : 'neutral'
    if (notify) {
      notify({ message, variant })
    }
  }, [notify])

  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'roster' | 'schedules' | 'activity'

  // Teams state (Server-side 5-team pagination)
  const [teams, setTeams] = useState([])
  const [allTeams, setAllTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [leadershipFilter, setLeadershipFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Personnel Pool state & backend filtering (R1)
  const [poolWorkers, setPoolWorkers] = useState([])
  const [allWorkers, setAllWorkers] = useState([])
  const [memberships, setMemberships] = useState([])
  const [poolSearch, setPoolSearch] = useState('')
  const [debouncedPoolSearch, setDebouncedPoolSearch] = useState('')
  const [poolFilter, setPoolFilter] = useState('all') // 'all' | 'available' | 'watcher' | 'driver' | 'crew'
  const [poolLoading, setPoolLoading] = useState(false)
  const [mobilePoolExpanded, setMobilePoolExpanded] = useState(false)

  // Assignment Interactions (Drag-and-Drop & Tap-to-Assign) (R2)
  const [selectedPoolWorker, setSelectedPoolWorker] = useState(null)
  const [draggedWorker, setDraggedWorker] = useState(null)
  const [dragOverTarget, setDragOverTarget] = useState(null) // { teamId, role, isValid }

  // Collapsible team cards state (R3 - collapsed by default)
  const [expandedTeamIds, setExpandedTeamIds] = useState(() => new Set())

  // Roster filters
  const [rosterSearch, setRosterSearch] = useState('')
  const [rosterRoleFilter, setRosterRoleFilter] = useState('all')
  const [rosterStatusFilter, setRosterStatusFilter] = useState('active')

  // Schedules & Deployments state (R4)
  const [schedules, setSchedules] = useState([])
  const [overrides, setOverrides] = useState([])
  const [allocations, setAllocations] = useState([])
  const [trucks, setTrucks] = useState([])
  const [scheduleLoading, setScheduleLoading] = useState(false)

  // Shift & Attendance activity state (R4)
  const [shifts, setShifts] = useState([])
  const [watcherShifts, setWatcherShifts] = useState([])
  const [crewShifts, setCrewShifts] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [inspectShift, setInspectShift] = useState(null)

  // Modals
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [teamCode, setTeamCode] = useState('')
  const [teamDescription, setTeamDescription] = useState('')

  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [selectedWorkerId, setSelectedWorkerId] = useState('')
  const [selectedRole, setSelectedRole] = useState('crew')

  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferWorker, setTransferWorker] = useState(null)
  const [targetTeamId, setTargetTeamId] = useState('')
  const [targetRole, setTargetRole] = useState('crew')

  // Schedule action modals
  const [overrideModalSchedule, setOverrideModalSchedule] = useState(null)
  const [overrideTeamId, setOverrideTeamId] = useState('')
  const [overrideDate, setOverrideDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [overrideReason, setOverrideReason] = useState('')

  const [allocModalSchedule, setAllocModalSchedule] = useState(null)
  const [allocTruckId, setAllocTruckId] = useState('')
  const [allocDate, setAllocDate] = useState(() => new Date().toISOString().slice(0, 10))

  const [defaultTeamModalSchedule, setDefaultTeamModalSchedule] = useState(null)
  const [defaultTeamId, setDefaultTeamId] = useState('')

  const [submitting, setSubmitting] = useState(false)

  // Debounce team search input and reset page to 1
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(prev => {
        if (prev !== searchQuery) {
          setCurrentPage(1)
        }
        return searchQuery
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Debounce pool search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPoolSearch(poolSearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [poolSearch])

  // Fetch Sanitation Teams with 5-team server-side pagination (R3)
  const fetchTeams = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page: currentPage, page_size: PAGE_SIZE }
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
      if (filterStatus === 'active') params.is_active = 'true'
      else if (filterStatus === 'inactive') params.is_active = 'false'
      if (leadershipFilter !== 'all') params.leadership_mode = leadershipFilter

      const [teamsRes, allRes] = await Promise.all([
        api.get('/api/driver/teams/', { params }),
        api.get('/api/driver/teams/?all=true').catch(() => ({ data: [] })),
      ])

      const data = teamsRes.data
      if (data && Array.isArray(data.results)) {
        const nextTotalCount = data.count ?? data.results.length
        const nextTotalPages = data.total_pages ?? Math.max(1, Math.ceil(nextTotalCount / PAGE_SIZE))
        if (currentPage > nextTotalPages && nextTotalPages >= 1) {
          setCurrentPage(nextTotalPages)
          return
        }
        setTeams(data.results)
        setTotalCount(nextTotalCount)
        setTotalPages(Math.max(1, nextTotalPages))
      } else {
        const list = Array.isArray(data) ? data : []
        const nextTotalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
        const clampedPage = Math.min(currentPage, nextTotalPages)
        if (clampedPage !== currentPage) {
          setCurrentPage(clampedPage)
          return
        }
        const start = (clampedPage - 1) * PAGE_SIZE
        setTeams(list.slice(start, start + PAGE_SIZE))
        setTotalCount(list.length)
        setTotalPages(nextTotalPages)
      }

      const fullList = allRes.data?.results || allRes.data || []
      setAllTeams(Array.isArray(fullList) ? fullList : [])
    } catch (err) {
      if (err?.response?.status === 404 && currentPage > 1) {
        setCurrentPage(1)
        return
      }
      setTeams([])
      showNotification(getApiErrorMessage(err, 'Failed to load sanitation teams data'), 'error')
    } finally {
      setLoading(false)
    }
  }, [currentPage, debouncedSearch, filterStatus, leadershipFilter, showNotification])

  // Fetch Personnel Pool using backend pool_filter and search parameters (R1)
  const fetchPersonnelPool = useCallback(async () => {
    setPoolLoading(true)
    try {
      const backendFilter = POOL_FILTER_MAPPING[poolFilter] || ''
      const params = {
        is_active: 'true',
        all: 'true',
      }
      if (backendFilter) params.pool_filter = backendFilter
      if (debouncedPoolSearch.trim()) params.search = debouncedPoolSearch.trim()

      const res = await api.get('/api/driver/workers/', { params })
      const list = res.data?.results || res.data || []
      setPoolWorkers(Array.isArray(list) ? list : [])
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to load personnel pool'), 'error')
    } finally {
      setPoolLoading(false)
    }
  }, [poolFilter, debouncedPoolSearch, showNotification])

  // Fetch all active workers for modals, lookups, and memberships
  const fetchWorkersAndMemberships = useCallback(async () => {
    try {
      const [workersRes, memRes] = await Promise.all([
        api.get('/api/driver/workers/?is_active=true&all=true'),
        api.get('/api/driver/team-memberships/').catch(() => ({ data: [] })),
      ])
      setAllWorkers(workersRes.data?.results || workersRes.data || [])
      setMemberships(memRes.data?.results || memRes.data || [])
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to load workers data'), 'error')
    }
  }, [showNotification])

  // Fetch collection schedules and deployments (R4)
  const fetchSchedulesAndDeployments = useCallback(async () => {
    setScheduleLoading(true)
    try {
      const [schedRes, ovrRes, allocRes, truckRes] = await Promise.all([
        api.get('/api/driver/collection-schedules/?paginate=false'),
        api.get('/api/driver/schedule-team-overrides/').catch(() => ({ data: [] })),
        api.get('/api/driver/schedule-truck-allocations/').catch(() => ({ data: [] })),
        api.get('/api/driver/trucks/?all=true').catch(() => ({ data: [] })),
      ])
      setSchedules(schedRes.data?.results || schedRes.data || [])
      setOverrides(ovrRes.data?.results || ovrRes.data || [])
      setAllocations(allocRes.data?.results || allocRes.data || [])
      setTrucks(truckRes.data?.results || truckRes.data || [])
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to load schedule deployments'), 'error')
    } finally {
      setScheduleLoading(false)
    }
  }, [showNotification])

  // Fetch shift activity & attendance logs (R4 / Stage 5B)
  const fetchShiftActivity = useCallback(async () => {
    setActivityLoading(true)
    try {
      const [shiftRes, watcherRes, crewRes] = await Promise.all([
        api.get('/api/driver/shift/?page_size=20'),
        api.get('/api/driver/watcher-shifts/').catch(() => ({ data: [] })),
        api.get('/api/driver/crew-shifts/?page_size=50').catch(() => ({ data: [] })),
      ])
      setShifts(shiftRes.data?.results || shiftRes.data || [])
      setWatcherShifts(watcherRes.data?.results || watcherRes.data || [])
      setCrewShifts(crewRes.data?.results || crewRes.data || [])
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to load shift and attendance activity'), 'error')
    } finally {
      setActivityLoading(false)
    }
  }, [showNotification])

  // State synchronization helper (R5)
  const fetchData = useCallback(async () => {
    await Promise.all([fetchTeams(), fetchPersonnelPool(), fetchWorkersAndMemberships()])
  }, [fetchTeams, fetchPersonnelPool, fetchWorkersAndMemberships])

  useEffect(() => {
    fetchTeams()
  }, [fetchTeams])

  useEffect(() => {
    fetchPersonnelPool()
  }, [fetchPersonnelPool])

  useEffect(() => {
    fetchWorkersAndMemberships()
  }, [fetchWorkersAndMemberships])

  useEffect(() => {
    if (activeTab === 'schedules') {
      fetchSchedulesAndDeployments()
    } else if (activeTab === 'activity') {
      fetchShiftActivity()
    }
  }, [activeTab, fetchSchedulesAndDeployments, fetchShiftActivity])

  // Comprehensive readiness warnings computation (R3)
  const getTeamWarnings = useCallback((team) => {
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
  }, [])

  // KPI computations across all teams
  const kpis = useMemo(() => {
    const active = allTeams.filter(t => t.is_active)
    const watcherLed = active.filter(t => t.team_leader_mode === 'watcher').length
    const driverLed = active.filter(t => t.team_leader_mode === 'driver').length
    const totalPersonnel = active.reduce((acc, t) => acc + (t.members_count || 0), 0)
    const incomplete = active.filter(t => getTeamWarnings(t).length > 0).length
    return {
      total: allTeams.length || totalCount,
      active: active.length,
      watcherLed,
      driverLed,
      totalPersonnel,
      incomplete,
    }
  }, [allTeams, totalCount, getTeamWarnings])

  const activeWorkerIds = useMemo(() => {
    const set = new Set()
    allTeams.forEach(t => {
      if (!t.is_active) return
      if (t.active_leader) set.add(t.active_leader.id)
      if (t.active_driver) set.add(t.active_driver.id)
      t.crew_members?.forEach(c => set.add(c.id))
    })
    return set
  }, [allTeams])

  const availablePersonnelCount = useMemo(() => {
    return allWorkers.filter(w => w.is_available).length
  }, [allWorkers])

  // Filtered roster memberships for Tab 2
  const filteredMemberships = useMemo(() => {
    return memberships.filter(m => {
      if (rosterStatusFilter === 'active' && !m.is_active) return false
      if (rosterStatusFilter === 'inactive' && m.is_active) return false
      if (rosterRoleFilter !== 'all' && m.role_in_team !== rosterRoleFilter) return false
      if (rosterSearch.trim()) {
        const q = rosterSearch.toLowerCase()
        const hay = `${m.worker_name || ''} ${m.worker_employee_id || ''} ${m.team_name || ''} ${m.team_code || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [memberships, rosterStatusFilter, rosterRoleFilter, rosterSearch])

  const activeTeamsForSelect = useMemo(() => allTeams.filter(t => t.is_active), [allTeams])

  // Check role eligibility strictly based on system user role & employee type (R2)
  const isWorkerEligibleForRole = useCallback((worker, roleInTeam) => {
    const sysRole = worker?.user_role || null
    const empType = worker?.employee_type || null
    if (roleInTeam === 'leader') return sysRole === 'watcher' || sysRole === 'driver'
    if (roleInTeam === 'driver') return sysRole === 'driver'
    if (roleInTeam === 'crew') return !sysRole || (sysRole === 'citizen' && empType === 'crew_member')
    return false
  }, [])

  // Validate worker assignment drop target (R2 - single-person overwrite protection & role check)
  const validateWorkerDrop = useCallback((worker, team, roleInTeam) => {
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
  }, [isWorkerEligibleForRole])

  // Handle Drag-and-Drop or Tap-to-Assign with cross-team transfer routing (R2)
  const handlePoolAssignOrTransfer = useCallback(async (worker, team, roleInTeam) => {
    if (!isAdmin) return
    const check = validateWorkerDrop(worker, team, roleInTeam)
    if (!check.valid) {
      showNotification(check.reason, 'error')
      return
    }

    const activeMembership = worker.active_team
    if (activeMembership) {
      if (activeMembership.id === team.id && activeMembership.role_in_team === roleInTeam) {
        showNotification(`${worker.full_name} is already assigned as ${ROLE_LABELS[roleInTeam]} on ${team.code}.`, 'info')
        setSelectedPoolWorker(null)
        return
      }

      // Existing active membership MUST route through authorized transfer workflow with confirmation (R2)
      setTransferWorker({
        id: worker.id,
        name: worker.full_name,
        employee_id: worker.employee_id,
        system_role: worker.user_role,
        employee_type: worker.employee_type,
      })
      setTargetTeamId(String(team.id))
      setTargetRole(roleInTeam)
      setShowTransferModal(true)
      setSelectedPoolWorker(null)
      return
    }

    setSubmitting(true)
    try {
      await api.post(`/api/driver/teams/${team.id}/assign-member/`, {
        worker_id: worker.id,
        role_in_team: roleInTeam,
      })
      showNotification(`${worker.full_name} assigned as ${ROLE_LABELS[roleInTeam]} on ${team.code}.`, 'success')
      setSelectedPoolWorker(null)
      await fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to assign worker'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [isAdmin, validateWorkerDrop, showNotification, fetchData])

  // Team expand / collapse controls (R3)
  const toggleTeamExpanded = useCallback((teamId) => {
    setExpandedTeamIds(prev => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }, [])

  const allDisplayedExpanded = teams.length > 0 && teams.every(t => expandedTeamIds.has(t.id))
  const handleToggleExpandAll = useCallback(() => {
    setExpandedTeamIds(prev => {
      const next = new Set(prev)
      if (allDisplayedExpanded) {
        teams.forEach(t => next.delete(t.id))
      } else {
        teams.forEach(t => next.add(t.id))
      }
      return next
    })
  }, [allDisplayedExpanded, teams])

  // Team Mutation Handlers
  const handleCreateTeam = async (e) => {
    e.preventDefault()
    if (!teamName.trim() || !teamCode.trim()) {
      showNotification('Team name and code are required.', 'error')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/api/driver/teams/', {
        name: teamName.trim(),
        code: teamCode.trim().toUpperCase(),
        description: teamDescription.trim(),
      })
      showNotification('Sanitation team created successfully.', 'success')
      setShowCreateTeamModal(false)
      setTeamName('')
      setTeamCode('')
      setTeamDescription('')
      await fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to create team'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAssignMember = async (e) => {
    e.preventDefault()
    if (!selectedTeam || !selectedWorkerId || !selectedRole) return
    setSubmitting(true)
    try {
      await api.post(`/api/driver/teams/${selectedTeam.id}/assign-member/`, {
        worker_id: parseInt(selectedWorkerId, 10),
        role_in_team: selectedRole,
      })
      showNotification('Worker assigned to team successfully.', 'success')
      setShowAssignModal(false)
      setSelectedWorkerId('')
      setSelectedRole('crew')
      await fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to assign worker'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleTransferMember = async (e) => {
    e.preventDefault()
    if (!transferWorker || !targetTeamId || !targetRole) return
    setSubmitting(true)
    try {
      await api.post('/api/driver/teams/transfer-worker/', {
        worker_id: transferWorker.id,
        target_team_id: parseInt(targetTeamId, 10),
        new_role: targetRole,
      })
      showNotification(`${transferWorker.name} transferred cleanly. Audit history preserved.`, 'success')
      setShowTransferModal(false)
      setTransferWorker(null)
      setTargetTeamId('')
      setTargetRole('crew')
      await fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Transfer failed'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeactivateMembership = async (membershipId, workerName) => {
    if (!window.confirm(`Remove ${workerName} from this team? Their historical shifts and attendance records remain intact.`)) return
    try {
      await api.post(`/api/driver/team-memberships/${membershipId}/deactivate/`)
      showNotification(`${workerName} removed from team.`, 'success')
      await fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to remove worker'), 'error')
    }
  }

  // Schedule mutation handlers
  const handleSetDefaultTeam = async (e) => {
    e.preventDefault()
    if (!defaultTeamModalSchedule || !defaultTeamId) return
    setSubmitting(true)
    try {
      await api.post(`/api/driver/collection-schedules/${defaultTeamModalSchedule.id}/set-default-team/`, {
        team_id: parseInt(defaultTeamId, 10),
      })
      showNotification('Default sanitation team updated.', 'success')
      setDefaultTeamModalSchedule(null)
      setDefaultTeamId('')
      await Promise.all([fetchSchedulesAndDeployments(), fetchData()])
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to update default team'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateOverride = async (e) => {
    e.preventDefault()
    if (!overrideModalSchedule || !overrideTeamId || !overrideDate) return
    setSubmitting(true)
    try {
      await api.post('/api/driver/schedule-team-overrides/', {
        schedule: overrideModalSchedule.id,
        team: parseInt(overrideTeamId, 10),
        effective_date: overrideDate,
        reason: overrideReason.trim(),
      })
      showNotification('Date-specific team override saved.', 'success')
      setOverrideModalSchedule(null)
      setOverrideTeamId('')
      setOverrideReason('')
      await fetchSchedulesAndDeployments()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to create team override'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteOverride = async (overrideId) => {
    if (!window.confirm('Remove this date-specific team override?')) return
    try {
      await api.delete(`/api/driver/schedule-team-overrides/${overrideId}/`)
      showNotification('Team override removed.', 'success')
      await fetchSchedulesAndDeployments()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to remove override'), 'error')
    }
  }

  const handleAllocateTruck = async (e) => {
    e.preventDefault()
    if (!allocModalSchedule || !allocTruckId || !allocDate) return
    setSubmitting(true)
    try {
      await api.post(`/api/driver/collection-schedules/${allocModalSchedule.id}/allocate-truck/`, {
        truck_id: parseInt(allocTruckId, 10),
        allocation_date: allocDate,
      })
      showNotification('Truck allocated to schedule.', 'success')
      setAllocModalSchedule(null)
      setAllocTruckId('')
      await fetchSchedulesAndDeployments()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to allocate truck'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const getTeamLeaderForTeamId = useCallback((teamId) => {
    const t = allTeams.find(x => x.id === teamId)
    return t?.active_leader || null
  }, [allTeams])

  return (
    <DashboardLayout>
      <div className="team-mgmt-container">
        {/* Page Header */}
        <div className="team-mgmt-header">
          <div className="team-mgmt-title-area">
            <div className="team-mgmt-title-row">
              <span className="team-mgmt-title-icon">
                <Users size={26} />
              </span>
              <h1 className="team-mgmt-title">Sanitation Team Operations</h1>
            </div>
            <p className="team-mgmt-subtitle">
              Manage municipal sanitation teams, transferable Team Leader designations, schedule deployments, and crew attendance activity.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowCreateTeamModal(true)}
              className="team-btn-primary"
            >
              <Plus size={18} />
              Create Sanitation Team
            </button>
          )}
        </div>

        {/* KPI Overview Strip */}
        <div className="team-kpi-grid">
          {[
            { label: 'Total Teams', value: kpis.total, accent: '#0f172a' },
            { label: 'Active Teams', value: kpis.active, accent: '#059669' },
            { label: 'Assigned Personnel', value: kpis.totalPersonnel, accent: '#0284c7' },
            { label: 'Watcher-Led Teams', value: kpis.watcherLed, accent: '#7c3aed' },
            { label: 'Driver-Led Teams', value: kpis.driverLed, accent: '#0d9488' },
            { label: 'Incomplete Readiness', value: kpis.incomplete, accent: kpis.incomplete > 0 ? '#d97706' : '#059669' },
          ].map(card => (
            <div key={card.label} className="team-kpi-card">
              <div className="team-kpi-label">
                {card.label}
              </div>
              <div className="team-kpi-value" style={{ color: card.accent }}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

        {/* Navigation Tabs */}
        <div className="team-tabs-bar">
          {[
            { id: 'overview', label: 'Teams & Composition', icon: Users },
            { id: 'roster', label: 'Personnel Roster & History', icon: UserCheck },
            { id: 'schedules', label: 'Schedules & Deployments', icon: Calendar },
            { id: 'activity', label: 'Attendance & Shift Activity', icon: ClipboardCheck },
          ].map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`team-tab-btn ${isActive ? 'active' : ''}`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* TAB 1: TEAMS & COMPOSITION */}
        {activeTab === 'overview' && (
          <>
            {/* Top Toolbar */}
            <div className="team-toolbar">
              <div className="team-search-box">
                <Search className="team-search-icon" size={16} />
                <input
                  type="text"
                  placeholder="Search team name, code, or member..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="team-search-input"
                />
              </div>
              <div className="team-filter-actions">
                <div className="team-filter-group">
                  {['all', 'active', 'inactive'].map(st => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => { setFilterStatus(st); setCurrentPage(1) }}
                      className={`team-filter-btn ${filterStatus === st ? 'active' : ''}`}
                    >
                      {st.charAt(0).toUpperCase() + st.slice(1)}
                    </button>
                  ))}
                </div>
                <select
                  value={leadershipFilter}
                  onChange={(e) => { setLeadershipFilter(e.target.value); setCurrentPage(1) }}
                  className="team-select"
                >
                  <option value="all">All Leadership Modes</option>
                  <option value="watcher">Watcher-Led</option>
                  <option value="driver">Driver-Led</option>
                  <option value="incomplete">Incomplete Readiness</option>
                </select>
                {teams.length > 0 && (
                  <button
                    type="button"
                    onClick={handleToggleExpandAll}
                    className="team-btn-outline"
                    title={allDisplayedExpanded ? 'Collapse all visible team cards' : 'Expand all visible team cards'}
                  >
                    <ChevronsUpDown size={14} />
                    {allDisplayedExpanded ? 'Collapse All' : 'Expand All'}
                  </button>
                )}
              </div>
            </div>

            {/* Mobile Header Toggle Bar (< 1024px) (R1) */}
            <div className="team-pool-mobile-bar">
              <button
                type="button"
                onClick={() => setMobilePoolExpanded(prev => !prev)}
                className="team-pool-mobile-toggle-btn"
                aria-expanded={mobilePoolExpanded}
              >
                <div className="team-pool-mobile-toggle-left">
                  <Users size={16} color="#059669" />
                  <span>Personnel Pool ({availablePersonnelCount} available) — {mobilePoolExpanded ? 'Hide' : 'Show'}</span>
                </div>
                {mobilePoolExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            <div className="team-workspace-layout">
              {/* LEFT PANE: PERSONNEL POOL SIDEBAR (R1) */}
              <aside
                className={`team-pool-sidebar ${mobilePoolExpanded ? 'mobile-expanded' : 'mobile-collapsed'}`}
                aria-label="Personnel Pool"
              >
                <div className="team-pool-header">
                  <div className="team-pool-title-row">
                    <h2 className="team-pool-title">
                      <Users size={16} color="#059669" />
                      Personnel Pool
                    </h2>
                    <span className="team-pool-count">{poolWorkers.length}</span>
                  </div>

                  <div className="team-search-box" style={{ width: '100%' }}>
                    <Search className="team-search-icon" size={14} />
                    <input
                      type="text"
                      placeholder="Search name, ID, team..."
                      value={poolSearch}
                      onChange={(e) => setPoolSearch(e.target.value)}
                      className="team-search-input"
                      style={{ padding: '7px 10px 7px 32px', fontSize: '0.8rem' }}
                    />
                  </div>

                  <div className="team-pool-filters">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'available', label: 'Available' },
                      { id: 'watcher', label: 'Watchers' },
                      { id: 'driver', label: 'Drivers' },
                      { id: 'crew', label: 'Crew Members' },
                    ].map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setPoolFilter(f.id)}
                        className={`team-pool-filter-pill ${poolFilter === f.id ? 'active' : ''}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="team-pool-list">
                  {poolLoading ? (
                    <div className="team-loading-state" style={{ padding: '24px 12px' }}>
                      <RefreshCw size={20} className="animate-spin" style={{ color: '#059669' }} />
                      <p style={{ fontSize: 12 }}>Loading pool...</p>
                    </div>
                  ) : poolWorkers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 12px', fontSize: 12.5, color: '#64748b' }}>
                      No personnel match your pool filter.
                    </div>
                  ) : (
                    poolWorkers.map(w => {
                      const sysRole = w.user_role || null
                      const empType = w.employee_type || 'crew_member'
                      const roleBadgeClass = sysRole === 'watcher' ? 'watcher' : sysRole === 'driver' ? 'driver' : 'crew'
                      const roleLabel = sysRole === 'watcher' ? 'Watcher' : sysRole === 'driver' ? 'Driver' : 'Crew Member'
                      const activeTeam = w.active_team
                      const isSelected = selectedPoolWorker?.id === w.id
                      const canDrag = isAdmin && !w.on_active_shift

                      // Transparent Workload Metrics (R1)
                      const teamSchedCount = w.team_schedule_count ?? w.workload?.team_schedule_count ?? 0
                      const driverSchedCount = w.direct_driver_schedules_count ?? w.workload?.direct_driver_schedules_count ?? 0

                      return (
                        <div
                          key={w.id}
                          draggable={canDrag}
                          onDragStart={(e) => {
                            if (!canDrag) {
                              e.preventDefault()
                              return
                            }
                            setDraggedWorker(w)
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', String(w.id))
                          }}
                          onDragEnd={() => {
                            setDraggedWorker(null)
                            setDragOverTarget(null)
                          }}
                          className={`team-pool-card ${canDrag ? 'draggable' : ''} ${isSelected ? 'selected' : ''}`}
                        >
                          <div className="team-pool-card-top">
                            <div className="team-pool-person">
                              {isAdmin && (
                                <GripVertical size={15} className="team-pool-drag-handle" />
                              )}
                              <div style={{ minWidth: 0 }}>
                                <div className="team-pool-name">{w.full_name}</div>
                                <div className="team-pool-meta">
                                  {w.employee_id} · {empType}
                                </div>
                              </div>
                            </div>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => setSelectedPoolWorker(isSelected ? null : w)}
                                className={`team-pool-select-btn ${isSelected ? 'active' : ''}`}
                                title={isSelected ? 'Cancel selection' : 'Select worker to assign via tap/click'}
                              >
                                {isSelected ? 'Selected' : 'Select'}
                              </button>
                            )}
                          </div>

                          <div className="team-pool-badges">
                            <span className={`team-pool-role-badge ${roleBadgeClass}`}>
                              {roleLabel}
                            </span>
                            {/* Authoritative backend availability flag (R1) */}
                            {w.is_available ? (
                              <span className="team-pool-avail-badge available">
                                Available
                              </span>
                            ) : activeTeam ? (
                              <span className="team-pool-avail-badge assigned">
                                {activeTeam.code} · {ROLE_LABELS[activeTeam.role_in_team] || activeTeam.role_in_team}
                              </span>
                            ) : (
                              <span className="team-pool-avail-badge unavailable">
                                Assigned / Inactive
                              </span>
                            )}
                            {w.on_active_shift && (
                              <span className="team-pool-avail-badge on-shift">
                                On Shift
                              </span>
                            )}
                          </div>

                          {/* Transparent Workload Metrics Breakdown (R1) */}
                          <div className="team-pool-workload-row">
                            {activeTeam ? (
                              <div className="team-workload-item">
                                <span className="team-workload-label">
                                  Team Workload: <strong>{teamSchedCount}</strong> {teamSchedCount === 1 ? 'schedule' : 'schedules'} (via {activeTeam.code})
                                </span>
                              </div>
                            ) : null}

                            {sysRole === 'driver' && (
                              <div className="team-workload-item">
                                <span className="team-workload-label">
                                  Direct Routes: <strong>{driverSchedCount}</strong>
                                </span>
                              </div>
                            )}

                            {!activeTeam && sysRole !== 'driver' && (
                              <div className="team-workload-item">
                                <span className="team-workload-muted">No active workload</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </aside>

              {/* RIGHT PANE: COLLAPSIBLE TEAM CARDS & PAGINATION (R2 & R3) */}
              <div style={{ minWidth: 0 }}>
                {selectedPoolWorker && (
                  <div className="team-selection-banner">
                    <span>
                      Selected: <strong>{selectedPoolWorker.full_name}</strong> ({selectedPoolWorker.user_role ? SYSTEM_ROLE_LABELS[selectedPoolWorker.user_role] || selectedPoolWorker.user_role : 'Crew Member'}) — Tap or click an eligible role slot on any team card to assign or transfer.
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedPoolWorker(null)}
                      className="team-btn-cancel"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {loading ? (
                  <div className="team-loading-state">
                    <RefreshCw size={28} style={{ color: '#059669' }} className="animate-spin" />
                    <p>Loading sanitation teams...</p>
                  </div>
                ) : teams.length === 0 ? (
                  <div className="team-empty-state">
                    <h3 className="team-empty-title">No teams match your filters</h3>
                    <p className="team-empty-subtitle">Adjust the search/filters or create a new sanitation team.</p>
                  </div>
                ) : (
                  <>
                    <div className="team-list-stack">
                      {teams.map((team) => {
                        const warnings = getTeamWarnings(team)
                        const isExpanded = expandedTeamIds.has(team.id)
                        const leaderModeLabel = team.team_leader_mode === 'watcher'
                          ? 'Watcher-Led'
                          : team.team_leader_mode === 'driver'
                            ? 'Driver-Led (No Watcher)'
                            : 'No Team Leader'
                        const leaderModeStyle = team.team_leader_mode === 'watcher'
                          ? { background: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }
                          : team.team_leader_mode === 'driver'
                            ? { background: '#ccfbf1', color: '#0f766e', border: '1px solid #99f6e4' }
                            : { background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }

                        // Accessible Drag-and-Drop & Tap-to-Assign drop target helper (R2)
                        const getDropHandlers = (roleInTeam) => {
                          const isTapEligible = Boolean(
                            isAdmin &&
                            selectedPoolWorker &&
                            validateWorkerDrop(selectedPoolWorker, team, roleInTeam).valid
                          )
                          const isDragTarget = dragOverTarget?.teamId === team.id && dragOverTarget?.role === roleInTeam
                          const dropClass = isDragTarget
                            ? (dragOverTarget.isValid ? 'drag-over-valid' : 'drag-over-invalid')
                            : (isTapEligible ? 'tap-eligible' : '')

                          return {
                            dropClass,
                            role: 'button',
                            tabIndex: selectedPoolWorker ? 0 : -1,
                            'aria-label': `Assign ${selectedPoolWorker ? selectedPoolWorker.full_name : 'worker'} as ${ROLE_LABELS[roleInTeam]} to ${team.name}`,
                            onDragOver: (e) => {
                              if (!isAdmin || !draggedWorker) return
                              e.preventDefault()
                              const check = validateWorkerDrop(draggedWorker, team, roleInTeam)
                              e.dataTransfer.dropEffect = check.valid ? 'move' : 'none'
                              if (
                                dragOverTarget?.teamId !== team.id ||
                                dragOverTarget?.role !== roleInTeam ||
                                dragOverTarget?.isValid !== check.valid
                              ) {
                                setDragOverTarget({ teamId: team.id, role: roleInTeam, isValid: check.valid })
                              }
                            },
                            onDragLeave: () => {
                              if (dragOverTarget?.teamId === team.id && dragOverTarget?.role === roleInTeam) {
                                setDragOverTarget(null)
                              }
                            },
                            onDrop: (e) => {
                              e.preventDefault()
                              const workerToAssign = draggedWorker
                              setDragOverTarget(null)
                              setDraggedWorker(null)
                              if (workerToAssign) {
                                handlePoolAssignOrTransfer(workerToAssign, team, roleInTeam)
                              }
                            },
                            onClick: () => {
                              if (isAdmin && selectedPoolWorker) {
                                handlePoolAssignOrTransfer(selectedPoolWorker, team, roleInTeam)
                              }
                            },
                            onKeyDown: (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                if (isAdmin && selectedPoolWorker) {
                                  handlePoolAssignOrTransfer(selectedPoolWorker, team, roleInTeam)
                                }
                              }
                            },
                          }
                        }

                        const leaderDrop = getDropHandlers('leader')
                        const driverDrop = getDropHandlers('driver')
                        const crewDrop = getDropHandlers('crew')

                        return (
                          <div key={team.id} className="team-card">
                            <div className="team-card-header">
                              <div className="team-card-title-group">
                                <div className="team-card-code-title">
                                  <span className="team-badge-code">{team.code}</span>
                                  <h3 className="team-card-name">{team.name}</h3>
                                  <span className={`team-status-badge ${team.is_active ? 'active' : 'inactive'}`}>
                                    {team.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                  <span style={{
                                    ...leaderModeStyle,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {leaderModeLabel}
                                  </span>
                                  {team.is_active && (
                                    warnings.length === 0 ? (
                                      <span className="team-readiness-pill ready">
                                        <CheckCircle2 size={11} /> Ready
                                      </span>
                                    ) : (
                                      <span className="team-readiness-pill incomplete" title={warnings.join(' · ')}>
                                        <AlertTriangle size={11} /> {warnings.length} Incomplete
                                      </span>
                                    )
                                  )}
                                </div>

                                {isExpanded && team.description && (
                                  <p className="team-card-desc">{team.description}</p>
                                )}

                                {/* Concise Readiness Warnings on Collapsed Cards (R3) */}
                                {!isExpanded && warnings.length > 0 && (
                                  <div className="team-collapsed-warnings">
                                    {warnings.map(w => (
                                      <span key={w} className="team-warning-tag">
                                        <AlertTriangle size={10} />
                                        {w}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => toggleTeamExpanded(team.id)}
                                className="team-collapse-btn"
                                title={isExpanded ? 'Collapse team card' : 'Expand team card'}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                            </div>

                            {/* COLLAPSED VIEW (R3 - Compact 3-slot grid) */}
                            {!isExpanded && (
                              <div className="team-card-collapsed-grid">
                                <div
                                  className={`team-compact-slot team-drop-zone ${leaderDrop.dropClass}`}
                                  role={leaderDrop.role}
                                  tabIndex={leaderDrop.tabIndex}
                                  aria-label={leaderDrop['aria-label']}
                                  onDragOver={leaderDrop.onDragOver}
                                  onDragLeave={leaderDrop.onDragLeave}
                                  onDrop={leaderDrop.onDrop}
                                  onClick={leaderDrop.onClick}
                                  onKeyDown={leaderDrop.onKeyDown}
                                >
                                  <span className="team-compact-slot-label" style={{ color: '#7c3aed' }}>Team Leader</span>
                                  <span className="team-compact-slot-val" style={!team.active_leader ? { color: '#d97706', fontStyle: 'italic' } : undefined}>
                                    {team.active_leader ? team.active_leader.name : 'Drop or tap to assign'}
                                  </span>
                                </div>
                                <div
                                  className={`team-compact-slot team-drop-zone ${driverDrop.dropClass}`}
                                  role={driverDrop.role}
                                  tabIndex={driverDrop.tabIndex}
                                  aria-label={driverDrop['aria-label']}
                                  onDragOver={driverDrop.onDragOver}
                                  onDragLeave={driverDrop.onDragLeave}
                                  onDrop={driverDrop.onDrop}
                                  onClick={driverDrop.onClick}
                                  onKeyDown={driverDrop.onKeyDown}
                                >
                                  <span className="team-compact-slot-label" style={{ color: '#2563eb' }}>Assigned Driver</span>
                                  <span
                                    className="team-compact-slot-val"
                                    style={!team.active_driver ? { color: team.team_leader_mode === 'driver' ? '#0f766e' : '#d97706', fontStyle: team.team_leader_mode === 'driver' ? 'normal' : 'italic' } : undefined}
                                  >
                                    {team.active_driver
                                      ? team.active_driver.name
                                      : team.team_leader_mode === 'driver' && team.active_leader
                                        ? `Driver-Led (${team.active_leader.name})`
                                        : 'Drop or tap to assign'}
                                  </span>
                                </div>
                                <div
                                  className={`team-compact-slot team-drop-zone ${crewDrop.dropClass}`}
                                  role={crewDrop.role}
                                  tabIndex={crewDrop.tabIndex}
                                  aria-label={crewDrop['aria-label']}
                                  onDragOver={crewDrop.onDragOver}
                                  onDragLeave={crewDrop.onDragLeave}
                                  onDrop={crewDrop.onDrop}
                                  onClick={crewDrop.onClick}
                                  onKeyDown={crewDrop.onKeyDown}
                                >
                                  <span className="team-compact-slot-label">Crew & Routes</span>
                                  <span className="team-compact-slot-val">
                                    {team.crew_members?.length || 0} crew assigned · {team.assigned_schedules?.length || 0} routes
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* EXPANDED VIEW */}
                            {isExpanded && (
                              <>
                                {team.is_active && warnings.length > 0 && (
                                  <div className="team-warning-banner">
                                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                                    <span>Incomplete: {warnings.join(' · ')}</span>
                                  </div>
                                )}

                                <div className="team-card-body">
                                  {/* Assigned Schedules & Dumpsites (R3) */}
                                  <div>
                                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', marginBottom: 6 }}>
                                      Assigned Routes & Dumpsites ({team.assigned_schedules?.length || 0})
                                    </div>
                                    {team.assigned_schedules && team.assigned_schedules.length > 0 ? (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {team.assigned_schedules.map(s => {
                                          const hasDumpsite = Boolean(s.dumpsite_id || s.dumpsite_name)
                                          return (
                                            <span
                                              key={s.id}
                                              className={`team-route-tag ${hasDumpsite ? '' : 'missing-dumpsite'}`}
                                            >
                                              <MapPin size={12} color={hasDumpsite ? '#059669' : '#dc2626'} />
                                              {s.area}
                                              {hasDumpsite ? ` → ${s.dumpsite_name}` : ' (Missing Dumpsite)'}
                                            </span>
                                          )
                                        })}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 12, color: '#94a3b8' }}>Not set as default team on any schedule.</div>
                                    )}
                                  </div>

                                  <div className="team-roles-grid">
                                    {/* Team Leader Drop Target */}
                                    <div
                                      className={`team-role-box team-drop-zone ${leaderDrop.dropClass}`}
                                      role={leaderDrop.role}
                                      tabIndex={leaderDrop.tabIndex}
                                      aria-label={leaderDrop['aria-label']}
                                      onDragOver={leaderDrop.onDragOver}
                                      onDragLeave={leaderDrop.onDragLeave}
                                      onDrop={leaderDrop.onDrop}
                                      onClick={leaderDrop.onClick}
                                      onKeyDown={leaderDrop.onKeyDown}
                                    >
                                      <div className="team-role-header">
                                        <span className="team-role-tag leader">Team Leader</span>
                                        {isAdmin && team.active_leader && (
                                          <div className="team-role-actions" onClick={(e) => e.stopPropagation()}>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setTransferWorker(team.active_leader)
                                                setTargetRole('leader')
                                                setShowTransferModal(true)
                                              }}
                                              className="team-icon-btn"
                                              title="Transfer Team Leader"
                                            >
                                              <ArrowRightLeft size={14} />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDeactivateMembership(team.active_leader.membership_id, team.active_leader.name)}
                                              className="team-icon-btn danger"
                                              title="Remove from Team"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                      {team.active_leader ? (
                                        <div>
                                          <div className="team-role-person-name">{team.active_leader.name}</div>
                                          <div className="team-role-person-id">
                                            {team.active_leader.employee_id} · System Role: {SYSTEM_ROLE_LABELS[team.active_leader.system_role] || team.active_leader.system_role || 'Staff'}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="team-role-empty">
                                          Drop Watcher or Driver here (or select & tap)
                                        </div>
                                      )}
                                    </div>

                                    {/* Assigned Driver Drop Target */}
                                    <div
                                      className={`team-role-box team-drop-zone ${driverDrop.dropClass}`}
                                      role={driverDrop.role}
                                      tabIndex={driverDrop.tabIndex}
                                      aria-label={driverDrop['aria-label']}
                                      onDragOver={driverDrop.onDragOver}
                                      onDragLeave={driverDrop.onDragLeave}
                                      onDrop={driverDrop.onDrop}
                                      onClick={driverDrop.onClick}
                                      onKeyDown={driverDrop.onKeyDown}
                                    >
                                      <div className="team-role-header">
                                        <span className="team-role-tag driver">Assigned Driver</span>
                                        {isAdmin && team.active_driver && (
                                          <div className="team-role-actions" onClick={(e) => e.stopPropagation()}>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setTransferWorker(team.active_driver)
                                                setTargetRole('driver')
                                                setShowTransferModal(true)
                                              }}
                                              className="team-icon-btn"
                                              title="Transfer Driver"
                                            >
                                              <ArrowRightLeft size={14} />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDeactivateMembership(team.active_driver.membership_id, team.active_driver.name)}
                                              className="team-icon-btn danger"
                                              title="Remove from Team"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                      {team.active_driver ? (
                                        <div>
                                          <div className="team-role-person-name">{team.active_driver.name}</div>
                                          <div className="team-role-person-id">{team.active_driver.employee_id} · System Role: Driver</div>
                                        </div>
                                      ) : team.team_leader_mode === 'driver' && team.active_leader ? (
                                        <div style={{ fontSize: 12, color: '#0f766e', fontWeight: 600 }}>
                                          Operated by Driver-Team Leader ({team.active_leader.name})
                                        </div>
                                      ) : (
                                        <div className="team-role-empty">
                                          Drop Driver here (or select & tap)
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Crew Members Drop Target & List */}
                                  <div
                                    className={`team-crew-section team-drop-zone ${crewDrop.dropClass}`}
                                    style={{ borderRadius: 8, padding: 6 }}
                                    role={crewDrop.role}
                                    tabIndex={crewDrop.tabIndex}
                                    aria-label={crewDrop['aria-label']}
                                    onDragOver={crewDrop.onDragOver}
                                    onDragLeave={crewDrop.onDragLeave}
                                    onDrop={crewDrop.onDrop}
                                    onClick={crewDrop.onClick}
                                    onKeyDown={crewDrop.onKeyDown}
                                  >
                                    <div className="team-crew-header">
                                      <span className="team-crew-tag">Crew Members ({team.crew_members?.length || 0})</span>
                                    </div>

                                    {team.crew_members && team.crew_members.length > 0 ? (
                                      <div className="team-crew-list">
                                        {team.crew_members.map((member) => (
                                          <div key={member.membership_id || member.id} className="team-crew-item">
                                            <div className="team-crew-item-info">
                                              <span className="team-crew-name">{member.name}</span>
                                              <span className="team-crew-id">
                                                {member.employee_id} · {SYSTEM_ROLE_LABELS[member.system_role] || 'Crew (No Login)'}
                                              </span>
                                            </div>
                                            {isAdmin && (
                                              <div className="team-role-actions" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setTransferWorker(member)
                                                    setTargetRole('crew')
                                                    setShowTransferModal(true)
                                                  }}
                                                  className="team-icon-btn"
                                                  title="Transfer Worker"
                                                >
                                                  <ArrowRightLeft size={13} />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleDeactivateMembership(member.membership_id, member.name)}
                                                  className="team-icon-btn danger"
                                                  title="Remove from Team"
                                                >
                                                  <Trash2 size={13} />
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}

                                    {isAdmin && team.is_active && (
                                      <div className="team-crew-drop-hint">
                                        Drop Crew Member here to add (or select & tap)
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="team-card-footer">
                                  <span className="team-footer-count">
                                    Total Roster: {team.members_count || 0} personnel
                                  </span>
                                  {isAdmin && team.is_active && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedTeam(team)
                                        setSelectedRole('crew')
                                        setShowAssignModal(true)
                                      }}
                                      className="team-btn-outline"
                                    >
                                      <Plus size={15} />
                                      Assign Personnel
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* 5-Team Server-Side Pagination (R3) */}
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setCurrentPage}
                      totalCount={totalCount}
                      pageSize={PAGE_SIZE}
                      loading={loading}
                    />
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* TAB 2: PERSONNEL ROSTER & HISTORY */}
        {activeTab === 'roster' && (
          <div className="team-section-card">
            <div className="team-section-header">
              <div>
                <h2 className="team-section-title">Personnel Roster & Membership History</h2>
                <p className="team-section-desc">
                  Operational team designations remain separate from system roles. Crew Members do not require login accounts.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Search worker, ID, team..."
                  value={rosterSearch}
                  onChange={e => setRosterSearch(e.target.value)}
                  className="team-search-input"
                  style={{ width: 220, padding: '8px 12px' }}
                />
                <select
                  value={rosterRoleFilter}
                  onChange={e => setRosterRoleFilter(e.target.value)}
                  className="team-select"
                >
                  <option value="all">All Designations</option>
                  <option value="leader">Team Leader</option>
                  <option value="driver">Driver</option>
                  <option value="crew">Crew Member</option>
                </select>
                <select
                  value={rosterStatusFilter}
                  onChange={e => setRosterStatusFilter(e.target.value)}
                  className="team-select"
                >
                  <option value="active">Active Only</option>
                  <option value="inactive">Historical / Left</option>
                  <option value="all">All History</option>
                </select>
              </div>
            </div>

            {filteredMemberships.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b', fontSize: 13 }}>
                No team membership records match your filter.
              </div>
            ) : (
              <div className="team-table-responsive">
                <table className="team-table">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 8px' }}>Worker</th>
                      <th style={{ padding: '10px 8px' }}>Team</th>
                      <th style={{ padding: '10px 8px' }}>Operational Designation</th>
                      <th style={{ padding: '10px 8px' }}>Status</th>
                      <th style={{ padding: '10px 8px' }}>Joined / Left</th>
                      {isAdmin && <th style={{ padding: '10px 8px', textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMemberships.map(m => (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{m.worker_name}</div>
                          <div style={{ fontSize: 11.5, color: '#64748b', fontFamily: 'monospace' }}>{m.worker_employee_id}</div>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{m.team_code}</span> · {m.team_name}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11.5,
                            fontWeight: 700,
                            background: m.role_in_team === 'leader' ? '#f3e8ff' : m.role_in_team === 'driver' ? '#dbeafe' : '#f1f5f9',
                            color: m.role_in_team === 'leader' ? '#6b21a8' : m.role_in_team === 'driver' ? '#1d4ed8' : '#334155',
                          }}>
                            {ROLE_LABELS[m.role_in_team] || m.role_in_team}
                          </span>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            background: m.is_active ? '#dcfce7' : '#f1f5f9',
                            color: m.is_active ? '#166534' : '#64748b',
                          }}>
                            {m.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 8px', fontSize: 12, color: '#475569' }}>
                          <div>Joined: {formatDateTime(m.joined_at)}</div>
                          {m.left_at && <div style={{ color: '#94a3b8' }}>Left: {formatDateTime(m.left_at)}</div>}
                        </td>
                        {isAdmin && (
                          <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                            {m.is_active && (
                              <div style={{ display: 'inline-flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="team-icon-btn"
                                  title="Transfer Worker"
                                  onClick={() => {
                                    setTransferWorker({
                                      id: m.worker,
                                      name: m.worker_name,
                                      employee_id: m.worker_employee_id,
                                      system_role: m.worker_system_role ?? null,
                                      employee_type: m.worker_employee_type ?? null,
                                    })
                                    setTargetRole(m.role_in_team)
                                    setShowTransferModal(true)
                                  }}
                                >
                                  <ArrowRightLeft size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="team-icon-btn danger"
                                  title="Remove from Team"
                                  onClick={() => handleDeactivateMembership(m.id, m.worker_name)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SCHEDULES & DEPLOYMENTS (R4 - Deployment-Specific Leader Display) */}
        {activeTab === 'schedules' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="team-section-card">
              <div className="team-section-header">
                <div>
                  <h2 className="team-section-title">Collection Schedules & Team Deployments</h2>
                  <p className="team-section-desc">
                    Each schedule requires an explicitly assigned Dumpsite. Date-specific overrides and schedule designations resolve the authoritative deployment Team Leader.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchSchedulesAndDeployments}
                  className="team-btn-outline"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>

              {scheduleLoading ? (
                <div className="team-loading-state">
                  <RefreshCw size={24} className="animate-spin" style={{ color: '#059669' }} />
                  <p>Loading schedules and overrides...</p>
                </div>
              ) : schedules.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b', fontSize: 13 }}>
                  No collection schedules found.
                </div>
              ) : (
                <div className="team-table-responsive">
                  <table className="team-table">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                        <th style={{ padding: '10px 8px' }}>Schedule / Route</th>
                        <th style={{ padding: '10px 8px' }}>Assigned Dumpsite</th>
                        <th style={{ padding: '10px 8px' }}>Default Team & Resolved Leader</th>
                        <th style={{ padding: '10px 8px' }}>Date Overrides</th>
                        <th style={{ padding: '10px 8px' }}>Truck Allocations</th>
                        {canAllocateTruck && <th style={{ padding: '10px 8px', textAlign: 'right' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.map(sched => {
                        const schedOverrides = overrides.filter(o => o.schedule === sched.id)
                        const schedAllocs = allocations.filter(a => a.schedule === sched.id)
                        const defaultLeader = sched.default_team ? getTeamLeaderForTeamId(sched.default_team) : null

                        const effectiveRoleLabel = SYSTEM_ROLE_LABELS[sched.effective_team_leader_role] || 'Staff'
                        const effectiveLeaderDisplay = sched.effective_team_leader_name
                          ? `${sched.effective_team_leader_name} (${effectiveRoleLabel})`
                          : defaultLeader
                            ? `${defaultLeader.name} (${SYSTEM_ROLE_LABELS[defaultLeader.system_role] || 'Staff'})`
                            : 'Unassigned'

                        return (
                          <tr key={sched.id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                            <td style={{ padding: '12px 8px' }}>
                              <div style={{ fontWeight: 700, color: '#0f172a' }}>{sched.area}</div>
                              <div style={{ fontSize: 11.5, color: '#64748b' }}>
                                {sched.days || 'No days'} · {sched.start_time || '—'} – {sched.end_time || '—'}
                              </div>
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              {sched.dumpsite_name ? (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5,
                                  padding: '3px 8px', borderRadius: 6, background: '#ecfdf5',
                                  color: '#047857', fontSize: 12, fontWeight: 600,
                                }}>
                                  <MapPin size={12} /> {sched.dumpsite_name}
                                </span>
                              ) : (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5,
                                  padding: '3px 8px', borderRadius: 6, background: '#fef2f2',
                                  color: '#b91c1c', fontSize: 12, fontWeight: 600,
                                }}>
                                  <AlertTriangle size={12} /> Missing Dumpsite
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              {sched.default_team_name ? (
                                <div>
                                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                    {sched.default_team_code} · {sched.default_team_name}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: '#475569', marginTop: 2 }}>
                                    Resolved Leader: <strong>{effectiveLeaderDisplay}</strong>
                                  </div>
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>No default team</span>
                              )}
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              {schedOverrides.length === 0 ? (
                                <span style={{ fontSize: 12, color: '#94a3b8' }}>None</span>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {schedOverrides.slice(0, 3).map(ov => {
                                    const ovLeader = getTeamLeaderForTeamId(ov.team)
                                    const overrideLeaderDisplay = ov.effective_team_leader_name || (ovLeader ? ovLeader.name : null)
                                    return (
                                      <div key={ov.id} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                                        padding: '4px 8px', borderRadius: 6, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 11.5,
                                      }}>
                                        <span>
                                          <strong>{ov.effective_date}</strong>: {ov.team_code}
                                          {overrideLeaderDisplay ? ` (${overrideLeaderDisplay})` : ''}
                                        </span>
                                        {isAdmin && (
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteOverride(ov.id)}
                                            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 0 }}
                                            title="Remove override"
                                          >
                                            <X size={13} />
                                          </button>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              {schedAllocs.length === 0 ? (
                                <span style={{ fontSize: 12, color: '#64748b' }}>
                                  Default: {sched.truck_plate || 'Unassigned'}
                                </span>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {schedAllocs.slice(0, 3).map(al => (
                                    <div key={al.id} style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 5,
                                      padding: '3px 8px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 11.5,
                                    }}>
                                      <Truck size={12} color="#475569" />
                                      <span><strong>{al.allocation_date}</strong>: {al.truck_plate}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            {canAllocateTruck && (
                              <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  {isAdmin && (
                                    <>
                                      <button
                                        type="button"
                                        className="team-btn-outline"
                                        onClick={() => {
                                          setDefaultTeamModalSchedule(sched)
                                          setDefaultTeamId(sched.default_team ? String(sched.default_team) : '')
                                        }}
                                      >
                                        Default Team
                                      </button>
                                      <button
                                        type="button"
                                        className="team-btn-outline"
                                        onClick={() => {
                                          setOverrideModalSchedule(sched)
                                          setOverrideTeamId('')
                                        }}
                                      >
                                        + Override
                                      </button>
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    className="team-btn-outline"
                                    onClick={() => {
                                      setAllocModalSchedule(sched)
                                      setAllocTruckId(sched.truck ? String(sched.truck) : '')
                                    }}
                                  >
                                    + Truck
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ATTENDANCE & SHIFT ACTIVITY (R4) */}
        {activeTab === 'activity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="team-section-card">
              <div className="team-section-header">
                <div>
                  <h2 className="team-section-title">Shift Lifecycles & Crew Attendance</h2>
                  <p className="team-section-desc">
                    DriverShift, WatcherShift, and CrewShift lifecycles remain independent at start and coordinated at closure. Click Inspect Attendance to view Present/Absent/Late/Excused statuses and append-only corrections.
                  </p>
                </div>
                <button type="button" onClick={fetchShiftActivity} className="team-btn-outline">
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>

              {activityLoading ? (
                <div className="team-loading-state">
                  <RefreshCw size={24} className="animate-spin" style={{ color: '#059669' }} />
                  <p>Loading shift and attendance activity...</p>
                </div>
              ) : shifts.length === 0 && crewShifts.filter(cs => !cs.driver_shift).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b', fontSize: 13 }}>
                  No recent shifts recorded.
                </div>
              ) : (
                <div className="team-table-responsive">
                  <table className="team-table">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                        <th style={{ padding: '10px 8px' }}>Shift / Team</th>
                        <th style={{ padding: '10px 8px' }}>DriverShift</th>
                        <th style={{ padding: '10px 8px' }}>WatcherShift</th>
                        <th style={{ padding: '10px 8px' }}>CrewShift & Resolved Leader</th>
                        <th style={{ padding: '10px 8px', textAlign: 'right' }}>Roll-Call</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crewShifts.filter(cs => !cs.driver_shift).map(cs => {
                        const ws = cs.watcher_shift ? watcherShifts.find(w => w.id === cs.watcher_shift) : null
                        return (
                          <tr key={`cs-${cs.id}`} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                            <td style={{ padding: '12px 8px' }}>
                              <div style={{ fontWeight: 700, color: '#0f172a' }}>CrewShift #{cs.id} · {cs.team_code || 'No Team'}</div>
                              <div style={{ fontSize: 11.5, color: '#64748b' }}>
                                Route: {cs.schedule_area || '—'} · Service Date: {cs.service_date || '—'}
                              </div>
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
                                Pre-Departure (No DriverShift yet)
                              </span>
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              {cs.watcher_shift ? (
                                <div>
                                  <div style={{ fontWeight: 600, color: '#6b21a8' }}>
                                    WatcherShift #{cs.watcher_shift} {ws?.watcher_username ? `(${ws.watcher_username})` : ''}
                                  </div>
                                  <span style={{
                                    display: 'inline-block',
                                    marginTop: 3,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    background: ws?.is_active ? '#f3e8ff' : '#f1f5f9',
                                    color: ws?.is_active ? '#6b21a8' : '#475569',
                                  }}>
                                    {ws ? (ws.is_active ? 'Active' : `Ended (${ws.end_reason || 'closed'})`) : 'Linked'}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: '#64748b' }}>Not started</span>
                              )}
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                                  CrewShift #{cs.id} · {cs.is_active ? 'Active' : 'Closed'}
                                </div>
                                <div style={{ fontSize: 11.5, color: '#64748b' }}>
                                  Resolved Leader: {cs.team_leader_username || '—'} ({cs.team_leader_role || '—'})
                                </div>
                                <div style={{ fontSize: 11.5, color: cs.attendance_submitted_by_username ? '#059669' : '#b45309', fontWeight: 600 }}>
                                  {cs.attendance_submitted_by_username
                                    ? `Submitted by ${cs.attendance_submitted_by_username}`
                                    : 'Attendance pending'}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                              <button
                                type="button"
                                className="team-btn-outline"
                                onClick={() => setInspectShift({
                                  id: null,
                                  crew_shift_id: cs.id,
                                  team_code: cs.team_code,
                                  started_at: cs.started_at,
                                  crew_shift_info: cs,
                                })}
                              >
                                <Eye size={14} /> Inspect Attendance
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                      {shifts.map(sh => {
                        const cs = sh.crew_shift_info
                        const ws = cs?.watcher_shift_id ? watcherShifts.find(w => w.id === cs.watcher_shift_id) : null
                        return (
                          <tr key={sh.id} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                            <td style={{ padding: '12px 8px' }}>
                              <div style={{ fontWeight: 700, color: '#0f172a' }}>Shift #{sh.id} · {sh.team_code || 'No Team'}</div>
                              <div style={{ fontSize: 11.5, color: '#64748b' }}>
                                Truck: {sh.truck_plate || '—'} · Started {formatDateTime(sh.started_at)}
                              </div>
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>{sh.driver_name || '—'}</div>
                              <span style={{
                                display: 'inline-block',
                                marginTop: 3,
                                padding: '2px 8px',
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: sh.is_active ? '#dcfce7' : '#f1f5f9',
                                color: sh.is_active ? '#166534' : '#475569',
                              }}>
                                {sh.is_active ? `Active (${sh.op_status || sh.status})` : `Ended (${sh.end_reason || 'completed'})`}
                              </span>
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              {cs?.watcher_shift_id ? (
                                <div>
                                  <div style={{ fontWeight: 600, color: '#6b21a8' }}>
                                    WatcherShift #{cs.watcher_shift_id} {ws?.watcher_username ? `(${ws.watcher_username})` : ''}
                                  </div>
                                  <span style={{
                                    display: 'inline-block',
                                    marginTop: 3,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    background: ws?.is_active ? '#f3e8ff' : '#f1f5f9',
                                    color: ws?.is_active ? '#6b21a8' : '#475569',
                                  }}>
                                    {ws ? (ws.is_active ? 'Active' : `Ended (${ws.end_reason || 'closed'})`) : 'Linked'}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: '#0f766e', fontWeight: 600 }}>
                                  None (Driver-Led Deployment)
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              {cs ? (
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                                    CrewShift #{cs.id} · {cs.is_active ? 'Active' : 'Closed'}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: '#64748b' }}>
                                    Resolved Leader: {cs.team_leader_username || '—'} ({cs.team_leader_role || '—'})
                                  </div>
                                  <div style={{ fontSize: 11.5, color: cs.attendance_submitted_by_username ? '#059669' : '#b45309', fontWeight: 600 }}>
                                    {cs.attendance_submitted_by_username
                                      ? `Submitted by ${cs.attendance_submitted_by_username}`
                                      : 'Attendance pending'}
                                  </div>
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: '#94a3b8' }}>No CrewShift</span>
                              )}
                            </td>
                            <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                              <button
                                type="button"
                                className="team-btn-outline"
                                onClick={() => setInspectShift(sh)}
                              >
                                <Eye size={14} /> Inspect Attendance
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Team Modal */}
      {showCreateTeamModal && createPortal(
        <div className="team-modal-backdrop" onClick={() => setShowCreateTeamModal(false)}>
          <div className="team-modal" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-header">
              <h3 className="team-modal-title">Create Sanitation Team</h3>
              <button onClick={() => setShowCreateTeamModal(false)} className="team-modal-close"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateTeam} className="team-modal-form">
              <div className="team-form-group">
                <label className="team-form-label">Team Name *</label>
                <input type="text" required placeholder="e.g. Barangay 1 Alpha Squad" value={teamName} onChange={(e) => setTeamName(e.target.value)} className="team-form-input" />
              </div>
              <div className="team-form-group">
                <label className="team-form-label">Team Code *</label>
                <input type="text" required placeholder="e.g. TM-ALPHA" value={teamCode} onChange={(e) => setTeamCode(e.target.value.toUpperCase())} className="team-form-input uppercase" />
              </div>
              <div className="team-form-group">
                <label className="team-form-label">Description (Optional)</label>
                <textarea rows={2} placeholder="Assigned zones or operational notes..." value={teamDescription} onChange={(e) => setTeamDescription(e.target.value)} className="team-form-textarea" />
              </div>
              <div className="team-modal-actions">
                <button type="button" onClick={() => setShowCreateTeamModal(false)} className="team-btn-cancel">Cancel</button>
                <button type="submit" disabled={submitting} className="team-btn-primary">{submitting ? 'Creating...' : 'Create Team'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Assign Member Modal */}
      {showAssignModal && selectedTeam && createPortal(
        <div className="team-modal-backdrop" onClick={() => setShowAssignModal(false)}>
          <div className="team-modal" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-header">
              <h3 className="team-modal-title">Assign Personnel to {selectedTeam.name}</h3>
              <button onClick={() => setShowAssignModal(false)} className="team-modal-close"><X size={20} /></button>
            </div>
            <form onSubmit={handleAssignMember} className="team-modal-form">
              <div className="team-form-group">
                <label className="team-form-label">Operational Team Designation *</label>
                <select
                  value={selectedRole}
                  onChange={(e) => {
                    setSelectedRole(e.target.value)
                    setSelectedWorkerId('')
                  }}
                  className="team-form-select"
                >
                  <option value="leader">Team Leader (Watcher or Driver)</option>
                  <option value="driver">Driver (Driver account only)</option>
                  <option value="crew">Crew Member (Citizen crew_member, no login)</option>
                </select>
                <span className="team-form-hint">
                  Eligible personnel are filtered by actual system role. Assigning a Driver as Team Leader does not grant Watcher permissions.
                </span>
              </div>
              <div className="team-form-group">
                <label className="team-form-label">Select Eligible Unassigned Worker *</label>
                <select required value={selectedWorkerId} onChange={(e) => setSelectedWorkerId(e.target.value)} className="team-form-select">
                  <option value="">-- Choose an eligible worker --</option>
                  {allWorkers
                    .filter(w => !activeWorkerIds.has(w.id) && isWorkerEligibleForRole(w, selectedRole))
                    .map(w => (
                      <option key={w.id} value={w.id}>
                        {w.full_name} ({w.employee_id}) — {w.user_role ? w.user_role.toUpperCase() : 'CREW_MEMBER'}
                      </option>
                    ))}
                </select>
              </div>
              <div className="team-modal-actions">
                <button type="button" onClick={() => setShowAssignModal(false)} className="team-btn-cancel">Cancel</button>
                <button type="submit" disabled={submitting} className="team-btn-primary">{submitting ? 'Assigning...' : 'Assign Personnel'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Transfer Worker Modal (R2 - Preserves Audit History) */}
      {showTransferModal && transferWorker && createPortal(
        <div className="team-modal-backdrop" onClick={() => setShowTransferModal(false)}>
          <div className="team-modal" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-header">
              <h3 className="team-modal-title">Transfer {transferWorker.name}</h3>
              <button onClick={() => setShowTransferModal(false)} className="team-modal-close"><X size={20} /></button>
            </div>
            <form onSubmit={handleTransferMember} className="team-modal-form">
              <div className="team-alert-info">
                <Info size={16} className="team-alert-icon" />
                <span>Transfers close the current team membership and create a new active membership without altering past shift or attendance history.</span>
              </div>
              <div className="team-form-group">
                <label className="team-form-label">Target Sanitation Team *</label>
                <select required value={targetTeamId} onChange={(e) => setTargetTeamId(e.target.value)} className="team-form-select">
                  <option value="">-- Select destination team --</option>
                  {activeTeamsForSelect.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                  ))}
                </select>
              </div>
              <div className="team-form-group">
                <label className="team-form-label">New Designation *</label>
                <select value={targetRole} onChange={(e) => setTargetRole(e.target.value)} className="team-form-select">
                  {isWorkerEligibleForRole({ user_role: transferWorker.system_role, employee_type: transferWorker.employee_type }, 'leader') && (
                    <option value="leader">Team Leader (Watcher or Driver)</option>
                  )}
                  {isWorkerEligibleForRole({ user_role: transferWorker.system_role, employee_type: transferWorker.employee_type }, 'driver') && (
                    <option value="driver">Driver</option>
                  )}
                  {isWorkerEligibleForRole({ user_role: transferWorker.system_role, employee_type: transferWorker.employee_type }, 'crew') && (
                    <option value="crew">Crew Member</option>
                  )}
                </select>
                <span className="team-form-hint">
                  You may select the same team to change this member's operational designation without altering their system role.
                </span>
              </div>
              <div className="team-modal-actions">
                <button type="button" onClick={() => setShowTransferModal(false)} className="team-btn-cancel">Cancel</button>
                <button type="submit" disabled={submitting} className="team-btn-primary">{submitting ? 'Transferring...' : 'Execute Transfer'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Set Default Team Modal */}
      {defaultTeamModalSchedule && createPortal(
        <div className="team-modal-backdrop" onClick={() => setDefaultTeamModalSchedule(null)}>
          <div className="team-modal" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-header">
              <h3 className="team-modal-title">Set Default Team — {defaultTeamModalSchedule.area}</h3>
              <button onClick={() => setDefaultTeamModalSchedule(null)} className="team-modal-close"><X size={20} /></button>
            </div>
            <form onSubmit={handleSetDefaultTeam} className="team-modal-form">
              <div className="team-form-group">
                <label className="team-form-label">Default Sanitation Team *</label>
                <select
                  required
                  value={defaultTeamId}
                  onChange={(e) => setDefaultTeamId(e.target.value)}
                  className="team-form-select"
                >
                  <option value="">-- Select team --</option>
                  {activeTeamsForSelect.map(t => (
                    <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
                  ))}
                </select>
              </div>
              <div className="team-modal-actions">
                <button type="button" onClick={() => setDefaultTeamModalSchedule(null)} className="team-btn-cancel">Cancel</button>
                <button type="submit" disabled={submitting} className="team-btn-primary">{submitting ? 'Saving...' : 'Save Default Team'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Create Schedule Team Override Modal */}
      {overrideModalSchedule && createPortal(
        <div className="team-modal-backdrop" onClick={() => setOverrideModalSchedule(null)}>
          <div className="team-modal" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-header">
              <h3 className="team-modal-title">Date-Specific Override — {overrideModalSchedule.area}</h3>
              <button onClick={() => setOverrideModalSchedule(null)} className="team-modal-close"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateOverride} className="team-modal-form">
              <div className="team-form-group">
                <label className="team-form-label">Effective Date *</label>
                <input type="date" required value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} className="team-form-input" />
              </div>
              <div className="team-form-group">
                <label className="team-form-label">Override Team *</label>
                <select
                  required
                  value={overrideTeamId}
                  onChange={(e) => setOverrideTeamId(e.target.value)}
                  className="team-form-select"
                >
                  <option value="">-- Select team --</option>
                  {activeTeamsForSelect.map(t => (
                    <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
                  ))}
                </select>
              </div>
              <div className="team-form-group">
                <label className="team-form-label">Reason (Optional)</label>
                <input type="text" placeholder="e.g. Relief team coverage" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className="team-form-input" />
              </div>
              <div className="team-modal-actions">
                <button type="button" onClick={() => setOverrideModalSchedule(null)} className="team-btn-cancel">Cancel</button>
                <button type="submit" disabled={submitting} className="team-btn-primary">{submitting ? 'Saving...' : 'Save Override'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Allocate Truck Modal */}
      {allocModalSchedule && createPortal(
        <div className="team-modal-backdrop" onClick={() => setAllocModalSchedule(null)}>
          <div className="team-modal" onClick={(e) => e.stopPropagation()}>
            <div className="team-modal-header">
              <h3 className="team-modal-title">Allocate Truck — {allocModalSchedule.area}</h3>
              <button onClick={() => setAllocModalSchedule(null)} className="team-modal-close"><X size={20} /></button>
            </div>
            <form onSubmit={handleAllocateTruck} className="team-modal-form">
              <div className="team-form-group">
                <label className="team-form-label">Allocation Date *</label>
                <input type="date" required value={allocDate} onChange={(e) => setAllocDate(e.target.value)} className="team-form-input" />
              </div>
              <div className="team-form-group">
                <label className="team-form-label">Truck *</label>
                <select required value={allocTruckId} onChange={(e) => setAllocTruckId(e.target.value)} className="team-form-select">
                  <option value="">-- Select operational truck --</option>
                  {trucks
                    .filter(t => t.status === 'active' && !t.is_retired && !t.is_operational_hold)
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.plate_number} — {t.model}</option>
                    ))}
                </select>
              </div>
              <div className="team-modal-actions">
                <button type="button" onClick={() => setAllocModalSchedule(null)} className="team-btn-cancel">Cancel</button>
                <button type="submit" disabled={submitting} className="team-btn-primary">{submitting ? 'Allocating...' : 'Allocate Truck'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Crew Attendance & Inspection Modal (R4 / Stage 5B) */}
      {inspectShift && (
        <AdminCrewAttendanceModal
          shiftId={inspectShift.id}
          crewShiftId={inspectShift.crew_shift_id || inspectShift.crew_shift_info?.id || null}
          shiftInfo={inspectShift}
          onClose={() => setInspectShift(null)}
          onActivityUpdated={fetchShiftActivity}
        />
      )}
    </DashboardLayout>
  )
}
