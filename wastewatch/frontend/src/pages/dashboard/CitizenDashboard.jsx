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

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import HomeCarousel from '../../components/carousel/HomeCarousel'
import OfflineReportBuilder from '../../components/OfflineReportBuilder'
import { useOfflineReports } from '../../hooks/useOfflineReports'
import { ICONS } from '../../api/navConfig'
import DispatchCard from '../../components/DispatchCard'
const STATUS_META = {
  pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  approved: { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  resolved: { label: 'Resolved', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
}

const TYPE_ICONS = {
  overflow: ICONS.trash,
  illegal_dumping: ICONS.hotspot,
  missed: ICONS.box,
}

const SEVERITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CitizenDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { addReport } = useOfflineReports()

  const [myReports, setMyReports] = useState([])
  const [stats, setStats] = useState({ total: 0, pending: 0, resolved: 0 })
  const [hotspots, setHotspots] = useState([])
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(true)
  const [reportsTab, setReportsTab] = useState('all')   // all | pending | resolved
  const [crewAssignment, setCrewAssignment] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [announcements, setAnnouncements] = useState([])

  const userBrgy = user?.barangay_name || user?.barangay?.name || '';
  const filteredSchedule = schedule.filter(s => {
    if (!userBrgy) return true;
    return s.zone && s.zone.toLowerCase().includes(userBrgy.toLowerCase());
  });

  const nextDay = filteredSchedule.find(s => s.isNext) || filteredSchedule[0]

  const [activeDispatch, setActiveDispatch] = useState(null)

  useEffect(() => {
    Promise.all([
      api.get('/api/news/items/for-dashboard/').catch(() => ({ data: [] })),
      api.get('/api/watcher/reports/').catch(() => ({ data: [] })),
      api.get('/api/watcher/reports/stats/').catch(() => ({ data: { total: 0, pending: 0, resolved: 0 } })),
      api.get('/api/watcher/hotspots/').catch(() => ({ data: [] })),
      api.get('/api/public/schedule/').catch(() => ({ data: [] })),
      api.get('/api/public/live/').catch(() => ({ data: [] })),
    ])
      .then(([newsRes, reportsRes, statsRes, hotspotsRes, scheduleRes, liveRes]) => {
        if (newsRes.data) setAnnouncements(newsRes.data)
        if (reportsRes.data) setMyReports(reportsRes.data.slice(0, 5))
        if (statsRes.data) setStats(statsRes.data)
        if (hotspotsRes.data) {
          setHotspots(hotspotsRes.data.slice(0, 4).map(h => {
            let pType = 'Mixed';
            if (h.name) {
              if (h.name.includes('—')) pType = h.name.split('—')[1].trim();
              else if (h.name.includes('-')) pType = h.name.split('-')[1].trim();
              else pType = h.name;
            }
            return {
              ...h,
              count: h.report_count || 0,
              type: pType,
              status: h.severity || 'low'
            }
          }))
        }
        if (scheduleRes.data) setSchedule(scheduleRes.data)

        if (liveRes && liveRes.data) {
          const userBrgy = user?.barangay_name || user?.barangay?.name;
          if (userBrgy) {
            const dispatched = liveRes.data.find(d => d.barangays && d.barangays.includes(userBrgy));
            if (dispatched) setActiveDispatch(dispatched);
          }
        }
      })
      .finally(() => setLoading(false))

    // Fetch crew assignment only if user is a crew member
    if (user?.employee_type === 'crew_member') {
      api.get('/api/driver/crew-assignments/my-assignment/')
        .then(res => setCrewAssignment(res.data))
        .catch(() => setCrewAssignment(null))
    }
  }, [user?.employee_type, user?.barangay_name, user?.barangay?.name])

  const handleSubmitReport = useCallback(async (fields) => {
    await addReport(fields)
    setShowBuilder(false)
  }, [addReport])

  const filteredReports = myReports.filter(r => {
    if (reportsTab === 'all') return true
    if (reportsTab === 'pending') return r.status === 'pending'
    if (reportsTab === 'done') return r.status === 'resolved' || r.status === 'approved'
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
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, marginBottom: 2 }}>
            Hello, {user?.full_name?.split(' ')[0] || 'Resident'}
          </h2>
          <p className="text-muted text-sm">
            {user?.barangay_name || 'Your Barangay'} · Stay updated on waste collection in your area
          </p>
        </div>

        <DispatchCard
          dispatchData={activeDispatch}
          userBarangay={user?.barangay_name || user?.barangay?.name}
        />

        <div className='mobile-schedule'>
          <HomeCarousel role="citizen" userBarangay={user?.barangay_name} onReport={() => setShowBuilder(true)} />
        </div>

        <div className="page-grid">
          <div>

            {/* ... rest of the content ... */}




            {/* ══════════════════════════════════════
                CREW MEMBER SECTION (visible only if crew_member)
            ══════════════════════════════════════ */}
            {user?.employee_type === 'crew_member' && (
              <div style={{ marginBottom: 20 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <h3 className="section-title" style={{ margin: 0 }}>My Crew Assignment</h3>
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
                    background: 'rgba(251,191,36,0.15)', color: '#f59e0b',
                    border: '1px solid rgba(251,191,36,0.3)', letterSpacing: '.07em',
                  }}>CREW MEMBER</span>
                </div>

                {crewAssignment ? (
                  <div style={{
                    background: 'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.03))',
                    border: '1.5px solid rgba(251,191,36,0.25)',
                    borderRadius: 16, padding: '18px 20px',
                  }}>
                    {/* Truck + Driver row */}
                    <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
                      <div style={{
                        flex: 1, minWidth: 140,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 12, padding: '12px 14px',
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Assigned Truck</div>
                        <div style={{ width: 24, height: 24, margin: '6px 0', color: 'var(--accent)' }}>{ICONS.truck}</div>
                        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, marginTop: 4 }}>
                          {crewAssignment.truck_plate}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{crewAssignment.truck_model}</div>
                      </div>

                      <div style={{
                        flex: 1, minWidth: 140,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 12, padding: '12px 14px',
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Driver</div>
                        <div style={{ width: 24, height: 24, margin: '6px 0', color: 'var(--accent)' }}>{ICONS.profile}</div>
                        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, marginTop: 4 }}>
                          {crewAssignment.driver_name || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lead Driver</div>
                      </div>
                    </div>

                    {/* Schedule + Route info */}
                    <div style={{
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: '14px 16px', marginBottom: 12,
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>Collection Schedule</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {[
                          { icon: ICONS.pin, label: 'Area / Route', value: crewAssignment.schedule_area || '—' },
                          { icon: ICONS.schedule, label: 'Days', value: crewAssignment.schedule_days || '—' },
                          { icon: ICONS.clock, label: 'Shift Start', value: crewAssignment.schedule_start || '—' },
                          { icon: ICONS.clock, label: 'Shift End', value: crewAssignment.schedule_end || '—' },
                        ].map(item => (
                          <div key={item.label}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                              <span style={{ width: 12, height: 12 }}>{item.icon}</span> {item.label}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Crew row */}
                    {crewAssignment.crew_names?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Crew on this shift</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {crewAssignment.crew_names.map(m => (
                            <span key={m.id} style={{
                              fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                              background: m.id === user?.id ? 'rgba(251,191,36,0.2)' : 'var(--surface)',
                              color: m.id === user?.id ? '#f59e0b' : 'var(--text)',
                              display: 'inline-flex', alignItems: 'center', gap: 4
                            }}>
                              {m.id === user?.id ? <span style={{ width: 12, height: 12 }}>{ICONS.star}</span> : null}{m.full_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 14, padding: '28px 20px', textAlign: 'center',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: 'var(--text-muted)' }}>
                      <div style={{ width: 40, height: 40 }}>{ICONS.truck}</div>
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>No Active Assignment</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>You haven't been assigned to a truck today. Check back later or contact your supervisor.</div>
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════
                PERSONALIZED STAT CARDS
            ══════════════════════════════════════ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>

              <div className="cd-card" style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, padding: '14px 12px', textAlign: 'center',
                cursor: 'pointer',
              }} onClick={() => {
                document.getElementById('my-reports-section')?.scrollIntoView({ behavior: 'smooth' })
              }}>
                <div style={{
                  padding: "20px",
                  fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800,
                  lineHeight: 1, marginBottom: 4,
                }}>{stats.total || myReports.length}</div>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '.06em'
                }}>My Reports</div>
              </div>

              <div className="cd-card" style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, padding: '14px 12px', textAlign: 'center',
                cursor: 'pointer',
              }} onClick={() => {
                document.getElementById('hotspots-section')?.scrollIntoView({ behavior: 'smooth' })
              }}>
                <div style={{
                  padding: "20px",
                  fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800,
                  lineHeight: 1, marginBottom: 4, color: 'var(--warning)',
                }}>{hotspots.length}</div>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '.06em'
                }}>Hotspots</div>
              </div>

              <div className="cd-card" style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, padding: '14px 12px', textAlign: 'center',
                cursor: 'pointer',
              }} onClick={() => {
                document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' })
              }}>
                <div style={{
                  padding: "20px",
                  fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800,
                  lineHeight: 1.1, marginBottom: 4, color: 'var(--accent)',
                }}>
                  {nextDay ? nextDay.day : 'N/A'}
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '.06em'
                }}>Next Pickup</div>
              </div>
            </div>

            {/* ══════════════════════════════════════
                MAP — FOCAL POINT
            ══════════════════════════════════════ */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Nearby Collection Points</h3>
                <button onClick={() => navigate('/map')}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer'
                  }}>
                  Open Live Map ›
                </button>
              </div>
              <MiniMap />
            </div>

            {/* ══════════════════════════════════════
                NEARBY HOTSPOTS
            ══════════════════════════════════════ */}
            <div id="hotspots-section" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Nearby Hotspots</h3>
                <span style={{
                  background: 'rgba(239,68,68,0.1)', color: 'var(--danger)',
                  fontSize: 10, fontWeight: 700, padding: '3px 10px',
                  borderRadius: 20,
                }}>{hotspots.length} Active</span>
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {hotspots.map((h, i) => (
                  <div key={h.id} className="cd-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      borderBottom: i < hotspots.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                    {/* Pin icon with severity color */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: `${SEVERITY_COLORS[h.status || 'low']}15`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: SEVERITY_COLORS[h.status || 'low'],
                    }}>
                      <div style={{ width: 18, height: 18 }}>{ICONS.pin}</div>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 1 }}>
                        {h.barangay_name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {h.type}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                        {h.count} reps
                      </div>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: SEVERITY_COLORS[h.status || 'low'],
                        marginLeft: 'auto', marginTop: 4,
                        boxShadow: `0 0 5px ${SEVERITY_COLORS[h.status || 'low']}`,
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ══════════════════════════════════════
                MY REPORTS
            ══════════════════════════════════════ */}
            <div id="my-reports-section" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>My Reports</h3>
                <button className="new-rptr-btn" onClick={() => setShowBuilder(true)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer'
                  }}>
                  + New Report
                </button>
              </div>

              {/* Filter tabs */}
              <div style={{
                display: 'flex', gap: 4, marginBottom: 12,
                background: 'var(--surface-2)', borderRadius: 10, padding: 4,
                width: 'fit-content',
              }}>
                {[
                  { key: 'all', label: 'All' },
                  { key: 'pending', label: 'Pending' },
                  { key: 'done', label: 'Done' },
                ].map(t => (
                  <button key={t.key} className="cd-tab"
                    onClick={() => setReportsTab(t.key)}
                    style={{
                      padding: '6px 14px', borderRadius: 8, border: 'none',
                      fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                      background: reportsTab === t.key ? 'var(--surface-3)' : 'transparent',
                      color: reportsTab === t.key ? '#fff' : 'var(--text-muted)',
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                  <div style={{ padding: '32px', textAlign: 'center' }}>
                    <div className="spinner" style={{ margin: '0 auto' }} />
                  </div>
                ) : filteredReports.length === 0 ? (
                  <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: 'var(--text-muted)' }}>
                      <div style={{ width: 40, height: 40 }}>{ICONS.box}</div>
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>No reports here yet</div>
                    <div className="text-muted text-sm">See something? Tap "Report Issue" to let us know.</div>
                    <button className="cd-btn btn btn-primary"
                      style={{ marginTop: 14, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      onClick={() => setShowBuilder(true)}>
                      <div style={{ width: 16, height: 16 }}>{ICONS.camera}</div> Submit a Report
                    </button>
                  </div>
                ) : (
                  filteredReports.map((report, i) => {
                    const sm = STATUS_META[report.status] || STATUS_META.pending
                    return (
                      <div key={report.id} className="cd-row"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 16px',
                          borderBottom: i < filteredReports.length - 1 ? '1px solid var(--border)' : 'none',
                        }}
                        onClick={() => navigate(`/report/${report.id}`)}>

                        <div style={{
                          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                          background: 'rgba(239,68,68,0.08)', color: 'var(--danger)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <div style={{ width: 20, height: 20 }}>
                            {TYPE_ICONS[report.waste_type] || ICONS.pin}
                          </div>
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                            {report.waste_type?.toUpperCase()}
                          </div>
                          <div style={{
                            fontSize: 12, color: 'var(--text-muted)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                          }}>
                            {report.address || report.barangay_name}
                          </div>
                          {/* Rejection reason — citizen-facing */}
                          {report.status === 'rejected' && report.rejection_reason && (
                            <div style={{
                              fontSize: 11, color: 'var(--danger)', marginTop: 4,
                              display: 'flex', alignItems: 'flex-start', gap: 4, lineHeight: 1.4,
                            }}>
                              <span style={{ flexShrink: 0 }}>⚠️</span>
                              <span>Reason: {report.rejection_reason}</span>
                            </div>
                          )}
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{
                            display: 'block',
                            background: sm.bg, color: sm.color,
                            fontSize: 9, fontWeight: 800, padding: '3px 9px',
                            borderRadius: 20, letterSpacing: '.05em',
                            marginBottom: 4, whiteSpace: 'nowrap',
                          }}>
                            {sm.label.toUpperCase()}
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {new Date(report.created_at).toLocaleDateString()}
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
            <div id="schedule-section" style={{ marginBottom: 20 }}>
              <h3 className="section-title" style={{ marginBottom: 10 }}>Your Collection Schedule</h3>

              {/* Next collection highlight */}
              {nextDay && (
                <div style={{
                  background: '#1e2633',
                  border: '1.5px solid rgba(46,204,113,0.28)',
                  borderRadius: 14, padding: '14px 16px', marginBottom: 12,
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: 'rgba(46,204,113,0.15)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}><div style={{ width: 24, height: 24 }}>{ICONS.truck}</div></div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: 'var(--accent)',
                      letterSpacing: '.07em', marginBottom: 2
                    }}>NEXT COLLECTION</div>
                    <div style={{ fontWeight: 800, color: "#ffffff", fontSize: 16, fontFamily: 'var(--font-head)', marginBottom: 1 }}>
                      {nextDay.day}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {nextDay.time} · {nextDay.zone}
                    </div>
                  </div>
                  <div style={{
                    background: 'var(--accent)', color: '#0d1117',
                    fontSize: 9, fontWeight: 800, padding: '4px 10px',
                    borderRadius: 20, letterSpacing: '.06em', flexShrink: 0,
                  }}>UPCOMING</div>
                </div>
              )}

              {/* Full schedule */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {filteredSchedule.length === 0 ? (
                  <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ marginBottom: 8 }}><span style={{ width: 24, height: 24, display: 'inline-block', opacity: 0.5 }}>{ICONS.schedule}</span></div>
                    No specific schedule listed for {userBrgy || 'your area'}.
                  </div>
                ) : filteredSchedule.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '13px 16px',
                    borderBottom: i < filteredSchedule.length - 1 ? '1px solid var(--border)' : 'none',
                    background: s.isNext ? 'rgba(46,204,113,0.03)' : 'transparent',
                  }}>
                    {/* Day icon */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: s.isNext ? 'rgba(46,204,113,0.12)' : 'var(--surface-2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: s.isNext ? 'var(--accent)' : 'var(--text-muted)'
                    }}>
                      <div style={{ width: 20, height: 20 }}>
                        {s.isNext ? ICONS.truck : ICONS.schedule}
                      </div>
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontWeight: s.isNext ? 700 : 500, fontSize: 14,
                        color: s.isNext ? 'var(--accent)' : 'var(--text)',
                      }}>
                        {s.day}
                        {s.isNext && (
                          <span style={{
                            fontSize: 9, fontWeight: 800,
                            background: 'rgba(46,204,113,0.12)', color: 'var(--accent)',
                            padding: '2px 7px', borderRadius: 20, marginLeft: 8, letterSpacing: '.05em',
                          }}>NEXT</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                        {s.zone}
                      </div>
                    </div>

                    <div style={{
                      fontSize: 12, fontWeight: 600, textAlign: 'right',
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


            {/* My Stats */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>My Activity</h3>
              {[
                { label: 'Total Reports', value: stats.total, color: 'var(--text)' },
                { label: 'Pending', value: stats.pending, color: 'var(--warning)' },
                { label: 'Resolved', value: stats.resolved, color: 'var(--accent)' },
              ].map(s => (
                <div key={s.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.label}</span>
                  <span style={{
                    fontSize: 20, fontWeight: 800, color: s.color,
                    fontFamily: 'var(--font-head)'
                  }}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Next Collection */}
            {nextDay && (
              <div className="card" style={{
                background: 'rgba(46,204,113,0.05)',
                border: '1.5px solid rgba(46,204,113,0.25)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 26, height: 26, color: 'var(--accent)' }}>{ICONS.truck}</div>
                  <h3 className="section-title" style={{ margin: 0, fontSize: 14, color: 'var(--accent)' }}>
                    Next Collection
                  </h3>
                </div>
                <div style={{
                  fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800,
                  marginBottom: 4
                }}>{nextDay.day}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{nextDay.time}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{nextDay.zone}</div>
              </div>
            )}

            {/* Nearby Hotspots */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Nearby Hotspots</h3>
              {hotspots.slice(0, 3).map((h, i) => (
                <div key={h.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                  borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: SEVERITY_COLORS[h.status || 'low'],
                    boxShadow: `0 0 5px ${SEVERITY_COLORS[h.status || 'low']}`,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{h.barangay_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.type}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{h.count} reps</div>
                </div>
              ))}
            </div>

            {/* Profile */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Your Profile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div className="form-label">Name</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{user?.full_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Barangay</div>
                  <div style={{ fontSize: 14 }}>{user?.barangay_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Role</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{
                      background: 'rgba(59,130,246,0.1)', color: 'var(--info)',
                      border: '1px solid rgba(59,130,246,0.25)',
                      fontSize: 9, fontWeight: 800, padding: '3px 10px',
                      borderRadius: 20, letterSpacing: '.07em', display: 'inline-block',
                    }}>RESIDENT</span>
                    {user?.employee_type === 'crew_member' && (
                      <span style={{
                        background: 'rgba(251,191,36,0.12)', color: '#f59e0b',
                        border: '1px solid rgba(251,191,36,0.3)',
                        fontSize: 9, fontWeight: 800, padding: '3px 10px',
                        borderRadius: 20, letterSpacing: '.07em', display: 'inline-block',
                      }}>CREW MEMBER</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <OfflineReportBuilder
        isOpen={showBuilder}
        onClose={() => setShowBuilder(false)}
        onSubmit={handleSubmitReport}
      />
    </>
  )
}