/**
 * components/Navbar.jsx
 * ----------------------
 * FIXES:
 * 1. Drawer icons: was doing NAV_ICONS[icon] on emoji strings → now renders
 *    the icon value directly when it's already a string/element, and only
 *    looks up via ICONS (from DashboardLayout) when it's a key string.
 * 2. Notifications: unified with DashboardLayout's style (English, consistent UI).
 * 3. Removed duplicate/conflicting icon lookup logic.
 */

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../hooks/useOnline'
import { ICONS, NAV_ICONS, getRoleNavItems, flattenNavItems } from '../api/navConfig'

// ─── tiny CSS injected once ───────────────────────────────────────────────────
const NAVBAR_CSS = `
/* ── Fixed light navbar ── */
.ww-navbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 60px;
  background: #ffffff;
  border-bottom: 2px solid #c8e6c9;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  z-index: 1000;
  font-family: 'Plus Jakarta Sans', 'DM Sans', sans-serif;
}

@media (min-width: 1024px) {
  .ww-navbar { padding: 0 40px; }
}

/* ── Brand ── */
.ww-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  cursor: pointer;
  flex-shrink: 0;
}

.ww-brand__icon {
  width: 34px; height: 34px;
  background: #2e7d32;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; color: #fff; flex-shrink: 0;
}

.ww-brand__name {
  font-size: 16px; font-weight: 800;
  color: #1a2e1a; letter-spacing: -0.02em;
}

/* ── Desktop nav links (hidden on mobile) ── */
.ww-nav-links {
  display: none;
  align-items: center;
  gap: 2px;
}

@media (min-width: 1024px) {
  .ww-nav-links { display: flex; }
}

.ww-nav-link {
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px; font-weight: 500;
  color: #4a6741;
  background: none; border: none;
  cursor: pointer;
  transition: background .15s, color .15s;
  font-family: inherit;
  white-space: nowrap;
}

.ww-nav-link:hover { background: #e8f5e9; color: #2e7d32; }
.ww-nav-link.active { background: #e8f5e9; color: #2e7d32; font-weight: 600; }

/* ── Right cluster ── */
.ww-nav-right {
  display: flex; align-items: center; gap: 8px;
}

/* ── Bell ── */
.ww-bell {
  position: relative;
  background: none; border: none;
  cursor: pointer; padding: 7px;
  font-size: 18px; line-height: 1;
  color: #4a6741;
  border-radius: 8px;
  transition: background .15s;
  display: flex; align-items: center; justify-content: center;
}
.ww-bell:hover { background: #e8f5e9; }

.ww-bell__dot {
  position: absolute;
  top: 5px; right: 5px;
  width: 8px; height: 8px;
  border-radius: 50%;
  border: 2px solid #fff;
}

/* ── Auth buttons (desktop) ── */
.ww-auth-row {
  display: none;
  align-items: center; gap: 8px;
}

@media (min-width: 1024px) { .ww-auth-row { display: flex; } }

.ww-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  cursor: pointer; border: none;
  transition: background .15s, box-shadow .15s;
  font-family: inherit; white-space: nowrap;
}

.ww-btn--outline {
  background: transparent;
  color: #2e7d32;
  border: 1.5px solid #a5d6a7;
}
.ww-btn--outline:hover { background: #e8f5e9; }

.ww-btn--primary {
  background: #2e7d32; color: #fff;
}
.ww-btn--primary:hover {
  background: #388e3c;
  box-shadow: 0 3px 10px rgba(46,125,50,.25);
}

.ww-btn--sm { padding: 6px 13px; font-size: 12px; }

/* ── Avatar chip (desktop, authenticated) ── */
.ww-avatar-chip {
  display: none;
  align-items: center; gap: 8px;
  padding: 4px 10px 4px 4px;
  border-radius: 100px;
  background: #f0f7ec;
  border: 1px solid #c8e6c9;
  cursor: pointer;
  transition: background .15s;
}
@media (min-width: 1024px) { .ww-avatar-chip { display: flex; } }
.ww-avatar-chip:hover { background: #e8f5e9; }

.ww-avatar {
  width: 28px; height: 28px;
  background: #2e7d32; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800; color: #fff; flex-shrink: 0;
}

.ww-avatar__name {
  font-size: 13px; font-weight: 600; color: #1a2e1a;
}

/* ── Hamburger (mobile only) ── */
.ww-hamburger {
  display: flex; flex-direction: column; justify-content: center;
  gap: 5px; width: 28px; height: 28px;
  background: none; border: none; cursor: pointer; padding: 3px;
  flex-shrink: 0;
}

@media (min-width: 1024px) { .ww-hamburger { display: none; } }

.ww-hamburger span {
  display: block; height: 2px;
  background: #2e7d32; border-radius: 2px;
  transition: all .25s ease; transform-origin: center;
}

.ww-hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.ww-hamburger.open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
.ww-hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

/* ── Offline banner strip ── */
.ww-offline-strip {
  position: fixed;
  top: 60px; left: 0; right: 0;
  background: #fff3e0;
  border-bottom: 1px solid #ffcc80;
  padding: 5px 20px;
  font-size: 11px; font-weight: 700;
  color: #e65100; text-align: center;
  z-index: 999; letter-spacing: .04em;
}

/* ── Notification dropdown ── */
.ww-notif-drop {
  position: fixed;
  top: 62px; right: 12px;
  width: 300px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 0 0 14px 14px;
  /* z-index BELOW navbar (1000) so it never covers it */
  z-index: 990;
  box-shadow: 0 8px 28px rgba(0,0,0,.12);
  overflow: hidden;
  /* slide-down animation */
  animation: wwNotifSlide .18s ease;
}

@keyframes wwNotifSlide {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (min-width: 1024px) { .ww-notif-drop { right: 20px; } }

.ww-notif-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.07);
}

.ww-notif-head__title {
  font-size: 13px; font-weight: 700; color: #1a2e1a;
}

.ww-notif-close {
  background: none; border: none; cursor: pointer;
  font-size: 20px; color: rgba(0,0,0,0.4); line-height: 1; padding: 0;
}
.ww-notif-close:hover { color: #1a2e1a; }

.ww-notif-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  transition: background .1s;
}
.ww-notif-item:last-of-type { border-bottom: none; }
.ww-notif-item:hover { background: rgba(0,0,0,0.03); }
.ww-notif-item.unread { background: rgba(74,222,128,0.05); }

.ww-notif-dot {
  width: 8px; height: 8px; min-width: 8px;
  background: #16a34a; border-radius: 50%;
  margin-top: 4px; flex-shrink: 0;
}

.ww-notif-item__title  { font-size: 13px; font-weight: 600; color: #1a2e1a; }
.ww-notif-item__time   { font-size: 11px; color: rgba(0,0,0,0.4); margin-top: 2px; }

.ww-notif-footer {
  padding: 10px 16px;
  border-top: 1px solid rgba(0,0,0,0.07);
}
.ww-notif-footer button {
  width: 100%; background: none; border: none;
  color: #16a34a; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; padding: 0;
}
.ww-notif-footer button:hover { text-decoration: underline; }

/* ── Mobile slide-in drawer — starts BELOW the navbar ── */
.ww-drawer {
  position: fixed;
  top: 60px; left: 0; bottom: 0;
  width: 280px;
  background: #fff;
  border-right: 1px solid #dce8d4;
  border-top: 1px solid #c8e6c9;
  z-index: 990;
  display: flex; flex-direction: column;
  overflow-y: auto;
  animation: wwSlideIn .22s ease;
}

@keyframes wwSlideIn {
  from { transform: translateX(-100%); opacity: 0; }
  to   { transform: translateX(0);     opacity: 1; }
}

@media (min-width: 1024px) { .ww-drawer { display: none !important; } }

/* Drawer — user block */
.ww-drawer__user {
  display: flex; align-items: center; gap: 12px;
  padding: 20px 18px;
  border-bottom: 1px solid #eef3ea;
}

.ww-drawer__avatar {
  width: 42px; height: 42px;
  background: #2e7d32; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 800; color: #fff; flex-shrink: 0;
}

.ww-drawer__avatar--guest {
  background: #f0f7ec;
  border: 2px dashed #c8e6c9;
  color: #6a8f6a;
}

.ww-drawer__name  { font-size: 14px; font-weight: 700; color: #1a2e1a; }
.ww-drawer__email { font-size: 11px; color: #6a8f6a; margin-top: 2px; }
.ww-drawer__signin {
  font-size: 12px; color: #2e7d32; font-weight: 600;
  cursor: pointer; margin-top: 2px;
}

.ww-offline-badge {
  margin-left: auto;
  background: #fff3e0; color: #e65100;
  border: 1px solid #ffcc80;
  font-size: 9px; font-weight: 800;
  padding: 3px 8px; border-radius: 20px;
  letter-spacing: .06em;
}

/* Compact role strip (replaces old user block) */
.ww-drawer__role-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 18px;
  border-bottom: 1px solid #eef3ea;
  background: #f8fdf8;
}

.ww-drawer__role-label {
  font-size: 11px;
  font-weight: 700;
  color: #2e7d32;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Drawer — nav items */
.ww-drawer__nav { padding: 8px 0; flex: 1; }

.ww-drawer__item {
  width: 100%; text-align: left;
  padding: 12px 18px;
  background: none; border: none;
  font-size: 14px; font-family: inherit;
  cursor: pointer;
  display: flex; align-items: center; gap: 12px;
  color: #1a2e1a;
  border-left: 3px solid transparent;
  transition: background .13s, color .13s;
}

.ww-drawer__item:hover {
  background: #f0f7ec;
  color: #2e7d32;
}

.ww-drawer__item.active {
  background: #e8f5e9;
  color: #2e7d32; font-weight: 600;
  border-left-color: #2e7d32;
}

/* ── FIX: icon cell — fixed width, flex centering, no overflow ── */
.ww-drawer__item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: #4a6741;
}

.ww-drawer__item.active .ww-drawer__item__icon {
  color: #2e7d32;
}

/* Drawer — footer buttons */
.ww-drawer__footer {
  padding: 12px 18px 20px;
  border-top: 1px solid #eef3ea;
  display: flex; flex-direction: column; gap: 8px;
}

.ww-drawer__footer .ww-btn { justify-content: center; }

/* ── Backdrop ── */
.ww-backdrop {
  position: fixed;
  /* start below the navbar so it never covers it */
  top: 60px; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,.25);
  z-index: 980;
  backdrop-filter: blur(1px);
}
`

