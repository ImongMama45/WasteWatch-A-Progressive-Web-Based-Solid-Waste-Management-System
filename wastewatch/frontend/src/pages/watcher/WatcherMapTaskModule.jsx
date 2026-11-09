/**
 * WatcherMapTaskModule.jsx — Unified Watcher map-based workflow
 *
 * Handles both PRE-INSPECTION and POST-COLLECTION verification.
 * Pass mode="pre" for Pre-Inspection, mode="post" for Confirm Collection.
 */

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronUp, ChevronDown, X, Camera, ArrowLeft } from 'lucide-react'
import CelebrationScreen from '../../components/CelebrationScreen'
import MapLayerToggle, { applyMapTileLayer } from '../../components/MapLayerToggle'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import {
    buildStopMarkerHtml,
    normalizeStopStatus,
    STOP_STATUS_COLORS,
    STOP_STATUS_LABELS,
    subscribePickupStatusSync,
} from '../../utils/pickupStatusSync'
import PreInspectionOverlay from './components/PreInspectionOverlay'
import PostCollectionOverlay from './components/PostCollectionOverlay'
import StopCompletedOverlay from './components/StopCompletedOverlay'
import GlobalCameraModal from '../../components/GlobalCameraModal'
import ReportForm from '../ReportForm'
import { ICONS } from '../../api/navConfig'
import MultiPhotoPicker from '../../components/MultiPhotoPicker'
import OfflineQueueBadge from '../../components/OfflineQueueBadge'
import { MapSkeleton, Skeleton, SkeletonText } from '../../components/ui/Skeleton'

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
    @keyframes vtmPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  `
    document.head.appendChild(style)
}

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

function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = d => d * Math.PI / 180
    const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180
    const toDeg = r => r * 180 / Math.PI
    const dLon = toRad(lon2 - lon1)
    const y = Math.sin(dLon) * Math.cos(toRad(lat2))
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
    return (toDeg(Math.atan2(y, x)) + 360) % 360
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const bearingToCompass = deg => deg != null ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : ''

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

function MapLegend({ isDrawerCollapsed = false }) {
    const items = [
        { color: 'transparent', border: '1.5px dotted #94a3b8', label: 'Pending Inspection' },
        { color: '#f59e0b', label: 'Ready for Collection' },
        { color: '#94a3b8', label: 'Empty Stop' },
        { color: '#eab308', label: 'Collection Reported' },
        { color: '#16a34a', label: 'Verified Collected' },
        { color: 'rgba(37, 99, 235, 0.18)', border: '2px dotted #2563eb', label: 'Watcher Spot' },
    ]
    return (
        <div style={{
            position: 'absolute', bottom: isDrawerCollapsed ? 48 : 210, right: 14, zIndex: 500,
            background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(6px)',
            borderRadius: 10, padding: '8px 10px',
            border: '1px solid rgba(0,0,0,0.1)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            display: 'flex', flexDirection: 'column', gap: 5,
            transition: 'bottom 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
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

function NoScheduleBanner({ barangayName, mode }) {
    const modeText = mode === 'pre' ? 'pre-collection inspections' : 'collections to confirm'
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
                    No Scheduled Tasks Today
                </div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, maxWidth: 280, margin: '0 auto 16px' }}>
                    {barangayName
                        ? `There are no ${modeText} for ${barangayName} today.`
                        : `There are no ${modeText} for your barangay today.`}
                    {' '}Check back on your next scheduled collection day.
                </div>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                    borderRadius: 20, padding: '6px 14px',
                }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>No tasks</span>
                </div>
            </div>
        </div>
    )
}

export default function WatcherMapTaskModule({ mode = 'pre' }) {
    const { user } = useAuth()
    const navigate = useNavigate()

    const TARGET_STATUS = mode === 'pre' ? 'PENDING_INSPECTION' : 'COLLECTION_REPORTED'

    const [gpsPos, setGpsPos] = useState(null)
    const [heading, setHeading] = useState(null)
    const [isMock, setIsMock] = useState(false)
    const [gpsError, setGpsError] = useState(null)
    const [gpsAccuracy, setGpsAccuracy] = useState(null)
    const [isTracking, setIsTracking] = useState(false)
    const gpsPosRef = useRef(null)
    const watchIdRef = useRef(null)
    const mockPosRef = useRef(null)
    const headingRef = useRef(null)

    const [leafletReady, setLeafletReady] = useState(false)
    const mapRef = useRef(null)
    const mapInstance = useRef(null)
    const baseTileLayerRef = useRef(null)
    const userMarkerRef = useRef(null)
    const stopMarkersRef = useRef(new Map())
    const watcherSpotMarkersRef = useRef(new Map())
    const routeLayerRef = useRef(null)
    const orsAbortRef = useRef(null)
    const lastFetchPosRef = useRef(null)
    const lastFetchStopRef = useRef(null)

    const [mapType, setMapType] = useState(() => localStorage.getItem('ww_map_type') || 'default')

    const toggleMapType = () => {
        setMapType(prev => {
            const next = prev === 'default' ? 'satellite' : 'default'
            localStorage.setItem('ww_map_type', next)
            return next
        })
    }

    const [stops, setStops] = useState([])
    const [allStops, setAllStops] = useState([])
    const [watcherSpots, setWatcherSpots] = useState([])
    const [loading, setLoading] = useState(true)
    const [hasScheduleToday, setHasScheduleToday] = useState(true)
    const [selectedTask, setSelectedTask] = useState(null)
    const [completedTask, setCompletedTask] = useState(null)
    const [orsRoute, setOrsRoute] = useState(null)
    const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(false)
    const [isNavBannerCollapsed, setIsNavBannerCollapsed] = useState(false)
    const [cameraOpen, setCameraOpen] = useState(false)
    const [reportFormOpen, setReportFormOpen] = useState(false)
    const [reportFormPhoto, setReportFormPhoto] = useState(null)

    useEffect(() => { injectStopMarkerStyles() }, [])
    useLayoutEffect(() => { gpsPosRef.current = gpsPos }, [gpsPos])

    useEffect(() => {
        if (!allStops.length) { setStops([]); return }
        const barangayId = user?.barangay
        const barangayName = user?.barangay_name?.toLowerCase()

        if (!barangayId && !barangayName) {
            setStops([])
            return
        }

        const filtered = allStops.filter(stop => {
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

    const nearestStop = (() => {
        const pending = stops.filter(s => normalizeStopStatus(s.current_status) === TARGET_STATUS && s.lat && s.lng)
        if (!gpsPos || pending.length === 0) return pending[0] || null
        return pending.reduce((best, s) => {
            const d = haversineDistance(gpsPos.lat, gpsPos.lng, s.lat, s.lng)
            const bd = haversineDistance(gpsPos.lat, gpsPos.lng, best.lat, best.lng)
            return d < bd ? s : best
        })
    })()

    const distToStop = gpsPos && nearestStop?.lat ? haversineDistance(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng) : null
    const isNearStop = distToStop != null && distToStop <= ARRIVAL_RADIUS_M
    const pendingCount = stops.filter(s => normalizeStopStatus(s.current_status) === TARGET_STATUS).length

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

    async function loadWatcherSpots() {
        try {
            const res = await api.get('/api/watcher/spots/', {
                params: {
                    status: 'all',
                }
            })
            const rows = res.data?.results ?? res.data ?? []
            // Include active and added_to_route (approved) spots, exclude rejected
            setWatcherSpots(rows.filter(s => s.status !== 'rejected'))
        } catch {
            setWatcherSpots([])
        }
    }

    useEffect(() => { loadStops() }, [])
    useEffect(() => { loadWatcherSpots() }, [user?.barangay])
    useEffect(() => subscribePickupStatusSync(() => { loadStops(); loadWatcherSpots() }), [user?.barangay])

    useEffect(() => {
        if (window.L) { setLeafletReady(true); return }
        const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
        document.head.appendChild(link)
        const s = Object.assign(document.createElement('script'), { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', onload: () => setLeafletReady(true) })
        document.head.appendChild(s)
    }, [])

    useEffect(() => {
        if (!navigator.geolocation) { setGpsError('GPS not available on this device.'); return }
        watchIdRef.current = navigator.geolocation.watchPosition(
            pos => {
                if (mockPosRef.current) return
                const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
                setGpsPos(p); setIsTracking(true); setGpsError(null)
                setGpsAccuracy(pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null)
                if (pos.coords.heading != null && !isNaN(pos.coords.heading)) {
                    setHeading(pos.coords.heading)
                    headingRef.current = pos.coords.heading
                }
            },
            err => { setGpsError(err.message); setIsTracking(false) },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        )

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

    useEffect(() => {
        if (!leafletReady || !mapRef.current || mapInstance.current) return
        const L = window.L
        const map = L.map(mapRef.current, { zoomControl: false, attributionControl: true })
            .setView(LUCENA_CENTER, 14)
        applyMapTileLayer(map, mapType, baseTileLayerRef)
        L.control.zoom({ position: 'topright' }).addTo(map)
        mapInstance.current = map
        setTimeout(() => map.invalidateSize(), 250)
    }, [leafletReady])

    useEffect(() => {
        if (!leafletReady || !mapInstance.current) return
        applyMapTileLayer(mapInstance.current, mapType, baseTileLayerRef)
    }, [mapType, leafletReady])

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

    useEffect(() => {
        const L = window.L
        if (!L || !mapInstance.current || stops.length === 0) return
        stopMarkersRef.current.forEach(m => m.remove())
        stopMarkersRef.current.clear()

        stops.forEach((stop, idx) => {
            if (!stop.lat || !stop.lng) return
            const status = normalizeStopStatus(stop.current_status)
            const isActive = nearestStop && stop.id === nearestStop.id && status === TARGET_STATUS
            const isWatcherStop = stop.label?.toLowerCase().includes('watcher spot') || stop.is_watcher_spot

            let html
            if (isWatcherStop) {
                const pulse = isActive ? `
                    <span style="position:absolute;inset:-6px;border-radius:50%;
                        border:2.5px dotted #2563eb;box-shadow:0 0 14px #2563eb;
                        animation:wwPulse 1.8s ease infinite;pointer-events:none;"></span>
                ` : ''
                html = `
                    <div style="position:relative;width:${isActive ? 34 : 28}px;height:${isActive ? 34 : 28}px;">
                        ${pulse}
                        <div style="
                            position:absolute;inset:0;background:${mapType === 'satellite' ? '#ffffff' : 'transparent'};border:2.5px dotted #2563eb;
                            border-radius:50%;display:flex;align-items:center;justify-content:center;
                            color:#1d4ed8;font-size:${isActive ? 13 : 11}px;font-weight:900;
                            font-family:system-ui,-apple-system,sans-serif;box-shadow:${mapType === 'satellite' ? '0 2px 10px rgba(0,0,0,0.55)' : '0 2px 10px rgba(37,99,235,0.4)'};
                        ">${stop.stop_order ?? idx + 1}</div>
                    </div>`
            } else {
                html = buildStopMarkerHtml(stop.stop_order ?? idx + 1, status, null, isActive, mapType === 'satellite')
            }

            const marker = L.marker([stop.lat, stop.lng], {
                icon: L.divIcon({ html, className: 'ww-stop-div-icon', iconSize: isActive ? [34, 34] : [28, 28], iconAnchor: isActive ? [17, 17] : [14, 14] }),
                zIndexOffset: isActive ? 100 : (isWatcherStop ? 85 : 0),
            }).addTo(mapInstance.current)
                .bindPopup(`<b>${stop.label}</b><br/><span style="font-size:11px;font-weight:700;color:${isWatcherStop ? '#2563eb' : (STOP_STATUS_COLORS[status]?.bg || '#94a3b8')}">${isWatcherStop ? 'Approved Watcher Spot (In Route)' : (STOP_STATUS_LABELS[status] || status)}</span>`)
            marker.on('click', () => { if (status === TARGET_STATUS) setSelectedTask(stop) })
            stopMarkersRef.current.set(stop.id, marker)
        })
    }, [stops, leafletReady, nearestStop, TARGET_STATUS, mapType])

    useEffect(() => {
        const L = window.L
        if (!L || !mapInstance.current) return
        watcherSpotMarkersRef.current.forEach(m => m.remove())
        watcherSpotMarkersRef.current.clear()

        watcherSpots.forEach(spot => {
            if (!spot.latitude || !spot.longitude) return
            const isAddedToRoute = spot.status === 'added_to_route'
            const isAlreadyStop = stops.some(s => Math.abs(Number(s.lat) - Number(spot.latitude)) < 0.0001 && Math.abs(Number(s.lng) - Number(spot.longitude)) < 0.0001)
            // If already shown on route as a stop, avoid redundant second marker
            if (isAlreadyStop) return

            const count = spot.report_count || 1
            const spotHtml = `
                <div style="position:relative;width:32px;height:32px;">
                    <span style="position:absolute;inset:-5px;border-radius:50%;border:2px dotted #2563eb;animation:wwMarkerPulse 2s ease infinite;pointer-events:none;"></span>
                    <div style="position:absolute;inset:0;border:2.5px dotted #2563eb;border-radius:50%;box-sizing:border-box;background:${mapType === 'satellite' ? '#ffffff' : (isAddedToRoute ? 'rgba(37,99,235,0.28)' : 'rgba(37,99,235,0.18)')};backdrop-filter:blur(2px);box-shadow:${mapType === 'satellite' ? '0 2px 10px rgba(0,0,0,0.55)' : '0 0 12px rgba(37,99,235,0.45)'};display:flex;align-items:center;justify-content:center;color:#1d4ed8;font-size:11px;font-weight:900;cursor:pointer;">
                        W${count}
                    </div>
                </div>
            `
            const marker = L.marker([Number(spot.latitude), Number(spot.longitude)], {
                icon: L.divIcon({ html: spotHtml, className: 'ww-stop-div-icon', iconSize: [32, 32], iconAnchor: [16, 16] }),
                zIndexOffset: isAddedToRoute ? 80 : 70,
            }).addTo(mapInstance.current)

            const myCount = spot.my_report_count || 0
            const issueType = spot.latest_report?.issue_type || 'Watcher Spot'
            marker.bindPopup(`
                <div style="font-size:12px;font-family:sans-serif;min-width:160px;padding:3px;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                        <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#2563eb;"></span>
                        <div style="color:#1d4ed8;font-weight:900;font-size:13px;">${isAddedToRoute ? 'Approved Watcher Spot' : 'Watcher Reported Spot'}</div>
                    </div>
                    <div style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:800;margin-bottom:4px;background:${isAddedToRoute ? 'rgba(22,163,74,0.12)' : 'rgba(37,99,235,0.12)'};color:${isAddedToRoute ? '#16a34a' : '#2563eb'};border:1px solid ${isAddedToRoute ? 'rgba(22,163,74,0.3)' : 'rgba(37,99,235,0.3)'};">
                        ${isAddedToRoute ? '✓ Approved in Route' : 'Pending Route Addition'}
                    </div>
                    <div style="color:#0f172a;font-weight:700;font-size:12px;">Reported ${count} time(s)${myCount > 0 ? ` (${myCount} by you)` : ''}</div>
                    <div style="color:#64748b;font-size:11px;margin-top:2px;text-transform:capitalize;">Type: <b>${issueType}</b></div>
                </div>
            `)
            watcherSpotMarkersRef.current.set(spot.id, marker)
        })

        return () => {
            watcherSpotMarkersRef.current.forEach(m => m.remove())
            watcherSpotMarkersRef.current.clear()
        }
    }, [watcherSpots, stops, leafletReady, mapType])

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
            mapInstance.current.panTo([gpsPos.lat, gpsPos.lng])
        }
    }, [gpsPos, heading, leafletReady])

    useEffect(() => {
        const L = window.L
        if (!gpsPos || !nearestStop?.lat || !nearestStop?.lng) {
            if (routeLayerRef.current && mapInstance.current) {
                try { mapInstance.current.removeLayer(routeLayerRef.current) } catch { }
            }
            routeLayerRef.current = null
            setOrsRoute(null)
            return
        }

        if (orsAbortRef.current) orsAbortRef.current.abort()
        const ctrl = new AbortController()
        orsAbortRef.current = ctrl

        if (L && mapInstance.current) {
            if (routeLayerRef.current) {
                try { mapInstance.current.removeLayer(routeLayerRef.current) } catch { }
            }
            routeLayerRef.current = L.polyline(
                [[gpsPos.lat, gpsPos.lng], [nearestStop.lat, nearestStop.lng]],
                { color: '#14b8a6', weight: 3, opacity: 0.5, dashArray: '8,6' }
            ).addTo(mapInstance.current)
        }
        setOrsRoute([[gpsPos.lat, gpsPos.lng], [nearestStop.lat, nearestStop.lng]])

        if (lastFetchPosRef.current && lastFetchStopRef.current === nearestStop.id) {
            const moved = haversineDistance(
                lastFetchPosRef.current.lat, lastFetchPosRef.current.lng,
                gpsPos.lat, gpsPos.lng,
            )
            if (moved < 30) return
        }

        if (!ORS_KEY) return

        lastFetchPosRef.current = { lat: gpsPos.lat, lng: gpsPos.lng }
        lastFetchStopRef.current = nearestStop.id

        fetch(
            `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${ORS_KEY}&start=${gpsPos.lng},${gpsPos.lat}&end=${nearestStop.lng},${nearestStop.lat}`,
            { signal: ctrl.signal }
        )
            .then(r => {
                if (!r.ok) throw new Error(`ORS ${r.status}`)
                return r.json()
            })
            .then(data => {
                const coords = data?.features?.[0]?.geometry?.coordinates
                if (!coords) return
                const pts = coords.map(([lng, lat]) => [lat, lng])
                setOrsRoute(pts)
                if (L && mapInstance.current) {
                    if (routeLayerRef.current) {
                        try { mapInstance.current.removeLayer(routeLayerRef.current) } catch { }
                    }
                    routeLayerRef.current = L.polyline(pts, {
                        color: '#14b8a6', weight: 4, opacity: 0.85,
                    }).addTo(mapInstance.current)
                }
            })
            .catch(err => {
                if (err.name === 'AbortError') return
            })

        return () => { ctrl.abort() }
    }, [gpsPos?.lat, gpsPos?.lng, nearestStop?.id, leafletReady])

    useEffect(() => {
        const L = window.L
        if (!L || !mapInstance.current || !gpsPos || !orsRoute || orsRoute.length < 2) return
        if (routeLayerRef.current) {
            try {
                routeLayerRef.current.setLatLngs([[gpsPos.lat, gpsPos.lng], ...orsRoute.slice(1)])
            } catch { }
        }
    }, [gpsPos?.lat, gpsPos?.lng])

    function teleportTo(stop) {
        if (!stop?.lat || !stop?.lng) return
        const p = { lat: stop.lat + (Math.random() * 0.00005 - 0.000025), lng: stop.lng + (Math.random() * 0.00005 - 0.000025) }
        mockPosRef.current = p
        setGpsPos(p); setIsMock(true); setIsTracking(true)
        mapInstance.current?.flyTo([p.lat, p.lng], 18, { animate: true, duration: 1 })
    }
    function clearMock() { mockPosRef.current = null; setIsMock(false); setGpsPos(null); setIsTracking(false) }

    const showCelebration = !loading && hasScheduleToday && stops.length > 0 && pendingCount === 0;

    useEffect(() => {
        if (showCelebration) {
            if (mapInstance.current) {
                mapInstance.current.remove()
                mapInstance.current = null
            }
        }
    }, [showCelebration])

    const pendingStops = stops.filter(s => normalizeStopStatus(s.current_status) === TARGET_STATUS)

    const activeFocus = selectedTask || nearestStop
    const nearbyWatcherSpots = (activeFocus || gpsPos)
        ? watcherSpots.filter(ws => {
            const refLat = activeFocus?.lat ?? gpsPos?.lat
            const refLng = activeFocus?.lng ?? gpsPos?.lng
            if (!refLat || !refLng || !ws.latitude || !ws.longitude) return false
            return haversineDistance(Number(refLat), Number(refLng), Number(ws.latitude), Number(ws.longitude)) <= 150
        })
        : []

    const activeBarangayId = user?.barangay || stops[0]?.barangay_id
    const activeBarangayName = user?.barangay_name?.toLowerCase() || stops[0]?.barangay_names?.toLowerCase()

    const areaWatcherSpots = watcherSpots.filter(ws => {
        if (!activeBarangayId && !activeBarangayName) return true
        const wsBrgyId = ws.barangay ?? ws.barangay_id
        if (activeBarangayId && wsBrgyId && String(wsBrgyId) === String(activeBarangayId)) return true
        if (activeBarangayName && ws.barangay_name) {
            const n1 = activeBarangayName.trim()
            const n2 = ws.barangay_name.toLowerCase().trim()
            if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) return true
        }
        if (stops.some(s => Math.abs(Number(s.lat) - Number(ws.latitude)) < 0.0001 && Math.abs(Number(s.lng) - Number(ws.longitude)) < 0.0001)) {
            return true
        }
        return false
    })

    if (showCelebration) {
        return (
            <CelebrationScreen
                title={`Great job, ${user?.full_name?.split(' ')[0] || 'Watcher'}!`}
                subtitle={mode === 'pre' ? "You've completed all pre-collection inspections for today." : "You've completed all collection confirmations for today."}
                stats={[
                    { icon: ICONS.pin, label: mode === 'pre' ? 'Inspections Done' : 'Collections Confirmed', value: `${stops.length} / ${stops.length}` },
                    { icon: ICONS.check, label: 'Completion', value: '100%' },
                    { icon: ICONS.schedule, label: 'Date', value: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                ]}
                onDone={() => navigate('/dashboard')}
            />
        )
    }

    return (
        <>
            <div style={{ height: '100vh', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#e8f0e8' }}>
                <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
                {!leafletReady && (
                    <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
                        <MapSkeleton height="100%" dark={false} label="Loading stop inspection map..." showControls={false} />
                    </div>
                )}
                {leafletReady && <MapLegend isDrawerCollapsed={isDrawerCollapsed} />}
                {leafletReady && (
                    <MapLayerToggle
                        mapType={mapType}
                        onToggle={toggleMapType}
                        style={{
                            position: 'absolute',
                            bottom: isDrawerCollapsed ? 48 : 220,
                            left: 14,
                            zIndex: 500,
                        }}
                    />
                )}

                {import.meta.env.DEV && (
                    <div style={{ position: 'absolute', top: '50%', right: 14, marginTop: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <button onClick={() => {
                            mapInstance.current?.setView([gpsPos.lat, gpsPos.lng], 16)
                        }} title="Re-center on GPS"
                            style={{ width: 44, height: 44, borderRadius: '50%', background: '#3b82f6', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', color: '#fff' }}>
                            <div style={{ width: 20, height: 20 }}>{ICONS.route || ICONS.map}</div>
                        </button>
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
                                style={{ width: 44, height: 44, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', color: '#fff' }}>
                                <X size={18} strokeWidth={2.5} />
                            </button>
                        )}
                    </div>
                )}
            </div>

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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                            type="button"
                            onClick={() => navigate('/dashboard')}
                            title="Back to Dashboard"
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                background: 'rgba(255,255,255,0.12)',
                                border: 'none',
                                color: '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                flexShrink: 0
                            }}
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900, letterSpacing: '.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
                                {mode === 'pre' ? 'Pre-Inspection' : 'Confirm Collection'}
                                <OfflineQueueBadge />
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 14, height: 14 }}>{ICONS.pin}</div> {user?.barangay_name || 'No barangay assigned'} ·{' '}
                                {loading ? 'Loading…' : `${pendingCount} pending`}
                            </div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#14b8a6' }}>{pendingCount}</div>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', fontWeight: 700, letterSpacing: '.06em' }}>PENDING</div>
                    </div>
                </div>
            </div>

                {!loading && hasScheduleToday && nearestStop && gpsPos && haversineDistance(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng) > 30 && (
                    <div
                        onClick={() => setIsNavBannerCollapsed(prev => !prev)}
                        title="Tap to toggle navigation banner"
                        style={{
                            position: 'absolute',
                            top: 90,
                            left: 14,
                            right: 14,
                            zIndex: 10,
                            background: 'rgba(15,23,42,0.92)',
                            backdropFilter: 'blur(12px)',
                            borderRadius: isNavBannerCollapsed ? 12 : 18,
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            padding: isNavBannerCollapsed ? '8px 14px' : '12px 14px',
                            boxShadow: '0 8px 30px rgba(0,0,0,.32)',
                            transition: 'all .35s cubic-bezier(0.3, 0.8, 0.3, 1)',
                            gap: 12,
                            cursor: 'pointer',
                            userSelect: 'none',
                        }}
                    >
                        <div style={{
                            width: isNavBannerCollapsed ? 32 : 46,
                            height: isNavBannerCollapsed ? 32 : 46,
                            flexShrink: 0,
                            background: 'rgba(255,255,255,0.12)',
                            borderRadius: isNavBannerCollapsed ? 8 : 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ffffff',
                            transition: 'all .25s ease',
                        }}>
                            <svg
                                viewBox="0 0 24 24"
                                width={isNavBannerCollapsed ? 18 : 28}
                                height={isNavBannerCollapsed ? 18 : 28}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{
                                    transform: `rotate(${calculateBearing(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng) - (heading || 0)}deg)`,
                                    transition: 'transform 0.3s ease',
                                }}
                            >
                                <path d="M12 19V5M5 12l7-7 7 7" />
                            </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontFamily: 'var(--font-head)',
                                fontSize: isNavBannerCollapsed ? 14 : 17,
                                fontWeight: 900,
                                color: '#ffffff',
                                lineHeight: 1.15,
                                letterSpacing: '-0.01em',
                                marginBottom: isNavBannerCollapsed ? 0 : 3,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}>
                                Head {bearingToCompass(calculateBearing(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng)).toLowerCase()} on {nearestStop.label || nearestStop.address || nearestStop.name || 'next stop'}
                            </div>
                            {!isNavBannerCollapsed && (
                                <div style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: '#34d399',
                                    lineHeight: 1.25,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                }}>
                                    {haversineDistance(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng) > 1000
                                        ? `${(haversineDistance(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng) / 1000).toFixed(1)} km to stop`
                                        : `${Math.round(haversineDistance(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng))} m to stop`}
                                </div>
                            )}
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
                            {isNavBannerCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                        </div>
                    </div>
                )}

                {!loading && !hasScheduleToday ? (
                    <NoScheduleBanner barangayName={user?.barangay_name} mode={mode} />
                ) : (
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
                        paddingBottom: isDrawerCollapsed ? 'env(safe-area-inset-bottom, 12px)' : 24,
                        transition: 'all 0.3s cubic-bezier(0.3, 0.8, 0.3, 1)',
                    }}>
                        {/* Retractable Handle Bar (Click to toggle) */}
                        <div
                            onClick={() => setIsDrawerCollapsed(prev => !prev)}
                            style={{
                                height: 38,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                userSelect: 'none',
                                padding: '4px 16px 2px',
                            }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, marginBottom: 2 }} />
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {isDrawerCollapsed ? (
                                        <>
                                            <ChevronUp size={13} />
                                            <span>{isNearStop ? `Arrived · Tap to view details` : "Tap to view stop details"}</span>
                                        </>
                                    ) : (
                                        <>
                                            <ChevronDown size={13} />
                                            <span>Tap to collapse stats</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {loading ? (
                            <div style={{ padding: '6px 20px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <Skeleton width="55%" height={16} />
                                <SkeletonText lines={2} />
                                <Skeleton width="100%" height={42} radius={10} />
                            </div>
                        ) : pendingCount === 0 ? (
                            <div style={{ textAlign: 'center', padding: '16px 20px 8px', color: '#64748b' }}>
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: '#10b981' }}>
                                    <div style={{ width: 36, height: 36 }}>{ICONS.check}</div>
                                </div>
                                <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>All stops verified!</div>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>No pending tasks remaining today.</div>
                                <button
                                    type="button"
                                    onClick={() => setCameraOpen(true)}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 8,
                                        padding: '10px 18px', borderRadius: 20,
                                        background: '#2563eb', color: '#fff', border: 'none',
                                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                                        boxShadow: '0 4px 12px rgba(37,99,235,0.3)',
                                    }}
                                >
                                    <Camera size={16} /> Report Watcher Spot
                                </button>
                            </div>
                        ) : nearestStop ? (
                            <div style={{ padding: '4px 20px 0' }}>
                                {!isDrawerCollapsed && (
                                    <>
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
                                            ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#14b8a6', marginBottom: 12 }}><div style={{ width: 16, height: 16 }}>{ICONS.pin}</div><p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>You have arrived — ready to {mode === 'pre' ? 'inspect' : 'confirm'}!</p></div>
                                            : distToStop != null
                                                ? <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12, textAlign: 'center' }}>Walk {distToStop > 1000 ? `${(distToStop / 1000).toFixed(1)} km` : `${Math.round(distToStop)} m`} to reach this stop</p>
                                                : <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12, textAlign: 'center' }}>Waiting for GPS signal…</p>
                                        }
                                    </>
                                )}

                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 360, margin: isDrawerCollapsed ? '4px auto 8px' : '0 auto' }}>
                                    {/* Dedicated Watcher Spot Camera Button */}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setCameraOpen(true)
                                        }}
                                        title="Report Watcher Spot (Open Camera)"
                                        style={{
                                            width: 52,
                                            height: 52,
                                            borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                                            color: '#ffffff',
                                            border: '2.5px solid #ffffff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            boxShadow: '0 4px 16px rgba(37,99,235,0.45)',
                                            cursor: 'pointer',
                                            flexShrink: 0,
                                            transition: 'transform 0.15s, box-shadow 0.15s',
                                        }}
                                        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.92)'}
                                        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                        <Camera size={24} strokeWidth={2.4} />
                                    </button>

                                    {/* Main Inspect / Confirm Action */}
                                    <button
                                        disabled={!isNearStop}
                                        onClick={() => setSelectedTask(nearestStop)}
                                        style={{
                                            flex: 1,
                                            padding: isDrawerCollapsed ? '13px 18px' : '17px', borderRadius: 30, border: 'none',
                                            fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, letterSpacing: '.04em',
                                            transition: 'all .35s ease', cursor: isNearStop ? 'pointer' : 'not-allowed',
                                            background: isNearStop ? (mode === 'pre' ? '#0f172a' : '#16a34a') : '#e2e8f0',
                                            color: isNearStop ? '#fff' : '#94a3b8',
                                            boxShadow: isNearStop ? (mode === 'pre' ? '0 6px 20px rgba(15,23,42,.3)' : '0 6px 20px rgba(22,163,74,.3)') : 'none',
                                        }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                            {isNearStop ? <><div style={{ width: 18, height: 18 }}>{ICONS.search}</div> {mode === 'pre' ? 'Inspect Stop' : 'Confirm Collection'}</> : (mode === 'pre' ? 'Inspect on Arrival' : 'Confirm on Arrival')}
                                        </div>
                                    </button>
                                </div>

                                {/* Dedicated section: Watcher Reported Spots in Area (matches RouteBuilder) */}
                                {!isDrawerCollapsed && (
                                    <div style={{
                                        marginTop: 16,
                                        padding: '10px 14px',
                                        background: 'rgba(37, 99, 235, 0.04)',
                                    borderRadius: 12,
                                    border: '1.5px solid rgba(37, 99, 235, 0.22)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px dotted #2563eb', background: 'rgba(37, 99, 235, 0.2)' }} />
                                            <span style={{ fontSize: 11, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                                Watcher Reported Spots in Area
                                            </span>
                                        </div>
                                        <span style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', background: 'rgba(37, 99, 235, 0.1)', padding: '2px 8px', borderRadius: 10 }}>
                                            {areaWatcherSpots.length}
                                        </span>
                                    </div>

                                    {areaWatcherSpots.length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
                                            {areaWatcherSpots.map(ws => {
                                                const isApproved = ws.status === 'added_to_route' || stops.some(s => Math.abs(Number(s.lat) - Number(ws.latitude)) < 0.0001 && Math.abs(Number(s.lng) - Number(ws.longitude)) < 0.0001);
                                                const d = gpsPos ? haversineDistance(gpsPos.lat, gpsPos.lng, Number(ws.latitude), Number(ws.longitude)) : null;
                                                return (
                                                    <div
                                                        key={ws.id}
                                                        onClick={() => {
                                                            if (mapInstance.current) {
                                                                mapInstance.current.flyTo([Number(ws.latitude), Number(ws.longitude)], 17);
                                                            }
                                                        }}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                            padding: '7px 10px', background: '#ffffff', borderRadius: 8,
                                                            border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'border-color .15s'
                                                        }}
                                                        onMouseEnter={e => e.currentTarget.style.borderColor = '#2563eb'}
                                                        onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                                                    >
                                                        <div style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <span>Watcher Spot ({ws.report_count || 1} reps)</span>
                                                                {ws.latest_report?.issue_type && (
                                                                    <span style={{ fontSize: 9, fontWeight: 700, color: '#2563eb', background: 'rgba(37, 99, 235, 0.08)', padding: '1px 5px', borderRadius: 4, textTransform: 'capitalize' }}>
                                                                        {ws.latest_report.issue_type}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                                                <span>{ws.barangay_name || 'Lucena City'}</span>
                                                                {d != null && <span>· {d > 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`} away</span>}
                                                            </div>
                                                        </div>

                                                        <span style={{
                                                            fontSize: 9, fontWeight: 800,
                                                            padding: '2px 7px', borderRadius: 6,
                                                            background: isApproved ? 'rgba(22, 163, 74, 0.1)' : 'rgba(37, 99, 235, 0.1)',
                                                            color: isApproved ? '#16a34a' : '#2563eb',
                                                            border: `1px solid ${isApproved ? 'rgba(22, 163, 74, 0.3)' : 'rgba(37, 99, 235, 0.3)'}`,
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {isApproved ? 'Approved in Route' : 'Reported Spot'}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div style={{ padding: '6px 4px', textAlign: 'center', color: '#64748b', fontSize: 11 }}>
                                            No Watcher reported spots for this area yet.
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                )}
            </div >

            {/* Global Camera Overlay for Watcher Spot Reporting */}
            <GlobalCameraModal
                visible={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={(capturedData) => {
                    setCameraOpen(false)
                    const isArray = Array.isArray(capturedData)
                    const blob = isArray ? capturedData[0] : capturedData
                    const previewUrl = URL.createObjectURL(blob)
                    setReportFormPhoto({ blob, url: previewUrl })
                    setReportFormOpen(true)
                }}
            />

            {/* Unified Report Form in Watcher Mode */}
            <ReportForm
                isOpen={reportFormOpen}
                initialPhoto={reportFormPhoto}
                isWatcherSpot={true}
                onClose={() => {
                    setReportFormOpen(false)
                    setReportFormPhoto(null)
                }}
                onSuccess={() => {
                    setReportFormOpen(false)
                    setReportFormPhoto(null)
                    loadWatcherSpots()
                    loadStops()
                }}
            />

            {mode === 'pre' ? (
                <PreInspectionOverlay
                    visible={!!selectedTask}
                    task={selectedTask}
                    gpsPos={gpsPos}
                    nearbyWatcherSpots={nearbyWatcherSpots}
                    mapType={mapType}
                    onToggleMapType={toggleMapType}
                    onComplete={() => {
                        setCompletedTask(selectedTask);
                        setSelectedTask(null);
                        loadStops();
                        loadWatcherSpots();
                    }}
                    onBack={() => setSelectedTask(null)}
                    MultiPhotoPicker={MultiPhotoPicker}
                />
            ) : (
                <PostCollectionOverlay
                    visible={!!selectedTask}
                    task={selectedTask}
                    gpsPos={gpsPos}
                    nearbyWatcherSpots={nearbyWatcherSpots}
                    mapType={mapType}
                    onToggleMapType={toggleMapType}
                    onComplete={() => {
                        setCompletedTask(selectedTask);
                        setSelectedTask(null);
                        loadStops();
                        loadWatcherSpots();
                    }}
                    onBack={() => setSelectedTask(null)}
                    MultiPhotoPicker={MultiPhotoPicker}
                />
            )}

            <StopCompletedOverlay
                task={completedTask}
                onNext={() => setCompletedTask(null)}
                totalStops={stops.length}
                pendingCount={pendingCount}
                type={mode}
            />
        </>
    )
}
