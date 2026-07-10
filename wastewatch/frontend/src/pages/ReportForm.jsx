/**
 * pages/ReportForm.jsx
 * -------------------------------------
 * Unified offline report form overlay. 
 * Replaces the old full-page ReportForm.
 * Combines the queue (OfflineReportQueue) and the builder (OfflineReportBuilder).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useOnline } from '../hooks/useOnline'
import { useOfflineReports } from '../hooks/useOfflineReports'
import { useOfflineSyncManager } from '../hooks/useOfflineSyncManager'
import OfflineReportQueue from '../components/OfflineReportQueue'
import MultiPhotoPicker from '../components/MultiPhotoPicker'
import { Trash2, Truck, AlertTriangle, Camera, MapPin, Tag, Flame, FileText, CheckCircle, RefreshCw } from 'lucide-react'
import '../styles/pages/OfflineModules.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const WASTE_TYPES = [
  { value: 'overflow', label: 'Overflow', icon: <Trash2 size={20} />, color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)' },
  { value: 'missed', label: 'Missed', icon: <Truck size={20} />, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)' },
  { value: 'illegal_dumping', label: 'Illegal Dump', icon: <AlertTriangle size={20} />, color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.4)' },
]

const SEVERITIES = [
  { value: 'low', label: 'Low', color: '#22c55e', desc: 'Minor issue' },
  { value: 'medium', label: 'Medium', color: '#f59e0b', desc: 'Needs attention' },
  { value: 'high', label: 'High', color: '#ef4444', desc: 'Urgent' },
]

// ─── GPS helpers ──────────────────────────────────────────────────────────────

const LS_LAST_LOC = 'ww_last_location'

function cacheLocation(loc) {
  try { localStorage.setItem(LS_LAST_LOC, JSON.stringify(loc)) } catch { }
}

function getCachedLocation() {
  try {
    const raw = localStorage.getItem(LS_LAST_LOC)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({ base64: reader.result, url: URL.createObjectURL(file), file })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportForm({ isOpen, onClose, initialPhoto }) {
  const isOnline = useOnline()
  const { reports, addReport, retryReport, pendingCount, failedCount, pushReport } = useOfflineReports()
  const { syncNow, isSyncing, lastSyncAt } = useOfflineSyncManager()

  const [view, setView] = useState('builder') // 'builder'

  const [wasteType, setWasteType] = useState('overflow')
  const [severity, setSeverity] = useState('medium')
  const [notes, setNotes] = useState('')
  const [location, setLocation] = useState(null)
  const [gpsState, setGpsState] = useState('idle')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const [photos, setPhotos] = useState([]) // array of base64
  const [photoError, setPhotoError] = useState('')

  // ── Initialization ────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setWasteType('overflow')
      setSeverity('medium')
      setNotes('')
      setLocation(null)
      setGpsState('idle')
      setSubmitting(false)
      setSubmitted(false)
      setPhotoError('')

      if (initialPhoto && initialPhoto.blob) {
        const reader = new FileReader()
        reader.onload = () => {
          setPhotos([reader.result])
        }
        reader.readAsDataURL(initialPhoto.blob)
      } else {
        setPhotos([])
      }
      setView('builder')
    }
  }, [isOpen, initialPhoto])

  useEffect(() => {
    if (isOpen && view === 'builder' && gpsState === 'idle') {
      captureGPS()
    }
  }, [isOpen, view, gpsState])

  // ── Escape to close ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // ── Revoke object URL on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      // Nothing to revoke since photos are base64
    }
  }, [photos, initialPhoto])

  // ── GPS capture ───────────────────────────────────────────────────────────
  const captureGPS = useCallback(() => {
    setGpsState('loading')
    if (!navigator.geolocation) {
      const cached = getCachedLocation()
      if (cached) { setLocation(cached); setGpsState('cached') }
      else setGpsState('error')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        const address = await reverseGeocode(lat, lng)
        const loc = { lat, lng, address }
        cacheLocation(loc)
        setLocation(loc)
        setGpsState('done')
      },
      () => {
        const cached = getCachedLocation()
        if (cached) { setLocation(cached); setGpsState('cached') }
        else setGpsState('error')
      },
      { timeout: 8000, maximumAge: 120000, enableHighAccuracy: true }
    )
  }, [])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    if (photos.length === 0) {
      setPhotoError('Kinakailangan ang larawan. Mag-attach ng photo bago mag-submit.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        issue_type: wasteType,
        severity,
        description: notes,
        latitude: location?.lat,
        longitude: location?.lng,
        address: location?.address,
        photos: photos,
      }
      try {
        await addReport(payload)
      } catch (idbErr) {
        if (isOnline) {
          console.warn('[ReportForm] IDB failed, pushing directly to server...', idbErr)
          await pushReport({ ...payload, id: 'temp-' + Date.now(), createdAt: new Date().toISOString() })
        } else {
          throw idbErr
        }
      }
      setSubmitted(true)
      setTimeout(() => {
        onClose()
        // Reset state after closing so next time it opens fresh
        setTimeout(() => setSubmitted(false), 300)
      }, 1500)
    } catch (err) {
      console.error('[ReportForm] submit error:', err)
      setPhotoError("Nabigo ang pag-save: Browser Storage Error. Mangyaring i-check kung puno ang storage, o i-refresh ang browser.")
    } finally {
      setSubmitting(false)
    }
  }, [submitting, photos, addReport, wasteType, severity, notes, location])

  if (!isOpen) return null

  const selectedWaste = WASTE_TYPES.find(w => w.value === wasteType) || WASTE_TYPES[0]
  const selectedSeverity = SEVERITIES.find(s => s.value === severity) || SEVERITIES[0]
  const canSubmit = photos.length > 0 && !submitting

  return (
    <>
      <div className="orb-backdrop" onClick={onClose} aria-hidden />

      <div className="orb-sheet" role="dialog" aria-modal aria-label="Report Form">
        <div className="orb-handle" />

        {/* Always render builder view */}
        <>
          <div className="orb-header">
            <div className="orb-header__text">
              <h2 className="orb-header__title">Report a Problem</h2>
              <p className="orb-header__sub">Saved offline · syncs when connected</p>
            </div>
            <button className="orb-close" onClick={onClose} aria-label="Close">✕</button>
          </div>

          {submitted ? (
            <div className="orb-success">
              <div className="orb-success__icon" style={{ color: '#22c55e', display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                <CheckCircle size={48} />
              </div>
              <h3 className="orb-success__title">Report Queued!</h3>
              <p className="orb-success__sub">
                Your report is saved offline and will sync automatically when you're online.
              </p>
            </div>
          ) : (
            <div className="orb-body">
              {/* ── PHOTO (mandatory) ── */}
              <div className="orb-field">
                <label className="orb-label">
                  <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}><Camera size={16} /></span> Photo
                  <span className="orb-required">*</span>
                  <span className="orb-label-hint">(kinakailangan)</span>
                </label>

                <MultiPhotoPicker photos={photos} onChange={(newPhotos) => { setPhotos(newPhotos); setPhotoError('') }} error={photoError} />
              </div>

              {/* ── GPS Location ── */}
              <div className="orb-field">
                <label className="orb-label">
                  <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}><MapPin size={16} /></span> Location
                  {gpsState !== 'idle' && (
                    <span className={`orb-gps-badge orb-gps-badge--${gpsState}`}>
                      {gpsState === 'loading' ? 'Getting GPS…'
                        : gpsState === 'cached' ? '📦 Cached'
                          : gpsState === 'error' ? '⚠️ Unavailable' : '✓ Located'}
                    </span>
                  )}
                </label>
                <div className="orb-location-box">
                  {location ? <span className="orb-location-box__addr">{location.address}</span>
                    : <span className="orb-location-box__placeholder">{gpsState === 'loading' ? 'Detecting your location…' : 'Location not available'}</span>}
                  <button className="orb-location-box__retry" onClick={captureGPS} aria-label="Retry GPS" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>

              {/* ── Waste Type ── */}
              <div className="orb-field">
                <label className="orb-label">
                  <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}><Tag size={16} /></span> Waste Type
                </label>
                <div className="orb-waste-grid">
                  {WASTE_TYPES.map(w => (
                    <button
                      key={w.value}
                      className={`orb-waste-btn${wasteType === w.value ? ' orb-waste-btn--selected' : ''}`}
                      style={wasteType === w.value ? { background: w.bg, borderColor: w.color, color: w.color } : undefined}
                      onClick={() => setWasteType(w.value)}
                    >
                      <span className="orb-waste-btn__emoji" style={{ display: 'flex', alignItems: 'center' }}>{w.icon}</span>
                      <span className="orb-waste-btn__label">{w.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Severity ── */}
              <div className="orb-field">
                <label className="orb-label">
                  <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}><Flame size={16} /></span> Severity
                </label>
                <div className="orb-severity-row">
                  {SEVERITIES.map(s => (
                    <button
                      key={s.value}
                      className={`orb-sev-btn${severity === s.value ? ' orb-sev-btn--selected' : ''}`}
                      style={severity === s.value ? { borderColor: s.color, color: s.color, background: `${s.color}18` } : undefined}
                      onClick={() => setSeverity(s.value)}
                      title={s.desc}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="orb-severity-desc" style={{ color: selectedSeverity?.color || '#64748b' }}>
                  {selectedSeverity?.desc || ''}
                </p>
              </div>

              {/* ── Notes ── */}
              <div className="orb-field">
                <label className="orb-label">
                  <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}><FileText size={16} /></span> Notes <span className="orb-optional">(optional)</span>
                </label>
                <textarea
                  className="orb-textarea"
                  rows={3}
                  placeholder="Describe the issue — e.g. overflowing bin near store, illegal dump site…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  maxLength={500}
                />
                <span className="orb-char-count">{notes.length}/500</span>
              </div>

              {/* ── Summary chip ── */}
              <div className="orb-summary" style={{ borderColor: (selectedWaste && selectedWaste.border) || 'transparent' }}>
                <span style={{ color: (selectedWaste && selectedWaste.color) || '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {selectedWaste ? selectedWaste.icon : <Tag size={16} />} {selectedWaste ? selectedWaste.label : 'Waste'}
                </span>
                <span className="orb-summary__sep">·</span>
                <span style={{ color: (selectedSeverity && selectedSeverity.color) || '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Flame size={16} /> {selectedSeverity ? selectedSeverity.label : 'Severity'}
                </span>
                <span className="orb-summary__sep">·</span>
                <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <MapPin size={16} /> {location ? 'Located' : 'No GPS'}
                </span>
                <span className="orb-summary__sep">·</span>
                <span style={{ color: photos.length > 0 ? '#22c55e' : '#ef4444' }}>
                  {photos.length > 0 ? 'Photo ✓' : 'No Photo'}
                </span>
              </div>

              {photos.length === 0 && (
                <div className="orb-photo-required-banner">
                  Mag-attach ng larawan para ma-submit ang report
                </div>
              )}

              {/* ── Submit ── */}
              <button
                className={`orb-submit${submitting ? ' orb-submit--loading' : ''}${!canSubmit ? ' orb-submit--disabled' : ''}`}
                onClick={handleSubmit}
                disabled={!canSubmit}
                title={photos.length === 0 ? 'Kinakailangan ang larawan' : ''}
              >
                {submitting
                  ? <><span className="orb-spinner" /> Saving…</>
                  : photos.length === 0
                    ? <><Camera size={18} style={{ marginRight: '8px' }} /> Mag-attach ng Photo muna</>
                    : isOnline ? 'Submit Report' : 'Submit Report (Offline)'}
              </button>
            </div>
          )}
        </>
      </div>
    </>
  )
}
