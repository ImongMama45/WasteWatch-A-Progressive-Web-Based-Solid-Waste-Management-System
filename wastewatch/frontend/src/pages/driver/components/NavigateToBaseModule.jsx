/**
 * NavigateToBaseModule.jsx
 * -------------------------
 * 1.5th step (between AssignmentModule and ConfirmStartModule) <== do not remove this indicator
 *
 * FLOW:
 *  - Fetches the driver's schedule to find waypoints[0] (home base)
 *  - If driver is already within BASE_ARRIVAL_RADIUS_M → auto-skip to 'confirm_start'
 *  - Otherwise: shows a Leaflet map with ORS route from current GPS → home base
 *    plus a live distance counter and turn instruction card.
 *  - "Confirm Arrival at Base" button unlocks on arrival.
 *  - On confirm → setRouteState('confirm_start')
 *  - DEV: teleport-to-base button for testing.
 */

import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../../context/AuthContext'
import useGpsTracking from '../../../hooks/useGpsTracking'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'

const BASE_ARRIVAL_RADIUS_M = 150
const LUCENA_FALLBACK = [13.9373, 121.617]

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

export default function NavigateToBaseModule({ onAdvance, shift }) {
  const { user } = useAuth()
  const { position: realGpsPos, accuracy: gpsAccuracy, isTracking, error: gpsError } =
    useGpsTracking({ enabled: true, intervalMs: 4000, syncEnabled: false })
  const [mockGps, setMockGps] = useState(null)
  const gpsPos = mockGps || realGpsPos
  const isMock = mockGps !== null

  const [baseLocation, setBaseLocation] = useState(null)
  const [baseName, setBaseName] = useState('Home Base')
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [orsData, setOrsData] = useState(null)
  const [skipped, setSkipped] = useState(false)

  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const driverMarkerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const [leafletReady, setLeafletReady] = useState(false)

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

  // ── Fetch schedule for base location ────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    setScheduleLoading(true)
    api.get('/api/driver/collection-schedules/')
      .then(res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        if (match?.waypoints?.length > 0) {
          setBaseLocation(match.waypoints[0])
          setBaseName(match.waypoints[0]?.label || 'Home Base')
        }
      })
      .catch(console.error)
      .finally(() => setScheduleLoading(false))
  }, [user?.id])

  // ── Auto-skip if already at base ─────────────────────────────────────────
  useEffect(() => {
    if (skipped || !gpsPos || !baseLocation) return
    const dist = haversineDistance(gpsPos.lat, gpsPos.lng, Number(baseLocation.lat), Number(baseLocation.lng))
    if (dist <= BASE_ARRIVAL_RADIUS_M) {
      setSkipped(true)
      onAdvance('confirm_start')
    }
  }, [gpsPos, baseLocation, skipped, onAdvance])

  // ── Distance & arrival ────────────────────────────────────────────────────
  const distanceToBase = gpsPos && baseLocation
    ? haversineDistance(gpsPos.lat, gpsPos.lng, Number(baseLocation.lat), Number(baseLocation.lng))
    : null
  const hasGoodAccuracy = isMock || gpsAccuracy == null || gpsAccuracy < 50
  const isAtBase = distanceToBase != null && distanceToBase <= BASE_ARRIVAL_RADIUS_M && hasGoodAccuracy

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current || scheduleLoading) return
    const L = window.L
    const center = gpsPos ? [gpsPos.lat, gpsPos.lng]
      : baseLocation ? [Number(baseLocation.lat), Number(baseLocation.lng)]
        : LUCENA_FALLBACK
    const map = L.map(mapRef.current, { center, zoom: 15, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    mapInstance.current = map

    const driverIcon = L.divIcon({
      html: `<div style="position:relative;width:18px;height:18px;">
             <span style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #2563eb;opacity:0.4;animation:ntbPulse 2s ease infinite;"></span>
             <div style="position:absolute;inset:0;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 0 12px rgba(37,99,235,0.7);"></div>
           </div>`,
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
    })
    driverMarkerRef.current = L.marker(center, { icon: driverIcon, zIndexOffset: 1000 }).addTo(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, scheduleLoading])

  // ── Place base marker ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current || !baseLocation || !window.L) return
    const L = window.L
    const baseLat = Number(baseLocation.lat), baseLng = Number(baseLocation.lng)
    const baseIcon = L.divIcon({
      html: `<div style="position:relative;width:40px;height:40px;">
               <span style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #16a34a;opacity:0.45;animation:ntbPulse 2.2s ease infinite .3s;"></span>
               <div style="position:absolute;inset:0;background:#16a34a;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 14px rgba(22,163,74,0.55);font-size:18px;">🏠</div>
             </div>`,
      className: '', iconSize: [40, 40], iconAnchor: [20, 20],
    })
    L.marker([baseLat, baseLng], { icon: baseIcon }).addTo(mapInstance.current)
      .bindPopup(`<b>${baseName}</b><br/><span style="font-size:11px;color:#16a34a;font-weight:700;">HOME BASE</span>`)
  }, [baseLocation, baseName, leafletReady])

  useEffect(() => {
    if (!mapInstance.current || !baseLocation) return
    // Re-center map once base location is known (in case map init used fallback)
    if (!gpsPos) {
      mapInstance.current.panTo([Number(baseLocation.lat), Number(baseLocation.lng)])
    }
  }, [baseLocation])

  // ── Fetch ORS route: GPS → base ───────────────────────────────────────────
  useEffect(() => {
    if (!baseLocation || !gpsPos) return
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
          if (routeLayerRef.current) mapInstance.current.removeLayer(routeLayerRef.current)
          const pts = decodePolyline(data.routes[0].geometry)
          routeLayerRef.current = window.L.polyline(pts, { color: '#16a34a', weight: 6, opacity: 0.85 })
            .addTo(mapInstance.current)
        }
      })
      .catch(console.error)
  }, [baseLocation, gpsPos?.lat, gpsPos?.lng])

  // ── Move driver marker on GPS update ─────────────────────────────────────
  useEffect(() => {
    if (!gpsPos || !driverMarkerRef.current || !mapInstance.current) return
    driverMarkerRef.current.setLatLng([gpsPos.lat, gpsPos.lng])
    mapInstance.current.panTo([gpsPos.lat, gpsPos.lng])
  }, [gpsPos])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
  }, [])

  // ── ORS display values ────────────────────────────────────────────────────
  let instructionText = 'Head to your home base'
  let etaMinutes = '--', arrivalTimeStr = '--:--', distanceKmStr = '--'
  if (orsData) {
    const seg = orsData.segments?.[0]
    if (seg?.steps?.length) instructionText = seg.steps[0].instruction || instructionText
    if (seg) {
      etaMinutes = Math.ceil(seg.duration / 60)
      arrivalTimeStr = new Date(Date.now() + seg.duration * 1000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      distanceKmStr = (seg.distance / 1000).toFixed(1)
    }
  }

  const distLabel = distanceToBase == null ? 'Calculating…'
    : distanceToBase > 1000 ? `${(distanceToBase / 1000).toFixed(1)} km to base`
      : `${Math.round(distanceToBase)} m to base`

  const gpsColor = gpsError ? '#ef4444' : !isTracking ? '#f59e0b'
    : gpsAccuracy != null && gpsAccuracy >= 50 ? '#f59e0b' : '#2ecc71'
  const gpsLabel = gpsError ? 'GPS Lost' : !isTracking ? 'GPS…'
    : gpsAccuracy != null ? `GPS ±${Math.round(gpsAccuracy)}m` : 'GPS Active'

  if (scheduleLoading) {
    return (
      <>
        <Navbar />
        <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, background: '#0f172a' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#2ecc71', animation: 'ntbSpin 1s linear infinite' }} />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Loading route…</span>
        </div>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes ntbPulse { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.6);opacity:0} }
        @keyframes ntbSpin  { to{transform:rotate(360deg)} }
        @keyframes ntbFadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)', overflow: 'hidden', position: 'relative', background: '#2a3441' }}>

        {/* ── MAP ── */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, width: '100%', height: '100%' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {/* DEV teleport */}
          {import.meta.env.DEV && (
            <div style={{ position: 'absolute', top: '50%', right: 14, marginTop: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => {
                  if (!baseLocation) return
                  const lat = Number(baseLocation.lat), lng = Number(baseLocation.lng)
                  setMockGps({ lat, lng })
                  mapInstance.current?.panTo([lat, lng])
                }}
                title="DEV: Teleport to Home Base"
                style={{ width: 44, height: 44, borderRadius: '50%', background: '#16a34a', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20 }}
              >🏠</button>
              {isMock && (
                <button onClick={() => setMockGps(null)} title="Clear Mock GPS"
                  style={{ width: 44, height: 44, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 16, fontWeight: 800, color: '#fff' }}>✕</button>
              )}
            </div>
          )}
        </div>

        {/* ── HEADER ── */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(15,23,42,0.93)', backdropFilter: 'blur(8px)', padding: '16px 18px 18px', color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          {/* Pills */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${gpsColor}18`, border: `1px solid ${gpsColor}44`, borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: gpsColor, display: 'inline-block', animation: isTracking && !gpsError ? 'ntbPulse 2s ease infinite' : 'none' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: gpsColor, letterSpacing: '.04em' }}>{gpsLabel}</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.5)', borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', letterSpacing: '.04em' }}>NAVIGATING TO BASE</span>
            </div>
          </div>

          {/* Destination */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 22, marginTop: 1 }}>🏠</span>
            <div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>{baseName}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                Navigate to base before starting your shift · {distLabel}
              </div>
            </div>
          </div>
        </div>

        {/* ── TURN INSTRUCTION CARD ── */}
        <div style={{ position: 'absolute', top: 122, left: 14, right: 14, zIndex: 10, background: 'rgba(255,255,255,0.97)', borderRadius: 16, overflow: 'hidden', display: 'flex', alignItems: 'stretch', boxShadow: '0 6px 28px rgba(0,0,0,.18)', animation: 'ntbFadeUp .25s ease' }}>
          <div style={{ width: 76, flexShrink: 0, background: '#16a34a12', borderRight: '3px solid #16a34a28', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
            <span style={{ fontSize: 30 }}>🏠</span>
          </div>
          <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, color: '#0f172a', lineHeight: 1.2, marginBottom: 4 }}>
              {instructionText}
            </div>
            <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 700 }}>{distLabel}</div>
          </div>
        </div>

        {/* ── BOTTOM PANEL ── */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -4px 24px rgba(0,0,0,.12)', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />

          {/* Stats row */}
          <div style={{ padding: '4px 12px 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
            {[
              { value: arrivalTimeStr, label: 'arrival' },
              { value: etaMinutes, label: 'min' },
              { value: distanceKmStr, label: 'km' },
            ].map((cell, i, arr) => (
              <React.Fragment key={cell.label}>
                <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{cell.value}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2 }}>{cell.label}</div>
                </div>
                {i < arr.length - 1 && <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />}
              </React.Fragment>
            ))}
          </div>

          {/* Confirm area */}
          <div style={{ padding: '20px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 800, textAlign: 'center', color: isAtBase ? '#16a34a' : '#64748b', margin: 0, transition: 'color .3s' }}>
              {isAtBase ? "You've reached home base!" : 'Head to your home base first'}
            </p>

            {!isAtBase && distanceToBase != null && (
              <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
                {distanceToBase > 1000 ? `${(distanceToBase / 1000).toFixed(1)} km remaining` : `${Math.round(distanceToBase)} m remaining`}
              </p>
            )}
            {!isAtBase && distanceToBase == null && (
              <p style={{ fontSize: 12, color: '#f59e0b', margin: 0 }}>📡 Waiting for GPS signal…</p>
            )}

            <button
              disabled={!isAtBase}
              onClick={() => onAdvance('confirm_start')}
              style={{
                width: '100%', maxWidth: 340, padding: '18px', borderRadius: 30, border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, letterSpacing: '.06em',
                transition: 'all .35s ease',
                cursor: isAtBase ? 'pointer' : 'not-allowed',
                background: isAtBase ? '#16a34a' : '#e2e8f0',
                color: isAtBase ? '#fff' : '#94a3b8',
                boxShadow: isAtBase ? '0 6px 20px rgba(22,163,74,0.35)' : 'none',
              }}
            >
              {isAtBase ? '✓ I\'m at Base — Continue' : 'Confirm on Arrival'}
            </button>

            {import.meta.env.DEV && (
              <button onClick={() => onAdvance('confirm_start')} style={{ width: '100%', maxWidth: 340, padding: '10px', borderRadius: 20, background: 'none', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                DEV: Skip to Confirm Start
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
