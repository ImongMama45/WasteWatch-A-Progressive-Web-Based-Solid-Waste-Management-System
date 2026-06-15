// MapView.jsx — WasteWatch Admin/Watcher/Barangay Official Map

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import api from '../api/client'
import { ICONS } from '../api/navConfig'
import ZonePanel from '../components/ZonePanel'
import ReactDOMServer from 'react-dom/server'
import {
  buildStopMarkerHtml,
  buildStopValidationSnapshot,
  normalizeStopStatus,
  resolveStopVisualStatus,
  STOP_STATUS_COLORS,
  STOP_STATUS_LABELS,
  subscribePickupStatusSync,
} from '../utils/pickupStatusSync'
import useUserLocation from '../hooks/useUserLocation'
import { getApiErrorMessage } from '../utils/notificationHelpers'

export const LUCENA_CENTER = [13.9373, 121.6170];

export const ZONE_TYPE_MAP = {
  // ... (rest of ZONE_TYPE_MAP)

  "Barangay 1 (Pob.)": "commercial", "Barangay 2 (Pob.)": "commercial",
  "Barangay 3 (Pob.)": "commercial", "Barangay 4 (Pob.)": "commercial",
  "Barangay 5 (Pob.)": "commercial", "Barangay 6 (Pob.)": "commercial",
  "Barangay 7 (Pob.)": "commercial", "Barangay 8 (Pob.)": "commercial",
  "Barangay 9 (Pob.)": "commercial",
  "Barangay 10 (Pob.)": "commercial", "Barangay 11 (Pob.)": "commercial",
  "Gulang-Gulang": "industrial", "Cotta": "industrial",
  "Mayao Crossing": "agricultural", "Mayao Kanluran": "agricultural",
  "Mayao Parada": "agricultural", "Mayao Silangan": "agricultural",
  "Ilayang Dupay": "agricultural",
}

export function getZoneType(brgy_name) {
  return ZONE_TYPE_MAP[brgy_name] ?? "residential"
}

const REPORT_MODERATOR_ROLES = ["brgy_official", "admin"]

export const TRUCK_ROUTES = [];
export const GARBAGE_REPORTS = [];

const TYPE_LABELS = { overflow: "Overflow", illegal_dumping: "Illegal Dumping", missed: "Missed Pickup" };

export const ZONE_META = {
  residential: { label: "Residential", icon: ICONS.barangay, color: "#4ade80" },
  commercial: { label: "Commercial", icon: ICONS.dashboard, color: "#fb923c" },
  industrial: { label: "Industrial", icon: ICONS.waste, color: "#94a3b8" },
  agricultural: { label: "Agricultural", icon: ICONS.hotspot, color: "#a3e635" },
};

const STATUS_COLORS = {
  active: '#22c55e',
  weak_signal: '#f59e0b',
  offline: '#64748b',
}

const pickupScheduleId = (pickupStatus) => {
  const schedule = pickupStatus?.schedule
  if (schedule && typeof schedule === 'object') return schedule.id ?? schedule.pk
  return schedule ?? pickupStatus?.schedule_id
}

const buildStopStatusMap = (validations) => buildStopValidationSnapshot(validations).statusMap

const STOP_COLORS_MAP = Object.fromEntries(
  Object.entries(STOP_STATUS_COLORS).map(([key, val]) => [key, val.bg])
)

const ROUTE_COLORS = ['#14b8a6', '#f59e0b', '#a78bfa', '#22c55e', '#60a5fa', '#f97316']

function normalizeZoneName(value) {
  return String(value || '').trim().toLowerCase()
}

function scheduleMatchesZone(schedule, zone) {
  if (!schedule || !zone) return false
  const zoneName = normalizeZoneName(zone.name)
  const zoneId = zone.id != null ? String(zone.id) : ''

  const scheduleZoneNames = [
    schedule.barangay_names,
    schedule.area,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (zoneName && scheduleZoneNames.includes(zoneName)) return true

  const barangays = Array.isArray(schedule.barangays) ? schedule.barangays : []
  if (zoneId && barangays.some(b => String(b) === zoneId)) return true

  const waypoints = Array.isArray(schedule.waypoints) ? schedule.waypoints : []
  return waypoints.some(wp => String(wp?.barangay_id ?? '') === zoneId)
}

function getRouteColor(schedule, index = 0) {
  const seed = String(schedule?.truck ?? schedule?.truck_plate ?? schedule?.driver ?? schedule?.id ?? index)
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return ROUTE_COLORS[hash % ROUTE_COLORS.length]
}

function decodePolyline(encoded) {
  const points = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let b
    let shift = 0
    let result = 0

    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)

    const dlat = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1)
    lat += dlat
    shift = 0
    result = 0

    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)

    const dlng = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1)
    lng += dlng
    points.push([lat / 1e5, lng / 1e5])
  }

  return points
}

const makeTruckIcon = (color, label, status) => `
  <div style="position:relative;width:48px;height:48px;">
    <div style="
      background: rgba(15,23,42,0.85);
      border: 2px solid ${color};
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 14px;
      width: 44px; height: 44px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.2);
      transition: transform 0.2s;
    ">
      <svg viewBox="0 0 100 80" style="width: 26px; height: 26px; fill: ${color}; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
        <!-- Body Main -->
        <path d="M 38 22 L 65 22 L 65 60 L 38 60 Z"/>
        <rect x="42" y="22" width="4" height="38" fill="var(--bg, #0f172a)"/>
        <rect x="50" y="22" width="4" height="38" fill="var(--bg, #0f172a)"/>
        <rect x="58" y="22" width="4" height="38" fill="var(--bg, #0f172a)"/>
        <!-- Cab -->
        <path d="M 67 33 L 78 33 L 82 45 L 88 45 L 88 60 L 67 60 Z"/>
        <!-- Window -->
        <path d="M 71 36 L 76 36 L 79 44 L 71 44 Z" fill="var(--bg, #0f172a)"/>
        <!-- Tailgate -->
        <path d="M 18 35 L 36 22 L 36 50 L 24 50 L 22 55 Z"/>
        <!-- Pile & Trash Can -->
        <path d="M 8 60 C 10 50, 20 50, 25 55 L 28 55 C 30 55, 33 60, 36 60 L 36 65 L 8 65 Z"/>
        <rect x="12" y="44" width="6" height="10" transform="rotate(-30 15 49)" fill="${color}"/>
        <rect x="11" y="43" width="8" height="2" transform="rotate(-30 15 49)" fill="${color}"/>
        <!-- Wheels -->
        <circle cx="48" cy="60" r="7"/>
        <circle cx="78" cy="60" r="7"/>
        <circle cx="48" cy="60" r="3" fill="var(--bg, #0f172a)"/>
        <circle cx="78" cy="60" r="3" fill="var(--bg, #0f172a)"/>
      </svg>
    </div>
    <div style="
      position:absolute; bottom: -8px; left: 50%; transform: translateX(-50%);
      background: ${color}; color: #0f172a; font-size: 10px; font-weight: 800;
      padding: 2px 8px; border-radius: 12px; white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 1.5px solid #0f172a;
    ">${label}</div>
    <div style="
      position:absolute; top: -4px; right: -4px;
      width: 12px; height: 12px; border-radius: 50%;
      background: ${STATUS_COLORS[status] || '#64748b'};
      border: 2px solid #0f172a; box-shadow: 0 0 8px ${STATUS_COLORS[status] || '#64748b'};
    "></div>
  </div>`;

const DUMPSITE_TYPES = [
  { value: 'landfill', label: 'Landfill', icon: ICONS.dumpsite, color: '#e74c3c' },
  { value: 'dumpsite', label: 'Open Dumpsite', icon: ICONS.trash, color: '#f39c12' },
  { value: 'transfer', label: 'Transfer Station', icon: ICONS.truck, color: '#5dade2' },
  { value: 'composting', label: 'Composting Area', icon: ICONS.waste, color: '#2ecc71' },
]
const dumpsiteTypeMap = Object.fromEntries(DUMPSITE_TYPES.map(t => [t.value, t]))

const dumpSiteIconHtml = (type) => {
  const t = dumpsiteTypeMap[type] || DUMPSITE_TYPES[1]
  return `<div style="
    background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(240,240,240,0.85));
    border: 2px solid ${t.color};
    border-radius: 16px 16px 16px 4px;
    width: 42px; height: 42px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 10px 25px rgba(0,0,0,0.35), inset 0 2px 4px rgba(255,255,255,0.8);
    backdrop-filter: blur(4px);
    position: relative;
  ">
    <svg viewBox="0 0 100 80" style="width: 24px; height: 24px; fill: #334155; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">
      <path d="M 38 22 L 65 22 L 65 60 L 38 60 Z"/>
      <rect x="42" y="22" width="4" height="38" fill="#fff"/>
      <rect x="50" y="22" width="4" height="38" fill="#fff"/>
      <rect x="58" y="22" width="4" height="38" fill="#fff"/>
      <path d="M 67 33 L 78 33 L 82 45 L 88 45 L 88 60 L 67 60 Z"/>
      <path d="M 71 36 L 76 36 L 79 44 L 71 44 Z" fill="#fff"/>
      <path d="M 18 35 L 36 22 L 36 50 L 24 50 L 22 55 Z"/>
      <path d="M 8 60 C 10 50, 20 50, 25 55 L 28 55 C 30 55, 33 60, 36 60 L 36 65 L 8 65 Z"/>
      <rect x="12" y="44" width="6" height="10" transform="rotate(-30 15 49)" fill="#334155"/>
      <rect x="11" y="43" width="8" height="2" transform="rotate(-30 15 49)" fill="#334155"/>
      <circle cx="48" cy="60" r="7"/>
      <circle cx="78" cy="60" r="7"/>
      <circle cx="48" cy="60" r="3" fill="#fff"/>
      <circle cx="78" cy="60" r="3" fill="#fff"/>
    </svg>
    <div style="
      position: absolute; bottom: -5px; right: -5px;
      width: 14px; height: 14px; background: ${t.color};
      border-radius: 50%; border: 2px solid #fff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>
  </div>`
};

const garbageReportIconHtml = (severity) => {
  const colors = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
  const color = colors[severity] || "#f59e0b";
  return `<div style="
    background: rgba(15,23,42,0.8);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 2px solid ${color};
    border-radius: 50%;
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 15px ${color}66, inset 0 0 10px ${color}44;
  ">
    <div style="width: 20px; height: 20px; color: ${color}; display: flex;">
      ${ReactDOMServer.renderToString(ICONS.warning)}
    </div>
  </div>`;
};

