/**
 * pages/ReportForm.jsx
 * --------------------
 * Form to submit a new garbage report.
 * Supports GPS auto-fill and image preview.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

const ISSUE_TYPES = [
  { value: 'overflow',        label: 'Overflow' },
  { value: 'missed',          label: 'Missed Collection' },
  { value: 'illegal_dumping', label: 'Illegal Dumping' },
]

const SEVERITIES = [
  { value: 'low',    label: '🟢 Low' },
  { value: 'medium', label: '🟡 Medium' },
  { value: 'high',   label: '🔴 High' },
]

export default function ReportForm() {
  const { user }  = useAuth()
  const navigate  = useNavigate()
  const fileRef   = useRef(null)

  const [barangays, setBarangays] = useState([])
  const [preview,   setPreview]   = useState(null)
  const [gpsStatus, setGpsStatus] = useState('idle') // idle | loading | done | error
  const [submitting, setSubmitting] = useState(false)
  const [errors,    setErrors]    = useState({})

  const [form, setForm] = useState({
    barangay:    user?.barangay_id || '',
    latitude:    '',
    longitude:   '',
    issue_type:  'overflow',
    severity:    'medium',
    description: '',
    image:       null,
  })

  useEffect(() => {
    api.get('/api/barangays/').then(r => setBarangays(r.data)).catch(() => {})
  }, [])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setErrors(prev => ({ ...prev, [name]: '' }))
  }

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setForm(prev => ({ ...prev, image: file }))
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  function fillGPS() {
    setGpsStatus('loading')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(prev => ({
          ...prev,
          latitude:  pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }))
        setGpsStatus('done')
      },
      () => setGpsStatus('error')
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})

    // Build FormData (required for file uploads)
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => {
      if (v !== null && v !== '') fd.append(k, v)
    })

    try {
      await api.post('/api/watcher/reports/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      navigate('/dashboard', { state: { success: 'Report submitted successfully!' } })
    } catch (err) {
      const data = err.response?.data || {}
      const mapped = {}
      for (const [k, v] of Object.entries(data)) {
        mapped[k] = Array.isArray(v) ? v[0] : v
      }
      setErrors(mapped)
    } finally {
      setSubmitting(false)
    }
  }

  const gpsLabel = {
    idle:    '📍 Use My Current Location',
    loading: '⏳ Getting location…',
    done:    '✅ Location filled',
    error:   '❌ Could not get location',
  }[gpsStatus]

  return (
    <>
      <Navbar />
      <div className="page">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate(-1)}>← Back</button>
          <div>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 800 }}>Submit Report</h2>
            <p className="text-muted text-sm">Report a garbage issue in your area</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>

          {/* Issue Type */}
          <div className="form-group">
            <label className="form-label">Issue Type</label>
            <select className="form-input" name="issue_type" value={form.issue_type} onChange={handleChange}>
              {ISSUE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Severity */}
          <div className="form-group">
            <label className="form-label">Severity</label>
            <select className="form-input" name="severity" value={form.severity} onChange={handleChange}>
              {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Barangay */}
          <div className="form-group">
            <label className="form-label">Barangay</label>
            <select className="form-input" name="barangay" value={form.barangay} onChange={handleChange}>
              <option value="">— Select barangay —</option>
              {barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {errors.barangay && <p className="form-error">{errors.barangay}</p>}
          </div>

          {/* Coordinates */}
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Latitude</label>
              <input
                className={`form-input ${errors.latitude ? 'error' : ''}`}
                type="number" name="latitude" step="0.000001"
                value={form.latitude} onChange={handleChange}
                placeholder="14.5995"
              />
              {errors.latitude && <p className="form-error">{errors.latitude}</p>}
            </div>
            <div className="form-group">
              <label className="form-label">Longitude</label>
              <input
                className={`form-input ${errors.longitude ? 'error' : ''}`}
                type="number" name="longitude" step="0.000001"
                value={form.longitude} onChange={handleChange}
                placeholder="120.9842"
              />
              {errors.longitude && <p className="form-error">{errors.longitude}</p>}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-outline btn-sm btn-full mb-16"
            onClick={fillGPS}
            disabled={gpsStatus === 'loading' || gpsStatus === 'done'}
          >
            {gpsLabel}
          </button>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-input"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Describe the garbage issue..."
              rows={4}
            />
          </div>

          {/* Image Upload */}
          <div className="form-group">
            <label className="form-label">Photo Evidence <span className="text-muted">(optional)</span></label>
            <div
              style={{
                border: '2px dashed var(--border)',
                borderRadius: 8,
                padding: 20,
                textAlign: 'center',
                cursor: 'pointer',
              }}
              onClick={() => fileRef.current?.click()}
            >
              {preview ? (
                <img src={preview} alt="Preview"
                     style={{ maxHeight: 160, borderRadius: 8, marginBottom: 8 }} />
              ) : (
                <>
                  <div style={{ fontSize: 28, marginBottom: 6 }}>📷</div>
                  <p className="text-muted text-sm">Tap to upload a photo</p>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            style={{ marginTop: 8 }}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : '🗂 Submit Report'}
          </button>

        </form>
      </div>
    </>
  )
}
