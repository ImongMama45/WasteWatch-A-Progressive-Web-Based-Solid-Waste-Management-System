/**
 * DriverStatusPanel.jsx — Shift & Truck Status
 * ----------------------------------------------
 * Manages driver shift state and displays truck assignment.
 *
 * Reuses:
 *  - useShiftTimer  → live elapsed clock, start/end persistence
 *  - Existing design system (card, form-label, btn classes)
 *
 * API endpoints:
 *   GET  /api/driver/profile/          → driver + truck info
 *   POST /api/driver/shift/start/      → begin shift
 *   POST /api/driver/shift/end/        → end shift + send duration
 *   GET  /api/driver/route/today/      → stops progress
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import useShiftTimer from '../../hooks/useShiftTimer'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_DRIVER = {
  name: 'Pedro Santos',
  employeeId: 'DRV-042',
  truck: 'TRUCK WT-042',
  plateNumber: 'ABC 1234',
  barangay: 'Barangay Isabang',
  route: 'Isabang–Brgy.12 Route',
}

const MOCK_ROUTE = {
  totalStops: 10,
  completedStops: 4,
}

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  off_shift: { label: 'Off Shift',  color: '#64748b', bg: 'rgba(100,116,139,0.1)', icon: '⭕' },
  on_shift:  { label: 'On Shift',   color: '#2ecc71', bg: 'rgba(46,204,113,0.1)',  icon: '🟢' },
  on_route:  { label: 'On Route',   color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  icon: '🔵' },
  delayed:   { label: 'Delayed',    color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  icon: '🟡' },
}

const STATUS_OPTIONS = ['on_shift', 'on_route', 'delayed']

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, icon }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '11px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
        <span className="form-label" style={{ marginBottom: 0 }}>{label}</span>
      </div>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{value}</span>
    </div>
  )
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.off_shift
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: cfg.bg, border: `1.5px solid ${cfg.color}44`,
      borderRadius: 20, padding: '6px 16px',
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: cfg.color,
        boxShadow: status !== 'off_shift' ? `0 0 8px ${cfg.color}` : 'none',
        animation: status === 'on_route' ? 'dspPulse 2s ease infinite' : 'none',
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{ fontWeight: 800, fontSize: 13, color: cfg.color, letterSpacing: '.04em' }}>
        {cfg.label}
      </span>
    </div>
  )
}

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────

function RouteProgress({ completed, total }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="text-muted text-xs">Route Progress</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>{pct}%</span>
      </div>
      <div style={{ background: 'var(--bg)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99,
          background: 'linear-gradient(90deg,#2ecc71,#27ae60)',
          width: `${pct}%`, transition: 'width .5s ease',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
        <span className="text-muted text-xs">{completed} completed</span>
        <span className="text-muted text-xs">{total - completed} remaining</span>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DriverStatusPanel() {
  const { user }  = useAuth()
  const navigate  = useNavigate()

  const [driver,   setDriver]   = useState(MOCK_DRIVER)
  const [route,    setRoute]    = useState(MOCK_ROUTE)
  const [opStatus, setOpStatus] = useState('off_shift')
  const [loading,  setLoading]  = useState(true)
  const [ending,   setEnding]   = useState(false)

  // ── Shift timer (shared with DriverDashboard via localStorage) ────────────
  const {
    shiftActive,
    startTime,
    formattedTime,
    startShift,
    endShift,
  } = useShiftTimer()

  // Sync opStatus with shiftActive on mount
  useEffect(() => {
    if (shiftActive && opStatus === 'off_shift') setOpStatus('on_shift')
    if (!shiftActive) setOpStatus('off_shift')
  }, [shiftActive])

  useEffect(() => {
    Promise.all([
      api.get('/api/driver/profile/').catch(() => ({ data: null })),
      api.get('/api/driver/route/today/').catch(() => ({ data: null })),
    ]).then(([profRes, routeRes]) => {
      if (profRes.data) setDriver(d => ({ ...d, ...profRes.data }))
      if (routeRes.data) setRoute(r => ({ ...r, ...routeRes.data }))
    }).finally(() => setLoading(false))
  }, [])

  function handleStartShift() {
    navigate('/driver/flow')
  }

  async function handleEndShift() {
    setEnding(true)
    const result = endShift()
    setOpStatus('off_shift')
    try {
      await api.post('/api/driver/shift/end/', {
        started_at:  result.startTime?.toISOString(),
        ended_at:    result.endTime?.toISOString(),
        duration_ms: result.durationMs,
      })
    } catch {}
    setEnding(false)
  }

  function handleStatusChange(newStatus) {
    if (!shiftActive) return
    setOpStatus(newStatus)
    api.post('/api/driver/shift/status/', { status: newStatus }).catch(() => {})
  }

  const progress = route.totalStops > 0
    ? Math.round((route.completedStops / route.totalStops) * 100)
    : 0

  return (
    <>
      <style>{`
        @keyframes dspPulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes dspFadeUp {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .dsp-section { animation: dspFadeUp .2s ease both; }
      `}</style>

      <div className="page" style={{ paddingBottom: 88 }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button onClick={() => navigate('/dashboard')} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
              Shift & Truck Status
            </h1>
            <p className="text-muted text-xs" style={{ marginTop: 2 }}>
              {driver.truck} · {driver.barangay}
            </p>
          </div>
          <StatusBadge status={opStatus} />
        </div>

        {/* ── SHIFT TIMER HERO ── */}
        <div className="card card-dark dsp-section" style={{ padding: '24px 20px', marginBottom: 16, textAlign: 'center' }}>
          <div className="form-label" style={{ marginBottom: 6 }}>
            {shiftActive ? 'SHIFT DURATION' : 'SHIFT NOT STARTED'}
          </div>
          <div style={{
            fontFamily: 'var(--font-head)', fontSize: 48, fontWeight: 800,
            letterSpacing: '.05em',
            color: shiftActive ? '#2ecc71' : 'rgba(255,255,255,0.25)',
          }}>
            {shiftActive ? formattedTime : '00:00:00'}
          </div>
          {shiftActive && startTime && (
            <div className="text-muted text-xs" style={{ marginTop: 6 }}>
              Started at {startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>

        {/* ── SHIFT CONTROLS ── */}
        <div className="dsp-section" style={{ marginBottom: 16 }}>
          {!shiftActive ? (
            /* OFF SHIFT — single Start Shift button */
            <button
              id="start-shift-btn"
              onClick={handleStartShift}
              style={{
                width: '100%', padding: '18px', borderRadius: 14,
                background: 'linear-gradient(135deg,#2ecc71,#27ae60)',
                color: '#0d1117', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800,
                cursor: 'pointer', boxShadow: '0 6px 22px rgba(46,204,113,0.38)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}
            >
              ▶  Start Shift
            </button>
          ) : (
            /* ON SHIFT — Continue Duty + status chips + End Shift */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Continue Duty — primary action */}
              <button
                id="continue-duty-btn"
                onClick={() => {
                  sessionStorage.setItem('ww_route_state', 'navigating')
                  navigate('/driver/flow')
                }}
                style={{
                  width: '100%', padding: '18px', borderRadius: 14,
                  background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
                  color: '#fff', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800,
                  cursor: 'pointer', boxShadow: '0 6px 22px rgba(59,130,246,0.38)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                }}
              >
                🚛  Continue Duty
              </button>

              {/* Status chips + End Shift */}
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
                  {STATUS_OPTIONS.map(s => {
                    const cfg = STATUS_CONFIG[s]
                    const active = opStatus === s
                    return (
                      <button key={s} onClick={() => handleStatusChange(s)} style={{
                        flex: 1, minWidth: 80, padding: '10px 8px', borderRadius: 10,
                        background: active ? cfg.bg : 'var(--surface)',
                        border: `1.5px solid ${active ? cfg.color : 'var(--border)'}`,
                        color: active ? cfg.color : 'var(--text-muted)',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        transition: 'all .15s',
                      }}>
                        {cfg.icon} {cfg.label}
                      </button>
                    )
                  })}
                </div>

                {/* End shift */}
                <button
                  id="end-shift-btn"
                  onClick={handleEndShift}
                  disabled={ending}
                  style={{
                    padding: '10px 18px', borderRadius: 10,
                    background: ending ? 'var(--bg)' : 'rgba(239,68,68,0.1)',
                    border: '1.5px solid rgba(239,68,68,0.4)',
                    color: '#ef4444', fontWeight: 800, fontSize: 12,
                    cursor: ending ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  {ending ? '…' : '⏹ End Shift'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── OPERATIONAL SUMMARY ── */}
        {shiftActive && (
          <div className="card dsp-section" style={{ marginBottom: 16 }}>
            <h2 className="section-title" style={{ fontSize: 14, marginBottom: 14 }}>TODAY'S PROGRESS</h2>

            {/* Stops stat row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'DONE',      value: route.completedStops,               color: '#2ecc71' },
                { label: 'REMAINING', value: route.totalStops - route.completedStops, color: '#f59e0b' },
                { label: 'TOTAL',     value: route.totalStops,                   color: 'var(--text-muted)' },
              ].map(s => (
                <div key={s.label} style={{
                  background: 'var(--bg)', borderRadius: 10, padding: '10px 0', textAlign: 'center',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 22, color: s.color,
                  }}>{s.value}</div>
                  <div className="form-label" style={{ marginBottom: 0 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <RouteProgress completed={route.completedStops} total={route.totalStops} />

            <button
              onClick={() => navigate('/driver/route')}
              style={{
                marginTop: 14, width: '100%', padding: '11px', borderRadius: 10,
                background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)',
                color: '#3b82f6', fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}
            >
              🗺 View Route Overview →
            </button>
          </div>
        )}

        {/* ── DRIVER INFORMATION ── */}
        <div className="card dsp-section" style={{ marginBottom: 16 }}>
          <h2 className="section-title" style={{ fontSize: 14, marginBottom: 4 }}>DRIVER INFORMATION</h2>
          <InfoRow label="NAME"       value={driver.name}        icon="👤" />
          <InfoRow label="EMPLOYEE ID" value={driver.employeeId}  icon="🪪" />
          <InfoRow label="BARANGAY"   value={driver.barangay}    icon="📍" />
          <InfoRow label="ROUTE"      value={driver.route}       icon="🗺️" />
        </div>

        {/* ── TRUCK INFORMATION ── */}
        <div className="card dsp-section">
          <h2 className="section-title" style={{ fontSize: 14, marginBottom: 4 }}>TRUCK ASSIGNMENT</h2>
          <InfoRow label="TRUCK NO."    value={driver.truck}        icon="🚛" />
          <InfoRow label="PLATE NO."    value={driver.plateNumber}  icon="🔢" />
          <div style={{ padding: '11px 0' }}>
            <div className="form-label" style={{ marginBottom: 6 }}>VEHICLE STATUS</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Operational', 'Needs Maintenance', 'Out of Service'].map(s => (
                <span key={s} style={{
                  fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 20,
                  background: s === 'Operational' ? 'rgba(46,204,113,0.1)' : 'var(--bg)',
                  border: `1px solid ${s === 'Operational' ? '#2ecc71' : 'var(--border)'}`,
                  color: s === 'Operational' ? '#2ecc71' : 'var(--text-muted)',
                }}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
