// MapView.jsx — WasteWatch Admin/Watcher/Barangay Official Map

import { useEffect, useRef, useState } from "react";
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'   // ← added

export const LUCENA_CENTER = [13.9373, 121.6170];

export const ZONE_TYPE_MAP = {
  "Barangay 1 (Pob.)": "commercial",  "Barangay 2 (Pob.)": "commercial",
  "Barangay 3 (Pob.)": "commercial",  "Barangay 4 (Pob.)": "commercial",
  "Barangay 5 (Pob.)": "commercial",  "Barangay 6 (Pob.)": "commercial",
  "Barangay 7 (Pob.)": "commercial",  "Barangay 8 (Pob.)": "commercial",
  "Barangay 9 (Pob.)": "commercial",  "Barangay 10 (Pob.)": "commercial",
  "Barangay 11 (Pob.)": "commercial",
  "Gulang-Gulang": "industrial",      "Cotta": "industrial",
  "Mayao Crossing": "agricultural",   "Mayao Kanluran": "agricultural",
  "Mayao Parada": "agricultural",     "Mayao Silangan": "agricultural",
  "Ilayang Dupay": "agricultural",
}

export function getZoneType(brgy_name) {
  return ZONE_TYPE_MAP[brgy_name] ?? "residential"
}

// Roles that may confirm or dismiss garbage reports
const REPORT_MODERATOR_ROLES = ["watcher", "brgy_official", "admin"]

export const TRUCK_ROUTES = [
  {
    id: "T01", truckId: "Truck 01", driver: "Pedro Santos", barangay: "Ibabang Dupay Zone 1",
    status: "collecting", capacity: 75, collectedCount: 11, totalPoints: 15,
    eta: "1:45 PM", nextCollection: "Thursday, 8:00 AM", lastUpdate: "5 min ago", color: "#14b8a6",
    completedUpTo: 7,
    waypoints: [[13.9460, 121.6085], [13.9472, 121.6102], [13.9480, 121.6120], [13.9488, 121.6138], [13.9475, 121.6155], [13.9460, 121.6160], [13.9448, 121.6145], [13.9440, 121.6128], [13.9452, 121.6110], [13.9464, 121.6095]]
  },
  {
    id: "T02", truckId: "Truck 02", driver: "Juan Dela Cruz", barangay: "Ibabang Dupay Zone 3",
    status: "collecting", capacity: 60, collectedCount: 9, totalPoints: 15,
    eta: "2:30 PM", nextCollection: "Friday, 8:00 AM", lastUpdate: "2 min ago", color: "#f59e0b",
    completedUpTo: 8,
    waypoints: [[13.9400, 121.6135], [13.9410, 121.6150], [13.9420, 121.6165], [13.9432, 121.6178], [13.9440, 121.6190], [13.9448, 121.6200], [13.9438, 121.6208], [13.9425, 121.6202], [13.9415, 121.6188], [13.9408, 121.6170], [13.9402, 121.6152]]
  },
  {
    id: "T03", truckId: "Truck 03", driver: "Maria Reyes", barangay: "Cotta Commercial District",
    status: "en_route", capacity: 30, collectedCount: 4, totalPoints: 12,
    eta: "3:15 PM", nextCollection: "Friday, 7:00 AM", lastUpdate: "12 min ago", color: "#a78bfa",
    completedUpTo: 3,
    waypoints: [[13.9330, 121.6095], [13.9340, 121.6110], [13.9352, 121.6125], [13.9362, 121.6140], [13.9370, 121.6155], [13.9362, 121.6168], [13.9350, 121.6162], [13.9338, 121.6148]]
  },
];

export const DUMP_SITES = [
  { id: "D1", name: "Main Landfill — Gulang-Gulang", lat: 13.9295, lng: 121.6230, capacity: 82 },
  { id: "D2", name: "Transfer Station — Cotta", lat: 13.9345, lng: 121.6085, capacity: 55 },
];

