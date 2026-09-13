import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import { useTrucks } from '../../hooks/useTrucks'
import { useUsers } from '../../hooks/useUsers'
import { useDumpsites } from '../../hooks/useDumpsites'
import { useHotspots } from '../../hooks/useHotspots'
import api from '../../api/client'
import { detectConflicts, formatTime12h } from '../../utils/scheduleConflicts'

const LUCENA_CENTER = [13.9373, 121.617]
const HOME_BASE = { lat: 13.9373, lng: 121.617, label: 'City Hall — Home Base' }
const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY || ''

// ── Truck palette (matches index.css vars) ─────────────────────────────────
const TRUCK_COLORS = [
  { color: '#2563EB', bg: '#EFF6FF', label: 'Blue' },
  { color: '#D97706', bg: '#FFFBEB', label: 'Amber' },
  { color: '#7C3AED', bg: '#F5F3FF', label: 'Violet' },
  { color: '#DC2626', bg: '#FEF2F2', label: 'Red' },
  { color: '#0891B2', bg: '#ECFEFF', label: 'Cyan' },
  { color: '#C026D3', bg: '#FDF4FF', label: 'Fuchsia' },
  { color: '#059669', bg: '#ECFDF5', label: 'Emerald' },
  { color: '#EA580C', bg: '#FFF7ED', label: 'Orange' },
]

// Stable color assignment per truck id
const truckColorCache = {}
let truckColorIdx = 0
function getTruckColor(truckId) {
  const key = String(truckId)
  if (!truckColorCache[key]) {
    truckColorCache[key] = TRUCK_COLORS[truckColorIdx % TRUCK_COLORS.length]
    truckColorIdx++
  }
  return truckColorCache[key]
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

async function fetchOrsRoute(coordinates) {
  if (!ORS_API_KEY || coordinates.length < 2) return null
  try {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: ORS_API_KEY },
      body: JSON.stringify({ coordinates, instructions: true }),
    })
    const data = await res.json()
    if (!data.routes?.length) return null
    return data.routes[0]
  } catch (err) { console.warn('[ORS] routing failed:', err); return null }
}

function pointInPolygon(point, vs) {
  const x = point[0], y = point[1]; let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1], xj = vs[j][0], yj = vs[j][1]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

function detectBarangay(lat, lng, geoJson) {
  if (!geoJson?.features) return null
  for (const f of geoJson.features) {
    if (f.geometry.type === 'Polygon') { if (pointInPolygon([lng, lat], f.geometry.coordinates[0])) return f.properties.brgy_name }
    else if (f.geometry.type === 'MultiPolygon') { for (const p of f.geometry.coordinates) { if (pointInPolygon([lng, lat], p[0])) return f.properties.brgy_name } }
  }
  return null
}

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function optimizeStopOrder(origin, stops) {
  if (stops.length <= 2) return stops
  const remaining = [...stops]; const ordered = []; let current = origin
  while (remaining.length > 0) {
    let ni = 0, nd = Infinity
    remaining.forEach((s, i) => { const d = Math.hypot(s.lat - current.lat, s.lng - current.lng); if (d < nd) { nd = d; ni = i } })
    ordered.push(remaining[ni]); current = remaining[ni]; remaining.splice(ni, 1)
  }
  return ordered
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const STEP_LABELS = ['Config', 'Schedule', 'Stops', 'Dumpsite', 'Review']

// ── Minimal SVG icons ──────────────────────────────────────────────────────
const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75, fill = 'none' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block' }}>
    <path d={d} />
  </svg>
)
const IcoTruck = p => <Ico {...p} d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
const IcoUser = p => <Ico {...p} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
const IcoCal = p => <Ico {...p} d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
const IcoClock = p => <Ico {...p} d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM12 6v6l4 2" />
const IcoPin = p => <Ico {...p} d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
const IcoEdit = p => <Ico {...p} d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
const IcoTrash = p => <Ico {...p} d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
const IcoPlus = p => <Ico {...p} d="M12 5v14M5 12h14" />
const IcoRoute = p => <Ico {...p} d="M3 17l4-8 4 4 4-6 4 4" />
const IcoMap = p => <Ico {...p} d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7zM9 4v13M15 7v13" />
const IcoX = p => <Ico {...p} d="M18 6L6 18M6 6l12 12" />
const IcoCheck = p => <Ico {...p} d="M20 6L9 17l-5-5" />
const IcoChevron = p => <Ico {...p} d="M6 9l6 6 6-6" />
const IcoLayers = p => <Ico {...p} d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />

