/**
 * CheckInModule.jsx
 * ------------------
 * Second stage of the Driver Shift Workflow.
 * // 2nd step <== do not remove this indicator
 *
 * On mount:
 *  1. Shows driver assignment info + mini map
 *  2. Automatically requests GPS permission
 *  3. Validates driver session (mock)
 *  4. Logs shift start timestamp
 *  5. Auto-advances → setRouteState("ready")
 *
 * No manual interaction required — this is a system boot screen.
 *
 * Props:
 *  - setRouteState: fn
 */

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../../context/AuthContext'
import useShiftTimer from '../../../hooks/useShiftTimer'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'

// ─── MOCK ASSIGNMENT DATA ─────────────────────────────────────────────────────

const MOCK_ASSIGNMENT = {
  route: 'Isabang–Brgy.12 Route',
  truck: '#023AD',
  plateNo: '0123-ABCD',
  barangay: 'Brgy. Isabang, Lucena City',
}

// ─── INIT STEPS ───────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'session', label: 'Verifying driver session…' },
  { key: 'gps', label: 'Activating GPS…' },
  { key: 'timestamp', label: 'Logging shift start time…' },
  { key: 'ready', label: 'All systems ready!' },
]

export default function CheckInModule({ setRouteState }) {
  const { user } = useAuth()
  const { startShift } = useShiftTimer()

  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState([])
  const [gpsStatus, setGpsStatus] = useState('pending')
  const [assignment, setAssignment] = useState(MOCK_ASSIGNMENT)
  const [initError, setInitError] = useState(null)
  const [retryTrigger, setRetryTrigger] = useState(0)

  // ── Leaflet map ──────────────────────────────────────────────────────────────
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const [leafletReady, setLeafletReady] = useState(false)
  const [schedule, setSchedule] = useState(null)
  const [mapLoading, setMapLoading] = useState(true)

  const dutyType = sessionStorage.getItem('ww_duty_type') || 'normal'
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  // ── Load Leaflet CDN ────────────────────────────────────────────────────────
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

  // ── Fetch driver schedule ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    setMapLoading(true)
    api.get('/api/driver/collection-schedules/')
      .then(res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        setSchedule(match || null)
      })
      .catch(() => setSchedule(null))
      .finally(() => setMapLoading(false))
  }, [user?.id])

  // ── Draw Leaflet map ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current || mapLoading) return
    const L = window.L
    const map = L.map(mapRef.current, { center: [13.9373, 121.617], zoom: 14, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapInstance.current = map
    if (schedule?.waypoints?.length > 0) {
      const wps = schedule.waypoints
      const line = L.polyline(wps.map(w => [w.lat, w.lng]), {
        color: '#2ecc71', weight: 5, opacity: 0.85, dashArray: '10,7',
      }).addTo(map)
      const startIcon = L.divIcon({
        html: `<div style="background:#1e2633;border:2px solid #2ecc71;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;box-shadow:0 2px 6px rgba(0,0,0,.5);">🏛️</div>`,
        className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      })
      L.marker([wps[0].lat, wps[0].lng], { icon: startIcon }).addTo(map).bindPopup('<b>Start Point</b>')
      wps.slice(1).forEach((wp, i) => {
        const icon = L.divIcon({
          html: `<div style="background:#5dade2;border:2px solid white;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;color:white;font-size:8px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,.4);">${i + 1}</div>`,
          className: '', iconSize: [18, 18], iconAnchor: [9, 9],
        })
        L.marker([wp.lat, wp.lng], { icon }).addTo(map).bindPopup(`<b>${wp.label || `Stop ${i + 1}`}</b>`)
      })
      map.fitBounds(line.getBounds(), { padding: [30, 30] })
    }
  }, [leafletReady, schedule, mapLoading])

  // ── Cleanup map on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
    }
  }, [])

  // ── Run init sequence on mount or retry ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function runInit() {
      if (cancelled) return

      // ── Step 0: Verify session — use real user data ──────────────────────
      setStepIndex(0)
      try {
        const res = await api.get('/api/driver/shift/profile/')
        if (res.data) {
          const p = res.data
          // Update display
          setAssignment({
            route: p.route || MOCK_ASSIGNMENT.route,
            truck: p.truck || MOCK_ASSIGNMENT.truck,
            plateNo: p.plateNumber || MOCK_ASSIGNMENT.plateNo,
            barangay: p.barangay || MOCK_ASSIGNMENT.barangay,
          })
          // Store for ShiftRouteModule to read
          sessionStorage.setItem('ww_route_name', p.route || '')
          sessionStorage.setItem('ww_truck', p.truck || '')
          sessionStorage.setItem('ww_plate', p.plateNumber || '')
          sessionStorage.setItem('ww_barangay', p.barangay || '')
          sessionStorage.setItem('ww_truck_id', p.truckId || '')
          sessionStorage.setItem('ww_driver_name', p.name || '')
        }
      } catch {
        // 500 or offline — fall back to AuthContext user data
        if (user) {
          const fallback = {
            route: user.assigned_route || MOCK_ASSIGNMENT.route,
            truck: user.truck || MOCK_ASSIGNMENT.truck,
            plateNo: user.plate_number || MOCK_ASSIGNMENT.plateNo,
            barangay: user.barangay_name || MOCK_ASSIGNMENT.barangay,
          }
          setAssignment(fallback)
          sessionStorage.setItem('ww_route_name', fallback.route)
          sessionStorage.setItem('ww_truck', fallback.truck)
          sessionStorage.setItem('ww_plate', fallback.plateNo)
          sessionStorage.setItem('ww_barangay', fallback.barangay)
        }
      }
      await delay(900)
      if (cancelled) return
      setCompleted(c => [...c, 'session'])

      // ── Step 1: Request GPS ──────────────────────────────────────────────
      setStepIndex(1)
      await new Promise(resolve => {
        if (!navigator.geolocation) {
          setGpsStatus('error')
          resolve()
          return
        }
        navigator.geolocation.getCurrentPosition(
          pos => {
            sessionStorage.setItem('ww_gps_lat', pos.coords.latitude)
            sessionStorage.setItem('ww_gps_lng', pos.coords.longitude)
            setGpsStatus('ok')
            resolve()
          },
          () => { setGpsStatus('error'); resolve() },
          { enableHighAccuracy: true, timeout: 8000 }
        )
      })
      await delay(500)
      if (cancelled) return
      setCompleted(c => [...c, 'gps'])

      // ── Step 2: Log shift start ──────────────────────────────────────────
      setStepIndex(2)
      var shiftTs = new Date().toISOString()
      var lat = sessionStorage.getItem('ww_gps_lat')
      var lng = sessionStorage.getItem('ww_gps_lng')

      // Only call shift/start if there's no active shift already
      const alreadyActive = !!localStorage.getItem('ww_shift_start')
      if (!alreadyActive) {
        try {
          await api.post('/api/driver/shift/start/', {
            duty_type: dutyType,
            started_at: shiftTs,
            latitude: lat,
            longitude: lng,
          })
          startShift()
          sessionStorage.setItem('ww_shift_started_at', shiftTs)
        } catch (err) {
          // If backend says already active, just continue — don't block the flow
          if (err.response?.status === 400 && err.response?.data?.error?.includes('active shift')) {
            startShift() // sync local timer
          } else {
            setGpsStatus('error')
            const errMsg = err.response?.data?.error || 'Failed to start shift. Please try again.'
            setInitError(errMsg)
            return
          }
        }
      } else {
        // Shift already active locally — just advance
        sessionStorage.setItem('ww_shift_started_at', shiftTs)
      }

      // ── Step 3: Done ─────────────────────────────────────────────────────
      setStepIndex(3)
      await delay(800)
      if (cancelled) return
      setCompleted(c => [...c, 'ready'])
      await delay(600)
      if (cancelled) return
      setRouteState('shiftroute')
    }

    runInit()
    return () => { cancelled = true }
  }, [retryTrigger])

  const allDone = completed.includes('ready')
  const progress = Math.round((completed.length / STEPS.length) * 100)

  return (
    <>
      <Navbar />
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f8fafc',
        fontFamily: 'var(--font-body)',
      }}>

        {/* ── HEADER ── */}
        <div style={{ padding: '24px 20px 0' }}>

          {/* Back arrow (disabled during init — decorative only) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            color: '#94a3b8', fontSize: 14, fontWeight: 600, marginBottom: 20,
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </div>

          {/* Driver greeting */}
          <h1 style={{
            fontFamily: 'var(--font-head)',
            fontSize: 22, fontWeight: 900,
            color: '#0f172a', margin: '0 0 4px',
            textAlign: 'center',
          }}>
            Hello Driver, <span style={{ fontWeight: 900 }}>{firstName}</span>
          </h1>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{ fontSize: 12, color: '#2563eb', textDecoration: 'underline', cursor: 'default' }}>
              ( Not you? )
            </span>
          </div>

          {/* Assignment info */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ margin: '0 0 4px', fontSize: 14, color: '#0f172a' }}>
              <strong>Assigned Route</strong> : {assignment.route}
            </p>
            <p style={{ margin: '0 0 4px', fontSize: 14, color: '#0f172a' }}>
              <strong>Truck</strong> : {assignment.truck}
            </p>
            <p style={{ margin: 0, fontSize: 14, color: '#0f172a' }}>
              <strong>PlateNo.</strong> : {assignment.plateNo}
            </p>
          </div>

          {/* ── Live Route Map ── */}
          <div style={{ position: 'relative', width: '100%', height: 200, background: '#1e293b', borderRadius: 16, overflow: 'hidden', border: '1px solid #e2e8f0', marginBottom: 24 }}>
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

            {/* Loading overlay */}
            {(mapLoading || !leafletReady) && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(30,41,59,0.88)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: '#fff', gap: 8,
              }}>
                <div style={{ fontSize: 28 }}>🗺️</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{mapLoading ? 'Loading route…' : 'Preparing map…'}</div>
              </div>
            )}

            {/* No route overlay */}
            {!mapLoading && leafletReady && !schedule && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(30,41,59,0.88)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: '#fff', gap: 6, padding: 16, textAlign: 'center',
              }}>
                <div style={{ fontSize: 28 }}>📍</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>No route configured yet</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{assignment.barangay}</div>
              </div>
            )}

            {/* Barangay label chip */}
            {assignment.barangay && (
              <div style={{
                position: 'absolute', bottom: 8, left: 8,
                background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(4px)',
                color: '#fff', borderRadius: 20, padding: '3px 10px',
                fontSize: 11, fontWeight: 600,
              }}>
                📍 {assignment.barangay}
              </div>
            )}
          </div>

          {/* GPS instruction */}
          <p style={{
            fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 6,
          }}>
            Head to your base location to start duty,{' '}
            <strong style={{ color: '#0f172a' }}>{assignment.barangay}</strong>{' '}
            — wait for location verification, please enable GPS.
          </p>
          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 28 }}>
            ( This might take a while )
          </p>
        </div>

        {/* ── INIT STEPS ── */}
        <div style={{ padding: '0 20px', flex: 1 }}>

          {/* Status badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: initError ? 'rgba(239,68,68,0.1)' : allDone ? 'rgba(46,204,113,0.1)' : 'rgba(59,130,246,0.1)',
            border: `1px solid ${initError ? 'rgba(239,68,68,0.4)' : allDone ? 'rgba(46,204,113,0.4)' : 'rgba(59,130,246,0.4)'}`,
            borderRadius: 20, padding: '5px 14px', marginBottom: 16,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: initError ? '#ef4444' : allDone ? '#2ecc71' : '#3b82f6',
              animation: allDone || initError ? 'none' : 'ciPulse 1.2s ease infinite',
              display: 'inline-block',
            }} />
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '.06em',
              color: initError ? '#ef4444' : allDone ? '#15803d' : '#1d4ed8',
            }}>
              {initError ? 'INITIALIZATION FAILED' : allDone ? 'SHIFT ACTIVE' : 'INITIALIZING SHIFT'}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{
            background: '#e2e8f0', borderRadius: 99, height: 6,
            overflow: 'hidden', marginBottom: 20,
          }}>
            <div style={{
              height: '100%', borderRadius: 99,
              background: initError
                ? '#ef4444'
                : allDone
                  ? 'linear-gradient(90deg,#2ecc71,#16a34a)'
                  : 'linear-gradient(90deg,#3b82f6,#2563eb)',
              width: `${progress}%`,
              transition: 'width .5s ease',
            }} />
          </div>

          {/* Step list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {STEPS.map((step, i) => {
              const isDone = completed.includes(step.key)
              const isActive = stepIndex === i && !isDone
              const isPending = stepIndex < i

              let icon = '○'
              let color = '#94a3b8'
              if (isDone) { icon = '✓'; color = '#2ecc71' }
              else if (initError && isActive) { icon = '✕'; color = '#ef4444' }
              else if (isActive) { icon = '⟳'; color = '#3b82f6' }

              // Special GPS status
              let label = step.label
              if (step.key === 'gps' && isDone) {
                label = gpsStatus === 'ok'
                  ? 'GPS activated ✓'
                  : 'GPS unavailable — continuing with limited tracking'
              }

              return (
                <div key={step.key} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  opacity: isPending ? 0.35 : 1,
                  transition: 'opacity .3s',
                }}>
                  <span style={{
                    fontSize: 16, color, fontWeight: 800, width: 20, textAlign: 'center',
                    animation: isActive && !initError ? 'ciSpin 1s linear infinite' : 'none',
                    display: 'inline-block',
                  }}>
                    {icon}
                  </span>
                  <span style={{
                    fontSize: 14, fontWeight: isDone ? 600 : 400,
                    color: isDone ? '#0f172a' : isActive ? (initError ? '#ef4444' : '#3b82f6') : '#94a3b8',
                  }}>
                    {label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Detailed Error Card */}
          {initError && (
            <div style={{
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 14,
              padding: '16px 18px',
              marginTop: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              animation: 'ciFadeIn .25s ease',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <span style={{ fontWeight: 800, color: '#ef4444', fontSize: 14 }}>
                  Shift Initialization Failed
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                {initError}
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  id="retry-checkin-btn"
                  onClick={() => {
                    setInitError(null)
                    setCompleted([])
                    setStepIndex(0)
                    setRetryTrigger(prev => prev + 1)
                  }}
                  style={{
                    flex: 1, padding: '12px 14px', borderRadius: 20,
                    background: '#ef4444', color: '#fff', border: 'none',
                    fontFamily: 'var(--font-head)', fontSize: 12, fontWeight: 900,
                    cursor: 'pointer', boxShadow: '0 4px 12px rgba(239,68,68,0.2)'
                  }}
                >
                  Retry Check-In
                </button>
                <button
                  id="back-to-assignment-btn"
                  onClick={() => setRouteState('assignment')}
                  style={{
                    padding: '12px 16px', borderRadius: 20,
                    background: '#fff', color: '#475569', border: '1px solid #cbd5e1',
                    fontFamily: 'var(--font-head)', fontSize: 12, fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Go Back
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── BOTTOM BANNER ── */}
        <div style={{
          background: '#0f172a',
          padding: '20px 24px',
          marginTop: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 60,
        }}>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, letterSpacing: '.06em' }}>
            Track · Monitor · Report
          </span>
        </div>

        <style>{`
          @keyframes ciPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
          @keyframes ciSpin  { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </>
  )
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
