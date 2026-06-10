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
import Navbar from '../../../components/Navbar'
import api from '../../../api/client'
import { useAuth } from '../../../context/AuthContext'
import EndShiftModule from './EndShiftModule'
import CameraProofModal from './CameraProofModal'
import {
  broadcastPickupStatusSync,
  buildStopValidationSnapshot,
  isRoutableStopStatus,
  normalizeStopStatus,
  STOP_STATUS_COLORS,
  STOP_STATUS_LABELS,
  subscribePickupStatusSync,
} from '../../../utils/pickupStatusSync'

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

function stopMarkerHTML(stopNumber, status, details, isActive = false) {
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
      border:2.5px solid ${c.bg === 'transparent' ? '#f59e0b' : c.bg};
      animation:wwMarkerPulse 1.8s ease infinite;
      pointer-events:none;
    "></span>
  ` : ''

  const glowShadow = ['VERIFIED_COLLECTED', 'COLLECTION_DISPUTED', 'COLLECTION_REPORTED'].includes(safeStatus)
    ? `0 2px 10px ${c.shadow}, 0 0 0 3px ${c.bg === 'transparent' ? 'rgba(148,163,184,0.3)' : `${c.bg}44`}`
    : `0 2px 10px ${c.shadow}`
  const fillColor = safeStatus === 'PENDING_INSPECTION' ? 'transparent' : c.bg
  const borderStyle = safeStatus === 'PENDING_INSPECTION' ? `2px dashed ${c.border}` : `2.5px solid ${c.border}`

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
        color:${c.label};
        font-size:${isActive ? 12 : 10}px;
        font-weight:900;
        font-family:monospace;
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

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const bearingToCompass = deg => deg != null
  ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : null

function TurnArrow({ type, bearing, size = 48, color = '#0f172a' }) {
  const compass = bearingToCompass(bearing)
  const s = { stroke: color, strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
  const wrap = (label, children) => (
    <svg viewBox="0 0 44 44" width={size} height={size} aria-label={label} style={{ display: 'block' }}>
      {children}
      {compass && <text x="22" y="43" textAnchor="middle" fontSize="6.5" fontWeight="700"
        fill={color} opacity="0.5" fontFamily="monospace">{compass}</text>}
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

function MapLegend() {
  const items = [
    { color: 'transparent', border: '1px dashed rgba(148,163,184,0.9)', label: STOP_STATUS_LABELS.PENDING_INSPECTION },
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
function RouteOverlay({ children, visible }) {
  if (!visible) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(5px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-end',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
        <Navbar />
      </div>
      <div style={{
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

function ArrivedOverlay({ visible, currentStop, stopIndex, gpsPos, scheduleId, onConfirm, onBack }) {
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [stop, setStop] = useState(null)
  const [loading, setLoading] = useState(false)
  const [photoUploaded, setPhotoUploaded] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState(null)

  useEffect(() => {
    if (!visible) return
    setNote('')
    setPhotoUploaded(false)
    setCapturedPhotoUrl(null)
    setCameraOpen(false)

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

  const stopName = stop?.address || currentStop || `Stop ${stopIndex}`
  const barangay = stop?.barangay || sessionStorage.getItem('ww_barangay') || ''

  function selectPreset(preset) {
    setNote(prev => prev ? `${prev}, ${preset}` : preset)
  }

  function handlePhotoSuccess({ photoUrl }) {
    setPhotoUploaded(true)
    setCapturedPhotoUrl(photoUrl || null)
    setCameraOpen(false)
    sessionStorage.setItem('ww_pending_collection_note', note.trim())
  }

  async function handleConfirm() {
    if (!photoUploaded) return
    setSubmitting(true)
    sessionStorage.setItem('ww_pending_collection_note', note.trim())
    sessionStorage.setItem('ww_pending_collection_at', new Date().toISOString())
    setSubmitting(false)
    onConfirm()
  }

  return (
    <>
      <RouteOverlay visible={visible}>
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
              <div style={{ fontSize: 48, marginBottom: 12 }}>📍</div>
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900, margin: '0 0 6px', letterSpacing: '.02em' }}>You have arrived</h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: 0 }}>
                {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            <div className="am-card" style={{ margin: '0 16px', marginTop: -18, background: '#fff', borderRadius: 14, padding: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 4 }}>CURRENT STOP</div>
              <div style={{ fontWeight: 900, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>{stopName}</div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{barangay}</div>
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

            <div style={{ padding: '0 16px', marginBottom: 20 }}>
              {!photoUploaded ? (
                <button onClick={() => setCameraOpen(true)} style={{
                  width: '100%', padding: '16px', borderRadius: 14,
                  border: '2px dashed #cbd5e1', background: '#fff',
                  display: 'flex', alignItems: 'center', gap: 14,
                  cursor: 'pointer', transition: 'all .15s',
                }}>
                  <div style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📷</div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 2 }}>Take Proof Photo</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Required · GPS location will be verified</div>
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, letterSpacing: '.05em', padding: '4px 8px', borderRadius: 20, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', flexShrink: 0 }}>REQUIRED</div>
                </button>
              ) : (
                <div style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1.5px solid rgba(22,163,74,0.35)', background: 'rgba(22,163,74,0.05)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  {capturedPhotoUrl ? (
                    <img src={capturedPhotoUrl} alt="Proof" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, background: 'rgba(22,163,74,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>✅</div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#16a34a', marginBottom: 2 }}>Photo uploaded</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>GPS location verified</div>
                  </div>
                  <button onClick={() => { setPhotoUploaded(false); setCapturedPhotoUrl(null); setCameraOpen(true) }}
                    style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                    Retake
                  </button>
                </div>
              )}
            </div>

            <div style={{ padding: '0 16px 28px', marginTop: 'auto' }}>
              <button onClick={handleConfirm} disabled={submitting || !photoUploaded} style={{
                width: '100%', padding: '16px', borderRadius: 30, border: 'none',
                background: submitting || !photoUploaded ? '#e2e8f0' : '#0f172a',
                color: submitting || !photoUploaded ? '#94a3b8' : '#fff',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                letterSpacing: '.06em', cursor: submitting || !photoUploaded ? 'not-allowed' : 'pointer',
                boxShadow: submitting || !photoUploaded ? 'none' : '0 6px 20px rgba(15,23,42,0.3)',
                transition: 'all .2s',
              }}>
                {submitting ? 'Saving…' : !photoUploaded ? '📷 Take a photo first' : '✓ Confirm Collection'}
              </button>
            </div>
          </div>
        )}
      </RouteOverlay>

      <CameraProofModal
        visible={cameraOpen && visible}
        stopIndex={stopIndex}
        scheduleId={scheduleId}
        gpsPos={gpsPos}
        note={note}
        onSuccess={handlePhotoSuccess}
        onClose={() => setCameraOpen(false)}
      />
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
    const isCompleted = wpIndex <= currentStopIndex
    return {
      id: wpIndex,
      name: wp.name || wp.label || `Stop ${wpIndex}`,
      status: isCompleted ? 'completed' : 'pending',
    }
  })

  const completed = stops.filter(s => s.status === 'completed').length
  const total = stops.length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const isRouteComplete = total > 0 && progress === 100

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
              <button onClick={onEndShift} style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: '#0f172a', color: '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                cursor: 'pointer', marginBottom: 8,
                boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
              }}>Done</button>
              <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', margin: '0 0 8px' }}>
                Accept Unclaimed dump site
              </p>
              <button onClick={onExtendedMode} style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: '#0f172a', color: '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
              }}>My Truck is still not full</button>
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

// ─── END SHIFT OVERLAY ────────────────────────────────────────────────────────

const EARLY_REASONS = [
  'Truck breakdown / mechanical issue',
  'Medical emergency',
  'Road is blocked / inaccessible',
  'Insufficient fuel',
  'Weather conditions',
  'End of scheduled shift hours',
  'Other',
]

const BASE_ARRIVAL_RADIUS_M = 150

function SummaryRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{label}</span>
      </div>
      <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{value}</span>
    </div>
  )
}

function Fireworks() {
  const particles = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * 360
    const dist = 70 + Math.random() * 50
    const colors = ['#2ecc71', '#3b82f6', '#f59e0b', '#ec4899', '#22d3ee', '#a78bfa', '#fff']
    return { x: Math.cos((angle * Math.PI) / 180) * dist, y: Math.sin((angle * Math.PI) / 180) * dist, color: colors[i % colors.length], delay: Math.random() * 0.4, size: 5 + Math.random() * 7 }
  })
  return (
    <div style={{ position: 'relative', width: 180, height: 180, margin: '0 auto' }}>
      {particles.map((p, i) => (
        <div key={i} style={{ position: 'absolute', top: '50%', left: '50%', width: p.size, height: p.size, borderRadius: i % 3 === 0 ? '50%' : '2px', background: p.color, animation: `fwBurst 1.2s cubic-bezier(.22,.61,.36,1) ${p.delay}s both`, '--tx': `${p.x}px`, '--ty': `${p.y}px` }} />
      ))}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fwCheck .5s cubic-bezier(.36,.07,.19,.97) .2s both' }}>
        <div style={{ width: 70, height: 70, borderRadius: '50%', background: '#1e2a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(15,23,42,0.3)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="32" height="32">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function EndShiftOverlay({ visible, gpsPos, schedule, onClose }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { formattedTime, startTime, endShift } = useShiftTimer()
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  const isRouteComplete = sessionStorage.getItem('ww_route_complete') === 'true'
  const completedStops = parseInt(sessionStorage.getItem('ww_completed_stops') || '0', 10)
  const totalStops = parseInt(sessionStorage.getItem('ww_total_stops') || '0', 10)

  const [phase, setPhase] = useState('returning')
  const baseLocation = schedule?.waypoints?.[0] || null
  const baseName = baseLocation?.label || 'Home Base'

  const distanceToBase = gpsPos && baseLocation
    ? haversineDistance(gpsPos.lat, gpsPos.lng, Number(baseLocation.lat), Number(baseLocation.lng))
    : null
  const isAtBase = distanceToBase != null && distanceToBase <= BASE_ARRIVAL_RADIUS_M

  const [reason, setReason] = useState('')
  const [customNote, setCustomNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!visible) return
    setPhase('returning'); setReason(''); setCustomNote(''); setSubmitted(false)
  }, [visible])

  const ROUTE_SESSION_KEYS = ['ww_route_state', 'ww_current_stop_index', 'ww_stop_statuses', 'ww_current_stop', 'ww_route_complete', 'ww_extended_mode', 'ww_completed_stops', 'ww_total_stops']
  function clearRouteSession() { ROUTE_SESSION_KEYS.forEach(k => sessionStorage.removeItem(k)) }

  async function handleEarlySubmit() {
    if (!reason || submitting) return
    setSubmitting(true)
    try {
      const endTime = new Date()
      const durationMs = startTime ? (endTime - new Date(startTime)) : 0
      await api.post('/api/driver/shift/end/', { ended_early: true, reason, notes: customNote.trim() || null, started_at: startTime ? new Date(startTime).toISOString() : null, ended_at: endTime.toISOString(), duration_ms: durationMs })
      endShift(); clearRouteSession(); setSubmitted(true)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to end shift. Please try again.')
    } finally { setSubmitting(false) }
  }

  async function handleDone() {
    if (submitting) return
    setSubmitting(true)
    try {
      const endTime = new Date()
      const durationMs = startTime ? (endTime - new Date(startTime)) : 0
      await api.post('/api/driver/shift/end/', { ended_early: false, started_at: startTime ? new Date(startTime).toISOString() : null, ended_at: endTime.toISOString(), duration_ms: durationMs })
      endShift(); clearRouteSession()
      navigate('/dashboard', { replace: true })
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to end shift. Please try again.')
    } finally { setSubmitting(false) }
  }

  const distLabel = distanceToBase == null ? 'Calculating…'
    : distanceToBase > 1000 ? `${(distanceToBase / 1000).toFixed(1)} km to base`
      : `${Math.round(distanceToBase)} m to base`

  return (
    <RouteOverlay visible={visible}>
      <style>{`
        @keyframes fwBurst { 0%{transform:translate(-50%,-50%) scale(1);opacity:1} 100%{transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(0);opacity:0} }
        @keyframes fwCheck { 0%{transform:scale(0);opacity:0} 60%{transform:scale(1.12)} 80%{transform:scale(0.96)} 100%{transform:scale(1);opacity:1} }
        @keyframes esFadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .es-fade1 { animation: esFadeUp .3s ease .1s both; }
        .es-fade2 { animation: esFadeUp .3s ease .4s both; }
        .es-fade3 { animation: esFadeUp .3s ease .6s both; }
        @keyframes esSlideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {phase === 'returning' && (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
          <div style={{ background: 'rgba(15,23,42,0.97)', padding: '24px 20px 20px', color: '#fff', borderRadius: '18px 18px 0 0' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.5)', borderRadius: 20, padding: '3px 10px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', letterSpacing: '.04em' }}>RETURNING TO BASE</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '.04em' }}>⏱ {formattedTime}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 22, marginTop: 1 }}>🏠</span>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, marginBottom: 2 }}>{baseName}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>Return to base before ending your shift · {distLabel}</div>
              </div>
            </div>
          </div>

          <div style={{ margin: '16px 16px 0', padding: '12px 16px', background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🗺️</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a' }}>Map active behind</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>GPS is still tracking your route</div>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
            <div style={{ width: 100, height: 100, borderRadius: '50%', background: isAtBase ? '#16a34a' : '#1e2a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 28px ${isAtBase ? 'rgba(22,163,74,0.35)' : 'rgba(15,23,42,0.25)'}`, transition: 'all .4s ease', marginBottom: 16 }}>
              <span style={{ fontSize: 32 }}>🏠</span>
            </div>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, textAlign: 'center', color: isAtBase ? '#16a34a' : '#64748b', marginBottom: 4, transition: 'color .3s' }}>
              {isAtBase ? "You've reached home base!" : 'Make your way back to base'}
            </p>
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 0 }}>{distLabel}</p>
          </div>

          <div style={{ padding: '0 20px 28px' }}>
            <button disabled={!isAtBase} onClick={() => setPhase('at_base')} style={{ width: '100%', padding: '16px', borderRadius: 30, border: 'none', background: isAtBase ? '#16a34a' : '#e2e8f0', color: isAtBase ? '#fff' : '#94a3b8', fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, cursor: isAtBase ? 'pointer' : 'not-allowed', boxShadow: isAtBase ? '0 6px 20px rgba(22,163,74,0.35)' : 'none', transition: 'all .35s ease', letterSpacing: '.04em' }}>
              {isAtBase ? '✓ Confirm Return to Base' : 'Confirm on Arrival'}
            </button>
            {import.meta.env.DEV && (
              <button onClick={() => setPhase('at_base')} style={{ width: '100%', marginTop: 8, padding: '10px', borderRadius: 20, background: 'none', border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                DEV: Skip to end-shift form
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'at_base' && !isRouteComplete && (
        submitted ? (
          <div style={{ minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>📋</div>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>Report Submitted</h2>
            <p style={{ color: '#64748b', fontSize: 13, marginBottom: 28, lineHeight: 1.6 }}>Your early shift end has been reported to the admin.<br />Stay safe, {firstName}.</p>
            <button onClick={() => navigate('/dashboard', { replace: true })} style={{ width: '100%', maxWidth: 300, padding: '14px', borderRadius: 30, background: '#0f172a', color: '#fff', border: 'none', fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 800, cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.25)' }}>
              Back to Dashboard
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', animation: 'esSlideUp .25s ease both' }}>
            <div style={{ background: '#0f172a', padding: '24px 20px 20px', color: '#fff', borderRadius: '18px 18px 0 0' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900, margin: '0 0 4px' }}>Ending Shift Early</h1>
              <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, margin: 0 }}>Please let us know why you're stopping before completing your route.</p>
            </div>
            <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
              <div style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: '1px solid #e2e8f0', marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Shift duration so far</span>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{formattedTime}</span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 8 }}>REASON FOR EARLY END *</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
                {EARLY_REASONS.map(r => (
                  <button key={r} onClick={() => setReason(r)} style={{ padding: '11px 14px', borderRadius: 10, textAlign: 'left', border: `1.5px solid ${reason === r ? '#0f172a' : '#e2e8f0'}`, background: reason === r ? '#0f172a' : '#fff', color: reason === r ? '#fff' : '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'all .15s' }}>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `2px solid ${reason === r ? '#fff' : '#cbd5e1'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {reason === r && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', display: 'block' }} />}
                    </span>
                    {r}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 7 }}>ADDITIONAL NOTES <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
              <textarea rows={2} maxLength={300} placeholder="e.g. Engine warning light appeared at Purok 3…" value={customNote} onChange={e => setCustomNote(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', fontSize: 13, color: '#0f172a', resize: 'none', fontFamily: 'var(--font-body)', marginBottom: 20 }} />
              <button onClick={handleEarlySubmit} disabled={!reason || submitting} style={{ width: '100%', padding: '15px', borderRadius: 30, background: reason && !submitting ? '#ef4444' : '#e2e8f0', color: reason && !submitting ? '#fff' : '#94a3b8', border: 'none', fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 900, letterSpacing: '.04em', cursor: reason && !submitting ? 'pointer' : 'not-allowed', boxShadow: reason ? '0 6px 18px rgba(239,68,68,0.28)' : 'none', transition: 'all .2s' }}>
                {submitting ? 'Submitting report…' : '⏹ Submit & End Shift'}
              </button>
              {!reason && <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Please select a reason above</p>}
            </div>
          </div>
        )
      )}

      {phase === 'at_base' && isRouteComplete && (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
          <div style={{ padding: '28px 20px 0', textAlign: 'center' }}>
            <h1 className="es-fade1" style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>Route Complete, {firstName}! 🎉</h1>
            <p className="es-fade1" style={{ color: '#64748b', fontSize: 13, marginBottom: 0 }}>You've completed all {totalStops} stops on your route today.</p>
          </div>
          <div style={{ padding: '20px', textAlign: 'center' }}><Fireworks /></div>
          <div className="es-fade2" style={{ padding: '0 20px', marginBottom: 20 }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: '4px 16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
              <SummaryRow icon="⏱" label="Shift Duration" value={formattedTime} />
              <SummaryRow icon="📍" label="Stops Completed" value={`${completedStops} / ${totalStops}`} />
              <SummaryRow icon="✅" label="Completion" value="100%" />
              <SummaryRow icon="📅" label="Date" value={new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
            </div>
          </div>
          <div className="es-fade3" style={{ padding: '0 20px 28px', marginTop: 'auto' }}>
            <button onClick={handleDone} style={{ width: '100%', padding: '15px', borderRadius: 14, background: '#0f172a', color: '#fff', border: 'none', fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, cursor: 'pointer', marginBottom: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em' }}>Done</button>
            <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', margin: '0 0 8px' }}>Accept Unclaimed dump site</p>
            <button onClick={() => { sessionStorage.setItem('ww_extended_mode', 'true'); onClose('navigating') }} style={{ width: '100%', padding: '15px', borderRadius: 14, background: '#0f172a', color: '#fff', border: 'none', fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em' }}>My Truck is still not full</button>
          </div>
        </div>
      )}
    </RouteOverlay>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function ShiftRouteModule({ routeState: externalRouteState, setRouteState: externalSetRouteState }) {
  const { user } = useAuth()
  const { formattedTime, shiftActive } = useShiftTimer()
  const { position: realGpsPos, accuracy: gpsAccuracy, isTracking, error: gpsError } = useDriverGps()

  const [routeState, setRouteStateLocal] = useState(() => {
    const saved = sessionStorage.getItem('ww_route_state')
    return saved || externalRouteState || 'navigating'
  })

  useEffect(() => {
    if (externalRouteState && externalRouteState !== routeState) setRouteStateLocal(externalRouteState)
  }, [externalRouteState])

  function setRouteState(next) {
    setRouteStateLocal(next)
    sessionStorage.setItem('ww_route_state', next)
    if (externalSetRouteState) externalSetRouteState(next)
  }

  const isExtendedMode = sessionStorage.getItem('ww_extended_mode') === 'true'
  useEffect(() => { injectStopMarkerStyles() }, [])

  // ── FIX 2: Clear mockGps on unmount to prevent stale state on remount. ────
  const [mockGps, setMockGps] = useState(null)
  useEffect(() => {
    return () => { setMockGps(null) }
  }, [])

  const gpsPos = mockGps || realGpsPos
  const isMock = mockGps !== null

  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const driverMarker = useRef(null)
  const routeLayer = useRef(null)

  // ── FIX 3: Use useLayoutEffect for gpsPosRef so synchronous reads within
  // the same render cycle (e.g. in map init) always see the latest value. ────
  const gpsPosRef = useRef(gpsPos)
  useLayoutEffect(() => { gpsPosRef.current = gpsPos }, [gpsPos])

  const stopMarkersRef = useRef(new Map())

  const [leafletReady, setLeafletReady] = useState(false)
  const [schedule, setSchedule] = useState(null)
  const [mapLoading, setMapLoading] = useState(true)

  const [currentStopIndex, setCurrentStopIndex] = useState(() => {
    const s = sessionStorage.getItem('ww_current_stop_index')
    return s ? parseInt(s, 10) : 1
  })
  const prevStopIndexRef = useRef(currentStopIndex)

  const [stopStatuses, setStopStatuses] = useState(restoreStopStatuses)
  const [stopDetailsMap, setStopDetailsMap] = useState(new Map())
  const stopDetailsMapRef = useRef(new Map())
  useEffect(() => { stopDetailsMapRef.current = stopDetailsMap }, [stopDetailsMap])

  const [orsData, setOrsData] = useState(null)
  const [orsFetchKey, setOrsFetchKey] = useState(0)

  const waypoints = schedule?.waypoints || []
  const currentTarget = waypoints[currentStopIndex] || null
  const nextTarget = waypoints[currentStopIndex + 1] || null

  const distanceToStop = gpsPos && currentTarget
    ? haversineDistance(gpsPos.lat, gpsPos.lng, currentTarget.lat, currentTarget.lng)
    : null

  const isNearDestination = distanceToStop != null && distanceToStop <= ARRIVAL_RADIUS_M

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
    const nextStopIndex = Number(currentRes.data?.order)
    if (Number.isInteger(nextStopIndex) && nextStopIndex > 0) {
      setCurrentStopIndex(nextStopIndex)
      sessionStorage.setItem('ww_current_stop_index', String(nextStopIndex))
    }
    const rows = validationRes.data?.results ?? validationRes.data ?? []
    const snapshot = buildStopValidationSnapshot(rows)
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
  }, [schedule?.id])

  const repaintMarker = useCallback((wpIndex, status, detailsOverride) => {
    const marker = stopMarkersRef.current.get(wpIndex)
    const safeStatus = normalizeStopStatus(status)
    if (!marker || !window.L) return
    const details = detailsOverride ?? stopDetailsMapRef.current.get(`${schedule?.id}:${wpIndex}`)
    const isActive = wpIndex === currentStopIndex && isRoutableStopStatus(safeStatus)
    const colorEntry = STOP_COLORS[safeStatus] || STOP_COLORS.PENDING_INSPECTION
    marker.setIcon(window.L.divIcon({
      html: stopMarkerHTML(wpIndex, safeStatus, details, isActive),
      className: 'ww-stop-div-icon',
      iconSize: isActive ? [28, 28] : [24, 24],
      iconAnchor: isActive ? [14, 14] : [12, 12],
    }))
    const displayColor = safeStatus === 'PENDING_INSPECTION' ? '#94a3b8' : colorEntry.bg
    const popupHtml = `
      <b>${waypoints[wpIndex]?.label || ('Stop ' + wpIndex)}</b>
      <br/><span style="font-size:11px;color:${displayColor};font-weight:700;text-transform:uppercase">${STOP_STATUS_LABELS[safeStatus] || safeStatus}</span>
      ${details?.collectedAt ? `<div style="margin-top:6px;font-size:11px;color:#10b981">Reported: ${details.collectedAt}</div>` : ''}
      ${details?.truck ? `<div style="font-size:11px;color:#64748b">Truck: ${details.truck}</div>` : ''}
    `
    marker.getPopup()?.setContent(popupHtml)
  }, [waypoints, schedule, currentStopIndex])

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
    api.get('/api/driver/collection-schedules/')
      .then(async res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
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
          setStopDetailsMap(snapshot.detailsMap)
          stopDetailsMapRef.current = snapshot.detailsMap
          const statusMap = new Map()
          snapshot.statusMap.forEach((status, key) => {
            const stopOrder = Number(String(key).split(':')[1])
            if (!Number.isNaN(stopOrder)) statusMap.set(stopOrder, status)
          })
          setStopStatuses(statusMap)
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
    // Use current GPS pos if available, otherwise fall back to Lucena coords.
    const pos = gpsPosRef.current
    const map = L.map(mapRef.current, {
      center: pos ? [pos.lat, pos.lng] : [13.9373, 121.617],
      zoom: 15,
      zoomControl: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    mapInstance.current = map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady])

  // ── FIX 4: Driver marker creation is now DECOUPLED from map init. ─────────
  // This effect waits until BOTH mapInstance.current and gpsPos are non-null
  // before creating the marker. If gpsPos arrives after the map, the marker
  // is created at the correct real position. If the map isn't ready yet when
  // gpsPos first arrives, this effect re-runs once the map is ready.
  useEffect(() => {
    if (!mapInstance.current || !window.L) return
    if (driverMarker.current) return // already created — movement handled below

    const L = window.L
    // Place at real GPS position if available, otherwise use map center.
    const pos = gpsPos || gpsPosRef.current
    const startPos = pos
      ? [pos.lat, pos.lng]
      : mapInstance.current.getCenter()

    const driverIcon = L.divIcon({
      html: `
        <div style="position:relative;width:18px;height:18px;">
          <span style="
            position:absolute;inset:-6px;border-radius:50%;
            border:2px solid #2563eb;opacity:0.4;
            animation:markerPulse 2s ease infinite;
          "></span>
          <div style="
            position:absolute;inset:0;
            background:#2563eb;
            border:3px solid white;
            border-radius:50%;
            box-shadow:0 0 12px rgba(37,99,235,0.7);
          "></div>
        </div>`,
      className: '',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })

    driverMarker.current = L.marker(startPos, {
      icon: driverIcon,
      zIndexOffset: 1000,
    }).addTo(mapInstance.current)

    // Pan to the real GPS position immediately on first fix.
    if (pos && routeState === 'navigating') {
      mapInstance.current.panTo([pos.lat, pos.lng])
    }
    // Re-run when map becomes ready OR when the first GPS fix arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady, gpsPos])

  // 3b. Draw stop markers
  useEffect(() => {
    if (!mapInstance.current || !window.L || !schedule) return
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
        html: stopMarkerHTML(wpIndex, status, details, isActive),
        className: 'ww-stop-div-icon',
        iconSize: isActive ? [28, 28] : [24, 24],
        iconAnchor: isActive ? [14, 14] : [12, 12],
      })
      const marker = L.marker([wp.lat, wp.lng], { icon })
        .addTo(mapInstance.current)
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:160px;">
            <b style="font-size:13px;">${wp.label || ('Stop ' + wpIndex)}</b><br/>
            <span style="font-size:11px;color:${displayColor};font-weight:700;text-transform:uppercase">
              ${STOP_STATUS_LABELS[safeStatus] || safeStatus}
            </span>
          </div>`)
      stopMarkersRef.current.set(wpIndex, marker)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule])

  // 4. ORS directions
  useEffect(() => {
    if (!currentTarget) return
    const orsApiKey = import.meta.env.VITE_ORS_API_KEY
    if (!orsApiKey) return
    const startLng = gpsPos?.lng ?? waypoints[0]?.lng ?? 121.617
    const startLat = gpsPos?.lat ?? waypoints[0]?.lat ?? 13.9373
    const routableFromCurrent = getRoutableIndices().filter(idx => idx >= currentStopIndex)
    const remaining = routableFromCurrent.slice(0, 40).map(idx => {
      const wp = waypoints[idx]
      return [wp.lng, wp.lat]
    })
    const coordinates = [[startLng, startLat], ...remaining]
    fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: orsApiKey },
      body: JSON.stringify({ coordinates, instructions: true }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.routes?.length) return
        setOrsData(data.routes[0])
        if (mapInstance.current && window.L) {
          if (routeLayer.current) mapInstance.current.removeLayer(routeLayer.current)
          const pts = decodePolyline(data.routes[0].geometry)
          routeLayer.current = window.L.polyline(pts, { color: '#3b82f6', weight: 6, opacity: 0.85 }).addTo(mapInstance.current)
        }
      })
      .catch(console.error)
  }, [orsFetchKey, currentTarget?.lat, currentTarget?.lng, currentStopIndex, getRoutableIndices, waypoints])

  // 5. Move driver marker — runs every time gpsPos updates.
  useEffect(() => {
    if (!gpsPos) return
    if (!mapInstance.current || !window.L) return

    if (driverMarker.current) {
      // Marker already exists — just move it.
      driverMarker.current.setLatLng([gpsPos.lat, gpsPos.lng])
    }
    // Pan map only while navigating (not when an overlay is open).
    if (routeState === 'navigating') {
      mapInstance.current.panTo([gpsPos.lat, gpsPos.lng])
    }
  }, [gpsPos, routeState])

  // 6. Cleanup
  useEffect(() => () => {
    if (mapInstance.current) {
      mapInstance.current.remove()
      mapInstance.current = null
    }
    driverMarker.current = null
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

  function handleCollectionConfirmed() {
    setStopStatuses(prev => {
      const next = new Map(prev)
      next.set(currentStopIndex, 'COLLECTION_REPORTED')
      return next
    })
    repaintMarker(currentStopIndex, 'COLLECTION_REPORTED')
    setRouteState('completed')
  }

  function handleNextStop() {
    const routable = getRoutableIndices()
    const pos = routable.indexOf(currentStopIndex)
    const nextIndex = pos >= 0 && pos < routable.length - 1 ? routable[pos + 1] : currentStopIndex + 1
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

  function handleEndShift() {
    const total = (schedule?.waypoints || []).length - 1
    sessionStorage.setItem('ww_completed_stops', String(currentStopIndex))
    sessionStorage.setItem('ww_total_stops', String(total))
    sessionStorage.setItem('ww_route_complete', total > 0 && currentStopIndex >= total ? 'true' : 'false')
    setRouteState('end_shift')
  }

  function handleExtendedMode() {
    const nextIndex = currentStopIndex + 1
    setCurrentStopIndex(nextIndex)
    sessionStorage.setItem('ww_current_stop_index', String(nextIndex))
    sessionStorage.removeItem('ww_pending_collection_note')
    sessionStorage.removeItem('ww_pending_collection_stop_id')
    sessionStorage.removeItem('ww_pending_collection_at')
    sessionStorage.setItem('ww_extended_mode', 'true')
    setOrsFetchKey(k => k + 1)
    setRouteState('navigating')
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

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes navPulse    { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes markerPulse { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.6);opacity:0} }
        @keyframes navFadeUp   { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes arrowPop    { 0%{transform:scale(.8);opacity:0} 60%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
      `}</style>

      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)', overflow: 'hidden', position: 'relative' }}>

        {/* MAP */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: '#2a3441' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
          <MapLegend />
          {import.meta.env.DEV && (
            <div style={{ position: 'absolute', top: '50%', right: 14, marginTop: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => teleportTo(currentTarget)} disabled={!currentTarget} title="Teleport to Current Stop"
                style={{ width: 44, height: 44, borderRadius: '50%', background: currentTarget ? '#f59e0b' : '#cbd5e1', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: currentTarget ? 'pointer' : 'not-allowed', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20 }}>📍</button>
              <button onClick={() => teleportTo(nextTarget)} disabled={!nextTarget} title="Teleport to Next Stop"
                style={{ width: 44, height: 44, borderRadius: '50%', background: nextTarget ? '#8b5cf6' : '#cbd5e1', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: nextTarget ? 'pointer' : 'not-allowed', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 20 }}>⏭</button>
              {isMock && (
                <button onClick={clearMock} title="Clear Mock GPS"
                  style={{ width: 44, height: 44, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 16, fontWeight: 800, color: '#fff' }}>✕</button>
              )}
              <button onClick={() => markRemainingMissed(currentStopIndex + 1)} title="Simulate shift end"
                style={{ width: 44, height: 44, borderRadius: '50%', background: '#0f172a', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.2)', fontSize: 14, color: '#fff', fontWeight: 800 }}>🚫</button>
            </div>
          )}
        </div>

        {/* STOP HEADER */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(30,42,58,0.92)', backdropFilter: 'blur(8px)', padding: '16px 18px 18px', color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.15)' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <GpsStatusPill isTracking={isTracking} error={gpsError} accuracy={gpsAccuracy} />
            <ConnPill />
            {isExtendedMode && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 20, padding: '3px 10px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'navPulse 1.5s ease infinite', display: 'inline-block' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em' }}>COLLECTING UNCLAIMED</span>
              </div>
            )}
            <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 20, padding: '3px 10px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '.04em' }}>⏱ {formattedTime}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 20, marginTop: 2 }}>📍</span>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>{currentTarget?.label || `Stop ${currentStopIndex}`}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{currentStopIndex} of {waypoints.length - 1} · {schedule?.days || ''}</div>
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

        {/* TURN INSTRUCTION CARD */}
        <div key={stepType} style={{ position: 'absolute', top: 122, left: 14, right: 14, zIndex: 10, background: 'rgba(255,255,255,0.97)', borderRadius: 16, overflow: 'hidden', display: 'flex', alignItems: 'stretch', boxShadow: '0 6px 28px rgba(0,0,0,.18)', backdropFilter: 'blur(6px)', animation: 'navFadeUp .25s ease' }}>
          <div style={{ width: 76, flexShrink: 0, background: `${accentColor}12`, borderRight: `3px solid ${accentColor}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
            <div style={{ animation: 'arrowPop .3s ease' }}>
              <TurnArrow type={stepType} bearing={stepBearing} size={48} color={accentColor} />
            </div>
          </div>
          <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900, color: '#0f172a', lineHeight: 1.2, marginBottom: instructionDist ? 5 : 0 }}>{instructionText}</div>
            {instructionDist && (
              <div style={{ fontSize: 13, color: accentColor, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round">
                  <line x1="8" y1="2" x2="8" y2="14" />
                  <line x1="3" y1="9" x2="8" y2="14" />
                  <line x1="13" y1="9" x2="8" y2="14" />
                </svg>
                in {instructionDist}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM PANEL */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, boxShadow: '0 -4px 24px rgba(0,0,0,.1)', display: 'flex', flexDirection: 'column', paddingBottom: 24 }}>
          <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '12px auto' }} />
          <div style={{ padding: '4px 12px 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
            <StatCell value={arrivalTimeStr} label="arrival" />
            <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
            <StatCell value={etaMinutes} label="min" />
            <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
            <StatCell value={distanceKmStr} label="km" />
          </div>
          <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <p style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, textAlign: 'center', color: isNearDestination ? '#0f172a' : '#64748b', marginBottom: 6, transition: 'color .3s' }}>
              {isNearDestination ? 'You have arrived!' : 'On the way to next stop'}
            </p>
            {!isNearDestination && distanceToStop != null && (
              <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                {distanceToStop > 1000
                  ? `${(distanceToStop / 1000).toFixed(1)} km to destination`
                  : `${Math.round(distanceToStop)} m to destination`}
              </p>
            )}
            {!isNearDestination && distanceToStop == null && (
              <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>📡 Waiting for GPS signal…</p>
            )}
            {(() => {
              const currentStatus = stopStatuses.has(currentStopIndex) ? normalizeStopStatus(stopStatuses.get(currentStopIndex)) : 'PENDING_INSPECTION';
              const isRoutable = isRoutableStopStatus(currentStatus);
              const canArrive = isNearDestination && isRoutable;

              let buttonText = 'Confirm on Arrival';
              if (isNearDestination) {
                if (isRoutable) buttonText = 'Confirm Arrival';
                else buttonText = 'Waiting for Inspection...';
              }

              return (
                <button
                  id="arrived-btn"
                  disabled={!canArrive}
                  onClick={handleArrived}
                  style={{
                    width: '100%', maxWidth: 320, padding: '18px', borderRadius: 30, border: 'none',
                    fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
                    transition: 'all .35s ease',
                    cursor: canArrive ? 'pointer' : 'not-allowed',
                    background: canArrive ? '#0f172a' : '#e2e8f0',
                    color: canArrive ? '#fff' : '#94a3b8',
                    boxShadow: canArrive ? '0 6px 20px rgba(15,23,42,0.3)' : 'none',
                  }}>
                  {buttonText}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      <ArrivedOverlay
        visible={routeState === 'arrived'}
        currentStop={currentTarget?.label || sessionStorage.getItem('ww_current_stop')}
        stopIndex={currentStopIndex}
        gpsPos={gpsPos}
        scheduleId={schedule?.id}
        onConfirm={handleCollectionConfirmed}
        onBack={() => setRouteState('navigating')}
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

      {routeState === 'end_shift' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
          <EndShiftModule setRouteState={setRouteState} />
        </div>
      )}
    </>
  )
}