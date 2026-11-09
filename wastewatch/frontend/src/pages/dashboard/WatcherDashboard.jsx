import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import HomeCarousel from '../../components/carousel/HomeCarousel'
import OfflineReportBuilder from '../../components/OfflineReportBuilder'
import { useOfflineReports } from '../../hooks/useOfflineReports'
import { ICONS } from '../../api/navConfig'
import DispatchCard from '../../components/DispatchCard'
import ReportDetail from '../admin/ReportDetail'
import { useBarangayTracker } from '../../hooks/useBarangayTracker'
import LiveTrackerCard from '../../components/analytics/LiveTrackerCard'
import {
  StatCardSkeleton,
  FeedCardSkeleton,
  SidebarWidgetSkeleton,
} from '../../components/ui/Skeleton'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { addReport } = useOfflineReports()

  const userBrgyId = user?.barangay || user?.barangay_id
  const tracker = useBarangayTracker(userBrgyId)

  const [reports, setReports] = useState([])
  const [stats, setStats] = useState({ total: 0, pending_approval: 0, resolved: 0, rejected: 0 })
  const [pendingTasksCount, setPendingTasksCount] = useState(0)
  const [totalTasksCount, setTotalTasksCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('schedule')
  const [activeTab1, setActiveTab1] = useState('reports')
  const [activeDispatch, setActiveDispatch] = useState(null)
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.get('/api/watcher/reports/?paginate=false'),
      api.get('/api/watcher/stop-validations/'),
      api.get('/api/public/live/').catch(() => ({ data: [] }))
    ])
      .then(([rRes, vRes, liveRes]) => {
        if (cancelled) return;
        const rawReports = rRes.data
        const allReports = Array.isArray(rawReports) ? rawReports : (rawReports?.results || [])
        setReports(allReports)

        const pending = allReports.filter(r => r.status === 'pending').length
        const resolved = allReports.filter(r => r.status === 'resolved' || r.status === 'completed').length
        const rejected = allReports.filter(r => r.status === 'issue' || r.status === 'rejected').length
        setStats({ total: allReports.length, pending_approval: pending, resolved, rejected })

        const validations = vRes.data?.results ?? vRes.data ?? []
        const pendingVals = validations.filter(v => {
          const status = v.current_status ? v.current_status.toUpperCase().replace(/ /g, '_') : 'PENDING_INSPECTION'
          return status === 'PENDING_INSPECTION' || status === 'COLLECTION_REPORTED'
        })
        setPendingTasksCount(pendingVals.length)
        setTotalTasksCount(validations.length)

        if (liveRes && liveRes.data) {
          const userBrgy = user?.barangay_name || user?.barangay?.name;
          if (userBrgy) {
            const dispatched = liveRes.data.find(d => d.barangays && d.barangays.includes(userBrgy));
            if (dispatched) setActiveDispatch(dispatched);
          }
        }
      })
      .catch(err => {
        if (!cancelled) console.error(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [user?.barangay_name, user?.barangay?.name])

  return (
    <>
      <style>{`
        .wd-container {
          background: #f0f2f5;
          min-height: 100vh;
          padding: 20px 24px;
          box-sizing: border-box;
        }
        @media (max-width: 768px) {
          .wd-container {
            padding: 12px 14px 84px;
          }
        }

        .wd-header-wrapper {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 16px;
        }
        @media (max-width: 768px) {
          .wd-header-wrapper {
            flex-direction: column;
            gap: 12px;
            margin-bottom: 12px;
          }
        }

        .wd-tracker-wrapper {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        @media (max-width: 768px) {
          .wd-tracker-wrapper {
            width: 100%;
            flex-direction: column;
            justify-content: stretch;
            gap: 10px;
          }
          .wd-tracker-wrapper > * {
            width: 100% !important;
            max-width: 100% !important;
          }
        }

        /* Responsive Page Grid */
        .wd-page-grid {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 1024px) {
          .wd-page-grid {
            grid-template-columns: 1fr;
            gap: 14px;
          }
        }

        /* Stat Cards: 4 columns on desktop, 2x2 on mobile */
        .wd-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 16px;
        }
        @media (max-width: 768px) {
          .wd-stats-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 14px;
          }
        }

        .wd-stat-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 14px 18px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        @media (max-width: 768px) {
          .wd-stat-card {
            padding: 10px 12px;
          }
        }

        /* Inspection CTA Card */
        .wd-inspection-card {
          margin-bottom: 14px;
          padding: 14px 16px;
          border-radius: 10px;
          cursor: pointer;
          background: #ffffff;
          border: 1px solid #e4e6eb;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          transition: background 0.14s, border-color 0.14s;
        }
        @media (max-width: 640px) {
          .wd-inspection-card {
            padding: 12px 14px;
            gap: 12px;
          }
        }

        .wd-card-panel {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 18px;
          margin-bottom: 16px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        @media (max-width: 768px) {
          .wd-card-panel {
            padding: 14px 12px;
            margin-bottom: 12px;
          }
        }
      `}</style>

      <div className="wd-container">
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>

          {/* Page Header with Corner Live Tracker */}
          <div className="wd-header-wrapper">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, margin: 0, color: '#1c1e21', letterSpacing: '-0.02em' }}>
                  Waste Collection
                </h2>
                <span style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '.05em' }}>
                  WATCHER
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#65676b' }}>Stay updated on garbage collection and pending inspections in your area</p>
            </div>

            <div className="wd-tracker-wrapper">
              {tracker.loading && !tracker.data?.trucks?.length ? (
                <LiveTrackerCard loading={true} />
              ) : tracker.data?.trucks?.length > 0 ? (
                tracker.data.trucks.map(t => <LiveTrackerCard key={t.schedule_id} truck={t} loading={tracker.loading} />)
              ) : loading ? (
                <LiveTrackerCard loading={true} />
              ) : (
                <DispatchCard
                  dispatchData={activeDispatch}
                  userBarangay={user?.barangay_name || user?.barangay?.name}
                />
              )}
            </div>
          </div>

          {/* ── INSPECTION CTA (Meta Card) ── */}
          <div
            onClick={() => navigate('/watcher-tasks')}
            className="wd-inspection-card"
            onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#16a34a' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.borderColor = '#e4e6eb' }}
          >
            <div style={{ width: 42, height: 42, borderRadius: 8, background: '#e7f5eb', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a', flexShrink: 0 }}>
              <div style={{ width: 20, height: 20 }}>{ICONS.search}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 700, color: '#1c1e21' }}>
                  Inspection Tasks
                </div>
                {!loading && totalTasksCount > 0 && (
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 10,
                    fontWeight: 800,
                    color: pendingTasksCount > 0 ? '#dc2626' : '#16a34a',
                    background: pendingTasksCount > 0 ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${pendingTasksCount > 0 ? '#fecaca' : '#bbf7d0'}`,
                    letterSpacing: '.03em',
                    whiteSpace: 'nowrap'
                  }}>
                    {pendingTasksCount > 0 ? `${pendingTasksCount} PENDING` : 'ALL CLEAR'}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#65676b', lineHeight: 1.35, marginBottom: 4 }}>
                Perform checkpoint validations and post-collection verification
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Open Tasks →
              </div>
            </div>
          </div>

          <div className='mobile-schedule' style={{ marginTop: 0, marginBottom: 14 }}>
            <HomeCarousel role="watcher" userBarangay={user?.barangay_name} onReport={() => setShowBuilder(true)} />
          </div>

          <div className="wd-page-grid">

            {/* ── MAIN COLUMN ── */}
            <div>

              {/* Stat Cards */}
              {loading ? (
                <StatCardSkeleton count={4} style={{ marginBottom: 16 }} />
              ) : (
                <div className="wd-stats-grid ww-stagger">
                  <div className="wd-stat-card">
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.05em' }}>Total Reports</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#1c1e21', marginTop: 4 }}>{stats.total}</div>
                  </div>
                  <div className="wd-stat-card">
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.05em' }}>Pending Approval</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#d97706', marginTop: 4 }}>{stats.pending_approval}</div>
                  </div>
                  <div className="wd-stat-card">
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.05em' }}>Resolved</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#16a34a', marginTop: 4 }}>{stats.resolved}</div>
                  </div>
                  <div className="wd-stat-card">
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.05em' }}>Rejected</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#dc2626', marginTop: 4 }}>{stats.rejected}</div>
                  </div>
                </div>
              )}

              {/* ── LIVE MAP WIDGET ── */}
              <div className="wd-card-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Live Collection Map</h3>
                  <button
                    onClick={() => navigate('/map')}
                    style={{
                      background: 'none', border: 'none',
                      color: '#16a34a', fontSize: 12, fontWeight: 700,
                      cursor: 'pointer', padding: 0,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    Full View →
                  </button>
                </div>
                <MiniMap />
              </div>

              {/* ── My Reports with tabs ── */}
              <div className="wd-card-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>My Reports</h3>
                  <div style={{ display: 'flex', background: '#e4e6eb', padding: 3, borderRadius: 6, gap: 2 }}>
                    <button
                      onClick={() => setActiveTab1('reports')}
                      style={{
                        padding: '4px 10px', borderRadius: 4, border: 'none', fontSize: 12, fontWeight: activeTab1 === 'reports' ? 700 : 600,
                        cursor: 'pointer', background: activeTab1 === 'reports' ? '#ffffff' : 'transparent',
                        color: activeTab1 === 'reports' ? '#1c1e21' : '#65676b',
                        boxShadow: activeTab1 === 'reports' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'
                      }}>
                      My Reports
                    </button>
                    <button
                      onClick={() => setActiveTab1('hotspots')}
                      style={{
                        padding: '4px 10px', borderRadius: 4, border: 'none', fontSize: 12, fontWeight: activeTab1 === 'hotspots' ? 700 : 600,
                        cursor: 'pointer', background: activeTab1 === 'hotspots' ? '#ffffff' : 'transparent',
                        color: activeTab1 === 'hotspots' ? '#1c1e21' : '#65676b',
                        boxShadow: activeTab1 === 'hotspots' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'
                      }}>
                      Nearby Issues
                    </button>
                  </div>
                </div>

                <div>
                  {activeTab1 === 'reports' ? (
                    loading ? (
                      <FeedCardSkeleton count={3} compact />
                    ) : reports.length === 0 ? (
                      <p className="ww-fade-in" style={{ textAlign: 'center', padding: '24px 0', fontSize: 13, color: '#65676b', margin: 0 }}>
                        No reports yet.{' '}
                        <span style={{ color: '#16a34a', cursor: 'pointer', fontWeight: 600 }}
                          onClick={() => setShowBuilder(true)}>
                          Submit your first report
                        </span>
                      </p>
                    ) : (
                      <div className="ww-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {reports.slice(0, 10).map(report => (
                          <div key={report.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                              background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
                              cursor: 'pointer', transition: 'border-color 0.14s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = '#16a34a'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                            onClick={() => setSelectedReportId(report.id)}>
                            <div style={{ width: 32, height: 32, borderRadius: 6, background: '#ffffff', border: '1px solid #ced0d4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#16a34a' }}>
                              <div style={{ width: 16, height: 16 }}>{ICONS.pin}</div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                <span style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21' }}>{report.issue_type_display}</span>
                                <span style={{
                                  background: report.status === 'resolved' || report.status === 'completed' ? '#e7f5eb' : report.status === 'pending' ? '#fffbeb' : '#fef2f2',
                                  color: report.status === 'resolved' || report.status === 'completed' ? '#15803d' : report.status === 'pending' ? '#b45309' : '#dc2626',
                                  border: `1px solid ${report.status === 'resolved' || report.status === 'completed' ? '#bbf7d0' : report.status === 'pending' ? '#fde68a' : '#fecaca'}`,
                                  borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase'
                                }}>
                                  {report.status}
                                </span>
                              </div>
                              <div style={{ fontSize: 12, color: '#65676b' }}>
                                {report.barangay_name || 'Unknown location'}
                              </div>
                              {report.status === 'rejected' && report.rejection_reason && (
                                <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                  Reason: {report.rejection_reason}
                                </div>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: '#8a8d91', fontWeight: 500 }}>
                              {report.created_at?.slice(0, 10)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : loading ? (
                    <SidebarWidgetSkeleton rows={3} />
                  ) : (
                    <p className="ww-fade-in" style={{ textAlign: 'center', padding: '24px 0', fontSize: 13, color: '#65676b', margin: 0 }}>
                      Nearby hotspots coming soon.
                    </p>
                  )}
                </div>
              </div>

              {/* ── Collection Schedule with tabs ── */}
              <div className="wd-card-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Your Collection Schedule</h3>
                  <div style={{ display: 'flex', background: '#e4e6eb', padding: 3, borderRadius: 6, gap: 2 }}>
                    <button
                      onClick={() => setActiveTab('schedule')}
                      style={{
                        padding: '4px 10px', borderRadius: 4, border: 'none', fontSize: 12, fontWeight: activeTab === 'schedule' ? 700 : 600,
                        cursor: 'pointer', background: activeTab === 'schedule' ? '#ffffff' : 'transparent',
                        color: activeTab === 'schedule' ? '#1c1e21' : '#65676b',
                        boxShadow: activeTab === 'schedule' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'
                      }}>
                      Schedule
                    </button>
                    <button
                      onClick={() => setActiveTab('other')}
                      style={{
                        padding: '4px 10px', borderRadius: 4, border: 'none', fontSize: 12, fontWeight: activeTab === 'other' ? 700 : 600,
                        cursor: 'pointer', background: activeTab === 'other' ? '#ffffff' : 'transparent',
                        color: activeTab === 'other' ? '#1c1e21' : '#65676b',
                        boxShadow: activeTab === 'other' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none'
                      }}>
                      Other
                    </button>
                  </div>
                </div>

                <div>
                  {loading ? (
                    <SidebarWidgetSkeleton rows={3} />
                  ) : activeTab === 'schedule' ? (
                    user?.barangay_name ? (
                      <div className="ww-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[
                          { day: 'Monday', time: '6:00 AM – 10:00 AM' },
                          { day: 'Wednesday', time: 'N/A' },
                          { day: 'Friday', time: '6:00 AM – 10:00 AM' },
                        ].map((s, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ width: 32, height: 32, borderRadius: 6, background: '#ffffff', border: '1px solid #ced0d4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
                                <div style={{ width: 16, height: 16 }}>{ICONS.schedule}</div>
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21' }}>{s.day}</div>
                                <div style={{ fontSize: 11, color: '#65676b' }}>{user.barangay_name}</div>
                              </div>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a' }}>{s.time}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="ww-fade-in" style={{ textAlign: 'center', padding: '16px 0', fontSize: 13, color: '#65676b', margin: 0 }}>
                        No barangay assigned. Contact your administrator.
                      </p>
                    )
                  ) : (
                    <p className="ww-fade-in" style={{ textAlign: 'center', padding: '16px 0', fontSize: 13, color: '#65676b', margin: 0 }}>
                      Other schedule info coming soon.
                    </p>
                  )}
                </div>
              </div>

            </div>{/* end main column */}

            {/* ── SIDEBAR (desktop only) ── */}
            <div className="sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Quick Actions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    onClick={() => navigate('/watcher-tasks')}
                    style={{
                      background: '#16a34a',
                      border: 'none',
                      color: '#ffffff',
                      borderRadius: 6,
                      height: 36,
                      fontSize: 13,
                      fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      cursor: 'pointer',
                      transition: 'background 0.14s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#15803d'}
                    onMouseLeave={e => e.currentTarget.style.background = '#16a34a'}
                  >
                    Watcher Tasks
                  </button>
                  <button
                    onClick={() => navigate('/map')}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #ced0d4',
                      color: '#1c1e21',
                      borderRadius: 6,
                      height: 36,
                      fontSize: 13,
                      fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      cursor: 'pointer',
                      transition: 'background 0.14s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f2f5'}
                    onMouseLeave={e => e.currentTarget.style.background = '#ffffff'}
                  >
                    <div style={{ width: 16, height: 16 }}>{ICONS.map}</div> View Live Map
                  </button>
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Collection Schedule</h3>
                {loading ? (
                  <SidebarWidgetSkeleton rows={3} />
                ) : user?.barangay_name ? (
                  <div className="ww-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { day: 'Monday', time: '6:00 AM – 10:00 AM' },
                      { day: 'Wednesday', time: 'N/A' },
                      { day: 'Friday', time: '6:00 AM – 10:00 AM' },
                    ].map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 12, color: '#1c1e21' }}>{s.day}</div>
                          <div style={{ fontSize: 11, color: '#65676b' }}>{user.barangay_name}</div>
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a' }}>{s.time}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ww-fade-in" style={{ fontSize: 13, color: '#65676b', margin: 0 }}>No barangay assigned.</p>
                )}
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Your Profile</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Name</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1e21' }}>{user?.full_name}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Email</div>
                    <div style={{ fontSize: 13, color: '#65676b' }}>{user?.email}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Barangay</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1e21' }}>{user?.barangay_name || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', marginBottom: 4 }}>Role</div>
                    <span style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                      {user?.role}
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
      {selectedReportId && (
        <ReportDetail
          reportId={selectedReportId}
          onClose={() => setSelectedReportId(null)}
        />
      )}
      <OfflineReportBuilder
        isOpen={showBuilder}
        onClose={() => setShowBuilder(false)}
        onSubmit={async (data) => {
          await addReport(data)
          setShowBuilder(false)
        }}
      />
    </>
  )
}
