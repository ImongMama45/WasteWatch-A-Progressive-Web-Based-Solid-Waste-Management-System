import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Camera,
  Navigation,
  MapPin,
  Clock,
  User,
  X,
  FileText,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  Flame,
  Check,
  Maximize2
} from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { DetailModalSkeleton } from '../../components/ui/Skeleton'
import { resolveImageUrl, getReportImages } from '../../utils/imageHelpers'

const TYPE_META = {
  overflow: { label: 'Overflow', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  illegal_dumping: { label: 'Illegal Dumping', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  missed: { label: 'Missed Pickup', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
}

const STATUS_META = {
  pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' },
  approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)' },
  resolved: { label: 'Resolved', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)' },
}

const SEVERITY_CONFIG = [
  { value: 'low', label: 'Low', color: '#10b981', bg: 'rgba(16,185,129,0.1)', desc: 'Minor accumulation, non-hazardous' },
  { value: 'medium', label: 'Medium', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', desc: 'Standard overflow, needs pickup attention' },
  { value: 'high', label: 'High', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', desc: 'Urgent / hazardous illegal dump or blockage' },
]

const REJECT_PRESETS = [
  'Duplicate report',
  'Insufficient photo evidence',
  'Not solid waste / invalid',
  'Already resolved on site',
  'Out of jurisdiction',
]

export default function ReportDetail({ reportId, onClose, onUpdated }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedSeverity, setSelectedSeverity] = useState('medium')
  const [isUpdatingSeverity, setIsUpdatingSeverity] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [isRejecting, setIsRejecting] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState(null)
  const [activePhotoIdx, setActivePhotoIdx] = useState(0)
  const [failedImages, setFailedImages] = useState(() => new Set())
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const photoList = useMemo(() => getReportImages(report), [report])
  const activePhoto = photoList[activePhotoIdx] || photoList[0] || null
  const isCurrentPhotoFailed = activePhoto && failedImages.has(activePhoto)

  const canModerate = Boolean(
    user && (user.role === 'admin' || user.is_superuser || user.is_staff || user.role === 'brgy_official')
  )

  useEffect(() => {
    if (!reportId) return
    let cancelled = false

    setLoading(true)
    setError(null)

    async function fetchReport() {
      try {
        const res = await api.get(`/api/watcher/reports/${reportId}/`)
        if (!cancelled) {
          setReport(res.data)
          setSelectedSeverity(res.data.severity || 'medium')
        }
      } catch (err) {
        if (!cancelled) setError(err.response?.status === 404 ? 'Report not found' : 'Failed to load report')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchReport()

    return () => { cancelled = true }
  }, [reportId])

  const showFeedback = (text, type = 'success') => {
    setFeedbackMsg({ text, type })
    setTimeout(() => setFeedbackMsg(null), 3500)
  }

  const handleSetSeverity = async (newSev) => {
    setSelectedSeverity(newSev)
    if (!report || report.status === 'pending') {
      // For pending reports, severity is saved when approved
      return
    }

    setIsUpdatingSeverity(true)
    try {
      const res = await api.post(`/api/watcher/reports/${report.id}/set_severity/`, { severity: newSev })
      setReport(prev => ({ ...prev, severity: newSev }))
      showFeedback(`Waste Severity updated to ${newSev.toUpperCase()}`)
      if (onUpdated) onUpdated(res.data)
    } catch (err) {
      showFeedback('Failed to update severity', 'error')
    } finally {
      setIsUpdatingSeverity(false)
    }
  }

  const handleApprove = async () => {
    if (!report || isApproving) return
    setIsApproving(true)
    try {
      const res = await api.post(`/api/watcher/reports/${report.id}/approve/`, {
        severity: selectedSeverity
      })
      setReport(prev => ({ ...prev, status: 'approved', severity: selectedSeverity }))
      showFeedback('Report approved and published to live map.')
      if (onUpdated) onUpdated(res.data)
    } catch (err) {
      showFeedback(err.response?.data?.error || 'Failed to approve report', 'error')
    } finally {
      setIsApproving(false)
    }
  }

  const handleConfirmReject = async () => {
    if (!report || isRejecting) return
    const finalReason = rejectReason.trim() || 'Not suitable for live map'
    setIsRejecting(true)
    setRejectError('')
    try {
      const res = await api.post(`/api/watcher/reports/${report.id}/reject/`, {
        rejection_reason: finalReason
      })
      setReport(prev => ({
        ...prev,
        ...(res.data && typeof res.data === 'object' ? res.data : {}),
        status: 'rejected',
        rejection_reason: finalReason,
        rejected_by_name: user?.full_name || 'Staff'
      }))
      setRejectModalOpen(false)
      setRejectReason('')
      setRejectError('')
      showFeedback('Report rejected and moved to history.')
      if (onUpdated) onUpdated(res.data)
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.rejection_reason ||
        err.response?.data?.detail ||
        'Failed to reject report'
      setRejectError(msg)
      showFeedback(msg, 'error')
    } finally {
      setIsRejecting(false)
    }
  }

  if (!reportId) return null

  // Overlay container styles
  const overlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(6px)',
    zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20, overflowY: 'auto'
  }

  const modalStyle = {
    background: 'var(--surface, #ffffff)',
    borderRadius: 20,
    width: '100%',
    maxWidth: 760,
    maxHeight: '90vh',
    overflowY: 'auto',
    position: 'relative',
    boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
    border: '1px solid var(--border, #e2e8f0)',
    color: 'var(--text, #0f172a)'
  }

  if (loading) return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="ww-scale-in" style={modalStyle} onClick={e => e.stopPropagation()}>
        <DetailModalSkeleton showBanner />
      </div>
    </div>
  )

  if (error) return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, padding: 40, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <AlertOctagon size={24} />
        </div>
        <div style={{ color: '#ef4444', fontWeight: 700, fontSize: 16, marginBottom: 16 }}>{error}</div>
        <button
          onClick={onClose}
          style={{
            padding: '8px 20px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            color: 'var(--text)', cursor: 'pointer', fontWeight: 600, fontSize: 13
          }}
        >
          Close
        </button>
      </div>
    </div>
  )

  if (!report) return null

  const tm = TYPE_META[report.issue_type] || TYPE_META.overflow
  const sm = STATUS_META[report.status] || STATUS_META.pending

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="ww-scale-in" style={modalStyle} onClick={e => e.stopPropagation()}>

        {/* Feedback Alert */}
        {feedbackMsg && (
          <div style={{
            position: 'sticky', top: 0, left: 0, right: 0, zIndex: 30,
            background: feedbackMsg.type === 'error' ? '#ef4444' : '#10b981',
            color: '#ffffff', padding: '10px 18px', fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>
            <span>{feedbackMsg.text}</span>
            <button onClick={() => setFeedbackMsg(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
        )}

        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 18, right: 18, zIndex: 10,
            background: 'var(--surface-2, rgba(0,0,0,0.05))',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: '50%', width: 34, height: 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-muted)',
            transition: 'all 0.15s ease'
          }}
        >
          <X size={16} />
        </button>

        {/* Header Strip */}
        <div style={{ padding: '24px 28px 18px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingRight: 40, marginBottom: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>
                  Report #{report.id}
                </h2>
                <span style={{
                  background: sm.bg, color: sm.color, border: `1px solid ${sm.border}`,
                  padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
                  letterSpacing: '.06em', textTransform: 'uppercase'
                }}>
                  {sm.label}
                </span>
                {report.is_watcher_spot && (
                  <span style={{
                    background: 'rgba(124,58,237,0.1)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.3)',
                    padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
                    letterSpacing: '.06em', textTransform: 'uppercase'
                  }}>
                    Watcher Spot
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Clock size={12} />
                Submitted {new Date(report.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', padding: '5px 12px', borderRadius: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.04em' }}>ISSUE TYPE</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: tm.color }}>{tm.label}</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', padding: '5px 12px', borderRadius: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.04em' }}>CURRENT SEVERITY</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: (SEVERITY_CONFIG.find(s => s.value === report.severity)?.color) || '#f59e0b' }}>
                {(report.severity || 'medium').toUpperCase()}
              </span>
            </div>
            {report.is_watcher_spot && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)', padding: '5px 12px', borderRadius: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#7c3aed', letterSpacing: '.04em' }}>SOURCE</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#6d28d9' }}>
                  ON-DUTY WATCHER {report.spot_report_count ? `(${report.spot_report_count} reps)` : ''}
                </span>
              </div>
            )}
            {report.tags && report.tags.split(',').filter(Boolean).map(tag => (
              <span key={tag} style={{
                fontSize: 11, fontWeight: 700,
                background: tag === 'Misconduct' ? 'rgba(239,68,68,0.1)' : 'var(--surface-2, #f8fafc)',
                color: tag === 'Misconduct' ? '#ef4444' : 'var(--text)',
                border: `1px solid ${tag === 'Misconduct' ? 'rgba(239,68,68,0.3)' : 'var(--border, #e2e8f0)'}`,
                padding: '4px 10px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 4
              }}>
                {tag === 'Misconduct' && <AlertTriangle size={11} />}
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Waste Severity Evaluation Selector (For Barangay Official / Admin) */}
          {canModerate && (
            <div style={{
              background: 'var(--surface-2, #f8fafc)',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 12,
              padding: '16px 18px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Flame size={16} color="#f59e0b" />
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                    Assign Waste Severity
                  </span>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800,
                  background: 'rgba(16,185,129,0.1)', color: '#10b981',
                  border: '1px solid rgba(16,185,129,0.3)',
                  padding: '2px 8px', borderRadius: 20
                }}>
                  {user?.role === 'admin' ? 'Admin Evaluation' : 'Official Evaluation'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {report.status === 'pending'
                  ? 'Select the evaluated severity before approving. This determines prioritization on maps and route schedules.'
                  : 'Update the official waste severity classification for this report.'}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {SEVERITY_CONFIG.map(s => {
                  const isSelected = selectedSeverity === s.value
                  return (
                    <button
                      key={s.value}
                      type="button"
                      disabled={isUpdatingSeverity}
                      onClick={() => handleSetSeverity(s.value)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: `1.5px solid ${isSelected ? s.color : 'var(--border, #cbd5e1)'}`,
                        background: isSelected ? s.bg : 'var(--surface, #ffffff)',
                        color: isSelected ? s.color : 'var(--text)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong style={{ fontSize: 13 }}>{s.label}</strong>
                        {isSelected && <Check size={14} color={s.color} />}
                      </div>
                      <div style={{ fontSize: 11, color: isSelected ? s.color : 'var(--text-muted)', lineHeight: 1.3 }}>
                        {s.desc}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Description
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, background: 'var(--surface-2, #f8fafc)', padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
              {report.description || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No description provided.</span>}
            </div>
          </div>

          {/* Rejection Feedback */}
          {report.status === 'rejected' && (
            <div style={{
              background: 'rgba(239,68,68,0.06)', border: '1.5px solid rgba(239,68,68,0.3)',
              borderRadius: 12, padding: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <AlertTriangle size={16} color="#ef4444" />
                <div style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                  Rejection Feedback
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 8 }}>
                {report.rejection_reason || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No reason provided.</span>}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
                {report.rejected_by_name && (
                  <span><strong>Rejected by:</strong> {report.rejected_by_name}</span>
                )}
                {report.rejected_at && (
                  <span><strong>On:</strong> {new Date(report.rejected_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                )}
              </div>
            </div>
          )}

          {/* Meta Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div style={{ background: 'var(--surface-2, #f8fafc)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                Reporter
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <User size={13} color="var(--text-muted)" />
                {report.user_name || 'Anonymous Citizen'}
              </div>
            </div>

            <div style={{ background: 'var(--surface-2, #f8fafc)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                Barangay
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={13} color="var(--text-muted)" />
                {report.barangay_name || 'Lucena City'}
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1', background: 'var(--surface-2, #f8fafc)', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                Address / Location Notes
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {report.address || `${report.latitude || '13.9373'}, ${report.longitude || '121.6170'}`}
              </div>
            </div>
          </div>

          {/* Photo Evidence */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                Photo Evidence {photoList.length > 0 && `(${photoList.length})`}
              </div>
              {photoList.length > 0 && !isCurrentPhotoFailed && (
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                    background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: 6, padding: '3px 8px', cursor: 'pointer'
                  }}
                >
                  <Maximize2 size={12} />
                  <span>Expand Photo</span>
                </button>
              )}
            </div>

            {photoList.length === 0 ? (
              <div style={{ padding: 32, background: 'var(--surface-2, #f8fafc)', borderRadius: 12, border: '1px dashed var(--border)', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px', color: 'var(--text-muted)' }}>
                  <Camera size={20} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>No photo submitted with report</div>
              </div>
            ) : isCurrentPhotoFailed ? (
              <div style={{
                padding: '36px 20px',
                background: '#fef2f2',
                borderRadius: 12,
                border: '1px solid #fecaca',
                textAlign: 'center',
                color: '#991b1b',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626' }}>
                  <AlertTriangle size={20} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Photo Evidence Unavailable</div>
                <div style={{ fontSize: 11, color: '#b91c1c', maxWidth: 360, lineHeight: 1.4 }}>
                  The image asset could not be loaded from storage or was moved. Report GPS coordinates, classification, and location notes remain fully valid.
                </div>
              </div>
            ) : (
              <div
                onClick={() => setLightboxOpen(true)}
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  background: '#0f172a',
                  position: 'relative',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 220
                }}
              >
                <img
                  src={activePhoto}
                  alt="Report Evidence"
                  onError={() => {
                    setFailedImages(prev => new Set([...prev, activePhoto]))
                  }}
                  style={{ width: '100%', maxHeight: 380, objectFit: 'contain', display: 'block' }}
                />
                <div style={{
                  position: 'absolute', bottom: 10, right: 10,
                  background: 'rgba(0,0,0,0.65)', color: '#fff',
                  borderRadius: 6, padding: '4px 8px', fontSize: 11,
                  fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
                  backdropFilter: 'blur(4px)'
                }}>
                  <Maximize2 size={12} />
                  <span>Click to view full image</span>
                </div>
              </div>
            )}

            {/* Multiple Photos Thumbnail Strip */}
            {photoList.length > 1 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', paddingBottom: 4 }}>
                {photoList.map((url, idx) => {
                  const isSelected = idx === activePhotoIdx
                  const isFailed = failedImages.has(url)
                  return (
                    <div
                      key={idx}
                      onClick={() => setActivePhotoIdx(idx)}
                      style={{
                        position: 'relative',
                        width: 58,
                        height: 58,
                        borderRadius: 8,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #16a34a' : '1px solid var(--border)',
                        boxShadow: isSelected ? '0 0 0 2px rgba(22,163,74,0.2)' : 'none',
                        flexShrink: 0,
                        background: '#0f172a'
                      }}
                    >
                      {isFailed ? (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fee2e2', color: '#dc2626' }}>
                          <AlertTriangle size={16} />
                        </div>
                      ) : (
                        <img
                          src={url}
                          alt={`Thumbnail ${idx + 1}`}
                          onError={() => setFailedImages(prev => new Set([...prev, url]))}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Moderate Actions (Approve / Reject) for Pending & Approved Reports */}
          {canModerate && (report.status === 'pending' || report.status === 'approved') && (
            <div style={{
              background: 'var(--surface-2, #f8fafc)',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 14,
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                {report.status === 'pending' ? 'Review Decision' : 'Moderation Actions'}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  disabled={isApproving || isRejecting}
                  onClick={() => {
                    setRejectError('')
                    setRejectModalOpen(true)
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 18px',
                    borderRadius: 10,
                    border: '1.5px solid #ef4444',
                    background: 'transparent',
                    color: '#ef4444',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <XCircle size={16} /> {report.status === 'approved' ? 'Reject & Remove from Map' : 'Reject Report'}
                </button>
                {report.status === 'pending' && (
                  <button
                    type="button"
                    disabled={isApproving || isRejecting}
                    onClick={handleApprove}
                    style={{
                      flex: 2,
                      padding: '12px 18px',
                      borderRadius: 10,
                      border: 'none',
                      background: 'var(--accent, #10b981)',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      boxShadow: '0 4px 14px rgba(16,185,129,0.3)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <CheckCircle2 size={16} /> Approve & Publish to Map
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Location Action */}
          {report.latitude && report.longitude && (
            <div>
              <button
                onClick={() => {
                  if (user?.role === 'admin') {
                    navigate(`/admin/hotspots?lat=${report.latitude}&lng=${report.longitude}`)
                  } else if (user?.role === 'brgy_official' || user?.role === 'watcher') {
                    navigate('/map', { state: { focusReport: report } })
                  } else {
                    navigate('/public-map', { state: { focusReport: report } })
                  }
                  onClose()
                }}
                style={{
                  width: '100%', padding: '12px 18px',
                  background: 'var(--surface-2, #f1f5f9)', color: 'var(--text)',
                  border: '1px solid var(--border, #cbd5e1)', borderRadius: 12, fontWeight: 700, fontSize: 13,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all 0.15s ease'
                }}
              >
                <Navigation size={15} /> Locate Report on Hotspot Map
              </button>
            </div>
          )}

        </div>

        {/* Reject Confirmation Modal */}
        {rejectModalOpen && (
          <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20
          }} onClick={() => setRejectModalOpen(false)}>
            <div style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              border: '1px solid var(--border)',
              padding: 24,
              width: '100%',
              maxWidth: 440,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(239,68,68,0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <XCircle size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Reject Waste Report</h3>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Provide a reason for rejection (logged in audit history).
                  </p>
                </div>
              </div>

              {/* Quick Reason Presets */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {REJECT_PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setRejectReason(preset)
                      setRejectError('')
                    }}
                    style={{
                      background: rejectReason === preset ? 'rgba(239,68,68,0.12)' : 'var(--surface-2, #f1f5f9)',
                      color: rejectReason === preset ? '#dc2626' : 'var(--text, #0f172a)',
                      border: `1px solid ${rejectReason === preset ? 'rgba(239,68,68,0.4)' : 'var(--border, #cbd5e1)'}`,
                      borderRadius: 6,
                      padding: '4px 9px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <textarea
                rows={3}
                placeholder="e.g. Insufficient photo evidence, duplicate report, or resolved on site (optional if preset selected)."
                value={rejectReason}
                onChange={e => {
                  setRejectReason(e.target.value)
                  if (rejectError) setRejectError('')
                }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2, #f8fafc)',
                  color: 'var(--text)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: rejectError ? 10 : 16
                }}
              />

              {rejectError && (
                <div style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  color: '#dc2626',
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span>{rejectError}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setRejectModalOpen(false)
                    setRejectError('')
                  }}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--surface-2)',
                    color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRejecting}
                  onClick={handleConfirmReject}
                  style={{
                    flex: 2, padding: '10px', borderRadius: 8,
                    border: 'none', background: '#ef4444',
                    color: '#ffffff', fontWeight: 700, fontSize: 13,
                    cursor: isRejecting ? 'wait' : 'pointer',
                    opacity: isRejecting ? 0.7 : 1
                  }}
                >
                  {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fullscreen Photo Lightbox Modal */}
        {lightboxOpen && activePhoto && !isCurrentPhotoFailed && (
          <div
            onClick={() => setLightboxOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 100000,
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
            }}
          >
            <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                style={{
                  position: 'absolute', top: -14, right: -14,
                  background: '#ffffff', color: '#1c1e21', border: 'none',
                  borderRadius: '50%', width: 34, height: 34,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
                  zIndex: 2
                }}
              >
                <X size={18} />
              </button>
              <img
                src={activePhoto}
                alt="Evidence Full View"
                style={{ maxWidth: '100%', maxHeight: '88vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 20px 50px rgba(0,0,0,0.5)', display: 'block' }}
              />
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
