// MiniMap.jsx — WasteWatch Dashboard Embedded Map Widget
// -------------------------------------------------------
// Matches MapView visuals (dark theme, same marker HTML, same stop colours).
// Role-aware:
//   citizen      → report FAB + read-only stops + report pins
//   driver       → no FAB, shows own truck + stops only
//   brgy_official / watcher / admin → all trucks, stops, report pins + moderate FAB

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import api from '../api/client'
import {
  buildStopMarkerHtml,
  buildStopValidationSnapshot,
  normalizeStopStatus,
  STOP_STATUS_COLORS,
  STOP_STATUS_LABELS,
} from '../utils/pickupStatusSync'
import { getApiErrorMessage } from '../utils/notificationHelpers'
import {
  filterBarangayItems,
  getBarangayCenter,
  getUserBarangayName,
  isAdminRole,
} from '../utils/barangayScope'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const LUCENA_CENTER = [13.9373, 121.617]

const STATUS_COLORS = {
  active: '#22c55e',
  weak_signal: '#f59e0b',
  offline: '#64748b',
}

const STOP_COLORS_MAP = Object.fromEntries(
  Object.entries(STOP_STATUS_COLORS).map(([k, v]) => [k, v.bg])
)

const TYPE_LABELS = {
  overflow: 'Overflow',
  illegal_dumping: 'Illegal Dumping',
  missed: 'Missed Pickup',
}

// ─── MARKER HTML (mirrors MapView exactly) ───────────────────────────────────

const makeTruckIconHtml = (color, label, status) => `
  <div style="position:relative;width:36px;height:50px;">
    <div style="background:${color};border:2px solid white;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);width:32px;height:32px;
      box-shadow:0 3px 10px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;">
      <div style="transform:rotate(45deg);display:flex;align-items:center;justify-content:center;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-truck"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
      </div>
    </div>
    <div style="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);
      background:${color};color:white;font-size:8px;font-weight:700;
      padding:1px 5px;border-radius:6px;border:1.5px solid white;
      white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3);">${label}</div>
    <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);
      width:8px;height:8px;border-radius:50%;
      background:${STATUS_COLORS[status] || '#64748b'};
      border:2px solid white;"></div>
  </div>`

const makeReportIconHtml = (severity) => {
  const c = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }[severity] || '#f59e0b'
  return `<div style="background:${c};border:2px solid white;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);width:24px;height:24px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 2px 8px rgba(0,0,0,0.35);">
    <div style="transform:rotate(45deg);font-size:11px;">⚠️</div>
  </div>`
}

const makeYouMarkerHtml = () => `
  <div style="position:relative;width:18px;height:18px;">
    <div style="position:absolute;inset:0;background:#3b82f6;border:3px solid white;border-radius:50%;
      box-shadow:0 0 0 4px rgba(59,130,246,0.3),0 3px 10px rgba(0,0,0,0.3);"></div>
    <div style="position:absolute;top:-16px;left:50%;transform:translateX(-50%);
      background:rgba(15,23,42,0.9);color:#fff;font-size:8px;font-weight:700;
      padding:2px 5px;border-radius:6px;white-space:nowrap;">You</div>
  </div>`

// ─── HELPER: inject stop @keyframes once ─────────────────────────────────────

function injectStopStyles() {
  if (document.getElementById('ww-mm-stop-styles')) return
  const s = document.createElement('style')
  s.id = 'ww-mm-stop-styles'
  s.textContent = `
    @keyframes wwPulse {
      0%,100%{transform:scale(1);opacity:.55}
      50%{transform:scale(1.7);opacity:0}
    }`
  document.head.appendChild(s)
}

// ─── ROLES ───────────────────────────────────────────────────────────────────

const MODERATOR_ROLES = ['brgy_official', 'watcher', 'admin']
const CAN_SEE_ALL_ROLES = ['admin', 'superadmin']

// ─── PANEL SUB-COMPONENTS ────────────────────────────────────────────────────

