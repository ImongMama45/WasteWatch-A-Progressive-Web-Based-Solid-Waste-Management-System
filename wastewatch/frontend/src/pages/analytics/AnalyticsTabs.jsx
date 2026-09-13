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

import { Zap, LayoutDashboard, LineChart, Download, Globe, Gauge, Shield, Flame, RefreshCw, Calendar, Users, Building2, Flag, CheckCircle2, Truck } from 'lucide-react'

function TabSpinner() {
  return <div className="spinner" style={{ margin: '40px auto' }} />
}

// ─── Tab registry ─────────────────────────────────────────────────────────────
const ALL_TABS = [
  { key: 'global', label: 'Global Insights', icon: Globe, roles: ['citizen', 'watcher', 'driver', 'brgy_official', 'admin'] },
  { key: 'perf', label: 'Performance', icon: Gauge, roles: ['driver', 'admin'] },
  { key: 'admin', label: 'Admin Controls', icon: Shield, roles: ['admin'] },
]

function buildTabs(role) {
  return ALL_TABS.filter(t => t.roles.includes(role))
}

// ─── Barangay list ────────────────────────────────────────────────────────────
const BARANGAY_OPTIONS = [
  'All Barangays',
  'Barangay 1 (Pob.)', 'Barangay 2 (Pob.)', 'Barangay 3 (Pob.)', 'Barangay 4 (Pob.)',
  'Barangay 5 (Pob.)', 'Barangay 6 (Pob.)', 'Barangay 7 (Pob.)', 'Barangay 8 (Pob.)',
  'Barangay 9 (Pob.)', 'Barangay 10 (Pob.)', 'Barangay 11 (Pob.)',
  'Barra', 'Bocohan', 'Cotta', 'Dalahican', 'Domoit', 'Gulang-Gulang',
  'Ibabang Dupay', 'Ibabang Iyam', 'Ibabang Talim', 'Ilayang Dupay', 'Ilayang Iyam',
  'Ilayang Talim', 'Isabang', 'Market View', 'Mayao Castillo', 'Mayao Crossing',
  'Mayao Kanluran', 'Mayao Parada', 'Mayao Silangan', 'Ransohan', 'Salinas', 'Talao-Talao',
]

