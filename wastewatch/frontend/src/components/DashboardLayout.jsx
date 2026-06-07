/**
 * DashboardLayout.jsx — WasteWatch Admin Sidebar (Redesigned)
 * -------------------------------------------------------------
 * Preserves ALL existing routes, roles, APIs, and functionality.
 * Changes: sidebar nav structure, naming, icons, collapsible groups,
 *          smooth animations, enterprise-grade styling.
 *
 * Role-based navigation is modular — each role defines its own groups.
 * Adding a new role = add one entry to ROLE_NAV_CONFIG below.
 */

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Navbar from './Navbar'
import { useOnline } from '../hooks/useOnline'
import BottomNav from './BottomNav'
import { ICONS, getRoleNavItems } from '../api/navConfig'

// ─── Helper: check if group has an active child ──────────────────────────────
function groupContainsActive(group, currentPath) {
  return group.items?.some(item => item.path === currentPath)
}

// ─── NavGroup: collapsible sidebar section ────────────────────────────────────
function NavGroup({ group, currentPath, onNavigate }) {
  const hasActive = groupContainsActive(group, currentPath)
  const [open, setOpen] = useState(hasActive)

  // Auto-expand if a child becomes active (e.g. direct URL navigation)
  useEffect(() => {
    if (hasActive) setOpen(true)
  }, [hasActive])

  return (
    <div className="ww-nav-group" data-open={open}>
      <button
        className={`ww-group-toggle ${hasActive ? 'has-active' : ''}`}
        onClick={() => setOpen(o => !o)}
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

// ─── CSS injected once ────────────────────────────────────────────────────────
const SIDEBAR_CSS = `
/* ═══════════════════════════════════════════════
   WasteWatch Sidebar — Enterprise Design System
   ═══════════════════════════════════════════════ */

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
.layout-desktop {
  display: none;
}
@media (min-width: 1024px) {
  .layout-desktop { display: flex; }
  .layout-mobile  { display: none; }
}

/* ── Sidebar ── */
.desktop-sidebar {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: var(--sb-width);
  background: var(--sb-bg);
  border-right: 1px solid var(--sb-border);
  display: flex;
  flex-direction: column;
  z-index: 200;
  overflow: hidden;
}

/* Logo zone */
.desktop-sidebar-logo {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid var(--sb-border);
  cursor: pointer;
  flex-shrink: 0;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sidebar-brand-icon {
  width: 32px; height: 32px;
  background: var(--sb-accent);
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  color: #0f1a0f;
  flex-shrink: 0;
}

.sidebar-brand-name {
  font-size: 15px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.02em;
  font-family: 'Plus Jakarta Sans', 'DM Sans', system-ui, sans-serif;
}

.sidebar-brand-tag {
  font-size: 9px;
  font-weight: 600;
  color: var(--sb-accent);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  display: block;
  line-height: 1;
  margin-top: 2px;
}

/* Scrollable nav */
.desktop-sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.1) transparent;
}

.desktop-sidebar-nav::-webkit-scrollbar { width: 4px; }
.desktop-sidebar-nav::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
}

/* ── Direct link item ── */
.ww-nav-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--sb-radius);
  border: none;
  background: none;
  color: var(--sb-text);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background var(--sb-transition), color var(--sb-transition);
  margin-bottom: 2px;
}

.ww-nav-item:hover {
  background: var(--sb-hover);
  color: #fff;
}

.ww-nav-item.active {
  background: var(--sb-accent-active);
  color: var(--sb-accent);
  font-weight: 600;
}

.ww-nav-item .ww-item-icon {
  flex-shrink: 0;
  opacity: 0.7;
  display: flex;
  align-items: center;
}

.ww-nav-item.active .ww-item-icon {
  opacity: 1;
}

/* ── Nav section separator ── */
.ww-nav-section-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--sb-muted);
  padding: 14px 12px 5px;
  display: block;
  user-select: none;
}

/* ── Group toggle button ── */
.ww-nav-group {
  margin-bottom: 2px;
}

.ww-group-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--sb-radius);
  border: none;
  background: none;
  color: var(--sb-text);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background var(--sb-transition), color var(--sb-transition);
}

.ww-group-toggle:hover {
  background: var(--sb-hover);
  color: #fff;
}

.ww-group-toggle.has-active {
  color: var(--sb-accent);
}

.ww-group-toggle.has-active .ww-group-icon {
  opacity: 1;
}

.ww-group-icon {
  flex-shrink: 0;
  opacity: 0.65;
  display: flex;
  align-items: center;
}

.ww-group-label {
  flex: 1;
}

.ww-group-chevron {
  display: flex;
  align-items: center;
  color: var(--sb-muted);
  transition: transform var(--sb-transition);
  flex-shrink: 0;
}

.ww-group-chevron.open {
  transform: rotate(180deg);
}

/* ── Collapsible items container ── */
.ww-group-items {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 250ms cubic-bezier(0.4,0,0.2,1);
  overflow: hidden;
}

.ww-group-items.expanded {
  grid-template-rows: 1fr;
}

.ww-group-items-inner {
  min-height: 0;
  padding-left: 14px;
}

/* Child nav items */
.ww-nav-child {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7.5px 10px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--sb-muted);
  font-size: 12.5px;
  font-weight: 400;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  margin-bottom: 1px;
  transition: background var(--sb-transition), color var(--sb-transition);
  position: relative;
}

.ww-nav-child::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 60%;
  background: var(--sb-border);
  border-radius: 1px;
}

.ww-nav-child:hover {
  background: var(--sb-hover);
  color: rgba(255,255,255,0.8);
}

.ww-nav-child.active {
  background: var(--sb-accent-dim);
  color: var(--sb-accent);
  font-weight: 600;
}

.ww-nav-child.active::before {
  background: var(--sb-accent);
  opacity: 0.6;
}

.ww-child-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  opacity: 0.7;
}

.ww-nav-child.active .ww-child-icon {
  opacity: 1;
}

/* ── Sidebar footer ── */
.desktop-sidebar-footer {
  border-top: 1px solid var(--sb-border);
  padding: 10px;
  flex-shrink: 0;
}

/* ── Top bar ── */
.desktop-topbar {
  position: fixed;
  top: 0;
  left: var(--sb-width);
  right: 0;
  height: var(--topbar-h);
  background: var(--surface, #fff);
  border-bottom: 1px solid rgba(0,0,0,0.07);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 100;
  gap: 16px;
}

.desktop-topbar-search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0,0,0,0.04);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 8px;
  padding: 7px 12px;
  flex: 1;
  max-width: 360px;
  color: rgba(0,0,0,0.4);
}

.desktop-topbar-search input {
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: inherit;
  width: 100%;
  font-family: inherit;
}

.desktop-topbar-search input::placeholder { color: rgba(0,0,0,0.35); }

.desktop-topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Notif bell button */
.notif-btn {
  position: relative;
  background: none;
  border: none;
  cursor: pointer;
  width: 36px; height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0,0,0,0.5);
  transition: background 0.15s;
}

.notif-btn:hover { background: rgba(0,0,0,0.05); }

.notif-dot {
  position: absolute;
  top: 7px; right: 7px;
  width: 7px; height: 7px;
  border-radius: 50%;
  border: 2px solid var(--surface, #fff);
}

/* Topbar user */
.desktop-topbar-user {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 10px 5px 5px;
  border-radius: 30px;
  cursor: pointer;
  border: 1px solid rgba(0,0,0,0.08);
  background: transparent;
  transition: background 0.15s;
}

.desktop-topbar-user:hover { background: rgba(0,0,0,0.04); }

.desktop-topbar-avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: #16a34a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
}

.desktop-topbar-username {
  font-size: 13px;
  font-weight: 600;
  color: rgba(0,0,0,0.8);
  line-height: 1.2;
}

.desktop-topbar-userrole {
  font-size: 10px;
  color: rgba(0,0,0,0.4);
  text-transform: capitalize;
}

/* ── Main content ── */
.dashboard-main {
  min-height: 100vh;
}

@media (min-width: 1024px) {
  .dashboard-main {
    margin-left: var(--sb-width);
    padding-top: var(--topbar-h);
  }
}

/* ── Notification dropdown ── */
.notif-dropdown {
  position: fixed;
  top: 64px;
  right: 20px;
  width: 300px;
  background: var(--surface, #fff);
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.12);
  z-index: 999;
  overflow: hidden;
}

.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.07);
  font-size: 13px;
  font-weight: 700;
}

.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  font-size: 13px;
  transition: background 0.12s;
}

.notif-item:hover { background: rgba(0,0,0,0.03); }
.notif-item.unread { background: rgba(74,222,128,0.05); }

.notif-dot-inline {
  width: 8px; height: 8px;
  min-width: 8px;
  border-radius: 50%;
  background: #16a34a;
  margin-top: 4px;
}

/* ── Backdrop ── */
.nav-backdrop {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(0,0,0,0.2);
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

// ─── LeafIcon ─────────────────────────────────────────────────────────────────
const LeafIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20C19 20 22 3 22 3c-1 2-8 5.25-8 5.25S17.7 9.08 17 8z"/>
  </svg>
)

// ─── DashboardLayout ──────────────────────────────────────────────────────────

export default function DashboardLayout({ children }) {
  const { user, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const isOnline  = useOnline()

  const [searchVal,  setSearchVal]  = useState('')
  const [notifOpen,  setNotifOpen]  = useState(false)

  // Inject CSS once
  useEffect(() => { injectSidebarCSS() }, [])

  const role     = user?.role?.toLowerCase() || 'citizen'
  const navItems = getRoleNavItems(role)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <>
      {/* ── MOBILE: existing top + bottom nav ── */}
      <div className="layout-mobile">
        <Navbar />
      </div>

      {/* ── DESKTOP: sidebar + topbar ── */}
      <div className="layout-desktop">

        {/* ─── Left Sidebar ─── */}
        <aside className="desktop-sidebar" role="navigation" aria-label="Main sidebar">

          {/* Brand / Logo */}
          <div
            className="desktop-sidebar-logo"
            onClick={() => navigate('/dashboard')}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && navigate('/dashboard')}
            aria-label="Go to dashboard"
          >
            <div className="sidebar-brand">
              <div className="sidebar-brand-icon">
                <LeafIcon />
              </div>
              <div>
                <span className="sidebar-brand-name">WasteWatch</span>
                <span className="sidebar-brand-tag">Management</span>
              </div>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="desktop-sidebar-nav">
            {navItems.map((item, idx) =>
              item.type === 'group' ? (
                <NavGroup
                  key={item.label + idx}
                  group={item}
                  currentPath={location.pathname}
                  onNavigate={(path) => navigate(path)}
                />
              ) : (
                <button
                  key={item.path + idx}
                  className={`ww-nav-item ${location.pathname === item.path ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                  aria-current={location.pathname === item.path ? 'page' : undefined}
                >
                  <span className="ww-item-icon">{ICONS[item.icon]}</span>
                  <span>{item.label}</span>
                </button>
              )
            )}
          </nav>

          {/* Footer: Profile + Logout */}
          <div className="desktop-sidebar-footer">
            <button
              className="ww-nav-item"
              onClick={() => navigate('/profile')}
              style={{ marginBottom: 2 }}
            >
              <span className="ww-item-icon">{ICONS.profile}</span>
              <span>Profile</span>
            </button>
            <button
              className="ww-nav-item"
              onClick={handleLogout}
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              <span className="ww-item-icon">{ICONS.logout}</span>
              <span>Logout</span>
            </button>
          </div>
        </aside>

        {/* ─── Top Bar ─── */}
        <header className="desktop-topbar">
          {/* Search */}
          <div className="desktop-topbar-search">
            {ICONS.search}
            <input
              type="text"
              placeholder="Search..."
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
              aria-label="Search"
            />
          </div>

          <div className="desktop-topbar-right">
            {/* Online/offline indicator */}
            {!isOnline && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                background: '#fef3c7', color: '#92400e',
                padding: '3px 8px', borderRadius: 20,
                border: '1px solid #fde68a',
                letterSpacing: '0.05em',
              }}>
                OFFLINE
              </span>
            )}

            {/* Notifications */}
            <button
              className="notif-btn"
              onClick={() => setNotifOpen(o => !o)}
              aria-label="Notifications"
              aria-expanded={notifOpen}
            >
              {ICONS.bell}
              <span className="notif-dot" style={{
                background: isOnline ? '#ef4444' : '#f97316',
              }} />
            </button>

            {/* User chip */}
            <div
              className="desktop-topbar-user"
              onClick={() => navigate('/profile')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate('/profile')}
              aria-label="View profile"
            >
              <div className="desktop-topbar-avatar">
                {user?.full_name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="desktop-topbar-userinfo">
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
            <span>Notifications</span>
            <button
              onClick={() => setNotifOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: 'rgba(0,0,0,0.4)' }}
              aria-label="Close notifications"
            >
              ×
            </button>
          </div>
          <div className="notif-item unread">
            <div className="notif-dot-inline" />
            <div>
              <div style={{ fontWeight: 600 }}>Report #3 resolved</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>2 hours ago</div>
            </div>
          </div>
          <div className="notif-item">
            <div style={{ width: 8 }} />
            <div>
              <div style={{ fontWeight: 600 }}>Welcome to WasteWatch!</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>3 days ago</div>
            </div>
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(0,0,0,0.07)' }}>
            <button style={{ width: '100%', background: 'none', border: 'none', color: '#16a34a', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Mark all as read
            </button>
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <main className="dashboard-main">
        {children}
      </main>

      {/* ── MOBILE: bottom nav ── */}
      <div className="layout-mobile">
        <BottomNav />
      </div>

      {/* Backdrop (closes dropdown) */}
      {notifOpen && (
        <div
          className="nav-backdrop"
          onClick={() => setNotifOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  )
}