/**
 * EscalateToAdmin.jsx — Barangay Official Escalation Page
 * --------------------------------------------------------
 * Route: /brgy/escalate
 *
 * Navigated to from:
 *  - "Escalate to Admin" button inside expanded truck card (when missedYesterday)
 *  - Sidebar Quick Actions "Escalate to Admin" button
 *
 * Receives optional state: { truckLabel, driver } via useLocation
 */

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

const SEVERITY_OPTIONS = [
  {
    key: 'low',
    label: 'Low',
    desc: 'Minor issue, not urgent',
    color: 'var(--accent)',
    bg: 'rgba(46,204,113,0.08)',
    border: 'rgba(46,204,113,0.35)',
  },
  {
    key: 'medium',
    label: 'Medium',
    desc: 'Needs attention soon',
    color: 'var(--warning)',
    bg: 'rgba(243,156,18,0.08)',
    border: 'rgba(243,156,18,0.35)',
  },
  {
    key: 'high',
    label: 'High',
    desc: 'Urgent — repeated or serious issue',
    color: 'var(--danger)',
    bg: 'rgba(231,76,60,0.08)',
    border: 'rgba(231,76,60,0.35)',
  },
]

const ISSUE_PRESETS = [
  'Repeated missed pickups',
  'Truck not following route',
  'Driver unresponsive',
  'Overflow not addressed',
  'Illegal dumping unresolved',
  'Schedule not updated',
]

