/**
 * pages/ReportForm.jsx
 * -------------------------------------
 * Unified offline report form overlay.
 * Geo-tags every report strictly from its (latitude, longitude) coordinates
 * against Lucena City's GeoJSON barangay boundaries (`/data/lucena_barangays.geojson`),
 * independent of the reporter's profile barangay or anonymous status.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOnline } from '../hooks/useOnline'
import { useOfflineReports } from '../hooks/useOfflineReports'
import { useOfflineSyncManager } from '../hooks/useOfflineSyncManager'
import MultiPhotoPicker from '../components/MultiPhotoPicker'
import ReportLocationPicker from '../components/ReportLocationPicker'
import { loadBarangayGeoJson, detectBarangayFromCoords } from '../utils/barangayGeofence'
import api from '../api/client'
import {
  Trash2,
  Truck,
  AlertTriangle,
  Camera,
  MapPin,
  Map as MapIcon,
  Tag,
  FileText,
  CheckCircle,
  RefreshCw,
  X,
} from 'lucide-react'
import '../styles/pages/OfflineModules.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const WASTE_TYPES = [
  { value: 'overflow', label: 'Overflow', icon: <Trash2 size={20} />, color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)' },
  { value: 'missed', label: 'Missed', icon: <Truck size={20} />, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)' },
  { value: 'illegal_dumping', label: 'Illegal Dump', icon: <AlertTriangle size={20} />, color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.4)' },
]

// ─── GPS helpers ──────────────────────────────────────────────────────────────

const LS_LAST_LOC = 'ww_last_location'

function cacheLocation(loc) {
  try {
    localStorage.setItem(LS_LAST_LOC, JSON.stringify(loc))
  } catch {}
}

function getCachedLocation() {
  try {
    const raw = localStorage.getItem(LS_LAST_LOC)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && Number.isFinite(Number(parsed.lat)) && Number.isFinite(Number(parsed.lng))) {
      return { ...parsed, lat: Number(parsed.lat), lng: Number(parsed.lng) }
    }
    return null
  } catch {
    return null
  }
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

export default function ReportForm({ isOpen, onClose, initialPhoto, onSuccess, isWatcherSpot }) {
  const { user } = useAuth()
  const isOnline = useOnline()
  const { addReport, pushReport } = useOfflineReports()
  useOfflineSyncManager()

  const isWatcherMode = Boolean(isWatcherSpot || user?.role === 'watcher')

  const [view, setView] = useState('builder')

  const [wasteType, setWasteType] = useState('overflow')
  const [notes, setNotes] = useState('')
  const [location, setLocation] = useState(null)
  const [nearbySpot, setNearbySpot] = useState(null)
  const [checkingNearbySpot, setCheckingNearbySpot] = useState(false)
  const [gpsState, setGpsState] = useState('idle')
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [queuedLater, setQueuedLater] = useState(false)

  const [photos, setPhotos] = useState([])
  const [photoError, setPhotoError] = useState('')
  const [formError, setFormError] = useState('')

  const geoSeqRef = useRef(0)

  // ── Apply coordinates immediately + geofence barangay + async reverse geocode ──
  const applyCoordinates = useCallback(async (rawLat, rawLng, statusType = 'done', existingAddress = null) => {
    const lat = Number(rawLat)
    const lng = Number(rawLng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    const seq = ++geoSeqRef.current
    const geo = await loadBarangayGeoJson()
    const match = geo ? detectBarangayFromCoords(lat, lng, geo) : null
    const barangayName = match?.barangayName || null
    const outsideLucena = Boolean(geo && !match)
    const fallbackAddr = existingAddress || `${lat.toFixed(5)}, ${lng.toFixed(5)}`

    const immediateLoc = {
      lat,
      lng,
      barangayName,
      outsideLucena,
      address: fallbackAddr,
    }

    if (seq !== geoSeqRef.current) return
    setLocation(immediateLoc)
    setGpsState(statusType)
    setFormError('')
    cacheLocation(immediateLoc)

    if (!existingAddress) {
      const resolvedAddr = await reverseGeocode(lat, lng)
      if (seq !== geoSeqRef.current) return
      setLocation((prev) => {
        if (!prev) return prev
        const enriched = { ...prev, address: resolvedAddr }
        cacheLocation(enriched)
        return enriched
      })
    }
  }, [])

  // ── Initialization ────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      geoSeqRef.current += 1
      loadBarangayGeoJson()
      setWasteType('overflow')
      setNotes('')
      setLocation(null)
      setNearbySpot(null)
      setCheckingNearbySpot(false)
      setGpsState('idle')
      setShowMapPicker(false)
      setSubmitting(false)
      setSubmitted(false)
      setQueuedLater(false)
      setPhotoError('')
      setFormError('')

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

  // ── Query nearby existing Watcher Spot (within 10m) ──────────────────────
  useEffect(() => {
    if (!isOpen || !isWatcherMode || !location?.lat || !location?.lng || !isOnline) {
      setNearbySpot(null)
      setCheckingNearbySpot(false)
      return
    }

    let active = true
    setCheckingNearbySpot(true)
    api.get('/api/watcher/spots/', {
      params: {
        lat: location.lat,
        lng: location.lng,
        radius_m: 10,
        status: 'all',
      }
    })
      .then((res) => {
        if (!active) return
        const results = Array.isArray(res.data) ? res.data : (res.data?.results || [])
        // Pick the nearest active or added_to_route spot
        const match = results.find(s => s.status !== 'rejected') || results[0] || null
        setNearbySpot(match)
      })
      .catch(() => {
        if (active) setNearbySpot(null)
      })
      .finally(() => {
        if (active) setCheckingNearbySpot(false)
      })

    return () => { active = false }
  }, [isOpen, isWatcherMode, location?.lat, location?.lng, isOnline])

  // ── GPS capture (high accuracy with automatic low-accuracy fallback) ──────
  const captureGPS = useCallback(() => {
    setGpsState('loading')
    if (!navigator.geolocation) {
      const cached = getCachedLocation()
      if (cached) {
        applyCoordinates(cached.lat, cached.lng, 'cached', cached.address)
      } else {
        setGpsState('error')
      }
      return
    }

    const handleFallbackFailure = () => {
      const cached = getCachedLocation()
      if (cached) {
        applyCoordinates(cached.lat, cached.lng, 'cached', cached.address)
      } else {
        setGpsState('error')
      }
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyCoordinates(pos.coords.latitude, pos.coords.longitude, 'done')
      },
      (err) => {
        // Code 1 = PERMISSION_DENIED; Codes 2/3 = UNAVAILABLE/TIMEOUT -> retry with Wi-Fi/network positioning
        if (err && err.code !== 1) {
          navigator.geolocation.getCurrentPosition(
            (pos2) => {
              applyCoordinates(pos2.coords.latitude, pos2.coords.longitude, 'done')
            },
            handleFallbackFailure,
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
          )
        } else {
          handleFallbackFailure()
        }
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
    )
  }, [applyCoordinates])

  useEffect(() => {
    if (isOpen && view === 'builder' && gpsState === 'idle') {
      captureGPS()
    }
  }, [isOpen, view, gpsState, captureGPS])

  // ── Escape to close ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    if (photos.length === 0) {
      setPhotoError('A live camera photo is required to submit this report.')
      return
    }
    if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) {
      setFormError('Live GPS coordinates are required for barangay geo-tagging. Please enable device location services and tap Retry.')
      return
    }
    if (location.outsideLucena) {
      setFormError('Detected GPS coordinates fall outside Lucena City boundaries. Reports can only be submitted within Lucena City.')
      return
    }

    setSubmitting(true)
    setFormError('')
    setPhotoError('')
    try {
      const serializedPhotos = await Promise.all(
        photos.map(
          (file) =>
            new Promise((resolve, reject) => {
              if (typeof file === 'string') {
                resolve(file)
                return
              }
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result)
              reader.onerror = reject
              reader.readAsDataURL(file)
            })
        )
      )

      const payload = {
        issue_type: wasteType,
        severity: 'medium',
        description: notes,
        latitude: Number(location.lat),
        longitude: Number(location.lng),
        barangay_name: location.barangayName || null,
        address: location.address || `${Number(location.lat).toFixed(5)}, ${Number(location.lng).toFixed(5)}`,
        photos: serializedPhotos,
        is_watcher_spot: isWatcherMode,
      }

      if (isOnline) {
        let record
        try {
          record = await addReport(payload, { skipAutoSync: true })
        } catch (idbErr) {
          console.warn('[ReportForm] IDB write warning, pushing to server...', idbErr)
          record = { ...payload, id: 'temp-' + Date.now(), createdAt: new Date().toISOString() }
        }

        const pushResult = await pushReport(record)
        if (pushResult && pushResult.status === 'pending') {
          setQueuedLater(true)
          setSubmitted(true)
          if (onSuccess) onSuccess({ queuedOffline: true, ...payload })
          setTimeout(() => {
            onClose()
            setTimeout(() => {
              setSubmitted(false)
              setQueuedLater(false)
            }, 300)
          }, 1800)
        } else if (pushResult && pushResult.status === 'synced') {
          setSubmitted(true)
          if (onSuccess) {
            onSuccess(pushResult.serverData || pushResult)
          }
          setTimeout(() => {
            onClose()
            setTimeout(() => setSubmitted(false), 300)
          }, 1500)
        } else {
          setFormError(
            pushResult?.error ||
              'Failed to submit report to server. Please review your input and try again.'
          )
        }
      } else {
        await addReport(payload)
        setSubmitted(true)
        if (onSuccess) {
          onSuccess({ queuedOffline: true, ...payload })
        }
        setTimeout(() => {
          onClose()
          setTimeout(() => setSubmitted(false), 300)
        }, 1500)
      }
    } catch (err) {
      console.error('[ReportForm] submit error:', err)
      const errDetail =
        err.response?.data?.detail ||
        (typeof err.response?.data === 'string' ? err.response?.data : null) ||
        (err.response?.data ? Object.values(err.response.data).flat().join(' ') : null) ||
        err.message ||
        'Failed to save report. Please try again.'
      setFormError(errDetail)
    } finally {
      setSubmitting(false)
    }
  }, [submitting, photos, addReport, wasteType, notes, location, isOnline, pushReport, onSuccess, onClose, isWatcherMode])

  if (!isOpen) return null

  const selectedWaste = WASTE_TYPES.find((w) => w.value === wasteType) || WASTE_TYPES[0]
  const gpsLoadingWithoutCoords = gpsState === 'loading' && !location
  const canSubmit = photos.length > 0 && !submitting && !gpsLoadingWithoutCoords

  return (
    <>
      <div className="orb-backdrop" onClick={onClose} aria-hidden />

      <div className="orb-sheet" role="dialog" aria-modal aria-label="Report Form">
        <div className="orb-handle" />

        <>
          <div className="orb-header">
            <div className="orb-header__text">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 className="orb-header__title">
                  {isWatcherMode ? 'Watcher Spot Report' : 'Report Waste Issue'}
                </h2>
                {isWatcherMode && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    background: 'rgba(124, 58, 237, 0.12)',
                    color: '#7c3aed',
                    border: '1px solid rgba(124, 58, 237, 0.3)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    letterSpacing: '.05em',
                    textTransform: 'uppercase'
                  }}>
                    Watcher Spot
                  </span>
                )}
              </div>
              <p className="orb-header__sub">
                {isWatcherMode
                  ? 'On-duty spot report · Bypasses approval & suggests spot to Route Builder'
                  : isOnline
                    ? 'Official Lucena Waste Report'
                    : 'Saved offline · syncs when connected'}
              </p>
            </div>
            <button className="orb-close" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          {submitted ? (
            <div className="orb-success">
              <div
                className="orb-success__icon"
                style={{ color: '#2e7d32', display: 'flex', justifyContent: 'center', marginBottom: '12px' }}
              >
                <CheckCircle size={48} />
              </div>
              <h3 className="orb-success__title">
                {isWatcherMode ? 'Watcher Spot Logged!' : (isOnline && !queuedLater ? 'Report Submitted!' : 'Report Queued!')}
              </h3>
              <p className="orb-success__sub">
                {isWatcherMode
                  ? `Recorded${location?.barangayName ? ` under Brgy. ${location.barangayName}` : ''}. Auto-approved and forwarded directly as a suggested stop in Route Builder.`
                  : (isOnline && !queuedLater
                    ? `Recorded${location?.barangayName ? ` under Brgy. ${location.barangayName}` : ''} and submitted for verification.`
                    : 'Your report is saved offline and will sync automatically when you are online.')}
              </p>
            </div>
          ) : (
            <div className="orb-body">
              {/* ── PHOTO (mandatory) ── */}
              <div className="orb-field">
                <label className="orb-label">
                  <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}>
                    <Camera size={16} />
                  </span>{' '}
                  Photo
                  <span className="orb-required">*</span>
                  <span className="orb-label-hint">(required)</span>
                </label>

                <MultiPhotoPicker
                  photos={photos}
                  onChange={(newPhotos) => {
                    setPhotos(newPhotos)
                    setPhotoError('')
                  }}
                  error={photoError}
                />
              </div>

              {/* ── GPS Location & Geofenced Barangay ── */}
              <div className="orb-field">
                <label className="orb-label" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}>
                      <MapPin size={16} />
                    </span>
                    Location
                    <span className="orb-required">*</span>
                  </span>

                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {location?.barangayName && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: '#dcfce7',
                          color: '#15803d',
                          border: '1px solid #86efac',
                          textTransform: 'none',
                          letterSpacing: 0,
                        }}
                      >
                        Brgy. {location.barangayName}
                      </span>
                    )}
                    {location?.outsideLucena && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: '#fee2e2',
                          color: '#b91c1c',
                          border: '1px solid #fca5a5',
                          textTransform: 'none',
                          letterSpacing: 0,
                        }}
                      >
                        Outside Lucena City
                      </span>
                    )}
                    {gpsState !== 'idle' && (
                      <span className={`orb-gps-badge orb-gps-badge--${gpsState}`}>
                        {gpsState === 'loading'
                          ? 'Detecting GPS…'
                          : gpsState === 'cached'
                            ? 'Cached'
                            : gpsState === 'error'
                              ? 'Unavailable'
                              : 'Located'}
                      </span>
                    )}
                  </span>
                </label>

                <div className="orb-location-box" style={{ gap: 6 }}>
                  {location ? (
                    <span className="orb-location-box__addr">{location.address}</span>
                  ) : (
                    <span className="orb-location-box__placeholder">
                      {gpsState === 'loading'
                        ? 'Detecting your GPS coordinates…'
                        : 'GPS unavailable — enable location services and tap Retry'}
                    </span>
                  )}
                  {location && (
                    <button
                      type="button"
                      className="orb-location-box__retry"
                      onClick={() => setShowMapPicker((v) => !v)}
                      title={showMapPicker ? 'Hide map preview' : 'View GPS location on barangay map'}
                      aria-label="View GPS location on map"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        width: 'auto',
                        padding: '0 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: showMapPicker ? '#15803d' : '#475569',
                        borderColor: showMapPicker ? '#86efac' : undefined,
                        background: showMapPicker ? '#f0fdf4' : undefined,
                      }}
                    >
                      <MapIcon size={14} />
                      <span>{showMapPicker ? 'Hide Map' : 'View Map'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="orb-location-box__retry"
                    onClick={captureGPS}
                    title="Re-detect GPS"
                    aria-label="Retry GPS"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>

                {showMapPicker && location && (
                  <ReportLocationPicker
                    lat={location?.lat}
                    lng={location?.lng}
                    barangayName={location?.barangayName}
                    allowMove={false}
                  />
                )}

                {isWatcherMode && location && (
                  <div style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: nearbySpot ? 'rgba(124, 58, 237, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                    border: `1px solid ${nearbySpot ? 'rgba(124, 58, 237, 0.28)' : 'rgba(16, 185, 129, 0.25)'}`,
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: nearbySpot ? '#5b21b6' : '#065f46'
                  }}>
                    {checkingNearbySpot ? (
                      <span style={{ color: '#64748b' }}>Checking 10m spot history…</span>
                    ) : nearbySpot ? (
                      <div>
                        <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span>Repeat Spot Detected (within 10m)</span>
                          <span style={{
                            background: '#7c3aed',
                            color: '#ffffff',
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '1px 6px',
                            borderRadius: 999
                          }}>
                            {nearbySpot.report_count}x Recorded
                          </span>
                        </div>
                        <div style={{ fontSize: 11 }}>
                          You have reported this spot {nearbySpot.my_report_count} time(s). Submitting another report here will increase this spot&apos;s frequency counter and reinforce priority for Route Builder.
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, fontWeight: 600 }}>
                        New Watcher Spot: Submitting creates a brand-new suggested stop candidate for Route Builder.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Waste Type ── */}
              <div className="orb-field">
                <label className="orb-label">
                  <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}>
                    <Tag size={16} />
                  </span>{' '}
                  Waste Type
                </label>
                <div className="orb-waste-grid">
                  {WASTE_TYPES.map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      className={`orb-waste-btn${wasteType === w.value ? ' orb-waste-btn--selected' : ''}`}
                      style={
                        wasteType === w.value
                          ? { background: w.bg, borderColor: w.color, color: w.color }
                          : undefined
                      }
                      onClick={() => setWasteType(w.value)}
                    >
                      <span className="orb-waste-btn__emoji" style={{ display: 'flex', alignItems: 'center' }}>
                        {w.icon}
                      </span>
                      <span className="orb-waste-btn__label">{w.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Notes ── */}
              <div className="orb-field">
                <label className="orb-label">
                  <span style={{ display: 'flex', alignItems: 'center', marginRight: '6px' }}>
                    <FileText size={16} />
                  </span>{' '}
                  Notes <span className="orb-optional">(optional)</span>
                </label>
                <textarea
                  className="orb-textarea"
                  rows={3}
                  placeholder="Describe the issue — e.g. overflowing bin near store, illegal dump site…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                />
                <span className="orb-char-count">{notes.length}/500</span>
              </div>

              {/* ── Summary chip ── */}
              <div
                className="orb-summary"
                style={{ borderColor: (selectedWaste && selectedWaste.border) || '#dce8d4' }}
              >
                <span
                  style={{
                    color: (selectedWaste && selectedWaste.color) || '#2e7d32',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontWeight: 700,
                  }}
                >
                  {selectedWaste ? selectedWaste.icon : <Tag size={16} />}{' '}
                  {selectedWaste ? selectedWaste.label : 'Waste'}
                </span>
                <span className="orb-summary__sep">·</span>
                <span
                  style={{
                    color: location?.barangayName
                      ? '#2e7d32'
                      : location?.outsideLucena
                        ? '#dc2626'
                        : '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontWeight: 600,
                  }}
                >
                  <MapPin size={16} />{' '}
                  {location?.barangayName
                    ? `Brgy. ${location.barangayName}`
                    : location?.outsideLucena
                      ? 'Outside Lucena'
                      : 'No GPS'}
                </span>
                <span className="orb-summary__sep">·</span>
                <span style={{ color: photos.length > 0 ? '#2e7d32' : '#dc2626', fontWeight: 600 }}>
                  {photos.length > 0 ? 'Photo Attached' : 'No Photo'}
                </span>
              </div>

              {photos.length === 0 && (
                <div className="orb-photo-required-banner">
                  Live camera photo is required to submit report
                </div>
              )}

              {formError && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#b91c1c',
                    fontSize: 13,
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AlertTriangle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                  <span>{formError}</span>
                </div>
              )}

              {/* ── Submit ── */}
              <button
                type="button"
                className={`orb-submit${submitting || gpsLoadingWithoutCoords ? ' orb-submit--loading' : ''}${!canSubmit ? ' orb-submit--disabled' : ''}`}
                onClick={handleSubmit}
                disabled={!canSubmit}
                title={photos.length === 0 ? 'Live camera photo is required' : ''}
              >
                {submitting ? (
                  <>
                    <span className="orb-spinner" /> Saving…
                  </>
                ) : gpsLoadingWithoutCoords ? (
                  <>
                    <span className="orb-spinner" /> Detecting GPS Location…
                  </>
                ) : photos.length === 0 ? (
                  <>
                    <Camera size={18} style={{ marginRight: '8px' }} /> Capture Photo to Submit
                  </>
                ) : isWatcherMode ? (
                  isOnline ? 'Submit Watcher Spot' : 'Submit Watcher Spot (Offline)'
                ) : isOnline ? (
                  'Submit Report'
                ) : (
                  'Submit Report (Offline)'
                )}
              </button>
            </div>
          )}
        </>
      </div>
    </>
  )
}
