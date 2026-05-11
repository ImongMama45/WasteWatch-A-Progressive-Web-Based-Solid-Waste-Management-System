/**
 * RouteOverview.jsx — Driver Route Overview
 * ------------------------------------------
 * Shows:
 *  - Full Leaflet map with driver location, route path, and stop markers
 *  - Scrollable stop list below the map
 *  - Per-stop: status badge, distance, "Mark as Completed" button
 *  - Photo proof slot is scaffolded (see TODO comment) but NOT yet active
 *
 * Leaflet loaded via CDN (window.L) — same pattern as MiniMap.jsx
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import useGpsTracking from '../../hooks/useGpsTracking'
import Navbar from '../../components/Navbar'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const DRIVER_LOCATION = [13.9452, 121.6128]   // current driver lat/lng

const MOCK_ROUTE = {
  id: 1,
  name: 'Isabang–Brgy.12 Route',
  barangay: 'Barangay Isabang',
  truck: 'TRUCK WT-042',
  color: '#2ecc71',
}

const MOCK_STOPS = [
  {
    id: 1,
    order: 1,
    address: 'Barangay Hall, Brgy. 8',
    zone: 'Zone A',
    type: 'Mixed Waste',
    lat: 13.946,
    lng: 121.6085,
    status: 'completed',        // 'completed' | 'current' | 'pending'
    distance: null,
    completedAt: '6:42 AM',
    // photoProof: null          // TODO: attach photo proof URL here when feature is ready
  },
  {
    id: 2,
    order: 2,
    address: 'Public Market, Brgy. 9',
    zone: 'Zone A',
    type: 'Recyclable',
    lat: 13.9472,
    lng: 121.6102,
    status: 'completed',
    distance: null,
    completedAt: '7:05 AM',
    // photoProof: null
  },
  {
    id: 3,
    order: 3,
    address: 'Covered Court, Brgy. 10',
    zone: 'Zone B',
    type: 'Mixed Waste',
    lat: 13.9480,
    lng: 121.6120,
    status: 'completed',
    distance: null,
    completedAt: '7:28 AM',
    // photoProof: null
  },
  {
    id: 4,
    order: 4,
    address: 'Barangay Hall, Brgy. 11',
    zone: 'Zone B',
    type: 'Biodegradable',
    lat: 13.9488,
    lng: 121.6138,
    status: 'current',
    distance: '0.3 km',
    completedAt: null,
    // photoProof: null
  },
  {
    id: 5,
    order: 5,
    address: 'School Zone, Brgy. 12',
    zone: 'Zone C',
    type: 'Mixed Waste',
    lat: 13.9475,
    lng: 121.6155,
    status: 'pending',
    distance: '1.1 km',
    completedAt: null,
    // photoProof: null
  },
  {
    id: 6,
    order: 6,
    address: 'Chapel, Brgy. 13',
    zone: 'Zone C',
    type: 'Recyclable',
    lat: 13.9460,
    lng: 121.6160,
    status: 'pending',
    distance: '1.8 km',
    completedAt: null,
    // photoProof: null
  },
  {
    id: 7,
    order: 7,
    address: 'Sitio Bagong Silang',
    zone: 'Zone D',
    type: 'Biodegradable',
    lat: 13.9448,
    lng: 121.6145,
    status: 'pending',
    distance: '2.4 km',
    completedAt: null,
    // photoProof: null
  },
]

// Route polyline (driver path through all stops)
const ROUTE_PATH = MOCK_STOPS.map(s => [s.lat, s.lng])

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────

const STATUS = {
  completed: { label: 'Completed', color: '#2ecc71', bg: 'rgba(46,204,113,0.12)', icon: '✅' },
  current: { label: 'Current', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', icon: '📍' },
  pending: { label: 'Pending', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', icon: '⏳' },
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function makeStopIcon(L, stop) {
  const cfg = STATUS[stop.status]
  const size = stop.status === 'current' ? 38 : 28

  const html = `
    <div style="
      width:${size}px; height:${size}px; border-radius:50%;
      background:${cfg.color}; border: 3px solid #fff;
      display:flex; align-items:center; justify-content:center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      font-size:${stop.status === 'current' ? 16 : 12}px;
      ${stop.status === 'current' ? 'animation: roPulse 2s ease infinite;' : ''}
    ">
      ${stop.status === 'completed' ? '✓' : stop.order}
    </div>
  `
  return L.divIcon({
    html, className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function makeDriverIcon(L) {
  const html = `
    <div style="
      width:42px; height:42px; border-radius:50%;
      background:linear-gradient(135deg,#1e2633,#2d3748);
      border:3px solid #2ecc71;
      display:flex; align-items:center; justify-content:center;
      font-size:20px; box-shadow:0 3px 14px rgba(46,204,113,0.45);
    ">🚛</div>
  `
  return L.divIcon({ html, className: '', iconSize: [42, 42], iconAnchor: [21, 21] })
}

// ─── STOP CARD (read-only) ───────────────────────────────────────────────────

function StopCard({ stop, isNext, onFocus, focused }) {
  const cfg = STATUS[stop.status]

  return (
    <>
      <div
        id={`stop-card-${stop.id}`}
        onClick={() => onFocus(stop)}
        style={{
          background: focused ? 'rgba(59,130,246,0.06)' : 'var(--surface)',
          border: `1.5px solid ${focused ? '#3b82f6' : stop.status === 'current' ? '#2ecc71' : 'var(--border)'}`,
          borderRadius: 14, padding: '14px 16px', marginBottom: 10,
          cursor: 'pointer', transition: 'all .18s',
          boxShadow: focused ? '0 0 0 3px rgba(59,130,246,0.18)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>

          {/* Order bubble */}
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: cfg.bg, border: `1.5px solid ${cfg.color}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 14, color: cfg.color,
          }}>
            {stop.status === 'completed' ? '✓' : stop.order}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
              <span style={{
                fontWeight: 700, fontSize: 14,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {stop.address}
              </span>
              {isNext && (
                <span style={{
                  background: 'rgba(59,130,246,0.12)', color: '#3b82f6',
                  fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20,
                  letterSpacing: '.05em', flexShrink: 0,
                }}>NEXT</span>
              )}
            </div>

            {/* Meta row */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{
                background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}44`,
                fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20, letterSpacing: '.05em',
              }}>
                {cfg.label.toUpperCase()}
              </span>
              <span style={{ color: "#000000", marginLeft: "10px" }} className="text-muted text-xs">{stop.type}</span>
              <span style={{ color: "#5b5b5bff", marginLeft: "10px" }} className="text-muted text-xs">{stop.zone}</span>
              {stop.distance && (
                <span style={{ color: "#ffffffff", marginLeft: "10px", fontWeight: 600, padding: 5, paddingLeft: 10, paddingRight: 10, borderRadius: 10, backgroundColor: "#4c6dffff" }} className="text-muted text-xs">{stop.distance}</span>
              )}
              {stop.completedAt && (
                <span style={{ color: "#000000ff", marginLeft: "10px", fontWeight: 600, padding: 5, paddingLeft: 10, paddingRight: 10, borderRadius: 10, backgroundColor: "#00ff15ff" }} className="text-muted text-xs">{stop.completedAt}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function RouteOverview() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef({})
  const driverRef = useRef(null)

  const [leafletReady, setLeafletReady] = useState(false)
  const [stops, setStops] = useState(MOCK_STOPS)
  const [focusedId, setFocusedId] = useState(null)

  // ── Live GPS tracking ────────────────────────────────────────────────────────
  const { position: gpsPosition, accuracy: gpsAccuracy, error: gpsError, isTracking } =
    useGpsTracking({ intervalMs: 10_000, enabled: true })

  const completedCount = stops.filter(s => s.status === 'completed').length
  const totalCount = stops.length
  const progress = Math.round((completedCount / totalCount) * 100)
  const currentStop = stops.find(s => s.status === 'current')
  const nextStop = stops.find(s => s.status === 'pending')

  // ── Load Leaflet CDN ────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setLeafletReady(true)
    document.head.appendChild(script)
  }, [])

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return
    const L = window.L
    const map = L.map(mapRef.current, {
      center: DRIVER_LOCATION,
      zoom: 15,
      zoomControl: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapInstance.current = map
    drawMap(map)
  }, [leafletReady])

  // ── Draw markers + route ────────────────────────────────────────────────────
  function drawMap(map) {
    const L = window.L

    // Completed path (solid)
    const doneCoords = stops.filter(s => s.status === 'completed').map(s => [s.lat, s.lng])
    if (doneCoords.length > 1)
      L.polyline(doneCoords, { color: '#2ecc71', weight: 5, opacity: 0.9 }).addTo(map)

    // Remaining path (dashed)
    const remStart = currentStop ? [[currentStop.lat, currentStop.lng]] : []
    const remCoords = [...remStart, ...stops.filter(s => s.status === 'pending').map(s => [s.lat, s.lng])]
    if (remCoords.length > 1)
      L.polyline(remCoords, { color: '#2ecc71', weight: 4, opacity: 0.45, dashArray: '10,8' }).addTo(map)

    // Stop markers
    stops.forEach(stop => {
      const m = L.marker([stop.lat, stop.lng], { icon: makeStopIcon(L, stop) })
        .addTo(map)
        .on('click', () => focusStop(stop))
      markersRef.current[stop.id] = m
    })

    // Driver marker — starts at mock location, updated by GPS hook
    driverRef.current = L.marker(DRIVER_LOCATION, { icon: makeDriverIcon(L), zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup('<b>📍 Your Location</b>')
  }

  // ── Move driver marker whenever GPS position updates ─────────────────────────
  useEffect(() => {
    if (!gpsPosition || !driverRef.current || !mapInstance.current) return
    const { lat, lng } = gpsPosition
    driverRef.current.setLatLng([lat, lng])
    // Optionally keep map centred on driver while tracking
    // mapInstance.current.panTo([lat, lng])
  }, [gpsPosition])

  // ── Focus a stop on the map ─────────────────────────────────────────────────
  const focusStop = useCallback((stop) => {
    setFocusedId(stop.id)
    if (mapInstance.current) {
      mapInstance.current.flyTo([stop.lat, stop.lng], 16, { duration: 0.6 })
    }
    // Scroll the card into view
    const el = document.getElementById(`stop-card-${stop.id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // ── Mark stop as completed ──────────────────────────────────────────────────
  function handleMarkDone(stop) {
    // Optimistic update
    setStops(prev => {
      const idx = prev.findIndex(s => s.id === stop.id)
      const updated = [...prev]
      updated[idx] = {
        ...updated[idx],
        status: 'completed',
        completedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      }
      // Promote next pending → current
      const nextPending = updated.find(s => s.status === 'pending')
      if (nextPending) nextPending.status = 'current'
      return updated
    })

    // Refresh markers on map
    if (mapInstance.current && window.L) {
      const L = window.L
      stops.forEach(s => {
        const m = markersRef.current[s.id]
        if (m) m.setIcon(makeStopIcon(L, s))
      })
    }

    // TODO: api.post(`/api/driver/stops/${stop.id}/complete/`, { photoProof: null })
    api.post(`/api/driver/stops/${stop.id}/complete/`).catch(() => { })
  }

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <>

      <style>{`
        @keyframes roPulse {
          0%,100% { box-shadow: 0 2px 10px rgba(46,204,113,0.35); }
          50%      { box-shadow: 0 2px 22px rgba(46,204,113,0.75); }
        }
        @keyframes dd-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        .ro-stop-card:active { transform: scale(.99); }
        .ww-routemap .leaflet-pane,
        .ww-routemap .leaflet-control-container { z-index: 1 !important; }
        .ww-routemap .leaflet-top,
        .ww-routemap .leaflet-bottom { z-index: 2 !important; }
      `}</style>

      <div className="page" style={{ paddingBottom: 80 }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
              My Route
            </h1>
            <p className="text-muted text-xs" style={{ marginTop: 2 }}>
              {MOCK_ROUTE.name} · {MOCK_ROUTE.truck}
            </p>
          </div>
          <div style={{
            background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)',
            borderRadius: 10, padding: '6px 12px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, color: '#2ecc71' }}>
              {completedCount}/{totalCount}
            </div>
            <div className="form-label" style={{ marginBottom: 0 }}>STOPS</div>
          </div>
        </div>

        {/* ── GPS STATUS BANNER ── */}
        {gpsError && (
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>{gpsError}</span>
          </div>
        )}

        {isTracking && gpsAccuracy && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.25)',
            borderRadius: 20, padding: '4px 12px', marginBottom: 12,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#2ecc71',
              boxShadow: '0 0 6px #2ecc71', display: 'inline-block',
              animation: 'dd-pulse 2s ease infinite',
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#2ecc71' }}>GPS ACTIVE</span>
            <span className="text-muted text-xs">±{gpsAccuracy}m</span>
          </div>
        )}

        {/* ── PROGRESS BAR ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span className="text-muted text-xs">Route Progress</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#2ecc71' }}>{progress}%</span>
          </div>
          <div style={{ background: 'var(--bg)', borderRadius: 99, height: 7, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              background: 'linear-gradient(90deg,#2ecc71,#27ae60)',
              width: `${progress}%`, transition: 'width .5s ease',
            }} />
          </div>
        </div>

        {/* ── MAP ── */}
        <div className="ww-routemap" style={{
          borderRadius: 16, overflow: 'hidden',
          border: '1px solid var(--border)',
          marginBottom: 16, position: 'relative',
        }}>
          <div ref={mapRef} style={{ width: '100%', height: 300, background: '#0f172a' }} />

          {!leafletReady && (
            <div style={{
              position: 'absolute', inset: 0, background: '#0f172a',
              display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16,
            }}>
              <div className="spinner" />
            </div>
          )}

          {/* Map overlay: current stop pill */}
          {currentStop && (
            <div style={{
              position: 'absolute', bottom: 10, left: 10, right: 10, zIndex: 400,
              background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(8px)',
              borderRadius: 10, padding: '8px 12px',
              border: '1px solid rgba(46,204,113,0.3)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#2ecc71', boxShadow: '0 0 8px #2ecc71', flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>
                  {currentStop.address}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 10 }}>
                  {currentStop.type} · {currentStop.distance}
                </div>
              </div>
              <button
                onClick={() => focusStop(currentStop)}
                style={{
                  background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.4)',
                  color: '#2ecc71', borderRadius: 8, padding: '4px 10px',
                  fontSize: 10, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                }}
              >
                Focus
              </button>
            </div>
          )}
        </div>

        {/* ── NEXT STOP BANNER (shown if current stop exists) ── */}
        {nextStop && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '12px 16px', marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(148,163,184,0.1)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>⏭</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="form-label">NEXT STOP</div>
              <div style={{
                fontWeight: 700, fontSize: 14,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {nextStop.address}
              </div>
              <div className="text-muted text-xs">{nextStop.type} · {nextStop.distance}</div>
            </div>
            <button onClick={() => focusStop(nextStop)} style={{
              background: 'none', border: 'none', color: 'var(--accent)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}>Map ›</button>
          </div>
        )}

        {/* ── STOP LIST ── */}
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 className="section-title" style={{ margin: 0, fontSize: 16 }}>All Stops</h2>
          <span className="text-muted text-xs">{totalCount - completedCount} remaining</span>
        </div>

        <div>
          {stops.map((stop, idx) => {
            const prevStop = stops[idx - 1]
            const isNext = prevStop?.status === 'current' && stop.status === 'pending'
            return (
              <StopCard
                key={stop.id}
                stop={stop}
                isNext={isNext}
                focused={focusedId === stop.id}
                onFocus={focusStop}
                onMarkDone={handleMarkDone}
              />
            )
          })}
        </div>

      </div>
    </>
  )
}
