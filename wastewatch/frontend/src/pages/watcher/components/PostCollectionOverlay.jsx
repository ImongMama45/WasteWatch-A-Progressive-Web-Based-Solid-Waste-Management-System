/**
 * components/PostCollectionOverlay — PATCH NOTES
 * ------------------------------------------------
 * Mirrors PreInspectionOverlay with post-collection
 * specific changes:
 * - Endpoint: /api/watcher/stop-validations/post-verify/
 * - Outcome options: 'success' | 'failed'
 * - Header label: POST-COLLECTION VERIFICATION
 * - Submit button: green (#16a34a) instead of dark
 * - payload.type = 'post_verify' for sync manager routing
 */

import { useState, useEffect } from 'react'
import api from '../../../api/client'
import { broadcastPickupStatusSync } from '../../../utils/pickupStatusSync'
import { ICONS } from '../../../api/navConfig'
import { useOnline } from '../../../hooks/useOnline'
import { getQueue } from '../../../hooks/useOfflineQueue'
import { useAuth } from '../../../context/AuthContext'
import { blobToBase64, estimateQueueStorageMB, isNearStorageLimit } from '../../../utils/photoStorage'

export default function PostCollectionOverlay({ visible, task, gpsPos, onComplete, onBack, MultiPhotoPicker }) {
  const [outcome, setOutcome] = useState('')     // 'present' | 'empty'
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const isOnline = useOnline()
  const inspectQueue = getQueue('inspection_submissions')
  const { user } = useAuth()

  useEffect(() => {
    if (visible) { setOutcome(''); setNotes(''); setPhotos([]); setError(''); setSubmitting(false); }
  }, [visible, task?.id])

  async function handleSubmit() {
    if (!user?.id) {
      setError('You must be logged in to submit a verification.')
      return
    }
    if (!outcome) { setError('Please select an inspection outcome.'); return }
    if (photos.length === 0) { setError('At least one photo is required.'); return }
    if (!gpsPos) { setError('GPS location required.'); return }

    setSubmitting(true); setError('')

    const payload = {
      ownerId: String(user.id),
      schedule_id: task.schedule_id,
      stop_order: task.stop_order,
      lat: gpsPos.lat,
      lng: gpsPos.lng,
      outcome,
      notes: notes.trim(),
      photos,
      type: 'post_verify'
    }

    if (isOnline) {
      try {
        const form = new FormData()
        form.append('schedule_id', payload.schedule_id)
        form.append('stop_order', payload.stop_order)
        form.append('lat', payload.lat)
        form.append('lng', payload.lng)
        form.append('outcome', payload.outcome)
        form.append('notes', payload.notes)
        photos.forEach((file, i) => form.append(i === 0 ? 'photo' : `photo_${i + 1}`, file))
        await api.post('/api/watcher/stop-validations/post-verify/', form)
        broadcastPickupStatusSync()
        onComplete()
        return
      } catch (err) {
        if (err.response?.status === 400) {
          setError(err.response?.data?.error || 'Stop already verified')
          setTimeout(() => onComplete(), 2500)
          return
        } else if (!err.response) {
          // Network blip → fall through to queue
        } else {
          setError('Server error. Please try again.')
          setSubmitting(false)
          return
        }
      }
    }

    // ── OFFLINE / FALLBACK PATH ─────────────────────────────────────────────
    try {
      const estimatedMB = await estimateQueueStorageMB(inspectQueue)
      if (isNearStorageLimit(estimatedMB)) {
        setError(`Offline storage is getting full (${estimatedMB.toFixed(1)}MB used). Please reconnect to sync your pending inspections before continuing.`)
        setSubmitting(false)
        return
      }

      // Convert photos to base64 before enqueuing
      const serializedPhotos = await Promise.all(
        photos.map(file => blobToBase64(file))
      )

      const offlinePayload = {
        ...payload,
        photos: serializedPhotos
      }

      await inspectQueue.enqueue(offlinePayload, 1)
      broadcastPickupStatusSync()
      onComplete()
    } catch (e) {
      setError('Failed to save offline. Storage may be full.')
      setSubmitting(false)
    }
  }

  if (!visible) return null

  const stopLabel = task?.label || `Stop ${task?.stop_order}`
  const canSubmit = outcome && gpsPos && photos.length > 0 && !submitting

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.65)', backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: '#fff', borderRadius: '22px 22px 0 0', boxShadow: '0 -6px 40px rgba(0,0,0,.25)', maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ width: 40, height: 4, background: '#cbd5e1', borderRadius: 2, margin: '14px auto 0' }} />

        {/* Header */}
        <div style={{ background: 'linear-gradient(160deg, #0f172a 60%, #0c4a6e)', padding: '20px 20px 18px', color: '#fff', marginTop: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.45)', letterSpacing: '.1em', marginBottom: 4 }}>POST-COLLECTION VERIFICATION</div>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900 }}>{stopLabel}</div>
        </div>

        <div style={{ padding: '18px 20px' }}>

          {/* GPS indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 10, marginBottom: 16, background: gpsPos ? 'rgba(22,163,74,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${gpsPos ? 'rgba(22,163,74,0.25)' : 'rgba(245,158,11,0.3)'}` }}>
            <div style={{ width: 14, height: 14, color: gpsPos ? '#16a34a' : '#f59e0b' }}>{gpsPos ? ICONS.pin : ICONS.warning}</div>
            <span style={{ fontSize: 12, fontWeight: 700, color: gpsPos ? '#16a34a' : '#f59e0b' }}>
              {gpsPos ? `GPS verified · ${gpsPos.lat.toFixed(4)}, ${gpsPos.lng.toFixed(4)}` : 'Waiting for GPS fix…'}
            </span>
          </div>

          {/* Outcome */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', marginBottom: 8 }}>REMARKS / REASON *</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            {[
              { key: 'success', label: 'Collection Complete', icon: ICONS.check, color: '#16a34a' },
              { key: 'failed', label: 'Missed Collection', icon: ICONS.warning, color: '#ef4444' },
            ].map(opt => (
              <button key={opt.key} onClick={() => setOutcome(opt.key)} style={{
                flex: 1, padding: '12px 8px', borderRadius: 10,
                border: `1.5px solid ${outcome === opt.key ? opt.color : '#e2e8f0'}`,
                background: outcome === opt.key ? `${opt.color}10` : '#fff',
                color: outcome === opt.key ? opt.color : '#475569',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <div style={{ width: 16, height: 16 }}>{opt.icon}</div> {opt.label}
                </div>
              </button>
            ))}
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', display: 'block', marginBottom: 7 }}>NOTES (OPTIONAL)</label>
            <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Describe the condition of the stop…" style={{ resize: 'vertical' }} />
          </div>

          {/* Multi-photo (mandatory) */}
          <div style={{ marginBottom: 20 }}>
            {MultiPhotoPicker
              ? <MultiPhotoPicker photos={photos} onChange={setPhotos} />
              : <p style={{ fontSize: 12, color: '#94a3b8' }}>Photo upload not available.</p>
            }
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#ef4444', marginBottom: 14 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={onBack} disabled={submitting}>Cancel</button>
            <button disabled={!canSubmit} onClick={handleSubmit} style={{ flex: 2, padding: '15px', borderRadius: 14, border: 'none', background: canSubmit ? '#16a34a' : '#e2e8f0', color: canSubmit ? '#fff' : '#94a3b8', fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, cursor: canSubmit ? 'pointer' : 'not-allowed', transition: 'all .2s', boxShadow: canSubmit ? '0 4px 14px rgba(22,163,74,.3)' : 'none' }}>
              {submitting ? 'Submitting…' : 'Verify Collection'}
            </button>
          </div>
          <div style={{ height: 20 }} />
        </div>
      </div>
    </div>
  )
}