export const GARBAGE_REPORTS = [
  { id: "R1", lat: 13.9415, lng: 121.6175, type: "overflow", severity: "high", address: "Ibabang Dupay Zone 3", reported: "30 min ago" },
  { id: "R2", lat: 13.9358, lng: 121.6130, type: "illegal_dumping", severity: "medium", address: "Near Cotta District", reported: "2 hrs ago" },
  { id: "R3", lat: 13.9482, lng: 121.6145, type: "missed", severity: "low", address: "Zone 1 Side Street", reported: "1 day ago" },
];

export const ZONE_META = {
  residential: { label: "Residential", icon: "🏠", color: "#4ade80" },
  commercial:  { label: "Commercial",  icon: "🏪", color: "#fb923c" },
  industrial:  { label: "Industrial",  icon: "🏭", color: "#94a3b8" },
  agricultural:{ label: "Agricultural",icon: "🌾", color: "#a3e635" },
};

const makeTruckIcon = (color, label) => `
  <div style="position:relative;width:44px;height:52px;">
    <div style="background:${color};border:2.5px solid white;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);width:40px;height:40px;
      box-shadow:0 4px 14px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;">
      <div style="transform:rotate(45deg);font-size:17px;">🚛</div>
    </div>
    <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);
      background:${color};color:white;font-size:9px;font-weight:700;
      padding:1px 5px;border-radius:8px;border:1.5px solid white;
      white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${label}</div>
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

export default function MapView() {
  const navigate = useNavigate()
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const layersRef = useRef({})

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

  const activeFiltersRef = useRef(activeFilters)
  useEffect(() => { activeFiltersRef.current = activeFilters }, [activeFilters])

  useEffect(() => {
    fetch('/data/lucena_barangays.geojson')
      .then(r => r.json())
      .then(setBarangayGeo)
      .catch(err => console.error("Failed to load barangay GeoJSON:", err))
  }, [])

  const statusColors = { collecting: "#22c55e", en_route: "#f59e0b", idle: "#64748b", done: "#3b82f6" }
  const statusLabels = { collecting: "Collecting", en_route: "En Route", idle: "Idle", done: "Done" }

  // Load Leaflet CDN
  useEffect(() => {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    document.head.appendChild(link)
    const script = document.createElement("script")
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)
  }, [])

  // Init map
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstanceRef.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: "topright" }).addTo(map)
    mapInstanceRef.current = map
  }, [mapReady])

  // Redraw whenever map is ready, GeoJSON loads, or filters change
  useEffect(() => {
    if (!mapInstanceRef.current) return
    drawAll(mapInstanceRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, barangayGeo, activeFilters])

  function clearLayers() {
    const map = mapInstanceRef.current
    Object.values(layersRef.current).forEach(l => { try { map.removeLayer(l) } catch { } })
    layersRef.current = {}
  }

  function drawAll(map) {
    const L = window.L
    if (!L) return
    clearLayers()

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
            color: meta.color,
            weight: 1.5,
            opacity: 0.85,
            fillColor: meta.color,
            fillOpacity: 0.18,
            dashArray: "5,4",
          }
        },
        onEachFeature: (feature, layer) => {
          const type  = getZoneType(feature.properties.brgy_name)
          const color = ZONE_META[type].color

          layer.on("click", () => {
            setSelectedZone({
              id:    feature.properties.brgy_code,
              name:  feature.properties.brgy_name,
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
        const remPts  = route.waypoints.slice(route.completedUpTo)
        const clickHandler = () => { setSelectedRoute(route); setPanelMode("route"); setPanelOpen(true) }

        const doneLine = L.polyline(donePts, { color: route.color, weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(map)
        const remLine  = L.polyline(remPts,  { color: route.color, weight: 4, opacity: 0.5, dashArray: "10,8" }).addTo(map)
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
        layersRef.current[`route-rem-${route.id}`]  = remLine
      })
    }

    // ── Truck markers ──
    if (activeFilters.trucks) {
      TRUCK_ROUTES.forEach(route => {
        const pos  = route.waypoints[route.completedUpTo]
        const icon = L.divIcon({ html: makeTruckIcon(route.color, route.truckId), className: "", iconSize: [44, 52], iconAnchor: [22, 52] })
        const m    = L.marker(pos, { icon }).addTo(map)
        m.on("click", () => { setSelectedRoute(route); setPanelMode("route"); setPanelOpen(true) })
        layersRef.current[`truck-${route.id}`] = m
      })
    }

    // ── Dump sites ──
    if (activeFilters.dumpSites) {
      DUMP_SITES.forEach(site => {
        const icon = L.divIcon({ html: dumpSiteIconHtml, className: "", iconSize: [36, 36], iconAnchor: [18, 18] })
        const m    = L.marker([site.lat, site.lng], { icon }).addTo(map)
        m.bindPopup(`<div style="font-family:sans-serif;min-width:160px;">
          <strong style="color:#ef4444">🏭 ${site.name}</strong><br/>
          <span style="color:#64748b;font-size:12px;">Capacity: ${site.capacity}% full</span>
        </div>`)
        layersRef.current[`dump-${site.id}`] = m
      })
    }

    // ── Garbage reports ──
    if (activeFilters.reports) {
      GARBAGE_REPORTS.forEach(report => {
        const icon = L.divIcon({ html: garbageReportIconHtml(report.severity), className: "", iconSize: [30, 36], iconAnchor: [8, 36] })
        const m    = L.marker([report.lat, report.lng], { icon }).addTo(map)
        m.on("click", () => { setSelectedReport(report); setPanelMode("report"); setPanelOpen(true) })
        layersRef.current[`report-${report.id}`] = m
      })
    }

    // ── "You" marker ──
    const youIcon = L.divIcon({ html: youIconHtml, className: "", iconSize: [38, 38], iconAnchor: [19, 19] })
    const youM    = L.marker([13.9370, 121.6155], { icon: youIcon, zIndexOffset: 1000 }).addTo(map)
    youM.bindPopup("<b>📍 Your Location</b>")
    layersRef.current["you"] = youM
  }

  function toggleFilter(key) {
    setActiveFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#0f172a" }}>

      {/* ── NAVBAR ── */}
      <Navbar />

      {/* ── MAP SECTION ── */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>

        <style>{`
          @keyframes pulse    { 0%,100%{box-shadow:0 0 0 4px rgba(59,130,246,0.3)} 50%{box-shadow:0 0 0 8px rgba(59,130,246,0.1)} }
          @keyframes slideUp  { from{transform:translateY(100%)} to{transform:translateY(0)} }
          @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
          .ww-btn:hover       { opacity:0.88; transform:scale(1.04); }
          .ww-btn             { transition:all 0.15s; cursor:pointer; }
          .filter-chip        { transition:all 0.15s; cursor:pointer; user-select:none; }
          .filter-chip:hover  { opacity:0.85; }
          .leaflet-barangay-tooltip { background:rgba(15,23,42,0.9); border:1px solid rgba(20,184,166,0.4); color:#e2e8f0; font-size:11px; padding:3px 8px; border-radius:6px; }
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
          padding: "12px 16px 32px",
          zIndex: 400, pointerEvents: "none",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1 }} />
          <button className="ww-btn"
            onClick={() => { setFilterOpen(o => !o); setLegendOpen(false) }}
            style={{
              pointerEvents: "auto", background: "rgba(10,16,30,0.92)",
              border: "1px solid rgba(20,184,166,0.4)", color: "#14b8a6",
              borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600
            }}>
            ⚙️ Filters
          </button>
          <button className="ww-btn"
            onClick={() => { setLegendOpen(o => !o); setFilterOpen(false) }}
            style={{
              pointerEvents: "auto", background: "rgba(10,16,30,0.92)",
              border: "1px solid rgba(20,184,166,0.4)", color: "#14b8a6",
              borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600
            }}>
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
              { key: "routes",    label: "Truck Routes",     icon: "〰️" },
              { key: "trucks",    label: "Truck Markers",    icon: "🚛" },
              { key: "dumpSites", label: "Dump Sites",       icon: "🏭" },
              { key: "reports",   label: "Garbage Reports",  icon: "⚠️" },
            ].map(f => (
              <div key={f.key} className="filter-chip" onClick={() => toggleFilter(f.key)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5,
                  background: activeFilters[f.key] ? "#14b8a6" : "#1e293b",
                  border: "1.5px solid", borderColor: activeFilters[f.key] ? "#14b8a6" : "#334155",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11
                }}>
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
                <div style={{
                  width: 20, height: 20, borderRadius: 5,
                  background: activeFilters[key] ? meta.color : "#1e293b",
                  border: "1.5px solid", borderColor: activeFilters[key] ? meta.color : "#334155",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11
                }}>
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
              { icon: "🚛", label: "Truck (current pos)" },
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
            <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>ROUTE SEGMENTS</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 28, height: 4, background: "#14b8a6", borderRadius: 2 }} />
              <span style={{ color: "#cbd5e1", fontSize: 12 }}>Completed</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 0, borderTop: "3px dashed #14b8a6", opacity: 0.5 }} />
              <span style={{ color: "#cbd5e1", fontSize: 12 }}>Remaining</span>
            </div>
          </div>
        )}

        {/* ── FAB (bottom right) ── */}
        <div style={{ position: "absolute", right: 16, bottom: 24, zIndex: 400, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            transform: fabOpen ? "translateY(0)" : "translateY(40px)",
            opacity: fabOpen ? 1 : 0, pointerEvents: fabOpen ? "auto" : "none",
            transition: "all 0.25s ease",
          }}>
            <button className="ww-btn" onClick={() => navigate("/report/submit")} title="Report Issue"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 50, height: 50, borderRadius: "50%", background: "#ef4444", border: "none",
                fontSize: 22, boxShadow: "0 4px 16px rgba(239,68,68,0.4)", cursor: "pointer",
              }}>⚠️</button>
            <button className="ww-btn" onClick={() => navigate("/collection/confirm")} title="Confirm Collection"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 50, height: 50, borderRadius: "50%", background: "#22c55e", border: "none",
                fontSize: 22, boxShadow: "0 4px 16px rgba(34,197,94,0.4)", cursor: "pointer",
              }}>✅</button>
          </div>
          <button className="ww-btn" onClick={() => setFabOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 50, height: 50, borderRadius: "50%", background: "rgba(20,184,166,0.9)",
              border: "none", fontSize: 22, fontWeight: 700, color: "white", cursor: "pointer",
              boxShadow: "0 4px 16px rgba(20,184,166,0.4)",
              transform: fabOpen ? "rotate(45deg)" : "rotate(0deg)", transition: "transform 0.2s",
            }}>
            +
          </button>
        </div>

        {/* ── BOTTOM DRAG PANEL ── */}
        {panelOpen && (
          <>
            <div onClick={() => setPanelOpen(false)}
              style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 450 }} />
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "#0f172a", borderRadius: "20px 20px 0 0",
              zIndex: 500, maxHeight: "52vh", overflowY: "auto",
              animation: "slideUp 0.3s cubic-bezier(.4,0,.2,1)",
              boxShadow: "0 -4px 32px rgba(0,0,0,0.5)",
            }}>
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
                <div style={{ width: 40, height: 4, background: "#334155", borderRadius: 2 }} />
              </div>
              <button onClick={() => setPanelOpen(false)}
                style={{ position: "absolute", top: 12, right: 16, background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>
              <div style={{ padding: "0 20px 24px" }}>
                {panelMode === "route"  && selectedRoute  && <RoutePanel  route={selectedRoute}   statusColors={statusColors} statusLabels={statusLabels} />}
                {panelMode === "zone"   && selectedZone   && <ZonePanel   zone={selectedZone} />}
                {/* ↓ pass canModerate so ReportPanel knows whether to show action buttons */}
                {panelMode === "report" && selectedReport && <ReportPanel report={selectedReport} />}
              </div>
            </div>
          </>
        )}

      </div>{/* end map section */}
    </div>
  )
}

