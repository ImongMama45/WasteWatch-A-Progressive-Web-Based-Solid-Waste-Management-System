/**
 * BrgyDashboard.jsx — Barangay Official Dashboard (Revised UI)
 * Route: /brgy/dashboard
 *
 * Key changes from previous version:
 *  - "Escalate to Admin" is now a button that navigates to /brgy/escalate
 *  - Appears as 3rd action inside expanded truck card ONLY when missedYesterday=true
 *  - Improved visual hierarchy, tab pill design, card consistency
 *  - Filter pills on report validation tab
 *  - Status badges on schedule
 */

import { useState,useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'


// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_PENDING_REPORTS = [
  {
    id: 'R001', type: 'overflow', address: 'Corner Main St & 5th Ave',
    reporter: 'Juan Watcher', date: '2026-04-19', photo: true,
    description: 'Large pile of garbage overflowing near the corner.',
    tags: ['Near Market', 'Side Road'],
  },
  {
    id: 'R002', type: 'illegal_dumping', address: 'Barangay Hall Side Gate',
    reporter: 'Maria Santos', date: '2026-04-19', photo: true,
    description: 'Someone dumped construction waste overnight.',
    tags: ['Residential'],
  },
  {
    id: 'R003', type: 'missed', address: 'Zone 3 — Purok 2',
    reporter: 'Pedro Reyes', date: '2026-04-18', photo: false,
    description: 'Truck did not come on Monday despite being scheduled.',
    tags: ['Residential'],
  },
]

const MOCK_TRUCKS = [
  {
    id: 'T01', label: 'Truck 01', driver: 'Pedro Santos',
    status: 'collecting', scheduledTime: '6:00 AM', actualTime: '6:14 AM',
    stopsCompleted: 11, totalStops: 15, missedYesterday: false, capacity: 75,
  },
  {
    id: 'T02', label: 'Truck 02', driver: 'Juan Dela Cruz',
    status: 'collecting', scheduledTime: '6:00 AM', actualTime: '6:02 AM',
    stopsCompleted: 9, totalStops: 15, missedYesterday: false, capacity: 60,
  },
  {
    id: 'T03', label: 'Truck 03', driver: 'Maria Reyes',
    status: 'en_route', scheduledTime: '7:00 AM', actualTime: '—',
    stopsCompleted: 4, totalStops: 12, missedYesterday: true, capacity: 30,
  },
]

const MOCK_SCHEDULE = [
  { day: 'Monday',    zone: 'Zone A', time: '6:00 – 10:00 AM', done: true  },
  { day: 'Wednesday', zone: 'Zone B', time: 'No Schedule',      done: false },
  { day: 'Friday',    zone: 'Zone C', time: '6:00 – 10:00 AM', done: false },
]

const ISSUE_LABELS = { overflow: 'Overflow', illegal_dumping: 'Illegal Dumping', missed: 'Missed Collection' }
const ISSUE_ICONS  = { overflow: '🗑️', illegal_dumping: '🚯', missed: '📭' }

