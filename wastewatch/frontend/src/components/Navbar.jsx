/**
 * components/Navbar.jsx
 * ----------------------
 * PWA Navbar:
 * - Unauthenticated: shows Login + Register buttons in top right
 * - Authenticated: shows user avatar + logout
 * - Mobile: hamburger menu
 * - Offline indicator dot on bell icon
 */

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../hooks/useOnline'
import { SIDEBAR_NAV } from './DashboardLayout'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isOnline = useOnline()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/')
    setMenuOpen(false)
  }

  const isActive = (path) => location.pathname === path ? 'active' : ''
  const navTo = (path) => { navigate(path); setMenuOpen(false) }

  const role = user?.role?.toLowerCase() || 'citizen'
  const baseItems = SIDEBAR_NAV[role] || SIDEBAR_NAV.citizen

  // Mobile menu items differ by auth state
  const mobileNavItems = user
    ? [
      ...baseItems.map(item => ({ path: item.path, label: `${item.icon}  ${item.label}` })),
      { path: '/report/submit', label: '🗂  Submit Report' },
      ...(role === 'driver' ? [{ path: '/collection/confirm', label: '✅  Confirm Collection' }] : [])
    ]
    : [
      { path: '/', label: '🏠  Home' },
      { path: '/login', label: '🔑  Login' },
      { path: '/register', label: '📝  Register' },
    ]

  return (
    <>
      <nav className="navbar" style={{ paddingTop: !isOnline ? 32 : undefined }}>
        {/* Left: Hamburger + Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="hamburger-btn"
            onClick={() => { setMenuOpen(o => !o); setNotifOpen(false) }}
            aria-label="Menu"
          >
            <span className={`hamburger-icon ${menuOpen ? 'open' : ''}`}>
              <span /><span /><span />
            </span>
          </button>

          <a
            href="/"
            onClick={e => { e.preventDefault(); navTo('/') }}
            className="navbar-brand"
          >
            <span className="logo"></span>
          </a>
        </div>

        {/* Desktop nav links */}
        <div className="navbar-links">
          <a href="/" className={isActive('/')}
            onClick={e => { e.preventDefault(); navigate('/') }}>
            Dashboard
          </a>
          {user && (
            <a href="/dashboard" className={isActive('/dashboard')}
              onClick={e => { e.preventDefault(); navigate('/dashboard') }}>
              My Dashboard
            </a>
          )}
        </div>

        {/* Right side — auth state */}
        <div className="navbar-right">

          {/* Offline dot on bell */}
          <button
            className="notif-btn"
            onClick={() => { setNotifOpen(o => !o); setMenuOpen(false) }}
            aria-label="Notifications"
          >
            🔔
            <span className="notif-dot" style={{
              background: isOnline ? 'var(--danger)' : 'var(--warning)',
            }} />
          </button>

          {/* Auth buttons */}
          {user ? (
            <>
              {/* Avatar + name on desktop */}
              <div onClick={() => { navTo('/profile'); setMenuOpen(false) }} className="desktop-only" style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  width: 26, height: 26,
                  background: 'var(--accent)',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, color: '#0d1117',
                }}>
                  {user.full_name?.[0]?.toUpperCase() || '?'}
                </div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  {user.full_name?.split(' ')[0]}
                </span>
              </div>
              <button
                className="btn btn-outline btn-sm desktop-only"
                onClick={handleLogout}
              >
                Logout
              </button>
            </>
          ) : (
            /* Not logged in — show Login + Register on desktop */
            <div className="desktop-only" style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => navigate('/login')}
              >
                Sign In
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/register')}
              >
                Register
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* ── Notification Dropdown ── */}
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

      {/* ── Mobile Slide-in Menu ── */}
      {menuOpen && (
        <div className="mobile-menu">
          {/* User info or guest state */}
          <div className="mobile-menu-user">
            <div onClick={() => { navTo('/profile'); setMenuOpen(false) }} style={{
              width: 40, height: 40,
              background: user ? 'var(--accent)' : 'var(--surface-2)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 800,
              color: user ? '#0d1117' : 'var(--text-muted)',
              border: user ? 'none' : '2px dashed var(--border)',
            }}>
              {user ? (user.full_name?.[0] || '?') : '👤'}
            </div>
            <div>
              {user ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{user.full_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user.email}</div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Guest</div>
                  <div style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}
                    onClick={() => navTo('/login')}>
                    Tap to sign in →
                  </div>
                </>
              )}
            </div>
            {/* Offline badge */}
            {!isOnline && (
              <span style={{
                marginLeft: 'auto',
                background: 'rgba(243,156,18,.15)',
                color: 'var(--warning)',
                fontSize: 10, fontWeight: 700,
                padding: '3px 8px', borderRadius: 20,
              }}>
                OFFLINE
              </span>
            )}
          </div>

          <nav style={{ padding: '8px 0' }}>
            {mobileNavItems.map(({ path, label }) => (
              <button key={path} onClick={() => navTo(path)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '13px 20px',
                  background: location.pathname === path ? 'rgba(46,204,113,.1)' : 'none',
                  border: 'none',
                  color: location.pathname === path ? 'var(--accent)' : 'var(--text)',
                  fontSize: 14, fontFamily: 'var(--font-body)', cursor: 'pointer',
                  borderLeft: location.pathname === path
                    ? '3px solid var(--accent)'
                    : '3px solid transparent',
                }}>
                {label}
              </button>
            ))}
          </nav>

          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
            {user ? (
              <>
                <button className="btn btn-outline btn-full" style={{ marginBottom: 10 }} onClick={() => navTo('/profile')}>
                  My Profile
                </button>
                <button className="btn btn-outline btn-full" onClick={handleLogout}>
                  Logout
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline" style={{ flex: 1 }}
                  onClick={() => navTo('/login')}>
                  Sign In
                </button>
                <button className="btn btn-primary" style={{ flex: 1 }}
                  onClick={() => navTo('/register')}>
                  Register
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backdrop */}
      {(menuOpen || notifOpen) && (
        <div className="nav-backdrop"
          onClick={() => { setMenuOpen(false); setNotifOpen(false) }} />
      )}
    </>
  )
}
