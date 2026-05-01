/**
 * CitizenDashboard.jsx — Citizen / Resident Dashboard
 * -----------------------------------------------------
 * Route: /dashboard  (or /citizen/dashboard if role-split)
 *
 * Simplified for non-technical residents:
 *  - Hero action card (report + view map)
 *  - Personalized stat cards (my reports, nearby, next collection)
 *  - MiniMap as focal point
 *  - Nearby Hotspots list (read-only, no actions)
 *  - My Reports (status only, no approve/reject)
 *  - Notification preview
 *  - Collection schedule (highlighted next day)
 */

import { useState, useEffect } from 'react'
import { useNavigate }         from 'react-router-dom'
import MiniMap                 from '../../components/MiniMap'
import { useAuth }             from '../../context/AuthContext'
import api                     from '../../api/client'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_MY_REPORTS = [
  {
    id: 1, type: 'overflow', typeLabel: 'Garbage Overflow',
    address: 'Baranggay 1, 5th Ave', date: '2026-04-18',
    status: 'pending', statusLabel: 'Pending Review',
  },
  {
    id: 2, type: 'illegal_dumping', typeLabel: 'Illegal Dumping',
    address: 'Near the river bank, Zone 2', date: '2026-04-15',
    status: 'resolved', statusLabel: 'Resolved',
  },
  {
    id: 3, type: 'missed', typeLabel: 'Missed Collection',
    address: 'Purok 4 — Side Street', date: '2026-04-12',
    status: 'approved', statusLabel: 'Approved',
  },
]

const MOCK_HOTSPOTS = [
  { id: 1, address: 'Baranggay 1, 5th Ave',    type: 'Garbage Overflow',  distance: '0.3 KM', severity: 'high'   },
  { id: 2, address: 'Baranggay 1, Main Road',  type: 'Illegal Dumping',   distance: '0.6 KM', severity: 'medium' },
  { id: 3, address: 'Baranggay 1, Side Street',type: 'Missed Collection',  distance: '0.9 KM', severity: 'low'    },
  { id: 4, address: 'Baranggay 1, 8th Ave',    type: 'Garbage Overflow',  distance: '1.2 KM', severity: 'high'   },
]


const MOCK_SCHEDULE = [
  { day: 'Monday',    zone: 'Baranggay Isabang', time: '6:00 AM – 10:00 AM', isNext: true,  done: false },
  { day: 'Wednesday', zone: 'Baranggay Isabang', time: 'N/A',                isNext: false, done: false },
  { day: 'Friday',    zone: 'Baranggay Isabang', time: '6:00 AM – 10:00 AM', isNext: false, done: false },
]

