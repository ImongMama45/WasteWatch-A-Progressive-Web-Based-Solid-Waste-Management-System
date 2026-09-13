/**
 * VerificationTasks.jsx — Watcher pre-collection inspection tasks.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'
import api from '../api/client'

const FILTERS = ['All', 'Pending', 'Inspected', 'Empty Stops']

const STATUS_META = {
  PENDING_INSPECTION: { label: 'Pending Inspection', color: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
  READY_FOR_COLLECTION: { label: 'Ready for Collection', color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
  EMPTY_STOP: { label: 'Empty Stop', color: '#64748b', bg: 'rgba(100,116,139,.12)' },
}

function filterTasks(tasks, tab) {
  if (tab === 'All') return tasks
  if (tab === 'Pending') return tasks.filter(t => t.current_status === 'PENDING_INSPECTION')
  if (tab === 'Inspected') return tasks.filter(t => t.current_status === 'READY_FOR_COLLECTION')
  if (tab === 'Empty Stops') return tasks.filter(t => t.current_status === 'EMPTY_STOP')
  return tasks
}

function PreInspectionForm({ task, onBack, onComplete }) {
  const [gps, setGps] = useState({ lat: null, lng: null, status: 'detecting' })
  const [remarks, setRemarks] = useState('')
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
    if (!outcome) { setError('Select whether garbage is present or not.'); return }
    if (gps.status !== 'ready') { setError('GPS validation required.'); return }
    setSubmitting(true)
    setError('')
    try {
      const form = new FormData()
      form.append('schedule_id', task.schedule_id)
      form.append('stop_order', task.stop_order)
      form.append('lat', gps.lat)
      form.append('lng', gps.lng)
      form.append('outcome', outcome)
      form.append('remarks', remarks)
      if (photo) form.append('photo', photo)
      await api.post('/api/watcher/stop-validations/pre-inspect/', form)
      onComplete()
    } catch (err) {
      setError(err.response?.data?.error || 'Inspection submission failed.')
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
          <h2 className="pv-title">PRE-COLLECTION INSPECTION</h2>
          <div className="pv-subtitle">{task.label}</div>
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
            <label className="form-label">Inspection Outcome</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className={`btn ${outcome === 'garbage_present' ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => setOutcome('garbage_present')}>Garbage Present</button>
              <button type="button" className={`btn ${outcome === 'no_garbage' ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }} onClick={() => setOutcome('no_garbage')}>No Garbage</button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Remarks (Optional)</label>
            <textarea className="form-input" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Photo Proof</label>
            <div className="photo-upload-zone" onClick={() => document.getElementById('pre-inspect-photo').click()}>
              {preview ? <img src={preview} alt="Preview" style={{ maxHeight: 160, borderRadius: 8 }} /> : (
                <button type="button" className="btn btn-outline btn-sm">Take Photo</button>
              )}
            </div>
            <input id="pre-inspect-photo" type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onBack}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSubmit} disabled={submitting || gps.status !== 'ready'}>
            {submitting ? 'Submitting…' : 'Submit Inspection'}
          </button>
        </div>
      </div>
      <BottomNav />
    </>
  )
}

export default function VerificationTasks() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('All')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [selectedTask, setSelectedTask] = useState(null)

  async function loadTasks() {
    setLoading(true)
    try {
      const res = await api.get('/api/watcher/stop-validations/')
      const rows = (res.data?.results ?? res.data ?? []).filter(t =>
        ['PENDING_INSPECTION', 'READY_FOR_COLLECTION', 'EMPTY_STOP'].includes(t.current_status),
      )
      setTasks(rows.map((row, index) => ({
        ...row,
        watcherIndex: index + 1,
        title: `Stop ${index + 1} of ${rows.length} (${row.label})`,
        barangay: row.barangay_names || row.label,
        date: row.collection_date,
        status: row.current_status,
      })))
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTasks() }, [])

  const topPending = tasks.find(t => t.status === 'PENDING_INSPECTION')
  const inspected = tasks.filter(t => t.status === 'READY_FOR_COLLECTION' || t.status === 'EMPTY_STOP').length
  const total = tasks.length
  const progress = total ? Math.round((inspected / total) * 100) : 0
  const filtered = filterTasks(tasks, activeTab)

  if (selectedTask) {
    return (
      <PreInspectionForm
        task={selectedTask}
        onBack={() => setSelectedTask(null)}
        onComplete={() => { setSelectedTask(null); loadTasks() }}
      />
    )
  }

  return (
    <>
      <Navbar />
      <div className="vt-hero">
        <div className="vt-hero-overlay" />
        <h1 className="vt-hero-title">VERIFICATION TASKS</h1>
      </div>
      <div className="page" style={{ maxWidth: 480, paddingTop: 16 }}>
        {topPending ? (
          <div className="card card-dark" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{topPending.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              {topPending.barangay_names || topPending.barangay}
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setSelectedTask(topPending)}>
              INSPECT STOP
            </button>
          </div>
        ) : !loading && (
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px', marginBottom: 16 }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No pending inspections today</p>
          </div>
        )}

        <div className="card card-dark" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Progress (Today)</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inspected}/{total} Stops</span>
          </div>
          <div style={{ background: 'var(--border)', borderRadius: 20, height: 8, overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 20, transition: 'width .6s ease' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setActiveTab(f)} className={activeTab === f ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
              {f}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? <p className="text-muted text-sm">Loading tasks…</p> : filtered.map(task => {
            const meta = STATUS_META[task.status] || STATUS_META.PENDING_INSPECTION
            return (
              <div key={task.id} className="vt-task-card" onClick={() => setExpandedId(prev => prev === task.id ? null : task.id)}>
                <span className="vt-status-badge" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                <div style={{ fontWeight: 600, fontSize: 15, margin: '10px 0' }}>{task.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{task.barangay}</div>
                {expandedId === task.id && task.status === 'PENDING_INSPECTION' && (
                  <button className="btn btn-primary" style={{ marginTop: 14, width: '100%' }}
                    onClick={e => { e.stopPropagation(); setSelectedTask(task) }}>
                    INSPECT
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <button className="btn btn-outline" style={{ width: '100%', marginTop: 16 }} onClick={() => navigate('/collection/confirm')}>
          View Post-Collection Verifications
        </button>
      </div>
      <BottomNav />
    </>
  )
}
