/**
 * NavigationModule.jsx
 * ---------------------
 * Module 4 — Core driver UI during active route execution.
 * Powered by Leaflet + OpenRouteService (ORS).
 * Matches reference image: Grab/delivery driver-style operational screen.
 *
 * 
 * Sections:
 *  ① Stop info header (dark card — dump site + route info)
 *  ② Leaflet Map area with turn-by-turn direction overlay (from ORS)
 *  ③ Stats bar — arrival, ETA mins, distance, total km
 *  ④ Action — "On the way…" status + "Arrived" CTA
 *
 * Props:
 *  - setRouteState: fn → call setRouteState("arrived") on arrival
 */

import { useState, useEffect, useRef } from 'react'
import useShiftTimer from '../../../hooks/useShiftTimer'
import useGpsTracking from '../../../hooks/useGpsTracking'
import Navbar from '../../../components/Navbar'
import api from '../../../api/client'
import { useAuth } from '../../../context/AuthContext'

// ─── GPS STATUS PILL ─────────────────────────────────────────────────────────

function GpsStatusPill({ isTracking, error, accuracy }) {
  const isPoor = accuracy !== null && accuracy !== undefined && accuracy >= 50
  const label = error
    ? 'GPS Lost'
    : !isTracking
      ? 'GPS…'
      : accuracy !== null && accuracy !== undefined
        ? `GPS ±${Math.round(accuracy)}m`
        : 'GPS Active'
  const color = error ? '#ef4444' : isPoor ? '#f59e0b' : isTracking ? '#2ecc71' : '#f59e0b'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: `${color}18`, border: `1px solid ${color}44`,
      borderRadius: 20, padding: '3px 10px',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        animation: isTracking && !error ? 'navPulse 2s ease infinite' : 'none',
        display: 'inline-block',
      }} />
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '.04em' }}>
        {label}
      </span>
    </div>
  )
}

// ─── CONNECTIVITY PILL ────────────────────────────────────────────────────────

function ConnPill() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: online ? 'rgba(46,204,113,0.1)' : 'rgba(239,68,68,0.1)',
      border: `1px solid ${online ? '#2ecc7144' : '#ef444444'}`,
      borderRadius: 20, padding: '3px 10px',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: online ? '#2ecc71' : '#ef4444', letterSpacing: '.04em' }}>
        {online ? '● Online' : '○ Offline'}
      </span>
    </div>
  )
}

// ─── STAT CELL ────────────────────────────────────────────────────────────────

function StatCell({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>
        {label}
      </div>
    </div>
  )
}

// ─── GPS GEOFENCE UTILS ───────────────────────────────────────────────────────

