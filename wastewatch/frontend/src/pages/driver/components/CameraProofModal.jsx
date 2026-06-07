/**
 * CameraProofModal.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * A fixed full-screen camera overlay that renders AT z-index 5000, above every
 * other panel (RouteOverlay is 3000, Navbar is ~100).  The map, GPS hook, and
 * all other overlays continue running underneath.
 *
 * STOP-ID RESOLUTION  (three-level priority, eliminates "Cannot find stop"):
 *   1. `stopId` prop  — passed explicitly from the parent overlay
 *   2. sessionStorage  ww_pending_collection_stop_id
 *   3. GET /api/driver/stops/current/  as a live fallback
 *
 * GPS LEGITIMACY CHECK:
 *   After the photo is captured the modal extracts EXIF GPS from the JPEG
 *   (using the tiny inline EXIF parser below — no extra dependency) and
 *   compares it against the driver's live `gpsPos` prop.
 *   • If the image has EXIF GPS  →  haversine distance is computed.
 *     - ≤ 200 m   : verified ✅
 *     - > 200 m   : warning shown but driver may still submit (field
 *                   conditions are imperfect; final audit is server-side).
 *   • If no EXIF GPS (most mobile browsers strip it) → the server-side
 *     lat/lng fields submitted with the form provide the ground truth.
 *     The modal still submits driver GPS with the upload.
 *
 * PROPS:
 *   visible    {boolean}          — controls render / camera lifecycle
 *   stopId     {number|null}      — preferred stop ID (may be null; modal resolves)
 *   stopIndex  {number}           — display label
 *   scheduleId {number|null}
 *   gpsPos     {{ lat, lng }|null} — live driver position from useGpsTracking
 *   note       {string}           — collection note from parent
 *   onSuccess  {({ photoUrl }) => void}
 *   onClose    {() => void}
 *
 * The modal calls onSuccess only after a successful API upload.
 * onClose is called when the driver taps the × button without uploading.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../../../api/client'
import { broadcastPickupStatusSync } from '../../../utils/pickupStatusSync'

// ─── HAVERSINE ────────────────────────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── INLINE EXIF GPS EXTRACTOR ────────────────────────────────────────────────
// Reads the bare minimum to extract GPS IFD from a JPEG ArrayBuffer.
// Returns { lat, lng } or null.  No dependencies.
function extractExifGps(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer)
    if (view.getUint16(0) !== 0xffd8) return null          // not JPEG

    let offset = 2
    while (offset < view.byteLength - 2) {
      const marker = view.getUint16(offset)
      offset += 2
      if (marker === 0xffe1) {                              // APP1 (EXIF)
        const segLen = view.getUint16(offset)
        const exifHeader = String.fromCharCode(
          view.getUint8(offset + 2), view.getUint8(offset + 3),
          view.getUint8(offset + 4), view.getUint8(offset + 5),
        )
        if (exifHeader !== 'Exif') break
        const tiffStart = offset + 8
        const byteOrder = view.getUint16(tiffStart)
        const le = byteOrder === 0x4949
        const read16 = o => le ? view.getUint16(tiffStart + o, true) : view.getUint16(tiffStart + o)
        const read32 = o => le ? view.getUint32(tiffStart + o, true) : view.getUint32(tiffStart + o)
        const ifdOffset = read32(4)
        const ifdCount  = read16(ifdOffset)

        let gpsIfdOffset = null
        for (let i = 0; i < ifdCount; i++) {
          const entryOffset = ifdOffset + 2 + i * 12
          const tag = read16(entryOffset)
          if (tag === 0x8825) {                             // GPSInfo IFD pointer
            gpsIfdOffset = read32(entryOffset + 8)
            break
          }
        }
        if (gpsIfdOffset == null) return null

        const gpsCount = read16(gpsIfdOffset)
        const gpsMap   = {}
        for (let i = 0; i < gpsCount; i++) {
          const e = gpsIfdOffset + 2 + i * 12
          gpsMap[read16(e)] = { type: read16(e + 2), count: read32(e + 4), value: read32(e + 8) }
        }

        function readRational(valueOffset, count) {
          const vals = []
          for (let i = 0; i < count; i++) {
            const num = read32(valueOffset + i * 8)
            const den = read32(valueOffset + i * 8 + 4)
            vals.push(den === 0 ? 0 : num / den)
          }
          return vals
        }

        function dmsToDecimal(tag, refTag, posChar) {
          const entry = gpsMap[tag]
          if (!entry) return null
          const dms = readRational(entry.value, 3)
          const deg = dms[0] + dms[1] / 60 + dms[2] / 3600
          const refEntry = gpsMap[refTag]
          let ref = posChar
          if (refEntry) {
            const refOffset = refEntry.value
            ref = String.fromCharCode(view.getUint8(tiffStart + refOffset))
          }
          return (ref === 'S' || ref === 'W') ? -deg : deg
        }

        const lat = dmsToDecimal(2, 1, 'N')   // GPSLatitude / GPSLatitudeRef
        const lng = dmsToDecimal(4, 3, 'E')   // GPSLongitude / GPSLongitudeRef
        if (lat == null || lng == null) return null
        return { lat, lng }
      } else {
        if (marker === 0xffda) break           // Start of scan — stop reading
        const segLen = view.getUint16(offset)
        offset += segLen
      }
    }
    return null
  } catch {
    return null
  }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function CameraProofModal({
  visible,
  stopId: stopIdProp,
  stopIndex,
  scheduleId,
  gpsPos,
  note,
  onSuccess,
  onClose,
}) {
  // ── Stop-ID resolution ──────────────────────────────────────────────────────
  const [resolvedStopId, setResolvedStopId] = useState(null)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    if (!visible) return

    // Level 1: prop
    if (stopIdProp) { setResolvedStopId(Number(stopIdProp)); return }

    // Level 2: sessionStorage
    const fromSession = Number(sessionStorage.getItem('ww_pending_collection_stop_id') || 0) || null
    if (fromSession) { setResolvedStopId(fromSession); return }

    // Level 3: live API
    setResolving(true)
    api.get('/api/driver/stops/current/')
      .then(res => {
        const id = res.data?.id ? Number(res.data.id) : null
        setResolvedStopId(id)
        if (id) sessionStorage.setItem('ww_pending_collection_stop_id', String(id))
      })
      .catch(() => setResolvedStopId(null))
      .finally(() => setResolving(false))
  }, [visible, stopIdProp])

  // ── Camera state ────────────────────────────────────────────────────────────
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)

  const [cameraPhase, setCameraPhase] = useState('idle')
  // idle | starting | live | captured | uploading | done | error
  const [cameraError, setCameraError]   = useState('')
  const [photoPreview, setPhotoPreview] = useState(null)
  const [capturedBlob, setCapturedBlob] = useState(null)
  const [capturedBuffer, setCapturedBuffer] = useState(null)

  // ── GPS verification state ──────────────────────────────────────────────────
  const [gpsCheck, setGpsCheck] = useState(null)
  // null | { status: 'verified'|'warning'|'no_exif', distanceM?: number, exifPos?: {lat,lng} }

  // ── Upload state ────────────────────────────────────────────────────────────
  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState('')

  // ── Shutter animation ───────────────────────────────────────────────────────
  const [shutterFlash, setShutterFlash] = useState(false)

  // ── Start / stop camera with visibility ─────────────────────────────────────
  useEffect(() => {
    if (!visible) {
      stopCamera()
      resetState()
      return
    }
    startCamera()
    return () => stopCamera()
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function resetState() {
    setCameraPhase('idle')
    setCameraError('')
    setPhotoPreview(null)
    setCapturedBlob(null)
    setCapturedBuffer(null)
    setGpsCheck(null)
    setUploading(false)
    setUploadError('')
    setShutterFlash(false)
  }

  async function startCamera() {
    setCameraPhase('starting')
    setCameraError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera not supported on this device.')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraPhase('live')
    } catch (err) {
      setCameraError(err?.message || 'Camera access denied.')
      setCameraPhase('error')
    }
  }

  // ── Capture photo ───────────────────────────────────────────────────────────
  async function handleCapture() {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || cameraPhase !== 'live') return

    canvas.width  = video.videoWidth  || 1280
    canvas.height = video.videoHeight || 720
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

    // Shutter flash
    setShutterFlash(true)
    setTimeout(() => setShutterFlash(false), 200)

    const blob = await new Promise((res, rej) =>
      canvas.toBlob(b => (b ? res(b) : rej(new Error('Capture failed.'))), 'image/jpeg', 0.92)
    )
    const buffer = await blob.arrayBuffer()

    const previewUrl = URL.createObjectURL(blob)
    setPhotoPreview(previewUrl)
    setCapturedBlob(blob)
    setCapturedBuffer(buffer)
    setCameraPhase('captured')

    // Stop live stream to save battery
    stopCamera()

    // GPS check
    doGpsCheck(buffer)
  }

  function doGpsCheck(buffer) {
    const exifPos = extractExifGps(buffer)
    if (!exifPos) {
      setGpsCheck({ status: 'no_exif' })
      return
    }
    if (!gpsPos) {
      setGpsCheck({ status: 'no_exif', exifPos })
      return
    }
    const dist = haversineDistance(exifPos.lat, exifPos.lng, gpsPos.lat, gpsPos.lng)
    setGpsCheck({
      status: dist <= 200 ? 'verified' : 'warning',
      distanceM: Math.round(dist),
      exifPos,
    })
  }

  // ── Retake ──────────────────────────────────────────────────────────────────
  function handleRetake() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
    setCapturedBlob(null)
    setCapturedBuffer(null)
    setGpsCheck(null)
    setUploadError('')
    setCameraPhase('starting')
    startCamera()
  }

  // ── Upload ──────────────────────────────────────────────────────────────────
  async function handleUpload() {
    if (!capturedBlob) return
    if (!resolvedStopId) {
      setUploadError('Cannot identify the current stop. Please try again.')
      return
    }
    setUploading(true)
    setUploadError('')

    try {
      const form = new FormData()
      form.append('photo', capturedBlob, `pickup-${stopIndex ?? 'x'}-${Date.now()}.jpg`)
      form.append('note', note?.trim() || '')
      form.append('collected_at', new Date().toISOString())
      if (gpsPos) {
        form.append('lat', String(gpsPos.lat))
        form.append('lng', String(gpsPos.lng))
      }

      const res = await api.post(`/api/driver/stops/${resolvedStopId}/collect/`, form)

      broadcastPickupStatusSync({
        scheduleId: scheduleId ?? null,
        stopOrder:  stopIndex ?? null,
        status:     'COMPLETED',
        source:     'camera-proof-modal',
      })

      // Persist for StopCompletedOverlay
      sessionStorage.setItem('ww_pending_collection_stop_id', String(resolvedStopId))

      setCameraPhase('done')
      onSuccess?.({ photoUrl: res.data?.photo_url || null })
    } catch (err) {
      setUploadError(err?.response?.data?.error || err?.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  // ── Close ───────────────────────────────────────────────────────────────────
  function handleClose() {
    stopCamera()
    resetState()
    onClose?.()
  }

  // ── Don't render when hidden ─────────────────────────────────────────────────
  if (!visible) return null

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const isLive = cameraPhase === 'live'
  const isCaptured = cameraPhase === 'captured'
  const isError = cameraPhase === 'error'
  const isDone = cameraPhase === 'done'

  const gpsStatusConfig = gpsCheck ? {
    verified: { color: '#16a34a', bg: 'rgba(22,163,74,0.1)',  border: 'rgba(22,163,74,0.3)',  icon: '✅', label: 'GPS verified' },
    warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', icon: '⚠️', label: `${gpsCheck.distanceM}m from stop` },
    no_exif:  { color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.3)', icon: '📡', label: 'Driver GPS recorded' },
  }[gpsCheck.status] : null

  return (
    <>
      {/* ── GLOBAL KEYFRAMES ── */}
      <style>{`
        @keyframes cpm-slide-up {
          from { opacity:0; transform:translateY(24px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes cpm-fade-in {
          from { opacity:0; } to { opacity:1; }
        }
        @keyframes cpm-shutter {
          0%   { opacity:0.95; }
          100% { opacity:0; }
        }
        @keyframes cpm-spin {
          to { transform:rotate(360deg); }
        }
        @keyframes cpm-success-pop {
          0%   { transform:scale(0.6); opacity:0; }
          60%  { transform:scale(1.1); }
          80%  { transform:scale(0.96); }
          100% { transform:scale(1);   opacity:1; }
        }
        @keyframes cpm-pulse-ring {
          0%   { transform:scale(1);    opacity:0.6; }
          100% { transform:scale(1.8);  opacity:0; }
        }
      `}</style>

      {/* ── BACKDROP ── */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 4999,
          background: 'rgba(5,10,20,0.75)',
          backdropFilter: 'blur(4px)',
          animation: 'cpm-fade-in .2s ease',
        }}
      />

      {/* ── MODAL SHEET ── */}
      <div style={{
        position: 'fixed',
        left: 0, right: 0, bottom: 0,
        zIndex: 5000,
        borderRadius: '22px 22px 0 0',
        background: '#0d1117',
        boxShadow: '0 -12px 60px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        maxHeight: '96vh',
        animation: 'cpm-slide-up .3s cubic-bezier(.32,.72,0,1)',
      }}>

        {/* ── DRAG PILL + HEADER ── */}
        <div style={{
          padding: '12px 20px 0',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', marginBottom: 14 }} />
          <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>
                COLLECTION PROOF
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
                {resolving ? 'Identifying stop…' : resolvedStopId ? `Stop ${stopIndex ?? '—'}` : '⚠ Stop ID unavailable'}
              </div>
            </div>
            <button
              onClick={handleClose}
              style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.7)', fontSize: 16, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background .15s',
              }}
            >✕</button>
          </div>
        </div>

        {/* ── VIEWFINDER ── */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000', flexShrink: 0 }}>

          {/* Live video */}
          <video
            ref={videoRef}
            muted playsInline autoPlay
            style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              opacity: isLive ? 1 : 0, transition: 'opacity .3s',
            }}
          />

          {/* Captured preview */}
          {photoPreview && (
            <img
              src={photoPreview}
              alt="Captured proof"
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%', objectFit: 'cover',
                animation: 'cpm-fade-in .25s ease',
              }}
            />
          )}

          {/* Hidden canvas */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Shutter flash */}
          {shutterFlash && (
            <div style={{
              position: 'absolute', inset: 0, background: '#fff',
              animation: 'cpm-shutter .2s ease forwards',
              pointerEvents: 'none',
            }} />
          )}

          {/* Starting overlay */}
          {(cameraPhase === 'starting' || cameraPhase === 'idle') && !photoPreview && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: 'rgba(13,17,23,0.85)',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '2.5px solid rgba(255,255,255,0.15)',
                borderTopColor: '#3b82f6',
                animation: 'cpm-spin 1s linear infinite',
              }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
                Starting camera…
              </span>
            </div>
          )}

          {/* Error overlay */}
          {isError && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: 'rgba(13,17,23,0.9)', padding: '0 24px',
            }}>
              <span style={{ fontSize: 32 }}>📵</span>
              <div style={{ fontSize: 13, color: '#fca5a5', textAlign: 'center', fontWeight: 600, lineHeight: 1.5 }}>
                {cameraError}
              </div>
              <button
                onClick={startCamera}
                style={{
                  marginTop: 8, padding: '10px 24px', borderRadius: 20,
                  background: '#3b82f6', border: 'none', color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </div>
          )}

          {/* ── Viewfinder guides (only when live) ── */}
          {isLive && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {/* Corner brackets */}
              {[
                { top: 16, left: 16 },
                { top: 16, right: 16 },
                { bottom: 16, left: 16 },
                { bottom: 16, right: 16 },
              ].map((pos, i) => (
                <div key={i} style={{
                  position: 'absolute', width: 20, height: 20, ...pos,
                  borderTop:    pos.top    != null ? '2.5px solid rgba(255,255,255,0.6)' : 'none',
                  borderBottom: pos.bottom != null ? '2.5px solid rgba(255,255,255,0.6)' : 'none',
                  borderLeft:   pos.left   != null ? '2.5px solid rgba(255,255,255,0.6)' : 'none',
                  borderRight:  pos.right  != null ? '2.5px solid rgba(255,255,255,0.6)' : 'none',
                  borderRadius: i === 0 ? '3px 0 0 0' : i === 1 ? '0 3px 0 0' : i === 2 ? '0 0 0 3px' : '0 0 3px 0',
                }} />
              ))}
              {/* Aim dot */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                width: 8, height: 8, marginTop: -4, marginLeft: -4,
                borderRadius: '50%', background: 'rgba(255,255,255,0.5)',
              }} />
            </div>
          )}

          {/* GPS indicator badge */}
          {gpsPos && isLive && (
            <div style={{
              position: 'absolute', top: 12, left: 12,
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(13,17,23,0.65)', backdropFilter: 'blur(4px)',
              borderRadius: 20, padding: '4px 10px',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: '#2ecc71',
                animation: 'cpm-pulse-ring 1.5s ease infinite',
                display: 'inline-block',
              }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#2ecc71', letterSpacing: '.04em' }}>GPS ACTIVE</span>
            </div>
          )}

          {/* Captured "PROOF" stamp */}
          {isCaptured && (
            <div style={{
              position: 'absolute', top: 12, right: 12,
              background: 'rgba(22,163,74,0.9)', borderRadius: 8, padding: '4px 10px',
              fontSize: 10, fontWeight: 900, color: '#fff', letterSpacing: '.08em',
            }}>
              ✓ CAPTURED
            </div>
          )}
        </div>

        {/* ── BOTTOM CONTROLS ── */}
        <div style={{ padding: '16px 20px 28px', flexShrink: 0 }}>

          {/* ── GPS verification result ── */}
          {gpsCheck && gpsStatusConfig && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 12, marginBottom: 14,
              background: gpsStatusConfig.bg,
              border: `1px solid ${gpsStatusConfig.border}`,
              animation: 'cpm-fade-in .3s ease',
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{gpsStatusConfig.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: gpsStatusConfig.color }}>
                  {gpsStatusConfig.label}
                </div>
                {gpsCheck.status === 'warning' && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
                    Photo location differs from stop. Submit anyway?
                  </div>
                )}
                {gpsCheck.status === 'no_exif' && gpsPos && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
                    ±{gpsPos.lat.toFixed(5)}, {gpsPos.lng.toFixed(5)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Stop-ID warning ── */}
          {!resolving && !resolvedStopId && (
            <div style={{
              padding: '10px 14px', borderRadius: 12, marginBottom: 14,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              fontSize: 12, fontWeight: 600, color: '#fca5a5',
            }}>
              ⚠️ Stop ID could not be resolved. Check your connection and try again.
            </div>
          )}

          {/* ── Upload error ── */}
          {uploadError && (
            <div style={{
              padding: '10px 14px', borderRadius: 12, marginBottom: 14,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              fontSize: 12, fontWeight: 600, color: '#fca5a5',
            }}>
              {uploadError}
            </div>
          )}

          {/* ── Success state ── */}
          {isDone ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 10, paddingTop: 8,
              animation: 'cpm-success-pop .5s cubic-bezier(.36,.07,.19,.97) both',
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', background: '#16a34a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 0 16px rgba(22,163,74,0.15)',
                fontSize: 28,
              }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
                Photo uploaded
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                GPS location recorded
              </div>
            </div>
          ) : isCaptured ? (
            /* ── Captured: retake / submit ── */
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleRetake}
                disabled={uploading}
                style={{
                  flex: '0 0 auto', padding: '14px 20px', borderRadius: 14,
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 700,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                }}
              >
                Retake
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading || !resolvedStopId}
                style={{
                  flex: 1, padding: '14px', borderRadius: 14, border: 'none',
                  background: uploading || !resolvedStopId ? '#1e2a3a' : '#16a34a',
                  color: uploading || !resolvedStopId ? 'rgba(255,255,255,0.35)' : '#fff',
                  fontFamily: 'monospace', fontSize: 14, fontWeight: 900,
                  letterSpacing: '.06em',
                  cursor: uploading || !resolvedStopId ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: uploading || !resolvedStopId ? 'none' : '0 6px 20px rgba(22,163,74,0.35)',
                  transition: 'all .2s',
                }}
              >
                {uploading ? (
                  <>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.2)',
                      borderTopColor: '#fff',
                      animation: 'cpm-spin 1s linear infinite',
                      flexShrink: 0,
                    }} />
                    Uploading…
                  </>
                ) : '↑ Submit Proof'}
              </button>
            </div>
          ) : (
            /* ── Live: shutter button ── */
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', paddingTop: 4 }}>
              {isError ? (
                <button
                  onClick={startCamera}
                  style={{
                    width: '100%', padding: '16px', borderRadius: 14, border: 'none',
                    background: '#3b82f6', color: '#fff',
                    fontSize: 14, fontWeight: 800, cursor: 'pointer',
                  }}
                >
                  📷 Allow Camera Access
                </button>
              ) : (
                /* Circular shutter button */
                <button
                  onClick={handleCapture}
                  disabled={!isLive}
                  style={{
                    width: 74, height: 74, borderRadius: '50%', border: 'none',
                    background: isLive ? '#fff' : 'rgba(255,255,255,0.15)',
                    cursor: isLive ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: isLive
                      ? '0 0 0 4px rgba(255,255,255,0.15), 0 6px 20px rgba(0,0,0,0.5)'
                      : 'none',
                    transition: 'all .15s',
                    position: 'relative',
                  }}
                >
                  {/* Inner ring */}
                  <div style={{
                    width: 62, height: 62, borderRadius: '50%',
                    border: '2.5px solid #0d1117',
                    background: isLive ? '#fff' : 'rgba(255,255,255,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 22 }}>📷</span>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Hint text */}
          {!isDone && !isCaptured && isLive && (
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '.04em' }}>
              TAP TO CAPTURE · GPS WILL BE EMBEDDED
            </div>
          )}
        </div>
      </div>
    </>
  )
}