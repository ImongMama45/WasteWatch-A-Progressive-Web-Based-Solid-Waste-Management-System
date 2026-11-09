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
import TurnArrow, { TURN_COLOR } from './TurnArrow'
import useGpsTracking from '../../../hooks/useGpsTracking'
import api from '../../../api/client'
import { resolveDriverSchedule } from '../../../utils/driverSchedule'
import {
  Home,
  X,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LocateFixed,
  Navigation,
  Radio,
  Layers,
  ArrowRight,
  Compass,
  Plus,
  Minus,
} from 'lucide-react'
import { calculateBearing, getShortestAngle, create3DVehicleIcon } from './map3DUtils'
import { MobileFlowSkeleton } from '../../../components/ui/Skeleton'

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

  // 3D camera & Retractable stats state
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

    if (newHeading == null && orsData?.geometry) {
      try {
        const pts = decodePolyline(orsData.geometry)
        if (pts.length >= 2) {
          newHeading = calculateBearing(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
        }
      } catch { }
    }

    if (newHeading == null && baseLocation) {
      newHeading = calculateBearing(gpsPos.lat, gpsPos.lng, Number(baseLocation.lat), Number(baseLocation.lng))
    }

    if (newHeading != null) {
      setMapHeading(prev => getShortestAngle(prev, newHeading))
    }
    prevGpsPosRef.current = gpsPos
  }, [gpsPos, baseLocation, orsData])

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
    api.get('/api/driver/collection-schedules/?paginate=false')
      .then(res => {
        const schedules = Array.isArray(res.data) ? res.data : (res.data?.results || [])
        const match = resolveDriverSchedule(res.data, user.id, shift?.schedule_id ?? shift?.schedule ?? null)
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
    const map = L.map(mapRef.current, { center, zoom: 17.5, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    mapInstance.current = map

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
               <div style="position:absolute;inset:0;background:#16a34a;border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 14px rgba(22,163,74,0.55);color:#fff;">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
               </div>
             </div>`,
      className: '', iconSize: [40, 40], iconAnchor: [20, 20],
    })
    L.marker([baseLat, baseLng], { icon: baseIcon }).addTo(mapInstance.current)
      .bindPopup(`<b>${baseName}</b><br/><span style="font-size:11px;color:#16a34a;font-weight:700;">HOME BASE</span>`)
  }, [baseLocation, baseName, leafletReady])

  useEffect(() => {
    if (!mapInstance.current || !baseLocation) return
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
    if (window.L) {
      const heading = mapHeading || gpsPos.heading || 0
      driverMarkerRef.current.setIcon(create3DVehicleIcon(window.L, heading, is3D, mapHeading))
    }
    if (isFollowCamRef.current) {
      mapInstance.current.panTo([gpsPos.lat, gpsPos.lng], { animate: true, duration: 0.4 })
    }
  }, [gpsPos, is3D, mapHeading])

  // Sync 3D vehicle avatar when 3D mode toggles
  useEffect(() => {
    if (driverMarkerRef.current && window.L && gpsPos) {
      const heading = mapHeading || gpsPos.heading || 0
      driverMarkerRef.current.setIcon(create3DVehicleIcon(window.L, heading, is3D, mapHeading))
    }
  }, [is3D, mapHeading, gpsPos])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null }
  }, [])

  // ── ORS display values ────────────────────────────────────────────────────
  let instructionText = 'Head to your home base'
  let etaMinutes = '--', arrivalTimeStr = '--:--', distanceKmStr = '--'
  let stepType = 6
  let stepBearing = null

  if (orsData) {
    const seg = orsData.segments?.[0]
    if (seg?.steps?.length) {
      const step = seg.steps[0]
      instructionText = step.instruction || instructionText
      stepType = step.type !== undefined ? step.type : 6
      stepBearing = step.bearing_after !== undefined ? step.bearing_after : null
    }
    if (seg) {
      etaMinutes = Math.ceil(seg.duration / 60)
      arrivalTimeStr = new Date(Date.now() + seg.duration * 1000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      distanceKmStr = (seg.distance / 1000).toFixed(1)
    }
  }

  const accentColor = TURN_COLOR[stepType] || '#16a34a'

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
        <div style={{ width: '100%' }}>
          <MobileFlowSkeleton dark label="Loading navigation route..." />


        </div>
      </>
    )
  }

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
        @keyframes ntbPulse { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.6);opacity:0} }
        @keyframes ntbSpin  { to{transform:rotate(360deg)} }
        @keyframes ntbFadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
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

        {/* ── MAP CONTAINER WITH 3D PERSPECTIVE SUPPORT ── */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
          <div
            ref={mapRef}
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
        </div>

        {/* ── FLOATING MAP CONTROLS (Right side, Google Maps / Grab HUD style) ── */}
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
                if (mapInstance.current && gpsPos) {
                  isFollowCamRef.current = true
                  setIsUserPanned(false)
                  mapInstance.current.setView([gpsPos.lat, gpsPos.lng], next ? 18 : 17.5, { animate: true })
                  setTimeout(() => mapInstance.current?.invalidateSize(), 300)
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
              if (gpsPos && mapInstance.current) {
                isFollowCamRef.current = true
                setIsUserPanned(false)
                mapInstance.current.setView([gpsPos.lat, gpsPos.lng], is3D ? 18 : 17.5, { animate: true })
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
                mapInstance.current?.zoomIn()
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
                mapInstance.current?.zoomOut()
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
                  if (!baseLocation) return
                  const lat = Number(baseLocation.lat), lng = Number(baseLocation.lng)
                  setMockGps({ lat, lng })
                  mapInstance.current?.panTo([lat, lng])
                }}
                title="DEV: Teleport to Home Base"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: '#16a34a',
                  border: '2px solid #ffffff',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                }}
              >
                <Home size={18} />
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
                    border: '2px solid #ffffff',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                  }}
                >
                  <X size={18} />
                </button>
              )}
            </>
          )}
        </div>

        {/* ── TOP STATUS BAR (Retractable) ── */}
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
          {/* Main Status Bar Content */}
          <div style={{
            padding: '12px 18px 8px',
            opacity: isHeaderCollapsed ? 0 : 1,
            pointerEvents: isHeaderCollapsed ? 'none' : 'auto',
            transition: 'opacity 0.25s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${gpsColor}18`, border: `1px solid ${gpsColor}44`, borderRadius: 20, padding: '3px 10px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: gpsColor, display: 'inline-block', animation: isTracking && !gpsError ? 'ntbPulse 2s ease infinite' : 'none' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: gpsColor, letterSpacing: '.04em' }}>{gpsLabel}</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(22,163,74,0.18)', border: '1px solid rgba(22,163,74,0.5)', borderRadius: 20, padding: '3px 10px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', letterSpacing: '.04em' }}>NAVIGATING TO BASE</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Home size={15} color="#22c55e" />
              <span style={{ fontSize: 12, fontWeight: 800, color: '#ffffff' }}>{baseName}</span>
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
              <Home size={13} color="#22c55e" />
              <span style={{
                fontSize: 12,
                fontWeight: 800,
                color: '#ffffff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {baseName}
              </span>
              {isHeaderCollapsed && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                  · {distLabel}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
              <span>{isHeaderCollapsed ? 'Expand Header' : 'Collapse'}</span>
              {isHeaderCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </div>
          </div>
        </div>

        {/* ── RIDE-HAILING / GOOGLE MAPS STYLE TURN MANEUVER CARD ── */}
        {(!distanceToBase || distanceToBase > 30) && (
          <div
            onClick={() => setIsTurnCardCollapsed(p => !p)}
            style={{
              position: 'absolute',
              top: isHeaderCollapsed ? 42 : 56,
              left: 14,
              right: 14,
              zIndex: 10,
              background: 'linear-gradient(135deg, #005944 0%, #064e3b 100%)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: isTurnCardCollapsed ? 12 : 18,
              boxShadow: '0 8px 30px rgba(0,0,0,0.32)',
              display: 'flex',
              alignItems: 'center',
              padding: isTurnCardCollapsed ? '8px 14px' : '12px 14px',
              gap: 12,
              cursor: 'pointer',
              userSelect: 'none',
              animation: 'ntbFadeUp .25s ease',
              transition: 'all 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
            }}
          >
            {/* Turn Icon Container */}
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
              <TurnArrow type={stepType} bearing={stepBearing} size={isTurnCardCollapsed ? 20 : 36} color="#ffffff" />
            </div>

            {/* Instruction Text & Distance */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-head)',
                fontSize: isTurnCardCollapsed ? 15 : 20,
                fontWeight: 900,
                color: '#ffffff',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                marginBottom: isTurnCardCollapsed ? 0 : 2,
              }}>
                {distLabel}
              </div>
              {!isTurnCardCollapsed && (
                <div style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.92)',
                  lineHeight: 1.25,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {instructionText}
                </div>
              )}
            </div>

            <div style={{ color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center' }}>
              {isTurnCardCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </div>
          </div>
        )}

        {/* ── RETRACTABLE BOTTOM SHEET (Ride-Hailing / Foodpanda style) ── */}
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
          {/* Retractable Handle Bar (Click or drag to toggle) */}
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
                  <span>{isAtBase ? "At Base · Tap to continue" : "Tap to view stats & actions"}</span>
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  <span>Tap to collapse stats</span>
                </>
              )}
            </div>
          </div>

          {/* When EXPANDED: Full 3-column stats & confirmation CTA */}
          {!isRetracted && (
            <>
              {/* Stats row */}
              <div style={{ padding: '4px 12px 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
                {[
                  { value: arrivalTimeStr, label: 'arrival' },
                  { value: etaMinutes, label: 'min' },
                  { value: distanceKmStr, label: 'km' },
                ].map((cell, i, arr) => (
                  <React.Fragment key={cell.label}>
                    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
                      <div style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{cell.value}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cell.label}</div>
                    </div>
                    {i < arr.length - 1 && <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />}
                  </React.Fragment>
                ))}
              </div>

              {/* Confirm area */}
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <p style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 800, textAlign: 'center', color: isAtBase ? '#16a34a' : '#475569', margin: 0, transition: 'color .3s' }}>
                  {isAtBase ? "You've reached home base!" : 'Head to your home base first'}
                </p>

                {!isAtBase && distanceToBase != null && (
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', margin: 0 }}>
                    {distanceToBase > 1000 ? `${(distanceToBase / 1000).toFixed(1)} km remaining` : `${Math.round(distanceToBase)} m remaining`}
                  </p>
                )}
                {!isAtBase && distanceToBase == null && (
                  <p style={{ fontSize: 12, color: '#f59e0b', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Radio size={14} /> Waiting for GPS signal…
                  </p>
                )}

                <button
                  disabled={!isAtBase}
                  onClick={() => onAdvance('confirm_start')}
                  style={{
                    width: '100%', maxWidth: 340, padding: '16px', borderRadius: 30, border: 'none',
                    fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, letterSpacing: '.04em',
                    transition: 'all .35s ease',
                    cursor: isAtBase ? 'pointer' : 'not-allowed',
                    background: isAtBase ? '#16a34a' : '#e2e8f0',
                    color: isAtBase ? '#ffffff' : '#94a3b8',
                    boxShadow: isAtBase ? '0 6px 20px rgba(22,163,74,0.35)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  {isAtBase && <CheckCircle2 size={18} />}
                  <span>{isAtBase ? "I'm at Base — Continue" : 'Confirm on Arrival'}</span>
                </button>

                {import.meta.env.DEV && (
                  <button onClick={() => onAdvance('confirm_start')} style={{ width: '100%', maxWidth: 340, padding: '10px', borderRadius: 20, background: 'none', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    DEV: Skip to Confirm Start
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