// ─── PANEL COMPONENTS ─────────────────────────────────────────────────────────

function RoutePanel({ route, statusColors, statusLabels }) {
  const pct = Math.round((route.collectedCount / route.totalPoints) * 100)
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
      <Row label="BARANGAY"        value={route.barangay} />
      <Row label="ETA TODAY"       value={route.eta}             accent />
      <Row label="NEXT COLLECTION" value={route.nextCollection} />
      <Row label="LAST UPDATE"     value={route.lastUpdate} />
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
          <div style={{
            height: "100%", width: `${route.capacity}%`,
            background: route.capacity > 80 ? "#ef4444" : route.capacity > 60 ? "#f59e0b" : "#22c55e",
            borderRadius: 8,
          }} />
        </div>
        <div style={{ color: route.capacity > 80 ? "#ef4444" : "#94a3b8", fontSize: 11, marginTop: 4 }}>{route.capacity}% full</div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button style={{ flex: 1, background: "rgba(20,184,166,0.15)", border: "1px solid #14b8a6", color: "#14b8a6", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>View Full Route</button>
        <button style={{ flex: 1, background: "rgba(239,68,68,0.1)",   border: "1px solid #ef4444", color: "#ef4444", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Report Issue</button>
      </div>
    </>
  )
}

function ZonePanel({ zone }) {
  const meta = {
    residential: { label: "Residential", icon: "🏠" },
    commercial:  { label: "Commercial",  icon: "🏪" },
    industrial:  { label: "Industrial",  icon: "🏭" },
    agricultural:{ label: "Agricultural",icon: "🌾" },
  }
  const m = meta[zone.type] || {}
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 30 }}>{m.icon}</div>
        <div>
          <div style={{ color: "white", fontWeight: 800, fontSize: 17 }}>{zone.name}</div>
          <div style={{ color: zone.color, fontSize: 12, fontWeight: 600 }}>{m.label} Zone</div>
        </div>
      </div>
      <Row label="ZONE TYPE"           value={m.label} />
      <Row label="COLLECTION SCHEDULE" value="Mon / Wed / Fri" />
      <Row label="ASSIGNED TRUCK"      value="Truck 02" accent />
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button style={{ flex: 1, background: "rgba(20,184,166,0.15)", border: "1px solid #14b8a6", color: "#14b8a6", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>View Reports</button>
      </div>
    </>
  )
}

// ─── ReportPanel — Confirm / Dismiss shown only to authorised roles ───────────
function ReportPanel({ report }) {
  const { user } = useAuth()   // ← pull current user from AuthContext

  // True when the logged-in user's role can moderate reports
  const canModerate = REPORT_MODERATOR_ROLES.includes(user?.role)

  const severityColors = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" }
  const typeLabels     = { overflow: "Overflow", illegal_dumping: "Illegal Dumping", missed: "Missed Pickup" }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 30 }}>⚠️</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "white", fontWeight: 800, fontSize: 17 }}>{typeLabels[report.type]}</div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>{report.address}</div>
        </div>
        <div style={{ background: `${severityColors[report.severity]}22`, border: `1px solid ${severityColors[report.severity]}`, borderRadius: 20, padding: "4px 12px" }}>
          <span style={{ color: severityColors[report.severity], fontSize: 12, fontWeight: 700 }}>{report.severity.toUpperCase()}</span>
        </div>
      </div>

      <Row label="REPORT TYPE" value={typeLabels[report.type]} />
      <Row label="REPORTED"    value={report.reported} />
      <Row label="STATUS"      value="Pending Review" accent />

      {/* ── Action buttons — visible to Watcher, Brgy_Official, Admin only ── */}
      {canModerate ? (
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button style={{ flex: 1, background: "rgba(34,197,94,0.1)",  border: "1px solid #22c55e", color: "#22c55e", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✅ Confirm</button>
          <button style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "1px solid #ef4444", color: "#ef4444", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✕ Dismiss</button>
        </div>
      ) : (
        /* Read-only notice for residents / drivers / other roles */
        <div style={{
          marginTop: 18, padding: "10px 14px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 16 }}></span>
          <span style={{ color: "#64748b", fontSize: 12 }}>
            photo
          </span>
        </div>
      )}
    </>
  )
}

function Row({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ color: "#0a0c0e", fontSize: 11, fontWeight: 600 }}>{label}</span>
      <span style={{ color: accent ? "#14b8a6" : "#e2e8f0", fontSize: 13, fontWeight: accent ? 700 : 400 }}>{value}</span>
    </div>
  )
}
