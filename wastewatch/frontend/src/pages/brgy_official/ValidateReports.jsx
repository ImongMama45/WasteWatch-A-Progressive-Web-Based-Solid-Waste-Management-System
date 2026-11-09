/**
 * ValidateReports.jsx — Report Validation & Moderation Suite
 * -------------------------------------------------------------
 * Route: /admin/validate-reports & /brgy/validate-reports
 * Modeled after: EscalationManagement.jsx (Meta Business Suite style)
 * Accessible to: Barangay Officials & System Administrators
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import { useLeaflet } from '../../hooks/useLeaflet'
import { StatCardSkeleton, FeedCardSkeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Clock,
  MapPin,
  User,
  Search,
  X,
  RotateCcw,
  FileText,
  Flame,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
  ShieldCheck,
  Camera,
  Archive,
  RefreshCw,
  Truck,
  Trash2,
  Maximize2,
  ExternalLink,
  Ban,
  Activity,
  Calendar,
  Info
} from 'lucide-react'

const SEVERITY_CONFIG = {
  high: {
    label: 'High',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.3)',
    desc: 'Urgent / hazardous dump or road blockage',
    bar: '#ef4444'
  },
  medium: {
    label: 'Medium',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.3)',
    desc: 'Standard overflow, needs attention',
    bar: '#f59e0b'
  },
  low: {
    label: 'Low',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.3)',
    desc: 'Minor accumulation, non-hazardous',
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
    label: 'Approved',
    color: '#16a34a',
    bg: 'rgba(22, 163, 74, 0.12)',
    border: 'rgba(22, 163, 74, 0.3)'
  },
  rejected: {
    label: 'Rejected',
    color: '#64748b',
    bg: 'rgba(100, 116, 139, 0.12)',
    border: 'rgba(100, 116, 139, 0.3)'
  },
  resolved: {
    label: 'Resolved',
    color: '#2563eb',
    bg: 'rgba(37, 99, 235, 0.12)',
    border: 'rgba(37, 99, 235, 0.3)'
  },
}

const ISSUE_TYPE_META = {
  overflow: { label: 'Overflow', icon: Trash2, color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)' },
  missed: { label: 'Missed Pickup', icon: Truck, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)' },
  illegal_dumping: { label: 'Illegal Dumping', icon: AlertTriangle, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' },
}

const REJECT_PRESETS = [
  'Duplicate report',
  'Not municipal solid waste',
  'Insufficient photo or location details',
  'Already cleared / resolved',
  'False or invalid reporting'
]

function getIssueIcon(type) {
  const t = (type || '').toLowerCase()
  if (t.includes('missed') || t.includes('pickup') || t.includes('truck')) {
    return <Truck size={17} />
  }
  if (t.includes('illegal') || t.includes('dump') || t.includes('hazard')) {
    return <AlertTriangle size={17} />
  }
  if (t.includes('overflow') || t.includes('bin') || t.includes('trash')) {
    return <Trash2 size={17} />
  }
  return <FileText size={17} />
}

function SeverityBadge({ s }) {
  const m = SEVERITY_CONFIG[s] || SEVERITY_CONFIG.medium
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

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'recently'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`
  return date.toLocaleDateString()
}

export default function ValidateReports() {
  const { user, barangays } = useAuth()
  const navigate = useNavigate()

  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [summaryCounts, setSummaryCounts] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })

  // Filters
  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [barangayFilter, setBarangayFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('priority')
  const [search, setSearch] = useState('')

  // Card expansion & actions
  const [expanded, setExpanded] = useState(null)
  const [localSeverityMap, setLocalSeverityMap] = useState({})
  const [rejectModal, setRejectModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [toast, setToast] = useState(null)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [lightboxImg, setLightboxImg] = useState(null)

  // Mini-map Leaflet hook
  const { mapReady } = useLeaflet()
  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)

  const isAdmin = user?.role === 'admin'
  const isOfficial = user?.role === 'brgy_official'

  useEffect(() => {
    fetchReports()
  }, [page, statusFilter, severityFilter, typeFilter, barangayFilter, search])

  // Reset pagination on filter change
  useEffect(() => {
    setPage(1)
  }, [statusFilter, severityFilter, typeFilter, barangayFilter, search])

  // Mini-map rendering inside expanded card
  useEffect(() => {
    if (!mapReady || !expanded || !mapContainerRef.current) return

    const report = reports.find(r => r.id === expanded)
    if (!report) return

    const lat = Number(report.latitude) || 13.9373
    const lng = Number(report.longitude) || 121.617
    const currentSev = localSeverityMap[report.id] || report.severity || 'medium'
    const sevColor = SEVERITY_CONFIG[currentSev]?.color || '#f59e0b'

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove()
      mapInstanceRef.current = null
    }

    try {
      const map = window.L.map(mapContainerRef.current, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: false,
      })

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
      }).addTo(map)

      window.L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: sevColor,
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(map)

      mapInstanceRef.current = map

      const t = setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize()
        }
      }, 250)

      return () => {
        clearTimeout(t)
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove()
          mapInstanceRef.current = null
        }
      }
    } catch (err) {
      console.warn('Map initialization:', err)
    }
  }, [expanded, mapReady, reports, localSeverityMap])

  async function fetchReports() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('page', page)
      params.append('page_size', '10')

      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }
      if (severityFilter !== 'all') {
        params.append('severity', severityFilter)
      }
      if (typeFilter !== 'all') {
        params.append('issue_type', typeFilter)
      }
      if (isAdmin && barangayFilter) {
        params.append('barangay', barangayFilter)
      }
      if (search.trim()) {
        params.append('search', search.trim())
      }

      const res = await api.get(`/api/watcher/reports/?${params.toString()}`)
      if (res.data?.results) {
        setReports(res.data.results)
        setTotalCount(res.data.count || 0)
        setTotalPages(res.data.total_pages || 1)
        if (res.data.summary) {
          setSummaryCounts({
            total: res.data.summary.total || 0,
            pending: res.data.summary.pending || 0,
            approved: res.data.summary.approved || 0,
            rejected: res.data.summary.rejected || 0,
          })
        }
      } else if (Array.isArray(res.data)) {
        setReports(res.data)
        setTotalCount(res.data.length)
        setTotalPages(Math.ceil(res.data.length / 10) || 1)
      }
    } catch (err) {
      console.error('Failed to fetch reports:', err)
      showToast('Failed to load reports', 'error')
    } finally {
      setLoading(false)
    }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const counts = useMemo(() => ({
    all: summaryCounts.total || totalCount,
    pending: summaryCounts.pending,
    approved: summaryCounts.approved,
    rejected: summaryCounts.rejected,
    high: reports.filter(r => (localSeverityMap[r.id] || r.severity) === 'high').length,
    medium: reports.filter(r => (localSeverityMap[r.id] || r.severity) === 'medium').length,
    low: reports.filter(r => (localSeverityMap[r.id] || r.severity) === 'low').length,
  }), [summaryCounts, totalCount, reports, localSeverityMap])

  const highPendingCount = useMemo(() => {
    return reports.filter(r => r.status === 'pending' && (localSeverityMap[r.id] || r.severity) === 'high').length
  }, [reports, localSeverityMap])

  // Sorting
  const sortedReports = useMemo(() => {
    return [...reports].sort((a, b) => {
      if (sortBy === 'priority') {
        const sevOrder = { high: 0, medium: 1, low: 2 }
        const statusOrder = { pending: 0, approved: 1, rejected: 2, resolved: 3 }
        const aSev = localSeverityMap[a.id] || a.severity || 'medium'
        const bSev = localSeverityMap[b.id] || b.severity || 'medium'
        return (statusOrder[a.status] - statusOrder[b.status]) || (sevOrder[aSev] - sevOrder[bSev])
      }
      if (sortBy === 'newest') {
        return (b.id || 0) - (a.id || 0)
      }
      if (sortBy === 'oldest') {
        return (a.id || 0) - (b.id || 0)
      }
      return 0
    })
  }, [reports, sortBy, localSeverityMap])

  const handleSelectSeverity = async (reportId, newSeverity) => {
    setLocalSeverityMap(prev => ({ ...prev, [reportId]: newSeverity }))
    try {
      await api.post(`/api/watcher/reports/${reportId}/set_severity/`, { severity: newSeverity })
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, severity: newSeverity } : r))
      showToast(`Severity updated to ${newSeverity.toUpperCase()}`)
    } catch (err) {
      console.warn('Failed to update severity on server:', err)
    }
  }

  const handleApprove = async (reportId, explicitSeverity) => {
    if (isActionLoading) return
    setIsActionLoading(true)
    const severityToSave = explicitSeverity || localSeverityMap[reportId] || 'medium'

    try {
      // 1. Assign severity
      try {
        await api.post(`/api/watcher/reports/${reportId}/set_severity/`, { severity: severityToSave })
      } catch (sevErr) {
        console.warn('Set severity warning before approve:', sevErr)
      }

      // 2. Approve report
      const res = await api.post(`/api/watcher/reports/${reportId}/approve/`)
      if (res.data?.success || res.status === 200) {
        showToast('Report approved and published to live map!')
        setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'approved', severity: severityToSave } : r))
        setSummaryCounts(s => ({
          ...s,
          pending: Math.max(0, s.pending - 1),
          approved: s.approved + 1
        }))
        if (expanded === reportId) setExpanded(null)
      } else {
        showToast('Failed to approve report', 'error')
      }
    } catch (err) {
      console.error('Approve failed:', err)
      const msg = err.response?.data?.error || err.response?.data?.detail || 'Approval failed'
      showToast(msg, 'error')
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleReject = async (reportId, reason) => {
    if (isActionLoading) return
    setIsActionLoading(true)
    const finalReason = (typeof reason === 'string' && reason.trim()) ? reason.trim() : 'Not suitable for live map'
    try {
      const res = await api.post(`/api/watcher/reports/${reportId}/reject/`, {
        rejection_reason: finalReason
      })
      if (res.data?.success || res.status === 200) {
        showToast('Report rejected.')
        setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'rejected', rejection_reason: finalReason } : r))
        setSummaryCounts(s => ({
          ...s,
          pending: Math.max(0, s.pending - 1),
          rejected: s.rejected + 1
        }))
        setRejectModal(null)
        setRejectReason('')
        if (expanded === reportId) setExpanded(null)
      } else {
        showToast('Failed to reject report', 'error')
      }
    } catch (err) {
      console.error('Reject failed:', err)
      const msg =
        err.response?.data?.error ||
        err.response?.data?.rejection_reason ||
        err.response?.data?.detail ||
        'Failed to reject report'
      showToast(msg, 'error')
    } finally {
      setIsActionLoading(false)
    }
  }

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
        .meta-sev-card {
          flex: 1;
          min-width: 140px;
          padding: 10px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1.5px solid #e4e6eb;
          background: #ffffff;
          text-align: left;
        }
        .meta-sev-card:hover {
          border-color: #ccd0d5;
          transform: translateY(-1px);
        }
        @media (max-width: 768px) {
          .meta-page-canvas {
            padding: 16px 12px 60px;
          }
        }
      `}</style>

      {/* ── Toast Notification ── */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: toast.type === 'error' ? '#7f1d1d' : '#1c1e21',
          color: '#ffffff',
          padding: '10px 18px',
          borderRadius: 6,
          zIndex: 99999,
          fontSize: 13,
          fontWeight: 600,
          border: `1px solid ${toast.type === 'error' ? '#991b1b' : '#333942'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          {toast.type === 'error' ? (
            <AlertTriangle size={16} color="#fca5a5" />
          ) : (
            <CheckCircle2 size={16} color="#16a34a" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* ── Image Lightbox Modal ── */}
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            zIndex: 100000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <button
              type="button"
              onClick={() => setLightboxImg(null)}
              style={{
                position: 'absolute',
                top: -40,
                right: 0,
                background: 'none',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                padding: 6
              }}
            >
              <X size={24} />
            </button>
            <img
              src={lightboxImg}
              alt="Report Evidence"
              style={{
                maxWidth: '100%',
                maxHeight: '85vh',
                borderRadius: 8,
                objectFit: 'contain',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
              }}
            />
          </div>
        </div>
      )}

      {/* ── Reject Modal (Meta Style) ── */}
      {rejectModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 8,
            width: '100%',
            maxWidth: 480,
            padding: '20px 24px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
            border: '1px solid #ccd0d5',
            animation: 'slideDown 0.15s ease-out'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: '#fee2e2', color: '#dc2626',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <XCircle size={18} />
                </div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#050505' }}>
                  Reject Report #{rejectModal.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#65676b', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#65676b', lineHeight: 1.4 }}>
              Specify why this report is being rejected. The rejection reason will be recorded in the audit history.
            </p>

            {/* Quick Reason Presets */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {REJECT_PRESETS.map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRejectReason(preset)}
                  style={{
                    background: rejectReason === preset ? '#fee2e2' : '#f0f2f5',
                    color: rejectReason === preset ? '#991b1b' : '#050505',
                    border: `1px solid ${rejectReason === preset ? '#fecaca' : '#e4e6eb'}`,
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                Rejection Reason Note
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Explain why this report cannot be approved (e.g. duplicate, not solid waste, resolved)..."
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 6,
                  border: '1px solid #ccd0d5',
                  background: '#ffffff',
                  color: '#050505',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                className="meta-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleReject(rejectModal.id, rejectReason)}
                disabled={isActionLoading}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: '1px solid #dc2626',
                  borderRadius: 6,
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isActionLoading ? 'wait' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <XCircle size={14} />
                <span>{isActionLoading ? 'Rejecting...' : 'Confirm Rejection'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Canvas ── */}
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
                  Validate Reports
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
                {isAdmin
                  ? 'Review citizen waste reports, evaluate severity, and approve or reject entries across Lucena City.'
                  : `${user?.barangay_name || 'Barangay'} · Review citizen reports, assign waste severity, and approve for live map.`}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => navigate('/admin/hotspots')}
                  className="meta-btn-secondary"
                  title="View Hotspot Map"
                >
                  <Flame size={14} color="#f97316" />
                  <span>Hotspots Map</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => fetchReports()}
                disabled={loading}
                className="meta-btn-secondary"
              >
                <RefreshCw size={14} className={loading ? 'icon-spin' : ''} color="#65676b" />
                <span>{loading ? 'Refreshing...' : 'Refresh Data'}</span>
              </button>

              {isAdmin ? (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)',
                  color: '#2563eb', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700
                }}>
                  <ShieldCheck size={14} /> Admin Moderation Active
                </span>
              ) : (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: '#ffffff', border: '1px solid #ccd0d5',
                  color: '#050505', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700
                }}>
                  <MapPin size={13} color="#16a34a" /> {user?.barangay_name || 'Lucena City'}
                </span>
              )}
            </div>
          </div>

          {/* ── KPI Stat Strip (Meta Business Suite Style) ── */}
          {loading && reports.length === 0 ? (
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
                  label: 'Total Reports',
                  value: counts.all,
                  subtext: 'City-wide logged reports',
                  icon: Layers
                },
                {
                  label: 'Pending Action',
                  value: counts.pending,
                  subtext: 'Awaiting severity & approval',
                  icon: Clock,
                  highlight: counts.pending > 0 ? '#b91c1c' : undefined
                },
                {
                  label: 'Approved & Live',
                  value: counts.approved,
                  subtext: 'Published to operations map',
                  icon: CheckCircle2,
                  highlight: '#166534'
                },
                {
                  label: 'Rejected / Declined',
                  value: counts.rejected,
                  subtext: 'Declined with reason recorded',
                  icon: Archive
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

          {/* ── Urgent Alert Banner (High-Severity Reports) ── */}
          {highPendingCount > 0 && (
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
                  {highPendingCount} high-severity waste accumulation(s) require priority validation
                </div>
                <div style={{ fontSize: 12, color: '#7f1d1d' }}>
                  Evaluate waste severity and approve reports immediately to alert route dispatch and trigger collection.
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
            {/* Severity Tabs */}
            <div style={{ display: 'flex', gap: 4, background: '#f0f2f5', borderRadius: 6, padding: 3, flexWrap: 'wrap' }}>
              {['all', 'high', 'medium', 'low'].map(f => {
                const active = severityFilter === f
                const pMeta = SEVERITY_CONFIG[f]
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSeverityFilter(f)}
                    className={`meta-tab-btn ${active ? 'active' : ''}`}
                  >
                    {f !== 'all' && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: pMeta.color }} />
                    )}
                    <span>
                      {f === 'all'
                        ? `All (${counts.all})`
                        : `${pMeta.label} (${counts[f]})`}
                    </span>
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
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>

            {/* Barangay Select (Admins only) */}
            {isAdmin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Barangay:
                </span>
                <select
                  value={barangayFilter}
                  onChange={e => setBarangayFilter(e.target.value)}
                  className="meta-select"
                >
                  <option value="">All Barangays</option>
                  {(barangays || []).map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Issue Type Select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Type:
              </span>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="meta-select"
              >
                <option value="all">All Types</option>
                <option value="overflow">Overflow</option>
                <option value="missed">Missed Pickup</option>
                <option value="illegal_dumping">Illegal Dumping</option>
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
                placeholder="Search address, reporter, ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: 32,
                  paddingRight: 28,
                  boxSizing: 'border-box'
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

          {/* ── Reports Feed ── */}
          {loading && reports.length === 0 ? (
            <FeedCardSkeleton count={4} compact />
          ) : sortedReports.length === 0 ? (
            <div className="meta-card" style={{
              textAlign: 'center',
              padding: '50px 20px'
            }}>
              <CheckCircle2 size={32} color="#16a34a" style={{ margin: '0 auto 10px' }} />
              <div style={{ fontWeight: 700, fontSize: 15, color: '#050505', marginBottom: 4 }}>
                No Reports Found
              </div>
              <div style={{ fontSize: 12, color: '#65676b', maxWidth: 320, margin: '0 auto' }}>
                No reports match your current filters. Clear filters or check back later.
              </div>
            </div>
          ) : (
            <div className="ww-stagger">
              {sortedReports.map(r => {
                const currentSev = localSeverityMap[r.id] || r.severity || 'medium'
                const p = SEVERITY_CONFIG[currentSev] || SEVERITY_CONFIG.medium
                const isOpen = expanded === r.id
                const isTerminal = ['approved', 'rejected', 'resolved'].includes(r.status)
                const isPending = r.status === 'pending'
                const typeMeta = ISSUE_TYPE_META[r.issue_type] || { label: r.issue_type || 'Waste', color: '#64748b', bg: '#f0f2f5', border: '#e4e6eb' }

                return (
                  <div
                    id={`report-${r.id}`}
                    key={r.id}
                    className="meta-esc-card"
                    style={{
                      borderLeft: `4px solid ${p.color}`,
                      opacity: r.status === 'rejected' ? 0.75 : 1,
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
                        background: isOpen ? '#f7f8fa' : 'transparent',
                        userSelect: 'none'
                      }}
                      onClick={() => setExpanded(prev => prev === r.id ? null : r.id)}
                    >
                      {/* Left Issue Icon */}
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        flexShrink: 0,
                        background: typeMeta.bg,
                        color: typeMeta.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: `1px solid ${typeMeta.border}`
                      }}>
                        {getIssueIcon(r.issue_type)}
                      </div>

                      {/* Main Details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: '#050505' }}>
                            {typeMeta.label} #{r.id}
                          </span>
                          <SeverityBadge s={currentSev} />
                          <StatusBadge s={r.status} />
                          {r.image && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              fontSize: 10, fontWeight: 700, color: '#2563eb',
                              background: 'rgba(37,99,235,0.08)', padding: '1px 6px', borderRadius: 4
                            }}>
                              <Camera size={11} /> Photo
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: 12, color: '#65676b', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <User size={12} color="#8a8d91" />
                            <span>Reporter: <strong style={{ color: '#050505' }}>{r.reporter_name || 'Anonymous Citizen'}</strong></span>
                          </span>

                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <MapPin size={12} color="#16a34a" />
                            <span>Brgy. {r.barangay_name || 'Lucena City'}</span>
                          </span>

                          {r.address && (
                            <span style={{
                              color: '#8a8d91',
                              maxWidth: 260,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}>
                              · {r.address}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right metadata, quick action buttons & expansion chevron */}
                      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 11, color: '#65676b', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={11} />
                          <span>{formatRelativeTime(r.created_at)}</span>
                        </div>

                        {/* Quick action buttons on pending items when collapsed */}
                        {isPending && !isOpen && (
                          <div style={{ display: 'flex', gap: 6 }} onClick={ev => ev.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setRejectModal(r)}
                              style={{
                                background: '#ffffff',
                                border: '1px solid #fecaca',
                                color: '#dc2626',
                                borderRadius: 5,
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '4px 9px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                            >
                              <X size={12} /> Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApprove(r.id, currentSev)}
                              style={{
                                background: '#16a34a',
                                border: '1px solid #16a34a',
                                color: '#ffffff',
                                borderRadius: 5,
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '4px 10px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                            >
                              <Check size={12} /> Approve
                            </button>
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
                          color: '#65676b'
                        }}>
                          {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </div>
                      </div>
                    </div>

                    {/* ── Expanded Details Section (Meta Style) ── */}
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
                        {/* Waste Severity Evaluation Selector Block */}
                        <div style={{
                          background: '#f7f8fa',
                          border: '1px solid #e4e6eb',
                          borderRadius: 6,
                          padding: '12px 14px',
                          marginBottom: 14
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Flame size={15} color="#b45309" />
                              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#65676b' }}>
                                Waste Severity Evaluation
                              </span>
                            </div>
                            <span style={{
                              fontSize: 10, fontWeight: 700, color: '#166534',
                              background: '#dcfce7', border: '1px solid #bbf7d0',
                              padding: '2px 8px', borderRadius: 4
                            }}>
                              {isAdmin ? 'Admin Moderation' : 'Official Evaluation'}
                            </span>
                          </div>

                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                            gap: 10
                          }}>
                            {Object.entries(SEVERITY_CONFIG).map(([sevKey, conf]) => {
                              const isSelected = currentSev === sevKey
                              return (
                                <button
                                  key={sevKey}
                                  type="button"
                                  onClick={() => handleSelectSeverity(r.id, sevKey)}
                                  className="meta-sev-card"
                                  style={{
                                    borderColor: isSelected ? conf.color : '#e4e6eb',
                                    background: isSelected ? conf.bg : '#ffffff',
                                    boxShadow: isSelected ? `0 0 0 1px ${conf.color}` : 'none'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <strong style={{ fontSize: 13, color: isSelected ? conf.color : '#050505', textTransform: 'uppercase' }}>
                                      {conf.label}
                                    </strong>
                                    {isSelected && <Check size={14} color={conf.color} />}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#65676b', lineHeight: 1.3 }}>
                                    {conf.desc}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Two Column Grid: Location Map & Report Details */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                          gap: 14,
                          marginBottom: 14
                        }}>
                          {/* Left Column: Mini Location Map */}
                          <div style={{
                            background: '#f7f8fa',
                            border: '1px solid #e4e6eb',
                            borderRadius: 6,
                            padding: '12px 14px'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Report Location Pin
                              </span>
                              <span style={{ fontSize: 11, color: '#8a8d91', fontFamily: 'monospace' }}>
                                {r.latitude ? `${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}` : 'No GPS'}
                              </span>
                            </div>

                            <div
                              ref={mapContainerRef}
                              style={{
                                height: 160,
                                width: '100%',
                                borderRadius: 6,
                                overflow: 'hidden',
                                border: '1px solid #cbd5e1',
                                background: '#e2e8f0',
                                marginBottom: 8
                              }}
                            />

                            <div style={{ fontSize: 12, color: '#050505', lineHeight: 1.4 }}>
                              <MapPin size={12} color="#16a34a" style={{ display: 'inline', marginRight: 4 }} />
                              <strong>{r.barangay_name || 'Lucena City'}</strong>
                              {r.address ? ` · ${r.address}` : ''}
                            </div>
                          </div>

                          {/* Right Column: Citizen Description & Evidence Photo */}
                          <div style={{
                            background: '#f7f8fa',
                            border: '1px solid #e4e6eb',
                            borderRadius: 6,
                            padding: '12px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between'
                          }}>
                            <div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
                                Citizen Submission Notes
                              </span>
                              <div style={{
                                background: '#ffffff',
                                border: '1px solid #e4e6eb',
                                borderRadius: 6,
                                padding: '10px 12px',
                                fontSize: 13,
                                color: r.notes || r.description ? '#050505' : '#8a8d91',
                                fontStyle: r.notes || r.description ? 'normal' : 'italic',
                                lineHeight: 1.5,
                                marginBottom: 10
                              }}>
                                {r.notes || r.description || 'No additional notes provided by the citizen.'}
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 10 }}>
                                <div style={{ background: '#ffffff', padding: '6px 10px', borderRadius: 4, border: '1px solid #e4e6eb' }}>
                                  <span style={{ fontSize: 10, color: '#65676b', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>
                                    Reporter
                                  </span>
                                  <strong style={{ color: '#050505' }}>{r.reporter_name || 'Anonymous Citizen'}</strong>
                                </div>
                                <div style={{ background: '#ffffff', padding: '6px 10px', borderRadius: 4, border: '1px solid #e4e6eb' }}>
                                  <span style={{ fontSize: 10, color: '#65676b', textTransform: 'uppercase', display: 'block', fontWeight: 700 }}>
                                    Submitted At
                                  </span>
                                  <strong style={{ color: '#050505' }}>{new Date(r.created_at).toLocaleString()}</strong>
                                </div>
                              </div>
                            </div>

                            {/* Photo Thumbnail */}
                            {r.image ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ffffff', padding: '8px 10px', borderRadius: 6, border: '1px solid #e4e6eb' }}>
                                <img
                                  src={r.image}
                                  alt="Report Photo"
                                  style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', cursor: 'pointer', border: '1px solid #cbd5e1' }}
                                  onClick={() => setLightboxImg(r.image)}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: '#050505' }}>Photo Attached</div>
                                  <div style={{ fontSize: 11, color: '#65676b' }}>Click preview to enlarge</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setLightboxImg(r.image)}
                                  className="meta-btn-secondary"
                                  style={{ padding: '4px 8px', fontSize: 11 }}
                                >
                                  <Maximize2 size={12} /> View
                                </button>
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: '#8a8d91', fontStyle: 'italic', background: '#ffffff', padding: '8px 10px', borderRadius: 4, border: '1px solid #e4e6eb' }}>
                                No photographic evidence was attached to this report.
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action Buttons Section */}
                        {isPending && (
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 6 }}>
                            <button
                              type="button"
                              onClick={() => setRejectModal(r)}
                              className="meta-btn-secondary"
                              style={{
                                flex: 1,
                                minWidth: 150,
                                justifyContent: 'center',
                                color: '#991b1b',
                                borderColor: '#fecaca',
                                background: '#fee2e2'
                              }}
                            >
                              <XCircle size={14} />
                              <span>Reject Report</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleApprove(r.id, currentSev)}
                              disabled={isActionLoading}
                              className="meta-btn-primary"
                              style={{
                                flex: 2,
                                minWidth: 200,
                                justifyContent: 'center'
                              }}
                            >
                              <CheckCircle2 size={14} />
                              <span>{isActionLoading ? 'Approving...' : 'Approve & Publish to Map'}</span>
                            </button>
                          </div>
                        )}

                        {/* Terminal State Notices (Approved / Rejected) */}
                        {isTerminal && (
                          <div style={{
                            background: r.status === 'rejected' ? '#f0f2f5' : '#e7f3ed',
                            border: `1px solid ${r.status === 'rejected' ? '#e4e6eb' : '#bbf7d0'}`,
                            borderRadius: 6,
                            padding: '10px 14px',
                            fontSize: 12,
                            color: r.status === 'rejected' ? '#65676b' : '#166534',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8
                          }}>
                            {r.status === 'rejected' ? <Ban size={15} /> : <CheckCircle2 size={15} />}
                            <span>
                              {r.status === 'rejected'
                                ? `This report was rejected: "${r.rejection_reason || 'Not suitable for live map'}"`
                                : `This report was approved as ${currentSev.toUpperCase()} severity and published to the live operations map.`}
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

          {/* ── Pagination ── */}
          <div style={{ marginTop: 20 }}>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={10}
              onPageChange={setPage}
            />
          </div>

        </div>
      </div>
    </DashboardLayout>
  )
}