function PanelRow({ label, value, accent }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>{label}</span>
      <span style={{ color: accent ? '#14b8a6' : '#e2e8f0', fontSize: 12, fontWeight: accent ? 700 : 400 }}>{value}</span>
    </div>
  )
}

function TruckPanel({ truck, onClose }) {
  const connColor = STATUS_COLORS[truck.status] || '#64748b'
  const connLabel = truck.status === 'active' ? 'LIVE'
    : truck.status === 'weak_signal' ? 'WEAK' : 'OFFLINE'

  return (
    <div style={{
      background: '#0f172a', borderTop: `2px solid ${connColor}`,
      padding: '14px 16px 16px',
      animation: 'mmSlideDown .22s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>🚛</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'white', fontWeight: 800, fontSize: 15 }}>{truck.truckId}</div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>{truck.driver}</div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: `${connColor}18`, border: `1px solid ${connColor}55`,
          borderRadius: 20, padding: '3px 10px',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: connColor,
            boxShadow: truck.status === 'active' ? `0 0 5px ${connColor}` : 'none'
          }} />
          <span style={{ color: connColor, fontSize: 10, fontWeight: 700 }}>{connLabel}</span>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', padding: 0 }}>
          ✕
        </button>
      </div>
      <PanelRow label="DRIVER" value={truck.driver} />
      <PanelRow label="PLATE" value={truck.truckId} accent />
      <PanelRow label="LAST UPDATE" value={truck.lastUpdate || 'N/A'} />
      <p style={{ color: '#475569', fontSize: 10, margin: '10px 0 0', lineHeight: 1.5 }}>
        Stop progress visible to assigned driver only.
      </p>
    </div>
  )
}

