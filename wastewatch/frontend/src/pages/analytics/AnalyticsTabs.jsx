/**
 * AnalyticsTabs.jsx — Role-aware analytics command center at /analytics
 * -----------------------------------------------------------------------
 * Layout fixes (v2):
 *   - ac-header margin bleed now matches .page padding at every breakpoint
 *   - ac-filters wrapped in a scroll container on mobile (no overflow)
 *   - ac-content padding-top reduced to prevent double-gap with header
 *   - selectedBarangay / selectedPeriod / selectedRoute filter state
 *     passed down to GlobalInsights (unchanged logic)
 */

import { useState, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import GlobalInsights from './GlobalInsights'
import PerformanceAnalytics from './PerformanceAnalytics'
import '../../styles/pages/AnalyticsCenter.css'

function TabSpinner() {
  return <div className="spinner" style={{ margin: '40px auto' }} />
}

// ─── Tab registry ─────────────────────────────────────────────────────────────
const ALL_TABS = [
  { key: 'global', label: 'Barangay Analytics', icon: 'public',                roles: ['citizen', 'watcher', 'driver', 'barangay_official', 'admin'] },
  { key: 'perf',   label: 'Performance',         icon: 'speed',                roles: ['driver', 'admin'] },
  { key: 'admin',  label: 'Admin Controls',       icon: 'admin_panel_settings', roles: ['admin'] },
]

function buildTabs(role) {
  return ALL_TABS.filter(t => t.roles.includes(role))
}

// ─── Barangay list ────────────────────────────────────────────────────────────
const BARANGAY_OPTIONS = [
  'All Barangays',
  'Barangay 1 (Pob.)','Barangay 2 (Pob.)','Barangay 3 (Pob.)','Barangay 4 (Pob.)',
  'Barangay 5 (Pob.)','Barangay 6 (Pob.)','Barangay 7 (Pob.)','Barangay 8 (Pob.)',
  'Barangay 9 (Pob.)','Barangay 10 (Pob.)','Barangay 11 (Pob.)',
  'Barra','Bocohan','Cotta','Dalahican','Domoit','Gulang-Gulang',
  'Ibabang Dupay','Ibabang Iyam','Ibabang Talim','Ilayang Dupay','Ilayang Iyam',
  'Ilayang Talim','Isabang','Market View','Mayao Castillo','Mayao Crossing',
  'Mayao Kanluran','Mayao Parada','Mayao Silangan','Ransohan','Salinas','Talao-Talao',
]

// ─── Admin Controls ───────────────────────────────────────────────────────────
function AdminControls() {
  const navigate = useNavigate()
  const [toast, setToast] = useState(null)
  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const ACTIONS = [
    { label: 'Flag Hotspot',        icon: 'local_fire_department', color: 'var(--danger)',  bg: 'rgba(231,76,60,.08)',   border: 'rgba(231,76,60,.25)',   onClick: () => show('Hotspot flagging coming soon.') },
    { label: 'Refresh Rankings',    icon: 'refresh',               color: 'var(--accent)',  bg: 'rgba(46,204,113,.08)',  border: 'rgba(46,204,113,.25)',  onClick: () => show('Rankings refreshed.') },
    { label: 'Export CSV',          icon: 'download',              color: 'var(--info)',    bg: 'rgba(93,173,226,.08)',  border: 'rgba(93,173,226,.25)',  onClick: () => show('Export queued — CSV downloading.') },
    { label: 'Schedule Collection', icon: 'calendar_month',        color: 'var(--warning)', bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.25)', onClick: () => navigate('/schedule') },
  ]

  const SYS = [
    { label: 'Registered Users',   value: '1,243', icon: 'group',                color: 'var(--info)'    },
    { label: 'Active Barangays',   value: '33',    icon: 'location_city',         color: 'var(--accent)'  },
    { label: 'Reports Filed',      value: '4,781', icon: 'flag',                  color: 'var(--warning)' },
    { label: 'Resolved Issues',    value: '4,102', icon: 'check_circle',          color: 'var(--accent)'  },
    { label: 'Active Trucks',      value: '7',     icon: 'local_shipping',        color: 'var(--info)'    },
    { label: 'Open Hotspots',      value: '14',    icon: 'local_fire_department', color: 'var(--danger)'  },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface-3)', color: '#fff', padding: '10px 20px',
          borderRadius: 10, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(255,255,255,.1)', whiteSpace: 'nowrap',
          boxShadow: '0 4px 16px rgba(0,0,0,.3)',
        }}>{toast}</div>
      )}


      {/* Quick actions */}
      <div className="ac-card">
        <div className="ac-card-head" style={{ marginBottom: 14 }}>
          <div className="ac-card-left">
            <div className="ac-card-icon"><span className="msi" style={{ fontSize: 18 }}>bolt</span></div>
            <div className="ac-card-titles">
              <div className="ac-card-title">Quick Admin Actions</div>
              <div className="ac-card-sub">Common operations at a glance</div>
            </div>
          </div>
        </div>
        <div className="ac-admin-grid">
          {ACTIONS.map(a => (
            <button key={a.label} onClick={a.onClick} className="ac-admin-action"
              style={{ background: a.bg, border: `1px solid ${a.border}`, color: a.color }}>
              <span className="msi" style={{ fontSize: 22 }}>{a.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* System overview */}
      <div className="ac-card">
        <div className="ac-card-head" style={{ marginBottom: 14 }}>
          <div className="ac-card-left">
            <div className="ac-card-icon ac-card-icon--blue"><span className="msi" style={{ fontSize: 18 }}>dashboard</span></div>
            <div className="ac-card-titles">
              <div className="ac-card-title">System Overview</div>
              <div className="ac-card-sub">Platform-wide metrics</div>
            </div>
          </div>
        </div>
        <div className="ac-sys-grid">
          {SYS.map(s => (
            <div key={s.label} className="ac-sys-card">
              <span className="msi" style={{ fontSize: 20, color: s.color }}>{s.icon}</span>
              <div className="ac-sys-val">{s.value}</div>
              <div className="ac-sys-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalyticsTabs() {
  const { user }     = useAuth()
  const role         = user?.role?.toLowerCase() || 'citizen'
  const userBarangay = user?.barangay_name || ''
  const navigate     = useNavigate()

  const tabs = buildTabs(role)
  const [active, setActive] = useState(tabs[0]?.key || 'global')

  // ── Filter state ───────────────────────────────────────────────────────────
  const [selectedBarangay, setSelectedBarangay] = useState('All Barangays')
  const [selectedPeriod,   setSelectedPeriod]   = useState('This Week')
  const [selectedRoute,    setSelectedRoute]     = useState('All Routes')

  function handleExport() {
    const params = new URLSearchParams({
      barangay: selectedBarangay,
      period:   selectedPeriod,
      route:    selectedRoute,
    })
    window.open(`/api/analytics/export/?${params}`, '_blank')
  }

  const scopeBarangay = selectedBarangay === 'All Barangays' ? 'City-wide View' : selectedBarangay

  return (
    <DashboardLayout>
      <div className="page">

        {/* ════════ COMMAND CENTER HEADER ════════ */}
        <div className="ac-header">
          <div className="ac-header__inner">

            {/* Breadcrumb */}
            <div className="ac-breadcrumb">
              <span className="ac-breadcrumb__city">Lucena City</span>
              <span className="ac-breadcrumb__sep">›</span>
              <span className="ac-breadcrumb__city">CENRO</span>
              <span className="ac-breadcrumb__sep">›</span>
              <span className="ac-breadcrumb__scope">{scopeBarangay}</span>
              <span className="ac-breadcrumb__sep">›</span>
              <span className="ac-breadcrumb__scope">{selectedPeriod}</span>
            </div>

            {/* Title row — stacks on mobile, side-by-side on desktop */}
            <div className="ac-header__row">
              {/* Left: title */}
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span className="msi" style={{ fontSize: 26, color: '#4ade80', flexShrink: 0 }}>analytics</span>
                  <h1 className="ac-display-title">Analytics Command Center</h1>
                </div>
                <p className="ac-display-sub">
                  Smart Waste Management Intelligence ·{' '}
                  {role === 'admin'
                    ? 'Administrator · Full Access'
                    : role === 'driver'
                      ? 'Driver + Public View'
                      : 'Citizen Portal'}
                </p>
              </div>

              {/* Right: filters — horizontally scrollable on mobile */}
              <div className="ac-filters">
                {/* Barangay */}
                <div className="ac-filter-group">
                  <div className="ac-filter-label">Barangay</div>
                  <select
                    className="ac-filter-select"
                    value={selectedBarangay}
                    onChange={e => setSelectedBarangay(e.target.value)}
                    aria-label="Select barangay"
                  >
                    {BARANGAY_OPTIONS.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                {/* Period */}
                <div className="ac-filter-group">
                  <div className="ac-filter-label">Date Range</div>
                  <select
                    className="ac-filter-select"
                    value={selectedPeriod}
                    onChange={e => setSelectedPeriod(e.target.value)}
                    aria-label="Select date range"
                  >
                    {['Today','This Week','This Month','This Quarter','This Year'].map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))} 
                  </select>
                </div>

                {/* Route — admin / driver only */}
                {(role === 'admin' || role === 'driver') && (
                  <div className="ac-filter-group">
                    <div className="ac-filter-label">Route</div>
                    <select
                      className="ac-filter-select"
                      value={selectedRoute}
                      onChange={e => setSelectedRoute(e.target.value)}
                      aria-label="Select collection route"
                    >
                      {['All Routes','Zone A','Zone B','Zone C','Zone D'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Export */}
                <button className="ac-export-btn" onClick={handleExport} aria-label="Export analytics data">
                  <span className="msi" style={{ fontSize: 16 }}>download</span>
                  Export
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="ac-tabs" role="tablist">
              {tabs.map(t => (
                <button
                  key={t.key}
                  className={`ac-tab${active === t.key ? ' ac-tab--active' : ''}`}
                  onClick={() => setActive(t.key)}
                  role="tab"
                  aria-selected={active === t.key}
                  aria-label={t.label}
                >
                  <span className="msi" style={{ fontSize: 16 }}>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>

          </div>
        </div>
        {/* ════════ END HEADER ════════ */}

        {/* ════════ TAB CONTENT ════════ */}
        <div className="ac-content" key={active} role="tabpanel">

          {active === 'global' && (
            <GlobalInsights
              userBarangay={userBarangay}
              selectedBarangay={selectedBarangay}
              selectedPeriod={selectedPeriod}
            />
          )}

          {active === 'perf' && (
              <PerformanceAnalytics
                selectedBarangay={selectedBarangay}
                selectedPeriod={selectedPeriod}
                selectedRoute={selectedRoute}
              />
            )}
          {active === 'admin' && <AdminControls />}

        </div>

      </div>
    </DashboardLayout>
  )
}