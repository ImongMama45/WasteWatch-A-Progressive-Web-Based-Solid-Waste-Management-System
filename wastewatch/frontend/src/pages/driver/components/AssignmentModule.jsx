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

export default function AssignmentModule({ setRouteState }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [schedule, setSchedule] = useState(null)

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

    // ── Start marker ──────────────────────────────────────────────────────
    const startIcon = L.divIcon({
      html: `<div style="background:#1e2633;border:2px solid #2ecc71;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,.5);">🏛️</div>`,
      className: '', iconSize: [22, 22], iconAnchor: [11, 11],
    })
    L.marker([wps[0].lat, wps[0].lng], { icon: startIcon }).addTo(map).bindPopup('<b>Start Point</b>')

    // ── Stop markers ──────────────────────────────────────────────────────
    wps.slice(1).forEach((wp, i) => {
      const stopIcon = L.divIcon({
        html: `<div style="background:#5dade2;border:2px solid white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,.4);">${i + 1}</div>`,
        className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      })
      L.marker([wp.lat, wp.lng], { icon: stopIcon }).addTo(map).bindPopup(`<b>${wp.label || `Stop ${i + 1}`}</b>`)
    })

    // ── Fallback dashed straight-line while ORS loads ─────────────────────
    const latlngs = wps.map(w => [w.lat, w.lng])
    const fallbackLine = L.polyline(latlngs, {
      color: '#2ecc71', weight: 3, opacity: 0.35, dashArray: '6, 6',
    }).addTo(map)
    map.fitBounds(fallbackLine.getBounds(), { padding: [30, 30] })

    // ── ORS actual road route ─────────────────────────────────────────────
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return

    // ORS accepts max 50 coordinates
    const coordinates = wps.slice(0, 50).map(w => [w.lng, w.lat])

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

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc', fontFamily: 'var(--font-body)', overflowX: 'hidden' }}>
        <div style={{ flex: 1, padding: '20px 20px 0' }}>

          {/* Back */}
          <button onClick={() => navigate('/dashboard')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a', fontWeight: 600, fontSize: 14, padding: 0, marginBottom: 24 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </button>

          {/* Greeting */}
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, textAlign: 'center', color: '#0f172a', marginBottom: 4 }}>
            Hello, {firstName} 👋
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
              <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', letterSpacing: '.03em' }}>📍 Your Route Map</span>
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
                  <div style={{ fontSize: 24 }}>🗺️</div>
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
                  <div style={{ fontSize: 32 }}>📍</div>
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
          <button id="start-duty-btn" onClick={() => {
            sessionStorage.setItem('ww_duty_type', 'normal')
            setRouteState('navigate_to_base')
          }}
            style={{ width: '100%', padding: '16px', borderRadius: 30, background: '#10b981', color: '#fff', border: 'none', fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, letterSpacing: '.08em', cursor: 'pointer', boxShadow: '0 4px 14px rgba(16,185,129,0.3)', marginBottom: 32 }}>
            START NORMAL DUTY
          </button>
        </div>

        {/* Bottom banner */}
        <div style={{ background: '#0f172a', padding: '28px 24px', display: 'flex', alignItems: 'flex-end', gap: 16, minHeight: 140, position: 'relative', overflow: 'hidden' }}>
          <div style={{ flex: 1, zIndex: 1 }}>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, color: '#fff', lineHeight: 1.3, marginBottom: 8, textTransform: 'uppercase' }}>
              " One app for monitoring all waste management related stuff "
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: '.06em', fontWeight: 600 }}>Track · Monitor · Report</p>
          </div>
          <div style={{ position: 'absolute', right: -10, bottom: 0, fontSize: 80, lineHeight: 1, opacity: 0.9, filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))', userSelect: 'none' }}>🚛</div>
        </div>
      </div>
    </>
  )
}