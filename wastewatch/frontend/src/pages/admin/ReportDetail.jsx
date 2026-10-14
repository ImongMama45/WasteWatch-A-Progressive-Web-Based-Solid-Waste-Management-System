import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'

const TYPE_META = {
  overflow: { label: 'Overflow', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  illegal_dumping: { label: 'Illegal Dumping', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  missed: { label: 'Missed Pickup', color: '#5dade2', bg: 'rgba(93,173,226,0.1)' },
}

const STATUS_META = {
  pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  approved: { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  resolved: { label: 'Resolved', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
}

const SEVERITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

import { useAuth } from '../../context/AuthContext'

export default function ReportDetail({ reportId, onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!reportId) return
    let cancelled = false;
    
    setLoading(true)
    setError(null)
    
    async function fetchReport() {
      try {
        const res = await api.get(`/api/watcher/reports/${reportId}/`)
        if (!cancelled) setReport(res.data)
      } catch (err) {
        if (!cancelled) setError(err.response?.status === 404 ? 'Report not found' : 'Failed to load report')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchReport()
    
    return () => { cancelled = true; }
  }, [reportId])

  if (!reportId) return null

  // Overlay container styles
  const overlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, overflowY: 'auto'
  }

  const modalStyle = {
    background: '#fff', borderRadius: 16, width: '100%', maxWidth: 800,
    maxHeight: '90vh', overflowY: 'auto', position: 'relative',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)'
  }

  if (loading) return (
    <div style={overlayStyle}>
      <div style={{...modalStyle, padding: 40, textAlign: 'center'}}>Loading report...</div>
    </div>
  )
  if (error) return (
    <div style={overlayStyle}>
      <div style={{...modalStyle, padding: 40, textAlign: 'center', color: '#DC2626'}}>
        {error}
        <br/><br/>
        <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #CBD5E1', cursor: 'pointer' }}>Close</button>
      </div>
    </div>
  )
  if (!report) return null

  const tm = TYPE_META[report.issue_type] || TYPE_META.overflow
  const sm = STATUS_META[report.status] || STATUS_META.pending

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        
        <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
          <button onClick={onClose} style={{
            background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%',
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 18, color: '#64748B'
          }}>
            ×
          </button>
        </div>

        <div style={{ overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 20px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#0F172A' }}>
                Report #{report.id}
              </h1>
              <div style={{ fontSize: 13, color: '#64748B' }}>
                Submitted {new Date(report.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{
                background: sm.bg, color: sm.color,
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase'
              }}>{sm.label}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', padding: '6px 12px', borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>TYPE</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: tm.color }}>{tm.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', padding: '6px 12px', borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>SEVERITY</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: SEVERITY_COLORS[report.severity] || '#64748B' }}>
                {(report.severity || 'unknown').toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 8 }}>DESCRIPTION</div>
            <div style={{ fontSize: 14, color: '#0F172A', lineHeight: 1.6, background: '#F8FAFC', padding: 16, borderRadius: 8 }}>
              {report.description || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No description provided.</span>}
            </div>
          </div>

          {/* Rejection Feedback */}
          {report.status === 'rejected' && (
            <div style={{
              background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 12, padding: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>⚠️</span>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#DC2626', letterSpacing: '.06em' }}>
                  REJECTION FEEDBACK
                </div>
              </div>
              <div style={{ fontSize: 14, color: '#0F172A', lineHeight: 1.6, marginBottom: 10 }}>
                {report.rejection_reason || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No reason provided.</span>}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#64748B' }}>
                {report.rejected_by_name && (
                  <span><strong style={{ color: '#334155' }}>Rejected by:</strong> {report.rejected_by_name}</span>
                )}
                {report.rejected_at && (
                  <span><strong style={{ color: '#334155' }}>On:</strong> {new Date(report.rejected_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>REPORTER</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{report.user_name || 'Unknown'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>BARANGAY</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{report.barangay_name || 'Unknown'}</div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>ADDRESS</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{report.address || 'No address provided'}</div>
            </div>
          </div>

          {/* Photo Evidence */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 12 }}>PHOTO EVIDENCE</div>
            {report.image ? (
              <img src={report.image} alt="Report Evidence" style={{ width: '100%', borderRadius: 12, border: '1px solid #E2E8F0' }} />
            ) : (
              <div style={{ padding: 32, background: '#F8FAFC', borderRadius: 12, border: '1px dashed #CBD5E1', textAlign: 'center', color: '#64748B' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>📷</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>No photo submitted</div>
              </div>
            )}
          </div>

          {/* Location Action */}
          {report.latitude && report.longitude && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 12 }}>LOCATION ACTION</div>
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
                  width: '100%', padding: '12px', background: 'var(--accent)', color: '#fff',
                  border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}
              >
                <span>📍</span> Navigate to that stop
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
    </div>
  )
}
