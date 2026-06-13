// MapView.jsx — WasteWatch Admin/Watcher/Barangay Official Map

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'
import { ICONS } from '../api/navConfig'
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
export const DUMP_SITES = [
  { id: "D1", name: "Main Landfill — Gulang-Gulang", lat: 13.9295, lng: 121.6230, capacity: 82 },
  { id: "D2", name: "Transfer Station — Cotta", lat: 13.9345, lng: 121.6085, capacity: 55 },
];
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

const makeTruckIcon = (color, label, status) => `
  <div style="position:relative;width:44px;height:60px;">
    <div style="background:${color};border:2.5px solid white;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);width:40px;height:40px;
      box-shadow:0 4px 14px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;">
      <div style="transform:rotate(45deg);display:flex;align-items:center;justify-content:center;">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-truck"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
      </div>
    </div>
    <div style="position:absolute;bottom:14px;left:50%;transform:translateX(-50%);
      background:${color};color:white;font-size:9px;font-weight:700;
      padding:1px 5px;border-radius:8px;border:1.5px solid white;
      white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${label}</div>
    <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);
      width:10px;height:10px;border-radius:50%;
      background:${STATUS_COLORS[status] || '#64748b'};
      border:2px solid white;box-shadow:0 0 6px ${STATUS_COLORS[status] || '#64748b'};"></div>
  </div>`;

const dumpSiteIconHtml = `
  <div style="background:#ef4444;border:2.5px solid white;border-radius:50%;
    width:36px;height:36px;display:flex;align-items:center;justify-content:center;
    color:white;box-shadow:0 4px 14px rgba(0,0,0,0.35);">${ReactDOMServer.renderToString(ICONS.dumpsite)}</div>`;

