/**
 * ArrivedModule.jsx
 * ------------------
 * Rendered when routeState === "arrived".
 * Driver confirms collection at the stop by capturing proof photos and
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

import { useState, useEffect } from 'react'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'
import { broadcastPickupStatusSync } from '../../../utils/pickupStatusSync'
import { useOnline } from '../../../hooks/useOnline'
import { getQueue } from '../../../hooks/useOfflineQueue'
import { useAuth } from '../../../context/AuthContext'
import MultiPhotoPicker from '../../../components/MultiPhotoPicker'

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
  const proofQueue = getQueue('proof_submissions')

  // Camera state
  const [cameraError, setCameraError] = useState('')
  const [photos, setPhotos] = useState([])

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

  // ── Confirm → transition ───────────────────────────────────────────────────

  async function handleConfirm() {
    if (photos.length === 0) {
      setCameraError('You must take at least one photo to confirm.')
      return
    }

    if (!user?.id) {
      setCameraError('You must be logged in to submit proof.')
      return
    }

    if (!currentStopId) {
      setCameraError('Unable to find the current stop.')
      return
    }

    setSubmitting(true)
    setCameraError('')

    try {
      const safeStopIndex = parseInt(sessionStorage.getItem('ww_current_stop_index') || '1', 10)
      
      const photoRes = await fetch(photos[0])
      const photoBlob = await photoRes.blob()

      const note_ = note.trim()
      const collected_at = new Date().toISOString()
      const lat = sessionStorage.getItem('ww_gps_lat') || ''
      const lng = sessionStorage.getItem('ww_gps_lng') || ''
      const photoName = `pickup-${safeStopIndex}-${Date.now()}.jpg`

      if (isOnline) {
        try {
          const formData = new FormData()
          formData.append('photo', photoBlob, photoName)
          formData.append('note', note_)
          formData.append('collected_at', collected_at)
          if (lat) formData.append('lat', lat)
          if (lng) formData.append('lng', lng)
          formData.append('schedule_id', schedule?.id || '')
          formData.append('stop_order', String(safeStopIndex))

          const res = await api.post(`/api/driver/stops/collect/`, formData)

          setPersistedStopStatus(safeStopIndex, 'collected')
          sessionStorage.setItem('ww_pending_collection_photo_url', res.data?.photo_url || '')
          broadcastPickupStatusSync({
            scheduleId: schedule?.id || null,
            stopOrder: safeStopIndex,
            status: 'COMPLETED',
            source: 'arrived-module',
          })

          sessionStorage.setItem('ww_pending_collection_note', note_)
          sessionStorage.setItem('ww_pending_collection_stop_id', String(currentStopId))
          sessionStorage.setItem('ww_pending_collection_at', collected_at)
          sessionStorage.setItem('ww_route_state', 'completed')
          setRouteState('completed')
          return
        } catch (netErr) {
          const isNetworkErr = !netErr?.response
          if (!isNetworkErr) throw netErr
        }
      }

      await proofQueue.enqueue({
        ownerId: String(user.id),
        stopId: currentStopId,
        stopOrder: safeStopIndex,
        scheduleId: schedule?.id || null,
        photo: photoBlob,
        photoName,
        note: note_,
        collected_at,
        lat,
        lng,
      }, 1)

      setPersistedStopStatus(safeStopIndex, 'collected')
      sessionStorage.setItem('ww_pending_collection_photo_url', '')
      broadcastPickupStatusSync({
        scheduleId: schedule?.id || null,
        stopOrder: safeStopIndex,
        status: 'COMPLETED',
        source: 'arrived-module-offline',
      })

      sessionStorage.setItem('ww_pending_collection_note', note_)
      sessionStorage.setItem('ww_pending_collection_stop_id', String(currentStopId))
      sessionStorage.setItem('ww_pending_collection_at', collected_at)
      sessionStorage.setItem('ww_route_state', 'completed')
      setRouteState('completed')
    } catch (err) {
      setCameraError(
        err?.response?.data?.error || err?.message || 'Proof photo upload failed.',
      )
      setSubmitting(false)
    }
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
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.2)'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
            </div>
          </div>
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

        {/* ── MULTI PHOTO PICKER ── */}
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

        {/* ── CONFIRM CTA ── */}
        <div style={{ padding: '0 16px', marginTop: 'auto', paddingBottom: 32 }}>
          <button
            id="confirm-collection-btn"
            onClick={handleConfirm}
            disabled={submitting || photos.length === 0}
            style={{
              width: '100%', padding: '18px', borderRadius: 30,
              background: submitting || photos.length === 0 ? '#e2e8f0' : '#0f172a',
              color: submitting || photos.length === 0 ? '#94a3b8' : '#fff',
              border: 'none',
              fontFamily: 'var(--font-head)',
              fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
              cursor: submitting || photos.length === 0 ? 'not-allowed' : 'pointer',
              boxShadow: submitting || photos.length === 0 ? 'none' : '0 6px 20px rgba(15,23,42,0.3)',
              transition: 'all .2s',
            }}
          >
            {submitting ? 'Saving…' : photos.length > 0 ? '✓ Confirm Collection' : 'Take a photo to confirm'}
          </button>
        </div>

      </div>
    </>
  )
}