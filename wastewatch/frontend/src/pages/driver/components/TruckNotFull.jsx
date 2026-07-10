/**
 * TruckNotFull.jsx
 * -----------------
 * Post-route decision module — same layout as NavigateToBaseModule.
 *
 * Shows a full-screen Leaflet map with all MISSED stops as pulsing red markers.
 * Bottom panel shows missed stop count + two action buttons:
 *   1) "My Truck is Still Not Full" → activates extended mode, returns to route
 *   2) "End Shift — I'm Done"       → ends the shift normally
 *
 * Props:
 *   visible          {boolean}
 *   shift            {object}   — active DriverShift
 *   schedule         {object}   — CollectionSchedule (has .waypoints[])
 *   stopStatuses     {Map}      — index → status string
 *   onEndShift       {fn}       — called after successful shift/end
 *   onExtendedMode   {fn}       — called after extended_mode API succeeds
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import api from '../../../api/client'
import { useNotification } from '../../../context/NotificationContext'
import useGpsTracking from '../../../hooks/useGpsTracking'
import useReassignedStops from '../../../hooks/useReassignedStops'
import Navbar from '../../../components/Navbar'
import {
  normalizeStopStatus,
  isCompletedStopStatus,
} from '../../../utils/pickupStatusSync'

const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY

// ─── SVG ICONS ────────────────────────────────────────────────────────────────
const RouteIcon = ({ size = 22, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
)

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Decode ORS encoded polyline geometry (same algorithm as EndShiftModule)
function decodeOrsPolyline(encoded) {
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

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const bearingToCompass = deg => deg != null
  ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : null

function TurnArrow({ type, bearing, size = 48, color = '#0f172a' }) {
  const compass = bearingToCompass(bearing)
  const s = { stroke: color, strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
  const wrap = (label, children) => (
    <svg viewBox="0 0 44 44" width={size} height={size} aria-label={label} style={{ display: 'block' }}>
      {children}
      {compass && <text x="22" y="43" textAnchor="middle" fontSize="6.5" fontWeight="700" fill={color} opacity="0.5" fontFamily="monospace">{compass}</text>}
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

const LUCENA_FALLBACK = [13.9373, 121.617]

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function TruckNotFull({ visible, shift, schedule, stopStatuses, onEndShift, onExtendedMode }) {
  const { notify } = useNotification()
  // GPS is ALWAYS enabled — position data is required for nearest-missed-stop
  // routing even before the panel becomes visible. syncEnabled: false keeps
  // this module from posting redundant location updates to the backend.
  const { position: realGpsPos, accuracy: gpsAccuracy, isTracking, error: gpsError } =
    useGpsTracking({ enabled: true, intervalMs: 4000, syncEnabled: false })
  const [mockGps, setMockGps] = useState(null)
  const gpsPos = mockGps || realGpsPos
  const isMock = mockGps !== null

  const [loading, setLoading] = useState(false)
  const [leafletReady, setLeafletReady] = useState(false)
  const [isPanelExpanded, setIsPanelExpanded] = useState(false)
  // ORS routing state
  const [orsLoading, setOrsLoading] = useState(false)
  const [orsDist, setOrsDist] = useState(null)   // metres, from ORS
  const [orsIsFallback, setOrsIsFallback] = useState(false)
  const orsAbortRef = useRef(null)
  const orsPolylineRef = useRef(null)
  const [orsData, setOrsData] = useState(null)
  const [orsFetchKey, setOrsFetchKey] = useState(0)
  const lastOrsGpsPosRef = useRef(null)

  // ── GPS ORS throttling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gpsPos) return
    const last = lastOrsGpsPosRef.current
    if (!last) {
      lastOrsGpsPosRef.current = gpsPos
      setOrsFetchKey(k => k + 1)
      return
    }
    const moved = haversineDistance(last.lat, last.lng, gpsPos.lat, gpsPos.lng)
    if (moved > 10) {
      lastOrsGpsPosRef.current = gpsPos
      setOrsFetchKey(k => k + 1)
    }
  }, [gpsPos])

  // Reassigned stops from other drivers
  const [reassignedStops, setReassignedStops] = useState([])
  const reassignedMarkersRef = useRef([])
  // Banner shown after extended mode API succeeds
  const [extendedActivated, setExtendedActivated] = useState(false)

  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const driverMarkerRef = useRef(null)
  const missedMarkersRef = useRef([])
  const hasFitBoundsRef = useRef(false)

  // ── Merge stopStatuses with sessionStorage snapshot ────────────────────────
  const mergedStatuses = useMemo(() => {
    const base = new Map(stopStatuses || [])
    if (base.size === 0) {
      try {
        const raw = sessionStorage.getItem('ww_stop_statuses_snapshot')
        if (raw) new Map(JSON.parse(raw)).forEach((v, k) => base.set(k, v))
      } catch { }
    }
    if (schedule?.waypoints?.length > 1) {
      for (let i = 1; i < schedule.waypoints.length; i++) {
        if (!base.has(i)) base.set(i, 'PENDING_INSPECTION')
      }
    }
    return base
  }, [stopStatuses, schedule])

  // ── Missed stops — only truly unvisited (aligns with EndShiftModule) ───────
  // EMPTY_STOP and COLLECTION_DISPUTED are excluded: driver visited those stops.
  const missedStops = useMemo(() => {
    if (!schedule?.waypoints) return []
    return schedule.waypoints.slice(1)
      .map((wp, i) => ({ ...wp, idx: i + 1, status: normalizeStopStatus(mergedStatuses.get(i + 1)) }))
      .filter(wp => {
        const s = wp.status
        return s === 'DRIVER_MISSED' || s === 'PENDING_INSPECTION' || s === 'READY_FOR_COLLECTION'
      })
  }, [schedule, mergedStatuses])

  const missedStopOrders = missedStops.map(wp => wp.idx)

  const collectedCount = useMemo(() => {
    if (!schedule?.waypoints) return 0
    return schedule.waypoints.slice(1)
      .filter((_, i) => isCompletedStopStatus(normalizeStopStatus(mergedStatuses.get(i + 1))))
      .length
  }, [schedule, mergedStatuses])

  const totalStops = (schedule?.waypoints?.length ?? 1) - 1

  // ── Nearest missed stop (for instruction card) ────────────────────────────
  const nearestMissed = useMemo(() => {
    if (!gpsPos || !missedStops.length) return missedStops[0] || null
    return missedStops.reduce((best, wp) => {
      if (!wp.lat || !wp.lng) return best
      if (!best?.lat || !best?.lng) return wp
      const d = haversineDistance(gpsPos.lat, gpsPos.lng, Number(wp.lat), Number(wp.lng))
      const bd = haversineDistance(gpsPos.lat, gpsPos.lng, Number(best.lat), Number(best.lng))
      return d < bd ? wp : best
    })
  }, [gpsPos, missedStops])

  // ORS distance label - shows 'Calculating.' while fetching, '(est.)' on fallback
  const distLabel = orsLoading ? 'Calculating route.'
    : orsDist != null
      ? `${orsDist > 1000 ? `${(orsDist / 1000).toFixed(1)} km` : `${Math.round(orsDist)} m`} away${orsIsFallback ? ' (est.)' : ''}`
      : '-'

  let orsInstruction = nearestMissed ? `Head to ${nearestMissed.label || `Stop ${nearestMissed.idx}`}` : 'Head to nearest stop'
  let stepType = 6, stepBearing = null

  if (orsData) {
    const seg = orsData.segments?.[0]
    if (seg?.steps?.length) {
      const step = seg.steps[0]
      orsInstruction = step.instruction || orsInstruction
      stepType = step.type ?? 6
      stepBearing = step.exit_bearings?.[0] ?? step.bearing ?? null
    }
  }

  const accentColor = TURN_COLOR[stepType] ?? '#ef4444'

  // ── Load Leaflet CDN ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return
    if (window.L) { setLeafletReady(true); return }
    const link = Object.assign(document.createElement('link'),
      { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
    document.head.appendChild(link)
    const script = Object.assign(document.createElement('script'),
      { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', onload: () => setLeafletReady(true) })
    document.head.appendChild(script)
  }, [visible])

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible || !leafletReady || !mapRef.current || mapInstance.current) return
    const L = window.L
    const center = gpsPos ? [gpsPos.lat, gpsPos.lng]
      : nearestMissed?.lat ? [Number(nearestMissed.lat), Number(nearestMissed.lng)]
        : LUCENA_FALLBACK
    const map = L.map(mapRef.current, { center, zoom: 15, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    mapInstance.current = map
    setTimeout(() => map.invalidateSize(), 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leafletReady])

  // ── Place missed stop markers ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current || !window.L || !missedStops.length) return
    const L = window.L

    // Clear old markers
    missedMarkersRef.current.forEach(m => { try { mapInstance.current.removeLayer(m) } catch { } })
    missedMarkersRef.current = []

    // Inject pulse keyframe once
    if (!document.getElementById('tnf-styles')) {
      const s = document.createElement('style')
      s.id = 'tnf-styles'
      s.textContent = `
        @keyframes tnfPulse { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.75);opacity:0} }
        .tnf-missed-icon { background:transparent!important;border:0!important;box-shadow:none!important; }
      `
      document.head.appendChild(s)
    }

    missedStops.forEach((wp, i) => {
      if (!wp.lat || !wp.lng) return
      const isNearest = nearestMissed && wp.idx === nearestMissed.idx
      const size = isNearest ? 36 : 28
      const html = `
        <div style="position:relative;width:${size}px;height:${size}px;">
          <span style="position:absolute;inset:-6px;border-radius:50%;
            border:2.5px solid #ef4444;opacity:0.6;
            animation:tnfPulse ${isNearest ? '1.4' : '2'}s ease infinite;
            pointer-events:none;"></span>
          <div style="position:absolute;inset:0;background:#ef4444;
            border:${isNearest ? 3 : 2}px solid #fff;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            font-size:${isNearest ? 14 : 11}px;font-weight:900;color:#fff;
            box-shadow:0 2px 12px rgba(239,68,68,.55);">
            ${isNearest ? '×' : i + 1}
          </div>
        </div>`

      const marker = L.marker([Number(wp.lat), Number(wp.lng)], {
        icon: L.divIcon({ html, className: 'tnf-missed-icon', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        zIndexOffset: isNearest ? 1000 : 0,
      })
        .addTo(mapInstance.current)
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:160px;">
            <b style="font-size:13px;">❌ ${wp.label || 'Stop ' + wp.idx}</b><br/>
            <span style="font-size:11px;color:#ef4444;font-weight:700;">MISSED STOP</span>
            ${isNearest ? '<div style="margin-top:4px;font-size:10px;color:#64748b;">← Nearest to you</div>' : ''}
          </div>`)

      missedMarkersRef.current.push(marker)
    })

    // Fit map to show all missed stops only once on load
    if (missedMarkersRef.current.length > 0 && !hasFitBoundsRef.current) {
      const group = L.featureGroup(missedMarkersRef.current)
      mapInstance.current.fitBounds(group.getBounds().pad(0.25))
      hasFitBoundsRef.current = true
    }
  }, [missedStops, leafletReady, nearestMissed])

  // ── Driver marker + follow GPS ─────────────────────────────────────────────
  useEffect(() => {
    if (!gpsPos || !mapInstance.current || !window.L) return
    const L = window.L
    const html = `<div style="position:relative;width:18px;height:18px;">
      <span style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #2563eb;opacity:0.4;animation:tnfPulse 2s ease infinite;"></span>
      <div style="position:absolute;inset:0;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 0 12px rgba(37,99,235,.7);"></div>
    </div>`
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = L.marker([gpsPos.lat, gpsPos.lng], {
        icon: L.divIcon({ html, className: '', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 2000,
      }).addTo(mapInstance.current)
    } else {
      driverMarkerRef.current.setLatLng([gpsPos.lat, gpsPos.lng])
    }
  }, [gpsPos, leafletReady])

  // ── ORS route to nearest missed stop ──────────────────────────────────────
  // Re-fetches only when the nearest stop changes (not on every GPS tick).
  // Falls back to straight-line haversine if ORS fails or key is missing.
  useEffect(() => {
    if (!visible || !nearestMissed?.lat || !gpsPos) return

    // Abort previous in-flight request
    if (orsAbortRef.current) orsAbortRef.current.abort()
    const ctrl = new AbortController()
    orsAbortRef.current = ctrl

    async function fetchOrsRoute() {
      setOrsLoading(true)
      setOrsIsFallback(false)

      // Remove previous polyline
      if (orsPolylineRef.current && mapInstance.current) {
        try { mapInstance.current.removeLayer(orsPolylineRef.current) } catch { }
        orsPolylineRef.current = null
      }

      const destLat = Number(nearestMissed.lat), destLng = Number(nearestMissed.lng)

      if (!ORS_API_KEY) {
        // No key — use straight-line haversine
        setOrsDist(haversineDistance(gpsPos.lat, gpsPos.lng, destLat, destLng))
        setOrsIsFallback(true)
        setOrsLoading(false)
        return
      }

      try {
        const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: ORS_API_KEY },
          body: JSON.stringify({ coordinates: [[gpsPos.lng, gpsPos.lat], [destLng, destLat]], instructions: true }),
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error(`ORS ${res.status}`)
        const data = await res.json()
        const route = data.routes?.[0]
        if (!route) throw new Error('No route')

        setOrsDist(route.summary.distance)
        setOrsData(route)
        setOrsIsFallback(false)

        // Draw polyline
        if (mapInstance.current && window.L) {
          const pts = decodeOrsPolyline(route.geometry)
          orsPolylineRef.current = window.L.polyline(pts, {
            color: '#ef4444', weight: 4, opacity: 0.75,
            dashArray: '8 6',
          }).addTo(mapInstance.current)
        }
      } catch (err) {
        if (err.name === 'AbortError') return
        // Fallback to straight-line
        setOrsDist(haversineDistance(gpsPos.lat, gpsPos.lng, destLat, destLng))
        setOrsIsFallback(true)
      } finally {
        setOrsLoading(false)
      }
    }

    fetchOrsRoute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, nearestMissed?.idx, orsFetchKey])

  // ── Reassigned stops hook (other drivers' missed stops) ───────────────────
  useReassignedStops({
    enabled: visible,
    scheduleId: schedule?.id,
    onNewStops: (newStops) => {
      setReassignedStops(prev => {
        const existingIds = new Set(prev.map(s => s.pickup_status_id ?? s.stop_order))
        const fresh = newStops.filter(s => !existingIds.has(s.pickup_status_id ?? s.stop_order))
        return fresh.length ? [...prev, ...fresh] : prev
      })
    },
  })

  // ── Reassigned stop markers (purple) ─────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current || !window.L || !reassignedStops.length) return
    const L = window.L
    reassignedMarkersRef.current.forEach(m => { try { mapInstance.current.removeLayer(m) } catch { } })
    reassignedMarkersRef.current = []

    reassignedStops.forEach((wp) => {
      const lat = Number(wp.lat ?? wp.latitude), lng = Number(wp.lng ?? wp.longitude)
      if (!lat || !lng) return
      const html = `<div style="position:relative;width:28px;height:28px;">
        <span style="position:absolute;inset:-6px;border-radius:50%;border:2.5px solid #a855f7;opacity:0.55;animation:tnfPulse 2.2s ease infinite;"></span>
        <div style="position:absolute;inset:0;background:#a855f7;border:2px solid #fff;border-radius:50%;
          display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff;
          box-shadow:0 2px 12px rgba(168,85,247,.5);">↓</div>
      </div>`
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({ html, className: 'tnf-missed-icon', iconSize: [28, 28], iconAnchor: [14, 14] }),
        zIndexOffset: 500,
      }).addTo(mapInstance.current)
        .bindPopup(`<div style="font-family:sans-serif;min-width:140px;"><b style="font-size:12px;">🟣 ${wp.label || 'Reassigned Stop'}</b><br/><span style="font-size:10px;color:#a855f7;font-weight:700;">AVAILABLE NEARBY</span></div>`)
      reassignedMarkersRef.current.push(marker)
    })
  }, [reassignedStops, leafletReady])

  // ── Cleanup map on unmount / hide ──────────────────────────────────────────
  useEffect(() => {
    if (!visible && mapInstance.current) {
      if (orsAbortRef.current) orsAbortRef.current.abort()
      mapInstance.current.remove()
      mapInstance.current = null
      driverMarkerRef.current = null
      missedMarkersRef.current = []
      reassignedMarkersRef.current = []
      orsPolylineRef.current = null
    }
  }, [visible])

  // ── GPS pill values ────────────────────────────────────────────────────────
  const gpsColor = gpsError ? '#ef4444' : !isTracking ? '#f59e0b'
    : gpsAccuracy != null && gpsAccuracy >= 50 ? '#f59e0b' : '#2ecc71'
  const gpsLabel = gpsError ? 'GPS Lost' : !isTracking ? 'GPS…'
    : gpsAccuracy != null ? `GPS ±${Math.round(gpsAccuracy)}m` : 'GPS Active'

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleExtendedMode() {
    if (loading || !shift?.id) return
    setLoading(true)
    try {
      await api.post(`/api/driver/shift/${shift.id}/extended_mode/`, {
        missed_stop_orders: missedStopOrders,
        schedule_id: schedule?.id,
      })
      sessionStorage.setItem('ww_extended_mode', 'true')
      sessionStorage.removeItem('ww_route_complete')
      setExtendedActivated(true) // show 'Waiting for new stops…' banner
      onExtendedMode?.()
    } catch (err) {
      notify({ variant: 'error-dark', message: err.response?.data?.error || 'Failed to activate extended mode.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleEndShift() {
    if (loading || !shift?.id) return
    // Remove the premature api.post call here.
    // EndShiftModule is responsible for handling the dumpsite visit and making
    // the final /api/driver/shift/end/ API call with the missedStopOrders.
    sessionStorage.removeItem('ww_route_complete')
    onEndShift?.()
  }

  if (!visible) return null

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes tnfPulse { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.75);opacity:0} }
        @keyframes tnfFadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes tnfSpin { to{transform:rotate(360deg)} }
      `}</style>

      {/* Main container fills viewport BELOW the navbar */}
      <div style={{
        position: 'fixed', top: 60, bottom: 0, left: 0, right: 0, zIndex: 900,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-body)', background: '#1e293b',
        overflow: 'hidden'
      }}>

        {/* ── MAP ── */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {/* DEV: teleport to nearest missed */}
          {import.meta.env.DEV && nearestMissed?.lat && (
            <div style={{ position: 'absolute', top: '50%', right: 14, marginTop: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => {
                  const lat = Number(nearestMissed.lat), lng = Number(nearestMissed.lng)
                  setMockGps({ lat, lng })
                  mapInstance.current?.panTo([lat, lng])
                }}
                title="DEV: Teleport to nearest missed stop"
                style={{ width: 44, height: 44, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.3)', fontSize: 18 }}
              >❌</button>
              {isMock && (
                <button onClick={() => setMockGps(null)} title="Clear Mock GPS"
                  style={{ width: 44, height: 44, borderRadius: '50%', background: '#64748b', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, fontWeight: 800, color: '#fff' }}>✕</button>
              )}
            </div>
          )}
        </div>

        {/* ── HEADER ── */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          background: 'rgba(15,23,42,0.93)', backdropFilter: 'blur(8px)',
          padding: '76px 18px 16px', color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,.25)',
        }}>
          {/* Pills */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${gpsColor}18`, border: `1px solid ${gpsColor}44`, borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: gpsColor, display: 'inline-block', animation: isTracking && !gpsError ? 'tnfPulse 2s ease infinite' : 'none' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: gpsColor, letterSpacing: '.04em' }}>{gpsLabel}</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', letterSpacing: '.04em' }}>
                {missedStops.length} MISSED STOP{missedStops.length !== 1 ? 'S' : ''}
              </span>
            </div>
          </div>

          {/* Route summary */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'rgba(255,255,255,0.15)', borderRadius: 8, marginTop: 1 }}>
              <RouteIcon size={16} color="#fff" />
            </span>
            <div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>
                Route Complete
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)' }}>
                {collectedCount} of {totalStops} stops collected · {missedStops.length} missed
              </div>
            </div>
          </div>
        </div>

        {/* ── NEAREST MISSED STOP CARD ── */}
        {nearestMissed && (!orsDist || orsDist > 30) && (
          <div style={{
            position: 'absolute', top: 182, left: 14, right: 14, zIndex: 10,
            background: 'rgba(255,255,255,0.97)', borderRadius: 16,
            overflow: 'hidden', display: 'flex', alignItems: 'stretch',
            boxShadow: '0 6px 28px rgba(0,0,0,.18)',
            animation: 'tnfFadeUp .25s ease',
          }}>
            <div style={{
              width: 76, flexShrink: 0,
              background: `${accentColor}12`,
              borderRight: `3px solid ${accentColor}28`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '16px 0',
            }}>
              <TurnArrow type={stepType} bearing={stepBearing} color={accentColor} size={42} />
            </div>
            <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 3 }}>
                NEAREST MISSED STOP
              </div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900, color: '#0f172a', lineHeight: 1.2, marginBottom: 4 }}>
                {orsInstruction}
              </div>
              <div style={{ fontSize: 13, color: accentColor, fontWeight: 700 }}>{distLabel}</div>
            </div>
          </div>
        )}

        {/* ── BOTTOM PANEL ── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
          background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          boxShadow: '0 -4px 24px rgba(0,0,0,.12)',
          display: 'flex', flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        }}>
          {/* Drag pill (clickable to toggle panel) */}
          <div
            onClick={() => setIsPanelExpanded(p => !p)}
            style={{ padding: '12px 0', cursor: 'pointer', display: 'flex', justifyContent: 'center' }}
          >
            <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2 }} />
          </div>

          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            <button onClick={() => setIsPanelExpanded(p => !p)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11, fontWeight: 800, letterSpacing: '.05em', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {isPanelExpanded ? 'HIDE ROUTE ACTIONS' : 'SHOW ROUTE ACTIONS'}
              <span style={{ transform: isPanelExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', fontSize: 14 }}>▼</span>
            </button>
          </div>

          {/* ── COLLAPSIBLE CONTENT (STATS + ACTIONS) ── */}
          {isPanelExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', maxHeight: '55vh' }}>

              {/* ── STATS ROW + INLINE LEGEND ── */}
              <div style={{
                padding: '0px 12px 14px', display: 'flex', flexDirection: 'column',
                borderBottom: '1px solid rgba(0,0,0,.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {[
                    { value: collectedCount, label: 'collected' },
                    { value: missedStops.length, label: 'missed', red: true },
                    { value: totalStops, label: 'total' },
                  ].map((cell, i, arr) => (
                    <div key={cell.label} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                      <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
                        <div style={{
                          fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900,
                          color: cell.red ? '#dc2626' : '#0f172a',
                        }}>{cell.value}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2 }}>{cell.label}</div>
                      </div>
                      {i < arr.length - 1 && <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />}
                    </div>
                  ))}
                </div>
                {/* Inline legend — only shown when there's something to explain */}
                {(missedStops.length > 0 || reassignedStops.length > 0) && (
                  <div style={{
                    display: 'flex', gap: 14, justifyContent: 'center',
                    marginTop: 10, fontSize: 11, color: '#64748b', fontWeight: 600,
                  }}>

                    {reassignedStops.length > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#a855f7', display: 'inline-block', flexShrink: 0 }} />
                        Available nearby
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* ── ACTION AREA ── */}
              <div style={{ padding: '16px 20px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* Waiting for new stops — shown right after extended mode API succeeds */}
                {extendedActivated && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.3)',
                    borderRadius: 12, padding: '10px 14px',
                  }}>
                    <span style={{ width: 14, height: 14, border: '2px solid #a855f7', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'tnfSpin .9s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700, lineHeight: 1.4 }}>
                      Extended mode active — waiting for nearby stops to appear on the map…
                    </span>
                  </div>
                )}

                {missedStops.length > 0 && (
                  <div style={{ textAlign: 'center', marginBottom: 4 }}>
                    <p style={{
                      fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800,
                      color: '#0f172a', margin: '0 0 2px',
                    }}>
                      Still capacity left?
                    </p>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
                      Activate extended mode to collect missed stops
                    </p>
                  </div>
                )}

                {/* Primary — Extended Mode */}
                {missedStops.length > 0 && (
                  <button
                    id="tnf-extend-btn"
                    disabled={loading}
                    onClick={handleExtendedMode}
                    style={{
                      width: '100%', padding: '17px 20px', borderRadius: 30, border: 'none',
                      background: loading ? '#e2e8f0' : '#0f172a',
                      color: loading ? '#94a3b8' : '#fff',
                      fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      boxShadow: loading ? 'none' : '0 6px 20px rgba(15,23,42,.3)',
                      letterSpacing: '.04em',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      transition: 'all .2s',
                    }}
                  >
                    {loading
                      ? <><span style={{ width: 16, height: 16, border: '2px solid #94a3b8', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'tnfSpin .7s linear infinite' }} /> Activating…</>
                      : '📦 My Truck is Still Not Full'}
                  </button>
                )}

                {/* Secondary — End Shift */}
                <button
                  id="tnf-end-btn"
                  disabled={loading}
                  onClick={handleEndShift}
                  style={{
                    width: '100%', padding: '16px 20px', borderRadius: 30,
                    border: '1.5px solid #e2e8f0',
                    background: loading ? '#f8fafc' : '#fff',
                    color: loading ? '#94a3b8' : '#64748b',
                    fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 800,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    letterSpacing: '.03em', transition: 'all .2s',
                    marginBottom: 4,
                  }}
                >
                  {loading ? 'Processing…' : "✓ I'm Done — End Shift"}
                </button>

                {/* DEV skip */}
                {import.meta.env.DEV && (
                  <button onClick={() => onEndShift?.()}
                    style={{ width: '100%', padding: '8px', borderRadius: 20, background: 'none', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    DEV: Skip End Shift
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
