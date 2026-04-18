/**
 * BottomNav.jsx
 * -------------
 * Mobile-only bottom navigation bar with a raised center camera button.
 * Hidden on desktop (desktop uses sidebar Quick Actions instead).
 *
 * Icons:
 *   Reports   — 📋  → /report/submit (history)
 *   Schedule  — 📅  → /dashboard
 *   Camera    — 📷  → /report/submit  (center raised CTA)
 *   Map       — 🗺  → /collection/confirm
 *   Profile   — 👤  → /profile (future)
 */

import { useNavigate, useLocation } from 'react-router-dom'

const NAV_ITEMS = [
  {
    id: 'reports',
    path: '/dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
        <line x1="9" y1="17" x2="13" y2="17"/>
        <polyline points="9 9 10 9"/>
        <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none"/>
      </svg>
    ),
    label: 'Reports',
  },
  {
    id: 'schedule',
    path: '/dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
    label: 'Schedule',
  },
  // center camera — rendered separately
  {
    id: 'map',
    path: '/map',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
        <line x1="8" y1="2" x2="8" y2="18"/>
        <line x1="16" y1="6" x2="16" y2="22"/>
      </svg>
    ),
    label: 'Map',
  },
  {
    id: 'profile',
    path: '/dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
    label: 'Profile',
  },
]

export default function BottomNav() {
  const navigate  = useNavigate()
  const location  = useLocation()

  const isActive = (path) => location.pathname === path

  return (
    <div className="bottom-nav">
      {/* Left two items */}
      {NAV_ITEMS.slice(0, 2).map(item => (
        <button
          key={item.id}
          className={`bottom-nav-item ${isActive(item.path) ? 'active' : ''}`}
          onClick={() => navigate(item.path)}
        >
          {item.icon}
          <span className="bottom-nav-label">{item.label}</span>
        </button>
      ))}

      {/* Center raised camera button */}
      <div className="bottom-nav-center">
        <button
          className="bottom-nav-camera"
          onClick={() => navigate('/report/submit')}
          aria-label="Submit Report"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
      </div>

      {/* Right two items */}
      {NAV_ITEMS.slice(2).map(item => (
        <button
          key={item.id}
          className={`bottom-nav-item ${isActive(item.path) ? 'active' : ''}`}
          onClick={() => navigate(item.path)}
        >
          {item.icon}
          <span className="bottom-nav-label">{item.label}</span>
        </button>
      ))}
    </div>
  )
}