// ─── STOP MARKER HTML (shared with ShiftRouteModule) ─────────────────────────
function makeYouMarkerHtml(accuracy) {
  const accRing = accuracy != null && accuracy <= 80
    ? `<div style="position:absolute;inset:-10px;border-radius:50%;border:2px solid rgba(59,130,246,0.35);pointer-events:none;"></div>`
    : ''
  return `
    <div style="position:relative;width:20px;height:20px;">
      ${accRing}
      <div style="position:absolute;inset:0;background:#3b82f6;border:3px solid white;border-radius:50%;
        box-shadow:0 0 0 4px rgba(59,130,246,0.35),0 4px 14px rgba(0,0,0,0.3);"></div>
      <div style="position:absolute;top:-18px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.9);
        color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;white-space:nowrap;">You</div>
    </div>`
}

function makeStopMarkerHtml(stopOrder, status, details, isActive = false) {
  return buildStopMarkerHtml(stopOrder, status, details, isActive)
}


// Inject stop marker keyframe once into document.head
// (divIcon html strings are inserted via innerHTML — @keyframes inside them
//  is browser-dependent and fails in Firefox/Safari. Injecting into head is reliable.)
function injectStopMarkerStyles() {
  if (document.getElementById('ww-stop-marker-styles')) return
  const style = document.createElement('style')
  style.id = 'ww-stop-marker-styles'
  style.textContent = `
    @keyframes wwPulse {
      0%, 100% { transform: scale(1); opacity: 0.55; }
      50%       { transform: scale(1.7); opacity: 0; }
    }
  `
  document.head.appendChild(style)
}



// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────


