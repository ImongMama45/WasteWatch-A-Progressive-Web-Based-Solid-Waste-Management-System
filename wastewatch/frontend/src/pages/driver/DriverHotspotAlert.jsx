/**
 * DriverHotspotAlert.jsx — Driver Hotspot Detection & Proximity Alerts
 * ---------------------------------------------------------------------
 * Displays:
 *  1. Dispatched Work Orders — Hotspots directly assigned to this truck
 *     by admin/dispatch. Driver can mark as acknowledged / collected.
 *  2. Nearby Hotspots — Situational awareness radar within 5 km of route.
 *
 * Supports dual display modes:
 *  - Standalone full page (via /driver/hotspots)
 *  - Overlay modal / drawer (via isOverlay=true or onClose prop)
 *
 * Interconnected with DriverSuiteHeader, DriverSuiteTabs, RouteOverview,
 * DriverCollectionLog, and DriverStatusPanel.
 *
 * Strictly SVG iconography (NO emojis) in compliance with project rules.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  CheckCircle2,
  Truck,
  MapPin,
  Clock,
  Compass,
  Search,
  Filter,
  Navigation,
  Check,
  ChevronLeft,
  X,
  Layers,
  ArrowRight,
  Maximize2,
  Activity,
  Flame,
  Radio,
  ExternalLink
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import useGpsTracking from '../../hooks/useGpsTracking'
import useShiftTimer from '../../hooks/useShiftTimer'
import DriverSuiteHeader from './components/DriverSuiteHeader'
import DriverStatusPanel from './DriverStatusPanel'
import DriverCollectionLog from './DriverCollectionLog'
import { StatCardSkeleton, FeedCardSkeleton } from '../../components/ui/Skeleton'

// ─── SEVERITY CONFIG (STRICTLY SVG - ZERO EMOJIS) ─────────────────────────────

const SEVERITY = {
  high: {
    label: 'HIGH PRIORITY',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.10)',
    border: 'rgba(239, 68, 68, 0.35)',
    glow: 'rgba(239, 68, 68, 0.15)',
    Icon: Flame,
    rank: 1,
  },
  medium: {
    label: 'MEDIUM PRIORITY',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.10)',
    border: 'rgba(245, 158, 11, 0.35)',
    glow: 'rgba(245, 158, 11, 0.15)',
    Icon: AlertTriangle,
    rank: 2,
  },
  low: {
    label: 'LOW PRIORITY',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.10)',
    border: 'rgba(16, 185, 129, 0.35)',
    glow: 'rgba(16, 185, 129, 0.15)',
    Icon: CheckCircle2,
    rank: 3,
  },
}

const TYPE_CONFIG = {
  overflow: { label: 'Bin Overflow', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  illegal_dumping: { label: 'Illegal Dumping', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
  missed_collection: { label: 'Missed Pickup', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },
}

const SORT_OPTIONS = [
  { key: 'proximity', label: 'Closest Distance' },
  { key: 'severity', label: 'Highest Severity' },
]

// ─── ASSIGNED HOTSPOT CARD (Primary Actionable Card) ──────────────────────────

function AssignedHotspotCard({ alert, onNoted }) {
  const sev = SEVERITY[alert.severity] || SEVERITY.medium
  const typeCfg = TYPE_CONFIG[alert.type] || { label: alert.type || 'Hotspot', color: '#64748b', bg: '#f0f2f5' }
  const SevIcon = sev.Icon

  const [noted, setNoted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleNoted() {
    setLoading(true)
    try {
      await api.post(`/api/watcher/hotspots/${alert.id}/noted/`)
    } catch {}
    setLoading(false)
    setNoted(true)
    setTimeout(() => {
      onNoted?.(alert.id)
    }, 400)
  }

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e4e6eb',
        borderRadius: 8,
        marginBottom: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        opacity: noted ? 0.6 : 1,
        transition: 'all 0.2s ease',
      }}
    >
      {/* Top Banner: Priority + Truck assignment */}
      <div
        style={{
          background: noted ? '#f0f2f5' : sev.bg,
          borderBottom: '1px solid #e4e6eb',
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: sev.color,
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SevIcon size={12} strokeWidth={2.5} />
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: sev.color, letterSpacing: '0.04em' }}>
            {sev.label}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: '#dbeafe',
              border: '1px solid #bfdbfe',
              color: '#1d4ed8',
              borderRadius: 4,
              padding: '2px 8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Truck size={11} /> {alert.assigned_truck_plate || 'Your Truck'}
          </span>
        </div>
      </div>

      {/* Main Card Content */}
      <div style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{
              margin: '0 0 3px 0',
              fontSize: 14,
              fontWeight: 700,
              color: '#1c1e21',
              lineHeight: 1.3,
            }}>
              {alert.address}
            </h3>

            {alert.barangay && (
              <div style={{
                color: '#65676b',
                fontSize: 12,
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <MapPin size={12} /> {alert.barangay}
              </div>
            )}
          </div>

          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 700,
              background: typeCfg.bg,
              color: typeCfg.color,
              border: `1px solid ${typeCfg.color}30`,
              borderRadius: 4,
              padding: '2px 8px',
            }}
          >
            {typeCfg.label}
          </span>
        </div>

        {alert.description && (
          <p
            style={{
              fontSize: 12,
              color: '#65676b',
              lineHeight: 1.4,
              margin: '8px 0 10px 0',
              background: '#f8fafc',
              border: '1px solid #e4e6eb',
              borderRadius: 6,
              padding: '8px 10px',
            }}
          >
            {alert.description}
          </p>
        )}

        {/* Metadata Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingTop: 8,
          marginBottom: 12,
          borderTop: '1px solid #f0f2f5',
          fontSize: 12,
          color: '#65676b',
          flexWrap: 'wrap',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Clock size={12} /> Reported {alert.reportedAt || 'recently'}
          </span>

          {alert.distanceKm != null && (
            <span style={{
              background: '#dbeafe',
              color: '#1d4ed8',
              fontWeight: 600,
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <Compass size={11} /> {Number(alert.distanceKm).toFixed(1)} km away
            </span>
          )}
        </div>

        {/* Action Button */}
        <button
          id={`hotspot-noted-${alert.id}`}
          onClick={handleNoted}
          disabled={noted || loading}
          style={{
            width: '100%',
            height: 36,
            borderRadius: 6,
            cursor: noted ? 'default' : 'pointer',
            background: noted
              ? '#e7f5eb'
              : '#16a34a',
            border: noted ? '1px solid #bbf7d0' : 'none',
            color: noted ? '#15803d' : '#ffffff',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            boxShadow: noted ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
            transition: 'background 0.15s ease',
          }}
          onMouseOver={e => {
            if (!noted && !loading) e.currentTarget.style.background = '#15803d'
          }}
          onMouseOut={e => {
            if (!noted && !loading) e.currentTarget.style.background = '#16a34a'
          }}
        >
          {loading ? (
            <div className="spinner" style={{ width: 14, height: 14 }} />
          ) : noted ? (
            <>
              <Check size={15} strokeWidth={2.5} /> Acknowledged by Driver
            </>
          ) : (
            <>
              <CheckCircle2 size={15} /> Mark as Acknowledged
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ─── NEARBY HOTSPOT CARD (Situational Radar Card) ─────────────────────────────

function NearbyHotspotCard({ alert }) {
  const sev = SEVERITY[alert.severity] || SEVERITY.medium
  const typeCfg = TYPE_CONFIG[alert.type] || { label: alert.type || 'Hotspot', color: '#64748b', bg: '#f0f2f5' }
  const SevIcon = sev.Icon

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e4e6eb',
        borderRadius: 8,
        marginBottom: 10,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        transition: 'all 0.15s ease',
      }}
    >
      <div
        style={{
          background: sev.bg,
          borderBottom: '1px solid #e4e6eb',
          padding: '7px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SevIcon size={12} style={{ color: sev.color }} strokeWidth={2.5} />
          <span style={{ fontSize: 10, fontWeight: 700, color: sev.color, letterSpacing: '0.04em' }}>
            {sev.label}
          </span>
        </div>

        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: typeCfg.color,
            background: '#ffffff',
            border: `1px solid ${typeCfg.color}30`,
            borderRadius: 4,
            padding: '2px 6px',
          }}
        >
          {typeCfg.label}
        </span>
      </div>

      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21', marginBottom: 2 }}>
              {alert.address}
            </div>
            <div style={{ color: '#65676b', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <MapPin size={11} /> {alert.barangay}
            </div>
          </div>

          {alert.distanceKm != null && (
            <div
              style={{
                flexShrink: 0,
                background: '#f0f2f5',
                border: '1px solid #e4e6eb',
                borderRadius: 4,
                padding: '3px 8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: sev.color }}>
                {Number(alert.distanceKm).toFixed(1)}
              </div>
              <div style={{ fontSize: 9, color: '#65676b', fontWeight: 700, letterSpacing: '0.04em' }}>
                KM AWAY
              </div>
            </div>
          )}
        </div>

        {alert.description && (
          <p style={{
            fontSize: 12,
            color: '#65676b',
            lineHeight: 1.4,
            margin: '8px 0 10px 0',
          }}>
            {alert.description}
          </p>
        )}

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px solid #f0f2f5',
          fontSize: 11,
          color: '#65676b',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Clock size={11} /> {alert.reportedAt || 'Recent report'}
          </span>

          {alert.assigned_truck_plate ? (
            <span style={{
              color: '#1d4ed8',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <Truck size={11} /> Dispatched to {alert.assigned_truck_plate}
            </span>
          ) : (
            <span style={{ color: '#8a8d91', fontStyle: 'italic' }}>
              Unassigned · Awareness Only
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DriverHotspotAlert({
  isOverlay = false,
  open = true,
  onClose = null,
}) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [assigned, setAssigned] = useState([])
  const [nearby, setNearby] = useState([])
  const [sortBy, setSortBy] = useState('proximity')
  const [filterType, setFilterType] = useState('all') // 'all' | 'overflow' | 'illegal_dumping' | 'missed_collection'
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [assignedLoading, setAssignedLoading] = useState(true)
  const [profile, setProfile] = useState(null)

  // Overlay state for opening Shift or Logs in modal
  const [activeOverlayModal, setActiveOverlayModal] = useState(null)

  const { shiftActive } = useShiftTimer()
  const { position: gpsPosition, accuracy: gpsAccuracy, isTracking } = useGpsTracking({ enabled: true, syncEnabled: shiftActive })

  // 1. Fetch driver shift profile
  useEffect(() => {
    api.get('/api/driver/shift/profile/')
      .then(res => setProfile(res.data))
      .catch(() => {})
  }, [])

  // 2. Fetch assigned hotspots (for this driver's truck)
  useEffect(() => {
    setAssignedLoading(true)
    api.get('/api/watcher/hotspots/assigned/')
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.results || [])
        setAssigned(list)
      })
      .catch(() => {})
      .finally(() => setAssignedLoading(false))
  }, [])

  // 3. Fetch nearby hotspots based on GPS
  useEffect(() => {
    const params = gpsPosition ? `?lat=${gpsPosition.lat}&lng=${gpsPosition.lng}` : ''
    setLoading(true)
    api.get(`/api/watcher/hotspots/nearby/${params}`)
      .then(res => {
        if (Array.isArray(res.data)) setNearby(res.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [gpsPosition?.lat, gpsPosition?.lng])

  // Exclude already-assigned to avoid duplicate presentation
  const assignedIds = useMemo(() => new Set(assigned.map(a => a.id)), [assigned])

  // Filtered and sorted nearby list
  const filteredNearby = useMemo(() => {
    return nearby
      .filter(h => !assignedIds.has(h.id))
      .filter(h => {
        if (filterType !== 'all' && h.type !== filterType) return false
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase()
          const matchAddress = h.address?.toLowerCase().includes(q)
          const matchBrgy = h.barangay?.toLowerCase().includes(q)
          const matchDesc = h.description?.toLowerCase().includes(q)
          return matchAddress || matchBrgy || matchDesc
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'proximity') {
          return (a.distanceKm ?? 99) - (b.distanceKm ?? 99)
        }
        return (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9)
      })
  }, [nearby, assignedIds, filterType, searchQuery, sortBy])

  // KPI Metrics
  const highCount = [...assigned, ...nearby].filter(a => a.severity === 'high').length
  const assignedCount = assigned.length
  const nearbyCount = nearby.length

  if (isOverlay && !open) return null

  const content = (
    <div>
      <style>{`
        @keyframes dhaFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .dha-animated { animation: dhaFadeUp 0.2s ease-out both; }
        .dha-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        .dha-kpi-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 14px 16px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          display: flex;
          align-items: center;
          gap: 14px;
          position: relative;
          overflow: hidden;
          transition: border-color 0.15s ease;
        }
        .dha-kpi-card:hover {
          border-color: #ced0d4;
        }
        @media (min-width: 1024px) {
          .dha-grid {
            grid-template-columns: 1.1fr 0.9fr;
            align-items: start;
          }
        }
      `}</style>

      {/* ── UNIFIED DRIVER SUITE HEADER (When Standalone Page) ── */}
      {!isOverlay && (
        <DriverSuiteHeader
          activeTab="hotspots"
          title="Hotspot Alerts"
          subtitle="Real-time illegal dumping and overflow detection radar along your jurisdiction"
          truck={profile?.truck || profile?.plateNumber}
          barangay={profile?.barangay}
          shiftActive={shiftActive}
          opStatus={shiftActive ? 'on_shift' : 'off_shift'}
          onOpenOverlay={(modalKey) => {
            if (modalKey === 'route') navigate('/driver/route')
            else if (modalKey === 'logs') setActiveOverlayModal('logs')
            else if (modalKey === 'status') setActiveOverlayModal('status')
          }}
          rightContent={
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e4e6eb',
                borderRadius: 8,
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>
                  Assigned Alerts
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: assignedCount > 0 ? '#ef4444' : '#15803d' }}>
                  {assignedCount} <span style={{ fontSize: 12, color: '#65676b', fontWeight: 500 }}>active</span>
                </div>
              </div>
            </div>
          }
        />
      )}

      {/* ── OVERLAY HEADER (When in Modal Mode) ── */}
      {isOverlay && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: '1px solid #e4e6eb',
          }}
        >
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#1c1e21' }}>
              Hotspot Detection & Alerts
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#65676b' }}>
              {profile?.truck ? `${profile.truck} · ` : ''}Active waste overflow and illegal dumping notifications
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: '#f0f2f5',
                border: '1px solid #e4e6eb',
                borderRadius: 6,
                padding: 6,
                color: '#65676b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* ── KPI METRICS CARDS ROW ── */}
      {(assignedLoading && loading) ? (
        <StatCardSkeleton count={4} style={{ marginBottom: 16 }} />
      ) : (
      <div
        className="ww-fade-in"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {/* Card 1: Dispatched to Truck */}
        <div className="dha-kpi-card">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              background: '#dbeafe',
              color: '#1d4ed8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Truck size={20} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>
              Assigned to Truck
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1c1e21', marginTop: 1 }}>
              {assignedCount}
            </div>
            <div style={{ fontSize: 11, color: '#65676b' }}>
              Actionable collections
            </div>
          </div>
        </div>

        {/* Card 2: High Severity */}
        <div className="dha-kpi-card">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              background: '#fee2e2',
              color: '#b91c1c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Flame size={20} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>
              High Priority
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#b91c1c', marginTop: 1 }}>
              {highCount}
            </div>
            <div style={{ fontSize: 11, color: '#65676b' }}>
              Urgent dumps &amp; overflows
            </div>
          </div>
        </div>

        {/* Card 3: Nearby in 5km */}
        <div className="dha-kpi-card">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              background: '#e7f5eb',
              color: '#15803d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Radio size={20} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>
              Nearby Radar (&lt;5km)
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#15803d', marginTop: 1 }}>
              {nearbyCount}
            </div>
            <div style={{ fontSize: 11, color: '#65676b' }}>
              Situational reports
            </div>
          </div>
        </div>

        {/* Card 4: GPS Live Positioning */}
        <div className="dha-kpi-card">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              background: isTracking ? '#e7f5eb' : '#f0f2f5',
              color: isTracking ? '#15803d' : '#65676b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Compass size={20} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>
              GPS Positioning
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              {isTracking ? (
                <>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a' }} />
                  Live (±{gpsAccuracy || 10}m)
                </>
              ) : (
                'Proximity Standby'
              )}
            </div>
            <div style={{ fontSize: 11, color: '#65676b', marginTop: 1 }}>
              {isTracking ? 'Active range calculation' : 'Awaiting GPS lock'}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ── MAIN CONTENT 2-COLUMN GRID ── */}
      <div className="dha-grid">

        {/* ── COLUMN 1: ASSIGNED TO YOUR TRUCK (DISPATCHED WORK ORDERS) ── */}
        <div className="dha-animated">
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e4e6eb',
              borderRadius: 8,
              padding: '18px 20px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              marginBottom: 16,
            }}
          >
            {/* Section Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    background: '#dbeafe',
                    color: '#1d4ed8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Truck size={16} />
                </div>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#1c1e21' }}>
                    Dispatched to Your Truck
                  </h2>
                  <p style={{ margin: '1px 0 0', fontSize: 12, color: '#65676b' }}>
                    Hotspots assigned by dispatch for mandatory pickup
                  </p>
                </div>
              </div>

              {assignedCount > 0 && (
                <span
                  style={{
                    background: '#fee2e2',
                    color: '#b91c1c',
                    border: '1px solid #fecaca',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {assignedCount} PENDING
                </span>
              )}
            </div>

            {/* List / Loading / Empty */}
            {assignedLoading ? (
              <FeedCardSkeleton count={2} compact />
            ) : assigned.length === 0 ? (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e4e6eb',
                  borderRadius: 8,
                  padding: '28px 16px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: '#e7f5eb',
                    color: '#15803d',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 10px',
                  }}
                >
                  <CheckCircle2 size={24} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1c1e21', marginBottom: 2 }}>
                  All Assigned Hotspots Clear
                </div>
                <p style={{ fontSize: 12, color: '#65676b', maxWidth: 340, margin: '0 auto', lineHeight: 1.4 }}>
                  No pending hotspots dispatched to your truck right now. Follow your scheduled route sequence.
                </p>
              </div>
            ) : (
              <div className="ww-stagger">
                {assigned.map(alert => (
                  <AssignedHotspotCard
                    key={alert.id}
                    alert={alert}
                    onNoted={id => setAssigned(prev => prev.filter(a => a.id !== id))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── COLUMN 2: NEARBY HOTSPOTS (SITUATIONAL AWARENESS RADAR) ── */}
        <div className="dha-animated">
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e4e6eb',
              borderRadius: 8,
              padding: '18px 20px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            {/* Section Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    background: '#fef3c7',
                    color: '#b45309',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Radio size={16} />
                </div>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#1c1e21' }}>
                    Nearby Hotspots Radar
                  </h2>
                  <p style={{ margin: '1px 0 0', fontSize: 12, color: '#65676b' }}>
                    Situational awareness within 5 km of truck
                  </p>
                </div>
              </div>

              {/* Sort Switcher */}
              <div
                style={{
                  display: 'inline-flex',
                  background: '#e4e6eb',
                  borderRadius: 6,
                  padding: 2,
                }}
              >
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setSortBy(opt.key)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      background: sortBy === opt.key ? '#ffffff' : 'transparent',
                      color: sortBy === opt.key ? '#1c1e21' : '#65676b',
                      boxShadow: sortBy === opt.key ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input Bar */}
            <div
              style={{
                position: 'relative',
                marginBottom: 10,
              }}
            >
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#65676b',
                }}
              />
              <input
                type="text"
                placeholder="Filter by location or barangay..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: 36,
                  padding: '0 12px 0 32px',
                  borderRadius: 6,
                  border: '1px solid #ced0d4',
                  background: '#ffffff',
                  fontSize: 13,
                  color: '#1c1e21',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#65676b',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Type Category Pills Filter */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 12 }}>
              {[
                { key: 'all', label: 'All Types' },
                { key: 'overflow', label: 'Overflow' },
                { key: 'illegal_dumping', label: 'Illegal Dumping' },
                { key: 'missed_collection', label: 'Missed Pickup' },
              ].map(t => {
                const isActive = filterType === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => setFilterType(t.key)}
                    style={{
                      background: isActive ? '#e7f5eb' : '#ffffff',
                      color: isActive ? '#15803d' : '#1c1e21',
                      border: `1px solid ${isActive ? '#bbf7d0' : '#ced0d4'}`,
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>

            {/* Nearby Cards Stream */}
            {loading ? (
              <FeedCardSkeleton count={3} compact />
            ) : filteredNearby.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '28px 16px',
                  color: '#65676b',
                  background: '#f8fafc',
                  borderRadius: 8,
                  border: '1px solid #e4e6eb',
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: '#e7f5eb',
                    border: '1px solid #bbf7d0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 10px',
                    color: '#15803d',
                  }}
                >
                  <ShieldAlert size={20} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1c1e21', marginBottom: 2 }}>
                  All Clear in Radar
                </div>
                <div style={{ fontSize: 12, maxWidth: 260, margin: '0 auto' }}>
                  {searchQuery || filterType !== 'all'
                    ? 'No hotspots match your current search criteria.'
                    : 'No active waste hotspots detected within 5 km.'}
                </div>
              </div>
            ) : (
              <div className="ww-stagger">
                {filteredNearby.map(alert => (
                  <NearbyHotspotCard key={alert.id} alert={alert} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── INTERCONNECTED OVERLAY MODALS ── */}
      {activeOverlayModal === 'logs' && (
        <DriverCollectionLog
          isOverlay={true}
          open={true}
          onClose={() => setActiveOverlayModal(null)}
        />
      )}

      {activeOverlayModal === 'status' && (
        <DriverStatusPanel
          isOverlay={true}
          open={true}
          onClose={() => setActiveOverlayModal(null)}
        />
      )}
    </div>
  )

  // When rendered as an overlay modal
  if (isOverlay) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: 8,
            width: '100%',
            maxWidth: 1040,
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            border: '1px solid #e4e6eb',
          }}
        >
          {content}
        </div>
      </div>
    )
  }

  // When rendered as a standalone page (/driver/hotspots)
  return (
    <div
      style={{
        background: '#f0f2f5',
        minHeight: '100vh',
        padding: '20px 24px 80px',
      }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        {content}
      </div>
    </div>
  )
}
