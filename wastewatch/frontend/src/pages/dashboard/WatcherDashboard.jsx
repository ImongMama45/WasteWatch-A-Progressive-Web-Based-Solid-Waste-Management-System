import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import HomeCarousel from '../../components/carousel/HomeCarousel'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [reports, setReports] = useState([])
  const [stats, setStats] = useState({ total: 0, pending_approval: 0, resolved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('schedule')
  const [activeTab1, setActiveTab1] = useState('reports')

  useEffect(() => {
    Promise.all([
      api.get('/api/watcher/reports/'),
      api.get('/api/watcher/stats/'),
    ])
      .then(([r, s]) => { setReports(r.data); setStats(s.data) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const badgeClass = (status) => `badge badge-${status}`

  return (
    <>
      <div className="page">

        {/* Page Header */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800 }}>
            Waste Collection
          </h2>
          <p className="text-muted text-sm">Stay updated on garbage collection in your area</p>
        </div>

        <div className='mobile-schedule'>
          <HomeCarousel role="watcher" userBarangay={user?.barangay_name} onReport={() => navigate('/report/submit')} />
        </div>

        <div className="page-grid">

          {/* ── MAIN COLUMN ── */}
          <div>

            {/* HomeCarousel — mobile-only, replaces static hero card */}

            {/* Stat Cards */}
            <div className="stat-grid">
              <div className="stat-card">
                <div className="label">Total Reports</div>
                <div className="value" style={{ color: 'white' }}>{stats.total}</div>
              </div>
              <div className="stat-card">
                <div className="label">Pending Approval</div>
                <div className="value" style={{ color: 'var(--warning)' }}>{stats.pending_approval}</div>
              </div>
              <div className="stat-card">
                <div className="label">Resolved</div>
                <div className="value" style={{ color: 'var(--accent)' }}>{stats.resolved}</div>
              </div>
              <div className="stat-card">
                <div className="label">Rejected</div>
                <div className="value" style={{ color: 'var(--danger)' }}>{stats.rejected}</div>
              </div>
            </div>

            {/* ── LIVE MAP WIDGET ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 className="section-title" style={{ margin: 0 }}>Live Collection Map</h3>
              <button
                onClick={() => navigate('/map')}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--accent)', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', padding: '2px 0',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                Full View ›
              </button>
            </div>
            <MiniMap />

            {/* ── My Reports with tabs ── */}
            <h3 className="section-title" style={{ marginTop: 20 }}>My Reports</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={() => setActiveTab1('reports')} className="tab-btn"
                style={{ background: activeTab1 === 'reports' ? 'var(--surface-3)' : 'var(--surface-2)', color: activeTab1 === 'reports' ? '#ffffff' : 'var(--text)' }}>
                My Reports
              </button>
              <button onClick={() => setActiveTab1('hotspots')} className="tab-btn"
                style={{ background: activeTab1 === 'hotspots' ? 'var(--surface-3)' : 'var(--surface-2)', color: activeTab1 === 'hotspots' ? '#f5f5f5' : 'var(--text)' }}>
                Nearby Issues
              </button>
            </div>

            <div className="card" style={{ padding: 16 }}>
              {activeTab1 === 'reports' ? (
                loading ? (
                  <div className="spinner" />
                ) : reports.length === 0 ? (
                  <p className="text-muted text-sm text-center" style={{ padding: '20px 0' }}>
                    No reports yet.{' '}
                    <span style={{ color: 'var(--accent)', cursor: 'pointer' }}
                      onClick={() => navigate('/report/submit')}>
                      Submit your first report
                    </span>
                  </p>
                ) : (
                  reports.slice(0, 10).map(report => (
                    <div key={report.id} className="report-item"
                      onClick={() => navigate(`/report/${report.id}`)}>
                      <div className="report-pin">📍</div>
                      <div className="report-info">
                        <div className="report-type">
                          {report.issue_type_display}
                          <span className={badgeClass(report.status)}>{report.status}</span>
                        </div>
                        <div className="report-location">
                          {report.barangay_name || 'Unknown location'}
                        </div>
                      </div>
                      <div className="report-date">
                        Reported on {report.created_at?.slice(0, 10)}
                      </div>
                    </div>
                  ))
                )
              ) : (
                <p className="text-muted text-sm text-center" style={{ padding: '20px 0' }}>
                  Nearby hotspots coming soon.
                </p>
              )}
            </div>

            {/* ── Collection Schedule with tabs ── */}
            <h3 className="section-title">Your Collection Schedule</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={() => setActiveTab('schedule')} className="tab-btn"
                style={{ background: activeTab === 'schedule' ? 'var(--surface-3)' : 'var(--surface-2)', color: activeTab === 'schedule' ? '#ffffff' : 'var(--text)' }}>
                Schedule
              </button>
              <button onClick={() => setActiveTab('other')} className="tab-btn"
                style={{ background: activeTab === 'other' ? 'var(--surface-3)' : 'var(--surface-2)', color: activeTab === 'other' ? '#ffffff' : 'var(--text)' }}>
                Other
              </button>
            </div>

            <div className="card" style={{ padding: 16 }}>
              {activeTab === 'schedule' ? (
                user?.barangay_name ? (
                  [
                    { day: 'Monday', time: '6:00 AM – 10:00 AM' },
                    { day: 'Wednesday', time: 'N/A' },
                    { day: 'Friday', time: '6:00 AM – 10:00 AM' },
                  ].map((s, i) => (
                    <div key={i} className="report-item">
                      <div className="report-pin">📅</div>
                      <div className="report-info">
                        <div className="report-type">{s.day}</div>
                        <div className="report-location">{user.barangay_name}</div>
                      </div>
                      <div className="report-date">{s.time}</div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted text-sm text-center" style={{ padding: '12px 0' }}>
                    No barangay assigned. Contact your administrator.
                  </p>
                )
              ) : (
                <p className="text-muted text-sm text-center" style={{ padding: '20px 0' }}>
                  Other schedule info coming soon.
                </p>
              )}
            </div>

          </div>{/* end main column */}

          {/* ── SIDEBAR (desktop only) ── */}
          <div className="sidebar">
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12 }}>Quick Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="btn btn-full"
                  onClick={() => navigate('/map')}
                  style={{
                    background: 'rgba(20,184,166,0.08)',
                    border: '1px solid rgba(20,184,166,0.4)',
                    color: 'var(--accent)',
                    fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}
                >
                  🗺 View Live Map
                </button>
              </div>
            </div>

            {/* Sidebar map preview */}


            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12 }}>Collection Schedule</h3>
              {user?.barangay_name ? (
                [
                  { day: 'Monday', time: '6:00 AM – 10:00 AM' },
                  { day: 'Wednesday', time: 'N/A' },
                  { day: 'Friday', time: '6:00 AM – 10:00 AM' },
                ].map((s, i) => (
                  <div key={i} className="report-item">
                    <div className="report-pin">📅</div>
                    <div className="report-info">
                      <div className="report-type">{s.day}</div>
                      <div className="report-location">{user.barangay_name}</div>
                    </div>
                    <div className="report-date">{s.time}</div>
                  </div>
                ))
              ) : (
                <p className="text-muted text-sm">No barangay assigned.</p>
              )}
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12 }}>Your Profile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div><div className="form-label">Name</div><div>{user?.full_name}</div></div>
                <div><div className="form-label">Email</div><div className="text-muted text-sm">{user?.email}</div></div>
                <div><div className="form-label">Barangay</div><div>{user?.barangay_name || '—'}</div></div>
                <div><div className="form-label">Role</div><span className="badge badge-approved">{user?.role}</span></div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}