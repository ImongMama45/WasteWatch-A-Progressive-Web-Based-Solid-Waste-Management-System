import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import ReactDOMServer from 'react-dom/server'
import { Truck, Trash2, AlertTriangle, Navigation2, X, Map as MapIcon, Layers, Search } from 'lucide-react'
import Navbar from '../components/Navbar'
import api from '../api/client'
import useUserLocation from '../hooks/useUserLocation'
import { useAuth } from '../context/AuthContext'

export const LUCENA_CENTER = [13.9373, 121.6170]

const SEVERITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }
const TYPE_LABELS = { overflow: 'Overflow', illegal_dumping: 'Illegal Dumping', missed: 'Missed Pickup' }
const TRUCK_STATUS_COLORS = { active: '#22c55e', weak_signal: '#f59e0b', offline: '#64748b' }
const TRUCK_STATUS_LABELS = { active: 'Active', weak_signal: 'Weak Signal', offline: 'Offline' }
const DUMPSITE_TYPE_META = {
  landfill: { label: 'Landfill', color: '#e74c3c' },
  dumpsite: { label: 'Open Dumpsite', color: '#f39c12' },
  transfer: { label: 'Transfer Station', color: '#5dade2' },
  composting: { label: 'Composting Area', color: '#2ecc71' },
}

