import React, { useEffect, useRef, useState } from 'react'
import api from '../../../api/client'
import {
  Trash2,
  CheckCircle2,
  LocateFixed,
  ChevronDown,
  ChevronUp,
  Clock,
  Radio,
  Compass,
  Plus,
  Minus,
  X
} from 'lucide-react'
import { calculateBearing, getShortestAngle, create3DVehicleIcon } from './map3DUtils'

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

import TurnArrow, { TURN_COLOR } from './TurnArrow'

function StatCell({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
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

  const [is3D, setIs3D] = useState(false)
  const [mapHeading, setMapHeading] = useState(0)
  const prevGpsPosRef = useRef(null)
  const isFollowCamRef = useRef(true)
  const [isUserPanned, setIsUserPanned] = useState(false)
  const [isRetracted, setIsRetracted] = useState(false)
  const [isTurnCardCollapsed, setIsTurnCardCollapsed] = useState(false)
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false)

  // Track heading & course angle
  useEffect(() => {
    if (!gpsPos) return
    let newHeading = null

    if (gpsPos.heading != null && !Number.isNaN(gpsPos.heading) && gpsPos.heading > 0) {
      newHeading = gpsPos.heading
    } else if (prevGpsPosRef.current) {
      const dist = haversineDistance(prevGpsPosRef.current.lat, prevGpsPosRef.current.lng, gpsPos.lat, gpsPos.lng)
      if (dist >= 1.5) {
        newHeading = calculateBearing(prevGpsPosRef.current.lat, prevGpsPosRef.current.lng, gpsPos.lat, gpsPos.lng)
      }
    }

    if (newHeading == null && dumpOrsData?.geometry) {
      try {
        const pts = decodePolyline(dumpOrsData.geometry)
        if (pts.length >= 2) {
          newHeading = calculateBearing(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
        }
      } catch { }
    }

    if (newHeading == null && dumpSiteLocation) {
      newHeading = calculateBearing(gpsPos.lat, gpsPos.lng, Number(dumpSiteLocation.latitude), Number(dumpSiteLocation.longitude))
    }

    if (newHeading != null) {
      setMapHeading(prev => getShortestAngle(prev, newHeading))
    }
    prevGpsPosRef.current = gpsPos
  }, [gpsPos, dumpSiteLocation, dumpOrsData])

  const toggleRetract = () => {
    setIsRetracted(prev => {
      const next = !prev
      setIsHeaderCollapsed(next)
      return next
    })
  }

  const toggleHeader = () => {
    setIsHeaderCollapsed(prev => !prev)
  }

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
    const map = L.map(dumpMapRef.current, { center, zoom: 17.5, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    dumpMapInstance.current = map
    setTimeout(() => map.invalidateSize(), 0)

    const pauseFollow = () => {
      isFollowCamRef.current = false
      setIsUserPanned(true)
    }
    map.on('dragstart zoomstart movestart', (e) => {
      if (e.originalEvent || e.type === 'dragstart' || e.type === 'zoomstart') {
        pauseFollow()
      }
    })

    const heading = mapHeading || gpsPos?.heading || 0
    const driverIcon = create3DVehicleIcon(L, heading, is3D, mapHeading)
    dumpDriverMarker.current = L.marker(center, { icon: driverIcon, zIndexOffset: 1000 }).addTo(map)

    const dumpIconHtml = `
      <div style="width:36px;height:36px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.3);color:#fff;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
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
    if (window.L) {
      const heading = mapHeading || gpsPos.heading || 0
      dumpDriverMarker.current.setIcon(create3DVehicleIcon(window.L, heading, is3D, mapHeading))
    }
    if (isFollowCamRef.current) {
      dumpMapInstance.current.panTo([gpsPos.lat, gpsPos.lng], { animate: true, duration: 0.4 })
    }
  }, [gpsPos, is3D, mapHeading])

  // Sync 3D vehicle avatar when 3D mode toggles
  useEffect(() => {
    if (dumpDriverMarker.current && window.L && gpsPos) {
      const heading = mapHeading || gpsPos.heading || 0
      dumpDriverMarker.current.setIcon(create3DVehicleIcon(window.L, heading, is3D, mapHeading))
    }
  }, [is3D, mapHeading, gpsPos])

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
      {/* ── TOP NAV BAR WITH COLLAPSIBLE SLIDE-UP ── */}
      <div style={{
        position: 'fixed',
        top: isHeaderCollapsed ? -65 : 0,
        left: 0,
        right: 0,
        height: 60,
        zIndex: 1005,
        transition: 'top 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
        overflow: 'hidden',
        pointerEvents: isHeaderCollapsed ? 'none' : 'auto',
      }}>
      </div>
      <style>{`
        @keyframes esMapPulse { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.6);opacity:0} }
        @keyframes esNavFadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
      <div style={{
        position: 'fixed',
        top: isHeaderCollapsed ? 0 : 60,
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
        background: '#1c2430',
        transition: 'top 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}>
        {/* MAP CONTAINER WITH 3D PERSPECTIVE SUPPORT */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#1c2430', overflow: 'hidden' }}>
          <div
            ref={dumpMapRef}
            onTouchStart={() => { isFollowCamRef.current = false; setIsUserPanned(true) }}
            onMouseDown={() => { isFollowCamRef.current = false; setIsUserPanned(true) }}
            onWheel={() => { isFollowCamRef.current = false; setIsUserPanned(true) }}
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              inset: 0,
              transform: is3D ? `perspective(900px) rotateX(50deg) rotateZ(${-mapHeading}deg) scale(1.85)` : 'none',
              transformOrigin: '50% 65%',
              transition: 'transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          />

          {/* FLOATING MAP CONTROLS */}
          <div style={{
            position: 'absolute',
            right: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {/* 3D / 2D Camera Toggle */}
            <button
              type="button"
              onClick={() => {
                setIs3D(prev => {
                  const next = !prev
                  if (dumpMapInstance.current && gpsPos) {
                    isFollowCamRef.current = true
                    setIsUserPanned(false)
                    dumpMapInstance.current.setView([gpsPos.lat, gpsPos.lng], next ? 18 : 17.5, { animate: true })
                    setTimeout(() => dumpMapInstance.current?.invalidateSize(), 300)
                  }
                  return next
                })
              }}
              title={is3D ? "Switch to 2D Top-Down View" : "Switch to 3D Cockpit View"}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: is3D ? '#16a34a' : 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(10px)',
                border: is3D ? '2px solid #22c55e' : '1px solid rgba(255,255,255,0.2)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease',
                fontFamily: 'var(--font-head)',
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: '0.04em',
              }}
            >
              {is3D ? '2D' : '3D'}
            </button>

            {/* Compass / Heading Reset in 3D Mode */}
            {is3D && (
              <button
                type="button"
                onClick={() => setMapHeading(0)}
                title="Reset to North"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ transform: `rotate(${-mapHeading}deg)`, transition: 'transform 0.4s ease' }}>
                  <Compass size={20} color="#f87171" />
                </div>
              </button>
            )}

            {/* Re-center GPS */}
            <button
              type="button"
              onClick={() => {
                if (gpsPos && dumpMapInstance.current) {
                  isFollowCamRef.current = true
                  setIsUserPanned(false)
                  dumpMapInstance.current.setView([gpsPos.lat, gpsPos.lng], is3D ? 18 : 17.5, { animate: true })
                }
              }}
              title="Re-center on My Location"
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: isUserPanned ? '#2563eb' : 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(10px)',
                border: isUserPanned ? '2px solid #60a5fa' : '1px solid rgba(255,255,255,0.2)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: isUserPanned ? '0 0 16px rgba(37,99,235,0.7)' : '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease',
              }}
            >
              <LocateFixed size={20} />
            </button>

            {/* Zoom In / Out Buttons */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(10px)',
              borderRadius: 22,
              border: '1px solid rgba(255,255,255,0.2)',
              overflow: 'hidden',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}>
              <button
                type="button"
                onClick={() => {
                  isFollowCamRef.current = false
                  setIsUserPanned(true)
                  dumpMapInstance.current?.zoomIn()
                }}
                title="Zoom In"
                style={{
                  width: 44,
                  height: 38,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.12)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
              >
                <Plus size={18} />
              </button>
              <button
                type="button"
                onClick={() => {
                  isFollowCamRef.current = false
                  setIsUserPanned(true)
                  dumpMapInstance.current?.zoomOut()
                }}
                title="Zoom Out"
                style={{
                  width: 44,
                  height: 38,
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
              >
                <Minus size={18} />
              </button>
            </div>

            {/* DEV Teleport */}
            {import.meta.env.DEV && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!dumpSiteLocation) return
                    const lat = Number(dumpSiteLocation.latitude), lng = Number(dumpSiteLocation.longitude)
                    setMockGps({ lat, lng })
                    dumpMapInstance.current?.panTo([lat, lng])
                  }}
                  title="DEV: Teleport to Dump Site"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: '#f59e0b',
                    border: '2px solid #fff',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0,0,0,.2)',
                  }}
                >
                  <Trash2 size={18} />
                </button>
                {isMock && (
                  <button
                    type="button"
                    onClick={() => setMockGps(null)}
                    title="Clear Mock GPS"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: '#ef4444',
                      border: '2px solid #fff',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0,0,0,.2)',
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* RETRACTABLE HEADER */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          background: 'rgba(15,23,42,0.95)',
          backdropFilter: 'blur(10px)',
          color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,.22)',
          transition: 'transform 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
          transform: isHeaderCollapsed ? 'translateY(calc(-100% + 32px))' : 'translateY(0)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Main Header Content */}
          <div style={{
            padding: '12px 18px 8px',
            opacity: isHeaderCollapsed ? 0 : 1,
            pointerEvents: isHeaderCollapsed ? 'none' : 'auto',
            transition: 'opacity 0.25s ease',
          }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${gpsColor}18`, border: `1px solid ${gpsColor}44`, borderRadius: 20, padding: '3px 10px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: gpsColor, display: 'inline-block', animation: isTracking && !gpsError ? 'esMapPulse 2s ease infinite' : 'none' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: gpsColor, letterSpacing: '.04em' }}>{gpsLabel}</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 20, padding: '3px 10px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em' }}>NAVIGATING TO DUMP SITE</span>
              </div>
              <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px' }}>
                <Clock size={11} color="rgba(255,255,255,0.7)" />
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: '.04em' }}>{formattedTime}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Trash2 size={18} color="#f59e0b" />
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, color: '#fff' }}>{dumpSiteName}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Dispose collected waste before returning · {dumpDistLabel}</div>
              </div>
            </div>
          </div>

          {/* Collapsible Handle Lip */}
          <div
            onClick={toggleHeader}
            title={isHeaderCollapsed ? "Tap to expand header" : "Tap to collapse header"}
            style={{
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
              cursor: 'pointer',
              userSelect: 'none',
              borderTop: isHeaderCollapsed ? 'none' : '1px solid rgba(255,255,255,0.08)',
              background: isHeaderCollapsed ? 'rgba(15,23,42,0.96)' : 'rgba(0,0,0,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Trash2 size={13} color="#f59e0b" />
              <span style={{
                fontSize: 12,
                fontWeight: 800,
                color: '#ffffff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {dumpSiteName}
              </span>
              {isHeaderCollapsed && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                  · {dumpDistLabel}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
              <span>{isHeaderCollapsed ? 'Expand Header' : 'Collapse'}</span>
              {isHeaderCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </div>
          </div>
        </div>

        {/* TURN CARD (Ride-Hailing Emerald style) */}
        {(!distanceToDump || distanceToDump > 30) && (
          <div
            onClick={() => setIsTurnCardCollapsed(p => !p)}
            style={{
              position: 'absolute',
              top: isHeaderCollapsed ? 42 : 70,
              left: 14,
              right: 14,
              zIndex: 10,
              background: 'linear-gradient(135deg, #005944 0%, #064e3b 100%)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: isTurnCardCollapsed ? 12 : 18,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              padding: isTurnCardCollapsed ? '8px 14px' : '12px 14px',
              boxShadow: '0 8px 30px rgba(0,0,0,.32)',
              animation: 'esNavFadeUp .25s ease',
              transition: 'all 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
              gap: 12,
              cursor: 'pointer',
            }}
          >
            <div style={{
              width: isTurnCardCollapsed ? 32 : 46,
              height: isTurnCardCollapsed ? 32 : 46,
              flexShrink: 0,
              background: 'rgba(255,255,255,0.12)',
              borderRadius: isTurnCardCollapsed ? 8 : 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}>
              <TurnArrow type={stepType} bearing={stepBearing} color="#ffffff" size={isTurnCardCollapsed ? 20 : 40} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-head)',
                fontSize: isTurnCardCollapsed ? 15 : 22,
                fontWeight: 900,
                color: '#ffffff',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                marginBottom: isTurnCardCollapsed ? 0 : 3,
              }}>
                {dumpDistLabel}
              </div>
              {!isTurnCardCollapsed && (
                <div style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.92)',
                  lineHeight: 1.25,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {dumpInstruction}
                </div>
              )}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center' }}>
              {isTurnCardCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </div>
          </div>
        )}

        {/* RETRACTABLE BOTTOM SHEET */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(16px)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          boxShadow: '0 -6px 28px rgba(0,0,0,.15)',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: isRetracted ? 0 : 'env(safe-area-inset-bottom, 16px)',
          transition: 'transform 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
          transform: isRetracted ? 'translateY(calc(100% - 32px))' : 'translateY(0)',
        }}>
          {/* Retractable Handle Bar */}
          <div
            onClick={toggleRetract}
            style={{
              height: 32,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
              padding: '6px 16px 2px',
            }}
          >
            <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, marginBottom: 2 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {isRetracted ? (
                <>
                  <ChevronUp size={13} />
                  <span>{isAtDump ? "At Dump · Tap to continue" : "Tap to view stats & actions"}</span>
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  <span>Tap to collapse stats</span>
                </>
              )}
            </div>
          </div>

          {!isRetracted && (
            /* When EXPANDED: Full 3-column stats & confirmation CTA */
            <>
              <div style={{ padding: '4px 12px 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
                <StatCell value={dumpArrival} label="arrival" />
                <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
                <StatCell value={dumpEta} label="min" />
                <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
                <StatCell value={dumpKm} label="km" />
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <p style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 800, textAlign: 'center', color: isAtDump ? '#f59e0b' : '#475569', margin: 0, transition: 'color .3s' }}>
                  {isAtDump ? "You've reached the dump site!" : 'Head to the dump site'}
                </p>
                {!isAtDump && distanceToDump != null && (
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', margin: 0 }}>
                    {distanceToDump > 1000 ? `${(distanceToDump / 1000).toFixed(1)} km remaining` : `${Math.round(distanceToDump)} m remaining`}
                  </p>
                )}
                {!isAtDump && distanceToDump == null && (
                  <p style={{ fontSize: 12, color: '#f59e0b', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Radio size={14} /> Waiting for GPS signal…
                  </p>
                )}
                <button
                  disabled={!isAtDump}
                  onClick={() => {
                    api.post('/api/driver/shift/status/', { status: 'at_dumpsite' }).catch(console.error)
                    setPhase('waiting_dump_confirmation')
                  }}
                  style={{
                    width: '100%', maxWidth: 340, padding: '16px', borderRadius: 30, border: 'none',
                    fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, letterSpacing: '.04em',
                    transition: 'all .35s ease',
                    cursor: isAtDump ? 'pointer' : 'not-allowed',
                    background: isAtDump ? '#f59e0b' : '#e2e8f0',
                    color: isAtDump ? '#fff' : '#94a3b8',
                    boxShadow: isAtDump ? '0 6px 20px rgba(245,158,11,0.35)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  {isAtDump && <CheckCircle2 size={18} />}
                  <span>{isAtDump ? 'Confirm Arrival at Dump Site' : 'Confirm on Arrival'}</span>
                </button>
                {import.meta.env.DEV && (
                  <button
                    onClick={() => {
                      api.post('/api/driver/shift/status/', { status: 'at_dumpsite' }).catch(console.error)
                      setPhase('waiting_dump_confirmation')
                    }}
                    style={{ width: '100%', maxWidth: 340, padding: '10px', borderRadius: 20, background: 'none', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                  >
                    DEV: Skip to Calibration
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
