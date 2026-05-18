/**
 * DriverDashboard.jsx — Driver Home Screen
 * -----------------------------------------
 * Mobile-first, matches BrgyDashboard desktop layout:
 *  - page → page-grid → main column + .sidebar
 *  - stat-grid / stat-card with .label / .value
 *  - section-title, form-label, card classes
 *  - Syne headings, DM Sans body (via CSS vars)
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import useShiftTimer from '../../hooks/useShiftTimer'
import useGpsTracking from '../../hooks/useGpsTracking'
import IssueReporter from './components/IssueReporter'
import HomeCarousel from '../../components/carousel/HomeCarousel'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_ROUTE = {
  id: 1,
  name: 'Isabang–Brgy.12 Route',
  barangay: 'Barangay Isabang',
  totalStops: 10,
  completedStops: 3,
  distanceKm: 24,
  startTime: '6:00 AM',
  estEnd: '10:30 AM',
  truck: 'TRUCK WT-042',
}

const MOCK_CURRENT_STOP = {
  address: 'Barangay Hall, Brgy. 8',
  type: 'Mixed Waste',
  eta: '3 mins',
}

const MOCK_NEXT_STOP = {
  address: 'Public Market, Brgy. 9',
  distance: '0.8 km',
}

const MOCK_SCHEDULE = [
  { day: 'Monday', zone: 'Zone A', time: '6:00 – 10:00 AM', done: true },
  { day: 'Wednesday', zone: 'Zone B', time: 'No Schedule', done: false },
  { day: 'Friday', zone: 'Zone C', time: '6:00 – 10:00 AM', done: false },
]

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────

const STATUSES = [
  { key: 'on_duty', label: 'On Duty', color: '#2ecc71', bg: 'rgba(46,204,113,0.12)' },
  { key: 'on_route', label: 'On Route', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  { key: 'at_stop', label: 'At Stop', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { key: 'issue', label: 'Issue', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
]

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [route, setRoute] = useState(MOCK_ROUTE)
  const [status, setStatus] = useState('on_route')
  const [loading, setLoading] = useState(true)
  const [issueOpen, setIssueOpen] = useState(false)

  // ── Shift timer (persists across refreshes) ────────────────────────────────
  const { shiftActive, startTime, formattedTime, startShift, endShift } = useShiftTimer()

  // ── GPS (for issue reports) ────────────────────────────────────────────
  const { position: gpsPosition } = useGpsTracking({ enabled: shiftActive })

  const progress = route.totalStops > 0 ? Math.round((route.completedStops / route.totalStops) * 100) : 0
  const activeStatus = STATUSES.find(s => s.key === status) || STATUSES[0]
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'
  const stopsLeft = route.totalStops - route.completedStops

  useEffect(() => {
    Promise.all([
      api.get('/api/driver/route/today/').catch(() => ({ data: null })),
      api.get('/api/driver/shift/status/').catch(() => ({ data: null })),
    ]).then(([routeRes, shiftRes]) => {
      if (routeRes.data) setRoute(r => ({ ...r, ...routeRes.data }))
    }).finally(() => setLoading(false))
  }, [])

  function handleShiftToggle() {
    if (!shiftActive) {
      navigate('/driver/flow')
    } else {
      const result = endShift()
      api.post('/api/driver/shift/end/', {
        started_at: result.startTime?.toISOString(),
        ended_at: result.endTime?.toISOString(),
        duration_ms: result.durationMs,
      }).catch(() => { })
    }
  }

  return (
    <>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity:0; transform:translateY(-8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes slideDown {
          from { opacity:0; transform:translateY(-5px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes dd-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .dcard { transition: box-shadow .18s, border-color .18s; }
        .dcard:hover { box-shadow: 0 4px 18px rgba(0,0,0,.09); }
        .abtn  { transition: opacity .15s, transform .1s; cursor:pointer; }
        .abtn:hover  { opacity:.88; }
        .abtn:active { transform:scale(.97); }
        .dd-pulse { animation: dd-pulse 2s ease infinite; }
      `}</style>

      <div className="page">

        {/* ── PAGE HEADER ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
              Hello, {firstName} 👋
            </h2>
            <span style={{
              background: shiftActive ? 'rgba(46,204,113,0.1)' : 'rgba(120,120,120,0.1)',
              color: shiftActive ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${shiftActive ? 'rgba(46,204,113,0.3)' : 'var(--border)'}`,
              fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20, letterSpacing: '.08em',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span className={shiftActive ? 'dd-pulse' : ''} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: shiftActive ? '#2ecc71' : '#999', display: 'inline-block',
              }} />
              {shiftActive ? 'ACTIVE SHIFT' : 'OFF DUTY'}
            </span>
          </div>
          <p className="text-muted text-sm">
            {route.truck} · {route.barangay} · {route.name}
          </p>

          {/* ── SHIFT TIMER ── */}
          {shiftActive && (
            <div style={{
              marginTop: 10, display: 'flex', alignItems: 'center', gap: 12,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '10px 14px',
            }}>
              <div style={{ flex: 1 }}>
                <div className="form-label" style={{ marginBottom: 2 }}>SHIFT DURATION</div>
                <div style={{
                  fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800,
                  color: 'var(--accent)', letterSpacing: '.04em',
                }}>
                  {formattedTime}
                </div>
              </div>
              {startTime && (
                <div style={{ textAlign: 'right' }}>
                  <div className="form-label" style={{ marginBottom: 2 }}>STARTED</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── HomeCarousel — mobile only ── */}
        <div className="mobile-schedule">
          <HomeCarousel
            role="driver"
            userBarangay={user?.barangay_name}
            onReport={() => navigate('/report/submit')}
            extraSecondCta={{ label: '🗺 View Route', onClick: () => navigate('/driver/route') }}
          />
        </div>

        <div className="page-grid">

          {/* ════════════════════════════════════════
              MAIN COLUMN
          ════════════════════════════════════════ */}
          <div>

            {/* ── STAT CARDS ── */}
            <div className="stat-grid" style={{ marginBottom: 20 }}>
              {[
                { label: 'Stops Done', value: route.completedStops, },
                { label: 'Stops Left', value: stopsLeft, },
                { label: 'Distance', value: `${route.distanceKm}km`, },
                { label: 'Total Stops', value: route.totalStops },
              ].map(s => (
                <div key={s.label} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 12, right: 14, fontSize: 18, opacity: .15 }}>{s.icon}</div>
                  <div className="label">{s.label}</div>
                  <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* ── ROUTE PROGRESS CARD ── */}
            <div className="card dcard" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Today's Route</h3>
                <span style={{
                  background: status === 'issue' ? 'rgba(239,68,68,0.1)' : 'rgba(46,204,113,0.1)',
                  color: status === 'issue' ? 'var(--danger)' : 'var(--accent)',
                  border: `1px solid ${status === 'issue' ? 'rgba(239,68,68,0.3)' : 'rgba(46,204,113,0.3)'}`,
                  fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20, letterSpacing: '.07em',
                }}>
                  {status === 'issue' ? '⚠ DELAYED' : 'IN PROGRESS'}
                </span>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="text-muted text-sm">Progress (Today)</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{route.completedStops} / {route.totalStops} stops</span>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    background: 'linear-gradient(90deg,#2ecc71,#27ae60)',
                    width: `${progress}%`, transition: 'width .4s ease',
                  }} />
                </div>
                <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  {progress}% complete
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                {[
                  { label: 'Start Time', value: route.startTime },
                  { label: 'Est. End', value: route.estEnd },
                  { label: 'Distance', value: `${route.distanceKm} km` },
                ].map(item => (
                  <div key={item.label} style={{
                    background: 'var(--bg)', borderRadius: 10, padding: '10px', textAlign: 'center',
                  }}>
                    <div className="form-label" style={{ marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 700 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="status-card-mobile-only">
              {/* ── STATUS TOGGLE ── */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h3 className="section-title" style={{ margin: 0 }}>Current Status</h3>
                  {!shiftActive && <span className="text-muted text-xs">Start shift to update</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                  {STATUSES.map(s => {
                    const isActive = status === s.key
                    return (
                      <button key={s.key} id={`status-${s.key}`} className="abtn"
                        onClick={() => shiftActive && setStatus(s.key)}
                        style={{
                          padding: '11px 4px', borderRadius: 10,
                          background: isActive ? s.bg : 'var(--surface)',
                          border: `2px solid ${isActive ? s.color : 'var(--border)'}`,
                          color: isActive ? s.color : 'var(--text-muted)',
                          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                          opacity: shiftActive ? 1 : 0.45,
                          cursor: shiftActive ? 'pointer' : 'not-allowed',
                        }}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ── CURRENT STOP (shift active only) ──
              {shiftActive && (
                <div style={{ marginBottom: 20, animation: 'slideDown .2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <h3 className="section-title" style={{ margin: 0 }}>Current Stop</h3>
                    <button onClick={() => navigate('/driver/route')}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      Full Route ›
                    </button>
                  </div>
                  <div className="dcard" style={{
                    background: 'linear-gradient(135deg,#2ecc71,#27ae60)',
                    borderRadius: 14, padding: '16px 14px', marginBottom: 10, position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{ position: 'absolute', right: -16, top: -16, width: 70, height: 70, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
                    <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(0,0,0,0.5)', letterSpacing: '.07em', marginBottom: 4 }}>🔄 RUNNING STOP</div>
                    <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 18, color: '#0d1117', marginBottom: 6 }}>
                      {MOCK_CURRENT_STOP.address}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ background: 'rgba(0,0,0,0.12)', color: '#0d1117', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20 }}>
                        📍 {MOCK_CURRENT_STOP.type}
                      </span>
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.6)', fontWeight: 600 }}>ETA: {MOCK_CURRENT_STOP.eta}</span>
                    </div>
                  </div>
                  <div className="card dcard" style={{ padding: '12px 16px', cursor: 'pointer' }} onClick={() => navigate('/driver/route')}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div className="form-label">NEXT STOP</div>
                        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{MOCK_NEXT_STOP.address}</div>
                        <div className="text-muted text-sm" style={{ marginTop: 2 }}>📍 {MOCK_NEXT_STOP.distance}</div>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" width="16" height="16"
                        style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>
                </div>
              )} */}

              {/* ── MAIN CTA ── */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
                <button id="driver-main-cta" className="abtn btn"
                  onClick={handleShiftToggle}
                  style={{
                    flex: 2, padding: '16px 20px', borderRadius: 14,
                    fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800,
                    background: shiftActive ? 'linear-gradient(135deg,#2ecc71,#27ae60)' : 'linear-gradient(135deg,#3b82f6,#2563eb)',
                    color: '#fff', border: 'none',
                    boxShadow: shiftActive ? '0 4px 18px rgba(46,204,113,0.35)' : '0 4px 18px rgba(59,130,246,0.35)',
                  }}>
                  {shiftActive ? '🚛 Resume Route' : '▶ Start Duty'}
                </button>
                {shiftActive && (
                  <button id="driver-end-shift" className="abtn btn"
                    onClick={() => { setShiftActive(false); api.post('/api/driver/shift/end/').catch(() => { }) }}
                    style={{
                      flex: 1, padding: '16px 14px', borderRadius: 14,
                      fontFamily: 'var(--font-head)', fontSize: 13, fontWeight: 700,
                      background: 'rgba(239,68,68,0.1)', border: '1.5px solid rgba(239,68,68,0.3)',
                      color: 'var(--danger)',
                    }}>
                    End Shift
                  </button>
                )}
              </div>
            </div>
            {/* ── LIVE MAP ── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Live Collection Map</h3>
                <button onClick={() => navigate('/map')}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Full View ›
                </button>
              </div>
              <MiniMap />
            </div>

            {/* ── COLLECTION SCHEDULE ── */}
            <div style={{ marginBottom: 24 }}>
              <h3 className="section-title">Collection Schedule</h3>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {MOCK_SCHEDULE.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                    borderBottom: i < MOCK_SCHEDULE.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: s.done ? 'rgba(46,204,113,0.12)' : 'var(--surface-2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                    }}>
                      {s.done ? '✅' : '📅'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{s.day}</div>
                      <div className="text-muted text-sm">{s.zone} · {route.barangay}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: s.time === 'No Schedule' ? 'var(--text-muted)' : 'var(--text)' }}>
                        {s.time}
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20, letterSpacing: '.05em',
                        background: s.done ? 'rgba(46,204,113,0.1)' : s.time === 'No Schedule' ? 'rgba(148,163,184,0.1)' : 'rgba(243,156,18,0.1)',
                        color: s.done ? 'var(--accent)' : s.time === 'No Schedule' ? 'var(--text-muted)' : 'var(--warning)',
                      }}>
                        {s.done ? 'DONE' : s.time === 'No Schedule' ? 'N/A' : 'UPCOMING'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>{/* end main column */}

          {/* ════════════════════════════════════════
              SIDEBAR (desktop only)
          ════════════════════════════════════════ */}
          <div className="sidebar">

            {/* Quick Actions */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Quick Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="abtn btn btn-full" onClick={() => navigate('/driver/route')}
                  style={{
                    background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.35)',
                    color: 'var(--accent)', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}>
                  🗺 View My Route
                </button>
                <button className="abtn btn btn-full" onClick={() => navigate('/driver/log')}
                  style={{
                    background: 'var(--surface-2)', border: '1px solid var(--border)', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}>
                  📋 Collection Log
                </button>
                <button className="abtn btn btn-full mobile-only" onClick={() => navigate('/report/submit')}
                  style={{
                    background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.35)',
                    color: 'var(--danger)', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}>
                  ⚠ Report Issue
                </button>
              </div>
            </div>

            {/* Route Summary */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Route Summary</h3>
              {[
                { label: 'Stops Done', value: route.completedStops, color: 'var(--accent)' },
                { label: 'Stops Left', value: stopsLeft, color: 'var(--warning)' },
                { label: 'Total Stops', value: route.totalStops, color: 'var(--text)' },
                { label: 'Distance', value: `${route.distanceKm} km`, color: 'var(--info)' },
              ].map(s => (
                <div key={s.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: 'var(--font-head)' }}>
                    {s.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Collection Schedule */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Collection Schedule</h3>
              {MOCK_SCHEDULE.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                  borderBottom: i < MOCK_SCHEDULE.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <span style={{ fontSize: 14 }}>{s.done ? '✅' : '📅'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.day}</div>
                    <div className="text-muted text-xs">{s.zone}</div>
                  </div>
                  <div className="text-muted text-xs" style={{ textAlign: 'right' }}>{s.time}</div>
                </div>
              ))}
            </div>

            {/* Driver Profile */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Your Profile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div className="form-label">Name</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{user?.full_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Email</div>
                  <div className="text-muted text-sm">{user?.email}</div>
                </div>
                <div>
                  <div className="form-label">Truck</div>
                  <div style={{ fontSize: 14 }}>{route.truck}</div>
                </div>
                <div>
                  <div className="form-label">Status</div>
                  <span style={{
                    background: activeStatus.bg, color: activeStatus.color,
                    border: `1px solid ${activeStatus.color}55`,
                    fontSize: 9, fontWeight: 800, padding: '3px 10px',
                    borderRadius: 20, letterSpacing: '.07em', display: 'inline-block',
                  }}>
                    {activeStatus.label.toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="form-label">Role</div>
                  <span style={{
                    background: 'rgba(59,130,246,0.1)', color: 'var(--info)',
                    border: '1px solid rgba(59,130,246,0.25)',
                    fontSize: 9, fontWeight: 800, padding: '3px 10px',
                    borderRadius: 20, letterSpacing: '.07em', display: 'inline-block',
                  }}>DRIVER</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div >

      {/* ── FLOATING REPORT ISSUE BUTTON (visible during active shift) ── */}
      {
        shiftActive && (
          <button
            id="floating-report-issue"
            onClick={() => setIssueOpen(true)}
            style={{
              position: 'fixed', bottom: 80, right: 20, zIndex: 800,
              background: 'linear-gradient(135deg,#ef4444,#dc2626)',
              color: '#fff', border: 'none', borderRadius: '50%',
              width: 54, height: 54, fontSize: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 20px rgba(239,68,68,0.45)',
              cursor: 'pointer', transition: 'transform .15s',
            }}
            title="Report Issue"
          >
            ⚠
          </button>
        )
      }

      {/* ── ISSUE REPORTER BOTTOM SHEET ── */}
      <IssueReporter
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        gpsPosition={gpsPosition}
      />
    </>
  )
}
