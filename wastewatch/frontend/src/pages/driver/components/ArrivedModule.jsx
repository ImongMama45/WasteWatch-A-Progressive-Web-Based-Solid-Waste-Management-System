/**
 * ArrivedModule.jsx
 * ------------------
 * Rendered when routeState === "arrived".
 * Driver confirms collection at the stop by capturing a proof photo and
 * optionally adding a note. Transitions to "completed" only after the
 * photo is successfully uploaded.
 *
 * On successful proof upload → setRouteState("completed")
 *
 * Designed for field conditions: fast, large targets, minimal steps.
 *
 * Props:
 *  - setRouteState: fn
 */

import { useState, useEffect, useRef } from 'react'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'
import { broadcastPickupStatusSync } from '../../../utils/pickupStatusSync'
import { useOnline } from '../../../hooks/useOnline'
import { getQueue } from '../../../hooks/useOfflineQueue'
import { useAuth } from '../../../context/AuthContext'

// ─── QUICK NOTE PRESETS ───────────────────────────────────────────────────────

const QUICK_NOTES = [
  'Collected',
  'Partially collected',
  'No bins outside',
  'Overflowing',
]

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function setPersistedStopStatus(wpIndex, status) {
  try {
    const saved = sessionStorage.getItem('ww_stop_statuses')
    const statuses = saved
      ? new Map(JSON.parse(saved).map(([key, value]) => [Number(key), value]))
      : new Map()
    statuses.set(wpIndex, status)
    sessionStorage.setItem('ww_stop_statuses', JSON.stringify([...statuses]))
  } catch {
    sessionStorage.setItem('ww_stop_statuses', JSON.stringify([[wpIndex, status]]))
  }
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function ArrivedModule({ setRouteState }) {
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [stop, setStop] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [loading, setLoading] = useState(true)
  const { user } = useAuth()
  // ── Connectivity ───────────────────────────────────────────────────────────
  const isOnline = useOnline()
  const queue = getQueue('proof_submissions')
  // Camera state
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoUploaded, setPhotoUploaded] = useState(false)
  const [uploadingProof, setUploadingProof] = useState(false)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const currentStopIndex = parseInt(
    sessionStorage.getItem('ww_current_stop_index') || '1',
    10,
  )

  // ── Fetch stop + schedule ──────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/api/driver/stops/current/').catch(() => ({ data: null })),
      api.get('/api/driver/collection-schedules/').catch(() => ({ data: [] })),
    ])
      .then(([stopRes, scheduleRes]) => {
        setStop(stopRes.data || null)
        const match = (scheduleRes.data || []).find(s => s.driver != null)
        setSchedule(match || null)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // ── Camera initialisation ─────────────────────────────────────────────────

  useEffect(() => {
    let active = true

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not supported on this device.')
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (!active) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => { })
        }
        setCameraReady(true)
        setCameraError('')
      } catch (err) {
        setCameraError(err?.message || 'Camera access is required to confirm collection.')
        setCameraReady(false)
      }
    }

    startCamera()

    return () => {
      active = false
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────────

  const stopName =
    stop?.address ||
    sessionStorage.getItem('ww_current_stop') ||
    'Barangay Isabang Dump Site'
  const barangay =
    stop?.barangay ||
    sessionStorage.getItem('ww_barangay') ||
    'BARANGAY ISABANG'
  const currentStopId = stop?.id || Number(sessionStorage.getItem('ww_pending_collection_stop_id') || '')

  // ── Note helpers ──────────────────────────────────────────────────────────

  function selectPreset(preset) {
    setNote(prev => (prev ? `${prev}, ${preset}` : preset))
  }

  // ── Camera helpers ────────────────────────────────────────────────────────

  function restartCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    setCameraError('')
    setCameraReady(false)
    setPhotoPreview('')
    setPhotoUploaded(false)

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => { })
        }
        setCameraReady(true)
      })
      .catch(err => setCameraError(err?.message || 'Camera access is required.'))
  }

  async function captureBlob() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) throw new Error('Camera is not ready yet.')
    if (!video.videoWidth || !video.videoHeight)
      throw new Error('Camera preview has not loaded yet.')

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Could not capture a photo.'))),
        'image/jpeg',
        0.92,
      )
    })
  }

  async function handleCaptureProof() {
    if (!user?.id) {
      setCameraError('You must be logged in to submit proof.')
      return
    }
    if (!currentStopId) {
      setCameraError('Unable to find the current stop.')
      return
    }

    try {
      const photo = await captureBlob()
      setUploadingProof(true)

      const note_ = note.trim()
      const collected_at = new Date().toISOString()
      const lat = sessionStorage.getItem('ww_gps_lat')
      const lng = sessionStorage.getItem('ww_gps_lng')
      const photoName = `pickup-${currentStopIndex}-${Date.now()}.jpg`

      if (isOnline) {
        // ── ONLINE PATH ─────────────────────────────────────────────────────
        try {
          const formData = new FormData()
          formData.append('photo', photo, photoName)
          formData.append('note', note_)
          formData.append('collected_at', collected_at)
          if (lat) formData.append('lat', lat)
          if (lng) formData.append('lng', lng)

          const res = await api.post(`/api/driver/stops/${currentStopId}/collect/`, formData)

          setPhotoUploaded(true)
          setPhotoPreview(canvasRef.current.toDataURL('image/jpeg', 0.9))
          setPersistedStopStatus(currentStopIndex, 'collected')
          sessionStorage.setItem('ww_pending_collection_photo_url', res.data?.photo_url || '')
          broadcastPickupStatusSync({
            scheduleId: schedule?.id || null,
            stopOrder: currentStopIndex,
            status: 'COMPLETED',
            source: 'arrived-module',
          })
          return
        } catch (netErr) {
          // Network failed despite being "online" → fall through to queue
          const isNetworkErr = !netErr?.response
          if (!isNetworkErr) throw netErr   // real server error, surface it
          // else fall through ↓
        }
      }

      // ── OFFLINE PATH (or network blip fallback) ─────────────────────────
      await proofQueue.enqueue({
        ownerId: String(user.id),
        stopId: currentStopId,
        stopOrder: currentStopIndex,
        scheduleId: schedule?.id || null,
        photo,
        photoName,
        note: note_,
        collected_at,
        lat,
        lng,
      }, 1)

      // Let the driver continue — mark as saved offline
      setPhotoUploaded(true)
      setPhotoPreview(canvasRef.current.toDataURL('image/jpeg', 0.9))
      setPersistedStopStatus(currentStopIndex, 'collected')
      sessionStorage.setItem('ww_pending_collection_photo_url', '')
      broadcastPickupStatusSync({
        scheduleId: schedule?.id || null,
        stopOrder: currentStopIndex,
        status: 'COMPLETED',
        source: 'arrived-module-offline',
      })
      // Surface a soft notice (not an error)
      setCameraError('📶 Saved offline — will sync when connected.')

    } catch (err) {
      setCameraError(
        err?.response?.data?.error || err?.message || 'Proof photo upload failed.',
      )
    } finally {
      setUploadingProof(false)
    }
  }

  // ── Confirm → transition ───────────────────────────────────────────────────

  async function handleConfirm() {
    if (!photoUploaded) return
    setSubmitting(true)
    sessionStorage.setItem('ww_pending_collection_note', note.trim())
    sessionStorage.setItem('ww_pending_collection_stop_id', String(currentStopId))
    sessionStorage.setItem('ww_pending_collection_at', new Date().toISOString())
    sessionStorage.setItem('ww_route_state', 'completed')
    setSubmitting(false)
    setRouteState('completed')
  }

  // ── Loading screen ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: '#f8fafc',
        fontFamily: 'var(--font-body)', gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          border: '3px solid #e2e8f0', borderTopColor: '#0f172a',
          animation: 'amPulse 1.2s linear infinite',
        }} />
        <style>{`@keyframes amPulse { to { transform: rotate(360deg); } }`}</style>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
          Loading stop details...
        </span>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Navbar />
      <style>{`
          @keyframes amSlideUp {
            from { opacity:0; transform:translateY(16px); }
            to   { opacity:1; transform:translateY(0); }
          }
          .am-card { animation: amSlideUp .25s ease both; }
        `}</style>

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f8fafc',
        fontFamily: 'var(--font-body)',
      }}>

        {/* ── ARRIVED HERO ── */}
        <div style={{
          background: 'linear-gradient(160deg, #0f172a 60%, #1e3a5f)',
          padding: '48px 24px 36px',
          textAlign: 'center',
          color: '#fff',
        }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>📍</div>
          <h1 style={{
            fontFamily: 'var(--font-head)',
            fontSize: 26, fontWeight: 900,
            margin: '0 0 8px', letterSpacing: '.02em',
          }}>
            You have arrived
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, margin: 0 }}>
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* ── STOP DETAILS ── */}
        <div className="am-card" style={{
          margin: '0 16px',
          marginTop: -20,
          background: '#fff',
          borderRadius: 16,
          padding: '18px 16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 6 }}>
            CURRENT STOP
          </div>
          <div style={{ fontWeight: 900, fontSize: 16, color: '#0f172a', marginBottom: 4 }}>
            {stopName}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
            {barangay}
          </div>
        </div>

        {/* ── QUICK NOTE PRESETS ── */}
        <div style={{ padding: '0 16px', marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: '#94a3b8',
            letterSpacing: '.06em', marginBottom: 10,
          }}>
            QUICK NOTES
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {QUICK_NOTES.map(preset => (
              <button
                key={preset}
                onClick={() => selectPreset(preset)}
                style={{
                  padding: '8px 14px', borderRadius: 20,
                  border: `1px solid ${note.includes(preset) ? '#0f172a' : '#e2e8f0'}`,
                  background: note.includes(preset) ? '#0f172a' : '#fff',
                  color: note.includes(preset) ? '#fff' : '#475569',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  transition: 'all .15s',
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* ── FREE-TEXT NOTE ── */}
        <div style={{ padding: '0 16px', marginBottom: 20 }}>
          <textarea
            placeholder="Additional notes (optional)…"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={200}
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '12px 14px', borderRadius: 12,
              border: '1.5px solid #e2e8f0', background: '#fff',
              fontSize: 14, color: '#0f172a', resize: 'none',
              fontFamily: 'var(--font-body)',
            }}
          />
        </div>

        {/* ── PHOTO PROOF ── */}
        <div style={{ padding: '0 16px', marginBottom: 28 }}>
          <div style={{
            background: '#fff',
            border: `1.5px solid ${cameraError ? '#ef4444' : '#e2e8f0'}`,
            borderRadius: 16,
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '14px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid #f1f5f9',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em' }}>
                  PHOTO PROOF
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                  Required before confirming
                </div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
                padding: '4px 10px', borderRadius: 999,
                background: photoUploaded ? 'rgba(46,204,113,0.12)' : 'rgba(245,158,11,0.12)',
                color: photoUploaded ? '#16a34a' : '#f59e0b',
              }}>
                {photoUploaded ? 'UPLOADED' : 'REQUIRED'}
              </span>
            </div>

            {/* Viewfinder */}
            <div style={{
              background: '#0f172a',
              minHeight: 220,
              position: 'relative',
            }}>
              {!photoPreview ? (
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                  style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <img
                  src={photoPreview}
                  alt="Captured proof"
                  style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }}
                />
              )}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {!cameraReady && !cameraError && !photoPreview && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#cbd5e1', fontSize: 12, background: 'rgba(15,23,42,0.35)',
                }}>
                  Starting camera...
                </div>
              )}
            </div>

            {/* Error */}
            {/* Replace the existing cameraError block with: */}
            {cameraError && (
              <div style={{
                margin: '12px 16px 0',
                padding: '10px 12px', borderRadius: 10,
                background: cameraError.startsWith('📶')
                  ? 'rgba(20,184,166,0.08)'
                  : 'rgba(239,68,68,0.08)',
                border: cameraError.startsWith('📶')
                  ? '1px solid rgba(20,184,166,0.25)'
                  : '1px solid rgba(239,68,68,0.18)',
                color: cameraError.startsWith('📶') ? '#0d9488' : '#b91c1c',
                fontSize: 12,
              }}>
                {cameraError}
              </div>
            )}

            {/* Controls */}
            <div style={{ display: 'flex', gap: 10, padding: '12px 16px 16px' }}>
              <button
                onClick={handleCaptureProof}
                disabled={uploadingProof || photoUploaded || !!cameraError || !cameraReady}
                style={{
                  flex: 1, padding: '14px 12px', borderRadius: 12, border: 'none',
                  background: uploadingProof ? '#cbd5e1' : '#0f172a', color: '#fff',
                  fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 900,
                  letterSpacing: '.04em',
                  cursor: uploadingProof || photoUploaded || !!cameraError || !cameraReady
                    ? 'not-allowed' : 'pointer',
                }}
              >
                {uploadingProof ? 'Uploading...' : photoUploaded ? '✓ Photo Uploaded' : '📷 Take Photo'}
              </button>
              <button
                onClick={restartCamera}
                style={{
                  width: 100, padding: '14px 12px', borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  background: '#fff', color: '#0f172a',
                  fontFamily: 'var(--font-head)', fontSize: 13, fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Retake
              </button>
            </div>
          </div>
        </div>

        {/* ── CONFIRM CTA ── */}
        <div style={{ padding: '0 16px', marginTop: 'auto', paddingBottom: 32 }}>
          <button
            id="confirm-collection-btn"
            onClick={handleConfirm}
            disabled={submitting || !photoUploaded}
            style={{
              width: '100%', padding: '18px', borderRadius: 30,
              background: submitting || !photoUploaded ? '#e2e8f0' : '#0f172a',
              color: submitting || !photoUploaded ? '#94a3b8' : '#fff',
              border: 'none',
              fontFamily: 'var(--font-head)',
              fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
              cursor: submitting || !photoUploaded ? 'not-allowed' : 'pointer',
              boxShadow: submitting || !photoUploaded ? 'none' : '0 6px 20px rgba(15,23,42,0.3)',
              transition: 'all .2s',
            }}
          >
            {submitting ? 'Saving…' : photoUploaded ? '✓ Confirm Collection' : 'Take a photo to confirm'}
          </button>
        </div>

      </div>
    </>
  )
}