export default function MapView() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { notify } = useNotification()
  const mapRef = useRef(null)
  const [mapInstance, setMapInstance] = useState(null)
  const layersRef = useRef({})

  // ── Barangay stop markers (drawn separately from main layers) ─────────────
  // Keyed separately so drawAll() doesn't wipe them, and clearBarangayMarkers()
  // removes them without touching the main layer set.
  const barangayMarkersRef = useRef(new Map())
  const globalStopMarkersRef = useRef(new Map())
  const ghostMarkersRef = useRef(new Map())  // Markers that persist after zone is cleared (until hard reload)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showRouteScheduleId, setShowRouteScheduleId] = useState(null)  // null = no route shown, scheduleId = show that route
  const [barangayData, setBarangayData] = useState({ trucks: [], stops: [], loading: false })
  const [schedules, setSchedules] = useState([])   // ← NEW: collection schedules keyed by driver id
  const [fabOpen, setFabOpen] = useState(false)
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [selectedZone, setSelectedZone] = useState(null)
  const [selectedReport, setSelectedReport] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMode, setPanelMode] = useState("route")
  const [mapReady, setMapReady] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [heatmapMode, setHeatmapMode] = useState(false)
  const heatmapModeRef = useRef(false)
  useEffect(() => { heatmapModeRef.current = heatmapMode }, [heatmapMode])
  const [activeFilters, setActiveFilters] = useState({
    residential: true, commercial: true, industrial: true, agricultural: true,
    routes: true, trucks: true, dumpSites: true, reports: true,
  })
  const [barangayGeo, setBarangayGeo] = useState(null)
  const [barangays, setBarangays] = useState([])  // Django Barangay list (for pk lookups)
  const barangaysRef = useRef([])
  useEffect(() => { barangaysRef.current = barangays }, [barangays])
  const [reports, setReports] = useState([])
  const [dumpsites, setDumpsites] = useState([])
  const [activeTrucks, setActiveTrucks] = useState([])
  const userMarkerRef = useRef(null)
  const userAccuracyCircleRef = useRef(null)
  const hasCenteredOnUserRef = useRef(false)
  const { position: userPosition, accuracy: userAccuracy, error: userLocationError, isTracking: userLocationReady } = useUserLocation({ enabled: true })

  useEffect(() => subscribePickupStatusSync(() => {
    api.get('/api/watcher/stop-validations/')
      .then(res => {
        const rows = res.data?.results ?? res.data ?? []
        const snapshot = buildStopValidationSnapshot(rows)
        setStopStatusMap(snapshot.statusMap)
        setStopDetailsMap(snapshot.detailsMap)
      })
      .catch(err => console.error('[MapView] sync stop-validations error', err))
  }), [])

  useEffect(() => {
    injectStopMarkerStyles()
  }, [])

  const activeFiltersRef = useRef(activeFilters)
  const activeTrucksRef = useRef(activeTrucks)
  const barangayDataRef = useRef(barangayData)
  const selectedZoneRef = useRef(selectedZone)
  const mapInstanceRef = useRef(null)

  useEffect(() => { activeFiltersRef.current = activeFilters }, [activeFilters])
  useEffect(() => { activeTrucksRef.current = activeTrucks }, [activeTrucks])
  useEffect(() => { barangayDataRef.current = barangayData }, [barangayData])
  useEffect(() => { selectedZoneRef.current = selectedZone }, [selectedZone])
  const schedulesRef = useRef(schedules)
  useEffect(() => { schedulesRef.current = schedules }, [schedules])
  const routeRequestSeqRef = useRef(0)
  const orsRouteCacheRef = useRef(new Map())
  const drawAllTimeoutRef = useRef(null)
  // Stop completion data — keyed as Map<scheduleId_stopOrder, status>
  // Fetched on the same interval as trucks so the map stays current.
  const [stopStatusMap, setStopStatusMap] = useState(new Map())
  const stopStatusMapRef = useRef(new Map())
  useEffect(() => { stopStatusMapRef.current = stopStatusMap }, [stopStatusMap])
  const [stopDetailsMap, setStopDetailsMap] = useState(new Map())
  const stopDetailsMapRef = useRef(new Map())
  useEffect(() => { stopDetailsMapRef.current = stopDetailsMap }, [stopDetailsMap])

  useEffect(() => {
    fetch('/data/lucena_barangays.geojson')
      .then(r => r.json())
      .then(setBarangayGeo)
      .catch(err => console.error("Failed to load barangay GeoJSON:", err))

    api.get('/api/barangays/')
      .then(r => setBarangays(r.data))
      .catch(err => console.error('[MapView] Failed to fetch barangays:', err))

    api.get('/api/driver/dumpsites/')
      .then(r => setDumpsites(r.data))
      .catch(err => console.error('[MapView] Failed to fetch dumpsites:', err))

    fetchReports()
  }, [])

  // ── Handle focus from navigation state ──
  useEffect(() => {
    if (!mapInstance || !reports.length) return

    const focus = location.state?.focusReport
    if (!focus) return

    // Find in current data
    const found = reports.find(r => r.id === focus.id) || focus

    const lat = found.latitude || found.lat || found.location?.lat
    const lng = found.longitude || found.lng || found.location?.lng

    if (lat && lng) {
      console.log('[MapView] Focusing on report:', found.id)
      mapInstance.setView([lat, lng], 18)
      setSelectedReport(found)
      setPanelMode("report")
      setPanelOpen(true)

      // Clear state so it doesn't re-focus on every render
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [mapInstance, reports, location.state, navigate, location.pathname])

  async function fetchReports() {
    try {
      const res = await api.get('/api/watcher/reports/map_pins/')
      console.log(`[MapView] Fetched ${res.data.length} approved reports`)
      setReports(res.data)
    } catch (err) {
      console.error("Failed to fetch reports:", err)
    }
  }

  const statusColors = { collecting: "#22c55e", en_route: "#f59e0b", idle: "#64748b", done: "#3b82f6" }
  const statusLabels = { collecting: "Collecting", en_route: "En Route", idle: "Idle", done: "Done" }

  // ── Load Leaflet CDN ──────────────────────────────────────────────────────
  useEffect(() => {
    if (window.L && window.L.heatLayer) { setMapReady(true); return }
    const loadScripts = async () => {
      if (!window.L) {
        await new Promise(r => {
          const script = document.createElement("script")
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          script.onload = r
          document.head.appendChild(script)
        })
      }
      if (!window.L.heatLayer) {
        await new Promise(r => {
          const script = document.createElement("script")
          script.src = "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"
          script.onload = r
          document.head.appendChild(script)
        })
      }
      setMapReady(true)
    }
    loadScripts()
  }, [])

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstance) return
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: "topright" }).addTo(map)

    setMapInstance(map)
    mapInstanceRef.current = map

    // Fix for fragmented tiles
    setTimeout(() => map.invalidateSize(), 100)
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(mapRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      setMapInstance(null)
      mapInstanceRef.current = null
    }
  }, [mapReady])

  // ── Live truck tracking — poll every 10 s ─────────────────────────────────
  // Also fetches collection schedules (for waypoints/stop markers).
  // Schedules are re-fetched on the same interval so stop statuses stay fresh.
  // ── Live truck tracking — poll every 10 s ─────────────────────────────────
  // ── Live truck tracking — poll every 10 s ─────────────────────────────────
  useEffect(() => {
    const fetchAll = () => {
      api.get('/api/driver/shift/active_shifts/')
        .then(res => setActiveTrucks(res.data))
        .catch(err => console.error('[MapView] active_shifts error', err))

      api.get('/api/driver/collection-schedules/')
        .then(res => setSchedules(res.data))
        .catch(err => console.error('[MapView] collection-schedules error', err))

      api.get('/api/watcher/stop-validations/')
        .then(res => {
          const rows = res.data?.results ?? res.data ?? []
          setStopStatusMap(buildStopStatusMap(rows))
          const details = new Map()
          rows.forEach(ps => {
            const scheduleId = ps.schedule_id ?? pickupScheduleId(ps)
            const stopOrder = Number(ps.stop_order ?? ps.stopOrder ?? ps.stop_id)
            if (scheduleId == null || Number.isNaN(stopOrder)) return
            const key = `${scheduleId}:${stopOrder}`
            let collectedAt = ''
            try {
              if (ps.collected_at) {
                const d = new Date(ps.collected_at)
                if (!isNaN(d)) collectedAt = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              }
            } catch { }
            details.set(key, {
              collectedAt,
              truck: ps.truck_plate || ps.truck || '',
              scheduleId,
              scheduledTime: ps.scheduledTime || '',
            })
          })
          setStopDetailsMap(details)
        })
        .catch(err => console.error('[MapView] stop-validations error', err))

      // ── NEW: if a zone panel is open, re-fetch its barangay stops so
      // collected/current markers stay live on the same 10s heartbeat.
      const zone = selectedZoneRef.current
      if (zone?.name) {
        api.get(`/api/driver/shift/barangay_stops/?barangay_name=${encodeURIComponent(zone.name)}&scope=focus`)
          .then(res => {
            setBarangayData({
              trucks: res.data.trucks || [],
              stops: res.data.stops || [],
              loading: false,
            })
            // Redraw barangay markers with fresh status data
            clearBarangayMarkers()
            clearGlobalStopMarkers()
            drawBarangayStops(res.data.stops || [])
          })
          .catch(() => { /* silently ignore — stale markers are better than crashing */ })
      }
    }

    fetchAll()
    const intv = setInterval(fetchAll, 10000)
    return () => clearInterval(intv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Live reports — poll every 30 s ───────────────────────────────────────
  useEffect(() => {
    fetchReports()
    const intv = setInterval(fetchReports, 30_000)
    return () => clearInterval(intv)
  }, [])

  // ── Redraw main layers whenever relevant state changes ────────────────────
  // Debounced: the 10s poll fires 3 separate API calls (active_shifts,
  // collection-schedules, stop-validations) that resolve at slightly
  // different times. Without debouncing, each resolution triggers its own
  // drawAll() -> routeRequestSeqRef bump, which invalidates the in-flight ORS
  // fetch from the PREVIOUS drawAll before it can resolve — so the
  // road-snapped route never gets cached and the map permanently falls back
  // to straight dashed lines. Debouncing collapses that burst into a single
  // drawAll() per poll cycle, giving ORS time to respond and populate the cache.
  useEffect(() => {
    if (!mapInstanceRef.current) return
    if (drawAllTimeoutRef.current) clearTimeout(drawAllTimeoutRef.current)
    drawAllTimeoutRef.current = setTimeout(() => {
      drawAllTimeoutRef.current = null
      console.log('[MapView] redraw layers', {
        mapReady, barangayGeo: !!barangayGeo,
        heatmapMode,
        activeFilters: Object.keys(activeFilters).filter(k => activeFilters[k]),
        activeTrucks: activeTrucks.length,
        reports: reports.length,
        dumpsites: dumpsites.length,
        barangayData: barangayData.trucks.length + barangayData.stops.length,
        schedules: schedules.length,
        stopStatusMap: stopStatusMap.size,
      })
      drawAll(mapInstanceRef.current)
    }, 300)
    return () => {
      if (drawAllTimeoutRef.current) clearTimeout(drawAllTimeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, barangayGeo, heatmapMode, activeFilters, activeTrucks, reports, dumpsites, barangayData, schedules, stopStatusMap, selectedZone])

  // ── Fetch barangay stops when a zone is selected ──────────────────────────
  // Draws stop markers (colour-coded like ShiftRouteModule) WITHOUT the route.
  // ── Fetch barangay stops when a zone is first selected ────────────────────
  // Subsequent re-fetches happen inside fetchAll() on the 10s heartbeat.
  // ── Fetch barangay stops when a zone is first selected ────────────────────
  useEffect(() => {
    if (!selectedZone || !mapReady) {
      clearBarangayMarkers()
      clearGlobalStopMarkers()
      return
    }
    // ← ADD THESE TWO LINES: wipe previous zone's markers before fetching new ones
    clearBarangayMarkers()
    clearGlobalStopMarkers()

    setBarangayData({ trucks: [], stops: [], loading: true })

    api.get(`/api/driver/shift/barangay_stops/?barangay_name=${encodeURIComponent(selectedZone.name)}&scope=focus`)
      .then(res => {
        setBarangayData({ trucks: res.data.trucks || [], stops: res.data.stops || [], loading: false })
        drawBarangayStops(res.data.stops || [])
      })
      .catch(() => setBarangayData({ trucks: [], stops: [], loading: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZone?.name, mapReady])

  function clearBarangayFocus() {
    if (drawAllTimeoutRef.current) {
      clearTimeout(drawAllTimeoutRef.current)
      drawAllTimeoutRef.current = null
    }
    routeRequestSeqRef.current += 1
    if (mapInstanceRef.current) clearLayers(mapInstanceRef.current)

    // ── Convert barangay markers to ghost markers (they stay on map until reload) ──
    barangayMarkersRef.current.forEach((entry, key) => {
      if (!ghostMarkersRef.current.has(key)) {
        // Dim the ghost marker to distinguish it from active ones
        try {
          const el = entry.marker.getElement()
          if (el) el.style.opacity = '0.45'
        } catch { }
        ghostMarkersRef.current.set(key, entry)
      } else {
        // Already a ghost — just remove the duplicate live one
        try { mapInstanceRef.current?.removeLayer(entry.marker) } catch { }
      }
    })
    barangayMarkersRef.current = new Map()

    clearGlobalStopMarkers()
    setBarangayData({ trucks: [], stops: [], loading: false })
    setShowRouteScheduleId(null)
    selectedZoneRef.current = null
    setSelectedZone(null)
    setSelectedRoute(null)
    setPanelOpen(false)
    drawAllTimeoutRef.current = setTimeout(() => {
      drawAllTimeoutRef.current = null
      if (mapInstanceRef.current) drawAll(mapInstanceRef.current)
    }, 50)
  }

  // ── Live user location marker (exact GPS, not hardcoded) ─────────────────
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !userPosition) return
    const L = window.L
    const latLng = [userPosition.lat, userPosition.lng]

    if (!userMarkerRef.current) {
      const icon = L.divIcon({
        html: makeYouMarkerHtml(userAccuracy),
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      })
      userMarkerRef.current = L.marker(latLng, { icon, zIndexOffset: 1200 }).addTo(mapInstanceRef.current)
      userMarkerRef.current.bindPopup(`<b>Your location</b>${userAccuracy != null ? `<br/><span style="font-size:11px;color:#64748b">±${userAccuracy}m accuracy</span>` : ''}`)
    } else {
      userMarkerRef.current.setLatLng(latLng)
      userMarkerRef.current.setIcon(L.divIcon({
        html: makeYouMarkerHtml(userAccuracy),
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }))
    }

    if (userAccuracy != null && userAccuracy <= 120) {
      if (userAccuracyCircleRef.current) {
        userAccuracyCircleRef.current.setLatLng(latLng)
        userAccuracyCircleRef.current.setRadius(userAccuracy)
      } else {
        userAccuracyCircleRef.current = L.circle(latLng, {
          radius: userAccuracy,
          color: '#3b82f6',
          weight: 1,
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
        }).addTo(mapInstanceRef.current)
      }
    }

    if (!hasCenteredOnUserRef.current && userLocationReady) {
      mapInstanceRef.current.setView(latLng, Math.max(mapInstanceRef.current.getZoom(), 15))
      hasCenteredOnUserRef.current = true
    }
  }, [userPosition, userAccuracy, userLocationReady])

  // ─── BARANGAY STOP MARKER HELPERS ────────────────────────────────────────

  function clearBarangayMarkers() {
    barangayMarkersRef.current.forEach(({ marker }) => {
      try { mapInstanceRef.current?.removeLayer(marker) } catch { }
    })
    barangayMarkersRef.current = new Map()
  }

  function clearGlobalStopMarkers() {
    globalStopMarkersRef.current.forEach(({ marker }) => {
      try { mapInstanceRef.current?.removeLayer(marker) } catch { }
    })
    globalStopMarkersRef.current = new Map()
  }

  function resolveLiveBarangayStopStatus(stop) {
    const scheduleId = stop.schedule_id ?? stop.schedule?.id ?? stop.schedule?.pk
    const stopOrder = Number(stop.stop_order ?? stop.stopOrder ?? stop.stop_id)
    if (scheduleId != null && !Number.isNaN(stopOrder)) {
      const statusKey = `${scheduleId}:${stopOrder}`
      if (stopStatusMapRef.current.has(statusKey)) {
        return normalizeStopStatus(stopStatusMapRef.current.get(statusKey))
      }
    }
    return resolveStopVisualStatus(stop, 'PENDING_INSPECTION')
  }

  function drawBarangayStops(stops, { fitBounds = true } = {}) {
    if (!mapInstanceRef.current || !window.L) return

    const L = window.L
    const desired = new Map()

    // Build a schedule lookup for enriching popups
    const schedLookup = {}
    schedulesRef.current.forEach(s => { schedLookup[s.id] = s })

    stops.forEach(stop => {
      if (!stop.lat || !stop.lng) return
      const stopStatus = resolveLiveBarangayStopStatus(stop)
      const color = STOP_COLORS_MAP[stopStatus]
      const displayColor = color === 'transparent' ? '#94a3b8' : color
      const isActive = Boolean(stop.is_current) || stopStatus === 'READY_FOR_COLLECTION' || stopStatus === 'COLLECTION_REPORTED'
      const size = isActive ? 28 : 24
      const scheduleId = stop.schedule_id ?? stop.schedule?.id ?? stop.schedule?.pk
      const stopOrder = Number(stop.stop_order ?? stop.stopOrder ?? stop.stop_id)
      if (scheduleId == null || Number.isNaN(stopOrder)) return
      const statusKey = `${scheduleId}:${stopOrder}`

      const sched = schedLookup[scheduleId]
      const totalStops = sched ? Math.max(0, (sched.waypoints?.length || 1) - 1) : '?'
      const scheduledTime = sched?.start_time ? sched.start_time.slice(0, 5) : 'N/A'
      const driverName = stop.driver_name || sched?.driver_name || '—'
      const truckPlate = stop.truck_plate || sched?.truck_plate || '—'

      // Build details for barangay stop if available
      const bCollectedRaw = stop.collected_at || stop.collectedAt || stop.collectedAtRaw
      let bCollected = ''
      try { if (bCollectedRaw) { const d = new Date(bCollectedRaw); if (!isNaN(d)) bCollected = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } } catch (e) { bCollected = '' }
      const bDetails = {
        collectedAt: bCollected,
        truck: truckPlate,
        scheduleId: scheduleId
      }
      const popupHtml = `<div style="font-family:sans-serif;min-width:200px;padding:2px 0">
          <b style="font-size:13px;">${stop.label || `Stop ${stopOrder}`}</b>
          <div style="margin:4px 0;display:flex;align-items:center;gap:6px;">
            <span style="background:${displayColor};color:#fff;font-size:9px;font-weight:800;padding:2px 7px;border-radius:20px;text-transform:uppercase;">${STOP_STATUS_LABELS[stopStatus] || stopStatus}</span>
            <span style="color:#94a3b8;font-size:10px;font-weight:700;">STOP ${stopOrder} of ${totalStops}</span>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">🕐 Scheduled: <b style="color:#e2e8f0">${scheduledTime}</b></div>
          <div style="font-size:11px;color:#64748b;">👤 Driver: <b style="color:#e2e8f0">${driverName}</b></div>
          <div style="font-size:11px;color:#64748b;">🚛 Truck: <b style="color:#14b8a6">${truckPlate}</b></div>
          ${bCollected ? `<div style="margin-top:5px;font-size:11px;color:#10b981;">✓ Collected: ${bCollected}</div>` : ''}
          <div style="margin-top:8px;">
            <button onclick="window.__wwViewRoute && window.__wwViewRoute(${scheduleId})" style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.5);color:#93c5fd;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;">🗺️ View Full Route</button>
          </div>
        </div>`

      desired.set(statusKey, {
        lat: Number(stop.lat),
        lng: Number(stop.lng),
        status: stopStatus,
        details: bDetails,
        label: stop.label,
        isActive,
        size,
        popupHtml,
        zIndexOffset: isActive ? 900 : 800,
      })
    })

    const toRemove = []
    barangayMarkersRef.current.forEach((entry, key) => {
      if (!desired.has(key)) toRemove.push(key)
    })
    toRemove.forEach(key => {
      try { mapInstanceRef.current?.removeLayer(barangayMarkersRef.current.get(key).marker) } catch { }
      barangayMarkersRef.current.delete(key)
    })

    desired.forEach((entry, key) => {
      const existing = barangayMarkersRef.current.get(key)
      const signature = `${entry.status}|${entry.details.collectedAt}|${entry.details.truck}|${entry.isActive ? 1 : 0}`
      if (existing) {
        if (existing.signature === signature) return
        existing.marker.setIcon(L.divIcon({
          html: makeStopMarkerHtml(key.split(':')[1], entry.status, entry.details, entry.isActive),
          className: '',
          iconSize: [entry.size, entry.size],
          iconAnchor: [entry.size / 2, entry.size / 2],
        }))
        existing.marker.getPopup()?.setContent(entry.popupHtml)
        existing.signature = signature
        existing.status = entry.status
        return
      }

      const marker = L.marker([entry.lat, entry.lng], {
        icon: L.divIcon({
          html: makeStopMarkerHtml(key.split(':')[1], entry.status, entry.details, entry.isActive),
          className: '',
          iconSize: [entry.size, entry.size],
          iconAnchor: [entry.size / 2, entry.size / 2],
        }),
        zIndexOffset: entry.zIndexOffset,
      })
        .addTo(mapInstanceRef.current)
        .bindPopup(entry.popupHtml)

      barangayMarkersRef.current.set(key, { marker, status: entry.status, signature })
    })

    // Fit map to show all stop markers if there are any
    if (fitBounds && barangayMarkersRef.current.size > 0) {
      try {
        const group = L.featureGroup([...barangayMarkersRef.current.values()].map(entry => entry.marker))
        mapInstanceRef.current.fitBounds(group.getBounds().pad(0.3))
      } catch { }
    }
  }

  useEffect(() => {
    if (!mapReady || !selectedZone?.name || !mapInstanceRef.current) return
    if (!selectedZoneRef.current) {
      clearBarangayMarkers()
      clearGlobalStopMarkers()
      return
    }
    drawBarangayStops(barangayDataRef.current.stops || [], { fitBounds: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, selectedZone?.name, stopStatusMap, stopDetailsMap])

  // ── Draw stop markers for the selected barangay's active drivers ──────────
  // Only called when a zone IS selected; mirrors ShiftRouteModule stop colours.
  // Does NOT draw polylines, ORS routes, or navigation paths — driver-only.
  function drawGlobalStops(map, allowedShiftIds = null) {
    if (!map || !window.L) return
    const L = window.L

    // Build a set of allowed driver IDs from the barangay trucks as a fallback
    // (schedules may link to a shift via shift_id, or to a driver via driver / driver_id)
    const barangayDriverIds = allowedShiftIds !== null
      ? new Set(barangayDataRef.current.trucks.map(t => t.driver_id ?? t.driverId).filter(Boolean))
      : null

    const pendingSchedules = schedulesRef.current.filter(s => {
      const st = String(s.status || '').toUpperCase()
      if (['COMPLETED', 'CANCELLED'].includes(st)) return false
      if (allowedShiftIds === null) return true
      // Match by shift id first, then fall back to driver id
      const schedShiftId = s.shift_id ?? s.shift ?? s.id
      if (allowedShiftIds.has(schedShiftId)) return true
      const schedDriverId = s.driver_id ?? s.driver
      if (barangayDriverIds && schedDriverId != null && barangayDriverIds.has(schedDriverId)) return true
      return false
    })

    const desired = new Map()
    pendingSchedules.forEach(schedule => {
      const waypoints = schedule.waypoints || []

      // ── Index 0: home base marker ──
      if (waypoints[0]?.lat && waypoints[0]?.lng) {
        const baseKey = `${schedule.id}:base`
        desired.set(baseKey, {
          wp: waypoints[0], stopOrder: 'base',
          stopStatus: 'base', details: null, schedule, statusKey: baseKey,
        })
      }

      // ── Index 1+: collection stops ──
      waypoints.slice(1).forEach((wp, i) => {
        const stopOrder = i + 1
        if (!wp.lat || !wp.lng) return

        const currentZone = selectedZoneRef.current
        // Compare as strings — barangay_id may be int or string from API
        if (currentZone && currentZone.id != null && String(wp.barangay_id) !== String(currentZone.id)) return

        const statusKey = `${schedule.id}:${stopOrder}`
        if (!stopStatusMapRef.current.has(statusKey)) return
        const stopStatus = normalizeStopStatus(stopStatusMapRef.current.get(statusKey))
        const details = stopDetailsMapRef.current.get(statusKey)
        desired.set(statusKey, { wp, stopOrder, stopStatus, details, schedule, statusKey })
      })
    })

    // Remove stale markers
    const toRemove = []
    globalStopMarkersRef.current.forEach((markerEntry, key) => {
      if (!desired.has(key)) toRemove.push(key)
    })
    toRemove.forEach(key => {
      try { map.removeLayer(globalStopMarkersRef.current.get(key).marker) } catch { }
      globalStopMarkersRef.current.delete(key)
    })

    // Add new or repaint changed markers
    desired.forEach(({ wp, stopOrder, stopStatus, details, schedule }, key) => {
      const existing = globalStopMarkersRef.current.get(key)

      // ── Home base: special green house marker ──
      if (stopOrder === 'base') {
        if (existing) return  // base marker never changes
        const baseIcon = L.divIcon({
          html: `<div style="position:relative;width:36px;height:36px;">
            <div style="position:absolute;inset:0;background:#16a34a;border:2.5px solid #fff;
              border-radius:50%;display:flex;align-items:center;justify-content:center;
              box-shadow:0 3px 14px rgba(22,163,74,0.55);font-size:16px;">🏠</div>
          </div>`,
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        })
        const marker = L.marker([Number(wp.lat), Number(wp.lng)], {
          icon: baseIcon, zIndexOffset: 700,
        })
          .addTo(map)
          .bindPopup(`<div style="font-family:sans-serif;min-width:160px;">
            <b style="font-size:13px;">${wp.label || 'Home Base'}</b><br/>
            <span style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase;">HOME BASE</span><br/>
            <span style="font-size:11px;color:#64748b;">${schedule.barangay_names || ''}</span>
          </div>`)
        globalStopMarkersRef.current.set(key, { marker, status: 'base' })
        return
      }

      // ── Collection stop: repaint if status changed ──
      if (existing) {
        if (existing.status !== stopStatus) {
          existing.marker.setIcon(L.divIcon({
            html: makeStopMarkerHtml(stopOrder, stopStatus, details),
            className: '',
            iconSize: stopStatus === 'current' ? [28, 28] : [24, 24],
            iconAnchor: stopStatus === 'current' ? [14, 14] : [12, 12],
          }))
          existing.status = stopStatus
        }
        return
      }

      // ── New collection stop marker ──
      const color = STOP_COLORS_MAP[stopStatus]
      const barangayName = schedule.barangay_names || 'Unknown'
      const marker = L.marker([Number(wp.lat), Number(wp.lng)], {
        icon: L.divIcon({
          html: makeStopMarkerHtml(stopOrder, stopStatus, details),
          className: '',
          iconSize: stopStatus === 'current' ? [28, 28] : [24, 24],
          iconAnchor: stopStatus === 'current' ? [14, 14] : [12, 12],
        }),
        zIndexOffset: 600,
      })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:200px;">
            <b style="font-size:13px;">${wp.label || `Stop ${stopOrder}`}</b><br/>
            <div style="margin:5px 0 3px;display:flex;align-items:center;gap:6px;">
              <span style="background:${color};color:#fff;font-size:9px;font-weight:800;
                padding:2px 7px;border-radius:20px;letter-spacing:.04em;text-transform:uppercase;">
                ${STOP_STATUS_LABELS[stopStatus] || stopStatus}
              </span>
              <span style="color:#94a3b8;font-size:9px;font-weight:700;">STOP ${stopOrder}</span>
            </div>
            <span style="font-size:11px;color:#64748b;">📍 ${barangayName}</span>
            ${details?.collectedAt ? `<div style="margin-top:6px;font-size:11px;color:#10b981">✓ Collected: ${details.collectedAt}</div>` : ''}
            ${details?.truck ? `<div style="font-size:11px;color:#64748b;">🚛 ${details.truck}</div>` : ''}
          </div>
        `)

      globalStopMarkersRef.current.set(key, { marker, status: stopStatus })
    })
  }
  // ─── MAIN LAYER DRAW ─────────────────────────────────────────────────────

  function clearLayers(map) {
    Object.values(layersRef.current).forEach(l => { try { map.removeLayer(l) } catch { } })
    layersRef.current = {}
    // Note: barangayMarkersRef is intentionally NOT cleared here — those
    // persist while the panel is open and are managed separately.
  }

  // Expose View Route handler for Leaflet popup button clicks
  useEffect(() => {
    window.__wwViewRoute = (scheduleId) => {
      setShowRouteScheduleId(prev => prev === scheduleId ? null : scheduleId)
    }
    return () => { delete window.__wwViewRoute }
  }, [])

  // Draw route polyline when showRouteScheduleId changes
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return
    // Remove any existing on-demand route layers
    Object.keys(layersRef.current).forEach(k => {
      if (k.startsWith('ondemand-')) {
        try { mapInstanceRef.current.removeLayer(layersRef.current[k]) } catch { }
        delete layersRef.current[k]
      }
    })
    if (!showRouteScheduleId) return
    const sched = schedulesRef.current.find(s => s.id === showRouteScheduleId)
    if (!sched) return
    const L = window.L
    const routeColor = getRouteColor(sched)
    const pts = (sched.waypoints || []).filter(wp => wp.lat && wp.lng).map(wp => [Number(wp.lat), Number(wp.lng)])
    if (pts.length < 2) return
    const line = L.polyline(pts, { color: routeColor, weight: 5, opacity: 0.85, dashArray: '10,6', lineCap: 'round' }).addTo(mapInstanceRef.current)
    layersRef.current['ondemand-route'] = line
    mapInstanceRef.current.fitBounds(line.getBounds().pad(0.2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRouteScheduleId])

  function drawAll(map) {
    const L = window.L
    if (!L) return
    clearLayers(map)
    clearGlobalStopMarkers()
    // NOTE: barangayMarkersRef is intentionally NOT cleared here —
    // active focus markers are managed by drawBarangayStops() and
    // ghost markers must persist across redraws.


    // ── Barangay GeoJSON zones ──
    if (barangayGeo) {
      const geoLayer = L.geoJSON(barangayGeo, {
        style: (feature) => {
          const type = getZoneType(feature.properties.brgy_name)
          const meta = ZONE_META[type]
          const zone = selectedZoneRef.current
          const isFocused = zone && feature.properties.brgy_name === zone.name
          const isDimmed = zone && !isFocused
          if (!activeFiltersRef.current[type]) {
            return { opacity: 0, fillOpacity: 0, pointerEvents: "none" }
          }
          return {
            color: isFocused ? '#f59e0b' : meta.color,
            weight: isFocused ? 3 : 1.5,
            opacity: isDimmed ? 0.25 : 0.85,
            fillColor: isFocused ? '#f59e0b' : meta.color,
            fillOpacity: isFocused ? 0.28 : isDimmed ? 0.05 : 0.18,
            dashArray: isFocused ? '' : '5,4',
          }
        },
        onEachFeature: (feature, layer) => {
          const type = getZoneType(feature.properties.brgy_name)
          const color = ZONE_META[type].color

          layer.on("click", () => {
            // Cancel pending drawAll so it doesn't fire with the previous zone
            if (drawAllTimeoutRef.current) {
              clearTimeout(drawAllTimeoutRef.current)
              drawAllTimeoutRef.current = null
            }
            routeRequestSeqRef.current += 1
            if (mapInstanceRef.current) clearLayers(mapInstanceRef.current)
            const djangoBrgy = barangaysRef.current.find(b => b.name === feature.properties.brgy_name)
            const newZone = {
              id: djangoBrgy ? djangoBrgy.id : null,
              brgy_code: feature.properties.brgy_code,
              name: feature.properties.brgy_name,
              type,
              color,
              djangoBrgy,
            }
            clearBarangayMarkers()
            clearGlobalStopMarkers()
            selectedZoneRef.current = newZone
            setSelectedZone(newZone)
            setPanelMode("zone")
            setPanelOpen(true)
          })
          layer.on("mouseover", () => {
            if (activeFiltersRef.current[type]) layer.setStyle({ fillOpacity: 0.32 })
          })
          layer.on("mouseout", () => {
            if (activeFiltersRef.current[type]) layer.setStyle({ fillOpacity: 0.18 })
          })
          layer.bindTooltip(feature.properties.brgy_name, {
            permanent: false, direction: "center",
            className: "leaflet-barangay-tooltip",
          })
        },
      }).addTo(map)
      layersRef.current["geojson-barangays"] = geoLayer
    }

    const focusedZone = selectedZoneRef.current
    const zoneFocusActive = Boolean(focusedZone)

    // Routes are drawn on-demand via View Route button (showRouteScheduleId effect)
    // NOT here in drawAll — this prevents route lines overlapping with stop-only view
    if (false && activeFilters.routes && zoneFocusActive) {
      const requestToken = ++routeRequestSeqRef.current
      const orsApiKey = import.meta.env.VITE_ORS_API_KEY
      if (!orsApiKey) {
        console.warn('[MapView] VITE_ORS_API_KEY is not set — all routes will use the straight-line fallback')
      }

      schedulesRef.current.forEach((schedule, index) => {
        if (!scheduleMatchesZone(schedule, focusedZone)) return

        const routePoints = (schedule.waypoints || [])
          .map(wp => ({
            lat: Number(wp.lat),
            lng: Number(wp.lng),
            label: wp.label || wp.name || '',
            barangay_id: wp.barangay_id ?? null,
          }))
          .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        if (routePoints.length < 2) return

        const routeColor = getRouteColor(schedule, index)
        const routeId = schedule.id ?? `schedule-${index}`
        const stopOrders = routePoints.slice(1)
        const collectedCount = stopOrders.reduce((count, _, stopIndex) => {
          const key = `${routeId}:${stopIndex + 1}`
          const status = normalizeStopStatus(stopStatusMapRef.current.get(key))
          return ['VERIFIED_COLLECTED', 'COLLECTION_REPORTED'].includes(status) ? count + 1 : count
        }, 0)
        const totalPoints = stopOrders.length
        const completedIndex = totalPoints > 0
          ? Math.max(0, Math.min(collectedCount, routePoints.length - 1))
          : Math.max(0, routePoints.length - 2)

        const clickHandler = () => {
          setSelectedRoute({
            ...schedule,
            color: routeColor,
            truckId: schedule.truck_plate || schedule.truck || '',
            driver: schedule.driver_name || schedule.driver || '',
            truckModel: schedule.truck_model || schedule.truck_model_name || 'Unknown',
            barangay: schedule.barangay_names || focusedZone.name,
            status: collectedCount >= totalPoints && totalPoints > 0 ? 'done' : collectedCount > 0 ? 'collecting' : 'en_route',
            collectedCount,
            totalPoints,
            capacity: totalPoints ? Math.round((collectedCount / totalPoints) * 100) : 0,
            eta: schedule.start_time ? schedule.start_time.slice(0, 5) : 'N/A',
            nextCollection: stopOrders[0]?.label || 'N/A',
            lastUpdate: schedule.updated_at || schedule.updatedAt || 'N/A',
          })
          setPanelMode("route")
          setPanelOpen(true)
        }

        const paintFallbackRoute = () => {
          const donePts = routePoints.slice(0, completedIndex + 1).map(p => [p.lat, p.lng])
          const remPts = routePoints.slice(completedIndex).map(p => [p.lat, p.lng])

          const doneLine = L.polyline(donePts, {
            color: routeColor,
            weight: 5,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
          }).addTo(map)
          const remLine = L.polyline(remPts, {
            color: routeColor,
            weight: 4,
            opacity: 0.5,
            dashArray: "10,8",
          }).addTo(map)
          doneLine.on("click", clickHandler)
          remLine.on("click", clickHandler)

          routePoints.forEach((pt, i) => {
            const done = i <= completedIndex
            const circle = L.circleMarker([pt.lat, pt.lng], {
              radius: done ? 7 : 5,
              fillColor: done ? routeColor : "#1e293b",
              color: routeColor,
              weight: 2,
              opacity: 1,
              fillOpacity: done ? 1 : 0.6,
            }).addTo(map)
            circle.on("click", clickHandler)
            layersRef.current[`stop-${routeId}-${i}`] = circle
          })

          layersRef.current[`route-done-${routeId}`] = doneLine
          layersRef.current[`route-rem-${routeId}`] = remLine
        }

        function routeSignature(routePoints) {
          return routePoints.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
        }

        if (!orsApiKey) {
          paintFallbackRoute()
          return
        }

        // ── Draw the route line + stop circles from already-decoded geometry.
        // Called either immediately (cache hit) or once a fresh ORS fetch resolves.
        const paintFromDecoded = (decoded) => {
          const routeLine = L.polyline(decoded, {
            color: routeColor,
            weight: 6,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round",
          }).addTo(map)
          routeLine.on("click", clickHandler)
          layersRef.current[`route-ors-${routeId}`] = routeLine

          routePoints.forEach((pt, i) => {
            const done = i <= completedIndex
            const circle = L.circleMarker([pt.lat, pt.lng], {
              radius: done ? 7 : 5,
              fillColor: done ? routeColor : "#1e293b",
              color: routeColor,
              weight: 2,
              opacity: 1,
              fillOpacity: done ? 1 : 0.6,
            }).addTo(map)
            circle.on("click", clickHandler)
            layersRef.current[`stop-${routeId}-${i}`] = circle
          })
        }

        const signature = routeSignature(routePoints)
        const cached = orsRouteCacheRef.current.get(routeId)

        // ── Cache hit: waypoints haven't changed since the last successful
        // ORS fetch — redraw synchronously from cached geometry, no network
        // round-trip, so the route line never disappears between polls.
        if (cached && cached.signature === signature) {
          paintFromDecoded(cached.decoded)
          return
        }

        // ── Cache miss (new route or waypoints changed) — fetch ORS once.
        // Until it resolves, fall back to the straight-line route so the
        // line never just vanishes.
        paintFallbackRoute()

        fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
          method: 'POST',
          headers: {
            Accept: 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
            'Content-Type': 'application/json',
            Authorization: orsApiKey,
          },
          body: JSON.stringify({
            coordinates: routePoints.map(pt => [pt.lng, pt.lat]),
            instructions: false,
          }),
        })
          .then(res => res.json())
          .then(data => {
            if (requestToken !== routeRequestSeqRef.current) return
            if (selectedZoneRef.current?.name !== focusedZone.name) return
            if (!data.routes?.length) return

            const decoded = decodePolyline(data.routes[0].geometry)
            orsRouteCacheRef.current.set(routeId, { signature, decoded })

              // Remove the fallback straight-line layers for this route, then
              // draw the road-snapped version in their place.
              ;['route-done-', 'route-rem-'].forEach(prefix => {
                const layer = layersRef.current[`${prefix}${routeId}`]
                if (layer) { try { map.removeLayer(layer) } catch { }; delete layersRef.current[`${prefix}${routeId}`] }
              })
            paintFromDecoded(decoded)
          })
          .catch(() => {
            if (requestToken !== routeRequestSeqRef.current) return
            if (selectedZoneRef.current?.name !== focusedZone.name) return
            paintFallbackRoute()
          })
      })
    }

    // ── Truck routes (visible only when a barangay is focused) ──
    if (false && activeFilters.routes && zoneFocusActive) {
      const normalizeName = (value) => String(value || '').trim().toLowerCase()
      const focusedName = normalizeName(focusedZone.name)
      TRUCK_ROUTES.forEach(route => {
        const routeBarangay =
          route.barangay ||
          route.barangay_name ||
          route.zone ||
          route.zoneName ||
          route.zone_name ||
          route.area
        if (routeBarangay && normalizeName(routeBarangay) !== focusedName) return

        const donePts = route.waypoints.slice(0, route.completedUpTo + 1)
        const remPts = route.waypoints.slice(route.completedUpTo)
        const clickHandler = () => { setSelectedRoute(route); setPanelMode("route"); setPanelOpen(true) }

        const doneLine = L.polyline(donePts, { color: route.color, weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(map)
        const remLine = L.polyline(remPts, { color: route.color, weight: 4, opacity: 0.5, dashArray: "10,8" }).addTo(map)
        doneLine.on("click", clickHandler)
        remLine.on("click", clickHandler)

        route.waypoints.forEach((coord, i) => {
          const done = i <= route.completedUpTo
          const circle = L.circleMarker(coord, {
            radius: done ? 7 : 5,
            fillColor: done ? route.color : "#1e293b",
            color: route.color, weight: 2, opacity: 1,
            fillOpacity: done ? 1 : 0.6,
          }).addTo(map)
          circle.on("click", clickHandler)
          layersRef.current[`stop-${route.id}-${i}`] = circle
        })

        layersRef.current[`route-done-${route.id}`] = doneLine
        layersRef.current[`route-rem-${route.id}`] = remLine
      })
    }

    // ── Live truck markers — only visible when a barangay zone is selected ──
    // Trucks and stop markers are hidden on the default overview. When a zone is
    // selected the driver markers and stop pins for that barangay appear, giving
    // a focused per-barangay view instead of a cluttered city-wide one.
    if (activeFilters.trucks && zoneFocusActive) {
      const barangayTrucks = barangayDataRef.current.trucks
      const allowedShiftIds = new Set(barangayTrucks.map(t => t.id))

      activeTrucksRef.current.forEach(truck => {
        if (!allowedShiftIds.has(truck.id)) return

        const truckColor = STATUS_COLORS[truck.status] || '#14b8a6'
        const icon = L.divIcon({
          html: makeTruckIcon(truckColor, truck.truckId, truck.status),
          className: '', iconSize: [44, 60], iconAnchor: [22, 60],
        })
        const m = L.marker([truck.lat, truck.lng], { icon }).addTo(map)

        const statusLabel = truck.status === 'active' ? '🟢 Active'
          : truck.status === 'weak_signal' ? '🟡 Weak Signal' : '⚫ Offline'
        const lastUpdate = truck.last_update
          ? new Date(truck.last_update).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
          : 'N/A'

        m.bindPopup(`<div style="font-family:sans-serif;min-width:200px;">
          <strong style="font-size:14px;">🚛 ${truck.truckId}</strong><br/>
          <span style="color:#64748b;font-size:12px;">${truck.truckModel || '—'}</span><br/>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:6px 0;"/>
          <div style="font-size:12px;margin-bottom:3px;">
            <b>Driver:</b> <span style="color:#374151">${truck.driver}</span>
          </div>
          <div style="font-size:12px;margin-bottom:3px;">
            <b>Plate:</b> <span style="color:#374151">${truck.truckId}</span>
          </div>
          <div style="font-size:12px;margin-bottom:3px;">
            <b>Status:</b> ${statusLabel}
          </div>
          <div style="font-size:11px;color:#94a8b8;margin-top:4px;">
            Last update: ${lastUpdate}
          </div>
        </div>`)

        m.on('click', () => {
          setSelectedRoute({
            id: truck.id,
            truckId: truck.truckId,
            truckModel: truck.truckModel || '—',
            driver: truck.driver,
            plateNumber: truck.truckId,
            opStatus: truck.op_status,
            barangay: 'Live Tracking',
            status: truck.status,
            lastUpdate,
            color: truckColor,
            capacity: 0,
            collectedCount: 0,
            totalPoints: 0,
            eta: 'N/A',
            nextCollection: 'N/A',
          })
          setPanelMode('route')
          setPanelOpen(true)
        })
        layersRef.current[`live-truck-${truck.id}`] = m
      })

      // Draw stop markers scoped to this barangay's active schedules only
      drawGlobalStops(map, allowedShiftIds)
    }

    // ── Dump sites (hidden when barangay focus is active) ──
    if (activeFiltersRef.current.dumpSites && !zoneFocusActive) {
      dumpsites.forEach(site => {
        if (!site.latitude || !site.longitude) return
        const t = dumpsiteTypeMap[site.type] || DUMPSITE_TYPES[1]
        const icon = L.divIcon({ html: dumpSiteIconHtml(site.type), className: "", iconSize: [36, 42], iconAnchor: [18, 42] })
        const m = L.marker([Number(site.latitude), Number(site.longitude)], { icon }).addTo(map)
        const bName = typeof site.barangay === 'object' ? site.barangay?.name : barangaysRef.current.find(b => b.id === site.barangay)?.name || site.barangay_name || 'Unknown'
        m.bindPopup(`<div style="font-family:sans-serif;min-width:160px;">
          <strong style="color:${t.color};display:flex;align-items:center;gap:4px;"><div style="width:16px;height:16px;display:flex;">${ReactDOMServer.renderToString(t.icon)}</div> ${site.name}</strong>
          <div style="margin-top:2px;">
            <span style="color:#64748b;font-size:11px;">${t.label} · ${bName}</span><br/>
            <span style="color:#64748b;font-size:11px;">Capacity: ${site.capacity_used ?? site.capacity ?? 0}% full</span>
          </div>
        </div>`)
        layersRef.current[`dump-${site.id}`] = m
      })
    }

    // ── Garbage reports (hidden when barangay focus is active) ──
    if (activeFiltersRef.current.reports && !zoneFocusActive) {
      if (heatmapModeRef.current && window.L.heatLayer) {
        const heatData = reports
          .filter(r => (r.latitude || r.lat) && (r.longitude || r.lng))
          .map(r => {
            const lat = Number(r.latitude || r.lat)
            const lng = Number(r.longitude || r.lng)
            const intensity = r.severity === 'high' ? 1.0 : r.severity === 'medium' ? 0.6 : 0.3
            return [lat, lng, intensity]
          })

        if (heatData.length > 0) {
          const heatLayer = window.L.heatLayer(heatData, {
            radius: 85,
            blur: 60,
            maxZoom: 15,
            gradient: {
              0.1: 'rgba(59, 130, 246, 0.4)', // Outer blue ring
              0.3: 'rgba(16, 185, 129, 0.6)', // Green
              0.6: 'rgba(234, 179, 8, 0.8)',  // Yellow
              0.8: 'rgba(249, 115, 22, 0.9)', // Orange
              1.0: 'rgba(239, 68, 68, 1)'     // Red core
            }
          }).addTo(map)
          layersRef.current['reports-heatmap'] = heatLayer
        }
      } else {
        reports.forEach(report => {
          const lat = report.latitude || report.lat
          const lng = report.longitude || report.lng
          if (!lat || !lng) return

          const icon = L.divIcon({
            html: garbageReportIconHtml(report.severity),
            className: "", iconSize: [36, 36], iconAnchor: [18, 18]
          })
          const m = L.marker([lat, lng], { icon }).addTo(map)
          m.on("click", () => {
            setSelectedReport(report)
            setPanelMode("report")
            setPanelOpen(true)
          })
          layersRef.current[`report-${report.id}`] = m
        })
      }
    }

    // User location marker is managed by the live GPS effect (not hardcoded).
  }

  function toggleFilter(key) {
    setActiveFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      overflow: "hidden", background: "#0f172a",
      paddingTop: 60  // ← matches Navbar height
    }}>
      <Navbar />
      <div style={{ position: "relative", flex: 1, overflow: "hidden", marginTop: 0 }}>

        <style>{`
          @keyframes pulse     { 0%,100%{box-shadow:0 0 0 4px rgba(59,130,246,0.3)} 50%{box-shadow:0 0 0 8px rgba(59,130,246,0.1)} }
          @keyframes slideUp   { from{transform:translateY(100%)} to{transform:translateY(0)} }
          @keyframes fadeIn    { from{opacity:0} to{opacity:1} }
          @keyframes markerPulse { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.6);opacity:0} }
          .ww-btn:hover { opacity:0.88; transform:scale(1.04); }
          .ww-btn       { transition:all 0.15s; cursor:pointer; }
          .filter-chip  { transition:all 0.15s; cursor:pointer; user-select:none; }
          .filter-chip:hover { opacity:0.85; }
          .leaflet-barangay-tooltip {
            background:rgba(15,23,42,0.9); border:1px solid rgba(20,184,166,0.4);
            color:#e2e8f0; font-size:11px; padding:3px 8px; border-radius:6px;
          }
        `}</style>

        {/* Map canvas */}
        <div ref={mapRef} style={{ position: "absolute", inset: 0, zIndex: 1 }} />

        {/* Loading overlay */}
        {!mapReady && (
          <div style={{ position: "absolute", inset: 0, background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
            <div style={{ color: "#14b8a6", fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>Loading Map…</div>
          </div>
        )}

        {/* ── TOP CONTROLS ── */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          background: "linear-gradient(to bottom, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0) 100%)",
          padding: "16px 20px 40px", zIndex: 400, pointerEvents: "none",
          display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16,
        }}>
          {/* Left section: Info & Search */}
          <div style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start", maxWidth: '100%' }}>
            {selectedZone && (
              <div style={{
                background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.45)",
                color: "#fbbf24", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 8, backdropFilter: "blur(4px)",
              }}>
                <div style={{ width: 16, height: 16, display: 'flex' }}>{ICONS.pin}</div>
                <span>{selectedZone.name}</span>
                <button onClick={clearBarangayFocus} style={{
                  background: "transparent", border: "none", color: "#fde68a", cursor: "pointer", fontSize: 11, fontWeight: 700,
                  display: "flex", alignItems: "center", padding: 0, marginLeft: 4
                }}>✕ Clear</button>
              </div>
            )}
            {!selectedZone && (
              <div style={{
                background: "rgba(15,23,42,0.65)", border: "1px solid rgba(255,255,255,0.15)",
                color: "#cbd5e1", borderRadius: 20, padding: "6px 14px", fontSize: 12,
                backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 6
              }}>
                <div style={{ width: 16, height: 16, display: 'flex', color: "#94a3b8" }}>{ICONS.map}</div>
                Tap a barangay to see its stops & trucks
              </div>
            )}

            {/* ── Search bar + GPS row ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {userLocationError && (
                <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5", borderRadius: 8, padding: "4px 10px", fontSize: 11, backdropFilter: "blur(4px)" }}>
                  {userLocationError}
                </div>
              )}
              {userLocationReady && userAccuracy != null && (
                <div style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", color: "#93c5fd", borderRadius: 8, padding: "4px 10px", fontSize: 11, backdropFilter: "blur(4px)", display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 14, height: 14, display: 'flex' }}>{ICONS.pin}</div> GPS ±{userAccuracy}m
                </div>
              )}

              {/* Search input */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search barangay…"
                  value={searchQuery}
                  onChange={e => {
                    const q = e.target.value
                    setSearchQuery(q)
                    if (!q.trim()) { setSearchResults([]); return }
                    const matches = barangaysRef.current.filter(b =>
                      b.name.toLowerCase().includes(q.toLowerCase())
                    ).slice(0, 6)
                    setSearchResults(matches)
                  }}
                  style={{
                    background: 'rgba(15,23,42,0.65)', border: '1px solid rgba(255,255,255,0.15)',
                    color: '#e2e8f0', borderRadius: 20, padding: '7px 14px 7px 34px',
                    fontSize: 13, width: 200, outline: 'none', backdropFilter: "blur(8px)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.2)", transition: "border-color 0.2s"
                  }}
                  onFocus={e => e.target.style.borderColor = "rgba(20,184,166,0.6)"}
                  onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.15)"}
                />
                <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, display: 'flex', color: "#94a3b8", pointerEvents: 'none' }}>{ICONS.search}</div>
                {searchResults.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '110%', left: 0, width: '100%', zIndex: 600,
                    background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    backdropFilter: "blur(12px)"
                  }}>
                    {searchResults.map(b => (
                      <div key={b.id} onClick={() => {
                        setSearchQuery('')
                        setSearchResults([])
                        if (!mapInstanceRef.current) return
                        const djangoBrgy = barangaysRef.current.find(x => x.id === b.id)
                        const type = getZoneType(b.name)
                        const color = ZONE_META[type]?.color || '#4ade80'
                        const newZone = { id: b.id, name: b.name, type, color, djangoBrgy }
                        clearBarangayMarkers()
                        clearGlobalStopMarkers()
                        selectedZoneRef.current = newZone
                        setSelectedZone(newZone)
                        setPanelMode('zone')
                        setPanelOpen(true)
                      }} style={{
                        padding: '10px 14px', color: '#cbd5e1', fontSize: 13,
                        cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)',
                        transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: 6
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(20,184,166,0.15)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ width: 16, height: 16, display: 'flex', color: "#14b8a6" }}>{ICONS.pin}</div>
                        {b.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right section: Map Toggles */}
          <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="ww-btn" onClick={() => setHeatmapMode(h => !h)}
              style={{
                background: heatmapMode ? "rgba(239,68,68,0.15)" : "rgba(15,23,42,0.65)",
                backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                border: `1px solid ${heatmapMode ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.15)"}`,
                color: heatmapMode ? "#fca5a5" : "#e2e8f0",
                borderRadius: 20, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
              }}>
              <div style={{ width: 18, height: 18, display: 'flex', color: heatmapMode ? "#ef4444" : "#94a3b8" }}>{ICONS.hotspot}</div>
              Heatmap {heatmapMode ? "On" : "Off"}
            </button>
            <button className="ww-btn" onClick={() => { setFilterOpen(o => !o); setLegendOpen(false) }}
              style={{
                background: filterOpen ? "rgba(20,184,166,0.15)" : "rgba(15,23,42,0.65)",
                backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                border: `1px solid ${filterOpen ? "rgba(20,184,166,0.4)" : "rgba(255,255,255,0.15)"}`,
                color: filterOpen ? "#5eead4" : "#e2e8f0",
                borderRadius: 20, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
              }}>
              <div style={{ width: 18, height: 18, display: 'flex', color: filterOpen ? "#14b8a6" : "#94a3b8" }}>{ICONS.analytics}</div>
              Filters
            </button>
            <button className="ww-btn" onClick={() => { setLegendOpen(o => !o); setFilterOpen(false) }}
              style={{
                background: legendOpen ? "rgba(20,184,166,0.15)" : "rgba(15,23,42,0.65)",
                backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                border: `1px solid ${legendOpen ? "rgba(20,184,166,0.4)" : "rgba(255,255,255,0.15)"}`,
                color: legendOpen ? "#5eead4" : "#e2e8f0",
                borderRadius: 20, padding: "8px 16px", fontSize: 13, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
              }}>
              <div style={{ width: 18, height: 18, display: 'flex', color: legendOpen ? "#14b8a6" : "#94a3b8" }}>{ICONS.map}</div>
              Legend
            </button>
          </div>
        </div>

        {/* ── FILTER PANEL ── */}
        {filterOpen && (
          <div style={{
            position: "absolute", top: 64, right: 16,
            background: "rgba(15,23,42,0.98)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "18px 20px", zIndex: 500, minWidth: 240,
            animation: "fadeIn 0.2s ease-out", boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)"
          }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 13, marginBottom: 14, letterSpacing: '0.5px' }}>MAP LAYERS</div>
            {[
              { key: "routes", label: "Truck Routes", icon: ICONS.route },
              { key: "trucks", label: "Truck Markers", icon: ICONS.truck },
              { key: "dumpSites", label: "Dump Sites", icon: ICONS.dumpsite },
              { key: "reports", label: "Garbage Reports", icon: ICONS.warning },
            ].map(f => (
              <div key={f.key} className="filter-chip" onClick={() => toggleFilter(f.key)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, background: activeFilters[f.key] ? "#14b8a6" : "transparent", border: "1.5px solid", borderColor: activeFilters[f.key] ? "#14b8a6" : "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: '#0f172a', fontWeight: 900 }}>
                  {activeFilters[f.key] ? "✓" : ""}
                </div>
                <div style={{ width: 18, height: 18, display: 'flex', color: "#94a3b8" }}>{f.icon}</div>
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{f.label}</span>
              </div>
            ))}
            <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 16, marginBottom: 10, fontWeight: 600, letterSpacing: '0.5px' }}>ZONE TYPES</div>
            {Object.entries(ZONE_META).map(([key, meta]) => (
              <div key={key} className="filter-chip" onClick={() => toggleFilter(key)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, background: activeFilters[key] ? meta.color : "transparent", border: "1.5px solid", borderColor: activeFilters[key] ? meta.color : "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: '#0f172a', fontWeight: 900 }}>
                  {activeFilters[key] ? "✓" : ""}
                </div>
                <div style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{meta.icon}</div>
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{meta.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── LEGEND PANEL ── */}
        {legendOpen && (
          <div style={{
            position: "absolute", top: 64, right: 16,
            background: "rgba(15,23,42,0.98)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "18px 20px", zIndex: 500, minWidth: 240,
            animation: "fadeIn 0.2s ease-out", boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)"
          }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 13, marginBottom: 14, letterSpacing: '0.5px' }}>LEGEND</div>
            {[
              { color: "#14b8a6", label: "Truck 01 route" },
              { color: "#f59e0b", label: "Truck 02 route" },
              { color: "#a78bfa", label: "Truck 03 route" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{ width: 24, height: 3, background: r.color, borderRadius: 2 }} />
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{r.label}</span>
              </div>
            ))}
            <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.06)", margin: "14px 0" }} />
            {[
              { icon: ICONS.truck, label: "Truck (barangay focus only)" },
              { icon: ICONS.dumpsite, label: "Dump site" },
              { icon: ICONS.warning, label: "Reported garbage" },
              { icon: ICONS.pin, label: "Your location" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{ width: 18, height: 18, display: 'flex', color: "#94a3b8" }}>{r.icon}</div>
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{r.label}</span>
              </div>
            ))}
            <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.06)", margin: "14px 0" }} />
            <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 10, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>STOP STATUS</div>
            {[
              { color: '#10b981', label: 'Home Base' },
              { color: 'transparent', border: '1px dashed #64748b', label: STOP_STATUS_LABELS.PENDING_INSPECTION },
              { color: '#f59e0b', label: STOP_STATUS_LABELS.READY_FOR_COLLECTION },
              { color: '#94a3b8', label: STOP_STATUS_LABELS.EMPTY_STOP },
              { color: '#eab308', label: STOP_STATUS_LABELS.COLLECTION_REPORTED },
              { color: '#10b981', label: STOP_STATUS_LABELS.VERIFIED_COLLECTED },
              { color: '#ef4444', label: STOP_STATUS_LABELS.COLLECTION_DISPUTED },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 9 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                  background: r.color,
                  border: r.border || `1px solid ${r.color}`,
                }} />
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{r.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── FAB ── */}
        <div style={{ position: "absolute", right: 16, bottom: 24, zIndex: 400, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            transform: fabOpen ? "translateY(0)" : "translateY(40px)",
            opacity: fabOpen ? 1 : 0, pointerEvents: fabOpen ? "auto" : "none",
            transition: "all 0.25s ease",
          }}>
            <button className="ww-btn" onClick={() => navigate("/report/submit")} title="Report Issue"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 50, height: 50, borderRadius: "50%", background: "#ef4444", border: "none", color: "white", boxShadow: "0 4px 16px rgba(239,68,68,0.4)", cursor: "pointer" }}><div style={{ width: 22, height: 22 }}>{ICONS.warning}</div></button>
            <button className="ww-btn" onClick={() => navigate("/collection/confirm")} title="Confirm Collection"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 50, height: 50, borderRadius: "50%", background: "#22c55e", border: "none", color: "white", boxShadow: "0 4px 16px rgba(34,197,94,0.4)", cursor: "pointer" }}><div style={{ width: 22, height: 22 }}>{ICONS.check}</div></button>
          </div>
          <button className="ww-btn" onClick={() => setFabOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 50, height: 50, borderRadius: "50%", background: "rgba(20,184,166,0.9)",
              border: "none", fontSize: 22, fontWeight: 700, color: "white", cursor: "pointer",
              boxShadow: "0 4px 16px rgba(20,184,166,0.4)",
              transform: fabOpen ? "rotate(45deg)" : "rotate(0deg)", transition: "transform 0.2s",
            }}>+</button>
        </div>

        {/* ── BOTTOM PANEL ── */}
        {panelOpen && (
          <>
            <div onClick={() => setPanelOpen(false)}
              style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 450 }} />
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "#0f172a", borderRadius: "20px 20px 0 0",
              zIndex: 500, maxHeight: "60vh", overflowY: "auto",
              animation: "slideUp 0.3s cubic-bezier(.4,0,.2,1)",
              boxShadow: "0 -4px 32px rgba(0,0,0,0.5)",
            }}>
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
                <div style={{ width: 40, height: 4, background: "#334155", borderRadius: 2 }} />
              </div>
              <button onClick={() => setPanelOpen(false)}
                style={{ position: "absolute", top: 12, right: 16, background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>
              <div style={{ padding: "0 20px 24px" }}>
                {panelMode === "route" && selectedRoute && <RoutePanel route={selectedRoute} />}
                {panelMode === "zone" && selectedZone && (
                  <ZonePanel zone={selectedZone} barangayData={barangayData} schedules={schedules} onClearFocus={clearBarangayFocus} />
                )}
                {panelMode === "report" && selectedReport && <ReportPanel report={selectedReport} onStatusChange={() => {
                  fetchReports()
                  setPanelOpen(false)
                }} />}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// ─── PANEL COMPONENTS ─────────────────────────────────────────────────────────

// Connection-status → colour and label for the bottom panel badge
const CONN_STATUS_META = {
  active: { color: '#22c55e', label: 'LIVE' },
  weak_signal: { color: '#f59e0b', label: 'WEAK SIGNAL' },
  offline: { color: '#64748b', label: 'OFFLINE' },
}

// Operational status (op_status from shift) → human label
const OP_STATUS_LABELS = {
  on_duty: 'On Duty',
  on_route: 'On Route',
  delayed: 'Delayed',
  off_duty: 'Off Duty',
}

function RoutePanel({ route }) {
  // If this is a live-truck card (opened by clicking a truck marker), show
  // the focused truck info layout. Detected by presence of route.plateNumber.
  const isLiveTruck = Boolean(route.plateNumber)

  if (isLiveTruck) {
    const conn = CONN_STATUS_META[route.status] || CONN_STATUS_META.offline
    const opLabel = OP_STATUS_LABELS[route.opStatus] || route.opStatus || '—'

    return (
      <>
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: `${route.color}22`,
            border: `2px solid ${route.color}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, color: route.color
          }}><div style={{ width: 24, height: 24 }}>{ICONS.truck}</div></div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'white', fontWeight: 800, fontSize: 18, lineHeight: 1.1 }}>
              {route.truckId}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
              {route.truckModel}
            </div>
          </div>

          {/* Connection status badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: `${conn.color}18`,
            border: `1px solid ${conn.color}55`,
            borderRadius: 20, padding: '4px 11px', flexShrink: 0,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: conn.color,
              boxShadow: route.status === 'active' ? `0 0 6px ${conn.color}` : 'none',
            }} />
            <span style={{ color: conn.color, fontSize: 11, fontWeight: 700, letterSpacing: '.04em' }}>
              {conn.label}
            </span>
          </div>
        </div>

        {/* ── Detail rows ── */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12, overflow: 'hidden', marginBottom: 14,
        }}>
          <DetailRow icon={<div style={{ width: 14, height: 14 }}>{ICONS.users}</div>} label="Driver" value={route.driver} />
          <DetailRow icon={<div style={{ width: 14, height: 14 }}>{ICONS.dashboard}</div>} label="Truck No." value={route.truckId} />
          <DetailRow icon={<div style={{ width: 14, height: 14 }}>{ICONS.waste}</div>} label="Plate" value={route.plateNumber} accent />
          <DetailRow icon={<div style={{ width: 14, height: 14 }}>{ICONS.pin}</div>} label="Op. Status" value={opLabel} />
          <DetailRow icon={<div style={{ width: 14, height: 14 }}>{ICONS.clock}</div>} label="Last Update" value={route.lastUpdate || 'N/A'} last />
        </div>

        <p style={{
          color: '#475569', fontSize: 11, lineHeight: 1.5,
          margin: 0, textAlign: 'center',
        }}>
          Stop progress and route details are only visible to the assigned driver.
        </p>
      </>
    )
  }

  // ── Non-live-truck route panel (original layout, kept intact) ─────────────
  const pct = route.totalPoints > 0
    ? Math.round((route.collectedCount / route.totalPoints) * 100)
    : 0
  const statusColor = { collecting: '#22c55e', en_route: '#f59e0b', idle: '#64748b', done: '#3b82f6' }[route.status] || '#64748b'
  const statusLabel = { collecting: 'Collecting', en_route: 'En Route', idle: 'Idle', done: 'Done' }[route.status] || route.status

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 28, height: 28, color: '#14b8a6' }}>{ICONS.truck}</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'white', fontWeight: 800, fontSize: 17 }}>{route.truckId}</div>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>{route.driver}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: `${statusColor}22`, border: `1px solid ${statusColor}`, borderRadius: 20, padding: '4px 12px' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
          <span style={{ color: statusColor, fontSize: 12, fontWeight: 600 }}>{statusLabel}</span>
        </div>
      </div>
      <Row label="BARANGAY" value={route.barangay} />
      <Row label="ETA TODAY" value={route.eta} accent />
      <Row label="NEXT COLLECTION" value={route.nextCollection} />
      <Row label="LAST UPDATE" value={route.lastUpdate} />
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>COLLECTION PROGRESS</span>
          <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>{route.collectedCount} / {route.totalPoints} stops</span>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 8, height: 10, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#14b8a6,#22c55e)', borderRadius: 8, transition: 'width 0.4s' }} />
        </div>
        <div style={{ color: '#14b8a6', fontSize: 11, marginTop: 4, fontWeight: 600 }}>{pct}% complete</div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 8 }}>TRUCK CAPACITY</div>
        <div style={{ background: '#1e293b', borderRadius: 8, height: 10, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${route.capacity}%`, background: route.capacity > 80 ? '#ef4444' : route.capacity > 60 ? '#f59e0b' : '#22c55e', borderRadius: 8 }} />
        </div>
        <div style={{ color: route.capacity > 80 ? '#ef4444' : '#94a3b8', fontSize: 11, marginTop: 4 }}>{route.capacity}% full</div>
      </div>
    </>
  )
}

// ── Sub-component used only by the live-truck panel ──────────────────────────
function DetailRow({ icon, label, value, accent, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px',
      borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, flexShrink: 0, color: '#94a3b8' }}>{icon}</span>
      <span style={{ color: '#64748b', fontSize: 11, fontWeight: 600, width: 80, flexShrink: 0, letterSpacing: '.03em' }}>
        {label}
      </span>
      <span style={{
        color: accent ? '#14b8a6' : '#e2e8f0',
        fontSize: 13,
        fontWeight: accent ? 700 : 400,
        flex: 1,
        textAlign: 'right',
      }}>
        {value}
      </span>
    </div>
  )
}