export default function EscalateToAdmin() {
  const { user }   = useAuth()
  const navigate   = useNavigate()
  const location   = useLocation()

  // Pre-filled context from truck monitor navigation
  const truckLabel = location.state?.truckLabel || ''
  const driver     = location.state?.driver     || ''

  const [form, setForm] = useState({
    severity: 'medium',
    subject:  truckLabel ? `Missed collection — ${truckLabel} (${driver})` : '',
    message:  '',
    category: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [error,      setError]      = useState(null)

  function setField(key, val) {
    setForm(p => ({ ...p, [key]: val }))
    setError(null)
  }

  function applyPreset(preset) {
    setField('subject', preset)
  }

  async function handleSubmit() {
    if (!form.subject.trim() || !form.message.trim()) {
      setError('Please fill in both Subject and Details.')
      return
    }

    setSubmitting(true)
    try {
      // TODO: replace with real endpoint
      await api.post('/api/brgy/escalate/', {
        severity:      form.severity,
        subject:       form.subject,
        message:       form.message,
        barangay_name: user?.barangay_name,
        reported_by:   user?.full_name,
      }).catch(() => {})
      await new Promise(r => setTimeout(r, 700)) // simulate network
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <>
        <Navbar />
        <div className="page" style={{ maxWidth:480 }}>
          <div style={{
            display:'flex', flexDirection:'column', alignItems:'center',
            justifyContent:'center', minHeight:'60vh', textAlign:'center', gap:16,
          }}>
            <div style={{
              width:80, height:80, borderRadius:'50%',
              background:'rgba(46,204,113,0.1)',
              border:'2px solid rgba(46,204,113,0.3)',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:36,
            }}>📨</div>

            <div>
              <h2 style={{ fontFamily:'var(--font-head)', fontSize:22, fontWeight:800, marginBottom:8 }}>
                Escalation Submitted
              </h2>
              <p className="text-muted text-sm" style={{ lineHeight:1.7, maxWidth:320, margin:'0 auto' }}>
                Your report has been sent to the Admin. You'll receive a notification once it's reviewed.
              </p>
            </div>

            <div style={{
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:12, padding:'14px 20px', width:'100%', textAlign:'left',
            }}>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, marginBottom:8, letterSpacing:'.06em' }}>
                SUBMISSION SUMMARY
              </div>
              {[
                { label:'Severity', value: form.severity.charAt(0).toUpperCase()+form.severity.slice(1) },
                { label:'Subject',  value: form.subject },
                { label:'From',     value: user?.barangay_name || 'Your Barangay' },
              ].map(row => (
                <div key={row.label} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'flex-start',
                  padding:'7px 0', borderBottom:'1px solid var(--border)', gap:12,
                }}>
                  <span style={{ fontSize:12, color:'var(--text-muted)', flexShrink:0 }}>{row.label}</span>
                  <span style={{ fontSize:12, fontWeight:600, textAlign:'right' }}>{row.value}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => navigate('/dashboard')}
              className="btn btn-primary"
              style={{ width:'100%', fontWeight:700, marginTop:8 }}>
              ← Back to Dashboard
            </button>
          </div>
        </div>
        <BottomNav />
      </>
    )
  }

  const selectedSeverity = SEVERITY_OPTIONS.find(s => s.key === form.severity)

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth:520 }}>

        {/* Back */}
        <button className="back-link" onClick={() => navigate(-1)}>‹ BACK</button>

        {/* Header */}
        <div style={{ marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
            <h2 style={{ fontFamily:'var(--font-head)', fontSize:22, fontWeight:800, margin:0 }}>
              Escalate to Admin
            </h2>
          </div>
          <p className="text-muted text-sm">
            Report a serious issue that requires Admin intervention.
          </p>
        </div>

        {/* Context card — shown if navigated from a specific truck */}
        {truckLabel && (
          <div style={{
            background:'rgba(231,76,60,0.05)', border:'1.5px solid rgba(231,76,60,0.25)',
            borderRadius:12, padding:'12px 16px', marginBottom:20,
            display:'flex', alignItems:'center', gap:12,
          }}>
            <span style={{ fontSize:24 }}>🚛</span>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--danger)' }}>
                Escalating missed collection
              </div>
              <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                {truckLabel} · Driver: {driver}
              </div>
            </div>
          </div>
        )}

        {/* Form card */}
        <div className="card card-dark" style={{ padding:24 }}>
          <h3 style={{ fontFamily:'var(--font-head)', fontSize:17, fontWeight:700, marginBottom:20, color:'white' }}>
            Escalation Details
          </h3>

          {/* Severity */}
          <div className="form-group">
            <label className="form-label">Severity Level</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {SEVERITY_OPTIONS.map(s => (
                <button key={s.key}
                  onClick={() => setField('severity', s.key)}
                  style={{
                    padding:'10px 8px', borderRadius:10, cursor:'pointer',
                    border: `1.5px solid ${form.severity===s.key ? s.border : 'rgba(255,255,255,0.1)'}`,
                    background: form.severity===s.key ? s.bg : 'rgba(255,255,255,0.03)',
                    transition:'all .15s',
                    textAlign:'center',
                  }}>
                  <div style={{
                    fontSize:12, fontWeight:800,
                    color: form.severity===s.key ? s.color : 'rgba(255,255,255,0.45)',
                    marginBottom:2,
                  }}>{s.label}</div>
                  <div style={{ fontSize:10, color:'rgba(255,255,255,0.35)', lineHeight:1.4 }}>{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Quick presets */}
          <div className="form-group">
            <label className="form-label">Quick Presets</label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {ISSUE_PRESETS.map(p => (
                <button key={p}
                  onClick={() => applyPreset(p)}
                  style={{
                    padding:'5px 12px', borderRadius:20, cursor:'pointer',
                    border:'1px solid rgba(255,255,255,0.15)',
                    background: form.subject===p ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.04)',
                    color: form.subject===p ? 'var(--accent)' : 'rgba(255,255,255,0.5)',
                    fontSize:11, fontWeight:600, fontFamily:'var(--font-body)',
                    transition:'all .15s',
                    borderColor: form.subject===p ? 'rgba(20,184,166,0.4)' : 'rgba(255,255,255,0.15)',
                  }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div className="form-group">
            <label className="form-label">Subject</label>
            <input
              className={`form-input ${error && !form.subject ? 'error' : ''}`}
              type="text"
              placeholder="e.g. Repeated missed pickup — Truck 03"
              value={form.subject}
              onChange={e => setField('subject', e.target.value)}
            />
          </div>

          {/* Details */}
          <div className="form-group" style={{ marginBottom:0 }}>
            <label className="form-label">Details</label>
            <textarea
              className={`form-input ${error && !form.message ? 'error' : ''}`}
              rows={5}
              placeholder="Describe the issue in detail — how many times it occurred, what you've already tried, and any other relevant context..."
              value={form.message}
              onChange={e => setField('message', e.target.value)}
            />
          </div>

          {error && <p className="form-error" style={{ marginTop:8 }}>{error}</p>}
        </div>

        {/* Sender info */}
        <div style={{
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:12, padding:'12px 16px', marginBottom:20,
          display:'flex', alignItems:'center', gap:10,
        }}>
          <div style={{
            width:36, height:36, borderRadius:10,
            background:'rgba(46,204,113,0.1)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:16,
          }}>🏛️</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, fontWeight:600 }}>
              Sending as: {user?.full_name || 'Barangay Official'}
            </div>
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>
              {user?.barangay_name || 'Your Barangay'} · {user?.email}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display:'flex', gap:12 }}>
          <button className="btn btn-outline" style={{ flex:1 }} onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            style={{ flex:2, fontWeight:700, letterSpacing:'.03em' }}
            onClick={handleSubmit}
            disabled={submitting}>
            {submitting ? 'Submitting…' : '📨 Submit Escalation'}
          </button>
        </div>

      </div>
      <BottomNav />
    </>
  )
}
