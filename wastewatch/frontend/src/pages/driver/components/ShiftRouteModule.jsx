/**
 * ShiftRouteModule.jsx
 * 
 * 3rd part < ==  Do not remove this indicator
 * ---------------------
 * Stop marker colour system:
 *  🟢 green  — collected (stop confirmed arrived + completed)
 *  🔵 blue   — current   (the stop the truck is heading to right now)
 *  🟠 orange — upcoming  (not yet reached)
 *  🔴 red    — missed    (shift ended before reaching, auto-cancelled)
 *
 * Status is tracked in stopStatuses: Map<stopIndex, 'collected'|'current'|'upcoming'|'missed'>
 * Marker DOM elements are kept in stopMarkerEls: Map<stopIndex, HTMLElement>
 * so we can repaint them in-place without redrawing the whole map.
 *
 * When the driver confirms arrival the stop becomes 'collected' and
 * currentStopIndex advances. When the shift ends (setRouteState('arrived')
 * is called from the last stop, or endShift is triggered externally) all
 * remaining 'upcoming' stops flip to 'missed'.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import useShiftTimer from '../../../hooks/useShiftTimer'
import useGpsTracking from '../../../hooks/useGpsTracking'
import Navbar from '../../../components/Navbar'
import api from '../../../api/client'
import { useAuth } from '../../../context/AuthContext'

// ─── STOP STATUS COLOURS ──────────────────────────────────────────────────────

const STOP_COLORS = {
  collected: { bg: '#16a34a', border: '#fff', shadow: 'rgba(22,163,74,0.5)', label: '#fff' },
  current: { bg: '#2563eb', border: '#fff', shadow: 'rgba(37,99,235,0.6)', label: '#fff' },
  upcoming: { bg: '#f59e0b', border: '#fff', shadow: 'rgba(245,158,11,0.4)', label: '#fff' },
  missed: { bg: '#ef4444', border: '#fff', shadow: 'rgba(239,68,68,0.5)', label: '#fff' },
}

function stopMarkerHTML(stopNumber, status) {
  const c = STOP_COLORS[status] || STOP_COLORS.upcoming
  const size = status === 'current' ? 28 : 24
  const pulse = status === 'current'
    ? `<span style="position:absolute;inset:-5px;border-radius:50%;
         border:2px solid ${c.bg};opacity:0.5;animation:markerPulse 1.8s ease infinite;"></span>`
    : ''
  const icon = status === 'collected' ? '✓'
    : status === 'missed' ? '✕'
      : stopNumber

  return `
    <div style="position:relative;width:${size}px;height:${size}px;">
      ${pulse}
      <div style="
        position:absolute;inset:0;
        background:${c.bg};
        border:2.5px solid ${c.border};
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        color:${c.label};
        font-size:${status === 'current' ? 12 : 10}px;
        font-weight:900;
        font-family:monospace;
        box-shadow:0 2px 10px ${c.shadow};
        transition:background .35s,box-shadow .35s;
      ">${icon}</div>
    </div>`
}

// ─── GPS STATUS PILL ──────────────────────────────────────────────────────────

function GpsStatusPill({ isTracking, error, accuracy }) {
  const isPoor = accuracy != null && accuracy >= 50
  const label = error ? 'GPS Lost' : !isTracking ? 'GPS…'
    : accuracy != null ? `GPS ±${Math.round(accuracy)}m` : 'GPS Active'
  const color = error ? '#ef4444' : isPoor ? '#f59e0b' : isTracking ? '#2ecc71' : '#f59e0b'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 20, padding: '3px 10px'
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block',
        animation: isTracking && !error ? 'navPulse 2s ease infinite' : 'none'
      }} />
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '.04em' }}>{label}</span>
    </div>
  )
}

// ─── CONNECTIVITY PILL ────────────────────────────────────────────────────────

function ConnPill() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const color = online ? '#2ecc71' : '#ef4444'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: `${color}1a`, border: `1px solid ${color}44`, borderRadius: 20, padding: '3px 10px'
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '.04em' }}>
        {online ? '● Online' : '○ Offline'}
      </span>
    </div>
  )
}

// ─── STAT CELL ────────────────────────────────────────────────────────────────

function StatCell({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>{label}</div>
    </div>
  )
}

// ─── HAVERSINE ────────────────────────────────────────────────────────────────

const ARRIVAL_RADIUS_M = 100

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── POLYLINE DECODER ─────────────────────────────────────────────────────────

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

// ─── COMPASS ──────────────────────────────────────────────────────────────────

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const bearingToCompass = deg => deg != null
  ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : null

// ─── TURN ARROW ───────────────────────────────────────────────────────────────

function TurnArrow({ type, bearing, size = 48, color = '#0f172a' }) {
  const compass = bearingToCompass(bearing)
  const s = { stroke: color, strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
  const wrap = (label, children) => (
    <svg viewBox="0 0 44 44" width={size} height={size} aria-label={label} style={{ display: 'block' }}>
      {children}
      {compass && <text x="22" y="43" textAnchor="middle" fontSize="6.5" fontWeight="700"
        fill={color} opacity="0.5" fontFamily="monospace">{compass}</text>}
    </svg>
  )
  const arrows = {
    0: wrap('Turn left', <g {...s}><path d="M22,36 L22,20 Q22,12 13,12" /><polyline points="20,20 13,12 21,5" /></g>),
    1: wrap('Turn right', <g {...s}><path d="M22,36 L22,20 Q22,12 31,12" /><polyline points="24,20 31,12 23,5" /></g>),
    2: wrap('Sharp left', <g {...s}><path d="M22,36 L22,24 Q22,18 16,14 Q10,10 10,4" /><polyline points="4,10 10,4 16,10" /></g>),
    3: wrap('Sharp right', <g {...s}><path d="M22,36 L22,24 Q22,18 28,14 Q34,10 34,4" /><polyline points="28,10 34,4 40,10" /></g>),
    4: wrap('Slight left', <g {...s}><path d="M22,36 L22,20 Q21,12 14,8" /><polyline points="7,12 14,8 16,16" /></g>),
    5: wrap('Slight right', <g {...s}><path d="M22,36 L22,20 Q23,12 30,8" /><polyline points="28,16 30,8 37,12" /></g>),
    6: wrap('Straight', <g {...s}><line x1="22" y1="36" x2="22" y2="8" /><polyline points="14,16 22,8 30,16" /></g>),
    7: wrap('Enter roundabout', <g {...s}><circle cx="22" cy="19" r="8" /><line x1="22" y1="36" x2="22" y2="27" /><line x1="28" y1="12" x2="33" y2="7" /><polyline points="26,3 33,7 29,14" /></g>),
    8: wrap('Exit roundabout', <g {...s}><circle cx="22" cy="19" r="8" /><line x1="22" y1="36" x2="22" y2="27" /><line x1="28" y1="12" x2="33" y2="7" /><polyline points="26,3 33,7 29,14" /></g>),
    9: wrap('U-turn', <g {...s}><path d="M14,36 L14,18 Q14,6 22,6 Q30,6 30,14 L30,20" /><polyline points="22,14 30,20 38,14" /><polyline points="8,30 14,36 20,30" /></g>),
    10: wrap('Arrived', <g><path d="M22,38 Q22,38 13,25 A11,11 0 1,1 31,25 Z" {...s} /><circle cx="22" cy="17" r="3.5" fill={color} opacity="0.7" stroke="none" /></g>),
    11: wrap('Depart', <g {...s}><line x1="13" y1="7" x2="13" y2="37" /><path d="M13,7 L33,14 L13,21" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="2.6" strokeLinejoin="round" /></g>),
    12: wrap('Keep left', <g {...s}><line x1="22" y1="36" x2="22" y2="8" strokeOpacity="0.2" /><path d="M22,36 L22,22 L15,8" /><polyline points="9,13 15,8 18,15" /></g>),
    13: wrap('Keep right', <g {...s}><line x1="22" y1="36" x2="22" y2="8" strokeOpacity="0.2" /><path d="M22,36 L22,22 L29,8" /><polyline points="26,15 29,8 35,13" /></g>),
  }
  return arrows[type] ?? arrows[6]
}

const TURN_COLOR = {
  0: '#3b82f6', 1: '#3b82f6', 2: '#f59e0b', 3: '#f59e0b', 4: '#64748b', 5: '#64748b',
  6: '#16a34a', 7: '#8b5cf6', 8: '#8b5cf6', 9: '#ef4444', 10: '#16a34a',
  11: '#2563eb', 12: '#64748b', 13: '#64748b',
}

// ─── MAP LEGEND ───────────────────────────────────────────────────────────────

function MapLegend() {
  const items = [
    { color: '#2563eb', label: 'Current' },
    { color: '#16a34a', label: 'Collected' },
    { color: '#f59e0b', label: 'Upcoming' },
    { color: '#ef4444', label: 'Missed' },
  ]
  return (
    <div style={{
      position: 'absolute', bottom: 10, right: 10, zIndex: 500,
      background: 'rgba(15,23,42,0.82)', backdropFilter: 'blur(6px)',
      borderRadius: 10, padding: '8px 10px',
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%', background: color,
            boxShadow: `0 0 4px ${color}88`, flexShrink: 0
          }} />
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.8)',
            letterSpacing: '.04em'
          }}>{label.toUpperCase()}</span>
        </div>
      ))}
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function NavigationModule({ setRouteState }) {
  const { user } = useAuth()
  const { formattedTime, shiftActive } = useShiftTimer()
  const { position: realGpsPos, accuracy: gpsAccuracy, isTracking, error: gpsError } =
    useGpsTracking({ enabled: shiftActive, intervalMs: 5000 })
  const isExtendedMode = sessionStorage.getItem('ww_extended_mode') === 'true'

  // ── Mock GPS ──────────────────────────────────────────────────────────────
  const [mockGps, setMockGps] = useState(null)
  const gpsPos = mockGps || realGpsPos
  const isMock = mockGps !== null

  // ── Map refs ──────────────────────────────────────────────────────────────
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const driverMarker = useRef(null)
  const routeLayer = useRef(null)
  const gpsPosRef = useRef(gpsPos)
  // Map of realStopIndex → Leaflet marker object (for icon updates)
  const stopMarkersRef = useRef(new Map())

  const [leafletReady, setLeafletReady] = useState(false)
  const [schedule, setSchedule] = useState(null)
  const [mapLoading, setMapLoading] = useState(true)

  // ── Stop index ────────────────────────────────────────────────────────────
  const [currentStopIndex, setCurrentStopIndex] = useState(() => {
    const s = sessionStorage.getItem('ww_current_stop_index')
    return s ? parseInt(s, 10) : 1
  })

  // ── Stop statuses: Map<waypointIndex, status> ─────────────────────────────
  // Initialise from sessionStorage so refreshes don't reset collected stops
  const [stopStatuses, setStopStatuses] = useState(() => {
    try {
      const saved = sessionStorage.getItem('ww_stop_statuses')
      return saved ? new Map(JSON.parse(saved)) : new Map()
    } catch { return new Map() }
  })

  // ── ORS ───────────────────────────────────────────────────────────────────
  const [orsData, setOrsData] = useState(null)
  const [orsFetchKey, setOrsFetchKey] = useState(0)

  // ── Derived ───────────────────────────────────────────────────────────────
  const waypoints = schedule?.waypoints || []
  const currentTarget = waypoints[currentStopIndex] || null
  const nextTarget = waypoints[currentStopIndex + 1] || null

  const distanceToStop = gpsPos && currentTarget
    ? haversineDistance(gpsPos.lat, gpsPos.lng, currentTarget.lat, currentTarget.lng)
    : null

  const GPS_ACCURACY_THRESHOLD = 50
  const hasGoodAccuracy = isMock || gpsAccuracy == null || gpsAccuracy < GPS_ACCURACY_THRESHOLD
  const isNearDestination = distanceToStop != null && distanceToStop <= ARRIVAL_RADIUS_M && hasGoodAccuracy

  useEffect(() => { gpsPosRef.current = gpsPos }, [gpsPos])

  // ── Persist stop statuses to sessionStorage ───────────────────────────────
  useEffect(() => {
    sessionStorage.setItem('ww_stop_statuses', JSON.stringify([...stopStatuses]))
  }, [stopStatuses])

  // ── Helper: derive status for a given waypoint index ─────────────────────
  const getStopStatus = useCallback((wpIndex) => {
    if (stopStatuses.has(wpIndex)) return stopStatuses.get(wpIndex)
    if (wpIndex === currentStopIndex) return 'current'
    if (wpIndex < currentStopIndex) return 'collected'
    return 'upcoming'
  }, [stopStatuses, currentStopIndex])

  // ── Helper: repaint a single marker's icon ────────────────────────────────
  const repaintMarker = useCallback((wpIndex, status) => {
    const marker = stopMarkersRef.current.get(wpIndex)
    if (!marker || !window.L) return
    const stopNum = wpIndex  // display number (1-based real stop number)
    marker.setIcon(window.L.divIcon({
      html: stopMarkerHTML(stopNum, status),
      className: '',
      iconSize: status === 'current' ? [28, 28] : [24, 24],
      iconAnchor: status === 'current' ? [14, 14] : [12, 12],
    }))
    // Update popup label too
    marker.getPopup()?.setContent(
      `<b>${waypoints[wpIndex]?.label || `Stop ${stopNum}`}</b>
       <br/><span style="font-size:11px;color:${STOP_COLORS[status].bg};font-weight:700;text-transform:uppercase">${status}</span>`
    )
  }, [waypoints])

  // ── Sync all marker colours when currentStopIndex or stopStatuses changes ─
  useEffect(() => {
    if (!window.L || stopMarkersRef.current.size === 0) return
    waypoints.slice(1).forEach((_, i) => {
      const wpIndex = i + 1
      repaintMarker(wpIndex, getStopStatus(wpIndex))
    })
  }, [currentStopIndex, stopStatuses, getStopStatus, repaintMarker, waypoints])

  // ── 1. Leaflet CDN ────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return }
    const link = Object.assign(document.createElement('link'),
      { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
    document.head.appendChild(link)
    const script = Object.assign(document.createElement('script'),
      { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', onload: () => setLeafletReady(true) })
    document.head.appendChild(script)
  }, [])

  // ── 2. Fetch schedule ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    setMapLoading(true)
    api.get('/api/driver/collection-schedules/')
      .then(res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        setSchedule(match || null)
        const saved = sessionStorage.getItem('ww_current_stop_index')
        const idx = saved ? parseInt(saved, 10) : (match?.waypoints?.length > 1 ? 1 : 0)
        setCurrentStopIndex(idx)
        if (!saved) sessionStorage.setItem('ww_current_stop_index', String(idx))
      })
      .catch(() => setSchedule(null))
      .finally(() => setMapLoading(false))
  }, [user?.id])

  // ── 3. Draw map + coloured stop markers ───────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current || mapLoading) return
    const L = window.L
    const pos = gpsPosRef.current
    const map = L.map(mapRef.current, {
      center: pos ? [pos.lat, pos.lng] : [13.9373, 121.617],
      zoom: 15, zoomControl: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    mapInstance.current = map

    // Driver marker — pulsing blue circle
    const driverIcon = L.divIcon({
      html: `<div style="position:relative;width:18px;height:18px;">
               <span style="position:absolute;inset:-6px;border-radius:50%;
                 border:2px solid #2563eb;opacity:0.4;animation:markerPulse 2s ease infinite;"></span>
               <div style="position:absolute;inset:0;background:#2563eb;border:3px solid white;
                 border-radius:50%;box-shadow:0 0 12px rgba(37,99,235,0.7);"></div>
             </div>`,
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
    })
    driverMarker.current = L.marker(
      pos ? [pos.lat, pos.lng] : [13.9373, 121.617],
      { icon: driverIcon, zIndexOffset: 1000 }
    ).addTo(map)

    // Stop markers — coloured by status, stored in ref for later updates
    waypoints.slice(1).forEach((wp, i) => {
      const wpIndex = i + 1
      const status = (() => {
        if (stopStatuses.has(wpIndex)) return stopStatuses.get(wpIndex)
        if (wpIndex === currentStopIndex) return 'current'
        if (wpIndex < currentStopIndex) return 'collected'
        return 'upcoming'
      })()

      const icon = L.divIcon({
        html: stopMarkerHTML(wpIndex, status),
        className: '',
        iconSize: status === 'current' ? [28, 28] : [24, 24],
        iconAnchor: status === 'current' ? [14, 14] : [12, 12],
      })

      const marker = L.marker([wp.lat, wp.lng], { icon })
        .addTo(map)
        .bindPopup(
          `<b>${wp.label || `Stop ${wpIndex}`}</b>
           <br/><span style="font-size:11px;color:${STOP_COLORS[status].bg};
             font-weight:700;text-transform:uppercase">${status}</span>`
        )

      stopMarkersRef.current.set(wpIndex, marker)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, schedule, mapLoading])

  // ── 4. ORS directions ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentTarget) return
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) { console.warn('VITE_ORS_API_KEY missing'); return }

    const startLng = gpsPos?.lng ?? waypoints[0]?.lng ?? 121.617
    const startLat = gpsPos?.lat ?? waypoints[0]?.lat ?? 13.9373
    const remaining = waypoints.slice(currentStopIndex, currentStopIndex + 40).map(wp => [wp.lng, wp.lat])
    const coordinates = [[startLng, startLat], ...remaining]

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: orsApiKey },
      body: JSON.stringify({ coordinates, instructions: true }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length) return
        setOrsData(data.routes[0])
        if (mapInstance.current && window.L) {
          if (routeLayer.current) mapInstance.current.removeLayer(routeLayer.current)
          const pts = decodePolyline(data.routes[0].geometry)
          routeLayer.current = window.L.polyline(pts, { color: '#3b82f6', weight: 6, opacity: 0.85 })
            .addTo(mapInstance.current)
        }
      })
      .catch(console.error)
  }, [orsFetchKey, currentTarget?.lat, currentTarget?.lng, currentStopIndex])

  // ── 5. Move driver marker ──────────────────────────────────────────────────
  useEffect(() => {
    if (!gpsPos || !driverMarker.current || !mapInstance.current) return
    driverMarker.current.setLatLng([gpsPos.lat, gpsPos.lng])
    mapInstance.current.panTo([gpsPos.lat, gpsPos.lng])
  }, [gpsPos])

  // ── 6. Cleanup ────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
  }, [])

  // ── Teleport helpers ──────────────────────────────────────────────────────
  const teleportTo = useCallback((wp) => {
    if (!wp) return
    const lat = Number(wp.lat), lng = Number(wp.lng)
    setMockGps({ lat, lng })
    mapInstance.current?.panTo([lat, lng])
    setOrsFetchKey(k => k + 1)
  }, [])

  const clearMock = useCallback(() => {
    setMockGps(null)
    setOrsFetchKey(k => k + 1)
  }, [])

  // ── Arrival handler: mark stop collected, advance index ───────────────────
  const handleArrived = () => {
    // Repaint map marker to collected immediately
    setStopStatuses(prev => {
      const next = new Map(prev)
      next.set(currentStopIndex, 'collected')
      return next
    })
    repaintMarker(currentStopIndex, 'collected')

    if (currentTarget) {
      sessionStorage.setItem('ww_current_stop', currentTarget.label || `Stop ${currentStopIndex}`)
    }

    // Always go to ArrivedModule — it handles notes/photo/confirm,
    // then calls setRouteState('completed') itself
    sessionStorage.setItem('ww_route_state', 'arrived')
    setRouteState('arrived')
  }

  // Mark all upcoming stops from startIndex onwards as missed
  const markRemainingMissed = useCallback((fromIndex) => {
    setStopStatuses(prev => {
      const next = new Map(prev)
      waypoints.slice(fromIndex).forEach((_, i) => {
        const idx = fromIndex + i
        if (!next.has(idx) || next.get(idx) === 'upcoming' || next.get(idx) === 'current') {
          next.set(idx, 'missed')
          repaintMarker(idx, 'missed')
        }
      })
      return next
    })
  }, [waypoints, repaintMarker])

  // ── End shift early — mark all remaining stops missed ─────────────────────
  // This is called if the parent tells us the shift ended (e.g. from DriverDashboard).
  // You can also wire a button to this if needed.
  useEffect(() => {
    if (!shiftActive && waypoints.length > 0) {
      markRemainingMissed(currentStopIndex)
    }
  }, [shiftActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derive ORS instruction ────────────────────────────────────────────────
  let instructionText = 'Follow the road'
  let instructionDist = ''
  let stepType = 6
  let stepBearing = null
  let etaMinutes = '--'
  let arrivalTimeStr = '--:--'
  let distanceKmStr = '--'

  if (orsData) {
    const seg = orsData.segments?.[0]
    if (seg?.steps?.length) {
      const step = seg.steps[0]
      instructionText = step.instruction || 'Follow the road'
      instructionDist = step.distance != null ? `${Math.round(step.distance)} m` : ''
      stepType = step.type ?? 6
      stepBearing = step.exit_bearings?.[0] ?? step.bearing ?? null
    }
    if (seg) {
      etaMinutes = Math.ceil(seg.duration / 60)
      arrivalTimeStr = new Date(Date.now() + seg.duration * 1000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      distanceKmStr = (seg.distance / 1000).toFixed(1)
    }
  }

  const accentColor = TURN_COLOR[stepType] ?? '#0f172a'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <style>{`
        @keyframes navPulse   { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes markerPulse{ 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.6);opacity:0} }
        @keyframes navFadeUp  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes arrowPop   { 0%{transform:scale(.8);opacity:0} 60%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
      `}</style>

      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-body)', overflow: 'hidden', position: 'relative'
      }}>

        {/* ── MAP ── */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#2a3441' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          <MapLegend />

          {/* Dev teleport */}
          {import.meta.env.DEV && (
            <div style={{
              position: 'absolute', top: '50%', right: 14, marginTop: 54,
              zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8
            }}>
              <button onClick={() => teleportTo(currentTarget)} disabled={!currentTarget}
                title="Teleport to Current Stop"
                style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: currentTarget ? '#f59e0b' : '#cbd5e1', border: '2px solid #fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: currentTarget ? 'pointer' : 'not-allowed',
                  boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20
                }}>📍</button>
              <button onClick={() => teleportTo(nextTarget)} disabled={!nextTarget}
                title="Teleport to Next Stop"
                style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: nextTarget ? '#8b5cf6' : '#cbd5e1', border: '2px solid #fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: nextTarget ? 'pointer' : 'not-allowed',
                  boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20
                }}>⏭</button>
              {mockGps && (
                <button onClick={clearMock} title="Clear Mock GPS"
                  style={{
                    width: 44, height: 44, borderRadius: '50%', background: '#ef4444',
                    border: '2px solid #fff', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 16, fontWeight: 800, color: '#fff'
                  }}>✕</button>
              )}
              {/* Dev: simulate end shift to test missed markers */}
              <button onClick={() => markRemainingMissed(currentStopIndex + 1)}
                title="Simulate shift end (mark remaining missed)"
                style={{
                  width: 44, height: 44, borderRadius: '50%', background: '#0f172a',
                  border: '2px solid #fff', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 14, color: '#fff', fontWeight: 800
                }}>🚫</button>
            </div>
          )}
        </div>

        {/* ── STOP HEADER ── */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          background: 'rgba(30,42,58,0.92)', backdropFilter: 'blur(8px)',
          padding: '16px 18px 18px', color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.15)'
        }}>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <GpsStatusPill isTracking={isTracking} error={gpsError} accuracy={gpsAccuracy} />
            <ConnPill />
            {isExtendedMode && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)',
                borderRadius: 20, padding: '3px 10px'
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#f59e0b',
                  animation: 'navPulse 1.5s ease infinite', display: 'inline-block'
                }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em' }}>
                  COLLECTING UNCLAIMED
                </span>
              </div>
            )}
            <div style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px'
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.65)',
                letterSpacing: '.04em'
              }}>⏱ {formattedTime}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 20, marginTop: 2 }}>📍</span>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>
                  {currentTarget?.label || `Stop ${currentStopIndex}`}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                  {currentStopIndex} of {waypoints.length - 1} · {schedule?.days || ''}
                </div>
              </div>
            </div>

            {/* Mini stop status summary */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              {[
                { status: 'collected', count: [...stopStatuses.values()].filter(s => s === 'collected').length || Math.max(0, currentStopIndex - 1), color: '#16a34a' },
                { status: 'missed', count: [...stopStatuses.values()].filter(s => s === 'missed').length, color: '#ef4444' },
              ].map(({ status, count, color }) => count > 0 && (
                <div key={status} style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  background: `${color}22`, border: `1px solid ${color}44`,
                  borderRadius: 20, padding: '2px 8px'
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                  <span style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: '.04em' }}>
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── TURN INSTRUCTION CARD ── */}
        <div key={stepType} style={{
          position: 'absolute', top: 122, left: 14, right: 14, zIndex: 10,
          background: 'rgba(255,255,255,0.97)', borderRadius: 16, overflow: 'hidden',
          display: 'flex', alignItems: 'stretch',
          boxShadow: '0 6px 28px rgba(0,0,0,.18)', backdropFilter: 'blur(6px)',
          animation: 'navFadeUp .25s ease'
        }}>
          <div style={{
            width: 76, flexShrink: 0, background: `${accentColor}12`,
            borderRight: `3px solid ${accentColor}28`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0'
          }}>
            <div style={{ animation: 'arrowPop .3s ease' }}>
              <TurnArrow type={stepType} bearing={stepBearing} size={48} color={accentColor} />
            </div>
          </div>
          <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900,
              color: '#0f172a', lineHeight: 1.2, marginBottom: instructionDist ? 5 : 0
            }}>
              {instructionText}
            </div>
            {instructionDist && (
              <div style={{
                fontSize: 13, color: accentColor, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 4
              }}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none"
                  stroke={accentColor} strokeWidth="2" strokeLinecap="round">
                  <line x1="8" y1="2" x2="8" y2="14" />
                  <line x1="3" y1="9" x2="8" y2="14" />
                  <line x1="13" y1="9" x2="8" y2="14" />
                </svg>
                in {instructionDist}
              </div>
            )}
          </div>
        </div>

        {/* ── BOTTOM PANEL ── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
          background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          boxShadow: '0 -4px 24px rgba(0,0,0,.1)',
          display: 'flex', flexDirection: 'column', paddingBottom: 24
        }}>

          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />

          {/* Stats */}
          <div style={{
            padding: '4px 12px 16px', display: 'flex', alignItems: 'center',
            borderBottom: '1px solid rgba(0,0,0,.06)'
          }}>
            <StatCell value={arrivalTimeStr} label="arrival" />
            <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
            <StatCell value={etaMinutes} label="min" />
            <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
            <StatCell value={distanceKmStr} label="km" />
          </div>

          {/* Action */}
          <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <p style={{
              fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, textAlign: 'center',
              color: isNearDestination ? '#0f172a' : '#64748b', marginBottom: 6, transition: 'color .3s'
            }}>
              {isNearDestination ? 'You have arrived!' : 'On the way to next stop'}
            </p>
            {!isNearDestination && distanceToStop != null && (
              <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                {distanceToStop > 1000
                  ? `${(distanceToStop / 1000).toFixed(1)} km to destination`
                  : `${Math.round(distanceToStop)} m to destination`}
              </p>
            )}
            {!isNearDestination && distanceToStop == null && (
              <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>📡 Waiting for GPS signal…</p>
            )}
            <button id="arrived-btn" disabled={!isNearDestination} onClick={handleArrived}
              style={{
                width: '100%', maxWidth: 320, padding: '18px', borderRadius: 30, border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
                transition: 'all .35s ease',
                cursor: isNearDestination ? 'pointer' : 'not-allowed',
                background: isNearDestination ? '#0f172a' : '#e2e8f0',
                color: isNearDestination ? '#fff' : '#94a3b8',
                boxShadow: isNearDestination ? '0 6px 20px rgba(15,23,42,0.3)' : 'none'
              }}>
              {isNearDestination ? 'Confirm Arrival' : 'Confirm on Arrival'}
            </button>
          </div>
        </div>

      </div>
    </>
  )
}