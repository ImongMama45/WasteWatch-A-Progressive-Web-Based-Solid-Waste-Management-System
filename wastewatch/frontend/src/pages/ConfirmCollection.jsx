/**
 * ConfirmCollection.jsx
 * ----------------------
 * Step 1 — "Pending Verifications" modal/page.
 * When Watcher taps "Confirm Collection" on the dashboard,
 * they land here and see all pending driver collections awaiting their verification.
 * Tapping CONFIRM on a card takes them to VerificationTasks.jsx.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'
import api from '../api/client'

// Mock pending verifications — replace with real API call when Driver module is built
const MOCK_PENDING = [
  {
    id: 1,
    barangay: 'Baranggay 1, 5th Ave',
    distance: '0.3 KM',
    time_reported: '2:00 AM',
    driver: 'Hassad Gerald',
    truck: '01-12-51',
    status: 'awaiting',
  },
  {
    id: 2,
    barangay: 'Baranggay 2, Main St',
    distance: '1.1 KM',
    time_reported: '3:45 AM',
    driver: 'Ramon Santos',
    truck: '02-08-33',
    status: 'awaiting',
  },
]

export default function ConfirmCollection() {
  const navigate = useNavigate()
  const [pending, setPending] = useState(MOCK_PENDING)
  const [selected, setSelected] = useState(null)   // which card is expanded
  const [showForm, setShowForm] = useState(false)   // show verification detail form
  const [activeCard, setActiveCard] = useState(null)

  // When a card is tapped — expand it (matches Frame_23 design)
  function handleCardClick(item) {
    setActiveCard(prev => prev?.id === item.id ? null : item)
  }

  function handleConfirm(item) {
    // Store the item being confirmed and show the detail form
    setSelected(item)
    setShowForm(true)
  }

  function handleReportIssue(item) {
    // Navigate to report form pre-filled as issue
    navigate('/report/submit')
  }

  if (showForm && selected) {
    return <PendingVerificationForm item={selected} onBack={() => setShowForm(false)} />
  }

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 480, paddingBottom: 88 }}>

        {/* Back */}
        <button className="back-link" onClick={() => navigate('/dashboard')}>
          ‹ BACK
        </button>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h2 className="pv-title">PENDING VERIFICATIONS</h2>
          <div className="pv-subtitle">CONFIRMATION</div>
          <p className="text-muted text-sm" style={{ marginTop: 8 }}>
            Help us keep the community clean
          </p>
        </div>

        {/* Pending cards */}
        {pending.length === 0 ? (
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
              {/* Card header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--danger)', fontSize: 16 }}>📍</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{item.barangay}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      <strong>Time Reported</strong> : {item.time_reported}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      <strong>Driver</strong> : {item.driver}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      <strong>Truck</strong> : {item.truck}
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {item.distance}
                </span>
              </div>

              {/* Status row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status : Awaiting Verification</span>
              </div>

              {/* Action buttons — always visible on this card design */}
              <div style={{ display: 'flex', gap: 10 }} onClick={e => e.stopPropagation()}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, fontWeight: 700, letterSpacing: '.05em', fontSize: 13 }}
                  onClick={() => handleConfirm(item)}
                >
                  CONFIRM
                </button>
                <button
                  className="btn btn-outline"
                  style={{ flex: 1, fontSize: 13 }}
                  onClick={() => handleReportIssue(item)}
                >
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


/**
 * PendingVerificationForm
 * -----------------------
 * Step 2 — After tapping CONFIRM on a pending card.
 * Watcher provides location, optional description, and a photo.
 * Matches Image 1 (Pending_Verifiacations.png).
 */
function PendingVerificationForm({ item, onBack }) {
  const navigate = useNavigate()
  const [gps, setGps]               = useState({ lat: null, lng: null, status: 'detecting' })
  const [description, setDescription] = useState('')
  const [photo, setPhoto]           = useState(null)
  const [preview, setPreview]       = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Silent GPS capture on mount — no manual override
  useEffect(() => {
    if (!navigator.geolocation) { setGps({ lat: null, lng: null, status: 'error' }); return }
    navigator.geolocation.getCurrentPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, status: 'ready' }),
      () => setGps({ lat: null, lng: null, status: 'error' }),
      { enableHighAccuracy: true, timeout: 10000 }
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
    setSubmitting(true)
    // TODO: POST to /api/watcher/confirm/ with real data
    // TODO: POST real data
    // Payload: { lat: gps.lat, lng: gps.lng, description, photo, item.id }
    await new Promise(r => setTimeout(r, 800))
    setSubmitting(false)
    navigate('/verification-tasks')
  }

  return (
    <>
      <Navbar />
      <div className="page" style={{ maxWidth: 480, paddingBottom: 88 }}>

        <button className="back-link" onClick={onBack}>‹ BACK</button>

        <div style={{ marginBottom: 24 }}>
          <h2 className="pv-title">PENDING VERIFICATIONS</h2>
          <div className="pv-subtitle">CONFIRMATION</div>
          <p className="text-muted text-sm" style={{ marginTop: 8 }}>
            Help us keep the community clean
          </p>
        </div>

        {/* Verification Details card */}
        <div className="card card-dark" style={{ padding: 24 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
            Verification Details
          </h3>

          {/* Location — GPS only, read-only */}
          <div className="form-group">
            <label className="form-label">Location</label>
            <div className="gps-field">
              <span className={`gps-dot ${gps.status}`} />
              <span style={{ fontSize: 13, color: gps.status === 'ready' ? 'var(--text)' : 'var(--text-muted)' }}>
                {gps.status === 'ready'
                  ? `Auto-detected : N: ${gps.lat?.toFixed(4)}`
                  : gps.status === 'detecting'
                  ? 'Detecting your location…'
                  : 'Location unavailable — enable GPS'}
              </span>
              {gps.status === 'detecting' && <span className="gps-spinner" />}
            </div>
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">
              Description{' '}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>
                (Optional)
              </span>
            </label>
            <textarea
              className="form-input"
              rows={4}
              placeholder="Provide notes to the driver."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Upload Photo */}
          <div className="form-group">
            <label className="form-label">Upload Photo</label>
            <div
              className="photo-upload-zone"
              onClick={() => document.getElementById('vf-photo').click()}
            >
              {preview ? (
                <img src={preview} alt="Preview"
                     style={{ maxHeight: 160, borderRadius: 8 }} />
              ) : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
                    Take a photo
                  </div>
                  <button className="btn btn-outline btn-sm"
                          onClick={e => { e.stopPropagation(); document.getElementById('vf-photo').click() }}>
                    Take Photo
                  </button>
                </>
              )}
            </div>
            <input id="vf-photo" type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
          </div>
        </div>

        {/* Bottom action buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onBack}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 2, fontWeight: 700, letterSpacing: '.04em' }}
            onClick={handleSubmit}
            disabled={submitting || gps.status === 'detecting'}
          >
            {submitting ? 'Submitting…' : 'Submit Verification'}
          </button>
        </div>

      </div>
      <BottomNav />
    </>
  )
}
