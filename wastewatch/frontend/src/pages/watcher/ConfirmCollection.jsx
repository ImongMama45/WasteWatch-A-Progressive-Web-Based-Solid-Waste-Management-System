/**
 * ConfirmCollection.jsx
 * Watcher post-collection verification for COLLECTION_REPORTED stops.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import api from '../../api/client'
import { broadcastPickupStatusSync } from '../../utils/pickupStatusSync'

function formatTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export default function ConfirmCollection() {
  const navigate = useNavigate()
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCard, setActiveCard] = useState(null)
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)

  async function loadPending() {
    setLoading(true)
    try {
      const res = await api.get('/api/watcher/stop-validations/?status=COLLECTION_REPORTED')
      const rows = res.data?.results ?? res.data ?? []
      setPending(rows.map(row => ({
        ...row,
        barangay: row.label,
        distance: '—',
        time_reported: formatTime(row.collection_timestamp),
        driver: row.driver_name || 'Unknown',
        truck: row.truck_plate || '—',
        status: row.current_status,
      })))
    } catch {
      setPending([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPending() }, [])

  function handleCardClick(item) {
    setActiveCard(prev => prev?.id === item.id ? null : item)
  }

  function handleConfirm(item) {
    setSelected(item)
    setShowForm(true)
  }

  if (showForm && selected) {
    return (
      <PendingVerificationForm
        item={selected}
        onBack={() => setShowForm(false)}
        onComplete={() => { setShowForm(false); loadPending(); broadcastPickupStatusSync() }}
      />
    )
  }

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 480, paddingBottom: 88 }}>
        <button className="back-link" onClick={() => navigate('/dashboard')}>‹ BACK</button>
        <div style={{ marginBottom: 24 }}>
          <h2 className="pv-title">PENDING VERIFICATIONS</h2>
          <div className="pv-subtitle">POST-COLLECTION</div>
          <p className="text-muted text-sm" style={{ marginTop: 8 }}>Verify driver collection reports</p>
        </div>

        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : pending.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <p style={{ fontWeight: 600 }}>All caught up!</p>
            <p className="text-muted text-sm">No pending verifications right now.</p>
          </div>
        ) : (
          pending.map(item => (
            <div
              key={item.id}
              className={`pv-card ${activeCard?.id === item.id ? 'expanded' : ''}`}
              onClick={() => handleCardClick(item)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{item.barangay}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    <strong>Reported</strong> : {item.time_reported}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <strong>Driver</strong> : {item.driver}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <strong>Truck</strong> : {item.truck}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308', display: 'inline-block' }} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status : Collection Reported</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleConfirm(item)}>
                  VERIFY
                </button>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate('/report/submit')}>
                  REPORT ISSUE
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <BottomNav />
    </>
  )
}

function PendingVerificationForm({ item, onBack, onComplete }) {
  const [gps, setGps] = useState({ lat: null, lng: null, status: 'detecting' })
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [outcome, setOutcome] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!navigator.geolocation) { setGps({ lat: null, lng: null, status: 'error' }); return }
    navigator.geolocation.getCurrentPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, status: 'ready' }),
      () => setGps({ lat: null, lng: null, status: 'error' }),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [])

  function handlePhoto(e) {
    const file = e.target.files[0]
    if (!file) return
    setPhoto(file)
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!outcome) { setError('Select verification outcome.'); return }
    if (outcome === 'failed' && !description.trim()) { setError('Dispute reason is required.'); return }
    if (gps.status !== 'ready') { setError('GPS validation required.'); return }
    setSubmitting(true)
    setError('')
    try {
      const form = new FormData()
      form.append('schedule_id', item.schedule_id)
      form.append('stop_order', item.stop_order)
      form.append('lat', gps.lat)
      form.append('lng', gps.lng)
      form.append('outcome', outcome)
      form.append('dispute_reason', description)
      if (photo) form.append('photo', photo)
      await api.post('/api/watcher/stop-validations/post-verify/', form)
      onComplete()
    } catch (err) {
      setError(err.response?.data?.error || 'Verification submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 480, paddingBottom: 88 }}>
        <button className="back-link" onClick={onBack}>‹ BACK</button>
        <div style={{ marginBottom: 24 }}>
          <h2 className="pv-title">POST-COLLECTION VERIFICATION</h2>
          <div className="pv-subtitle">{item.label || item.barangay}</div>
        </div>
        <div className="card card-dark" style={{ padding: 24 }}>
          <div className="form-group">
            <label className="form-label">Location</label>
            <div className="gps-field">
              <span className={`gps-dot ${gps.status}`} />
              <span style={{ fontSize: 13, color: gps.status === 'ready' ? 'var(--text)' : 'var(--text-muted)' }}>
                {gps.status === 'ready'
                  ? `GPS verified : ${gps.lat?.toFixed(4)}, ${gps.lng?.toFixed(4)}`
                  : gps.status === 'detecting' ? 'Detecting your location…' : 'Location unavailable'}
              </span>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Verification Outcome</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className={`btn ${outcome === 'success' ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }}
                onClick={() => setOutcome('success')}>
                Collected Successfully
              </button>
              <button type="button" className={`btn ${outcome === 'failed' ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }}
                onClick={() => setOutcome('failed')}>
                Collection Failed
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes / Dispute Reason</label>
            <textarea className="form-input" rows={4} value={description} onChange={e => setDescription(e.target.value)}
              placeholder={outcome === 'failed' ? 'Explain why collection failed…' : 'Optional notes'} />
          </div>
          <div className="form-group">
            <label className="form-label">Verification Photo</label>
            <div className="photo-upload-zone" onClick={() => document.getElementById('vf-photo').click()}>
              {preview ? <img src={preview} alt="Preview" style={{ maxHeight: 160, borderRadius: 8 }} /> : (
                <button type="button" className="btn btn-outline btn-sm">Take Photo</button>
              )}
            </div>
            <input id="vf-photo" type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onBack}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSubmit}
            disabled={submitting || gps.status !== 'ready'}>
            {submitting ? 'Submitting…' : 'Submit Verification'}
          </button>
        </div>
      </div>
      <BottomNav />
    </>
  )
}
