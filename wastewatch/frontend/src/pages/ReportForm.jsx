/**
 * ReportForm.jsx — Report Garbage Issue
 * ---------------------------------------
 * GPS is captured silently on mount — user cannot edit it.
 * Photo must be taken via camera — gallery upload is not allowed.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

const ISSUE_TYPES = [
  { value: '', label: 'Select Issue Type' },
  { value: 'overflow', label: 'Overflow' },
  { value: 'missed', label: 'Missed Collection' },
  { value: 'illegal_dumping', label: 'Illegal Dumping' },
]

const SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const ALL_TAGS = ['Near School', 'Near market', 'Side Road', 'Residential', 'Highway', 'Near River', 'Misconduct']

export default function ReportForm() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [gps, setGps] = useState({ lat: null, lng: null, status: 'detecting', address: '' })
  const [barangays, setBarangays] = useState([])
  const [systemUsers, setSystemUsers] = useState([])
  const [preview, setPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})
  const [selectedTags, setSelectedTags] = useState([])
  const [showMoreTags, setShowMoreTags] = useState(false)
  const [isManualLocation, setIsManualLocation] = useState(false)

  const [form, setForm] = useState({
    issue_type: '',
    severity: 'medium',
    description: '',
    image: null,
    manual_address: '',
    reported_user: '',
  })

  // Silently capture GPS on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGps({ lat: null, lng: null, status: 'error', address: '' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        setGps(prev => ({ ...prev, lat, lng, status: 'ready' }))
        
        // Reverse geocode
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
          const data = await res.json()
          setGps(prev => ({ ...prev, address: data.display_name || '' }))
        } catch { }
      },
      () => setGps({ lat: null, lng: null, status: 'error', address: '' }),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  useEffect(() => {
    api.get('/api/barangays/').then(r => setBarangays(r.data)).catch(() => { })
    
    // Fetch users for misconduct reporting
    // Note: This endpoint might require auth/role checks on backend
    api.get('/api/accounts/users/').then(r => {
      setSystemUsers(r.data)
    }).catch(err => {
      console.error('Failed to fetch system users:', err)
    })
  }, [])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  function toggleTag(tag) {
    setSelectedTags(prev => {
      const next = prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
      // Clear reported_user if Misconduct tag removed
      if (!next.includes('Misconduct')) {
        setForm(f => ({ ...f, reported_user: '' }))
      }
      return next
    })
  }

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setForm(prev => ({ ...prev, image: file }))
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    const errs = {}
    if (!form.issue_type) errs.issue_type = 'Please select an issue type.'
    if (!isManualLocation && gps.status !== 'ready') {
      errs.gps = 'Location could not be detected. Please enable GPS or enter address manually.'
    }
    if (isManualLocation && !form.manual_address) {
      errs.manual_address = 'Please enter the location address.'
    }
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSubmitting(true)
    const fd = new FormData()
    if (!isManualLocation) {
      if (isGpsValid(gps.lat)) fd.append('latitude', Number(gps.lat).toFixed(6))
      if (isGpsValid(gps.lng)) fd.append('longitude', Number(gps.lng).toFixed(6))
      fd.append('address', gps.address || '')
    } else {
      fd.append('address', form.manual_address)
    }
    
    fd.append('issue_type', form.issue_type)
    fd.append('severity', form.severity)
    fd.append('description', form.description)
    fd.append('tags', selectedTags.join(','))
    if (form.reported_user) fd.append('reported_user', form.reported_user)
    if (form.image) fd.append('image', form.image)
    if (user?.barangay) fd.append('barangay', user.barangay)

    // Debug: log FormData entries
    console.log('[ReportForm] Submitting payload:')
    for (let [key, val] of fd.entries()) {
      console.log(`  ${key}:`, val instanceof File ? `File(${val.name})` : val)
    }

    try {
      const response = await api.post('/api/watcher/reports/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      console.log('[ReportForm] Success:', response.data)
      navigate('/map', {
        state: {
          success: 'Report submitted!',
          focusReport: response.data
        }
      })
    } catch (err) {
      const data = err.response?.data || {}
      console.error('[ReportForm] Submission error:')
      
      let errorDetails = ''
      if (typeof data === 'string') {
        errorDetails = data
      } else {
        errorDetails = Object.entries(data)
          .map(([k, v]) => {
            const val = Array.isArray(v) ? v[0] : v
            return typeof val === 'object' ? JSON.stringify(val) : `${k}: ${val}`
          })
          .join('\n')
      }
      
      alert(`Report failed:\n${errorDetails}`)

      if (typeof data === 'object') {
        Object.keys(data).forEach(key => {
          console.error(`  Field "${key}":`, data[key])
        })
        const mapped = {}
        for (const [k, v] of Object.entries(data)) {
          mapped[k] = Array.isArray(v) ? v[0] : v
        }
        setErrors(mapped)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const visibleTags = showMoreTags ? ALL_TAGS : ALL_TAGS.slice(0, 3)
  const isGpsValid = (val) => val !== null && val !== undefined && !isNaN(Number(val))
  const locationDisplay = gps.status === 'ready'
    ? (gps.address || `Auto-detected: ${isGpsValid(gps.lat) ? Number(gps.lat).toFixed(4) : '?'}, ${isGpsValid(gps.lng) ? Number(gps.lng).toFixed(4) : '?'}`)
    : gps.status === 'detecting'
      ? 'Detecting your location…'
      : 'Location unavailable'

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 800 }}>


        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800 }}>
            Report Garbage Issue
          </h2>
          <p className="text-muted text-sm">Help us keep the community clean</p>
        </div>

        <div className="card card-dark" style={{ padding: 24 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', color: 'white', fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
            Issue Details
          </h3>

          {/* Issue Type & Severity */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
              <label className="form-label">Issue Type</label>
              <select
                className={`form-input ${errors.issue_type ? 'error' : ''}`}
                name="issue_type"
                value={form.issue_type}
                onChange={handleChange}
              >
                {ISSUE_TYPES.map(t => (
                  <option key={t.value} value={t.value} disabled={t.value === ''}>
                    {t.label}
                  </option>
                ))}
              </select>
              {errors.issue_type && <p className="form-error">{errors.issue_type}</p>}
            </div>

            <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
              <label className="form-label">Severity</label>
              <select
                className="form-input"
                name="severity"
                value={form.severity}
                onChange={handleChange}
              >
                {SEVERITIES.map(s => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Location — GPS with manual toggle */}
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Location
              <button 
                type="button" 
                onClick={() => setIsManualLocation(!isManualLocation)}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0 }}
              >
                {isManualLocation ? 'Use GPS' : 'Enter Manually'}
              </button>
            </label>
            
            {!isManualLocation ? (
              <div className="gps-field">
                <span className={`gps-dot ${gps.status}`} />
                <span style={{ fontSize: 13, color: gps.status === 'ready' ? 'var(--text)' : 'var(--text-muted)' }}>
                  {locationDisplay}
                </span>
                {gps.status === 'detecting' && <span className="gps-spinner" />}
                {gps.status === 'error' && (
                   <button 
                     type="button" 
                     className="btn btn-sm" 
                     style={{ marginLeft: 10, padding: '2px 8px', fontSize: 11 }}
                     onClick={() => window.location.reload()}
                   >
                     Retry
                   </button>
                )}
              </div>
            ) : (
              <input
                className={`form-input ${errors.manual_address ? 'error' : ''}`}
                name="manual_address"
                placeholder="Enter nearby landmark or street address"
                value={form.manual_address}
                onChange={handleChange}
              />
            )}
            {errors.gps && <p className="form-error">{errors.gps}</p>}
            {errors.manual_address && <p className="form-error">{errors.manual_address}</p>}
          </div>

          {/* Tags */}
          <div className="form-group">
            <label className="form-label">Tags</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {visibleTags.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className="tag-chip"
                  style={{
                    background: selectedTags.includes(tag) ? 'rgba(46,204,113,.15)' : 'transparent',
                    borderColor: selectedTags.includes(tag) ? 'var(--accent)' : 'var(--border)',
                    color: selectedTags.includes(tag) ? 'var(--accent)' : 'white',
                  }}
                >
                  {tag}
                </button>
              ))}
              <button
                type="button"
                className="tag-chip"
                onClick={() => setShowMoreTags(p => !p)}
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                {showMoreTags ? '▲' : '• • •'}
              </button>
            </div>
          </div>

          {/* Reported User (only if Misconduct tag selected) */}
          {selectedTags.includes('Misconduct') && (
            <div className="form-group animate-fade-in">
              <label className="form-label">Person to Report</label>
              <select
                className={`form-input ${errors.reported_user ? 'error' : ''}`}
                name="reported_user"
                value={form.reported_user}
                onChange={handleChange}
              >
                <option value="">Select Person (Driver/Watcher/Official)</option>
                {systemUsers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({u.role?.replace('_', ' ')})
                  </option>
                ))}
              </select>
              {errors.reported_user && <p className="form-error">{errors.reported_user}</p>}
            </div>
          )}

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-input"
              name="description"
              rows={4}
              placeholder="Provide details about the issue.."
              value={form.description}
              onChange={handleChange}
            />
          </div>

          {/* ── Capture Photo — camera only, no gallery ── */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Capture Photo</label>
            <div
              className="photo-upload-zone"
              onClick={() => fileRef.current?.click()}
            >
              {preview ? (
                <>
                  <img
                    src={preview}
                    alt="Captured"
                    style={{ maxHeight: 160, borderRadius: 8, marginBottom: 8 }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    📷 Tap to retake
                  </span>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, textAlign: 'center' }}>
                    Tap to open camera, to capture a photo of the issue.
                  </div>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={e => { e.stopPropagation(); fileRef.current?.click() }}
                  >
                    Open Camera
                  </button>
                </>
              )}
            </div>

            {/*
              capture="environment" = opens rear camera directly on mobile.
              accept="image/*"      = restricts to images.
              Together these prevent the "browse files / gallery" option
              from appearing on most mobile browsers.
            */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>
        </div>

        {/* Bottom actions */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 2, fontWeight: 700, letterSpacing: '.04em' }}
            onClick={handleSubmit}
            disabled={submitting || gps.status === 'detecting'}
          >
            {submitting ? 'Submitting…' : 'SUBMIT REPORT'}
          </button>
        </div>

      </div>
      <BottomNav />
    </>
  )
}