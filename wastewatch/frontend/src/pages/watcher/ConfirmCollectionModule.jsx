/**
 * pages/watcher/ConfirmCollectionModule.jsx
 * -------------------------------------------
 * Map-based POST-COLLECTION verification workflow.
 * Mirrors VerificationTasksModule architecture:
 *   - Fullscreen Leaflet dark map
 *   - GPS proximity guard (VERIFICATION_RADIUS_M = 50m)
 *   - ORS polyline to nearest COLLECTION_REPORTED stop
 *   - Bottom sheet panel with arrive & verify CTA
 *   - PostCollectionOverlay slides up for form submission
 *   - Dev teleport tools in DEV mode
 *
 * Target stop status: COLLECTION_REPORTED
 * Output status: VERIFIED_COLLECTED | COLLECTION_DISPUTED
 */

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
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

const VERIFICATION_RADIUS_M = 50
const LUCENA_CENTER = [13.9373, 121.617]
const ORS_KEY = import.meta.env.VITE_ORS_API_KEY || ''

// ─── INJECT MARKER STYLES ─────────────────────────────────────────────────────
function injectMarkerStyles() {
    if (document.getElementById('ww-ccm-styles')) return
    const style = document.createElement('style')
    style.id = 'ww-ccm-styles'
    style.textContent = `
    @keyframes ccmPulse  { 0%,100%{opacity:1} 50%{opacity:.3} }
    @keyframes ccmSlideUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
    @keyframes ccmBounce  { 0%{transform:scale(.85);opacity:0} 60%{transform:scale(1.06)} 100%{transform:scale(1);opacity:1} }
    .ww-stop-div-icon { background:transparent!important;border:0!important;box-shadow:none!important; }
    .ccm-overlay-card { animation: ccmSlideUp .22s ease both; }
  `
    document.head.appendChild(style)
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = d => d * Math.PI / 180
    const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── STATUS PILLS ─────────────────────────────────────────────────────────────
function GpsStatusPill({ isTracking, error, accuracy }) {
    const isPoor = accuracy != null && accuracy >= 50
    const label = error ? 'GPS Lost'
        : !isTracking ? 'Acquiring GPS…'
            : accuracy != null ? `GPS ±${Math.round(accuracy)}m` : 'GPS Active'
    const color = error ? '#ef4444' : isPoor ? '#f59e0b' : isTracking ? '#2ecc71' : '#f59e0b'
    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 20, padding: '3px 10px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', animation: isTracking && !error ? 'ccmPulse 2s ease infinite' : 'none' }} />
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

