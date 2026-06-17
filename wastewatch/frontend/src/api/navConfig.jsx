
/**
 * navConfig.jsx — Shared navigation configuration and constants
 * -----------------------------------------------------------
 * Move this here to break circular dependency between Navbar and DashboardLayout.
 */

import React from 'react'

// ─── SVG Icon Library (no emoji, clean line icons) ────────────────────────────

export const ICONS = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
  truck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <rect x="1" y="3" width="15" height="13" rx="1" />
      <path d="M16 8h4l3 5v3h-7V8z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  ),
  route: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <circle cx="6" cy="19" r="2" />
      <path d="M6 17V5a2 2 0 0 1 2-2h3" />
      <polyline points="11 4 14 1 17 4" />
      <circle cx="18" cy="5" r="2" />
      <path d="M18 7v12a2 2 0 0 1-2 2H9" />
      <polyline points="7 20 4 17 7 14" />
    </svg>
  ),
  dumpsite: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M8 3l4 8 5-5 5 15H2L8 3z" />
    </svg>
  ),
  hotspot: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  escalation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  barangay: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  waste: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  news: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" />
    </svg>
  ),
  report: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  ),
  schedule: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  driver: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  ),
}

export const NAV_ICONS = {
  '📊': ICONS.dashboard,
  '🗺️': ICONS.map,
  '📋': ICONS.report,
  '📨': ICONS.escalation,
  '✅': ICONS.check,
  '🚛': ICONS.truck,
  '🏠': ICONS.barangay,
  '📅': ICONS.schedule,
  '👥': ICONS.users,
  '🏔️': ICONS.dumpsite,
  '⚠️': ICONS.escalation,
  '📈': ICONS.waste,
  '🔥': ICONS.hotspot,
  '🔔': ICONS.bell,
  '📝': ICONS.report,
  '📍': ICONS.pin,
  '👤': ICONS.profile,
  '🔑': ICONS.logout,
  '📰': ICONS.news,
}

