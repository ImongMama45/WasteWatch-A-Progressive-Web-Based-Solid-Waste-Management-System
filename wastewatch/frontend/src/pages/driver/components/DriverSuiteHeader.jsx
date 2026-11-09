/**
 * DriverSuiteHeader.jsx — Unified Header & Navigation for Driver Suite
 * ---------------------------------------------------------------------
 * Provides a standardized header, breadcrumb, driver badge, and suite tab switcher
 * across Route Overview, Collection Logs, and Shift Status.
 *
 * Strictly SVG iconography (NO emojis) in compliance with project rules.
 */

import { useNavigate } from 'react-router-dom'
import {
  Truck,
  MapPin,
  FileText,
  Activity,
  Circle,
  CheckCircle2,
  Navigation,
  AlertTriangle,
} from 'lucide-react'

export default function DriverSuiteHeader({
  activeTab = 'route', // 'route' | 'logs' | 'status'
  title = 'Driver Suite',
  subtitle = 'Lucena City Solid Waste Collection',
  truck = '',
  barangay = '',
  shiftActive = false,
  opStatus = 'off_shift',
  rightContent = null,
  onOpenOverlay = null,
}) {
  const navigate = useNavigate()

  const tabs = [
    { key: 'route', label: 'Route Map', path: '/driver/route', Icon: MapPin },
    { key: 'logs', label: 'Collection Logs', path: '/driver/log', Icon: FileText },
    { key: 'hotspots', label: 'Hotspot Alerts', path: '/driver/hotspots', Icon: AlertTriangle },
    { key: 'status', label: 'Shift & Status', path: '/driver/status', Icon: Activity },
  ]

  // Status mapping
  const statusCfg = {
    off_shift: { label: 'Off Duty', color: '#65676b', bg: '#f0f2f5', border: '#ced0d4', Icon: Circle },
    on_shift: { label: 'On Shift', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0', Icon: CheckCircle2 },
    on_route: { label: 'On Route', color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe', Icon: Navigation },
    delayed: { label: 'Delayed', color: '#b45309', bg: '#fef3c7', border: '#fde68a', Icon: AlertTriangle },
  }[opStatus] || { label: 'Off Duty', color: '#65676b', bg: '#f0f2f5', border: '#ced0d4', Icon: Circle }

  const StatusIcon = statusCfg.Icon

  return (
    <div style={{ marginBottom: 20 }}>
      {/* ── ROW 1: UNIFIED NAVIGATION TABS & DRIVER STATUS BAR ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 16,
      }}>
        {/* Left: Connected Suite Tabs */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          background: '#e4e6eb',
          borderRadius: 8,
          padding: 3,
        }}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.key
            const TabIcon = tab.Icon

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
                <TabIcon size={14} color={isActive ? '#16a34a' : '#65676b'} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Right Info Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {barangay && (
            <span style={{
              background: '#dbeafe',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <MapPin size={11} /> {barangay}
            </span>
          )}

          {truck && (
            <span style={{
              background: '#ffffff',
              color: '#1c1e21',
              border: '1px solid #e4e6eb',
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <Truck size={12} style={{ color: '#16a34a' }} /> {truck.toUpperCase().startsWith('TRUCK') ? truck : `TRUCK ${truck}`}
            </span>
          )}

          {/* Operational Status Pill (Clickable if onOpenOverlay provided) */}
          <button
            onClick={() => {
              if (onOpenOverlay && activeTab !== 'status') onOpenOverlay('status')
              else if (activeTab !== 'status') navigate('/driver/status')
            }}
            style={{
              background: statusCfg.bg,
              border: `1px solid ${statusCfg.border}`,
              color: statusCfg.color,
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              cursor: activeTab !== 'status' ? 'pointer' : 'default',
            }}
            title={activeTab !== 'status' ? 'Click to open Shift Command Center' : ''}
          >
            <StatusIcon size={12} />
            <span>{statusCfg.label.toUpperCase()}</span>
            {shiftActive && (
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#16a34a',
                display: 'inline-block',
                marginLeft: 2,
              }} />
            )}
          </button>
        </div>
      </div>

      {/* ── ROW 3: PAGE TITLE & CONTEXT ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        marginBottom: 16,
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#1c1e21', letterSpacing: '-0.01em' }}>
            {title}
          </h1>
          <p style={{ margin: '3px 0 0', fontSize: 13, color: '#65676b' }}>
            {subtitle}
          </p>
        </div>

        {rightContent && (
          <div>
            {rightContent}
          </div>
        )}
      </div>
    </div>
  )
}
