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

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import GlobalInsights from './GlobalInsights'
import PerformanceAnalytics from './PerformanceAnalytics'
import '../../styles/pages/AnalyticsCenter.css'
import api from '../../api/client'

import { Zap, LayoutDashboard, LineChart, Download, Globe, Gauge, Shield, Flame, RefreshCw, Calendar, Users, Building2, Flag, CheckCircle2, Truck } from 'lucide-react'



// ─── Tab registry ─────────────────────────────────────────────────────────────
const ALL_TABS = [
  { key: 'global', label: 'Global Insights', icon: Globe, roles: ['citizen', 'watcher', 'driver', 'brgy_official', 'admin'] },
  { key: 'perf', label: 'Performance', icon: Gauge, roles: ['driver', 'admin'] },
  { key: 'admin', label: 'Admin Controls', icon: Shield, roles: ['admin'] },
]

function buildTabs(role) {
  return ALL_TABS.filter(t => t.roles.includes(role))
}

// ─── Admin Controls ───────────────────────────────────────────────────────────
function AdminControls() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true); setError(null)
    api.get('/api/analytics/system-overview/', { signal: ctrl.signal })
      .then(res => { setData(res.data); setLoading(false) })
      .catch(err => {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return
        setData(null)
        setError(err.response?.data?.detail || 'Could not load system overview.')
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [tick])

  const ACTIONS = [
    { label: 'Manage Hotspots', icon: Flame, color: 'var(--danger)', bg: 'rgba(231,76,60,.08)', border: 'rgba(231,76,60,.25)', onClick: () => navigate('/admin/hotspots') },
    { label: 'Schedule Collection', icon: Calendar, color: 'var(--warning)', bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.25)', onClick: () => navigate('/schedule') },
  ]

  const fmt = n => (n ?? 0).toLocaleString()
  const SYS = data ? [
    { label: 'Registered Users', value: fmt(data.users), icon: Users, color: 'var(--info)' },
    { label: 'Barangays', value: fmt(data.barangays), icon: Building2, color: 'var(--accent)' },
    { label: 'Reports Filed', value: fmt(data.reports_total), icon: Flag, color: 'var(--warning)' },
    { label: 'Resolved Reports', value: fmt(data.reports_resolved), icon: CheckCircle2, color: 'var(--accent)' },
    { label: 'Trucks', value: fmt(data.trucks), icon: Truck, color: 'var(--info)' },
    { label: 'Hotspots', value: fmt(data.hotspots), icon: Flame, color: 'var(--danger)' },
  ] : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ac-card">
        <div className="ac-card-head" style={{ marginBottom: 14 }}>
          <div className="ac-card-left">
            <div className="ac-card-icon"><Zap size={18} /></div>
            <div className="ac-card-titles">
              <div className="ac-card-title">Quick Admin Actions</div>
              <div className="ac-card-sub">Jump to management pages</div>
            </div>
          </div>
        </div>
        <div className="ac-admin-grid">
          {ACTIONS.map(a => {
            const Icon = a.icon
            return (
              <button key={a.label} onClick={a.onClick} className="ac-admin-action"
                style={{ background: a.bg, border: `1px solid ${a.border}`, color: a.color }}>
                <Icon size={22} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{a.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="ac-card">
        <div className="ac-card-head" style={{ marginBottom: 14 }}>
          <div className="ac-card-left">
            <div className="ac-card-icon ac-card-icon--blue"><LayoutDashboard size={18} /></div>
            <div className="ac-card-titles">
              <div className="ac-card-title">System Overview</div>
              <div className="ac-card-sub">Platform-wide totals (all time)</div>
            </div>
          </div>
          <button className="ac-export-btn" onClick={() => setTick(t => t + 1)} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        {loading && !data && <div className="spinner" style={{ margin: '20px auto' }} />}
        {error && <div style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>{error}</div>}
        {data && (
          <div className="ac-sys-grid" style={{ opacity: loading ? .6 : 1 }}>
            {SYS.map(s => {
              const Icon = s.icon
              return (
                <div key={s.label} className="ac-sys-card">
                  <Icon size={20} color={s.color} />
                  <div className="ac-sys-val">{s.value}</div>
                  <div className="ac-sys-label">{s.label}</div>
                </div>
              )
            })}
          </div>
        )}
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

  const fmtLocalDate = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayStr = fmtLocalDate(new Date())
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const defaultFrom = fmtLocalDate(thirtyDaysAgo)

  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(todayStr)

  function handleToday() {
    const today = fmtLocalDate(new Date())
    setDateFrom(today)
    setDateTo(today)
  }

  const canPickBarangay = ['admin', 'watcher', 'driver'].includes(role)
  const effectiveBarangay = canPickBarangay ? selectedBarangay : String(user?.barangay ?? '')

  async function handleExport() {
    const params = new URLSearchParams({
      barangay_id: effectiveBarangay,
      date_from: dateFrom,
      date_to: dateTo,
    })
    try {
      const res = await api.get(`/api/analytics/export/?${params}`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `wastewatch_analytics_${dateFrom}_to_${dateTo}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Export failed. You may not have permission.')
    }
  }

  const selectedBrgyName = effectiveBarangay === 'all'
    ? 'City-wide View'
    : ((barangays ?? []).find(b => String(b.id) === effectiveBarangay)?.name || 'Selected Barangay')



  return (
    <DashboardLayout>
      {/* ════════ COMMAND CENTER HEADER — sticky below topbar ════════ */}
      <div className="ac-header ac-header--sticky">
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

            {/* Right: filters */}
            <div className="ac-filters">
              {/* Barangay */}
              <div className="ac-filter-group">
                <div className="ac-filter-label">Barangay</div>
                <select
                  className="ac-filter-select"
                  value={effectiveBarangay}
                  onChange={e => setSelectedBarangay(e.target.value)}
                  disabled={!canPickBarangay}
                  aria-label="Select barangay"
                >
                  {canPickBarangay && <option value="all">All Barangays</option>}
                  {(barangays ?? []).map(b => (
                    <option key={b.id} value={String(b.id)}>{b.name}</option>
                  ))}
                </select>
              </div>

              {/* Date From */}
              <div className="ac-filter-group">
                <div className="ac-filter-label">Date From</div>
                <input
                  type="date"
                  className="ac-filter-select"
                  value={dateFrom}
                  max={dateTo}
                  onChange={e => setDateFrom(e.target.value)}
                />
              </div>

              {/* Date To */}
              <div className="ac-filter-group">
                <div className="ac-filter-label">Date To</div>
                <input
                  type="date"
                  className="ac-filter-select"
                  value={dateTo}
                  min={dateFrom}
                  max={todayStr}
                  onChange={e => setDateTo(e.target.value)}
                />
              </div>

              {/* Today Shortcut */}
              <button
                className="ac-export-btn"
                onClick={handleToday}
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                TODAY
              </button>

              {/* Export — only visible to admin and brgy_official (matches backend 403 guard) */}
              {['admin', 'brgy_official'].includes(role) && (
                <button className="ac-export-btn" onClick={handleExport} aria-label="Export analytics data">
                  <Download size={16} />
                  Export
                </button>
              )}
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
      <div className="page" style={{ paddingTop: 20 }}>
        <div className="ac-content" role="tabpanel">

          {active === 'global' && (() => {
            const userBrgyName = (barangays ?? []).find(b => String(b.id) === String(user?.barangay))?.name ?? user?.barangay
            return (
              <GlobalInsights
                userBarangay={userBrgyName}
                selectedBarangay={effectiveBarangay}
                dateFrom={dateFrom}
                dateTo={dateTo}
              />
            )
          })()}

          {active === 'perf' && (
            <PerformanceAnalytics
              selectedBarangay={effectiveBarangay}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          )}
          {active === 'admin' && <AdminControls />}

        </div>
      </div>
    </DashboardLayout>
  )
}