import { useEffect, useRef, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import { useTrucks } from '../../hooks/useTrucks'
import { useUsers } from '../../hooks/useUsers'
import { useDumpsites } from '../../hooks/useDumpsites'
import api from '../../api/client'

const LUCENA_CENTER = [13.9373, 121.617]
const HOME_BASE = { lat: 13.9373, lng: 121.617, label: 'City Hall — Home Base' }

// ── ORS config ─────────────────────────────────────────────────────────────
const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY || ''

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
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify({ coordinates, instructions: true }),
    })
    const data = await res.json()
    if (!data.routes?.length) return null
    return data.routes[0]
  } catch (err) {
    console.warn('[ORS] routing failed:', err)
    return null
  }
}

function pointInPolygon(point, vs) {
  const x = point[0], y = point[1]
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1]
    const xj = vs[j][0], yj = vs[j][1]
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function detectBarangay(lat, lng, geoJson) {
  if (!geoJson || !geoJson.features) return null
  for (const feature of geoJson.features) {
    if (feature.geometry.type === 'Polygon') {
      if (pointInPolygon([lng, lat], feature.geometry.coordinates[0])) return feature.properties.brgy_name
    } else if (feature.geometry.type === 'MultiPolygon') {
      for (const poly of feature.geometry.coordinates) {
        if (pointInPolygon([lng, lat], poly[0])) return feature.properties.brgy_name
      }
    }
  }
  return null
}

// ── Nearest-neighbor stop optimizer ────────────────────────────────────────
function optimizeStopOrder(origin, stops) {
  if (stops.length <= 2) return stops
  const remaining = [...stops]
  const ordered = []
  let current = origin
  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity
    remaining.forEach((s, i) => {
      const d = Math.hypot(s.lat - current.lat, s.lng - current.lng)
      if (d < nearestDist) { nearestDist = d; nearestIdx = i }
    })
    ordered.push(remaining[nearestIdx])
    current = remaining[nearestIdx]
    remaining.splice(nearestIdx, 1)
  }
  return ordered
}

// ── SVG Icon primitives ──────────────────────────────────────────
const Icon = ({ d, size = 14, color = 'currentColor', strokeWidth = 1.75 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, display: 'block' }}>
    <path d={d} />
  </svg>
)
const IcoTruck = (p) => <Icon {...p} d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
const IcoUser = (p) => <Icon {...p} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
const IcoCal = (p) => <Icon {...p} d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
const IcoClock = (p) => <Icon {...p} d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM12 6v6l4 2" />
const IcoPin = (p) => <Icon {...p} d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
const IcoEdit = (p) => <Icon {...p} d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
const IcoTrash = (p) => <Icon {...p} d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
const IcoPlus = (p) => <Icon {...p} d="M12 5v14M5 12h14" />
const IcoRoute = (p) => <Icon {...p} d="M3 17l4-8 4 4 4-6 4 4" />
const IcoMap = (p) => <Icon {...p} d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7zM9 4v13M15 7v13" />
const IcoX = (p) => <Icon {...p} d="M18 6L6 18M6 6l12 12" />

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const STEP_LABELS = ['Config', 'Schedule', 'Stops', 'Dumpsite', 'Review']

