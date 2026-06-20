/**
 * VerificationTasksModule.jsx — Watcher map-based PRE-INSPECTION workflow
 *
 * Changes from previous version:
 *  - OSM tile layer (default Leaflet, not CartoDB dark)
 *  - Watcher marker: compass-style SVG with heading direction (like Google Maps)
 *  - Multi-photo capture (up to 4 images), mandatory before submit
 *  - Barangay-filtered stops — only shows stops in the watcher's assigned barangay
 *  - Schedule-filtered stops — only today's scheduled stops appear
 *  - "No Scheduled Verification Today" empty state when nothing matches
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import CelebrationScreen from '../../components/CelebrationScreen'
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
import PostCollectionOverlay from './components/PostCollectionOverlay'
import StopCompletedOverlay from './components/StopCompletedOverlay'
import { ICONS } from '../../api/navConfig'
import { compressImage } from '../../utils/imageCompressor'

const ARRIVAL_RADIUS_M = 30
const LUCENA_CENTER = [13.9373, 121.617]
const ORS_KEY = import.meta.env.VITE_ORS_API_KEY || ''
const MAX_PHOTOS = 4

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
    @keyframes vtmPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  `
    document.head.appendChild(style)
}

// ─── WATCHER MARKER HTML (compass/heading style) ──────────────────────────────
function watcherMarkerHtml(heading) {
    const h = heading ?? 0
    return `
    <div style="position:relative;width:40px;height:40px;">
      <!-- Heading cone -->
      <svg viewBox="0 0 40 40" width="40" height="40"
        style="position:absolute;inset:0;transform:rotate(${h}deg);transform-origin:center;transition:transform .3s ease;">
        <defs>
          <radialGradient id="coneGrad" cx="50%" cy="100%" r="100%">
            <stop offset="0%" stop-color="#14b8a6" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="#14b8a6" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <!-- Cone pointing up (north = 0deg) -->
        <path d="M20 20 L13 4 Q20 1 27 4 Z" fill="url(#coneGrad)"/>
      </svg>
      <!-- Accuracy ring -->
      <div style="
        position:absolute;inset:4px;border-radius:50%;
        background:rgba(20,184,166,0.15);
        border:1.5px solid rgba(20,184,166,0.4);
      "></div>
      <!-- Center dot -->
      <div style="
        position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%);
        width:14px;height:14px;border-radius:50%;
        background:#14b8a6;
        border:2.5px solid #fff;
        box-shadow:0 0 10px rgba(20,184,166,.7), 0 2px 6px rgba(0,0,0,.3);
      "></div>
    </div>
  `
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = d => d * Math.PI / 180
    const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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
        { color: 'transparent', border: '1.5px dashed #94a3b8', label: 'Pending Inspection' },
        { color: '#f59e0b', label: 'Ready for Collection' },
        { color: '#94a3b8', label: 'Empty Stop' },
        { color: '#eab308', label: 'Collection Reported' },
        { color: '#16a34a', label: 'Verified Collected' },
    ]
    return (
        <div style={{
            position: 'absolute', bottom: 210, right: 14, zIndex: 500,
            background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(6px)',
            borderRadius: 10, padding: '8px 10px',
            border: '1px solid rgba(0,0,0,0.1)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            display: 'flex', flexDirection: 'column', gap: 5,
        }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: '#64748b', letterSpacing: '.08em', marginBottom: 3 }}>LEGEND</div>
            {items.map(({ color, border, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, border: border || 'none', flexShrink: 0 }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#334155', letterSpacing: '.03em' }}>{label}</span>
                </div>
            ))}
        </div>
    )
}

// ─── MULTI-PHOTO PICKER ───────────────────────────────────────────────────────
function MultiPhotoPicker({ photos, onChange }) {
    async function handleAdd(e) {
        const files = Array.from(e.target.files || [])
        if (!files.length) return
        const compressedFiles = await Promise.all(files.map(f => compressImage(f)))
        const next = [...photos, ...compressedFiles].slice(0, MAX_PHOTOS)
        onChange(next)
        e.target.value = ''
    }
    function removePhoto(idx) {
        onChange(photos.filter((_, i) => i !== idx))
    }

    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', marginBottom: 8 }}>
                INSPECTION PHOTOS * <span style={{ fontWeight: 500, textTransform: 'none', fontSize: 10, color: photos.length >= MAX_PHOTOS ? '#f59e0b' : '#94a3b8' }}>({photos.length}/{MAX_PHOTOS})</span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {photos.map((file, idx) => (
                    <div key={idx} style={{ position: 'relative', width: 72, height: 72 }}>
                        <img
                            src={URL.createObjectURL(file)}
                            alt={`Photo ${idx + 1}`}
                            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '2px solid #e2e8f0' }}
                        />
                        <button
                            onClick={() => removePhoto(idx)}
                            style={{
                                position: 'absolute', top: -6, right: -6,
                                width: 20, height: 20, borderRadius: '50%',
                                background: '#ef4444', color: '#fff', border: '2px solid #fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 800, cursor: 'pointer',
                                boxShadow: '0 2px 6px rgba(0,0,0,.2)',
                            }}
                        >×</button>
                    </div>
                ))}

                {photos.length < MAX_PHOTOS && (
                    <label style={{
                        width: 72, height: 72, borderRadius: 10,
                        border: `2px dashed ${photos.length === 0 ? '#ef4444' : '#cbd5e1'}`,
                        background: photos.length === 0 ? 'rgba(239,68,68,0.04)' : '#fafafa',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', gap: 4,
                    }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke={photos.length === 0 ? '#ef4444' : '#94a3b8'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                        </svg>
                        <span style={{ fontSize: 8, fontWeight: 700, color: photos.length === 0 ? '#ef4444' : '#94a3b8' }}>
                            {photos.length === 0 ? 'REQUIRED' : 'ADD'}
                        </span>
                        <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={handleAdd} />
                    </label>
                )}
            </div>

            {photos.length === 0 && (
                <p style={{ fontSize: 11, color: '#ef4444', marginTop: 6, fontWeight: 600 }}>
                    At least one photo is required to submit.
                </p>
            )}
        </div>
    )
}

// ─── NO SCHEDULE BANNER ───────────────────────────────────────────────────────
function NoScheduleBanner({ barangayName }) {
    return (
        <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
            background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(12px)',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            boxShadow: '0 -4px 24px rgba(0,0,0,.12)', paddingBottom: 28,
        }}>
            <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />
            <div style={{ textAlign: 'center', padding: '18px 24px' }}>
                <div style={{
                    width: 50, height: 50, borderRadius: 14, background: 'rgba(59,130,246,.15)', border: '1px solid rgba(59,130,246,.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6', marginBottom: 12,
                    boxShadow: '0 4px 12px rgba(59,130,246,.1)'
                }}>
                    <div style={{ width: 24, height: 24 }}>{ICONS.schedule}</div>
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900, color: '#0f172a', marginBottom: 6 }}>
                    No Scheduled Collections Today
                </div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, maxWidth: 280, margin: '0 auto 16px' }}>
                    {barangayName
                        ? `There are no collections to confirm for ${barangayName} today.`
                        : 'There are no collections to confirm for your barangay today.'}
                    {' '}Check back on your next scheduled collection day.
                </div>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                    borderRadius: 20, padding: '6px 14px',
                }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>No collections to confirm</span>
                </div>
            </div>
        </div>
    )
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function ConfirmCollectionModule() {
    const { user } = useAuth()
    const navigate = useNavigate()

    // ── GPS state ──
    const [gpsPos, setGpsPos] = useState(null)
    const [heading, setHeading] = useState(null)   // device compass heading
    const [isMock, setIsMock] = useState(false)
    const [gpsError, setGpsError] = useState(null)
    const [gpsAccuracy, setGpsAccuracy] = useState(null)
    const [isTracking, setIsTracking] = useState(false)
    const gpsPosRef = useRef(null)
    const watchIdRef = useRef(null)
    const mockPosRef = useRef(null)
    const headingRef = useRef(null)

    // ── Map state ──
    const [leafletReady, setLeafletReady] = useState(false)
    const mapRef = useRef(null)
    const mapInstance = useRef(null)
    const userMarkerRef = useRef(null)
    const stopMarkersRef = useRef(new Map())
    const routeLayerRef = useRef(null)

    // ── Data state ──
    const [stops, setStops] = useState([])   // filtered stops
    const [allStops, setAllStops] = useState([])   // raw from API
    const [loading, setLoading] = useState(true)
    const [hasScheduleToday, setHasScheduleToday] = useState(true)
    const [selectedTask, setSelectedTask] = useState(null)
    const [completedTask, setCompletedTask] = useState(null)
    const [orsRoute, setOrsRoute] = useState(null)

    useEffect(() => { injectStopMarkerStyles() }, [])
    useLayoutEffect(() => { gpsPosRef.current = gpsPos }, [gpsPos])

    // ── Filter stops by watcher's barangay ──
    useEffect(() => {
        if (!allStops.length) { setStops([]); return }
        const barangayId = user?.barangay
        const barangayName = user?.barangay_name?.toLowerCase()

        // If no barangay assigned, show nothing (admin-level watchers can override)
        if (!barangayId && !barangayName) {
            setStops([])
            return
        }

        const filtered = allStops.filter(stop => {
            // Match by barangay id or name (API may return either)
            const stopBrgy = stop.barangay_id ?? stop.barangay
            const stopName = stop.barangay_names?.toLowerCase() ?? ''
            if (barangayId && stopBrgy != null) return String(stopBrgy) === String(barangayId)
            if (barangayName) return stopName.includes(barangayName) || barangayName.includes(stopName)
            return false
        })

        setHasScheduleToday(filtered.length > 0)
        setStops(filtered.map(r => ({
            ...r,
            lat: r.lat ?? r.pre_validation_latitude ?? null,
            lng: r.lng ?? r.pre_validation_longitude ?? null,
        })))
    }, [allStops, user?.barangay, user?.barangay_name])

    // ── Derived: nearest pending stop ──
    const nearestStop = (() => {
        const pending = stops.filter(s => normalizeStopStatus(s.current_status) === 'COLLECTION_REPORTED' && s.lat && s.lng)
        if (!gpsPos || pending.length === 0) return pending[0] || null
        return pending.reduce((best, s) => {
            const d = haversineDistance(gpsPos.lat, gpsPos.lng, s.lat, s.lng)
            const bd = haversineDistance(gpsPos.lat, gpsPos.lng, best.lat, best.lng)
            return d < bd ? s : best
        })
    })()

    const distToStop = gpsPos && nearestStop?.lat ? haversineDistance(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng) : null
    const isNearStop = distToStop != null && distToStop <= ARRIVAL_RADIUS_M
    const pendingCount = stops.filter(s => normalizeStopStatus(s.current_status) === 'COLLECTION_REPORTED').length

    // ── Load stops ──
    async function loadStops() {
        setLoading(true)
        try {
            const res = await api.get('/api/watcher/stop-validations/')
            const rows = res.data?.results ?? res.data ?? []
            setAllStops(rows)
            if (rows.length === 0) setHasScheduleToday(false)
        } catch {
            setAllStops([])
            setHasScheduleToday(false)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadStops() }, [])
    useEffect(() => subscribePickupStatusSync(() => loadStops()), [])

    // ── Leaflet CDN ──
    useEffect(() => {
        if (window.L) { setLeafletReady(true); return }
        const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
        document.head.appendChild(link)
        const s = Object.assign(document.createElement('script'), { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', onload: () => setLeafletReady(true) })
        document.head.appendChild(s)
    }, [])

    // ── GPS tracking + heading ──
    useEffect(() => {
        if (!navigator.geolocation) { setGpsError('GPS not available on this device.'); return }
        watchIdRef.current = navigator.geolocation.watchPosition(
            pos => {
                if (mockPosRef.current) return
                const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
                setGpsPos(p); setIsTracking(true); setGpsError(null)
                setGpsAccuracy(pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null)
                // heading from GPS (only on moving, may be null)
                if (pos.coords.heading != null && !isNaN(pos.coords.heading)) {
                    setHeading(pos.coords.heading)
                    headingRef.current = pos.coords.heading
                }
            },
            err => { setGpsError(err.message); setIsTracking(false) },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        )

        // Device orientation for heading when stationary
        function onOrientation(e) {
            const alpha = e.webkitCompassHeading ?? (e.alpha != null ? (360 - e.alpha) : null)
            if (alpha != null) { setHeading(alpha); headingRef.current = alpha }
        }
        if (window.DeviceOrientationEvent) {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                DeviceOrientationEvent.requestPermission().then(perm => {
                    if (perm === 'granted') window.addEventListener('deviceorientation', onOrientation)
                }).catch(() => { })
            } else {
                window.addEventListener('deviceorientation', onOrientation)
            }
        }

        return () => {
            if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
            window.removeEventListener('deviceorientation', onOrientation)
        }
    }, [])

    // ── Map init (OSM tiles) ──
    useEffect(() => {
        if (!leafletReady || !mapRef.current || mapInstance.current) return
        const L = window.L
        const map = L.map(mapRef.current, { zoomControl: false, attributionControl: true })
            .setView(LUCENA_CENTER, 14)
        // Standard OSM tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
        }).addTo(map)
        L.control.zoom({ position: 'topright' }).addTo(map)
        mapInstance.current = map
        setTimeout(() => map.invalidateSize(), 250)
    }, [leafletReady])

    // ── Map Resize Handler ──
    useEffect(() => {
        const onResize = () => {
            if (mapInstance.current) mapInstance.current.invalidateSize()
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])

    useEffect(() => {
        if (mapInstance.current) {
            setTimeout(() => mapInstance.current.invalidateSize(), 150)
        }
    }, [selectedTask])

    // ── Draw stop markers ──
    useEffect(() => {
        const L = window.L
        if (!L || !mapInstance.current || stops.length === 0) return
        stopMarkersRef.current.forEach(m => m.remove())
        stopMarkersRef.current.clear()

        stops.forEach((stop, idx) => {
            if (!stop.lat || !stop.lng) return
            const status = normalizeStopStatus(stop.current_status)
            const isActive = nearestStop && stop.id === nearestStop.id && status === 'COLLECTION_REPORTED'
            const html = buildStopMarkerHtml(stop.stop_order ?? idx + 1, status, null, isActive)
            const marker = L.marker([stop.lat, stop.lng], {
                icon: L.divIcon({ html, className: 'ww-stop-div-icon', iconSize: isActive ? [28, 28] : [24, 24], iconAnchor: isActive ? [14, 14] : [12, 12] }),
                zIndexOffset: isActive ? 100 : 0,
            }).addTo(mapInstance.current)
                .bindPopup(`<b>${stop.label}</b><br/><span style="font-size:11px;font-weight:700;color:${STOP_STATUS_COLORS[status]?.bg || '#94a3b8'}">${STOP_STATUS_LABELS[status] || status}</span>`)
            marker.on('click', () => { if (status === 'COLLECTION_REPORTED') setSelectedTask(stop) })
            stopMarkersRef.current.set(stop.id, marker)
        })
    }, [stops, leafletReady, nearestStop])

    // ── Watcher marker (heading-aware) ──
    useEffect(() => {
        const L = window.L
        if (!L || !mapInstance.current || !gpsPos) return
        const html = watcherMarkerHtml(heading)
        if (!userMarkerRef.current) {
            userMarkerRef.current = L.marker([gpsPos.lat, gpsPos.lng], {
                icon: L.divIcon({ html, className: '', iconSize: [40, 40], iconAnchor: [20, 20] }),
                zIndexOffset: 1000,
            }).addTo(mapInstance.current)
            mapInstance.current.setView([gpsPos.lat, gpsPos.lng], 16)
        } else {
            userMarkerRef.current.setLatLng([gpsPos.lat, gpsPos.lng])
            userMarkerRef.current.setIcon(L.divIcon({ html, className: '', iconSize: [40, 40], iconAnchor: [20, 20] }))
        }
    }, [gpsPos, heading, leafletReady])

    // ── ORS route to nearest stop ──
    useEffect(() => {
        if (!gpsPos || !nearestStop?.lat || !nearestStop?.lng) { setOrsRoute(null); return }
        
        if (!ORS_KEY) {
            setOrsRoute([[gpsPos.lat, gpsPos.lng], [nearestStop.lat, nearestStop.lng]])
            return
        }

        const ctrl = new AbortController()
        fetch(
            `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${ORS_KEY}&start=${gpsPos.lng},${gpsPos.lat}&end=${nearestStop.lng},${nearestStop.lat}`,
            { signal: ctrl.signal }
        ).then(r => r.json()).then(data => {
            const geometry = data?.features?.[0]?.geometry
            if (geometry?.coordinates) setOrsRoute(geometry.coordinates.map(([lng, lat]) => [lat, lng]))
            else setOrsRoute([[gpsPos.lat, gpsPos.lng], [nearestStop.lat, nearestStop.lng]])
        }).catch(err => {
            if (err.name === 'AbortError') return;
            // Fallback to straight line on ORS errors
            setOrsRoute([[gpsPos.lat, gpsPos.lng], [nearestStop.lat, nearestStop.lng]])
        })
        return () => ctrl.abort()
    }, [gpsPos?.lat, gpsPos?.lng, nearestStop?.id])

    // ── Draw polyline ──
    useEffect(() => {
        const L = window.L
        if (!L || !mapInstance.current || !gpsPos) return
        routeLayerRef.current?.remove(); routeLayerRef.current = null
        if (!orsRoute || orsRoute.length < 2) return

        // Visually anchor the route start to current GPS so it auto-updates smoothly as user walks
        const dynamicRoute = [[gpsPos.lat, gpsPos.lng], ...orsRoute.slice(1)]

        routeLayerRef.current = L.polyline(dynamicRoute, {
            color: '#14b8a6', weight: 4, opacity: 0.85,
            dashArray: dynamicRoute.length === 2 ? '8,6' : null,
        }).addTo(mapInstance.current)
    }, [orsRoute, leafletReady, gpsPos?.lat, gpsPos?.lng])

    // ── Dev teleport ──
    function teleportTo(stop) {
        if (!stop?.lat || !stop?.lng) return
        const p = { lat: stop.lat + (Math.random() * 0.00005 - 0.000025), lng: stop.lng + (Math.random() * 0.00005 - 0.000025) }
        mockPosRef.current = p
        setGpsPos(p); setIsMock(true); setIsTracking(true)
        mapInstance.current?.flyTo([p.lat, p.lng], 18, { animate: true, duration: 1 })
    }
    function clearMock() { mockPosRef.current = null; setIsMock(false); setGpsPos(null); setIsTracking(false) }

    const showCelebration = !loading && hasScheduleToday && stops.length > 0 && pendingCount === 0;

    // ── Cleanup map when Celebration Screen is shown ──
    useEffect(() => {
        if (showCelebration) {
            if (mapInstance.current) {
                mapInstance.current.remove()
                mapInstance.current = null
            }
        }
    }, [showCelebration])

    const pendingStops = stops.filter(s => normalizeStopStatus(s.current_status) === 'COLLECTION_REPORTED')

    if (showCelebration) {
        return (
            <>
                <Navbar />
                <CelebrationScreen
                    title={`Great job, ${user?.full_name?.split(' ')[0] || 'Watcher'}! 🎉`}
                    subtitle="You've completed all collection confirmations for today."
                    stats={[
                        { icon: '📍', label: 'Collections Confirmed', value: `${stops.length} / ${stops.length}` },
                        { icon: '✅', label: 'Completion', value: '100%' },
                        { icon: '📅', label: 'Date', value: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                    ]}
                    onDone={() => navigate('/dashboard')}
                />
            </>
        )
    }

    return (
        <>
            <Navbar />

            <div style={{ height: 'calc(100vh - 64px)', marginTop: 64, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

                {/* MAP */}
                <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#e8f0e8' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
                    {leafletReady && <MapLegend />}

                    {/* DEV TOOLS */}
                    {import.meta.env.DEV && (
                        <div style={{ position: 'absolute', top: '50%', right: 14, marginTop: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <button onClick={() => teleportTo(nearestStop)} disabled={!nearestStop} title="Teleport to Nearest Pending Stop"
                                style={{ width: 44, height: 44, borderRadius: '50%', background: nearestStop ? '#14b8a6' : '#cbd5e1', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: nearestStop ? 'pointer' : 'not-allowed', boxShadow: '0 4px 12px rgba(0,0,0,.2)', color: '#fff' }}>
                                {ICONS.pin}
                            </button>
                            {pendingStops.slice(0, 3).map((s, i) => (
                                <button key={s.id} onClick={() => teleportTo(s)} title={`Teleport to ${s.label}`}
                                    style={{ width: 44, height: 44, borderRadius: '50%', background: '#8b5cf6', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 13, fontWeight: 900, color: '#fff' }}>
                                    {i + 1}
                                </button>
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
                                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <div style={{ width: 12, height: 12 }}>{ICONS.pin}</div> MOCK GPS
                                </span>
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900, letterSpacing: '.02em' }}>Verification Tasks</div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 14, height: 14 }}>{ICONS.pin}</div> {user?.barangay_name || 'No barangay assigned'} ·{' '}
                                {loading ? 'Loading…' : `${pendingCount} pending`}
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 22, fontWeight: 900, color: '#14b8a6' }}>{pendingCount}</div>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', fontWeight: 700, letterSpacing: '.06em' }}>PENDING</div>
                        </div>
                    </div>
                </div>

                {/* BOTTOM PANEL or NO-SCHEDULE BANNER */}
                {!loading && !hasScheduleToday ? (
                    <NoScheduleBanner barangayName={user?.barangay_name} />
                ) : (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(12px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -4px 24px rgba(0,0,0,.12)', paddingBottom: 24 }}>
                        <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />

                        {loading ? (
                            <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 13 }}>Loading…</div>
                        ) : pendingCount === 0 ? (
                            <div style={{ textAlign: 'center', padding: '20px 20px', color: '#64748b' }}>
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: '#10b981' }}>
                                    <div style={{ width: 36, height: 36 }}>{ICONS.check}</div>
                                </div>
                                <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>All stops verified!</div>
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

                                {isNearStop
                                    ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#14b8a6', marginBottom: 12 }}><div style={{ width: 16, height: 16 }}>{ICONS.pin}</div><p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>You have arrived — ready to inspect!</p></div>
                                    : distToStop != null
                                        ? <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12, textAlign: 'center' }}>Walk {distToStop > 1000 ? `${(distToStop / 1000).toFixed(1)} km` : `${Math.round(distToStop)} m`} to reach this stop</p>
                                        : <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12, textAlign: 'center' }}>📡 Waiting for GPS signal…</p>
                                }

                                <button
                                    disabled={!isNearStop}
                                    onClick={() => setSelectedTask(nearestStop)}
                                    style={{
                                        width: '100%', maxWidth: 320, display: 'block', margin: '0 auto',
                                        padding: '18px', borderRadius: 30, border: 'none',
                                        fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
                                        transition: 'all .35s ease', cursor: isNearStop ? 'pointer' : 'not-allowed',
                                        background: isNearStop ? '#0f172a' : '#e2e8f0',
                                        color: isNearStop ? '#fff' : '#94a3b8',
                                        boxShadow: isNearStop ? '0 6px 20px rgba(15,23,42,.3)' : 'none',
                                    }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                        {isNearStop ? <><div style={{ width: 18, height: 18 }}>{ICONS.search}</div> Inspect Stop</> : 'Confirm on Arrival'}
                                    </div>
                                </button>
                            </div>
                        ) : null}
                    </div>
                )}
            </div >

            {/* INSPECTION OVERLAY — passes MultiPhotoPicker requirement down */}
            < PostCollectionOverlay
                visible={!!selectedTask
                }
                task={selectedTask}
                gpsPos={gpsPos}
                onComplete={() => { 
                    setCompletedTask(selectedTask);
                    setSelectedTask(null); 
                    loadStops() 
                }}
                onBack={() => setSelectedTask(null)}
                MultiPhotoPicker={MultiPhotoPicker}
            />

            <StopCompletedOverlay 
                task={completedTask} 
                onNext={() => setCompletedTask(null)} 
                totalStops={stops.length}
                pendingCount={pendingCount} 
                type="post" 
            />
        </>
    )
}