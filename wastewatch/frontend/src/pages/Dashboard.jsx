/**
 * pages/Dashboard.jsx
 * --------------------
 * Main Watcher dashboard — mirrors the Home.png design:
 *   • "Report a Garbage Issue" banner with 2 CTAs
 *   • Stat cards (Total, Pending, Resolved, Rejected)
 *   • Map placeholder with active truck info
 *   • My Reports list
 *   • Collection schedule
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState("schedule");
  const [activeTab1, setActiveTab1] = useState("hotspots");

  const [reports, setReports]   = useState([])
  const [stats,   setStats]     = useState({ total: 0, pending_approval: 0, resolved: 0, rejected: 0 })
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/api/watcher/reports/'),
      api.get('/api/watcher/stats/'),
    ])
      .then(([reportsRes, statsRes]) => {
        setReports(reportsRes.data)
        setStats(statsRes.data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function badgeClass(status) {
    return `badge badge-${status}`
  }

  function severityColor(s) {
    if (s === 'high')   return 'var(--danger)'
    if (s === 'medium') return 'var(--warning)'
    return 'var(--accent)'
  }

  return (
    <>
      <Navbar />
      <div className="page">

        {/* ── Page Header ── */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800 }}>
            Waste Collection
          </h2>
          <p className="text-muted text-sm">Stay updated on garbage collection in your area</p>
        </div>

        {/* ── Report a Garbage Issue Banner ── */}
        <div className="card card-dark" style={{ textAlign: 'center', padding: '28px 20px', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
            Report a Garbage Issue
          </h3>
          <p className="text-muted text-sm" style={{ marginBottom: 20 }}>
            See uncollected waste or illegal dumping? let us know
          </p>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button className="btn btn-outline" onClick={() => navigate('/report/submit')}>
              🗂 Submit Report
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/collection/confirm')}>
              ✅ Confirm Collection
            </button>
          </div>
        </div>

        {/* ── Stat Cards ── */}
        <div
          style={{
            overflowX: "auto",
            marginBottom: 24,

            /* Firefox */
            scrollbarWidth: "none",

            /* IE/Edge */
            msOverflowStyle: "none",
          }}
        >
          <div
            className="stat-grid"
            style={{
              display: "flex",
              gap: "16px",
              minWidth: "max-content",
            }}
          >
            
            <div className="stat-card">
              <div className="label">Total Reports</div>
              <div className="value">{stats.total}</div>
            </div>

            <div className="stat-card">
              <div className="label">Pending Approval</div>
              <div className="value" style={{ color: 'var(--warning)' }}>
                {stats.pending_approval}
              </div>
            </div>

            <div className="stat-card">
              <div className="label">Resolved</div>
              <div className="value" style={{ color: 'var(--accent)' }}>
                {stats.resolved}
              </div>
            </div>

            <div className="stat-card">
              <div className="label">Rejected</div>
              <div className="value" style={{ color: 'var(--danger)' }}>
                {stats.rejected}
              </div>
            </div>

          </div>
        </div>

        {/* ── Nearby Collection Points (Map Placeholder) ── */}
        <h3 className="section-title">Nearby Collection Points</h3>
        <div className="card" style={{ padding: 12, marginBottom: 24 }}>
          <div className="map-placeholder">
            <div className="map-pill">
              📍 Active Trucks: 2<br />
              ⚠️ Hotspots Nearby: 3
            </div>
          </div>
          <button
            className="btn btn-outline btn-sm btn-full"
            style={{ marginTop: 8 }}
            disabled
          >
            🗺 Interactive Map View (coming soon)
          </button>
        </div>

        {/* ── My Reports ── */}
        
        <h3 className="section-title">My Reports</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setActiveTab1("reports")}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background: activeTab1 === "reports" ? "var(--accent)" : "#eee",
                color: activeTab1 === "reports" ? "#fff" : "#000000"
              }}
              >
              My Reports
            </button>
            <button onClick={() => setActiveTab1("hotspots")}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background: activeTab1 === "hotspots" ? "var(--accent)" : "#eee",
                color: activeTab1 === "hotspots" ? "#fff" : "#333"
              }}
              >
              Hotspots         
            </button>
        </div>

        <div className="card" style={{ padding: 16 }}>
          {activeTab1 === "reports" ? (
            loading ? (
              <div className="spinner" />
            ) : reports.length === 0 ? (
              <p className="text-muted text-sm text-center" style={{ padding: '20px 0' }}>
                No reports yet.{" "}
                <span
                  style={{ color: "var(--accent)", cursor: "pointer" }}
                  onClick={() => navigate("/report/submit")}
                >
                  Submit your first report
                </span>
              </p>
            ) : (
              reports.slice(0, 10).map(report => (
                <div
                  key={report.id}
                  className="report-item"
                  onClick={() => navigate(`/report/${report.id}`)}
                >
                  <div className="report-pin">📍</div>
                  <div className="report-info">
                    <div className="report-type">
                      {report.issue_type_display}
                      <span className={badgeClass(report.status)}>
                        {report.status}
                      </span>
                    </div>
                    <div className="report-location">
                      {report.barangay_name || "Unknown location"}
                    </div>
                  </div>
                  <div className="report-date">
                    Reported on {report.created_at?.slice(0, 10)}
                  </div>
                </div>
              ))
            )
          ) : (
            <div>
              {/* 👉 HOTSPOTS TAB */}
              <p className="text-muted text-sm text-center" style={{ padding: '20px 0' }}>
                Nearby Hotspots (you can add map or data here)
              </p>
            </div>
          )}
        </div>

        {/* ── Collection Schedule ── */}
         <h3 className="section-title">Your Collection Schedule</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setActiveTab("schedule")}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              background: activeTab === "schedule" ? "var(--accent)" : "#eee",
              color: activeTab === "schedule" ? "#fff" : "#333"
            }}
          >
            Schedule
          </button>

          <button
            onClick={() => setActiveTab("other")}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              background: activeTab === "other" ? "var(--accent)" : "#eee",
              color: activeTab === "other" ? "#fff" : "#333"
            }}
          >
            Other
          </button>
        </div>
        <div className="card" style={{ padding: 16 }}>
          {activeTab === "schedule" ? (
            user?.barangay_name ? (
              <>
                {[
                  { day: 'Monday', time: '6:00 AM – 10:00 AM' },
                  { day: 'Wednesday', time: 'N/A' },
                  { day: 'Monday', time: '6:00 AM – 10:00 AM' },
                ].map((sched, i) => (
                  <div key={i} className="report-item">
                    <div className="report-pin">📅</div>
                    <div className="report-info">
                      <div className="report-type">{sched.day}</div>
                      <div className="report-location">{user.barangay_name}</div>
                    </div>
                    <div className="report-date">{sched.time}</div>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-muted text-sm text-center" style={{ padding: '12px 0' }}>
                No barangay assigned. Contact your administrator.
              </p>
            )
          ) : (
            <div>
              {/* 👉 Future content goes here */}
              <p>Other tab content (you can add anything here later)</p>
            </div>
          )}
        </div>

      </div>
    </>
  )
}
