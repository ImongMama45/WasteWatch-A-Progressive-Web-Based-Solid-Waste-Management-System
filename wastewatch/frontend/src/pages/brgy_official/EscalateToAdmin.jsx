/**
 * EscalateToAdmin.jsx — Barangay Official Escalation Page
 * --------------------------------------------------------
 * Route: /brgy/escalate
 *
 * Navigated to from:
 *  - "Escalate to Admin" button inside expanded truck card
 *  - Sidebar Quick Actions "Escalate to Admin" button
 *
 * Receives optional state: { shiftId, truckLabel, driver } via useLocation
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import DashboardLayout from '../../components/DashboardLayout'
import { ICONS } from '../../api/navConfig'
import { useEscalations } from '../../hooks/useEscalations'

const SEVERITY_OPTIONS = [
  { key: 'low', label: 'Low', desc: 'Minor issue, not urgent', color: 'var(--accent)', bg: 'rgba(46,204,113,0.08)', border: 'rgba(46,204,113,0.35)' },
  { key: 'medium', label: 'Medium', desc: 'Needs attention soon', color: 'var(--warning)', bg: 'rgba(243,156,18,0.08)', border: 'rgba(243,156,18,0.35)' },
  { key: 'high', label: 'High', desc: 'Urgent — repeated or serious issue', color: 'var(--danger)', bg: 'rgba(231,76,60,0.08)', border: 'rgba(231,76,60,0.35)' },
]

const ISSUE_PRESETS = [
  'Repeated missed pickups',
  'Truck not following route',
  'Driver unresponsive',
  'Reckless driving',
  'Schedule not updated',
]

export default function EscalateToAdmin() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Pre-filled context from truck monitor navigation
  const initShiftId = location.state?.shiftId || ''
  const initSeverity = location.state?.severity || 'medium'

  const [form, setForm] = useState({
    severity: initSeverity,
    subject: '',
    message: '',
    truckId: '',
    driverId: '',
    shiftId: initShiftId,
  })

  const [activeShifts, setActiveShifts] = useState([])
  const [loadingShifts, setLoadingShifts] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)

  // Fetch driver history
  const { items: allEscalations, loading: loadingEscalations } = useEscalations()

  useEffect(() => {
    async function fetchLiveShifts() {
      try {
        const res = await api.get('/api/public/live/')
        setActiveShifts(res.data)

        // Auto-select if navigated from a specific shift
        if (initShiftId) {
          const shift = res.data.find(s => s.id === initShiftId)
          if (shift) {
            setForm(prev => ({
              ...prev,
              truckId: shift.truck_id,
              driverId: shift.driver_id,
              subject: `Missed collection — Truck ${shift.truck_plate} (${shift.driver_name})`
            }))
          }
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingShifts(false)
      }
    }
    fetchLiveShifts()
  }, [initShiftId])

  function setField(key, val) {
    setForm(p => ({ ...p, [key]: val }))
    setError(null)
  }

  function handleShiftSelect(e) {
    const sId = e.target.value
    if (!sId) {
      setForm(p => ({ ...p, shiftId: '', truckId: '', driverId: '' }))
      return
    }
    const shift = activeShifts.find(s => s.id === parseInt(sId))
    if (shift) {
      setForm(p => ({ ...p, shiftId: shift.id, truckId: shift.truck_id, driverId: shift.driver_id }))
    }
  }

  function applyPreset(preset) {
    setField('subject', preset)
  }

  async function handleSubmit() {
    if (!form.subject.trim() || !form.message.trim()) {
      setError('Please fill in both Subject and Details.')
      return
    }
    if (!form.driverId || !form.truckId) {
      setError('Please select a specific Truck & Driver.')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/api/watcher/escalations/', {
        priority: form.severity,
        title: form.subject,
        issue_type: 'Truck Infraction',
        notes: form.message,
        raised_by: user?.full_name || 'Barangay Official',
        barangay: user?.barangay_id,
        driver: form.driverId,
        truck: form.truckId,
      })
      await new Promise(r => setTimeout(r, 700)) // simulate network
      setSubmitted(true)
    } catch (err) {
      setError('Failed to submit escalation. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const driverHistory = useMemo(() => {
    if (!form.driverId) return []
    return allEscalations.filter(e => e.driver === form.driverId)
  }, [form.driverId, allEscalations])


  const selectedDriverName = activeShifts.find(s => s.driver_id === form.driverId)?.driver_name || 'Unknown Driver'

  return (
    <DashboardLayout>
      {submitted && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(12px)',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 24, padding: '40px 32px',
            width: '100%', maxWidth: 420, textAlign: 'center',
            boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
            animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            <style>{`
              @keyframes slideUp { from { opacity: 0; transform: translateY(30px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
              @keyframes checkmark { 0% { stroke-dashoffset: 48; opacity: 0; } 100% { stroke-dashoffset: 0; opacity: 1; } }
            `}</style>

            <div style={{
              width: 80, height: 80, margin: '0 auto 24px',
              borderRadius: '50%', background: 'linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(20,184,166,0.1) 100%)',
              border: '2px solid rgba(34,197,94,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 30px rgba(34,197,94,0.15)'
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" strokeDasharray="48" strokeDashoffset="48" style={{ animation: 'checkmark 0.6s cubic-bezier(0.65, 0, 0.45, 1) 0.2s forwards' }} />
              </svg>
            </div>

            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, color: 'var(--text)', marginBottom: 12 }}>
              Escalation Submitted
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
              Your report has been securely logged for Admin review. The reviewing admin will track progress in the Escalations panel.
            </p>

            <button
              onClick={() => navigate('/dashboard')}
              style={{
                width: '100%', padding: '14px', borderRadius: 12,
                background: 'var(--accent)', color: '#000',
                border: 'none', fontWeight: 800, fontSize: 15,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: '0 4px 14px rgba(20,184,166,0.3)', transition: 'all 0.2s'
              }}
              onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      )}

      <div className="page" style={{ maxWidth: 1200 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
              Log Disciplinary Escalation
            </h2>
          </div>
          <p className="text-muted text-sm">
            Report truck infractions or serious issues requiring Admin intervention.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Left Panel: Form */}
          <div style={{ flex: '1 1 600px' }}>
            <div className="card card-dark" style={{ padding: 24, marginBottom: 24 }}>
              <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 700, marginBottom: 20, color: 'white' }}>
                Escalation Details
              </h3>

              {/* Truck / Driver Selection */}
              <div className="form-group">
                <label className="form-label">Select Truck / Driver</label>
                <select
                  className="form-input"
                  value={form.shiftId}
                  onChange={handleShiftSelect}
                  disabled={loadingShifts}
                >
                  <option value="">— Select an active truck —</option>
                  {activeShifts.map(s => (
                    <option key={s.id} value={s.id}>
                      Truck {s.truck_plate} · {s.driver_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Severity */}
              <div className="form-group">
                <label className="form-label">Severity Level</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {SEVERITY_OPTIONS.map(s => (
                    <button key={s.key} onClick={() => setField('severity', s.key)} style={{
                      padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
                      border: `1.5px solid ${form.severity === s.key ? s.border : 'rgba(255,255,255,0.1)'}`,
                      background: form.severity === s.key ? s.bg : 'rgba(255,255,255,0.03)',
                      transition: 'all .15s', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: form.severity === s.key ? s.color : 'rgba(255,255,255,0.45)', marginBottom: 2 }}>{s.label}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4 }}>{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick presets */}
              <div className="form-group">
                <label className="form-label">Quick Presets</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ISSUE_PRESETS.map(p => (
                    <button key={p} onClick={() => applyPreset(p)} style={{
                      padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                      border: '1px solid rgba(255,255,255,0.15)',
                      background: form.subject === p ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.04)',
                      color: form.subject === p ? 'var(--accent)' : 'rgba(255,255,255,0.5)',
                      fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                      transition: 'all .15s', borderColor: form.subject === p ? 'rgba(20,184,166,0.4)' : 'rgba(255,255,255,0.15)',
                    }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className={`form-input ${error && !form.subject ? 'error' : ''}`} type="text" placeholder="e.g. Repeated missed pickup..." value={form.subject} onChange={e => setField('subject', e.target.value)} />
              </div>

              {/* Details */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Details</label>
                <textarea className={`form-input ${error && !form.message ? 'error' : ''}`} rows={4} placeholder="Describe the issue in detail..." value={form.message} onChange={e => setField('message', e.target.value)} />
              </div>

              {error && <p className="form-error" style={{ marginTop: 12 }}>{error}</p>}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate(-1)}>Cancel</button>
              <button className="btn btn-danger" style={{ flex: 2, fontWeight: 700 }} onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Submitting…' : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><div style={{ width: 14, height: 14 }}>{ICONS.escalation}</div> Submit Escalation</div>}
              </button>
            </div>
          </div>

          {/* Right Panel: Driver History */}
          <div style={{ flex: '1 1 340px' }}>
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 14, overflow: 'hidden'
            }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <h3 style={{ fontSize: 13, fontWeight: 800, margin: 0, letterSpacing: '.05em', color: 'var(--text-muted)' }}>
                  DRIVER RECORD
                </h3>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                  {form.driverId ? selectedDriverName : 'Select a driver'}
                </div>
              </div>

              <div style={{ padding: 20, minHeight: 300 }}>
                {!form.driverId ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 40 }}>
                    Select a truck/driver from the left to view their history.
                  </div>
                ) : loadingEscalations ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
                ) : driverHistory.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 40 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: 'var(--accent)' }}><div style={{ width: 32, height: 32 }}>{ICONS.check}</div></div>
                    Clean record (within your barangay).<br />No past escalations found for this driver in your jurisdiction.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {driverHistory.slice(0, 5).map(esc => (
                      <div key={esc.id} style={{
                        padding: 12, borderRadius: 10,
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{esc.title}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: esc.status === 'resolved' ? 'var(--accent)' : 'var(--danger)' }}>
                            {esc.status.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(esc.created_at).toLocaleDateString()} · {esc.barangay_name}
                        </div>
                      </div>
                    ))}
                    {driverHistory.length > 5 && (
                      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--accent)', fontWeight: 700, marginTop: 8 }}>
                        + {driverHistory.length - 5} older records
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
