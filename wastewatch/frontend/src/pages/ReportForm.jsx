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

const ALL_TAGS = ['Near School', 'Near market', 'Side Road', 'Residential', 'Highway', 'Near River']

export default function ReportForm() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [gps, setGps] = useState({ lat: null, lng: null, status: 'detecting' })
  const [barangays, setBarangays] = useState([])
  const [preview, setPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})
  const [selectedTags, setSelectedTags] = useState([])
  const [showMoreTags, setShowMoreTags] = useState(false)

  const [form, setForm] = useState({
    issue_type: '',
    description: '',
    image: null,
  })

  // Silently capture GPS on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGps({ lat: null, lng: null, status: 'error' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, status: 'ready' }),
      () => setGps({ lat: null, lng: null, status: 'error' }),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  useEffect(() => {
    api.get('/api/barangays/').then(r => setBarangays(r.data)).catch(() => { })
  }, [])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  function toggleTag(tag) {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
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
    if (gps.status !== 'ready') errs.gps = 'Location could not be detected. Please enable GPS and try again.'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSubmitting(true)
    const fd = new FormData()
    fd.append('latitude', gps.lat)
    fd.append('longitude', gps.lng)
    fd.append('issue_type', form.issue_type)
    fd.append('description', form.description)
    fd.append('tags', selectedTags.join(','))
    if (form.image) fd.append('image', form.image)
    if (user?.barangay_id) fd.append('barangay', user.barangay_id)

    try {
      await api.post('/api/watcher/reports/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      navigate('/dashboard', { state: { success: 'Report submitted!' } })
    } catch (err) {
      const data = err.response?.data || {}
      const mapped = {}
      for (const [k, v] of Object.entries(data)) mapped[k] = Array.isArray(v) ? v[0] : v
      setErrors(mapped)
    } finally {
      setSubmitting(false)
    }
  }

  const visibleTags = showMoreTags ? ALL_TAGS : ALL_TAGS.slice(0, 3)
  const locationDisplay = gps.status === 'ready'
    ? `Auto-detected : N: ${gps.lat?.toFixed(4)}`
    : gps.status === 'detecting'
      ? 'Detecting your location…'
      : 'Location unavailable — please enable GPS'

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

          {/* Issue Type */}
          <div className="form-group">
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

          {/* Location — read-only GPS */}
          <div className="form-group">
            <label className="form-label">Location</label>
            <div className="gps-field">
              <span className={`gps-dot ${gps.status}`} />
              <span style={{ fontSize: 13, color: gps.status === 'ready' ? 'var(--text)' : 'var(--text-muted)' }}>
                {locationDisplay}
              </span>
              {gps.status === 'detecting' && <span className="gps-spinner" />}
            </div>
            {errors.gps && <p className="form-error">{errors.gps}</p>}
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