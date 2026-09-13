/**
 * DriverHotspotAlert.jsx
 * -----------------------
 * Driver-facing hotspot view.
 *
 * Two sections:
 *  1. "Assigned to Your Truck"  — hotspots the admin dispatched to this truck
 *     via HotspotDetection > Assign Truck.  Driver must collect these.
 *  2. "Nearby Hotspots"         — situational awareness only (read-only).
 *     No "Add to Route" — that is an admin/RouteBuilder concern.
 *
 * API:
 *   GET /api/watcher/hotspots/assigned/  → hotspots for this driver's truck
 *   GET /api/watcher/hotspots/nearby/?lat=&lng=  → proximity list
 *   POST /api/watcher/hotspots/<id>/noted/ → acknowledge
 */

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import useGpsTracking from '../../hooks/useGpsTracking'

// ─── SEVERITY CONFIG ──────────────────────────────────────────────────────────

const SEVERITY = {
  high:   { label: 'HIGH',   color: '#ef4444', bg: 'rgba(239,68,68,0.10)',   icon: '🔴', rank: 1 },
  medium: { label: 'MEDIUM', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', icon: '🟡', rank: 2 },
  low:    { label: 'LOW',    color: '#2ecc71', bg: 'rgba(46,204,113,0.10)', icon: '🟢', rank: 3 },
}

const TYPE_LABELS = {
  overflow:          'Overflow',
  illegal_dumping:   'Illegal Dumping',
  missed_collection: 'Missed Collection',
}

// ─── SORT OPTIONS ─────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { key: 'proximity', label: 'By Proximity' },
  { key: 'severity',  label: 'By Severity'  },
]

// ─── ASSIGNED CARD ────────────────────────────────────────────────────────────

function AssignedCard({ alert, onNoted }) {
  const sev = SEVERITY[alert.severity] || SEVERITY.medium
  const [noted, setNoted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleNoted() {
    setLoading(true)
    try { await api.post(`/api/watcher/hotspots/${alert.id}/noted/`) } catch {}
    setLoading(false)
    setNoted(true)
    onNoted?.(alert.id)
  }

  return (
    <div style={{
      background: noted ? 'var(--surface)' : `${sev.bg}`,
      border: `2px solid ${noted ? 'var(--border)' : sev.color + '66'}`,
      borderRadius: 14,
      marginBottom: 12,
      overflow: 'hidden',
      opacity: noted ? 0.6 : 1,
      transition: 'opacity .3s',
    }}>
      {/* Priority strip */}
      <div style={{
        background: noted ? 'var(--surface-2)' : sev.bg,
        borderBottom: `1px solid ${sev.color}33`,
        padding: '8px 14px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 13 }}>{sev.icon}</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: sev.color, letterSpacing: '.07em' }}>
          {sev.label} PRIORITY
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 700,
          background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
          color: '#3b82f6', borderRadius: 10, padding: '2px 8px',
        }}>
          🚛 {alert.assigned_truck_plate || 'Your Truck'}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{alert.address}</div>
            <div className='text-muted text-xs'>{alert.barangay}</div>
          </div>
          <span style={{
            flexShrink: 0, marginLeft: 10, fontSize: 10, fontWeight: 700,
            background: 'var(--bg)', border: '1px solid var(--border)',
            color: sev.color, borderRadius: 8, padding: '4px 9px',
          }}>
            {TYPE_LABELS[alert.type] || alert.type}
          </span>
        </div>

        {alert.description ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
            {alert.description}
          </p>
        ) : null}

        <div className='text-muted text-xs' style={{ marginBottom: 12 }}>
          🕐 Reported at {alert.reportedAt}
        </div>

        <button
          id={`hotspot-noted-${alert.id}`}
          onClick={handleNoted}
          disabled={noted || loading}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 10,
            cursor: noted ? 'default' : 'pointer',
            background: noted ? 'rgba(46,204,113,0.08)' : 'var(--bg)',
            border: `1px solid ${noted ? '#2ecc71' : 'var(--border)'}`,
            color: noted ? '#2ecc71' : 'var(--text-muted)',
            fontSize: 12, fontWeight: 700, transition: 'all .15s',
          }}
        >
          {loading ? '…' : noted ? '✓ Acknowledged' : 'Mark as Acknowledged'}
        </button>
      </div>
    </div>
  )
}

// ─── NEARBY CARD (read-only) ──────────────────────────────────────────────────

