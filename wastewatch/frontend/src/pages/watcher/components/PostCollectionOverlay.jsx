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

export default function PostCollectionOverlay({ visible, task, gpsPos, onComplete, onBack, MultiPhotoPicker }) {
  const [outcome, setOutcome] = useState('')     // 'present' | 'empty'
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (visible) { setOutcome(''); setNotes(''); setPhotos([]); setError('') }
  }, [visible, task?.id])

  async function handleSubmit() {
    if (!outcome) { setError('Please select an inspection outcome.'); return }
    if (photos.length === 0) { setError('At least one photo is required.'); return }
    if (!gpsPos) { setError('GPS location required.'); return }

    setSubmitting(true); setError('')
    try {
      const form = new FormData()
      form.append('schedule_id', task.schedule_id)
      form.append('stop_order', task.stop_order)
      form.append('lat', gpsPos.lat)
      form.append('lng', gpsPos.lng)
      form.append('outcome', outcome)
      form.append('notes', notes.trim())
      photos.forEach((file, i) => form.append(i === 0 ? 'photo' : `photo_${i + 1}`, file))
      await api.post('/api/watcher/stop-validations/post-verify/', form)
      broadcastPickupStatusSync()
      onComplete()
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed.')
    } finally {
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, marginBottom: 16, background: gpsPos ? 'rgba(22,163,74,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${gpsPos ? 'rgba(22,163,74,0.25)' : 'rgba(245,158,11,0.3)'}` }}>
            <span style={{ fontSize: 14 }}>{gpsPos ? '📍' : '📡'}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: gpsPos ? '#16a34a' : '#f59e0b' }}>
              {gpsPos ? `GPS verified · ${gpsPos.lat.toFixed(4)}, ${gpsPos.lng.toFixed(4)}` : 'Waiting for GPS fix…'}
            </span>
          </div>

          {/* Outcome */}
          <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', marginBottom: 8 }}>REMARKS / REASON *</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            {[
              { key: 'success', label: '✅ Collection Complete', color: '#16a34a' },
              { key: 'failed', label: '❌ Missed Collection', color: '#ef4444' },
            ].map(opt => (
              <button key={opt.key} onClick={() => setOutcome(opt.key)} style={{
                flex: 1, padding: '12px 8px', borderRadius: 10,
                border: `1.5px solid ${outcome === opt.key ? opt.color : '#e2e8f0'}`,
                background: outcome === opt.key ? `${opt.color}10` : '#fff',
                color: outcome === opt.key ? opt.color : '#475569',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
              }}>{opt.label}</button>
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