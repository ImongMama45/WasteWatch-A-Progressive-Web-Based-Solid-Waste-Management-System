/**
 * DashboardLayout.jsx — WasteWatch Sidebar Layout
 * -------------------------------------------------
 * FIXES:
 * 1. Sidebar no longer eaten by topbar — logo zone height matches topbar exactly
 * 2. Section labels added between nav groups (OPERATIONS, MONITORING, etc.)
 * 3. Collapsible groups with smooth animation retained
 * 4. Main content correctly offset: margin-left = sidebar width, padding-top = topbar height
 * 5. Mobile: no sidebar, just Navbar + BottomNav as before
 */

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Navbar from './Navbar'
import { useOnline } from '../hooks/useOnline'
import BottomNav from './BottomNav'
import { ICONS, getRoleNavItems } from '../api/navConfig'
import { DriverGpsProvider } from '../context/DriverGpsContext'
import { useNotifications } from '../hooks/useNotifications'


// ─── NavGroup: collapsible sidebar section ────────────────────────────────────
function NavGroup({ group, currentPath, onNavigate, onExpandSidebar }) {
  const hasActive = group.items?.some(item => item.path === currentPath)
  const [open, setOpen] = useState(hasActive)

  useEffect(() => { if (hasActive) setOpen(true) }, [hasActive])

  return (
    <div className="ww-nav-group" data-open={open}>
      <button
        className={`ww-group-toggle ${hasActive ? 'has-active' : ''}`}
        onClick={() => { setOpen(o => !o); if (onExpandSidebar) onExpandSidebar(); }}
        aria-expanded={open}
      >
        <span className="ww-group-icon">{ICONS[group.icon]}</span>
        <span className="ww-group-label">{group.label}</span>
        <span className={`ww-group-chevron ${open ? 'open' : ''}`}>
          {ICONS.chevron}
        </span>
      </button>

      <div className={`ww-group-items ${open ? 'expanded' : ''}`}>
        <div className="ww-group-items-inner">
          {group.items.map(item => (
            <button
              key={item.path + item.label}
              className={`ww-nav-child ${currentPath === item.path ? 'active' : ''}`}
              onClick={() => onNavigate(item.path)}
              tabIndex={open ? 0 : -1}
            >
              <span className="ww-child-icon">{ICONS[item.icon]}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
const SIDEBAR_CSS = `
:root {
  --sb-width: 240px;
  --sb-bg: #0f1a0f;
  --sb-border: rgba(255,255,255,0.07);
  --sb-accent: #4ade80;
  --sb-accent-dim: rgba(74,222,128,0.12);
  --sb-accent-active: rgba(74,222,128,0.18);
  --sb-text: rgba(255,255,255,0.85);
  --sb-muted: rgba(255,255,255,0.4);
  --sb-hover: rgba(255,255,255,0.06);
  --sb-radius: 8px;
  --sb-transition: 220ms cubic-bezier(0.4,0,0.2,1);
  --topbar-h: 56px;
}

/* ── Layout shells ── */
.layout-desktop { display: none; }
.layout-mobile  { display: block; }

@media (min-width: 1024px) {
  .layout-desktop { display: flex; }
  .layout-mobile  { display: none; }
}

/* ════════════════════════════════════════
   SIDEBAR
   ════════════════════════════════════════ */
.desktop-sidebar {
  position: fixed;
  /* sit flush to top — logo zone matches topbar height so nothing is hidden */
  top: 0; left: 0; bottom: 0;
  width: var(--sb-width);
  background: var(--sb-bg);
  border-right: 1px solid var(--sb-border);
  display: flex;
  flex-direction: column;
  z-index: 200;
  overflow: hidden;
}

/* ── Logo zone — same height as topbar so they're flush ── */
.desktop-sidebar-logo {
  height: var(--topbar-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 18px;
  border-bottom: 1px solid var(--sb-border);
  cursor: pointer;
  user-select: none;
}

.sidebar-brand { display: flex; align-items: center; gap: 10px; }

.sidebar-brand-icon {
  width: 30px; height: 30px;
  background: var(--sb-accent);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #0f1a0f; flex-shrink: 0;
}

.sidebar-brand-name {
  font-size: 14px; font-weight: 800; color: #fff;
  letter-spacing: -0.02em;
  font-family: 'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif;
  line-height: 1.1;
}

.sidebar-brand-tag {
  font-size: 9px; font-weight: 600;
  color: var(--sb-accent);
  letter-spacing: 0.1em; text-transform: uppercase;
  display: block; line-height: 1; margin-top: 2px;
}

/* ── Scrollable nav area ── */
.desktop-sidebar-nav {
  flex: 1; overflow-y: auto;
  padding: 10px 8px 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.1) transparent;
}

.desktop-sidebar-nav::-webkit-scrollbar { width: 4px; }
.desktop-sidebar-nav::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.1); border-radius: 4px;
}

/* ── Section label (e.g. OPERATIONS, MONITORING) ── */
.ww-nav-section {
  font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--sb-muted);
  padding: 14px 10px 4px;
  display: block;
  user-select: none;
}

/* First section label has less top padding */
.ww-nav-section:first-child { padding-top: 6px; }

/* ── Direct link item ── */
.ww-nav-item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: var(--sb-radius);
  border: none; background: none; color: var(--sb-text);
  font-size: 13px; font-weight: 500; font-family: inherit;
  cursor: pointer; text-align: left; margin-bottom: 1px;
  transition: background var(--sb-transition), color var(--sb-transition);
}

.ww-nav-item:hover { background: var(--sb-hover); color: #fff; }

.ww-nav-item.active {
  background: var(--sb-accent-active);
  color: var(--sb-accent); font-weight: 600;
}

.ww-item-icon { flex-shrink: 0; opacity: 0.65; display: flex; align-items: center; }
.ww-nav-item.active .ww-item-icon { opacity: 1; }

/* ── Group toggle ── */
.ww-nav-group { margin-bottom: 1px; }

.ww-group-toggle {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: var(--sb-radius);
  border: none; background: none; color: var(--sb-text);
  font-size: 13px; font-weight: 500; font-family: inherit;
  cursor: pointer; text-align: left;
  transition: background var(--sb-transition), color var(--sb-transition);
}

.ww-group-toggle:hover { background: var(--sb-hover); color: #fff; }
.ww-group-toggle.has-active { color: var(--sb-accent); }
.ww-group-toggle.has-active .ww-group-icon { opacity: 1; }

.ww-group-icon { flex-shrink: 0; opacity: 0.6; display: flex; align-items: center; }
.ww-group-label { flex: 1; }

.ww-group-chevron {
  display: flex; align-items: center; color: var(--sb-muted);
  transition: transform var(--sb-transition); flex-shrink: 0;
}
.ww-group-chevron.open { transform: rotate(180deg); }

/* ── Collapsible children ── */
.ww-group-items {
  display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows 240ms cubic-bezier(0.4,0,0.2,1);
  overflow: hidden;
}
.ww-group-items.expanded { grid-template-rows: 1fr; }

.ww-group-items-inner { min-height: 0; padding-left: 12px; }

.ww-nav-child {
  width: 100%; display: flex; align-items: center; gap: 9px;
  padding: 7px 10px; border-radius: 6px;
  border: none; background: none;
  color: var(--sb-muted); font-size: 12.5px; font-weight: 400;
  font-family: inherit; cursor: pointer; text-align: left;
  margin-bottom: 1px;
  transition: background var(--sb-transition), color var(--sb-transition);
  position: relative;
}

.ww-nav-child::before {
  content: '';
  position: absolute; left: -4px; top: 50%;
  transform: translateY(-50%);
  width: 1px; height: 55%;
  background: var(--sb-border); border-radius: 1px;
}

.ww-nav-child:hover { background: var(--sb-hover); color: rgba(255,255,255,0.8); }

.ww-nav-child.active {
  background: var(--sb-accent-dim);
  color: var(--sb-accent); font-weight: 600;
}
.ww-nav-child.active::before { background: var(--sb-accent); opacity: 0.5; }

.ww-child-icon { flex-shrink: 0; display: flex; align-items: center; opacity: 0.65; }
.ww-nav-child.active .ww-child-icon { opacity: 1; }

/* ── Sidebar divider ── */
.ww-sidebar-divider {
  border: none; border-top: 1px solid var(--sb-border);
  margin: 6px 0;
}

/* ── Sidebar footer (Profile + Logout) ── */
.desktop-sidebar-footer {
  border-top: 1px solid var(--sb-border);
  padding: 8px;
  flex-shrink: 0;
}

/* ════════════════════════════════════════
   TOPBAR
   ════════════════════════════════════════ */
.desktop-topbar {
  position: fixed;
  top: 0;
  left: var(--sb-width); right: 0;
  height: var(--topbar-h);
  background: #fff;
  border-bottom: 4px solid #16a34a !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px;
  z-index: 100; gap: 16px;
}

.desktop-topbar-search {
  display: flex; align-items: center; gap: 8px;
  background: rgba(0,0,0,0.04);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 8px;
  padding: 7px 12px;
  flex: 1; max-width: 360px;
  color: rgba(0,0,0,0.4);
}

.desktop-topbar-search input {
  border: none; background: transparent; outline: none;
  font-size: 13px; color: inherit; width: 100%; font-family: inherit;
}
.desktop-topbar-search input::placeholder { color: rgba(0,0,0,0.35); }

.desktop-topbar-right {
  display: flex; align-items: center; gap: 8px;
}

.notif-btn {
  position: relative; background: none; border: none;
  cursor: pointer; width: 36px; height: 36px;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  color: rgba(0,0,0,0.5); transition: background 0.15s;
}
.notif-btn:hover { background: rgba(0,0,0,0.05); }

.notif-dot {
  position: absolute; top: 7px; right: 7px;
  width: 7px; height: 7px; border-radius: 50%;
  border: 2px solid #fff;
}

.desktop-topbar-user {
  display: flex; align-items: center; gap: 9px;
  padding: 5px 10px 5px 5px;
  border-radius: 30px; cursor: pointer;
  border: 1px solid rgba(0,0,0,0.08); background: transparent;
  transition: background 0.15s;
}
.desktop-topbar-user:hover { background: rgba(0,0,0,0.04); }

.desktop-topbar-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  background: #16a34a;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800; color: #fff; flex-shrink: 0;
}

.desktop-topbar-username {
  font-size: 13px; font-weight: 600; color: rgba(0,0,0,0.8); line-height: 1.2;
}
.desktop-topbar-userrole {
  font-size: 10px; color: rgba(0,0,0,0.4); text-transform: capitalize;
}

/* ════════════════════════════════════════
   MAIN CONTENT — offset so nothing is hidden
   ════════════════════════════════════════ */
.dashboard-main {
  min-height: 100vh;
  padding-top: 60px;
}

@media (min-width: 1024px) {
  .dashboard-main {
    margin-left: var(--sb-width);
    padding-top: var(--topbar-h);
  }
}


/* ── Sidebar Collapse ── */
.layout-desktop.sidebar-collapsed {
  --sb-width: 76px;
}

.layout-desktop.sidebar-collapsed .sidebar-brand-name,
.layout-desktop.sidebar-collapsed .sidebar-brand-tag,
.layout-desktop.sidebar-collapsed .ww-nav-section,
.layout-desktop.sidebar-collapsed .ww-group-label,
.layout-desktop.sidebar-collapsed .ww-group-chevron,
.layout-desktop.sidebar-collapsed .ww-nav-item span:nth-child(2),
.layout-desktop.sidebar-collapsed .ww-nav-child span:nth-child(2) {
  display: none;
}

.layout-desktop.sidebar-collapsed .ww-nav-item,
.layout-desktop.sidebar-collapsed .ww-group-toggle {
  justify-content: center;
  padding: 12px 0;
  width: 44px;
  margin: 0 auto 4px auto;
}

.layout-desktop.sidebar-collapsed .desktop-sidebar-logo {
  padding: 0;
  justify-content: center;
}

.layout-desktop.sidebar-collapsed .ww-group-items {
  display: none !important;
}

.layout-desktop.sidebar-collapsed .ww-item-icon,
.layout-desktop.sidebar-collapsed .ww-group-icon {
  margin: 0;
  opacity: 0.9;
}

.desktop-sidebar, .desktop-topbar, .dashboard-main {
  transition: width 0.25s ease, left 0.25s ease, margin-left 0.25s ease;
}

.desktop-topbar-left {
  display: flex;
  align-items: center;
}

.sidebar-toggle-btn {
  background: none; border: none; cursor: pointer;
  color: rgba(0,0,0,0.6); padding: 8px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
  margin-left: -8px;
}
.sidebar-toggle-btn:hover { background: rgba(0,0,0,0.05); color: #000; }

/* ── Notification dropdown ── */
.notif-dropdown {
  position: fixed;
  top: calc(var(--topbar-h) + 8px);
  right: 20px;
  width: 300px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.12);
  z-index: 999;
  overflow: hidden;
  animation: notifSlide .16s ease;
}

@keyframes notifSlide {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.notif-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.07);
  font-size: 13px; font-weight: 700;
}

.notif-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  font-size: 13px; transition: background 0.12s;
  cursor: pointer;
}
.notif-item:last-of-type { border-bottom: none; }
.notif-item:hover { background: rgba(0,0,0,0.03); }
.notif-item.unread { background: rgba(74,222,128,0.05); }

.notif-dot-inline {
  width: 8px; height: 8px; min-width: 8px;
  border-radius: 50%; background: #16a34a; margin-top: 4px;
}

/* ── Backdrop ── */
.nav-backdrop {
  position: fixed; inset: 0;
  z-index: 150; background: rgba(0,0,0,0.15);
}
`

let _sidebarCSSInjected = false
function injectSidebarCSS() {
  if (_sidebarCSSInjected) return
  _sidebarCSSInjected = true
  const el = document.createElement('style')
  el.id = 'ww-sidebar-styles'
  el.textContent = SIDEBAR_CSS
  document.head.appendChild(el)
}


const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>
)

const LeafIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20C19 20 22 3 22 3c-1 2-8 5.25-8 5.25S17.7 9.08 17 8z" />
  </svg>
)

// ─── Section label rendering ──────────────────────────────────────────────────
// nav items can optionally carry a `section` key to inject a label above them.
// We detect the first item of each new section and render the label before it.
function renderNavItems(navItems, currentPath, navigate, onExpandSidebar) {
  const rendered = []
  let lastSection = null

  navItems.forEach((item, idx) => {
    // Inject section label when the section key changes
    if (item.section && item.section !== lastSection) {
      lastSection = item.section
      rendered.push(
        <span key={`section-${item.section}-${idx}`} className="ww-nav-section">
          {item.section}
        </span>
      )
    }

    if (item.type === 'group') {
      rendered.push(
        <NavGroup
          key={item.label + idx}
          group={item}
          currentPath={currentPath}
          onNavigate={navigate}
          onExpandSidebar={onExpandSidebar}
        />
      )
    } else {
      rendered.push(
        <button
          key={item.path + idx}
          className={`ww-nav-item ${currentPath === item.path ? 'active' : ''}`}
          onClick={() => { navigate(item.path); if (onExpandSidebar) onExpandSidebar(); }}
          aria-current={currentPath === item.path ? 'page' : undefined}
        >
          <span className="ww-item-icon">{ICONS[item.icon]}</span>
          <span>{item.label}</span>
        </button>
      )
    }
  })

  return rendered
}

// ─── DashboardLayout ──────────────────────────────────────────────────────────
export default function DashboardLayout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isOnline = useOnline()
  const { notifications, unreadCount, markRead } = useNotifications()

  const [isPinned, setIsPinned] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const isCollapsed = !(isPinned || isHovered)
  const [notifOpen, setNotifOpen] = useState(false)

  useEffect(() => { injectSidebarCSS() }, [])

  const role = user?.role?.toLowerCase() || 'citizen'
  const navItems = getRoleNavItems(role)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div
      className="dashboard-root"
      style={{ '--sb-width': isCollapsed ? '76px' : '240px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
      onClick={() => {
        // Tapping somewhere in the page tucks the sidebar in
        if (isPinned) setIsPinned(false);
      }}
    >
      {/* ── MOBILE: top navbar only ── */}
      <div className="layout-mobile">
        <Navbar />
      </div>

      {/* ── DESKTOP: sidebar + topbar ── */}
      <div className={`layout-desktop ${isCollapsed ? 'sidebar-collapsed' : ''}`}>

        {/* ─── Left Sidebar ─── */}
        <aside className="desktop-sidebar" role="navigation" aria-label="Main sidebar" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} onClick={e => e.stopPropagation()}>

          {/* Brand / Logo — same height as topbar */}
          <div
            className="desktop-sidebar-logo"
            onClick={() => isCollapsed ? setIsPinned(true) : navigate('/dashboard')}
            role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && navigate('/dashboard')}
            aria-label="Go to dashboard"
          >
            <div className="sidebar-brand">
              <div className="sidebar-brand-icon"><LeafIcon /></div>
              <div>
                <span className="sidebar-brand-name">WasteWatch</span>
                <span className="sidebar-brand-tag">Management</span>
              </div>
            </div>
          </div>

          {/* Nav Items with section labels */}
          <nav className="desktop-sidebar-nav">
            {renderNavItems(navItems, location.pathname, (path) => navigate(path), () => !isPinned && setIsPinned(true))}
          </nav>

          {/* Footer */}
          <div className="desktop-sidebar-footer">
            <button
              className="ww-nav-item"
              onClick={() => navigate('/profile')}
            >
              <span className="ww-item-icon">{ICONS.profile}</span>
              <span>Profile</span>
            </button>
            <button
              className="ww-nav-item"
              onClick={handleLogout}
              style={{ color: 'rgba(255,255,255,0.45)' }}
            >
              <span className="ww-item-icon">{ICONS.logout}</span>
              <span>Logout</span>
            </button>
          </div>
        </aside>

        {/* ─── Top Bar ─── */}
        <header className="desktop-topbar" onClick={e => e.stopPropagation()}>
          <div className="desktop-topbar-left">

          </div>

          <div className="desktop-topbar-right">
            {!isOnline && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                background: '#fef3c7', color: '#92400e',
                padding: '3px 8px', borderRadius: 20,
                border: '1px solid #fde68a', letterSpacing: '0.05em',
              }}>
                OFFLINE
              </span>
            )}

            <button
              className="notif-btn"
              onClick={() => setNotifOpen(o => !o)}
              aria-label="Notifications"
              aria-expanded={notifOpen}
            >
              {ICONS.bell}
              {unreadCount > 0 && (
                <span className="notif-dot" style={{ background: '#ef4444' }} />
              )}
            </button>

            <div
              className="desktop-topbar-user"
              onClick={() => navigate('/profile')}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate('/profile')}
              aria-label="View profile"
            >
              {user?.profile_pic ? (
                <img src={user.profile_pic} alt="Avatar" className="desktop-topbar-avatar" style={{ objectFit: 'cover', background: '#fff' }} />
              ) : (
                <div className="desktop-topbar-avatar">
                  {user?.full_name?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <div>
                <div className="desktop-topbar-username">
                  {user?.full_name?.split(' ')[0] || 'User'}
                </div>
                <div className="desktop-topbar-userrole">
                  {role.replace('_', ' ')}
                </div>
              </div>
            </div>
          </div>
        </header>
      </div>

      {/* ── Notification dropdown ── */}
      {notifOpen && (
        <div className="notif-dropdown" role="dialog" aria-label="Notifications">
          <div className="notif-header">
            <span>
              Notifications
              {unreadCount > 0 && (
                <span style={{
                  marginLeft: 8, background: '#ef4444', color: '#fff',
                  fontSize: 10, fontWeight: 800, padding: '1px 7px',
                  borderRadius: 20,
                }}>{unreadCount}</span>
              )}
            </span>
            <button
              onClick={() => setNotifOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: 'rgba(0,0,0,0.4)' }}
              aria-label="Close notifications"
            >×</button>
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>
              No new notifications
            </div>
          ) : (
            notifications.slice(0, 5).map(n => (
              <div
                key={n.id}
                className={`notif-item ${!n.is_read ? 'unread' : ''}`}
                onClick={() => { navigate('/notifications'); setNotifOpen(false); }}
              >
                {!n.is_read
                  ? <div className="notif-dot-inline" />
                  : <div style={{ width: 8, flexShrink: 0 }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                  <div style={{
                    fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {n.message}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                    {new Date(n.created_at).toLocaleString('en-PH', {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            ))
          )}

          <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(0,0,0,0.07)', display: 'flex', gap: '10px' }}>
            <button
              onClick={() => { navigate('/notifications'); setNotifOpen(false); }}
              style={{ flex: 1, background: 'none', border: 'none', color: '#1a2e1a', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              View all
            </button>
            <button
              onClick={() => markRead()}
              style={{ flex: 1, background: 'none', border: 'none', color: '#16a34a', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Mark all as read
            </button>
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <main className="dashboard-main">
        {role === 'driver' ? (
          <DriverGpsProvider>{children}</DriverGpsProvider>
        ) : children}
      </main>

      {/* ── MOBILE: bottom nav ── */}
      <div className="layout-mobile">
        <BottomNav />
      </div>

      {notifOpen && (
        <div className="nav-backdrop" onClick={() => setNotifOpen(false)} aria-hidden="true" />
      )}
    </div>
  )
}