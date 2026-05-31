/**
 * components/OfflineReportBuilder.jsx
 * -------------------------------------
 * Slide-up sheet for creating garbage reports — works fully offline.
 * CHANGES from previous version:
 *   • Photo capture is now MANDATORY (camera or file picker).
 *   • Photo preview shown before submission.
 *   • Image stored as base64 in the report payload.
 *   • Submit button disabled until a photo is attached.
 *
 * Props:
 *   isOpen   : boolean
 *   onClose  : () => void
 *   onSubmit : (report) => void
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const WASTE_TYPES = [
  { value: 'biodegradable', label: 'Biodegradable', emoji: '🌿', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.4)' },
  { value: 'residual',      label: 'Residual',      emoji: '🗑️', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.4)' },
  { value: 'recyclable',    label: 'Recyclable',    emoji: '♻️', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)' },
  { value: 'special',       label: 'Special',       emoji: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)' },
]

const SEVERITIES = [
  { value: 'low',      label: 'Low',      color: '#22c55e', desc: 'Minor issue'  },
  { value: 'medium',   label: 'Medium',   color: '#f59e0b', desc: 'Needs attention' },
  { value: 'high',     label: 'High',     color: '#ef4444', desc: 'Urgent'       },
  { value: 'critical', label: 'Critical', color: '#7c3aed', desc: 'Emergency'    },
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

// ─── Image helpers ────────────────────────────────────────────────────────────

/**
 * Reads a File and resolves with { base64, url, file }.
 * base64 is the full data-URI for offline storage.
 * url is a local object URL for immediate preview.
 */
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