// ── Distance helper (client-side haversine, km) ────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || Number.isNaN(Number(v)))) return null
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Marker icon builders (vanilla HTML strings for L.divIcon) ─────────────
function makeYouMarkerHtml(accuracy) {
  const accRing =
    accuracy != null && accuracy <= 80
      ? `<div style="position:absolute;inset:-10px;border-radius:50%;border:2px solid rgba(59,130,246,0.35);"></div>`
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

function makeTruckIconHtml(color) {
  return `
    <div style="position:relative;width:44px;height:44px;">
      <div style="
        background: rgba(15,23,42,0.85); border:2px solid ${color}; backdrop-filter: blur(8px);
        border-radius: 14px; width:44px; height:44px; display:flex; align-items:center; justify-content:center;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      ">
        <svg viewBox="0 0 100 80" style="width:26px;height:26px;fill:${color};">
          <path d="M 38 22 L 65 22 L 65 60 L 38 60 Z"/>
          <rect x="42" y="22" width="4" height="38" fill="#0f172a"/>
          <rect x="50" y="22" width="4" height="38" fill="#0f172a"/>
          <rect x="58" y="22" width="4" height="38" fill="#0f172a"/>
          <path d="M 67 33 L 78 33 L 82 45 L 88 45 L 88 60 L 67 60 Z"/>
          <path d="M 71 36 L 76 36 L 79 44 L 71 44 Z" fill="#0f172a"/>
          <path d="M 18 35 L 36 22 L 36 50 L 24 50 L 22 55 Z"/>
          <circle cx="48" cy="60" r="7"/><circle cx="78" cy="60" r="7"/>
          <circle cx="48" cy="60" r="3" fill="#0f172a"/><circle cx="78" cy="60" r="3" fill="#0f172a"/>
        </svg>
      </div>
      <div style="position:absolute; bottom:-8px; left:50%; transform:translateX(-50%);
        background:${color}; color:#0f172a; font-size:9px; font-weight:800; padding:2px 8px;
        border-radius:12px; white-space:nowrap; border:1.5px solid #0f172a;">NEAREST</div>
    </div>`
}

function makeDumpsiteIconHtml(color) {
  return `
    <div style="
      background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(240,240,240,0.85));
      border: 2px solid ${color}; border-radius: 16px 16px 16px 4px; width:40px; height:40px;
      display:flex; align-items:center; justify-content:center; box-shadow: 0 10px 25px rgba(0,0,0,0.35);
    ">
      <svg viewBox="0 0 100 80" style="width:22px;height:22px;fill:#334155;">
        <path d="M 38 22 L 65 22 L 65 60 L 38 60 Z"/>
        <rect x="42" y="22" width="4" height="38" fill="#fff"/>
        <rect x="50" y="22" width="4" height="38" fill="#fff"/>
        <rect x="58" y="22" width="4" height="38" fill="#fff"/>
        <path d="M 67 33 L 78 33 L 82 45 L 88 45 L 88 60 L 67 60 Z"/>
        <path d="M 18 35 L 36 22 L 36 50 L 24 50 L 22 55 Z"/>
        <circle cx="48" cy="60" r="7"/><circle cx="78" cy="60" r="7"/>
      </svg>
    </div>`
}

function makeReportIconHtml(severity) {
  const color = SEVERITY_COLORS[severity] || '#f59e0b'
  return `<div style="
    background: rgba(15,23,42,0.8); border:2px solid ${color}; border-radius:50%;
    width:32px; height:32px; display:flex; align-items:center; justify-content:center;
    box-shadow:0 0 12px ${color}66;">
    <div style="width:16px;height:16px;color:${color};display:flex;">
      ${ReactDOMServer.renderToString(<AlertTriangle size={16} />)}
    </div>
  </div>`
}

export default function PublicMap() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading: authLoading, barangays } = useAuth()
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapInitialized, setMapInitialized] = useState(false)

  const markersRef = useRef({}) // key -> L.marker
  const userMarkerRef = useRef(null)
  const userAccuracyCircleRef = useRef(null)
  const hasCenteredRef = useRef(false)
  const geoJsonLayerRef = useRef(null)
  const zoneRequestSeqRef = useRef(0)
  const barangaysRef = useRef(barangays)

  const { position, accuracy, error: locError, isTracking } = useUserLocation({ enabled: true })

  const [trucks, setTrucks] = useState([])
  const [dumpsites, setDumpsites] = useState([])
  const [myReports, setMyReports] = useState([])
  const [hotspots, setHotspots] = useState([])
  const [barangaySummary, setBarangaySummary] = useState([])
  const [zoneStops, setZoneStops] = useState(null)
  const [loadingReports, setLoadingReports] = useState(true)
  const [selected, setSelected] = useState(null) // { type: 'truck'|'dumpsite'|'report'|'zone', data }
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [focusedReport, setFocusedReport] = useState(null)

  const [filterOpen, setFilterOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [filters, setFilters] = useState({ boundaries: true, hotspots: true, trucks: true, dumpsites: true, myReports: true })
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const summaryRef = useRef(barangaySummary)
  const filtersRef = useRef(filters)
  const selectedZoneRef = useRef(null)

  useEffect(() => { barangaysRef.current = barangays }, [barangays])

  // ── Sync refs and trigger restyle ───────────────────────────────────────
  useEffect(() => {
    summaryRef.current = barangaySummary
    filtersRef.current = filters
    if (geoJsonLayerRef.current) {
      geoJsonLayerRef.current.setStyle(styleFeature)
    }
  }, [barangaySummary, filters])

  // ── Dynamic GeoJSON Styling ─────────────────────────────────────────────
  const styleFeature = useCallback((feature) => {
    if (!filtersRef.current.boundaries) {
      return { opacity: 0, fillOpacity: 0, pointerEvents: 'none' }
    }
    const name = feature.properties.brgy_name
    const summary = summaryRef.current.find(s => s.barangay_name === name)
    const isFocused = selectedZoneRef.current && selectedZoneRef.current.name === name
    const isDimmed = selectedZoneRef.current && !isFocused

    let baseColor = '#64748b' // default slate
    if (summary) {
      if (summary.completed_stops >= summary.total_stops && summary.total_stops > 0) {
        baseColor = '#10b981' // Completed -> Emerald
      } else if (summary.is_active) {
        baseColor = '#3b82f6' // Active -> Blue
      }
    }

    return {
      color: isFocused ? '#f59e0b' : baseColor, // Highlight selected in amber
      weight: isFocused ? 3 : 1.5,
      opacity: isDimmed ? 0.3 : 0.8,
      fillColor: isFocused ? '#f59e0b' : baseColor,
      fillOpacity: isFocused ? 0.3 : (isDimmed ? 0.05 : 0.15),
      dashArray: isFocused ? '' : '4,4'
    }
  }, [])

  // ── Feature Click Handler ───────────────────────────────────────────────
  const onFeatureClick = useCallback((e) => {
    const brgyName = e.target.feature.properties.brgy_name
    const djangoBrgy = barangaysRef.current?.find(b => b.name === brgyName)
    const zone = { id: djangoBrgy?.id ?? null, name: brgyName }

    selectedZoneRef.current = zone
    setSelected({ type: 'zone', data: zone })
    setZoneStops(null) // clear old stops
    setIsPanelCollapsed(false)

    // trigger redraw for focus
    if (geoJsonLayerRef.current) {
      geoJsonLayerRef.current.setStyle(styleFeature)
    }

    // Fetch stops
    const token = ++zoneRequestSeqRef.current
    api.get(`/api/driver/shift/barangay_stops/?barangay_name=${encodeURIComponent(zone.name)}&scope=all`)
      .then(res => {
        if (token !== zoneRequestSeqRef.current) return
        setZoneStops(res.data)
      })
      .catch(console.error)
  }, [styleFeature])

  const clearZoneSelection = useCallback(() => {
    selectedZoneRef.current = null
    setSelected(null)
    setZoneStops(null)
    setIsPanelCollapsed(false)
    zoneRequestSeqRef.current += 1 // invalidate any pending stop fetch
    if (geoJsonLayerRef.current) {
      geoJsonLayerRef.current.setStyle(styleFeature)
    }
  }, [styleFeature])

  // ── Load Leaflet CDN ──────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setMapReady(true); return }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)
  }, [])

  // ── Init map ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstanceRef.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapInstanceRef.current = map
    setMapInitialized(true)

    if (location.state?.focusReport) {
      const rep = location.state.focusReport
      const focusLat = rep.latitude || rep.lat
      const focusLng = rep.longitude || rep.lng
      if (focusLat && focusLng) {
        map.setView([focusLat, focusLng], 18)
        setFocusedReport(rep)
        setSelected({ type: 'report', data: rep })
        navigate(location.pathname, { replace: true, state: {} })
      }
    }

    setTimeout(() => map.invalidateSize(), 100)
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(mapRef.current)

    // Intercept clicks on map background to clear selection
    map.on('click', (e) => {
      // If they didn't click a polygon (which stops propagation)
      clearZoneSelection()
    })

    return () => {
      observer.disconnect()
      map.remove()
      mapInstanceRef.current = null
      setMapInitialized(false)
    }
  }, [mapReady, clearZoneSelection]) // clearZoneSelection must stay referentially stable or this remounts the whole map

  // ── Load GeoJSON ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInitialized || geoJsonLayerRef.current) return
    fetch('/data/lucena_barangays.geojson')
      .then(res => res.json())
      .then(geo => {
        geoJsonLayerRef.current = window.L.geoJSON(geo, {
          style: styleFeature,
          onEachFeature: (feature, layer) => {
            layer.on('click', (e) => {
              L.DomEvent.stopPropagation(e) // prevent map bg click
              onFeatureClick(e)
            })
          }
        }).addTo(mapInstanceRef.current)
      }).catch(console.error)
  }, [mapInitialized, styleFeature, onFeatureClick])

  // ── Fetch scoped data ───────────────────────────────────────────────────
  const fetchTrucksAndDumpsites = useCallback(() => {
    api.get('/api/driver/shift/active_shifts/')
      .then((res) => setTrucks(res.data || []))
      .catch((err) => console.error('[PublicMap] active_shifts error', err))

    api.get('/api/dumpsite/dumpsites/')
      .then((res) => setDumpsites(res.data || []))
      .catch((err) => console.error('[PublicMap] dumpsites error', err))
  }, [])

  const fetchMyReports = useCallback(() => {
    if (!user) {
      setMyReports([])
      setLoadingReports(false)
      return
    }
    api.get('/api/watcher/reports/mine/')
      .then((res) => setMyReports(res.data || []))
      .catch((err) => console.error('[PublicMap] mine reports error', err))
      .finally(() => setLoadingReports(false))
  }, [user])

  const fetchHotspots = useCallback(() => {
    api.get('/api/watcher/reports/map_pins/')
      .then((res) => setHotspots(res.data || []))
      .catch((err) => console.error('[PublicMap] hotspots error', err))
  }, [])

  const fetchSummary = useCallback(() => {
    api.get('/api/driver/shift/barangay_summary/')
      .then((res) => setBarangaySummary(res.data || []))
      .catch((err) => console.error('[PublicMap] summary error', err))
  }, [])

  // Poll setup
  useEffect(() => {
    fetchTrucksAndDumpsites()
    const intv = setInterval(fetchTrucksAndDumpsites, 15000)
    return () => clearInterval(intv)
  }, [fetchTrucksAndDumpsites])

  useEffect(() => {
    fetchMyReports()
    if (!user) return
    const intv = setInterval(fetchMyReports, 30000)
    return () => clearInterval(intv)
  }, [fetchMyReports, user])

  useEffect(() => {
    fetchHotspots()
    const intv = setInterval(fetchHotspots, 60000)
    return () => clearInterval(intv)
  }, [fetchHotspots])

  useEffect(() => {
    fetchSummary()
    const intv = setInterval(fetchSummary, 30000)
    return () => clearInterval(intv)
  }, [fetchSummary])

  // ── Compute nearest truck / dumpsite ───────────────────────────────────
  const nearestTruck = useMemo(() => {
    if (!position) return null
    let best = null
    trucks.forEach((t) => {
      if (t.lat == null || t.lng == null) return
      const dist = haversineKm(position.lat, position.lng, t.lat, t.lng)
      if (dist == null) return
      if (!best || dist < best.distanceKm) best = { ...t, distanceKm: dist }
    })
    return best
  }, [position, trucks])

  const nearestDumpsite = useMemo(() => {
    if (!position) return null
    let best = null
    dumpsites.forEach((d) => {
      if (!d.latitude || !d.longitude) return
      const dist = haversineKm(position.lat, position.lng, Number(d.latitude), Number(d.longitude))
      if (dist == null) return
      if (!best || dist < best.distanceKm) best = { ...d, distanceKm: dist }
    })
    return best
  }, [position, dumpsites])

  // ── Live "You are here" marker ─────────────────────────────────────────
  useEffect(() => {
    if (!mapInitialized || !window.L || !position) return
    const L = window.L
    const latLng = [position.lat, position.lng]

    if (!userMarkerRef.current) {
      const icon = L.divIcon({ html: makeYouMarkerHtml(accuracy), className: '', iconSize: [20, 20], iconAnchor: [10, 10] })
      userMarkerRef.current = L.marker(latLng, { icon, zIndexOffset: 1200 }).addTo(mapInstanceRef.current)
      userMarkerRef.current.bindPopup('<b>Your location</b>')
    } else {
      userMarkerRef.current.setLatLng(latLng)
      userMarkerRef.current.setIcon(L.divIcon({ html: makeYouMarkerHtml(accuracy), className: '', iconSize: [20, 20], iconAnchor: [10, 10] }))
    }

    if (accuracy != null && accuracy <= 150) {
      if (userAccuracyCircleRef.current) {
        userAccuracyCircleRef.current.setLatLng(latLng)
        userAccuracyCircleRef.current.setRadius(accuracy)
      } else {
        userAccuracyCircleRef.current = L.circle(latLng, {
          radius: accuracy, color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.08,
        }).addTo(mapInstanceRef.current)
      }
    }
  }, [mapInitialized, position, accuracy])

  // ── Draw generic markers (Trucks, Dumpsites, Reports, Raw Stops) ────────
  useEffect(() => {
    if (!mapInitialized || !window.L) return
    const L = window.L
    const map = mapInstanceRef.current
    const desired = new Map()

    if (filters.trucks && nearestTruck) {
      desired.set('nearest-truck', {
        lat: nearestTruck.lat, lng: nearestTruck.lng,
        html: makeTruckIconHtml(TRUCK_STATUS_COLORS[nearestTruck.status] || '#14b8a6'),
        size: 44, onClick: () => setSelected({ type: 'truck', data: nearestTruck }),
        z: 900
      })
    }
    if (filters.dumpsites && nearestDumpsite) {
      const meta = DUMPSITE_TYPE_META[nearestDumpsite.type] || DUMPSITE_TYPE_META.dumpsite
      desired.set('nearest-dumpsite', {
        lat: Number(nearestDumpsite.latitude), lng: Number(nearestDumpsite.longitude),
        html: makeDumpsiteIconHtml(meta.color), size: 40,
        onClick: () => setSelected({ type: 'dumpsite', data: nearestDumpsite }),
        z: 800
      })
    }

    // My Reports
    if (filters.myReports) {
      myReports.forEach((r) => {
        const lat = r.latitude ?? r.lat
        const lng = r.longitude ?? r.lng
        if (!lat || !lng) return
        desired.set(`my-report-${r.id}`, {
          lat: Number(lat), lng: Number(lng),
          html: makeReportIconHtml(r.severity), size: 32,
          onClick: () => setSelected({ type: 'report', data: r }),
          z: 700
        })
      })
    }

    // Public Hotspots
    if (filters.hotspots) {
      hotspots.forEach((r) => {
        // map_pins returns limited data, don't overlap with myReports if same id
        if (filters.myReports && myReports.some(m => m.id === r.report_id)) return
        const lat = r.latitude ?? r.lat
        const lng = r.longitude ?? r.lng
        if (!lat || !lng) return
        desired.set(`hotspot-${r.id}`, {
          lat: Number(lat), lng: Number(lng),
          html: makeReportIconHtml(r.severity), size: 32,
          onClick: () => setSelected({ type: 'report', data: r }),
          z: 600
        })
      })
    }

    // Focused Report
    if (focusedReport) {
      const lat = focusedReport.latitude ?? focusedReport.lat
      const lng = focusedReport.longitude ?? focusedReport.lng
      if (lat && lng) {
        desired.set(`focused-report-${focusedReport.id}`, {
          lat: Number(lat), lng: Number(lng),
          html: makeReportIconHtml(focusedReport.severity || 'medium'), size: 32,
          onClick: () => setSelected({ type: 'report', data: focusedReport }),
          z: 1000
        })
      }
    }

    // Tiny dots for zone stops if a zone is active
    if (selected?.type === 'zone' && zoneStops?.stops) {
      zoneStops.stops.forEach((st) => {
        const isDone = st.status === 'VERIFIED_COLLECTED' || st.status === 'COLLECTION_REPORTED'
        const col = isDone ? '#10b981' : '#cbd5e1'
        const shadow = isDone ? 'box-shadow: 0 0 6px rgba(16,185,129,0.5);' : ''
        const html = `<div style="width:10px;height:10px;background:${col};border-radius:50%;border:1.5px solid #fff;${shadow}"></div>`
        desired.set(`stop-${st.schedule_id}-${st.stop_order}`, {
          lat: st.lat, lng: st.lng, html, size: 10,
          onClick: () => { }, // empty click handler so it doesn't close panel
          z: 500
        })
      })
    }

    // Remove stale
    Object.keys(markersRef.current).forEach((key) => {
      if (!desired.has(key)) {
        try { map.removeLayer(markersRef.current[key]) } catch { /* noop */ }
        delete markersRef.current[key]
      }
    })

    // Add / update
    desired.forEach((entry, key) => {
      const icon = L.divIcon({ html: entry.html, className: '', iconSize: [entry.size, entry.size], iconAnchor: [entry.size / 2, entry.size / 2] })
      if (markersRef.current[key]) {
        markersRef.current[key].setLatLng([entry.lat, entry.lng])
        markersRef.current[key].setIcon(icon)
        markersRef.current[key].setZIndexOffset(entry.z || 0)
        return
      }
      const marker = L.marker([entry.lat, entry.lng], { icon, zIndexOffset: entry.z || 0 }).addTo(map)
      if (entry.onClick) marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        entry.onClick()
      })
      markersRef.current[key] = marker
    })
  }, [mapInitialized, nearestTruck, nearestDumpsite, myReports, hotspots, zoneStops, filters, selected, focusedReport])

  // ── Auto-center once, when we first know the user's position ──────────
  useEffect(() => {
    if (!mapInitialized || !position || hasCenteredRef.current) return
    hasCenteredRef.current = true
    mapInstanceRef.current.setView([position.lat, position.lng], Math.max(mapInstanceRef.current.getZoom(), 15))
  }, [mapInitialized, position])

  function recenter() {
    if (!position || !mapInstanceRef.current) return
    mapInstanceRef.current.setView([position.lat, position.lng], 16)
  }

  const toggleFilter = (key) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSearch = (name) => {
    const djangoBrgy = barangaysRef.current?.find(b => b.name === name)
    if (!djangoBrgy) return
    const zone = { id: djangoBrgy.id, name }

    selectedZoneRef.current = zone
    setSelected({ type: 'zone', data: zone })
    setZoneStops(null)
    setIsPanelCollapsed(false)
    setSearchQuery(name)
    setShowSearchResults(false)

    if (geoJsonLayerRef.current) {
      geoJsonLayerRef.current.setStyle(styleFeature)

      // Auto-pan to the selected zone
      geoJsonLayerRef.current.eachLayer(layer => {
        if (layer.feature.properties.brgy_name === name && mapInstanceRef.current) {
          mapInstanceRef.current.fitBounds(layer.getBounds())
        }
      })
    }

    const token = ++zoneRequestSeqRef.current
    api.get(`/api/driver/shift/barangay_stops/?barangay_name=${encodeURIComponent(zone.name)}&scope=all`)
      .then(res => {
        if (token !== zoneRequestSeqRef.current) return
        setZoneStops(res.data)
      })
      .catch(console.error)
  }

  const filteredBarangays = useMemo(() => {
    if (!searchQuery) return []
    return (barangays || [])
      .filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .slice(0, 5)
  }, [searchQuery, barangays])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      <Navbar />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div ref={mapRef} style={{ position: 'absolute', inset: 0 }} />

        {!mapReady && (
          <div style={{ position: 'absolute', inset: 0, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <div style={{ color: '#14b8a6', fontSize: 18, fontWeight: 600 }}>Loading Map…</div>
          </div>
        )}


        {/* Top Left Controls: Search Bar */}
        <div style={{ position: 'absolute', top: 80, left: 16, zIndex: 400 }}>
          <div style={{ position: 'relative', width: isMobile ? 200 : 260 }}>
            <div style={{
              display: 'flex', alignItems: 'center', background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 20, padding: '8px 12px', backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}>
              <Search size={16} color="#94a3b8" />
              <input
                type="text"
                placeholder="Search barangay..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setShowSearchResults(true) }}
                onFocus={() => setShowSearchResults(true)}
                style={{ background: 'transparent', border: 'none', color: 'white', outline: 'none', marginLeft: 8, fontSize: 13, width: '100%' }}
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setShowSearchResults(false) }} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                  <X size={14} />
                </button>
              )}
            </div>
            {showSearchResults && filteredBarangays.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'rgba(15,23,42,0.95)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden', backdropFilter: 'blur(16px)',
              }}>
                {filteredBarangays.map(b => (
                  <div
                    key={b.id}
                    onClick={() => handleSearch(b.name)}
                    style={{ padding: '10px 12px', color: 'white', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                    onMouseOver={e => e.target.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseOut={e => e.target.style.background = 'transparent'}
                  >
                    {b.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Top Right Controls: Filters, Legend */}
        <div style={{ position: 'absolute', top: 80, right: 16, zIndex: 400, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <button onClick={() => { setFilterOpen(o => !o); setLegendOpen(false) }}
            title="Map Filters"
            style={{
              background: filterOpen ? "rgba(20,184,166,0.15)" : "rgba(15,23,42,0.65)",
              backdropFilter: "blur(8px)", border: `1px solid ${filterOpen ? "rgba(20,184,166,0.4)" : "rgba(255,255,255,0.15)"}`,
              color: filterOpen ? "#5eead4" : "#e2e8f0", borderRadius: 20, padding: isMobile ? "8px" : "8px 16px", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
              cursor: 'pointer', height: 38, width: isMobile ? 38 : 'auto'
            }}>
            <Layers size={16} /> {!isMobile && "Filters"}
          </button>

          <button onClick={() => { setLegendOpen(o => !o); setFilterOpen(false) }}
            title="Map Legend"
            style={{
              background: legendOpen ? "rgba(20,184,166,0.15)" : "rgba(15,23,42,0.65)",
              backdropFilter: "blur(8px)", border: `1px solid ${legendOpen ? "rgba(20,184,166,0.4)" : "rgba(255,255,255,0.15)"}`,
              color: legendOpen ? "#5eead4" : "#e2e8f0", borderRadius: 20, padding: isMobile ? "8px" : "8px 16px", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
              cursor: 'pointer', height: 38, width: isMobile ? 38 : 'auto'
            }}>
            <MapIcon size={16} /> {!isMobile && "Legend"}
          </button>
        </div>

        {filterOpen && (
          <div style={{
            position: "absolute", top: 128, right: 16,
            background: "rgba(15,23,42,0.98)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "18px 20px", zIndex: 500, minWidth: 240,
            animation: "fadeIn 0.2s ease-out", boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)"
          }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 13, marginBottom: 14, letterSpacing: '0.5px' }}>MAP LAYERS</div>

            <FilterToggle label="Barangay Zones" active={filters.boundaries} color="#3b82f6" icon={<MapIcon size={18} />} onClick={() => toggleFilter('boundaries')} />
            <FilterToggle label="Nearest Truck" active={filters.trucks} color="#14b8a6" icon={<Truck size={18} />} onClick={() => toggleFilter('trucks')} />
            <FilterToggle label="Transfer Stations" active={filters.dumpsites} color="#5dade2" icon={<Trash2 size={18} />} onClick={() => toggleFilter('dumpsites')} />
            <FilterToggle label="Public Hotspots" active={filters.hotspots} color="#ef4444" icon={<AlertTriangle size={18} />} onClick={() => toggleFilter('hotspots')} />
            {user && <FilterToggle label="My Reports" active={filters.myReports} color="#f59e0b" icon={<AlertTriangle size={18} />} onClick={() => toggleFilter('myReports')} />}
          </div>
        )}

        {legendOpen && (
          <div style={{
            position: "absolute", top: 128, right: 16,
            background: "rgba(15,23,42,0.98)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "18px 20px", zIndex: 500, minWidth: 240,
            animation: "fadeIn 0.2s ease-out", boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)"
          }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 13, marginBottom: 14, letterSpacing: '0.5px' }}>LEGEND</div>
            {[
              { icon: <MapIcon size={18} />, label: "Barangay Zone" },
              { icon: <Truck size={18} />, label: "Nearest Truck" },
              { icon: <Trash2 size={18} />, label: "Transfer Station" },
              { icon: <AlertTriangle size={18} />, label: "Reported Garbage" },
            ].map(r => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', color: "#94a3b8" }}>{r.icon}</div>
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{r.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* MAP SUMMARY */}
        {!selected && (
          <div style={{
            position: "absolute", bottom: 24, left: 16, zIndex: 400,
            background: "rgba(15,23,42,0.85)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "12px 16px",
            backdropFilter: "blur(12px)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
          }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 12, letterSpacing: '0.5px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layers size={14} color="#14b8a6" />
                CITY SUMMARY
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#10b981', fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 4px #10b981' }} />
                LIVE
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 150 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Public Hotspots:</span>
                <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{hotspots.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Active Trucks:</span>
                <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{trucks.length}</span>
              </div>
            </div>
          </div>
        )}

        {/* Recenter button */}
        <button onClick={recenter} title="Recenter on my location" style={{
          position: 'absolute', bottom: selected ? (isPanelCollapsed ? 120 : 380) : 100, right: 16, zIndex: 400,
          width: 44, height: 44, borderRadius: '50%', background: 'rgba(15,23,42,0.85)',
          border: '1px solid rgba(255,255,255,0.15)', color: '#93c5fd', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(10px)',
          transition: 'bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
          <Navigation2 size={18} />
        </button>

        {/* Top status cards */}
        <div style={{
          position: 'absolute', top: 132, left: 16, zIndex: 400,
          display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', maxWidth: 'calc(100vw - 32px)',
          pointerEvents: 'none'
        }}>
          {locError && (
            <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', borderRadius: 12, padding: '8px 16px', fontSize: 12, backdropFilter: 'blur(8px)', pointerEvents: 'auto' }}>
              {locError}
            </div>
          )}
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start', pointerEvents: 'auto'
          }}>
            {filters.trucks && (
              <StatusChip
                icon={<Truck size={14} />}
                label={isMobile ? null : (nearestTruck ? `Nearest truck: ${nearestTruck.distanceKm.toFixed(1)} km` : (isTracking ? 'No active trucks nearby' : 'Locating…'))}
                title={nearestTruck ? `Nearest truck: ${nearestTruck.distanceKm.toFixed(1)} km` : (isTracking ? 'No active trucks nearby' : 'Locating…')}
                color={nearestTruck ? (TRUCK_STATUS_COLORS[nearestTruck.status] || '#14b8a6') : '#64748b'}
                onClick={nearestTruck ? () => setSelected({ type: 'truck', data: nearestTruck }) : undefined}
              />
            )}
            {filters.dumpsites && (
              <StatusChip
                icon={<Trash2 size={14} />}
                label={isMobile ? null : (nearestDumpsite ? `Nearest dumpsite: ${nearestDumpsite.distanceKm.toFixed(1)} km` : (isTracking ? 'No dumpsites found' : 'Locating…'))}
                title={nearestDumpsite ? `Nearest dumpsite: ${nearestDumpsite.distanceKm.toFixed(1)} km` : (isTracking ? 'No dumpsites found' : 'Locating…')}
                color={nearestDumpsite ? (DUMPSITE_TYPE_META[nearestDumpsite.type]?.color || '#5dade2') : '#64748b'}
                onClick={nearestDumpsite ? () => setSelected({ type: 'dumpsite', data: nearestDumpsite }) : undefined}
              />
            )}
          </div>
        </div>

        {/* Selected marker info panel */}
        {selected && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, background: '#0f172a',
            borderRadius: '24px 24px 0 0', zIndex: 500,
            height: isPanelCollapsed ? 88 : 'auto',
            maxHeight: '60vh', overflowY: isPanelCollapsed ? 'hidden' : 'auto',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.6)', padding: '24px 24px 32px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <div
              onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
              }}
            >
              <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)' }} />
            </div>

            <button onClick={clearZoneSelection} style={{
              position: 'absolute', top: 16, right: 20, background: 'rgba(255,255,255,0.05)', border: 'none', color: '#94a3b8',
              cursor: 'pointer', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}><X size={18} /></button>
            <SelectedPanel
              selected={selected}
              summaryData={barangaySummary}
              barangays={barangaysRef.current}
              zoneStops={zoneStops}
              isCollapsed={isPanelCollapsed}
            />
          </div>
        )}

        {!authLoading && !loadingReports && myReports.length === 0 && !selected && (
          <div style={{
            position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 400, maxWidth: 300,
            background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
            padding: '10px 14px', color: '#94a3b8', fontSize: 11, backdropFilter: 'blur(10px)', textAlign: 'center'
          }}>
            {user ? (
              "You haven't submitted any reports yet."
            ) : (
              <>Sign in to track your own reports on this map. <a href="/login" onClick={e => { e.preventDefault(); navigate('/login') }} style={{ color: '#5eead4', textDecoration: 'none', fontWeight: 600 }}>Sign in</a></>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterToggle({ label, active, color, icon, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
    }}>
      <div style={{ width: 18, height: 18, borderRadius: 4, background: active ? color : 'transparent', border: '1.5px solid', borderColor: active ? color : '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#0f172a', fontWeight: 900 }}>
        {active ? '✓' : ''}
      </div>
      {icon && <div style={{ display: 'flex', color: '#94a3b8' }}>{icon}</div>}
      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>{label}</span>
    </div>
  )
}

function StatusChip({ icon, label, color, title, onClick }) {
  return (
    <div onClick={onClick} title={title} style={{
      display: 'flex', alignItems: 'center', gap: label ? 6 : 0, background: 'rgba(15,23,42,0.85)',
      border: `1px solid ${color}55`, color: '#e2e8f0', borderRadius: label ? 20 : '50%', 
      padding: label ? '6px 12px' : '0', width: label ? 'auto' : 32, height: label ? 'auto' : 32,
      justifyContent: 'center',
      fontSize: 12, fontWeight: 600, backdropFilter: 'blur(8px)', cursor: onClick ? 'pointer' : 'default',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <span style={{ color, display: 'flex' }}>{icon}</span>
      {label}
    </div>
  )
}

function SelectedPanel({ selected, summaryData, barangays, zoneStops, isCollapsed }) {
  const { type, data } = selected

  if (type === 'zone') {
    const summary = summaryData.find(s => s.barangay_name === data.name)
    const djangoBrgy = barangays?.find(b => b.name === data.name)
    const pop = djangoBrgy?.population ? Number(djangoBrgy.population).toLocaleString() : 'Unknown'

    let statusStr = 'No active collection'
    let statusCol = '#64748b'
    if (summary) {
      if (summary.completed_stops >= summary.total_stops && summary.total_stops > 0) {
        statusStr = 'Completed'
        statusCol = '#10b981'
      } else if (summary.is_active) {
        statusStr = `Collecting — ${summary.completed_stops}/${summary.total_stops}`
        statusCol = '#3b82f6'
      }
    }

    return (
      <div style={{ opacity: isCollapsed ? 0.6 : 1, transition: '0.3s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isCollapsed ? 0 : 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
            <MapIcon size={22} />
          </div>
          <div>
            <div style={{ color: 'white', fontWeight: 800, fontSize: 18 }}>{data.name}</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>Zone Insights</div>
          </div>
        </div>

        {!isCollapsed && (
          <>
            <Row label="Collection Status" value={statusStr} color={statusCol} />
            <Row label="Population" value={pop} />

            {zoneStops?.trucks && zoneStops.trucks.length > 0 && (
              <Row label="Active Trucks" value={zoneStops.trucks.length} color="#f59e0b" />
            )}

            {!zoneStops && statusStr !== 'No active collection' && (
              <div style={{ marginTop: 14, color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>
                Loading street-level collection stops...
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  if (type === 'truck') {
    const color = TRUCK_STATUS_COLORS[data.status] || '#64748b'
    const lastUpdate = data.last_update ? new Date(data.last_update).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A'
    return (
      <div style={{ opacity: isCollapsed ? 0.6 : 1, transition: '0.3s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isCollapsed ? 0 : 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}22`, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
            <Truck size={22} />
          </div>
          <div>
            <div style={{ color: 'white', fontWeight: 800, fontSize: 18 }}>Nearest Collection Truck</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>{data.distanceKm.toFixed(2)} km away</div>
          </div>
        </div>
        {!isCollapsed && (
          <>
            <Row label="Status" value={TRUCK_STATUS_LABELS[data.status] || data.status} color={color} />
            <Row label="Last update" value={lastUpdate} />
            <p style={{ color: '#475569', fontSize: 12, marginTop: 14, lineHeight: 1.4 }}>
              For privacy, driver and plate details are not shown on the public map.
            </p>
          </>
        )}
      </div>
    )
  }

  if (type === 'dumpsite') {
    const meta = DUMPSITE_TYPE_META[data.type] || DUMPSITE_TYPE_META.dumpsite
    const capacity = data.fill_percent ?? data.capacity_used ?? data.capacity ?? 0
    return (
      <div style={{ opacity: isCollapsed ? 0.6 : 1, transition: '0.3s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isCollapsed ? 0 : 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: `${meta.color}22`, border: `2px solid ${meta.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color }}>
            <Trash2 size={22} />
          </div>
          <div>
            <div style={{ color: 'white', fontWeight: 800, fontSize: 18 }}>{data.name || meta.label}</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>{data.distanceKm.toFixed(2)} km away</div>
          </div>
        </div>
        {!isCollapsed && (
          <>
            <Row label="Type" value={meta.label} />
            <Row label="Capacity" value={`${capacity}% full`} />
          </>
        )}
      </div>
    )
  }

  // report
  const color = SEVERITY_COLORS[data.severity] || '#f59e0b'
  const typeLabel = TYPE_LABELS[data.issue_type || data.type] || (data.issue_type || data.type)
  const reportedStr = data.created_at || data.reported ? new Date(data.created_at || data.reported).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'
  return (
    <div style={{ opacity: isCollapsed ? 0.6 : 1, transition: '0.3s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isCollapsed ? 0 : 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}22`, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
          <AlertTriangle size={22} />
        </div>
        <div>
          <div style={{ color: 'white', fontWeight: 800, fontSize: 18 }}>{typeLabel}</div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>{reportedStr}</div>
        </div>
      </div>
      {!isCollapsed && (
        <>
          <Row label="Severity" value={data.severity?.toUpperCase()} color={color} />
          <Row label="Status" value={data.status?.toUpperCase()} />
          {(data.description || data.notes) && (
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, color: '#e2e8f0', fontSize: 13, lineHeight: 1.5 }}>
              {data.description || data.notes}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 500 }}>{label}</span>
      <span style={{ color: color || '#f8fafc', fontSize: 14, fontWeight: 600 }}>{value}</span>
    </div>
  )
}