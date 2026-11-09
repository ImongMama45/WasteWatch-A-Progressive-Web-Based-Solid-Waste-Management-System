import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'
import { useEscalations } from '../../hooks/useEscalations'
import { useUsers } from '../../hooks/useUsers'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import { StatCardSkeleton, FeedCardSkeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  User,
  Truck,
  MapPin,
  Calendar,
  Layers,
  Search,
  ChevronDown,
  ChevronUp,
  Info,
  X,
  FileText,
  RefreshCw,
  Flame,
  Check,
  Ban,
  Activity,
  UserX,
  ExternalLink,
  ShieldOff,
  Gavel
} from 'lucide-react'

const PRIORITY = {
  high: {
    label: 'High',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.3)',
    bar: '#ef4444'
  },
  medium: {
    label: 'Medium',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.3)',
    bar: '#f59e0b'
  },
  low: {
    label: 'Low',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.3)',
    bar: '#10b981'
  },
}

const STATUS_META = {
  pending: {
    label: 'Pending',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.3)'
  },
  approved: {
    label: 'In Progress',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.3)'
  },
  rejected: {
    label: 'Rejected',
    color: '#64748b',
    bg: 'rgba(100, 116, 139, 0.12)',
    border: 'rgba(100, 116, 139, 0.3)'
  },
  resolved: {
    label: 'Resolved',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.3)'
  },
}

function getIssueIcon(type) {
  const t = (type || '').toLowerCase()
  if (t.includes('truck') || t.includes('route') || t.includes('driver')) {
    return <Truck size={18} />
  }
  if (t.includes('hazard') || t.includes('danger')) {
    return <ShieldAlert size={18} />
  }
  if (t.includes('overflow') || t.includes('dumping') || t.includes('waste')) {
    return <AlertTriangle size={18} />
  }
  return <AlertCircle size={18} />
}

function PriorityBadge({ p }) {
  const m = PRIORITY[p] || PRIORITY.low
  return (
    <span style={{
      background: m.bg,
      border: `1px solid ${m.border}`,
      color: m.color,
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color }} />
      {m.label}
    </span>
  )
}

function StatusBadge({ s }) {
  const m = STATUS_META[s] || STATUS_META.pending
  return (
    <span style={{
      background: m.bg,
      border: `1px solid ${m.border}`,
      color: m.color,
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase'
    }}>
      {m.label}
    </span>
  )
}

