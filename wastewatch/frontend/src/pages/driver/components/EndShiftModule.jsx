/**
 * EndShiftModule.jsx
 * -------------------
 * 5th and Last step <== do not remove this indicator
 *
 * FLOW:
 *  Phase 1 — "returning"
 *    Driver must navigate back to waypoints[0] (home base) before ending
 *    their shift. Shows a Leaflet map with ORS route to base, live distance
 *    counter, and a "Confirm Return to Base" button that unlocks within
 *    BASE_ARRIVAL_RADIUS_M metres. Dev 🏠 button teleports to base.
 *
 *  Phase 2a — EARLY TERMINATION  (ww_route_complete !== 'true')
 *    Form: driver explains why they ended early → notifies admin via API.
 *
 *  Phase 2b — ROUTE COMPLETED  (ww_route_complete === 'true')
 *    Celebration screen: fireworks + shift summary → Done or extended mode.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import useShiftTimer from '../../../hooks/useShiftTimer'
import useGpsTracking from '../../../hooks/useGpsTracking'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const BASE_ARRIVAL_RADIUS_M = 150   // slightly larger than stop radius

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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

// ─── EARLY TERMINATION REASONS ────────────────────────────────────────────────

const EARLY_REASONS = [
  'Truck breakdown / mechanical issue',
  'Medical emergency',
  'Road is blocked / inaccessible',
  'Insufficient fuel',
  'Weather conditions',
  'End of scheduled shift hours',
  'Other',
]

// ─── FIREWORKS ────────────────────────────────────────────────────────────────

function Fireworks() {
  const particles = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * 360
    const dist = 80 + Math.random() * 60
    const x = Math.cos((angle * Math.PI) / 180) * dist
    const y = Math.sin((angle * Math.PI) / 180) * dist
    const colors = ['#2ecc71', '#3b82f6', '#f59e0b', '#ec4899', '#22d3ee', '#a78bfa', '#fff']
    const color = colors[i % colors.length]
    const delay = Math.random() * 0.4
    const size = 6 + Math.random() * 8
    return { x, y, color, delay, size }
  })

  return (
    <div style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', top: '50%', left: '50%',
          width: p.size, height: p.size,
          borderRadius: i % 3 === 0 ? '50%' : '2px',
          background: p.color,
          animation: `fwBurst 1.2s cubic-bezier(.22,.61,.36,1) ${p.delay}s both`,
          '--tx': `${p.x}px`, '--ty': `${p.y}px`,
        }} />
      ))}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fwCheck .5s cubic-bezier(.36,.07,.19,.97) .2s both',
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: '#1e2a3a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(15,23,42,0.3)',
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="36" height="36">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
    </div>
  )
}

// ─── SUMMARY ROW ─────────────────────────────────────────────────────────────

function SummaryRow({ icon, label, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid #f1f5f9',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>{label}</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{value}</span>
    </div>
  )
}

// ─── STAT CELL ────────────────────────────────────────────────────────────────

function StatCell({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>{label}</div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function EndShiftModule({ setRouteState }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { formattedTime, startTime, endShift } = useShiftTimer()

  const isRouteComplete = sessionStorage.getItem('ww_route_complete') === 'true'
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  // ── Phase gate ────────────────────────────────────────────────────────────
  // 'returning' → driver navigates back to base
  // 'at_base'   → driver can proceed to end-shift form
  const [phase, setPhase] = useState('returning')

  // ── GPS ───────────────────────────────────────────────────────────────────
  const { position: realGpsPos, accuracy: gpsAccuracy, isTracking, error: gpsError } =
    useGpsTracking({ enabled: true, intervalMs: 5000 })
  const [mockGps, setMockGps] = useState(null)
  const gpsPos = mockGps || realGpsPos
  const isMock = mockGps !== null

  // ── Base location (waypoints[0] from driver's schedule) ───────────────────
  const [baseLocation, setBaseLocation] = useState(null)
  const [baseName, setBaseName] = useState('Home Base')

  useEffect(() => {
    if (!user?.id) return
    api.get('/api/driver/collection-schedules/')
      .then(res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        if (match?.waypoints?.length > 0) {
          setBaseLocation(match.waypoints[0])
          setBaseName(match.waypoints[0]?.label || 'Home Base')
        }
      })
      .catch(console.error)
  }, [user?.id])

  // ── Distance / arrival detection ──────────────────────────────────────────
  const distanceToBase = gpsPos && baseLocation
    ? haversineDistance(
      gpsPos.lat, gpsPos.lng,
      Number(baseLocation.lat), Number(baseLocation.lng)
    )
    : null

  const hasGoodAccuracy = isMock || gpsAccuracy == null || gpsAccuracy < 50
  const isAtBase = distanceToBase != null && distanceToBase <= BASE_ARRIVAL_RADIUS_M && hasGoodAccuracy

  // ── Map refs ──────────────────────────────────────────────────────────────
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const driverMarker = useRef(null)
  const routeLayer = useRef(null)
  const [leafletReady, setLeafletReady] = useState(false)
  const [orsData, setOrsData] = useState(null)

  // ── Load Leaflet CDN ──────────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return }
    const link = Object.assign(document.createElement('link'),
      { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
    document.head.appendChild(link)
    const script = Object.assign(document.createElement('script'),
      { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', onload: () => setLeafletReady(true) })
    document.head.appendChild(script)
  }, [])

  // ── Draw map (only while in 'returning' phase) ────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current || phase !== 'returning') return
    const L = window.L
    const center = gpsPos
      ? [gpsPos.lat, gpsPos.lng]
      : baseLocation
        ? [Number(baseLocation.lat), Number(baseLocation.lng)]
        : [13.9373, 121.617]

    const map = L.map(mapRef.current, { center, zoom: 15, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    mapInstance.current = map

    // Driver marker — pulsing blue dot
    const driverIcon = L.divIcon({
      html: `<div style="position:relative;width:18px;height:18px;">
               <span style="position:absolute;inset:-6px;border-radius:50%;
                 border:2px solid #2563eb;opacity:0.4;animation:esMapPulse 2s ease infinite;"></span>
               <div style="position:absolute;inset:0;background:#2563eb;border:3px solid white;
                 border-radius:50%;box-shadow:0 0 12px rgba(37,99,235,0.7);"></div>
             </div>`,
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
    })
    driverMarker.current = L.marker(center, { icon: driverIcon, zIndexOffset: 1000 }).addTo(map)

    // Home base marker — green house icon with outer ring
    if (baseLocation) {
      const baseLat = Number(baseLocation.lat)
      const baseLng = Number(baseLocation.lng)
      const baseIcon = L.divIcon({
        html: `<div style="position:relative;width:40px;height:40px;">
                 <span style="position:absolute;inset:-6px;border-radius:50%;
                   border:2px solid #16a34a;opacity:0.45;
                   animation:esMapPulse 2.2s ease infinite .3s;"></span>
                 <div style="position:absolute;inset:0;background:#16a34a;
                   border:3px solid #fff;border-radius:50%;
                   display:flex;align-items:center;justify-content:center;
                   box-shadow:0 3px 14px rgba(22,163,74,0.55);font-size:18px;">
                   🏠
                 </div>
               </div>`,
        className: '', iconSize: [40, 40], iconAnchor: [20, 20],
      })
      L.marker([baseLat, baseLng], { icon: baseIcon })
        .addTo(map)
        .bindPopup(`<b>${baseName}</b><br/><span style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase">Home Base</span>`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, baseLocation, phase])

  // ── Fetch ORS route: current position → base ──────────────────────────────
  useEffect(() => {
    if (!baseLocation || !gpsPos || phase !== 'returning') return
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: orsApiKey },
      body: JSON.stringify({
        coordinates: [
          [gpsPos.lng, gpsPos.lat],
          [Number(baseLocation.lng), Number(baseLocation.lat)],
        ],
        instructions: true,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length) return
        setOrsData(data.routes[0])
        if (mapInstance.current && window.L) {
          if (routeLayer.current) mapInstance.current.removeLayer(routeLayer.current)
          const pts = decodePolyline(data.routes[0].geometry)
          // Green route line to distinguish from normal navigation
          routeLayer.current = window.L.polyline(pts, {
            color: '#16a34a', weight: 6, opacity: 0.85,
          }).addTo(mapInstance.current)
        }
      })
      .catch(console.error)
  }, [baseLocation, gpsPos?.lat, gpsPos?.lng, phase])

  // ── Move driver marker as GPS updates ─────────────────────────────────────
  useEffect(() => {
    if (!gpsPos || !driverMarker.current || !mapInstance.current) return
    driverMarker.current.setLatLng([gpsPos.lat, gpsPos.lng])
    mapInstance.current.panTo([gpsPos.lat, gpsPos.lng])
  }, [gpsPos])

  // ── Destroy map when phase transitions away from 'returning' ─────────────
  useEffect(() => {
    if (phase === 'at_base' && mapInstance.current) {
      mapInstance.current.remove()
      mapInstance.current = null
    }
  }, [phase])

  // ── Full cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => () => {
    if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
  }, [])

  // ── ORS-derived display values ────────────────────────────────────────────
  let instructionText = 'Head back to home base'
  let etaMinutes = '--'
  let arrivalTimeStr = '--:--'
  let distanceKmStr = '--'

  if (orsData) {
    const seg = orsData.segments?.[0]
    if (seg?.steps?.length) {
      instructionText = seg.steps[0].instruction || 'Follow the road to base'
    }
    if (seg) {
      etaMinutes = Math.ceil(seg.duration / 60)
      arrivalTimeStr = new Date(Date.now() + seg.duration * 1000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      distanceKmStr = (seg.distance / 1000).toFixed(1)
    }
  }

  // ── Clean up route session key on mount ───────────────────────────────────
  useEffect(() => {
    sessionStorage.removeItem('ww_route_state')
  }, [])

  // ── Early termination state ───────────────────────────────────────────────
  const [reason, setReason] = useState('')
  const [customNote, setCustomNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleEarlySubmit() {
    if (!reason || submitting) return
    setSubmitting(true)
    try {
      const endTime = new Date()
      const durationMs = startTime ? (endTime.getTime() - new Date(startTime).getTime()) : 0
      await api.post('/api/driver/shift/end/', {
        ended_early: true,
        reason,
        notes: customNote.trim() || null,
        started_at: startTime ? new Date(startTime).toISOString() : null,
        ended_at: endTime.toISOString(),
        duration_ms: durationMs,
      })
      endShift()
      setSubmitted(true)
    } catch (err) {
      console.error('shift/end error:', err.response?.data)
      alert(err.response?.data?.error || 'Failed to end shift. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDone() {
    if (submitting) return
    setSubmitting(true)
    try {
      const endTime = new Date()
      const durationMs = startTime ? (endTime - new Date(startTime)) : 0
      await api.post('/api/driver/shift/end/', {
        ended_early: false,
        started_at: startTime ? new Date(startTime).toISOString() : null,
        ended_at: endTime.toISOString(),
        duration_ms: durationMs,
      })
      endShift()
      sessionStorage.clear()
      navigate('/dashboard', { replace: true })
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to end shift. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleExtendedMode() {
    sessionStorage.setItem('ww_extended_mode', 'true')
    sessionStorage.setItem('ww_route_state', 'navigating')
    setRouteState('navigating')
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1 — RETURN TO BASE MAP
  // ══════════════════════════════════════════════════════════════════════════

  if (phase === 'returning') {
    // Inline GPS pill colours
    const gpsColor = gpsError ? '#ef4444'
      : (!isTracking) ? '#f59e0b'
        : (gpsAccuracy != null && gpsAccuracy >= 50) ? '#f59e0b'
          : '#2ecc71'
    const gpsLabel = gpsError ? 'GPS Lost'
      : !isTracking ? 'GPS…'
        : gpsAccuracy != null ? `GPS ±${Math.round(gpsAccuracy)}m` : 'GPS Active'

    const distLabel = distanceToBase == null
      ? 'Calculating…'
      : distanceToBase > 1000
        ? `${(distanceToBase / 1000).toFixed(1)} km to base`
        : `${Math.round(distanceToBase)} m to base`

    return (
      <>
        <Navbar />
        <style>{`
          @keyframes esMapPulse {
            0%,100% { transform:scale(1); opacity:.5; }
            50%      { transform:scale(1.6); opacity:0; }
          }
          @keyframes esNavFadeUp {
            from { opacity:0; transform:translateY(6px); }
            to   { opacity:1; transform:translateY(0); }
          }
        `}</style>

        <div style={{
          height: '100vh', display: 'flex', flexDirection: 'column',
          fontFamily: 'var(--font-body)', overflow: 'hidden', position: 'relative',
        }}>

          {/* ── MAP LAYER ── */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#2a3441' }}>
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

            {/* DEV: teleport to base button */}
            {import.meta.env.DEV && (
              <div style={{
                position: 'absolute', top: '50%', right: 14, marginTop: 54,
                zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <button
                  onClick={() => {
                    if (!baseLocation) return
                    const lat = Number(baseLocation.lat), lng = Number(baseLocation.lng)
                    setMockGps({ lat, lng })
                    mapInstance.current?.panTo([lat, lng])
                  }}
                  title="DEV: Teleport to Home Base"
                  style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: '#16a34a', border: '2px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20,
                  }}
                >🏠</button>

                {mockGps && (
                  <button
                    onClick={() => setMockGps(null)}
                    title="Clear Mock GPS"
                    style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: '#ef4444', border: '2px solid #fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)',
                      fontSize: 16, fontWeight: 800, color: '#fff',
                    }}
                  >✕</button>
                )}
              </div>
            )}
          </div>

          {/* ── HEADER ── */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            background: 'rgba(15,23,42,0.93)', backdropFilter: 'blur(8px)',
            padding: '16px 18px 18px', color: '#fff',
            boxShadow: '0 4px 20px rgba(0,0,0,.2)',
          }}>
            {/* Status pills row */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: `${gpsColor}18`, border: `1px solid ${gpsColor}44`,
                borderRadius: 20, padding: '3px 10px',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: gpsColor,
                  display: 'inline-block',
                  animation: isTracking && !gpsError ? 'esMapPulse 2s ease infinite' : 'none',
                }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: gpsColor, letterSpacing: '.04em' }}>
                  {gpsLabel}
                </span>
              </div>

              {/* "Return to Base" mode badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.5)',
                borderRadius: 20, padding: '3px 10px',
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', letterSpacing: '.04em' }}>
                  RETURNING TO BASE
                </span>
              </div>

              <div style={{
                marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px',
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '.04em' }}>
                  ⏱ {formattedTime}
                </span>
              </div>
            </div>

            {/* Destination title */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 22, marginTop: 1 }}>🏠</span>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>
                  {baseName}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                  Return to base before ending your shift · {distLabel}
                </div>
              </div>
            </div>
          </div>

          {/* ── TURN INSTRUCTION CARD ── */}
          <div style={{
            position: 'absolute', top: 122, left: 14, right: 14, zIndex: 10,
            background: 'rgba(255,255,255,0.97)', borderRadius: 16, overflow: 'hidden',
            display: 'flex', alignItems: 'stretch',
            boxShadow: '0 6px 28px rgba(0,0,0,.18)',
            animation: 'esNavFadeUp .25s ease',
          }}>
            <div style={{
              width: 76, flexShrink: 0, background: '#16a34a12',
              borderRight: '3px solid #16a34a28',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0',
            }}>
              <span style={{ fontSize: 30 }}>🏠</span>
            </div>
            <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{
                fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900,
                color: '#0f172a', lineHeight: 1.2, marginBottom: 4,
              }}>
                {instructionText}
              </div>
              <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 700 }}>
                {distLabel}
              </div>
            </div>
          </div>

          {/* ── BOTTOM PANEL ── */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
            background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            boxShadow: '0 -4px 24px rgba(0,0,0,.1)',
            display: 'flex', flexDirection: 'column', paddingBottom: 24,
          }}>
            <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />

            {/* Stats row */}
            <div style={{
              padding: '4px 12px 16px', display: 'flex', alignItems: 'center',
              borderBottom: '1px solid rgba(0,0,0,.06)',
            }}>
              <StatCell value={arrivalTimeStr} label="arrival" />
              <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
              <StatCell value={etaMinutes} label="min" />
              <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
              <StatCell value={distanceKmStr} label="km" />
            </div>

            {/* Confirm button */}
            <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <p style={{
                fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, textAlign: 'center',
                color: isAtBase ? '#16a34a' : '#64748b',
                marginBottom: 6, transition: 'color .3s',
              }}>
                {isAtBase ? "You've reached home base!" : 'Returning to base…'}
              </p>

              {!isAtBase && distanceToBase != null && (
                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                  {distanceToBase > 1000
                    ? `${(distanceToBase / 1000).toFixed(1)} km remaining`
                    : `${Math.round(distanceToBase)} m remaining`}
                </p>
              )}
              {!isAtBase && distanceToBase == null && (
                <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>
                  📡 Waiting for GPS signal…
                </p>
              )}

              <button
                disabled={!isAtBase}
                onClick={() => setPhase('at_base')}
                style={{
                  width: '100%', maxWidth: 320, padding: '18px', borderRadius: 30, border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
                  transition: 'all .35s ease',
                  cursor: isAtBase ? 'pointer' : 'not-allowed',
                  background: isAtBase ? '#16a34a' : '#e2e8f0',
                  color: isAtBase ? '#fff' : '#94a3b8',
                  boxShadow: isAtBase ? '0 6px 20px rgba(22,163,74,0.35)' : 'none',
                }}
              >
                {isAtBase ? '✓ Confirm Return to Base' : 'Confirm on Arrival'}
              </button>
            </div>
          </div>

        </div>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2a — EARLY TERMINATION
  // ══════════════════════════════════════════════════════════════════════════

  if (!isRouteComplete) {
    if (submitted) {
      return (
        <>
          <Navbar />
          <div style={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: '#f8fafc', padding: '0 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>📋</div>
            <h2 style={{
              fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900,
              color: '#0f172a', marginBottom: 8,
            }}>Report Submitted</h2>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
              Your early shift end has been reported to the admin.<br />
              Stay safe, {firstName}.
            </p>
            <button
              onClick={() => { sessionStorage.clear(); navigate('/dashboard', { replace: true }) }}
              style={{
                width: '100%', maxWidth: 320, padding: '16px', borderRadius: 30,
                background: '#0f172a', color: '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800,
                cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        </>
      )
    }

    return (
      <>
        <Navbar />
        <style>{`
          @keyframes esSlideUp {
            from { opacity:0; transform:translateY(12px); }
            to   { opacity:1; transform:translateY(0); }
          }
        `}</style>

        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          background: '#f8fafc', fontFamily: 'var(--font-body)',
        }}>
          <div style={{ background: '#0f172a', padding: '28px 20px 24px', color: '#fff' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
            <h1 style={{
              fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900,
              margin: '0 0 6px', letterSpacing: '.02em',
            }}>
              Ending Shift Early
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: 0 }}>
              Please let us know why you're stopping before completing your route.
              This will notify the admin and be stored in your shift log.
            </p>
          </div>

          <div style={{ flex: 1, padding: '24px 20px', animation: 'esSlideUp .25s ease both' }}>
            <div style={{
              background: '#fff', borderRadius: 14, padding: '14px 16px',
              border: '1px solid #e2e8f0', marginBottom: 20,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Shift duration so far</span>
              <span style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                {formattedTime}
              </span>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: '#94a3b8',
                letterSpacing: '.06em', marginBottom: 10,
              }}>
                REASON FOR EARLY END *
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {EARLY_REASONS.map(r => (
                  <button key={r} onClick={() => setReason(r)} style={{
                    padding: '13px 16px', borderRadius: 12, textAlign: 'left',
                    border: `1.5px solid ${reason === r ? '#0f172a' : '#e2e8f0'}`,
                    background: reason === r ? '#0f172a' : '#fff',
                    color: reason === r ? '#fff' : '#475569',
                    fontWeight: 600, fontSize: 14, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10, transition: 'all .15s',
                  }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${reason === r ? '#fff' : '#cbd5e1'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {reason === r && (
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', display: 'block' }} />
                      )}
                    </span>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: '#94a3b8',
                letterSpacing: '.06em', marginBottom: 8,
              }}>
                ADDITIONAL NOTES <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
              </div>
              <textarea rows={3} maxLength={300}
                placeholder="e.g. Engine warning light appeared at Purok 3…"
                value={customNote} onChange={e => setCustomNote(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '12px 14px', borderRadius: 12,
                  border: '1.5px solid #e2e8f0', background: '#fff',
                  fontSize: 14, color: '#0f172a', resize: 'none',
                  fontFamily: 'var(--font-body)', outline: 'none',
                }}
              />
            </div>

            <button
              id="early-end-submit-btn"
              onClick={handleEarlySubmit}
              disabled={!reason || submitting}
              style={{
                width: '100%', padding: '17px', borderRadius: 30,
                background: reason && !submitting ? '#ef4444' : '#e2e8f0',
                color: reason && !submitting ? '#fff' : '#94a3b8',
                border: 'none', fontFamily: 'var(--font-head)',
                fontSize: 15, fontWeight: 900, letterSpacing: '.04em',
                cursor: reason && !submitting ? 'pointer' : 'not-allowed',
                boxShadow: reason ? '0 6px 18px rgba(239,68,68,0.28)' : 'none',
                transition: 'all .2s',
              }}
            >
              {submitting ? 'Submitting report…' : '⏹ Submit & End Shift'}
            </button>

            {!reason && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 10 }}>
                Please select a reason above
              </p>
            )}
          </div>
        </div>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2b — ROUTE COMPLETED — celebration screen
  // ══════════════════════════════════════════════════════════════════════════

  const completedStops = parseInt(sessionStorage.getItem('ww_completed_stops') || '10', 10)
  const totalStops = parseInt(sessionStorage.getItem('ww_total_stops') || '10', 10)

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes fwBurst {
          0%   { transform: translate(-50%,-50%) scale(1); opacity:1; }
          100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0); opacity:0; }
        }
        @keyframes fwCheck {
          0%  { transform:scale(0); opacity:0; }
          60% { transform:scale(1.12); }
          80% { transform:scale(0.96); }
          100%{ transform:scale(1); opacity:1; }
        }
        @keyframes esFadeUp {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .es-fade1 { animation: esFadeUp .3s ease .1s both; }
        .es-fade2 { animation: esFadeUp .3s ease .4s both; }
        .es-fade3 { animation: esFadeUp .3s ease .6s both; }
      `}</style>

      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        background: '#f8fafc', fontFamily: 'var(--font-body)',
      }}>
        <div style={{ padding: '32px 20px 0', textAlign: 'center' }}>
          <h1 className="es-fade1" style={{
            fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 900,
            color: '#0f172a', marginBottom: 6,
          }}>
            Route Complete, {firstName}! 🎉
          </h1>
          <p className="es-fade1" style={{ color: '#64748b', fontSize: 14, marginBottom: 0 }}>
            You've completed all {totalStops} stops on your route today.
          </p>
        </div>

        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <Fireworks />
        </div>

        <div className="es-fade2" style={{ padding: '0 20px', marginBottom: 24 }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '4px 16px',
            border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}>
            <SummaryRow icon="⏱" label="Shift Duration" value={formattedTime} />
            <SummaryRow icon="📍" label="Stops Completed" value={`${completedStops} / ${totalStops}`} />
            <SummaryRow icon="✅" label="Completion" value="100%" />
            <SummaryRow icon="📅" label="Date" value={new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
          </div>
        </div>

        <div className="es-fade3" style={{ padding: '0 20px 32px', marginTop: 'auto' }}>
          <button
            id="end-shift-done-btn"
            onClick={handleDone}
            style={{
              width: '100%', padding: '17px', borderRadius: 14,
              background: '#0f172a', color: '#fff', border: 'none',
              fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
              cursor: 'pointer', marginBottom: 10,
              boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
            }}
          >
            Done
          </button>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
            Accept Unclaimed dump site
          </p>
          <button
            id="extended-mode-btn"
            onClick={handleExtendedMode}
            style={{
              width: '100%', padding: '17px', borderRadius: 14,
              background: '#0f172a', color: '#fff', border: 'none',
              fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
              cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
              letterSpacing: '.04em',
            }}
          >
            My Truck is still not full
          </button>
        </div>

        <div style={{
          background: '#0f172a', padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, letterSpacing: '.06em' }}>
            Track · Monitor · Report
          </span>
        </div>
      </div>
    </>
  )
}