const STATUS_META = {
  pending:  { label: 'Pending',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  approved: { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.1)'   },
  resolved: { label: 'Resolved', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'  },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
}

const TYPE_ICONS = {
  overflow:        '🗑️',
  illegal_dumping: '🚯',
  missed:          '📭',
}

const SEVERITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CitizenDashboard() {
  const { user }   = useAuth()
  const navigate   = useNavigate()

  const [myReports,      setMyReports]      = useState(MOCK_MY_REPORTS)
  const [stats,          setStats]          = useState({ total: 3, pending: 1, resolved: 1 })
  const [loading,        setLoading]        = useState(true)
  const [reportsTab,     setReportsTab]     = useState('all')   // all | pending | resolved

  const nextDay     = MOCK_SCHEDULE.find(s => s.isNext)

  useEffect(() => {
    Promise.all([
      api.get('/api/watcher/reports/').catch(() => ({ data: [] })),
      api.get('/api/watcher/stats/').catch(() => ({ data: stats })),
    ])
      .then(([r, s]) => {
        if (r.data?.length) setMyReports(r.data.slice(0, 5))
        if (s.data)         setStats(s.data)
      })
      .finally(() => setLoading(false))
  }, [])


  const filteredReports = myReports.filter(r => {
    if (reportsTab === 'all')     return true
    if (reportsTab === 'pending') return r.status === 'pending'
    if (reportsTab === 'done')    return r.status === 'resolved' || r.status === 'approved'
    return true
  })

  return (
    <>

      <style>{`
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .cd-card { transition: box-shadow .18s; }
        .cd-card:hover { box-shadow: 0 6px 24px rgba(0,0,0,.09); }
        .cd-btn  { transition: opacity .15s, transform .1s; cursor:pointer; }
        .cd-btn:hover  { opacity:.88; }
        .cd-btn:active { transform:scale(.97); }
        .cd-tab  { transition:all .15s; cursor:pointer; }
        .cd-tab:hover { opacity:.85; }
        .cd-row  { transition:background .12s; cursor:pointer; }
        .cd-row:hover  { background:rgba(0,0,0,.02); }
      `}</style>

      <div className="page">

        {/* ── GREETING ── */}
        <div style={{ marginBottom:20 }}>
          <h2 style={{ fontFamily:'var(--font-head)', fontSize:22, fontWeight:800, marginBottom:2 }}>
            Hello, {user?.full_name?.split(' ')[0] || 'Resident'} 
          </h2>
          <p className="text-muted text-sm">
            {user?.barangay_name || 'Your Barangay'} · Stay updated on waste collection in your area
          </p>
        </div>

        <div className="page-grid">
          <div>

            {/* ══════════════════════════════════════
                HERO CARD — primary action
            ══════════════════════════════════════ */}
            <div className='mobile-schedule'>
              <div className="card card-dark cd-card" style={{ padding:'24px 20px', marginBottom:16 }}>
                {/* Icon row */}  
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                  <div>
                    <div style={{ color:'white', fontWeight:800, fontSize:16,
                      fontFamily:'var(--font-head)', lineHeight:1.2 }}>
                      See garbage that needs attention?
                    </div>
                    <div style={{ color:'rgba(255,255,255,0.55)', fontSize:12, marginTop:2 }}>
                      Let your barangay know — it only takes a minute.
                    </div>
                  </div>
                </div>

                {/* Buttons */}
                <div style={{ display:'flex', gap:10 }}>
                  <button className="cd-btn btn btn-primary"
                    style={{ flex:2, fontWeight:700, fontSize:13 }}
                    onClick={() => navigate('/report/submit')}>
                    📸 Report Issue
                  </button>
                  <button className="cd-btn btn"
                    style={{
                      flex:1, fontWeight:600, fontSize:13,
                      background:'rgba(255,255,255,0.12)',
                      border:'1px solid rgba(255,255,255,0.2)',
                      color:'white',
                    }}
                    onClick={() => navigate('/map')}>
                    🗺 View Map
                  </button>
                </div>
              </div>
            </div>

            {/* ══════════════════════════════════════
                PERSONALIZED STAT CARDS
            ══════════════════════════════════════ */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>

              <div className="cd-card" style={{
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:14, padding:'14px 12px', textAlign:'center',
                cursor:'pointer',
              }} onClick={() => {
                document.getElementById('my-reports-section')?.scrollIntoView({ behavior:'smooth' })
              }}>
                <div style={{padding:"20px",
                  fontFamily:'var(--font-head)', fontSize:28, fontWeight:800,
                  lineHeight:1, marginBottom:4,
                }}>{stats.total || myReports.length}</div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)',
                  textTransform:'uppercase', letterSpacing:'.06em' }}>My Reports</div>
              </div>

              <div className="cd-card" style={{
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:14, padding:'14px 12px', textAlign:'center',
                cursor:'pointer',
              }} onClick={() => {
                document.getElementById('hotspots-section')?.scrollIntoView({ behavior:'smooth' })
              }}>
                <div style={{padding:"20px",
                  fontFamily:'var(--font-head)', fontSize:28, fontWeight:800,
                  lineHeight:1, marginBottom:4, color:'var(--warning)',
                }}>{MOCK_HOTSPOTS.length}</div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)',
                  textTransform:'uppercase', letterSpacing:'.06em' }}>Hotspots</div>
              </div>

              <div className="cd-card" style={{
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:14, padding:'14px 12px', textAlign:'center',
                cursor:'pointer',
              }} onClick={() => {
                document.getElementById('schedule-section')?.scrollIntoView({ behavior:'smooth' })
              }}>
                <div style={{
                  padding:"20px",
                  fontFamily:'var(--font-head)', fontSize:16, fontWeight:800,
                  lineHeight:1.1, marginBottom:4, color:'var(--accent)',
                }}>
                  {nextDay ? nextDay.day : 'N/A'}
                </div>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)',
                  textTransform:'uppercase', letterSpacing:'.06em' }}>Next Pickup</div>
              </div>
            </div>

            {/* ══════════════════════════════════════
                MAP — FOCAL POINT
            ══════════════════════════════════════ */}
            <div style={{ marginBottom:20 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <h3 className="section-title" style={{ margin:0 }}>Nearby Collection Points</h3>
                <button onClick={() => navigate('/map')}
                  style={{ background:'none', border:'none', color:'var(--accent)',
                    fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  Open Live Map ›
                </button>
              </div>
              <MiniMap />
            </div>

            {/* ══════════════════════════════════════
                NEARBY HOTSPOTS
            ══════════════════════════════════════ */}
            <div id="hotspots-section" style={{ marginBottom:20 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <h3 className="section-title" style={{ margin:0 }}>Nearby Hotspots</h3>
                <span style={{
                  background:'rgba(239,68,68,0.1)', color:'var(--danger)',
                  fontSize:10, fontWeight:700, padding:'3px 10px',
                  borderRadius:20,
                }}>{MOCK_HOTSPOTS.length} Active</span>
              </div>

              <div className="card" style={{ padding:0, overflow:'hidden' }}>
                {MOCK_HOTSPOTS.map((h, i) => (
                  <div key={h.id} className="cd-row"
                    style={{
                      display:'flex', alignItems:'center', gap:12,
                      padding:'12px 16px',
                      borderBottom: i < MOCK_HOTSPOTS.length-1 ? '1px solid var(--border)' : 'none',
                    }}>
                    {/* Pin icon with severity color */}
                    <div style={{
                      width:36, height:36, borderRadius:10, flexShrink:0,
                      background:`${SEVERITY_COLORS[h.severity]}15`,
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}>
                      <span style={{ fontSize:18 }}>📍</span>
                    </div>

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:14, marginBottom:1 }}>
                        {h.address}
                      </div>
                      <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                        {h.type}
                      </div>
                    </div>

                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)' }}>
                        {h.distance}
                      </div>
                      <div style={{
                        width:8, height:8, borderRadius:'50%',
                        background:SEVERITY_COLORS[h.severity],
                        marginLeft:'auto', marginTop:4,
                        boxShadow:`0 0 5px ${SEVERITY_COLORS[h.severity]}`,
                      }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ══════════════════════════════════════
                MY REPORTS
            ══════════════════════════════════════ */}
            <div id="my-reports-section" style={{ marginBottom:20 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <h3 className="section-title" style={{ margin:0 }}>My Reports</h3>
                <button className="new-rptr-btn" onClick={() => navigate('/report/submit')}
                  style={{ background:'none', border:'none', color:'var(--accent)',
                    fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  + New Report
                </button>
              </div>

              {/* Filter tabs */}
              <div style={{
                display:'flex', gap:4, marginBottom:12,
                background:'var(--surface-2)', borderRadius:10, padding:4,
                width:'fit-content',
              }}>
                {[
                  { key:'all',     label:'All'      },
                  { key:'pending', label:'Pending'  },
                  { key:'done',    label:'Done'     },
                ].map(t => (
                  <button key={t.key} className="cd-tab"
                    onClick={() => setReportsTab(t.key)}
                    style={{
                      padding:'6px 14px', borderRadius:8, border:'none',
                      fontFamily:'var(--font-body)', fontSize:12, fontWeight:600,
                      background: reportsTab===t.key ? 'var(--surface-3)' : 'transparent',
                      color:      reportsTab===t.key ? '#fff' : 'var(--text-muted)',
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="card" style={{ padding:0, overflow:'hidden' }}>
                {loading ? (
                  <div style={{ padding:'32px', textAlign:'center' }}>
                    <div className="spinner" style={{ margin:'0 auto' }}/>
                  </div>
                ) : filteredReports.length === 0 ? (
                  <div style={{ padding:'32px 20px', textAlign:'center' }}>
                    <div style={{ fontSize:40, marginBottom:10 }}>📭</div>
                    <div style={{ fontWeight:600, marginBottom:4 }}>No reports here yet</div>
                    <div className="text-muted text-sm">See something? Tap "Report Issue" to let us know.</div>
                    <button className="cd-btn btn btn-primary"
                      style={{ marginTop:14, fontSize:12 }}
                      onClick={() => navigate('/report/submit')}>
                      📸 Submit a Report
                    </button>
                  </div>
                ) : (
                  filteredReports.map((report, i) => {
                    const sm = STATUS_META[report.status] || STATUS_META.pending
                    return (
                      <div key={report.id} className="cd-row"
                        style={{
                          display:'flex', alignItems:'center', gap:12,
                          padding:'12px 16px',
                          borderBottom: i < filteredReports.length-1 ? '1px solid var(--border)' : 'none',
                        }}
                        onClick={() => navigate(`/report/${report.id}`)}>

                        {/* Icon */}
                        <div style={{
                          width:38, height:38, borderRadius:10, flexShrink:0,
                          background:'rgba(239,68,68,0.08)',
                          display:'flex', alignItems:'center', justifyContent:'center', fontSize:18,
                        }}>
                          {TYPE_ICONS[report.type] || '📍'}
                        </div>

                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:600, fontSize:14, marginBottom:2 }}>
                            {report.typeLabel}
                          </div>
                          <div style={{ fontSize:12, color:'var(--text-muted)',
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {report.address || report.barangay_name}
                          </div>
                        </div>

                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <span style={{
                            display:'block',
                            background:sm.bg, color:sm.color,
                            fontSize:9, fontWeight:800, padding:'3px 9px',
                            borderRadius:20, letterSpacing:'.05em',
                            marginBottom:4, whiteSpace:'nowrap',
                          }}>
                            {sm.label.toUpperCase()}
                          </span>
                          <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                            {report.date || report.created_at?.slice(0,10)}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* ══════════════════════════════════════
                COLLECTION SCHEDULE
            ══════════════════════════════════════ */}
            <div id="schedule-section" style={{ marginBottom:20 }}>
              <h3 className="section-title" style={{ marginBottom:10 }}>Your Collection Schedule</h3>

              {/* Next collection highlight */}
              {nextDay && (
                <div style={{
                  background:'#1e2633',
                  border:'1.5px solid rgba(46,204,113,0.28)',
                  borderRadius:14, padding:'14px 16px', marginBottom:12,
                  display:'flex', alignItems:'center', gap:14,
                }}>
                  <div style={{
                    width:44, height:44, borderRadius:12, flexShrink:0,
                    background:'rgba(46,204,113,0.15)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:22,
                  }}>🚛</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--accent)',
                      letterSpacing:'.07em', marginBottom:2 }}>NEXT COLLECTION</div>
                    <div style={{ fontWeight:800,color:"#ffffff", fontSize:16, fontFamily:'var(--font-head)', marginBottom:1 }}>
                      {nextDay.day}
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                      {nextDay.time} · {nextDay.zone}
                    </div>
                  </div>
                  <div style={{
                    background:'var(--accent)', color:'#0d1117',
                    fontSize:9, fontWeight:800, padding:'4px 10px',
                    borderRadius:20, letterSpacing:'.06em', flexShrink:0,
                  }}>UPCOMING</div>
                </div>
              )}

              {/* Full schedule */}
              <div className="card" style={{ padding:0, overflow:'hidden' }}>
                {MOCK_SCHEDULE.map((s, i) => (
                  <div key={i} style={{
                    display:'flex', alignItems:'center', gap:12,
                    padding:'13px 16px',
                    borderBottom: i < MOCK_SCHEDULE.length-1 ? '1px solid var(--border)' : 'none',
                    background: s.isNext ? 'rgba(46,204,113,0.03)' : 'transparent',
                  }}>
                    {/* Day icon */}
                    <div style={{
                      width:36, height:36, borderRadius:10, flexShrink:0,
                      background: s.isNext ? 'rgba(46,204,113,0.12)' : 'var(--surface-2)',
                      display:'flex', alignItems:'center', justifyContent:'center', fontSize:16,
                    }}>
                      {s.done ? '✅' : s.isNext ? '🚛' : '📅'}
                    </div>

                    <div style={{ flex:1 }}>
                      <div style={{
                        fontWeight: s.isNext ? 700 : 500, fontSize:14,
                        color: s.isNext ? 'var(--accent)' : 'var(--text)',
                      }}>
                        {s.day}
                        {s.isNext && (
                          <span style={{
                            fontSize:9, fontWeight:800,
                            background:'rgba(46,204,113,0.12)', color:'var(--accent)',
                            padding:'2px 7px', borderRadius:20, marginLeft:8, letterSpacing:'.05em',
                          }}>NEXT</span>
                        )}
                      </div>
                      <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:1 }}>
                        {s.zone}
                      </div>
                    </div>

                    <div style={{
                      fontSize:12, fontWeight:600, textAlign:'right',
                      color: s.time === 'N/A' ? 'var(--text-muted)' : 'var(--text)',
                    }}>
                      {s.time}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ══════════════════════════════════════
                BOTTOM CTA — mobile only
            ══════════════════════════════════════ */}
            

          </div>{/* end main column */}

          {/* ════════════════════════════════════════
              SIDEBAR (desktop)
          ════════════════════════════════════════ */}
          <div className="sidebar">

            {/* Quick Actions */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom:12, fontSize:15 }}>Quick Actions</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  
                <button className="cd-btn btn btn-full"
                  onClick={() => navigate('/map')}
                  style={{
                    background:'rgba(20,184,166,0.08)',
                    border:'1px solid rgba(20,184,166,0.35)',
                    color:'var(--accent)', fontWeight:700,
                    display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                  }}>
                  🗺 Open Live Map
                </button>
              </div>
            </div>

            {/* My Stats */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom:12, fontSize:15 }}>My Activity</h3>
              {[
                { label:'Total Reports',  value:stats.total||myReports.length, color:'var(--text)'    },
                { label:'Pending',        value:stats.pending||myReports.filter(r=>r.status==='pending').length, color:'var(--warning)' },
                { label:'Resolved',       value:stats.resolved||myReports.filter(r=>r.status==='resolved').length, color:'var(--accent)'  },
              ].map(s => (
                <div key={s.label} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'9px 0', borderBottom:'1px solid var(--border)',
                }}>
                  <span style={{ fontSize:13, color:'var(--text-muted)' }}>{s.label}</span>
                  <span style={{ fontSize:20, fontWeight:800, color:s.color,
                    fontFamily:'var(--font-head)' }}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Next Collection */}
            {nextDay && (
              <div className="card" style={{
                background:'rgba(46,204,113,0.05)',
                border:'1.5px solid rgba(46,204,113,0.25)',
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
                  <span style={{ fontSize:22 }}>🚛</span>
                  <h3 className="section-title" style={{ margin:0, fontSize:14, color:'var(--accent)' }}>
                    Next Collection
                  </h3>
                </div>
                <div style={{ fontFamily:'var(--font-head)', fontSize:22, fontWeight:800,
                  marginBottom:4 }}>{nextDay.day}</div>
                <div style={{ fontSize:13, color:'var(--text-muted)', marginBottom:4 }}>{nextDay.time}</div>
                <div style={{ fontSize:12, color:'var(--text-muted)' }}>{nextDay.zone}</div>
              </div>
            )}

            {/* Nearby Hotspots */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom:12, fontSize:15 }}>Nearby Hotspots</h3>
              {MOCK_HOTSPOTS.slice(0, 3).map((h, i) => (
                <div key={h.id} style={{
                  display:'flex', alignItems:'center', gap:10, padding:'9px 0',
                  borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{
                    width:8, height:8, borderRadius:'50%', flexShrink:0,
                    background:SEVERITY_COLORS[h.severity],
                    boxShadow:`0 0 5px ${SEVERITY_COLORS[h.severity]}`,
                  }}/>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600 }}>{h.address}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)' }}>{h.type}</div>
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', flexShrink:0 }}>{h.distance}</div>
                </div>
              ))}
            </div>

            {/* Profile */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom:12, fontSize:15 }}>Your Profile</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <div>
                  <div className="form-label">Name</div>
                  <div style={{ fontSize:14, fontWeight:600 }}>{user?.full_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Barangay</div>
                  <div style={{ fontSize:14 }}>{user?.barangay_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Role</div>
                  <span style={{
                    background:'rgba(59,130,246,0.1)', color:'var(--info)',
                    border:'1px solid rgba(59,130,246,0.25)',
                    fontSize:9, fontWeight:800, padding:'3px 10px',
                    borderRadius:20, letterSpacing:'.07em', display:'inline-block',
                  }}>RESIDENT</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}