function AssignModal({ esc, onSave, onClose, staff, drivers, trucks, currentUser, onNavigateToUserManagement }) {
  const [assignee, setAssignee] = useState(esc.assignee || (currentUser ? currentUser.id : ''))
  const [deadline, setDeadline] = useState(esc.deadline || '')
  const [truckId, setTruckId] = useState(esc.truck || '')
  const [driverId, setDriverId] = useState(esc.driver || '')
  const [pointsDeducted, setPointsDeducted] = useState(esc.points_deducted || 0)
  const [disciplinaryAction, setDisciplinaryAction] = useState('warning')
  const [notes, setNotes] = useState(esc.notes || '')
  const [saving, setSaving] = useState(false)

  const selectedDriver = useMemo(() => {
    return drivers.find(d => String(d.id) === String(driverId))
  }, [drivers, driverId])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({
        assignee: assignee || null,
        deadline: deadline || null,
        truck: truckId || null,
        driver: driverId || null,
        points_deducted: Number(pointsDeducted) || 0,
        notes: notes.trim(),
        status: assignee ? 'approved' : esc.status
      })
    } finally {
      setSaving(false)
    }
  }

  const handleActionTypeChange = (actionType) => {
    setDisciplinaryAction(actionType)
    if (actionType === 'points' && (!pointsDeducted || pointsDeducted === 0)) {
      setPointsDeducted(10)
    } else if (actionType === 'suspension') {
      setPointsDeducted(20)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(5px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface, #ffffff)',
          borderRadius: 18,
          border: '1px solid var(--border, #e2e8f0)',
          padding: 24,
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 60px rgba(0,0,0,0.25)',
          position: 'relative'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Gavel size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: 'var(--text)' }}>
                Log Disciplinary Action
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                Identify the truck, penalize the responsible driver, or disable access.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface-2, #f1f5f9)',
              border: 'none',
              borderRadius: 8,
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-muted)'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Issue Overview Card */}
        <div style={{
          background: 'var(--surface-2, #f8fafc)',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 16,
          border: '1px solid var(--border, #e2e8f0)'
        }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>{esc.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <MapPin size={12} color="var(--accent, #10b981)" />
            <span>Brgy. {esc.barangay_name}</span>
            <span>·</span>
            <span>Origin: {esc.raised_by || 'Barangay Official'}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Section: Disciplined Entity */}
          <div style={{
            background: 'rgba(245, 158, 11, 0.05)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: 12,
            padding: '12px 14px',
            marginBottom: 16
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Truck size={14} />
              <span>Disciplined Vehicle &amp; Driver Identification</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                  Truck Involved
                </label>
                <select
                  value={truckId}
                  onChange={e => setTruckId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #cbd5e1)',
                    background: 'var(--surface, #ffffff)',
                    color: 'var(--text)',
                    fontSize: 12,
                    fontWeight: 600,
                    outline: 'none'
                  }}
                >
                  <option value="">— Select Truck —</option>
                  {trucks.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.plate_number} {t.model ? `(${t.model})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                  Responsible Driver
                </label>
                <select
                  value={driverId}
                  onChange={e => setDriverId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #cbd5e1)',
                    background: 'var(--surface, #ffffff)',
                    color: 'var(--text)',
                    fontSize: 12,
                    fontWeight: 600,
                    outline: 'none'
                  }}
                >
                  <option value="">— Select Driver —</option>
                  {drivers.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} ({d.username || d.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Direct Account Disable Action Banner */}
            {selectedDriver && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: 8,
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                marginTop: 6
              }}>
                <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>
                  Need to disable <strong>{selectedDriver.full_name}</strong>'s login immediately?
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToUserManagement(selectedDriver)}
                  style={{
                    background: '#ef4444',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <UserX size={12} />
                  Disable Account
                </button>
              </div>
            )}
          </div>

          {/* Action Sanction Type & Points */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                Disciplinary Sanction
              </label>
              <select
                value={disciplinaryAction}
                onChange={e => handleActionTypeChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border, #cbd5e1)',
                  background: 'var(--surface, #ffffff)',
                  color: 'var(--text)',
                  fontSize: 12,
                  fontWeight: 600,
                  outline: 'none'
                }}
              >
                <option value="warning">Written Warning &amp; Counseling</option>
                <option value="points">Demerit Points Penalty</option>
                <option value="suspension">Temporary Driver Suspension</option>
                <option value="deactivation">Account Deactivation Required</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                Points Penalty
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={pointsDeducted}
                onChange={e => setPointsDeducted(e.target.value)}
                placeholder="0"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border, #cbd5e1)',
                  background: 'var(--surface, #ffffff)',
                  color: 'var(--text)',
                  fontSize: 12,
                  fontWeight: 700,
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* Reviewing Admin & Deadline */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                Reviewing Administrator
              </label>
              <select
                value={assignee}
                onChange={e => setAssignee(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border, #cbd5e1)',
                  background: 'var(--surface, #ffffff)',
                  color: 'var(--text)',
                  fontSize: 12,
                  fontWeight: 600,
                  outline: 'none'
                }}
              >
                <option value="">— Select Admin —</option>
                {staff.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                Resolution Deadline
              </label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border, #cbd5e1)',
                  background: 'var(--surface, #ffffff)',
                  color: 'var(--text)',
                  fontSize: 12,
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
              Disciplinary Action Notes &amp; Instructions
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Record details of sanctions issued, required driver retraining, or coordination with barangay…"
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #cbd5e1)',
                background: 'var(--surface, #ffffff)',
                color: 'var(--text)',
                fontSize: 12,
                resize: 'vertical',
                outline: 'none',
                lineHeight: 1.5
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid var(--border, #cbd5e1)',
                background: 'var(--surface, #ffffff)',
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 10,
                border: 'none',
                background: 'var(--accent, #10b981)',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 800,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.75 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)'
              }}
            >
              <Check size={16} />
              {saving ? 'Saving...' : 'Save Disciplinary Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const USER_LOOKUP_PARAMS = { page_size: 100 }

export default function EscalationManagement() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { items, pagination, loading, refresh, saveEscalation, resolveEscalation } = useEscalations()
  const { users } = useUsers(USER_LOOKUP_PARAMS)
  const [page, setPage] = useState(1)

  const [trucks, setTrucks] = useState([])
  useEffect(() => {
    api.get('/api/driver/trucks/')
      .then(res => setTrucks(Array.isArray(res.data) ? res.data : (res.data?.results || [])))
      .catch(() => setTrucks([]))
  }, [])

  const staff = useMemo(() => users.filter(u => u.role === 'admin'), [users])
  const drivers = useMemo(() => users.filter(u => u.role === 'driver'), [users])

  const [priorityFilter, setPriorityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState(location.state?.truckLabel || location.state?.driver || '')
  const [sortBy, setSortBy] = useState('priority')
  const [expanded, setExpanded] = useState(null)
  const [assignModal, setAssignModal] = useState(null)
  const [toast, setToast] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const focusDoneRef = useRef(false)

  useEffect(() => {
    const focusId = searchParams.get('focus')
    if (!focusId || loading || focusDoneRef.current) return
    focusDoneRef.current = true
    setSearchParams({}, { replace: true })
    const target = items.find(e => String(e.id) === focusId)
    if (!target) { showToast('Escalation not found or already closed.'); return }
    setPriorityFilter('all')
    setStatusFilter('all')
    setSearch('')
    setExpanded(target.id)
    setTimeout(() => document.getElementById(`esc-${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
  }, [searchParams, items, loading, setSearchParams])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function handleResolve(id) {
    const res = await resolveEscalation(id)
    if (res.ok) {
      setExpanded(null)
      showToast('Escalation marked as resolved.')
    } else {
      showToast('Failed to resolve escalation. Please try again.')
    }
  }

  async function handleSaveAssign(id, data) {
    const res = await saveEscalation(id, data)
    if (res.ok) {
      setAssignModal(null)
      showToast('Disciplinary record updated successfully.')
    } else {
      showToast('Failed to save record.')
    }
  }

  const navigateToUserManagement = (driverObjOrName, driverId) => {
    const name = typeof driverObjOrName === 'string' ? driverObjOrName : driverObjOrName?.full_name || ''
    const id = typeof driverObjOrName === 'object' ? driverObjOrName?.id : driverId

    navigate(`/admin/users?search=${encodeURIComponent(name || '')}&focus=${id || ''}`, {
      state: {
        search: name,
        focusUserId: id,
        role: 'driver',
        action: 'disable'
      }
    })
  }

  const summary = pagination?.summary
  const counts = useMemo(() => ({
    all: summary?.total ?? items.length,
    pending: summary?.pending ?? items.filter(e => e.status === 'pending').length,
    approved: summary?.approved ?? items.filter(e => e.status === 'approved').length,
    resolved: summary?.resolved ?? items.filter(e => e.status === 'resolved').length,
    rejected: summary?.rejected ?? items.filter(e => e.status === 'rejected').length,
    high: items.filter(e => e.priority === 'high').length,
    medium: items.filter(e => e.priority === 'medium').length,
    low: items.filter(e => e.priority === 'low').length,
  }), [items, summary])

  useEffect(() => { setPage(1) }, [statusFilter, priorityFilter, search])

  useEffect(() => {
    refresh({
      page,
      page_size: 10,
      status: statusFilter === 'all' ? '' : statusFilter,
      priority: priorityFilter === 'all' ? '' : priorityFilter,
      search: search.trim(),
    })
  }, [page, statusFilter, priorityFilter, search, refresh])

  // Filtering is performed by the backend; only ordering within the page happens here.
  const filtered = items

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === 'priority') {
        const order = { high: 0, medium: 1, low: 2 }
        const so = { pending: 0, approved: 1, rejected: 2, resolved: 3 }
        return (so[a.status] - so[b.status]) || (order[a.priority] - order[b.priority])
      }
      if (sortBy === 'newest') {
        return (b.id || 0) - (a.id || 0)
      }
      if (sortBy === 'oldest') {
        return (a.id || 0) - (b.id || 0)
      }
      return 0
    })
  }, [filtered, sortBy])

  const criticalOpenCount = useMemo(() => {
    return items.filter(e => e.priority === 'high' && !['resolved', 'rejected'].includes(e.status)).length
  }, [items])

  return (
    <DashboardLayout>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .meta-page-canvas {
          background: #f0f2f5;
          min-height: calc(100vh - 60px);
          padding: 24px 32px 60px;
        }
        .meta-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .meta-stat-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 16px 20px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .meta-stat-card:hover {
          border-color: #ccd0d5;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
        }
        .meta-esc-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          margin-bottom: 12px;
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .meta-esc-card:hover {
          border-color: #ccd0d5;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
        }
        .meta-btn-secondary {
          background: #ffffff;
          border: 1px solid #ccd0d5;
          color: #050505;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
        }
        .meta-btn-secondary:hover {
          background: #f0f2f5;
          border-color: #bec3c9;
        }
        .meta-btn-primary {
          background: #16a34a;
          border: 1px solid #16a34a;
          color: #ffffff;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 16px;
        }
        .meta-btn-primary:hover {
          background: #15803d;
          border-color: #15803d;
        }
        .meta-tab-btn {
          padding: 7px 13px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          background: transparent;
          color: #65676b;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: inherit;
        }
        .meta-tab-btn:hover {
          background: #f0f2f5;
          color: #050505;
        }
        .meta-tab-btn.active {
          background: #ffffff;
          color: #050505;
          border: 1px solid #ccd0d5;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }
        .meta-select {
          height: 36px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid #ccd0d5;
          background: #ffffff;
          color: #050505;
          font-size: 13px;
          font-weight: 500;
          outline: none;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .meta-select:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
        .meta-input {
          height: 36px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid #ccd0d5;
          background: #ffffff;
          color: #050505;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .meta-input:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
      `}</style>

      {toast && (
        <div style={{
          position: 'fixed',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1c1e21',
          color: '#ffffff',
          padding: '10px 18px',
          borderRadius: 6,
          zIndex: 99999,
          fontSize: 13,
          fontWeight: 600,
          border: '1px solid #333942',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <CheckCircle2 size={16} color="#16a34a" />
          <span>{toast}</span>
        </div>
      )}

      {assignModal && (
        <AssignModal
          esc={assignModal}
          staff={staff}
          drivers={drivers}
          trucks={trucks}
          currentUser={user}
          onSave={data => handleSaveAssign(assignModal.id, data)}
          onClose={() => setAssignModal(null)}
          onNavigateToUserManagement={driver => navigateToUserManagement(driver)}
        />
      )}

      <div className="meta-page-canvas">
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Page Header (Meta Business Suite Style) ── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 16
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{
                  fontSize: 22,
                  fontWeight: 700,
                  margin: 0,
                  color: '#050505',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.2
                }}>
                  Escalation Management
                </h1>
                {counts.pending > 0 && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#fee2e2',
                    color: '#991b1b',
                    border: '1px solid #fecaca',
                    padding: '2px 8px',
                    borderRadius: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                    {counts.pending} PENDING
                  </span>
                )}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#65676b' }}>
                Barangay-escalated issues and driver infractions requiring municipal administrator review.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => refresh()}
                disabled={loading}
                className="meta-btn-secondary"
              >
                <RefreshCw size={14} className={loading ? 'icon-spin' : ''} color="#65676b" />
                <span>{loading ? 'Refreshing...' : 'Refresh Data'}</span>
              </button>
            </div>
          </div>

          {/* ── KPI Stat Strip (Meta Business Suite Style) ── */}
          {loading && items.length === 0 ? (
            <StatCardSkeleton count={4} style={{ marginBottom: 18 }} />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 14,
              marginBottom: 18
            }}>
              {[
                {
                  label: 'Total Escalations',
                  value: counts.all,
                  subtext: 'All recorded escalations',
                  icon: Layers
                },
                {
                  label: 'Pending Action',
                  value: counts.pending,
                  subtext: 'Awaiting administrator review',
                  icon: Clock,
                  highlight: counts.pending > 0 ? '#b91c1c' : undefined
                },
                {
                  label: 'In Progress',
                  value: counts.approved,
                  subtext: 'Assigned / disciplinary log open',
                  icon: Activity,
                  highlight: counts.approved > 0 ? '#b45309' : undefined
                },
                {
                  label: 'Resolved & Closed',
                  value: counts.resolved,
                  subtext: 'Successfully addressed',
                  icon: CheckCircle2,
                  highlight: '#166534'
                },
              ].map(s => {
                const IconComp = s.icon
                return (
                  <div key={s.label} className="meta-stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {s.label}
                      </span>
                      <IconComp size={16} color="#8a8d91" />
                    </div>
                    <div style={{
                      fontSize: 26,
                      fontWeight: 700,
                      color: s.highlight || '#050505',
                      lineHeight: 1.15,
                      marginBottom: 4
                    }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 12, color: '#65676b' }}>
                      {s.subtext}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Urgent Alert Banner (High-Priority Infractions) ── */}
          {criticalOpenCount > 0 && (
            <div style={{
              background: '#fee2e2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              padding: '12px 16px',
              marginBottom: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 12
            }}>
              <Flame size={18} color="#991b1b" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', marginBottom: 2 }}>
                  {criticalOpenCount} high-priority driver infraction(s) require immediate municipal intervention
                </div>
                <div style={{ fontSize: 12, color: '#7f1d1d' }}>
                  Review driver details, log disciplinary penalties, or coordinate with barangay desk officers to lift or enforce suspensions.
                </div>
              </div>
            </div>
          )}

          {/* ── Toolbar: Filters & Search ── */}
          <div className="meta-card" style={{
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center'
          }}>
            {/* Priority Tabs */}
            <div style={{ display: 'flex', gap: 4, background: '#f0f2f5', borderRadius: 6, padding: 3, flexWrap: 'wrap' }}>
              {['all', 'high', 'medium', 'low'].map(f => {
                const active = priorityFilter === f
                const pMeta = PRIORITY[f]
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setPriorityFilter(f)}
                    className={`meta-tab-btn ${active ? 'active' : ''}`}
                  >
                    {f !== 'all' && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: pMeta.color }} />
                    )}
                    <span>{f === 'all' ? `All (${counts.all})` : `${pMeta.label} (${counts[f]})`}</span>
                  </button>
                )
              })}
            </div>

            {/* Status Select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Status:
              </span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="meta-select"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">In Progress</option>
                <option value="rejected">Rejected</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>

            {/* Sort Select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Sort:
              </span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="meta-select"
              >
                <option value="priority">Priority Urgency</option>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            {/* Search Box */}
            <div style={{ position: 'relative', width: 260, maxWidth: '100%', marginLeft: 'auto' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#8a8d91' }} />
              <input
                className="meta-input"
                placeholder="Search title, driver, brgy…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: 32,
                  paddingRight: 28
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#8a8d91',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* ── Escalations Feed ── */}
          {loading && items.length === 0 ? (
            <FeedCardSkeleton count={4} compact />
          ) : sorted.length === 0 ? (
            <div className="meta-card" style={{
              textAlign: 'center',
              padding: '50px 20px'
            }}>
              <CheckCircle2 size={32} color="#16a34a" style={{ margin: '0 auto 10px' }} />
              <div style={{ fontWeight: 700, fontSize: 15, color: '#050505', marginBottom: 4 }}>
                No Escalations Found
              </div>
              <div style={{ fontSize: 12, color: '#65676b', maxWidth: 300, margin: '0 auto' }}>
                No issues match your current filters. Clear search or check back later.
              </div>
            </div>
          ) : (
            <div className="ww-stagger">
            {sorted.map(e => {
              const p = PRIORITY[e.priority] || PRIORITY.low
              const isOpen = expanded === e.id
              const isTerminal = ['resolved', 'rejected'].includes(e.status)

              return (
                <div
                  id={`esc-${e.id}`}
                  key={e.id}
                  className="meta-esc-card"
                  style={{
                    borderLeft: `4px solid ${p.color}`,
                    opacity: isTerminal ? 0.75 : 1,
                  }}
                >
                  {/* Header Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      cursor: 'pointer',
                      background: isOpen ? '#f7f8fa' : 'transparent'
                    }}
                    onClick={() => setExpanded(prev => prev === e.id ? null : e.id)}
                  >
                    {/* Icon box */}
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      flexShrink: 0,
                      background: p.bg,
                      color: p.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: `1px solid ${p.border}`
                    }}>
                      {getIssueIcon(e.issue_type || e.type || e.title)}
                    </div>

                    {/* Main Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: '#050505' }}>
                          {e.title}
                        </span>
                        <PriorityBadge p={e.priority} />
                        <StatusBadge s={e.status} />
                      </div>

                      <div style={{ fontSize: 12, color: '#65676b', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <FileText size={12} color="#8a8d91" />
                          <span>{e.issue_type || e.type || 'Escalation'}</span>
                        </span>

                        {e.driver_name && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <User size={12} color="#8a8d91" />
                            <span>Driver: <strong style={{ color: '#050505' }}>{e.driver_name}</strong></span>
                            {e.points_deducted ? (
                              <span style={{ background: '#fee2e2', color: '#991b1b', padding: '1px 5px', borderRadius: 4, fontWeight: 700, fontSize: 10 }}>
                                -{e.points_deducted} pts
                              </span>
                            ) : null}
                          </span>
                        )}

                        {e.truck_plate && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Truck size={12} color="#8a8d91" />
                            <span>Truck {e.truck_plate} {e.truck_model ? `(${e.truck_model})` : ''}</span>
                          </span>
                        )}

                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={12} color="#16a34a" />
                          <span>Brgy. {e.barangay_name}</span>
                        </span>
                      </div>
                    </div>

                    {/* Right metadata and expansion chevron */}
                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                      <div style={{ fontSize: 11, color: '#65676b', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={11} />
                        <span>{e.ago || 'recently'}</span>
                      </div>
                      {e.deadline && (
                        <div style={{ fontSize: 10, color: '#92400e', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Calendar size={11} />
                          <span>Due: {e.deadline}</span>
                        </div>
                      )}
                      <div style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        background: '#f0f2f5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#65676b',
                        marginTop: 2
                      }}>
                        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details Section */}
                  {isOpen && (
                    <div
                      style={{
                        borderTop: '1px solid #e4e6eb',
                        padding: '16px 20px',
                        background: '#ffffff',
                        animation: 'slideDown 0.15s ease-out'
                      }}
                      onClick={ev => ev.stopPropagation()}
                    >
                      {/* Originator Banner */}
                      <div style={{
                        background: '#f7f8fa',
                        border: '1px solid #e4e6eb',
                        borderRadius: 6,
                        padding: '10px 14px',
                        marginBottom: 14,
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: '#050505'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <User size={13} color="#65676b" />
                          <strong style={{ color: '#050505' }}>
                            Escalated by {e.raised_by || e.raised_by_name || 'Barangay Official'}
                          </strong>
                          <span style={{ color: '#65676b' }}>
                            in Barangay {e.barangay_name}
                          </span>
                        </div>
                        {e.notes && (
                          <div style={{ marginTop: 4, color: '#1c1e21', fontStyle: 'italic', background: '#ffffff', border: '1px solid #e4e6eb', padding: '6px 10px', borderRadius: 4 }}>
                            "{e.notes}"
                          </div>
                        )}
                      </div>

                      {/* Disciplined Vehicle & Driver Card */}
                      <div style={{
                        background: '#f7f8fa',
                        border: '1px solid #e4e6eb',
                        borderRadius: 6,
                        padding: '12px 14px',
                        marginBottom: 14
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Truck size={15} color="#b45309" />
                            <div>
                              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#65676b' }}>
                                Disciplined Entity Details
                              </span>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#050505' }}>
                                {e.truck_plate ? `Truck: ${e.truck_plate} ${e.truck_model ? `(${e.truck_model})` : ''}` : 'No Specific Truck Linked'}
                              </div>
                            </div>
                          </div>

                          {/* Driver link / Disable Account Action */}
                          <button
                            type="button"
                            onClick={() => navigateToUserManagement(e.driver_name, e.driver)}
                            className="meta-btn-secondary"
                            style={{
                              padding: '5px 10px',
                              fontSize: 11,
                              color: '#991b1b',
                              borderColor: '#fecaca',
                              background: '#fee2e2'
                            }}
                          >
                            <UserX size={13} />
                            <span>{e.driver_name ? `Disable Driver (${e.driver_name})` : 'Manage in User Management'}</span>
                            <ExternalLink size={11} />
                          </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 12 }}>
                          <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: 4, border: '1px solid #e4e6eb' }}>
                            <span style={{ color: '#65676b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>
                              Responsible Driver
                            </span>
                            <strong style={{ color: e.driver_name ? '#050505' : '#8a8d91' }}>
                              {e.driver_name || 'Unassigned / Needs Driver Identification'}
                            </strong>
                          </div>

                          <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: 4, border: '1px solid #e4e6eb' }}>
                            <span style={{ color: '#65676b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>
                              Demerit Points Deduction
                            </span>
                            <strong style={{ color: e.points_deducted ? '#991b1b' : '#65676b' }}>
                              {e.points_deducted ? `-${e.points_deducted} demerit points` : '0 points penalized'}
                            </strong>
                          </div>
                        </div>
                      </div>

                      {/* Reviewing Admin & Deadline Cards */}
                      {e.assignee && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
                          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 6, padding: '10px 12px' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
                              Reviewing Administrator
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#050505', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <User size={13} color="#16a34a" />
                              {e.assignee_name || 'Assigned Admin'}
                            </div>
                          </div>

                          {e.deadline && (
                            <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 6, padding: '10px 12px' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
                                Resolution Target
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#050505', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Calendar size={13} color="#f59e0b" />
                                {e.deadline}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Driver Suspension Advisory Notice */}
                      {e.driver_name && !isTerminal && (
                        <div style={{
                          padding: '10px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          background: '#f0f2f5',
                          border: '1px solid #e4e6eb',
                          color: '#050505',
                          marginBottom: 14
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 2 }}>
                            <Info size={14} color="#65676b" />
                            <span>Suspension Auto-Lift Status</span>
                          </div>
                          <div style={{ color: '#65676b', lineHeight: 1.4 }}>
                            {(() => {
                              const openOther = e.driver_open_escalations || 0
                              return openOther === 0
                                ? "This is their only open escalation. Resolving this will automatically restore the driver's active dispatch status."
                                : `This driver has ${openOther} other active infraction(s). Resolving this issue will not lift their suspension until all open escalations are cleared.`
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      {!isTerminal && (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => setAssignModal(e)}
                            className="meta-btn-secondary"
                            style={{ flex: 1, minWidth: 160, justifyContent: 'center' }}
                          >
                            <FileText size={14} color="#65676b" />
                            <span>{e.assignee ? 'Update Disciplinary Record' : 'Log Disciplinary Action'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleResolve(e.id)}
                            className="meta-btn-primary"
                            style={{ flex: 1, minWidth: 160, justifyContent: 'center' }}
                          >
                            <CheckCircle2 size={14} />
                            <span>Mark Resolved</span>
                          </button>
                        </div>
                      )}

                      {isTerminal && (
                        <div style={{
                          background: e.status === 'rejected' ? '#f0f2f5' : '#e7f3ed',
                          border: `1px solid ${e.status === 'rejected' ? '#e4e6eb' : '#bbf7d0'}`,
                          borderRadius: 6,
                          padding: '10px 14px',
                          fontSize: 12,
                          color: e.status === 'rejected' ? '#65676b' : '#166534',
                          fontWeight: 600,
                          textAlign: 'center',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                        }}>
                          {e.status === 'rejected' ? <Ban size={15} /> : <CheckCircle2 size={15} />}
                          <span>
                            {e.status === 'rejected' ? 'This escalation was rejected by administration.' : 'This escalation has been officially resolved and closed.'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          )}

          <Pagination
            currentPage={page}
            totalPages={pagination?.total_pages || 1}
            totalCount={pagination?.count || items.length}
            pageSize={10}
            onPageChange={setPage}
            loading={loading}
          />
        </div>
      </div>
    </DashboardLayout>
  )
}

