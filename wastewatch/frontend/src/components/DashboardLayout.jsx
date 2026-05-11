/**
 * DashboardLayout.jsx
 * --------------------
 * Wraps dashboard pages to provide:
 *   - Desktop (≥1024px): Left sidebar nav + slim top bar (search + profile)
 *   - Mobile  (<1024px): Top navbar + bottom nav (unchanged)
 *
 * Each role gets its own set of sidebar nav items.
 * The sidebar is fixed on the left; main content flows beside it.
 */

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Navbar from './Navbar'
import { useOnline } from '../hooks/useOnline'
import BottomNav from './BottomNav'

// ─── Role-based sidebar nav items ─────────────────────────────────────────────

export const SIDEBAR_NAV = {
  admin: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/schedule', label: 'Schedule', icon: '📅' },
    { path: '/map', label: 'Live Map', icon: '🗺️' },
    { path: '/brgy/validate-reports', label: 'Reports', icon: '📋' },
    { path: '/admin/trucks', label: 'Trucks & Drivers', icon: '🚛' },
    { path: '/admin/users', label: 'User Management', icon: '👥' },
    { path: '/admin/dumpsites', label: 'Dumpsites', icon: '🏔️' },
    { path: '/admin/routes', label: 'Route Builder', icon: '🗺️' },
    { path: '/admin/escalations', label: 'Escalations', icon: '⚠️' },
    { path: '/admin/analytics', label: 'Analytics', icon: '📈' },
    { path: '/admin/hotspots', label: 'Hotspots', icon: '🔥' },
    { path: '/admin/notifications', label: 'Notifications', icon: '🔔' },
    { path: '/admin/activity-log', label: 'Activity Log', icon: '📝' },
  ],
  barangay_official: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/schedule', label: 'Schedule', icon: '📅' },
    { path: '/map', label: 'Live Map', icon: '🗺️' },
    { path: '/brgy/validate-reports', label: 'Reports', icon: '📋' },
    { path: '/brgy/escalate', label: 'Escalations', icon: '📨' },
  ],
  watcher: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/schedule', label: 'Schedule', icon: '📅' },
    { path: '/map', label: 'Live Map', icon: '🗺️' },
    { path: '/verification-tasks', label: 'Verifications', icon: '✅' },
  ],
  citizen: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/schedule', label: 'Schedule', icon: '📅' },
    { path: '/map', label: 'Live Map', icon: '🗺️' },
  ],
  driver: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/driver/route', label: 'My Route', icon: '🗺️' },
    { path: '/driver/log', label: 'Collection Log', icon: '📋' },
    { path: '/driver/analytics', label: 'Analytics', icon: '📈' },
    { path: '/driver/hotspots', label: 'Hotspot Alerts', icon: '🔥' },
    { path: '/driver/status', label: 'Shift & Truck', icon: '🚛' },
    { path: '/map', label: 'Live Map', icon: '📍' },
    { path: '/profile', label: 'Profile', icon: '👤' },
  ],
}

// ─── Sidebar SVG Icons (clean line icons) ─────────────────────────────────────

const NAV_ICONS = {
  '📊': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  '🗺️': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
  '📋': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  ),
  '📨': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  '✅': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  '🚛': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <rect x="1" y="3" width="15" height="13" rx="1" />
      <path d="M16 8h4l3 5v3h-7V8z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  ),
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchVal, setSearchVal] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const isOnline = useOnline()


  const role = user?.role?.toLowerCase() || 'citizen'
  const navItems = SIDEBAR_NAV[role] || SIDEBAR_NAV.citizen

  const isActive = (path) => location.pathname === path

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <>
      {/* ── MOBILE: keep existing top + bottom nav ── */}
      <div className="layout-mobile">
        <Navbar />
      </div>

      {/* ── DESKTOP: left sidebar + top bar ── */}
      <div className="layout-desktop">

        {/* ─── Left Sidebar ─── */}
        <aside className="desktop-sidebar">
          {/* Logo */}
          <div className="desktop-sidebar-logo" onClick={() => navigate('/dashboard')}>
            <h1 className="logo">
              <img src="../../public/logo.svg" alt="Logo"></img>
            </h1>
          </div>

          {/* Nav Items */}
          <nav className="desktop-sidebar-nav">
            {navItems.map(item => (
              <button
                key={item.path}
                className={`desktop-sidebar-item ${isActive(item.path) ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span className="desktop-sidebar-icon">
                  {NAV_ICONS[item.icon] || item.icon}
                </span>
                <span className="desktop-sidebar-label">{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Bottom: Logout */}
          <div className="desktop-sidebar-footer">
            <button className="desktop-sidebar-item" onClick={handleLogout}>
              <span className="desktop-sidebar-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </span>
              <span className="desktop-sidebar-label">Logout</span>
            </button>
          </div>
        </aside>

        {/* ─── Top Bar (desktop only, right of sidebar) ─── */}
        <header className="desktop-topbar">
          <div className="desktop-topbar-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search..."
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
            />
          </div>

          <div className="desktop-topbar-right">
            <button
              className="notif-btn"
              onClick={() => { setNotifOpen(o => !o) }}
              aria-label="Notifications"
            >
              🔔
              <span className="notif-dot" style={{
                background: isOnline ? 'var(--danger)' : 'var(--warning)',
              }} />
            </button>
            {/* User avatar */}

            <div className="desktop-topbar-user" onClick={() => navigate('/profile')}>
              <div className="desktop-topbar-avatar">
                {user?.full_name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="desktop-topbar-userinfo">
                <div className="desktop-topbar-username">{user?.full_name || 'User'}</div>
                <div className="desktop-topbar-userrole">{role.replace('_', ' ')}</div>
              </div>
            </div>
          </div>
        </header>
      </div>
      {notifOpen && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>
              Notifications
              {!isOnline && (
                <span style={{ fontSize: 10, color: 'var(--warning)', marginLeft: 8, fontWeight: 400 }}>
                  (offline — cached)
                </span>
              )}
            </span>
            <button onClick={() => setNotifOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>
              ×
            </button>
          </div>
          <div className="notif-item unread">
            <div className="notif-dot-inline" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Report #3 resolved</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>2 hours ago</div>
            </div>
          </div>
          <div className="notif-item">
            <div style={{ width: 8 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Welcome to WasteWatch!</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>3 days ago</div>
            </div>
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
            <button style={{ width: '100%', background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
              Mark all as read
            </button>
          </div>
        </div>
      )}

      {/* ── Main Content Area ── */}
      <main className="dashboard-main">
        {children}
      </main>

      {/* ── MOBILE: bottom nav ── */}
      <div className="layout-mobile">
        <BottomNav />
      </div>

      {/* Backdrop */}
      {(notifOpen) && (
        <div className="nav-backdrop"
          onClick={() => { setNotifOpen(false) }} />
      )}
    </>
  )
}