const garbageReportIconHtml = (severity) => {
  const colors = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
  return `<div style="background:${colors[severity] || "#f59e0b"};border:2px solid white;
    border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:30px;height:30px;
    display:flex;align-items:center;justify-content:center;color:white;
    box-shadow:0 3px 10px rgba(0,0,0,0.35);">
    <div style="transform:rotate(45deg);width:16px;height:16px;display:flex;align-items:center;justify-content:center;">${ReactDOMServer.renderToString(ICONS.warning)}</div></div>`;
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
  const mapRef = useRef(null)
  const [mapInstance, setMapInstance] = useState(null)
  const layersRef = useRef({})

  // ── Barangay stop markers (drawn separately from main layers) ─────────────
  // Keyed separately so drawAll() doesn't wipe them, and clearBarangayMarkers()
  // removes them without touching the main layer set.
  const barangayMarkersRef = useRef(new Map())
  const globalStopMarkersRef = useRef(new Map())  // Map<statusKey, {marker, status}>  // ← NEW: stop markers for all active trucks, no-zone mode
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
  const [activeFilters, setActiveFilters] = useState({
    residential: true, commercial: true, industrial: true, agricultural: true,
    routes: true, trucks: true, dumpSites: true, reports: true,
  })
  const [barangayGeo, setBarangayGeo] = useState(null)
  const [barangays, setBarangays] = useState([])  // Django Barangay list (for pk lookups)
  const barangaysRef = useRef([])
  useEffect(() => { barangaysRef.current = barangays }, [barangays])
  const [reports, setReports] = useState([])
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
    if (window.L) { setMapReady(true); return }
    const script = document.createElement("script")
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)
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
  useEffect(() => {
    if (!mapInstanceRef.current) return
    console.log('[MapView] redraw layers', {
      mapReady, barangayGeo: !!barangayGeo,
      activeFilters: Object.keys(activeFilters).filter(k => activeFilters[k]),
      activeTrucks: activeTrucks.length,
      reports: reports.length,
      barangayData: barangayData.trucks.length + barangayData.stops.length,
      schedules: schedules.length,
      stopStatusMap: stopStatusMap.size,
    })
    drawAll(mapInstanceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, barangayGeo, activeFilters, activeTrucks, reports, barangayData, schedules, stopStatusMap, selectedZone])

  // ── Fetch barangay stops when a zone is selected ──────────────────────────
  // Draws stop markers (colour-coded like ShiftRouteModule) WITHOUT the route.
  // ── Fetch barangay stops when a zone is first selected ────────────────────
  // Subsequent re-fetches happen inside fetchAll() on the 10s heartbeat.
  useEffect(() => {
    if (!selectedZone || !mapReady) {
      clearBarangayMarkers()
      // When zone is cleared, also wipe global stop markers so stale pins don't linger
      clearGlobalStopMarkers()
      return
    }
    clearBarangayMarkers()
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
    clearBarangayMarkers()
    clearGlobalStopMarkers()
    setBarangayData({ trucks: [], stops: [], loading: false })
    setSelectedZone(null)
    setPanelOpen(false)
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

      // Build details for barangay stop if available
      const bCollectedRaw = stop.collected_at || stop.collectedAt || stop.collectedAtRaw
      let bCollected = ''
      try { if (bCollectedRaw) { const d = new Date(bCollectedRaw); if (!isNaN(d)) bCollected = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } } catch (e) { bCollected = '' }
      const bDetails = {
        collectedAt: bCollected,
        truck: stop.truck_plate || stop.driver_name || '',
        scheduleId: stop.schedule_id || stop.schedule || ''
      }
      const popupHtml = `<div style="font-family:sans-serif;min-width:180px;">
          <b style="font-size:13px;">${stop.label}</b><br/>
          <span style="font-size:11px;color:${displayColor};font-weight:700;text-transform:uppercase">${STOP_STATUS_LABELS[stopStatus] || stopStatus}</span><br/>
          <span style="font-size:11px;color:#64748b">Driver: ${stop.driver_name || ''}</span><br/>
          ${bDetails.collectedAt ? `<div style="margin-top:6px;font-size:11px;color:#10b981">Collected: ${bDetails.collectedAt}</div>` : ''}
          ${bDetails.truck ? `<div style="font-size:11px;color:#64748b">Truck: ${bDetails.truck}</div>` : ''}
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
        if (currentZone && wp.barangay_id !== currentZone.id) return

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

  function drawAll(map) {
    const L = window.L
    if (!L) return
    clearLayers(map)

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
            // Look up the Django Barangay integer PK by name so that
            // selectedZone.id matches the barangay_id stored in waypoints.
            const djangoBrgy = barangaysRef.current.find(b => b.name === feature.properties.brgy_name)
            setSelectedZone({
              id: djangoBrgy ? djangoBrgy.id : null,  // integer PK — matches wp.barangay_id
              brgy_code: feature.properties.brgy_code, // GeoJSON code kept for reference
              name: feature.properties.brgy_name,
              type,
              color,
            })
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

    const zoneFocusActive = Boolean(selectedZoneRef.current)

    // ── Truck routes (hidden when barangay focus is active) ──
    if (activeFilters.routes && !zoneFocusActive) {
      TRUCK_ROUTES.forEach(route => {
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
    } else if (!zoneFocusActive) {
      // No zone selected — ensure no stale stop markers remain from a previous focus
      clearGlobalStopMarkers()
    }

    // ── Dump sites (hidden when barangay focus is active) ──
    if (activeFilters.dumpSites && !zoneFocusActive) {
      DUMP_SITES.forEach(site => {
        const icon = L.divIcon({ html: dumpSiteIconHtml, className: "", iconSize: [36, 36], iconAnchor: [18, 18] })
        const m = L.marker([site.lat, site.lng], { icon }).addTo(map)
        m.bindPopup(`<div style="font-family:sans-serif;min-width:160px;">
          <strong style="color:#ef4444">🏭 ${site.name}</strong><br/>
          <span style="color:#64748b;font-size:12px;">Capacity: ${site.capacity}% full</span>
        </div>`)
        layersRef.current[`dump-${site.id}`] = m
      })
    }

    // ── Garbage reports (hidden when barangay focus is active) ──
    if (activeFilters.reports && !zoneFocusActive) {
      reports.forEach(report => {
        const lat = report.latitude || report.lat
        const lng = report.longitude || report.lng
        if (!lat || !lng) return

        const icon = L.divIcon({
          html: garbageReportIconHtml(report.severity),
          className: "", iconSize: [30, 36], iconAnchor: [8, 36]
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
          background: "linear-gradient(to bottom,rgba(15,23,42,0.85),transparent)",
          padding: "12px 16px 32px", zIndex: 400, pointerEvents: "none",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1, pointerEvents: "auto", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
            {selectedZone && (
              <div style={{
                background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.45)",
                color: "#fbbf24", borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>Focused: {selectedZone.name}</span>
                <button onClick={clearBarangayFocus} style={{
                  background: "transparent", border: "none", color: "#fde68a", cursor: "pointer", fontSize: 11, fontWeight: 700,
                }}>✕ Clear</button>
              </div>
            )}
            {!selectedZone && (
              <div style={{
                background: "rgba(15,23,42,0.75)", border: "1px solid rgba(20,184,166,0.25)",
                color: "#64748b", borderRadius: 20, padding: "5px 12px", fontSize: 11,
              }}>
                Tap a barangay to see its routes &amp; drivers
              </div>
            )}
            {userLocationError && (
              <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5", borderRadius: 8, padding: "4px 10px", fontSize: 11 }}>
                {userLocationError}
              </div>
            )}
            {userLocationReady && userAccuracy != null && (
              <div style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.35)", color: "#93c5fd", borderRadius: 8, padding: "4px 10px", fontSize: 11 }}>
                Your GPS ±{userAccuracy}m
              </div>
            )}
          </div>
          <button className="ww-btn" onClick={() => { setFilterOpen(o => !o); setLegendOpen(false) }}
            style={{ pointerEvents: "auto", background: "rgba(10,16,30,0.92)", border: "1px solid rgba(20,184,166,0.4)", color: "#14b8a6", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600 }}>
            ⚙️ Filters
          </button>
          <button className="ww-btn" onClick={() => { setLegendOpen(o => !o); setFilterOpen(false) }}
            style={{ pointerEvents: "auto", background: "rgba(10,16,30,0.92)", border: "1px solid rgba(20,184,166,0.4)", color: "#14b8a6", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600 }}>
            <div style={{ width: 16, height: 16, color: '#14b8a6' }}>{ICONS.map}</div> Legend
          </button>
        </div>

        {/* ── FILTER PANEL ── */}
        {filterOpen && (
          <div style={{
            position: "absolute", top: 52, right: 16,
            background: "rgba(15,23,42,0.97)", border: "1px solid rgba(20,184,166,0.3)",
            borderRadius: 14, padding: 16, zIndex: 500, minWidth: 220,
            animation: "fadeIn 0.2s", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 13, marginBottom: 12 }}>MAP LAYERS</div>
            {[
              { key: "routes", label: "Truck Routes", icon: <div style={{ width: 14, height: 14 }}>{ICONS.dashboard}</div> },
              { key: "trucks", label: "Truck Markers", icon: <div style={{ width: 14, height: 14 }}>{ICONS.truck}</div> },
              { key: "dumpSites", label: "Dump Sites", icon: <div style={{ width: 14, height: 14 }}>{ICONS.dumpsite}</div> },
              { key: "reports", label: "Garbage Reports", icon: <div style={{ width: 14, height: 14 }}>{ICONS.warning}</div> },
            ].map(f => (
              <div key={f.key} className="filter-chip" onClick={() => toggleFilter(f.key)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ width: 20, height: 20, borderRadius: 5, background: activeFilters[f.key] ? "#14b8a6" : "#1e293b", border: "1.5px solid", borderColor: activeFilters[f.key] ? "#14b8a6" : "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                  {activeFilters[f.key] ? "✓" : ""}
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>{f.icon}</span>
                <span style={{ color: "#cbd5e1", fontSize: 13 }}>{f.label}</span>
              </div>
            ))}
            <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 10, marginBottom: 6, fontWeight: 600 }}>ZONE TYPES</div>
            {Object.entries(ZONE_META).map(([key, meta]) => (
              <div key={key} className="filter-chip" onClick={() => toggleFilter(key)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                <div style={{ width: 20, height: 20, borderRadius: 5, background: activeFilters[key] ? meta.color : "#1e293b", border: "1.5px solid", borderColor: activeFilters[key] ? meta.color : "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                  {activeFilters[key] ? "✓" : ""}
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', width: 14, height: 14 }}>{meta.icon}</span>
                <span style={{ color: "#cbd5e1", fontSize: 13 }}>{meta.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── LEGEND PANEL ── */}
        {legendOpen && (
          <div style={{
            position: "absolute", top: 52, right: 16,
            background: "rgba(15,23,42,0.97)", border: "1px solid rgba(20,184,166,0.3)",
            borderRadius: 14, padding: 16, zIndex: 500, minWidth: 200,
            animation: "fadeIn 0.2s", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 13, marginBottom: 12 }}>LEGEND</div>
            {[
              { color: "#14b8a6", label: "Truck 01 route" },
              { color: "#f59e0b", label: "Truck 02 route" },
              { color: "#a78bfa", label: "Truck 03 route" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <div style={{ width: 28, height: 4, background: r.color, borderRadius: 2 }} />
                <span style={{ color: "#cbd5e1", fontSize: 12 }}>{r.label}</span>
              </div>
            ))}
            <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.07)", margin: "10px 0" }} />
            {[
              { icon: <div style={{ width: 14, height: 14 }}>{ICONS.truck}</div>, label: "Truck (barangay focus only)" },
              { icon: <div style={{ width: 14, height: 14 }}>{ICONS.dumpsite}</div>, label: "Dump site" },
              { icon: <div style={{ width: 14, height: 14 }}>{ICONS.warning}</div>, label: "Reported garbage" },
              { icon: <div style={{ width: 14, height: 14 }}>{ICONS.pin}</div>, label: "Your location" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>{r.icon}</span>
                <span style={{ color: "#cbd5e1", fontSize: 12 }}>{r.label}</span>
              </div>
            ))}
            <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.07)", margin: "10px 0" }} />
            <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>STOP STATUS</div>
            {[
              { color: '#16a34a', label: 'Home Base' },
              { color: 'transparent', border: '1px dashed rgba(148,163,184,0.95)', label: STOP_STATUS_LABELS.PENDING_INSPECTION },
              { color: '#f59e0b', label: STOP_STATUS_LABELS.READY_FOR_COLLECTION },
              { color: '#94a3b8', label: STOP_STATUS_LABELS.EMPTY_STOP },
              { color: '#eab308', label: STOP_STATUS_LABELS.COLLECTION_REPORTED },
              { color: '#16a34a', label: STOP_STATUS_LABELS.VERIFIED_COLLECTED },
              { color: '#ef4444', label: STOP_STATUS_LABELS.COLLECTION_DISPUTED },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: r.color,
                  border: r.border || (r.color === 'transparent' ? '1px dashed rgba(148,163,184,0.95)' : '1px solid rgba(255,255,255,0.14)'),
                  boxShadow: r.color === 'transparent' ? 'none' : `0 0 0 1px ${r.color}55`,
                }} />
                <span style={{ color: "#cbd5e1", fontSize: 12 }}>{r.label}</span>
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
                  <ZonePanel zone={selectedZone} barangayData={barangayData} onClearFocus={clearBarangayFocus} />
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

// ─── ZONE PANEL — shows active trucks + stop status for the selected barangay ─
// Stop route is NOT shown here (driver-only). Only the coloured stop markers
// already drawn on the map by drawBarangayStops() are visible.
function ZonePanel({ zone, barangayData, onClearFocus }) {
  const meta = {
    residential: { label: "Residential", icon: <div style={{ width: 24, height: 24 }}>{ICONS.barangay}</div> },
    commercial: { label: "Commercial", icon: <div style={{ width: 24, height: 24 }}>{ICONS.dashboard}</div> },
    industrial: { label: "Industrial", icon: <div style={{ width: 24, height: 24 }}>{ICONS.waste}</div> },
    agricultural: { label: "Agricultural", icon: <div style={{ width: 24, height: 24 }}>{ICONS.hotspot}</div> },
  }
  const m = meta[zone.type] || {}
  const { trucks = [], stops = [], loading = false } = barangayData || {}

  const currentStops = stops.filter(s => s.is_current)
  const collectingCount = stops.filter(s => normalizeStopStatus(s.current_status || s.status) === 'COLLECTION_REPORTED').length
  const readyCount = stops.filter(s => normalizeStopStatus(s.current_status || s.status) === 'READY_FOR_COLLECTION').length

  return (
    <>
      {/* Zone header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ color: zone.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{m.icon}</div>
        <div>
          <div style={{ color: "white", fontWeight: 800, fontSize: 17 }}>{zone.name}</div>
          <div style={{ color: zone.color, fontSize: 12, fontWeight: 600 }}>{m.label} Zone</div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b', fontSize: 13 }}>
          <div style={{ fontSize: 20, marginBottom: 8 }}>🔄</div>
          Loading trucks &amp; stops…
        </div>
      ) : trucks.length === 0 ? (
        <div style={{
          padding: '14px 16px', background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, color: '#64748b', fontSize: 13, marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 20, height: 20 }}>{ICONS.truck}</div>
          No active trucks assigned to this barangay right now.
        </div>
      ) : (
        <>
          {/* Active trucks list */}
          <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, marginBottom: 8, letterSpacing: '.04em' }}>
            ACTIVE TRUCKS ({trucks.length})
          </div>
          {trucks.map(truck => {
            const tColor = STATUS_COLORS[truck.status] || '#64748b'
            const tLabel = truck.status === 'active' ? 'LIVE'
              : truck.status === 'weak_signal' ? 'WEAK' : 'OFFLINE'
            return (
              <div key={truck.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: tColor, boxShadow: `0 0 6px ${tColor}`, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{truck.truckId}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{truck.driver}</div>
                </div>
                <div style={{ fontSize: 9, fontWeight: 800, color: tColor, background: `${tColor}18`, border: `1px solid ${tColor}44`, borderRadius: 20, padding: '2px 8px', letterSpacing: '.05em' }}>
                  {tLabel}
                </div>
              </div>
            )
          })}

          {currentStops.length > 0 && (
            <>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, margin: '16px 0 8px', letterSpacing: '.04em' }}>
                CURRENT STOP IN THIS BARANGAY
              </div>
              {currentStops.map(stop => (
                <div key={`${stop.schedule_id}-${stop.stop_order}`} style={{
                  padding: '10px 12px', marginBottom: 8, borderRadius: 10,
                  background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
                }}>
                  <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>{stop.label}</div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                    {STOP_STATUS_LABELS[normalizeStopStatus(stop.current_status || stop.status)] || 'Active stop'}
                    {stop.driver_name ? ` · ${stop.driver_name}` : ''}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, textAlign: 'center', padding: 8, borderRadius: 8, background: 'rgba(245,158,11,0.12)' }}>
                  <div style={{ color: '#f59e0b', fontWeight: 800 }}>{readyCount}</div>
                  <div style={{ color: '#94a3b8', fontSize: 10 }}>Ready</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', padding: 8, borderRadius: 8, background: 'rgba(234,179,8,0.12)' }}>
                  <div style={{ color: '#eab308', fontWeight: 800 }}>{collectingCount}</div>
                  <div style={{ color: '#94a3b8', fontSize: 10 }}>Collecting</div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          onClick={onClearFocus}
          style={{ flex: 1, background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.35)", color: "#cbd5e1", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          Show All Barangays
        </button>
      </div>
    </>
  )
}

function ReportPanel({ report, onStatusChange }) {
  const { user } = useAuth()
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
        alert(err.response?.data?.error || 'Failed to approve report')
      })
  }

  function handleReject() {
    const id = report.report_id || report.id
    const reason = prompt('Please enter a reason for rejection:')
    if (reason === null) return
    if (!reason.trim()) return alert('Reason is required for rejection.')
    api.post(`/api/watcher/reports/${id}/reject/`, { rejection_reason: reason })
      .then(() => onStatusChange?.())
      .catch(err => {
        console.error(err)
        alert(err.response?.data?.error || 'Failed to reject report')
      })
  }

  function handleResolve() {
    const id = report.report_id || report.id
    api.post('/api/watcher/confirmations/', { report: id })
      .then(() => onStatusChange?.())
      .catch(err => {
        console.error(err)
        alert('Failed to resolve report')
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