function ReportPanel({ report, onStatusChange }) {
  const { user } = useAuth()
  const { notify } = useNotification()
  const canModerate = REPORT_MODERATOR_ROLES.includes(user?.role)
  const severityColors = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" }
  const typeLabels = { overflow: "Overflow", illegal_dumping: "Illegal Dumping", missed: "Missed Pickup" }

  const reportedStr = report.created_at || report.reported
    ? new Date(report.created_at || report.reported).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown'

  const statusLabel = {
    pending: 'Pending Review',
    approved: 'Approved (Visible)',
    resolved: 'Resolved (Collected)',
    rejected: 'Rejected (Hidden)'
  }[report.status] ?? report.status?.toUpperCase()

  function handleApprove() {
    const id = report.report_id || report.id
    api.post(`/api/watcher/reports/${id}/approve/`)
      .then(() => onStatusChange?.())
      .catch(err => {
        console.error(err)
        notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed to approve report') })
      })
  }

  function handleReject() {
    const id = report.report_id || report.id
    const reason = prompt('Please enter a reason for rejection:')
    if (reason === null) return
    if (!reason.trim()) return notify({ variant: 'error-solid', message: 'Reason is required for rejection.' })
    api.post(`/api/watcher/reports/${id}/reject/`, { rejection_reason: reason })
      .then(() => onStatusChange?.())
      .catch(err => {
        console.error(err)
        notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed to reject report') })
      })
  }

  function handleResolve() {
    const id = report.report_id || report.id
    api.post('/api/watcher/confirmations/', { report: id })
      .then(() => onStatusChange?.())
      .catch(err => {
        console.error(err)
        notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed to resolve report') })
      })
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 30 }}>⚠️</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "white", fontWeight: 800, fontSize: 17 }}>{typeLabels[report.issue_type || report.type] ?? (report.issue_type || report.type)}</div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>{report.barangay_name || report.address}</div>
        </div>
        <div style={{ background: `${severityColors[report.severity]}22`, border: `1px solid ${severityColors[report.severity]}`, borderRadius: 20, padding: "4px 12px" }}>
          <span style={{ color: severityColors[report.severity], fontSize: 12, fontWeight: 700 }}>{report.severity?.toUpperCase()}</span>
        </div>
      </div>
      <Row label="REPORT TYPE" value={typeLabels[report.issue_type || report.type] ?? (report.issue_type || report.type)} />
      <Row label="REPORTED" value={reportedStr} />
      <Row label="STATUS" value={statusLabel} accent />

      {report.rejection_reason && (
        <Row label="REASON" value={report.rejection_reason} />
      )}

      {report.description || report.notes ? (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 10, color: "#cbd5e1", fontSize: 12, lineHeight: 1.5 }}>
          {report.description || report.notes}
        </div>
      ) : null}

      {report.image && (
        <div style={{ marginTop: 12, borderRadius: 10, overflow: 'hidden' }}>
          <img src={report.image} alt="Evidence" style={{ width: '100%', height: 'auto' }} />
        </div>
      )}

      {canModerate && (
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          {report.status === 'pending' && (
            <>
              <button onClick={handleApprove} style={{ flex: 1, background: "rgba(34,197,94,0.1)", border: "1px solid #22c55e", color: "#22c55e", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✅ Approve</button>
              <button onClick={handleReject} style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid #ef4444", color: "#ef4444", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✕ Reject</button>
            </>
          )}
          {report.status === 'approved' && (
            <button onClick={handleResolve} style={{ flex: 1, background: "rgba(34,197,94,0.1)", border: "1px solid #22c55e", color: "#22c55e", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>🏁 Mark Resolved</button>
          )}
        </div>
      )}

      {!canModerate && (
        <div style={{ marginTop: 18, padding: "10px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#64748b", fontSize: 12 }}>
          ℹ️ Barangay Officials, and Admins can moderate reports.
        </div>
      )}
    </>
  )
}

function Row({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>{label}</span>
      <span style={{ color: accent ? "#14b8a6" : "#e2e8f0", fontSize: 13, fontWeight: accent ? 700 : 400 }}>{value}</span>
    </div>
  )
}
