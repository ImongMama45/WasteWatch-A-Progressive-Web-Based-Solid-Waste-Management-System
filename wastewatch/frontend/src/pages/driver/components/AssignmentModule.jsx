// 1st step <== do not remove this indicator



import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'

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

export default function AssignmentModule({ onAdvance, setActiveShift }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [startError, setStartError] = useState(null)
  const [starting, setStarting] = useState(false)

  // ── Leaflet map state ───────────────────────────────────────────────────────
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const [leafletReady, setLeafletReady] = useState(false)
  const [mapLoading, setMapLoading] = useState(true)

  const firstName = user?.full_name?.split(' ')[0] || 'Driver'
  const truckLabel = profile?.truck || 'No Truck Assigned'
  const plateLabel = profile?.plateNumber || '—'
  const routeLabel = profile?.route || 'No Route Assigned'
  const barangayLabel = profile?.barangay || '—'

  // 1. Fetch driver profile ────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/driver/shift/profile/')
      .then(res => setProfile(res.data))
      .catch(() => { })
  }, [])

  // 2. Once we have the driver id, fetch their collection schedule ─────────────
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
  // 4. Draw map once Leaflet + schedule are ready ───────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current || mapLoading) return

    const L = window.L
    const map = L.map(mapRef.current, { center: [13.9373, 121.617], zoom: 14, zoomControl: false })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapInstance.current = map

    if (!schedule?.waypoints?.length) return

    const wps = schedule.waypoints

    // ── Start marker (Base) ───────────────────────────────────────────────
    const baseIcon = L.divIcon({
      html: `<div style="background:#fff;border:2.5px solid #16A34A;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.18);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></div>`,
      className: '', iconSize: [32, 32], iconAnchor: [16, 16],
    })
    L.marker([wps[0].lat, wps[0].lng], { icon: baseIcon }).addTo(map).bindPopup(`<b>Start Point</b><br>${wps[0].label || 'Home Base'}`)

    // ── Stop markers ──────────────────────────────────────────────────────
    wps.slice(1).forEach((wp, i) => {
      const stopIcon = L.divIcon({
        html: `<div style="background:#5dade2;border:2px solid white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,.4);">${i + 1}</div>`,
        className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      })
      L.marker([wp.lat, wp.lng], { icon: stopIcon }).addTo(map).bindPopup(`<b>${wp.label || `Stop ${i + 1}`}</b>`)
    })

    // ── Dumpsite Marker ───────────────────────────────────────────────────
    if (schedule?.dumpsite_detail) {
      const ds = schedule.dumpsite_detail
      const dsIcon = L.divIcon({
        html: `<div style="background:#DC2626;border:2px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.18);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20"></path><path d="M5 20V8l7-3v15"></path><path d="M12 20V4l8 4v12"></path></svg></div>`,
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      })
      L.marker([+ds.latitude, +ds.longitude], { icon: dsIcon }).addTo(map).bindPopup(`<b>${ds.name}</b>`)
    }

    // ── Full Route Coordinates ────────────────────────────────────────────
    const allPts = [...wps]
    if (schedule?.dumpsite_detail) {
      allPts.push({ lat: +schedule.dumpsite_detail.latitude, lng: +schedule.dumpsite_detail.longitude })
    }
    allPts.push(wps[0]) // Return to Base

    // ── Fallback dashed straight-line while ORS loads ─────────────────────
    const latlngs = allPts.map(w => [w.lat, w.lng])
    const fallbackLine = L.polyline(latlngs, {
      color: '#2ecc71', weight: 3, opacity: 0.35, dashArray: '6, 6',
    }).addTo(map)
    map.fitBounds(fallbackLine.getBounds(), { padding: [30, 30] })

    // ── ORS actual road route ─────────────────────────────────────────────
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return

    // ORS accepts max 50 coordinates
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
    } catch (e) {}
  }, [])

  return (
    <>
      <Navbar />
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
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.value.startsWith('No') || r.value === '—' ? '#f59e0b' : '#fff' }}>{r.value}</span>
              </div>
            ))}
          </div>

          {/* ── Inline Route Map ─────────────────────────────────────────────── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', letterSpacing: '.03em', display: 'flex', alignItems: 'center', gap: 6 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> Your Route Map</span>
              {schedule && (
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  {schedule.waypoints?.length || 0} waypoints
                </span>
              )}
            </div>

            <div style={{ position: 'relative', width: '100%', height: 260, background: '#1e293b', borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              {/* Leaflet map container */}
              <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

              {/* Loading overlay */}
              {(mapLoading || !leafletReady) && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(30,41,59,0.88)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', gap: 8,
                }}>
                  <div style={{ color: '#94a3b8' }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"></path><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg></div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{mapLoading ? 'Loading route…' : 'Preparing map…'}</div>
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
                  <div style={{ color: '#0f172a' }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></div>
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
                      {schedule.start_time?.slice(0, 5)} – {schedule.end_time?.slice(0, 5)}
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

          {/* Start button */}
          <button id="start-duty-btn" disabled={starting} onClick={async () => {
            setStartError(null)
            setStarting(true)
            try {
              sessionStorage.setItem('ww_duty_type', 'normal')
              const res = await api.post('/api/driver/shift/pre_start/', { duty_type: 'normal' })
              if (setActiveShift) setActiveShift(res.data)
              onAdvance('navigate_to_base')
            } catch (err) {
              const msg = err.response?.data?.error || 'Failed to start shift. Please try again.'
              setStartError(msg)
            } finally {
              setStarting(false)
            }
          }}
            style={{ width: '100%', padding: '16px', borderRadius: 30, background: starting ? '#94a3b8' : '#10b981', color: '#fff', border: 'none', fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, letterSpacing: '.08em', cursor: starting ? 'not-allowed' : 'pointer', boxShadow: starting ? 'none' : '0 4px 14px rgba(16,185,129,0.3)', marginBottom: startError ? 12 : 32 }}>
            {starting ? 'Starting…' : 'START NORMAL DUTY'}
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