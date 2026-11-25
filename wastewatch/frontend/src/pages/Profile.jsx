import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Loader2,
  Pencil,
  ShieldCheck,
  Users,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  History,
  Truck,
  FileText,
  ExternalLink,
} from 'lucide-react'
import api from '../api/client'
import {
  getMyAttendanceHistory,
  submitDeploymentAttendanceCorrection,
  ATTENDANCE_STATUSES,
} from '../api/driverWorkflowApi'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import DashboardLayout from '../components/DashboardLayout'
import BarangaySelect from '../components/BarangaySelect'
import { ICONS } from '../api/navConfig'
import { AppShellSkeleton } from '../components/ui/Skeleton'

const STATUS_BADGE_STYLES = {
  PRESENT: { bg: '#dcfce7', color: '#166534', border: '#86efac', label: 'Present' },
  LATE: { bg: '#fef9c3', color: '#854d0e', border: '#fde047', label: 'Late' },
  EXCUSED: { bg: '#e0f2fe', color: '#075985', border: '#7dd3fc', label: 'Excused' },
  ABSENT: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5', label: 'Absent' },
}

function AttendanceStatusPill({ status }) {
  const key = String(status || '').toUpperCase()
  const cfg = STATUS_BADGE_STYLES[key] || {
    bg: '#f1f5f9',
    color: '#334155',
    border: '#cbd5e1',
    label: status || 'Unknown',
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {cfg.label}
    </span>
  )
}

