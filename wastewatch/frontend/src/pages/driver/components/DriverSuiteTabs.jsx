/**
 * DriverSuiteTabs.jsx — Connected Navigation Switcher for Driver Suite
 * ---------------------------------------------------------------------
 * Unifies Route Overview, Collection Logs, and Shift Status.
 * Supports both direct routing and quick overlay modal triggering.
 *
 * Strictly SVG iconography (NO emojis) in compliance with project rules.
 */

import { useNavigate, useLocation } from 'react-router-dom'
import { MapPin, FileText, Activity, AlertTriangle } from 'lucide-react'

export default function DriverSuiteTabs({
  activeTab, // 'route' | 'logs' | 'hotspots' | 'status'
  onOpenOverlay, // optional: (tabKey) => void
  showOverlayButtons = false,
}) {
  const navigate = useNavigate()
  const location = useLocation()

  const tabs = [
    { key: 'route', label: 'Route Map', path: '/driver/route', Icon: MapPin },
    { key: 'logs', label: 'Collection Logs', path: '/driver/log', Icon: FileText },
    { key: 'hotspots', label: 'Hotspot Alerts', path: '/driver/hotspots', Icon: AlertTriangle },
    { key: 'status', label: 'Shift & Status', path: '/driver/status', Icon: Activity },
  ]

  const currentTab = activeTab || (
    location.pathname.includes('/driver/log') ? 'logs' :
    location.pathname.includes('/driver/hotspots') ? 'hotspots' :
    location.pathname.includes('/driver/status') ? 'status' : 'route'
  )

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      background: '#e4e6eb',
      borderRadius: 8,
      padding: 3,
      marginBottom: 16,
    }}>
      {tabs.map(tab => {
        const isActive = currentTab === tab.key
        const Icon = tab.Icon

        return (
          <button
            key={tab.key}
            onClick={() => {
              if (!isActive) navigate(tab.path)
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: isActive ? '#ffffff' : 'transparent',
              color: isActive ? '#1c1e21' : '#65676b',
              border: 'none',
              transition: 'all 0.15s ease',
              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            <Icon size={14} color={isActive ? '#16a34a' : '#65676b'} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