// ─── MAP LEGEND ───────────────────────────────────────────────────────────────
function MapLegend() {
    const items = [
        { color: '#eab308', label: 'Collection Reported — needs your verification' },
        { color: '#16a34a', label: 'Verified Collected' },
        { color: '#ef4444', label: 'Disputed' },
        { color: 'transparent', border: '1.5px dashed rgba(148,163,184,.9)', label: 'Other / Pending' },
    ]
    return (
        <div style={{ position: 'absolute', bottom: 210, right: 14, zIndex: 500, background: 'rgba(15,23,42,.88)', backdropFilter: 'blur(6px)', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {items.map(({ color, border, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, border: border || 'none', flexShrink: 0 }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.8)', letterSpacing: '.04em' }}>{label.toUpperCase()}</span>
                </div>
            ))}
        </div>
    )
}

// ─── POST-COLLECTION OVERLAY ──────────────────────────────────────────────────
function PostCollectionOverlay({ visible, task, gpsPos, onComplete, onBack }) {
    const [outcome, setOutcome] = useState('')
    const [notes, setNotes] = useState('')
    const [photo, setPhoto] = useState(null)
    const [preview, setPreview] = useState(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')

    // Reset form when task changes
    useEffect(() => {
        if (visible) { setOutcome(''); setNotes(''); setPhoto(null); setPreview(null); setError('') }
    }, [visible, task?.id])

    function handlePhoto(e) {
        const file = e.target.files?.[0]
        if (!file) return
        setPhoto(file)
        const reader = new FileReader()
        reader.onload = ev => setPreview(ev.target.result)
        reader.readAsDataURL(file)
    }

    async function handleSubmit() {
        if (!outcome) { setError('Please select a verification outcome.'); return }
        if (outcome === 'failed' && !notes.trim()) { setError('Please describe why collection failed.'); return }
        if (!gpsPos) { setError('GPS location required. Please wait for a fix.'); return }

        setSubmitting(true); setError('')
        try {
            const form = new FormData()
            form.append('schedule_id', task.schedule_id)
            form.append('stop_order', task.stop_order)
            form.append('lat', gpsPos.lat)
            form.append('lng', gpsPos.lng)
            form.append('outcome', outcome)
            form.append('dispute_reason', notes.trim())
            if (photo) form.append('photo', photo)
            await api.post('/api/watcher/stop-validations/post-verify/', form)
            broadcastPickupStatusSync()
            onComplete()
        } catch (err) {
            setError(err.response?.data?.error || 'Submission failed. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    if (!visible) return null

    const driverName = task?.driver_name || 'Unknown driver'
    const truckPlate = task?.truck_plate || '—'
    const stopLabel = task?.label || `Stop ${task?.stop_order}`
    const reportedAt = task?.collection_timestamp
        ? new Date(task.collection_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—'

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(15,23,42,.65)', backdropFilter: 'blur(4px)',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        }}>
            <div className="ccm-overlay-card" style={{
                background: '#fff', borderRadius: '22px 22px 0 0',
                boxShadow: '0 -6px 40px rgba(0,0,0,.25)',
                maxHeight: '88vh', overflowY: 'auto',
            }}>
                {/* Handle */}
                <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '14px auto 0' }} />

                {/* Header */}
                <div style={{
                    background: 'linear-gradient(160deg, #0f172a 60%, #14532d)',
                    padding: '20px 20px 18px', color: '#fff',
                    marginTop: 12,
                }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.45)', letterSpacing: '.1em', marginBottom: 4 }}>POST-COLLECTION VERIFICATION</div>
                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900, marginBottom: 2 }}>{stopLabel}</div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.55)' }}>🚛 {driverName}</span>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.55)' }}>🔖 {truckPlate}</span>
                        <span style={{ fontSize: 12, color: '#eab308', fontWeight: 700 }}>Reported {reportedAt}</span>
                    </div>
                </div>

                <div style={{ padding: '18px 20px' }}>

                    {/* GPS indicator */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '9px 12px', borderRadius: 10, marginBottom: 16,
                        background: gpsPos ? 'rgba(22,163,74,0.06)' : 'rgba(245,158,11,0.06)',
                        border: `1px solid ${gpsPos ? 'rgba(22,163,74,0.25)' : 'rgba(245,158,11,0.3)'}`,
                    }}>
                        <span style={{ fontSize: 14 }}>{gpsPos ? '📍' : '📡'}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: gpsPos ? '#16a34a' : '#f59e0b' }}>
                            {gpsPos
                                ? `GPS verified · ${gpsPos.lat.toFixed(4)}, ${gpsPos.lng.toFixed(4)}`
                                : 'Waiting for GPS fix…'}
                        </span>
                    </div>

                    {/* Outcome buttons */}
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', marginBottom: 8 }}>
                        VERIFICATION OUTCOME *
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        {[
                            { key: 'success', label: '✅ Collected Successfully', color: '#16a34a' },
                            { key: 'failed', label: '❌ Collection Failed', color: '#ef4444' },
                        ].map(opt => (
                            <button
                                key={opt.key}
                                onClick={() => setOutcome(opt.key)}
                                style={{
                                    flex: 1, padding: '12px 8px', borderRadius: 10, border: `1.5px solid`,
                                    borderColor: outcome === opt.key ? opt.color : '#e2e8f0',
                                    background: outcome === opt.key ? `${opt.color}10` : '#fff',
                                    color: outcome === opt.key ? opt.color : '#475569',
                                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                    transition: 'all .15s',
                                }}
                            >{opt.label}</button>
                        ))}
                    </div>

                    {/* Notes */}
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', display: 'block', marginBottom: 7 }}>
                            {outcome === 'failed' ? 'REASON FOR DISPUTE *' : 'NOTES (OPTIONAL)'}
                        </label>
                        <textarea
                            className="form-input"
                            rows={3}
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder={outcome === 'failed' ? 'Describe why collection failed or was incomplete…' : 'Any additional observations…'}
                            style={{ resize: 'vertical' }}
                        />
                    </div>

                    {/* Photo upload */}
                    <div style={{ marginBottom: 20 }}>
                        <label style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', display: 'block', marginBottom: 7 }}>
                            VERIFICATION PHOTO (RECOMMENDED)
                        </label>
                        {preview ? (
                            <div style={{ position: 'relative' }}>
                                <img src={preview} alt="Preview" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
                                <button
                                    onClick={() => { setPhoto(null); setPreview(null) }}
                                    style={{
                                        position: 'absolute', top: 8, right: 8,
                                        background: 'rgba(15,23,42,.7)', color: '#fff', border: 'none',
                                        borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                                    }}
                                >×</button>
                            </div>
                        ) : (
                            <button
                                onClick={() => document.getElementById('ccm-photo-input').click()}
                                style={{
                                    width: '100%', padding: '14px', borderRadius: 10,
                                    border: '2px dashed #cbd5e1', background: '#fafafa',
                                    display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                                }}
                            >
                                <span style={{ fontSize: 22 }}>📷</span>
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Take or upload a photo</div>
                                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Shows condition of stop after collection</div>
                                </div>
                            </button>
                        )}
                        <input id="ccm-photo-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />
                    </div>

                    {/* Error */}
                    {error && (
                        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#ef4444', marginBottom: 14 }}>
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button
                            className="btn btn-outline"
                            style={{ flex: 1 }}
                            onClick={onBack}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !outcome || !gpsPos}
                            style={{
                                flex: 2, padding: '14px', borderRadius: 12, border: 'none',
                                background: submitting || !outcome || !gpsPos ? '#e2e8f0' : '#0f172a',
                                color: submitting || !outcome || !gpsPos ? '#94a3b8' : '#fff',
                                fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 900,
                                cursor: submitting || !outcome || !gpsPos ? 'not-allowed' : 'pointer',
                                boxShadow: submitting || !outcome || !gpsPos ? 'none' : '0 4px 16px rgba(15,23,42,.25)',
                                transition: 'all .2s',
                            }}
                        >
                            {submitting ? 'Submitting…' : !gpsPos ? '📡 Awaiting GPS…' : '✓ Submit Verification'}
                        </button>
                    </div>

                    <div style={{ height: 20 }} /> {/* bottom safe area */}
                </div>
            </div>
        </div>
    )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function ConfirmCollectionModule() {
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

    // ── Sync GPS ref ──
    useLayoutEffect(() => { gpsPosRef.current = gpsPos }, [gpsPos])

    useEffect(() => { injectMarkerStyles() }, [])

    // ── Derived: nearest COLLECTION_REPORTED stop ──
    const reportedStops = stops.filter(s =>
        normalizeStopStatus(s.current_status) === 'COLLECTION_REPORTED' && s.lat && s.lng
    )

    const nearestStop = (() => {
        if (reportedStops.length === 0) return null
        if (!gpsPos) return reportedStops[0]
        return reportedStops.reduce((best, s) => {
            const d = haversineDistance(gpsPos.lat, gpsPos.lng, s.lat, s.lng)
            const bd = haversineDistance(gpsPos.lat, gpsPos.lng, best.lat, best.lng)
            return d < bd ? s : best
        })
    })()

    const distToStop = gpsPos && nearestStop?.lat
        ? haversineDistance(gpsPos.lat, gpsPos.lng, nearestStop.lat, nearestStop.lng)
        : null
    const isNearStop = distToStop != null && distToStop <= VERIFICATION_RADIUS_M
    const reportedCount = reportedStops.length

    // ── Load stops (filter for COLLECTION_REPORTED on server when possible) ──
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
        } catch {
            setStops([])
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

    // ── GPS watch ──
    useEffect(() => {
        if (!navigator.geolocation) { setGpsError('GPS not available.'); return }
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

    // ── Init map ──
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
                .bindPopup(`
          <b>${stop.label || `Stop ${stop.stop_order ?? idx + 1}`}</b><br/>
          <span style="font-size:11px;font-weight:700;color:${STOP_STATUS_COLORS[status]?.bg || '#94a3b8'}">
            ${STOP_STATUS_LABELS[status] || status}
          </span>
          ${stop.driver_name ? `<br/><span style="font-size:11px;color:#64748b">Driver: ${stop.driver_name}</span>` : ''}
        `)
            marker.on('click', () => {
                if (status === 'COLLECTION_REPORTED') setSelectedTask(stop)
            })
            stopMarkersRef.current.set(stop.id, marker)
        })
    }, [stops, leafletReady, nearestStop])

    // ── User dot on map ──
    useEffect(() => {
        const L = window.L
        if (!L || !mapInstance.current || !gpsPos) return
        const html = `<div style="width:14px;height:14px;border-radius:50%;background:#16a34a;border:2.5px solid #fff;box-shadow:0 0 12px rgba(22,163,74,.6);"></div>`
        if (!userMarkerRef.current) {
            userMarkerRef.current = L.marker([gpsPos.lat, gpsPos.lng], {
                icon: L.divIcon({ html, className: '', iconSize: [14, 14], iconAnchor: [7, 7] }),
                zIndexOffset: 1000,
            }).addTo(mapInstance.current)
        } else {
            userMarkerRef.current.setLatLng([gpsPos.lat, gpsPos.lng])
        }
    }, [gpsPos, leafletReady])

    // ── ORS polyline to nearest COLLECTION_REPORTED stop ──
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
                const geometry = data?.features?.[0]?.geometry
                if (geometry?.coordinates) {
                    setOrsRoute(geometry.coordinates.map(([lng, lat]) => [lat, lng]))
                } else {
                    setOrsRoute([[gpsPos.lat, gpsPos.lng], [nearestStop.lat, nearestStop.lng]])
                }
            } catch {
                setOrsRoute(null)
            }
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
            color: '#16a34a', weight: 4, opacity: 0.85,
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

    return (
        <>
            <Navbar />

            <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

                {/* ── MAP ── */}
                <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#1e2a38' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
                    {leafletReady && <MapLegend />}

                    {/* DEV TOOLS */}
                    {import.meta.env.DEV && (
                        <div style={{ position: 'absolute', top: '50%', right: 14, marginTop: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <button
                                onClick={() => teleportTo(nearestStop)}
                                disabled={!nearestStop}
                                title="Teleport to Nearest Reported Stop"
                                style={{ width: 44, height: 44, borderRadius: '50%', background: nearestStop ? '#16a34a' : '#cbd5e1', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: nearestStop ? 'pointer' : 'not-allowed', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20 }}
                            >📍</button>
                            {reportedStops.slice(0, 3).map((s, i) => (
                                <button key={s.id} onClick={() => teleportTo(s)} title={`Teleport to ${s.label}`}
                                    style={{ width: 44, height: 44, borderRadius: '50%', background: '#eab308', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 13, fontWeight: 900, color: '#0d1117' }}
                                >{i + 1}</button>
                            ))}
                            {isMock && (
                                <button onClick={clearMock} title="Clear Mock GPS"
                                    style={{ width: 44, height: 44, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 16, fontWeight: 800, color: '#fff' }}>✕</button>
                            )}
                        </div>
                    )}
                </div>

                {/* ── HEADER ── */}
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
                    background: 'rgba(15,23,42,.92)', backdropFilter: 'blur(8px)',
                    padding: '14px 16px 16px', color: '#fff',
                    boxShadow: '0 4px 20px rgba(0,0,0,.2)',
                }}>
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
                            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900, letterSpacing: '.02em' }}>
                                Post-Collection Verification
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>
                                {loading
                                    ? 'Loading stops…'
                                    : `${reportedCount} stop${reportedCount !== 1 ? 's' : ''} awaiting verification`}
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 22, fontWeight: 900, color: '#eab308' }}>{reportedCount}</div>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', fontWeight: 700, letterSpacing: '.06em' }}>TO VERIFY</div>
                        </div>
                    </div>
                </div>

                {/* ── BOTTOM PANEL ── */}
                <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
                    background: 'rgba(255,255,255,.97)', backdropFilter: 'blur(12px)',
                    borderTopLeftRadius: 24, borderTopRightRadius: 24,
                    boxShadow: '0 -4px 24px rgba(0,0,0,.12)', paddingBottom: 24,
                }}>
                    <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 13 }}>Loading…</div>
                    ) : reportedCount === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px 20px', color: '#64748b' }}>
                            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>All verified!</div>
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>No stops awaiting post-collection verification today.</div>
                        </div>
                    ) : nearestStop ? (
                        <div style={{ padding: '4px 20px 0' }}>

                            {/* Stop info */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 3 }}>
                                        NEAREST REPORTED STOP
                                    </div>
                                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900, color: isNearStop ? '#0f172a' : '#64748b', transition: 'color .3s', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {nearestStop.label || `Stop ${nearestStop.stop_order}`}
                                    </div>
                                    {nearestStop.driver_name && (
                                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                                            🚛 Reported by {nearestStop.driver_name}
                                        </div>
                                    )}
                                </div>
                                {distToStop != null && (
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900, color: isNearStop ? '#16a34a' : '#475569' }}>
                                            {distToStop > 1000 ? `${(distToStop / 1000).toFixed(1)}km` : `${Math.round(distToStop)}m`}
                                        </div>
                                        <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: '.04em' }}>AWAY</div>
                                    </div>
                                )}
                            </div>

                            {/* Proximity message */}
                            {isNearStop ? (
                                <p style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, marginBottom: 12, textAlign: 'center' }}>
                                    📍 You have arrived — ready to verify!
                                </p>
                            ) : distToStop != null ? (
                                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12, textAlign: 'center' }}>
                                    Walk {distToStop > 1000 ? `${(distToStop / 1000).toFixed(1)} km` : `${Math.round(distToStop)} m`} to reach this stop
                                </p>
                            ) : (
                                <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12, textAlign: 'center' }}>📡 Waiting for GPS signal…</p>
                            )}

                            {/* Remaining count */}
                            {reportedCount > 1 && (
                                <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginBottom: 10 }}>
                                    +{reportedCount - 1} more stop{reportedCount - 1 !== 1 ? 's' : ''} to verify after this one
                                </p>
                            )}

                            {/* CTA */}
                            <button
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
                                {isNearStop ? '✅ Verify Stop' : 'Confirm on Arrival'}
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* ── VERIFICATION OVERLAY ── */}
            <PostCollectionOverlay
                visible={!!selectedTask}
                task={selectedTask}
                gpsPos={gpsPos}
                onComplete={() => { setSelectedTask(null); loadStops() }}
                onBack={() => setSelectedTask(null)}
            />
        </>
    )
}