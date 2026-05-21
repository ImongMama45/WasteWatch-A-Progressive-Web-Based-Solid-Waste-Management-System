/**
 * components/OfflineReportBuilder.jsx
 * -------------------------------------
 * Slide-up modal/sheet for creating garbage reports — works fully offline.
 * Captures GPS, waste type, severity, and optional notes.
 * Queues the report locally via useOfflineReports (IndexedDB).
 *
 * Props:
 *   isOpen   : boolean
 *   onClose  : () => void
 *   onSubmit : (report) => void  — called after IDB write
 */

import { useState, useEffect, useCallback } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const WASTE_TYPES = [
  { value: 'biodegradable', label: 'Biodegradable', emoji: '🌿', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.4)' },
  { value: 'residual', label: 'Residual', emoji: '🗑️', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.4)' },
  { value: 'recyclable', label: 'Recyclable', emoji: '♻️', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)' },
  { value: 'special', label: 'Special', emoji: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)' },
]

const SEVERITIES = [
  { value: 'low', label: 'Low', color: '#22c55e', desc: 'Minor issue' },
  { value: 'medium', label: 'Medium', color: '#f59e0b', desc: 'Needs attention' },
  { value: 'high', label: 'High', color: '#ef4444', desc: 'Urgent' },
  { value: 'critical', label: 'Critical', color: '#7c3aed', desc: 'Emergency' },
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflineReportBuilder({ isOpen, onClose, onSubmit }) {
  const [wasteType, setWasteType] = useState('residual')
  const [severity, setSeverity] = useState('medium')
  const [notes, setNotes] = useState('')
  const [location, setLocation] = useState(null)
  const [gpsState, setGpsState] = useState('idle') // idle | loading | done | error | cached
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // ── Reset form on open ────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setWasteType('residual')
      setSeverity('medium')
      setNotes('')
      setLocation(null)
      setGpsState('idle')
      setSubmitting(false)
      setSubmitted(false)
      captureGPS()
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close on Escape ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

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
        // Fallback to cached
        const cached = getCachedLocation()
        if (cached) { setLocation(cached); setGpsState('cached') }
        else setGpsState('error')
      },
      { timeout: 8000, maximumAge: 120000, enableHighAccuracy: true }
    )
  }, [])

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const report = await onSubmit({ wasteType, severity, notes, location })
      if (report) {
        setSubmitted(true)
        setTimeout(() => onClose(), 1800)
      }
    } catch (err) {
      console.error('[OfflineReportBuilder] submit error:', err)
    } finally {
      setSubmitting(false)
    }
  }, [submitting, onSubmit, wasteType, severity, notes, location, onClose])

  if (!isOpen) return null

  const selectedWaste = WASTE_TYPES.find(w => w.value === wasteType)
  const selectedSeverity = SEVERITIES.find(s => s.value === severity)

  return (
    <>
      {/* Backdrop */}
      <div className="orb-backdrop" onClick={onClose} aria-hidden />

      {/* Sheet */}
      <div className="orb-sheet" role="dialog" aria-modal aria-label="Report Garbage Problem">

        {/* Handle bar */}
        <div className="orb-handle" />

        {/* Header */}
        <div className="orb-header">
          <div className="orb-header__icon">🗑️</div>
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
            <p className="orb-success__sub">Your report is saved offline and will sync automatically when you're online.</p>
          </div>
        ) : (
          <div className="orb-body">

            {/* GPS Location */}
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

            {/* Waste Type */}
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

            {/* Severity */}
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

            {/* Notes */}
            <div className="orb-field">
              <label className="orb-label"><span>📝</span> Notes <span className="orb-optional">(optional)</span></label>
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

            {/* Summary chip */}
            <div className="orb-summary" style={{ borderColor: selectedWaste.border }}>
              <span style={{ color: selectedWaste.color }}>{selectedWaste.emoji} {selectedWaste.label}</span>
              <span className="orb-summary__sep">·</span>
              <span style={{ color: selectedSeverity.color }}>🔥 {selectedSeverity.label}</span>
              <span className="orb-summary__sep">·</span>
              <span style={{ color: '#64748b' }}>📍 {location ? 'Located' : 'No GPS'}</span>
            </div>

            {/* Submit */}
            <button
              className={`orb-submit${submitting ? ' orb-submit--loading' : ''}`}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? <><span className="orb-spinner" /> Saving…</>
                : '📤 Submit Report (Offline)'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
