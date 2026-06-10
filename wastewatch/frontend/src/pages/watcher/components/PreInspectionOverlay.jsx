/**
 * PreInspectionOverlay.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Sliding overlay for watcher pre-collection inspection.
 * Mirrors ArrivedOverlay in ShiftRouteModule but adapted for the watcher role.
 *
 * Flow:
 *   1. Shows stop name + status
 *   2. Watcher selects outcome: "Garbage Present" → READY_FOR_COLLECTION
 *                               "No Garbage"      → EMPTY_STOP
 *   3. Watcher takes a photo via WatcherCameraModal (optional but recommended)
 *   4. Adds remarks (optional)
 *   5. Submits to POST /api/watcher/stop-validations/pre-inspect/
 *
 * PROPS:
 *   visible   {boolean}
 *   task      {{ schedule_id, stop_order, label, lat, lng, current_status }}
 *   gpsPos    {{ lat, lng } | null}
 *   onComplete {() => void}  — called after successful submit
 *   onBack    {() => void}   — called when watcher cancels
 */

import { useState, useEffect } from 'react'
import api from '../../../api/client'
import WatcherCameraModal from './WatcherCameraModal'
import { broadcastPickupStatusSync } from '../../../utils/pickupStatusSync'

const QUICK_NOTES = ['Bags at roadside', 'Bins overflowing', 'Scatter outside', 'Neatly bagged', 'No bins visible']

