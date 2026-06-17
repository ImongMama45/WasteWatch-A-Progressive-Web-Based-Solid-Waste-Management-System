/**
 * pages/admin/TruckManagement.jsx
 * --------------------------------
 * Admin: Truck & Driver Management
 * - Truck list with plate, status, driver, crew
 * - Add / Edit truck modal
 * - Assign driver and crew members
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../../components/DashboardLayout'
import { useTrucks } from '../../hooks/useTrucks'
import { useUsers } from '../../hooks/useUsers'
import { useNotification } from '../../context/NotificationContext'
import { getApiErrorMessage } from '../../utils/notificationHelpers'
import api from '../../api/client'
import { ICONS } from '../../api/navConfig'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_META = {
  active: { label: 'Active', color: '#2ecc71', bg: 'rgba(46,204,113,0.1)', border: 'rgba(46,204,113,0.3)' },
  maintenance: { label: 'Maintenance', color: '#f39c12', bg: 'rgba(243,156,18,0.1)', border: 'rgba(243,156,18,0.3)' },
  inactive: { label: 'Inactive', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)', border: 'rgba(231,76,60,0.3)' },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.inactive
  return (
    <span style={{
      background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      borderRadius: 20, padding: '2px 10px', fontSize: 9, fontWeight: 800,
      letterSpacing: '.06em', whiteSpace: 'nowrap',
    }}>
      {m.label.toUpperCase()}
    </span>
  )
}

function CapacityBar({ pct }) {
  const color = pct > 80 ? '#e74c3c' : pct > 55 ? '#f39c12' : '#2ecc71'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: '#e0e0e0', borderRadius: 20, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 20, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 10, color: '#888', width: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
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

// ─── Modal ────────────────────────────────────────────────────────────────────

const EMPTY_FORM = { plate_number: '', model: '', status: 'active', drivers: [], crew: [], last_service: '', max_capacity_kg: 1000 }

function TruckModal({ truck, onSave, onClose, drivers, crewPool }) {
  const { notify } = useNotification()
  const [form, setForm] = useState(truck ? {
    plate_number: truck.plate_number, model: truck.model, status: truck.status,
    drivers: truck.drivers || [], crew: truck.crew || [],
    last_service: truck.last_service || '',
    max_capacity_kg: truck.max_capacity_kg || 1000,
  } : { ...EMPTY_FORM })
  const [crewInput, setCrewInput] = useState('')
  const [driverInput, setDriverInput] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const addCrew = (id) => {
    if (!id || form.crew.includes(parseInt(id))) return
    set('crew', [...form.crew, parseInt(id)])
    setCrewInput('')
  }

  const removeCrew = (id) => set('crew', form.crew.filter(c => c !== id))

  const availableCrew = crewPool.filter(c => !form.crew.includes(c.id))

  const getMemberName = (id) => {
    const u = crewPool.find(x => x.id === id) || drivers.find(x => x.id === id)
    return u ? u.full_name : 'Unknown'
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 24,
        width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
            {truck ? 'Edit Truck' : 'Add New Truck'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        {/* Plate & Model */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label className="form-label">Plate Number</label>
            <input className="form-input" value={form.plate_number} onChange={e => set('plate_number', e.target.value)} placeholder="LCN-001" />
          </div>
          <div>
            <label className="form-label">Model</label>
            <input className="form-input" value={form.model} onChange={e => set('model', e.target.value)} placeholder="Isuzu Elf" />
          </div>
        </div>

        {/* Status & Max Capacity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label className="form-label">Status</label>
            <select className="form-input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="form-label">Max Capacity (kg)</label>
            <input className="form-input" type="number" min="0" step="100" value={form.max_capacity_kg} onChange={e => set('max_capacity_kg', e.target.value)} />
          </div>
        </div>

        {/* Zone & Last Service */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label className="form-label">Assigned Barangay</label>
            <input className="form-input" value={form.assigned_barangays || 'No routes assigned'} readOnly style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} />
          </div>
          <div>
            <label className="form-label">Last Service</label>
            <input className="form-input" type="date" value={form.last_service} onChange={e => set('last_service', e.target.value)} />
          </div>
        </div>

        {/* Drivers */}
        <div style={{ marginBottom: 14 }}>
          <label className="form-label">Assigned Drivers (Max 2)</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select
              className="form-input"
              value={driverInput}
              onChange={e => setDriverInput(e.target.value)}
              style={{ flex: 1 }}
              disabled={form.drivers.length >= 2}
            >
              <option value="">— Select driver —</option>
              {drivers.filter(d => !form.drivers.includes(d.id)).map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
            <button
              onClick={() => {
                if (!driverInput || form.drivers.includes(parseInt(driverInput)) || form.drivers.length >= 2) return
                set('drivers', [...form.drivers, parseInt(driverInput)])
                setDriverInput('')
              }}
              style={{ background: 'var(--accent)', color: '#0d1117', border: 'none', borderRadius: 8, padding: '0 14px', fontWeight: 700, cursor: 'pointer' }}
              disabled={form.drivers.length >= 2}
            >Add</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {form.drivers.length === 0 && <span style={{ fontSize: 12, color: '#aaa' }}>No driver assigned.</span>}
            {form.drivers.map(id => (
              <span key={id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                {getMemberName(id)}
                <button onClick={() => set('drivers', form.drivers.filter(d => d !== id))} style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
        </div>

        {/* Crew */}
        <div style={{ marginBottom: 20 }}>
          <label className="form-label">Crew Members</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select
              className="form-input"
              value={crewInput}
              onChange={e => setCrewInput(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">— Select crew member —</option>
              {availableCrew.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <button
              onClick={() => addCrew(crewInput)}
              style={{
                background: 'var(--accent)', color: '#0d1117', border: 'none',
                borderRadius: 8, padding: '0 14px', fontWeight: 700, cursor: 'pointer',
              }}
            >Add</button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {form.crew.length === 0 && (
              <span style={{ fontSize: 12, color: '#aaa' }}>No crew assigned yet.</span>
            )}
            {form.crew.map(id => (
              <span key={id} style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 20, padding: '4px 10px', fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {getMemberName(id)}
                <button
                  onClick={() => removeCrew(id)}
                  style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}
                >×</button>
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => {
              if (!form.plate_number.trim()) return notify({ variant: 'error-solid', message: 'Plate number is required.' })
              onSave(form)
            }}
          >
            {truck ? 'Save Changes' : 'Add Truck'}
          </button>
        </div>
      </div>
    </div>
  )
}
function formatDaysInitials(daysStr) {
  if (!daysStr || daysStr === 'Daily') return daysStr || 'Daily'
  const arr = daysStr.split(', ')
  if (arr.length > 1) {
    return arr.map(d => d.trim()[0]).join(' - ')
  }
  return daysStr
}
function formatBarangays(bStr) {
  if (!bStr) return 'No routes'
  const arr = bStr.split(', ')
  if (arr.length > 3) {
    return `${arr.slice(0, 3).join(', ')} +${arr.length - 3} more...`
  }
  return bStr
}
function formatMaintenanceDuration(startDateStr) {
  if (!startDateStr) return ''
  const start = new Date(startDateStr)
  const diffMs = Date.now() - start.getTime()
  if (diffMs < 0) return 'Just now'
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

  if (diffDays > 0) return `${diffDays} day${diffDays !== 1 ? 's' : ''}, ${diffHours} hr${diffHours !== 1 ? 's' : ''}`
  if (diffHours > 0) return `${diffHours} hr${diffHours !== 1 ? 's' : ''}, ${diffMins} min${diffMins !== 1 ? 's' : ''}`
  if (diffMins > 0) return `${diffMins} min${diffMins !== 1 ? 's' : ''}`
  return 'Just now'
}

function RouteModal({ truckId, driverId, driverName, onClose }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const [leafletReady, setLeafletReady] = useState(false)
  const [schedules, setSchedules] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(true)

  const schedule = schedules[activeIdx] || null

  // Load Leaflet CDN dynamically if not present
  useEffect(() => {
    if (window.L) {
      setLeafletReady(true)
      return
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setLeafletReady(true)
    document.head.appendChild(script)
  }, [])

  // Fetch driver schedule
  useEffect(() => {
    setLoading(true)
    api.get('/api/driver/collection-schedules/')
      .then(res => {
        const matching = res.data.filter(s => String(s.truck) === String(truckId) && String(s.driver) === String(driverId))
        setSchedules(matching)
        setActiveIdx(0)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [truckId, driverId])

  // Initialize Map
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: [13.9373, 121.617], zoom: 14 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    mapInstance.current = map
  }, [leafletReady])

  const layerGroupRef = useRef(null)

  // Draw Schedule
  useEffect(() => {
    if (!leafletReady || !mapInstance.current || loading || !schedule) return
    const L = window.L
    const map = mapInstance.current

    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers()
    } else {
      layerGroupRef.current = L.featureGroup().addTo(map)
    }
    const layerGroup = layerGroupRef.current

    const waypoints = (schedule?.waypoints || []).filter(w => w && w.lat != null && w.lng != null)
    if (waypoints.length === 0) return

    const startIcon = L.divIcon({
      html: `<div style="background:#2ecc71;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 6px rgba(0,0,0,0.5);"></div>`,
      className: '', iconSize: [12, 12], iconAnchor: [6, 6],
    })
    L.marker([waypoints[0].lat, waypoints[0].lng], { icon: startIcon }).addTo(layerGroup).bindPopup('Start Point')

    waypoints.slice(1).forEach((wp, index) => {
      const stopIcon = L.divIcon({
        html: `<div style="background:#3498db;width:16px;height:16px;border-radius:50%;color:white;font-size:9px;font-weight:bold;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 0 6px rgba(0,0,0,0.5);">${index + 1}</div>`,
        className: '', iconSize: [16, 16], iconAnchor: [8, 8],
      })
      L.marker([wp.lat, wp.lng], { icon: stopIcon }).addTo(layerGroup).bindPopup(`Stop ${index + 1}: ${wp.label || ''}`)
    })

    const latlngs = waypoints.map(w => [w.lat, w.lng])
    const fallbackLine = L.polyline(latlngs, {
      color: '#2ecc71', weight: 3, opacity: 0.35, dashArray: '6, 6',
    }).addTo(layerGroup)
    map.fitBounds(fallbackLine.getBounds(), { padding: [30, 30] })

    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return

    const coordinates = waypoints.slice(0, 50).map(w => [w.lng, w.lat])

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: orsApiKey },
      body: JSON.stringify({ coordinates }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length || !mapInstance.current) return
        layerGroup.removeLayer(fallbackLine)
        const pts = decodePolyline(data.routes[0].geometry)
        const orsLine = L.polyline(pts, { color: '#2ecc71', weight: 5, opacity: 0.85 }).addTo(layerGroup)
        map.fitBounds(orsLine.getBounds(), { padding: [30, 30] })
      })
      .catch(() => { /* fallbackLine stays visible */ })
  }, [leafletReady, schedule, loading])

  // Cleanup map instance on unmount
  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
    }
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 24,
        width: '100%', maxWidth: 600, maxHeight: '95vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
              Route Map
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Assigned to: {driverName}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#888', padding: 0 }}>×</button>
        </div>

        <div style={{ position: 'relative', width: '100%', height: 350, background: '#1e293b', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          {schedules.length > 1 && (
            <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {schedules.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => setActiveIdx(idx)}
                  style={{
                    background: activeIdx === idx ? '#14b8a6' : 'rgba(15,23,42,0.8)',
                    color: '#fff', borderRadius: 20, padding: '6px 12px',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    border: `1px solid ${activeIdx === idx ? '#14b8a6' : 'rgba(255,255,255,0.2)'}`
                  }}
                >
                  {formatDaysInitials(s.days) || `Route ${idx + 1}`}
                </button>
              ))}
            </div>
          )}
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {(loading || !leafletReady) && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(30, 41, 59, 0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 600
            }}>
              {loading ? 'Fetching route schedule...' : 'Loading map...'}
            </div>
          )}

          {!loading && leafletReady && !schedule && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(30, 41, 59, 0.9)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: 20, textAlign: 'center'
            }}>
              <span style={{ width: 36, height: 36, marginBottom: 10, color: '#e74c3c' }}>{ICONS.map}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e74c3c' }}>No Route Configured</span>
              <span style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>This driver does not have a route schedule assigned.</span>
            </div>
          )}
        </div>

        {schedule && (
          <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Barangays:</span>
              <span style={{ fontWeight: 600 }}>{schedule.barangay_names || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Days:</span>
              <span style={{ fontWeight: 600 }}>{formatDaysInitials(schedule.days) || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Time Schedule:</span>
              <span style={{ fontWeight: 600 }}>{schedule.start_time?.slice(0, 5)} - {schedule.end_time?.slice(0, 5)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total Waypoints:</span>
              <span style={{ fontWeight: 600 }}>{schedule.waypoints?.length || 0} stops</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-outline" style={{ minWidth: 100 }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TruckManagement() {
  const navigate = useNavigate()
  const { trucks, loading, saveTruck, deleteTruck: apiDeleteTruck } = useTrucks()
  const { drivers, crew: crewPool } = useUsers()
  const { notify } = useNotification()

  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)   // null | 'add' | truck object
  const [expanded, setExpanded] = useState(null)
  const [toast, setToast] = useState(null)
  const [viewRouteTruck, setViewRouteTruck] = useState(null)
  const [warningModal, setWarningModal] = useState(null) // { action: 'delete', truck: obj } | { action: 'status', id: id, form: obj }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleSave(form) {
    const id = modal === 'add' ? null : modal.id
    
    // Check if status changed from active to maintenance/inactive
    if (id) {
      const originalTruck = trucks.find(t => t.id === id)
      if (originalTruck && originalTruck.status === 'active' && (form.status === 'maintenance' || form.status === 'inactive')) {
        setWarningModal({ action: 'status', id, form })
        return
      }
    }
    
    executeSave(id, form)
  }

  async function executeSave(id, form) {
    const res = await saveTruck(id, form)
    if (res.ok) {
      showToast(id ? '✅ Truck updated successfully.' : '✅ Truck added successfully.')
      setModal(null)
    } else {
      notify({ variant: 'error-outline', message: getApiErrorMessage({ response: { data: res.error } }, 'Failed to save truck.') })
    }
  }

  function handleDeleteTruck(truck) {
    setWarningModal({ action: 'delete', truck })
  }

  async function confirmDelete(truck) {
    const res = await apiDeleteTruck(truck.id)
    if (res.ok) {
      setExpanded(null)
      setWarningModal(null)
      notify({ message: 'Truck deleted permanently.', variant: 'error-dark', position: 'bottom-left' })
    }
  }

  async function confirmStatusChange(reason) {
    const { id, form } = warningModal
    const finalForm = { ...form, status_reason: reason }
    if (form.status === 'inactive') {
      finalForm.drivers = []
      finalForm.crew = []
    }
    setWarningModal(null)
    executeSave(id, finalForm)
  }

  const filtered = useMemo(() => trucks.filter(t => {
    const matchStatus = filter === 'all' || t.status === filter
    const driverNames = t.driver_details?.map(d => d.full_name).join(' ') || ''
    const assignedBarangays = t.driver_details?.map(d => d.assigned_barangays).join(' ') || ''
    const matchSearch = !search ||
      t.plate_number.toLowerCase().includes(search.toLowerCase()) ||
      driverNames.toLowerCase().includes(search.toLowerCase()) ||
      assignedBarangays.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  }), [trucks, filter, search])

  const counts = useMemo(() => ({
    all: trucks.length,
    active: trucks.filter(t => t.status === 'active').length,
    maintenance: trucks.filter(t => t.status === 'maintenance').length,
    inactive: trucks.filter(t => t.status === 'inactive').length,
  }), [trucks])

  return (
    <DashboardLayout>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 22px',
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap',
          animation: 'fadeSlideIn .2s',
        }}>{toast}</div>
      )}

      {/* Modal */}
      {modal && (
        <TruckModal
          truck={modal === 'add' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
          drivers={drivers}
          crewPool={crewPool}
        />
      )}

      {/* Route Map Modal */}
      {viewRouteTruck && (
        <RouteModal
          truckId={viewRouteTruck.id}
          driverId={viewRouteTruck.driverId}
          driverName={viewRouteTruck.name}
          onClose={() => setViewRouteTruck(null)}
        />
      )}

      <style>{`
        @keyframes fadeSlideIn { from{opacity:0;transform:translateX(-50%) translateY(-8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        .truck-row { transition: box-shadow .18s, border-color .18s; cursor: pointer; }
        .truck-row:hover { box-shadow: 0 4px 18px rgba(0,0,0,.08); }
        .tm-filter-btn { transition: all .15s; cursor: pointer; }
        .tm-filter-btn:hover { opacity: .8; }
      `}</style>

      <div className="page">

        {/* ── Page Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                Truck & Driver Management
              </h2>
              <span style={{
                background: 'rgba(93,173,226,0.1)', color: '#5dade2',
                border: '1px solid rgba(93,173,226,0.3)',
                fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
              }}>ADMIN</span>
            </div>
            <p className="text-muted text-sm">Manage fleet, assign drivers and crew members.</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setModal('add')}
          >
            + Add Truck
          </button>
        </div>

        {/* ── KPI Strip ── */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Total Trucks', value: counts.all, color: '#ffffffff', icon: '' },
            { label: 'Active', value: counts.active, color: '#2ecc71', icon: '' },
            { label: 'Maintenance', value: counts.maintenance, color: '#f39c12', icon: '' },
            { label: 'Inactive', value: counts.inactive, color: '#e74c3c', icon: '' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div className="label">{s.label}</div>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
              </div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Filters + Search ── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{
            display: 'flex', gap: 4,
            background: 'var(--surface-2)', borderRadius: 10, padding: 4,
          }}>
            {['all', 'active', 'maintenance', 'inactive'].map(f => (
              <button key={f} className="tm-filter-btn" onClick={() => setFilter(f)} style={{
                padding: '6px 14px', borderRadius: 8, border: 'none',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                background: filter === f ? 'var(--surface)' : 'transparent',
                color: filter === f ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: filter === f ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
              }}>
                {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
              </button>
            ))}
          </div>

          <input
            className="form-input"
            placeholder="   Search plate, driver, barangay…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 260, marginLeft: 'auto' }}
          />
        </div>

        {/* ── Truck List ── */}
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>Loading trucks...</div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '36px 20px' }}>
              <div style={{ width: 48, height: 48, margin: '0 auto 12px', color: '#94a3b8' }}>{ICONS.truck}</div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>No trucks found</div>
              <div className="text-muted text-sm">Try adjusting your filter or search.</div>
            </div>
          ) : (
            filtered.map(truck => {
              const isOpen = expanded === truck.id
              const sm = STATUS_META[truck.status]
              return (
                <div
                  key={truck.id}
                  className="truck-row"
                  style={{
                    background: 'var(--surface)',
                    border: `1px solid ${isOpen ? sm.border : 'var(--border)'}`,
                    borderRadius: 14, marginBottom: 10, overflow: 'hidden',
                  }}
                >
                  {/* ── Row header ── */}
                  <div
                    style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}
                    onClick={() => setExpanded(p => p === truck.id ? null : truck.id)}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                      background: `${sm.bg}`,
                      border: `1px solid ${sm.border}`, color: sm.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <div style={{ width: 24, height: 24 }}>{ICONS.truck}</div>
                    </div>

                    {/* Main info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15 }}>{truck.plate_number}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{truck.model}</span>
                        <StatusBadge status={truck.status} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 14, height: 14, flexShrink: 0 }}>{ICONS.profile}</div>
                        {truck.driver_details?.length ? truck.driver_details.map(d => d.full_name).join(' & ') : 'No drivers assigned'} &nbsp;·&nbsp; {truck.driver_details?.length ? Array.from(new Set(truck.driver_details.map(d => d.assigned_barangays).filter(b => b && b !== 'No routes assigned'))).join(' | ') || 'No routes' : 'No routes'}
                      </div>
                      {truck.status === 'active' && <CapacityBar pct={truck.current_capacity} />}
                    </div>

                    {/* Crew count */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Crew</div>
                      <div style={{
                        fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 20,
                        color: truck.crew.length === 0 ? '#e74c3c' : 'var(--text)',
                      }}>{truck.crew.length}</div>
                    </div>

                    {/* Chevron */}
                    <div style={{
                      fontSize: 16, color: 'var(--text-muted)',
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                      transition: 'transform .2s', flexShrink: 0,
                    }}>›</div>
                  </div>

                  {/* ── Expanded detail ── */}
                  {isOpen && (
                    <div
                      style={{ borderTop: '1px solid var(--border)', padding: '16px', animation: 'slideDown .18s' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
                        {truck.driver_details && truck.driver_details.length > 0 ? (
                          truck.driver_details.map(d => (
                            <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {/* Driver & Schedule card */}
                              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', flex: 1 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', marginBottom: 8 }}>ASSIGNMENT & SCHEDULE</div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{
                                        width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#0d1117',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13,
                                      }}>{d.full_name[0]}</div>
                                      <span style={{ fontSize: 13, fontWeight: 600 }}>{d.full_name}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                      <div style={{ marginBottom: 2 }}>
                                        <strong style={{ color: 'var(--text)' }}>Added:</strong> {truck.created_at ? new Date(truck.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'}
                                      </div>
                                      <div>
                                        <strong style={{ color: 'var(--text)' }}>Schedule:</strong>
                                        {Array.isArray(d.schedule_description) && d.schedule_description.length > 0 ? (
                                          <ul style={{ listStyleType: 'disc', paddingLeft: 20, margin: '4px 0 0 0', color: 'var(--text)' }}>
                                            {d.schedule_description.map((desc, i) => {
                                              let displayDesc = desc;
                                              const parts = desc.split(' | ');
                                              if (parts.length === 2) {
                                                const timeStr = parts[1];
                                                displayDesc = `${formatDaysInitials(parts[0])} | ${timeStr}`;
                                              }
                                              return <li key={i} style={{ marginBottom: 2 }}>{displayDesc}</li>
                                            })}
                                          </ul>
                                        ) : (
                                          <span style={{ marginLeft: 4 }}>No active schedule</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '6px 12px', height: 'fit-content', whiteSpace: 'nowrap' }} onClick={() => setViewRouteTruck({ id: truck.id, driverId: d.id, name: d.full_name })}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 14, height: 14 }}>{ICONS.map}</div> Show Route</div>
                                  </button>
                                </div>
                              </div>
                              {/* Last service */}
                              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', marginBottom: 6 }}>LAST SERVICE</div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{d.last_service || '—'}</div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', gridColumn: '1 / -1' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', marginBottom: 8 }}>ASSIGNMENT & SCHEDULE</div>
                            <span style={{ fontSize: 12, color: '#e74c3c' }}>No drivers assigned</span>
                          </div>
                        )}
                      </div>

                      {truck.status === 'maintenance' && (
                        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#d97706', letterSpacing: '.07em', marginBottom: 6 }}>UNDER MAINTENANCE</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            {truck.maintenance_start ? formatMaintenanceDuration(truck.maintenance_start) : 'Start time unknown'}
                          </div>
                        </div>
                      )}

                      {/* Crew list */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', marginBottom: 8 }}>
                          {truck.status === 'inactive' 
                            ? 'PAST CREW MEMBERS' 
                            : `CREW MEMBERS (${truck.crew?.length || 0})`}
                        </div>
                        
                        {truck.status === 'inactive' ? (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', background: 'var(--surface)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 8 }}>
                            {truck.past_crew_names ? truck.past_crew_names : 'No past crew recorded.'}
                          </div>
                        ) : truck.crew?.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#e74c3c' }}>No crew assigned to this truck.</div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {truck.crew_names?.map(c => (
                              <span key={c} style={{
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 500,
                                display: 'flex', alignItems: 'center', gap: 6,
                              }}>
                                <span style={{
                                  width: 18, height: 18, borderRadius: '50%', background: '#5dade2',
                                  color: '#fff', fontSize: 9, fontWeight: 800,
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                }}>{c[0]}</span>
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ flex: 1 }}
                          onClick={() => setModal(truck)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <div style={{ width: 14, height: 14 }}>{ICONS.edit}</div> Edit / Reassign
                          </div>
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ background: 'rgba(231,76,60,0.08)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)' }}
                          onClick={() => handleDeleteTruck(truck)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <div style={{ width: 14, height: 14 }}>{ICONS.trash}</div> Delete
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Warning Modal */}
      {warningModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--surface)', width: '90%', maxWidth: 400, borderRadius: 16, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            
            {warningModal.action === 'delete' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, color: '#e74c3c' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(231,76,60,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 20, height: 20 }}>{ICONS.trash}</div>
                  </div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Delete Truck</h3>
                </div>
                <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
                  Are you sure you want to delete <strong>{warningModal.truck.plate_number}</strong>? <br/><br/>
                  Deleting this truck will orphan any assigned routes (leaving them blank for reassignment). This action cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline" onClick={() => setWarningModal(null)}>Cancel</button>
                  <button className="btn btn-primary" style={{ background: '#e74c3c', borderColor: '#e74c3c', color: '#fff' }} onClick={() => confirmDelete(warningModal.truck)}>
                    Yes, Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, color: '#d97706' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(217,119,6,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: 20 }}>⚠️</div>
                  </div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Change Status</h3>
                </div>
                <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                  You are changing this truck's status to <strong>{warningModal.form.status}</strong>. 
                  {warningModal.form.status === 'inactive' && ' This will unassign the truck, driver, and crew from all active routes.'}
                </p>
                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Reason for {warningModal.form.status}</label>
                  <textarea 
                    id="statusReasonInput"
                    style={{ width: '100%', minHeight: 80, padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, resize: 'vertical' }}
                    placeholder={`Why is this truck ${warningModal.form.status}?`}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline" onClick={() => setWarningModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => confirmStatusChange(document.getElementById('statusReasonInput').value)}>
                    Confirm Change
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

    </DashboardLayout>
  )
}
