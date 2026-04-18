import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen,  setMenuOpen]  = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login')
    setMenuOpen(false)
  }

  const isActive = (path) => location.pathname === path ? 'active' : ''

  const navTo = (path) => {
    navigate(path)
    setMenuOpen(false)
  }

  return (
    <>
      <nav className="navbar">
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
            href="/dashboard"
            onClick={e => { e.preventDefault(); navTo('/dashboard') }}
            className="navbar-brand"
          >
            <span className="logo-icon">🗑️</span>
          </a>
        </div>

        {/* Desktop nav links — monitor-only, no action links */}
        <div className="navbar-links">
          <a
            href="/dashboard"
            className={isActive('/dashboard')}
            onClick={e => { e.preventDefault(); navigate('/dashboard') }}
          >
            Dashboard
          </a>
          <a
            href="/map"
            className={isActive('/map')}
            onClick={e => { e.preventDefault(); navigate('/map') }}
          >
            Live Map
          </a>
        </div>

        {/* Right: Bell + Logout */}
        <div className="navbar-right">
          <button
            className="notif-btn"
            onClick={() => { setNotifOpen(o => !o); setMenuOpen(false) }}
            aria-label="Notifications"
          >
            🔔
            <span className="notif-dot" />
          </button>

          {user && (
            <button className="btn btn-outline btn-sm desktop-only" onClick={handleLogout}>
              Logout
            </button>
          )}
        </div>
      </nav>

      {/* ── Notification Dropdown ── */}
      {notifOpen && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700 }}>Notifications</span>
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
          <div className="notif-item unread">
            <div className="notif-dot-inline" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>New collection confirmed</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Yesterday</div>
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

      {/* ── Mobile Slide-in Menu — keeps submit/confirm for mobile users ── */}
      {menuOpen && (
        <div className="mobile-menu">
          <div className="mobile-menu-user">
            <div style={{
              width: 40, height: 40, background: 'var(--accent)', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 800, color: '#0d1117',
            }}>
              {user?.full_name?.[0] || '?'}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{user?.full_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user?.email}</div>
            </div>
          </div>

          <nav style={{ padding: '8px 0' }}>
            {[
              { path: '/dashboard',          label: '🏠  Dashboard' },
              { path: '/report/submit',      label: '🗂  Submit Report' },
              { path: '/collection/confirm', label: '✅  Confirm Collection' },
            ].map(({ path, label }) => (
              <button key={path} onClick={() => navTo(path)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '13px 20px',
                  background: location.pathname === path ? 'rgba(46,204,113,.1)' : 'none',
                  border: 'none',
                  color: location.pathname === path ? 'var(--accent)' : 'var(--text)',
                  fontSize: 14, fontFamily: 'var(--font-body)', cursor: 'pointer',
                  borderLeft: location.pathname === path ? '3px solid var(--accent)' : '3px solid transparent',
                }}>
                {label}
              </button>
            ))}
          </nav>

          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
            <button className="btn btn-outline btn-full" onClick={handleLogout}>
              Logout
            </button>
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