function ReportPanel({ report, canModerate, onAction, onClose }) {
  const sev = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }[report.severity] || '#f59e0b'
  const statusLabel = {
    pending: 'Pending Review',
    approved: 'Approved',
    resolved: 'Resolved',
    rejected: 'Rejected',
  }[report.status] ?? report.status

  const reportedStr = report.created_at
    ? new Date(report.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown'

  const tags = report.tags ? report.tags.split(',') : []

  return (
    <div style={{
      background: '#0f172a', borderTop: '2px solid #f59e0b',
      padding: '14px 16px 16px',
      animation: 'mmSlideDown .22s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'white', fontWeight: 800, fontSize: 15 }}>
            {TYPE_LABELS[report.issue_type || report.type] ?? (report.issue_type || report.type)}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>{report.barangay_name || report.address}</div>
        </div>
        <div style={{
          background: `${sev}22`, border: `1px solid ${sev}`,
          borderRadius: 20, padding: '2px 10px',
          color: sev, fontSize: 10, fontWeight: 700,
        }}>
          {report.severity?.toUpperCase()}
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', padding: 0 }}>
          ✕
        </button>
      </div>

      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
          {tags.map(tag => (
            <span key={tag} style={{ 
              fontSize: 9, background: tag === 'Misconduct' ? '#ef4444' : 'rgba(255,255,255,0.08)', 
              color: tag === 'Misconduct' ? 'white' : '#cbd5e1', 
              padding: '1px 6px', borderRadius: 4, border: tag === 'Misconduct' ? 'none' : '1px solid rgba(255,255,255,0.1)'
            }}>{tag}</span>
          ))}
        </div>
      )}

      {report.reported_user_name && (
        <div style={{ 
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', 
          borderRadius: 6, padding: '8px 10px', marginBottom: 12, color: '#fca5a5', fontSize: 11
        }}>
          <b>Reported Person:</b> {report.reported_user_name}
        </div>
      )}

      <PanelRow label="TYPE" value={TYPE_LABELS[report.issue_type || report.type] ?? ''} />
      <PanelRow label="REPORTED" value={reportedStr} />
      <PanelRow label="STATUS" value={statusLabel} accent />

      {report.description && (
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: 'rgba(255,255,255,0.04)', borderRadius: 8,
          color: '#cbd5e1', fontSize: 11, lineHeight: 1.5,
        }}>
          {report.description}
        </div>
      )}

      {canModerate && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {report.status === 'pending' && (
            <>
              <button onClick={() => onAction('approve', report)}
                style={{
                  flex: 1, background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e',
                  color: '#22c55e', borderRadius: 8, padding: '8px', fontWeight: 700, fontSize: 11, cursor: 'pointer'
                }}>
                ✅ Approve
              </button>
              <button onClick={() => onAction('reject', report)}
                style={{
                  flex: 1, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444',
                  color: '#ef4444', borderRadius: 8, padding: '8px', fontWeight: 700, fontSize: 11, cursor: 'pointer'
                }}>
                ✕ Reject
              </button>
            </>
          )}
          {report.status === 'approved' && (
            <button onClick={() => onAction('resolve', report)}
              style={{
                flex: 1, background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e',
                color: '#22c55e', borderRadius: 8, padding: '8px', fontWeight: 700, fontSize: 11, cursor: 'pointer'
              }}>
              🏁 Mark Resolved
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function MiniMap({ height = 260 }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { notify } = useNotification()
  const role = user?.role?.toLowerCase() || 'citizen'
  const barangayName = getUserBarangayName(user)
  const isAdmin = isAdminRole(user)

  const canSeeAll = CAN_SEE_ALL_ROLES.includes(role)
  const canModerate = MODERATOR_ROLES.includes(role)
  const isDriver = role === 'driver'

  // ── Refs ──
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const layersRef = useRef({})
  const stopMarkersRef = useRef(new Map())
  const userMarkerRef = useRef(null)

  // ── State ──
  const [leafletReady, setLeafletReady] = useState(false)
  const [activeTrucks, setActiveTrucks] = useState([])
  const [reports, setReports] = useState([])
  const [schedules, setSchedules] = useState([])
  const [barangayStops, setBarangayStops] = useState([])
  const [stopStatusMap, setStopStatusMap] = useState(new Map())
  const [stopDetailsMap, setStopDetailsMap] = useState(new Map())

  const [selectedTruck, setSelectedTruck] = useState(null)
  const [selectedReport, setSelectedReport] = useState(null)
  const [panelType, setPanelType] = useState(null) // 'truck' | 'report'

  // keep refs in sync for use inside drawLayers (no stale closure)
  const activeTrucksRef = useRef(activeTrucks)
  const reportsRef = useRef(reports)
  const schedulesRef = useRef(schedules)
  const barangayStopsRef = useRef(barangayStops)
  const stopStatusMapRef = useRef(stopStatusMap)
  const stopDetailsMapRef = useRef(stopDetailsMap)
  useEffect(() => { activeTrucksRef.current = activeTrucks }, [activeTrucks])
  useEffect(() => { reportsRef.current = reports }, [reports])
  useEffect(() => { schedulesRef.current = schedules }, [schedules])
  useEffect(() => { barangayStopsRef.current = barangayStops }, [barangayStops])
  useEffect(() => { stopStatusMapRef.current = stopStatusMap }, [stopStatusMap])
  useEffect(() => { stopDetailsMapRef.current = stopDetailsMap }, [stopDetailsMap])

  // ── Load Leaflet ──
  useEffect(() => {
    injectStopStyles()
    if (window.L) { setLeafletReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    s.onload = () => setLeafletReady(true)
    document.head.appendChild(s)
  }, [])

  // ── Init map ──
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstanceRef.current) return
    const L = window.L
    const map = L.map(mapRef.current, {
      center: LUCENA_CENTER, zoom: 14,
      zoomControl: false, scrollWheelZoom: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)

    mapInstanceRef.current = map
    setTimeout(() => map.invalidateSize(), 150)
    const obs = new ResizeObserver(() => map.invalidateSize())
    obs.observe(mapRef.current)

    return () => { obs.disconnect(); map.remove(); mapInstanceRef.current = null }
  }, [leafletReady])

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !barangayName || isAdmin) return
    let alive = true
    getBarangayCenter(barangayName).then(center => {
      if (alive && mapInstanceRef.current) mapInstanceRef.current.setView(center, 15)
    })
    return () => { alive = false }
  }, [barangayName, isAdmin, leafletReady])

  // ── Poll live data ──
  useEffect(() => {
    const fetchAll = () => {
      // Active trucks — drivers see only their own shift; others see all
      const shiftsUrl = isDriver
        ? '/api/driver/shift/my_active_shift/'
        : '/api/driver/shift/active_shifts/'

      if (!isDriver && !isAdmin && barangayName) {
        api.get(`/api/driver/shift/barangay_stops/?barangay_name=${encodeURIComponent(barangayName)}`)
          .then(res => {
            setActiveTrucks(res.data?.trucks || [])
            setBarangayStops(res.data?.stops || [])
          })
          .catch(() => {
            setActiveTrucks([])
            setBarangayStops([])
          })
      } else {
        api.get(shiftsUrl)
          .then(res => {
            const raw = res.data
            setActiveTrucks(Array.isArray(raw) ? raw : raw ? [raw] : [])
          })
          .catch(() => { })
      }

      // Reports — moderators + citizens see approved pins
      api.get('/api/watcher/reports/map_pins/')
        .then(res => setReports(filterBarangayItems(res.data || [], user)))
        .catch(() => { })

      // Schedules + stop validations — only for roles that show stops
      if (!isDriver) {
        api.get('/api/driver/collection-schedules/')
          .then(res => setSchedules(filterBarangayItems(res.data || [], user)))
          .catch(() => { })

        api.get('/api/watcher/stop-validations/')
          .then(res => {
            const rows = res.data?.results ?? res.data ?? []
            const snap = buildStopValidationSnapshot(rows)
            setStopStatusMap(snap.statusMap)

            const details = new Map()
            rows.forEach(ps => {
              const scheduleId = ps.schedule_id ?? ps.schedule?.id ?? ps.schedule?.pk
              const stopOrder = Number(ps.stop_order ?? ps.stopOrder ?? ps.stop_id)
              if (scheduleId == null || Number.isNaN(stopOrder)) return
              let collectedAt = ''
              try {
                if (ps.collected_at) {
                  const d = new Date(ps.collected_at)
                  if (!isNaN(d)) collectedAt = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }
              } catch { }
              details.set(`${scheduleId}:${stopOrder}`, {
                collectedAt,
                truck: ps.truck_plate || ps.truck || '',
              })
            })
            setStopDetailsMap(details)
          })
          .catch(() => { })
      }
    }

    fetchAll()
    const intv = setInterval(fetchAll, 10_000)
    return () => clearInterval(intv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDriver])

  // ── User GPS ──
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      const map = mapInstanceRef.current
      if (!map || !window.L) return
      const L = window.L
      const lLng = [lat, lng]
      if (!userMarkerRef.current) {
        userMarkerRef.current = L.marker(lLng, {
          icon: L.divIcon({ html: makeYouMarkerHtml(), className: '', iconSize: [18, 18], iconAnchor: [9, 9] }),
          zIndexOffset: 1200,
        }).addTo(map)
      } else {
        userMarkerRef.current.setLatLng(lLng)
      }
    }, () => { }, { enableHighAccuracy: true })
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // ── Redraw when data changes ──
  useEffect(() => {
    if (mapInstanceRef.current) drawLayers(mapInstanceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, activeTrucks, reports, schedules, stopStatusMap])

  // ── Layer helpers ──

  function clearMainLayers(map) {
    Object.values(layersRef.current).forEach(l => { try { map.removeLayer(l) } catch { } })
    layersRef.current = {}
  }

  function clearStopMarkers(map) {
    stopMarkersRef.current.forEach(({ marker }) => { try { map.removeLayer(marker) } catch { } })
    stopMarkersRef.current = new Map()
  }

  function drawLayers(map) {
    const L = window.L
    if (!L) return
    clearMainLayers(map)

    // ── 1. Truck markers ──
    activeTrucksRef.current.forEach(truck => {
      const color = STATUS_COLORS[truck.status] || '#14b8a6'
      const icon = L.divIcon({
        html: makeTruckIconHtml(color, truck.truckId, truck.status),
        className: '', iconSize: [36, 50], iconAnchor: [18, 50],
      })
      const lastUpdate = truck.last_update
        ? new Date(truck.last_update).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
        : 'N/A'

      const m = L.marker([truck.lat, truck.lng], { icon })
        .addTo(map)
        .bindPopup(`<div style="font-family:sans-serif;min-width:160px;">
          <b style="font-size:13px;">🚛 ${truck.truckId}</b><br/>
          <span style="font-size:11px;color:#64748b;">${truck.driver}</span><br/>
          <span style="font-size:11px;color:${color};font-weight:700;">${truck.status === 'active' ? 'LIVE' : truck.status === 'weak_signal' ? 'WEAK SIGNAL' : 'OFFLINE'
          }</span><br/>
          <span style="font-size:10px;color:#94a3b8;">Updated: ${lastUpdate}</span>
        </div>`)

      m.on('click', () => {
        setSelectedTruck({ ...truck, lastUpdate })
        setPanelType('truck')
        setSelectedReport(null)
      })

      layersRef.current[`truck-${truck.id}`] = m
    })

    // ── 2. Stop markers (non-driver roles only) ──
    if (!isDriver) {
      clearStopMarkers(map)

      const pending = schedulesRef.current.filter(s => {
        const st = String(s.status || '').toUpperCase()
        return !['COMPLETED', 'CANCELLED'].includes(st)
      })

      pending.forEach(schedule => {
        const wps = schedule.waypoints || []
        wps.slice(1).forEach((wp, i) => {
          if (!wp.lat || !wp.lng) return
          const stopOrder = i + 1
          const statusKey = `${schedule.id}:${stopOrder}`
          if (!stopStatusMapRef.current.has(statusKey)) return

          const stopStatus = normalizeStopStatus(stopStatusMapRef.current.get(statusKey))
          const details = stopDetailsMapRef.current.get(statusKey)
          const existing = stopMarkersRef.current.get(statusKey)

          if (existing) {
            if (existing.status !== stopStatus) {
              existing.marker.setIcon(L.divIcon({
                html: buildStopMarkerHtml(stopOrder, stopStatus, details),
                className: '',
                iconSize: [24, 24], iconAnchor: [12, 12],
              }))
              existing.status = stopStatus
            }
            return
          }

          const color = STOP_COLORS_MAP[stopStatus]
          const marker = L.marker([Number(wp.lat), Number(wp.lng)], {
            icon: L.divIcon({
              html: buildStopMarkerHtml(stopOrder, stopStatus, details),
              className: '',
              iconSize: [24, 24], iconAnchor: [12, 12],
            }),
            zIndexOffset: 600,
          })
            .addTo(map)
            .bindPopup(`<div style="font-family:sans-serif;min-width:160px;">
              <b style="font-size:12px;">${wp.label || `Stop ${stopOrder}`}</b><br/>
              <span style="font-size:10px;color:${color};font-weight:700;text-transform:uppercase;">
                ${STOP_STATUS_LABELS[stopStatus] || stopStatus}
              </span><br/>
              ${details?.collectedAt ? `<div style="font-size:10px;color:#10b981;margin-top:4px;">✓ ${details.collectedAt}</div>` : ''}
            </div>`)

          stopMarkersRef.current.set(statusKey, { marker, status: stopStatus })
        })
      })
    }

    // ── 3. Report pins (citizen + moderator roles) ──
    reportsRef.current.forEach(r => {
      const lat = r.lat ?? r.latitude
      const lng = r.lng ?? r.longitude
      if (lat == null || lng == null) return

      // Citizens see all approved pins read-only; moderators can act on them
      const icon = L.divIcon({
        html: makeReportIconHtml(r.severity),
        className: '', iconSize: [24, 30], iconAnchor: [6, 30],
      })
      const m = L.marker([lat, lng], { icon }).addTo(map)
      m.on('click', () => {
        setSelectedReport(r)
        setPanelType('report')
        setSelectedTruck(null)
      })
      layersRef.current[`rep-${r.id}`] = m
    })
  }

  // ── Moderation actions ──
  function handleReportAction(action, report) {
    const id = report.report_id || report.id
    if (action === 'approve') {
      api.post(`/api/watcher/reports/${id}/approve/`)
        .then(() => { setPanelType(null); fetchReportsFresh() })
        .catch(err => notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed') }))
    } else if (action === 'reject') {
      const reason = prompt('Reason for rejection:')
      if (!reason?.trim()) return
      api.post(`/api/watcher/reports/${id}/reject/`, { rejection_reason: reason })
        .then(() => { setPanelType(null); fetchReportsFresh() })
        .catch(err => notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed') }))
    } else if (action === 'resolve') {
      api.post('/api/watcher/confirmations/', { report: id })
        .then(() => { setPanelType(null); fetchReportsFresh() })
        .catch(err => notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed to resolve') }))
    }
  }

  function fetchReportsFresh() {
    api.get('/api/watcher/reports/map_pins/')
      .then(res => setReports(res.data || []))
      .catch(() => { })
  }

  function closePanel() { setPanelType(null); setSelectedTruck(null); setSelectedReport(null) }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const showPanel = panelType === 'truck' && selectedTruck
    || panelType === 'report' && selectedReport

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid rgba(20,184,166,0.2)',
        background: '#0f172a',
        isolation: 'isolate',
      }}
    >
      <style>{`
        .ww-mm .leaflet-pane,
        .ww-mm .leaflet-control-container { z-index: 1 !important; }
        .ww-mm .leaflet-top,
        .ww-mm .leaflet-bottom           { z-index: 2 !important; }
        @keyframes mmSlideDown {
          from { opacity:0; transform:translateY(-6px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .ww-mm-fab {
          transition: transform .15s, opacity .15s;
        }
        .ww-mm-fab:hover { transform: scale(1.06) !important; opacity: .9; }
      `}</style>

      {/* ── MAP CANVAS ── */}
      <div
        className="ww-mm"
        ref={mapRef}
        style={{ width: '100%', height, position: 'relative', zIndex: 0 }}
      />

      {/* Loading overlay */}
      {!leafletReady && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height,
          background: '#0f172a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#14b8a6', fontSize: 12, fontWeight: 600 }}>Loading map…</span>
        </div>
      )}

      {/* ── EXPAND BUTTON ── */}
      <button
        onClick={() => navigate('/map')}
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 400,
          background: 'rgba(20,184,166,0.88)', border: 'none',
          color: 'white', borderRadius: 8, padding: '5px 10px',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
          boxShadow: '0 2px 10px rgba(20,184,166,0.35)',
        }}
      >
        ⛶ Full Map
      </button>



      {/* ── STATS BAR (bottom gradient) ── */}
      {!showPanel && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(to top, rgba(15,23,42,.92), transparent)',
          padding: '20px 14px 10px',
          display: 'flex', gap: 16, alignItems: 'flex-end',
          zIndex: 300, pointerEvents: 'none',
        }}>
          <StatDot color="#22c55e" label={`${activeTrucks.length} Active Truck${activeTrucks.length !== 1 ? 's' : ''}`} />
          {!isDriver && (
            <StatDot color="#f59e0b" label={`${reports.length} Report${reports.length !== 1 ? 's' : ''}`} />
          )}
          {canSeeAll && stopStatusMapRef.current.size > 0 && (
            <StatDot color="#14b8a6" label={`${stopStatusMapRef.current.size} Stops`} />
          )}
        </div>
      )}

      {/* ── SLIDE-UP PANEL ── */}
      {panelType === 'truck' && selectedTruck && (
        <TruckPanel truck={selectedTruck} onClose={closePanel} />
      )}
      {panelType === 'report' && selectedReport && (
        <ReportPanel
          report={selectedReport}
          canModerate={canModerate}
          onAction={handleReportAction}
          onClose={closePanel}
        />
      )}
    </div>
  )
}

// ── tiny stat dot ─────────────────────────────────────────────────────────────
function StatDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}` }} />
      <span style={{ color: '#cbd5e1', fontSize: 11 }}>{label}</span>
    </div>
  )
}
