/**
 * DriverHotspotAlert.jsx
 * -----------------------
 * Displays nearby garbage hotspot alerts relevant to the driver's
 * current GPS position and assigned route.
 *
 * Features:
 *  - Alert cards with severity, distance, barangay, description
 *  - "Mark Noted" / "Add to Route" per-card actions
 *  - Sort by proximity or severity
 *  - Empty state when no nearby alerts
 *
 * API endpoints:
 *   GET  /api/driver/hotspots/nearby/              → alert list
 *   POST /api/driver/hotspots/<id>/noted/          → mark noted
 *   POST /api/driver/hotspots/<id>/add-to-route/   → add to route
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import useGpsTracking from '../../hooks/useGpsTracking'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_ALERTS = [
  {
    id: 1,
    severity: 'high',
    barangay: 'Barangay Isabang',
    address: 'Near Isabang Market, Main St.',
    description: 'Overflowing bins — multiple bags on sidewalk, foul odor reported.',
    distanceKm: 0.3,
    reportedAt: '6:15 AM',
    type: 'overflow',
  },
  {
    id: 2,
    severity: 'medium',
    barangay: 'Barangay 12',
    address: 'Chapel Area, Brgy. 12',
    description: 'Illegal dumping spotted near the chapel entrance. Mostly plastic waste.',
    distanceKm: 0.8,
    reportedAt: '7:02 AM',
    type: 'illegal_dumping',
  },
  {
    id: 3,
    severity: 'high',
    barangay: 'Barangay 8',
    address: 'Side Street, Zone A',
    description: 'Accumulated waste for 2+ days — missed collection reported by residents.',
    distanceKm: 1.1,
    reportedAt: '5:48 AM',
    type: 'missed_collection',
  },
  {
    id: 4,
    severity: 'low',
    barangay: 'Barangay 11',
    address: 'Basketball Court, Brgy. 11',
    description: 'Small pile of biodegradable waste beside the court. Manageable.',
    distanceKm: 1.6,
    reportedAt: '8:30 AM',
    type: 'overflow',
  },
  {
    id: 5,
    severity: 'medium',
    barangay: 'Cotta District',
    address: 'Near Cotta Crossing',
    description: 'Construction debris mixed with household waste on roadside.',
    distanceKm: 2.2,
    reportedAt: '7:55 AM',
    type: 'illegal_dumping',
  },
]

// ─── SEVERITY CONFIG ──────────────────────────────────────────────────────────

const SEVERITY = {
  high: { label: 'HIGH', color: '#ef4444', bg: 'rgba(239,68,68,0.10)', icon: '🔴', rank: 1 },
  medium: { label: 'MEDIUM', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', icon: '🟡', rank: 2 },
  low: { label: 'LOW', color: '#2ecc71', bg: 'rgba(46,204,113,0.10)', icon: '🟢', rank: 3 },
}

const TYPE_LABELS = {
  overflow: 'Overflow',
  illegal_dumping: 'Illegal Dumping',
  missed_collection: 'Missed Collection',
}

// ─── SORT OPTIONS ─────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { key: 'proximity', label: 'By Proximity' },
  { key: 'severity', label: 'By Severity' },
]

// ─── ALERT CARD ───────────────────────────────────────────────────────────────

function AlertCard({ alert, onNoted, onAddToRoute }) {
  const sev = SEVERITY[alert.severity]
  const [noted, setNoted] = useState(false)
  const [added, setAdded] = useState(false)
  const [loading, setLoading] = useState(null)   // 'noted' | 'route' | null

  async function handleNoted() {
    setLoading('noted')
    try { await api.post(`/api/driver/hotspots/${alert.id}/noted/`) } catch { }
    setLoading(null)
    setNoted(true)
    onNoted?.(alert.id)
  }

  async function handleAddToRoute() {
    setLoading('route')
    try { await api.post(`/api/driver/hotspots/${alert.id}/add-to-route/`) } catch { }
    setLoading(null)
    setAdded(true)
    onAddToRoute?.(alert.id)
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1.5px solid ${noted ? 'var(--border)' : sev.color + '44'}`,
      borderRadius: 14,
      marginBottom: 12,
      overflow: 'hidden',
      opacity: noted ? 0.55 : 1,
      transition: 'opacity .3s',
    }}>
      {/* Severity header strip */}
      <div style={{
        background: sev.bg,
        borderBottom: `1px solid ${sev.color}22`,
        padding: '8px 14px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 13 }}>{sev.icon}</span>
        <span style={{
          fontSize: 10, fontWeight: 800, color: sev.color, letterSpacing: '.07em',
        }}>{sev.label} PRIORITY</span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 600,
          background: 'var(--bg)', border: '1px solid var(--border)',
          color: 'var(--text-muted)', borderRadius: 10, padding: '2px 8px',
        }}>
          {TYPE_LABELS[alert.type] || alert.type}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px' }}>
        {/* Location row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{alert.address}</div>
            <div className="text-muted text-xs">{alert.barangay}</div>
          </div>
          {/* Distance badge */}
          <div style={{
            flexShrink: 0, marginLeft: 10,
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '5px 10px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, color: sev.color }}>
              {alert.distanceKm.toFixed(1)}
            </div>
            <div className="form-label" style={{ marginBottom: 0 }}>KM</div>
          </div>
        </div>

        {/* Description */}
        <p style={{
          fontSize: 13, color: 'var(--text-muted)',
          lineHeight: 1.5, marginBottom: 12,
        }}>
          {alert.description}
        </p>

        {/* Reported time */}
        <div className="text-muted text-xs" style={{ marginBottom: 12 }}>
          🕐 Reported at {alert.reportedAt}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
          <button
            id={`hotspot-noted-${alert.id}`}
            onClick={handleNoted}
            disabled={noted || loading === 'noted'}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, cursor: noted ? 'default' : 'pointer',
              background: noted ? 'rgba(46,204,113,0.08)' : 'var(--bg)',
              border: `1px solid ${noted ? '#2ecc71' : 'var(--border)'}`,
              color: noted ? '#2ecc71' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 700, transition: 'all .15s',
            }}
          >
            {loading === 'noted' ? '…' : noted ? '✓ Noted' : 'Mark Noted'}
          </button>

          <button
            id={`hotspot-add-route-${alert.id}`}
            onClick={handleAddToRoute}
            disabled={added || loading === 'route'}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, cursor: added ? 'default' : 'pointer',
              background: added ? 'rgba(59,130,246,0.08)' : 'var(--bg)',
              border: `1px solid ${added ? '#3b82f6' : 'var(--border)'}`,
              color: added ? '#3b82f6' : 'var(--text)',
              fontSize: 12, fontWeight: 700, transition: 'all .15s',
            }}
          >
            {loading === 'route' ? '…' : added ? '✓ Added' : '+  Add to Route'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SORT TAB ─────────────────────────────────────────────────────────────────

function SortTab({ option, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
      fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#0d1117' : 'var(--text-muted)',
      transition: 'all .15s',
    }}>
      {option.label}
    </button>
  )
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '48px 20px' }}>
      <div style={{ fontSize: 52, marginBottom: 14 }}>🌿</div>
      <div style={{
        fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, marginBottom: 8,
      }}>
        All Clear!
      </div>
      <div className="text-muted text-sm" style={{ maxWidth: 260, margin: '0 auto' }}>
        No garbage hotspot alerts near your current location.
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DriverHotspotAlert() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [alerts, setAlerts] = useState(MOCK_ALERTS)
  const [sortBy, setSortBy] = useState('proximity')
  const [loading, setLoading] = useState(true)
  const [showNoted, setShowNoted] = useState(false)   // toggle to show/hide noted alerts

  // GPS for real distance calculation when backend is ready
  const { position: gpsPosition, isTracking } = useGpsTracking({ enabled: true })

  useEffect(() => {
    api.get('/api/driver/hotspots/nearby/')
      .then(res => { if (res.data) setAlerts(res.data) })
      .catch(() => { })
      .finally(() => setLoading(false))
  }, [])

  // Sorted + filtered list
  const displayedAlerts = useMemo(() => {
    const sorted = [...alerts].sort((a, b) => {
      if (sortBy === 'proximity') return a.distanceKm - b.distanceKm
      return SEVERITY[a.severity].rank - SEVERITY[b.severity].rank
    })
    return sorted
  }, [alerts, sortBy])

  // Counts
  const activeCount = displayedAlerts.length
  const highCount = alerts.filter(a => a.severity === 'high').length

  return (
    <>
      <style>{`
        @keyframes haFadeUp {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .ha-card { animation: haFadeUp .2s ease both; }
      `}</style>

      <div className="page" style={{ paddingBottom: 88 }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>

          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
              Hotspot Alerts
            </h1>
            <p className="text-muted text-xs" style={{ marginTop: 2 }}>
              {isTracking ? ' Using live location' : 'Near your route'}
            </p>
          </div>
          {/* High-priority badge */}
          {highCount > 0 && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: '5px 12px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, color: '#ef4444' }}>
                {highCount}
              </div>
              <div className="form-label" style={{ marginBottom: 0, color: '#ef4444' }}>HIGH</div>
            </div>
          )}
        </div>

        {/* ── SUMMARY BAR ── */}
        <div style={{
          display: 'flex', gap: 8, marginBottom: 16,
        }}>
          {Object.entries(SEVERITY).map(([key, cfg]) => {
            const count = alerts.filter(a => a.severity === key).length
            return (
              <div key={key} style={{
                flex: 1, background: cfg.bg,
                border: `1px solid ${cfg.color}33`,
                borderRadius: 10, padding: '8px 0', textAlign: 'center',
              }}>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 18, color: cfg.color }}>
                  {count}
                </div>
                <div className="form-label" style={{ marginBottom: 0 }}>{cfg.label}</div>
              </div>
            )
          })}
        </div>

        {/* ── SORT TABS ── */}
        <div style={{
          display: 'inline-flex', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 24, padding: 4, marginBottom: 16,
        }}>
          {SORT_OPTIONS.map(opt => (
            <SortTab key={opt.key} option={opt}
              active={sortBy === opt.key}
              onClick={() => setSortBy(opt.key)}
            />
          ))}
        </div>

        {/* ── ALERT LIST ── */}
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <div className="spinner" />
          </div>
        ) : displayedAlerts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="ha-card">
            {displayedAlerts.map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onNoted={id => {
                  // Keep in list but visually dim (handled inside card)
                }}
                onAddToRoute={id => {
                  // Could navigate to route overview or show toast
                }}
              />
            ))}
          </div>
        )}

      </div>
    </>
  )
}