function formatDateTime(val) {
  if (!val) return '—'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return String(val)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Profile() {
  const { user, barangays, updateUser } = useAuth()
  const navigate = useNavigate()

  const [siteData, setSiteData] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  const [isEditing, setIsEditing] = useState(false)
  const [toast, setToast] = useState(null)

  const [historyData, setHistoryData] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [activeHistoryTab, setActiveHistoryTab] = useState('personal')

  // Inline append-only correction state (only for authorized original Team Leader or Admin)
  const [correctingRecord, setCorrectingRecord] = useState(null)
  const [correctionStatus, setCorrectionStatus] = useState('PRESENT')
  const [correctionReason, setCorrectionReason] = useState('')
  const [submittingCorrection, setSubmittingCorrection] = useState(false)

  // Form state
  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone_number || '',
    barangay: user?.barangay || '',
    profile_pic: null,
  })

  // Password state
  const [pwd, setPwd] = useState({ current: '', new: '', confirm: '' })

  const role = user?.role?.toLowerCase() || 'citizen'
  const isAdmin = role === 'admin' || Boolean(user?.is_staff)
  const isCrewMember =
    user?.employee_type === 'crew_member' || Boolean(historyData?.is_crew_member)

  const loadHistory = useCallback(async () => {
    if (!user) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const data = await getMyAttendanceHistory()
      setHistoryData(data)
      if (
        (data?.personal_attendance?.length || 0) === 0 &&
        (data?.led_crew_shifts?.length || 0) > 0
      ) {
        setActiveHistoryTab('led')
      } else if (
        (data?.personal_attendance?.length || 0) === 0 &&
        (data?.driver_shifts?.length || 0) > 0
      ) {
        setActiveHistoryTab('shifts')
      } else if (
        (data?.personal_attendance?.length || 0) === 0 &&
        (data?.watcher_shifts?.length || 0) > 0
      ) {
        setActiveHistoryTab('shifts')
      }
    } catch (err) {
      setHistoryError(
        err?.response?.data?.error || 'Unable to load attendance and shift history.'
      )
    } finally {
      setHistoryLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (user && role === 'dumpsite') {
      api
        .get('/api/dumpsite/dumpsites/')
        .then((res) => {
          const list = Array.isArray(res.data) ? res.data : res.data?.results || []
          if (list.length > 0) setSiteData(list[0])
        })
        .catch(() => {})
    }
  }, [user, role])

  if (!user) {
    return (
      <DashboardLayout>
        <AppShellSkeleton showTopBar={false} />
      </DashboardLayout>
    )
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const handlePhoto = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('profile_pic', file)
      await updateUser(fd)
      showToast('Profile photo updated successfully.')
    } catch {
      showToast('Failed to update photo.')
    } finally {
      setUploading(false)
    }
  }

  async function handleSaveProfile(e) {
    e.preventDefault()
    try {
      const payload = new FormData()
      payload.append('first_name', form.first_name)
      payload.append('last_name', form.last_name)
      payload.append('username', form.username)
      payload.append('full_name', `${form.first_name} ${form.last_name}`.trim())
      if (form.barangay) payload.append('barangay', form.barangay)
      if (form.profile_pic) payload.append('profile_pic', form.profile_pic)

      await updateUser(payload)
      setIsEditing(false)
      showToast('Profile updated successfully.')
    } catch {
      showToast('Failed to update profile.')
    }
  }

  function handleSavePassword(e) {
    e.preventDefault()
    if (pwd.new !== pwd.confirm) {
      showToast('New passwords do not match.')
      return
    }
    if (!pwd.current) {
      showToast('Current password is required.')
      return
    }
    setPwd({ current: '', new: '', confirm: '' })
    showToast('Password changed successfully.')
  }

  async function handleCorrectionSubmit(e) {
    e.preventDefault()
    if (!correctingRecord) return
    if (!correctionReason.trim()) {
      showToast('A correction reason is required.')
      return
    }
    setSubmittingCorrection(true)
    try {
      await submitDeploymentAttendanceCorrection({
        record_id: correctingRecord.record_id || correctingRecord.id,
        corrected_status: correctionStatus,
        reason: correctionReason.trim(),
      })
      showToast('Attendance correction recorded.')
      setCorrectingRecord(null)
      setCorrectionReason('')
      await loadHistory()
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.corrected_status ||
        'Failed to record attendance correction.'
      showToast(typeof msg === 'string' ? msg : 'Failed to record attendance correction.')
    } finally {
      setSubmittingCorrection(false)
    }
  }

  const personalRecords = historyData?.personal_attendance || []
  const ledCrewShifts = historyData?.led_crew_shifts || []
  const driverShifts = historyData?.driver_shifts || []
  const watcherShifts = historyData?.watcher_shifts || []
  const summary = historyData?.attendance_summary || {
    total: 0,
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    corrected: 0,
  }
  const activeMembership = historyData?.active_membership || null
  const workerProfile = historyData?.worker || null
  const limitations = historyData?.limitations || []

  const showHistorySection =
    isCrewMember ||
    role === 'driver' ||
    role === 'watcher' ||
    isAdmin ||
    personalRecords.length > 0 ||
    ledCrewShifts.length > 0

  return (
    <DashboardLayout>
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0f172a',
            color: '#fff',
            padding: '10px 22px',
            borderRadius: 12,
            zIndex: 9999,
            fontSize: 13,
            fontWeight: 600,
            border: '1px solid rgba(46,204,113,0.3)',
            whiteSpace: 'nowrap',
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        .profile-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .section-title { font-family: var(--font-head); font-weight: 800; font-size: 16px; margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
        .info-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 0; border-bottom: 1px solid var(--border); }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-size: 12px; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase; width: 160px; flex-shrink: 0; }
        .info-value { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; min-width: 180px; }
        .role-badge { background: var(--accent); color: #0d1117; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; display: inline-flex; align-items: center; gap: 5px; }
        .crew-badge { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; display: inline-flex; align-items: center; gap: 5px; }
        .history-tab-btn { border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); padding: 7px 14px; border-radius: 10px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease; }
        .history-tab-btn.active { background: #0f172a; color: #fff; border-color: #0f172a; }
        .attendance-record-card { border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 12px; background: var(--surface); }
        .correction-trail { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: rgba(15, 23, 42, 0.03); border-left: 3px solid #0284c7; font-size: 12px; }
      `}</style>

      <div className="page ww-fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>
            My Profile
          </h2>
          <p className="text-muted text-sm" style={{ margin: 0 }}>
            Manage your personal information, operational assignments, and verified attendance records.
          </p>
        </div>

        {/* 1. Header Card */}
        <div
          className="profile-card ww-fade-in"
          style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}
        >
          <div style={{ position: 'relative' }}>
            {user.profile_pic ? (
              <img
                src={user.profile_pic}
                alt="Profile"
                style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: '#0d1117',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 32,
                  fontWeight: 800,
                }}
              >
                {user.first_name?.[0]?.toUpperCase() || user.full_name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'var(--accent)',
                border: '2px solid var(--surface)',
                cursor: 'pointer',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#000',
                padding: 0,
              }}
              title="Change photo"
            >
              {uploading ? <Loader2 size={14} className="spin" /> : <Pencil size={13} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handlePhoto}
              style={{ display: 'none' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
              {user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>
              @{user.username || 'username'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="role-badge">
                {isAdmin ? 'administrator' : role.replace('_', ' ')}
              </span>
              {isCrewMember && (
                <span className="crew-badge">
                  <Users size={12} /> Municipal Sanitation Crew Member
                </span>
              )}
              {workerProfile?.employee_id && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: 'rgba(15,23,42,0.06)',
                    color: 'var(--text)',
                  }}
                >
                  Employee ID: {workerProfile.employee_id}
                </span>
              )}
              {(role === 'brgy_official' || role === 'watcher' || role === 'citizen') && (
                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <div style={{ width: 14, height: 14, color: '#14b8a6' }}>{ICONS.pin}</div> Brgy.{' '}
                  {user.barangay_name || 'Unassigned'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="ww-stagger" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
          {/* 2. Personal Information */}
          <div className="profile-card ww-fade-in">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <div className="section-title" style={{ margin: 0 }}>
                Personal Information
              </div>
              {!isEditing && (
                <button className="btn btn-outline btn-sm" onClick={() => setIsEditing(true)}>
                  Edit Profile
                </button>
              )}
            </div>

            {isEditing ? (
              <form onSubmit={handleSaveProfile}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 16,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <label className="form-label">First Name</label>
                    <input
                      className="form-input"
                      value={form.first_name}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Last Name</label>
                    <input
                      className="form-input"
                      value={form.last_name}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Username</label>
                    <input
                      className="form-input"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Email</label>
                    <input
                      className="form-input"
                      type="email"
                      value={form.email}
                      disabled
                      style={{ opacity: 0.6, cursor: 'not-allowed' }}
                    />
                  </div>
                  <div>
                    <label className="form-label">Profile Picture</label>
                    <input
                      className="form-input"
                      type="file"
                      accept="image/*"
                      onChange={(e) => setForm({ ...form, profile_pic: e.target.files[0] })}
                      style={{ padding: 8 }}
                    />
                  </div>
                  <div>
                    <label className="form-label">Contact Number</label>
                    <input
                      className="form-input"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                  {(role === 'brgy_official' || role === 'watcher' || role === 'citizen') && (
                    <div>
                      <label className="form-label">Barangay (Optional)</label>
                      <BarangaySelect
                        barangays={barangays}
                        value={form.barangay}
                        onChange={(id) => setForm({ ...form, barangay: id })}
                        label="Select barangay (Optional)"
                      />
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setIsEditing(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save Changes
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div className="info-row">
                  <div className="info-label">First Name</div>
                  <div className="info-value">{user.first_name || '—'}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Last Name</div>
                  <div className="info-value">{user.last_name || '—'}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Username</div>
                  <div className="info-value">{user.username || '—'}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Email Address</div>
                  <div className="info-value">{user.email || '—'}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Contact Number</div>
                  <div className="info-value">{form.phone || 'Not provided'}</div>
                </div>
                {(role === 'brgy_official' || role === 'watcher' || role === 'citizen') && (
                  <div className="info-row">
                    <div className="info-label">Barangay</div>
                    <div className="info-value">{user.barangay_name || 'Not assigned'}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Assignment & Operational Standing */}
          <div className="profile-card ww-fade-in">
            <div className="section-title">
              <ShieldCheck size={18} /> Assignment & Operational Standing
            </div>

            {isAdmin && (
              <div className="info-row">
                <div className="info-label">System Access</div>
                <div className="info-value">Citywide Administrator Access</div>
              </div>
            )}

            {workerProfile && (
              <div className="info-row">
                <div className="info-label">Worker Record</div>
                <div className="info-value">
                  {workerProfile.full_name} ({workerProfile.employee_id}) —{' '}
                  <span style={{ color: workerProfile.is_active ? '#16a34a' : '#dc2626' }}>
                    {workerProfile.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            )}

            {activeMembership && (
              <div className="info-row">
                <div className="info-label">Sanitation Team</div>
                <div className="info-value">
                  {activeMembership.team_name} ({activeMembership.team_code}) — Role:{' '}
                  <span style={{ textTransform: 'capitalize' }}>
                    {activeMembership.role_in_team}
                  </span>
                </div>
              </div>
            )}

            {(role === 'brgy_official' || role === 'watcher') && (
              <div className="info-row">
                <div className="info-label">Home Barangay</div>
                <div className="info-value">Barangay {user.barangay_name || 'Unassigned'}</div>
              </div>
            )}

            {role === 'dumpsite' && (
              <>
                <div className="info-row">
                  <div className="info-label">Assigned Facility</div>
                  <div className="info-value">
                    {siteData
                      ? `${siteData.name} (${String(siteData.type || '').replace('_', ' ')})`
                      : user.dumpsite_name || 'Unassigned'}
                  </div>
                </div>
                {siteData && (
                  <>
                    <div className="info-row">
                      <div className="info-label">Location</div>
                      <div className="info-value">Brgy. {siteData.barangay_name || '—'}</div>
                    </div>
                    <div className="info-row">
                      <div className="info-label">Capacity</div>
                      <div className="info-value">
                        {Number(siteData.current_fill_kg || 0).toLocaleString()} kg /{' '}
                        {Number(siteData.max_capacity_kg || 0).toLocaleString()} kg
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {role === 'citizen' && (
              <div className="info-row">
                <div className="info-label">Account Status</div>
                <div className="info-value" style={{ color: '#16a34a' }}>
                  {isCrewMember
                    ? 'Active Resident & Municipal Sanitation Crew Member'
                    : 'Active Resident'}
                </div>
              </div>
            )}
          </div>

          {/* 4. Stage 5B: Persisted Attendance & Shift History */}
          {showHistorySection && (
            <div className="profile-card ww-fade-in" data-testid="profile-attendance-history">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div className="section-title" style={{ margin: 0 }}>
                  <History size={18} /> Attendance & Shift History
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(isCrewMember || personalRecords.length > 0 || (role !== 'driver' && role !== 'watcher')) && (
                    <button
                      type="button"
                      className={`history-tab-btn ${activeHistoryTab === 'personal' ? 'active' : ''}`}
                      onClick={() => setActiveHistoryTab('personal')}
                    >
                      <CheckCircle2 size={14} /> Personal Attendance ({personalRecords.length})
                    </button>
                  )}
                  {(role === 'driver' || role === 'watcher' || ledCrewShifts.length > 0) && (
                    <button
                      type="button"
                      className={`history-tab-btn ${activeHistoryTab === 'led' ? 'active' : ''}`}
                      onClick={() => setActiveHistoryTab('led')}
                    >
                      <Users size={14} /> Team Leader Roll Calls ({ledCrewShifts.length})
                    </button>
                  )}
                  {(role === 'driver' || role === 'watcher' || driverShifts.length > 0 || watcherShifts.length > 0) && (
                    <button
                      type="button"
                      className={`history-tab-btn ${activeHistoryTab === 'shifts' ? 'active' : ''}`}
                      onClick={() => setActiveHistoryTab('shifts')}
                    >
                      <Clock size={14} /> My Duty Shifts (
                      {role === 'watcher' ? watcherShifts.length : driverShifts.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Summary metrics bar */}
              {summary.total > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                    gap: 10,
                    marginBottom: 18,
                  }}
                >
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'rgba(15,23,42,0.02)',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                      TOTAL LOGS
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{summary.total}</div>
                  </div>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid #86efac',
                      background: '#f0fdf4',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>PRESENT</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#166534' }}>
                      {summary.present}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid #fde047',
                      background: '#fefce8',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#854d0e' }}>LATE</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#854d0e' }}>
                      {summary.late}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid #7dd3fc',
                      background: '#f0f9ff',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#075985' }}>EXCUSED</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#075985' }}>
                      {summary.excused}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid #fca5a5',
                      background: '#fef2f2',
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b' }}>ABSENT</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#991b1b' }}>
                      {summary.absent}
                    </div>
                  </div>
                </div>
              )}

              {limitations.length > 0 && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    color: '#92400e',
                    fontSize: 12,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>{limitations.join(' ')}</div>
                </div>
              )}

              {historyLoading ? (
                <div
                  style={{
                    padding: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    color: 'var(--text-muted)',
                    fontSize: 13,
                  }}
                >
                  <Loader2 size={16} className="spin" /> Loading persisted attendance records...
                </div>
              ) : historyError ? (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 10,
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    fontSize: 13,
                  }}
                >
                  {historyError}
                </div>
              ) : (
                <>
                  {/* TAB A: Personal Attendance History */}
                  {activeHistoryTab === 'personal' && (
                    <div>
                      {personalRecords.length === 0 ? (
                        <div
                          style={{
                            padding: 24,
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontSize: 13,
                            border: '1px dashed var(--border)',
                            borderRadius: 12,
                          }}
                        >
                          No persisted personal attendance records found.
                        </div>
                      ) : (
                        personalRecords.map((rec) => (
                          <div key={rec.id} className="attendance-record-card">
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                flexWrap: 'wrap',
                                gap: 10,
                              }}
                            >
                              <div>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    flexWrap: 'wrap',
                                    marginBottom: 4,
                                  }}
                                >
                                  <span style={{ fontWeight: 800, fontSize: 14 }}>
                                    {rec.schedule_area || 'Scheduled Collection Deployment'}
                                  </span>
                                  {rec.team_name && (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 700,
                                        padding: '2px 8px',
                                        borderRadius: 6,
                                        background: 'rgba(15,23,42,0.06)',
                                      }}
                                    >
                                      {rec.team_name} ({rec.team_code})
                                    </span>
                                  )}
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      color: rec.shift_is_active ? '#16a34a' : 'var(--text-muted)',
                                    }}
                                  >
                                    {rec.shift_is_active ? 'Active Shift' : 'Concluded'}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: 'var(--text-muted)',
                                    display: 'flex',
                                    gap: 14,
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <Calendar size={12} /> Service Date: {rec.service_date || '—'}
                                  </span>
                                  <span>
                                    Submitted by: {rec.submitted_by_name || rec.checked_in_by_username || '—'}
                                    {rec.leadership_mode ? ` (${rec.leadership_mode} Team Leader)` : ''}
                                  </span>
                                  <span>Recorded: {formatDateTime(rec.recorded_at)}</span>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <AttendanceStatusPill status={rec.effective_status} />
                                {rec.is_corrected && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      color: '#0369a1',
                                      background: '#e0f2fe',
                                      padding: '2px 8px',
                                      borderRadius: 6,
                                    }}
                                  >
                                    Amended (Initial: {rec.initial_status})
                                  </span>
                                )}
                              </div>
                            </div>

                            {Array.isArray(rec.corrections) && rec.corrections.length > 0 && (
                              <div className="correction-trail">
                                <div style={{ fontWeight: 700, marginBottom: 4, color: '#0369a1' }}>
                                  Append-Only Correction Audit Trail ({rec.corrections.length})
                                </div>
                                {rec.corrections.map((c) => (
                                  <div
                                    key={c.id}
                                    style={{
                                      padding: '4px 0',
                                      borderBottom: '1px dashed rgba(15,23,42,0.08)',
                                    }}
                                  >
                                    <span style={{ fontWeight: 700 }}>
                                      #{c.correction_sequence}: {c.previous_status} to{' '}
                                      {c.corrected_status}
                                    </span>{' '}
                                    — {c.reason}{' '}
                                    <span style={{ color: 'var(--text-muted)' }}>
                                      (by {c.corrected_by_name || c.corrected_by_username || 'Admin'}{' '}
                                      on {formatDateTime(c.corrected_at)})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* TAB B: Team Leader Roll Calls (Watcher / Driver Team Leaders) */}
                  {activeHistoryTab === 'led' && (
                    <div>
                      {role === 'watcher' && (
                        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => navigate('/watcher/attendance')}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            <ExternalLink size={13} /> Open Watcher Crew Attendance Workspace
                          </button>
                        </div>
                      )}
                      {ledCrewShifts.length === 0 ? (
                        <div
                          style={{
                            padding: 24,
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontSize: 13,
                            border: '1px dashed var(--border)',
                            borderRadius: 12,
                          }}
                        >
                          No Team Leader attendance submissions found.
                        </div>
                      ) : (
                        ledCrewShifts.map((cs) => (
                          <div key={cs.id} className="attendance-record-card">
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 8,
                                marginBottom: 10,
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 800, fontSize: 14 }}>
                                  Crew Shift #{cs.id} — {cs.schedule_area || 'Deployment'}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  Service Date: {cs.service_date || '—'} | Team:{' '}
                                  {cs.team_name ? `${cs.team_name} (${cs.team_code})` : '—'} |
                                  Submitted: {formatDateTime(cs.attendance_submitted_at)}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '3px 10px',
                                  borderRadius: 999,
                                  background: cs.is_active ? '#dcfce7' : '#f1f5f9',
                                  color: cs.is_active ? '#166534' : '#475569',
                                }}
                              >
                                {cs.is_active ? 'Active' : 'Ended'}
                              </span>
                            </div>

                            {Array.isArray(cs.attendance_records) &&
                              cs.attendance_records.map((r) => (
                                <div
                                  key={r.id}
                                  style={{
                                    padding: '10px 12px',
                                    borderRadius: 8,
                                    border: '1px solid var(--border)',
                                    marginBottom: 8,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      flexWrap: 'wrap',
                                      gap: 8,
                                    }}
                                  >
                                    <div>
                                      <span style={{ fontWeight: 700, fontSize: 13 }}>
                                        {r.worker_name}
                                      </span>{' '}
                                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        ({r.employee_id})
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <AttendanceStatusPill status={r.effective_status} />
                                      {r.is_corrected && (
                                        <span style={{ fontSize: 11, color: '#0369a1', fontWeight: 700 }}>
                                          Initial: {r.initial_status}
                                        </span>
                                      )}
                                      {r.can_correct && (
                                        <button
                                          type="button"
                                          className="btn btn-outline btn-sm"
                                          style={{ padding: '3px 9px', fontSize: 11 }}
                                          onClick={() => {
                                            setCorrectingRecord(r)
                                            const nextDefault =
                                              ATTENDANCE_STATUSES.find(
                                                (s) => s !== r.effective_status
                                              ) || 'PRESENT'
                                            setCorrectionStatus(nextDefault)
                                            setCorrectionReason('')
                                          }}
                                        >
                                          Amend
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {Array.isArray(r.corrections) && r.corrections.length > 0 && (
                                    <div className="correction-trail">
                                      {r.corrections.map((c) => (
                                        <div key={c.id}>
                                          <strong>
                                            #{c.correction_sequence}: {c.previous_status} to{' '}
                                            {c.corrected_status}
                                          </strong>{' '}
                                          — {c.reason} ({c.corrected_by_name || c.corrected_by_username},{' '}
                                          {formatDateTime(c.corrected_at)})
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* TAB C: Duty Shifts (DriverShift / WatcherShift) */}
                  {activeHistoryTab === 'shifts' && (
                    <div>
                      {role === 'watcher' ? (
                        watcherShifts.length === 0 ? (
                          <div
                            style={{
                              padding: 24,
                              textAlign: 'center',
                              color: 'var(--text-muted)',
                              fontSize: 13,
                              border: '1px dashed var(--border)',
                              borderRadius: 12,
                            }}
                          >
                            No WatcherShift history found.
                          </div>
                        ) : (
                          watcherShifts.map((ws) => (
                            <div key={ws.id} className="attendance-record-card">
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                                    Watcher Shift #{ws.id} — {ws.schedule_area || 'Route'}
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    Date: {ws.shift_date || '—'} | Team:{' '}
                                    {ws.team_name ? `${ws.team_name} (${ws.team_code})` : '—'} |
                                    Started: {formatDateTime(ws.started_at)} | Ended:{' '}
                                    {formatDateTime(ws.ended_at)}
                                  </div>
                                </div>
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: '3px 10px',
                                    borderRadius: 999,
                                    background: ws.is_active ? '#dcfce7' : '#f1f5f9',
                                    color: ws.is_active ? '#166534' : '#475569',
                                  }}
                                >
                                  {ws.is_active ? 'Active' : ws.end_reason || 'Concluded'}
                                </span>
                              </div>
                            </div>
                          ))
                        )
                      ) : driverShifts.length === 0 ? (
                        <div
                          style={{
                            padding: 24,
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontSize: 13,
                            border: '1px dashed var(--border)',
                            borderRadius: 12,
                          }}
                        >
                          No DriverShift history found.
                        </div>
                      ) : (
                        driverShifts.map((ds) => (
                          <div key={ds.id} className="attendance-record-card">
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 8,
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 800, fontSize: 14 }}>
                                  Driver Shift #{ds.id} — {ds.schedule_area || 'Route'}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  Service Date: {ds.service_date || '—'} | Team:{' '}
                                  {ds.team_name ? `${ds.team_name} (${ds.team_code})` : '—'} | Truck:{' '}
                                  {ds.truck_plate || '—'} | Started: {formatDateTime(ds.started_at)} |
                                  Ended: {formatDateTime(ds.ended_at)}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '3px 10px',
                                  borderRadius: 999,
                                  background: ds.is_active ? '#dcfce7' : '#f1f5f9',
                                  color: ds.is_active ? '#166534' : '#475569',
                                }}
                              >
                                {ds.is_active ? `Active (${ds.status})` : ds.end_reason || 'Concluded'}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Inline Append-Only Attendance Correction Modal (Team Leader / Admin Only) */}
          {correctingRecord && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15,23,42,0.55)',
                zIndex: 9998,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
            >
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  padding: 24,
                  maxWidth: 460,
                  width: '100%',
                }}
              >
                <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 800 }}>
                  Append Attendance Correction
                </h3>
                <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                  Worker: <strong>{correctingRecord.worker_name}</strong> (
                  {correctingRecord.employee_id}) — Current Status:{' '}
                  <strong>{correctingRecord.effective_status}</strong>
                </p>
                <form onSubmit={handleCorrectionSubmit}>
                  <div style={{ marginBottom: 12 }}>
                    <label className="form-label">Corrected Status</label>
                    <select
                      className="form-input"
                      value={correctionStatus}
                      onChange={(e) => setCorrectionStatus(e.target.value)}
                    >
                      {ATTENDANCE_STATUSES.map((st) => (
                        <option key={st} value={st} disabled={st === correctingRecord.effective_status}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label className="form-label">Reason for Correction (Required)</label>
                    <textarea
                      className="form-input"
                      rows={3}
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                      placeholder="Explain why this attendance record is being amended..."
                      required
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setCorrectingRecord(null)}
                      disabled={submittingCorrection}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={submittingCorrection}
                    >
                      {submittingCorrection ? 'Saving...' : 'Save Correction'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 20,
            }}
          >
            {/* 5. Security Section */}
            <div className="profile-card ww-fade-in">
              <div className="section-title">Security</div>
              <form onSubmit={handleSavePassword}>
                <div style={{ marginBottom: 12 }}>
                  <label className="form-label">Current Password</label>
                  <input
                    className="form-input"
                    type="password"
                    value={pwd.current}
                    onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
                    required
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="form-label">New Password</label>
                  <input
                    className="form-input"
                    type="password"
                    value={pwd.new}
                    onChange={(e) => setPwd({ ...pwd, new: e.target.value })}
                    required
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label">Confirm New Password</label>
                  <input
                    className="form-input"
                    type="password"
                    value={pwd.confirm}
                    onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  Change Password
                </button>
              </form>
            </div>

            {/* 6. Quick Workspace & Admin Oversight Navigation */}
            <div className="profile-card ww-fade-in">
              <div className="section-title">
                <FileText size={18} /> Operational Workspaces
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
                Access your authorized operational modules and historical logs.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate('/admin/teams')}
                      className="btn btn-outline btn-sm"
                      style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                    >
                      <Users size={14} /> Sanitation Team & Shift Activity Oversight
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/admin/workers')}
                      className="btn btn-outline btn-sm"
                      style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                    >
                      <ShieldCheck size={14} /> Worker Pool & Attendance History
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/admin/activity-log')}
                      className="btn btn-outline btn-sm"
                      style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                    >
                      <History size={14} /> View All System Activity
                    </button>
                  </>
                )}
                {role === 'watcher' && (
                  <button
                    type="button"
                    onClick={() => navigate('/watcher/attendance')}
                    className="btn btn-outline btn-sm"
                    style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                  >
                    <Users size={14} /> Watcher Crew Attendance Workspace
                  </button>
                )}
                {role === 'driver' && (
                  <button
                    type="button"
                    onClick={() => navigate('/driver')}
                    className="btn btn-outline btn-sm"
                    style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                  >
                    <Truck size={14} /> Driver Mobile Route Workspace
                  </button>
                )}
                {role === 'citizen' && (
                  <button
                    type="button"
                    onClick={() => navigate('/citizen')}
                    className="btn btn-outline btn-sm"
                    style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                  >
                    <Calendar size={14} /> Return to Citizen Dashboard
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