function NearbyCard({ alert }) {
  const sev = SEVERITY[alert.severity] || SEVERITY.medium
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1.5px solid ${sev.color}33`,
      borderRadius: 12,
      marginBottom: 10,
      overflow: 'hidden',
    }}>
      {/* Strip */}
      <div style={{
        background: sev.bg,
        borderBottom: `1px solid ${sev.color}22`,
        padding: '6px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 11 }}>{sev.icon}</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: sev.color, letterSpacing: '.06em' }}>
          {sev.label}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 600,
          color: 'var(--text-muted)', background: 'var(--bg)',
          border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px',
        }}>
          {TYPE_LABELS[alert.type] || alert.type}
        </span>
      </div>

      <div style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{alert.address}</div>
            <div className='text-muted text-xs'>{alert.barangay}</div>
          </div>
          {alert.distanceKm != null && (
            <div style={{
              flexShrink: 0, marginLeft: 10,
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '4px 8px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 13, color: sev.color }}>
                {Number(alert.distanceKm).toFixed(1)}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>KM</div>
            </div>
          )}
        </div>
        <div className='text-muted text-xs' style={{ marginTop: 6 }}>
          🕐 {alert.reportedAt}
          {alert.assigned_truck_plate && (
            <span style={{ marginLeft: 8, color: '#3b82f6', fontWeight: 700 }}>
              · 🚛 {alert.assigned_truck_plate}
            </span>
          )}
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

function EmptyNearby() {
  return (
    <div style={{ textAlign: 'center', padding: '32px 16px' }}>
      <div style={{ fontSize: 42, marginBottom: 10 }}>🌿</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>All Clear Nearby</div>
      <div className='text-muted text-sm'>No hotspots within 5 km of your current location.</div>
    </div>
  )
}

function EmptyAssigned() {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12,
      background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.2)',
      display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
    }}>
      <span style={{ fontSize: 24 }}>✅</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#2ecc71' }}>No assigned hotspots</div>
        <div className='text-muted text-xs'>The admin has not dispatched any hotspot to your truck yet.</div>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DriverHotspotAlert() {
  const { user } = useAuth()

  const [assigned, setAssigned]     = useState([])
  const [nearby, setNearby]         = useState([])
  const [sortBy, setSortBy]         = useState('proximity')
  const [loading, setLoading]       = useState(true)
  const [assignedLoading, setAssignedLoading] = useState(true)

  const { position: gpsPosition, isTracking } = useGpsTracking({ enabled: true })

  // Fetch assigned hotspots (for this driver's truck)
  useEffect(() => {
    setAssignedLoading(true)
    api.get('/api/watcher/hotspots/assigned/')
      .then(res => { if (Array.isArray(res.data)) setAssigned(res.data) })
      .catch(() => {})
      .finally(() => setAssignedLoading(false))
  }, [])

  // Fetch nearby hotspots
  useEffect(() => {
    const params = gpsPosition ? `?lat=${gpsPosition.lat}&lng=${gpsPosition.lng}` : ''
    setLoading(true)
    api.get(`/api/watcher/hotspots/nearby/${params}`)
      .then(res => { if (Array.isArray(res.data)) setNearby(res.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [gpsPosition?.lat, gpsPosition?.lng])

  // Sorted nearby (exclude already-assigned to avoid duplicates)
  const assignedIds = useMemo(() => new Set(assigned.map(a => a.id)), [assigned])

  const sortedNearby = useMemo(() => {
    return [...nearby]
      .filter(h => !assignedIds.has(h.id))
      .sort((a, b) => {
        if (sortBy === 'proximity') return (a.distanceKm ?? 99) - (b.distanceKm ?? 99)
        return (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9)
      })
  }, [nearby, sortBy, assignedIds])

  const highCount = [...assigned, ...nearby].filter(a => a.severity === 'high').length

  return (
    <>
      <style>{`
        @keyframes haFadeUp {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .ha-section { animation: haFadeUp .2s ease both; }
      `}</style>

      <div className='page' style={{ paddingBottom: 88 }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
              Hotspot Alerts
            </h1>
            <p className='text-muted text-xs' style={{ marginTop: 2 }}>
              {isTracking ? 'Using live location' : 'Near your route'}
            </p>
          </div>
          {highCount > 0 && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: '5px 12px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, color: '#ef4444' }}>
                {highCount}
              </div>
              <div className='form-label' style={{ marginBottom: 0, color: '#ef4444' }}>HIGH</div>
            </div>
          )}
        </div>

        {/* ── SECTION 1: ASSIGNED TO YOUR TRUCK ── */}
        <div className='ha-section'>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            paddingBottom: 8, borderBottom: '1.5px solid var(--border)',
          }}>
            <span style={{ fontSize: 16 }}>🚛</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Assigned to Your Truck</div>
              <div className='text-muted text-xs'>Hotspots dispatched by admin for your collection</div>
            </div>
            {assigned.length > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 800, color: '#3b82f6',
                background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 20, padding: '3px 10px',
              }}>{assigned.length}</span>
            )}
          </div>

          {assignedLoading ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div className='spinner' />
            </div>
          ) : assigned.length === 0 ? (
            <EmptyAssigned />
          ) : (
            assigned.map(alert => (
              <AssignedCard
                key={alert.id}
                alert={alert}
                onNoted={id => setAssigned(prev => prev.filter(a => a.id !== id))}
              />
            ))
          )}
        </div>

        {/* ── SECTION 2: NEARBY ── */}
        <div className='ha-section' style={{ marginTop: 6 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            paddingBottom: 8, borderBottom: '1.5px solid var(--border)',
          }}>
            <span style={{ fontSize: 16 }}>📍</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>Nearby Hotspots</div>
              <div className='text-muted text-xs'>Situational awareness — within 5 km</div>
            </div>
            {/* Sort tabs */}
            <div style={{
              display: 'inline-flex', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 24, padding: 3,
            }}>
              {SORT_OPTIONS.map(opt => (
                <SortTab key={opt.key} option={opt}
                  active={sortBy === opt.key}
                  onClick={() => setSortBy(opt.key)}
                />
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '28px 0' }}>
              <div className='spinner' />
            </div>
          ) : sortedNearby.length === 0 ? (
            <EmptyNearby />
          ) : (
            sortedNearby.map(alert => (
              <NearbyCard key={alert.id} alert={alert} />
            ))
          )}
        </div>

      </div>
    </>
  )
}
