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
import { buildStopValidationSnapshot, normalizeStopStatus } from '../../utils/pickupStatusSync'


// ─── ROUTE HELPERS ────────────────────────────────────────────────────────────

function decodePolyline(encoded) {
  let pts = [], i = 0, lat = 0, lng = 0
  while (i < encoded.length) {
    let b, s = 0, r = 0
    do { b = encoded.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5 } while (b >= 0x20)
    lat += (r & 1) ? ~(r >> 1) : r >> 1; s = 0; r = 0
    do { b = encoded.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5 } while (b >= 0x20)
    lng += (r & 1) ? ~(r >> 1) : r >> 1
    pts.push([lat / 1e5, lng / 1e5])
  }
  return pts
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Backend normalised status → the three UI buckets used by StopCard / STATUS
function mapBackendStatus(normalizedStatus, isCurrentStop) {
  if (['VERIFIED_COLLECTED', 'COLLECTION_REPORTED', 'EMPTY_STOP'].includes(normalizedStatus))
    return 'completed'
  if (isCurrentStop) return 'current'
  return 'pending'
}

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

function StopCard({ stop, isNext, onFocus, focused, gpsPosition }) {
  const cfg = STATUS[stop.status]

  const distance = (() => {
    if (stop.status === 'completed') return null
    if (gpsPosition) {
      const d = haversineDistance(gpsPosition.lat, gpsPosition.lng, stop.lat, stop.lng)
      return d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`
    }
    return stop.distance || null
  })()

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
              {distance && (
                <span style={{ color: "#ffffffff", marginLeft: "10px", fontWeight: 600, padding: 5, paddingLeft: 10, paddingRight: 10, borderRadius: 10, backgroundColor: "#4c6dffff" }} className="text-muted text-xs">{distance}</span>
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
  const [schedule, setSchedule] = useState(null)
  const [profile, setProfile] = useState(null)
  const [stops, setStops] = useState([])
  const [mapLoading, setMapLoading] = useState(true)
  const [focusedId, setFocusedId] = useState(null)

  // ── Live GPS tracking ────────────────────────────────────────────────────────
  const { position: gpsPosition, accuracy: gpsAccuracy, error: gpsError, isTracking } =
    useGpsTracking({ intervalMs: 10_000, enabled: true })

  const completedCount = stops.filter(s => s.status === 'completed').length
  const totalCount = stops.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const currentStop = stops.find(s => s.status === 'current')
  const nextStop = stops.find(s => s.status === 'pending')

  // ── 1. Fetch driver profile ──────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/driver/shift/profile/')
      .then(res => setProfile(res.data))
      .catch(() => { })
  }, [])

  // ── 2. Fetch schedule + stop validations → build real stops list ─────────────
  useEffect(() => {
    if (!user?.id) return
    setMapLoading(true)
    api.get('/api/driver/collection-schedules/')
      .then(async res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        setSchedule(match || null)
        if (!match) return

        const [currentRes, valRes] = await Promise.all([
          api.get('/api/driver/stops/current/').catch(() => ({ data: null })),
          api.get(`/api/watcher/stop-validations/?schedule_id=${encodeURIComponent(match.id)}`).catch(() => ({ data: null })),
        ])
        const currentStopOrder = Number(currentRes.data?.order) || null
        const rows = valRes.data?.results ?? valRes.data ?? []
        const snapshot = buildStopValidationSnapshot(rows)

        const builtStops = (match.waypoints || []).slice(1).map((wp, i) => {
          const wpIndex = i + 1
          const key = `${match.id}:${wpIndex}`
          const rawStatus = snapshot.statusMap.get(key) || 'PENDING_INSPECTION'
          const normalized = normalizeStopStatus(rawStatus)
          const isCurrentStop = wpIndex === currentStopOrder
          const details = snapshot.detailsMap.get(key)
          return {
            id: wpIndex,
            order: wpIndex,
            address: wp.label || wp.name || `Stop ${wpIndex}`,
            zone: wp.barangay || match.barangay_names || '',
            type: 'Waste Collection',
            lat: Number(wp.lat),
            lng: Number(wp.lng),
            status: mapBackendStatus(normalized, isCurrentStop),
            distance: null,          // computed live in StopCard via gpsPosition prop
            completedAt: details?.collectedAt || null,
          }
        })
        setStops(builtStops)
      })
      .catch(() => setSchedule(null))
      .finally(() => setMapLoading(false))
  }, [user?.id])

  // ── 3. Load Leaflet CDN ──────────────────────────────────────────────────────
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

  // ── 4. Init map once (no drawMap call here) ──────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: [13.9373, 121.617], zoom: 15, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapInstance.current = map
  }, [leafletReady])

  // ── 5. Redraw whenever stops change (after fetch or optimistic update) ────────
  useEffect(() => {
    if (!mapInstance.current || !window.L || !stops.length) return
    drawMap(mapInstance.current, stops)
  }, [stops]) // eslint-disable-line

  // ── Draw markers + ORS road-snapped route ────────────────────────────────────
  function drawMap(map, stopsData) {
    const L = window.L

    // Clear previous markers before redraw
    Object.values(markersRef.current).forEach(m => { try { map.removeLayer(m) } catch { } })
    markersRef.current = {}
    if (driverRef.current) { try { map.removeLayer(driverRef.current) } catch { }; driverRef.current = null }

    if (!stopsData.length) return

    // Stop markers
    stopsData.forEach(stop => {
      const m = L.marker([stop.lat, stop.lng], { icon: makeStopIcon(L, stop) })
        .addTo(map)
        .on('click', () => focusStop(stop))
      markersRef.current[stop.id] = m
    })

    // Driver marker — real GPS if available, else first stop coords
    const driverStart = gpsPosition
      ? [gpsPosition.lat, gpsPosition.lng]
      : [stopsData[0].lat, stopsData[0].lng]
    driverRef.current = L.marker(driverStart, { icon: makeDriverIcon(L), zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup('<b>📍 Your Location</b>')

    // Completed path — solid, straight line (already driven, accuracy fine)
    const doneCoords = stopsData.filter(s => s.status === 'completed').map(s => [s.lat, s.lng])
    if (doneCoords.length > 1)
      L.polyline(doneCoords, { color: '#2ecc71', weight: 5, opacity: 0.9 }).addTo(map)

    // Remaining path — faint fallback first, then swap with ORS road-snapped route
    const curStop = stopsData.find(s => s.status === 'current')
    const remCoords = [
      ...(curStop ? [[curStop.lat, curStop.lng]] : []),
      ...stopsData.filter(s => s.status === 'pending').map(s => [s.lat, s.lng]),
    ]

    let fallbackLine = null
    if (remCoords.length > 1) {
      fallbackLine = L.polyline(remCoords, {
        color: '#2ecc71', weight: 3, opacity: 0.35, dashArray: '6, 6',
      }).addTo(map)
    }

    // Fit to all stops
    map.fitBounds(L.latLngBounds(stopsData.map(s => [s.lat, s.lng])), { padding: [40, 40] })

    // ORS road-snapped route for remaining stops
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey || remCoords.length < 2) return

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: orsApiKey,
      },
      body: JSON.stringify({ coordinates: remCoords.slice(0, 50).map(([lat, lng]) => [lng, lat]) }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length || !mapInstance.current) return
        if (fallbackLine) map.removeLayer(fallbackLine)
        const pts = decodePolyline(data.routes[0].geometry)
        L.polyline(pts, { color: '#2ecc71', weight: 5, opacity: 0.85 }).addTo(map)
      })
      .catch(() => { /* fallbackLine stays visible */ })
  }

  // ── 6. Move driver marker on GPS update ──────────────────────────────────────
  useEffect(() => {
    if (!gpsPosition || !driverRef.current) return
    driverRef.current.setLatLng([gpsPosition.lat, gpsPosition.lng])
  }, [gpsPosition])

  // ── 7. Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
    }
  }, [])

  // ── Focus a stop on the map ──────────────────────────────────────────────────
  const focusStop = useCallback((stop) => {
    setFocusedId(stop.id)
    if (mapInstance.current) mapInstance.current.flyTo([stop.lat, stop.lng], 16, { duration: 0.6 })
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
              {schedule?.barangay_names || (mapLoading ? 'Loading route…' : 'No route assigned')}
              {profile?.truck ? ` · ${profile.truck}` : profile?.plateNumber ? ` · ${profile.plateNumber}` : ''}
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
                  {currentStop.type}{gpsPosition
                    ? ` · ${(() => { const d = haversineDistance(gpsPosition.lat, gpsPosition.lng, currentStop.lat, currentStop.lng); return d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m` })()}`
                    : currentStop.distance ? ` · ${currentStop.distance}` : ''}
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
                gpsPosition={gpsPosition}
              />
            )
          })}
        </div>

      </div>
    </>
  )
}
