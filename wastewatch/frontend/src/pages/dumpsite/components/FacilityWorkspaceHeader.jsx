import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Building2,
  MapPin,
  Calendar,
  Activity,
  ClipboardCheck,
  ShieldAlert,
  Wrench,
  Fuel,
  ArrowLeftRight,
  Truck,
  History,
  LayoutDashboard,
} from 'lucide-react'

const WORKSPACE_TABS = [
  { path: '/dashboard', adminPath: '/dumpsite/workspace', label: 'Overview', Icon: LayoutDashboard },
  { path: '/dumpsite/monitoring', label: 'Monitoring', Icon: Activity },
  { path: '/dumpsite/queue', label: 'Queue', Icon: Truck },
  { path: '/dumpsite/inspections', label: 'Inspections', Icon: ClipboardCheck },
  { path: '/dumpsite/holds', label: 'Holds', Icon: ShieldAlert },
  { path: '/dumpsite/maintenance', label: 'Maintenance', Icon: Wrench },
  { path: '/dumpsite/allocations', label: 'Allocations', Icon: ArrowLeftRight },
  { path: '/dumpsite/fuel', label: 'Fuel', Icon: Fuel },
  { path: '/dumpsite/activity', label: 'Activity', Icon: History },
]

const TYPE_LABELS = {
  landfill: 'Landfill',
  dumpsite: 'Open Dumpsite',
  transfer: 'Transfer Station',
  composting: 'Composting Area',
}

export default function FacilityWorkspaceHeader({
  title,
  subtitle,
  sites = [],
  siteId,
  onSiteChange,
  activeSite,
  isAdmin = false,
  operationalDate,
  rightContent = null,
}) {
  const navigate = useNavigate()
  const location = useLocation()

  const facilityLocation = activeSite?.barangay_name || activeSite?.barangay?.name || 'Lucena City'
  const facilityType = TYPE_LABELS[activeSite?.type] || activeSite?.type || 'Facility'

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        className="ww-op-header"
        style={{
          background: '#ffffff',
          border: '1px solid #e4e6eb',
          borderRadius: 10,
          padding: '16px 20px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 14,
          }}
        >
          <div style={{ minWidth: 220, flex: '1 1 320px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <h1
                style={{
                  fontSize: 21,
                  fontWeight: 700,
                  color: '#1c1e21',
                  margin: 0,
                  fontFamily: 'var(--font-head)',
                  letterSpacing: '-0.02em',
                }}
              >
                {title}
              </h1>
              <span
                style={{
                  background: isAdmin ? '#eff6ff' : '#e7f5eb',
                  color: isAdmin ? '#1d4ed8' : '#15803d',
                  border: `1px solid ${isAdmin ? '#bfdbfe' : '#bbf7d0'}`,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 4,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                {isAdmin ? 'Admin Facility View' : 'Dumpsite Operator'}
              </span>
            </div>

            {subtitle && (
              <p style={{ color: '#65676b', fontSize: 13, margin: '0 0 8px' }}>
                {subtitle}
              </p>
            )}

            {activeSite && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#65676b' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: '#15803d' }}>
                  <Building2 size={14} />
                  {activeSite.name}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={13} />
                  {facilityType} · {facilityLocation}
                </span>
                {operationalDate && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Calendar size={13} />
                    Operational Date: <strong style={{ color: '#1c1e21' }}>{operationalDate}</strong>
                  </span>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {isAdmin && sites.length > 0 && onSiteChange && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <label
                  htmlFor="ww-facility-select"
                  style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  Active Facility
                </label>
                <select
                  id="ww-facility-select"
                  value={siteId || ''}
                  onChange={(e) => onSiteChange(e.target.value)}
                  style={{
                    height: 36,
                    minWidth: 220,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: '1px solid #ced0d4',
                    background: '#ffffff',
                    color: '#1c1e21',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.barangay_name || s.type})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {rightContent}
          </div>
        </div>

        {/* Workspace Module Navigation Strip */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid #e4e6eb',
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          {WORKSPACE_TABS.map((tab) => {
            const targetPath = isAdmin && tab.adminPath ? tab.adminPath : tab.path
            const isActive =
              location.pathname === targetPath ||
              (tab.path === '/dashboard' && (location.pathname === '/dashboard' || location.pathname === '/dumpsite/workspace'))
            const Icon = tab.Icon
            return (
              <button
                key={tab.path}
                type="button"
                onClick={() => navigate(targetPath)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 11px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: isActive ? '1px solid #bbf7d0' : '1px solid #e4e6eb',
                  background: isActive ? '#e7f5eb' : '#f8fafc',
                  color: isActive ? '#15803d' : '#4b5563',
                  transition: 'all 0.14s ease',
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
