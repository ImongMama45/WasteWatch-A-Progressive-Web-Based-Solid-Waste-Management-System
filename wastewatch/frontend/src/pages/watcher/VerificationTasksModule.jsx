/**
 * VerificationTasksModule.jsx — Watcher map-based inspection workflow
 * Mirrors ShiftRouteModule architecture: fullscreen Leaflet map, GPS
 * proximity guard, ORS polyline to nearest stop, Dev teleport tools.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import Navbar from '../../components/Navbar'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import {
  buildStopMarkerHtml,
  broadcastPickupStatusSync,
  normalizeStopStatus,
  STOP_STATUS_COLORS,
  STOP_STATUS_LABELS,
  subscribePickupStatusSync,
} from '../../utils/pickupStatusSync'
import PreInspectionOverlay from './components/PreInspectionOverlay'

const ARRIVAL_RADIUS_M = 30
const LUCENA_CENTER = [13.9373, 121.617]
const ORS_KEY = import.meta.env.VITE_ORS_API_KEY || ''

function injectStopMarkerStyles() {
  if (document.getElementById('ww-vtm-stop-styles')) return
  const style = document.createElement('style')
  style.id = 'ww-vtm-stop-styles'
  style.textContent = `
    @keyframes wwMarkerPulse {
      0%, 100% { transform: scale(1); opacity: 0.5; }
      50%       { transform: scale(1.75); opacity: 0; }
    }
    .ww-stop-div-icon {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }
  `
  document.head.appendChild(style)
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = d => d * Math.PI / 180
  const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function decodePolyline(enc) {
  let pts = [], i = 0, lat = 0, lng = 0
  while (i < enc.length) {
    let b, s = 0, r = 0
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5 } while (b >= 0x20)
    lat += (r & 1) ? ~(r >> 1) : r >> 1; s = 0; r = 0
    do { b = enc.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5 } while (b >= 0x20)
    lng += (r & 1) ? ~(r >> 1) : r >> 1
    pts.push([lat / 1e5, lng / 1e5])
  }
  return pts
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
function GpsStatusPill({ isTracking, error, accuracy }) {
  const isPoor = accuracy != null && accuracy >= 50
  const label = error ? 'GPS Lost' : !isTracking ? 'Acquiring GPS…'
    : accuracy != null ? `GPS ±${Math.round(accuracy)}m` : 'GPS Active'
  const color = error ? '#ef4444' : isPoor ? '#f59e0b' : isTracking ? '#2ecc71' : '#f59e0b'
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 20, padding: '3px 10px' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', animation: isTracking && !error ? 'vtmPulse 2s ease infinite' : 'none' }} />
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '.04em' }}>{label}</span>
    </div>
  )
}

function ConnPill() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const c = online ? '#2ecc71' : '#ef4444'
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${c}1a`, border: `1px solid ${c}44`, borderRadius: 20, padding: '3px 10px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: c, letterSpacing: '.04em' }}>{online ? '● Online' : '○ Offline'}</span>
    </div>
  )
}

function MapLegend() {
  const items = [
    { color: 'transparent', border: '1.5px dashed rgba(148,163,184,.9)', label: 'Pending Inspection' },
    { color: '#f59e0b', label: 'Ready for Collection' },
    { color: '#94a3b8', label: 'Empty Stop' },
    { color: '#eab308', label: 'Collection Reported' },
    { color: '#16a34a', label: 'Verified Collected' },
  ]
  return (
    <div style={{ position: 'absolute', bottom: 210, right: 14, zIndex: 500, background: 'rgba(15,23,42,.85)', backdropFilter: 'blur(6px)', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map(({ color, border, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, border: border || 'none', flexShrink: 0 }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.8)', letterSpacing: '.04em' }}>{label.toUpperCase()}</span>
        </div>
      ))}
    </div>
  )
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function VerificationTasksModule() {
  const { user } = useAuth()

  // ── GPS state ──
  const [gpsPos, setGpsPos] = useState(null)
  const [isMock, setIsMock] = useState(false)
  const [gpsError, setGpsError] = useState(null)
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  const [isTracking, setIsTracking] = useState(false)
  const gpsPosRef = useRef(null)
  const watchIdRef = useRef(null)
  const mockPosRef = useRef(null)

  // ── Map state ──
  const [leafletReady, setLeafletReady] = useState(false)
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const userMarkerRef = useRef(null)
  const stopMarkersRef = useRef(new Map())
  const routeLayerRef = useRef(null)

  // ── Data state ──
  const [stops, setStops] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState(null)
  const [orsRoute, setOrsRoute] = useState(null)

  // ── Inject marker styles on mount ──
  useEffect(() => { injectStopMarkerStyles() }, [])

  // ── Sync GPS ref (layout effect for same-render reads) ──
  useLayoutEffect(() => { gpsPosRef.current = gpsPos }, [gpsPos])

  // ── Derived: nearest pending stop ──
  const nearestStop = (() => {
    const pending = stops.filter(s => normalizeStopStatus(s.current_status) === 'PENDING_INSPECTION' && s.lat && s.lng)
    if (!gpsPos || pending.length === 0) return pending[0] || null
    return pending.reduce((best, s) => {
      const d = haversineDistance(gpsPos.lat, gpsPos.lng, s.lat, s.lng)
      const bd = haversineDistance(gpsPos.lat, gpsPos.lng, best.lat, best.lng)
      return d < bd ? s : best
    })
  })()

  const distToStop = gpsPos && nearestStop?.lat
    ? haversineDistance(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng)
    : null
  const isNearStop = distToStop != null && distToStop <= ARRIVAL_RADIUS_M
  const pendingCount = stops.filter(s => normalizeStopStatus(s.current_status) === 'PENDING_INSPECTION').length

  // ── Load stops ──
  async function loadStops() {
    setLoading(true)
    try {
      const res = await api.get('/api/watcher/stop-validations/')
      const rows = res.data?.results ?? res.data ?? []
      setStops(rows.map(r => ({
        ...r,
        lat: r.lat ?? r.pre_validation_latitude ?? null,
        lng: r.lng ?? r.pre_validation_longitude ?? null,
      })))
    } catch { setStops([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadStops() }, [])

  // ── Subscribe to sync events ──
  useEffect(() => subscribePickupStatusSync(() => loadStops()), [])

  // ── Leaflet CDN ──
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return }
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
    document.head.appendChild(link)
    const s = Object.assign(document.createElement('script'), { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', onload: () => setLeafletReady(true) })
    document.head.appendChild(s)
  }, [])

  // ── GPS tracking (with mock override) ──
  useEffect(() => {
    if (!navigator.geolocation) { setGpsError('GPS not available on this device.'); return }
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        if (mockPosRef.current) return
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setGpsPos(p); setIsTracking(true); setGpsError(null)
        setGpsAccuracy(pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null)
      },
      err => { setGpsError(err.message); setIsTracking(false) },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    )
    return () => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current) }
  }, [])

  // ── Map init ──
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return
    const L = window.L
    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false })
      .setView(LUCENA_CENTER, 14)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    mapInstance.current = map
  }, [leafletReady])

  // ── Draw stop markers ──
  useEffect(() => {
    const L = window.L
    if (!L || !mapInstance.current || stops.length === 0) return
    const map = mapInstance.current

    // Clear old markers
    stopMarkersRef.current.forEach(m => m.remove())
    stopMarkersRef.current.clear()

    stops.forEach((stop, idx) => {
      if (!stop.lat || !stop.lng) return
      const status = normalizeStopStatus(stop.current_status)
      const isActive = nearestStop && stop.id === nearestStop.id && status === 'PENDING_INSPECTION'
      const html = buildStopMarkerHtml(stop.stop_order ?? idx + 1, status, null, isActive)
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({ html, className: 'ww-stop-div-icon', iconSize: isActive ? [28, 28] : [24, 24], iconAnchor: isActive ? [14, 14] : [12, 12] }),
        zIndexOffset: isActive ? 100 : 0,
      })
        .addTo(map)
        .bindPopup(`<b>${stop.label}</b><br/><span style="font-size:11px;font-weight:700;color:${STOP_STATUS_COLORS[status]?.bg || '#94a3b8'}">${STOP_STATUS_LABELS[status] || status}</span>`)

      marker.on('click', () => {
        if (status === 'PENDING_INSPECTION') setSelectedTask(stop)
      })
      stopMarkersRef.current.set(stop.id, marker)
    })
  }, [stops, leafletReady, nearestStop])

  // ── User dot on map ──
  useEffect(() => {
    const L = window.L
    if (!L || !mapInstance.current || !gpsPos) return
    const userHtml = `<div style="width:14px;height:14px;border-radius:50%;background:#14b8a6;border:2.5px solid #fff;box-shadow:0 0 12px rgba(20,184,166,.6);"></div>`
    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker([gpsPos.lat, gpsPos.lng], {
        icon: L.divIcon({ html: userHtml, className: '', iconSize: [14, 14], iconAnchor: [7, 7] }),
        zIndexOffset: 1000,
      }).addTo(mapInstance.current)
    } else {
      userMarkerRef.current.setLatLng([gpsPos.lat, gpsPos.lng])
    }
  }, [gpsPos, leafletReady])

  // ── ORS route to nearest stop ──
  useEffect(() => {
    if (!gpsPos || !nearestStop?.lat || !nearestStop?.lng || !ORS_KEY) {
      setOrsRoute(null); return
    }
    const ctrl = new AbortController()
    const fetchRoute = async () => {
      try {
        const res = await fetch(
          `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${ORS_KEY}&start=${gpsPos.lng},${gpsPos.lat}&end=${nearestStop.lng},${nearestStop.lat}`,
          { signal: ctrl.signal }
        )
        const data = await res.json()
        const encoded = data?.features?.[0]?.properties?.segments?.[0]
        const geometry = data?.features?.[0]?.geometry
        if (geometry?.coordinates) {
          setOrsRoute(geometry.coordinates.map(([lng, lat]) => [lat, lng]))
        } else { setOrsRoute([[gpsPos.lat, gpsPos.lng], [nearestStop.lat, nearestStop.lng]]) }
      } catch { setOrsRoute(null) }
    }
    fetchRoute()
    return () => ctrl.abort()
  }, [gpsPos?.lat, gpsPos?.lng, nearestStop?.id])

  // ── Draw ORS polyline ──
  useEffect(() => {
    const L = window.L
    if (!L || !mapInstance.current) return
    routeLayerRef.current?.remove()
    routeLayerRef.current = null
    if (!orsRoute || orsRoute.length < 2) return
    routeLayerRef.current = L.polyline(orsRoute, {
      color: '#14b8a6', weight: 4, opacity: 0.85,
      dashArray: orsRoute.length === 2 ? '8,6' : null,
    }).addTo(mapInstance.current)
  }, [orsRoute, leafletReady])

  // ── Dev teleport ──
  function teleportTo(stop) {
    if (!stop?.lat || !stop?.lng) return
    const p = { lat: stop.lat + (Math.random() * 0.00005 - 0.000025), lng: stop.lng + (Math.random() * 0.00005 - 0.000025) }
    mockPosRef.current = p
    setGpsPos(p); setIsMock(true); setIsTracking(true)
    mapInstance.current?.flyTo([p.lat, p.lng], 18, { animate: true, duration: 1 })
  }

  function clearMock() {
    mockPosRef.current = null
    setIsMock(false); setGpsPos(null); setIsTracking(false)
  }

  const pendingStops = stops.filter(s => normalizeStopStatus(s.current_status) === 'PENDING_INSPECTION')

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes vtmPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        .ww-stop-div-icon { background:transparent!important;border:0!important;box-shadow:none!important; }
      `}</style>

      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

        {/* MAP */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#1e2a38' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          {leafletReady && <MapLegend />}

          {/* DEV TOOLS */}
          {import.meta.env.DEV && (
            <div style={{ position: 'absolute', top: '50%', right: 14, marginTop: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => teleportTo(nearestStop)}
                disabled={!nearestStop}
                title="Teleport to Nearest Pending Stop"
                style={{ width: 44, height: 44, borderRadius: '50%', background: nearestStop ? '#14b8a6' : '#cbd5e1', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: nearestStop ? 'pointer' : 'not-allowed', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20 }}
              >📍</button>
              {pendingStops.slice(0, 3).map((s, i) => (
                <button key={s.id} onClick={() => teleportTo(s)} title={`Teleport to ${s.label}`}
                  style={{ width: 44, height: 44, borderRadius: '50%', background: '#8b5cf6', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 13, fontWeight: 900, color: '#fff' }}
                >{i + 1}</button>
              ))}
              {isMock && (
                <button onClick={clearMock} title="Clear Mock GPS"
                  style={{ width: 44, height: 44, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 16, fontWeight: 800, color: '#fff' }}>✕</button>
              )}
            </div>
          )}
        </div>

        {/* HEADER */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(15,23,42,.92)', backdropFilter: 'blur(8px)', padding: '14px 16px 16px', color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <GpsStatusPill isTracking={isTracking} error={gpsError} accuracy={gpsAccuracy} />
            <ConnPill />
            {isMock && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.5)', borderRadius: 20, padding: '3px 10px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em' }}>📍 MOCK GPS</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900, letterSpacing: '.02em' }}>Verification Tasks</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>
                {loading ? 'Loading stops…' : `${pendingCount} stop${pendingCount !== 1 ? 's' : ''} pending inspection`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#14b8a6' }}>{pendingCount}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', fontWeight: 700, letterSpacing: '.06em' }}>PENDING</div>
            </div>
          </div>
        </div>

        {/* BOTTOM PANEL */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(12px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -4px 24px rgba(0,0,0,.12)', paddingBottom: 24 }}>
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />

          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 13 }}>Loading…</div>
          ) : pendingCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 20px', color: '#64748b' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>All stops inspected!</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>No pending inspection stops remaining today.</div>
            </div>
          ) : nearestStop ? (
            <div style={{ padding: '4px 20px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 3 }}>NEAREST PENDING STOP</div>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900, color: isNearStop ? '#0f172a' : '#64748b', transition: 'color .3s' }}>{nearestStop.label}</div>
                </div>
                {distToStop != null && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900, color: isNearStop ? '#14b8a6' : '#475569' }}>
                      {distToStop > 1000 ? `${(distToStop / 1000).toFixed(1)}km` : `${Math.round(distToStop)}m`}
                    </div>
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '.04em' }}>AWAY</div>
                  </div>
                )}
              </div>

              {isNearStop ? (
                <p style={{ fontSize: 12, color: '#14b8a6', fontWeight: 700, marginBottom: 12, textAlign: 'center' }}>📍 You have arrived — ready to inspect!</p>
              ) : distToStop != null ? (
                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12, textAlign: 'center' }}>
                  Walk {distToStop > 1000 ? `${(distToStop / 1000).toFixed(1)} km` : `${Math.round(distToStop)} m`} to reach this stop
                </p>
              ) : (
                <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12, textAlign: 'center' }}>📡 Waiting for GPS signal…</p>
              )}

              <button
                id="inspect-btn"
                disabled={!isNearStop}
                onClick={() => setSelectedTask(nearestStop)}
                style={{
                  width: '100%', maxWidth: 320, display: 'block', margin: '0 auto',
                  padding: '18px', borderRadius: 30, border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
                  transition: 'all .35s ease',
                  cursor: isNearStop ? 'pointer' : 'not-allowed',
                  background: isNearStop ? '#0f172a' : '#e2e8f0',
                  color: isNearStop ? '#fff' : '#94a3b8',
                  boxShadow: isNearStop ? '0 6px 20px rgba(15,23,42,.3)' : 'none',
                }}
              >
                {isNearStop ? '🔍 Inspect Stop' : 'Confirm on Arrival'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* INSPECTION OVERLAY */}
      <PreInspectionOverlay
        visible={!!selectedTask}
        task={selectedTask}
        gpsPos={gpsPos}
        onComplete={() => { setSelectedTask(null); loadStops() }}
        onBack={() => setSelectedTask(null)}
      />
    </>
  )
}
