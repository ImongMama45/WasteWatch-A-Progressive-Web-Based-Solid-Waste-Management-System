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

import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ClipboardCheck, Truck } from 'lucide-react'
import GlobalCameraModal from './GlobalCameraModal'
import ReportForm from '../pages/ReportForm'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import api from '../api/client'

const NAV_ITEMS = [
  {
    id: 'reports',
    path: '/dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
        <polyline points="9 9 10 9" />
        <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    label: 'Reports',
  },
  {
    id: 'schedule',
    path: '/schedule',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
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
        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
        <line x1="8" y1="2" x2="8" y2="18" />
        <line x1="16" y1="6" x2="16" y2="22" />
      </svg>
    ),
    label: 'Map',
  },
  {
    id: 'profile',
    path: '/profile',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    label: 'Profile',
  },
]

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { notify } = useNotification()
  const isWatcher = user?.role === 'watcher'

  const [cameraOpen, setCameraOpen] = useState(false)
  const [showWatcherMenu, setShowWatcherMenu] = useState(false)
  const [taskCounts, setTaskCounts] = useState({ verify: 0, confirm: 0 })
  const menuRef = useRef(null)
  const hoverTimeoutRef = useRef(null)

  // Overlay state for the unified report form
  const [reportFormOpen, setReportFormOpen] = useState(false)
  const [reportFormPhoto, setReportFormPhoto] = useState(null)

  const handleMouseEnter = () => {
    if (!isWatcher) return
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setShowWatcherMenu(true)
  }

  const handleMouseLeave = () => {
    if (!isWatcher) return
    hoverTimeoutRef.current = setTimeout(() => {
      setShowWatcherMenu(false)
    }, 600) // 600ms delay to allow crossing the gap
  }

  // Click outside to close watcher menu
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowWatcherMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [])

  // Fetch pending tasks for watcher so we know if buttons should be disabled
  useEffect(() => {
    if (!isWatcher) return
    api.get('/api/watcher/stop-validations/')
      .then(res => {
        const validations = res.data?.results ?? res.data ?? []
        let verify = 0
        let confirm = 0
        validations.forEach(v => {
          const status = v.current_status ? v.current_status.toUpperCase().replace(/ /g, '_') : 'PENDING_INSPECTION'
          if (status === 'PENDING_INSPECTION') verify++
          if (status === 'COLLECTION_REPORTED') confirm++
        })
        setTaskCounts({ verify, confirm })
      })
      .catch(() => {})
  }, [isWatcher, location.pathname])

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

      {/* Center raised camera button / Speed Dial */}
      <div
        className="bottom-nav-center"
        ref={menuRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {isWatcher && (
          <div style={{
            position: 'absolute',
            bottom: '80px',
            left: '50%',
            transform: `translateX(-50%) translateY(${showWatcherMenu ? '0' : '15px'})`,
            display: 'flex',
            gap: '16px',
            opacity: showWatcherMenu ? 1 : 0,
            pointerEvents: showWatcherMenu ? 'auto' : 'none',
            transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            zIndex: 100
          }}>
            {/* Verification Button (Red) */}
            <button onClick={(e) => { 
                e.stopPropagation(); 
                if (taskCounts.verify === 0) {
                  notify({ variant: 'warning-dark', message: 'No Available Verification yet Today' })
                  setShowWatcherMenu(false)
                  return
                }
                navigate('/verification-tasks'); 
                setShowWatcherMenu(false) 
              }}
              style={{
                height: 48, padding: '0 16px', borderRadius: '24px',
                background: taskCounts.verify > 0 ? '#ef4444' : '#64748b', 
                color: 'white', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                boxShadow: taskCounts.verify > 0 ? '0 4px 12px rgba(239,68,68,0.4)' : 'none', 
                cursor: taskCounts.verify > 0 ? 'pointer' : 'not-allowed',
                fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap',
                opacity: taskCounts.verify > 0 ? 1 : 0.8
              }}>
              <ClipboardCheck size={18} />
              Verify
            </button>
            {/* Confirm Button (Green) */}
            <button onClick={(e) => { 
                e.stopPropagation(); 
                if (taskCounts.confirm === 0) {
                  notify({ variant: 'warning-dark', message: 'No Available Confirmation yet Today' })
                  setShowWatcherMenu(false)
                  return
                }
                navigate('/watcher/confirm'); 
                setShowWatcherMenu(false) 
              }}
              style={{
                height: 48, padding: '0 16px', borderRadius: '24px',
                background: taskCounts.confirm > 0 ? '#10b981' : '#64748b', 
                color: 'white', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                boxShadow: taskCounts.confirm > 0 ? '0 4px 12px rgba(16,185,129,0.4)' : 'none', 
                cursor: taskCounts.confirm > 0 ? 'pointer' : 'not-allowed',
                fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap',
                opacity: taskCounts.confirm > 0 ? 1 : 0.8
              }}>
              <Truck size={18} />
              Confirm
            </button>
          </div>
        )}
        <button
          className="bottom-nav-camera"
          onClick={() => {
            setCameraOpen(true)
            setShowWatcherMenu(false)
          }}
          aria-label="Submit Report"
          style={{
            transform: showWatcherMenu ? 'scale(0.9) rotate(45deg)' : 'scale(1) rotate(0deg)',
            transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            background: showWatcherMenu ? '#334155' : undefined,
            color: showWatcherMenu ? '#f8fafc' : undefined
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
            {showWatcherMenu ? (
              <path d="M12 4v16m8-8H4" />
            ) : (
              <>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </>
            )}
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

      {/* Global Camera Overlay */}
      <GlobalCameraModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(capturedData) => {
          setCameraOpen(false)
          const isArray = Array.isArray(capturedData)
          const blob = isArray ? capturedData[0] : capturedData
          const previewUrl = URL.createObjectURL(blob)
          setReportFormPhoto({ blob, url: previewUrl })
          setReportFormOpen(true)
        }}
      />

      {/* Unified Offline Report Form Overlay */}
      <ReportForm
        isOpen={reportFormOpen}
        onClose={() => {
          setReportFormOpen(false)
          setReportFormPhoto(null)
        }}
        initialPhoto={reportFormPhoto}
      />
    </div>
  )
}
