// 1st step <== do not remove this indicator

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Ban, Calendar, CheckCircle2, Clock, Play, Users } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import api from '../../../api/client'
import {
  resolveDriverSchedule,
  evaluateScheduleShiftTiming,
  formatScheduleDays,
  formatTime12h,
} from '../../../utils/driverSchedule'
import { MapSkeleton } from '../../../components/ui/Skeleton'
import CrewAttendanceBoard from '../../../components/CrewAttendanceBoard'
import {
  ALLOWED_ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_META,
  normalizeAttendanceDetail,
} from '../../../utils/crewAttendanceHelpers'
import {
  buildClosedLoopWaypoints,
  formatReadinessErrorLabel,
  LUCENA_DEFAULT_VIEW_CENTER,
  resolveScheduleDumpsiteOrigin,
  resolveScheduleReturnDestination,
  resolveScheduleStops,
} from '../../../utils/routeBaseHelpers'
import { getPreallocatedTruck, getTeamRoster } from '../../../api/driverWorkflowApi'
import { getApiErrorMessage } from '../../../utils/notificationHelpers'

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

export default function AssignmentModule({ onAdvance, setActiveShift, truckPreviousShifts = [] }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [allocation, setAllocation] = useState(null)
  const [allocationLoading, setAllocationLoading] = useState(false)
  const [allocationError, setAllocationError] = useState(null)
  const [startError, setStartError] = useState(null)
  const [starting, setStarting] = useState(false)
  const [teamRoster, setTeamRoster] = useState(null)
  const [attendanceMap, setAttendanceMap] = useState({})
  const [attendanceSubmitted, setAttendanceSubmitted] = useState(false)

  // ── Leaflet map state ───────────────────────────────────────────────────────
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const [leafletReady, setLeafletReady] = useState(false)
  const [mapLoading, setMapLoading] = useState(true)

  const firstName = user?.full_name?.split(' ')[0] || 'Driver'
  const truckLabel = allocation?.truck_model
    || (allocation?.truck_plate ? `TRUCK ${allocation.truck_plate}` : null)
    || profile?.truck
    || 'No Truck Assigned'
  const plateLabel = allocation?.truck_plate || profile?.plateNumber || '—'
  const routeLabel = schedule?.area || schedule?.barangay_names || profile?.route || 'No Route Assigned'
  const barangayLabel = schedule?.barangay_names || profile?.barangay || '—'

  // 1. Fetch driver profile ────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/driver/shift/profile/')
      .then(res => setProfile(res.data))
      .catch(() => { })
  }, [])

  // 2. Once we have the driver id, fetch their collection schedule ─────────────
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!user?.id) return
    setMapLoading(true)
    api.get('/api/driver/collection-schedules/?paginate=false')
      .then(res => {
        const match = resolveDriverSchedule(res.data, user.id)
        setSchedule(match || null)
      })
      .catch(() => setSchedule(null))
      .finally(() => setMapLoading(false))
  }, [user?.id])

  const loadAllocation = useCallback(() => {
    if (!user?.id || !schedule?.id) {
      setAllocation(null)
      setAllocationError(null)
      setAllocationLoading(false)
      return Promise.resolve(null)
    }
    setAllocationLoading(true)
    setAllocationError(null)
    return getPreallocatedTruck(schedule.id)
      .then(data => {
        if (data?.has_allocation && data?.allocation?.id && data.allocation.schedule === schedule.id) {
          setAllocation(data.allocation)
          setAllocationError(null)
          return data.allocation
        }
        setAllocation(null)
        setAllocationError('No truck allocation is assigned for this route today.')
        return null
      })
      .catch(err => {
        setAllocation(null)
        setAllocationError(getApiErrorMessage(err, 'Unable to verify truck allocation for this route.'))
        return null
      })
      .finally(() => setAllocationLoading(false))
  }, [user?.id, schedule?.id])

  useEffect(() => {
    let cancelled = false
    if (!user?.id || !schedule?.id) {
      setAllocation(null)
      setAllocationError(null)
      setAllocationLoading(false)
      return () => { cancelled = true }
    }
    setAllocationLoading(true)
    setAllocationError(null)
    getPreallocatedTruck(schedule.id)
      .then(data => {
        if (cancelled) return
        if (data?.has_allocation && data?.allocation?.id && data.allocation.schedule === schedule.id) {
          setAllocation(data.allocation)
          setAllocationError(null)
        } else {
          setAllocation(null)
          setAllocationError('No truck allocation is assigned for this route today.')
        }
      })
      .catch(err => {
        if (cancelled) return
        setAllocation(null)
        setAllocationError(getApiErrorMessage(err, 'Unable to verify truck allocation for this route.'))
      })
      .finally(() => {
        if (!cancelled) setAllocationLoading(false)
      })
    return () => { cancelled = true }
  }, [user?.id, schedule?.id])

  const loadTeamRoster = useCallback(() => {
    if (!user?.id) return
    getTeamRoster({ scheduleId: schedule?.id ?? null })
      .then(data => {
        setTeamRoster(data)
        const normalized = normalizeAttendanceDetail(data, user)
        if (normalized.attendanceSubmitted) {
          setAttendanceSubmitted(true)
          const savedMap = {}
          normalized.records.forEach(rec => {
            savedMap[rec.worker_id] = rec.effective_status
          })
          setAttendanceMap(savedMap)
        } else {
          setAttendanceSubmitted(false)
        }
      })
      .catch(() => setTeamRoster(null))
  }, [user, schedule?.id])

  useEffect(() => {
    loadTeamRoster()
  }, [loadTeamRoster])

  const normalizedAttendance = useMemo(
    () => normalizeAttendanceDetail(teamRoster, user),
    [teamRoster, user]
  )
  const { ownership } = normalizedAttendance
  const showDriverAttendanceEditor = Boolean(
    ownership.hasTeam && ownership.isDriverLed && !ownership.isWatcherLed && ownership.canSubmitInitial
  )
  const showAttendanceBoard = Boolean(
    ownership.hasTeam && (normalizedAttendance.attendanceSubmitted || ownership.isWatcherLed)
  )
  const crewMembers = normalizedAttendance.roster
  const allCrewMarked = crewMembers.every(m => ALLOWED_ATTENDANCE_STATUSES.includes(attendanceMap[m.worker_id]))
  const needsAttendanceBeforeStart = Boolean(
    showDriverAttendanceEditor && !attendanceSubmitted && crewMembers.length > 0 && !allCrewMarked
  )

  const dumpsiteOrigin = useMemo(() => resolveScheduleDumpsiteOrigin(schedule), [schedule])
  const routeStops = useMemo(() => resolveScheduleStops(schedule), [schedule])
  const dumpsiteReturn = useMemo(() => resolveScheduleReturnDestination(schedule), [schedule])
  const readinessErrors = useMemo(() => {
    const errs = Array.isArray(schedule?.readiness_errors) ? [...schedule.readiness_errors] : []
    if (schedule && !dumpsiteOrigin && !errs.includes('missing_dumpsite')) {
      errs.push('missing_dumpsite')
    }
    if (schedule && routeStops.length === 0 && !errs.includes('missing_stops')) {
      errs.push('missing_stops')
    }
    if (profile?.truck_detail?.is_operational_hold || profile?.is_operational_hold) {
      if (!errs.includes('truck_on_hold')) errs.push('truck_on_hold')
    }
    if (profile?.truck_detail?.is_retired || profile?.is_retired) {
      if (!errs.includes('truck_retired')) errs.push('truck_retired')
    }
    return errs
  }, [schedule, dumpsiteOrigin, routeStops.length, profile])
  const isOperationallyReady = Boolean(
    schedule &&
      schedule.is_operationally_ready !== false &&
      dumpsiteOrigin &&
      routeStops.length > 0 &&
      readinessErrors.length === 0
  )

  const todayWeekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const timing = evaluateScheduleShiftTiming(schedule, now)
  const hasScheduleToday = timing.hasScheduleToday
  const isRouteDone = schedule?.truck_status === 'completed'
  const isShiftEndedIncomplete = schedule?.truck_status === 'returning_unfinished'
  const isShiftDone = isRouteDone || isShiftEndedIncomplete
  const isAllocationReady = Boolean(
    allocation?.id && !allocationLoading && !allocationError
  )
  const isStartBlocked = Boolean(
    mapLoading ||
    allocationLoading ||
    user?.is_suspended ||
    !schedule ||
    !hasScheduleToday ||
    !isOperationallyReady ||
    !isAllocationReady ||
    isShiftDone
  )

  // 3. Load Leaflet from CDN (once) ─────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setLeafletReady(true)
    document.head.appendChild(script)
  }, [])

  // 4. Draw map once Leaflet + schedule are ready ───────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current || mapLoading) return

    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_DEFAULT_VIEW_CENTER, zoom: 14, zoomControl: false })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapInstance.current = map

    if (!schedule) return

    const origin = resolveScheduleDumpsiteOrigin(schedule)
    const stops = resolveScheduleStops(schedule)
    const returnDest = resolveScheduleReturnDestination(schedule) || origin

    // ── Assigned Dumpsite Marker (Start & Return Base) ────────────────────
    if (origin) {
      const dsIcon = L.divIcon({
        html: `<div style="background:#15803d;border:2.5px solid white;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(21,128,61,.35);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg></div>`,
        className: '', iconSize: [32, 32], iconAnchor: [16, 16],
      })
      L.marker([origin.lat, origin.lng], { icon: dsIcon })
        .addTo(map)
        .bindPopup(`<b>${origin.label}</b><br/><span style="font-size:11px;color:#15803d;font-weight:700;">ASSIGNED DUMPSITE (START &amp; RETURN)</span>`)
    }

    // ── Stop markers ──────────────────────────────────────────────────────
    stops.forEach((wp, i) => {
      const stopIcon = L.divIcon({
        html: `<div style="background:#5dade2;border:2px solid white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,.4);">${i + 1}</div>`,
        className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      })
      L.marker([wp.lat, wp.lng], { icon: stopIcon }).addTo(map).bindPopup(`<b>${wp.label || `Stop ${i + 1}`}</b>`)
    })

    // ── Closed-loop route (Assigned Dumpsite -> Stops -> Same Assigned Dumpsite) ──
    if (schedule.route_geometry) {
      const pts = decodePolyline(schedule.route_geometry)
      if (pts.length > 0) {
        const line = L.polyline(pts, { color: '#16a34a', weight: 5, opacity: 0.85 }).addTo(map)
        map.fitBounds(line.getBounds(), { padding: [30, 30] })
        return
      }
    }

    const { closedLoopPoints } = buildClosedLoopWaypoints({
      dumpsite: origin ? { ...origin, latitude: origin.lat, longitude: origin.lng } : null,
      stops,
    })
    const allPts = returnDest && origin && closedLoopPoints.length > 0 ? closedLoopPoints : stops
    if (allPts.length === 0) return

    const latlngs = allPts.map(w => [w.lat, w.lng])
    const fallbackLine = L.polyline(latlngs, {
      color: '#2ecc71', weight: 3, opacity: 0.35, dashArray: '6, 6',
    }).addTo(map)
    map.fitBounds(fallbackLine.getBounds(), { padding: [30, 30] })

    // ── ORS actual road route ─────────────────────────────────────────────
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey || allPts.length < 2) return

    const coordinates = allPts.slice(0, 50).map(w => [w.lng, w.lat])

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: orsApiKey,
      },
      body: JSON.stringify({ coordinates }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length || !mapInstance.current) return
        map.removeLayer(fallbackLine)
        const pts = decodePolyline(data.routes[0].geometry)
        const orsLine = L.polyline(pts, { color: '#2ecc71', weight: 5, opacity: 0.85 }).addTo(map)
        map.fitBounds(orsLine.getBounds(), { padding: [30, 30] })
      })
      .catch(() => { /* fallbackLine stays visible */ })
  }, [leafletReady, schedule, mapLoading])

  // 5. Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
    }
  }, [])

  const [closedNotice, setClosedNotice] = useState(false)
  useEffect(() => {
    try {
      const noticeTime = Number(sessionStorage.getItem('ww_shift_closed_notice'))
      if (noticeTime && Date.now() - noticeTime < 5 * 60 * 1000) {
        setClosedNotice(true)
        sessionStorage.removeItem('ww_shift_closed_notice')
      }
    } catch (e) { }
  }, [])

  return (
    <>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc', fontFamily: 'var(--font-body)', overflowX: 'hidden' }}>
        <div style={{ flex: 1, padding: '20px 20px 0' }}>

          {closedNotice && (
            <div style={{ marginBottom: 16, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.5)', borderRadius: 12, padding: '12px 16px', color: '#b91c1c', fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" style={{ flexShrink: 0, marginTop: 2 }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <strong style={{ display: 'block', marginBottom: 2 }}>Your shift was closed.</strong>
                <div style={{ opacity: 0.85, lineHeight: 1.4 }}>This happens if there is no signal for an extended period or an admin ends it. Start a new shift to continue.</div>
              </div>
            </div>
          )}

          {/* Back */}
          <button onClick={() => navigate('/dashboard')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a', fontWeight: 600, fontSize: 14, padding: 0, marginBottom: 24 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </button>

          {/* Greeting */}
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, textAlign: 'center', color: '#0f172a', marginBottom: 4 }}>
            Hello, {firstName}
          </h1>
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginBottom: 20 }}>
            Are you ready to ride?
          </p>

          {/* Assignment summary card */}
          <div style={{ background: '#1e2a3a', borderRadius: 14, padding: '16px 18px', marginBottom: 20, color: '#fff' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.45)', letterSpacing: '.08em', marginBottom: 10 }}>TODAY'S ASSIGNMENT</div>
            {[
              { label: 'Route', value: routeLabel },
              { label: 'Truck', value: truckLabel },
              { label: 'Plate No.', value: plateLabel },
              { label: 'Barangay', value: barangayLabel },
              { label: 'Base & Return', value: dumpsiteOrigin?.label || dumpsiteReturn?.label || 'Unassigned Dumpsite' },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.value.startsWith('No') || r.value.startsWith('Unassigned') || r.value === '—' ? '#f59e0b' : '#fff' }}>{r.value}</span>
              </div>
            ))}
          </div>

          {truckPreviousShifts.length > 0 && (
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '12px 14px',
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', letterSpacing: '.06em', marginBottom: 8 }}>
                TRUCK PREVIOUS SHIFTS TODAY ({truckPreviousShifts.length})
              </div>
              {truckPreviousShifts.slice(0, 3).map(ps => {
                const sTime = ps.started_at
                  ? new Date(ps.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : '—'
                const eTime = ps.ended_at
                  ? new Date(ps.ended_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  : '—'
                return (
                  <div
                    key={ps.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 12,
                      padding: '4px 0',
                      color: '#334155',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {ps.truck_plate ? `TRUCK ${ps.truck_plate}` : `Shift #${ps.id}`}
                      {ps.driver_name ? ` · ${ps.driver_name}` : ''}
                    </span>
                    <span style={{ color: '#64748b', fontSize: 11 }}>
                      {sTime} – {eTime}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Inline Route Map ─────────────────────────────────────────────── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', letterSpacing: '.03em', display: 'flex', alignItems: 'center', gap: 6 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Your Route Map</span>
              {schedule && (
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  {routeStops.length} collection stop{routeStops.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div style={{ position: 'relative', width: '100%', height: 260, background: '#1e293b', borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              {/* Leaflet map container */}
              <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

              {/* Loading overlay */}
              {(mapLoading || !leafletReady) && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 500 }}>
                  <MapSkeleton height="100%" dark label={mapLoading ? 'Loading route...' : 'Preparing map...'} showControls={false} />
                </div>
              )}

              {/* No route overlay */}
              {!mapLoading && leafletReady && !schedule && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(30,41,59,0.92)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', padding: 20, textAlign: 'center', gap: 6,
                }}>
                  <div style={{ color: '#94a3b8' }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>No Route Assigned</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Your admin hasn't built a route for you yet.</div>
                </div>
              )}
            </div>

            {/* Route info strip under map */}
            {schedule && (
              <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '10px 14px', marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {schedule.days && (
                  <div>
                    <div style={{ fontSize: 9, color: '#64748b', fontWeight: 800, letterSpacing: '.06em' }}>DAYS</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{schedule.days}</div>
                  </div>
                )}
                {schedule.start_time && (
                  <div>
                    <div style={{ fontSize: 9, color: '#64748b', fontWeight: 800, letterSpacing: '.06em' }}>TIME</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                      {formatTime12h(schedule.start_time)}{schedule.end_time ? ` – ${formatTime12h(schedule.end_time)}` : ''}
                    </div>
                  </div>
                )}
                {schedule.barangay_names && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#64748b', fontWeight: 800, letterSpacing: '.06em' }}>BARANGAYS</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{schedule.barangay_names}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Schedule / Suspension / Late Gating Banner */}
          {!mapLoading && user?.is_suspended && (
            <div style={{
              marginBottom: 16, borderRadius: 12, padding: '12px 14px',
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)',
              display: 'flex', alignItems: 'flex-start', gap: 10, color: '#991b1b',
            }}>
              <Ban size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Account Suspended</strong>
                Your account is currently suspended. You cannot start a shift until unresolved escalations are cleared.
              </div>
            </div>
          )}

          {!mapLoading && !user?.is_suspended && (!schedule || !hasScheduleToday) && (
            <div style={{
              marginBottom: 16, borderRadius: 12, padding: '12px 14px',
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)',
              display: 'flex', alignItems: 'flex-start', gap: 10, color: '#92400e',
            }}>
              <Calendar size={18} style={{ flexShrink: 0, marginTop: 2, color: '#b45309' }} />
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>No Scheduled Collection Today</strong>
                {schedule
                  ? <>Today is <strong>{todayWeekday}</strong>. Your assigned schedule only runs on <strong>{formatScheduleDays(schedule.days)}</strong>.</>
                  : 'You do not have an assigned collection route for today.'}
              </div>
            </div>
          )}

          {!mapLoading && !user?.is_suspended && schedule && hasScheduleToday && !isShiftDone && timing.isOffSchedule && (
            <div style={{
              marginBottom: 16, borderRadius: 12, padding: '12px 14px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.45)',
              display: 'flex', alignItems: 'flex-start', gap: 10, color: '#92400e',
            }}>
              <Clock size={18} style={{ flexShrink: 0, marginTop: 2, color: '#d97706' }} />
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>
                  {timing.isLate ? 'Behind Scheduled Start Time' : 'Ahead of Scheduled Window'}
                </strong>
                You are scheduled for <strong>{timing.formattedWindow || timing.formattedStart}</strong> today. Starting now will log this shift outside your normal start time.
              </div>
            </div>
          )}

          {!mapLoading && !user?.is_suspended && schedule && readinessErrors.length > 0 && (
            <div style={{
              marginBottom: 16, borderRadius: 12, padding: '12px 14px',
              background: '#fef2f2', border: '1px solid #fecaca',
              display: 'flex', alignItems: 'flex-start', gap: 10, color: '#991b1b',
            }}>
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Deployment Readiness Blocked</strong>
                {readinessErrors.map(formatReadinessErrorLabel).join(' ')}
              </div>
            </div>
          )}

          {!mapLoading && !allocationLoading && !user?.is_suspended && schedule && hasScheduleToday && !isShiftDone && allocationError && (
            <div style={{
              marginBottom: 16, borderRadius: 12, padding: '12px 14px',
              background: '#fef2f2', border: '1px solid #fecaca',
              display: 'flex', alignItems: 'flex-start', gap: 10, color: '#991b1b',
            }}>
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                <strong style={{ display: 'block', marginBottom: 2 }}>Truck Allocation Required</strong>
                {allocationError}
              </div>
            </div>
          )}

          {/* Crew Attendance: Driver-Led Roll-Call OR Watcher-Led Read-Only / Correction History */}
          {showAttendanceBoard ? (
            <div style={{ marginBottom: 16 }}>
              <CrewAttendanceBoard
                mode="driver"
                scheduleId={schedule?.id}
                initialData={teamRoster}
                compact
                onSubmitted={loadTeamRoster}
                onCorrected={loadTeamRoster}
              />
            </div>
          ) : showDriverAttendanceEditor ? (
            <div style={{
              marginBottom: 16,
              padding: '14px 16px',
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              background: '#ffffff',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Users size={18} color="#0f766e" />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                      Crew Roll-Call — {teamRoster?.team?.name || 'Assigned Team'}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Driver Team Leader pre-departure roll call (you are excluded from crew roll call)
                    </div>
                  </div>
                </div>
                {attendanceSubmitted && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 999,
                    background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 700,
                  }}>
                    <CheckCircle2 size={13} /> Submitted
                  </span>
                )}
              </div>

              {crewMembers.length === 0 ? (
                <div style={{ fontSize: 12.5, color: '#64748b' }}>
                  No crew members assigned to this team.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {crewMembers.map(member => {
                    const selected = attendanceMap[member.worker_id]
                    return (
                      <div key={member.worker_id} style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{member.full_name}</span>
                          <span style={{ fontSize: 11.5, color: '#64748b', fontFamily: 'monospace' }}>{member.employee_id}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                          {ALLOWED_ATTENDANCE_STATUSES.map(statusKey => {
                            const opt = ATTENDANCE_STATUS_META[statusKey]
                            const isActive = selected === statusKey
                            return (
                              <button
                                key={statusKey}
                                type="button"
                                disabled={attendanceSubmitted || starting}
                                onClick={() => setAttendanceMap(prev => ({ ...prev, [member.worker_id]: statusKey }))}
                                style={{
                                  padding: '6px 4px',
                                  borderRadius: 8,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  border: isActive ? `1px solid ${opt.activeBg}` : '1px solid #cbd5e1',
                                  background: isActive ? opt.activeBg : '#ffffff',
                                  color: isActive ? '#ffffff' : '#475569',
                                  cursor: attendanceSubmitted ? 'default' : 'pointer',
                                  opacity: attendanceSubmitted && !isActive ? 0.55 : 1,
                                }}
                              >
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {needsAttendanceBeforeStart && (
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: '#b45309' }}>
                  Select an attendance status for every crew member before starting duty.
                </div>
              )}
            </div>
          ) : null}

          {/* Start button */}
          <button
            id="start-duty-btn"
            disabled={starting || isStartBlocked || needsAttendanceBeforeStart}
            onClick={async () => {
              if (starting || isStartBlocked || needsAttendanceBeforeStart) return
              setStartError(null)
              setStarting(true)
              try {
                sessionStorage.setItem('ww_duty_type', 'normal')
                const payload = {
                  duty_type: 'normal',
                  schedule_id: schedule?.id,
                  allocation_id: allocation.id,
                }
                if (showDriverAttendanceEditor && !attendanceSubmitted && crewMembers.length > 0) {
                  payload.attendance = crewMembers.map(m => ({
                    worker_id: m.worker_id,
                    status: attendanceMap[m.worker_id],
                  }))
                }
                const res = await api.post('/api/driver/shift/pre_start/', payload)
                if (res.data?.attendance_submitted) {
                  setAttendanceSubmitted(true)
                  loadTeamRoster()
                }
                if (setActiveShift) setActiveShift(res.data)
                window.dispatchEvent(new Event('ww_shift_updated'))
                onAdvance('navigate_to_base')
              } catch (err) {
                setStartError(getApiErrorMessage(err, 'Failed to start shift. Please try again.'))
                if (err?.response?.status === 400 || err?.response?.status === 409) {
                  loadAllocation()
                  loadTeamRoster()
                }
              } finally {
                setStarting(false)
              }
            }}
            style={{
              width: '100%',
              padding: '16px 18px',
              borderRadius: 30,
              background: (starting || isStartBlocked || needsAttendanceBeforeStart)
                ? '#cbd5e1'
                : timing.isOffSchedule
                  ? '#d97706'
                  : '#10b981',
              color: (starting || isStartBlocked || needsAttendanceBeforeStart) ? '#64748b' : '#fff',
              border: 'none',
              fontFamily: 'var(--font-head)',
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: '.04em',
              cursor: (starting || isStartBlocked || needsAttendanceBeforeStart) ? 'not-allowed' : 'pointer',
              boxShadow: (starting || isStartBlocked || needsAttendanceBeforeStart)
                ? 'none'
                : timing.isOffSchedule
                  ? '0 4px 14px rgba(217,119,6,0.32)'
                  : '0 4px 14px rgba(16,185,129,0.3)',
              marginBottom: startError ? 12 : 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              textAlign: 'center',
            }}
          >
            {user?.is_suspended ? (
              <><Ban size={18} /> ACCOUNT SUSPENDED</>
            ) : !schedule ? (
              <><Ban size={18} /> NO ROUTE ASSIGNED</>
            ) : !isOperationallyReady ? (
              <><AlertTriangle size={18} /> DEPLOYMENT NOT READY</>
            ) : !hasScheduleToday ? (
              <><Ban size={18} /> NO SCHEDULED DUTY TODAY</>
            ) : allocationLoading ? (
              'Checking allocation…'
            ) : !isAllocationReady ? (
              <><AlertTriangle size={18} /> ALLOCATION REQUIRED</>
            ) : isRouteDone ? (
              <><CheckCircle2 size={18} /> ROUTE COMPLETED TODAY</>
            ) : isShiftEndedIncomplete ? (
              <><CheckCircle2 size={18} /> SHIFT ENDED EARLY</>
            ) : starting ? (
              'Starting…'
            ) : timing.isOffSchedule ? (
              <><Clock size={18} /> {timing.ctaLabel}</>
            ) : (
              <><Play size={18} fill="currentColor" /> START NORMAL DUTY</>
            )}
          </button>

          {startError && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10, padding: '10px 14px', marginBottom: 20,
              fontSize: 13, color: '#dc2626', fontWeight: 600, lineHeight: 1.5,
            }}>
              {startError}
            </div>
          )}
        </div>

        {/* Bottom banner */}
        <div style={{ background: '#0f172a', padding: '28px 24px', display: 'flex', alignItems: 'flex-end', gap: 16, minHeight: 140, position: 'relative', overflow: 'hidden' }}>
          <div style={{ flex: 1, zIndex: 1 }}>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, color: '#fff', lineHeight: 1.3, marginBottom: 8, textTransform: 'uppercase' }}>
              " One app for monitoring all waste management related stuff "
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: '.06em', fontWeight: 600 }}>Track · Monitor · Report</p>
          </div>
          <div style={{ position: 'absolute', right: -10, bottom: 0, opacity: 0.9, filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))', userSelect: 'none', color: '#16a34a' }}>
            <svg width="100" height="100" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h2v12H3zm3 0h4v12H6zm5 0h4v12h-4zm5 3h4v6h-4zm1 8h2v2h-2zm-6 0h2v2h-2zm-6 0h2v2H6zm-3 0h2v2H3z" /></svg>
          </div>
        </div>
      </div>
    </>
  )
}
