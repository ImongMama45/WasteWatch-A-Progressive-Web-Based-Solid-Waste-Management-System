/**
 * components/OfflineBanner.jsx
 * -----------------------------
 * Sticky banner shown when the device is offline.
 * Slides in from top, disappears when back online.
 */

import { useOnline } from '../hooks/useOnline'

export default function OfflineBanner() {
  const isOnline = useOnline()

  if (isOnline) return null

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0,
      zIndex: 9999,
      background: '#1a1a2e',
      borderBottom: '1px solid rgba(243,156,18,.4)',
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      fontSize: 12,
      fontWeight: 600,
      color: '#f39c12',
      animation: 'slideDown .3s ease',
    }}>
      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
      <span>📡</span>
      <span>Offline Mode — showing cached data</span>
    </div>
  )
}