export default function OfflineReportBuilder({ isOpen, onClose, onSubmit }) {
  const [wasteType,   setWasteType]   = useState('residual')
  const [severity,    setSeverity]    = useState('medium')
  const [notes,       setNotes]       = useState('')
  const [location,    setLocation]    = useState(null)
  const [gpsState,    setGpsState]    = useState('idle')
  const [submitting,  setSubmitting]  = useState(false)
  const [submitted,   setSubmitted]   = useState(false)

  // Photo state
  const [photo,       setPhoto]       = useState(null)   // { base64, url, file }
  const [photoError,  setPhotoError]  = useState('')
  const [showCamera,  setShowCamera]  = useState(false)

  const fileInputRef   = useRef(null)
  const cameraInputRef = useRef(null)

  // ── Reset on open ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setWasteType('residual')
      setSeverity('medium')
      setNotes('')
      setLocation(null)
      setGpsState('idle')
      setSubmitting(false)
      setSubmitted(false)
      setPhoto(null)
      setPhotoError('')
      setShowCamera(false)
      captureGPS()
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

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
      if (photo?.url) URL.revokeObjectURL(photo.url)
    }
  }, [photo])

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

  // ── Photo selection (from file picker or camera) ──────────────────────────
  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError('')
    try {
      const result = await readFileAsBase64(file)
      setPhoto(result)
    } catch {
      setPhotoError('Hindi ma-load ang larawan. Subukan ulit.')
    }
    // Reset so same file can be re-selected
    e.target.value = ''
  }, [])

  const handleRemovePhoto = useCallback(() => {
    if (photo?.url) URL.revokeObjectURL(photo.url)
    setPhoto(null)
    setPhotoError('')
  }, [photo])

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (submitting) return

    // Guard: photo is mandatory
    if (!photo) {
      setPhotoError('Kinakailangan ang larawan. Mag-attach ng photo bago mag-submit.')
      return
    }

    setSubmitting(true)
    try {
      const report = await onSubmit({
        wasteType,
        severity,
        notes,
        location,
        photo: photo.base64,   // full data-URI stored offline
      })
      if (report) {
        setSubmitted(true)
        setTimeout(() => onClose(), 1800)
      }
    } catch (err) {
      console.error('[OfflineReportBuilder] submit error:', err)
    } finally {
      setSubmitting(false)
    }
  }, [submitting, photo, onSubmit, wasteType, severity, notes, location, onClose])

  if (!isOpen) return null

  const selectedWaste    = WASTE_TYPES.find(w => w.value === wasteType)
  const selectedSeverity = SEVERITIES.find(s => s.value === severity)
  const canSubmit        = !!photo && !submitting

  return (
    <>
      {/* Backdrop */}
      <div className="orb-backdrop" onClick={onClose} aria-hidden />

      {/* Sheet */}
      <div className="orb-sheet" role="dialog" aria-modal aria-label="Report Garbage Problem">

        {/* Handle */}
        <div className="orb-handle" />

        {/* Header */}
        <div className="orb-header">
          <div className="orb-header__text">
            <h2 className="orb-header__title">Report a Problem</h2>
            <p className="orb-header__sub">Saved offline · syncs when connected</p>
          </div>
          <button className="orb-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── SUCCESS STATE ── */}
        {submitted ? (
          <div className="orb-success">
            <div className="orb-success__icon">✅</div>
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
                <span>📷</span> Photo
                <span className="orb-required">*</span>
                <span className="orb-label-hint">(kinakailangan)</span>
              </label>

              {photo ? (
                /* Preview */
                <div className="orb-photo-preview">
                  <img
                    src={photo.url}
                    alt="Report photo preview"
                    className="orb-photo-preview__img"
                  />
                  <div className="orb-photo-preview__overlay">
                    <button
                      className="orb-photo-preview__remove"
                      onClick={handleRemovePhoto}
                      aria-label="Remove photo"
                    >
                      ✕ Tanggalin
                    </button>
                  </div>
                  <div className="orb-photo-preview__badge">
                    ✓ Photo attached
                  </div>
                </div>
              ) : (
                /* Upload area */
                <div className={`orb-photo-area${photoError ? ' orb-photo-area--error' : ''}`}>
                  <div className="orb-photo-area__icon">📸</div>
                  <p className="orb-photo-area__title">Mag-attach ng larawan</p>
                  <p className="orb-photo-area__hint">Kinakailangan para ma-submit ang report</p>

                  <div className="orb-photo-btns">
                    {/* Camera capture — mobile */}
                    <button
                      className="orb-photo-btn orb-photo-btn--camera"
                      onClick={() => cameraInputRef.current?.click()}
                      type="button"
                    >
                      📷 Camera
                    </button>

                    {/* File / gallery pick */}
                    <button
                      className="orb-photo-btn orb-photo-btn--gallery"
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      🖼️ Gallery
                    </button>
                  </div>

                  {/* Hidden camera input (capture="environment" = rear camera) */}
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="orb-file-input"
                    onChange={handleFileChange}
                    aria-label="Take photo with camera"
                  />

                  {/* Hidden gallery / file picker */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="orb-file-input"
                    onChange={handleFileChange}
                    aria-label="Choose photo from gallery"
                  />
                </div>
              )}

              {/* Photo error message */}
              {photoError && (
                <p className="orb-photo-error">{photoError}</p>
              )}
            </div>

            {/* ── GPS Location ── */}
            <div className="orb-field">
              <label className="orb-label">
                <span>📍</span> Location
                {gpsState !== 'idle' && (
                  <span className={`orb-gps-badge orb-gps-badge--${gpsState}`}>
                    {gpsState === 'loading' ? 'Getting GPS…'
                      : gpsState === 'cached' ? '📦 Cached'
                        : gpsState === 'error' ? '⚠️ Unavailable'
                          : '✓ Located'}
                  </span>
                )}
              </label>
              <div className="orb-location-box">
                {location ? (
                  <span className="orb-location-box__addr">{location.address}</span>
                ) : (
                  <span className="orb-location-box__placeholder">
                    {gpsState === 'loading' ? 'Detecting your location…' : 'Location not available'}
                  </span>
                )}
                <button className="orb-location-box__retry" onClick={captureGPS} aria-label="Retry GPS">
                  🔄
                </button>
              </div>
            </div>

            {/* ── Waste Type ── */}
            <div className="orb-field">
              <label className="orb-label"><span>🏷️</span> Waste Type</label>
              <div className="orb-waste-grid">
                {WASTE_TYPES.map(w => (
                  <button
                    key={w.value}
                    className={`orb-waste-btn${wasteType === w.value ? ' orb-waste-btn--selected' : ''}`}
                    style={wasteType === w.value
                      ? { background: w.bg, borderColor: w.color, color: w.color }
                      : undefined}
                    onClick={() => setWasteType(w.value)}
                  >
                    <span className="orb-waste-btn__emoji">{w.emoji}</span>
                    <span className="orb-waste-btn__label">{w.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Severity ── */}
            <div className="orb-field">
              <label className="orb-label"><span>🔥</span> Severity</label>
              <div className="orb-severity-row">
                {SEVERITIES.map(s => (
                  <button
                    key={s.value}
                    className={`orb-sev-btn${severity === s.value ? ' orb-sev-btn--selected' : ''}`}
                    style={severity === s.value
                      ? { borderColor: s.color, color: s.color, background: `${s.color}18` }
                      : undefined}
                    onClick={() => setSeverity(s.value)}
                    title={s.desc}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="orb-severity-desc" style={{ color: selectedSeverity.color }}>
                {selectedSeverity.desc}
              </p>
            </div>

            {/* ── Notes ── */}
            <div className="orb-field">
              <label className="orb-label">
                <span>📝</span> Notes <span className="orb-optional">(optional)</span>
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
            <div className="orb-summary" style={{ borderColor: selectedWaste.border }}>
              <span style={{ color: selectedWaste.color }}>{selectedWaste.emoji} {selectedWaste.label}</span>
              <span className="orb-summary__sep">·</span>
              <span style={{ color: selectedSeverity.color }}>🔥 {selectedSeverity.label}</span>
              <span className="orb-summary__sep">·</span>
              <span style={{ color: '#64748b' }}>📍 {location ? 'Located' : 'No GPS'}</span>
              <span className="orb-summary__sep">·</span>
              <span style={{ color: photo ? '#22c55e' : '#ef4444' }}>
                {photo ? 'Photo ✓' : 'No Photo'}
              </span>
            </div>

            {/* ── Photo required notice (shown when no photo yet) ── */}
            {!photo && (
              <div className="orb-photo-required-banner">
                Mag-attach ng larawan para ma-submit ang report
              </div>
            )}

            {/* ── Submit ── */}
            <button
              className={`orb-submit${submitting ? ' orb-submit--loading' : ''}${!canSubmit ? ' orb-submit--disabled' : ''}`}
              onClick={handleSubmit}
              disabled={!canSubmit}
              title={!photo ? 'Kinakailangan ang larawan' : ''}
            >
              {submitting
                ? <><span className="orb-spinner" /> Saving…</>
                : !photo
                  ? '📷 Mag-attach ng Photo muna'
                  : 'Submit Report (Offline)'}
            </button>

          </div>
        )}
      </div>
    </>
  )
}