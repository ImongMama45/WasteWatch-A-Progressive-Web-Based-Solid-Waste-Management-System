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
  useEffect(() => {
    if (!dumpSiteLocation || !gpsPos) return
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return
    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: orsApiKey },
      body: JSON.stringify({
        coordinates: [
          [gpsPos.lng, gpsPos.lat],
          [Number(dumpSiteLocation.longitude), Number(dumpSiteLocation.latitude)],
        ],
        instructions: true,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length) return
        setDumpOrsData(data.routes[0])
        if (dumpMapInstance.current && window.L) {
          if (dumpRouteLayer.current) dumpMapInstance.current.removeLayer(dumpRouteLayer.current)
          const pts = decodePolyline(data.routes[0].geometry)
          dumpRouteLayer.current = window.L.polyline(pts, { color: '#f59e0b', weight: 6, opacity: 0.85 })
            .addTo(dumpMapInstance.current)
        }
      })
      .catch(console.error)
  }, [dumpSiteLocation, gpsPos?.lat, gpsPos?.lng])

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
  if (dumpOrsData) {
    const seg = dumpOrsData.segments?.[0]
    if (seg?.steps?.length) dumpInstruction = seg.steps[0].instruction || dumpInstruction
    if (seg) {
      dumpEta = Math.ceil(seg.duration / 60)
      dumpArrival = new Date(Date.now() + seg.duration * 1000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      dumpKm = (seg.distance / 1000).toFixed(1)
    }
  }
  const dumpDistLabel = distanceToDump == null ? 'Calculating…'
    : distanceToDump > 1000 ? `${(distanceToDump / 1000).toFixed(1)} km to dump site`
      : `${Math.round(distanceToDump)} m to dump site`

  return (
    <>
      <Navbar />
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)', overflow: 'hidden', position: 'relative' }}>
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
        <div style={{ position: 'absolute', top: 122, left: 14, right: 14, zIndex: 10, background: 'rgba(255,255,255,0.97)', borderRadius: 16, overflow: 'hidden', display: 'flex', alignItems: 'stretch', boxShadow: '0 6px 28px rgba(0,0,0,.18)', animation: 'esNavFadeUp .25s ease' }}>
          <div style={{ width: 76, flexShrink: 0, background: '#f59e0b12', borderRight: '3px solid #f59e0b28', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
            <span style={{ fontSize: 30 }}>🗑️</span>
          </div>
          <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900, color: '#0f172a', lineHeight: 1.2, marginBottom: 4 }}>{dumpInstruction}</div>
            <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 700 }}>{dumpDistLabel}</div>
          </div>
        </div>

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
