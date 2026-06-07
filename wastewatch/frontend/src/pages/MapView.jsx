// MapView.jsx — WasteWatch Admin/Watcher/Barangay Official Map
import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

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

const REPORT_MODERATOR_ROLES = ["watcher", "brgy_official", "admin"]

export const TRUCK_ROUTES = [];
export const DUMP_SITES = [
  { id: "D1", name: "Main Landfill — Gulang-Gulang", lat: 13.9295, lng: 121.6230, capacity: 82 },
  { id: "D2", name: "Transfer Station — Cotta", lat: 13.9345, lng: 121.6085, capacity: 55 },
];
export const GARBAGE_REPORTS = [];

const TYPE_LABELS = { overflow: "Overflow", illegal_dumping: "Illegal Dumping", missed: "Missed Pickup" };

export const ZONE_META = {
  residential: { label: "Residential", icon: "🏠", color: "#4ade80" },
  commercial: { label: "Commercial", icon: "🏪", color: "#fb923c" },
  industrial: { label: "Industrial", icon: "🏭", color: "#94a3b8" },
  agricultural: { label: "Agricultural", icon: "🌾", color: "#a3e635" },
};

const STATUS_COLORS = {
  active: '#22c55e',
  weak_signal: '#f59e0b',
  offline: '#64748b',
}

// ─── STOP COLOURS (mirrors ShiftRouteModule — no route, just markers) ─────────
const STOP_COLORS_MAP = {
  collected: '#16a34a',
  current: '#2563eb',
  upcoming: '#f59e0b',
  missed: '#ef4444',
}

const makeTruckIcon = (color, label, status) => `
  <div style="position:relative;width:44px;height:60px;">
    <div style="background:${color};border:2.5px solid white;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);width:40px;height:40px;
      box-shadow:0 4px 14px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;">
      <div style="transform:rotate(45deg);font-size:17px;">🚛</div>
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
    font-size:18px;box-shadow:0 4px 14px rgba(0,0,0,0.35);">🏭</div>`;

const garbageReportIconHtml = (severity) => {
  const colors = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
  return `<div style="background:${colors[severity] || "#f59e0b"};border:2px solid white;
    border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:30px;height:30px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 3px 10px rgba(0,0,0,0.35);">
    <div style="transform:rotate(45deg);font-size:14px;">⚠️</div></div>`;
};

const youIconHtml = `
  <div style="background:#3b82f6;border:3px solid white;border-radius:50%;
    width:38px;height:38px;display:flex;align-items:center;justify-content:center;
    font-size:18px;box-shadow:0 0 0 4px rgba(59,130,246,0.3),0 4px 14px rgba(0,0,0,0.3);">📍</div>`;

