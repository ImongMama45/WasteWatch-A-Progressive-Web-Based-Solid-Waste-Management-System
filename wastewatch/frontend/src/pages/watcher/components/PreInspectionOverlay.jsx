/**
 * components/PreInspectionOverlay — PATCH NOTES
 * ------------------------------------------------
 * This file shows only what needs to change from your existing
 * PreInspectionOverlay to support mandatory multi-photo capture.
 *
 * The overlay now receives a `MultiPhotoPicker` component prop
 * from VerificationTasksModule (same shared component, passed down
 * to avoid duplicating the camera logic).
 *
 * KEY CHANGES TO YOUR EXISTING PreInspectionOverlay:
 *
 * 1. Accept `MultiPhotoPicker` as a prop:
 *    export default function PreInspectionOverlay({ visible, task, gpsPos, onComplete, onBack, MultiPhotoPicker })
 *
 * 2. Add photos state:
 *    const [photos, setPhotos] = useState([])
 *
 * 3. Reset photos when overlay opens:
 *    useEffect(() => { if (visible) { ... setPhotos([]) } }, [visible, task?.id])
 *
 * 4. Replace the single photo upload section with:
 *    {MultiPhotoPicker && <MultiPhotoPicker photos={photos} onChange={setPhotos} />}
 *
 * 5. Block submission if no photos:
 *    if (photos.length === 0) { setError('At least one photo is required.'); return }
 *
 * 6. Append all photos to FormData:
 *    photos.forEach((file, i) => form.append(i === 0 ? 'photo' : `photo_${i+1}`, file))
 *
 * 7. Disable/style the submit button when photos are missing:
 *    const canSubmit = outcome && gpsPos && photos.length > 0 && !submitting
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Full drop-in replacement below (adapt field names to match your existing
 * PreInspectionOverlay form shape — outcome values, API endpoint, etc.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from 'react'
import api from '../../../api/client'
import { broadcastPickupStatusSync } from '../../../utils/pickupStatusSync'
import { ICONS } from '../../../api/navConfig'
import { useOnline } from '../../../hooks/useOnline'
import { getQueue } from '../../../hooks/useOfflineQueue'
import { useAuth } from '../../../context/AuthContext'
import { blobToBase64, estimateQueueStorageMB, isNearStorageLimit } from '../../../utils/photoStorage'

export default function PreInspectionOverlay({ visible, task, gpsPos, onComplete, onBack, MultiPhotoPicker }) {
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
      setError('You must be logged in to submit an inspection.')
      return
    }
    if (!outcome) { setError('Please select an inspection outcome.'); return }
    if (photos.length === 0) { setError('At least one photo is required.'); return }
    if (!gpsPos) { setError('GPS location required.'); return }

    setSubmitting(true); setError('')

    const payload = {
      ownerId: String(user.id),   // always a real watcher ID, never anonymous
      schedule_id: task.schedule_id,
      stop_order: task.stop_order,
      lat: gpsPos.lat,
      lng: gpsPos.lng,
      outcome,
      notes: notes.trim(),
      photos,
    }

    if (isOnline) {
      // ── ONLINE PATH ───────────────────────────────────────────────────────
      try {
        const form = new FormData()
        form.append('schedule_id', payload.schedule_id)
        form.append('stop_order', payload.stop_order)
        form.append('lat', payload.lat)
        form.append('lng', payload.lng)
        form.append('outcome', payload.outcome)
        form.append('notes', payload.notes)
        photos.forEach((file, i) =>
          form.append(i === 0 ? 'photo' : `photo_${i + 1}`, file)
        )
        await api.post('/api/watcher/stop-validations/pre-inspect/', form)
        broadcastPickupStatusSync()
        onComplete()
        return
      } catch (err) {
        if (err.response?.status === 400) {
          setError(err.response?.data?.error || 'Stop already submitted')
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

    // ── OFFLINE PATH ──────────────────────────────────────────────────────
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

      await inspectQueue.enqueue(offlinePayload, 1 /* high priority */)
      broadcastPickupStatusSync()
      onComplete()   // let watcher proceed immediately
    } catch (qErr) {
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
          <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.45)', letterSpacing: '.1em', marginBottom: 4 }}>PRE-COLLECTION INSPECTION</div>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 900 }}>{stopLabel}</div>
        </div>

        <div style={{ padding: '18px 20px' }}>

          {/* GPS indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: gpsPos ? 'rgba(20,184,166,0.1)' : 'rgba(245,158,11,0.1)', color: gpsPos ? '#14b8a6' : '#f59e0b', padding: '6px 12px', borderRadius: 20 }}>
            <div style={{ width: 14, height: 14 }}>{gpsPos ? ICONS.pin : ICONS.warning}</div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em' }}>{gpsPos ? 'GPS ACQUIRED' : 'LOCATING...'}</span>
          </div>

          {/* Outcome */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', marginBottom: 8 }}>INSPECTION OUTCOME *</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { key: 'present', label: 'Garbage Present', icon: ICONS.trash, color: '#f59e0b' },
              { key: 'empty', label: 'Empty / Clean', icon: ICONS.check, color: '#16a34a' },
            ].map(opt => (
              <button key={opt.key} onClick={() => setOutcome(opt.key)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 8px', borderRadius: 10,
                border: `1.5px solid ${outcome === opt.key ? opt.color : '#e2e8f0'}`,
                background: outcome === opt.key ? `${opt.color}10` : '#fff',
                color: outcome === opt.key ? opt.color : '#475569',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
              }}>
                <div style={{ width: 18, height: 18 }}>{opt.icon}</div>
                <div>{opt.label}</div>
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
            <button onClick={handleSubmit} disabled={!canSubmit} style={{
              flex: 2, padding: '14px', borderRadius: 12, border: 'none',
              background: canSubmit ? '#0f172a' : '#e2e8f0',
              color: canSubmit ? '#fff' : '#94a3b8',
              fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 900,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              boxShadow: canSubmit ? '0 4px 16px rgba(15,23,42,.25)' : 'none',
              transition: 'all .2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {submitting ? 'Submitting...' : <><div style={{ width: 18, height: 18 }}>{ICONS.search}</div> Submit Inspection</>}
              </div>
            </button>
          </div>
          <div style={{ height: 20 }} />
        </div>
      </div>
    </div>
  )
}