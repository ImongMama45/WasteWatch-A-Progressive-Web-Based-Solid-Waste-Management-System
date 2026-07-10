import React, { useEffect, useRef, useState } from 'react'
import Navbar from '../../../components/Navbar'
import api from '../../../api/client'

function decodePolyline(encoded) {
  if (!encoded) return []
  const poly = []
  let index = 0, len = encoded.length, lat = 0, lng = 0
  while (index < len) {
    let b, shift = 0, result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat
    shift = 0; result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng
    poly.push([lat / 1e5, lng / 1e5])
  }
  return poly
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const bearingToCompass = deg => deg != null
  ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : null

function TurnArrow({ type, bearing, size = 48, color = '#0f172a' }) {
  const compass = bearingToCompass(bearing)
  const s = { stroke: color, strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
  const wrap = (label, children) => (
    <svg viewBox="0 0 44 44" width={size} height={size} aria-label={label} style={{ display: 'block' }}>
      {children}
      {compass && <text x="22" y="43" textAnchor="middle" fontSize="6.5" fontWeight="700" fill={color} opacity="0.5" fontFamily="monospace">{compass}</text>}
    </svg>
  )
  const arrows = {
    0: wrap('Turn left', <g {...s}><path d="M22,36 L22,20 Q22,12 13,12" /><polyline points="20,20 13,12 21,5" /></g>),
    1: wrap('Turn right', <g {...s}><path d="M22,36 L22,20 Q22,12 31,12" /><polyline points="24,20 31,12 23,5" /></g>),
    2: wrap('Sharp left', <g {...s}><path d="M22,36 L22,24 Q22,18 16,14 Q10,10 10,4" /><polyline points="4,10 10,4 16,10" /></g>),
    3: wrap('Sharp right', <g {...s}><path d="M22,36 L22,24 Q22,18 28,14 Q34,10 34,4" /><polyline points="28,10 34,4 40,10" /></g>),
    4: wrap('Slight left', <g {...s}><path d="M22,36 L22,20 Q21,12 14,8" /><polyline points="7,12 14,8 16,16" /></g>),
    5: wrap('Slight right', <g {...s}><path d="M22,36 L22,20 Q23,12 30,8" /><polyline points="28,16 30,8 37,12" /></g>),
    6: wrap('Straight', <g {...s}><line x1="22" y1="36" x2="22" y2="8" /><polyline points="14,16 22,8 30,16" /></g>),
    7: wrap('Enter roundabout', <g {...s}><circle cx="22" cy="19" r="8" /><line x1="22" y1="36" x2="22" y2="27" /><line x1="28" y1="12" x2="33" y2="7" /><polyline points="26,3 33,7 29,14" /></g>),
    8: wrap('Exit roundabout', <g {...s}><circle cx="22" cy="19" r="8" /><line x1="22" y1="36" x2="22" y2="27" /><line x1="28" y1="12" x2="33" y2="7" /><polyline points="26,3 33,7 29,14" /></g>),
    9: wrap('U-turn', <g {...s}><path d="M14,36 L14,18 Q14,6 22,6 Q30,6 30,14 L30,20" /><polyline points="22,14 30,20 38,14" /><polyline points="8,30 14,36 20,30" /></g>),
    10: wrap('Arrived', <g><path d="M22,38 Q22,38 13,25 A11,11 0 1,1 31,25 Z" {...s} /><circle cx="22" cy="17" r="3.5" fill={color} opacity="0.7" stroke="none" /></g>),
    11: wrap('Depart', <g {...s}><line x1="13" y1="7" x2="13" y2="37" /><path d="M13,7 L33,14 L13,21" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="2.6" strokeLinejoin="round" /></g>),
    12: wrap('Keep left', <g {...s}><line x1="22" y1="36" x2="22" y2="8" strokeOpacity="0.2" /><path d="M22,36 L22,22 L15,8" /><polyline points="9,13 15,8 18,15" /></g>),
    13: wrap('Keep right', <g {...s}><line x1="22" y1="36" x2="22" y2="8" strokeOpacity="0.2" /><path d="M22,36 L22,22 L29,8" /><polyline points="26,15 29,8 35,13" /></g>),
  }
  return arrows[type] ?? arrows[6]
}

const TURN_COLOR = {
  0: '#3b82f6', 1: '#3b82f6', 2: '#f59e0b', 3: '#f59e0b', 4: '#64748b', 5: '#64748b',
  6: '#16a34a', 7: '#8b5cf6', 8: '#8b5cf6', 9: '#ef4444', 10: '#16a34a',
  11: '#2563eb', 12: '#64748b', 13: '#64748b',
}

function StatCell({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>{label}</div>
    </div>
  )
}

export default function NavigateToDumpsiteModule({
  gpsPos, gpsError, isTracking, gpsAccuracy,
  isMock, setMockGps,
  dumpSiteLocation, dumpSiteName,
  distanceToDump, isAtDump,
  formattedTime, setPhase,
  leafletReady
}) {
  const dumpMapRef = useRef(null)
  const dumpMapInstance = useRef(null)
  const dumpDriverMarker = useRef(null)
  const dumpRouteLayer = useRef(null)
  const [dumpOrsData, setDumpOrsData] = useState(null)
  const [orsFetchKey, setOrsFetchKey] = useState(0)
  const lastOrsGpsPosRef = useRef(null)

  // ── GPS ORS throttling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gpsPos) return
    const last = lastOrsGpsPosRef.current
    if (!last) {
      lastOrsGpsPosRef.current = gpsPos
      setOrsFetchKey(k => k + 1)
      return
    }
    const moved = haversineDistance(last.lat, last.lng, gpsPos.lat, gpsPos.lng)
    if (moved > 10) {
      lastOrsGpsPosRef.current = gpsPos
      setOrsFetchKey(k => k + 1)
    }
  }, [gpsPos])

  // ── Init dump site map ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !dumpMapRef.current || dumpMapInstance.current) return
    if (!dumpSiteLocation) return
    const L = window.L
    const center = gpsPos
      ? [gpsPos.lat, gpsPos.lng]
      : [Number(dumpSiteLocation.latitude), Number(dumpSiteLocation.longitude)]
    const map = L.map(dumpMapRef.current, { center, zoom: 15, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    dumpMapInstance.current = map
    setTimeout(() => map.invalidateSize(), 0)

    const truckIconHtml = `
      <div style="width:32px;height:32px;filter:drop-shadow(0 3px 8px rgba(37,99,235,0.7));">
        <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
          <rect x="6" y="10" width="20" height="14" rx="3" fill="#1d4ed8" stroke="white" stroke-width="1.5"/>
          <rect x="14" y="6" width="12" height="10" rx="2" fill="#2563eb" stroke="white" stroke-width="1.2"/>
          <rect x="15" y="7.5" width="9" height="5" rx="1" fill="rgba(186,230,253,0.85)"/>
          <circle cx="10" cy="24" r="3" fill="#1e293b" stroke="white" stroke-width="1"/>
          <circle cx="22" cy="24" r="3" fill="#1e293b" stroke="white" stroke-width="1"/>
          <polygon points="16,2 13.5,6.5 18.5,6.5" fill="#60a5fa"/>
        </svg>
      </div>`

    const driverIcon = L.divIcon({ html: truckIconHtml, className: '', iconSize: [32, 32], iconAnchor: [16, 16] })
    dumpDriverMarker.current = L.marker(center, { icon: driverIcon, zIndexOffset: 1000 }).addTo(map)

    const dumpIconHtml = `
      <div style="width:36px;height:36px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.3);font-size:18px;">
        🗑️
      </div>`
    const dumpIcon = L.divIcon({ html: dumpIconHtml, className: '', iconSize: [36, 36], iconAnchor: [18, 18] })
    L.marker(
      [Number(dumpSiteLocation.latitude), Number(dumpSiteLocation.longitude)],
      { icon: dumpIcon }
    ).addTo(map).bindPopup(`<b>${dumpSiteName}</b><br/><span style="font-size:11px;color:#f59e0b;font-weight:700;">DUMP SITE</span>`)

    return () => {
      if (dumpMapInstance.current) {
        dumpMapInstance.current.remove()
        dumpMapInstance.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, dumpSiteLocation])

  // ── ORS route: GPS → dump site ────────────────────────────────────────────────
  // Strategy (mirrors ShiftRouteModule):
  //   1. Always draw a straight-line fallback immediately so the driver sees a
  //      route even when ORS is unreachable or the API key is missing.
  //   2. Overlay the ORS road-snapped route on top once it resolves.
  //   3. AbortController cancels any in-flight request when gpsPos or
  //      dumpSiteLocation changes before the response arrives.
  const orsAbortRef = useRef(null)

  useEffect(() => {
    if (!dumpSiteLocation || !gpsPos) return

    // Cancel previous in-flight ORS request
    if (orsAbortRef.current) orsAbortRef.current.abort()
    const ctrl = new AbortController()
    orsAbortRef.current = ctrl

    const destLat = Number(dumpSiteLocation.latitude)
    const destLng = Number(dumpSiteLocation.longitude)

    // ── Layer 1: straight-line fallback (always shown immediately) ──────────
    if (dumpMapInstance.current && window.L) {
      if (dumpRouteLayer.current) {
        try { dumpMapInstance.current.removeLayer(dumpRouteLayer.current) } catch { }
      }
      dumpRouteLayer.current = window.L.polyline(
        [[gpsPos.lat, gpsPos.lng], [destLat, destLng]],
        { color: '#f59e0b', weight: 4, opacity: 0.55, dashArray: '8,6' }
      ).addTo(dumpMapInstance.current)
    }

    // ── Layer 2: ORS road-snapped route (overlaid when available) ───────────
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return   // no key — straight-line fallback stays

    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: orsApiKey },
      body: JSON.stringify({
        coordinates: [
          [gpsPos.lng, gpsPos.lat],
          [destLng, destLat],
        ],
        instructions: true,
      }),
      signal: ctrl.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error(`ORS ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (!data.routes?.length) return
        setDumpOrsData(data.routes[0])
        // Replace fallback with solid road-snapped route
        if (dumpMapInstance.current && window.L) {
          if (dumpRouteLayer.current) {
            try { dumpMapInstance.current.removeLayer(dumpRouteLayer.current) } catch { }
          }
          const pts = decodePolyline(data.routes[0].geometry)
          dumpRouteLayer.current = window.L.polyline(pts, { color: '#f59e0b', weight: 6, opacity: 0.85 })
            .addTo(dumpMapInstance.current)
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return   // intentional cancel — ignore
        // Network error / ORS down: straight-line fallback already visible, nothing to do
        console.warn('NavigateToDumpsiteModule: ORS unavailable, using straight-line fallback.', err.message)
      })

    return () => { ctrl.abort() }
  }, [dumpSiteLocation, orsFetchKey])

  // ── Move dump driver marker on GPS update ────────────────────────────────────
  useEffect(() => {
    if (!gpsPos || !dumpDriverMarker.current || !dumpMapInstance.current) return
    dumpDriverMarker.current.setLatLng([gpsPos.lat, gpsPos.lng])
    dumpMapInstance.current.panTo([gpsPos.lat, gpsPos.lng])
  }, [gpsPos])

  const gpsColor = gpsError ? '#ef4444' : (!isTracking) ? '#f59e0b'
    : (gpsAccuracy != null && gpsAccuracy >= 50) ? '#f59e0b' : '#2ecc71'
  const gpsLabel = gpsError ? 'GPS Lost' : !isTracking ? 'GPS…'
    : gpsAccuracy != null ? `GPS ±${Math.round(gpsAccuracy)}m` : 'GPS Active'

  let dumpInstruction = `Head to ${dumpSiteName}`
  let dumpEta = '--', dumpArrival = '--:--', dumpKm = '--'
  let stepType = 6, stepBearing = null

  if (dumpOrsData) {
    const seg = dumpOrsData.segments?.[0]
    if (seg?.steps?.length) {
      const step = seg.steps[0]
      dumpInstruction = step.instruction || dumpInstruction
      stepType = step.type ?? 6
      stepBearing = step.exit_bearings?.[0] ?? step.bearing ?? null
    }
    if (seg) {
      dumpEta = Math.ceil(seg.duration / 60)
      dumpArrival = new Date(Date.now() + seg.duration * 1000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      dumpKm = (seg.distance / 1000).toFixed(1)
    }
  }

  const accentColor = TURN_COLOR[stepType] ?? '#f59e0b'
  const dumpDistLabel = distanceToDump == null ? 'Calculating…'
    : distanceToDump > 1000 ? `${(distanceToDump / 1000).toFixed(1)} km to dump site`
      : `${Math.round(distanceToDump)} m to dump site`

  return (
    <>
      <Navbar />
      <div style={{ position: 'fixed', top: 60, bottom: 0, left: 0, right: 0, zIndex: 900, display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)', overflow: 'hidden', background: '#1e293b' }}>
        {/* MAP */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#2a3441' }}>
          <div ref={dumpMapRef} style={{ width: '100%', height: '100%' }} />
          {import.meta.env.DEV && (
            <div style={{ position: 'absolute', top: '50%', right: 14, marginTop: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => {
                  if (!dumpSiteLocation) return
                  const lat = Number(dumpSiteLocation.latitude), lng = Number(dumpSiteLocation.longitude)
                  setMockGps({ lat, lng })
                  dumpMapInstance.current?.panTo([lat, lng])
                }}
                title="DEV: Teleport to Dump Site"
                style={{ width: 44, height: 44, borderRadius: '50%', background: '#f59e0b', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20 }}
              >🗑️</button>
              {isMock && (
                <button onClick={() => setMockGps(null)} title="Clear Mock GPS"
                  style={{ width: 44, height: 44, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 16, fontWeight: 800, color: '#fff' }}>✕</button>
              )}
            </div>
          )}
        </div>

        {/* HEADER */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(15,23,42,0.93)', backdropFilter: 'blur(8px)', padding: '16px 18px 18px', color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${gpsColor}18`, border: `1px solid ${gpsColor}44`, borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: gpsColor, display: 'inline-block', animation: isTracking && !gpsError ? 'esMapPulse 2s ease infinite' : 'none' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: gpsColor, letterSpacing: '.04em' }}>{gpsLabel}</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em' }}>NAVIGATING TO DUMP SITE</span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '.04em' }}>⏱ {formattedTime}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 22, marginTop: 1 }}>🗑️</span>
            <div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>{dumpSiteName}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>Dispose collected waste before returning · {dumpDistLabel}</div>
            </div>
          </div>
        </div>

        {/* TURN CARD */}
        {(!distanceToDump || distanceToDump > 30) && (
          <div style={{ position: 'absolute', top: 122, left: 14, right: 14, zIndex: 10, background: 'rgba(255,255,255,0.97)', borderRadius: 16, overflow: 'hidden', display: 'flex', alignItems: 'stretch', boxShadow: '0 6px 28px rgba(0,0,0,.18)', animation: 'esNavFadeUp .25s ease' }}>
            <div style={{ width: 76, flexShrink: 0, background: `${accentColor}12`, borderRight: `3px solid ${accentColor}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
              <TurnArrow type={stepType} bearing={stepBearing} color={accentColor} size={42} />
            </div>
            <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900, color: '#0f172a', lineHeight: 1.2, marginBottom: 4 }}>{dumpInstruction}</div>
              <div style={{ fontSize: 13, color: accentColor, fontWeight: 700 }}>{dumpDistLabel}</div>
            </div>
          </div>
        )}

        {/* BOTTOM PANEL */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -4px 24px rgba(0,0,0,.1)', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom, 24px)' }}>
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />
          <div style={{ padding: '4px 12px 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
            <StatCell value={dumpArrival} label="arrival" />
            <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
            <StatCell value={dumpEta} label="min" />
            <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
            <StatCell value={dumpKm} label="km" />
          </div>
          <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, textAlign: 'center', color: isAtDump ? '#f59e0b' : '#64748b', marginBottom: 6, transition: 'color .3s' }}>
              {isAtDump ? "You've reached the dump site!" : 'Head to the dump site'}
            </p>
            {!isAtDump && distanceToDump != null && (
              <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                {distanceToDump > 1000 ? `${(distanceToDump / 1000).toFixed(1)} km remaining` : `${Math.round(distanceToDump)} m remaining`}
              </p>
            )}
            {!isAtDump && distanceToDump == null && (
              <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>📡 Waiting for GPS signal…</p>
            )}
            <button
              disabled={!isAtDump}
              onClick={() => {
                api.post('/api/driver/shift/status/', { status: 'at_dumpsite' }).catch(console.error)
                setPhase('waiting_dump_confirmation')
              }}
              style={{
                width: '100%', maxWidth: 320, padding: '18px', borderRadius: 30, border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
                transition: 'all .35s ease',
                cursor: isAtDump ? 'pointer' : 'not-allowed',
                background: isAtDump ? '#f59e0b' : '#e2e8f0',
                color: isAtDump ? '#fff' : '#94a3b8',
                boxShadow: isAtDump ? '0 6px 20px rgba(245,158,11,0.35)' : 'none',
              }}
            >
              {isAtDump ? '✓ Confirm Arrival at Dump Site' : 'Confirm on Arrival'}
            </button>
            {import.meta.env.DEV && (
              <button 
                onClick={() => {
                  api.post('/api/driver/shift/status/', { status: 'at_dumpsite' }).catch(console.error)
                  setPhase('waiting_dump_confirmation')
                }} 
                style={{ width: '100%', maxWidth: 320, marginTop: 8, padding: '10px', borderRadius: 20, background: 'none', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                DEV: Skip to Calibration
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