export default function PreInspectionOverlay({ visible, task, gpsPos, onComplete, onBack }) {
  const [outcome, setOutcome] = useState('')       // 'garbage_present' | 'no_garbage'
  const [remarks, setRemarks] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Reset every time a new task opens
  useEffect(() => {
    if (!visible) return
    setOutcome('')
    setRemarks('')
    setCameraOpen(false)
    setPhotoBlob(null)
    setPhotoPreview(null)
    setSubmitting(false)
    setError('')
  }, [visible, task?.id])

  function handleQuickNote(note) {
    setRemarks(prev => prev ? `${prev}, ${note}` : note)
  }

  function handlePhotoCapture(blob, previewUrl) {
    setPhotoBlob(blob)
    setPhotoPreview(previewUrl)
    setCameraOpen(false)
  }

  function handleClearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoBlob(null)
    setPhotoPreview(null)
  }

  async function handleSubmit() {
    if (!outcome) { setError('Please select an outcome before submitting.'); return }
    if (!gpsPos) { setError('GPS location required. Please wait for a signal.'); return }

    setSubmitting(true)
    setError('')

    try {
      const form = new FormData()
      form.append('schedule_id', String(task.schedule_id))
      form.append('stop_order', String(task.stop_order))
      form.append('lat', String(gpsPos.lat))
      form.append('lng', String(gpsPos.lng))
      form.append('outcome', outcome)
      form.append('remarks', remarks.trim())
      if (photoBlob) form.append('photo', photoBlob, `inspect-${task.stop_order}-${Date.now()}.jpg`)

      await api.post('/api/watcher/stop-validations/pre-inspect/', form)

      broadcastPickupStatusSync({
        scheduleId: task.schedule_id,
        stopOrder: task.stop_order,
        status: outcome === 'no_garbage' ? 'EMPTY_STOP' : 'READY_FOR_COLLECTION',
        source: 'pre-inspection-overlay',
      })

      onComplete?.()
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!visible || !task) return null

  const canSubmit = !!outcome && !!gpsPos && !submitting

  return (
    <>
      <style>{`
        @keyframes pio-slide-up { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .pio-card { animation: pio-slide-up .25s ease both; }
      `}</style>

      {/* Backdrop */}
      <div onClick={onBack} style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(15,23,42,.65)', backdropFilter: 'blur(5px)',
      }} />

      {/* Sheet — bottom on mobile, centred on desktop */}
      <div style={{
        position: 'fixed', zIndex: 3001,
        left: 0, right: 0, bottom: 0,
        maxWidth: 560, margin: '0 auto',
        height: '85vh', maxHeight: '85vh',
        borderRadius: '18px 18px 0 0',
        background: '#f8fafc',
        boxShadow: '0 -8px 40px rgba(0,0,0,.35)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        animation: 'pio-slide-up .3s cubic-bezier(.32,.72,0,1)',
      }}>

        {/* Hero header */}
        <div style={{
          background: 'linear-gradient(160deg,#0f172a 60%,#134e4a)',
          padding: '36px 24px 28px', textAlign: 'center', color: '#fff',
          borderRadius: '18px 18px 0 0', flexShrink: 0,
        }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, margin: '0 0 4px', letterSpacing: '.02em' }}>
            Pre-Collection Inspection
          </h1>
          <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 12, margin: 0 }}>
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 100px' }}>

          {/* Stop card */}
          <div className="pio-card" style={{
            margin: '0 0 16px', marginTop: -18,
            background: '#fff', borderRadius: 14, padding: '14px 16px',
            boxShadow: '0 4px 20px rgba(0,0,0,.08)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 4 }}>STOP LOCATION</div>
            <div style={{ fontWeight: 900, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>{task.label}</div>
            {gpsPos ? (
              <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                GPS confirmed · {gpsPos.lat.toFixed(5)}, {gpsPos.lng.toFixed(5)}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>⚠️ Waiting for GPS signal…</div>
            )}
          </div>

          {/* Outcome selection */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 10 }}>INSPECTION OUTCOME *</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { value: 'garbage_present', label: '🗑️ Garbage Present', color: '#f59e0b', bg: 'rgba(245,158,11,.08)' },
                { value: 'no_garbage', label: '✅ No Garbage', color: '#16a34a', bg: 'rgba(22,163,74,.08)' },
              ].map(opt => (
                <button key={opt.value}
                  onClick={() => setOutcome(opt.value)}
                  style={{
                    flex: 1, padding: '14px 8px', borderRadius: 14, cursor: 'pointer',
                    border: `2px solid ${outcome === opt.value ? opt.color : '#e2e8f0'}`,
                    background: outcome === opt.value ? opt.bg : '#fff',
                    color: outcome === opt.value ? opt.color : '#475569',
                    fontWeight: 800, fontSize: 13, transition: 'all .15s',
                    boxShadow: outcome === opt.value ? `0 4px 14px ${opt.color}33` : 'none',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Photo capture */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 10 }}>PHOTO PROOF</div>
            {!photoBlob ? (
              <button onClick={() => setCameraOpen(true)} style={{
                width: '100%', padding: '16px', borderRadius: 14,
                border: '2px dashed #cbd5e1', background: '#fff',
                display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
                transition: 'all .15s',
              }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📷</div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 2 }}>Take Inspection Photo</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Recommended · GPS location will be verified</div>
                </div>
                <div style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, letterSpacing: '.05em', padding: '4px 8px', borderRadius: 20, background: 'rgba(100,116,139,.1)', color: '#64748b', flexShrink: 0 }}>OPTIONAL</div>
              </button>
            ) : (
              <div style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1.5px solid rgba(20,184,166,.35)', background: 'rgba(20,184,166,.05)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <img src={photoPreview} alt="Proof" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#14b8a6', marginBottom: 2 }}>Photo captured</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>GPS location recorded</div>
                </div>
                <button onClick={handleClearPhoto} style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Retake</button>
              </div>
            )}
          </div>

          {/* Quick notes */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 8 }}>QUICK NOTES</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {QUICK_NOTES.map(note => (
                <button key={note} onClick={() => handleQuickNote(note)} style={{
                  padding: '7px 12px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${remarks.includes(note) ? '#0f172a' : '#e2e8f0'}`,
                  background: remarks.includes(note) ? '#0f172a' : '#fff',
                  color: remarks.includes(note) ? '#fff' : '#475569',
                  fontSize: 12, fontWeight: 600, transition: 'all .15s',
                }}>{note}</button>
              ))}
            </div>
          </div>

          {/* Remarks textarea */}
          <div style={{ marginBottom: 16 }}>
            <textarea
              placeholder="Additional remarks (optional)…"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              maxLength={300}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px', borderRadius: 10,
                border: '1.5px solid #e2e8f0', background: '#fff',
                fontSize: 13, color: '#0f172a', resize: 'none',
                fontFamily: 'var(--font-body)',
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 12, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#ef4444', fontSize: 12, fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>

        {/* Fixed bottom action bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '16px 16px 28px',
          background: 'linear-gradient(to top, #f8fafc 70%, transparent)',
          display: 'flex', gap: 10,
        }}>
          <button onClick={onBack} style={{
            flex: '0 0 auto', padding: '15px 20px', borderRadius: 30,
            background: '#fff', border: '1.5px solid #e2e8f0',
            color: '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit} style={{
            flex: 1, padding: '15px', borderRadius: 30, border: 'none',
            background: canSubmit ? '#0f172a' : '#e2e8f0',
            color: canSubmit ? '#fff' : '#94a3b8',
            fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
            letterSpacing: '.05em',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            boxShadow: canSubmit ? '0 6px 20px rgba(15,23,42,.3)' : 'none',
            transition: 'all .2s',
          }}>
            {submitting ? 'Submitting…' : !outcome ? '⬆ Select outcome first' : '✓ Submit Inspection'}
          </button>
        </div>
      </div>

      {/* Camera modal — rendered above the overlay */}
      <WatcherCameraModal
        visible={cameraOpen}
        stopLabel={task.label}
        gpsPos={gpsPos}
        onCapture={handlePhotoCapture}
        onClose={() => setCameraOpen(false)}
      />
    </>
  )
}