const STATUS_COLORS = { collecting: '#22c55e', en_route: '#f59e0b', idle: '#94a3b8', done: '#3b82f6' }
const STATUS_LABELS = { collecting: 'Collecting', en_route: 'En Route', idle: 'Idle', done: 'Done' }

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function BrgyDashboard() {
  const { user } = useAuth()
  const trucksRef = useRef(null);
  const navigate  = useNavigate()

  const [stats,          setStats]          = useState({ approved: 0, rejected: 0 })
  const [loading,        setLoading]        = useState(true)
  const [pendingReports, setPendingReports] = useState(MOCK_PENDING_REPORTS)
  const [trucks,         setTrucks]         = useState(MOCK_TRUCKS)
  const [activeMainTab,  setActiveMainTab]  = useState('validation')
  const [reportFilter,   setReportFilter]   = useState('All')
  const [expandedReport, setExpandedReport] = useState(null)
  const [expandedTruck,  setExpandedTruck]  = useState(null)
  const [toast,          setToast]          = useState(null)

  useEffect(() => {
    api.get('/api/brgy/stats/').catch(() => {}).finally(() => setLoading(false))
  }, [])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleApprove(id) {
    setPendingReports(prev => prev.filter(r => r.id !== id))
    setExpandedReport(null)
    showToast('✅ Report approved and added to driver schedule.')
  }

  function handleReject(id) {
    setPendingReports(prev => prev.filter(r => r.id !== id))
    setExpandedReport(null)
    showToast('✕ Report rejected.')
  }

  function handleFlagTruck(truckId) {
    setTrucks(prev => prev.map(t => t.id === truckId ? { ...t, flagged: true } : t))
    showToast('🚩 Truck flagged. Admin has been notified.')
  }

  useEffect(() => {
  if (activeMainTab !== "trucks") return
  const timer = setTimeout(() => {
    trucksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, 80)
  return () => clearTimeout(timer)
}, [activeMainTab])

  const pendingCount = pendingReports.length
  const missedCount  = trucks.filter(t => t.missedYesterday).length

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
        .bcard { transition: box-shadow .18s, border-color .18s; }
        .bcard:hover { box-shadow: 0 4px 18px rgba(0,0,0,.09); }
        .abtn { transition: opacity .15s, transform .1s; cursor:pointer; }
        .abtn:hover { opacity:.88; }
        .abtn:active { transform:scale(.97); }
        .fpill { transition: all .15s; cursor:pointer; }
        .fpill:hover { opacity:.85; }
      `}</style>

      {/* ── Toast notification ── */}
      {toast && (
        <div style={{
          position:'fixed', top:70, left:'50%', transform:'translateX(-50%)',
          background:'#0f172a', color:'#fff', padding:'10px 22px',
          borderRadius:12, zIndex:9999, fontSize:13, fontWeight:600,
          border:'1px solid rgba(20,184,166,0.3)',
          boxShadow:'0 8px 32px rgba(0,0,0,.35)',
          whiteSpace:'nowrap', animation:'fadeSlideIn .2s',
        }}>
          {toast}
        </div>
      )}

      <div className="page">

        {/* ── PAGE HEADER ── */}
        <div style={{ marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:3 }}>
            <h2 style={{ fontFamily:'var(--font-head)', fontSize:22, fontWeight:800, margin:0 }}>
              Barangay Dashboard
            </h2>
            <span style={{
              background:'rgba(46,204,113,0.1)', color:'var(--accent)',
              border:'1px solid rgba(46,204,113,0.28)',
              fontSize:9, fontWeight:800, padding:'3px 10px',
              borderRadius:20, letterSpacing:'.08em',
            }}>OFFICIAL</span>
          </div>
          <p className="text-muted text-sm">
            {user?.barangay_name || 'Your Barangay'} · Monitor, validate &amp; coordinate
          </p>
        </div>

        <div className="mobile-schedule">
              <div className="card card-dark" style={{ textAlign: 'center', padding: '28px 20px' }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 6, color:'white' }}>
                  Report a Garbage Issue
                </h3>
                <p className="text-muted text-sm" style={{ marginBottom: 20,color:'white' }}>
                  See uncollected waste or illegal dumping? Let us know
                </p>
                <div className="btn-row" style={{ justifyContent: 'center' }}>
                  <button className="btn btn-outline" style={{backgroundColor:'white'}} onClick={() => navigate('/report/submit')}>
                    Submit Report
                  </button>
                  <button className="btn btn-primary" onClick={() => navigate('/brgy/validate-reports')}>
                    Validate Reports
                  </button>
                </div>
              </div>
            </div>

        

        <div className="page-grid">

          {/* ════════════════════════════════════════
              MAIN COLUMN
          ════════════════════════════════════════ */}
          <div>

            {/* ── STAT CARDS ── */}
            <div className="stat-grid" style={{ marginBottom:20 }}>
              {[
                { label:'Pending Validation', value:pendingCount,       color:'var(--warning)', icon:'📋' },
                { label:'Approved',           value:stats.approved||0,  color:'var(--accent)',  icon:'✅' },
                { label:'Rejected',           value:stats.rejected||0,  color:'var(--danger)',  icon:'✕'  },
                { label:'Missed Pickups',     value:missedCount,        color:'var(--danger)',  icon:'🚩' },
              ].map(s => (
                <div key={s.label} className="stat-card" style={{ position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', top:12, right:14, fontSize:18, opacity:.15 }}>{s.icon}</div>
                  <div className="label">{s.label}</div>
                  <div className="value" style={{ color:s.color, fontSize:30 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* ── MISSED COLLECTION ALERT BAR ── */}
            {missedCount > 0 && (
              <div style={{
                background:'rgba(231,76,60,0.05)',
                border:'1.5px solid rgba(231,76,60,0.28)',
                borderRadius:12, padding:'12px 16px', marginBottom:18,
                display:'flex', alignItems:'center', gap:12,
                animation:'fadeSlideIn .25s',
              }}>
                <div style={{
                  width:38, height:38, borderRadius:10, flexShrink:0,
                  background:'rgba(231,76,60,0.1)',
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:18,
                }}>⚠️</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--danger)', marginBottom:1 }}>
                    {missedCount} missed collection{missedCount > 1 ? 's' : ''} detected yesterday
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>
                    Review Truck Monitor — flag or escalate to Admin if needed.
                  </div>
                </div>
                <button className="abtn"
                  onClick={() => setActiveMainTab('trucks')}
                  style={{
                    background:'var(--danger)', color:'#fff', border:'none',
                    borderRadius:8, padding:'7px 14px', fontSize:12, fontWeight:700, flexShrink:0,
                  }}>
                  Review
                </button>
              </div>
            )}

            {/* ── LIVE MAP ── */}
            <div style={{ marginBottom:24 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <h3 className="section-title" style={{ margin:0 }}>Live Collection Map</h3>
                <button onClick={() => navigate('/map')}
                  style={{ background:'none', border:'none', color:'var(--accent)',
                    fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  Full View ›
                </button>
              </div>
              <MiniMap />
            </div>

            {/* ── MAIN TABS — pill style ── */}
            <div style={{
              display:'flex', gap:4, marginBottom:16,
              background:'var(--surface-2)', borderRadius:10, padding:4,
              width:'fit-content', flexWrap:'wrap',
            }}>
              {[
                { key:'validation', label:'Validate Reports', badge: pendingCount||null },
                { key:'trucks',     label:'Truck Monitor',    badge: missedCount>0?'!':null },
                { key:'schedule',   label:'Schedule' },
              ].map(t => (
                <button key={t.key}
                  className="abtn"
                  onClick={() => setActiveMainTab(t.key)}
                  style={{
                    position:'relative', padding:'8px 16px', borderRadius:8,
                    border:'none', fontFamily:'var(--font-body)', fontSize:13, fontWeight:600,
                    background: activeMainTab===t.key ? 'var(--surface-3)' : 'transparent',
                    color:      activeMainTab===t.key ? '#fff' : 'var(--text-muted)',
                    boxShadow:  activeMainTab===t.key ? '0 2px 8px rgba(0,0,0,.15)' : 'none',
                  }}>
                  {t.label}
                  {t.badge && (
                    <span style={{
                      position:'absolute', top:5, right:5,
                      minWidth:15, height:15, background:t.badge==='!'?'var(--danger)':'var(--warning)',
                      color:'#fff', fontSize:8, fontWeight:800, borderRadius:20,
                      display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px',
                    }}>{t.badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ════════════════════════════════════════
                TAB 1 — REPORT VALIDATION
            ════════════════════════════════════════ */}
            {activeMainTab === 'validation' && (
              <div style={{ animation:'slideDown .2s' }}>

                {/* Filter pills */}
                <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
                  {['All','Pending','Approved','Rejected'].map(f => (
                    <button key={f} className="fpill"
                      onClick={() => setReportFilter(f)}
                      style={{
                        padding:'5px 14px', borderRadius:20, border:'1px solid',
                        fontSize:12, fontWeight:600, fontFamily:'var(--font-body)',
                        borderColor: reportFilter===f ? 'var(--accent)' : 'var(--border)',
                        color:       reportFilter===f ? 'var(--accent)' : 'var(--text-muted)',
                        background:  reportFilter===f ? 'rgba(46,204,113,0.08)' : 'transparent',
                      }}>
                      {f}
                    </button>
                  ))}
                  <button onClick={() => navigate('/brgy/validate-reports')}
                      style={{
                        border:'1px dashed var(--border)', borderRadius:20,
                        padding:'11px', fontSize:12, fontWeight:600,
                        marginLeft:'auto', background:'transparent',
                        color:'var(--text-muted)', cursor:'pointer', marginTop:4,
                        fontFamily:'var(--font-body)',
                      }}>
                      View All Reports
                  </button>
                </div>

                {pendingReports.length === 0 ? (
                  <div className="card" style={{ textAlign:'center', padding:'40px 20px' }}>
                    <div style={{ fontSize:42, marginBottom:12 }}>✅</div>
                    <div style={{ fontWeight:700, marginBottom:4 }}>All caught up!</div>
                    <div className="text-muted text-sm">No pending reports to validate.</div>
                  </div>
                ) : (
                  <>
                    {pendingReports.map(report => (
                      <div key={report.id} className="bcard"
                        style={{
                          background:'var(--surface)',
                          border: expandedReport===report.id
                            ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                          borderRadius:14, marginBottom:10,
                          overflow:'hidden', cursor:'pointer',
                        }}
                        onClick={() => setExpandedReport(p => p===report.id ? null : report.id)}
                      >
                        {/* Row */}
                        <div style={{ padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
                          <div style={{
                            width:40, height:40, borderRadius:10, flexShrink:0,
                            background: report.type==='overflow' ? 'rgba(239,68,68,0.1)'
                              : report.type==='illegal_dumping' ? 'rgba(243,156,18,0.1)'
                              : 'rgba(93,173,226,0.1)',
                            display:'flex', alignItems:'center', justifyContent:'center', fontSize:18,
                          }}>{ISSUE_ICONS[report.type]}</div>

                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap', marginBottom:2 }}>
                              <span style={{ fontWeight:700, fontSize:14 }}>{ISSUE_LABELS[report.type]}</span>
                              <span style={{
                                background:'rgba(243,156,18,0.1)', color:'var(--warning)',
                                fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:20, letterSpacing:'.05em',
                              }}>PENDING</span>
                              {report.photo && <span style={{ fontSize:11 }}>📷</span>}
                            </div>
                            <div style={{ fontSize:12, color:'var(--text-muted)' }}>{report.address}</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>
                              {report.reporter} · {report.date}
                            </div>
                          </div>

                          <div style={{
                            fontSize:16, color:'var(--text-muted)',
                            transform: expandedReport===report.id ? 'rotate(90deg)' : 'rotate(0)',
                            transition:'transform .2s',
                          }}>›</div>
                        </div>

                        {/* Expanded */}
                        {expandedReport === report.id && (
                          <div style={{ borderTop:'1px solid var(--border)', padding:'14px 16px', animation:'slideDown .18s' }}
                            onClick={e => e.stopPropagation()}>
                            <p style={{ fontSize:13, lineHeight:1.65, marginBottom:12, fontStyle:'italic', color:'var(--text-muted)' }}>
                              "{report.description}"
                            </p>
                            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
                              {report.tags.map(tag => (
                                <span key={tag} style={{
                                  background:'var(--bg)', border:'1px solid var(--border)',
                                  borderRadius:20, fontSize:11, padding:'3px 10px', color:'var(--text-muted)',
                                }}>{tag}</span>
                              ))}
                            </div>
                            <div style={{
                              background:'rgba(20,184,166,0.05)', border:'1px solid rgba(20,184,166,0.18)',
                              borderRadius:8, padding:'9px 12px', marginBottom:14,
                              fontSize:12, color:'var(--text-muted)', lineHeight:1.6,
                            }}>
                              <strong style={{ color:'var(--text)' }}>💡 Validate:</strong> Is this a real issue in your barangay? Approving adds it to the driver's route.
                            </div>
                            <div style={{ display:'flex', gap:8 }}>
                              <button className="abtn"
                                onClick={() => handleApprove(report.id)}
                                style={{
                                  flex:1, background:'var(--accent)', color:'#0d1117',
                                  border:'none', borderRadius:10, padding:'10px',
                                  fontWeight:700, fontSize:13,
                                }}>
                                ✅ Approve
                              </button>
                              <button className="abtn"
                                onClick={() => handleReject(report.id)}
                                style={{
                                  flex:1, background:'transparent',
                                  border:'1.5px solid var(--danger)',
                                  color:'var(--danger)', borderRadius:10, padding:'10px',
                                  fontWeight:700, fontSize:13,
                                }}>
                                ✕ Reject
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    
                  </>
                )}
              </div>
            )}

            {/* ════════════════════════════════════════
                TAB 2 — TRUCK MONITOR
            ════════════════════════════════════════ */}
            {activeMainTab === 'trucks' && (
              <div ref={trucksRef} style={{ animation:'slideDown .2s' }}>
                <button onClick={() => navigate('/')}
                      style={{
                        display:'block',
                        marginBottom:14,
                        border:'1px dashed var(--border)', borderRadius:20,
                        padding:'11px', fontSize:12, fontWeight:600,
                        marginLeft:'auto', background:'transparent',
                        color:'var(--text-muted)', cursor:'pointer', marginTop:4,
                        fontFamily:'var(--font-body)',
                      }}>
                      View Trucks In Area
                </button>

                {trucks.map(truck => (
                  <div key={truck.id} className="bcard"
                    style={{
                      background:'var(--surface)',
                      border: truck.missedYesterday
                        ? '1.5px solid rgba(231,76,60,0.4)' : '1px solid var(--border)',
                      borderRadius:14, marginBottom:10,
                      overflow:'hidden', cursor:'pointer',
                    }}
                    onClick={() => setExpandedTruck(p => p===truck.id ? null : truck.id)}
                  >
                    {/* Row */}
                    <div style={{ padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{
                        width:40, height:40, borderRadius:10, flexShrink:0,
                        background:'var(--surface-2)',
                        display:'flex', alignItems:'center', justifyContent:'center', fontSize:20,
                      }}>🚛</div>

                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap', marginBottom:2 }}>
                          <span style={{ fontWeight:700, fontSize:14 }}>{truck.label}</span>
                          <span style={{
                            display:'inline-flex', alignItems:'center', gap:4,
                            background:`${STATUS_COLORS[truck.status]}18`,
                            border:`1px solid ${STATUS_COLORS[truck.status]}55`,
                            color:STATUS_COLORS[truck.status],
                            fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:20, letterSpacing:'.04em',
                          }}>
                            <span style={{
                              width:5, height:5, borderRadius:'50%',
                              background:STATUS_COLORS[truck.status], display:'inline-block',
                            }}/>
                            {STATUS_LABELS[truck.status]}
                          </span>
                          {truck.missedYesterday && (
                            <span style={{
                              background:'rgba(231,76,60,0.1)', color:'var(--danger)',
                              fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:20,
                            }}>⚠️ MISSED</span>
                          )}
                          {truck.flagged && (
                            <span style={{
                              background:'rgba(243,156,18,0.1)', color:'var(--warning)',
                              fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:20,
                            }}>🚩 FLAGGED</span>
                          )}
                        </div>
                        <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                          {truck.driver} · Sched. {truck.scheduledTime}
                          {truck.actualTime !== '—' ? ` · Started ${truck.actualTime}` : ''}
                        </div>
                      </div>

                      <div style={{ textAlign:'right', flexShrink:0, marginRight:6 }}>
                        <div style={{ fontSize:15, fontWeight:800 }}>
                          {truck.stopsCompleted}
                          <span style={{ color:'var(--text-muted)', fontWeight:400, fontSize:12 }}>
                            /{truck.totalStops}
                          </span>
                        </div>
                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>stops</div>
                      </div>

                      <div style={{
                        fontSize:16, color:'var(--text-muted)',
                        transform: expandedTruck===truck.id ? 'rotate(90deg)' : 'rotate(0)',
                        transition:'transform .2s',
                      }}>›</div>
                    </div>

                    {/* Expanded truck detail */}
                    {expandedTruck === truck.id && (
                      <div style={{ borderTop:'1px solid var(--border)', padding:'14px 16px', animation:'slideDown .18s' }}
                        onClick={e => e.stopPropagation()}>

                        {/* Progress */}
                        <div style={{ marginBottom:12 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                            <span style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', letterSpacing:'.06em' }}>ROUTE PROGRESS</span>
                            <span style={{ fontSize:12, fontWeight:700 }}>
                              {Math.round((truck.stopsCompleted/truck.totalStops)*100)}%
                            </span>
                          </div>
                          <div style={{ background:'var(--border)', borderRadius:20, height:7, overflow:'hidden' }}>
                            <div style={{
                              height:'100%', borderRadius:20,
                              width:`${(truck.stopsCompleted/truck.totalStops)*100}%`,
                              background:'linear-gradient(90deg,var(--accent),#14b8a6)',
                              transition:'width .4s',
                            }}/>
                          </div>
                        </div>

                        {/* Capacity */}
                        <div style={{ marginBottom:14 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                            <span style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', letterSpacing:'.06em' }}>CAPACITY</span>
                            <span style={{
                              fontSize:12, fontWeight:700,
                              color:truck.capacity>80?'var(--danger)':'var(--text-muted)',
                            }}>{truck.capacity}%</span>
                          </div>
                          <div style={{ background:'var(--border)', borderRadius:20, height:7, overflow:'hidden' }}>
                            <div style={{
                              height:'100%', borderRadius:20,
                              width:`${truck.capacity}%`,
                              background: truck.capacity>80?'var(--danger)':truck.capacity>60?'var(--warning)':'var(--accent)',
                              transition:'width .4s',
                            }}/>
                          </div>
                        </div>

                        {/* Compliance note */}
                        <div style={{
                          background: truck.missedYesterday?'rgba(231,76,60,0.05)':'rgba(46,204,113,0.05)',
                          border:`1px solid ${truck.missedYesterday?'rgba(231,76,60,0.2)':'rgba(46,204,113,0.2)'}`,
                          borderRadius:8, padding:'9px 12px', marginBottom:14,
                          fontSize:12, lineHeight:1.6, color:'var(--text-muted)',
                        }}>
                          {truck.missedYesterday
                            ? <><strong style={{ color:'var(--danger)' }}>⚠️ Missed collection yesterday.</strong> This truck did not complete its route.</>
                            : <><strong style={{ color:'var(--accent)' }}>✅ On schedule.</strong> No missed collections in the past 7 days.</>
                          }
                        </div>

                        {/* ── 3 ACTION BUTTONS ── */}
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>

                          {/* 1. Track on Map */}
                          <button className="abtn"
                            onClick={() => navigate('/map')}
                            style={{
                              flex:1, minWidth:90,
                              background:'rgba(20,184,166,0.08)',
                              border:'1px solid rgba(20,184,166,0.35)',
                              color:'var(--accent)', borderRadius:10,
                              padding:'9px 8px', fontWeight:700, fontSize:12,
                            }}>
                            🗺 Track on Map
                          </button>

                          {/* 2. Flag to Admin */}
                          {!truck.flagged ? (
                            <button className="abtn"
                              onClick={() => handleFlagTruck(truck.id)}
                              style={{
                                flex:1, minWidth:90,
                                background:'rgba(231,76,60,0.06)',
                                border:'1px solid rgba(231,76,60,0.35)',
                                color:'var(--danger)', borderRadius:10,
                                padding:'9px 8px', fontWeight:700, fontSize:12,
                              }}>
                              🚩 Flag to Admin
                            </button>
                          ) : (
                            <button disabled style={{
                              flex:1, minWidth:90,
                              background:'rgba(243,156,18,0.05)',
                              border:'1px solid rgba(243,156,18,0.3)',
                              color:'var(--warning)', borderRadius:10,
                              padding:'9px 8px', fontWeight:700, fontSize:12, opacity:.55,
                            }}>
                              🚩 Flagged
                            </button>
                          )}

                          {/* 3. Escalate to Admin — ONLY when truck missed yesterday */}
                          {truck.missedYesterday && (
                            <button className="abtn"
                              onClick={() => navigate('/brgy/escalate', { state: { truckLabel: truck.label, driver: truck.driver } })}
                              style={{
                                flex:'1 1 100%',   /* full width below the first two */
                                background:'rgba(231,76,60,0.07)',
                                border:'1.5px solid rgba(231,76,60,0.38)',
                                color:'var(--danger)', borderRadius:10,
                                padding:'9px', fontWeight:700, fontSize:12,
                              }}>
                              📨 Escalate to Admin
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ════════════════════════════════════════
                TAB 3 — SCHEDULE
            ════════════════════════════════════════ */}
            {activeMainTab === 'schedule' && (
              <div>
                <button onClick={() => navigate('/')}
                  style={{
                    display:'block',
                    marginBottom:14,marginTop:4, marginLeft:'auto',
                    border:'1px dashed var(--border)', borderRadius:20,
                    padding:'11px', fontSize:12, fontWeight:600,
                    background:'transparent',
                    color:'var(--text-muted)', cursor:'pointer', 
                    fontFamily:'var(--font-body)',
                  }}>
                  View Brgy Collection Schedule
                </button>
                <div className="card" style={{ padding:16, animation:'slideDown .2s' }}>
                  {MOCK_SCHEDULE.map((s, i) => (
                    <div key={i} style={{
                      display:'flex', alignItems:'center', gap:12, padding:'12px 0',
                      borderBottom: i < MOCK_SCHEDULE.length-1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{
                        width:36, height:36, borderRadius:10, flexShrink:0,
                        background: s.done ? 'rgba(46,204,113,0.12)' : 'var(--surface-2)',
                        display:'flex', alignItems:'center', justifyContent:'center', fontSize:16,
                      }}>
                        {s.done ? '✅' : '📅'}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600, fontSize:14 }}>{s.day}</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                          {s.zone} · {user?.barangay_name || 'Barangay'}
                        </div>
                      </div>
                      <div style={{ fontSize:12, fontWeight:600, textAlign:'right', marginRight:8,
                        color: s.time==='No Schedule' ? 'var(--text-muted)' : 'var(--text)' }}>
                        {s.time}
                      </div>
                      <span style={{
                        fontSize:9, fontWeight:800, padding:'3px 8px', borderRadius:20,
                        letterSpacing:'.05em', flexShrink:0,
                        background: s.done ? 'rgba(46,204,113,0.1)'
                          : s.time==='No Schedule' ? 'rgba(148,163,184,0.1)'
                          : 'rgba(243,156,18,0.1)',
                        color: s.done ? 'var(--accent)'
                          : s.time==='No Schedule' ? 'var(--text-muted)'
                          : 'var(--warning)',
                      }}>
                        {s.done ? 'DONE' : s.time==='No Schedule' ? 'N/A' : 'UPCOMING'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>{/* end main column */}

          {/* ════════════════════════════════════════
              SIDEBAR (desktop only)
          ════════════════════════════════════════ */}
          <div className="sidebar">
            <div className="card">
              <h3 className="section-title" style={{ marginBottom:12, fontSize:15 }}>Quick Actions</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <button className="abtn btn btn-full"
                  onClick={() => navigate('/map')}
                  style={{
                    background:'rgba(20,184,166,0.08)', border:'1px solid rgba(20,184,166,0.35)',
                    color:'var(--accent)', fontWeight:700,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                  }}>
                  🗺 View Live Map
                </button>
                <button className="abtn btn btn-full"
                  onClick={() => navigate('/brgy/escalate')}
                  style={{
                    background:'rgba(231,76,60,0.06)', border:'1px solid rgba(231,76,60,0.35)',
                    color:'var(--danger)', fontWeight:700,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                  }}>
                  📨 Escalate to Admin
                </button>
              </div>
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom:12, fontSize:15 }}>Pending Summary</h3>
              {[
                { label:'Reports to Validate', value:pendingCount,                       color:'var(--warning)' },
                { label:'Missed Collections',  value:missedCount,                        color:'var(--danger)'  },
                { label:'Flagged Trucks',      value:trucks.filter(t=>t.flagged).length, color:'var(--warning)' },
              ].map(s => (
                <div key={s.label} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'9px 0', borderBottom:'1px solid var(--border)',
                }}>
                  <span style={{ fontSize:12, color:'var(--text-muted)' }}>{s.label}</span>
                  <span style={{ fontSize:18, fontWeight:800, color:s.color, fontFamily:'var(--font-head)' }}>
                    {s.value}
                  </span>
                </div>
              ))}
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom:12, fontSize:15 }}>Collection Schedule</h3>
              {MOCK_SCHEDULE.map((s, i) => (
                <div key={i} style={{
                  display:'flex', alignItems:'center', gap:10, padding:'10px 0',
                  borderBottom: i < MOCK_SCHEDULE.length-1 ? '1px solid var(--border)' : 'none',
                }}>
                  <span style={{ fontSize:14 }}>{s.done ? '✅' : '📅'}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>{s.day}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)' }}>{s.zone}</div>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'right' }}>{s.time}</div>
                </div>
              ))}
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom:12, fontSize:15 }}>Your Profile</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <div>
                  <div className="form-label">Name</div>
                  <div style={{ fontSize:14, fontWeight:600 }}>{user?.full_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Email</div>
                  <div className="text-muted text-sm">{user?.email}</div>
                </div>
                <div>
                  <div className="form-label">Barangay</div>
                  <div style={{ fontSize:14 }}>{user?.barangay_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Role</div>
                  <span style={{
                    background:'rgba(46,204,113,0.1)', color:'var(--accent)',
                    border:'1px solid rgba(46,204,113,0.25)',
                    fontSize:9, fontWeight:800, padding:'3px 10px',
                    borderRadius:20, letterSpacing:'.07em', display:'inline-block',
                  }}>BARANGAY OFFICIAL</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}