export const ROLE_NAV_CONFIG = {
  admin: [
    { type: 'item', path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    {
      type: 'group', label: 'Operations', icon: 'truck',
      items: [
        { path: '/map',            label: 'Live Map',        icon: 'map' },
        { path: '/admin/trucks',   label: 'Trucks & Drivers', icon: 'truck' },
        { path: '/admin/routes',   label: 'Routes',          icon: 'route' },
        { path: '/admin/dumpsites', label: 'Dumpsites',      icon: 'dumpsite' },
      ],
    },
    {
      type: 'group', label: 'Monitoring', icon: 'hotspot',
      items: [
        { path: '/admin/reports',      label: 'Waste Reports',     icon: 'report' },
        { path: '/admin/hotspots',     label: 'Reported Hotspots', icon: 'hotspot' },
        { path: '/admin/escalations',  label: 'Escalations',       icon: 'escalation' },
        { path: '/admin/activity-log', label: 'Activity Logs',     icon: 'activity' },
      ],
    },
    {
      type: 'group', label: 'Analytics', icon: 'analytics',
      items: [
        { path: '/analytics',       label: 'Barangay Analytics', icon: 'barangay' },
      ],
    },
    {
      type: 'group', label: 'Administration', icon: 'users',
      items: [
        { path: '/admin/users', label: 'User Management', icon: 'users' },
      ],
    },
    { type: 'item', path: '/announcements', label: 'News & Alerts', icon: 'news' },
  ],

  brgy_official: [
    { type: 'item', path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    {
      type: 'group', label: 'Operations', icon: 'map',
      items: [
        { path: '/map',      label: 'Live Map',           icon: 'map' },
        { path: '/schedule', label: 'Collection Schedule', icon: 'schedule' },
      ],
    },
    {
      type: 'group', label: 'Monitoring', icon: 'report',
      items: [
        { path: '/brgy/validate-reports', label: 'Resident Reports', icon: 'report' },
        { path: '/brgy/escalate',         label: 'Escalations',      icon: 'escalation' },
      ],
    },
    {
      type: 'group', label: 'Analytics', icon: 'analytics',
      items: [
        { path: '/analytics', label: 'Barangay Analytics', icon: 'barangay' },
      ],
    },
    { type: 'item', path: '/announcements', label: 'News & Alerts', icon: 'news' },
  ],

  watcher: [
    { type: 'item', path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    {
      type: 'group', label: 'Field Work', icon: 'check',
      items: [
        { path: '/map',                 label: 'Live Map',            icon: 'map' },
        { path: '/watcher-tasks',       label: 'Watcher Tasks',       icon: 'check' },
        { path: '/schedule',            label: 'Collection Schedule', icon: 'schedule' },
      ],
    },
    {
      type: 'group', label: 'Analytics', icon: 'analytics',
      items: [
        { path: '/analytics', label: 'Barangay Analytics', icon: 'barangay' },
      ],
    },
    { type: 'item', path: '/announcements', label: 'News & Alerts', icon: 'news' },
  ],

  driver: [
    { type: 'item', path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    {
      type: 'group', label: 'Operations', icon: 'truck',
      items: [
        { path: '/driver/route',  label: 'My Route',       icon: 'route' },
        { path: '/driver/log',    label: 'Collection Log', icon: 'report' },
        { path: '/driver/status', label: 'Shift & Truck',  icon: 'truck' },
      ],
    },
    {
      type: 'group', label: 'Monitoring', icon: 'hotspot',
      items: [
        { path: '/map',             label: 'Live Map',       icon: 'map' },
        { path: '/driver/hotspots', label: 'Hotspot Alerts', icon: 'hotspot' },
      ],
    },
    {
      type: 'group', label: 'Analytics', icon: 'analytics',
      items: [
        { path: '/driver/analytics', label: 'Driver Analytics',   icon: 'analytics' },
        { path: '/analytics',        label: 'Barangay Analytics', icon: 'barangay' },
      ],
    },
    { type: 'item', path: '/announcements', label: 'News & Alerts', icon: 'news' },
  ],

  citizen: [
    { type: 'item', path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    {
      type: 'group', label: 'Services', icon: 'map',
      items: [
        { path: '/map',      label: 'Live Map',           icon: 'map' },
        { path: '/schedule', label: 'Collection Schedule', icon: 'schedule' },
      ],
    },
    {
      type: 'group', label: 'Community', icon: 'barangay',
      items: [
        { path: '/analytics',     label: 'Barangay Analytics', icon: 'barangay' },
        { path: '/announcements', label: 'News & Alerts',      icon: 'news' },
      ],
    },
  ],
  dumpsite: [
    { type: 'item', path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    {
      type: 'group', label: 'Operations', icon: 'dumpsite',
      items: [
        { path: '/dumpsite/inbound',  label: 'Inbound Trucks', icon: 'truck' },
        { path: '/dumpsite/log',      label: 'Disposal Log',   icon: 'report' },
      ],
    },
    { type: 'item', path: '/announcements', label: 'News & Alerts', icon: 'news' },
  ],
}

export const SIDEBAR_NAV = {
  admin: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/analytics', label: 'Brgy Analytics', icon: '📈' },
    { path: '/announcements', label: 'News & Alerts', icon: '📰' },
    { path: '/schedule', label: 'Schedule', icon: '📅' },
    { path: '/map', label: 'Live Map', icon: '🗺️' },
    { path: '/admin/reports', label: 'Waste Reports', icon: '📋' },
    { path: '/admin/trucks', label: 'Trucks & Drivers', icon: '🚛' },
    { path: '/admin/users', label: 'User Management', icon: '👥' },
    { path: '/admin/dumpsites', label: 'Dumpsites', icon: '🏔️' },
    { path: '/admin/routes', label: 'Routes', icon: '🗺️' },
    { path: '/admin/escalations', label: 'Escalations', icon: '⚠️' },
    { path: '/admin/analytics', label: 'Analytics', icon: '📈' },
    { path: '/admin/hotspots', label: 'Hotspots', icon: '🔥' },
    { path: '/admin/activity-log', label: 'Activity Log', icon: '📝' },
  ],
  brgy_official: [
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
  dumpsite: [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/announcements', label: 'News & Alerts', icon: '📰' },
    { path: '/dumpsite/inbound', label: 'Inbound', icon: '🚛' },
    { path: '/dumpsite/log', label: 'Disposal Log', icon: '📋' },
  ],
}

export function getRoleNavItems(role) {
  return ROLE_NAV_CONFIG[role] || ROLE_NAV_CONFIG.citizen
}

export function flattenNavItems(items) {
  return items.flatMap(item =>
    item.type === 'group' ? item.items : [item]
  )
}