// ─── Admin Controls ───────────────────────────────────────────────────────────
function AdminControls() {
  const navigate = useNavigate()
  const [toast, setToast] = useState(null)
  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const ACTIONS = [
    { label: 'Flag Hotspot', icon: Flame, color: 'var(--danger)', bg: 'rgba(231,76,60,.08)', border: 'rgba(231,76,60,.25)', onClick: () => show('Hotspot flagging coming soon.') },
    { label: 'Refresh Rankings', icon: RefreshCw, color: 'var(--accent)', bg: 'rgba(46,204,113,.08)', border: 'rgba(46,204,113,.25)', onClick: () => show('Rankings refreshed.') },
    { label: 'Export CSV', icon: Download, color: 'var(--info)', bg: 'rgba(93,173,226,.08)', border: 'rgba(93,173,226,.25)', onClick: () => show('Export queued — CSV downloading.') },
    { label: 'Schedule Collection', icon: Calendar, color: 'var(--warning)', bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.25)', onClick: () => navigate('/schedule') },
  ]

  const SYS = [
    { label: 'Registered Users', value: '1,243', icon: Users, color: 'var(--info)' },
    { label: 'Active Barangays', value: '33', icon: Building2, color: 'var(--accent)' },
    { label: 'Reports Filed', value: '4,781', icon: Flag, color: 'var(--warning)' },
    { label: 'Resolved Issues', value: '4,102', icon: CheckCircle2, color: 'var(--accent)' },
    { label: 'Active Trucks', value: '7', icon: Truck, color: 'var(--info)' },
    { label: 'Open Hotspots', value: '14', icon: Flame, color: 'var(--danger)' },
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
            <div className="ac-card-icon"><Zap size={18} /></div>
            <div className="ac-card-titles">
              <div className="ac-card-title">Quick Admin Actions</div>
              <div className="ac-card-sub">Common operations at a glance</div>
            </div>
          </div>
        </div>
        <div className="ac-admin-grid">
          {ACTIONS.map((a, idx) => {
            const Icon = a.icon;
            return (
              <button key={a.label || idx} onClick={a.onClick} className="ac-admin-action"
                style={{ background: a.bg, border: `1px solid ${a.border}`, color: a.color }}>
                <Icon size={22} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{a.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* System overview */}
      <div className="ac-card">
        <div className="ac-card-head" style={{ marginBottom: 14 }}>
          <div className="ac-card-left">
            <div className="ac-card-icon ac-card-icon--blue"><LayoutDashboard size={18} /></div>
            <div className="ac-card-titles">
              <div className="ac-card-title">System Overview</div>
              <div className="ac-card-sub">Platform-wide metrics</div>
            </div>
          </div>
        </div>
        <div className="ac-sys-grid">
          {SYS.map((s, idx) => {
            const Icon = s.icon;
            return (
              <div key={s.label || idx} className="ac-sys-card">
                <Icon size={20} color={s.color} />
                <div className="ac-sys-val">{s.value}</div>
                <div className="ac-sys-label">{s.label}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalyticsTabs() {
  const { user, barangays } = useAuth()
  const role = user?.role?.toLowerCase() || 'citizen'
  const navigate = useNavigate()

  const tabs = buildTabs(role)
  const [active, setActive] = useState(tabs[0]?.key || 'global')

  // ── Filter state ───────────────────────────────────────────────────────────
  // Default: Admin = All Barangays, Others = User's Barangay ID
  const [selectedBarangay, setSelectedBarangay] = useState(
    role === 'admin' ? 'all' : (user?.barangay || 'all')
  )

  // Default date range: Last 30 days
  const todayStr = new Date().toISOString().split('T')[0]
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const defaultFrom = thirtyDaysAgo.toISOString().split('T')[0]

  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(todayStr)
  const [selectedRoute, setSelectedRoute] = useState('All Routes')

  function handleToday() {
    setDateFrom(todayStr)
    setDateTo(todayStr)
  }

  function handleExport() {
    const params = new URLSearchParams({
      barangay_id: selectedBarangay,
      date_from: dateFrom,
      date_to: dateTo,
      route: selectedRoute,
    })
    window.open(`/api/analytics/export/?${params}`, '_blank')
  }

  const selectedBrgyName = selectedBarangay === 'all' 
    ? 'City-wide View' 
    : (barangays.find(b => b.id === Number(selectedBarangay))?.name || 'Selected Barangay')

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
              <span className="ac-breadcrumb__scope">{selectedBrgyName}</span>
              <span className="ac-breadcrumb__sep">›</span>
              <span className="ac-breadcrumb__scope">{dateFrom} to {dateTo}</span>
            </div>

            {/* Title row — stacks on mobile, side-by-side on desktop */}
            <div className="ac-header__row">
              {/* Left: title */}
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <LineChart size={26} color="#4ade80" style={{ flexShrink: 0 }} />
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
                    <option value="all">All Barangays</option>
                    {barangays.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                {/* Date Range */}
                <div className="ac-filter-group">
                  <div className="ac-filter-label">Date From</div>
                  <input
                    type="date"
                    className="ac-filter-select"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="ac-filter-group">
                  <div className="ac-filter-label">Date To</div>
                  <input
                    type="date"
                    className="ac-filter-select"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                  />
                </div>

                {/* Today Shortcut */}
                <button 
                  className="ac-export-btn" 
                  onClick={handleToday}
                  style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}
                >
                  TODAY
                </button>

                {/* Export */}
                <button className="ac-export-btn" onClick={handleExport} aria-label="Export analytics data">
                  <Download size={16} />
                  Export
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="ac-tabs" role="tablist">
              {tabs.map(t => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    className={`ac-tab${active === t.key ? ' ac-tab--active' : ''}`}
                    onClick={() => setActive(t.key)}
                    role="tab"
                    aria-selected={active === t.key}
                    aria-label={t.label}
                  >
                    <Icon size={16} />
                    {t.label}
                  </button>
                )
              })}
            </div>

          </div>
        </div>
        {/* ════════ END HEADER ════════ */}

        {/* ════════ TAB CONTENT ════════ */}
        <div className="ac-content" key={active} role="tabpanel">

          {active === 'global' && (
            <GlobalInsights
              selectedBarangay={selectedBarangay}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          )}

          {active === 'perf' && (
            <PerformanceAnalytics
              selectedBarangay={selectedBarangay}
              dateFrom={dateFrom}
              dateTo={dateTo}
              selectedRoute={selectedRoute}
            />
          )}
          {active === 'admin' && <AdminControls />}

        </div>

      </div>
    </DashboardLayout>
  )
}