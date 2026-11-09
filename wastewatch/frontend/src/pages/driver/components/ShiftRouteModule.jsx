/**
 * ShiftRouteModule.jsx
 *
 * 3rd part < ==  Do not remove this indicator
 * ---------------------
 * OVERLAY ARCHITECTURE:
 *   ShiftRouteModule is ALWAYS mounted once the shift starts.
 *   ArrivedModule, StopCompletedModule, and EndShiftModule are rendered
 *   as RouteStateOverlay panels ON TOP of the map — they never unmount
 *   the map or interrupt GPS tracking.
 *
 *   routeState is managed here (not in DriverDashboard) for overlay control:
 *     'navigating'  → map visible, no overlay
 *     'arrived'     → ArrivedModule overlay
 *     'completed'   → StopCompletedModule overlay
 *     'end_shift'   → EndShiftModule overlay
 *
 * Stop marker colour system:
 *  🟢 green  — collected
 *  🔵 blue   — current
 *  🟠 orange — upcoming
 *  🔴 red    — missed
 *  ⚪ grey    — pending / watcher not confirmed
 *  ◌ border   — none / no watcher confirmation yet
 *
 * CAMERA PROOF:
 *   Photo capture happens ONCE — in ArrivedOverlay only.
 *   CameraProofModal opens from ArrivedOverlay, posts to
 *   POST /api/driver/stops/collect/, and calls onSuccess.
 *   StopCompletedOverlay shows the result and lets the driver
 *   proceed — no second photo required.
 *
 * GPS FIX NOTES:
 *   - useGpsTracking is always enabled (enabled={true}) regardless of
 *     shiftActive. The shift timer gating was preventing GPS from ever
 *     starting when shiftActive was false on first render.
 *   - Driver marker creation is deferred: the map init effect only creates
 *     the L.map instance. A separate effect watches for BOTH mapInstance and
 *     gpsPos to be non-null before placing the driver marker, so the marker
 *     always starts at the real GPS position instead of the [13.9373, 121.617]
 *     fallback.
 *   - gpsPosRef is synced in a layout effect (useLayoutEffect) so any
 *     synchronous reads of gpsPosRef.current within the same render cycle
 *     see the latest value.
 *   - mockGps is cleared on component unmount to prevent stale mock state
 *     bleeding into a fresh mount (e.g. after a hot-reload or navigation).
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useShiftTimer from '../../../hooks/useShiftTimer'
import { useDriverGps } from '../../../context/DriverGpsContext'
import { useNotification } from '../../../context/NotificationContext'
import api from '../../../api/client'
import { resolveDriverSchedule } from '../../../utils/driverSchedule'
import { useAuth } from '../../../context/AuthContext'
import EndShiftModule from './EndShiftModule'
import MultiPhotoPicker from '../../../components/MultiPhotoPicker'
import { useOnline } from '../../../hooks/useOnline'
import { getQueue } from '../../../hooks/useOfflineQueue'
import {
  MapPin,
  Navigation,
  LocateFixed,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Radio,
  AlertTriangle,
  Package,
  X,
  Flag,
  SkipForward,
  Ban,
  Target,
  Check,
  Camera,
  Compass,
  Plus,
  Minus,
  Layers,
} from 'lucide-react'
import MapLayerToggle, { applyMapTileLayer } from '../../../components/MapLayerToggle'
import { calculateBearing, getShortestAngle, create3DVehicleIcon, createTruckSpriteIcon } from './map3DUtils'
import { NavCamera } from './navCamera'
import TruckOverlay from './TruckOverlay'
import {
  broadcastPickupStatusSync,
  buildStopValidationSnapshot,
  isRoutableStopStatus,
  isCompletedStopStatus,
  isMissedStopStatus,
  normalizeStopStatus,
  STOP_STATUS_COLORS,
  STOP_STATUS_LABELS,
  subscribePickupStatusSync,
  isScheduleFullyResolved,
} from '../../../utils/pickupStatusSync'
import useReassignedStops from '../../../hooks/useReassignedStops'
import { MapSkeleton } from '../../../components/ui/Skeleton'
import { resolveActiveNavTarget, pickNearestRoutableIndex, getResolvedStopStatus } from './navTarget'
import { RouteRequestManager } from './routeRequestManager'

const STOP_COLORS = STOP_STATUS_COLORS

const restoreStopStatuses = () => {
  try {
    const saved = sessionStorage.getItem('ww_stop_statuses')
    if (!saved) return new Map()
    return new Map(
      JSON.parse(saved)
        .map(([key, status]) => [Number(key), normalizeStopStatus(status)])
        .filter(([key]) => Number.isInteger(key))
    )
  } catch {
    return new Map()
  }
}

const persistStopStatuses = (statuses) =>
  sessionStorage.setItem('ww_stop_statuses', JSON.stringify([...statuses]))

function injectStopMarkerStyles() {
  if (document.getElementById('ww-shift-stop-marker-styles')) return
  const style = document.createElement('style')
  style.id = 'ww-shift-stop-marker-styles'
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

function stopMarkerHTML(stopNumber, status, details, isActive = false, isSatellite = false) {
  const safeStatus = normalizeStopStatus(status)
  const c = STOP_COLORS[safeStatus] || STOP_COLORS.PENDING_INSPECTION
  const size = isActive ? 28 : 24
  const markerLabel = safeStatus === 'VERIFIED_COLLECTED' ? '✓'
    : safeStatus === 'COLLECTION_DISPUTED' ? '×'
      : safeStatus === 'COLLECTION_REPORTED' ? '?'
        : stopNumber

  const keyframe = isActive ? `
    <style>@keyframes wwMarkerPulse{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.75);opacity:0}}</style>
  ` : ''

  const pulse = isActive ? `
    <span style="
      position:absolute;inset:-5px;border-radius:50%;
      border:2.5px solid ${isSatellite ? '#f59e0b' : (c.bg === 'transparent' ? '#f59e0b' : c.bg)};
      animation:wwMarkerPulse 1.8s ease infinite;
      pointer-events:none;
    "></span>
  ` : ''

  let fillColor
  let borderStyle
  let textColor
  let glowShadow

  if (isSatellite) {
    // Satellite view: White Version (solid white circle with dark text, like PostCollectionOverlay.jsx)
    fillColor = '#ffffff'
    textColor = '#0f172a'
    const statusBorderColor = safeStatus === 'PENDING_INSPECTION'
      ? (isActive ? '#f59e0b' : '#94a3b8')
      : (c.bg !== 'transparent' ? c.bg : (c.border || '#16a34a'))
    borderStyle = isActive ? '2.5px solid #f59e0b' : `2.5px solid ${statusBorderColor}`
    glowShadow = '0 2px 10px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.2)'
  } else {
    // Default view: Transparent inside and dotted lines on the side for pending stops
    if (safeStatus === 'PENDING_INSPECTION') {
      fillColor = 'transparent'
      borderStyle = isActive ? '2.5px dotted #f59e0b' : `2px dotted ${c.border || '#94a3b8'}`
      textColor = isActive ? '#d97706' : '#64748b'
      glowShadow = isActive ? '0 0 10px rgba(245,158,11,0.5)' : 'none'
    } else {
      fillColor = c.bg
      borderStyle = `2.5px solid ${c.border}`
      textColor = c.label
      glowShadow = ['VERIFIED_COLLECTED', 'COLLECTION_DISPUTED', 'COLLECTION_REPORTED'].includes(safeStatus)
        ? `0 2px 10px ${c.shadow}, 0 0 0 3px ${c.bg === 'transparent' ? 'rgba(148,163,184,0.3)' : `${c.bg}44`}`
        : `0 2px 10px ${c.shadow}`
    }
  }

  return `
    ${keyframe}
    <div style="position:relative;width:${size}px;height:${size}px;">
      ${pulse}
      <div style="
        position:absolute;inset:0;
        background:${fillColor};
        border:${borderStyle};
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        color:${textColor};
        font-size:${isActive ? 12 : 10}px;
        font-weight:900;
        font-family:system-ui,-apple-system,sans-serif;
        box-shadow:${glowShadow};
        transition:background .35s, box-shadow .35s;
      ">${markerLabel}</div>
      ${details?.collectedAt ? `<div style="position:absolute;top:-6px;right:-6px;background:rgba(0,0,0,0.75);color:#fff;font-size:10px;padding:2px 6px;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${details.collectedAt}</div>` : ''}
    </div>`
}

// ─── GPS STATUS PILL ──────────────────────────────────────────────────────────

function GpsStatusPill({ isTracking, error, accuracy }) {
  const isPoor = accuracy != null && accuracy >= 50
  const label = error ? 'GPS Lost' : !isTracking ? 'GPS…'
    : accuracy != null ? `GPS ±${Math.round(accuracy)}m` : 'GPS Active'
  const color = error ? '#ef4444' : isPoor ? '#f59e0b' : isTracking ? '#2ecc71' : '#f59e0b'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 20, padding: '3px 10px'
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block',
        animation: isTracking && !error ? 'navPulse 2s ease infinite' : 'none'
      }} />
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
  const color = online ? '#2ecc71' : '#ef4444'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: `${color}1a`, border: `1px solid ${color}44`, borderRadius: 20, padding: '3px 10px'
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '.04em' }}>
        {online ? '● Online' : '○ Offline'}
      </span>
    </div>
  )
}

function StatCell({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>{label}</div>
    </div>
  )
}

const ARRIVAL_RADIUS_M = 20

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

import TurnArrow, { TURN_COLOR } from './TurnArrow'

function MapLegend() {
  const items = [
    { color: 'transparent', border: '1.5px dotted rgba(148,163,184,0.9)', label: STOP_STATUS_LABELS.PENDING_INSPECTION },
    { color: '#f59e0b', label: STOP_STATUS_LABELS.READY_FOR_COLLECTION },
    { color: '#94a3b8', label: STOP_STATUS_LABELS.EMPTY_STOP },
    { color: '#eab308', label: STOP_STATUS_LABELS.COLLECTION_REPORTED },
    { color: '#16a34a', label: STOP_STATUS_LABELS.VERIFIED_COLLECTED },
    { color: '#ef4444', label: STOP_STATUS_LABELS.COLLECTION_DISPUTED },
  ]
  return (
    <div style={{
      position: 'absolute', bottom: 10, right: 10, zIndex: 500,
      background: 'rgba(15,23,42,0.82)', backdropFilter: 'blur(6px)',
      borderRadius: 10, padding: '8px 10px',
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      {items.map(({ color, border, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%', background: color,
            border: border || 'none',
            boxShadow: color === 'transparent' ? 'none' : `0 0 4px ${color}88`,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.8)',
            letterSpacing: '.04em',
          }}>{label.toUpperCase()}</span>
        </div>
      ))}
    </div>
  )
}

// ─── OVERLAY WRAPPER ──────────────────────────────────────────────────────────
function RouteOverlay({ children, visible, onClose }) {
  if (!visible) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(5px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-end',
      }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
      </div>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', height: '80vh', overflow: 'auto',
          borderRadius: '18px 18px 0 0', background: '#f8fafc',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.35)',
        }}>
        {children}
      </div>
    </div>
  )
}

// ─── ARRIVED OVERLAY ──────────────────────────────────────────────────────────
const QUICK_NOTES = ['Collected', 'Partially collected', 'No bins outside', 'Overflowing']

function ArrivedOverlay({ visible, currentStop, stopIndex, gpsPos, scheduleId, onConfirm, onBack, missedStopId }) {
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [stop, setStop] = useState(null)
  const [loading, setLoading] = useState(false)
  const [photos, setPhotos] = useState([])
  const [cameraError, setCameraError] = useState('')

  const { user } = useAuth()
  const isOnline = useOnline()
  const proofQueue = getQueue('proof_submissions')
  const { notify } = useNotification()

  useEffect(() => {
    if (!visible) {
      setNote('')
      setPhotos([])
      setCameraError('')
      return
    }

    setLoading(true)
    api.get('/api/driver/stops/current/')
      .then(res => {
        if (res.data) {
          setStop(res.data)
          const id = Number(res.data.id)
          if (id) sessionStorage.setItem('ww_pending_collection_stop_id', String(id))
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [visible])

  const displayName = stop?.address || currentStop || `Stop ${stopIndex}`
  const displayBarangay = stop?.barangay || sessionStorage.getItem('ww_barangay') || ''

  function selectPreset(preset) {
    setNote(prev => prev ? `${prev}, ${preset}` : preset)
  }

  async function handleConfirm() {
    if (photos.length === 0) {
      setCameraError('You must take at least one photo to confirm.')
      return
    }
    if (!user?.id) {
      setCameraError('You must be logged in to submit proof.')
      return
    }

    setSubmitting(true)
    setCameraError('')

    try {
      // photos[0] is a File object from compressImage — use it directly.
      // fetch() on a File produces an empty/corrupted blob → Cloudinary "Invalid image file".
      const photoBlob = photos[0]

      const note_ = note.trim()
      const collected_at = new Date().toISOString()
      const lat = gpsPos?.lat || sessionStorage.getItem('ww_gps_lat')
      const lng = gpsPos?.lng || sessionStorage.getItem('ww_gps_lng')
      const photoName = `pickup-${stopIndex}-${Date.now()}.jpg`
      const stopId = stop?.id || sessionStorage.getItem('ww_pending_collection_stop_id')

      if (isOnline) {
        try {
          const formData = new FormData()
          formData.append('photo', photoBlob, photoName)
          formData.append('note', note_)
          formData.append('collected_at', collected_at)
          if (lat) formData.append('lat', lat)
          if (lng) formData.append('lng', lng)
          formData.append('schedule_id', scheduleId || '')
          formData.append('stop_order', String(stopIndex))

          const res = await api.post(`/api/driver/stops/collect/`, formData)

          sessionStorage.setItem('ww_pending_collection_photo_url', res.data?.photo_url || '')
          sessionStorage.setItem('ww_pending_collection_note', note_)
          sessionStorage.setItem('ww_pending_collection_at', collected_at)
          let missedStopResolved = true
          // If collecting a missed stop, also call the resolve endpoint
          if (missedStopId) {
            try {
              await api.post(`/api/driver/shift/missed-stops/${missedStopId}/collect/`)
            } catch {
              missedStopResolved = false
              notify({ variant: 'warning', message: 'Photo saved, but failed to mark missed stop as resolved. Please retry later.' })
            }
          }
          setSubmitting(false)
          onConfirm(missedStopResolved)
          return
        } catch (netErr) {
          const isNetworkErr = !netErr?.response
          if (!isNetworkErr) throw netErr
        }
      }

      await proofQueue.enqueue({
        ownerId: String(user.id),
        stopId: stopId,
        stopOrder: stopIndex,
        scheduleId: scheduleId || null,
        photo: photoBlob,
        photoName,
        note: note_,
        collected_at,
        lat,
        lng,
      }, 1)

      sessionStorage.setItem('ww_pending_collection_photo_url', '')
      sessionStorage.setItem('ww_pending_collection_note', note_)
      sessionStorage.setItem('ww_pending_collection_at', collected_at)
      setSubmitting(false)
      onConfirm(missedStopId ? false : true)
    } catch (err) {
      setCameraError(err?.response?.data?.error || err?.message || 'Proof photo upload failed.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <RouteOverlay visible={visible} onClose={onBack}>
        <style>{`
          @keyframes amSlideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
          .am-card { animation: amSlideUp .25s ease both; }
          @keyframes amPulse { to { transform: rotate(360deg); } }
        `}</style>

        {loading ? (
          <div style={{ minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#0f172a', animation: 'amPulse 1.2s linear infinite' }} />
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Loading stop details...</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            <div style={{ background: 'linear-gradient(160deg, #0f172a 60%, #1e3a5f)', padding: '40px 24px 32px', textAlign: 'center', color: '#fff', borderRadius: '18px 18px 0 0' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>{missedStopId ? '🎯' : '📍'}</div>
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900, margin: '0 0 6px', letterSpacing: '.02em' }}>
                {missedStopId ? 'Collect Missed Stop' : 'You have arrived'}
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: 0 }}>
                {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            <div className="am-card" style={{ margin: '0 16px', marginTop: -18, background: '#fff', borderRadius: 14, padding: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 4 }}>
                {missedStopId ? 'MISSED STOP — UNCLAIMED' : 'CURRENT STOP'}
              </div>
              <div style={{ fontWeight: 900, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>{displayName}</div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{displayBarangay}</div>
            </div>

            <div style={{ padding: '0 16px', marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 8 }}>QUICK NOTES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {QUICK_NOTES.map(preset => (
                  <button key={preset} onClick={() => selectPreset(preset)} style={{
                    padding: '7px 12px', borderRadius: 20,
                    border: `1px solid ${note.includes(preset) ? '#0f172a' : '#e2e8f0'}`,
                    background: note.includes(preset) ? '#0f172a' : '#fff',
                    color: note.includes(preset) ? '#fff' : '#475569',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                  }}>{preset}</button>
                ))}
              </div>
            </div>

            <div style={{ padding: '0 16px', marginBottom: 16 }}>
              <textarea placeholder="Additional notes (optional)…" value={note}
                onChange={e => setNote(e.target.value)} maxLength={200} rows={2}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', fontSize: 13, color: '#0f172a', resize: 'none', fontFamily: 'var(--font-body)' }}
              />
            </div>

            <div style={{ padding: '0 16px', marginBottom: 28 }}>
              <div style={{
                background: '#fff',
                border: `1.5px dashed ${cameraError ? '#ef4444' : '#cbd5e1'}`,
                borderRadius: 16,
                padding: '16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Take Proof Photo</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>Required &middot; GPS location will be verified</p>
                  </div>
                  {photos.length === 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
                      padding: '4px 10px', borderRadius: 999,
                      background: 'rgba(245,158,11,0.12)',
                      color: '#f59e0b',
                    }}>
                      REQUIRED
                    </span>
                  )}
                </div>

                <MultiPhotoPicker
                  photos={photos}
                  onChange={setPhotos}
                  error={cameraError}
                />
              </div>
            </div>

            <div style={{ padding: '0 16px 28px', marginTop: 'auto' }}>
              <button onClick={handleConfirm} disabled={submitting || photos.length === 0} style={{
                width: '100%', padding: '16px', borderRadius: 30, border: 'none',
                background: submitting || photos.length === 0 ? '#e2e8f0' : '#0f172a',
                color: submitting || photos.length === 0 ? '#94a3b8' : '#fff',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                letterSpacing: '.06em', cursor: submitting || photos.length === 0 ? 'not-allowed' : 'pointer',
                boxShadow: submitting || photos.length === 0 ? 'none' : '0 6px 20px rgba(15,23,42,0.3)',
                transition: 'all .2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}>
                {submitting ? (
                  'Saving…'
                ) : photos.length === 0 ? (
                  <>
                    <Camera size={18} />
                    <span>Take a photo first</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={18} />
                    <span>Confirm Collection</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </RouteOverlay>
    </>
  )
}

// ─── STOP COMPLETED OVERLAY ───────────────────────────────────────────────────

function StopCompletedOverlay({ visible, schedule, currentStopIndex, stopStatuses, gpsPos, onNextStop, onEndShift, onExtendedMode }) {
  const { user } = useAuth()
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'
  const [showRouteList, setShowRouteList] = useState(false)

  const pendingNote = sessionStorage.getItem('ww_pending_collection_note') || ''

  useEffect(() => {
    if (!visible) return
    setShowRouteList(false)
  }, [visible])

  const stops = (schedule?.waypoints || []).slice(1).map((wp, i) => {
    const wpIndex = i + 1
    const status = normalizeStopStatus(stopStatuses.get(wpIndex))
    const isCompleted = isCompletedStopStatus(status) || status === 'EMPTY_STOP'
    return {
      id: wpIndex,
      name: wp.name || wp.label || `Stop ${wpIndex}`,
      rawStatus: status,
      status: isCompleted ? 'completed' : 'pending',
    }
  })

  const completed = stops.filter(s => s.status === 'completed').length
  const total = stops.length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const isRouteComplete = total > 0 && progress === 100

  // Auto-advance to EndShiftModule if the overlay becomes visible and route is already 100%
  useEffect(() => {
    if (!visible || !isRouteComplete || !onEndShift) return
    const timer = setTimeout(() => {
      try { sessionStorage.setItem('ww_stop_statuses_snapshot', JSON.stringify([...stopStatuses])) } catch { }
      sessionStorage.setItem('ww_route_complete', 'true')
      onEndShift()
    }, 600)
    return () => clearTimeout(timer)
  }, [visible, isRouteComplete]) // eslint-disable-line

  return (
    <RouteOverlay visible={visible}>
      <style>{`
        @keyframes scmBounce {
          0%   { transform: scale(0.7); opacity:0; }
          60%  { transform: scale(1.08); }
          80%  { transform: scale(0.97); }
          100% { transform: scale(1); opacity:1; }
        }
        @keyframes scmFadeUp {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .scm-check  { animation: scmBounce .5s cubic-bezier(.36,.07,.19,.97) both; }
        .scm-fade   { animation: scmFadeUp .3s ease .2s both; }
        .scm-fade2  { animation: scmFadeUp .3s ease .35s both; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <div style={{ padding: '20px 20px 0' }}>
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900, color: '#0f172a', margin: '0 0 18px', textAlign: 'center' }}>
            Well done, {firstName}!
          </h1>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ flex: 1, marginRight: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: '#2ecc71', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#0d1117" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.04em', color: '#0f172a' }}>PROGRESS INDICATOR</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 7, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg,#2ecc71,#16a34a)', width: `${progress}%`, transition: 'width .6s ease' }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#2ecc71', flexShrink: 0 }}>{progress}%</span>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', marginBottom: 2 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2ecc71', display: 'inline-block' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#2ecc71' }}>Verified Location</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>{completed}/{total} Locations</span>
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 12, marginBottom: 10,
            background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)',
          }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a' }}>Collection proof submitted</div>
              {pendingNote && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>Note: {pendingNote}</div>
              )}
            </div>
          </div>

          <button onClick={() => setShowRouteList(p => !p)} style={{
            width: '100%', padding: '9px 12px', borderRadius: 10,
            background: '#f1f5f9', border: '1px solid #e2e8f0',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
              View stop details ({completed} completed · {total - completed} remaining)
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="13" height="13"
              style={{ transform: showRouteList ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showRouteList && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 10px 10px', maxHeight: 200, overflowY: 'auto' }}>
              {stops.map((stop, i) => (
                <div key={stop.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: i < stops.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: stop.status === 'completed' ? '#2ecc71' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: stop.status === 'completed' ? '#0d1117' : '#94a3b8' }}>
                    {stop.status === 'completed' ? '✓' : i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: stop.status === 'completed' ? '#0f172a' : '#94a3b8' }}>{stop.name}</div>
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.05em', padding: '2px 7px', borderRadius: 20, flexShrink: 0, background: stop.status === 'completed' ? 'rgba(46,204,113,0.1)' : 'rgba(148,163,184,0.1)', color: stop.status === 'completed' ? '#2ecc71' : '#94a3b8' }}>
                    {stop.status === 'completed' ? 'DONE' : 'PENDING'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="scm-fade" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <p style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900, color: '#0f172a', marginBottom: 18 }}>
            {isRouteComplete ? 'Route Complete' : 'Good Job'}
          </p>
          <div className="scm-check" style={{ width: 90, height: 90, borderRadius: '50%', background: '#1e2a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 28px rgba(15,23,42,0.25)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="44" height="44">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <div className="scm-fade2" style={{ padding: '0 20px 28px' }}>
          <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', marginBottom: 12, fontWeight: 500 }}>
            Ready for your next stop?
          </p>
          {isRouteComplete ? (
            <>
              <button onClick={() => {
                // Persist snapshot so EndShiftModule can read it even after re-render
                try { sessionStorage.setItem('ww_stop_statuses_snapshot', JSON.stringify([...stopStatuses])) } catch { }
                sessionStorage.setItem('ww_route_complete', 'true')
                if (onEndShift) onEndShift()
              }} style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: '#0f172a', color: '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
              }}>View Route Summary →</button>
            </>
          ) : (
            <>
              <button onClick={onNextStop} style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: '#0f172a', color: '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                cursor: 'pointer', marginBottom: 8,
                boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
              }}>Next Stop</button>
              <button onClick={onEndShift} style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: '#0f172a', color: '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
              }}>I'm done for the day!</button>
            </>
          )}
        </div>

        <div style={{ background: '#0f172a', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 0 18px 18px' }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, letterSpacing: '.06em' }}>Track · Monitor · Report</span>
        </div>
      </div>
    </RouteOverlay>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function ShiftRouteModule({ onAdvance, shift }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { notify } = useNotification()
  const {
    formattedTime,
    shiftActive,
    scheduleId: activeScheduleId,
    loading: shiftLoading,
  } = useShiftTimer()
  const { position: realGpsPos, accuracy: gpsAccuracy, isTracking, error: gpsError } = useDriverGps()

  const [hasNewStops, setHasNewStops] = useState(false)

  // Wait for the backend check to resolve before deciding to redirect —
  // otherwise a page refresh briefly reads shiftActive=false and bounces
  // the driver out before /active/ has responded.
  const hasRedirected = useRef(false)
  useEffect(() => {
    if (shiftLoading) return
    if (!shiftActive && !hasRedirected.current) {
      hasRedirected.current = true
      navigate('/dashboard', { replace: true })
    }
  }, [shiftActive, shiftLoading, navigate])



  const [routeState, setRouteState] = useState(() => {
    return sessionStorage.getItem('ww_route_state') || 'navigating'
  })

  const [showFullConfirm, setShowFullConfirm] = useState(false)
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false)


  const isExtendedMode = sessionStorage.getItem('ww_extended_mode') === 'true'


  useEffect(() => { injectStopMarkerStyles() }, [])

  // Hydrate the full stop→stop leg cache from sessionStorage on mount.
  // Runs before schedule/GPS loads so cached legs are available immediately.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('ww_ors_route_cache')
      if (saved) routeLegCacheRef.current = new Map(JSON.parse(saved))
    } catch { }
  }, [])

  // ── FIX 2: Clear mockGps on unmount to prevent stale state on remount. ────
  const [mockGps, setMockGps] = useState(null)
  useEffect(() => {
    return () => { setMockGps(null) }
  }, [])

  const gpsPos = mockGps || realGpsPos
  const isMock = mockGps !== null

  const viewportRef = useRef(null)
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const driverMarker = useRef(null)
  const navCameraRef = useRef(null)
  const routeLayer = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  // ── FIX 3: Use useLayoutEffect for gpsPosRef so synchronous reads within
  // the same render cycle (e.g. in map init) always see the latest value. ────
  const gpsPosRef = useRef(gpsPos)
  useLayoutEffect(() => { gpsPosRef.current = gpsPos }, [gpsPos])

  const stopMarkersRef = useRef(new Map())

  const [leafletReady, setLeafletReady] = useState(false)
  const [schedule, setSchedule] = useState(null)
  const [mapLoading, setMapLoading] = useState(true)

  // Stage 2B: Vehicle avatar mode ('sprite-topdown' | 'svg')
  const [markerAvatarMode, setMarkerAvatarMode] = useState('sprite-topdown')
  const resolvedHeadingRef = useRef(null)

  const getVehicleMarkerIcon = (L, heading, is3DMode, mapHdg) => {
    if (markerAvatarMode === 'svg') {
      return create3DVehicleIcon(L, heading, is3DMode, mapHdg)
    }
    return createTruckSpriteIcon(L, heading, is3DMode, mapHdg, {
      useChaseIn3D: false, // Standardize on top-down sprite for Stage 2B to prevent cornering roll
    })
  }

  // Guard: if the driver has an active shift on a DIFFERENT route than the
  // one this module just loaded, don't let them silently work the wrong route.
  const hasWarnedMismatch = useRef(false)
  useEffect(() => {
    if (shiftLoading || !shiftActive || !schedule?.id || !activeScheduleId) return
    if (String(activeScheduleId) !== String(schedule.id) && !hasWarnedMismatch.current) {
      hasWarnedMismatch.current = true
      notify({
        variant: 'error-dark',
        message: 'You have an active shift on a different route. Redirecting to your dashboard.',
      })
      navigate('/dashboard', { replace: true })
    }
  }, [shiftLoading, shiftActive, activeScheduleId, schedule?.id, notify, navigate])

  const [currentStopIndex, setCurrentStopIndex] = useState(() => {
    const s = sessionStorage.getItem('ww_current_stop_index')
    return s ? parseInt(s, 10) : 1
  })
  const prevStopIndexRef = useRef(currentStopIndex)

  const [stopStatuses, setStopStatuses] = useState(restoreStopStatuses)
  const [is3D, setIs3D] = useState(false)
  const [mapHeading, setMapHeading] = useState(0)
  const prevGpsPosRef = useRef(null)
  const isFollowCamRef = useRef(true)
  const [isUserPanned, setIsUserPanned] = useState(false)
  const [isRetracted, setIsRetracted] = useState(false)
  const [isTurnCardCollapsed, setIsTurnCardCollapsed] = useState(false)
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false)
  const [show3DPreview, setShow3DPreview] = useState(false)

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

  // ── Reactive route-completion catcher ────────────────────────────────────
  // Fires after BOTH of these are true:
  //   1. statusesSynced — the API has responded at least once (not just the
  //      sessionStorage-restored initial state from the prior mount).
  //   2. sawIncompleteRef — this mount has seen at least one render where the
  //      route was NOT fully resolved, so we know the completion happened
  //      here, not before we arrived.
  //
  // Guard rationale:
  //   Without (1), a stale ww_stop_statuses from a previously-finished run
  //   could trigger auto-end before the first network response arrives.
  //   Without (2), the catcher fires on routes whose backend data was already
  //   all-resolved when we mounted (e.g., re-opening the app after the last
  //   stop was confirmed hours ago).
  //
  // Known limitation: if the very first synced render shows "complete" because
  // the last stop was just collected moments before a reload, sawIncompleteRef
  // is still false and the catcher does NOT fire — the driver must either reload
  // again (which triggers the backend /shift/current/ auto-heal to end_shift)
  // or tap End Shift manually. This is intentional until the [catcher] console
  // log confirms which hypothesis triggers the spurious auto-end in production.
  //
  // IMPORTANT: extended mode MUST be excluded — in extended mode the driver's
  // original schedule is already 100% resolved by design, so this guard would
  // instantly eject them if it were allowed to fire there.
  const hasAutoEndedRef = useRef(false)
  const sawIncompleteRef = useRef(false)
  const [statusesSynced, setStatusesSynced] = useState(false)
  useEffect(() => {
    if (hasAutoEndedRef.current || isExtendedMode) return
    if (!schedule || !statusesSynced || !stopStatuses.size) return

    // Diagnostic: log on every evaluation so stale-state races show up in DevTools.
    console.log('[catcher]', { schedId: schedule?.id, n: stopStatuses.size, statusesSynced, statuses: [...stopStatuses] })

    if (!isScheduleFullyResolved(schedule, stopStatuses)) {
      // Route still has unresolved stops — record that we've seen it incomplete.
      sawIncompleteRef.current = true
      return
    }
    if (!sawIncompleteRef.current) {
      // Route was already fully resolved when we mounted (stale data or prior run).
      // Do NOT auto-end — a driver who reloads mid-shift should not be ejected.
      // The backend /shift/current/ auto-heal already handles the resume path.
      console.warn('[ShiftRoute] route already resolved on arrival — not auto-ending (stale data guard)')
      return
    }
    hasAutoEndedRef.current = true
    sessionStorage.setItem('ww_route_complete', 'true')
    try { sessionStorage.setItem('ww_stop_statuses_snapshot', JSON.stringify([...stopStatuses])) } catch { }
    // Use setTimeout to let current React render cycle finish before transitioning
    setTimeout(() => handleEndShift(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, stopStatuses, statusesSynced, isExtendedMode])

  const [stopDetailsMap, setStopDetailsMap] = useState(new Map())
  const stopDetailsMapRef = useRef(new Map())
  useEffect(() => { stopDetailsMapRef.current = stopDetailsMap }, [stopDetailsMap])

  const [orsData, setOrsData] = useState(null)
  const [orsFetchKey, setOrsFetchKey] = useState(0)
  const lastOrsGpsPosRef = useRef(null)
  // Straight-line fallback layer ref (kept for cleanup only; drawing now via cachedLegLayersRef)
  const fallbackRouteLayer = useRef(null)
  // Last successful ORS geometry for the *current* target.
  // Stored as { key: "lat,lng", geometry } so stale geometry from a previous
  // leg is never redrawn over a new leg (Fix 1).
  const lastOrsGeometryRef = useRef(null)
  // Retry timer ref for ORS backoff
  const orsRetryTimerRef = useRef(null)
  // Stop→stop leg cache: "fromIdx-toIdx" → { geometry } — pre-fetched while online (Fix 2)
  const routeLegCacheRef = useRef(new Map())
  // All currently-drawn route polyline layers, tracked as an array for clean teardown (Fix 4)
  const cachedLegLayersRef = useRef([])
  // Camera-authority flag: true while next stop is >800m away (Fix 5)
  const isFarModeRef = useRef(false)
  // Base tile layer ref for switching between Default and Satellite
  const baseTileLayerRef = useRef(null)
  const [mapType, setMapType] = useState(() => localStorage.getItem('ww_map_type') || 'default')

  const toggleMapType = () => {
    setMapType(prev => {
      const next = prev === 'default' ? 'satellite' : 'default'
      localStorage.setItem('ww_map_type', next)
      return next
    })
  }

  // Track online status for auto-retry
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  const [localWaypoints, setLocalWaypoints] = useState([])
  // Missed stops from OTHER drivers' routes — shown as floating markers,
  // NOT inserted into the navigation sequence
  const [floatingMissedStops, setFloatingMissedStops] = useState([])
  const [activeMissedStop, setActiveMissedStop] = useState(null)
  const floatingMarkersRef = useRef(new Map()) // key: pickup_status_id → L.Marker

  // Auto-target nearest missed stop the moment they become available (or after
  // the current one is claimed/resolved by another driver).
  useEffect(() => {
    if (!isExtendedMode) return
    if (!floatingMissedStops.length) {
      // All stops claimed — clear active target
      setActiveMissedStop(null)
      return
    }
    // If current activeMissedStop is still in the list, keep it
    if (activeMissedStop && floatingMissedStops.find(s => s.id === activeMissedStop.id)) return
    // Pick nearest stop by haversine distance (falls back to first if no GPS)
    let best = floatingMissedStops[0]
    if (gpsPos) {
      let bestDist = Infinity
      floatingMissedStops.forEach(s => {
        if (s.lat == null || s.lng == null) return
        const d = haversineDistance(gpsPos.lat, gpsPos.lng, Number(s.lat), Number(s.lng))
        if (d < bestDist) { bestDist = d; best = s }
      })
    }
    setActiveMissedStop(best)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatingMissedStops, isExtendedMode])

  useEffect(() => {
    if (schedule?.waypoints) setLocalWaypoints(schedule.waypoints)
  }, [schedule])

  function insertNearestNeighbor(waypoints, newStops, gpsPos) {
    if (!newStops.length) return waypoints
    const insertAfter = waypoints.findIndex((_, i) => i === currentStopIndex)
    const sortedNew = [...newStops].sort((a, b) => {
      if (!gpsPos) return 0
      const dA = haversineDistance(gpsPos.lat, gpsPos.lng, Number(a.lat), Number(a.lng))
      const dB = haversineDistance(gpsPos.lat, gpsPos.lng, Number(b.lat), Number(b.lng))
      return dA - dB
    })
    const result = [...waypoints]
    result.splice(insertAfter + 1, 0, ...sortedNew)
    return result
  }

  useReassignedStops({
    enabled: isExtendedMode,
    driverLat: gpsPos?.lat,
    driverLng: gpsPos?.lng,
    onNewStops: (newStops) => {
      // Store as floating markers — NOT part of the route sequence
      setFloatingMissedStops(prev => {
        const existingIds = new Set(prev.map(s => s.id))
        const truly_new = newStops.filter(s => !existingIds.has(s.id))
        if (!truly_new.length) return prev
        return [...prev, ...truly_new]
      })
      setHasNewStops(true)
    },
    onStopResolved: (resolvedId) => {
      // Remove floating marker when another extended driver claims this stop
      setFloatingMissedStops(prev => prev.filter(s => s.id !== resolvedId))
    },
  })

  const waypoints = localWaypoints

  const resolvedNavTarget = resolveActiveNavTarget({
    waypoints,
    currentStopIndex,
    stopStatuses,
    activeMissedStop,
  })
  const currentTarget = resolvedNavTarget.targetWp
  const nextTarget = waypoints[currentStopIndex + 1] || null

  const distanceToStop = gpsPos && currentTarget
    ? haversineDistance(gpsPos.lat, gpsPos.lng, currentTarget.lat, currentTarget.lng)
    : null

  const isNearDestination = distanceToStop != null && distanceToStop <= ARRIVAL_RADIUS_M

  // Track heading & course angle for Google Maps style Course-Up navigation
  useEffect(() => {
    if (!gpsPos) return
    let newHeading = null

    // 1. Valid hardware GPS heading: [0, 360) where 0 is True North
    const hasValidGpsHeading =
      typeof gpsPos.heading === 'number' &&
      !Number.isNaN(gpsPos.heading) &&
      gpsPos.heading >= 0 &&
      gpsPos.heading < 360

    if (hasValidGpsHeading) {
      newHeading = gpsPos.heading
    } else if (prevGpsPosRef.current) {
      const dist = haversineDistance(prevGpsPosRef.current.lat, prevGpsPosRef.current.lng, gpsPos.lat, gpsPos.lng)
      if (dist >= 1.5) {
        newHeading = calculateBearing(prevGpsPosRef.current.lat, prevGpsPosRef.current.lng, gpsPos.lat, gpsPos.lng)
      }
    }

    // 2. Initial startup fallback: only query route geometry or currentTarget if we have NEVER established a heading yet.
    // If vehicle is stationary and already had an established heading, keep the existing heading to avoid sudden flips.
    if (newHeading == null && resolvedHeadingRef.current == null) {
      if (orsData?.geometry) {
        try {
          const pts = decodePolyline(orsData.geometry)
          if (pts.length >= 2) {
            newHeading = calculateBearing(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
          }
        } catch { }
      }

      const orsStepBearing = orsData?.segments?.[0]?.steps?.[0]?.bearing_after
      if (newHeading == null && orsStepBearing != null && !Number.isNaN(orsStepBearing)) {
        newHeading = orsStepBearing
      } else if (newHeading == null && currentTarget) {
        const distToCurrent = haversineDistance(gpsPos.lat, gpsPos.lng, currentTarget.lat, currentTarget.lng)
        if (distToCurrent < 15 && nextTarget) {
          newHeading = calculateBearing(gpsPos.lat, gpsPos.lng, nextTarget.lat, nextTarget.lng)
        } else {
          newHeading = calculateBearing(gpsPos.lat, gpsPos.lng, currentTarget.lat, currentTarget.lng)
        }
      }
    }

    if (newHeading != null) {
      const unwrapped = getShortestAngle(resolvedHeadingRef.current ?? newHeading, newHeading)
      resolvedHeadingRef.current = unwrapped
      setMapHeading(unwrapped)
    }
    prevGpsPosRef.current = gpsPos
  }, [gpsPos, currentTarget, nextTarget, orsData])

  useEffect(() => { persistStopStatuses(stopStatuses) }, [stopStatuses])

  const getStopStatus = useCallback((wpIndex) => {
    if (stopStatuses.has(wpIndex)) return normalizeStopStatus(stopStatuses.get(wpIndex))
    return 'PENDING_INSPECTION'
  }, [stopStatuses])

  const getRoutableIndices = useCallback(() => {
    const wps = schedule?.waypoints || []
    const indices = []
    for (let i = 1; i < wps.length; i += 1) {
      if (isRoutableStopStatus(getStopStatus(i))) indices.push(i)
    }
    return indices
  }, [schedule?.waypoints, getStopStatus])

  const syncPickupStatuses = useCallback(async () => {
    if (!schedule?.id) return
    const scheduleId = String(schedule.id)
    const [currentRes, validationRes] = await Promise.all([
      api.get('/api/driver/stops/current/').catch(() => ({ data: null })),
      api.get(`/api/watcher/stop-validations/?schedule_id=${encodeURIComponent(scheduleId)}`).catch(() => ({ data: null })),
    ])
    const serverStopIndex = Number(currentRes.data?.order)
    const rows = validationRes.data?.results ?? validationRes.data ?? []
    const snapshot = buildStopValidationSnapshot(rows)

    schedule?.waypoints?.forEach((wp, i) => {
      if (i === 0) return // skip depot
      const wpIndex = i
      if (!wp.watcher_names && !snapshot.statusMap.has(`${schedule.id}:${wpIndex}`)) {
        // No watcher assigned and no validation exists -> auto-mark as empty
        snapshot.statusMap.set(`${schedule.id}:${wpIndex}`, 'EMPTY_STOP')
      }
    })

    // Dynamic routing: keep the active target while it is still routable; once it
    // is resolved, pick the nearest remaining routable stop from the live GPS fix
    // (server order is only a fallback when there is no GPS).
    {
      const stored = parseInt(sessionStorage.getItem('ww_current_stop_index') || '1', 10)
      const statusByIdx = new Map()
      snapshot.statusMap.forEach((st, key) => {
        const o = Number(String(key).split(':')[1])
        if (!Number.isNaN(o)) statusByIdx.set(o, st)
      })
      if (!isRoutableStopStatus(getResolvedStopStatus(statusByIdx, stored))) {
        const gps = gpsPosRef.current
        let pick = pickNearestRoutableIndex({
          waypoints: schedule?.waypoints, stopStatuses: statusByIdx, gps, excludeIndex: stored,
        })
        if (pick == null && !gps && Number.isInteger(serverStopIndex) && serverStopIndex > 0) pick = serverStopIndex
        if (pick != null && pick !== stored) {
          setCurrentStopIndex(pick)
          sessionStorage.setItem('ww_current_stop_index', String(pick))
        }
      }
    }
    setStopDetailsMap(snapshot.detailsMap)
    stopDetailsMapRef.current = snapshot.detailsMap
    setStopStatuses(prev => {
      const next = new Map(prev)
      snapshot.statusMap.forEach((status, key) => {
        const stopOrder = Number(String(key).split(':')[1])
        if (Number.isNaN(stopOrder)) return
        next.set(stopOrder, status)
      })
      return next
    })
    setStatusesSynced(true)
  }, [schedule?.id])

  const repaintMarker = useCallback((wpIndex, status, detailsOverride) => {
    const marker = stopMarkersRef.current.get(wpIndex)
    const safeStatus = normalizeStopStatus(status)
    if (!marker || !window.L) return
    const details = detailsOverride ?? stopDetailsMapRef.current.get(`${schedule?.id}:${wpIndex}`)
    const isActive = wpIndex === currentStopIndex && isRoutableStopStatus(safeStatus)
    const colorEntry = STOP_COLORS[safeStatus] || STOP_COLORS.PENDING_INSPECTION
    const isSatellite = mapType === 'satellite'
    marker.setIcon(window.L.divIcon({
      html: stopMarkerHTML(wpIndex, safeStatus, details, isActive, isSatellite),
      className: 'ww-stop-div-icon',
      iconSize: isActive ? [28, 28] : [24, 24],
      iconAnchor: isActive ? [14, 14] : [12, 12],
    }))
    const displayColor = safeStatus === 'PENDING_INSPECTION' ? '#94a3b8' : colorEntry.bg
    const popupHtml = `
      <b>${waypoints[wpIndex]?.label || ('Stop ' + wpIndex)}</b>
      <br/><span style="font-size:11px;color:${displayColor};font-weight:700;text-transform:uppercase">${STOP_STATUS_LABELS[safeStatus] || safeStatus}</span>
      ${safeStatus === 'PENDING_INSPECTION' ? `<div style="margin-top:6px;font-size:10px;color:#f59e0b;font-weight:bold;">Pending Verification by: ${waypoints[wpIndex]?.watcher_names || 'Unknown'}</div>` : ''}
      ${details?.collectedAt ? `<div style="margin-top:6px;font-size:11px;color:#10b981">Reported: ${details.collectedAt}</div>` : ''}
      <div style="font-size:11px;color:#64748b;margin-top:2px;">Truck: ${details?.truck || schedule?.truck_plate || 'Unknown'}</div>
    `
    marker.getPopup()?.setContent(popupHtml)
  }, [waypoints, schedule, currentStopIndex, mapType])

  useEffect(() => {
    if (!window.L || stopMarkersRef.current.size === 0) return
    const prev = prevStopIndexRef.current
    prevStopIndexRef.current = currentStopIndex
    if (prev !== currentStopIndex && prev >= 1) repaintMarker(prev, getStopStatus(prev))
    if (currentStopIndex >= 1) repaintMarker(currentStopIndex, getStopStatus(currentStopIndex))
  }, [currentStopIndex, getStopStatus, repaintMarker])

  useEffect(() => {
    if (!window.L || stopMarkersRef.current.size === 0) return
    stopMarkersRef.current.forEach((_, wpIndex) => repaintMarker(wpIndex, getStopStatus(wpIndex)))
  }, [stopStatuses, getStopStatus, repaintMarker])

  // 1. Leaflet CDN
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return }
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' })
    document.head.appendChild(link)
    const script = Object.assign(document.createElement('script'), { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', onload: () => setLeafletReady(true) })
    document.head.appendChild(script)
  }, [])

  // 2. Fetch schedule
  useEffect(() => {
    if (!user?.id) return
    setMapLoading(true)
    api.get('/api/driver/collection-schedules/?paginate=false')
      .then(async res => {
        const match = resolveDriverSchedule(
          res.data,
          user.id,
          activeScheduleId ?? shift?.schedule_id ?? shift?.schedule ?? null
        )
        setSchedule(match || null)
        const currentStopRes = await api.get('/api/driver/stops/current/').catch(() => ({ data: null }))
        const backendIndex = Number(currentStopRes.data?.order)
        const saved = sessionStorage.getItem('ww_current_stop_index')
        const idx = Number.isInteger(backendIndex) && backendIndex > 0
          ? backendIndex : saved ? parseInt(saved, 10) : (match?.waypoints?.length > 1 ? 1 : 0)
        setCurrentStopIndex(idx)
        sessionStorage.setItem('ww_current_stop_index', String(idx))
        if (currentStopRes.data?.id) sessionStorage.setItem('ww_pending_collection_stop_id', String(currentStopRes.data.id))
        try {
          const valRes = await api.get(`/api/watcher/stop-validations/?schedule_id=${encodeURIComponent(match?.id || '')}`)
          const rows = valRes.data?.results ?? valRes.data ?? []
          const snapshot = buildStopValidationSnapshot(rows)

          match?.waypoints?.forEach((wp, i) => {
            if (i === 0) return // skip depot
            const wpIndex = i
            if (!wp.watcher_names && !snapshot.statusMap.has(`${match.id}:${wpIndex}`)) {
              // No watcher assigned and no validation exists -> auto-mark as empty
              snapshot.statusMap.set(`${match.id}:${wpIndex}`, 'EMPTY_STOP')
            }
          })

          setStopDetailsMap(snapshot.detailsMap)
          stopDetailsMapRef.current = snapshot.detailsMap
          const statusMap = new Map()
          snapshot.statusMap.forEach((status, key) => {
            const stopOrder = Number(String(key).split(':')[1])
            if (!Number.isNaN(stopOrder)) statusMap.set(stopOrder, status)
          })
          setStopStatuses(statusMap)
          setStatusesSynced(true)
        } catch { }
      })
      .catch(() => setSchedule(null))
      .finally(() => setMapLoading(false))
  }, [user?.id])

  useEffect(() => {
    if (!schedule?.id) return () => { }
    let alive = true
    const refresh = async () => { try { await syncPickupStatuses() } catch (err) { if (alive) console.error('[ShiftRouteModule] pickup sync error', err) } }
    refresh()
    const intv = setInterval(refresh, 8000)
    const unsubscribe = subscribePickupStatusSync(() => refresh())
    return () => { alive = false; clearInterval(intv); unsubscribe() }
  }, [schedule?.id, syncPickupStatuses])

  // 3a. Init map — ONLY creates the L.map instance. Driver marker placement
  // is handled separately below so it always uses the real GPS position.
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return
    const L = window.L
    const pos = gpsPosRef.current
    const map = L.map(mapRef.current, {
      center: pos ? [pos.lat, pos.lng] : [13.9373, 121.617],
      zoom: 17.5,
      zoomControl: false,
    })
    applyMapTileLayer(map, mapType, baseTileLayerRef)

    // User drag / zoom listener: pause auto follow-cam so user can freely explore
    const pauseFollow = () => {
      isFollowCamRef.current = false
      setIsUserPanned(true)
    }
    map.on('dragstart zoomstart movestart', (e) => {
      if (e.originalEvent || e.type === 'dragstart' || e.type === 'zoomstart') {
        pauseFollow()
      }
    })

    mapInstance.current = map
    setMapReady(true)
    setTimeout(() => map.invalidateSize(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, schedule])

  useEffect(() => {
    if (!leafletReady || !mapInstance.current) return
    applyMapTileLayer(mapInstance.current, mapType, baseTileLayerRef)
    stopMarkersRef.current.forEach((_, wpIndex) => {
      repaintMarker(wpIndex, getStopStatus(wpIndex))
    })
  }, [mapType, leafletReady, repaintMarker, getStopStatus])


  // ── Online / offline listener — triggers ORS retry on reconnect ─────────
  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); setOrsFetchKey(k => k + 1) }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // GPS fix forwarding to RouteRequestManager for local progress tracking and off-route detection
  useEffect(() => {
    if (!gpsPos) return
    routeManagerRef.current?.handleGpsUpdate(
      gpsPos,
      isMock ? null : gpsAccuracy,
      { isMock }
    )
  }, [gpsPos, gpsAccuracy, isMock])
  // ── FIX 4: Driver marker creation is now DECOUPLED from map init. ─────────
  // This effect waits until BOTH mapInstance.current and gpsPos are non-null
  // before creating the marker. If gpsPos arrives after the map, the marker
  // is created at the correct real position. If the map isn't ready yet when
  // gpsPos first arrives, this effect re-runs once the map is ready.
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !window.L) return
    if (driverMarker.current) return // already created — movement handled below

    const L = window.L
    const pos = gpsPos || gpsPosRef.current
    const startPos = pos
      ? [pos.lat, pos.lng]
      : mapInstance.current.getCenter()

    const heading = resolvedHeadingRef.current ?? pos?.heading ?? mapHeading ?? 0
    const driverIcon = getVehicleMarkerIcon(L, heading, is3D, mapHeading)

    driverMarker.current = L.marker(startPos, {
      icon: driverIcon,
      zIndexOffset: 1000,
    }).addTo(mapInstance.current)

    // Pan to the real GPS position immediately on first fix at close-up street level
    if (pos && routeState === 'navigating') {
      mapInstance.current.setView([pos.lat, pos.lng], is3D ? 18 : 17.5)
    }

    // Initialize unified NavCamera controller
    if (!navCameraRef.current && viewportRef.current && mapRef.current) {
      navCameraRef.current = new NavCamera({
        viewportEl: viewportRef.current,
        mapEl: mapRef.current,
        getMap: () => mapInstance.current,
        getMarker: () => driverMarker.current,
        onModeChange: (mode) => {
          if (mode === '2D') {
            setIs3D(false)
          }
        },
      })
      if (pos) {
        navCameraRef.current.setTargetPosition(pos.lat, pos.lng)
      }
      navCameraRef.current.setTargetHeading(heading)
      const initialMode = navCameraRef.current.setMode(is3D ? '3D' : '2D')
      if (is3D && initialMode !== '3D') {
        setIs3D(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, gpsPos, mapReady])

  // 3b. Draw stop markers
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !window.L || !schedule) return
    stopMarkersRef.current.forEach(marker => { try { mapInstance.current.removeLayer(marker) } catch { } })
    stopMarkersRef.current.clear()
    const L = window.L
    const wps = schedule.waypoints || []
    wps.slice(1).forEach((wp, i) => {
      const wpIndex = i + 1
      const status = getStopStatus(wpIndex)
      const isActive = wpIndex === currentStopIndex && isRoutableStopStatus(status)
      const details = stopDetailsMapRef.current.get(`${schedule?.id}:${wpIndex}`)
      const safeStatus = normalizeStopStatus(status)
      const colorEntry = STOP_COLORS[safeStatus] || STOP_COLORS.PENDING_INSPECTION
      const displayColor = safeStatus === 'PENDING_INSPECTION' ? '#94a3b8' : colorEntry.bg
      const icon = L.divIcon({
        html: stopMarkerHTML(wpIndex, status, details, isActive, mapType === 'satellite'),
        className: 'ww-stop-div-icon',
        iconSize: isActive ? [28, 28] : [24, 24],
        iconAnchor: isActive ? [14, 14] : [12, 12],
      })
      const marker = L.marker([wp.lat, wp.lng], { icon })
        .addTo(mapInstance.current)
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:180px;">
            <b style="font-size:13px;">${wp.label || ('Stop ' + wpIndex)}</b><br/>
            <span style="font-size:11px;color:${displayColor};font-weight:700;text-transform:uppercase">
              ${STOP_STATUS_LABELS[safeStatus] || safeStatus}
            </span>
            ${safeStatus === 'PENDING_INSPECTION' ? `<div style="margin-top:6px;font-size:10px;color:#f59e0b;font-weight:bold;">Pending Verification by: ${wp.watcher_names || 'Unknown'}</div>` : ''}
            ${details?.collectedAt ? `<div style="margin-top:6px;font-size:11px;color:#10b981">Reported: ${details.collectedAt}</div>` : ''}
            <div style="font-size:11px;color:#64748b;margin-top:2px;">Truck: ${details?.truck || schedule?.truck_plate || 'Unknown'}</div>
          </div>`)
      stopMarkersRef.current.set(wpIndex, marker)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, mapReady, mapType])

  // 3c. Floating missed-stop markers (reassigned from other routes)
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !window.L) return
    const L = window.L

    // Clean up old floating markers before re-rendering
    floatingMarkersRef.current.forEach(m => { try { mapInstance.current.removeLayer(m) } catch { } })
    floatingMarkersRef.current.clear()

    floatingMissedStops.forEach(wp => {
      if (!wp.lat || !wp.lng) return
      const id = wp.pickup_status_id ?? wp.stop_order
      const html = `
        <div style="position:relative;width:28px;height:28px;">
          <div style="position:absolute;inset:-6px;border-radius:50%;
            border:2.5px solid #ef4444;animation:wwMarkerPulse 1.6s ease infinite;pointer-events:none;"></div>
          <div style="position:absolute;inset:0;background:#ef4444;border:2px solid #fff;
            border-radius:50%;display:flex;align-items:center;justify-content:center;
            font-size:13px;font-weight:900;color:#fff;box-shadow:0 2px 10px rgba(239,68,68,0.5);">
            ×
          </div>
        </div>`

      const marker = L.marker([Number(wp.lat), Number(wp.lng)], {
        icon: L.divIcon({ html, className: 'ww-floating-missed-icon', iconSize: [28, 28], iconAnchor: [14, 14] }),
        zIndexOffset: 800,
      })
        .addTo(mapInstance.current)
        .on('click', () => {
          setActiveMissedStop(wp)
        })
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:180px;">
            <b style="font-size:13px;">⚠ Missed Stop</b><br/>
            <span style="font-size:12px;color:#64748b;">${wp.label || 'Unlabelled stop'}</span><br/>
            <span style="font-size:11px;color:#ef4444;font-weight:700;">Available for collection</span>
            <div style="margin-top:6px;font-size:10px;color:#94a3b8;">
              This stop was missed by another driver.<br/>Click "Confirm on Arrival" below to collect it.
            </div>
          </div>`)

      floatingMarkersRef.current.set(id, marker)
    })
  }, [floatingMissedStops, mapReady])

  // ── Helper: build the ordered coordinate list for ORS / fallback ─────────
  const buildRouteCoords = useCallback(() => {
    const startLng = Number(gpsPosRef.current?.lng ?? waypoints[0]?.lng ?? 121.617)
    const startLat = Number(gpsPosRef.current?.lat ?? waypoints[0]?.lat ?? 13.9373)
    if (activeMissedStop) {
      const target = [Number(activeMissedStop.lng), Number(activeMissedStop.lat)]
      return { startLat, startLng, remaining: [target], orsCoords: [[startLng, startLat], target] }
    }
    if (!resolvedNavTarget.hasValidCoords || !resolvedNavTarget.coords) {
      return { startLat, startLng, remaining: [], orsCoords: [[startLng, startLat]] }
    }
    const target = resolvedNavTarget.coords
    const orsCoords = [[startLng, startLat], target]
    return { startLat, startLng, remaining: [target], orsCoords }
  }, [waypoints, activeMissedStop, resolvedNavTarget])

  // ── Shared traversal: the physical stop sequence from currentTarget onward,
  // regardless of watcher/validation status. Used by BOTH the leg pre-cache
  // (4b) and the draw loop (drawAllLegs) so their keys always agree.
  const getAheadSequence = useCallback(() => {
    if (!currentTarget) return []
    if (activeMissedStop) return []
    const rest = waypoints
      .map((wp, idx) => ({ wp, idx }))
      .filter(({ idx, wp }) => idx > currentStopIndex && wp.lat != null && wp.lng != null)
    return [{ wp: currentTarget, idx: currentStopIndex }, ...rest]
  }, [waypoints, currentStopIndex, currentTarget, activeMissedStop])


  // ── Single authoritative draw function for all route legs ─────────────────
  //
  // Leg 0  (GPS → currentTarget) — always drawn when currentTarget exists,
  //   regardless of watcher/validation status.  Uses lastOrsGeometryRef (Fix 1).
  // Legs 1+ (stop → stop ahead) — uses raw waypoints, NOT getRoutableIndices,
  //   so PENDING_INSPECTION / EMPTY_STOP stops don't suppress the route line.
  //
  // Current leg:  solid/dashed bright blue (#3b82f6 / #94a3b8)
  // Upcoming legs: solid/dashed sky-blue  (#bfdbfe) — visually subordinate
  const drawAllLegs = useCallback(() => {
    if (!mapReady || !mapInstance.current || !window.L) return
    const L = window.L

    // Clear all managed leg layers
    cachedLegLayersRef.current.forEach(layer => {
      try { mapInstance.current.removeLayer(layer) } catch { }
    })
    cachedLegLayersRef.current = []
    if (routeLayer.current) {
      try { mapInstance.current.removeLayer(routeLayer.current) } catch { }
      routeLayer.current = null
    }
    if (fallbackRouteLayer.current) {
      try { mapInstance.current.removeLayer(fallbackRouteLayer.current) } catch { }
      fallbackRouteLayer.current = null
    }

    const driverLat = gpsPosRef.current?.lat ?? waypoints[0]?.lat ?? 13.9373
    const driverLng = gpsPosRef.current?.lng ?? waypoints[0]?.lng ?? 121.617

    // ── Leg 0: GPS → currentTarget ────────────────────────────────────────────
    if (currentTarget) {
      const targetKey = `${currentTarget.lat},${currentTarget.lng}`
      if (lastOrsGeometryRef.current?.key === targetKey) {
        const pts = decodePolyline(lastOrsGeometryRef.current.geometry)
        const layer = L.polyline(pts, { color: '#3b82f6', weight: 6, opacity: 0.85 }).addTo(mapInstance.current)
        cachedLegLayersRef.current.push(layer)
      } else {
        const layer = L.polyline(
          [[driverLat, driverLng], [currentTarget.lat, currentTarget.lng]],
          { color: '#94a3b8', weight: 3, opacity: 0.5, dashArray: '2 8' }
        ).addTo(mapInstance.current)
        cachedLegLayersRef.current.push(layer)
      }
    }

    // ── Legs 1+: physical stop sequence ahead, watcher-status-agnostic ───────
    const ahead = getAheadSequence()

    for (let i = 0; i < ahead.length - 1; i++) {
      const { wp: fromWp, idx: fromIdx } = ahead[i]
      const { wp: toWp, idx: toIdx } = ahead[i + 1]
      const legKey = `${fromIdx}-${toIdx}`
      const cached = routeLegCacheRef.current.get(legKey)
      if (cached?.geometry) {
        const pts = decodePolyline(cached.geometry)
        const layer = L.polyline(pts, { color: '#bfdbfe', weight: 4, opacity: 0.75, dashArray: '10 6' }).addTo(mapInstance.current)
        cachedLegLayersRef.current.push(layer)
      } else {
        const layer = L.polyline(
          [[fromWp.lat, fromWp.lng], [toWp.lat, toWp.lng]],
          { color: '#bfdbfe', weight: 3, opacity: 0.4, dashArray: '2 10' }
        ).addTo(mapInstance.current)
        cachedLegLayersRef.current.push(layer)
      }
    }
  }, [mapReady, currentStopIndex, currentTarget, waypoints, getAheadSequence])


  // ── 4a. RouteRequestManager Integration ────────────────────────────────────
  //
  // Manages single-flight ORS route requests, target caching, auto-reroute cooldown,
  // exponential backoff with jitter, and 10s-paced background pre-caching.
  //
  // Binding Owner Decision A1: If resolvedNavTarget.isRoutable is false, route
  // requests are suppressed; fallback geometry remains visible.
  const routeManagerRef = useRef(null)
  const drawAllLegsRef = useRef(drawAllLegs)
  useLayoutEffect(() => {
    drawAllLegsRef.current = drawAllLegs
  })

  useEffect(() => {
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return

    const manager = new RouteRequestManager({
      apiKey: orsApiKey,
      initialGps: gpsPosRef.current || gpsPos,
      initialAccuracy: isMock ? null : gpsAccuracy,
      initialIsMock: isMock,
      initialIsOnline: isOnline,
      initialTarget: mapReady ? resolvedNavTarget : null,
      onRouteSuccess: ({ route, target }) => {
        setOrsData(route)
        if (target?.targetKey) {
          lastOrsGeometryRef.current = { key: target.targetKey, geometry: route.geometry }
        }
        drawAllLegsRef.current?.()
      },
      onPrecacheSuccess: ({ legKey, route }) => {
        routeLegCacheRef.current.set(legKey, { geometry: route.geometry })
        drawAllLegsRef.current?.()
      },
      onRouteError: (err) => {
        console.warn('[RouteManager] Request failed:', err.error?.message)
      },
    })
    routeManagerRef.current = manager

    return () => {
      manager.destroy()
      routeManagerRef.current = null
    }
  }, []) // Stable manager lifecycle: mounted component lifecycle

  // Sync online status to RouteRequestManager
  useEffect(() => {
    routeManagerRef.current?.setOnline(isOnline)
  }, [isOnline])

  // Sync active navigation target to RouteRequestManager
  useEffect(() => {
    if (!mapReady) return
    routeManagerRef.current?.setTarget(resolvedNavTarget)
  }, [resolvedNavTarget.targetId, resolvedNavTarget.targetKey, resolvedNavTarget.isRoutable, mapReady])

  // Sync upcoming legs to pre-cache queue
  useEffect(() => {
    if (!schedule?.id || !mapReady || !isOnline) return
    routeManagerRef.current?.updatePrecacheSequence(waypoints, currentStopIndex)
  }, [schedule?.id, mapReady, isOnline, currentStopIndex, waypoints])

  // 4c. Hydrate current-leg geometry from sessionStorage after currentTarget resolves.
  //
  // Deferred until AFTER schedule + stop-index loads (both async) so currentTarget
  // is stable.  Only hydrates if the persisted key matches — prevents restoring a
  // stale leg from a previous session (Fix 3).
  useEffect(() => {
    if (!currentTarget || !mapReady) return
    const targetKey = `${currentTarget.lat},${currentTarget.lng}`
    if (lastOrsGeometryRef.current?.key === targetKey) return // already in memory
    try {
      const saved = JSON.parse(sessionStorage.getItem('ww_ors_route') || 'null')
      if (saved?.key === targetKey) {
        lastOrsGeometryRef.current = saved
        drawAllLegs()
      }
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTarget?.lat, currentTarget?.lng, mapReady, drawAllLegs])

  // 5a. Move driver marker coordinate — runs on gpsPos updates (zero icon recreation, zero layout thrashing)
  useEffect(() => {
    if (!gpsPos || !driverMarker.current) return
    driverMarker.current.setLatLng([gpsPos.lat, gpsPos.lng])

    // Only auto-pan camera if user hasn't panned away
    if (routeState === 'navigating' && isFollowCamRef.current && mapInstance.current) {
      if (!navCameraRef.current || navCameraRef.current.mode === '2D') {
        mapInstance.current.panTo([gpsPos.lat, gpsPos.lng], { animate: true, duration: 0.4 })
      }
    }
    if (navCameraRef.current) {
      navCameraRef.current.follow = isFollowCamRef.current
      navCameraRef.current.setTargetPosition(gpsPos.lat, gpsPos.lng)
    }
  }, [gpsPos, routeState])

  // 5b. Update driver marker icon ONLY when visual representation actually changes
  // Mode/avatar toggles reconstruct icon; continuous heading is driven by NavCamera's rAF loop
  const lastIconStateRef = useRef({ heading: null, is3D: null, avatarMode: null })
  useEffect(() => {
    if (!driverMarker.current || !window.L) return

    const currentHeading = resolvedHeadingRef.current ?? mapHeading ?? 0
    const prev = lastIconStateRef.current

    const modeChanged = prev.is3D !== is3D
    const avatarChanged = prev.avatarMode !== markerAvatarMode
    const headingChanged = prev.heading == null || Math.abs(currentHeading - prev.heading) >= 0.5

    if (modeChanged || avatarChanged) {
      lastIconStateRef.current = {
        heading: currentHeading,
        is3D,
        avatarMode: markerAvatarMode,
      }
      driverMarker.current.setIcon(getVehicleMarkerIcon(window.L, currentHeading, is3D, mapHeading))
    }

    if (navCameraRef.current) {
      navCameraRef.current.setTargetHeading(currentHeading)
      navCameraRef.current.apply()
    } else if (headingChanged) {
      const el = driverMarker.current.getElement()
      const wrapper = el?.querySelector('.ww-truck-sprite-wrapper') || el?.querySelector('.ww-3d-truck-wrapper')
      if (wrapper) {
        wrapper.style.transform = `rotate(${currentHeading}deg)`
      }
    }
  }, [mapHeading, is3D, markerAvatarMode])

  // 5c. Mode synchronization: removed duplicate setMode() call;
  // the explicit toggle handler (handleToggle3D) is the single authority for NavCamera.setMode().

  // 6. Cleanup
  useEffect(() => () => {
    if (navCameraRef.current) {
      navCameraRef.current.destroy()
      navCameraRef.current = null
    }
    if (orsRetryTimerRef.current) clearTimeout(orsRetryTimerRef.current)
    cachedLegLayersRef.current.forEach(layer => {
      try { mapInstance.current?.removeLayer(layer) } catch { }
    })
    cachedLegLayersRef.current = []
    if (mapInstance.current) {
      mapInstance.current.remove()
      mapInstance.current = null
    }
    driverMarker.current = null
    fallbackRouteLayer.current = null
    routeLayer.current = null
  }, [])

  const teleportTo = useCallback((wp) => {
    if (!wp) return
    setMockGps({ lat: Number(wp.lat), lng: Number(wp.lng) })
    mapInstance.current?.panTo([Number(wp.lat), Number(wp.lng)])
    setOrsFetchKey(k => k + 1)
  }, [])

  const clearMock = useCallback(() => {
    setMockGps(null)
    setOrsFetchKey(k => k + 1)
  }, [])

  // Stage 2D-B2: Explicit 2D/3D camera mode toggle (single authority for NavCamera.setMode)
  const handleToggle3D = useCallback(() => {
    isFollowCamRef.current = true
    setIsUserPanned(false)

    if (navCameraRef.current) {
      navCameraRef.current.follow = true
      const targetMode = (navCameraRef.current.mode === '3D' || is3D) ? '2D' : '3D'
      const actualMode = navCameraRef.current.setMode(targetMode)
      setIs3D(actualMode === '3D')
    } else {
      if (mapInstance.current && gpsPos) {
        mapInstance.current.setView([gpsPos.lat, gpsPos.lng], 17.5, { animate: true })
        setTimeout(() => mapInstance.current?.invalidateSize(), 300)
      }
      setIs3D(false)
    }
  }, [is3D, gpsPos])

  const markRemainingMissed = useCallback((fromIndex) => {
    setStopStatuses(prev => {
      const next = new Map(prev)
      waypoints.slice(fromIndex).forEach((_, i) => {
        const idx = fromIndex + i
        if (isRoutableStopStatus(next.get(idx))) {
          next.set(idx, 'COLLECTION_DISPUTED')
          repaintMarker(idx, 'COLLECTION_DISPUTED')
        }
      })
      return next
    })
  }, [waypoints, repaintMarker])

  useEffect(() => {
    if (!shiftActive && waypoints.length > 0) markRemainingMissed(currentStopIndex)
  }, [shiftActive]) // eslint-disable-line

  function handleArrived() {
    if (currentTarget) sessionStorage.setItem('ww_current_stop', currentTarget.label || `Stop ${currentStopIndex}`)
    if (gpsPos) {
      sessionStorage.setItem('ww_gps_lat', String(gpsPos.lat))
      sessionStorage.setItem('ww_gps_lng', String(gpsPos.lng))
    }
    setRouteState('arrived')
  }

  async function handleCollectMissedStop() {
    // Route through the ArrivedOverlay photo flow — same as a normal stop.
    // The overlay's onConfirm will call /missed-stops/<id>/collect/ after uploading the photo.
    if (gpsPos) {
      sessionStorage.setItem('ww_gps_lat', String(gpsPos.lat))
      sessionStorage.setItem('ww_gps_lng', String(gpsPos.lng))
    }
    setRouteState('arrived')
  }

  function handleCollectClick() {
    if (activeMissedStop) {
      handleCollectMissedStop()
      return
    }
    const currentStatus = getStopStatus(currentStopIndex);
    if (currentStatus === 'PENDING_INSPECTION') {
      if (currentTarget?.watcher_names === 'No assigned watcher') {
        sessionStorage.setItem('ww_override_reason', '[OVERRIDE: No Watcher] ');
        handleArrived();
      } else {
        setShowOverrideConfirm(true);
      }
    } else {
      sessionStorage.removeItem('ww_override_reason');
      handleArrived();
    }
  }

  function handleCollectionConfirmed(missedStopResolved = true) {
    if (activeMissedStop) {
      if (missedStopResolved) {
        // Missed stop: show a toast, remove from floating list, clear active target
        notify({ variant: 'success', message: `🎯 Missed stop collected! +50 pts` })

        // Update local storage so the dashboard immediately shows the new count
        const localCount = parseInt(sessionStorage.getItem('ww_missed_stops_collected') || '0', 10)
        sessionStorage.setItem('ww_missed_stops_collected', String(localCount + 1))

        setFloatingMissedStops(prev => prev.filter(s => s.id !== activeMissedStop.id))
      }
      // Either way, stop targeting it — the poller will re-surface it if still PENDING
      setActiveMissedStop(null)
      setRouteState('navigating')
      return
    }
    setStopStatuses(prev => {
      const next = new Map(prev)
      try {
        const saved = sessionStorage.getItem('ww_stop_statuses')
        const parsed = saved ? new Map(JSON.parse(saved)) : new Map()
        parsed.set(currentStopIndex, 'COLLECTION_REPORTED')
        sessionStorage.setItem('ww_stop_statuses', JSON.stringify([...parsed]))
      } catch { }
      next.set(currentStopIndex, 'COLLECTION_REPORTED')

      // ── Auto-detect route completion ────────────────────────────────────────
      // Check if every non-depot waypoint is now completed after this confirmation.
      const allWaypoints = schedule?.waypoints || []
      const stopCount = allWaypoints.length - 1 // exclude depot at index 0
      if (stopCount > 0) {
        let completedCount = 0
        for (let i = 1; i <= stopCount; i++) {
          const s = normalizeStopStatus(next.get(i))
          if (isCompletedStopStatus(s) || s === 'EMPTY_STOP') completedCount++
        }
        if (completedCount >= stopCount) {
          // All stops done — snapshot, mark route complete, go straight to EndShiftModule
          try { sessionStorage.setItem('ww_stop_statuses_snapshot', JSON.stringify([...next])) } catch { }
          sessionStorage.setItem('ww_route_complete', 'true')
          // Defer so state update from setStopStatuses settles first
          setTimeout(() => {
            handleEndShift()
          }, 400)
          return next
        }
      }
      // ── Not yet complete — show StopCompletedOverlay as usual ───────────────
      return next
    })
    repaintMarker(currentStopIndex, 'COLLECTION_REPORTED')
    setRouteState('completed')
  }

  function handleDevSkipStop() {
    if (nextTarget) {
      teleportTo(nextTarget)
      handleNextStop()
    }
  }

  function handleNextStop() {
    // Dynamic routing: next target is the nearest remaining routable stop by distance
    const nearest = pickNearestRoutableIndex({
      waypoints: schedule?.waypoints,
      stopStatuses,
      gps: gpsPosRef.current || gpsPos,
      excludeIndex: currentStopIndex,
    })
    const nextIndex = nearest != null ? nearest : (schedule?.waypoints || []).length
    setCurrentStopIndex(nextIndex)
    sessionStorage.setItem('ww_current_stop_index', String(nextIndex))
    sessionStorage.removeItem('ww_pending_collection_note')
    sessionStorage.removeItem('ww_pending_collection_stop_id')
    sessionStorage.removeItem('ww_pending_collection_at')
    const total = (schedule?.waypoints || []).length - 1
    const completedCount = nextIndex - 1
    sessionStorage.setItem('ww_completed_stops', String(completedCount))
    sessionStorage.setItem('ww_total_stops', String(total))
    sessionStorage.setItem('ww_route_complete', completedCount >= total ? 'true' : 'false')
    setOrsFetchKey(k => k + 1)
    setRouteState('navigating')
  }

  async function handleEndShift() {
    const routeComplete = sessionStorage.getItem('ww_route_complete') === 'true'
    let missedStopOrders = []

    if (!routeComplete) {
      missedStopOrders = getRoutableIndices().filter(idx => idx >= currentStopIndex)
      setStopStatuses(prev => {
        const next = new Map(prev)
        missedStopOrders.forEach(idx => {
          if (isMissedStopStatus(normalizeStopStatus(prev.get(idx)))) {
            next.set(idx, 'DRIVER_MISSED')
            repaintMarker(idx, 'DRIVER_MISSED')
          }
        })
        try { sessionStorage.setItem('ww_stop_statuses_snapshot', JSON.stringify([...next])) } catch { }
        return next
      })
    } else {
      try { sessionStorage.setItem('ww_stop_statuses_snapshot', JSON.stringify([...stopStatuses])) } catch { }
    }

    onAdvance('end_shift')
  }

  // Called when extended_mode API succeeds
  function handleExtendedModeActivated() {
    sessionStorage.setItem('ww_extended_mode', 'true')
    sessionStorage.removeItem('ww_route_complete')
    sessionStorage.removeItem('ww_pending_collection_note')
    sessionStorage.removeItem('ww_pending_collection_stop_id')
    sessionStorage.removeItem('ww_pending_collection_at')
    setOrsFetchKey(k => k + 1)
    setRouteState('navigating')
  }

  // Legacy: called from StopCompletedOverlay "I'm done" (non-route-complete path)
  async function handleExtendedMode() {
    try {
      await api.post(`/api/driver/shift/${shift.id}/extended_mode/`)
      handleExtendedModeActivated()
    } catch {
      notify({ variant: 'error-dark', message: 'Failed to activate extended mode. Please try again.' })
    }
  }

  let instructionText = 'Follow the road', instructionDist = '', stepType = 6, stepBearing = null
  let etaMinutes = '--', arrivalTimeStr = '--:--', distanceKmStr = '--'

  if (orsData) {
    const seg = orsData.segments?.[0]
    if (seg?.steps?.length) {
      const step = seg.steps[0]
      instructionText = step.instruction || 'Follow the road'
      instructionDist = step.distance != null ? `${Math.round(step.distance)} m` : ''
      stepType = step.type ?? 6
      stepBearing = step.exit_bearings?.[0] ?? step.bearing ?? null
    }
    if (seg) {
      etaMinutes = Math.ceil(seg.duration / 60)
      arrivalTimeStr = new Date(Date.now() + seg.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      distanceKmStr = (seg.distance / 1000).toFixed(1)
    }
  }

  const accentColor = TURN_COLOR[stepType] ?? '#0f172a'
  const isTargetRoutable = isRoutableStopStatus(getStopStatus(currentStopIndex))

  return (
    <>
      <div style={{
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
        background: '#1c2430',
      }}>
        {/* MAP CONTAINER WITH 3D PERSPECTIVE SUPPORT (NavCamera Unified Controller) */}
        <div
          ref={viewportRef}
          style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#1c2430', overflow: 'hidden' }}
        >
          <div
            ref={mapRef}
            onTouchStart={() => {
              if (!is3D) {
                isFollowCamRef.current = false
                setIsUserPanned(true)
                if (navCameraRef.current) navCameraRef.current.follow = false
              }
            }}
            onMouseDown={() => {
              if (!is3D) {
                isFollowCamRef.current = false
                setIsUserPanned(true)
                if (navCameraRef.current) navCameraRef.current.follow = false
              }
            }}
            onWheel={() => {
              if (!is3D) {
                isFollowCamRef.current = false
                setIsUserPanned(true)
                if (navCameraRef.current) navCameraRef.current.follow = false
              }
            }}
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              inset: 0,
            }}
          />
          <MapLegend />
          {leafletReady && (
            <MapLayerToggle
              mapType={mapType}
              onToggle={toggleMapType}
              style={{
                position: 'absolute',
                bottom: isRetracted ? 95 : 230,
                left: 14,
                zIndex: 500,
              }}
            />
          )}
          {(!leafletReady || (mapLoading && waypoints.length === 0)) && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 500 }}>
              <MapSkeleton height="100%" dark label="Initializing live route HUD..." showControls={false} />
            </div>
          )}

          {/* FLOATING MAP CONTROLS (Right side, Google Maps / Grab style HUD) */}
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
            {/* Satellite / Default Layer Toggle */}
            <button
              type="button"
              onClick={toggleMapType}
              title={`Switch to ${mapType === 'default' ? 'Satellite' : 'Default'} Map`}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: mapType === 'satellite' ? '#16a34a' : 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(10px)',
                border: mapType === 'satellite' ? '2px solid #22c55e' : '1px solid rgba(255,255,255,0.2)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease',
              }}
            >
              <Layers size={18} />
            </button>

            {/* 3D / 2D Camera Toggle */}
            <button
              type="button"
              onClick={handleToggle3D}
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

            {/* Stage 2B: Vehicle Avatar Toggle (Top-down Sprite <-> SVG Fallback) */}
            <button
              type="button"
              onClick={() => {
                setMarkerAvatarMode(prev => (prev === 'sprite-topdown' ? 'svg' : 'sprite-topdown'))
              }}
              title={`Truck Avatar: ${markerAvatarMode === 'sprite-topdown' ? '3D Model Sprite' : 'Vector SVG'}`}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: markerAvatarMode === 'svg' ? 'rgba(15, 23, 42, 0.85)' : '#0284c7',
                backdropFilter: 'blur(10px)',
                border: markerAvatarMode === 'svg' ? '1px solid rgba(255,255,255,0.2)' : '2px solid #38bdf8',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                transition: 'all 0.2s ease',
                fontFamily: 'var(--font-head)',
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: '0.02em',
              }}
            >
              {markerAvatarMode === 'sprite-topdown' ? '3D' : 'SVG'}
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

            {/* DEV CONTROLS */}
            {import.meta.env.DEV && (
              <>
                <button onClick={() => teleportTo(currentTarget)} disabled={!currentTarget} title="DEV: Teleport to Current Stop"
                  style={{ width: 44, height: 44, borderRadius: '50%', background: currentTarget ? '#f59e0b' : '#cbd5e1', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: currentTarget ? 'pointer' : 'not-allowed', boxShadow: '0 4px 12px rgba(0,0,0,.2)', color: '#fff' }}>
                  <MapPin size={18} />
                </button>
                <button onClick={handleDevSkipStop} disabled={!nextTarget} title="DEV: Teleport to Next Stop & Skip Current"
                  style={{ width: 44, height: 44, borderRadius: '50%', background: nextTarget ? '#8b5cf6' : '#cbd5e1', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: nextTarget ? 'pointer' : 'not-allowed', boxShadow: '0 4px 12px rgba(0,0,0,.2)', color: '#fff' }}>
                  <SkipForward size={18} />
                </button>
                {isMock && (
                  <button onClick={clearMock} title="Clear Mock GPS"
                    style={{ width: 44, height: 44, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', color: '#fff' }}>
                    <X size={18} />
                  </button>
                )}
                <button onClick={() => markRemainingMissed(currentStopIndex + 1)} title="Simulate shift end"
                  style={{ width: 44, height: 44, borderRadius: '50%', background: '#0f172a', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', color: '#fff' }}>
                  <Ban size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setShow3DPreview(prev => !prev)}
                  title="DEV: Inspect 3D Truck Model (Gate 1)"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: show3DPreview ? '#2563eb' : '#0f172a',
                    border: '2px solid #38bdf8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0,0,0,.3)',
                    color: '#38bdf8',
                    fontWeight: 900,
                    fontSize: 11,
                    letterSpacing: '0.04em'
                  }}
                >
                  3D
                </button>
              </>
            )}
          </div>
        </div>

        {/* RETRACTABLE STOP HEADER */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          background: 'rgba(30,42,58,0.95)',
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
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center', paddingRight: 110 }}>
              <GpsStatusPill isTracking={isTracking} error={gpsError} accuracy={gpsAccuracy} />
              <ConnPill />
              {isExtendedMode && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 20, padding: '3px 10px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'navPulse 1.5s ease infinite', display: 'inline-block' }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em' }}>COLLECTING UNCLAIMED</span>
                </div>
              )}
              <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px' }}>
                <Clock size={11} color="rgba(255,255,255,0.7)" />
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: '.04em' }}>{formattedTime}</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ marginTop: 2 }}>
                  {activeMissedStop ? <Target size={18} color="#f59e0b" /> : <MapPin size={18} color="#22c55e" />}
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>
                    {currentTarget?.label || (activeMissedStop ? 'Missed Stop' : `Stop ${currentStopIndex}`)}
                    {!activeMissedStop && getStopStatus(currentStopIndex) === 'PENDING_INSPECTION' && (
                      <span style={{
                        marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 800, verticalAlign: 'middle',
                        background: currentTarget?.watcher_names === 'No assigned watcher' ? '#ef4444' : '#f59e0b',
                        color: currentTarget?.watcher_names === 'No assigned watcher' ? '#fff' : '#0f172a'
                      }}>
                        {currentTarget?.watcher_names === 'No assigned watcher' ? 'NO WATCHER' : 'UNINSPECTED'}
                      </span>
                    )}
                  </div>
                  {activeMissedStop ? (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Unclaimed Stop</div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{currentStopIndex} of {waypoints.length - 1} · {schedule?.days || ''}</div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {[
                  { status: 'PENDING_INSPECTION', color: '#94a3b8' },
                  { status: 'READY_FOR_COLLECTION', color: '#f59e0b' },
                  { status: 'EMPTY_STOP', color: '#94a3b8' },
                  { status: 'COLLECTION_REPORTED', color: '#eab308' },
                  { status: 'VERIFIED_COLLECTED', color: '#16a34a' },
                  { status: 'COLLECTION_DISPUTED', color: '#ef4444' },
                ].map(({ status, color }) => {
                  const count = [...stopStatuses.values()].filter(s => normalizeStopStatus(s) === status).length
                  return count > 0 && (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 3, background: `${color}22`, border: `1px solid ${color}44`, borderRadius: 20, padding: '2px 8px' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                      <span style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: '.04em' }}>{count}</span>
                    </div>
                  )
                })}
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
              background: isHeaderCollapsed ? 'rgba(20,29,42,0.96)' : 'rgba(0,0,0,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <MapPin size={13} color="#22c55e" />
              <span style={{
                fontSize: 12,
                fontWeight: 800,
                color: '#ffffff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {currentTarget?.label || (activeMissedStop ? 'Missed Stop' : `Stop ${currentStopIndex}`)}
              </span>
              {isHeaderCollapsed && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                  ({currentStopIndex} of {waypoints.length - 1})
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
              <span>{isHeaderCollapsed ? 'Expand Header' : 'Collapse'}</span>
              {isHeaderCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </div>
          </div>
        </div>

        {hasNewStops && (
          <div style={{
            position: 'absolute', top: isHeaderCollapsed ? 42 : 100, left: 14, right: 14, zIndex: 20,
            background: '#0f172a', borderRadius: 12, padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            transition: 'top 0.35s cubic-bezier(0.3, 0.8, 0.3, 1)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 13, fontWeight: 700 }}>
              <Package size={16} color="#22c55e" />
              <span>New stops assigned to your route</span>
            </div>
            <button onClick={() => setHasNewStops(false)} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center'
            }}>
              <X size={18} />
            </button>
          </div>
        )}

        {/* TURN INSTRUCTION CARD (Google Maps / Ride-Hailing Emerald style) */}
        {isTargetRoutable && (!distanceToStop || distanceToStop > 30) && (
          <div
            key={stepType}
            onClick={() => setIsTurnCardCollapsed(p => !p)}
            title="Tap to toggle turn card size"
            style={{
              position: 'absolute',
              top: isHeaderCollapsed ? (hasNewStops ? 88 : 42) : (hasNewStops ? 155 : 100),
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
              transition: 'all .35s cubic-bezier(0.3, 0.8, 0.3, 1)',
              animation: 'navFadeUp .25s ease',
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
              transition: 'all .25s ease',
            }}>
              <TurnArrow type={stepType} bearing={stepBearing} size={isTurnCardCollapsed ? 20 : 36} color="#ffffff" />
            </div>
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
                {instructionDist ? `in ${instructionDist}` : 'Next Maneuver'}
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
            <div style={{ color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
              {isTurnCardCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </div>
          </div>
        )}

        {/* RETRACTABLE BOTTOM SHEET (Ride-Hailing / Foodpanda style) */}
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
          paddingBottom: 'env(safe-area-inset-bottom, 14px)',
          transition: 'all 0.3s cubic-bezier(0.3, 0.8, 0.3, 1)',
        }}>
          {/* Retractable Handle Bar (Click to toggle) */}
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
                  <span>{isNearDestination ? "Arrived · Tap to view stats" : "Tap to view stats"}</span>
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  <span>Tap to collapse stats</span>
                </>
              )}
            </div>
          </div>

          {/* Stats & Details — Collapsible to save space */}
          {!isRetracted && (
            isExtendedMode && floatingMissedStops.length === 0 ? (
              <div style={{ padding: '12px 24px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <CheckCircle2 size={36} color="#16a34a" />
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, color: '#0f172a', textAlign: 'center' }}>
                  All Clear — No Missed Stops
                </div>
                <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center', margin: 0 }}>
                  There are currently no unclaimed stops nearby.
                  Checking again every 8 seconds…
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', animation: 'navPulse 1.5s ease infinite' }} />
                  Scanning for unclaimed stops
                </div>
              </div>
            ) : (
              <>
                {isTargetRoutable && (
                  <div style={{ padding: '4px 12px 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
                    <StatCell value={arrivalTimeStr} label="arrival" />
                    <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
                    <StatCell value={etaMinutes} label="min" />
                    <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
                    <StatCell value={distanceKmStr} label="km" />
                  </div>
                )}
                <div style={{ padding: '12px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <p style={{ fontFamily: 'var(--font-head)', fontSize: isTargetRoutable ? 16 : 13, fontWeight: 800, textAlign: 'center', color: isTargetRoutable ? (isNearDestination ? '#0f172a' : '#64748b') : '#f59e0b', marginBottom: 4, transition: 'color .3s' }}>
                    {isTargetRoutable
                      ? (isNearDestination ? 'You have arrived!' : 'On the way to next stop')
                      : `No verified Stops yet, contact your assigned watcher (${currentTarget?.watcher_names || 'Unknown'})`}
                  </p>
                  {isTargetRoutable && !isNearDestination && distanceToStop != null && (
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>
                      {distanceToStop > 1000
                        ? `${(distanceToStop / 1000).toFixed(1)} km to destination`
                        : `${Math.round(distanceToStop)} m to destination`}
                    </p>
                  )}
                  {isTargetRoutable && !isNearDestination && distanceToStop == null && (
                    <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Radio size={14} /> Waiting for GPS signal…
                    </p>
                  )}
                </div>
              </>
            )
          )}

          {/* Action Area — ALWAYS accessible even when collapsed */}
          <div style={{
            padding: isRetracted ? '4px 20px 10px' : '10px 20px 12px',
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
          }}>
            {isExtendedMode && floatingMissedStops.length === 0 ? (
              <button
                id="end-extended-shift-btn"
                onClick={() => onAdvance('end_shift')}
                style={{
                  width: '100%', maxWidth: 360, padding: isRetracted ? '12px' : '15px',
                  borderRadius: 30, border: 'none',
                  background: '#0f172a', color: '#fff',
                  fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                  letterSpacing: '.04em', cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}>
                <Flag size={16} />
                <span>Return to Base &amp; End Shift</span>
              </button>
            ) : (
              (() => {
                const currentStatus = activeMissedStop ? 'READY_FOR_COLLECTION' : (stopStatuses.has(currentStopIndex) ? normalizeStopStatus(stopStatuses.get(currentStopIndex)) : 'PENDING_INSPECTION');
                const isRoutable = activeMissedStop ? true : isRoutableStopStatus(currentStatus);
                const canArrive = isNearDestination && isRoutable;

                let buttonText = 'Confirm on Arrival';
                if (isNearDestination) {
                  if (isRoutable) {
                    if (currentStatus === 'PENDING_INSPECTION') {
                      buttonText = currentTarget?.watcher_names === 'No assigned watcher'
                        ? 'Collect (No Watcher)'
                        : 'Collect (Uninspected)';
                    } else {
                      buttonText = 'Confirm Arrival';
                    }
                  }
                  else buttonText = 'Waiting for Inspection...';
                }

                return (
                  <div style={{ width: '100%', maxWidth: 360, display: 'flex', gap: 10 }}>
                    <button
                      id="arrived-btn"
                      disabled={!canArrive}
                      onClick={handleCollectClick}
                      style={{
                        flex: 1, padding: isRetracted ? '13px 12px' : '16px 12px', borderRadius: 30, border: 'none',
                        fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, letterSpacing: '.04em',
                        transition: 'all .35s ease',
                        cursor: canArrive ? 'pointer' : 'not-allowed',
                        background: canArrive ? '#16a34a' : '#e2e8f0',
                        color: canArrive ? '#fff' : '#94a3b8',
                        boxShadow: canArrive ? '0 6px 20px rgba(22,163,74,0.35)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}>
                      {canArrive && <CheckCircle2 size={16} />}
                      <span>{buttonText}</span>
                    </button>
                    <button
                      onClick={() => setShowFullConfirm(true)}
                      style={{
                        padding: isRetracted ? '13px 16px' : '16px 16px', borderRadius: 30, border: '2px solid #ef4444',
                        background: '#fff', color: '#ef4444', fontFamily: 'var(--font-head)',
                        fontSize: 14, fontWeight: 900, letterSpacing: '.02em', flexShrink: 0,
                        cursor: 'pointer', transition: 'all .2s'
                      }}>
                      Full
                    </button>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      </div>

      {/* ── Overlays — always mounted for state continuity ── */}
      <ArrivedOverlay
        visible={routeState === 'arrived'}
        currentStop={activeMissedStop ? (activeMissedStop.label || 'Missed Stop') : (currentTarget?.label || sessionStorage.getItem('ww_current_stop'))}
        stopIndex={activeMissedStop ? 0 : currentStopIndex}
        gpsPos={gpsPos}
        scheduleId={schedule?.id}
        onConfirm={handleCollectionConfirmed}
        onBack={() => setRouteState('navigating')}
        missedStopId={activeMissedStop?.id ?? null}
      />

      <StopCompletedOverlay
        visible={routeState === 'completed'}
        schedule={schedule}
        currentStopIndex={currentStopIndex}
        stopStatuses={stopStatuses}
        gpsPos={gpsPos}
        onNextStop={handleNextStop}
        onEndShift={handleEndShift}
        onExtendedMode={handleExtendedMode}
      />

      {showOverrideConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 4000,
          background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, animation: 'navFadeUp .2s ease'
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 24,
            width: '100%', maxWidth: 340, textAlign: 'center',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <AlertTriangle size={40} color="#f59e0b" />
            </div>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>Watcher Delayed</h3>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.5 }}>
              Watcher <strong>{currentTarget?.watcher_names}</strong> hasn't inspected this stop — proceed anyway?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowOverrideConfirm(false)}
                style={{
                  flex: 1, padding: '14px', borderRadius: 14,
                  background: '#f1f5f9', color: '#64748b', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800,
                  cursor: 'pointer'
                }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowOverrideConfirm(false);
                  sessionStorage.setItem('ww_override_reason', '[OVERRIDE: Watcher Delayed] ');
                  handleArrived();
                }}
                style={{
                  flex: 1, padding: '14px', borderRadius: 14,
                  background: '#f59e0b', color: '#fff', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800,
                  cursor: 'pointer', boxShadow: '0 4px 12px rgba(245,158,11,0.25)'
                }}>
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {showFullConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 4000,
          background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, animation: 'navFadeUp .2s ease'
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 24,
            width: '100%', maxWidth: 340, textAlign: 'center',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <AlertTriangle size={40} color="#ef4444" />
            </div>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>Truck Full?</h3>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.5 }}>
              Are you sure your truck is full? This will end your route and navigate you directly to the dump site.
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowFullConfirm(false)}
                style={{
                  flex: 1, padding: '14px', borderRadius: 14,
                  background: '#f1f5f9', color: '#64748b', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800,
                  cursor: 'pointer'
                }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowFullConfirm(false);
                  // Flag that this shift ended because the truck is full — NOT an emergency.
                  // EndShiftModule reads this flag and routes straight to dump_site,
                  // bypassing the early-termination incident-report form.
                  sessionStorage.setItem('ww_end_reason', 'truck_full');
                  handleEndShift();
                }}
                style={{
                  flex: 1, padding: '14px', borderRadius: 14,
                  background: '#ef4444', color: '#fff', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800,
                  cursor: 'pointer', boxShadow: '0 4px 12px rgba(239,68,68,0.25)'
                }}>
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GATE 1 ISOLATED 3D TRUCK MODEL INSPECTOR ── */}
      {show3DPreview && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}>
          <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: 620,
            height: 520,
            background: '#0f172a',
            borderRadius: 16,
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(30, 41, 59, 0.7)',
            }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>
                  Gate 1: Isolated 3D Truck Inspector
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>
                  Three.js + OBJLoader + MTLLoader · camion jugete.obj
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShow3DPreview(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ flex: 1, position: 'relative' }}>
              <TruckOverlay isolated={true} testView="oblique" />
            </div>
          </div>
        </div>
      )}

    </>
  )
}