const ARRIVAL_RADIUS_M = 100 // meters

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ORS Helper to decode polyline
function decodePolyline(encoded) {
  let points = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;
  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charAt(index++).charCodeAt(0) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlat = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charAt(index++).charCodeAt(0) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlng = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    points.push([lat / 1E5, lng / 1E5]);
  }
  return points;
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function NavigationModule({ setRouteState }) {
  const { user } = useAuth()
  const { formattedTime, shiftActive } = useShiftTimer()
  const { position: realGpsPos, accuracy: gpsAccuracy, isTracking, error: gpsError } = useGpsTracking({ enabled: shiftActive, intervalMs: 5000 })
  const isExtendedMode = sessionStorage.getItem('ww_extended_mode') === 'true'

  // Developer Mock GPS — mockGps bypasses real GPS (accuracy check also bypassed for dev)
  const [mockGps, setMockGps] = useState(null)
  const gpsPos = mockGps || realGpsPos
  const isMockActive = mockGps !== null

  // Map and Route State
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const driverMarker = useRef(null)
  const routeLayer = useRef(null)
  const [leafletReady, setLeafletReady] = useState(false)
  const [schedule, setSchedule] = useState(null)
  const [mapLoading, setMapLoading] = useState(true)

  // Navigation State
  const [currentStopIndex, setCurrentStopIndex] = useState(() => {
    const saved = sessionStorage.getItem('ww_current_stop_index')
    return saved ? parseInt(saved, 10) : 1
  })
  const [orsData, setOrsData] = useState(null)
  const [totalKmTravelled, setTotalKmTravelled] = useState(0) // Mocked or calculated

  // Extract variables
  const waypoints = schedule?.waypoints || []
  const currentTarget = waypoints[currentStopIndex] || null

  const destLat = currentTarget?.lat
  const destLng = currentTarget?.lng

  // Haversine distance to next stop
  const distanceToStop = gpsPos && destLat && destLng
    ? haversineDistance(gpsPos.lat, gpsPos.lng, destLat, destLng)
    : null

  const GPS_ACCURACY_THRESHOLD = 50 // metres — arrivals require accuracy better than this

  // Arrived if within radius.
  // Mock GPS (dev button) still bypasses accuracy checks for status logic only.
  const hasGoodAccuracy = isMockActive || gpsAccuracy == null || gpsAccuracy <= GPS_ACCURACY_THRESHOLD
  const isNearDestination = distanceToStop !== null && distanceToStop <= ARRIVAL_RADIUS_M

  // 1. Load Leaflet CDN
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

  // 2. Fetch driver's schedule
  useEffect(() => {
    if (!user?.id) return
    setMapLoading(true)
    api.get('/api/driver/collection-schedules/')
      .then(res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        setSchedule(match || null)

        // Start at index 1 because index 0 is typically the base/start point
        const savedIndex = sessionStorage.getItem('ww_current_stop_index')
        if (savedIndex) {
          setCurrentStopIndex(parseInt(savedIndex, 10))
        } else if (match?.waypoints?.length > 1) {
          setCurrentStopIndex(1)
          sessionStorage.setItem('ww_current_stop_index', '1')
        }
      })
      .catch(() => setSchedule(null))
      .finally(() => setMapLoading(false))
  }, [user?.id])

  // 3. Draw Leaflet map & Driver Marker
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current || mapLoading) return
    const L = window.L
    const map = L.map(mapRef.current, { center: [13.9373, 121.617], zoom: 15, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    mapInstance.current = map

    // Driver Marker
    const driverIcon = L.divIcon({
      html: `<div style="background:#2563eb;border:3px solid white;border-radius:50%;width:18px;height:18px;box-shadow:0 0 10px rgba(37,99,235,0.6);"></div>`,
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
    })

    // Initial marker at Lucena if no GPS
    driverMarker.current = L.marker([gpsPos?.lat || 13.9373, gpsPos?.lng || 121.617], { icon: driverIcon, zIndexOffset: 1000 }).addTo(map)

    // Add Stop markers
    if (waypoints.length > 0) {
      waypoints.slice(1).forEach((wp, i) => {
        const stopIcon = L.divIcon({
          html: `<div style="background:#f59e0b;border:2px solid white;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,.4);">${i + 1}</div>`,
          className: '', iconSize: [22, 22], iconAnchor: [11, 11],
        })
        L.marker([wp.lat, wp.lng], { icon: stopIcon }).addTo(map).bindPopup(`<b>${wp.label || `Stop ${i + 1}`}</b>`)
      })
    }
  }, [leafletReady, schedule, mapLoading])

  // 4. Fetch ORS Directions
  useEffect(() => {
    // Only fetch if we have a valid end (currentTarget)
    if (!currentTarget) return

    const startLng = gpsPos ? gpsPos.lng : (waypoints[0]?.lng || 121.617)
    const startLat = gpsPos ? gpsPos.lat : (waypoints[0]?.lat || 13.9373)

    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) {
      console.warn("VITE_ORS_API_KEY is missing. Using straight line fallback.")
      return
    }

    // ORS uses [lng, lat] format. Include up to 40 remaining stops to stay under ORS limits.
    const remainingStops = waypoints.slice(currentStopIndex, currentStopIndex + 40).map(wp => [wp.lng, wp.lat])
    const coordinates = [
      [startLng, startLat],
      ...remainingStops
    ]

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
        'Content-Type': 'application/json',
        'Authorization': orsApiKey
      },
      body: JSON.stringify({
        coordinates: coordinates,
        instructions: true,
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.routes && data.routes.length > 0) {
          setOrsData(data.routes[0])

          // Draw the route on the map
          if (mapInstance.current && window.L) {
            const L = window.L
            if (routeLayer.current) {
              mapInstance.current.removeLayer(routeLayer.current)
            }
            const decoded = decodePolyline(data.routes[0].geometry)
            routeLayer.current = L.polyline(decoded, { color: '#3b82f6', weight: 6, opacity: 0.8 }).addTo(mapInstance.current)

            // Optionally fit bounds, but might be jarring while driving.
            // mapInstance.current.fitBounds(routeLayer.current.getBounds(), { padding: [30,30] })
          }
        }
      })
      .catch(console.error)
  }, [gpsPos?.lat, gpsPos?.lng, currentTarget])

  // Update Driver Marker Position & Pan Map
  useEffect(() => {
    if (gpsPos && driverMarker.current && mapInstance.current) {
      driverMarker.current.setLatLng([gpsPos.lat, gpsPos.lng])
      // Smooth pan to driver
      mapInstance.current.panTo([gpsPos.lat, gpsPos.lng])
    }
  }, [gpsPos])

  // Cleanup map
  useEffect(() => {
    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
    }
  }, [])

  // Handle Stop Arrival
  const handleArrived = () => {
    if (currentTarget) {
      sessionStorage.setItem('ww_current_stop', currentTarget.name || `Stop ${currentStopIndex}`)
    }
    sessionStorage.setItem('ww_route_state', 'arrived')
    setRouteState('arrived')
  }

  // Current Instruction
  let instructionText = 'Follow the road'
  let instructionDistance = ''
  let etaMinutes = '--'
  let arrivalTimeStr = '--:--'
  let distanceKmStr = '--'

  if (orsData) {
    const segmentToNextStop = orsData.segments[0]
    if (segmentToNextStop && segmentToNextStop.steps && segmentToNextStop.steps.length > 0) {
      const currentStep = segmentToNextStop.steps[0] // Simplify: just show the first upcoming step
      instructionText = currentStep.instruction
      instructionDistance = Math.round(currentStep.distance) + 'm'
    }

    // Summary info (ETA/distance to NEXT STOP, not the whole route)
    if (segmentToNextStop) {
      const durationSec = segmentToNextStop.duration
      etaMinutes = Math.ceil(durationSec / 60)

      const arrTime = new Date(Date.now() + durationSec * 1000)
      arrivalTimeStr = arrTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

      distanceKmStr = (segmentToNextStop.distance / 1000).toFixed(1)
    }
  }

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes navPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes navFadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-body)', overflow: 'hidden', position: 'relative'
      }}>

        {/* ── ② MAP AREA (Background) ── */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#2a3441' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {/* Location re-center button */}
          {/* Dev Mock GPS Buttons — DEV only */}
          {import.meta.env.DEV && (
            <div style={{
              position: 'absolute', top: '50%', right: 14, marginTop: 54,
              zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {/* Teleport to Current Stop */}
              <button
                onClick={() => {
                  if (!currentTarget) return
                  setMockGps({ lat: Number(currentTarget.lat), lng: Number(currentTarget.lng) })
                  if (mapInstance.current) {
                    mapInstance.current.panTo([Number(currentTarget.lat), Number(currentTarget.lng)])
                  }
                }}
                title="Teleport to Current Stop"
                style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: '#f59e0b', border: '2px solid #fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: 20,
                }}
              >
                📍
              </button>

              {/* Teleport to Next Stop */}
              <button
                onClick={() => {
                  const nextStop = waypoints[currentStopIndex + 1]
                  if (!nextStop) return
                  setMockGps({ lat: Number(nextStop.lat), lng: Number(nextStop.lng) })
                  if (mapInstance.current) {
                    mapInstance.current.panTo([Number(nextStop.lat), Number(nextStop.lng)])
                  }
                }}
                title="Teleport to Next Stop"
                disabled={!waypoints[currentStopIndex + 1]}
                style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: waypoints[currentStopIndex + 1] ? '#8b5cf6' : '#cbd5e1',
                  border: '2px solid #fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: waypoints[currentStopIndex + 1] ? 'pointer' : 'not-allowed',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: 20,
                }}
              >
                ⏭
              </button>

              {/* Clear Mock GPS */}
              {mockGps && (
                <button
                  onClick={() => setMockGps(null)}
                  title="Clear Mock GPS (use real GPS)"
                  style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: '#ef4444', border: '2px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: 16,
                    fontWeight: 800, color: '#fff',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── ① STOP INFO HEADER (Floating Top) ── */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          background: 'rgba(30, 42, 58, 0.92)', backdropFilter: 'blur(8px)',
          padding: '16px 18px 18px', color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
        }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <GpsStatusPill isTracking={isTracking} error={gpsError} accuracy={gpsAccuracy} />
            <ConnPill />
            {isExtendedMode && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)',
                borderRadius: 20, padding: '3px 10px',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#f59e0b',
                  animation: 'navPulse 1.5s ease infinite', display: 'inline-block',
                }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em' }}>
                  COLLECTING UNCLAIMED
                </span>
              </div>
            )}
            <div style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px',
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '.04em' }}>
                ⏱ {formattedTime}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 20, marginTop: 2 }}>📍</span>
            <div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>
                {currentTarget?.label || `Stop ${currentStopIndex}`}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                {currentStopIndex} out of {waypoints.length - 1} · {schedule?.days || ''}
              </div>
            </div>
          </div>
        </div>

        {/* Turn direction card (Floating below header) */}
        <div style={{
          position: 'absolute', top: 120, left: 14, right: 14, zIndex: 10,
          background: 'rgba(255,255,255,0.96)', borderRadius: 14, padding: '14px 18px',
          display: 'flex', alignItems: 'center', gap: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)', backdropFilter: 'blur(6px)',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#0f172a" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900, color: '#0f172a' }}>
              {instructionText}
            </div>
            <div style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>
              {instructionDistance}
            </div>
          </div>
        </div>

        {/* ── BOTTOM PANEL (Floating Bottom) ── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
          background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          boxShadow: '0 -4px 24px rgba(0,0,0,0.1)',
          display: 'flex', flexDirection: 'column',
          paddingBottom: 24
        }}>
          {/* Drag handle pill */}
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />

          {/* ── ③ STATS BAR ── */}
          <div style={{
            padding: '4px 12px 16px', display: 'flex', alignItems: 'center',
            borderBottom: '1px solid rgba(0,0,0,0.06)'
          }}>
            <StatCell value={arrivalTimeStr} label="arrival" />
            <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
            <StatCell value={etaMinutes} label="min" />
            <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
            <StatCell value={distanceKmStr} label="km" />
          </div>

          {/* ── ④ ACTION AREA ── */}
          <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <p style={{
              fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800,
              color: isNearDestination ? '#0f172a' : '#64748b',
              textAlign: 'center', marginBottom: 6, transition: 'color .3s',
            }}>
              {isNearDestination ? 'You have arrived' : 'On the way to next stop'}
            </p>

            {!isNearDestination && distanceToStop !== null && (
              <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                {distanceToStop > 1000
                  ? `${(distanceToStop / 1000).toFixed(1)} km to destination`
                  : `${Math.round(distanceToStop)} m to destination`
                }
              </p>
            )}
            {!isNearDestination && distanceToStop === null && (
              <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>
                📡 Waiting for GPS signal…
              </p>
            )}

            <button
              id="arrived-btn"
              disabled={!isNearDestination}
              onClick={handleArrived}
              style={{
                width: '100%', maxWidth: 320, padding: '18px', borderRadius: 30, border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
                letterSpacing: '.06em', transition: 'all .35s ease',
                cursor: isNearDestination ? 'pointer' : 'not-allowed',
                background: isNearDestination ? '#0f172a' : '#e2e8f0',
                color: isNearDestination ? '#ffffff' : '#94a3b8',
                boxShadow: isNearDestination ? '0 6px 20px rgba(15,23,42,0.3)' : 'none',
              }}
            >
              {isNearDestination ? 'Confirm Arrival' : 'Confirm on Arrival'}
            </button>
          </div>
        </div>
      </div>

    </>
  )
}
