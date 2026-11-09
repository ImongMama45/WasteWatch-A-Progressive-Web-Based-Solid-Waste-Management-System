/**
 * EndShiftModule.jsx
 * -------------------
 * 5th and Last step <== do not remove this indicator
 *
 * FLOW:
 *  Phase 1 — "returning"
 *    Driver must navigate back to waypoints[0] (home base) before ending
 *    their shift. Shows a Leaflet map with ORS route to base, live distance
 *    counter, and a "Confirm Return to Base" button that unlocks within
 *    BASE_ARRIVAL_RADIUS_M metres. Dev 🏠 button teleports to base.
 *
 *  Phase 2a — EARLY TERMINATION  (ww_route_complete !== 'true')
 *    Form: driver explains why they ended early → notifies admin via API.
 *
 *  Phase 2b — ROUTE COMPLETED  (ww_route_complete === 'true')
 *    Celebration screen: fireworks + shift summary → Done or extended mode.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import TurnArrow, { TURN_COLOR } from './TurnArrow'
import { useNotification } from '../../../context/NotificationContext'
import useShiftTimer, { clearDriverSessionData } from '../../../hooks/useShiftTimer'
import useGpsTracking from '../../../hooks/useGpsTracking'
import api, { handleStaleShift } from '../../../api/client'
import { resolveDriverSchedule } from '../../../utils/driverSchedule'
import NavigateToDumpsiteModule from './NavigateToDumpsiteModule'
import CalibrationCelebrationModule from './CalibrationCelebrationModule'
import RouteCompletionMiniMap from './RouteCompletionMiniMap'
import { buildStopValidationSnapshot, isMissedStopStatus, isCompletedStopStatus, normalizeStopStatus } from '../../../utils/pickupStatusSync'
import {
  Home,
  X,
  CheckCircle2,
  LocateFixed,
  ChevronDown,
  ChevronUp,
  Clock,
  Radio,
  Flag,
  Package,
  Scale,
  FileText,
  AlertTriangle,
  Square,
  Sparkles,
  MapPin,
  Calendar,
  Compass,
  Plus,
  Minus,
} from 'lucide-react'
import { calculateBearing, getShortestAngle, create3DVehicleIcon } from './map3DUtils'
import { MobileFlowSkeleton } from '../../../components/ui/Skeleton'


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const BASE_ARRIVAL_RADIUS_M = 150   // slightly larger than stop radius



// ─── HELPERS ─────────────────────────────────────────────────────────────────

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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

// ─── EARLY TERMINATION REASONS ────────────────────────────────────────────────

const EARLY_REASONS = [
  'Truck breakdown / mechanical issue',
  'Medical emergency',
  'Road is blocked / inaccessible',
  'Insufficient fuel',
  'Weather conditions',
  'End of scheduled shift hours',
  'Other',
]

// ─── FIREWORKS ────────────────────────────────────────────────────────────────

function Fireworks() {
  const particles = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * 360
    const dist = 80 + Math.random() * 60
    const x = Math.cos((angle * Math.PI) / 180) * dist
    const y = Math.sin((angle * Math.PI) / 180) * dist
    const colors = ['#2ecc71', '#3b82f6', '#f59e0b', '#ec4899', '#22d3ee', '#a78bfa', '#fff']
    const color = colors[i % colors.length]
    const delay = Math.random() * 0.4
    const size = 6 + Math.random() * 8
    return { x, y, color, delay, size }
  })

  return (
    <div style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', top: '50%', left: '50%',
          width: p.size, height: p.size,
          borderRadius: i % 3 === 0 ? '50%' : '2px',
          background: p.color,
          animation: `fwBurst 1.2s cubic-bezier(.22,.61,.36,1) ${p.delay}s both`,
          '--tx': `${p.x}px`, '--ty': `${p.y}px`,
        }} />
      ))}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fwCheck .5s cubic-bezier(.36,.07,.19,.97) .2s both',
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: '#1e2a3a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(15,23,42,0.3)',
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="36" height="36">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
    </div>
  )
}

// ─── SUMMARY ROW ─────────────────────────────────────────────────────────────

function SummaryRow({ icon: Icon, label, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid #f1f5f9',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {typeof Icon === 'function' || typeof Icon === 'object' ? (
          <Icon size={18} color="#64748b" />
        ) : (
          <span style={{ fontSize: 18 }}>{Icon}</span>
        )}
        <span style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>{label}</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{value}</span>
    </div>
  )
}

// ─── SVG ICONS ────────────────────────────────────────────────────────────────

const TimerIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: -1 }}>
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
)

const HomeIcon = ({ size = 22, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
    <polyline points="9 22 9 12 15 12 15 22"></polyline>
  </svg>
)

const RadarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: -2 }}>
    <path d="M12 2v2"></path>
    <path d="M12 20v2"></path>
    <path d="M4.93 4.93l1.41 1.41"></path>
    <path d="M17.66 17.66l1.41 1.41"></path>
    <path d="M2 12h2"></path>
    <path d="M20 12h2"></path>
    <path d="M6.34 17.66l-1.41 1.41"></path>
    <path d="M19.07 4.93l-1.41 1.41"></path>
    <circle cx="12" cy="12" r="4"></circle>
  </svg>
)

// ─── STAT CELL ────────────────────────────────────────────────────────────────

function StatCell({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>{label}</div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────




export default function EndShiftModule({ onAdvance, shift, schedule: scheduleProp, stopStatuses: stopStatusesProp, currentStopIndex: currentStopIndexProp }) {

  const navigate = useNavigate()
  const { user } = useAuth()
  const { notify } = useNotification()
  const { formattedTime, startTime, shiftActive, endShift } = useShiftTimer()

  const isRouteComplete = sessionStorage.getItem('ww_route_complete') === 'true'
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  // ── Phase gate ────────────────────────────────────────────────────────────
  // 'loading'               → fetching schedule data
  // 'dump_site'             → driver navigates to dump site (if exists)
  // 'waiting_dump_confirmation' → waiting for dumpsite operator calibration
  // 'returning'             → driver navigates back to base
  // 'at_base'               → driver can proceed to end-shift form

  // Persist sub-phase to the backend on every transition so any device
  // can resume correctly (sessionStorage is device-local; backend is canonical).
  const [phase, setPhaseRaw] = useState('loading')
  const endedRef = useRef(false)

  function setPhase(p) {
    if (p !== 'loading') {
      // Fire-and-forget — non-blocking, won't block UI transition
      if (shift?.id) {
        api.patch(`/api/driver/shift/${shift.id}/update-status/`, {
          status: 'end_shift',
          end_shift_phase: p,
        }).catch((err) => {
          if (!endedRef.current) handleStaleShift(err)
        })
      }
      // Also keep sessionStorage as a fast-path fallback (same device, offline)
      sessionStorage.setItem('ww_endshift_phase', p)
    }
    setPhaseRaw(p)
  }
  const [calibrationData, setCalibrationData] = useState(null)

  // Seed from ShiftRouteModule props so missedStopOrders is immediately correct
  const [schedule, setSchedule] = useState(scheduleProp || null)

  // Initialise from the snapshot persisted by ShiftRouteModule just before
  // advancing phase. This is the source of truth for which stops are missed.
  const [stopStatuses, setStopStatuses] = useState(() => {
    if (stopStatusesProp && stopStatusesProp.size > 0) return stopStatusesProp
    try {
      const raw = sessionStorage.getItem('ww_stop_statuses_snapshot')
      if (raw) return new Map(JSON.parse(raw))
    } catch { }
    return new Map()
  })

  // Keep in sync if props update (e.g. rendered inside ShiftRouteModule)
  useEffect(() => {
    if (stopStatusesProp && stopStatusesProp.size > 0) setStopStatuses(stopStatusesProp)
  }, [stopStatusesProp])
  useEffect(() => {
    if (scheduleProp) setSchedule(scheduleProp)
  }, [scheduleProp])


  // ── GPS ───────────────────────────────────────────────────────────────────
  const { position: realGpsPos, accuracy: gpsAccuracy, isTracking, error: gpsError } =
    useGpsTracking({ enabled: true, intervalMs: 30000, syncEnabled: Boolean(shift?.id) && shiftActive })
  const [mockGps, setMockGps] = useState(null)
  const gpsPos = mockGps || realGpsPos
  const isMock = mockGps !== null

  const [is3D, setIs3D] = useState(false)
  const [mapHeading, setMapHeading] = useState(0)
  const prevGpsPosRef = useRef(null)
  const isFollowCamRef = useRef(true)
  const [isUserPanned, setIsUserPanned] = useState(false)
  const [isRetracted, setIsRetracted] = useState(false)
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false)
  const [isTurnCardCollapsed, setIsTurnCardCollapsed] = useState(false)
  const [orsData, setOrsData] = useState(null)
  const [leafletReady, setLeafletReady] = useState(false)
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const driverMarker = useRef(null)
  const routeLayer = useRef(null)

  const toggleRetract = () => {
    setIsRetracted(prev => {
      const next = !prev
      setIsHeaderCollapsed(next)
      return next
    })
  }

  const toggleHeader = () => {
    setIsHeaderCollapsed(prev => !prev)
  }

  // ── Base location (waypoints[0] from driver's schedule) ───────────────────
  const [baseLocation, setBaseLocation] = useState(null)
  const [baseName, setBaseName] = useState('Home Base')
  const [dumpSiteLocation, setDumpSiteLocation] = useState(null)
  const [dumpSiteName, setDumpSiteName] = useState('Dump Site')

  useEffect(() => {
    if (!user?.id) return
    // Fetch fresh shift state from backend so end_shift_phase is never stale —
    // the `shift` prop can be a captured value from a prior render cycle.
    const shiftPromise = api.get('/api/driver/shift/current/').then(r => r.data.active_shift).catch(() => null)

    api.get('/api/driver/collection-schedules/?paginate=false')
      .then(async res => {
        const match = resolveDriverSchedule(res.data, user.id, shift?.schedule_id ?? shift?.schedule ?? null)
        if (match) {
          setSchedule(match)
          try {
            const valRes = await api.get(`/api/watcher/stop-validations/?schedule_id=${encodeURIComponent(match.id)}`)
            const snapshot = buildStopValidationSnapshot(valRes.data?.results || valRes.data || [])
            const statusMap = new Map()
            snapshot.statusMap.forEach((status, key) => {
              const stopOrder = Number(String(key).split(':')[1])
              if (!Number.isNaN(stopOrder)) statusMap.set(stopOrder, status)
            })

            // Layer 2: merge sessionStorage snapshot for locally-flagged stops
            // (e.g. COLLECTION_REPORTED or DRIVER_MISSED that aren't yet synced)
            //
            // Two cases:
            //  a) The API has no row for this index → just add it.
            //  b) The API has the stop as PENDING_INSPECTION or READY_FOR_COLLECTION
            //     (unresolved) but we have a local completed status → let local win.
            //     This prevents stops collected offline (photo still in queue) from
            //     being counted as missed in missedStopOrders.
            try {
              const raw = sessionStorage.getItem('ww_stop_statuses_snapshot')
              if (raw) {
                const localMap = new Map(JSON.parse(raw))
                localMap.forEach((localStatus, idx) => {
                  if (!statusMap.has(idx)) { statusMap.set(idx, localStatus); return }
                  const apiStatus = normalizeStopStatus(statusMap.get(idx))
                  const apiUnresolved = apiStatus === 'PENDING_INSPECTION' || apiStatus === 'READY_FOR_COLLECTION'
                  if (apiUnresolved && isCompletedStopStatus(normalizeStopStatus(localStatus))) {
                    statusMap.set(idx, localStatus)
                  }
                })
              }
            } catch { }

            // Layer 3: fill every waypoint index with PENDING_INSPECTION if still missing
            // so the mini-map renders ALL stops, not just watcher-logged ones
            if (match.waypoints?.length > 1) {
              for (let i = 1; i < match.waypoints.length; i++) {
                if (!statusMap.has(i)) statusMap.set(i, 'PENDING_INSPECTION')
              }
            }

            setStopStatuses(statusMap)
          } catch (e) { console.error('Failed to fetch validations snapshot:', e) }
        }

        if (match?.waypoints?.length > 0) {
          setBaseLocation(match.waypoints[0])
          setBaseName(match.waypoints[0]?.label || 'Home Base')
        }

        // Resolve the freshest end_shift_phase:
        // Priority 1 — live backend (fresh fetch, avoids stale prop closure)
        // Priority 2 — sessionStorage (same-device fast-path / offline)
        // Priority 3 — shift prop (initial mount value)
        const freshShift = await shiftPromise
        const serverPhase = freshShift?.end_shift_phase || shift?.end_shift_phase
        const localPhase = sessionStorage.getItem('ww_endshift_phase')
        const persisted = serverPhase || localPhase
        const freshShiftId = freshShift?.id || shift?.id

        if (match?.dumpsite_detail) {
          setDumpSiteLocation(match.dumpsite_detail)
          setDumpSiteName(match.dumpsite_detail?.name || 'Dump Site')
        }
        setCalibrationData(match)

        const KNOWN_PHASES = ['dump_site', 'waiting_dump_confirmation', 'returning', 'calibration_complete', 'route_complete_decision', 'early_termination']

        if (persisted && KNOWN_PHASES.includes(persisted)) {
          setPhaseRaw(persisted)
        } else {
          const isRouteCompleteSession = sessionStorage.getItem('ww_route_complete') === 'true'
          const endReason = sessionStorage.getItem('ww_end_reason')

          if (isRouteCompleteSession) {
            // Driver finished all stops normally — show the celebration screen.
            setPhase('route_complete_decision')
          } else if (endReason === 'truck_full') {
            // Truck full mid-route: this is a routine, expected end — route to dumpsite
            // (or directly to calibration_complete if no dumpsite is assigned).
            // Do NOT show the emergency incident-report form.
            setPhase(match?.dumpsite_detail ? 'dump_site' : 'calibration_complete')
          } else {
            // A genuine early termination (breakdown, medical, etc.) — show reason form.
            setPhase('early_termination')
          }
        }

        if (freshShiftId) api.patch(`/api/driver/shift/${freshShiftId}/update-status/`, { status: 'end_shift' }).catch(() => { })
      })
      .catch((err) => {
        console.error(err)
        setPhase('returning')
      })
  }, [user?.id])


  // ── Distance / arrival detection ──────────────────────────────────────────
  const distanceToBase = gpsPos && baseLocation
    ? haversineDistance(
      gpsPos.lat, gpsPos.lng,
      Number(baseLocation.lat), Number(baseLocation.lng)
    )
    : null

  // Track heading & course angle
  useEffect(() => {
    if (!gpsPos) return
    let newHeading = null

    if (gpsPos.heading != null && !Number.isNaN(gpsPos.heading) && gpsPos.heading > 0) {
      newHeading = gpsPos.heading
    } else if (prevGpsPosRef.current) {
      const dist = haversineDistance(prevGpsPosRef.current.lat, prevGpsPosRef.current.lng, gpsPos.lat, gpsPos.lng)
      if (dist >= 1.5) {
        newHeading = calculateBearing(prevGpsPosRef.current.lat, prevGpsPosRef.current.lng, gpsPos.lat, gpsPos.lng)
      }
    }

    if (newHeading == null && orsData?.geometry) {
      try {
        const pts = decodePolyline(orsData.geometry)
        if (pts && pts.length >= 2) {
          newHeading = calculateBearing(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
        }
      } catch { }
    }

    if (newHeading == null && baseLocation) {
      if (distanceToBase != null && distanceToBase < 15) {
        // Keep current heading near base to prevent 180° flip
        newHeading = mapHeading
      } else {
        newHeading = calculateBearing(gpsPos.lat, gpsPos.lng, Number(baseLocation.lat), Number(baseLocation.lng))
      }
    }

    if (newHeading != null) {
      setMapHeading(prev => getShortestAngle(prev, newHeading))
    }
    prevGpsPosRef.current = gpsPos
  }, [gpsPos, baseLocation, orsData, distanceToBase])

  const hasGoodAccuracy = isMock || gpsAccuracy == null || gpsAccuracy < 50
  const isAtBase = distanceToBase != null && distanceToBase <= BASE_ARRIVAL_RADIUS_M && hasGoodAccuracy

  const distanceToDump = gpsPos && dumpSiteLocation
    ? haversineDistance(
      gpsPos.lat, gpsPos.lng,
      Number(dumpSiteLocation.latitude), Number(dumpSiteLocation.longitude)
    )
    : null
  const isAtDump = distanceToDump != null && distanceToDump <= BASE_ARRIVAL_RADIUS_M && hasGoodAccuracy

  // ── Load Leaflet CDN ──────────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return }
    const link = Object.assign(document.createElement('link'),
      { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
    document.head.appendChild(link)
    const script = Object.assign(document.createElement('script'),
      { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', onload: () => setLeafletReady(true) })
    document.head.appendChild(script)
  }, [])

  // ── Draw map (only while in 'returning' phase) ────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current || phase !== 'returning') return
    const L = window.L
    const center = gpsPos
      ? [gpsPos.lat, gpsPos.lng]
      : baseLocation
        ? [Number(baseLocation.lat), Number(baseLocation.lng)]
        : [13.9373, 121.617]
    const map = L.map(mapRef.current, { center, zoom: 17.5, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    mapInstance.current = map

    const pauseFollow = () => {
      isFollowCamRef.current = false
      setIsUserPanned(true)
    }
    map.on('dragstart zoomstart movestart', (e) => {
      if (e.originalEvent || e.type === 'dragstart' || e.type === 'zoomstart') {
        pauseFollow()
      }
    })

    setTimeout(() => map.invalidateSize(), 250)

    const heading = mapHeading || gpsPos?.heading || 0
    const driverIcon = create3DVehicleIcon(L, heading, is3D, mapHeading)
    driverMarker.current = L.marker(center, { icon: driverIcon, zIndexOffset: 1000 }).addTo(map)

    if (baseLocation) {
      const baseLat = Number(baseLocation.lat)
      const baseLng = Number(baseLocation.lng)
      const baseIcon = L.divIcon({
        html: `<div style="position:relative;width:40px;height:40px;">
                 <span style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #16a34a;opacity:0.45;animation:esmPulse 2.2s ease infinite .3s;"></span>
                 <div style="position:absolute;inset:0;background:#16a34a;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 14px rgba(22,163,74,0.55);font-size:18px;">
                   <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                 </div>
               </div>`,
        className: '', iconSize: [40, 40], iconAnchor: [20, 20]
      })
      L.marker([baseLat, baseLng], { icon: baseIcon })
        .addTo(map)
        .bindPopup(`<b>${baseName}</b><br/><span style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase">Home Base</span>`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, baseLocation, phase])

  // ── Fetch ORS route: current position → base ──────────────────────────────
  useEffect(() => {
    if (!baseLocation || !gpsPos || phase !== 'returning') return
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: orsApiKey },
      body: JSON.stringify({
        coordinates: [
          [gpsPos.lng, gpsPos.lat],
          [Number(baseLocation.lng), Number(baseLocation.lat)],
        ],
        instructions: true,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length) return
        setOrsData(data.routes[0])
        if (mapInstance.current && window.L) {
          if (routeLayer.current) mapInstance.current.removeLayer(routeLayer.current)
          const pts = decodePolyline(data.routes[0].geometry)
          // Green route line to distinguish from normal navigation
          routeLayer.current = window.L.polyline(pts, {
            color: '#16a34a', weight: 6, opacity: 0.85,
          }).addTo(mapInstance.current)
        }
      })
      .catch(console.error)
  }, [baseLocation, gpsPos?.lat, gpsPos?.lng, phase])

  // ── Move driver marker as GPS updates ─────────────────────────────────────
  useEffect(() => {
    if (!gpsPos || !driverMarker.current || !mapInstance.current) return
    driverMarker.current.setLatLng([gpsPos.lat, gpsPos.lng])
    if (window.L) {
      const heading = mapHeading || gpsPos.heading || 0
      driverMarker.current.setIcon(create3DVehicleIcon(window.L, heading, is3D, mapHeading))
    }
    if (isFollowCamRef.current) {
      const targetZoom = is3D ? 18 : 17.5
      if (Math.abs(mapInstance.current.getZoom() - targetZoom) > 1.5) {
        mapInstance.current.setView([gpsPos.lat, gpsPos.lng], targetZoom, { animate: true })
      } else {
        mapInstance.current.panTo([gpsPos.lat, gpsPos.lng], { animate: true, duration: 0.4 })
      }
    }
  }, [gpsPos, is3D, mapHeading])

  // Sync 3D vehicle avatar when 3D mode toggles
  useEffect(() => {
    if (driverMarker.current && window.L && gpsPos) {
      const heading = mapHeading || gpsPos.heading || 0
      driverMarker.current.setIcon(create3DVehicleIcon(window.L, heading, is3D, mapHeading))
    }
  }, [is3D, mapHeading, gpsPos])

  // ── Destroy map when phase transitions away from 'returning' ─────────────
  useEffect(() => {
    if (phase === 'at_base' && mapInstance.current) {
      mapInstance.current.remove()
      mapInstance.current = null
    }
  }, [phase])

  // ── Full cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => () => {
    if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
  }, [])

  // ── ORS-derived display values ────────────────────────────────────────────
  let instructionText = 'Head back to home base'
  let etaMinutes = '--'
  let arrivalTimeStr = '--:--'
  let distanceKmStr = '--'
  let stepType = 6
  let stepBearing = null

  if (orsData) {
    const seg = orsData.segments?.[0]
    if (seg?.steps?.length) {
      const step = seg.steps[0]
      instructionText = step.instruction || 'Follow the road to base'
      stepType = step.type !== undefined ? step.type : 6
      stepBearing = step.bearing_after !== undefined ? step.bearing_after : null
    }
    if (seg) {
      etaMinutes = Math.ceil(seg.duration / 60)
      arrivalTimeStr = new Date(Date.now() + seg.duration * 1000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      distanceKmStr = (seg.distance / 1000).toFixed(1)
    }
  }

  const accentColor = TURN_COLOR[stepType] || '#16a34a'

  // ── Clean up route session key on mount ───────────────────────────────────
  useEffect(() => {
    sessionStorage.removeItem('ww_route_state')
  }, [])

  // ── Poll for dumpsite confirmation ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting_dump_confirmation' || !dumpSiteLocation) return

    const checkDelivery = async () => {
      try {
        const res = await api.get('/api/dumpsite/waste-deliveries/')
        const deliveries = res.data?.results || res.data || []
        const match = deliveries.find(d => {
          if (String(d.driver) !== String(user?.id)) return false
          if (!startTime) return true // fallback
          return new Date(d.created_at) > new Date(startTime)
        })
        if (match) {
          // Delivery found! Dumpsite operator has calibrated/logged the truck.
          setCalibrationData(match)
          setPhase('calibration_complete')
        }
      } catch (err) {
        console.error('Error checking dump confirmation:', err)
      }
    }

    checkDelivery()
    const interval = setInterval(checkDelivery, 5000)
    return () => clearInterval(interval)
  }, [phase, dumpSiteLocation, user?.id])

  // ── Early termination state ───────────────────────────────────────────────
  const [reason, setReason] = useState('')
  const [customNote, setCustomNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Compute missed stops: only truly unvisited stops.
  // Excluded: EMPTY_STOP (legitimately empty, driver did visit),
  //           COLLECTION_DISPUTED (watcher challenge on a collection that happened),
  //           VERIFIED_COLLECTED / COLLECTION_REPORTED (completed).
  // This definition aligns with MISSED_STOP_STATUSES in pickupStatusSync.js.
  const missedStopOrders = useMemo(() => {
    if (!schedule?.waypoints) return []
    return schedule.waypoints
      .slice(1)
      .map((_, i) => i + 1)
      .filter(idx => {
        const s = normalizeStopStatus(stopStatuses?.get(idx))
        return s === 'DRIVER_MISSED' || s === 'PENDING_INSPECTION' || s === 'READY_FOR_COLLECTION'
      })
  }, [schedule, stopStatuses])

  const [extendedModeLoading, setExtendedModeLoading] = useState(false)

  async function handleEarlySubmit() {
    if (!reason || submitting) return
    setSubmitting(true)
    endedRef.current = true
    try {
      await endShift({
        scheduleId: schedule?.id,
        missedStopOrders,
        ended_early: true,
        reason,
        notes: customNote.trim() || null,
      })
      clearDriverSessionData()
      setSubmitted(true)
    } catch (err) {
      console.error('shift/end error:', err.response?.data)
      notify({ variant: 'error-dark', message: err.response?.data?.error || 'Failed to end shift. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDone() {
    if (submitting) return
    setSubmitting(true)
    endedRef.current = true
    try {
      await endShift({
        scheduleId: schedule?.id,
        missedStopOrders,
        ended_early: false,
      })
      // Clear all route-specific session keys so DriverFlow restarts
      // from AssignmentModule (the first step) on next entry.
      clearDriverSessionData()
      navigate('/dashboard', { replace: true })
    } catch (err) {
      notify({ variant: 'error-dark', message: err.response?.data?.error || 'Failed to end shift. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleExtendedMode() {
    if (extendedModeLoading) return
    setExtendedModeLoading(true)
    try {
      await api.post(`/api/driver/shift/${shift?.id}/extended_mode/`, {
        missed_stop_orders: missedStopOrders,
        schedule_id: schedule?.id,
      })
      // Only set session flag after confirmed server acknowledgment
      sessionStorage.setItem('ww_extended_mode', 'true')
      onAdvance('shiftroute')
    } catch (err) {
      notify({
        variant: 'error-dark',
        message: err.response?.data?.error || 'Failed to activate extended mode. Please try again.',
      })
    } finally {
      setExtendedModeLoading(false)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 0 — LOADING
  // ══════════════════════════════════════════════════════════════════════════

  if (phase === 'loading') {
    return (
      <>
        <div style={{ width: '100%' }}>
          <MobileFlowSkeleton label="Loading shift summary..." />



        </div>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1 — RETURN TO BASE MAP
  // ══════════════════════════════════════════════════════════════════════════

  if (phase === 'returning') {
    // Inline GPS pill colours
    const gpsColor = gpsError ? '#ef4444'
      : (!isTracking) ? '#f59e0b'
        : (gpsAccuracy != null && gpsAccuracy >= 50) ? '#f59e0b'
          : '#2ecc71'
    const gpsLabel = gpsError ? 'GPS Lost'
      : !isTracking ? 'GPS…'
        : gpsAccuracy != null ? `GPS ±${Math.round(gpsAccuracy)}m` : 'GPS Active'

    const distLabel = distanceToBase == null
      ? 'Calculating…'
      : distanceToBase > 1000
        ? `${(distanceToBase / 1000).toFixed(1)} km to base`
        : `${Math.round(distanceToBase)} m to base`

    return (
      <>
        <div style={{
          position: 'fixed',
          top: isHeaderCollapsed ? -65 : 0,
          left: 0,
          right: 0,
          height: 60,
          zIndex: 1000,
          overflow: 'hidden',
          transition: 'top 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
          pointerEvents: isHeaderCollapsed ? 'none' : 'auto'
        }}>
        </div>
        <style>{`
          @keyframes esMapPulse {
            0%,100% { transform:scale(1); opacity:.5; }
            50%      { transform:scale(1.6); opacity:0; }
          }
          @keyframes esNavFadeUp {
            from { opacity:0; transform:translateY(6px); }
            to   { opacity:1; transform:translateY(0); }
          }
        `}</style>

        <div style={{
          position: 'fixed',
          top: isHeaderCollapsed ? 0 : 60,
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 900,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-body)',
          overflow: 'hidden',
          background: '#1c2430',
          transition: 'top 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }}>
          {/* MAP CONTAINER WITH 3D PERSPECTIVE SUPPORT */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#1c2430', overflow: 'hidden' }}>
            <div
              ref={mapRef}
              onTouchStart={() => { isFollowCamRef.current = false; setIsUserPanned(true) }}
              onMouseDown={() => { isFollowCamRef.current = false; setIsUserPanned(true) }}
              onWheel={() => { isFollowCamRef.current = false; setIsUserPanned(true) }}
              style={{
                width: '100%',
                height: '100%',
                position: 'absolute',
                inset: 0,
                transform: is3D ? `perspective(1000px) rotateX(54deg) rotateZ(${-mapHeading}deg) scale(1.15)` : 'none',
                transformOrigin: 'center center',
                transition: 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
            />

            {/* FLOATING MAP CONTROLS */}
            <div style={{
              position: 'absolute',
              right: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              {/* 3D / 2D Camera Toggle */}
              <button
                type="button"
                onClick={() => {
                  setIs3D(prev => {
                    const next = !prev
                    if (mapInstance.current && gpsPos) {
                      mapInstance.current.setView([gpsPos.lat, gpsPos.lng], next ? 18 : 17.5, { animate: true })
                    }
                    return next
                  })
                }}
                title={is3D ? "Switch to 2D Top-Down View" : "Switch to 3D Cockpit View"}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: is3D ? '#16a34a' : 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(10px)',
                  border: is3D ? '2px solid #22c55e' : '1px solid rgba(255,255,255,0.2)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                  transition: 'all 0.2s ease',
                  fontFamily: 'var(--font-head)',
                  fontSize: 13,
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                }}
              >
                {is3D ? '2D' : '3D'}
              </button>

              {/* Compass / Heading Reset in 3D Mode */}
              {is3D && (
                <button
                  type="button"
                  onClick={() => setMapHeading(0)}
                  title="Reset to North"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'rgba(15, 23, 42, 0.85)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ transform: `rotate(${-mapHeading}deg)`, transition: 'transform 0.4s ease' }}>
                    <Compass size={20} color="#f87171" />
                  </div>
                </button>
              )}

              {/* Re-center GPS */}
              <button
                type="button"
                onClick={() => {
                  isFollowCamRef.current = true
                  setIsUserPanned(false)
                  if (gpsPos && mapInstance.current) {
                    if (is3D) {
                      mapInstance.current.setView([gpsPos.lat, gpsPos.lng], 18, { animate: true })
                    } else {
                      mapInstance.current.panTo([gpsPos.lat, gpsPos.lng])
                    }
                  }
                }}
                title="Re-center on My Location"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: isUserPanned ? '#2563eb' : 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(10px)',
                  border: isUserPanned ? '2px solid #60a5fa' : '1px solid rgba(255,255,255,0.2)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: isUserPanned ? '0 0 16px rgba(37,99,235,0.6)' : '0 4px 16px rgba(0,0,0,0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                <LocateFixed size={20} />
              </button>

              {/* Zoom Controls */}
              <button
                type="button"
                onClick={() => {
                  isFollowCamRef.current = false
                  setIsUserPanned(true)
                  mapInstance.current?.zoomIn()
                }}
                title="Zoom In"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Plus size={20} />
              </button>

              <button
                type="button"
                onClick={() => {
                  isFollowCamRef.current = false
                  setIsUserPanned(true)
                  mapInstance.current?.zoomOut()
                }}
                title="Zoom Out"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Minus size={20} />
              </button>

              {/* DEV Teleport */}
              {import.meta.env.DEV && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (!baseLocation) return
                      const lat = Number(baseLocation.lat), lng = Number(baseLocation.lng)
                      setMockGps({ lat, lng })
                      mapInstance.current?.panTo([lat, lng])
                    }}
                    title="DEV: Teleport to Home Base"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: '#16a34a',
                      border: '2px solid #fff',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0,0,0,.2)',
                    }}
                  >
                    <Home size={18} />
                  </button>

                  {mockGps && (
                    <button
                      type="button"
                      onClick={() => setMockGps(null)}
                      title="Clear Mock GPS"
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: '#ef4444',
                        border: '2px solid #fff',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(0,0,0,.2)',
                      }}
                    >
                      <X size={18} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── RETRACTABLE HEADER ── */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(10px)',
            color: '#fff',
            boxShadow: '0 4px 20px rgba(0,0,0,.22)',
            transition: 'transform 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
            transform: isHeaderCollapsed ? 'translateY(calc(-100% + 32px))' : 'translateY(0)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '12px 18px 8px',
              opacity: isHeaderCollapsed ? 0 : 1,
              pointerEvents: isHeaderCollapsed ? 'none' : 'auto',
              transition: 'opacity 0.25s ease',
            }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: `${gpsColor}18`, border: `1px solid ${gpsColor}44`,
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: gpsColor,
                    display: 'inline-block',
                    animation: isTracking && !gpsError ? 'esMapPulse 2s ease infinite' : 'none',
                  }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: gpsColor, letterSpacing: '.04em' }}>
                    {gpsLabel}
                  </span>
                </div>

                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'rgba(22,163,74,0.18)', border: '1px solid rgba(22,163,74,0.5)',
                  borderRadius: 20, padding: '3px 10px',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', letterSpacing: '.04em' }}>
                    RETURNING TO BASE
                  </span>
                </div>

                <div style={{
                  marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px',
                }}>
                  <Clock size={11} color="rgba(255,255,255,0.7)" />
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: '.04em' }}>
                    {formattedTime}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Home size={18} color="#22c55e" />
                <div>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, color: '#fff' }}>
                    {baseName}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                    Return to base before ending your shift · {distLabel}
                  </div>
                </div>
              </div>
            </div>

            {/* Collapsible Handle Lip */}
            <div
              onClick={toggleHeader}
              title={isHeaderCollapsed ? "Tap to expand header" : "Tap to collapse header"}
              style={{
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 16px',
                cursor: 'pointer',
                userSelect: 'none',
                borderTop: isHeaderCollapsed ? 'none' : '1px solid rgba(255,255,255,0.08)',
                background: isHeaderCollapsed ? 'rgba(15,23,42,0.96)' : 'rgba(0,0,0,0.12)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Home size={13} color="#22c55e" />
                <span style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: '#ffffff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {baseName}
                </span>
                {isHeaderCollapsed && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                    · {distLabel}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
                <span>{isHeaderCollapsed ? 'Expand Header' : 'Collapse'}</span>
                {isHeaderCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </div>
            </div>
          </div>

          {/* ── TURN INSTRUCTION CARD (Ride-Hailing Emerald style) ── */}
          {(!distanceToBase || distanceToBase > 30) && (
            <div
              onClick={() => setIsTurnCardCollapsed(p => !p)}
              style={{
                position: 'absolute',
                top: isHeaderCollapsed ? 42 : 70,
                left: 14,
                right: 14,
                zIndex: 10,
                background: 'linear-gradient(135deg, #005944 0%, #064e3b 100%)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: isTurnCardCollapsed ? 12 : 18,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                padding: isTurnCardCollapsed ? '8px 14px' : '12px 14px',
                boxShadow: '0 8px 30px rgba(0,0,0,.32)',
                animation: 'esNavFadeUp .25s ease',
                transition: 'all 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
                gap: 12,
                cursor: 'pointer',
              }}
            >
              <div style={{
                width: isTurnCardCollapsed ? 32 : 46,
                height: isTurnCardCollapsed ? 32 : 46,
                flexShrink: 0,
                background: 'rgba(255,255,255,0.12)',
                borderRadius: isTurnCardCollapsed ? 8 : 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
              }}>
                <TurnArrow type={stepType} bearing={stepBearing} color="#ffffff" size={isTurnCardCollapsed ? 20 : 40} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-head)',
                  fontSize: isTurnCardCollapsed ? 15 : 22,
                  fontWeight: 900,
                  color: '#ffffff',
                  lineHeight: 1.1,
                  letterSpacing: '-0.02em',
                  marginBottom: isTurnCardCollapsed ? 0 : 3,
                }}>
                  {distLabel}
                </div>
                {!isTurnCardCollapsed && (
                  <div style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'rgba(255,255,255,0.92)',
                    lineHeight: 1.25,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {instructionText}
                  </div>
                )}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center' }}>
                {isTurnCardCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </div>
            </div>
          )}

          {/* ── RETRACTABLE BOTTOM SHEET ── */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(16px)',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            boxShadow: '0 -6px 28px rgba(0,0,0,.15)',
            display: 'flex', flexDirection: 'column',
            paddingBottom: isRetracted ? 0 : 'env(safe-area-inset-bottom, 16px)',
            transition: 'transform 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
            transform: isRetracted ? 'translateY(calc(100% - 32px))' : 'translateY(0)',
          }}>
            {/* Retractable Handle Bar */}
            <div
              onClick={toggleRetract}
              style={{
                height: 32,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
                padding: '6px 16px 2px',
              }}
            >
              <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, marginBottom: 2 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {isRetracted ? (
                  <>
                    <ChevronUp size={13} />
                    <span>{isAtBase ? "At Base · Tap to end shift" : "Tap to view stats & actions"}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={13} />
                    <span>Tap to collapse stats</span>
                  </>
                )}
              </div>
            </div>

            {!isRetracted && (
              /* When EXPANDED: Full 3-column stats & confirmation CTA */
              <>
                <div style={{
                  padding: '4px 12px 16px', display: 'flex', alignItems: 'center',
                  borderBottom: '1px solid rgba(0,0,0,.06)',
                }}>
                  <StatCell value={arrivalTimeStr} label="arrival" />
                  <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
                  <StatCell value={etaMinutes} label="min" />
                  <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
                  <StatCell value={distanceKmStr} label="km" />
                </div>

                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <p style={{
                    fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 800, textAlign: 'center',
                    color: isAtBase ? '#16a34a' : '#475569',
                    margin: 0, transition: 'color .3s',
                  }}>
                    {isAtBase ? "You've reached home base!" : 'Returning to base…'}
                  </p>

                  {!isAtBase && distanceToBase != null && (
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', margin: 0 }}>
                      {distanceToBase > 1000
                        ? `${(distanceToBase / 1000).toFixed(1)} km remaining`
                        : `${Math.round(distanceToBase)} m remaining`}
                    </p>
                  )}
                  {!isAtBase && distanceToBase == null && (
                    <p style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#f59e0b', margin: 0 }}>
                      <Radio size={14} /> Waiting for GPS signal…
                    </p>
                  )}

                  <button
                    disabled={!isAtBase || submitting}
                    onClick={handleDone}
                    style={{
                      width: '100%', maxWidth: 340, padding: '16px', borderRadius: 30, border: 'none',
                      fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, letterSpacing: '.04em',
                      transition: 'all .35s ease',
                      cursor: isAtBase && !submitting ? 'pointer' : 'not-allowed',
                      background: isAtBase && !submitting ? '#16a34a' : '#e2e8f0',
                      color: isAtBase && !submitting ? '#fff' : '#94a3b8',
                      boxShadow: isAtBase && !submitting ? '0 6px 20px rgba(22,163,74,0.35)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    {isAtBase && <CheckCircle2 size={18} />}
                    <span>{submitting ? 'Ending Shift...' : isAtBase ? 'Confirm Return to Base' : 'Confirm on Arrival'}</span>
                  </button>
                </div>
              </>
            )}
          </div>

        </div>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3 — DUMP SITE NAVIGATION
  // ══════════════════════════════════════════════════════════════════════════

  if (phase === 'dump_site') {
    return (
      <NavigateToDumpsiteModule
        gpsPos={gpsPos} gpsError={gpsError} isTracking={isTracking} gpsAccuracy={gpsAccuracy}
        isMock={isMock} setMockGps={setMockGps}
        dumpSiteLocation={dumpSiteLocation} dumpSiteName={dumpSiteName}
        distanceToDump={distanceToDump} isAtDump={isAtDump}
        formattedTime={formattedTime} setPhase={setPhase}
        leafletReady={leafletReady}
      />
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3b — WAITING FOR DUMPSITE CONFIRMATION
  // ══════════════════════════════════════════════════════════════════════════

  if (phase === 'waiting_dump_confirmation') {
    return (
      <>
        <style>{`
          @keyframes pulseIcon {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes slideUpFade {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        <div style={{
          height: '100dvh', display: 'flex', flexDirection: 'column',
          background: '#f8fafc', fontFamily: 'var(--font-body)',
        }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center' }}>
            <div style={{
              width: 100, height: 100, borderRadius: '50%', background: '#f59e0b15',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid #f59e0b40', marginBottom: 32,
              animation: 'pulseIcon 2s infinite ease-in-out',
            }}>
              <Scale size={44} color="#f59e0b" />
            </div>

            <h2 style={{
              fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900,
              color: '#0f172a', marginBottom: 12, letterSpacing: '.02em',
              animation: 'slideUpFade 0.4s ease-out'
            }}>
              Waiting for Calibration
            </h2>

            <p style={{
              fontSize: 15, color: '#64748b', lineHeight: 1.5, maxWidth: 280,
              animation: 'slideUpFade 0.4s ease-out 0.1s both'
            }}>
              Please hold while the dumpsite operator verifies and logs your truck's weight.
            </p>

            <div style={{
              marginTop: 40, padding: '12px 20px', background: '#fff',
              borderRadius: 12, border: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', gap: 12,
              boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
              animation: 'slideUpFade 0.4s ease-out 0.2s both'
            }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #e2e8f0', borderTopColor: '#f59e0b', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>Auto-checking status...</span>
            </div>

            {import.meta.env.DEV && (
              <button
                onClick={() => {
                  setCalibrationData({ estimated_kg: '250', net_weight: '250', volume_m3: '4.5' })
                  setPhase('calibration_complete')
                }}
                style={{
                  marginTop: 40, padding: '12px 24px', borderRadius: 20,
                  background: 'none', border: '1px dashed #cbd5e1',
                  color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  animation: 'slideUpFade 0.4s ease-out 0.3s both'
                }}
              >
                DEV: Skip to Calibration Summary
              </button>
            )}
          </div>
        </div>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3c — CALIBRATION CELEBRATION
  // ══════════════════════════════════════════════════════════════════════════

  if (phase === 'calibration_complete') {
    return (
      <CalibrationCelebrationModule
        calibrationData={calibrationData}
        schedule={schedule}
        stopStatuses={stopStatuses}
        currentStopIndex={1}
        onContinue={() => setPhase('returning')}
      />
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2a — EARLY TERMINATION
  // ══════════════════════════════════════════════════════════════════════════

  if (phase === 'early_termination') {
    if (submitted) {
      return (
        <>
          <div style={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: '#f8fafc', padding: '0 24px', textAlign: 'center',
          }}>
            <FileText size={52} color="#0f172a" style={{ marginBottom: 16 }} />
            <h2 style={{
              fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900,
              color: '#0f172a', marginBottom: 8,
            }}>Report Submitted</h2>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
              Your early shift end has been reported to the admin.<br />
              Stay safe, {firstName}.
            </p>
            <button
              onClick={() => { navigate('/dashboard', { replace: true }) }}
              style={{
                width: '100%', maxWidth: 320, padding: '16px', borderRadius: 30,
                background: '#0f172a', color: '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800,
                cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        </>
      )
    }

    return (
      <>
        <style>{`
          @keyframes esSlideUp {
            from { opacity:0; transform:translateY(12px); }
            to   { opacity:1; transform:translateY(0); }
          }
        `}</style>

        <div style={{
          height: '100dvh', display: 'flex', flexDirection: 'column',
          background: '#f8fafc', fontFamily: 'var(--font-body)', overflowY: 'auto',
        }}>
          <div style={{ background: '#0f172a', padding: '28px 20px 24px', color: '#fff' }}>
            <AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: 10 }} />
            <h1 style={{
              fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900,
              margin: '0 0 6px', letterSpacing: '.02em',
            }}>
              Ending Shift Early
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: 0 }}>
              Please let us know why you're stopping before completing your route.
              This will notify the admin and be stored in your shift log.
            </p>
          </div>

          <div style={{ flex: 1, padding: '24px 20px', animation: 'esSlideUp .25s ease both' }}>
            <div style={{
              background: '#fff', borderRadius: 14, padding: '14px 16px',
              border: '1px solid #e2e8f0', marginBottom: 20,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Shift duration so far</span>
              <span style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                {formattedTime}
              </span>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: '#94a3b8',
                letterSpacing: '.06em', marginBottom: 10,
              }}>
                REASON FOR EARLY END *
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {EARLY_REASONS.map(r => (
                  <button key={r} onClick={() => setReason(r)} style={{
                    padding: '13px 16px', borderRadius: 12, textAlign: 'left',
                    border: `1.5px solid ${reason === r ? '#0f172a' : '#e2e8f0'}`,
                    background: reason === r ? '#0f172a' : '#fff',
                    color: reason === r ? '#fff' : '#475569',
                    fontWeight: 600, fontSize: 14, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10, transition: 'all .15s',
                  }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${reason === r ? '#fff' : '#cbd5e1'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {reason === r && (
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', display: 'block' }} />
                      )}
                    </span>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {missedStopOrders.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 12,
                  alignItems: 'flex-start', marginBottom: 16
                }}>
                  <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#ef4444', marginBottom: 2 }}>
                      {missedStopOrders.length} stop{missedStopOrders.length > 1 ? 's' : ''} will be marked missed
                    </div>
                    <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.4 }}>
                      These uncollected stops will be offered to nearby active drivers.
                    </div>
                  </div>
                </div>

                <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                  <RouteCompletionMiniMap schedule={schedule} stopStatuses={stopStatuses} />
                </div>
              </div>
            )}

            <div style={{ marginBottom: 28 }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: '#94a3b8',
                letterSpacing: '.06em', marginBottom: 8,
              }}>
                ADDITIONAL NOTES <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
              </div>
              <textarea rows={3} maxLength={300}
                placeholder="e.g. Engine warning light appeared at Purok 3…"
                value={customNote} onChange={e => setCustomNote(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '12px 14px', borderRadius: 12,
                  border: '1.5px solid #e2e8f0', background: '#fff',
                  fontSize: 14, color: '#0f172a', resize: 'none',
                  fontFamily: 'var(--font-body)', outline: 'none',
                }}
              />
            </div>

            <button
              id="early-end-submit-btn"
              onClick={handleEarlySubmit}
              disabled={!reason || submitting}
              style={{
                width: '100%', padding: '17px', borderRadius: 30,
                background: reason && !submitting ? '#ef4444' : '#e2e8f0',
                color: reason && !submitting ? '#fff' : '#94a3b8',
                border: 'none', fontFamily: 'var(--font-head)',
                fontSize: 15, fontWeight: 900, letterSpacing: '.04em',
                cursor: reason && !submitting ? 'pointer' : 'not-allowed',
                boxShadow: reason ? '0 6px 18px rgba(239,68,68,0.28)' : 'none',
                transition: 'all .2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {submitting ? (
                'Submitting report…'
              ) : (
                <>
                  <Square size={16} fill="currentColor" />
                  <span>Submit & End Shift</span>
                </>
              )}
            </button>

            {!reason && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 10 }}>
                Please select a reason above
              </p>
            )}
          </div>
        </div>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2b — ROUTE COMPLETED — celebration screen
  // ══════════════════════════════════════════════════════════════════════════

  // Derive from live state, not sessionStorage fallbacks that default to '10'.
  // A false auto-completion will show 0/10 0% instead of looking like success.
  const totalStops = Math.max((schedule?.waypoints?.length ?? 1) - 1, 0)
  const completedStops = [...stopStatuses.values()]
    .filter(s => isCompletedStopStatus(normalizeStopStatus(s)) || normalizeStopStatus(s) === 'EMPTY_STOP').length
  const completionPct = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0

  if (phase === 'route_complete_decision') {
    return (
      <>
        <style>{`
        @keyframes fwBurst {
          0%   { transform: translate(-50%,-50%) scale(1); opacity:1; }
          100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0); opacity:0; }
        }
        @keyframes fwCheck {
          0%  { transform:scale(0); opacity:0; }
          60% { transform:scale(1.12); }
          80% { transform:scale(0.96); }
          100%{ transform:scale(1); opacity:1; }
        }
        @keyframes esFadeUp {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .es-fade1 { animation: esFadeUp .3s ease .1s both; }
        .es-fade2 { animation: esFadeUp .3s ease .4s both; }
        .es-fade3 { animation: esFadeUp .3s ease .6s both; }
      `}</style>

        <div style={{
          height: '100dvh', display: 'flex', flexDirection: 'column',
          background: '#f8fafc', fontFamily: 'var(--font-body)', overflowY: 'auto',
        }}>
          <div style={{ padding: '32px 20px 0', textAlign: 'center' }}>
            <h1 className="es-fade1" style={{
              fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 900,
              color: '#0f172a', marginBottom: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <span>Route Complete, {firstName}!</span>
              <Sparkles size={24} color="#f59e0b" />
            </h1>
            <p className="es-fade1" style={{ color: '#64748b', fontSize: 14, marginBottom: 0 }}>
              You've completed all {totalStops} stops on your route today.
            </p>
          </div>

          <div style={{ padding: '24px 20px', textAlign: 'center' }}>
            <Fireworks />
          </div>

          <div className="es-fade2" style={{ padding: '0 20px', marginBottom: 24 }}>
            <div style={{
              background: '#fff', borderRadius: 16, padding: '4px 16px',
              border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            }}>
              <SummaryRow icon={Clock} label="Shift Duration" value={formattedTime} />
              <SummaryRow icon={MapPin} label="Stops Completed" value={`${completedStops} / ${totalStops}`} />
              <SummaryRow icon={CheckCircle2} label="Completion" value={`${completionPct}%`} />
              <SummaryRow icon={Calendar} label="Date" value={new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
            </div>
          </div>

          {schedule && (
            <div className="es-fade2" style={{ padding: '0 20px', marginBottom: 20 }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: '#94a3b8',
                letterSpacing: '.06em', marginBottom: 10,
              }}>ROUTE RECEIPT</div>
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <RouteCompletionMiniMap schedule={schedule} stopStatuses={stopStatuses} />
              </div>
            </div>
          )}

          <div className="es-fade3" style={{ padding: '0 20px 32px', marginTop: 'auto' }}>
            <button
              id="end-shift-done-btn"
              disabled={submitting}
              onClick={() => {
                if (dumpSiteLocation) {
                  setPhase('dump_site')
                } else {
                  setPhase('calibration_complete')
                }
              }}
              style={{
                width: '100%', padding: '17px', borderRadius: 14,
                background: submitting ? '#e2e8f0' : '#0f172a',
                color: submitting ? '#94a3b8' : '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
                cursor: submitting ? 'not-allowed' : 'pointer', marginBottom: 10,
                boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {submitting ? (
                'Proceeding…'
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  <span>End Shift</span>
                </>
              )}
            </button>

            <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
              Truck not full? Help collect unclaimed stops nearby.
            </p>
            <button
              id="extended-mode-btn"
              disabled={extendedModeLoading}
              onClick={handleExtendedMode}
              style={{
                width: '100%', padding: '17px', borderRadius: 14,
                background: extendedModeLoading ? '#e2e8f0' : '#0f172a',
                color: extendedModeLoading ? '#94a3b8' : '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
                cursor: extendedModeLoading ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {extendedModeLoading ? (
                'Activating…'
              ) : (
                <>
                  <Package size={18} />
                  <span>My Truck is still not full</span>
                </>
              )}
            </button>
          </div>

          <div style={{
            background: '#0f172a', padding: '16px 24px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, letterSpacing: '.06em' }}>
              Track · Monitor · Report
            </span>
          </div>
        </div>
      </>
    )
  }

  return null
}