export default function RouteBuilder() {
  const mapRef = useRef(null)
  const mapInst = useRef(null)
  const layersRef = useRef([])
  const orsRouteLayer = useRef(null)

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

  // ── NEW: Calendar day detail modal ──────────────────────────────
  const [calDayModal, setCalDayModal] = useState(null) // { date, day, label, routes, events }

  // ORS routing state
  const [orsData, setOrsData] = useState(null)
  const [orsFetching, setOrsFetching] = useState(false)
  const orsAbortRef = useRef(null)

  const { trucks } = useTrucks()
  const { drivers } = useUsers()
  const { sites: dumpsites } = useDumpsites()

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

  // Auto-optimize stop order by proximity
  const prevStopsRef = useRef([])
  useEffect(() => {
    if (stops.length < 3) { prevStopsRef.current = stops; return }
    const posChanged = stops.some((s, i) => {
      const p = prevStopsRef.current[i]
      return !p || p.lat !== s.lat || p.lng !== s.lng
    }) || stops.length !== prevStopsRef.current.length
    if (!posChanged) return
    const optimized = optimizeStopOrder(startPoint, stops)
    prevStopsRef.current = optimized
    setStops(optimized)
  }, [stops.map(s => `${s.lat},${s.lng}`).join('|'), startPoint.lat, startPoint.lng])

  useEffect(() => { barangaysRef.current = barangays }, [barangays])
  useEffect(() => { selectedBarangaysRef.current = selectedBarangays }, [selectedBarangays])
  useEffect(() => { barangayGeoRef.current = barangayGeo }, [barangayGeo])

  useEffect(() => {
    function handleOutside(e) {
      if (barangayDropRef.current && !barangayDropRef.current.contains(e.target))
        setBarangayDropOpen(false)
    }
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
    api.get('/api/driver/collection-schedules/')
      .then(r => setSchedules(r.data)).catch(console.error).finally(() => setSchedLoading(false))
  }
  const fetchCalendarEvents = () => {
    api.get('/api/driver/calendar-events/').then(r => setCalendarEvents(r.data)).catch(console.error)
  }
  useEffect(() => {
    if (activeTab === 'list' || activeTab === 'calendar') {
      fetchSchedules()
      if (activeTab === 'calendar') fetchCalendarEvents()
    }
  }, [activeTab])

  // ── Load Leaflet ─────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    s.onload = () => setMapReady(true)
    document.head.appendChild(s)
  }, [])

  // ── Init map ──────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'builder') return
    if (!mapReady || !mapRef.current) return
    if (mapInst.current) {
      if (mapInst.current.getContainer() !== mapRef.current) {
        try { mapInst.current.remove() } catch { }
        mapInst.current = null
      } else { return }
    }
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    map.on('click', e => {
      if (!addModeRef.current) return
      const { lat, lng } = e.latlng
      const detectedName = detectBarangay(lat, lng, barangayGeoRef.current)

      if (selectedBarangaysRef.current.length > 0) {
        const matchedBarangay = barangaysRef.current.find(x => x.name === detectedName)
        if (!matchedBarangay || !selectedBarangaysRef.current.includes(matchedBarangay.id)) {
          showToast('⛔ Pin is outside the selected barangay area')
          return
        }
      }

      if (detectedName) {
        const b = barangaysRef.current.find(x => x.name === detectedName)
        if (b && !selectedBarangaysRef.current.includes(b.id)) {
          setSelectedBarangays(prev => [...prev, b.id])
          showToast(`📍 Auto-added: ${b.name}`)
        }
      }
      setStops(prev => [...prev, { lat, lng, label: '' }])
      setAddMode(false)
    })
    mapInst.current = map
    setTimeout(() => { try { map.invalidateSize() } catch { } }, 200)
  }, [mapReady, activeTab])

  useEffect(() => {
    if (mapInst.current) try { mapInst.current.invalidateSize() } catch { }
  }, [mapReady, activeTab, showMap])

  useEffect(() => {
    const onResize = () => { if (mapInst.current) try { mapInst.current.invalidateSize() } catch { } }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const buildOrsCoords = () => {
    const ds = dumpsites.find(d => String(d.id) === String(dumpsite))
    const allPoints = [
      startPoint,
      ...stops,
      ...(ds ? [{ lat: +ds.latitude, lng: +ds.longitude }] : []),
      startPoint,
    ]
    if (allPoints.length < 2) return []
    return allPoints.map(p => [p.lng, p.lat])
  }

  useEffect(() => {
    if (!mapReady || activeTab !== 'builder') return
    const coords = buildOrsCoords()
    if (coords.length < 2) {
      setOrsData(null)
      return
    }
    if (orsAbortRef.current) orsAbortRef.current = false
    const token = {}
    orsAbortRef.current = token
    setOrsFetching(true)

    fetchOrsRoute(coords).then(route => {
      if (token !== orsAbortRef.current) return
      setOrsData(route)
      setOrsFetching(false)
    })
    return () => { orsAbortRef.current = false }
  }, [stops, dumpsite, startPoint, mapReady, activeTab])

  // ── Redraw all map layers ──────────────────────────────────────────
  useEffect(() => {
    if (!mapInst.current) return
    const L = window.L
    const map = mapInst.current

    layersRef.current.forEach(l => { try { map.removeLayer(l) } catch { } })
    layersRef.current = []
    if (orsRouteLayer.current) { try { map.removeLayer(orsRouteLayer.current) } catch { } orsRouteLayer.current = null }

    const ds = dumpsites.find(d => String(d.id) === String(dumpsite))

    // ── Geofence highlight for selected barangays ──────────────────
    if (barangayGeo && selectedBarangays.length > 0) {
      const selectedNames = new Set(barangays.filter(b => selectedBarangays.includes(b.id)).map(b => b.name))
      barangayGeo.features.forEach(feature => {
        if (!selectedNames.has(feature.properties.brgy_name)) return
        const toLatLng = ring => ring.map(([lng, lat]) => [lat, lng])
        let polys = []
        if (feature.geometry.type === 'Polygon') polys = [feature.geometry.coordinates]
        else if (feature.geometry.type === 'MultiPolygon') polys = feature.geometry.coordinates
        polys.forEach(poly => {
          // Outer fill layer — light green tint matching screenshot
          const fillLayer = L.polygon(poly.map(toLatLng), {
            color: 'transparent',
            weight: 0,
            fillColor: '#8b91ffff',
            fillOpacity: 0.08,
            interactive: false,
          }).addTo(map)
          layersRef.current.push(fillLayer)

          // Border layer — solid green, matching screenshot style
          const borderLayer = L.polygon(poly.map(toLatLng), {
            color: '#8b91ffff',
            weight: 2.5,
            opacity: 0.85,
            fill: false,
            dashArray: null,
            interactive: false,
          }).addTo(map)
          layersRef.current.push(borderLayer)
        })
      })
    }

    // ── Home base marker ──
    const homeIcon = L.divIcon({
      html: `<div style="background:#1e2633;border:2px solid #2ecc71;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 3px 8px rgba(0,0,0,.4);">🏛️</div>`,
      className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    })
    const hm = L.marker([startPoint.lat, startPoint.lng], { icon: homeIcon, draggable: true }).addTo(map)
    hm.bindPopup(`<b>Start${universalStart ? ' (Universal)' : ''}</b><br>${startPoint.label}`)
    hm.on('dragend', e => { const { lat, lng } = e.target.getLatLng(); setStartPoint(p => ({ ...p, lat, lng })) })
    layersRef.current.push(hm)

    // ── Stop markers — numbered circles showing optimized order ────
    stops.forEach((stop, i) => {
      const seqNum = i + 1
      // Color transitions from blue → amber as stops increase (visual distance cue)
      const hue = Math.round(200 - (i / Math.max(stops.length - 1, 1)) * 30)
      const icon = L.divIcon({
        html: `<div style="
          background: #1a2a3a;
          border: 2.5px solid #5dade2;
          border-radius: 50%;
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          color: #5dade2;
          font-family: system-ui, sans-serif;
          box-shadow: 0 2px 8px rgba(0,0,0,.5);
          line-height: 1;
        ">${seqNum}</div>`,
        className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      })
      const m = L.marker([stop.lat, stop.lng], { icon, draggable: true }).addTo(map)
      m.bindPopup(`<b>Stop ${seqNum}${stop.label ? ': ' + stop.label : ''}</b><br><span style="font-size:11px;color:#888;">${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}</span>`)
      m.on('dragend', e => {
        const { lat, lng } = e.target.getLatLng()
        setStops(p => p.map((s, idx) => idx === i ? { ...s, lat, lng } : s))
      })
      layersRef.current.push(m)
    })

    // ── Dumpsite marker ──
    if (ds) {
      const dsIcon = L.divIcon({
        html: `<div style="background:#e74c3c;border:2px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 3px 8px rgba(0,0,0,.4);">🏭</div>`,
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      })
      const dm = L.marker([+ds.latitude, +ds.longitude], { icon: dsIcon }).addTo(map)
      dm.bindPopup(`<b>${ds.name}</b>`)
      layersRef.current.push(dm)
    }

    // ── Route polyline — ORS or straight-line fallback ──
    if (orsData?.geometry) {
      const pts = decodePolyline(orsData.geometry)
      const line = L.polyline(pts, {
        color: '#2ecc71',
        weight: 5,
        opacity: 0.9,
      }).addTo(map)
      orsRouteLayer.current = line
      if (step >= 2) map.fitBounds(line.getBounds(), { padding: [40, 40] })
    } else if (stops.length > 0) {
      const allPoints = [
        startPoint,
        ...stops,
        ...(ds ? [{ lat: +ds.latitude, lng: +ds.longitude }] : []),
        startPoint,
      ]
      const coords = allPoints.map(p => [p.lat, p.lng])
      const line = L.polyline(coords, {
        color: '#5dade2',
        weight: 3,
        opacity: 0.5,
        dashArray: '8,6',
      }).addTo(map)
      layersRef.current.push(line)
      if (step >= 2) map.fitBounds(line.getBounds(), { padding: [40, 40] })
    }
  }, [stops, dumpsite, mapReady, step, startPoint, activeTab, orsData, selectedBarangays, barangayGeo, barangays])

  useEffect(() => {
    if (!mapInst.current) return
    mapInst.current.getContainer().style.cursor = addMode ? 'crosshair' : ''
  }, [addMode])

  function removeStop(i) {
    setStops(prev => prev.filter((_, idx) => idx !== i))
  }
  function moveStop(i, dir) {
    setStops(prev => {
      const arr = [...prev]; const to = i + dir
      if (to < 0 || to >= arr.length) return arr
        ;[arr[i], arr[to]] = [arr[to], arr[i]]
      return arr.map((s, idx) => ({ ...s, label: `Stop ${idx + 1}` }))
    })
  }
  function canNext() {
    if (step === 0) return truck && driver && selectedBarangays.length > 0
    if (step === 1) return days.length > 0 && time && endTime
    if (step === 2) return stops.length > 0
    if (step === 3) return !!dumpsite
    return true
  }

  function handleCancel() {
    setStep(0); setEditId(null); setTruck(''); setDriver('')
    setSelectedBarangays([]); setDays([]); setStops([]); setDumpsite('')
    setSaved(false); setStartPoint(HOME_BASE); setOrsData(null)
    setUniversalStart(false); setManualCoords({ lat: '', lng: '' }); setShowManualCoords(false)
    setActiveTab('list')
  }

  async function handleSave() {
    try {
      const payload = {
        truck, driver, barangays: selectedBarangays, dumpsite,
        days: days.join(', '), start_time: time, end_time: endTime,
        waypoints: [startPoint, ...stops],
        universal_start: universalStart,
        start_location: { lat: startPoint.lat, lng: startPoint.lng, label: startPoint.label },
      }
      if (editId) await api.patch(`/api/driver/collection-schedules/${editId}/`, payload)
      else await api.post('/api/driver/collection-schedules/', payload)
      setSaved(true)
      showToast(`✅ Route ${editId ? 'updated' : 'saved'}!`)
      setTimeout(() => {
        setStep(0); setEditId(null); setTruck(''); setDriver(''); setSelectedBarangays([])
        setDays([]); setStops([]); setDumpsite(''); setSaved(false); setStartPoint(HOME_BASE)
        setOrsData(null)
      }, 2000)
    } catch (err) {
      showToast(`❌ Failed to ${editId ? 'update' : 'save'} schedule.`)
      console.error(err)
    }
  }

  function handleEdit(s) {
    setActiveTab('builder'); setStep(2); setEditId(s.id)
    setTruck(s.truck || ''); setDriver(s.driver || '')
    setSelectedBarangays(s.barangays || [])
    setDays(s.days ? s.days.split(', ') : [])
    setTime(s.start_time ? s.start_time.slice(0, 5) : '06:00')
    setEndTime(s.end_time ? s.end_time.slice(0, 5) : '14:00')
    setDumpsite(s.dumpsite || '')
    if (s.waypoints?.length > 0) {
      const wps = s.waypoints.map(w => ({ ...w, lat: +w.lat, lng: +w.lng }))
      const sp = wps.shift()
      setStartPoint(sp); setStops(wps)
    } else {
      setStartPoint(HOME_BASE); setStops([])
    }
    setTimeout(() => { try { if (mapInst.current) mapInst.current.invalidateSize() } catch { } }, 300)
  }

  function undoDelete(id, item) {
    const t = pendingDeletesRef.current[id]
    if (t) { clearTimeout(t); delete pendingDeletesRef.current[id]; setSchedules(p => [item, ...p]); showToast('↩️ Undone') }
  }
  function handleDelete(s) {
    setSchedules(p => p.filter(x => x.id !== s.id))
    setToast(
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span>🗑️ Route deleted</span>
        <button onClick={() => undoDelete(s.id, s)} style={{ background: 'transparent', color: '#f39c12', border: '1px solid rgba(243,156,18,0.3)', padding: '4px 10px', borderRadius: 8, fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>Undo</button>
      </div>
    )
    setTimeout(() => setToast(null), 5000)
    const t = setTimeout(async () => {
      try { await api.delete(`/api/driver/collection-schedules/${s.id}/`) } catch { showToast('❌ Server delete failed') }
      delete pendingDeletesRef.current[s.id]
    }, 5000)
    pendingDeletesRef.current[s.id] = t
  }

  const handleCreateEvent = async (e) => {
    e.preventDefault()
    try {
      await api.post('/api/driver/calendar-events/', newEvent)
      showToast('✅ Event created!')
      setShowEventModal(false)
      setNewEvent({ title: '', date: '', location: '', assigned_to: '' })
      fetchCalendarEvents()
    } catch { showToast('❌ Failed to create event') }
  }

  // ── Calendar day modal helper ────────────────────────────────────
  function openCalDayModal(d, dateStr, cellDayName, daySched, dayEvts) {
    const today = new Date()
    const monthName = today.toLocaleString('default', { month: 'long' })
    const label = `${monthName} ${d}, ${today.getFullYear()} · ${cellDayName}`
    setCalDayModal({ d, dateStr, cellDayName, label, routes: daySched, events: dayEvts })
  }

  const renderCalendar = () => {
    const today = new Date()
    const cm = today.getMonth(), cy = today.getFullYear()
    const dim = new Date(cy, cm + 1, 0).getDate()
    const fdom = new Date(cy, cm, 1).getDay()
    const cells = []
    for (let i = 0; i < fdom; i++) cells.push(null)
    for (let i = 1; i <= dim; i++) cells.push(i)
    const dayFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '-.01em' }}>
            {today.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)', userSelect: 'none' }}>
              <input type="checkbox" checked={showSchedulesOnCalendar} onChange={e => setShowSchedulesOnCalendar(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              Show routes
            </label>
            <button className="rb-action-btn" onClick={() => setShowEventModal(true)}
              style={{ background: 'var(--accent)', color: '#0d1117', borderColor: 'transparent', padding: '6px 13px', fontSize: 12 }}>
              <IcoPlus size={13} color="#0d1117" /> Add Event
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {dayLabel.map((d, i) => (
            <div key={d} style={{
              textAlign: 'center', padding: '4px 0', fontSize: 11, fontWeight: 700,
              color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase'
            }}>
              <span className="cal-day-full">{d}</span>
              <span className="cal-day-short">{dayShort[i]}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} style={{ minHeight: 80, borderRadius: 8, background: 'var(--surface-2)', opacity: .2 }} />
            const isToday = d === today.getDate()
            const cellDayName = dayFull[new Date(cy, cm, d).getDay()]
            const dateStr = `${cy}-${String(cm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const daySched = showSchedulesOnCalendar ? schedules.filter(s => s.days?.includes(cellDayName)) : []
            const dayEvts = calendarEvents.filter(e => e.date === dateStr)
            const total = daySched.length + dayEvts.length
            const hasItems = total > 0
            return (
              <div
                key={i}
                onClick={() => openCalDayModal(d, dateStr, cellDayName, daySched, dayEvts)}
                style={{
                  borderRadius: 8, minHeight: 80, padding: '7px 6px',
                  background: isToday ? 'rgba(46,204,113,0.07)' : 'var(--surface-2)',
                  border: isToday ? '1.5px solid rgba(46,204,113,0.6)' : '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'background .12s, border-color .12s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = isToday ? 'rgba(46,204,113,0.12)' : 'var(--surface-3, #1e2633)'
                  e.currentTarget.style.borderColor = isToday ? 'rgba(46,204,113,0.8)' : 'var(--accent)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = isToday ? 'rgba(46,204,113,0.07)' : 'var(--surface-2)'
                  e.currentTarget.style.borderColor = isToday ? 'rgba(46,204,113,0.6)' : 'var(--border)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 800, lineHeight: 1,
                    width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%',
                    background: isToday ? 'var(--accent)' : 'transparent',
                    color: isToday ? '#0d1117' : 'var(--text)',
                  }}>{d}</span>
                  {total > 0 && (
                    <span style={{ fontSize: 9, fontWeight: 800, lineHeight: '14px', background: 'var(--surface-3,#1e2633)', color: 'var(--text-muted)', borderRadius: 10, padding: '0 5px', minWidth: 16, textAlign: 'center' }}>{total}</span>
                  )}
                </div>
                <div className="cal-events-full" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {daySched.slice(0, 2).map(s => (
                    <div key={'s' + s.id} title={s.barangay_names} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(93,173,226,0.1)', borderLeft: '2px solid #5dade2', borderRadius: '0 4px 4px 0', padding: '2px 5px', overflow: 'hidden' }}>
                      <IcoTruck size={9} color="#5dade2" />
                      <span style={{ fontSize: 9, fontWeight: 600, color: '#5dade2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.barangay_names}</span>
                    </div>
                  ))}
                  {dayEvts.slice(0, 1).map(e => (
                    <div key={'e' + e.id} title={e.title} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(243,156,18,0.1)', borderLeft: '2px solid #f39c12', borderRadius: '0 4px 4px 0', padding: '2px 5px', overflow: 'hidden' }}>
                      <IcoCal size={9} color="#f39c12" />
                      <span style={{ fontSize: 9, fontWeight: 600, color: '#f39c12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                    </div>
                  ))}
                  {total > 3 && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, paddingLeft: 2 }}>+{total - 3} more</span>}
                </div>
                <div className="cal-events-dots" style={{ display: 'none', gap: 3, flexWrap: 'wrap', marginTop: 4 }}>
                  {daySched.map(s => <div key={'d' + s.id} style={{ width: 6, height: 6, borderRadius: '50%', background: '#5dade2' }} />)}
                  {dayEvts.map(e => <div key={'d' + e.id} style={{ width: 6, height: 6, borderRadius: '50%', background: '#f39c12' }} />)}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 20, paddingTop: 2 }}>
          {[{ color: '#5dade2', Icon: IcoTruck, label: 'Route Schedule' }, { color: '#f39c12', Icon: IcoCal, label: 'Event' }].map(({ color, Icon: I, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-muted)' }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: color }} />
              <I size={12} color={color} />
              <span>{label}</span>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <IcoPin size={11} color="var(--text-muted)" />
            <span>Tap any date to see details</span>
          </div>
        </div>
      </div>
    )
  }

  const selectedDumpsite = dumpsites.find(d => String(d.id) === String(dumpsite))
  const selectedTruck = trucks.find(t => String(t.id) === String(truck))
  const selectedDriver = drivers.find(d => String(d.id) === String(driver))

  const orsStats = orsData?.segments?.[0]
    ? {
      distKm: (orsData.segments[0].distance / 1000).toFixed(1),
      durationMin: Math.round(orsData.segments[0].duration / 60),
    }
    : null

  return (
    <DashboardLayout>
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 22px',
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap',
          animation: 'fadeSlideIn .2s',
        }}>{toast}</div>
      )}

      <style>{`
  @keyframes fadeSlideIn {
    from { opacity:0; transform:translateX(-50%) translateY(-8px) }
    to   { opacity:1; transform:translateX(-50%) translateY(0) }
  }
  @keyframes modalIn {
    from { opacity:0; transform:scale(.96) translateY(8px) }
    to   { opacity:1; transform:scale(1) translateY(0) }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .rb-btn { transition: all .15s; cursor: pointer; }
  .rb-btn:hover { opacity: .85; }
  .rb-btn:active { transform: scale(.97); }
  .rb-stop-row:hover { background: var(--surface-2) !important; }

  .rb-builder-grid { display:grid; grid-template-columns:1fr 340px; gap:16px; align-items:start; }
  .rb-map-wrap { position:relative; border-radius:14px; overflow:hidden; height:540px; }
  .rb-map-mobile-toggle { display:none; }
  .rb-tab-bar { display:flex; background:var(--surface-2); padding:4px; border-radius:12px; gap:2px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
  .rb-tab-bar::-webkit-scrollbar { display:none; }
  .rb-stepper { display:flex; align-items:center; gap:0; margin-bottom:24px; overflow-x:auto; scrollbar-width:none; padding-bottom:4px; }
  .rb-stepper::-webkit-scrollbar { display:none; }

  .ors-pill {
    display:inline-flex; align-items:center; gap:5px;
    position:absolute; top:12px; right:52px; z-index:400;
    background:rgba(15,23,42,0.82); backdrop-filter:blur(4px);
    border-radius:20px; padding:4px 10px;
    font-size:10px; font-weight:700; letter-spacing:.04em;
    border:1px solid rgba(255,255,255,0.1);
  }
  .ors-spinner {
    width:10px; height:10px; border-radius:50%;
    border:2px solid rgba(46,204,113,0.3);
    border-top-color:#2ecc71;
    animation: spin .8s linear infinite;
    flex-shrink:0;
  }

  .cal-day-short { display:none; }
  .cal-day-full  { display:inline; }

  .rb-list-desktop { display:block; }
  .rb-list-mobile  { display:none; }
  .rb-list-row-hover { transition: background .12s; }
  .rb-list-row-hover:hover { background: var(--surface-2) !important; }

  .rb-action-btn {
    display: inline-flex; align-items: center; gap: 5px;
    border-radius: 7px; padding: 5px 11px;
    font-size: 11px; font-weight: 700; cursor: pointer;
    transition: all .15s; border: 1px solid transparent;
    font-family: var(--font-body);
  }
  .rb-action-btn:active { transform: scale(.96); }
  .rb-action-edit  { background: rgba(99,179,237,0.08); color: #63b3ed; border-color: rgba(99,179,237,0.2); }
  .rb-action-edit:hover  { background: rgba(99,179,237,0.15); }
  .rb-action-del   { background: rgba(231,76,60,0.06); color: #e05d5d; border-color: rgba(231,76,60,0.18); }
  .rb-action-del:hover   { background: rgba(231,76,60,0.12); }

  /* Cal day modal */
  .cal-day-modal-overlay {
    position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:9998;
    display:flex; align-items:center; justify-content:center; padding:16px;
  }
  .cal-day-modal {
    background:var(--surface); border:1px solid var(--border);
    border-radius:16px; padding:24px; width:100%; max-width:440px;
    max-height:80vh; overflow-y:auto;
    animation: modalIn .18s ease;
    box-shadow: 0 24px 64px rgba(0,0,0,.5);
  }

  @media (max-width: 768px) {
    .rb-builder-grid { grid-template-columns:1fr; }
    .rb-map-wrap { height:300px; display:none; }
    .rb-map-wrap.visible { display:block; }
    .rb-map-mobile-toggle {
      display:flex; align-items:center; justify-content:center; gap:8px;
      width:100%; padding:10px; margin-bottom:12px;
      border-radius:10px; border:1px solid var(--border);
      background:var(--surface-2);
      font-size:13px; font-weight:700; color:var(--text); cursor:pointer;
    }
    .rb-step-label { display:none; }
    .rb-step-connector { width:14px !important; }
  }
  @media (max-width: 680px) {
    .rb-list-desktop { display:none !important; }
    .rb-list-mobile  { display:flex !important; }
  }
  @media (max-width: 520px) {
    .cal-day-short { display:inline; }
    .cal-day-full  { display:none; }
    .cal-events-full { display:none !important; }
    .cal-events-dots { display:flex !important; }
  }
  @media (max-width: 480px) {
    .rb-page-header { flex-direction:column !important; gap:12px !important; }
    .rb-tab-bar { width:100%; }
  }
`}</style>

      <div className="page">

        {/* ── Header ── */}
        <div className="rb-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>Route Management</h2>
              <span style={{ background: 'rgba(93,173,226,0.1)', color: '#5dade2', border: '1px solid rgba(93,173,226,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>ADMIN</span>
            </div>
            <p className="text-muted text-sm" style={{ margin: 0 }}>Build and manage garbage collection schedules and routes.</p>
          </div>
          <div className="rb-tab-bar">
            {[
              { key: 'builder', label: 'Build Route' },
              { key: 'list', label: 'Scheduled Routes' },
              { key: 'calendar', label: 'Calendar' },
            ].map(t => (
              <button key={t.key} className="rb-btn" onClick={() => setActiveTab(t.key)} style={{
                padding: '8px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                background: activeTab === t.key ? 'var(--surface)' : 'transparent',
                color: activeTab === t.key ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: activeTab === t.key ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════
            BUILDER TAB
        ══════════════════════════════════════ */}
        {activeTab === 'builder' && (
          <>
            {/* Stepper */}
            <div className="rb-stepper" style={{ alignItems: 'center', marginBottom: 24 }}>
              {STEP_LABELS.map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <div
                    className="rb-btn"
                    onClick={() => i < step && setStep(i)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}
                    title={label}
                  >
                    <div style={{
                      width: i === step ? 12 : 8,
                      height: i === step ? 12 : 8,
                      borderRadius: '50%',
                      background: i < step ? 'var(--accent)' : i === step ? 'var(--accent)' : 'var(--surface-3,#1e2633)',
                      border: i === step ? '2px solid var(--accent)' : i < step ? '2px solid var(--accent)' : '2px solid var(--border)',
                      boxShadow: i === step ? '0 0 0 3px rgba(46,204,113,0.2)' : 'none',
                      transition: 'all .2s',
                      flexShrink: 0,
                    }} />
                    <span className="rb-step-label" style={{
                      fontSize: 10, fontWeight: i === step ? 700 : 500, letterSpacing: '.04em',
                      color: i === step ? 'var(--accent)' : i < step ? 'var(--text-muted)' : 'var(--text-muted)',
                      whiteSpace: 'nowrap', textTransform: 'uppercase',
                    }}>{label}</span>
                  </div>
                  {i < STEP_LABELS.length - 1 && (
                    <div className="rb-step-connector" style={{
                      width: 28, height: 1.5,
                      background: i < step ? 'var(--accent)' : 'var(--border)',
                      margin: '0 4px', marginBottom: 14, flexShrink: 0,
                      transition: 'background .2s',
                    }} />
                  )}
                </div>
              ))}
            </div>

            <button
              className="rb-map-mobile-toggle"
              onClick={() => {
                setShowMap(v => !v)
                setTimeout(() => { try { mapInst.current?.invalidateSize() } catch { } }, 50)
              }}
            >
              <IcoMap size={15} color="var(--text-muted)" />
              {showMap ? 'Hide Map' : 'Show Map'}
              {orsFetching && <span style={{ marginLeft: 4, width: 8, height: 8, borderRadius: '50%', border: '1.5px solid rgba(46,204,113,0.3)', borderTopColor: '#2ecc71', animation: 'spin .8s linear infinite', display: 'inline-block' }} />}
              <span style={{ marginLeft: 'auto', fontSize: 16, color: 'var(--text-muted)' }}>{showMap ? '▲' : '▼'}</span>
            </button>

            <div className="rb-builder-grid">

              {/* MAP */}
              <div className={`rb-map-wrap${showMap ? ' visible' : ''}`}>
                <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />

                {!mapReady && (
                  <div style={{ position: 'absolute', inset: 0, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
                    <span style={{ color: '#5dade2', fontWeight: 600 }}>Loading Map…</span>
                  </div>
                )}

                {stops.length > 0 && (
                  <div className="ors-pill" style={{ color: orsFetching ? '#f39c12' : orsData ? '#2ecc71' : '#94a3b8' }}>
                    {orsFetching ? (
                      <><div className="ors-spinner" /> Routing…</>
                    ) : orsData ? (
                      <><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2ecc71', display: 'inline-block' }} /> Road route</>
                    ) : (
                      <><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', display: 'inline-block' }} /> Straight line</>
                    )}
                  </div>
                )}

                {/* Map legend */}
                <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 400, background: 'rgba(15,23,42,0.9)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11, color: '#cbd5e1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>🏛️ <span>Start</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#1a2a3a', border: '2px solid #5dade2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5dade2', fontSize: 9, fontWeight: 800 }}>1</div>
                    <span>Stop (ordered)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>🏭 <span>Dumpsite</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 18, height: 2, background: '#2ecc71', borderRadius: 1 }} /><span>Route</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 18, height: 12, border: '2px solid #8b91ffff', borderRadius: 2, background: 'rgba(46,204,113,0.1)' }} />
                    <span>Geofence</span>
                  </div>
                </div>

                {step === 2 && (
                  <button className="rb-btn" onClick={() => setAddMode(a => !a)} style={{
                    position: 'absolute', top: 12, left: 12, zIndex: 400,
                    background: addMode ? '#f39c12' : 'rgba(15,23,42,0.92)',
                    color: addMode ? '#0d1117' : '#2ecc71',
                    border: '1px solid rgba(46,204,113,0.4)',
                    borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 12,
                  }}>
                    {addMode ? '✕ Click map to add stop' : '+ Add Stop'}
                  </button>
                )}
              </div>

              {/* SIDE PANEL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* STEP 0 */}
                {step === 0 && (
                  <div className="card" style={{ padding: 18 }}>
                    <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>1. Select Truck & Driver</h3>
                    <div style={{ marginBottom: 14 }}>
                      <label className="form-label">Truck</label>
                      <select className="form-input" value={truck} onChange={e => setTruck(e.target.value)}>
                        <option value="">— Select truck —</option>
                        {trucks.map(t => <option key={t.id} value={t.id}>{t.plate_number} · {t.model}</option>)}
                      </select>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <label className="form-label">Driver</label>
                      <select className="form-input" value={driver} onChange={e => setDriver(e.target.value)}>
                        <option value="">— Select driver —</option>
                        {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                      </select>
                    </div>
                    <div ref={barangayDropRef} style={{ position: 'relative' }}>
                      <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        <span>Barangays</span>
                        <span style={{ fontSize: 10, color: '#5dade2', fontWeight: 500 }}>Auto-detected on map click · Geofenced on map</span>
                      </label>

                      <div
                        onClick={() => setBarangayDropOpen(v => !v)}
                        style={{
                          minHeight: 40, background: 'var(--surface-2)', border: `1px solid ${barangayDropOpen ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 8, padding: '5px 8px', cursor: 'text',
                          display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center',
                          transition: 'border-color .15s',
                        }}
                      >
                        {barangays.filter(b => selectedBarangays.includes(b.id)).map(b => (
                          <span key={b.id} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            background: 'rgba(46,204,113,0.12)', color: '#2ecc71',
                            border: '1px solid rgba(46,204,113,0.3)',
                            borderRadius: 20, padding: '2px 8px 2px 10px', fontSize: 11, fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}>
                            {b.name}
                            <span
                              onClick={e => { e.stopPropagation(); setSelectedBarangays(prev => prev.filter(x => x !== b.id)) }}
                              style={{ cursor: 'pointer', opacity: .7, fontSize: 13, lineHeight: 1 }}
                            >×</span>
                          </span>
                        ))}
                        <input
                          value={barangaySearch}
                          onChange={e => { setBarangaySearch(e.target.value); setBarangayDropOpen(true) }}
                          onFocus={() => setBarangayDropOpen(true)}
                          onClick={e => e.stopPropagation()}
                          placeholder={selectedBarangays.length === 0 ? 'Search barangays…' : ''}
                          style={{
                            flex: 1, minWidth: 120, background: 'none', border: 'none', outline: 'none',
                            color: 'var(--text)', fontSize: 12, padding: '2px 4px',
                          }}
                        />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', userSelect: 'none' }}>
                          {barangayDropOpen ? '▲' : '▼'}
                        </span>
                      </div>

                      {barangayDropOpen && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 800,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                          borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: 'auto',
                          boxShadow: '0 8px 24px rgba(0,0,0,.3)',
                        }}>
                          {barangays
                            .filter(b => b.name.toLowerCase().includes(barangaySearch.toLowerCase()))
                            .map(b => {
                              const on = selectedBarangays.includes(b.id)
                              return (
                                <div
                                  key={b.id}
                                  onClick={() => {
                                    setSelectedBarangays(prev => on ? prev.filter(x => x !== b.id) : [...prev, b.id])
                                    setBarangaySearch('')
                                  }}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '9px 14px', cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 500,
                                    background: on ? 'rgba(46,204,113,0.07)' : 'transparent',
                                    color: on ? '#2ecc71' : 'var(--text)',
                                    transition: 'background .1s',
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = on ? 'rgba(46,204,113,0.12)' : 'var(--surface-2)'}
                                  onMouseLeave={e => e.currentTarget.style.background = on ? 'rgba(46,204,113,0.07)' : 'transparent'}
                                >
                                  <div style={{
                                    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                                    border: `2px solid ${on ? '#2ecc71' : 'var(--border)'}`,
                                    background: on ? '#2ecc71' : 'transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    {on && <span style={{ color: '#0d1117', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                                  </div>
                                  {b.name}
                                </div>
                              )
                            })}
                          {barangays.filter(b => b.name.toLowerCase().includes(barangaySearch.toLowerCase())).length === 0 && (
                            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No results</div>
                          )}
                        </div>
                      )}
                    </div>

                    {selectedBarangays.length > 0 && (
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.2)', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                        <div style={{ width: 14, height: 10, border: '1.5px solid #2ecc71', borderRadius: 2, background: 'rgba(46,204,113,0.15)', flexShrink: 0 }} />
                        <span>Geofence active — stops outside selected barangays will be blocked</span>
                      </div>
                    )}

                    {truck && driver && selectedBarangays.length > 0 && (
                      <div style={{ marginTop: 14, background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
                        <div style={{ fontWeight: 700, marginBottom: 3 }}>{selectedTruck?.plate_number} — {selectedTruck?.model}</div>
                        <div style={{ color: 'var(--text-muted)' }}>Driver: {selectedDriver?.full_name}</div>
                        <div style={{ color: 'var(--text-muted)' }}>Barangays: {barangays.filter(b => selectedBarangays.includes(b.id)).map(b => b.name).join(', ')}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 1 */}
                {step === 1 && (
                  <div className="card" style={{ padding: 18 }}>
                    <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>2. Set Schedule</h3>
                    <label className="form-label">Collection Days</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                      {DAYS.map(d => {
                        const on = days.includes(d)
                        return (
                          <button key={d} className="rb-btn"
                            onClick={() => setDays(prev => on ? prev.filter(x => x !== d) : [...prev, d])}
                            style={{ padding: '5px 12px', borderRadius: 20, border: '1px solid', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', borderColor: on ? 'var(--accent)' : 'var(--border)', color: on ? 'var(--accent)' : 'var(--text-muted)', background: on ? 'rgba(46,204,113,0.1)' : 'transparent' }}
                          >{d.slice(0, 3)}</button>
                        )
                      })}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label className="form-label">Start Time</label>
                        <input className="form-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
                      </div>
                      <div>
                        <label className="form-label">End Time</label>
                        <input className="form-input" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 2 */}
                {step === 2 && (
                  <div className="card" style={{ padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: 0 }}>3. Route Stops ({stops.length})</h3>
                      <button className="rb-btn btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => {
                        setAddMode(true)
                        setShowMap(true)
                        setTimeout(() => { try { mapInst.current?.invalidateSize() } catch { } }, 50)
                      }}>
                        + Add Stop
                      </button>
                    </div>
                    {stops.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                        Tap "+ Add Stop", then tap the map to place stops.
                      </div>
                    )}

                    {orsStats && stops.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        {[
                          { label: 'Distance', value: `${orsStats.distKm} km` },
                          { label: 'Est. time', value: `${orsStats.durationMin} min` },
                          { label: 'Stops', value: stops.length },
                        ].map(s => (
                          <div key={s.label} style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{s.value}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {orsFetching && stops.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 11, color: '#f39c12' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(243,156,18,0.3)', borderTopColor: '#f39c12', animation: 'spin .8s linear infinite' }} />
                        Calculating road route…
                      </div>
                    )}

                    <div style={{ padding: '10px 0 6px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 24, height: 24, background: '#1e2633', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, border: '1px solid #2ecc71' }}>🏛️</div>
                        <input
                          className="form-input"
                          value={startPoint.label}
                          onChange={e => setStartPoint(p => ({ ...p, label: e.target.value }))}
                          style={{ flex: 1, padding: '4px 8px', fontSize: 12, borderColor: 'rgba(46,204,113,0.3)' }}
                          placeholder="Start location label"
                        />
                        <span style={{ fontSize: 10, color: '#2ecc71', fontWeight: 700, flexShrink: 0 }}>START</span>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 32, cursor: 'pointer', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={universalStart}
                          onChange={e => {
                            setUniversalStart(e.target.checked)
                            if (e.target.checked) showToast('🌐 Start location will apply to all truck routes')
                          }}
                          style={{ accentColor: 'var(--accent)', width: 13, height: 13 }}
                        />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                          Apply this Start location to all truck routes
                        </span>
                      </label>
                    </div>

                    {stops.map((s, i) => (
                      <div key={i} className="rb-stop-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        {/* Numbered badge matching map marker */}
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: '#1a2a3a', border: '2px solid #5dade2',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 800, color: '#5dade2',
                          flexShrink: 0,
                        }}>{i + 1}</div>
                        <input
                          className="form-input"
                          value={s.label}
                          onChange={e => setStops(prev => prev.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                          style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                          placeholder="Optional label…"
                        />
                        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                          <button className="rb-btn" onClick={() => removeStop(i)} style={{ background: 'none', border: 'none', color: '#e74c3c', fontSize: 16 }}>×</button>
                        </div>
                      </div>
                    ))}

                    {stops.length > 1 && (
                      <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.15)', borderRadius: 7, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <IcoRoute size={11} color="#2ecc71" />
                        <span>Order auto-optimized by proximity · Numbers match map markers</span>
                      </div>
                    )}

                    {/* Manual coordinate entry */}
                    <div style={{ marginTop: 4, paddingLeft: 32 }}>
                      <button
                        className="rb-btn"
                        onClick={() => setShowManualCoords(v => !v)}
                        style={{ background: 'none', border: 'none', color: '#5dade2', fontSize: 11, fontWeight: 600, padding: 0, cursor: 'pointer' }}
                      >
                        {showManualCoords ? '▲ Hide' : '▼ Enter manual coordinates'}
                      </button>
                      {showManualCoords && (
                        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
                          <div>
                            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>Latitude</label>
                            <input className="form-input" value={manualCoords.lat} onChange={e => setManualCoords(p => ({ ...p, lat: e.target.value }))} placeholder="e.g. 13.9350" style={{ fontSize: 12, padding: '5px 8px' }} type="number" step="0.000001" />
                          </div>
                          <div>
                            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>Longitude</label>
                            <input className="form-input" value={manualCoords.lng} onChange={e => setManualCoords(p => ({ ...p, lng: e.target.value }))} placeholder="e.g. 121.617" style={{ fontSize: 12, padding: '5px 8px' }} type="number" step="0.000001" />
                          </div>
                          <button className="rb-btn btn btn-primary btn-sm" style={{ fontSize: 11, padding: '6px 10px', whiteSpace: 'nowrap' }}
                            onClick={() => {
                              const lat = parseFloat(manualCoords.lat)
                              const lng = parseFloat(manualCoords.lng)
                              if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) { showToast('❌ Invalid coordinates'); return }
                              setStartPoint(p => ({ ...p, lat, lng }))
                              if (mapInst.current) { mapInst.current.panTo([lat, lng]); setShowMap(true); setTimeout(() => { try { mapInst.current?.invalidateSize() } catch { } }, 50) }
                              showToast('📍 Start moved to coordinates')
                              setShowManualCoords(false); setManualCoords({ lat: '', lng: '' })
                            }}>
                            Set
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* STEP 3 */}
                {step === 3 && (
                  <div className="card" style={{ padding: 18 }}>
                    <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>4. Select Dumpsite</h3>
                    {dumpsites.map(ds => (
                      <div key={ds.id} className="rb-btn" onClick={() => setDumpsite(ds.id)} style={{
                        border: `1.5px solid ${String(dumpsite) === String(ds.id) ? '#e74c3c' : 'var(--border)'}`,
                        background: String(dumpsite) === String(ds.id) ? 'rgba(231,76,60,0.07)' : 'var(--surface)',
                        borderRadius: 10, padding: '12px 14px', marginBottom: 10,
                        display: 'flex', alignItems: 'center', gap: 12,
                      }}>
                        <span style={{ fontSize: 22 }}>🏭</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{ds.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(+ds.latitude).toFixed(4)}, {(+ds.longitude).toFixed(4)}</div>
                        </div>
                        {String(dumpsite) === String(ds.id) && <span style={{ marginLeft: 'auto', color: '#e74c3c', fontWeight: 800 }}>✓</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* STEP 4 — Preview */}
                {step === 4 && (
                  <div className="card" style={{ padding: 18 }}>
                    <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>5. Route Summary</h3>
                    {orsStats && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                        <div style={{ background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.2)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: '#2ecc71' }}>{orsStats.distKm} km</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Total distance</div>
                        </div>
                        <div style={{ background: 'rgba(93,173,226,0.08)', border: '1px solid rgba(93,173,226,0.2)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: '#5dade2' }}>{orsStats.durationMin} min</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Estimated time</div>
                        </div>
                      </div>
                    )}
                    {orsFetching && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 11, color: '#f39c12' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(243,156,18,0.3)', borderTopColor: '#f39c12', animation: 'spin .8s linear infinite' }} />
                        Calculating road route for preview…
                      </div>
                    )}
                    {!orsData && !orsFetching && stops.length > 0 && !ORS_API_KEY && (
                      <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.25)', borderRadius: 8, fontSize: 11, color: '#f39c12' }}>
                        ⚠️ Add <code>VITE_ORS_API_KEY</code> to enable real road routing
                      </div>
                    )}

                    <div style={{ marginBottom: 14 }}>
                      {[
                        { label: 'Truck', value: `${selectedTruck?.plate_number} — ${selectedTruck?.model}` },
                        { label: 'Driver', value: selectedDriver?.full_name },
                        { label: 'Days', value: days.join(', ') },
                        { label: 'Time', value: `${time} – ${endTime}` },
                        { label: 'Stops', value: `${stops.length} collection points` },
                        { label: 'Dumpsite', value: selectedDumpsite?.name },
                      ].map(r => (
                        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, flexShrink: 0 }}>{r.label.toUpperCase()}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{r.value || '—'}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.9 }}>
                      🏛️ Home Base
                      {stops.map((s, i) => (
                        <span key={i}> → <span style={{ color: '#5dade2', fontWeight: 700 }}>#{i + 1}</span> {s.label || `Stop ${i + 1}`}</span>
                      ))}
                      {selectedDumpsite && <> → 🏭 {selectedDumpsite.name}</>}
                      {' → 🏛️ Return'}
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                      <IcoMap size={12} color="var(--text-muted)" />
                      <span>{orsData ? 'Road route shown on map above' : 'View route on the map'}</span>
                    </div>

                    {saved && (
                      <div style={{ marginTop: 14, background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#2ecc71', textAlign: 'center' }}>
                        ✅ Route saved successfully!
                      </div>
                    )}
                  </div>
                )}

                {/* Nav buttons */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="rb-btn btn btn-outline" style={{ fontSize: 12, padding: '8px 14px' }} onClick={handleCancel} title="Discard and return to Scheduled Routes">Cancel</button>
                  {step > 0 && (
                    <button className="rb-btn btn btn-outline" style={{ flex: 1 }} onClick={() => { setStep(s => s - 1); setSaved(false) }}>← Back</button>
                  )}
                  {step < 4 ? (
                    <button className="rb-btn btn btn-primary" style={{ flex: 1, opacity: canNext() ? 1 : 0.4 }} disabled={!canNext()} onClick={() => setStep(s => s + 1)}>
                      Next →
                    </button>
                  ) : (
                    <button className="rb-btn btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saved}>
                      {saved ? '✅ Saved' : '💾 Save Route'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════
            LIST TAB
        ══════════════════════════════════════ */}
        {activeTab === 'list' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="rb-list-desktop">
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1.8fr 0.85fr 1fr 1.3fr 0.9fr 0.45fr 0.9fr',
                padding: '11px 20px',
                background: 'var(--surface-2)',
                borderBottom: '1px solid var(--border)',
                fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
                textTransform: 'uppercase', color: 'var(--text-muted)',
                alignItems: 'center',
              }}>
                <span>Barangays</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IcoTruck size={10} /> Truck</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IcoUser size={10} /> Driver</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IcoCal size={10} /> Days</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><IcoClock size={10} /> Time</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}><IcoPin size={10} /></div>
                <span style={{ textAlign: 'right' }}>Actions</span>
              </div>

              {schedLoading ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  <IcoRoute size={28} color="var(--text-muted)" />
                  <div style={{ marginTop: 10 }}>Loading schedules…</div>
                </div>
              ) : schedules.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  <IcoRoute size={28} color="var(--text-muted)" />
                  <div style={{ marginTop: 10, fontWeight: 600 }}>No scheduled routes yet</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Create one in the Build Route tab.</div>
                </div>
              ) : schedules.map((s, idx) => (
                <div key={s.id} className="rb-list-row-hover" style={{
                  display: 'grid',
                  gridTemplateColumns: '1.8fr 0.85fr 1fr 1.3fr 0.9fr 0.45fr 0.9fr',
                  padding: '13px 20px', alignItems: 'center',
                  borderBottom: idx < schedules.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div><div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{s.barangay_names || '—'}</div></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{s.truck_plate || '—'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.driver_name || '—'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {(s.days || '').split(', ').filter(Boolean).map(day => (
                      <span key={day} style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', background: 'var(--surface-3,#1e2633)', color: 'var(--text-muted)', borderRadius: 4, padding: '2px 6px' }}>{day.slice(0, 3)}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#5dade2' }}>{Array.isArray(s.waypoints) ? s.waypoints.length : 0}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button className="rb-action-btn rb-action-edit" onClick={() => handleEdit(s)}><IcoEdit size={11} /> Edit</button>
                    <button className="rb-action-btn rb-action-del" onClick={() => handleDelete(s)}><IcoTrash size={11} /> Delete</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rb-list-mobile" style={{ flexDirection: 'column' }}>
              {schedLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
              ) : schedules.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No routes yet. Build one first.</div>
              ) : schedules.map((s, idx) => (
                <div key={s.id} style={{ padding: '16px', borderBottom: idx < schedules.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.35, flex: 1 }}>{s.barangay_names || '—'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(93,173,226,0.1)', color: '#5dade2', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                      <IcoPin size={10} color="#5dade2" />
                      {Array.isArray(s.waypoints) ? s.waypoints.length : 0}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {[
                      { Icon: IcoTruck, val: s.truck_plate },
                      { Icon: IcoUser, val: s.driver_name },
                      { Icon: IcoClock, val: s.start_time?.slice(0, 5) && `${s.start_time.slice(0, 5)}–${s.end_time?.slice(0, 5)}` },
                    ].filter(m => m.val).map(({ Icon: I, val }, mi) => (
                      <span key={mi} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--surface-3,#1e2633)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 10px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                        <I size={11} color="var(--text-muted)" /> {val}
                      </span>
                    ))}
                    {(s.days || '').split(', ').filter(Boolean).map(day => (
                      <span key={day} style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--surface-3,#1e2633)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 10px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>{day.slice(0, 3)}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="rb-btn" onClick={() => handleEdit(s)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(99,179,237,0.08)', color: '#63b3ed', border: '1px solid rgba(99,179,237,0.2)', borderRadius: 9, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                      <IcoEdit size={13} color="#63b3ed" /> Edit
                    </button>
                    <button className="rb-btn" onClick={() => handleDelete(s)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(231,76,60,0.06)', color: '#e05d5d', border: '1px solid rgba(231,76,60,0.18)', borderRadius: 9, padding: '9px', fontSize: 12, fontWeight: 700 }}>
                      <IcoTrash size={13} color="#e05d5d" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            CALENDAR TAB
        ══════════════════════════════════════ */}
        {activeTab === 'calendar' && (
          <div className="card" style={{ padding: 20 }}>
            {renderCalendar()}
          </div>
        )}
      </div>

      {/* ── ADD EVENT MODAL ── */}
      {showEventModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '100%', maxWidth: 400, padding: 24, animation: 'modalIn .18s ease' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>Create Calendar Event</h3>
            <form onSubmit={handleCreateEvent} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label className="form-label">Event Title</label><input required className="form-input" value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="e.g. Clean-up Drive" /></div>
              <div><label className="form-label">Date</label><input required type="date" className="form-input" value={newEvent.date} onChange={e => setNewEvent({ ...newEvent, date: e.target.value })} /></div>
              <div><label className="form-label">Location (Optional)</label><input className="form-input" value={newEvent.location} onChange={e => setNewEvent({ ...newEvent, location: e.target.value })} placeholder="e.g. Quezon Park" /></div>
              <div>
                <label className="form-label">Assign Personnel (Optional)</label>
                <select className="form-input" value={newEvent.assigned_to} onChange={e => setNewEvent({ ...newEvent, assigned_to: e.target.value })}>
                  <option value="">— No specific assignment —</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowEventModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Save Event</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CALENDAR DAY DETAIL MODAL ── */}
      {calDayModal && (
        <div
          className="cal-day-modal-overlay"
          onClick={e => { if (e.target === e.currentTarget) setCalDayModal(null) }}
        >
          <div className="cal-day-modal">
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 4 }}>
                  {calDayModal.cellDayName}
                </div>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{calDayModal.label.split('·')[0].trim()}</h3>
              </div>
              <button
                onClick={() => setCalDayModal(null)}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
              >
                <IcoX size={14} />
              </button>
            </div>

            {/* Route schedules */}
            {calDayModal.routes.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#5dade2', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IcoTruck size={11} color="#5dade2" /> Route Schedules ({calDayModal.routes.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {calDayModal.routes.map(s => (
                    <div key={s.id} style={{ background: 'rgba(93,173,226,0.07)', border: '1px solid rgba(93,173,226,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', lineHeight: 1.3, flex: 1, paddingRight: 8 }}>
                          {s.barangay_names || 'No barangays'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(93,173,226,0.15)', color: '#5dade2', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                          <IcoPin size={9} color="#5dade2" />
                          {Array.isArray(s.waypoints) ? s.waypoints.length : 0} stops
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {s.truck_plate && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-3,#1e2633)', borderRadius: 20, padding: '3px 9px', fontWeight: 600 }}>
                            <IcoTruck size={10} color="var(--text-muted)" /> {s.truck_plate}
                          </span>
                        )}
                        {s.driver_name && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-3,#1e2633)', borderRadius: 20, padding: '3px 9px', fontWeight: 600 }}>
                            <IcoUser size={10} color="var(--text-muted)" /> {s.driver_name}
                          </span>
                        )}
                        {s.start_time && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-3,#1e2633)', borderRadius: 20, padding: '3px 9px', fontWeight: 600 }}>
                            <IcoClock size={10} color="var(--text-muted)" /> {s.start_time.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Calendar events */}
            {calDayModal.events.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#f39c12', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IcoCal size={11} color="#f39c12" /> Events ({calDayModal.events.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {calDayModal.events.map(ev => (
                    <div key={ev.id} style={{ background: 'rgba(243,156,18,0.07)', border: '1px solid rgba(243,156,18,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>{ev.title}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {ev.location && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-3,#1e2633)', borderRadius: 20, padding: '3px 9px', fontWeight: 600 }}>
                            <IcoPin size={10} color="var(--text-muted)" /> {ev.location}
                          </span>
                        )}
                        {ev.assigned_to_name && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-3,#1e2633)', borderRadius: 20, padding: '3px 9px', fontWeight: 600 }}>
                            <IcoUser size={10} color="var(--text-muted)" /> {ev.assigned_to_name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {calDayModal.routes.length === 0 && calDayModal.events.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                <IcoCal size={32} color="var(--text-muted)" />
                <div style={{ marginTop: 12, fontWeight: 600, fontSize: 14 }}>Nothing scheduled</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>No routes or events for this day.</div>
                <button
                  className="rb-action-btn"
                  style={{ marginTop: 16, background: 'var(--accent)', color: '#0d1117', borderColor: 'transparent' }}
                  onClick={() => { setCalDayModal(null); setNewEvent(n => ({ ...n, date: calDayModal.dateStr })); setShowEventModal(true) }}
                >
                  <IcoPlus size={12} color="#0d1117" /> Add Event for this day
                </button>
              </div>
            )}

            {/* Footer actions */}
            {(calDayModal.routes.length > 0 || calDayModal.events.length > 0) && (
              <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
                <button
                  className="rb-action-btn"
                  style={{ background: 'rgba(243,156,18,0.08)', color: '#f39c12', borderColor: 'rgba(243,156,18,0.2)' }}
                  onClick={() => { setCalDayModal(null); setNewEvent(n => ({ ...n, date: calDayModal.dateStr })); setShowEventModal(true) }}
                >
                  <IcoPlus size={11} /> Add Event
                </button>
                <button
                  className="rb-action-btn"
                  style={{ marginLeft: 'auto', background: 'var(--surface-2)', color: 'var(--text-muted)', borderColor: 'var(--border)' }}
                  onClick={() => setCalDayModal(null)}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}