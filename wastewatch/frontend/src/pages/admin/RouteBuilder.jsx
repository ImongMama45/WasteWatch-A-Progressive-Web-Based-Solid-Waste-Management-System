import { useEffect, useRef, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import { useTrucks } from '../../hooks/useTrucks'
import { useUsers } from '../../hooks/useUsers'
import { useDumpsites } from '../../hooks/useDumpsites'
import api from '../../api/client'

const LUCENA_CENTER = [13.9373, 121.617]
const HOME_BASE = { lat: 13.9373, lng: 121.617, label: 'City Hall — Home Base' }

// --- Ray Casting for Auto-Detect ---
function pointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function detectBarangay(lat, lng, geoJson) {
  if (!geoJson || !geoJson.features) return null;
  for (const feature of geoJson.features) {
    if (feature.geometry.type === 'Polygon') {
      const coords = feature.geometry.coordinates[0];
      if (pointInPolygon([lng, lat], coords)) return feature.properties.brgy_name;
    } else if (feature.geometry.type === 'MultiPolygon') {
      for (const poly of feature.geometry.coordinates) {
        if (pointInPolygon([lng, lat], poly[0])) return feature.properties.brgy_name;
      }
    }
  }
  return null;
}
// ------------------------------------

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const STEP_LABELS = ['Truck & Driver','Schedule','Route Stops','Dumpsite','Preview & Save']

export default function RouteBuilder() {
  const mapRef      = useRef(null)
  const mapInst     = useRef(null)
  const layersRef   = useRef([])

  const [step, setStep]         = useState(0)
  const [mapReady, setMapReady] = useState(false)
  const [toast, setToast]       = useState(null)
  const [saved, setSaved]       = useState(false)

  // Tabs & Data
  const [activeTab, setActiveTab] = useState('builder') // 'builder' | 'list'
  const [schedules, setSchedules] = useState([])
  const [schedLoading, setSchedLoading] = useState(false)
  const [barangays, setBarangays] = useState([])
  const [barangayGeo, setBarangayGeo] = useState(null)
  
  // Calendar State
  const [calendarEvents, setCalendarEvents] = useState([])
  const [showSchedulesOnCalendar, setShowSchedulesOnCalendar] = useState(true)
  const [showEventModal, setShowEventModal] = useState(false)
  const [newEvent, setNewEvent] = useState({ title: '', date: '', location: '', assigned_to: '' })

  // API Data
  const { trucks } = useTrucks()
  const { drivers } = useUsers()
  const { sites: dumpsites } = useDumpsites()

  // Form state
  const [editId,   setEditId]   = useState(null)
  const [truck,    setTruck]    = useState('')
  const [driver,   setDriver]   = useState('')
  const [selectedBarangays, setSelectedBarangays] = useState([])
  const [days,     setDays]     = useState([])
  const [time,     setTime]     = useState('06:00')
  const [endTime,  setEndTime]  = useState('14:00')
  const [startPoint, setStartPoint] = useState(HOME_BASE)
  const [stops,    setStops]    = useState([])   // [{lat,lng,label}]
  const [dumpsite, setDumpsite] = useState('')
  const [addMode,  setAddMode]  = useState(false)

  // Refs for map event listeners
  const addModeRef = useRef(addMode)
  useEffect(() => { addModeRef.current = addMode }, [addMode])
  
  const stopsRef = useRef(stops)
  useEffect(() => { stopsRef.current = stops }, [stops])

  const barangaysRef = useRef(barangays)
  useEffect(() => { barangaysRef.current = barangays }, [barangays])

  const selectedBarangaysRef = useRef(selectedBarangays)
  useEffect(() => { selectedBarangaysRef.current = selectedBarangays }, [selectedBarangays])

  const barangayGeoRef = useRef(barangayGeo)
  useEffect(() => { barangayGeoRef.current = barangayGeo }, [barangayGeo])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Fetch initial lookups
  useEffect(() => {
    api.get('/api/barangays/').then(res => setBarangays(res.data)).catch(console.error)
    fetch('/data/lucena_barangays.geojson').then(r => r.json()).then(setBarangayGeo).catch(console.error)
  }, [])

  // Fetch schedules
  const fetchSchedules = () => {
    setSchedLoading(true)
    api.get('/api/driver/collection-schedules/')
      .then(res => setSchedules(res.data))
      .catch(console.error)
      .finally(() => setSchedLoading(false))
  }

  const fetchCalendarEvents = () => {
    api.get('/api/driver/calendar-events/')
      .then(res => setCalendarEvents(res.data))
      .catch(console.error)
  }

  useEffect(() => {
    if (activeTab === 'list' || activeTab === 'calendar') {
      fetchSchedules()
      if (activeTab === 'calendar') fetchCalendarEvents()
    }
  }, [activeTab])

  // Load Leaflet
  useEffect(() => {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    s.onload = () => setMapReady(true)
    document.head.appendChild(s)
  }, [])

  // Init map
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInst.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    map.on('click', e => {
      if (!addModeRef.current) return
      const { lat, lng } = e.latlng
      const label = `Stop ${stopsRef.current.length + 1}`

      const detectedName = detectBarangay(lat, lng, barangayGeoRef.current)
      if (detectedName) {
         const b = barangaysRef.current.find(x => x.name === detectedName)
         if (b && !selectedBarangaysRef.current.includes(b.id)) {
           setSelectedBarangays(prev => [...prev, b.id])
           showToast(`📍 Auto-added Barangay: ${b.name}`)
         }
      }

      setStops(prev => [...prev, { lat, lng, label }])
      setAddMode(false)
    })
    mapInst.current = map
  }, [mapReady])

  // Redraw route on map
  useEffect(() => {
    if (!mapInst.current) return
    const L = window.L
    const map = mapInst.current
    layersRef.current.forEach(l => { try { map.removeLayer(l) } catch {} })
    layersRef.current = []

    const ds = dumpsites.find(d => String(d.id) === String(dumpsite))
    const allPoints = [
      startPoint,
      ...stops,
      ...(ds ? [{ lat: parseFloat(ds.latitude), lng: parseFloat(ds.longitude), label: ds.name }] : []),
      startPoint,
    ]

    // Home base marker
    const homeIcon = L.divIcon({
      html: `<div style="background:#1e2633;border:2px solid #2ecc71;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 3px 8px rgba(0,0,0,.4);">🏛️</div>`,
      className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    })
    const hm = L.marker([startPoint.lat, startPoint.lng], { icon: homeIcon, draggable: true }).addTo(map)
    hm.bindPopup('<b>Start Point</b><br>' + startPoint.label)
    hm.on('dragend', e => {
      const { lat, lng } = e.target.getLatLng()
      setStartPoint(prev => ({ ...prev, lat, lng }))
    })
    layersRef.current.push(hm)

    // Stop markers
    stops.forEach((stop, i) => {
      const icon = L.divIcon({
        html: `<div style="background:#5dade2;border:2px solid white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:800;box-shadow:0 3px 8px rgba(0,0,0,.4);">${i + 1}</div>`,
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      })
      const m = L.marker([stop.lat, stop.lng], { icon, draggable: true }).addTo(map)
      m.bindPopup(`<b>${stop.label}</b>`)
      m.on('dragend', e => {
        const { lat, lng } = e.target.getLatLng()
        setStops(prev => prev.map((s, idx) => idx === i ? { ...s, lat, lng } : s))
      })
      layersRef.current.push(m)
    })

    // Dumpsite marker
    if (ds) {
      const dsIcon = L.divIcon({
        html: `<div style="background:#e74c3c;border:2px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 3px 8px rgba(0,0,0,.4);">🏭</div>`,
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      })
      const dm = L.marker([parseFloat(ds.latitude), parseFloat(ds.longitude)], { icon: dsIcon }).addTo(map)
      dm.bindPopup(`<b>${ds.name}</b>`)
      layersRef.current.push(dm)
    }

    // Route line
    if (allPoints.length > 1) {
      const coords = allPoints.map(p => [p.lat, p.lng])
      const line = L.polyline(coords, { color: '#2ecc71', weight: 4, opacity: 0.85, dashArray: '10,6' }).addTo(map)
      layersRef.current.push(line)
      if (step >= 2) map.fitBounds(line.getBounds(), { padding: [40, 40] })
    }
  }, [stops, dumpsite, mapReady, step, startPoint])

  // cursor
  useEffect(() => {
    if (!mapInst.current) return
    mapInst.current.getContainer().style.cursor = addMode ? 'crosshair' : ''
  }, [addMode])

  function removeStop(i) {
    setStops(prev => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, label: `Stop ${idx + 1}` })))
  }

  function moveStop(i, dir) {
    setStops(prev => {
      const arr = [...prev]
      const to = i + dir
      if (to < 0 || to >= arr.length) return arr;
      [arr[i], arr[to]] = [arr[to], arr[i]]
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

  async function handleSave() {
    try {
      const combinedWaypoints = [startPoint, ...stops]
      const payload = {
        truck, driver, barangays: selectedBarangays, dumpsite,
        days: days.join(', '), start_time: time, end_time: endTime,
        waypoints: combinedWaypoints
      }
      
      if (editId) {
        await api.patch(`/api/driver/collection-schedules/${editId}/`, payload)
      } else {
        await api.post('/api/driver/collection-schedules/', payload)
      }
      
      const ds = dumpsites.find(d => String(d.id) === String(dumpsite))
      const truckObj = trucks.find(t => String(t.id) === String(truck))
      setSaved(true)
      showToast(`✅ Route ${editId ? 'updated' : 'saved'}! ${truckObj?.plate_number} · ${stops.length} stops`)
      
      // Reset form after a brief moment
      setTimeout(() => {
        setStep(0); setEditId(null); setTruck(''); setDriver(''); setSelectedBarangays([]); 
        setDays([]); setStops([]); setDumpsite(''); setSaved(false); setStartPoint(HOME_BASE);
      }, 2000)
    } catch (err) {
      showToast(`❌ Failed to ${editId ? 'update' : 'save'} schedule.`)
      console.error(err)
    }
  }

  function handleEdit(s) {
    setActiveTab('builder')
    setEditId(s.id)
    setTruck(s.truck || '')
    setDriver(s.driver || '')
    setSelectedBarangays(s.barangays || [])
    setDays(s.days ? s.days.split(', ') : [])
    setTime(s.start_time ? s.start_time.slice(0,5) : '06:00')
    setEndTime(s.end_time ? s.end_time.slice(0,5) : '14:00')
    setDumpsite(s.dumpsite || '')
    
    // Parse waypoints back into startPoint and stops
    if (s.waypoints && s.waypoints.length > 0) {
      const wps = [...s.waypoints]
      setStartPoint(wps.shift()) // First waypoint is startPoint
      setStops(wps)
    } else {
      setStartPoint(HOME_BASE)
      setStops([])
    }
  }

  function handleView(s) {
    handleEdit(s)
    // You could also add a read-only mode flag here if desired.
  }

  const handleCreateEvent = async (e) => {
    e.preventDefault()
    try {
      await api.post('/api/driver/calendar-events/', newEvent)
      showToast('✅ Event created!')
      setShowEventModal(false)
      setNewEvent({ title: '', date: '', location: '', assigned_to: '' })
      fetchCalendarEvents()
    } catch (err) {
      console.error(err)
      showToast('❌ Failed to create event')
    }
  }

  const renderCalendar = () => {
    const today = new Date()
    const currentMonth = today.getMonth()
    const currentYear = today.getFullYear()
    
    // Get days in month
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay() // 0 = Sunday
    
    const days = []
    for (let i = 0; i < firstDayOfMonth; i++) days.push(null)
    for (let i = 1; i <= daysInMonth; i++) days.push(i)

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{today.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
          {dayNames.map(d => (
            <div key={d} style={{ fontWeight: 800, fontSize: 12, textAlign: 'center', padding: '8px 0', color: 'var(--text-muted)' }}>{d}</div>
          ))}
          {days.map((d, i) => {
            if (!d) return <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, minHeight: 100, opacity: 0.3 }} />
            
            const cellDate = new Date(currentYear, currentMonth, d)
            const cellDayName = cellDate.toLocaleDateString('en-US', { weekday: 'long' })
            
            // Format to YYYY-MM-DD avoiding timezone offset issues
            const cellDateString = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

            const daySchedules = showSchedulesOnCalendar ? schedules.filter(s => s.days && s.days.includes(cellDayName)) : []
            const dayEvents = calendarEvents.filter(e => e.date === cellDateString)

            return (
              <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, minHeight: 100, padding: 8, border: d === today.getDate() ? '2px solid var(--accent)' : '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, color: d === today.getDate() ? 'var(--accent)' : 'var(--text)' }}>{d}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, overflowY: 'auto' }}>
                  {daySchedules.map(s => (
                    <div key={'s'+s.id} style={{ fontSize: 10, background: 'rgba(93,173,226,0.1)', color: '#5dade2', padding: '4px 6px', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.barangay_names}>
                      🚛 {s.barangay_names}
                    </div>
                  ))}
                  {dayEvents.map(e => (
                    <div key={'e'+e.id} style={{ fontSize: 10, background: 'rgba(243,156,18,0.1)', color: '#f39c12', padding: '4px 6px', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.title + (e.location ? ` @ ${e.location}` : '')}>
                      📅 {e.title}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const selectedDumpsite = dumpsites.find(d => String(d.id) === String(dumpsite))
  const selectedTruck    = trucks.find(t => String(t.id) === String(truck))
  const selectedDriver   = drivers.find(d => String(d.id) === String(driver))

  return (
    <DashboardLayout>
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 22px',
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      <style>{`
        .rb-btn { transition:all .15s; cursor:pointer; }
        .rb-btn:hover { opacity:.85; }
        .rb-btn:active { transform:scale(.97); }
        .rb-stop-row:hover { background:var(--surface-2) !important; }
      `}</style>

      <div className="page">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                Route Management
              </h2>
              <span style={{ background: 'rgba(93,173,226,0.1)', color: '#5dade2', border: '1px solid rgba(93,173,226,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>ADMIN</span>
            </div>
            <p className="text-muted text-sm">Build and manage garbage collection schedules and routes.</p>
          </div>

          <div style={{ display: 'flex', background: 'var(--surface-2)', padding: 4, borderRadius: 12 }}>
            <button className="rb-btn" onClick={() => setActiveTab('builder')} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700,
              background: activeTab === 'builder' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'builder' ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: activeTab === 'builder' ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
            }}>
              🏗️ Build Route
            </button>
            <button className="rb-btn" onClick={() => setActiveTab('list')} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700,
              background: activeTab === 'list' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'list' ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: activeTab === 'list' ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
            }}>
              📋 Scheduled Routes
            </button>
            <button className="rb-btn" onClick={() => setActiveTab('calendar')} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700,
              background: activeTab === 'calendar' ? 'var(--surface)' : 'transparent',
              color: activeTab === 'calendar' ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: activeTab === 'calendar' ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
            }}>
              📅 Calendar
            </button>
          </div>
        </div>

        {activeTab === 'builder' ? (
          <>
            {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24, overflowX: 'auto' }}>
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div
                className="rb-btn"
                onClick={() => i < step && setStep(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 12,
                  background: i < step ? 'var(--accent)' : i === step ? 'var(--surface-3, #1e2633)' : 'var(--surface-2)',
                  color: i < step ? '#0d1117' : i === step ? '#fff' : 'var(--text-muted)',
                  border: i === step ? '2px solid var(--accent)' : '2px solid transparent',
                }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: 12, fontWeight: i === step ? 700 : 500, color: i === step ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div style={{ width: 24, height: 2, background: i < step ? 'var(--accent)' : 'var(--border)', margin: '0 8px', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

          {/* MAP */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 14, height: 540, position: 'relative' }}>
            <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
            {!mapReady && (
              <div style={{ position: 'absolute', inset: 0, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
                <span style={{ color: '#5dade2', fontWeight: 600 }}>Loading Map…</span>
              </div>
            )}
            {/* Legend */}
            <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 400, background: 'rgba(15,23,42,0.9)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11, color: '#cbd5e1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>🏛️ <span>Home Base</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><div style={{ width: 18, height: 18, borderRadius: '50%', background: '#5dade2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800 }}>N</div><span>Stop</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>🏭 <span>Dumpsite</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 18, height: 2, background: '#2ecc71', borderTop: '2px dashed #2ecc71' }} /><span>Route</span></div>
            </div>
            {step === 2 && (
              <button
                className="rb-btn"
                onClick={() => setAddMode(a => !a)}
                style={{
                  position: 'absolute', top: 12, left: 12, zIndex: 400,
                  background: addMode ? '#f39c12' : 'rgba(15,23,42,0.92)',
                  color: addMode ? '#0d1117' : '#2ecc71',
                  border: '1px solid rgba(46,204,113,0.4)',
                  borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 12,
                  fontFamily: 'var(--font-body)',
                }}
              >
                {addMode ? '✕ Click map to add stop' : '+ Add Stop'}
              </button>
            )}
          </div>

          {/* SIDE PANEL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* STEP 0 — Truck & Driver */}
            {step === 0 && (
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>
                  1. Select Truck & Driver
                </h3>
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
                <div>
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Barangays</span>
                    <span style={{ fontSize: 10, color: '#5dade2', fontWeight: 500 }}>(Auto-detected on map click)</span>
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {barangays.map(b => {
                      const on = selectedBarangays.includes(b.id)
                      return (
                        <div
                          key={b.id}
                          className="rb-btn"
                          onClick={() => setSelectedBarangays(prev => on ? prev.filter(x => x !== b.id) : [...prev, b.id])}
                          style={{
                            background: on ? '#5dade2' : 'var(--surface-2)',
                            color: on ? '#fff' : 'var(--text-muted)',
                            border: on ? '1px solid #5dade2' : '1px solid var(--border)',
                            padding: '6px 12px', borderRadius: 16, fontSize: 11, fontWeight: 700,
                          }}
                        >
                          {b.name}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {truck && driver && selectedBarangays.length > 0 && (
                  <div style={{ marginTop: 14, background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 3 }}>{selectedTruck?.plate_number} — {selectedTruck?.model}</div>
                    <div style={{ color: 'var(--text-muted)' }}>Driver: {selectedDriver?.full_name}</div>
                    <div style={{ color: 'var(--text-muted)' }}>Barangays: {barangays.filter(b => selectedBarangays.includes(b.id)).map(b => b.name).join(', ')}</div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 1 — Schedule */}
            {step === 1 && (
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>
                  2. Set Schedule
                </h3>
                <label className="form-label">Collection Days</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                  {DAYS.map(d => {
                    const on = days.includes(d)
                    return (
                      <button key={d} className="rb-btn" onClick={() => setDays(prev => on ? prev.filter(x => x !== d) : [...prev, d])}
                        style={{ padding: '5px 12px', borderRadius: 20, border: '1px solid', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', borderColor: on ? 'var(--accent)' : 'var(--border)', color: on ? 'var(--accent)' : 'var(--text-muted)', background: on ? 'rgba(46,204,113,0.1)' : 'transparent' }}>
                        {d.slice(0, 3)}
                      </button>
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

            {/* STEP 2 — Stops */}
            {step === 2 && (
              <div className="card" style={{ padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: 0 }}>
                    3. Route Stops ({stops.length})
                  </h3>
                  <button className="rb-btn btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => setAddMode(true)}>
                    + Add Stop
                  </button>
                </div>

                {stops.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                    Click "+ Add Stop" then click on the map to place collection stops.
                  </div>
                )}

                {/* Start Point fixed row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 24, height: 24, background: '#1e2633', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, border: '1px solid #2ecc71' }}>🏛️</div>
                  <input
                    className="form-input"
                    value={startPoint.label}
                    onChange={e => setStartPoint(prev => ({ ...prev, label: e.target.value }))}
                    style={{ flex: 1, padding: '4px 8px', fontSize: 12, borderColor: 'rgba(46,204,113,0.3)' }}
                    placeholder="Start Point Label"
                  />
                  <span style={{ fontSize: 10, color: '#2ecc71', fontWeight: 700 }}>START</span>
                </div>

                {stops.map((s, i) => (
                  <div key={i} className="rb-stop-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', transition: 'background .1s' }}>
                    <div style={{ width: 24, height: 24, background: '#5dade2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 10, flexShrink: 0 }}>{i + 1}</div>
                    <input
                      className="form-input"
                      value={s.label}
                      onChange={e => setStops(prev => prev.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                    />
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button className="rb-btn" onClick={() => moveStop(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                      <button className="rb-btn" onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: i === stops.length - 1 ? 'not-allowed' : 'pointer', opacity: i === stops.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button className="rb-btn" onClick={() => removeStop(i)} style={{ background: 'none', border: 'none', color: '#e74c3c', fontSize: 16, cursor: 'pointer' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* STEP 3 — Dumpsite */}
            {step === 3 && (
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>
                  4. Select Dumpsite
                </h3>
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
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{parseFloat(ds.latitude).toFixed(4)}, {parseFloat(ds.longitude).toFixed(4)}</div>
                    </div>
                    {String(dumpsite) === String(ds.id) && <span style={{ marginLeft: 'auto', color: '#e74c3c', fontWeight: 800 }}>✓</span>}
                  </div>
                ))}
              </div>
            )}

            {/* STEP 4 — Preview */}
            {step === 4 && (
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>
                  5. Route Summary
                </h3>
                <div style={{ marginBottom: 14 }}>
                  {[
                    { label: 'Truck',    value: `${selectedTruck?.plate_number} — ${selectedTruck?.model}` },
                    { label: 'Driver',   value: selectedDriver?.full_name },
                    { label: 'Days',     value: days.join(', ') },
                    { label: 'Time',     value: time },
                    { label: 'Stops',    value: `${stops.length} collection points` },
                    { label: 'Dumpsite', value: selectedDumpsite?.name },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>{r.label.toUpperCase()}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', maxWidth: 160 }}>{r.value || '—'}</span>
                    </div>
                  ))}
                </div>

                {/* Route path preview */}
                <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  🏛️ Home Base
                  {stops.map((s, i) => <span key={i}> → {s.label}</span>)}
                  {selectedDumpsite && <> → 🏭 {selectedDumpsite.name}</>}
                  {' → 🏛️ Return'}
                </div>

                {saved && (
                  <div style={{ marginTop: 14, background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#2ecc71', textAlign: 'center' }}>
                    ✅ Route saved successfully!
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              {step > 0 && (
                <button className="rb-btn btn btn-outline" style={{ flex: 1 }} onClick={() => { setStep(s => s - 1); setSaved(false) }}>
                  ← Back
                </button>
              )}
              {step < 4 ? (
                <button
                  className="rb-btn btn btn-primary"
                  style={{ flex: 1, opacity: canNext() ? 1 : 0.4 }}
                  disabled={!canNext()}
                  onClick={() => setStep(s => s + 1)}
                >
                  Next →
                </button>
              ) : (
                <button
                  className="rb-btn btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleSave}
                  disabled={saved}
                >
                  {saved ? '✅ Saved' : '💾 Save Route'}
                </button>
              )}
            </div>

          </div>
        </div>
          </>
        ) : activeTab === 'list' ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1.5fr 1fr 1fr 1.5fr 1fr 0.5fr 1fr',
              padding: '12px 16px',
              background: 'var(--surface-2)',
              borderBottom: '1px solid var(--border)',
              fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
              letterSpacing: '.07em', textTransform: 'uppercase',
            }}>
              <span>Barangays</span>
              <span>Truck</span>
              <span>Driver</span>
              <span>Days</span>
              <span>Time</span>
              <span style={{ textAlign: 'right' }}>Stops</span>
              <span style={{ textAlign: 'right' }}>Actions</span>
            </div>

            {schedLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading schedules...</div>
            ) : schedules.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No scheduled routes found.</div>
            ) : (
              schedules.map((s, idx) => (
                <div key={s.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 1fr 1fr 1.5fr 1fr 0.5fr 1fr',
                  padding: '14px 16px',
                  alignItems: 'center',
                  borderBottom: idx < schedules.length - 1 ? '1px solid var(--border)' : 'none',
                  fontSize: 13,
                }}>
                  <div style={{ fontWeight: 600 }}>{s.barangay_names || '—'}</div>
                  <div style={{ color: 'var(--text)' }}>
                    <div style={{ fontWeight: 600 }}>{s.truck_plate || '—'}</div>
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>{s.driver_name || '—'}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.days || '—'}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {s.start_time?.slice(0,5)} - {s.end_time?.slice(0,5)}
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 700, color: '#5dade2' }}>
                    {Array.isArray(s.waypoints) ? s.waypoints.length : 0}
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button className="rb-btn" onClick={() => handleView(s)} style={{ background: 'rgba(93,173,226,0.1)', color: '#5dade2', border: '1px solid rgba(93,173,226,0.3)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 700 }}>
                      View
                    </button>
                    <button className="rb-btn" onClick={() => handleEdit(s)} style={{ background: 'rgba(243,156,18,0.1)', color: '#f39c12', border: '1px solid rgba(243,156,18,0.3)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 700 }}>
                      Edit
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : activeTab === 'calendar' ? (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Schedule & Events Calendar</h2>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={showSchedulesOnCalendar} onChange={e => setShowSchedulesOnCalendar(e.target.checked)} />
                  Show Route Schedules
                </label>
                <button className="btn btn-primary btn-sm" onClick={() => setShowEventModal(true)}>+ Add Event</button>
              </div>
            </div>
            {renderCalendar()}
          </div>
        ) : null}

      </div>
      
      {/* ADD EVENT MODAL */}
      {showEventModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 400, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>Create Calendar Event</h3>
            <form onSubmit={handleCreateEvent} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="form-label">Event Title</label>
                <input required className="form-input" value={newEvent.title} onChange={e => setNewEvent({...newEvent, title: e.target.value})} placeholder="e.g. Clean-up Drive" />
              </div>
              <div>
                <label className="form-label">Date</label>
                <input required type="date" className="form-input" value={newEvent.date} onChange={e => setNewEvent({...newEvent, date: e.target.value})} />
              </div>
              <div>
                <label className="form-label">Location (Optional)</label>
                <input className="form-input" value={newEvent.location} onChange={e => setNewEvent({...newEvent, location: e.target.value})} placeholder="e.g. Quezon Park" />
              </div>
              <div>
                <label className="form-label">Assign Personnel (Optional)</label>
                <select className="form-input" value={newEvent.assigned_to} onChange={e => setNewEvent({...newEvent, assigned_to: e.target.value})}>
                  <option value="">-- No specific assignment --</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowEventModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Save Event</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
