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
import { X, Layers, ChevronDown, ChevronUp } from 'lucide-react'
import api from '../../../api/client'
import { broadcastPickupStatusSync } from '../../../utils/pickupStatusSync'
import { ICONS } from '../../../api/navConfig'
import { useOnline } from '../../../hooks/useOnline'
import { getQueue } from '../../../hooks/useOfflineQueue'
import { useAuth } from '../../../context/AuthContext'
import { blobToBase64, estimateQueueStorageMB, isNearStorageLimit } from '../../../utils/photoStorage'

export default function PostCollectionOverlay({
  visible,
  task,
  gpsPos,
  onComplete,
  onBack,
  MultiPhotoPicker,
  nearbyWatcherSpots = [],
  mapType = 'default',
  onToggleMapType,
}) {
  const [outcome, setOutcome] = useState('')     // 'present' | 'empty'
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const isOnline = useOnline()
  const inspectQueue = getQueue('inspection_submissions')
  const { user } = useAuth()

  useEffect(() => {
    if (visible) { setOutcome(''); setNotes(''); setPhotos([]); setError(''); setSubmitting(false); setIsCollapsed(false); }
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
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 2000,
      background: isCollapsed ? 'transparent' : 'rgba(15,23,42,.65)',
      backdropFilter: isCollapsed ? 'none' : 'blur(4px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      pointerEvents: isCollapsed ? 'none' : 'auto',
      transition: 'background 0.25s ease',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '24px 24px 0 0',
        boxShadow: '0 -10px 40px rgba(0,0,0,.3)',
        maxHeight: isCollapsed ? 'none' : '92vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pointerEvents: 'auto',
        transition: 'max-height 0.3s cubic-bezier(0.3, 0.8, 0.3, 1)',
      }}>

        {/* Retractable Drag Pill / Collapse Handle */}
        <div
          onClick={() => setIsCollapsed(prev => !prev)}
          title={isCollapsed ? "Expand verification form" : "Collapse form to view map"}
          style={{
            cursor: 'pointer',
            padding: '8px 16px 4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
          }}
        >
          <div style={{ width: 36, height: 4, background: '#cbd5e1', borderRadius: 2, marginBottom: 3 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {isCollapsed ? (
              <>
                <ChevronUp size={13} />
                <span>Tap to expand verification</span>
              </>
            ) : (
              <>
                <ChevronDown size={13} />
                <span>Tap to collapse to map</span>
              </>
            )}
          </div>
        </div>

        {/* Fixed Header */}
        <div style={{
          background: 'linear-gradient(160deg, #0f172a 60%, #064e3b)',
          padding: '14px 18px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#ffffff', border: '2.5px solid #16a34a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#0f172a', fontWeight: 900, fontSize: 15,
              boxShadow: '0 2px 10px rgba(0,0,0,0.3)', flexShrink: 0
            }}>
              {task?.stop_order || 1}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.55)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Post-Collection Verification
              </div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {stopLabel}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {onToggleMapType && (
              <button
                type="button"
                onClick={onToggleMapType}
                title={`Switch map view to ${mapType === 'satellite' ? 'Default' : 'Satellite'}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 16,
                  background: mapType === 'satellite' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(255, 255, 255, 0.14)',
                  border: `1px solid ${mapType === 'satellite' ? '#22c55e' : 'rgba(255, 255, 255, 0.25)'}`,
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.03em',
                }}
              >
                <Layers size={13} />
                <span>{mapType === 'satellite' ? 'Satellite' : 'Default'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onBack}
              disabled={submitting}
              title="Close overlay"
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(255,255,255,0.14)',
                border: 'none', color: '#ffffff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0
              }}
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Scrollable Body — hidden when collapsed */}
        {!isCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 10px' }}>

          {/* GPS indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: gpsPos ? 'rgba(22,163,74,0.08)' : 'rgba(245,158,11,0.08)', color: gpsPos ? '#16a34a' : '#f59e0b', padding: '6px 12px', borderRadius: 20, marginBottom: 12 }}>
            <div style={{ width: 14, height: 14 }}>{gpsPos ? ICONS.pin : ICONS.warning}</div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em' }}>
              {gpsPos ? `GPS VERIFIED (${gpsPos.lat.toFixed(4)}, ${gpsPos.lng.toFixed(4)})` : 'WAITING FOR GPS FIX...'}
            </span>
          </div>

          {/* Watcher Reported Spots Suggestion Banner */}
          {nearbyWatcherSpots && nearbyWatcherSpots.length > 0 && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(37,99,235,0.06) 0%, rgba(59,130,246,0.12) 100%)',
              border: '1.5px solid rgba(37,99,235,0.35)',
              borderRadius: 14,
              padding: '13px 15px',
              marginBottom: 16,
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              boxShadow: '0 4px 14px rgba(37,99,235,0.1)',
            }}>
              {/* Blue Dotted Spot Marker Badge */}
              <div style={{
                width: 38, height: 38, borderRadius: '50%',
                border: '2.5px dotted #2563eb',
                background: 'rgba(37, 99, 235, 0.2)',
                boxShadow: '0 0 12px rgba(37, 99, 235, 0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#1d4ed8', fontWeight: 900, fontSize: 13,
                flexShrink: 0, marginTop: 2,
              }}>
                W{nearbyWatcherSpots[0]?.report_count || 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 900, color: '#1d4ed8', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                    Watcher Reported Spot Nearby
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 800, background: '#2563eb', color: '#fff', padding: '1px 7px', borderRadius: 10 }}>
                    {nearbyWatcherSpots.length} Spot{nearbyWatcherSpots.length > 1 ? 's' : ''}
                  </span>
                </div>
                {nearbyWatcherSpots.map(s => (
                  <div key={s.id} style={{ fontSize: 12, color: '#1e293b', marginTop: 4, lineHeight: 1.4 }}>
                    <span>Reported <b>{s.report_count}</b> time{s.report_count > 1 ? 's' : ''}</span>
                    {s.my_report_count > 0 ? (
                      <span style={{ color: '#2563eb', fontWeight: 800 }}> (You have reported this spot {s.my_report_count} time{s.my_report_count > 1 ? 's' : ''})</span>
                    ) : (
                      <span style={{ color: '#64748b' }}> by on-duty Watchers</span>
                    )}
                    {s.latest_report?.issue_type && (
                      <span style={{ color: '#1d4ed8', fontSize: 11, fontWeight: 700, background: 'rgba(37,99,235,0.08)', padding: '1px 6px', borderRadius: 4, marginLeft: 6, textTransform: 'capitalize' }}>
                        {s.latest_report.issue_type}
                      </span>
                    )}
                  </div>
                ))}
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.35 }}>
                  Identified during shift routines. Check if waste at this spot was also cleared.
                </div>
              </div>
            </div>
          )}

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
                fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s'
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
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.07em', marginBottom: 8 }}>
                VERIFICATION PHOTOS * <span style={{ fontWeight: 500, textTransform: 'none', fontSize: 10, color: photos.length >= 4 ? '#16a34a' : '#94a3b8' }}>({photos.length}/4)</span>
            </div>
            {MultiPhotoPicker
              ? <MultiPhotoPicker photos={photos} onChange={setPhotos} />
              : <p style={{ fontSize: 12, color: '#94a3b8' }}>Photo upload not available.</p>
            }
            {photos.length === 0 && (
                <p style={{ fontSize: 11, color: '#ef4444', marginTop: 6, fontWeight: 600 }}>
                    At least one photo is required to submit.
                </p>
            )}
          </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 9, padding: '9px 12px', fontSize: 12, color: '#ef4444', marginBottom: 14 }}>
                {error}
              </div>
            )}
          </div>
        )}

        {/* Sticky Action Footer */}
        <div style={{
          padding: '12px 18px',
          background: '#ffffff',
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          gap: 10,
          flexShrink: 0,
          boxShadow: '0 -4px 12px rgba(0,0,0,0.03)'
        }}>
          <button
            className="btn btn-outline"
            style={{ flex: 1, padding: '13px', borderRadius: 12, fontWeight: 700, fontSize: 13 }}
            onClick={onBack}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={handleSubmit}
            style={{
              flex: 2, padding: '13px', borderRadius: 12, border: 'none',
              background: canSubmit ? '#16a34a' : '#e2e8f0',
              color: canSubmit ? '#fff' : '#94a3b8',
              fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 900,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'all .2s',
              boxShadow: canSubmit ? '0 4px 14px rgba(22,163,74,.3)' : 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {submitting ? 'Submitting…' : <><div style={{ width: 17, height: 17 }}>{ICONS.check}</div> Verify Collection</>}
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}