export default function RouteBuilder() {
  const mapRef = useRef(null)
  const mapInst = useRef(null)
  const layersRef = useRef([])
  const orsRouteLayer = useRef(null)
  // All barangay polygons drawn on map (for show-all-dim-unselected mode)
  const allBrgyLayersRef = useRef([])

  const [step, setStep] = useState(0)
  const [mapReady, setMapReady] = useState(false)
  const [toast, setToast] = useState(null)
  const [saved, setSaved] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [activeTab, setActiveTab] = useState('builder')
  const [schedules, setSchedules] = useState([])
  const [schedLoading, setSchedLoading] = useState(false)
  const [barangays, setBarangays] = useState([])
  const [barangayGeo, setBarangayGeo] = useState(null)
  const [calendarEvents, setCalendarEvents] = useState([])
  const [showSchedulesOnCalendar, setShowSchedulesOnCalendar] = useState(true)
  const [showEventModal, setShowEventModal] = useState(false)
  const [newEvent, setNewEvent] = useState({ title: '', date: '', location: '', assigned_to: '' })
  const [calDayModal, setCalDayModal] = useState(null)
  const [calDayExpanded, setCalDayExpanded] = useState(null)
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth())
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())

  // Calendar truck filter — null = show all
  const [calTruckFilter, setCalTruckFilter] = useState(null)

  // List filters
  const [listSearch, setListSearch] = useState('')
  const [listTruckFilter, setListTruckFilter] = useState('')
  const [listDriverFilter, setListDriverFilter] = useState('')
  const [listDayFilter, setListDayFilter] = useState('')
  const [listStatusFilter, setListStatusFilter] = useState('')
  const [listPage, setListPage] = useState(1)

  useEffect(() => {
    setListPage(1)
  }, [listSearch, listTruckFilter, listDriverFilter, listDayFilter, listStatusFilter])

  const [orsData, setOrsData] = useState(null)
  const [orsFetching, setOrsFetching] = useState(false)
  const orsAbortRef = useRef(null)

  const { trucks, loading: trucksLoading, refresh: refreshTrucks } = useTrucks()
  const { drivers, refresh: refreshDrivers } = useUsers()
  const { sites: dumpsites, refresh: refreshDumpsites } = useDumpsites()
  const { items: hotspots, refresh: refreshHotspots } = useHotspots()

  const [editId, setEditId] = useState(null)
  const [truck, setTruck] = useState('')
  const [driver, setDriver] = useState('')
  const [selectedBarangays, setSelectedBarangays] = useState([])
  const [days, setDays] = useState([])
  const [time, setTime] = useState('06:00')
  const [endTime, setEndTime] = useState('14:00')
  const [startPoint, setStartPoint] = useState(HOME_BASE)
  const [universalStart, setUniversalStart] = useState(false)
  const [manualCoords, setManualCoords] = useState({ lat: '', lng: '' })
  const [showManualCoords, setShowManualCoords] = useState(false)
  const [stops, setStops] = useState([])
  const [dumpsite, setDumpsite] = useState('')
  const [addMode, setAddMode] = useState(false)
  const [barangaySearch, setBarangaySearch] = useState('')
  const [barangayDropOpen, setBarangayDropOpen] = useState(false)
  const barangayDropRef = useRef(null)

  const addModeRef = useRef(addMode)
  const stopsRef = useRef(stops)
  const barangaysRef = useRef(barangays)
  const selectedBarangaysRef = useRef(selectedBarangays)
  const barangayGeoRef = useRef(barangayGeo)
  const pendingDeletesRef = useRef({})

  useEffect(() => { addModeRef.current = addMode }, [addMode])
  useEffect(() => { stopsRef.current = stops }, [stops])

  // ── Auto-fill driver when truck selected ─────────────────────────────────
  useEffect(() => {
    if (!truck || trucksLoading) return
    const t = trucks.find(t => String(t.id) === String(truck))
    if (!t) return
    if (t.drivers?.length === 1) {
      setDriver(String(t.drivers[0]))
    } else if (t.drivers?.length > 0 && driver && !t.drivers.includes(parseInt(driver))) {
      setDriver('')
    }
  }, [truck, trucks, trucksLoading])

  // ── Auto-optimize stops by proximity ─────────────────────────────────────
  const prevStopsRef = useRef([])
  useEffect(() => {
    if (stops.length < 3) { prevStopsRef.current = stops; return }
    const posChanged = stops.some((s, i) => { const p = prevStopsRef.current[i]; return !p || p.lat !== s.lat || p.lng !== s.lng }) || stops.length !== prevStopsRef.current.length
    if (!posChanged) return
    const optimized = optimizeStopOrder(startPoint, stops)
    prevStopsRef.current = optimized
    setStops(optimized)
  }, [stops.map(s => `${s.lat},${s.lng}`).join('|'), startPoint.lat, startPoint.lng])

  useEffect(() => { barangaysRef.current = barangays }, [barangays])
  useEffect(() => { selectedBarangaysRef.current = selectedBarangays }, [selectedBarangays])
  useEffect(() => { barangayGeoRef.current = barangayGeo }, [barangayGeo])

  useEffect(() => {
    function handleOutside(e) { if (barangayDropRef.current && !barangayDropRef.current.contains(e.target)) setBarangayDropOpen(false) }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    api.get('/api/barangays/').then(r => setBarangays(r.data)).catch(console.error)
    fetch('/data/lucena_barangays.geojson').then(r => r.json()).then(setBarangayGeo).catch(console.error)
  }, [])

  const fetchSchedules = () => {
    setSchedLoading(true)
    api.get('/api/driver/collection-schedules/').then(r => setSchedules(r.data)).catch(console.error).finally(() => setSchedLoading(false))
  }
  const fetchCalendarEvents = () => { api.get('/api/driver/calendar-events/').then(r => setCalendarEvents(r.data)).catch(console.error) }
  useEffect(() => {
    if (activeTab === 'builder') {
      refreshTrucks()
      refreshDrivers()
      refreshDumpsites()
      refreshHotspots()
    }
    if (activeTab === 'list' || activeTab === 'calendar') { fetchSchedules(); if (activeTab === 'calendar') fetchCalendarEvents() }
  }, [activeTab])

  // ── Load Leaflet ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link)
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = () => setMapReady(true); document.head.appendChild(s)
  }, [])

  // ── Init map ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'builder') return
    if (!mapReady || !mapRef.current) return
    if (mapInst.current) {
      if (mapInst.current.getContainer() !== mapRef.current) { try { mapInst.current.remove() } catch { } mapInst.current = null }
      else return
    }
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    // Light-mode OSM tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    map.on('click', e => {
      if (!addModeRef.current) return
      const { lat, lng } = e.latlng
      const detectedName = detectBarangay(lat, lng, barangayGeoRef.current)

      // Normalize names for robust matching (e.g. Gulang-Gulang vs Gulang-gulang, Kanlurang Mayao vs Mayao Kanluran)
      const matchName = (dbName, geoName) => {
        if (!geoName) return false
        const n1 = dbName.toLowerCase().trim()
        const n2 = geoName.toLowerCase().trim()
        if (n1 === n2) return true
        if (n1 === 'kanlurang mayao' && n2 === 'mayao kanluran') return true
        if (n1 === 'mayao kanluran' && n2 === 'kanlurang mayao') return true
        return false
      }

      if (selectedBarangaysRef.current.length > 0) {
        const matchedBarangay = barangaysRef.current.find(x => matchName(x.name, detectedName))
        if (!matchedBarangay || !selectedBarangaysRef.current.includes(matchedBarangay.id)) { showToast('⛔ Pin is outside the selected barangay area'); return }
      }

      let assignedBarangayId = null
      if (detectedName) {
        const b = barangaysRef.current.find(x => matchName(x.name, detectedName))
        if (b) {
          assignedBarangayId = b.id
          if (!selectedBarangaysRef.current.includes(b.id)) { setSelectedBarangays(prev => [...prev, b.id]); showToast(`📍 Auto-added: ${b.name}`) }
        }
      } else {
        showToast('⚠️ Warning: Stop is not inside any recognized barangay')
      }

      setStops(prev => [...prev, { stop_id: generateUUID(), lat, lng, label: '', barangay_id: assignedBarangayId }]); setAddMode(false)
    })
    mapInst.current = map
    setTimeout(() => { try { map.invalidateSize() } catch { } }, 200)
  }, [mapReady, activeTab])

  useEffect(() => { if (mapInst.current) try { mapInst.current.invalidateSize() } catch { } }, [mapReady, activeTab, showMap])
  useEffect(() => {
    const onResize = () => { if (mapInst.current) try { mapInst.current.invalidateSize() } catch { } }
    window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize)
  }, [])

  const buildOrsCoords = () => {
    const ds = dumpsites.find(d => String(d.id) === String(dumpsite))
    return [startPoint, ...stops, ...(ds ? [{ lat: +ds.latitude, lng: +ds.longitude }] : []), startPoint].map(p => [p.lng, p.lat])
  }

  useEffect(() => {
    if (!mapReady || activeTab !== 'builder') return
    const coords = buildOrsCoords(); if (coords.length < 2) { setOrsData(null); return }
    if (orsAbortRef.current) orsAbortRef.current = false
    const token = {}; orsAbortRef.current = token; setOrsFetching(true)
    fetchOrsRoute(coords).then(route => { if (token !== orsAbortRef.current) return; setOrsData(route); setOrsFetching(false) })
    return () => { orsAbortRef.current = false }
  }, [stops, dumpsite, startPoint, mapReady, activeTab])

  // ── Redraw map layers ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInst.current) return
    const L = window.L, map = mapInst.current

    // Clear previous layers
    layersRef.current.forEach(l => { try { map.removeLayer(l) } catch { } }); layersRef.current = []
    if (orsRouteLayer.current) { try { map.removeLayer(orsRouteLayer.current) } catch { } orsRouteLayer.current = null }
    allBrgyLayersRef.current.forEach(l => { try { map.removeLayer(l) } catch { } }); allBrgyLayersRef.current = []

    const ds = dumpsites.find(d => String(d.id) === String(dumpsite))
    const toLL = ring => ring.map(([lng, lat]) => [lat, lng])

    // ── BARANGAY LAYERS ───────────────────────────────────────────────────
    // Strategy: if barangays selected → draw ALL barangays, dim unselected, highlight selected
    // If none selected → draw nothing (clean map)
    if (barangayGeo && selectedBarangays.length > 0) {
      const selNames = new Set(barangays.filter(b => selectedBarangays.includes(b.id)).map(b => b.name))

      barangayGeo.features.forEach(f => {
        const name = f.properties.brgy_name
        const isSelected = selNames.has(name)
        let polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
          : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : []

        polys.forEach(poly => {
          const latlngs = poly.map(toLL)

          if (isSelected) {
            // Selected: bright green fill + solid border
            const fillLayer = L.polygon(latlngs, {
              color: '#16A34A',
              weight: 2.5,
              opacity: 0.9,
              fillColor: '#16A34A',
              fillOpacity: 0.12,
              interactive: false,
            }).addTo(map)
            fillLayer.bindTooltip(name, {
              permanent: false,
              className: 'leaflet-barangay-tooltip',
              direction: 'center',
            })
            allBrgyLayersRef.current.push(fillLayer)
          } else {
            // Unselected: dark desaturated overlay — darkens the map beneath
            const dimLayer = L.polygon(latlngs, {
              color: '#374151',
              weight: 1,
              opacity: 0.4,
              fillColor: '#1A1F2E',
              fillOpacity: 0.48,
              interactive: false,
            }).addTo(map)
            allBrgyLayersRef.current.push(dimLayer)
          }
        })
      })
    }

    // ── HOME BASE marker ──────────────────────────────────────────────────
    const homeIcon = L.divIcon({
      html: `<div style="background:#fff;border:2.5px solid #16A34A;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 3px 10px rgba(0,0,0,.18);">🏛️</div>`,
      className: '', iconSize: [32, 32], iconAnchor: [16, 16],
    })
    const hm = L.marker([startPoint.lat, startPoint.lng], { icon: homeIcon, draggable: true }).addTo(map)
    hm.bindPopup(`<b>Start</b><br>${startPoint.label}`)
    hm.on('dragend', e => { const { lat, lng } = e.target.getLatLng(); setStartPoint(p => ({ ...p, lat, lng })) })
    layersRef.current.push(hm)

    // ── STOP markers ─────────────────────────────────────────────────────
    stops.forEach((stop, i) => {
      const isNullBarangay = stop.barangay_id === null;
      const borderColor = isNullBarangay ? '#DC2626' : '#16A34A';
      const textColor = isNullBarangay ? '#DC2626' : '#15803D';
      const icon = L.divIcon({
        html: `<div style="background:#fff;border:2.5px solid ${borderColor};border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${textColor};font-family:system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.15);">${i + 1}</div>`,
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      })
      const m = L.marker([stop.lat, stop.lng], { icon, draggable: true }).addTo(map)
      m.bindPopup(`<b>Stop ${i + 1}${stop.label ? ': ' + stop.label : ''}</b><br><span style="font-size:11px;color:#6B7280;">${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}</span>`)
      m.on('dragend', e => {
        const { lat, lng } = e.target.getLatLng()
        const detectedName = detectBarangay(lat, lng, barangayGeoRef.current)
        const b = barangaysRef.current.find(x => x.name === detectedName)
        const newBarangayId = b ? b.id : null
        setStops(p => p.map((s, idx) => idx === i ? { ...s, lat, lng, barangay_id: newBarangayId } : s))
      })
      layersRef.current.push(m)
    })

    // ── DUMPSITE marker ──────────────────────────────────────────────────
    if (ds) {
      const dsIcon = L.divIcon({
        html: `<div style="background:#DC2626;border:2px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 3px 8px rgba(0,0,0,.18);">🏭</div>`,
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      })
      const dm = L.marker([+ds.latitude, +ds.longitude], { icon: dsIcon }).addTo(map)
      dm.bindPopup(`<b>${ds.name}</b>`); layersRef.current.push(dm)
    }

    // ── ROUTE polyline ───────────────────────────────────────────────────
    if (orsData?.geometry) {
      const pts = decodePolyline(orsData.geometry)
      const line = L.polyline(pts, { color: '#16A34A', weight: 4.5, opacity: 0.85 }).addTo(map)
      orsRouteLayer.current = line
      if (step >= 2) map.fitBounds(line.getBounds(), { padding: [48, 48] })
    } else if (stops.length > 0) {
      const allPts = [startPoint, ...stops, ...(ds ? [{ lat: +ds.latitude, lng: +ds.longitude }] : []), startPoint]
      const line = L.polyline(allPts.map(p => [p.lat, p.lng]), { color: '#16A34A', weight: 3, opacity: 0.3, dashArray: '8,6' }).addTo(map)
      layersRef.current.push(line)
      if (step >= 2) map.fitBounds(line.getBounds(), { padding: [48, 48] })
    }
  }, [stops, dumpsite, mapReady, step, startPoint, activeTab, orsData, selectedBarangays, barangayGeo, barangays])

  useEffect(() => { if (!mapInst.current) return; mapInst.current.getContainer().style.cursor = addMode ? 'crosshair' : '' }, [addMode])

  function removeStop(i) { setStops(prev => prev.filter((_, idx) => idx !== i)) }

  const scheduleConflicts = useMemo(() => {
    if (step < 1) return []
    return detectConflicts(
      { truck, driver, days, start_time: time, end_time: endTime, editId },
      schedules
    )
  }, [step, truck, driver, days, time, endTime, editId, schedules])

  function canNext() {
    if (step === 0) return truck && driver && selectedBarangays.length > 0
    if (step === 1) return days.length > 0 && time && endTime && scheduleConflicts.length === 0
    if (step === 2) return stops.length > 0
    if (step === 3) return !!dumpsite
    return true
  }
  function handleCancel() {
    setStep(0); setEditId(null); setTruck(''); setDriver(''); setSelectedBarangays([]); setDays([])
    setStops([]); setDumpsite(''); setSaved(false); setStartPoint(HOME_BASE); setOrsData(null)
    setUniversalStart(false); setManualCoords({ lat: '', lng: '' }); setShowManualCoords(false); setActiveTab('list')
  }
  async function handleSave() {
    try {
      const payload = {
        truck: truck || null,
        driver: driver || null,
        dumpsite: dumpsite || null,
        barangays: selectedBarangays,
        days: days.join(', '),
        start_time: time,
        end_time: endTime,
        waypoints: [startPoint, ...stops],  // now writes to the real JSONField
      }
      if (editId) await api.patch(`/api/driver/collection-schedules/${editId}/`, payload)
      else await api.post('/api/driver/collection-schedules/', payload)

      await refreshTrucks()
      await refreshDrivers()

      setSaved(true)
      showToast(`✅ Route ${editId ? 'updated' : 'saved'}!`)
      setTimeout(() => {
        setStep(0); setEditId(null); setTruck(''); setDriver('')
        setSelectedBarangays([]); setDays([]); setStops([])
        setDumpsite(''); setSaved(false); setStartPoint(HOME_BASE)
        setOrsData(null); setActiveTab('list')
      }, 2000)
    } catch (err) {
      const detail = err.response?.data
      const msg = typeof detail === 'object'
        ? Object.entries(detail)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join(' | ')
        : String(detail || 'Unknown error')
      showToast(`❌ ${msg}`)
      console.error('Save error:', err.response?.status, detail)
    }
  }

  function handleEdit(s) {
    setActiveTab('builder'); setStep(2); setEditId(s.id)
    setTruck(s.truck ? String(s.truck) : '')
    setDriver(s.driver ? String(s.driver) : '')
    setSelectedBarangays(s.barangays || [])
    setDays(s.days ? s.days.split(', ') : [])
    setTime(s.start_time ? s.start_time.slice(0, 5) : '06:00')
    setEndTime(s.end_time ? s.end_time.slice(0, 5) : '14:00')
    setDumpsite(s.dumpsite ? String(s.dumpsite) : '')

    // Use raw waypoints (JSONField), fall back to waypoints_display
    const raw = s.waypoints?.length ? s.waypoints : (s.waypoints_display || [])
    if (raw.length > 0) {
      const wps = raw.map(w => ({ ...w, lat: +w.lat, lng: +w.lng }))
      const sp = wps.shift()
      setStartPoint(sp)
      setStops(wps)
    } else {
      setStartPoint(HOME_BASE)
      setStops([])
    }
    setTimeout(() => { try { mapInst.current?.invalidateSize() } catch { } }, 300)
  }

  function undoDelete(id, item) {
    const t = pendingDeletesRef.current[id]
    if (t) { clearTimeout(t); delete pendingDeletesRef.current[id]; setSchedules(p => [item, ...p]); showToast('↩️ Undone') }
  }
  function handleDelete(s) {
    setSchedules(p => p.filter(x => x.id !== s.id))
    setToast(
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        Route deleted
        <button onClick={() => undoDelete(s.id, s)} style={{ background: 'rgba(217,119,6,0.1)', color: '#D97706', border: '1px solid rgba(217,119,6,0.25)', padding: '3px 10px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Undo</button>
      </span>
    )
    setTimeout(() => setToast(null), 5000)
    const t = setTimeout(async () => { try { await api.delete(`/api/driver/collection-schedules/${s.id}/`) } catch { showToast('❌ Server delete failed') } delete pendingDeletesRef.current[s.id] }, 5000)
    pendingDeletesRef.current[s.id] = t
  }
  const handleCreateEvent = async (e) => {
    e.preventDefault()
    try { await api.post('/api/driver/calendar-events/', newEvent); showToast('✅ Event created!'); setShowEventModal(false); setNewEvent({ title: '', date: '', location: '', assigned_to: '' }); fetchCalendarEvents() }
    catch { showToast('❌ Failed to create event') }
  }
  function openCalDayModal(d, dateStr, cellDayName, daySched, dayEvts) {
    const today = new Date()
    const label = `${today.toLocaleString('default', { month: 'long' })} ${d}, ${today.getFullYear()}`
    setCalDayModal({ d, dateStr, cellDayName, label, routes: daySched, events: dayEvts })
  }

  const selectedDumpsite = dumpsites.find(d => String(d.id) === String(dumpsite))
  const selectedTruck = trucks.find(t => String(t.id) === String(truck))
  const selectedDriverObj = drivers.find(d => String(d.id) === String(driver))
  const orsStats = orsData?.segments?.[0] ? { distKm: (orsData.segments[0].distance / 1000).toFixed(1), durationMin: Math.round(orsData.segments[0].duration / 60) } : null

  // ── Calendar helpers ─────────────────────────────────────────────────────
  // Stable truck → color index mapping for calendar
  const truckColorMap = useCallback(() => {
    const map = {}
    schedules.forEach((s, i) => {
      const key = String(s.truck)
      if (!(key in map)) map[key] = Object.keys(map).length % TRUCK_COLORS.length
    })
    return map
  }, [schedules])

  function getTruckColorIdx(truckId) {
    const map = truckColorMap()
    const idx = map[String(truckId)]
    return idx !== undefined ? idx : 0
  }

  const calNavPrev = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else { setCalMonth(m => m - 1) } }
  const calNavNext = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else { setCalMonth(m => m + 1) } }

  const renderCalendar = () => {
    const today = new Date()
    const cm = calMonth, cy = calYear
    const isCurrentMonth = today.getMonth() === cm && today.getFullYear() === cy
    const dim = new Date(cy, cm + 1, 0).getDate(); const fdom = new Date(cy, cm, 1).getDay()
    const cells = []; for (let i = 0; i < fdom; i++) cells.push(null); for (let i = 1; i <= dim; i++) cells.push(i)
    const dayFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const monthLabel = new Date(cy, cm, 1).toLocaleString('default', { month: 'long', year: 'numeric' })

    // Unique trucks in schedule list
    const uniqueTrucks = []
    const seenTruck = new Set()
    schedules.forEach(s => {
      if (!seenTruck.has(String(s.truck))) {
        seenTruck.add(String(s.truck))
        uniqueTrucks.push({ id: s.truck, plate: s.truck_plate || `Truck ${s.truck}`, colorIdx: getTruckColorIdx(s.truck) })
      }
    })

    return (
      <div className="cal-wrapper">
        {/* Header */}
        <div className="cal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="cal-nav-btn" onClick={calNavPrev}>‹</button>
              <button className="cal-nav-btn" onClick={calNavNext}>›</button>
            </div>
            <span className="cal-month-label">{monthLabel}</span>
            {!isCurrentMonth && (
              <button onClick={() => { setCalMonth(today.getMonth()); setCalYear(today.getFullYear()) }}
                style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-light)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 20, padding: '2px 9px', cursor: 'pointer' }}>
                Today
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)', userSelect: 'none' }}>
              <input type="checkbox" checked={showSchedulesOnCalendar} onChange={e => setShowSchedulesOnCalendar(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />
              Show routes
            </label>
          </div>
        </div>

        {/* Day-of-week headers */}
        <div className="cal-day-header">
          {dayAbbr.map((d, i) => (
            <div key={d} className="cal-day-header-cell">
              <span className="full">{d}</span>
              <span className="short">{dayShort[i]}</span>
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="cal-grid">
          {cells.map((d, cellIdx) => {
            if (!d) return <div key={cellIdx} className="cal-cell empty" />
            const isToday = isCurrentMonth && d === today.getDate()
            const cellDayName = dayFull[new Date(cy, cm, d).getDay()]
            const dateStr = `${cy}-${String(cm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const daySched = showSchedulesOnCalendar
              ? schedules.filter(s => {
                const dayMatch = s.days?.includes(cellDayName)
                const truckMatch = calTruckFilter === null || String(s.truck) === String(calTruckFilter)
                return dayMatch && truckMatch
              })
              : []
            const dayEvts = calendarEvents.filter(e => e.date === dateStr)
            const total = daySched.length + dayEvts.length

            const cellStyle = dayEvts.length > 0 ? { background: '#FFFBEB', borderColor: '#FDE68A' } : {}

            return (
              <div
                key={cellIdx}
                className={`cal-cell${isToday ? ' today' : ''}`}
                style={cellStyle}
                onClick={() => openCalDayModal(d, dateStr, cellDayName, daySched, dayEvts)}
              >
                {/* Date row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span className="cal-date-num">{d}</span>
                  {total > 0 && <span className="cal-count">{total}</span>}
                </div>

                {/* Event chips (hidden on mobile → dots shown instead) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {daySched.slice(0, 2).map(s => {
                    const ci = getTruckColorIdx(s.truck)
                    const tc = TRUCK_COLORS[ci]
                    return (
                      <div key={'s' + s.id} className="cal-event-chip"
                        style={{ background: tc.bg, borderLeftColor: tc.color, color: tc.color }}>
                        <IcoTruck size={7} color={tc.color} />
                        <span>{s.barangay_names || s.truck_plate}</span>
                      </div>
                    )
                  })}
                  {dayEvts.slice(0, 1).map(ev => (
                    <div key={'e' + ev.id} className="cal-event-chip event-type">
                      <IcoCal size={7} color="#D97706" />
                      <span>{ev.title}</span>
                    </div>
                  ))}
                  {total > 3 && <span className="cal-more-link">+{total - 3} more</span>}
                </div>

                {/* Dots (mobile only) */}
                <div className="cal-dots-row">
                  {daySched.map(s => {
                    const tc = TRUCK_COLORS[getTruckColorIdx(s.truck)]
                    return <div key={'dot' + s.id} className="cal-dot-sm" style={{ background: tc.color }} />
                  })}
                  {dayEvts.map(ev => <div key={'dot' + ev.id} className="cal-dot-sm" style={{ background: '#D97706' }} />)}
                </div>
              </div>
            )
          })}
        </div>

        {/* Truck legend + filter */}
        <div className="cal-legend">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
            <IcoLayers size={13} color="var(--text-muted)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Filter</span>
          </div>

          {/* All trucks */}
          <button
            className={`cal-legend-item${calTruckFilter === null ? ' active' : ''}`}
            style={calTruckFilter === null ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
            onClick={() => setCalTruckFilter(null)}
          >
            <div className="cal-legend-dot" style={{ background: 'var(--accent)' }} />
            All routes
          </button>

          {/* Per-truck */}
          {uniqueTrucks.map(t => {
            const tc = TRUCK_COLORS[t.colorIdx]
            const isActive = String(calTruckFilter) === String(t.id)
            return (
              <button key={t.id}
                className={`cal-legend-item${isActive ? ' active' : ''}`}
                style={isActive ? { borderColor: tc.color, color: tc.color } : { color: tc.color }}
                onClick={() => setCalTruckFilter(isActive ? null : t.id)}
              >
                <div className="cal-legend-dot" style={{ background: tc.color }} />
                {t.plate}
              </button>
            )
          })}

          {/* Calendar events */}
          <button className="cal-legend-item" style={{ color: '#D97706', borderColor: 'transparent' }}>
            <div className="cal-legend-dot" style={{ background: '#D97706' }} />
            Events
          </button>

          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <IcoPin size={11} color="var(--text-light)" /> Tap a date for details
          </span>
        </div>
      </div>
    )
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const css = `
    @keyframes rbFadeUp  { from { opacity:0; transform:translateY(5px) } to { opacity:1; transform:translateY(0) } }
    @keyframes rbModalIn { from { opacity:0; transform:scale(.97) translateY(6px) } to { opacity:1; transform:scale(1) translateY(0) } }
    @keyframes rbSpin    { to { transform:rotate(360deg) } }
    @keyframes rbToastIn { from { opacity:0; transform:translateX(-50%) translateY(-10px) } to { opacity:1; transform:translateX(-50%) translateY(0) } }

    /* ── Page layout ── */
    .rb-page { padding: 24px; max-width: 1280px; margin: 0 auto; }

    /* ── Tabs ── */
    .rb-tabs { display:flex; background:var(--surface-2); padding:4px; border-radius:10px; gap:2px; border:1px solid var(--border); overflow-x:auto; scrollbar-width:none; }
    .rb-tabs::-webkit-scrollbar { display:none; }
    .rb-tab { padding:7px 15px; border-radius:8px; border:none; font-size:12px; font-weight:600; cursor:pointer; transition:all .14s; white-space:nowrap; font-family:var(--font-body); }
    .rb-tab.active { background:var(--surface); color:var(--text); box-shadow:var(--shadow-sm); }
    .rb-tab:not(.active) { background:transparent; color:var(--text-muted); }
    .rb-tab:not(.active):hover { color:var(--text); background:rgba(0,0,0,.03); }

    /* ── Stepper ── */
    .rb-stepper { display:flex; align-items:center; gap:0; margin-bottom:22px; overflow-x:auto; scrollbar-width:none; padding-bottom:4px; }
    .rb-stepper::-webkit-scrollbar { display:none; }
    .rb-step { display:flex; flex-direction:column; align-items:center; gap:5px; cursor:pointer; flex-shrink:0; }
    .rb-step-dot { width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; transition:all .2s; border:2px solid; }
    .rb-step-dot.done    { background:var(--accent); border-color:var(--accent); color:#fff; }
    .rb-step-dot.active  { background:#fff; border-color:var(--accent); color:var(--accent); box-shadow:0 0 0 4px rgba(22,163,74,.1); }
    .rb-step-dot.pending { background:var(--surface-2); border-color:var(--border-2); color:var(--text-muted); }
    .rb-step-label { font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }
    .rb-step-conn { height:2px; width:28px; margin:0 4px; margin-bottom:16px; flex-shrink:0; border-radius:1px; transition:background .2s; }

    /* ── Builder grid ── */
    .rb-builder-grid { display:grid; grid-template-columns:1fr 360px; gap:18px; align-items:start; }
    .rb-map-wrap { position:relative; border-radius:14px; overflow:hidden; height:560px; background:var(--surface-2); border:1px solid var(--border); box-shadow:var(--shadow-sm); }
    .rb-map-toggle { display:none; }

    /* ── Panel card ── */
    .rb-panel { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:20px; box-shadow:var(--shadow-sm); animation:rbFadeUp .18s; }
    .rb-panel-title { font-family:var(--font-head); font-size:15px; font-weight:700; color:var(--text); margin:0 0 2px; }
    .rb-panel-sub   { font-size:12px; color:var(--text-muted); margin:0 0 18px; }

    /* ── Form ── */
    .rb-label { display:block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--text-muted); margin-bottom:5px; }
    .rb-input, .rb-select { width:100%; background:var(--surface); border:1.5px solid var(--border); border-radius:9px; padding:9px 12px; font-size:13px; color:var(--text); transition:border-color .14s,box-shadow .14s; outline:none; box-sizing:border-box; font-family:var(--font-body); box-shadow:var(--shadow-xs); }
    .rb-input:focus, .rb-select:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(22,163,74,.1); }
    .rb-input::placeholder { color:var(--text-light); }
    .rb-select option { background:#fff; color:var(--text); }

    /* ── Chip ── */
    .rb-chip { display:inline-flex; align-items:center; gap:5px; background:var(--accent-light); color:var(--accent-dim); border:1px solid rgba(22,163,74,.25); border-radius:20px; padding:3px 10px 3px 12px; font-size:11px; font-weight:600; white-space:nowrap; }
    .rb-chip-x { cursor:pointer; opacity:.6; font-size:14px; line-height:1; padding:0 1px; transition:opacity .1s; }
    .rb-chip-x:hover { opacity:1; }

    /* ── Day pills ── */
    .rb-day-pill { padding:5px 12px; border-radius:20px; border:1.5px solid var(--border); font-size:12px; font-weight:600; cursor:pointer; transition:all .13s; background:transparent; color:var(--text-muted); font-family:var(--font-body); }
    .rb-day-pill.on { background:var(--accent-light); border-color:var(--accent); color:var(--accent-dim); font-weight:700; }
    .rb-day-pill:hover:not(.on) { border-color:var(--border-2); color:var(--text); }

    /* ── Stat tiles ── */
    .rb-stat { flex:1; background:var(--surface-2); border-radius:9px; padding:10px 12px; text-align:center; border:1px solid var(--border); }
    .rb-stat-val { font-size:15px; font-weight:800; color:var(--accent); }
    .rb-stat-lbl { font-size:9px; color:var(--text-muted); margin-top:1px; text-transform:uppercase; letter-spacing:.05em; }

    /* ── Stop row ── */
    .rb-stop-row { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--border); }
    .rb-stop-num { width:24px; height:24px; border-radius:50%; background:#fff; border:2px solid var(--accent); display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; color:var(--accent); flex-shrink:0; box-shadow:var(--shadow-xs); }

    /* ── Dumpsite card ── */
    .rb-ds-card { border-radius:10px; padding:13px 14px; margin-bottom:9px; display:flex; align-items:center; gap:12px; cursor:pointer; transition:all .13s; border:1.5px solid var(--border); background:var(--surface); }
    .rb-ds-card:hover { border-color:rgba(220,38,38,.35); background:rgba(220,38,38,.03); }
    .rb-ds-card.sel { border-color:#DC2626; background:rgba(220,38,38,.06); }

    /* ── Buttons ── */
    .rb-btn-primary { background:var(--accent); color:#fff; border:none; border-radius:9px; padding:9px 17px; font-size:13px; font-weight:600; cursor:pointer; transition:all .14s; display:inline-flex; align-items:center; gap:6px; font-family:var(--font-body); box-shadow:0 1px 3px rgba(22,163,74,.25); }
    .rb-btn-primary:hover { background:var(--accent-dim); }
    .rb-btn-primary:active { transform:scale(.97); }
    .rb-btn-primary:disabled { opacity:.35; cursor:not-allowed; transform:none; }
    .rb-btn-ghost { background:var(--surface-2); color:var(--text-muted); border:1px solid var(--border); border-radius:9px; padding:9px 17px; font-size:13px; font-weight:600; cursor:pointer; transition:all .14s; font-family:var(--font-body); }
    .rb-btn-ghost:hover { color:var(--text); border-color:var(--border-2); background:var(--surface-3); }
    .rb-btn-sm { padding:6px 12px; font-size:12px; border-radius:8px; }
    .rb-btn-edit  { background:rgba(37,99,235,.06); color:#2563EB; border:1px solid rgba(37,99,235,.2); border-radius:7px; padding:5px 11px; font-size:11px; font-weight:600; cursor:pointer; transition:all .13s; display:inline-flex; align-items:center; gap:5px; font-family:var(--font-body); }
    .rb-btn-edit:hover { background:rgba(37,99,235,.12); }
    .rb-btn-del   { background:rgba(220,38,38,.06); color:#DC2626; border:1px solid rgba(220,38,38,.18); border-radius:7px; padding:5px 11px; font-size:11px; font-weight:600; cursor:pointer; transition:all .13s; display:inline-flex; align-items:center; gap:5px; font-family:var(--font-body); }
    .rb-btn-del:hover { background:rgba(220,38,38,.12); }

    /* ── Table ── */
    .rb-tbl-row  { display:flex; flex-direction:column; gap:14px; padding:18px 20px; border-bottom:1px solid var(--border); transition:background .12s; }
    .rb-tbl-row:last-child { border-bottom:none; }
    .rb-tbl-row:hover { background:var(--surface-2); }

    /* ── Badge tiny ── */
    .rb-badge { font-size:10px; font-weight:800; background:linear-gradient(135deg, #22c55e 0%, #15803d 100%); color:#fff; border-radius:6px; padding:3px 8px; box-shadow:0 2px 4px rgba(22,163,74,.15); text-shadow:0 1px 1px rgba(0,0,0,.15); }

    /* ── Dropdown ── */
    .rb-dropdown { position:absolute; top:calc(100% + 5px); left:0; right:0; z-index:800; background:var(--surface); border:1px solid var(--border); border-radius:10px; max-height:200px; overflow-y:auto; box-shadow:var(--shadow-lg); }
    .rb-dropdown-item { display:flex; align-items:center; gap:10px; padding:9px 13px; cursor:pointer; font-size:12px; font-weight:500; color:var(--text); transition:background .1s; }
    .rb-dropdown-item:hover { background:var(--surface-2); }
    .rb-dropdown-item.on { background:rgba(22,163,74,.06); color:var(--accent-dim); font-weight:700; }

    /* ── Map overlays ── */
    .rb-map-legend { position:absolute; bottom:14px; left:14px; z-index:400; background:rgba(255,255,255,.94); backdrop-filter:blur(6px); border-radius:10px; padding:9px 13px; border:1px solid var(--border); font-size:11px; color:var(--text-muted); box-shadow:var(--shadow-sm); }
    .rb-ors-pill { display:inline-flex; align-items:center; gap:5px; position:absolute; top:12px; right:52px; z-index:400; background:rgba(255,255,255,.92); backdrop-filter:blur(4px); border-radius:20px; padding:4px 11px; font-size:10px; font-weight:700; letter-spacing:.04em; border:1px solid var(--border); box-shadow:var(--shadow-xs); color:var(--text-muted); }
    .rb-add-btn { position:absolute; top:12px; left:12px; z-index:400; border-radius:9px; padding:7px 13px; font-weight:700; font-size:12px; cursor:pointer; transition:all .13s; border:1.5px solid; font-family:var(--font-body); }

    /* ── Toast ── */
    .rb-toast { position:fixed; top:70px; left:50%; transform:translateX(-50%); background:var(--surface); color:var(--text); padding:10px 20px; border-radius:10px; z-index:9999; font-size:13px; font-weight:600; border:1px solid var(--border); white-space:nowrap; animation:rbToastIn .2s; box-shadow:var(--shadow-lg); }

    /* ── Info row ── */
    .rb-info-row { display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--border); gap:8px; }

    /* ── Alerts ── */
    .rb-alert-badge { display:inline-flex; align-items:center; gap:5px; background:rgba(217,119,6,.08); color:#D97706; border:1px solid rgba(217,119,6,.25); border-radius:12px; padding:2px 8px; font-size:9px; font-weight:800; letter-spacing:.04em; }
    .rb-alert-dot { width:5px; height:5px; border-radius:50%; background:#D97706; animation:rbPulseAlert 2s infinite ease-in-out; }
    @keyframes rbPulseAlert { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.3); } }
    .rb-info-key { font-size:10px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.06em; flex-shrink:0; }
    .rb-info-val { font-size:12px; font-weight:600; color:var(--text); text-align:right; }

    /* ── Autofill badge ── */
    .rb-autofill { display:inline-flex; align-items:center; gap:5px; background:var(--accent-light); color:var(--accent-dim); border-radius:6px; padding:2px 8px; font-size:10px; font-weight:700; letter-spacing:.04em; animation:rbFadeUp .18s; }

    /* ── Spinner ── */
    .rb-spinner { width:10px; height:10px; border-radius:50%; border:2px solid var(--border); border-top-color:var(--accent); animation:rbSpin .75s linear infinite; flex-shrink:0; }

    /* ── Modal overlay ── */
    .rb-modal-ov { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:9998; display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(3px); }
    .rb-modal    { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:24px; width:100%; max-width:440px; max-height:85vh; overflow-y:auto; animation:rbModalIn .18s; box-shadow:var(--shadow-lg); }
    .rb-modal::-webkit-scrollbar { width:4px; }
    .rb-modal::-webkit-scrollbar-thumb { background:var(--border-2); border-radius:2px; }

    /* ── Geofence notice ── */
    .rb-geo-notice { display:flex; align-items:center; gap:8px; padding:8px 11px; background:rgba(22,163,74,.05); border:1px solid rgba(22,163,74,.18); border-radius:9px; font-size:11px; color:var(--text-muted); }

    /* ── Empty state ── */
    .rb-empty { padding:56px 24px; text-align:center; }
    .rb-empty-title { font-size:14px; font-weight:700; color:var(--text-muted); margin:12px 0 4px; }
    .rb-empty-sub   { font-size:12px; color:var(--text-light); }

    /* ── Mobile list ── */
    .rb-list-desktop { display:block; }
    .rb-list-mobile  { display:none; }

    /* ── Review path ── */
    .rb-path { background:var(--surface-2); border-radius:10px; padding:11px 13px; font-size:11px; color:var(--text-muted); line-height:2; border:1px solid var(--border); }

    /* ── Checkbox ── */
    .rb-check { display:flex; align-items:center; gap:7px; cursor:pointer; user-select:none; font-size:11px; color:var(--text-muted); }
    .rb-check input { accent-color:var(--accent); width:13px; height:13px; cursor:pointer; }

    /* ── Cal day header responsive ── */
    .cal-day-header-cell .short { display:none; }
    .cal-day-header-cell .full  { display:inline; }

    /* ── Calendar wrapper ── */
    .cal-wrapper { background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; box-shadow:var(--shadow-sm); }

    /* ── Calendar header ── */
    .cal-header { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid var(--border); gap:10px; flex-wrap:wrap; }
    .cal-month-label { font-family:var(--font-head); font-size:16px; font-weight:800; color:var(--text); }
    .cal-nav-btn { width:30px; height:30px; border-radius:8px; border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .12s; line-height:1; }
    .cal-nav-btn:hover { background:var(--surface-3); border-color:var(--border-2); }

    /* ── Calendar day-of-week header ── */
    .cal-day-header { display:grid; grid-template-columns:repeat(7,1fr); border-bottom:1px solid var(--border); }
    .cal-day-header-cell { text-align:center; padding:9px 4px; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--text-muted); }

    /* ── Calendar grid ── */
    .cal-grid { display:grid; grid-template-columns:repeat(7,1fr); }
    .cal-cell { min-height:88px; padding:7px 6px 5px; border-right:1px solid var(--border); border-bottom:1px solid var(--border); cursor:pointer; transition:background .12s; position:relative; }
    .cal-cell:nth-child(7n) { border-right:none; }
    .cal-cell.empty { background:var(--surface-2); cursor:default; }
    .cal-cell:hover:not(.empty) { background:rgba(22,163,74,.03); }
    .cal-cell.today { background:rgba(22,163,74,.04); }
    .cal-cell.today .cal-date-num { background:var(--accent); color:#fff; }

    /* ── Date number badge ── */
    .cal-date-num { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; font-size:12px; font-weight:700; color:var(--text); }

    /* ── Event count badge ── */
    .cal-count { font-size:9px; font-weight:800; background:var(--accent); color:#fff; border-radius:20px; padding:1px 5px; line-height:1.4; }

    /* ── Event chips ── */
    .cal-event-chip { display:flex; align-items:center; gap:3px; font-size:9px; font-weight:700; border-radius:3px; padding:2px 5px; border-left:2px solid; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .cal-event-chip.event-type { background:#FEF3C7; border-left-color:#D97706; color:#92400E; }
    .cal-more-link { font-size:9px; font-weight:700; color:var(--text-muted); padding-left:2px; }

    /* ── Mobile dots ── */
    .cal-dots-row { display:none; flex-wrap:wrap; gap:3px; margin-top:4px; }
    .cal-dot-sm { width:5px; height:5px; border-radius:50%; }

    /* ── Legend ── */
    .cal-legend { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:10px 16px; border-top:1px solid var(--border); background:var(--surface-2); }
    .cal-legend-item { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; color:var(--text-muted); background:var(--surface); border:1px solid transparent; border-radius:20px; padding:3px 10px; cursor:pointer; transition:all .12s; }
    .cal-legend-item:hover { border-color:var(--border-2); color:var(--text); }
    .cal-legend-item.active { border-color:currentColor; }
    .cal-legend-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }

    @media (max-width:900px) {
      .rb-builder-grid { grid-template-columns:1fr; }
      .rb-map-wrap { height:300px; display:none; }
      .rb-map-wrap.vis { display:block; }
      .rb-map-toggle { display:flex; width:100%; align-items:center; justify-content:center; gap:8px; padding:10px; margin-bottom:12px; border-radius:10px; border:1px solid var(--border); background:var(--surface); font-size:13px; font-weight:600; color:var(--text); cursor:pointer; }
      .rb-step-label { display:none; }
      .rb-step-conn { width:16px !important; }
      .cal-cell { min-height:60px; }
      .cal-event-chip { display:none; }
      .cal-dots-row { display:flex; }
    }
    @media (max-width:680px) {
      .rb-list-desktop { display:none !important; }
      .rb-list-mobile  { display:flex !important; }
    }
    @media (max-width:480px) {
      .cal-day-header-cell .short { display:inline; }
      .cal-day-header-cell .full  { display:none; }
      .cal-cell { min-height:48px; padding:4px 3px; }
      .cal-date-num { width:18px; height:18px; font-size:10px; }
    }
  `

  return (
    <DashboardLayout>
      <style>{css}</style>

      {/* Toast */}
      {toast && <div className="rb-toast">{toast}</div>}

      <div className="rb-page">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)', fontFamily: 'var(--font-head)', letterSpacing: '-.02em' }}>Route Management</h2>
              <span style={{ background: 'var(--accent-light)', color: 'var(--accent-dim)', border: '1px solid rgba(22,163,74,.2)', fontSize: 9, fontWeight: 800, padding: '3px 9px', borderRadius: 20, letterSpacing: '.06em' }}>ADMIN</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Build and manage garbage collection schedules and routes.</p>
          </div>
          <div className="rb-tabs">
            {[{ key: 'builder', label: 'Build Route' }, { key: 'list', label: 'Scheduled Routes' }, { key: 'calendar', label: 'Calendar' }].map(t => (
              <button key={t.key} className={`rb-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* ══ BUILDER ══════════════════════════════════════════════════════ */}
        {activeTab === 'builder' && (
          <>
            {/* Stepper */}
            <div className="rb-stepper">
              {STEP_LABELS.map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <div className="rb-step" onClick={() => i < step && setStep(i)} title={label}>
                    <div className={`rb-step-dot ${i < step ? 'done' : i === step ? 'active' : 'pending'}`}>
                      {i < step ? <IcoCheck size={13} color="#fff" sw={2.5} /> : <span>{i + 1}</span>}
                    </div>
                    <span className="rb-step-label" style={{ color: i <= step ? 'var(--accent)' : 'var(--text-muted)' }}>{label}</span>
                  </div>
                  {i < STEP_LABELS.length - 1 && (
                    <div className="rb-step-conn" style={{ background: i < step ? 'var(--accent)' : 'var(--border)' }} />
                  )}
                </div>
              ))}
            </div>

            {/* Mobile map toggle */}
            <button className="rb-map-toggle" onClick={() => { setShowMap(v => !v); setTimeout(() => { try { mapInst.current?.invalidateSize() } catch { } }, 50) }}>
              <IcoMap size={14} color="var(--text-muted)" />
              {showMap ? 'Hide Map' : 'Show Map'}
              {orsFetching && <div className="rb-spinner" style={{ marginLeft: 4 }} />}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{showMap ? '▲' : '▼'}</span>
            </button>

            <div className="rb-builder-grid">

              {/* MAP */}
              <div className={`rb-map-wrap${showMap ? ' vis' : ''}`}>
                <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                {!mapReady && (
                  <div style={{ position: 'absolute', inset: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="rb-spinner" /><span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>Loading Map…</span>
                    </div>
                  </div>
                )}
                {stops.length > 0 && (
                  <div className="rb-ors-pill">
                    {orsFetching
                      ? <><div className="rb-spinner" style={{ borderTopColor: 'var(--warning)' }} /> Routing…</>
                      : orsData
                        ? <><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} /> Road route</>
                        : <><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-light)', display: 'inline-block' }} /> Straight line</>
                    }
                  </div>
                )}
                {/* Map legend */}
                <div className="rb-map-legend">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>🏛️ <span>Start</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', border: '2px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontSize: 8, fontWeight: 800 }}>1</div>
                    <span>Stop</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>🏭 <span>Dumpsite</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ width: 18, height: 2, background: 'var(--accent)', borderRadius: 1 }} /><span>Route</span>
                  </div>
                  {selectedBarangays.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 14, height: 9, border: '1.5px solid var(--accent)', borderRadius: 2, background: 'rgba(22,163,74,.1)' }} />
                      <span>Selected zone</span>
                    </div>
                  )}
                  {selectedBarangays.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <div style={{ width: 14, height: 9, borderRadius: 2, background: 'rgba(26,31,46,.45)', border: '1px solid #374151' }} />
                      <span>Dimmed areas</span>
                    </div>
                  )}
                </div>
                {step === 2 && (
                  <button className="rb-add-btn" onClick={() => setAddMode(a => !a)}
                    style={{ background: addMode ? '#D97706' : 'rgba(255,255,255,.92)', color: addMode ? '#fff' : 'var(--accent)', borderColor: addMode ? '#D97706' : 'rgba(22,163,74,.4)', backdropFilter: 'blur(4px)' }}>
                    {addMode ? '✕ Click map to add stop' : '+ Add Stop'}
                  </button>
                )}
              </div>

              {/* SIDE PANEL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>

                {/* Step 0 — Config */}
                {step === 0 && (
                  <div className="rb-panel">
                    <p className="rb-panel-title">Truck & Driver</p>
                    <p className="rb-panel-sub">Assign a vehicle and driver to this route.</p>

                    <div style={{ marginBottom: 13 }}>
                      <label className="rb-label">Truck</label>
                      <select className="rb-select" value={truck} onChange={e => setTruck(e.target.value)}>
                        <option value="">— Select truck —</option>
                        {trucks.map(t => <option key={t.id} value={t.id}>{t.plate_number} · {t.model}</option>)}
                      </select>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <label className="rb-label" style={{ margin: 0 }}>Driver</label>
                        {truck && selectedDriverObj && <span className="rb-autofill"><IcoCheck size={10} color="var(--accent-dim)" sw={2.5} /> Auto-filled</span>}
                      </div>
                      <select className="rb-select" value={driver} onChange={e => setDriver(e.target.value)}>
                        <option value="">— Select driver —</option>
                        {drivers
                          .filter(d => {
                            if (!truck) return true; // Show all if no truck selected
                            const t = trucks.find(tObj => String(tObj.id) === String(truck));
                            if (!t) return true;
                            // Only allow the drivers assigned to the selected truck
                            return t.drivers?.includes(d.id);
                          })
                          .map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)
                        }
                      </select>
                      {truck && !selectedDriverObj && <p style={{ margin: '5px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>No assigned driver — select manually or assign in Truck Management.</p>}
                    </div>

                    <div ref={barangayDropRef} style={{ position: 'relative' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <label className="rb-label" style={{ margin: 0 }}>Barangays</label>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>Auto-detected · Geofenced</span>
                      </div>
                      <div onClick={() => setBarangayDropOpen(v => !v)} style={{ minHeight: 40, background: 'var(--surface)', border: `1.5px solid ${barangayDropOpen ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 9, padding: '5px 9px', cursor: 'text', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', transition: 'border-color .14s', boxShadow: 'var(--shadow-xs)' }}>
                        {barangays.filter(b => selectedBarangays.includes(b.id)).map(b => (
                          <span key={b.id} className="rb-chip">
                            {b.name}
                            <span className="rb-chip-x" onClick={e => { e.stopPropagation(); setSelectedBarangays(p => p.filter(x => x !== b.id)) }}>×</span>
                          </span>
                        ))}
                        <input value={barangaySearch} onChange={e => { setBarangaySearch(e.target.value); setBarangayDropOpen(true) }}
                          onFocus={() => setBarangayDropOpen(true)} onClick={e => e.stopPropagation()}
                          placeholder={selectedBarangays.length === 0 ? 'Search barangays…' : ''}
                          style={{ flex: 1, minWidth: 90, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 12, padding: '2px 4px' }} />
                        <IcoChevron size={12} color="var(--text-muted)" />
                      </div>
                      {barangayDropOpen && (
                        <div className="rb-dropdown">
                          {barangays.filter(b => b.name.toLowerCase().includes(barangaySearch.toLowerCase())).map(b => {
                            const on = selectedBarangays.includes(b.id)
                            return (
                              <div key={b.id} className={`rb-dropdown-item${on ? ' on' : ''}`} onClick={() => { setSelectedBarangays(p => on ? p.filter(x => x !== b.id) : [...p, b.id]); setBarangaySearch('') }}>
                                <div style={{ width: 15, height: 15, borderRadius: 4, border: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  {on && <span style={{ color: '#fff', fontSize: 9, fontWeight: 900 }}>✓</span>}
                                </div>
                                {b.name}
                              </div>
                            )
                          })}
                          {barangays.filter(b => b.name.toLowerCase().includes(barangaySearch.toLowerCase())).length === 0 && (
                            <div style={{ padding: '13px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No results</div>
                          )}
                        </div>
                      )}
                    </div>

                    {selectedBarangays.length > 0 && (
                      <div className="rb-geo-notice" style={{ marginTop: 10 }}>
                        <div style={{ width: 13, height: 8, border: '1.5px solid var(--accent)', borderRadius: 2, background: 'rgba(22,163,74,.1)', flexShrink: 0 }} />
                        Geofence active — stops outside selected zones blocked. Unselected areas dimmed on map.
                      </div>
                    )}

                    {truck && driver && selectedBarangays.length > 0 && (
                      <div style={{ marginTop: 13, background: 'rgba(22,163,74,.05)', border: '1px solid rgba(22,163,74,.18)', borderRadius: 10, padding: '11px 13px' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>{selectedTruck?.plate_number} — {selectedTruck?.model}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 1 }}>Driver: {selectedDriverObj?.full_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Zones: {barangays.filter(b => selectedBarangays.includes(b.id)).map(b => b.name).join(', ')}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 1 — Schedule */}
                {step === 1 && (
                  <div className="rb-panel">
                    <p className="rb-panel-title">Schedule</p>
                    <p className="rb-panel-sub">Set collection days and operating hours.</p>
                    <label className="rb-label">Collection Days</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                      {DAYS.map(d => (
                        <button key={d} className={`rb-day-pill${days.includes(d) ? ' on' : ''}`} onClick={() => setDays(p => days.includes(d) ? p.filter(x => x !== d) : [...p, d])}>{d.slice(0, 3)}</button>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
                      <div><label className="rb-label">Start Time</label><input className="rb-input" type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
                      <div><label className="rb-label">End Time</label><input className="rb-input" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} /></div>
                    </div>
                    {days.length > 0 && scheduleConflicts.length === 0 && (
                      <div style={{ marginTop: 12, padding: '9px 12px', background: 'rgba(22,163,74,.05)', border: '1px solid rgba(22,163,74,.15)', borderRadius: 9, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <IcoClock size={12} color="var(--accent)" />
                        {days.map(d => d.slice(0, 3)).join(', ')} · {formatTime12h(time)} – {formatTime12h(endTime)}
                      </div>
                    )}

                    {scheduleConflicts.length > 0 && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: '#FEF2F2', border: '1px solid rgba(239,68,68,.3)', borderRadius: 9, fontSize: 12, color: '#991B1B' }}>
                        <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ display: 'inline-block', width: 15, height: 15, borderRadius: '50%', background: '#EF4444', color: '#fff', textAlign: 'center', lineHeight: '15px', fontSize: 10 }}>!</span>
                          Scheduling Conflict Detected
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 22, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {scheduleConflicts.map((c, i) => (
                            <li key={i}>
                              {c.type === 'truck' ? `Truck ${c.truckPlate}` : c.type === 'driver' ? `Driver ${c.driverName}` : `Truck ${c.truckPlate} and Driver ${c.driverName}`} is already scheduled on <strong>{c.sharedDays.join(', ')}</strong> ({c.existingTime}).
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2 — Stops */}
                {step === 2 && (
                  <div className="rb-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <div>
                        <p className="rb-panel-title" style={{ margin: 0 }}>Route Stops</p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{stops.length} stop{stops.length !== 1 ? 's' : ''} placed</p>
                      </div>
                      <button className="rb-btn-primary rb-btn-sm" onClick={() => { setAddMode(true); setShowMap(true); setTimeout(() => { try { mapInst.current?.invalidateSize() } catch { } }, 50) }}>
                        <IcoPlus size={12} color="#fff" /> Add Stop
                      </button>
                    </div>

                    {stops.length === 0 && <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 12, color: 'var(--text-muted)' }}>Tap "+ Add Stop", then click the map to place points.</div>}

                    {orsStats && stops.length > 0 && (
                      <div style={{ display: 'flex', gap: 7, marginBottom: 13 }}>
                        <div className="rb-stat"><div className="rb-stat-val">{orsStats.distKm} km</div><div className="rb-stat-lbl">Distance</div></div>
                        <div className="rb-stat"><div className="rb-stat-val" style={{ color: 'var(--text)' }}>{orsStats.durationMin} min</div><div className="rb-stat-lbl">Est. Time</div></div>
                        <div className="rb-stat"><div className="rb-stat-val" style={{ color: 'var(--text)' }}>{stops.length}</div><div className="rb-stat-lbl">Stops</div></div>
                      </div>
                    )}
                    {orsFetching && stops.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 11, color: 'var(--warning)' }}>
                        <div className="rb-spinner" style={{ borderTopColor: 'var(--warning)' }} /> Calculating road route…
                      </div>
                    )}

                    {/* Start point */}
                    <div style={{ padding: '9px 0 10px', borderBottom: '1px solid var(--border)', marginBottom: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        <div style={{ width: 26, height: 26, background: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, border: '2px solid var(--accent)', boxShadow: 'var(--shadow-xs)' }}>🏛️</div>
                        <input className="rb-input" value={startPoint.label} onChange={e => setStartPoint(p => ({ ...p, label: e.target.value }))} style={{ flex: 1, padding: '5px 9px', fontSize: 12 }} placeholder="Start location label" />
                        <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 800, flexShrink: 0, letterSpacing: '.05em' }}>START</span>
                      </div>
                      <label className="rb-check" style={{ paddingLeft: 34 }}>
                        <input type="checkbox" checked={universalStart} onChange={e => { setUniversalStart(e.target.checked); if (e.target.checked) showToast('🌐 Start location applies to all routes') }} />
                        Apply to all truck routes
                      </label>
                    </div>

                    {stops.map((s, i) => (
                      <div key={i} className="rb-stop-row">
                        <div className="rb-stop-num">{i + 1}</div>
                        <input className="rb-input" value={s.label} onChange={e => setStops(p => p.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} style={{ flex: 1, padding: '5px 9px', fontSize: 12 }} placeholder="Label (optional)…" />
                        <button onClick={() => removeStop(i)} style={{ background: 'none', border: 'none', color: 'var(--text-light)', fontSize: 18, cursor: 'pointer', padding: '0 3px', transition: 'color .1s' }} onMouseEnter={e => e.target.style.color = 'var(--danger)'} onMouseLeave={e => e.target.style.color = 'var(--text-light)'}>×</button>
                      </div>
                    ))}

                    {stops.length > 1 && (
                      <div style={{ marginTop: 9, padding: '6px 10px', background: 'rgba(22,163,74,.04)', border: '1px solid rgba(22,163,74,.12)', borderRadius: 7, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <IcoRoute size={11} color="var(--accent)" /> Order auto-optimized by proximity
                      </div>
                    )}

                    {/* Hotspots Section */}
                    {(() => {
                      const selNames = barangays.filter(b => selectedBarangays.includes(b.id)).map(b => b.name);
                      const availableHotspots = (hotspots || []).filter(h => selNames.includes(h.barangay_name));

                      if (availableHotspots.length > 0) {
                        return (
                          <div style={{ marginBottom: 15, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                              Reported Hotspots in Area
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto', scrollbarWidth: 'none' }}>
                              {availableHotspots.map(h => {
                                const isAdded = stops.some(s => Math.abs(s.lat - h.latitude) < 0.0001 && Math.abs(s.lng - h.longitude) < 0.0001);
                                return (
                                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
                                    <div>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
                                        {h.count > 1 ? `${h.type} Cluster (${h.count})` : h.type}
                                      </div>
                                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{h.barangay_name}</div>
                                    </div>
                                    <button 
                                      disabled={isAdded}
                                      onClick={() => {
                                        setStops(prev => [...prev, { stop_id: generateUUID(), lat: parseFloat(h.latitude), lng: parseFloat(h.longitude), label: `Hotspot: ${h.type}`, barangay_id: barangays.find(b => b.name === h.barangay_name)?.id }]);
                                        if (mapInst.current) { mapInst.current.panTo([parseFloat(h.latitude), parseFloat(h.longitude)]); setShowMap(true); setTimeout(() => { try { mapInst.current?.invalidateSize() } catch { } }, 50) }
                                        showToast('📍 Hotspot added to route');
                                      }}
                                      style={{ 
                                        padding: '4px 10px', fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: isAdded ? 'default' : 'pointer',
                                        background: isAdded ? 'rgba(22,163,74,.1)' : 'var(--accent)', color: isAdded ? 'var(--accent)' : '#fff', border: 'none'
                                      }}>
                                      {isAdded ? 'Added' : '+ Add'}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Manual coords */}
                    <div style={{ marginTop: 9, paddingLeft: 32 }}>
                      <button onClick={() => setShowManualCoords(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--info)', fontSize: 11, fontWeight: 600, padding: 0, cursor: 'pointer' }}>
                        {showManualCoords ? '▲ Hide coordinates' : '▼ Enter manual coordinates'}
                      </button>
                      {showManualCoords && (
                        <div style={{ marginTop: 9, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 7, alignItems: 'flex-end' }}>
                          <div><label className="rb-label">Latitude</label><input className="rb-input" value={manualCoords.lat} onChange={e => setManualCoords(p => ({ ...p, lat: e.target.value }))} placeholder="13.9350" style={{ padding: '7px 9px', fontSize: 12 }} type="number" step="0.000001" /></div>
                          <div><label className="rb-label">Longitude</label><input className="rb-input" value={manualCoords.lng} onChange={e => setManualCoords(p => ({ ...p, lng: e.target.value }))} placeholder="121.617" style={{ padding: '7px 9px', fontSize: 12 }} type="number" step="0.000001" /></div>
                          <button className="rb-btn-primary rb-btn-sm" onClick={() => {
                            const lat = parseFloat(manualCoords.lat), lng = parseFloat(manualCoords.lng)
                            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) { showToast('❌ Invalid coordinates'); return }
                            setStartPoint(p => ({ ...p, lat, lng }))
                            if (mapInst.current) { mapInst.current.panTo([lat, lng]); setShowMap(true); setTimeout(() => { try { mapInst.current?.invalidateSize() } catch { } }, 50) }
                            showToast('📍 Start moved'); setShowManualCoords(false); setManualCoords({ lat: '', lng: '' })
                          }}>Set</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 3 — Dumpsite */}
                {step === 3 && (() => {
                  const lastStop = stops.length > 0 ? stops[stops.length - 1] : startPoint;
                  const recommended = [...dumpsites]
                    .filter(d => (d.fill_percent || 0) < 100)
                    .sort((a, b) => {
                      const distA = Math.hypot(Number(a.latitude) - lastStop.lat, Number(a.longitude) - lastStop.lng);
                      const distB = Math.hypot(Number(b.latitude) - lastStop.lat, Number(b.longitude) - lastStop.lng);
                      if (distA === distB) return (a.fill_percent || 0) - (b.fill_percent || 0);
                      return distA - distB;
                    })[0] || dumpsites[0];

                  const availableDumpsites = dumpsites.filter(d => String(d.id) !== String(recommended?.id));

                  return (
                    <div className="rb-panel">
                      <p className="rb-panel-title">Select Dumpsite</p>
                      <p className="rb-panel-sub">Where does the truck unload after collection?</p>

                      {recommended && (
                        <div style={{ marginBottom: 16 }}>
                          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 13 }}>⭐</span> Recommended (Nearest)
                          </p>
                          <div className={`rb-ds-card${String(dumpsite) === String(recommended.id) ? ' sel' : ''}`} onClick={() => setDumpsite(recommended.id)} style={{ marginBottom: 0, borderColor: String(dumpsite) === String(recommended.id) ? '#DC2626' : 'rgba(22,163,74,.4)', background: String(dumpsite) === String(recommended.id) ? 'rgba(220,38,38,.06)' : 'rgba(22,163,74,.03)' }}>
                            <div style={{ width: 38, height: 38, borderRadius: 9, background: String(dumpsite) === String(recommended.id) ? 'rgba(220,38,38,.12)' : 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>🏭</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 1 }}>{recommended.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {(+recommended.latitude).toFixed(4)}, {(+recommended.longitude).toFixed(4)} • {recommended.fill_percent || 0}% full
                              </div>
                            </div>
                            {String(dumpsite) === String(recommended.id) && (
                              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <IcoCheck size={11} color="#fff" sw={3} />
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {availableDumpsites.length > 0 && (
                        <>
                          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                            Other Dumpsites
                          </p>
                          {availableDumpsites.map(ds => (
                            <div key={ds.id} className={`rb-ds-card${String(dumpsite) === String(ds.id) ? ' sel' : ''}`} onClick={() => setDumpsite(ds.id)}>
                              <div style={{ width: 38, height: 38, borderRadius: 9, background: String(dumpsite) === String(ds.id) ? 'rgba(220,38,38,.12)' : 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>🏭</div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 1 }}>{ds.name}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {(+ds.latitude).toFixed(4)}, {(+ds.longitude).toFixed(4)} • {ds.fill_percent || 0}% full
                                </div>
                              </div>
                              {String(dumpsite) === String(ds.id) && (
                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <IcoCheck size={11} color="#fff" sw={3} />
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )
                })()}

                {/* Step 4 — Review */}
                {step === 4 && (
                  <div className="rb-panel">
                    <p className="rb-panel-title">Route Summary</p>
                    <p className="rb-panel-sub">Review before saving.</p>

                    {orsStats && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginBottom: 16 }}>
                        <div style={{ background: 'rgba(22,163,74,.05)', border: '1px solid rgba(22,163,74,.18)', borderRadius: 10, padding: '11px', textAlign: 'center' }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>{orsStats.distKm} km</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '.05em' }}>Total distance</div>
                        </div>
                        <div style={{ background: 'rgba(37,99,235,.04)', border: '1px solid rgba(37,99,235,.15)', borderRadius: 10, padding: '11px', textAlign: 'center' }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: '#2563EB' }}>{orsStats.durationMin} min</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '.05em' }}>Estimated time</div>
                        </div>
                      </div>
                    )}
                    {orsFetching && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11, fontSize: 11, color: 'var(--warning)' }}><div className="rb-spinner" style={{ borderTopColor: 'var(--warning)' }} /> Calculating…</div>}
                    {!orsData && !orsFetching && stops.length > 0 && !ORS_API_KEY && (
                      <div style={{ marginBottom: 13, padding: '8px 11px', background: 'rgba(217,119,6,.06)', border: '1px solid rgba(217,119,6,.2)', borderRadius: 9, fontSize: 11, color: 'var(--warning)' }}>
                        ⚠️ Add <code>VITE_ORS_API_KEY</code> to enable road routing
                      </div>
                    )}

                    <div style={{ marginBottom: 14 }}>
                      {[
                        { label: 'Truck', value: `${selectedTruck?.plate_number} — ${selectedTruck?.model}` },
                        { label: 'Driver', value: selectedDriverObj?.full_name },
                        { label: 'Days', value: days.join(', ') },
                        { label: 'Time', value: `${time} – ${endTime}` },
                        { label: 'Stops', value: `${stops.length} collection points` },
                        { label: 'Dumpsite', value: selectedDumpsite?.name },
                      ].map(r => (
                        <div key={r.label} className="rb-info-row">
                          <span className="rb-info-key">{r.label}</span>
                          <span className="rb-info-val">{r.value || '—'}</span>
                        </div>
                      ))}
                    </div>

                    <div className="rb-path">
                      🏛️ Home Base
                      {stops.map((s, i) => <span key={i}> → <span style={{ color: 'var(--accent)', fontWeight: 700 }}>#{i + 1}</span> {s.label || `Stop ${i + 1}`}</span>)}
                      {selectedDumpsite && <> → 🏭 {selectedDumpsite.name}</>}
                      {' → 🏛️ Return'}
                    </div>

                    {saved && (
                      <div style={{ marginTop: 14, background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.25)', borderRadius: 9, padding: '11px', fontSize: 13, fontWeight: 700, color: 'var(--accent)', textAlign: 'center' }}>
                        ✅ Route saved successfully!
                      </div>
                    )}
                  </div>
                )}

                {/* Nav buttons */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="rb-btn-ghost rb-btn-sm" onClick={handleCancel}>Cancel</button>
                  {step > 0 && <button className="rb-btn-ghost" style={{ flex: 1 }} onClick={() => { setStep(s => s - 1); setSaved(false) }}>← Back</button>}
                  {step < 4
                    ? <button className="rb-btn-primary" style={{ flex: 1, opacity: canNext() ? 1 : .35 }} disabled={!canNext()} onClick={() => setStep(s => s + 1)}>Next →</button>
                    : <button className="rb-btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saved}>{saved ? '✅ Saved' : '💾 Save Route'}</button>
                  }
                </div>

              </div>
            </div>
          </>
        )}

        {/* ══ LIST ══════════════════════════════════════════════════════════ */}
        {activeTab === 'list' && (() => {
          const filteredSchedules = schedules.filter(s => {
            if (listTruckFilter && String(s.truck) !== String(listTruckFilter)) return false
            if (listDriverFilter && String(s.driver) !== String(listDriverFilter)) return false
            if (listDayFilter && !s.days?.includes(listDayFilter)) return false
            if (listStatusFilter) {
              const t = trucks.find(x => String(x.id) === String(s.truck))
              if (!t || String(t.status || 'active').toLowerCase() !== listStatusFilter.toLowerCase()) return false
            }
            if (listSearch) {
              const q = listSearch.toLowerCase()
              const matchText = [s.barangay_names, s.start_time, s.end_time].join(' ').toLowerCase()
              if (!matchText.includes(q)) return false
            }
            return true
          })

          return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 190px)' }}>

              {/* Filter Bar */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: 'var(--surface-2)' }}>
                <input className="rb-input" style={{ flex: 1, minWidth: 160, padding: '7px 12px', fontSize: 12, borderRadius: 8 }} placeholder="Search barangays or time..." value={listSearch} onChange={e => setListSearch(e.target.value)} />
                <select className="rb-select" style={{ width: 'auto', padding: '7px 30px 7px 12px', fontSize: 12, borderRadius: 8 }} value={listTruckFilter} onChange={e => setListTruckFilter(e.target.value)}>
                  <option value="">All Trucks</option>
                  {trucks.map(t => <option key={t.id} value={t.id}>{t.plate_number}</option>)}
                </select>
                <select className="rb-select" style={{ width: 'auto', padding: '7px 30px 7px 12px', fontSize: 12, borderRadius: 8 }} value={listDriverFilter} onChange={e => setListDriverFilter(e.target.value)}>
                  <option value="">All Drivers</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
                <select className="rb-select" style={{ width: 'auto', padding: '7px 30px 7px 12px', fontSize: 12, borderRadius: 8 }} value={listDayFilter} onChange={e => setListDayFilter(e.target.value)}>
                  <option value="">All Days</option>
                  {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="rb-select" style={{ width: 'auto', padding: '7px 30px 7px 12px', fontSize: 12, borderRadius: 8 }} value={listStatusFilter} onChange={e => setListStatusFilter(e.target.value)}>
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="rb-list-desktop" style={{ flex: 1, overflowY: 'auto' }}>
                {schedLoading ? (
                  <div className="rb-empty"><IcoRoute size={30} color="var(--text-light)" /><div className="rb-empty-title">Loading schedules…</div></div>
                ) : schedules.length === 0 ? (
                  <div className="rb-empty"><IcoRoute size={30} color="var(--text-light)" /><div className="rb-empty-title">No scheduled routes yet</div><div className="rb-empty-sub">Create one in the Build Route tab.</div></div>
                ) : filteredSchedules.length === 0 ? (
                  <div className="rb-empty"><IcoRoute size={30} color="var(--text-light)" /><div className="rb-empty-title">No matching routes</div><div className="rb-empty-sub">Try adjusting your filters.</div></div>
                ) : filteredSchedules.slice((listPage - 1) * 10, listPage * 10).map((s, idx) => {
                  const tc = TRUCK_COLORS[getTruckColorIdx(s.truck)]
                  return (
                    <div key={s.id} className="rb-tbl-row" style={(!s.driver_name || !s.truck) ? { background: '#FEF2F2', borderLeft: '3px solid #EF4444' } : {}}>

                      {/* Top Section: Quick Stats & Actions */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {s.truck ? (
                              <>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: tc.color, flexShrink: 0 }} />
                                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{s.truck_plate || '—'}</span>
                              </>
                            ) : (
                              <span style={{ fontSize: 13, fontWeight: 800, color: '#EF4444' }}>No Truck</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: s.driver_name ? 'var(--text)' : '#EF4444', fontWeight: s.driver_name ? 600 : 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <IcoUser size={12} color={s.driver_name ? "var(--text-muted)" : "#EF4444"} />
                            {s.driver_name || 'No Driver'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <IcoClock size={12} color="var(--text-muted)" />
                            {s.start_time ? `${formatTime12h(s.start_time)} – ${formatTime12h(s.end_time)}` : '—'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: tc.bg, color: tc.color, borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>
                            <IcoPin size={10} color={tc.color} /> {Array.isArray(s.waypoints) ? s.waypoints.length : 0} Stops
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button className="rb-btn-edit" onClick={() => handleEdit(s)}><IcoEdit size={12} /> Edit</button>
                          <button className="rb-btn-del" onClick={() => handleDelete(s)}><IcoTrash size={12} /> Delete</button>
                        </div>
                      </div>

                      {/* Bottom Section: Barangays and Days */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 2 }}>
                        <div>
                          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>Routed Barangays</span>
                          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', lineHeight: 1.45 }}>
                            {s.barangay_names || '—'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {(s.days || '').split(', ').filter(Boolean).map(day => <span key={day} className="rb-badge">{{ 'Sunday': 'Su', 'Monday': 'M', 'Tuesday': 'T', 'Wednesday': 'W', 'Thursday': 'Th', 'Friday': 'F', 'Saturday': 'S' }[day] || day}</span>)}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {filteredSchedules.length > 10 && (
                  <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', borderTop: '1px solid var(--border)', position: 'sticky', bottom: 0, zIndex: 10 }}>
                    <button className="rb-btn-ghost rb-btn-sm" disabled={listPage === 1} onClick={() => setListPage(p => p - 1)}>← Previous</button>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Page {listPage} of {Math.ceil(filteredSchedules.length / 10)}</span>
                    <button className="rb-btn-ghost rb-btn-sm" disabled={listPage >= Math.ceil(filteredSchedules.length / 10)} onClick={() => setListPage(p => p + 1)}>Next →</button>
                  </div>
                )}
              </div>

              {/* Mobile list */}
              <div className="rb-list-mobile" style={{ flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
                {schedLoading ? (
                  <div className="rb-empty">Loading…</div>
                ) : schedules.length === 0 ? (
                  <div className="rb-empty"><div className="rb-empty-title">No routes yet.</div><div className="rb-empty-sub">Build one first.</div></div>
                ) : filteredSchedules.length === 0 ? (
                  <div className="rb-empty"><div className="rb-empty-title">No matches.</div><div className="rb-empty-sub">Try adjusting your filters.</div></div>
                ) : filteredSchedules.slice((listPage - 1) * 10, listPage * 10).map((s, idx) => {
                  const tc = TRUCK_COLORS[getTruckColorIdx(s.truck)]
                  return (
                    <div key={s.id} style={{ padding: 16, borderBottom: idx < filteredSchedules.length - 1 ? '1px solid var(--border)' : 'none', background: (!s.driver_name || !s.truck) ? '#FEF2F2' : 'transparent', borderLeft: (!s.driver_name || !s.truck) ? '3px solid #EF4444' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 9, gap: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', lineHeight: 1.35, flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          {s.barangay_names || '—'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: tc.bg, color: tc.color, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 800, flexShrink: 0, border: `1px solid ${tc.color}33` }}>
                          <IcoPin size={10} color={tc.color} />{Array.isArray(s.waypoints) ? s.waypoints.length : 0}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 11 }}>
                        {[{ Icon: IcoTruck, val: s.truck_plate || 'No Truck', missing: !s.truck }, { Icon: IcoUser, val: s.driver_name || 'No Driver', missing: !s.driver_name }, { Icon: IcoClock, val: s.start_time && `${formatTime12h(s.start_time)} – ${formatTime12h(s.end_time)}` }].filter(m => m.val).map(({ Icon: I, val, missing }, mi) => (
                          <span key={mi} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: missing ? 'rgba(239,68,68,0.1)' : 'var(--surface-2)', border: missing ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)', borderRadius: 20, padding: '4px 10px', fontSize: 11, color: missing ? '#EF4444' : 'var(--text-muted)', fontWeight: missing ? 800 : 600 }}>
                            <I size={10} color={missing ? '#EF4444' : 'var(--text-muted)'} />{val}
                          </span>
                        ))}
                        {(s.days || '').split(', ').filter(Boolean).map(day => <span key={day} className="rb-badge" style={{ padding: '4px 9px' }}>{{ 'Sunday': 'Su', 'Monday': 'M', 'Tuesday': 'T', 'Wednesday': 'W', 'Thursday': 'Th', 'Friday': 'F', 'Saturday': 'S' }[day] || day}</span>)}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="rb-btn-edit" style={{ flex: 1, justifyContent: 'center', padding: 9, fontSize: 12, borderRadius: 9 }} onClick={() => handleEdit(s)}><IcoEdit size={12} /> Edit</button>
                        <button className="rb-btn-del" style={{ flex: 1, justifyContent: 'center', padding: 9, fontSize: 12, borderRadius: 9 }} onClick={() => handleDelete(s)}><IcoTrash size={12} /> Delete</button>
                      </div>
                    </div>
                  )
                })}
                {filteredSchedules.length > 10 && (
                  <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', borderTop: '1px solid var(--border)', position: 'sticky', bottom: 0, zIndex: 10 }}>
                    <button className="rb-btn-ghost rb-btn-sm" disabled={listPage === 1} onClick={() => setListPage(p => p - 1)}>← Previous</button>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Page {listPage} of {Math.ceil(filteredSchedules.length / 10)}</span>
                    <button className="rb-btn-ghost rb-btn-sm" disabled={listPage >= Math.ceil(filteredSchedules.length / 10)} onClick={() => setListPage(p => p + 1)}>Next →</button>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* ══ CALENDAR ══════════════════════════════════════════════════════ */}
        {activeTab === 'calendar' && renderCalendar()}

      </div>

      {/* ── ADD EVENT MODAL ── */}
      {showEventModal && (
        <div className="rb-modal-ov">
          <div className="rb-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-head)' }}>Create Event</h3>
              <button onClick={() => setShowEventModal(false)} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><IcoX size={13} /></button>
            </div>
            <form onSubmit={handleCreateEvent} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div><label className="rb-label">Event Title</label><input required className="rb-input" value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="e.g. Clean-up Drive" /></div>
              <div><label className="rb-label">Date</label><input required type="date" className="rb-input" value={newEvent.date} onChange={e => setNewEvent({ ...newEvent, date: e.target.value })} /></div>
              <div><label className="rb-label">Location (Optional)</label><input className="rb-input" value={newEvent.location} onChange={e => setNewEvent({ ...newEvent, location: e.target.value })} placeholder="e.g. Quezon Park" /></div>
              <div>
                <label className="rb-label">Assign Personnel (Optional)</label>
                <select className="rb-select" value={newEvent.assigned_to} onChange={e => setNewEvent({ ...newEvent, assigned_to: e.target.value })}>
                  <option value="">— No specific assignment —</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 9, marginTop: 4 }}>
                <button type="button" className="rb-btn-ghost" style={{ flex: 1 }} onClick={() => setShowEventModal(false)}>Cancel</button>
                <button type="submit" className="rb-btn-primary" style={{ flex: 1 }}>Save Event</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CALENDAR DAY DETAIL MODAL ── */}
      {calDayModal && (
        <div className="rb-modal-ov" onClick={e => { if (e.target === e.currentTarget) setCalDayModal(null) }} style={{ alignItems: 'flex-end', padding: '0', background: 'rgba(0,0,0,0.4)' }}>
          <style>{`
            @keyframes sheetUp { from { transform: translateY(100%); opacity: 0.5 } to { transform: translateY(0); opacity: 1 } }
            .sheet-modal { background: #fff; width: 100%; max-width: 600px; border-radius: 24px 24px 0 0; padding: 12px 0 0 0; animation: sheetUp 0.25s cubic-bezier(0.1, 0.9, 0.2, 1); box-shadow: 0 -4px 24px rgba(0,0,0,0.1); max-height: 90vh; display: flex; flex-direction: column; margin: 0 auto; overflow: hidden; }
            .sheet-grid-container { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; background: #fff; }
            .sheet-vl { position: absolute; top: 0; bottom: 0; left: 64px; width: 1px; background: #E5E7EB; z-index: 1; }
            .sheet-hour { position: absolute; left: 0; right: 0; height: 1px; z-index: 1; }
            .sheet-hour-line { position: absolute; left: 64px; right: 0; top: 0; height: 1px; background: #E5E7EB; }
            .sheet-hour-label { position: absolute; top: -7px; left: 12px; font-size: 11px; color: #6B7280; width: 40px; text-align: right; background: #fff; padding-right: 4px; }
          `}</style>
          <div className="sheet-modal" onClick={e => e.stopPropagation()}>
            {/* Drag Handle */}
            <div style={{ width: 36, height: 4, background: '#E5E7EB', borderRadius: 4, margin: '0 auto 16px' }} />

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0 24px 16px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 400, color: '#111827', fontFamily: 'var(--font-head)' }}>
                  {calDayModal.label.split(',')[0]}
                </h3>
                <div style={{ fontSize: 14, color: '#4B5563' }}>
                  {calDayModal.cellDayName.substring(0, 3)}, {calDayModal.label}
                </div>
              </div>
              <button onClick={() => { setCalDayModal(null); setCalDayExpanded(null); }} style={{ background: '#F3F4F6', border: 'none', padding: 8, borderRadius: '50%', cursor: 'pointer', color: '#4B5563', display: 'flex', alignItems: 'center' }}>
                <IcoX size={18} sw={2} />
              </button>
            </div>

            {(() => {
              const timeToMins = (t) => {
                if (!t) return 0;
                const [h, m] = t.split(':');
                return parseInt(h, 10) * 60 + parseInt(m, 10);
              };
              const hours = Array.from({ length: 24 }, (_, i) => i); // 12 AM to 11 PM

              // Group routes by start time (in minutes) to render them in horizontal rows
              const routesByTime = {};
              calDayModal.routes.forEach(r => {
                const startMins = Math.max(0, timeToMins(r.start_time));
                const endMins = timeToMins(r.end_time || r.start_time);

                if (endMins <= startMins) {
                  if (!routesByTime[startMins]) routesByTime[startMins] = [];
                  routesByTime[startMins].push(r);
                } else {
                  // Repeat the route pill for every hour slot it covers
                  for (let m = startMins; m < endMins; m += 60) {
                    if (!routesByTime[m]) routesByTime[m] = [];
                    routesByTime[m].push(r);
                  }
                }
              });

              return (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  {/* All Day Events Section */}
                  {calDayModal.events.length > 0 && (
                    <div style={{ padding: '12px 16px 12px 72px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #E5E7EB', borderBottom: '1px solid #E5E7EB', position: 'relative', background: '#F9FAFB' }}>
                      <div style={{ position: 'absolute', left: 16, top: 16, fontSize: 11, color: '#6B7280', fontWeight: 600 }}>All-day</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {calDayModal.events.map(ev => (
                          <div key={ev.id} style={{ position: 'relative' }}>
                            <span
                              style={{ background: '#FDE68A', color: '#92400E', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, borderLeft: '3px solid #D97706', cursor: 'pointer', display: 'inline-block' }}
                              onClick={(e) => { e.stopPropagation(); setCalDayExpanded(calDayExpanded === ev.id ? null : ev.id); }}
                            >
                              {ev.title}
                            </span>

                            {calDayExpanded === ev.id && (
                              <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 24, left: 0, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 200, zIndex: 11 }}>
                                <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', marginBottom: 4 }}>{ev.title}</div>
                                {ev.location && <div style={{ fontSize: 12, color: '#4B5563', marginBottom: 2 }}>📍 {ev.location}</div>}
                                {ev.assigned_to_name && <div style={{ fontSize: 12, color: '#4B5563' }}>👤 {ev.assigned_to_name}</div>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {calDayModal.events.length === 0 && calDayModal.routes.length > 0 && (
                    <div style={{ borderTop: '1px solid #E5E7EB' }} />
                  )}

                  {/* Scrollable Timeline Grid */}
                  <div className="sheet-grid-container" onClick={() => setCalDayExpanded(null)} style={{ background: '#F9FAFB' }}>
                    {calDayModal.routes.length === 0 && calDayModal.events.length === 0 ? (
                      <div style={{ padding: '40px 0', textAlign: 'center', color: '#6B7280' }}>
                        <IcoCal size={32} color="#D1D5DB" />
                        <div style={{ marginTop: 12, fontWeight: 600 }}>Nothing scheduled for this day.</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#fff' }}>
                        {(() => {
                          const hourBuckets = Array.from({ length: 24 }, () => []);
                          calDayModal.routes.forEach(r => {
                            const startMins = Math.max(0, timeToMins(r.start_time));
                            const endMins = timeToMins(r.end_time || r.start_time);

                            if (endMins <= startMins) {
                              const bucket = Math.floor(startMins / 60);
                              if (bucket >= 0 && bucket < 24) {
                                hourBuckets[bucket].push(r);
                              }
                            } else {
                              const startBucket = Math.floor(startMins / 60);
                              const endBucket = Math.floor(endMins / 60);
                              for (let b = startBucket; b <= endBucket; b++) {
                                if (b >= 0 && b < 24) {
                                  if (!hourBuckets[b].some(existing => existing.id === r.id)) {
                                    hourBuckets[b].push(r);
                                  }
                                }
                              }
                            }
                          });

                          return hours.map(h => {
                            const routes = hourBuckets[h];
                            return (
                              <div key={h} style={{ display: 'flex', minHeight: 64, borderBottom: '1px solid #E5E7EB', position: 'relative' }}>
                                {/* Hour Label */}
                                <div style={{ width: 72, flexShrink: 0, borderRight: '1px solid #E5E7EB', padding: '12px 12px 12px 0', textAlign: 'right', fontSize: 11, color: '#6B7280', background: '#F9FAFB' }}>
                                  {h === 0 ? '12 AM' : h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}
                                </div>

                                {/* Routes Container */}
                                <div style={{ flex: 1, padding: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px 8px', alignContent: 'flex-start' }}>
                                  {routes.map(s => {
                                    const tc = TRUCK_COLORS[getTruckColorIdx(s.truck)];
                                    return (
                                      <div
                                        key={s.id}
                                        style={{ display: 'flex', cursor: 'pointer', transition: 'transform 0.1s' }}
                                        onClick={(e) => { e.stopPropagation(); setCalDayExpanded(calDayExpanded === h ? null : h); }}
                                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                                      >
                                        <span style={{ background: tc.color, color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                                          {formatTime12h(s.start_time)} - {s.end_time ? formatTime12h(s.end_time) : ''} | {s.truck_plate || 'Truck'} • {s.driver_name || 'Driver'}
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>

                                {/* Expanded Popover */}
                                {calDayExpanded === h && (
                                  <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 40, left: 84, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', minWidth: 320, zIndex: 100, cursor: 'default' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E5E7EB', paddingBottom: 12, marginBottom: 16 }}>
                                      <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}>
                                        {h === 0 ? '12:00 AM' : h === 12 ? '12:00 PM' : h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`}
                                      </h4>
                                      <button onClick={() => setCalDayExpanded(null)} style={{ background: '#F3F4F6', border: 'none', padding: 6, borderRadius: '50%', cursor: 'pointer', color: '#4B5563', display: 'flex', alignItems: 'center' }}>
                                        <IcoX size={16} sw={2} />
                                      </button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '50vh', overflowY: 'auto', paddingRight: 4 }}>
                                      {routes.map(s => {
                                        const tc = TRUCK_COLORS[getTruckColorIdx(s.truck)];
                                        return (
                                          <div key={s.id}>
                                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#111827' }}>{s.barangay_names || 'Route Assignment'}</div>
                                            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                                              <IcoCal size={12} /> {formatTime12h(s.start_time)} – {s.end_time ? formatTime12h(s.end_time) : ''}
                                            </div>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                              <span style={{ background: tc.bg, color: tc.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{s.truck_plate}</span>
                                              <span style={{ background: '#EFF6FF', color: '#2563EB', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{s.driver_name}</span>
                                              <span style={{ background: '#F3F4F6', color: '#4B5563', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{Array.isArray(s.waypoints) ? s.waypoints.length : 0} stops</span>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          });
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            <div style={{ height: 10 }} />
          </div>
        </div>
      )}


    </DashboardLayout>
  )
}