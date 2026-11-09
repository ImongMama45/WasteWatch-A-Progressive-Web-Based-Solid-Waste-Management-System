/**
 * RouteOverview.jsx — Driver Route Overview
 * ------------------------------------------
 * Shows:
 *  - Full Leaflet map with driver location, route path, and stop markers
 *  - Responsive split layout (desktop side-by-side, mobile stacked)
 *  - Map HUD with Recenter, Fit Route, and Active Target overlay
 *  - Weekday schedule switcher with route indicators
 *  - Interactive stops timeline with status badges and live distance
 *  - Non-blocking floating bottom action bar
 *  - Strictly SVG icons (NO emojis) in compliance with project rules
 *
 * Leaflet loaded via CDN (window.L) — same pattern as MiniMap.jsx
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Truck,
  MapPin,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Play,
  ArrowRight,
  Crosshair,
  Maximize2,
  Navigation,
  Check,
  Building2,
  Trash2,
  Info,
  Sparkles,
  Ban
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import useGpsTracking from '../../hooks/useGpsTracking'
import useShiftTimer from '../../hooks/useShiftTimer'
import { buildStopValidationSnapshot, normalizeStopStatus } from '../../utils/pickupStatusSync'
import { extractArray, evaluateScheduleShiftTiming } from '../../utils/driverSchedule'
import DriverSuiteTabs from './components/DriverSuiteTabs'
import DriverSuiteHeader from './components/DriverSuiteHeader'
import DriverStatusPanel from './DriverStatusPanel'
import DriverCollectionLog from './DriverCollectionLog'
import DriverHotspotAlert from './DriverHotspotAlert'
import { MapSkeleton, FeedCardSkeleton, SidebarWidgetSkeleton } from '../../components/ui/Skeleton'

// ─── ROUTE HELPERS ────────────────────────────────────────────────────────────

// Get YYYY-MM-DD date for a given day name in the current week (Mon-Sun)
function getDateForDay(dayName) {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const today = new Date()
  const todayIdx = (today.getDay() + 6) % 7
  const target = new Date(today)
  target.setDate(today.getDate() + (names.indexOf(dayName) - todayIdx))
  const p = n => String(n).padStart(2, '0')
  return `${target.getFullYear()}-${p(target.getMonth() + 1)}-${p(target.getDate())}`
}

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

const STATUS_CONFIG = {
  completed: {
    label: 'Completed',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.3)',
  },
  current: {
    label: 'Current Target',
    color: '#2563eb',
    bg: 'rgba(37, 99, 235, 0.12)',
    border: 'rgba(37, 99, 235, 0.3)',
  },
  pending: {
    label: 'Pending',
    color: '#64748b',
    bg: 'rgba(100, 116, 139, 0.08)',
    border: 'rgba(100, 116, 139, 0.2)',
  },
}

// ─── MAP MARKER FACTORIES (STRICTLY SVG - ZERO EMOJIS) ──────────────────────────

function makeStopIcon(L, stop) {
  const isCurrent = stop.status === 'current'
  const isCompleted = stop.status === 'completed'
  const size = isCurrent ? 38 : 28

  let innerContent = `${stop.order}`
  if (isCompleted) {
    innerContent = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    `
  }

  const bgColor = isCompleted ? '#10b981' : isCurrent ? '#2563eb' : '#64748b'
  const pulseStyle = isCurrent ? 'animation: roPulseRing 2s ease infinite;' : ''

  const html = `
    <div style="
      width:${size}px; height:${size}px; border-radius:50%;
      background:${bgColor}; border: 2.5px solid #ffffff;
      display:flex; align-items:center; justify-content:center;
      box-shadow: 0 3px 12px rgba(0,0,0,0.28);
      color:#ffffff; font-weight:800; font-size:${isCurrent ? 14 : 12}px;
      ${pulseStyle}
    ">
      ${innerContent}
    </div>
  `
  return L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function makeDriverIcon(L) {
  const html = `
    <div style="
      width:44px; height:44px; border-radius:50%;
      background: linear-gradient(135deg, #1e293b, #0f172a);
      border: 3px solid #10b981;
      display: flex; align-items: center; justify-content: center;
      color: #10b981; box-shadow: 0 4px 16px rgba(16, 185, 129, 0.45);
      animation: roPulseRing 2.5s ease infinite;
    ">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
        <path d="M15 18H9"/>
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
        <circle cx="17" cy="18" r="2"/>
        <circle cx="7" cy="18" r="2"/>
      </svg>
    </div>
  `
  return L.divIcon({ html, className: '', iconSize: [44, 44], iconAnchor: [22, 22] })
}

function makeHomeIcon(L) {
  const html = `
    <div style="
      width:34px; height:34px; border-radius:50%;
      background: #ffffff; border: 2.5px solid #2563eb;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 3px 10px rgba(37,99,235,0.3); color: #2563eb;
    ">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    </div>
  `
  return L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17] })
}

function makeDumpsiteIcon(L) {
  const html = `
    <div style="
      width:34px; height:34px; border-radius:50%;
      background: #dc2626; border: 2.5px solid #ffffff;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 3px 10px rgba(220,38,38,0.35); color: #ffffff;
    ">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/>
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
      </svg>
    </div>
  `
  return L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17] })
}

// ─── STOP CARD ───────────────────────────────────────────────────────────────

function StopCard({ stop, isNext, onFocus, focused, gpsPosition, isLast }) {
  const cfg = STATUS_CONFIG[stop.status] || STATUS_CONFIG.pending

  const distance = (() => {
    if (stop.status === 'completed') return null
    if (gpsPosition) {
      const d = haversineDistance(gpsPosition.lat, gpsPosition.lng, stop.lat, stop.lng)
      return d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`
    }
    return stop.distance || null
  })()

  return (
    <div className="ro-timeline-node" style={{ position: 'relative', display: 'flex', gap: 14 }}>
      {/* Timeline connector line */}
      {!isLast && (
        <div style={{
          position: 'absolute',
          left: 17,
          top: 36,
          bottom: -16,
          width: 2,
          background: stop.status === 'completed' ? '#10b981' : 'var(--border)',
          opacity: 0.6,
          zIndex: 0,
        }} />
      )}

      {/* Stop order circle indicator */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          flexShrink: 0,
          background: stop.status === 'completed' ? '#10b981' : stop.status === 'current' ? '#2563eb' : 'var(--surface)',
          border: `2px solid ${cfg.color}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: 13,
          color: stop.status === 'pending' ? cfg.color : '#ffffff',
          boxShadow: focused ? `0 0 0 4px ${cfg.bg}` : 'none',
          transition: 'all 0.2s ease',
          zIndex: 1,
        }}
      >
        {stop.status === 'completed' ? (
          <Check size={16} strokeWidth={3} />
        ) : (
          stop.order
        )}
      </div>

      {/* Stop card body */}
      <div
        id={`stop-card-${stop.id}`}
        onClick={() => onFocus(stop)}
        style={{
          flex: 1,
          minWidth: 0,
          background: focused ? 'rgba(37, 99, 235, 0.05)' : 'var(--surface)',
          border: `1.5px solid ${focused ? '#2563eb' : stop.status === 'current' ? '#3b82f6' : 'var(--border)'}`,
          borderRadius: 14,
          padding: '12px 14px',
          marginBottom: 14,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: focused ? '0 4px 14px rgba(37,99,235,0.14)' : '0 1px 3px rgba(0,0,0,0.02)',
        }}
        className="ro-stop-card"
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Header: address + Next indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {stop.address}
              </span>
              {isNext && (
                <span style={{
                  background: 'rgba(37, 99, 235, 0.12)',
                  color: '#2563eb',
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: 12,
                  letterSpacing: '0.04em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}>
                  <Navigation size={10} /> NEXT
                </span>
              )}
            </div>

            {/* Badges / metadata */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                background: cfg.bg,
                color: cfg.color,
                border: `1px solid ${cfg.border}`,
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 99,
              }}>
                {cfg.label.toUpperCase()}
              </span>

              {stop.zone && (
                <span style={{
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}>
                  <MapPin size={11} /> {stop.zone}
                </span>
              )}

              {distance && (
                <span style={{
                  background: 'rgba(37, 99, 235, 0.08)',
                  color: '#2563eb',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 99,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}>
                  <Navigation size={10} /> {distance}
                </span>
              )}

              {stop.completedAt && (
                <span style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  color: '#10b981',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 99,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}>
                  <Clock size={11} /> {stop.completedAt}
                </span>
              )}
            </div>
          </div>

          {/* Quick Focus Button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFocus(stop)
            }}
            title="Focus on map"
            style={{
              background: focused ? '#2563eb' : 'var(--surface-hover, rgba(0,0,0,0.04))',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 6,
              color: focused ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.15s ease',
            }}
          >
            <Crosshair size={14} />
          </button>
        </div>
      </div>
    </div>
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
  const drawIdRef = useRef(0)

  const [leafletReady, setLeafletReady] = useState(false)
  const [schedules, setSchedules] = useState([])
  const [selectedDay, setSelectedDay] = useState(new Date().toLocaleDateString('en-US', { weekday: 'long' }))
  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const isTodaySelected = selectedDay === todayStr
  const [schedule, setSchedule] = useState(null)
  const [profile, setProfile] = useState(null)
  const [stops, setStops] = useState([])
  const [mapLoading, setMapLoading] = useState(true)
  const [focusedId, setFocusedId] = useState(null)
  const [overlayView, setOverlayView] = useState(null) // 'status' | 'logs' | null

  const { shiftActive } = useShiftTimer()

  // ── Live GPS tracking ────────────────────────────────────────────────────────
  const { position: gpsPosition, accuracy: gpsAccuracy, error: gpsError, isTracking } =
    useGpsTracking({ intervalMs: 10_000, enabled: true, syncEnabled: shiftActive })

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
    let ignore = false
    setMapLoading(true)
    api.get('/api/driver/collection-schedules/?paginate=false')
      .then(async res => {
        if (ignore) return
        const matches = extractArray(res.data).filter(s => String(s.driver) === String(user.id))
        setSchedules(matches)

        const activeMatch = matches.find(s => {
          let days = []
          if (Array.isArray(s.days)) days = s.days
          else if (typeof s.days === 'string') days = s.days.split(',').map(d => d.trim())
          return days.some(d => d.toLowerCase().startsWith(selectedDay.substring(0, 3).toLowerCase()))
        })

        setSchedule(activeMatch || null)
        if (!activeMatch) { setStops([]); return }

        const targetDateStr = getDateForDay(selectedDay)
        const [currentRes, valRes] = await Promise.all([
          selectedDay === todayStr
            ? api.get('/api/driver/stops/current/').catch(() => ({ data: null }))
            : Promise.resolve({ data: null }),
          api.get(`/api/watcher/stop-validations/?schedule_id=${encodeURIComponent(activeMatch.id)}&date=${targetDateStr}`).catch(() => ({ data: null })),
        ])
        if (ignore) return

        const currentStopOrder = Number(currentRes.data?.order) || null
        const rows = valRes.data?.results ?? valRes.data ?? []
        const snapshot = buildStopValidationSnapshot(rows)

        const builtStops = (activeMatch.waypoints || []).slice(1).map((wp, i) => {
          const wpIndex = i + 1
          const key = `${activeMatch.id}:${wpIndex}`
          const normalized = normalizeStopStatus(snapshot.statusMap.get(key) || 'PENDING_INSPECTION')
          const details = snapshot.detailsMap.get(key)
          return {
            id: wpIndex,
            order: wpIndex,
            address: wp.label || wp.name || `Stop ${wpIndex}`,
            zone: wp.barangay || activeMatch.barangay_names || '',
            type: 'Waste Collection',
            lat: Number(wp.lat),
            lng: Number(wp.lng),
            status: mapBackendStatus(normalized, wpIndex === currentStopOrder),
            distance: null,
            completedAt: details?.collectedAt || null,
          }
        })
        setStops(builtStops)
      })
      .catch(() => { if (!ignore) { setSchedule(null); setStops([]) } })
      .finally(() => { if (!ignore) setMapLoading(false) })
    return () => { ignore = true }
  }, [user?.id, selectedDay])

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

  // ── 4. Init map once ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: [13.9373, 121.617], zoom: 15, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapInstance.current = map
    const t = setTimeout(() => map.invalidateSize(), 250)
    return () => {
      clearTimeout(t)
      map.remove()
      mapInstance.current = null
      markersRef.current = {}
      driverRef.current = null
    }
  }, [leafletReady])

  function clearMap() {
    drawIdRef.current++
    const map = mapInstance.current
    if (!map) return
    Object.values(markersRef.current).forEach(m => { try { map.removeLayer(m) } catch { } })
    markersRef.current = {}
  }

  // ── 5. Redraw whenever stops change ──────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapInstance.current || !window.L) return
    if (!stops.length || !schedule) { clearMap(); return }
    drawMap(mapInstance.current, stops, schedule)
  }, [stops, schedule, leafletReady]) // eslint-disable-line

  // ── Draw markers + ORS road-snapped route ────────────────────────────────────
  function drawMap(map, stopsData, sched) {
    const L = window.L

    // Clear previous markers
    clearMap()
    const myDrawId = drawIdRef.current

    if (!stopsData.length) return

    // Stop markers
    stopsData.forEach(stop => {
      const m = L.marker([stop.lat, stop.lng], { icon: makeStopIcon(L, stop) })
        .addTo(map)
        .on('click', () => focusStop(stop))
      markersRef.current[stop.id] = m
    })

    // Home Base Marker
    if (sched?.waypoints?.length) {
      const sp = sched.waypoints[0]
      const hm = L.marker([sp.lat, sp.lng], { icon: makeHomeIcon(L) }).addTo(map)
      hm.bindPopup(`<b>Start Depot</b><br>${sp.label || 'Home Base'}`)
      markersRef.current['base'] = hm
    }

    // Dumpsite Marker
    if (sched?.dumpsite_detail) {
      const ds = sched.dumpsite_detail
      const dm = L.marker([+ds.latitude, +ds.longitude], { icon: makeDumpsiteIcon(L) }).addTo(map)
      dm.bindPopup(`<b>Dumpsite: ${ds.name}</b>`)
      markersRef.current['dumpsite'] = dm
    }

    // Full Route Path
    const allPts = []
    if (sched?.waypoints?.length) allPts.push(sched.waypoints[0])
    stopsData.forEach(s => allPts.push(s))
    if (sched?.dumpsite_detail) allPts.push({ lat: +sched.dumpsite_detail.latitude, lng: +sched.dumpsite_detail.longitude })
    if (sched?.waypoints?.length) allPts.push(sched.waypoints[0])

    let fallbackLine = null
    if (allPts.length > 1) {
      fallbackLine = L.polyline(allPts.map(p => [p.lat, p.lng]), {
        color: '#10b981', weight: 3.5, opacity: 0.45, dashArray: '6,6',
      }).addTo(map)
      markersRef.current['route_fallback'] = fallbackLine
      map.fitBounds(fallbackLine.getBounds(), { padding: [40, 40] })
    }

    // ORS road-snapped route
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey || allPts.length < 2) return

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: orsApiKey,
      },
      body: JSON.stringify({ coordinates: allPts.slice(0, 50).map(p => [p.lng, p.lat]) }),
    })
      .then(r => r.json())
      .then(data => {
        if (myDrawId !== drawIdRef.current || !data.routes?.length || !mapInstance.current) return
        if (fallbackLine) map.removeLayer(fallbackLine)
        const pts = decodePolyline(data.routes[0].geometry)
        const orsLine = L.polyline(pts, { color: '#10b981', weight: 4.5, opacity: 0.85 }).addTo(map)
        markersRef.current['route_ors'] = orsLine
      })
      .catch(() => { })
  }

  // ── 6. Driver marker (only with a real GPS fix) ──
  useEffect(() => {
    const L = window.L, map = mapInstance.current
    if (!L || !map) return
    if (!gpsPosition) {
      if (driverRef.current) { map.removeLayer(driverRef.current); driverRef.current = null }
      return
    }
    const ll = [gpsPosition.lat, gpsPosition.lng]
    if (driverRef.current) driverRef.current.setLatLng(ll)
    else driverRef.current = L.marker(ll, { icon: makeDriverIcon(L), zIndexOffset: 1000 })
      .addTo(map).bindPopup('<b>Driver Location</b>')
  }, [gpsPosition, leafletReady])

  // ── Map Actions ─────────────────────────────────────────────────────────────
  const focusStop = useCallback((stop) => {
    setFocusedId(stop.id)
    if (mapInstance.current) mapInstance.current.flyTo([stop.lat, stop.lng], 16, { duration: 0.6 })
    const el = document.getElementById(`stop-card-${stop.id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const fitRouteBounds = useCallback(() => {
    if (!mapInstance.current) return
    const routeLayer = markersRef.current['route_ors'] || markersRef.current['route_fallback']
    if (routeLayer) {
      mapInstance.current.fitBounds(routeLayer.getBounds(), { padding: [40, 40] })
    } else if (stops.length > 0) {
      const latlngs = stops.map(s => [s.lat, s.lng])
      mapInstance.current.fitBounds(latlngs, { padding: [40, 40] })
    }
  }, [stops])

  const recenterDriver = useCallback(() => {
    if (!mapInstance.current) return
    if (!gpsPosition) { fitRouteBounds(); return }
    mapInstance.current.flyTo([gpsPosition.lat, gpsPosition.lng], 16, { duration: 0.6 })
  }, [gpsPosition, fitRouteBounds])

  const weekdays = useMemo(() => [
    { full: 'Monday', short: 'Mon' },
    { full: 'Tuesday', short: 'Tue' },
    { full: 'Wednesday', short: 'Wed' },
    { full: 'Thursday', short: 'Thu' },
    { full: 'Friday', short: 'Fri' },
    { full: 'Saturday', short: 'Sat' },
    { full: 'Sunday', short: 'Sun' },
  ], [])

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes roPulseRing {
          0%, 100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.4); }
          50% { box-shadow: 0 0 0 10px rgba(37, 99, 235, 0); }
        }
        @keyframes roGpsPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.15); }
        }
        .ro-container {
          max-width: 1240px;
          margin: 0 auto;
          padding: 20px 24px 120px;
        }
        .ro-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 20px;
          
        }
        .ro-desktop-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
          
        }
        @media (min-width: 1024px) {
          .ro-desktop-grid {
            grid-template-columns: 1.15fr 0.85fr;
            align-items: start;
          }
          .ro-map-sticky {
            position: sticky;
            top: 20px;
          }
        }
        .ro-hud-btn {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(0,0,0,0.12);
          border-radius: 8px;
          padding: 7px 11px;
          font-size: 11px;
          font-weight: 700;
          color: #1e293b;
          display: flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          transition: all 0.15s ease;
        }
        .ro-hud-btn:hover {
          background: #ffffff;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.18);
        }
        .ro-day-btn {
          flex: 1 0 54px;
          min-width: 54px;
          height: 52px;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .ro-day-btn:hover {
          transform: translateY(-1px);
        }
        .ro-stop-card:hover {
          border-color: #3b82f6 !important;
          transform: translateY(-1px);
        }
      `}
      </style>

      <div className="ro-container">

        {/* ── UNIFIED DRIVER SUITE HEADER ── */}
        <DriverSuiteHeader
          activeTab="route"
          title="My Route"
          subtitle={isTodaySelected ? "Today's collection sequence and navigation map" : `Scheduled route for ${selectedDay}`}
          truck={profile?.truck || profile?.plateNumber}
          barangay={schedule?.barangay_names}
          shiftActive={shiftActive}
          opStatus={shiftActive ? 'on_shift' : 'off_shift'}
          onOpenOverlay={(modalKey) => setOverlayView(modalKey)}
          rightContent={
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Progress
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981' }}>
                  {completedCount}/{totalCount}
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginLeft: 4 }}>
                    ({progress}%)
                  </span>
                </div>
              </div>
              <div style={{ width: 44, height: 44 }}>
                <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth="3.5"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="3.5"
                    strokeDasharray={`${progress}, 100`}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          }
        />

        {/* ── DAY SELECTOR (MOVED TO TOP FOR CLARITY) ── */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '10px 12px',
          marginBottom: 20,
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              SCHEDULE DAYS
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
              Viewing: <strong style={{ color: 'var(--text)' }}>{selectedDay}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {weekdays.map(d => {
              const isActive = selectedDay === d.full
              const isToday = todayStr === d.full
              const scheduled = schedules.some(s => {
                let days = []
                if (Array.isArray(s.days)) days = s.days
                else if (typeof s.days === 'string') days = s.days.split(',').map(item => item.trim())
                return days.some(day => day.toLowerCase().startsWith(d.full.substring(0, 3).toLowerCase()))
              })

              return (
                <button
                  key={d.full}
                  onClick={() => setSelectedDay(d.full)}
                  className="ro-day-btn"
                  style={{
                    background: isActive ? '#10b981' : isToday ? 'rgba(16, 185, 129, 0.08)' : 'var(--surface-2, #ffffff)',
                    color: isActive ? '#ffffff' : isToday ? '#10b981' : scheduled ? 'var(--text)' : 'var(--text-muted)',
                    border: `1.5px solid ${isActive ? '#10b981' : isToday ? 'rgba(16, 185, 129, 0.35)' : scheduled ? 'var(--border)' : 'transparent'}`,
                    opacity: scheduled || isToday ? 1 : 0.45,
                    boxShadow: isActive ? '0 4px 12px rgba(16,185,129,0.3)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800 }}>{d.short}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
                    {isToday && (
                      <span style={{
                        fontSize: 8,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        padding: '1px 3px',
                        borderRadius: 4,
                        background: isActive ? 'rgba(255,255,255,0.25)' : '#10b981',
                        color: '#ffffff',
                      }}>
                        Today
                      </span>
                    )}
                    {scheduled && !isToday && (
                      <div style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: isActive ? '#ffffff' : '#10b981',
                      }} />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── GPS ERROR BANNER (STRICTLY SVG ICON - NO EMOJI) ── */}
        {gpsError && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.06)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#ef4444', flexShrink: 0,
            }}>
              <AlertTriangle size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>
                GPS Location Offline
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {gpsError}
              </div>
            </div>
          </div>
        )}

        {/* ── MAIN CONTENT GRID (MAP LEFT, TIMELINE RIGHT ON DESKTOP) ── */}
        <div className="ro-desktop-grid">

          {/* ── COLUMN 1: INTERACTIVE MAP ── */}
          <div className="ro-map-sticky">
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
              position: 'relative',
            }}>
              {/* Map HUD Top Bar */}
              <div style={{
                position: 'absolute',
                top: 14,
                left: 14,
                right: 14,
                zIndex: 400,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                pointerEvents: 'none',
              }}>
                {/* Live GPS badge */}
                <div style={{ pointerEvents: 'auto' }}>
                  {isTracking && gpsAccuracy ? (
                    <div style={{
                      background: 'rgba(15, 23, 42, 0.85)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: 20,
                      padding: '5px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 700,
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: '#10b981', animation: 'roGpsPulse 2s infinite',
                      }} />
                      GPS LIVE (±{gpsAccuracy}m)
                    </div>
                  ) : (
                    <div style={{
                      background: 'rgba(15, 23, 42, 0.8)',
                      backdropFilter: 'blur(8px)',
                      borderRadius: 20,
                      padding: '5px 12px',
                      color: '#94a3b8',
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
                      Route Map
                    </div>
                  )}
                </div>

                {/* HUD Map Actions */}
                <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
                  <button onClick={recenterDriver} className="ro-hud-btn" title="Center Driver">
                    <Crosshair size={14} /> Center Driver
                  </button>
                  <button onClick={fitRouteBounds} className="ro-hud-btn" title="Fit Entire Route">
                    <Maximize2 size={14} /> Fit Route
                  </button>
                </div>
              </div>

              {/* Leaflet Canvas */}
              <div
                ref={mapRef}
                style={{
                  width: '100%',
                  height: 'clamp(360px, 50vh, 540px)',
                  background: '#0f172a',
                }}
              />

              {!leafletReady && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 500 }}>
                  <MapSkeleton height="100%" dark label="Loading route map..." showControls={false} />
                </div>
              )}

              {/* Active stop floating overlay pill at bottom of map */}
              {currentStop && (
                <div style={{
                  position: 'absolute', bottom: 14, left: 14, right: 14, zIndex: 400,
                  background: 'rgba(15, 23, 42, 0.92)', backdropFilter: 'blur(12px)',
                  borderRadius: 14, padding: '10px 14px',
                  border: '1px solid rgba(37, 99, 235, 0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: '#2563eb', boxShadow: '0 0 10px #2563eb', flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: '#ffffff', fontSize: 13, fontWeight: 700,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {currentStop.address}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>Target Stop #{currentStop.order}</span>
                        {gpsPosition && (
                          <span>
                            · {(() => {
                              const d = haversineDistance(gpsPosition.lat, gpsPosition.lng, currentStop.lat, currentStop.lng)
                              return d > 1000 ? `${(d / 1000).toFixed(1)} km away` : `${Math.round(d)} m away`
                            })()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => focusStop(currentStop)}
                    style={{
                      background: 'rgba(37, 99, 235, 0.25)',
                      border: '1px solid rgba(37, 99, 235, 0.5)',
                      color: '#60a5fa',
                      borderRadius: 8,
                      padding: '5px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Navigation size={12} /> Focus
                  </button>
                </div>
              )}
            </div>

            {/* Map Legend */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              marginTop: 10,
              fontSize: 11,
              color: 'var(--text-muted)',
              flexWrap: 'wrap',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }} /> Start Depot
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} /> Collection Stops
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626' }} /> Lucena Dumpsite
              </span>
            </div>
          </div>

          {/* ── COLUMN 2: ROUTE SEQUENCE & TIMELINE ── */}
          <div>
            {/* NEXT STOP HERO CARD */}
            {mapLoading ? (
              <FeedCardSkeleton count={1} compact style={{ marginBottom: 14 }} />
            ) : nextStop && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(16, 185, 129, 0.06))',
                border: '1.5px solid rgba(37, 99, 235, 0.25)',
                borderRadius: 16,
                padding: '16px',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.06)',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: '#2563eb', color: '#ffffff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)',
                }}>
                  <Navigation size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', letterSpacing: '0.05em' }}>
                    NEXT STOP IN QUEUE
                  </div>
                  <div style={{
                    fontWeight: 800, fontSize: 15, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1,
                  }}>
                    {nextStop.address}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                    Stop #{nextStop.order} {nextStop.zone ? `· ${nextStop.zone}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => focusStop(nextStop)}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#2563eb',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  Map <ChevronRight size={14} />
                </button>
              </div>
            )}

            {/* STOPS TIMELINE SECTION */}
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              padding: '18px 20px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.02)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text)' }}>
                    Collection Stops Sequence
                  </h2>
                  <p style={{ margin: '2px 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Tap any stop to zoom and highlight on the map
                  </p>
                </div>
                <span style={{
                  background: 'var(--surface-2, rgba(0,0,0,0.04))',
                  border: '1px solid var(--border)',
                  borderRadius: 20,
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                }}>
                  {totalCount - completedCount} remaining
                </span>
              </div>

              {mapLoading ? (
                <SidebarWidgetSkeleton rows={4} />
              ) : stops.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '36px 16px',
                  color: 'var(--text-muted)',
                }}>
                  <div style={{
                    width: 54, height: 54, borderRadius: '50%',
                    background: 'var(--surface-2, rgba(0,0,0,0.04))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 12px', color: 'var(--text-muted)',
                  }}>
                    <Calendar size={24} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>
                    No Route Scheduled for {selectedDay}
                  </div>
                  <div style={{ fontSize: 13, maxWidth: 300, margin: '0 auto' }}>
                    There are no waste collection stops assigned to your truck on this day.
                  </div>
                </div>
              ) : (
                <div className="ww-stagger" style={{ marginTop: 8 }}>
                  {stops.map((stop, idx) => {
                    const isNext = nextStop?.id === stop.id
                    const isLast = idx === stops.length - 1
                    return (
                      <StopCard
                        key={stop.id}
                        stop={stop}
                        isNext={isNext}
                        focused={focusedId === stop.id}
                        onFocus={focusStop}
                        gpsPosition={gpsPosition}
                        isLast={isLast}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── FLOATING BOTTOM DOCK ACTION BAR (Today Only) ── */}
        {
          isTodaySelected && schedule && (() => {
            const dockTiming = evaluateScheduleShiftTiming(schedule)
            const isRouteFinished = (totalCount > 0 && completedCount === totalCount) || schedule.truck_status === 'completed'
            const isEndedEarly = schedule.truck_status === 'returning_unfinished'
            const isDockBlocked = !shiftActive && (user?.is_suspended || isRouteFinished || isEndedEarly)
            const isDockOffSchedule = !shiftActive && !isDockBlocked && dockTiming.isOffSchedule

            return (
              <div style={{
                position: 'fixed',
                bottom: 20,
                left: 16,
                right: 16,
                margin: '0 auto',
                maxWidth: 640,
                zIndex: 1000,
                background: 'rgba(255, 255, 255, 0.94)',
                backdropFilter: 'blur(16px)',
                padding: '12px 18px',
                borderRadius: 20,
                border: '1px solid rgba(0,0,0,0.1)',
                boxShadow: '0 12px 36px rgba(0,0,0,0.14)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
              }}>
                {/* Status info on left */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: user?.is_suspended
                      ? 'rgba(220, 38, 38, 0.12)'
                      : isDockOffSchedule
                        ? 'rgba(217, 119, 6, 0.14)'
                        : isRouteFinished || isEndedEarly
                          ? 'rgba(16, 185, 129, 0.12)'
                          : shiftActive
                            ? 'rgba(37, 99, 235, 0.12)'
                            : 'rgba(16, 185, 129, 0.12)',
                    color: user?.is_suspended
                      ? '#dc2626'
                      : isDockOffSchedule
                        ? '#d97706'
                        : isRouteFinished || isEndedEarly
                          ? '#10b981'
                          : shiftActive
                            ? '#2563eb'
                            : '#10b981',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {user?.is_suspended ? (
                      <Ban size={20} />
                    ) : isRouteFinished || isEndedEarly ? (
                      <CheckCircle2 size={20} />
                    ) : shiftActive ? (
                      <Truck size={20} />
                    ) : isDockOffSchedule ? (
                      <Clock size={20} />
                    ) : (
                      <Sparkles size={20} />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: '#0f172a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {user?.is_suspended
                        ? 'Account Suspended'
                        : isRouteFinished
                          ? 'All Stops Completed'
                          : isEndedEarly
                            ? 'Shift Ended Early'
                            : shiftActive
                              ? 'Shift In Progress'
                              : isDockOffSchedule
                                ? `Scheduled for ${dockTiming.formattedWindow || dockTiming.formattedStart}`
                                : "Today's Route Ready"}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {completedCount} of {totalCount} stops collected ({progress}%)
                    </div>
                  </div>
                </div>

                {/* Action Button on right */}
                <button
                  disabled={isDockBlocked}
                  onClick={() => {
                    if (isDockBlocked) return
                    navigate('/driver/flow')
                  }}
                  style={{
                    flexShrink: 0,
                    background: isDockBlocked
                      ? '#e2e8f0'
                      : shiftActive
                        ? '#2563eb'
                        : isDockOffSchedule
                          ? '#d97706'
                          : '#10b981',
                    color: isDockBlocked ? '#94a3b8' : '#ffffff',
                    border: 'none',
                    borderRadius: 12,
                    padding: '12px 20px',
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: isDockBlocked ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: isDockBlocked
                      ? 'none'
                      : isDockOffSchedule
                        ? '0 4px 14px rgba(217, 119, 6, 0.35)'
                        : '0 4px 14px rgba(16, 185, 129, 0.35)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {user?.is_suspended ? (
                    <><Ban size={16} /> Suspended</>
                  ) : isRouteFinished ? (
                    <><CheckCircle2 size={16} /> Completed</>
                  ) : isEndedEarly ? (
                    <><CheckCircle2 size={16} /> Ended Early</>
                  ) : shiftActive ? (
                    <><Play size={16} fill="currentColor" /> Resume Shift</>
                  ) : isDockOffSchedule ? (
                    <><Clock size={16} /> {dockTiming.compactCtaLabel}</>
                  ) : (
                    <><Play size={16} fill="currentColor" /> Start Shift</>
                  )}
                </button>
              </div>
            )
          })()
        }

        {/* ── OVERLAY MODALS (Shift Status & Collection Logs) ── */}
        {
          overlayView === 'status' && (
            <DriverStatusPanel
              isOverlay={true}
              open={true}
              onClose={() => setOverlayView(null)}
            />
          )
        }

        {
          overlayView === 'logs' && (
            <DriverCollectionLog
              isOverlay={true}
              open={true}
              onClose={() => setOverlayView(null)}
            />
          )
        }

        {
          overlayView === 'hotspots' && (
            <DriverHotspotAlert
              isOverlay={true}
              open={true}
              onClose={() => setOverlayView(null)}
            />
          )
        }
      </div>
    </>
  )
}
