/**
 * AnalyticsTabs.jsx — Role-aware analytics page at /analytics
 * ------------------------------------------------------------
 * No emojis. Material Symbols Outlined via .msi class.
 * Design matches WasteWatch .card / .btn / .section-title system.
 */

import { useState, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import GlobalInsights from './GlobalInsights'
import DriverAnalytics from '../driver/DriverAnalytics'

// ─── Spinner ──────────────────────────────────────────────────────────────────
function TabSpinner() {
  return <div className="spinner" />
}

// ─── Tab definitions ──────────────────────────────────────────────────────────
const ALL_TABS = [
  { key: 'global', label: 'Global Insights', icon: 'public',        roles: ['citizen', 'watcher', 'driver', 'barangay_official', 'admin'] },
  { key: 'perf',   label: 'Performance',     icon: 'speed',         roles: ['driver', 'admin'] },
  { key: 'admin',  label: 'Admin Controls',  icon: 'admin_panel_settings', roles: ['admin'] },
]

function buildTabs(role) {
  return ALL_TABS.filter(t => t.roles.includes(role))
}

// ─── Admin Controls Panel ─────────────────────────────────────────────────────
function AdminControls() {
  const navigate = useNavigate()
  const [toast, setToast] = useState(null)

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const ACTIONS = [
    { label: 'Add Announcement', icon: 'campaign',         color: 'var(--warning)', bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.25)', onClick: () => show('Announcement editor coming soon.') },
    { label: 'Flag Hotspot',      icon: 'local_fire_department', color: 'var(--danger)',  bg: 'rgba(231,76,60,.08)',  border: 'rgba(231,76,60,.25)',  onClick: () => show('Hotspot flagging coming soon.') },
    { label: 'Refresh Rankings',  icon: 'refresh',          color: 'var(--accent)',  bg: 'rgba(46,204,113,.08)',border: 'rgba(46,204,113,.25)', onClick: () => show('Rankings refreshed.') },
    { label: 'Export Analytics',  icon: 'download',         color: 'var(--info)',    bg: 'rgba(93,173,226,.08)', border: 'rgba(93,173,226,.25)', onClick: () => show('Export queued — CSV downloading.') },
  ]

  const SYS = [
    { label: 'Registered Users',    value: '1,243', icon: 'group',              color: 'var(--info)'    },
    { label: 'Active Barangays',    value: '33',    icon: 'location_city',       color: 'var(--accent)'  },
    { label: 'Total Reports Filed', value: '4,781', icon: 'flag',               color: 'var(--warning)' },
    { label: 'Resolved Issues',     value: '4,102', icon: 'check_circle',       color: 'var(--accent)'  },
  ]

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface-3)', color: '#fff', padding: '10px 20px',
          borderRadius: 10, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(255,255,255,.1)', whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      {/* Link to full admin analytics */}
      <div className="card" style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
        border: '1px solid var(--border)',
      }}>
        <span className="msi" style={{ fontSize: 28, color: 'var(--text-muted)', flexShrink: 0 }}>analytics</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 3 }}>Full Performance Analytics</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Truck efficiency · Missed stops · Driver reports</div>
        </div>
        <button
          onClick={() => navigate('/admin/analytics')}
          className="btn btn-outline btn-sm"
          style={{ flexShrink: 0 }}
        >
          Open
          <span className="msi" style={{ fontSize: 16, marginLeft: 3 }}>arrow_forward</span>
        </button>
      </div>

      {/* Quick actions */}
      <div className="card">
        <div className="form-label" style={{ marginBottom: 12 }}>Quick Admin Actions</div>
        <div className="grid-2">
          {ACTIONS.map(a => (
            <button key={a.label} onClick={a.onClick} style={{
              background: a.bg, border: `1px solid ${a.border}`,
              color: a.color, borderRadius: 'var(--radius)', padding: '13px 12px',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
              fontFamily: 'var(--font-body)', textAlign: 'left',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span className="msi" style={{ fontSize: 22 }}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* System overview */}
      <div className="card">
        <div className="form-label" style={{ marginBottom: 12 }}>System Overview</div>
        <div className="grid-2">
          {SYS.map(s => (
            <div key={s.label} style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '12px',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <span className="msi" style={{ fontSize: 20, color: s.color }}>{s.icon}</span>
              <div style={{ fontWeight: 700, fontSize: 22, color: 'var(--text)' }}>{s.value}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.04em' }}>
                {s.label.toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalyticsTabs() {
  const { user } = useAuth()
  const role         = user?.role?.toLowerCase() || 'citizen'
  const userBarangay = user?.barangay_name || ''
  const navigate     = useNavigate()

  const tabs = buildTabs(role)
  const [active, setActive] = useState(tabs[0]?.key || 'global')

  return (
    <DashboardLayout>
      <div className="page">

        {/* ── Page header ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="msi" style={{ fontSize: 24, color: 'var(--accent)' }}>analytics</span>
            <h2 className="section-title" style={{ margin: 0 }}>Analytics</h2>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
              background: 'rgba(46,204,113,.1)', color: 'var(--accent)',
              border: '1px solid rgba(46,204,113,.25)', borderRadius: 20,
              padding: '2px 9px',
            }}>
              Lucena City
            </span>
          </div>
          <p className="text-muted text-sm">
            City-wide waste management insights ·{' '}
            {role === 'admin' ? 'Admin view' : role === 'driver' ? 'Driver + Public view' : 'Public view'}
          </p>
        </div>

        {/* ── Tab bar ── */}
        <div style={{
          display: 'flex', gap: 2, marginBottom: 20,
          background: 'var(--bg)', borderRadius: 10,
          padding: 3, border: '1px solid var(--border)',
          overflowX: 'auto',
        }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 13px', borderRadius: 8, border: 'none',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer',
                background: active === t.key ? 'var(--surface)' : 'transparent',
                color: active === t.key ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: active === t.key ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
                borderBottom: active === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <span className="msi" style={{ fontSize: 16 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div key={active}>
          {active === 'global' && (
            <GlobalInsights userBarangay={userBarangay} />
          )}

          {active === 'perf' && (
            <Suspense fallback={<TabSpinner />}>
              {role === 'admin' && (
                <div className="card" style={{
                  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
                }}>
                  <span className="msi" style={{ fontSize: 26, color: 'var(--text-muted)', flexShrink: 0 }}>local_shipping</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
                      Viewing city-wide driver analytics
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      For full truck efficiency data, visit{' '}
                      <button
                        onClick={() => navigate('/admin/analytics')}
                        style={{
                          background: 'none', border: 'none', color: 'var(--accent)',
                          fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 11,
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        Admin Performance Analytics
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <DriverAnalytics />
            </Suspense>
          )}

          {active === 'admin' && <AdminControls />}
        </div>

      </div>
    </DashboardLayout>
  )
}
