import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../api/client'
import DashboardLayout from '../../components/DashboardLayout'

const SEVERITY_COLORS = { 
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#16A34A',
}

export default function EscalationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [escalation, setEscalation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Resolution state
  const [confirming, setConfirming] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState(null)

  useEffect(() => {
    async function fetchEscalation() {
      try {
        const res = await api.get(`/api/watcher/escalations/${id}/`)
        setEscalation(res.data)
      } catch (err) {
        setError(err.response?.status === 404 ? 'Escalation not found' : 'Failed to load escalation')
      } finally {
        setLoading(false)
      }
    }
    fetchEscalation()
  }, [id])

  async function handleResolve() {
    setResolving(true)
    setResolveError(null)
    try {
      await api.post(`/api/watcher/escalations/${id}/resolve/`)
      // Optimistic update
      setEscalation(prev => ({ ...prev, status: 'resolved' }))
      setConfirming(false)
    } catch (err) {
      setResolveError('Failed to resolve escalation. Please try again.')
    } finally {
      setResolving(false)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading escalation...</div>
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#DC2626' }}>{error}</div>
  if (!escalation) return null

  const isResolved = escalation.status === 'resolved'
  const priorityColor = SEVERITY_COLORS[escalation.priority] || '#64748B'

  return (
    <DashboardLayout>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      
      <button onClick={() => navigate(-1)} style={{
        background: 'none', border: 'none', color: '#64748B',
        fontSize: 14, fontWeight: 600, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 24
      }}>
        <span style={{ fontSize: 18 }}>←</span> Back
      </button>

      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 20px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#0F172A' }}>
                {escalation.title || 'Untitled Escalation'}
              </h1>
              <div style={{ fontSize: 13, color: '#64748B' }}>
                Raised on {new Date(escalation.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {escalation.updated_at && escalation.updated_at !== escalation.created_at && 
                  ` · Updated ${new Date(escalation.updated_at).toLocaleDateString()}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{
                background: isResolved ? '#F0FDF4' : '#FEF2F2', 
                color: isResolved ? '#16A34A' : '#DC2626',
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800, letterSpacing: '.05em'
              }}>
                {isResolved ? 'RESOLVED' : 'OPEN'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', padding: '6px 12px', borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>PRIORITY</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: priorityColor }}>
                {(escalation.priority || 'unknown').toUpperCase()}
              </span>
            </div>
            {escalation.issue_type && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', padding: '6px 12px', borderRadius: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>ISSUE TYPE</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{escalation.issue_type}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 8 }}>NOTES</div>
            <div style={{ fontSize: 14, color: '#0F172A', lineHeight: 1.6, background: '#F8FAFC', padding: 16, borderRadius: 8 }}>
              {escalation.notes || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No notes provided.</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>RAISED BY</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{escalation.raised_by || 'Unknown'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>BARANGAY</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{escalation.barangay_name || 'Unknown'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>LINKED REPORTS</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{escalation.reports_count || 0}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 4 }}>ASSIGNEE</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{escalation.assignee_name || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Unassigned</span>}</div>
            </div>
          </div>

          {/* Action Area */}
          {!isResolved && (
            <div style={{ 
              marginTop: 16, padding: 20, background: '#F8FAFC', 
              borderRadius: 12, border: '1px solid #E2E8F0',
              display: 'flex', flexDirection: 'column', gap: 12
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Resolution Action</div>
              
              {!confirming ? (
                <button 
                  onClick={() => setConfirming(true)}
                  style={{
                    alignSelf: 'flex-start', padding: '10px 20px', borderRadius: 8,
                    background: '#10B981', color: '#fff', border: 'none',
                    fontWeight: 700, cursor: 'pointer', fontSize: 14
                  }}
                >
                  Mark as Resolved
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#DC2626' }}>Are you sure?</span>
                  <button 
                    onClick={handleResolve}
                    disabled={resolving}
                    style={{
                      padding: '10px 20px', borderRadius: 8,
                      background: resolving ? '#94A3B8' : '#10B981', color: '#fff', border: 'none',
                      fontWeight: 700, cursor: resolving ? 'not-allowed' : 'pointer', fontSize: 14
                    }}
                  >
                    {resolving ? 'Resolving...' : 'Confirm'}
                  </button>
                  <button 
                    onClick={() => setConfirming(false)}
                    disabled={resolving}
                    style={{
                      padding: '10px 20px', borderRadius: 8,
                      background: '#fff', color: '#64748B', border: '1px solid #CBD5E1',
                      fontWeight: 600, cursor: resolving ? 'not-allowed' : 'pointer', fontSize: 14
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {resolveError && (
                <div style={{ color: '#DC2626', fontSize: 13, fontWeight: 600 }}>{resolveError}</div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
    </DashboardLayout>
  )
}