// ─── STOP MARKER HTML (mirrors ShiftRouteModule colour system) ────────────────
function makeStopMarkerHtml(stopOrder, status) {
  const color = STOP_COLORS_MAP[status] || STOP_COLORS_MAP.upcoming
  const size = status === 'current' ? 28 : 24
  const pulse = status === 'current'
    ? `<span style="position:absolute;inset:-5px;border-radius:50%;border:2px solid ${color};opacity:0.5;animation:markerPulse 1.8s ease infinite;"></span>`
    : ''
  const icon = status === 'collected' ? '✓' : status === 'missed' ? '✕' : stopOrder
  return `<div style="position:relative;width:${size}px;height:${size}px;">
    ${pulse}
    <div style="position:absolute;inset:0;background:${color};border:2.5px solid #fff;
      border-radius:50%;display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:${status === 'current' ? 12 : 10}px;font-weight:900;
      font-family:monospace;box-shadow:0 2px 10px rgba(0,0,0,0.3);">${icon}</div>
  </div>`
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
  const barangayMarkersRef = useRef([])
  const [barangayData, setBarangayData] = useState({ trucks: [], stops: [], loading: false })

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
  const [reports, setReports] = useState([])
  const [activeTrucks, setActiveTrucks] = useState([])
  const [liveReports, setLiveReports] = useState([])

  const activeFiltersRef = useRef(activeFilters)
  const activeTrucksRef = useRef(activeTrucks)
  const liveReportsRef = useRef(liveReports)
  const mapInstanceRef = useRef(null) // Added for stability with drawAll

  useEffect(() => { activeFiltersRef.current = activeFilters }, [activeFilters])
  useEffect(() => { activeTrucksRef.current = activeTrucks }, [activeTrucks])
  useEffect(() => { liveReportsRef.current = liveReports }, [liveReports])

  useEffect(() => {
    fetch('/data/lucena_barangays.geojson')
      .then(r => r.json())
      .then(setBarangayGeo)
      .catch(err => console.error("Failed to load barangay GeoJSON:", err))
    
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
  useEffect(() => {
    const fetchActiveShifts = () => {
      api.get('/api/driver/shift/active_shifts/')
        .then(res => setActiveTrucks(res.data))
        .catch(console.error)
    }
    fetchActiveShifts()
    const intv = setInterval(fetchActiveShifts, 10000)
    return () => clearInterval(intv)
  }, [])

  // ── Live reports — poll every 30 s ───────────────────────────────────────
  useEffect(() => {
    const intv = setInterval(fetchReports, 30_000)
    return () => clearInterval(intv)
  }, [])

  // ── Redraw main layers whenever relevant state changes ────────────────────
  useEffect(() => {
    if (!mapInstanceRef.current) return
    drawAll(mapInstanceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, barangayGeo, activeFilters, reports, activeTrucks])

  // ── Fetch barangay stops when a zone is selected ──────────────────────────
  // Draws stop markers (colour-coded like ShiftRouteModule) WITHOUT the route.
  useEffect(() => {
    if (!selectedZone || !mapReady) {
      clearBarangayMarkers()
      return
    }
    clearBarangayMarkers()
    setBarangayData({ trucks: [], stops: [], loading: true })

    api.get(`/api/driver/shift/barangay_stops/?barangay_name=${encodeURIComponent(selectedZone.name)}`)
      .then(res => {
        setBarangayData({ trucks: res.data.trucks || [], stops: res.data.stops || [], loading: false })
        drawBarangayStops(res.data.stops || [])
      })
      .catch(() => setBarangayData({ trucks: [], stops: [], loading: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZone?.name, mapReady])

  // ── Clear barangay markers when panel closes ──────────────────────────────
  useEffect(() => {
    if (!panelOpen) {
      clearBarangayMarkers()
      setBarangayData({ trucks: [], stops: [], loading: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen])

  // ─── BARANGAY STOP MARKER HELPERS ────────────────────────────────────────

  function clearBarangayMarkers() {
    barangayMarkersRef.current.forEach(m => {
      try { mapInstanceRef.current?.removeLayer(m) } catch { }
    })
    barangayMarkersRef.current = []
  }

  function drawBarangayStops(stops) {
    if (!mapInstanceRef.current || !window.L || !stops.length) return
    const L = window.L

    stops.forEach(stop => {
      if (!stop.lat || !stop.lng) return
      const color = STOP_COLORS_MAP[stop.status] || STOP_COLORS_MAP.upcoming
      const size = stop.status === 'current' ? 28 : 24

      const marker = L.marker([Number(stop.lat), Number(stop.lng)], {
        icon: L.divIcon({
          html: makeStopMarkerHtml(stop.stop_order, stop.status),
          className: '',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        zIndexOffset: 800,
      })
        .addTo(mapInstanceRef.current)
        .bindPopup(`<div style="font-family:sans-serif;min-width:140px;">
          <b style="font-size:13px;">${stop.label}</b><br/>
          <span style="font-size:11px;color:${color};font-weight:700;text-transform:uppercase">${stop.status}</span><br/>
          <span style="font-size:11px;color:#64748b">Driver: ${stop.driver_name}</span>
        </div>`)

      barangayMarkersRef.current.push(marker)
    })

    // Fit map to show all stop markers if there are any
    if (barangayMarkersRef.current.length > 0) {
      try {
        const group = L.featureGroup(barangayMarkersRef.current)
        mapInstanceRef.current.fitBounds(group.getBounds().pad(0.3))
      } catch { }
    }
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
          if (!activeFiltersRef.current[type]) {
            return { opacity: 0, fillOpacity: 0, pointerEvents: "none" }
          }
          return {
            color: meta.color, weight: 1.5, opacity: 0.85,
            fillColor: meta.color, fillOpacity: 0.18, dashArray: "5,4",
          }
        },
        onEachFeature: (feature, layer) => {
          const type = getZoneType(feature.properties.brgy_name)
          const color = ZONE_META[type].color

          layer.on("click", () => {
            setSelectedZone({
              id: feature.properties.brgy_code,
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

    // ── Truck routes ──
    if (activeFilters.routes) {
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

    // ── Live truck markers ──
    if (activeFilters.trucks) {
      activeTrucksRef.current.forEach(truck => {
        const truckColor = STATUS_COLORS[truck.status] || '#14b8a6'
        const icon = L.divIcon({
          html: makeTruckIcon(truckColor, truck.truckId, truck.status),
          className: '', iconSize: [44, 60], iconAnchor: [22, 60],
        })
        const m = L.marker([truck.lat, truck.lng], { icon }).addTo(map)

        const statusLabel = truck.status === 'active' ? '🟢 Active'
          : truck.status === 'weak_signal' ? '🟡 Weak Signal' : '⚫ Offline'
        const lastUpdate = truck.last_update ? new Date(truck.last_update).toLocaleTimeString() : 'N/A'

        m.bindPopup(`<div style="font-family:sans-serif;min-width:180px;">
          <strong style="font-size:14px;">🚛 ${truck.truckId}</strong><br/>
          <span style="color:#64748b;font-size:12px;">${truck.driver}</span><br/>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:6px 0;"/>
          <span style="font-size:12px;"><b>Status:</b> ${statusLabel}</span><br/>
          <span style="font-size:11px;color:#94a3b8;">Last update: ${lastUpdate}</span>
        </div>`)

        m.on('click', () => {
          setSelectedRoute({
            id: truck.id, truckId: truck.truckId, driver: truck.driver,
            barangay: 'Live Tracking', status: 'collecting', capacity: 50,
            collectedCount: 0, totalPoints: 0, eta: 'N/A', nextCollection: 'N/A',
            lastUpdate, color: truckColor,
          })
          setPanelMode('route')
          setPanelOpen(true)
        })
        layersRef.current[`live-truck-${truck.id}`] = m
      })
    }

    // ── Dump sites ──
    if (activeFilters.dumpSites) {
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

    // ── Garbage reports ──
    if (activeFilters.reports) {
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

    // ── "You" marker ──
    const youIcon = L.divIcon({ html: youIconHtml, className: "", iconSize: [38, 38], iconAnchor: [19, 19] })
    const youM = L.marker([13.9370, 121.6155], { icon: youIcon, zIndexOffset: 1000 }).addTo(map)
    youM.bindPopup("<b>📍 Your Location</b>")
    layersRef.current["you"] = youM
  }

  function toggleFilter(key) {
    setActiveFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#0f172a" }}>
      <Navbar />

      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>

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
          <div style={{ flex: 1 }} />
          <button className="ww-btn" onClick={() => { setFilterOpen(o => !o); setLegendOpen(false) }}
            style={{ pointerEvents: "auto", background: "rgba(10,16,30,0.92)", border: "1px solid rgba(20,184,166,0.4)", color: "#14b8a6", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600 }}>
            ⚙️ Filters
          </button>
          <button className="ww-btn" onClick={() => { setLegendOpen(o => !o); setFilterOpen(false) }}
            style={{ pointerEvents: "auto", background: "rgba(10,16,30,0.92)", border: "1px solid rgba(20,184,166,0.4)", color: "#14b8a6", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600 }}>
            🗺️ Legend
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
              { key: "routes", label: "Truck Routes", icon: "〰️" },
              { key: "trucks", label: "Truck Markers", icon: "🚛" },
              { key: "dumpSites", label: "Dump Sites", icon: "🏭" },
              { key: "reports", label: "Garbage Reports", icon: "⚠️" },
            ].map(f => (
              <div key={f.key} className="filter-chip" onClick={() => toggleFilter(f.key)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ width: 20, height: 20, borderRadius: 5, background: activeFilters[f.key] ? "#14b8a6" : "#1e293b", border: "1.5px solid", borderColor: activeFilters[f.key] ? "#14b8a6" : "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                  {activeFilters[f.key] ? "✓" : ""}
                </div>
                <span style={{ fontSize: 11 }}>{f.icon}</span>
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
                <span style={{ fontSize: 11 }}>{meta.icon}</span>
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
              { icon: "🚛", label: "Truck (live position)" },
              { icon: "🏭", label: "Dump site" },
              { icon: "⚠️", label: "Reported garbage" },
              { icon: "📍", label: "Your location" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 14 }}>{r.icon}</span>
                <span style={{ color: "#cbd5e1", fontSize: 12 }}>{r.label}</span>
              </div>
            ))}
            <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.07)", margin: "10px 0" }} />
            <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>STOP STATUS (barangay view)</div>
            {[
              { color: '#2563eb', label: 'Current stop' },
              { color: '#16a34a', label: 'Collected' },
              { color: '#f59e0b', label: 'Upcoming' },
              { color: '#ef4444', label: 'Missed' },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
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
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 50, height: 50, borderRadius: "50%", background: "#ef4444", border: "none", fontSize: 22, boxShadow: "0 4px 16px rgba(239,68,68,0.4)", cursor: "pointer" }}>⚠️</button>
            <button className="ww-btn" onClick={() => navigate("/collection/confirm")} title="Confirm Collection"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 50, height: 50, borderRadius: "50%", background: "#22c55e", border: "none", fontSize: 22, boxShadow: "0 4px 16px rgba(34,197,94,0.4)", cursor: "pointer" }}>✅</button>
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
                {panelMode === "route" && selectedRoute && <RoutePanel route={selectedRoute} statusColors={statusColors} statusLabels={statusLabels} />}
                {panelMode === "zone" && selectedZone && <ZonePanel zone={selectedZone} barangayData={barangayData} />}
                {panelMode === "report" && selectedReport && <ReportPanel report={selectedReport} onStatusChange={() => {
                  api.get('/api/watcher/reports/map_pins/').then(res => setLiveReports(res.data)).catch(console.error)
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

function RoutePanel({ route, statusColors, statusLabels }) {
  const pct = route.totalPoints > 0
    ? Math.round((route.collectedCount / route.totalPoints) * 100)
    : 0
  const statusColor = statusColors[route.status] || "#64748b"
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 28 }}>🚛</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "white", fontWeight: 800, fontSize: 17 }}>{route.truckId}</div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>{route.driver}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: `${statusColor}22`, border: `1px solid ${statusColor}`, borderRadius: 20, padding: "4px 12px" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
          <span style={{ color: statusColor, fontSize: 12, fontWeight: 600 }}>{statusLabels[route.status]}</span>
        </div>
      </div>
      <Row label="BARANGAY" value={route.barangay} />
      <Row label="ETA TODAY" value={route.eta} accent />
      <Row label="NEXT COLLECTION" value={route.nextCollection} />
      <Row label="LAST UPDATE" value={route.lastUpdate} />
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>COLLECTION PROGRESS</span>
          <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>{route.collectedCount} / {route.totalPoints} stops</span>
        </div>
        <div style={{ background: "#1e293b", borderRadius: 8, height: 10, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#14b8a6,#22c55e)", borderRadius: 8, transition: "width 0.4s" }} />
        </div>
        <div style={{ color: "#14b8a6", fontSize: 11, marginTop: 4, fontWeight: 600 }}>{pct}% complete</div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, marginBottom: 8 }}>TRUCK CAPACITY</div>
        <div style={{ background: "#1e293b", borderRadius: 8, height: 10, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${route.capacity}%`, background: route.capacity > 80 ? "#ef4444" : route.capacity > 60 ? "#f59e0b" : "#22c55e", borderRadius: 8 }} />
        </div>
        <div style={{ color: route.capacity > 80 ? "#ef4444" : "#94a3b8", fontSize: 11, marginTop: 4 }}>{route.capacity}% full</div>
      </div>
    </>
  )
}

// ─── ZONE PANEL — shows active trucks + stop status for the selected barangay ─
// Stop route is NOT shown here (driver-only). Only the coloured stop markers
// already drawn on the map by drawBarangayStops() are visible.
function ZonePanel({ zone, barangayData }) {
  const meta = {
    residential: { label: "Residential", icon: "🏠" },
    commercial: { label: "Commercial", icon: "🏪" },
    industrial: { label: "Industrial", icon: "🏭" },
    agricultural: { label: "Agricultural", icon: "🌾" },
  }
  const m = meta[zone.type] || {}
  const { trucks = [], stops = [], loading = false } = barangayData || {}

  const collectedCount = stops.filter(s => s.status === 'collected').length
  const currentCount = stops.filter(s => s.status === 'current').length
  const upcomingCount = stops.filter(s => s.status === 'upcoming').length
  const missedCount = stops.filter(s => s.status === 'missed').length

  return (
    <>
      {/* Zone header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 30 }}>{m.icon}</div>
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
          <span style={{ fontSize: 20 }}>🚛</span>
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

          {/* Stop status summary — mirrors ShiftRouteModule colour coding */}
          {stops.length > 0 && (
            <>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, margin: '16px 0 8px', letterSpacing: '.04em' }}>
                STOP STATUS ({stops.length} stops · see map for locations)
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { label: 'Collected', count: collectedCount, color: '#16a34a' },
                  { label: 'Current', count: currentCount, color: '#2563eb' },
                  { label: 'Upcoming', count: upcomingCount, color: '#f59e0b' },
                  { label: 'Missed', count: missedCount, color: '#ef4444' },
                ].map(s => (
                  <div key={s.label} style={{
                    flex: 1, background: `${s.color}18`, border: `1px solid ${s.color}44`,
                    borderRadius: 8, padding: '8px 6px', textAlign: 'center',
                  }}>
                    <div style={{ color: s.color, fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{s.count}</div>
                    <div style={{ color: s.color, fontSize: 8, fontWeight: 700, letterSpacing: '.04em', marginTop: 3, textTransform: 'uppercase' }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ color: '#475569', fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
                Stop markers are visible on the map. Route paths are only shown to the assigned driver.
              </p>
            </>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button style={{ flex: 1, background: "rgba(20,184,166,0.15)", border: "1px solid #14b8a6", color: "#14b8a6", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          View Reports
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
    api.post(`/api/watcher/reports/${report.id}/approve/`)
      .then(() => onStatusChange?.())
      .catch(err => {
        console.error(err)
        alert(err.response?.data?.error || 'Failed to approve report')
      })
  }

  function handleReject() {
    const reason = prompt('Please enter a reason for rejection:')
    if (reason === null) return // Cancelled
    if (!reason.trim()) return alert('Reason is required for rejection.')
    
    api.post(`/api/watcher/reports/${report.id}/reject/`, { rejection_reason: reason })
      .then(() => onStatusChange?.())
      .catch(err => {
        console.error(err)
        alert(err.response?.data?.error || 'Failed to reject report')
      })
  }

  function handleResolve() {
    // This creates a confirmation which marks report as RESOLVED
    api.post('/api/watcher/confirmations/', { report: report.id })
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
          ℹ️ Only Watchers, Barangay Officials, and Admins can moderate reports.
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