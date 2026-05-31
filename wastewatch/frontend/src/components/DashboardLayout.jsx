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
    { path: '/analytics', label: 'Brgy Analytics', icon: '📈' },
    { path: '/announcements', label: 'News & Alerts', icon: '📰' },
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
    { path: '/analytics', label: 'Brgy Analytics', icon: '📈' },
    { path: '/announcements', label: 'News & Alerts', icon: '📰' },
    { path: '/schedule', label: 'Schedule', icon: '📅' },
    { path: '/map', label: 'Live Map', icon: '🗺️' },
    { path: '/brgy/validate-reports', label: 'Reports', icon: '📋' },
    { path: '/brgy/escalate', label: 'Escalations', icon: '📨' },
  ],
  watcher: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/analytics', label: 'Brgy Analytics', icon: '📈' },
    { path: '/announcements', label: 'News & Alerts', icon: '📰' },
    { path: '/schedule', label: 'Schedule', icon: '📅' },
    { path: '/map', label: 'Live Map', icon: '🗺️' },
    { path: '/verification-tasks', label: 'Verifications', icon: '✅' },
  ],
  citizen: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/analytics', label: 'Brgy Analytics', icon: '📈' },
    { path: '/announcements', label: 'News & Alerts', icon: '📰' },
    { path: '/schedule', label: 'Schedule', icon: '📅' },
    { path: '/map', label: 'Live Map', icon: '🗺️' },
  ],
  driver: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/analytics', label: 'Brgy Analytics', icon: '📈' },
    { path: '/announcements', label: 'News & Alerts', icon: '📰' },
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

export const NAV_ICONS = {
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
  '🏠': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <polyline points="9 22 9 12 15 12 15 22"></polyline>
    </svg>
  ),
  '📅': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
  ),
  '👥': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
  ),
  '🏔️': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M8 3l4 8 5-5 5 15H2L8 3z"></path>
    </svg>
  ),
  '⚠️': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  ),
  '📈': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
      <polyline points="17 6 23 6 23 12"></polyline>
    </svg>
  ),
  '🔥': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>
    </svg>
  ),
  '🔔': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    </svg>
  ),
  '📝': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
  ),
  '📍': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
      <circle cx="12" cy="10" r="3"></circle>
    </svg>
  ),
  '👤': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  ),
  '🔑': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
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
              {NAV_ICONS['🔔']}
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