// ─── inject styles once ───────────────────────────────────────────────────────
let _injected = false
function injectStyles() {
  if (_injected) return
  _injected = true
  const el = document.createElement('style')
  el.textContent = NAVBAR_CSS
  document.head.appendChild(el)
}

// ─── Leaf SVG icon (brand) ────────────────────────────────────────────────────
const LeafIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
  </svg>
)

const BellIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
)

/**
 * resolveIcon — FIX for the blank/raw-text icon bug.
 *
 * Nav items from getRoleNavItems/flattenNavItems carry an `icon` field that
 * is either:
 *   (a) an emoji string  e.g. "🏠"  → render as-is
 *   (b) a key string     e.g. "dashboard", "map"  → look up in ICONS map
 *   (c) already a React element → render as-is
 *
 * Previously the code only tried NAV_ICONS[icon] which is an emoji lookup
 * object; keys like "dashboard" don't exist there so it returned undefined
 * and fell back to rendering the raw key string ("dashboard").
 */
function resolveIcon(icon) {
  if (!icon) return null

  // Already a React element
  if (typeof icon === 'object') return icon

  // Try the SVG ICONS map first (keys like 'dashboard', 'map', 'truck'…)
  if (ICONS && ICONS[icon]) return ICONS[icon]

  // Try the emoji NAV_ICONS map
  if (NAV_ICONS && NAV_ICONS[icon]) return NAV_ICONS[icon]

  // It's already an emoji / plain string — render directly
  return icon
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isOnline = useOnline()

  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  useEffect(() => { injectStyles() }, [])

  // Close drawer/notif on route change
  useEffect(() => { setMenuOpen(false); setNotifOpen(false) }, [location.pathname])

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  async function handleLogout() {
    await logout()
    navigate('/')
    setMenuOpen(false)
  }

  const isActive = (path) => location.pathname === path ? 'active' : ''
  const navTo = (path) => { navigate(path); setMenuOpen(false) }

  const role = user?.role?.toLowerCase() || 'citizen'

  // Build mobile nav items from role config
  const baseItems = flattenNavItems(getRoleNavItems(role))

  const mobileNavItems = user
    ? [
      ...baseItems.map(item => ({
        path: item.path,
        icon: item.icon,   // keep as-is; resolveIcon() handles it in render
        label: item.label,
      }))

    ]
    : [
      { path: '/', icon: '🏠', label: 'Home' },
      { path: '/login', icon: '🔑', label: 'Login' },
      { path: '/register', icon: '📝', label: 'Register' },
    ]

  const desktopLinks = [
    { path: '/', label: 'Home' },
    { path: '/map', label: 'Map' },
    { path: '/schedule', label: 'Schedule' },
    { path: '/about', label: 'About' },
    ...(user ? [{ path: '/dashboard', label: 'Dashboard' }] : []),
  ]

  return (
    <>
      {/* ── Offline strip (below navbar) ── */}
      {!isOnline && (
        <div className="ww-offline-strip">
          ⚠️ OFFLINE — changes will sync when connection is restored
        </div>
      )}

      {/* ════════ NAVBAR ════════ */}
      <nav className="ww-navbar">

        {/* Left: hamburger + brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className={`ww-hamburger ${menuOpen ? 'open' : ''}`}
            onClick={() => { setMenuOpen(o => !o); setNotifOpen(false) }}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <span /><span /><span />
          </button>

          <a
            href="/"
            className="ww-brand"
            onClick={e => { e.preventDefault(); navTo('/') }}
          >
            <span className="ww-brand__icon"><LeafIcon /></span>
            <span className="ww-brand__name">WasteWatch</span>
          </a>
        </div>

        {/* Centre: desktop nav links */}
        <nav className="ww-nav-links" aria-label="Main navigation">
          {desktopLinks.map(({ path, label }) => (
            <button
              key={path}
              className={`ww-nav-link ${isActive(path)}`}
              onClick={() => navigate(path)}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Right: bell + auth */}
        <div className="ww-nav-right">
          <button
            className="ww-bell"
            onClick={() => { setNotifOpen(o => !o); setMenuOpen(false) }}
            aria-label="Notifications"
            aria-expanded={notifOpen}
          >
            <BellIcon />
            <span
              className="ww-bell__dot"
              style={{ background: isOnline ? '#e74c3c' : '#f57c00' }}
            />
          </button>

          {user ? (
            <div
              className="ww-avatar-chip"
              onClick={() => navTo('/profile')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navTo('/profile')}
              title="Go to profile"
            >
              <div className="ww-avatar">
                {user.full_name?.[0]?.toUpperCase() || '?'}
              </div>
              <span className="ww-avatar__name">
                {user.full_name?.split(' ')[0]}
              </span>
            </div>
          ) : (
            <div className="ww-auth-row">
              <button
                className="ww-btn ww-btn--outline ww-btn--sm"
                onClick={() => navigate('/login')}
              >
                Sign In
              </button>
              <button
                className="ww-btn ww-btn--primary ww-btn--sm"
                onClick={() => navigate('/register')}
              >
                Register
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* ════════ NOTIFICATION DROPDOWN ════════ */}
      {notifOpen && (
        <div className="ww-notif-drop" role="dialog" aria-label="Notifications">
          <div className="ww-notif-head">
            <span className="ww-notif-head__title">
              Notifications
              {!isOnline && (
                <span style={{ fontSize: 10, color: '#e65100', marginLeft: 8, fontWeight: 400 }}>
                  (cached)
                </span>
              )}
            </span>
            <button
              className="ww-notif-close"
              onClick={() => setNotifOpen(false)}
              aria-label="Close notifications"
            >
              ×
            </button>
          </div>

          <div className="ww-notif-item unread">
            <div className="ww-notif-dot" />
            <div>
              <div className="ww-notif-item__title">Report #3 resolved</div>
              <div className="ww-notif-item__time">2 hours ago</div>
            </div>
          </div>

          <div className="ww-notif-item">
            <div style={{ width: 8, flexShrink: 0 }} />
            <div>
              <div className="ww-notif-item__title">Welcome to WasteWatch!</div>
              <div className="ww-notif-item__time">3 days ago</div>
            </div>
          </div>

          <div className="ww-notif-footer">
            <button>Mark all as read</button>
          </div>
        </div>
      )}

      {/* ════════ MOBILE DRAWER ════════ */}
      {menuOpen && (
        <aside className="ww-drawer" aria-label="Mobile navigation">

          {/* Compact role/status strip below navbar */}
          {user && (
            <div className="ww-drawer__role-strip">
              <span className="ww-drawer__role-label">
                {role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
              {!isOnline && <span className="ww-offline-badge">OFFLINE</span>}
            </div>
          )}

          {/* Nav links */}
          <nav className="ww-drawer__nav">
            {mobileNavItems.map(({ path, icon, label }) => (
              <button
                key={path + label}
                className={`ww-drawer__item ${location.pathname === path ? 'active' : ''}`}
                onClick={() => navTo(path)}
              >
                {/*
                  ── ICON FIX ──
                  resolveIcon() tries ICONS (SVG map) first, then NAV_ICONS
                  (emoji map), then falls back to the raw string.
                  This prevents raw key names ("dashboard", "map") from
                  appearing as text in the drawer.
                */}
                <span className="ww-drawer__item__icon" aria-hidden="true">
                  {resolveIcon(icon)}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {/* Footer */}
          <div className="ww-drawer__footer">
            {user ? (
              <>
                <button
                  className="ww-btn ww-btn--outline"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => navTo('/profile')}
                >
                  My Profile
                </button>
                <button
                  className="ww-btn ww-btn--primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="ww-btn ww-btn--outline"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => navTo('/login')}
                >
                  Sign In
                </button>
                <button
                  className="ww-btn ww-btn--primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => navTo('/register')}
                >
                  Register
                </button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ── Backdrop ── */}
      {(menuOpen || notifOpen) && (
        <div
          className="ww-backdrop"
          onClick={() => { setMenuOpen(false); setNotifOpen(false) }}
          aria-hidden="true"
        />
      )}
    </>
  )
}