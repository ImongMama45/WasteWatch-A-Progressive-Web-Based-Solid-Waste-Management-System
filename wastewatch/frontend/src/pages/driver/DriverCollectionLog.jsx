/**
 * DriverCollectionLog.jsx
 * ------------------------
 * Driver-specific collection confirmation page.
 *
 * Flow:
 *  1. Driver sees their current stop details at the top
 *  2. "Mark Collected" button + optional note → confirms stop
 *  3. Photo proof section (scaffolded, NOT yet implemented)
 *  4. Today's completed stops list at the bottom
 *
 * Extends the existing ConfirmCollection flow (Watcher side).
 * The Watcher still verifies; this page lets the Driver report first.
 *
 * API endpoints:
 *   GET  /api/driver/stops/current/          → current stop
 *   POST /api/driver/stops/<id>/collect/     → mark collected
 *   GET  /api/driver/stops/history/today/    → today's history
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_CURRENT_STOP = {
  id: 4,
  order: 4,
  address: 'Barangay Hall, Brgy. 11',
  barangay: 'Barangay 11',
  zone: 'Zone B',
  category: 'Biodegradable',
  scheduledTime: '8:15 AM',
  distance: '0.3 km',
  notes: '',
}

const MOCK_HISTORY = [
  {
    id: 1, order: 1,
    address: 'Barangay Hall, Brgy. 8',
    barangay: 'Barangay 8',
    category: 'Mixed Waste',
    collectedAt: '6:42 AM',
    note: null,
  },
  {
    id: 2, order: 2,
    address: 'Public Market, Brgy. 9',
    barangay: 'Barangay 9',
    category: 'Recyclable',
    collectedAt: '7:05 AM',
    note: 'Bins were full',
  },
  {
    id: 3, order: 3,
    address: 'Covered Court, Brgy. 10',
    barangay: 'Barangay 10',
    category: 'Mixed Waste',
    collectedAt: '7:28 AM',
    note: null,
  },
]

// ─── QUICK NOTE PRESETS ───────────────────────────────────────────────────────

const NOTE_PRESETS = [
  'No bins outside',
  'Area inaccessible',
  'Partially collected',
  'Resident not home',
]

// ─── CATEGORY CONFIG ──────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  'Biodegradable': '#2ecc71',
  'Recyclable': '#3b82f6',
  'Mixed Waste': '#f59e0b',
  'Hazardous': '#ef4444',
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || 'var(--text-muted)'
}

function now12() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ─── STOP DETAIL CARD ─────────────────────────────────────────────────────────

function CurrentStopCard({ stop }) {
  const color = categoryColor(stop.category)
  return (
    <div style={{
      background: 'var(--surface)', border: `1.5px solid ${color}44`,
      borderRadius: 16, padding: '18px 16px', marginBottom: 16,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Category accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: 4,
        background: color, borderRadius: '16px 0 0 16px',
      }} />

      <div style={{ paddingLeft: 12 }}>
        {/* Stop number + category */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: `${color}1a`, border: `1.5px solid ${color}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 12, color,
          }}>
            {stop.order}
          </div>
          <span style={{
            background: `${color}1a`, color, border: `1px solid ${color}44`,
            fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20, letterSpacing: '.05em',
          }}>
            {stop.category.toUpperCase()}
          </span>
          <span className="text-muted text-xs" style={{ marginLeft: 'auto' }}>
            {stop.distance}
          </span>
        </div>

        {/* Address */}
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{stop.address}</div>
        <div className="text-muted text-xs" style={{ marginBottom: 8 }}>{stop.barangay} · {stop.zone}</div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 16 }}>
          <div>
            <div className="form-label" style={{ marginBottom: 2 }}>SCHEDULED</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{stop.scheduledTime}</div>
          </div>
          <div>
            <div className="form-label" style={{ marginBottom: 2 }}>CATEGORY</div>
            <div style={{ fontSize: 14, fontWeight: 700, color }}>{stop.category}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── COLLECTION FORM ──────────────────────────────────────────────────────────

function CollectionForm({ stop, onCollected }) {
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  function selectPreset(preset) {
    setNote(prev => prev ? `${prev}, ${preset}` : preset)
  }

  async function handleCollect() {
    setSubmitting(true)
    const payload = {
      stop_id: stop.id,
      note: note.trim() || null,
      collected_at: new Date().toISOString(),
      // photo_proof: null   // TODO: attach when photo feature is ready
    }
    try {
      await api.post(`/api/driver/stops/${stop.id}/collect/`, payload)
    } catch {
      // Fail silently — optimistic update shown anyway
    } finally {
      setSubmitting(false)
      setDone(true)
      setTimeout(() => onCollected({ ...stop, collectedAt: now12(), note: note || null }), 900)
    }
  }

  if (done) {
    return (
      <div style={{
        background: 'rgba(46,204,113,0.08)', border: '1.5px solid rgba(46,204,113,0.3)',
        borderRadius: 14, padding: '24px', textAlign: 'center', marginBottom: 16,
      }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
        <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, color: 'var(--accent)' }}>
          Stop Collected!
        </div>
        <div className="text-muted text-xs" style={{ marginTop: 6 }}>Moving to next stop…</div>
      </div>
    )
  }

}

// ─── HISTORY CARD ─────────────────────────────────────────────────────────────

function HistoryCard({ entry, index }) {
  const color = categoryColor(entry.category)
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* Order bubble */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(46,204,113,0.12)', border: '1.5px solid #2ecc71',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: 12, color: '#2ecc71',
      }}>✓</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{entry.address}</div>
        <div className="text-muted text-xs" style={{ marginBottom: entry.note ? 4 : 0 }}>
          <span style={{ color }}>{entry.category}</span>
          {' · '}{entry.barangay}{' · '}{entry.collectedAt}
        </div>
        {entry.note && (
          <div style={{
            fontSize: 11, color: 'var(--text-muted)',
            background: 'var(--bg)', borderRadius: 6, padding: '3px 8px',
            display: 'inline-block', marginTop: 2,
          }}>
            {entry.note}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DriverCollectionLog() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [currentStop, setCurrentStop] = useState(MOCK_CURRENT_STOP)
  const [history, setHistory] = useState(MOCK_HISTORY)
  const [loading, setLoading] = useState(true)
  const [noMoreStops, setNoMoreStops] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/api/driver/stops/current/').catch(() => ({ data: null })),
      api.get('/api/driver/stops/history/today/').catch(() => ({ data: null })),
    ]).then(([curRes, histRes]) => {
      if (curRes.data) setCurrentStop(curRes.data)
      if (histRes.data) setHistory(histRes.data)
    }).finally(() => setLoading(false))
  }, [])

  // Called when driver confirms a stop
  function handleCollected(confirmedStop) {
    setHistory(prev => [
      { ...confirmedStop, collectedAt: now12() },
      ...prev,
    ])
    // Fetch next stop from backend (or set noMoreStops)
    api.get('/api/driver/stops/current/').then(res => {
      if (res.data) setCurrentStop(res.data)
      else setNoMoreStops(true)
    }).catch(() => setNoMoreStops(true))
  }

  return (
    <>
      <style>{`
        @keyframes slideDown {
          from { opacity:0; transform:translateY(-8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .dcl-section { animation: slideDown .2s ease both; }
      `}</style>

      <div className="page" style={{ paddingBottom: 88 }}>

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>

          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
              Collection Log
            </h1>
            <p className="text-muted text-xs" style={{ marginTop: 2 }}>
              {history.length} stops done today
            </p>
          </div>
          {/* Compact progress pill */}
          <div style={{
            background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)',
            borderRadius: 10, padding: '5px 12px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, color: 'var(--accent)' }}>
              {history.length}
            </div>
            <div className="form-label" style={{ marginBottom: 0 }}>DONE</div>
          </div>
        </div>

        {noMoreStops ? (
          /* ── ALL STOPS DONE ── */
          <div className="card dcl-section" style={{ textAlign: 'center', padding: '32px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🎉</div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
              Route Complete!
            </div>
            <div className="text-muted text-sm">All stops collected for today.</div>
          </div>
        ) : currentStop ? (
          <>
            {/* ── CURRENT STOP SECTION ── */}
            <div className="dcl-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h2 className="section-title" style={{ fontSize: 14, margin: 0 }}>CURRENT STOP</h2>
                <span style={{
                  background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.3)',
                  fontSize: 9, fontWeight: 800, padding: '2px 9px', borderRadius: 20, letterSpacing: '.05em',
                }}>ACTIVE</span>
              </div>
              <CurrentStopCard stop={currentStop} />
              <CollectionForm stop={currentStop} onCollected={handleCollected} />
            </div>
          </>
        ) : null}

        {/* ── TODAY'S HISTORY ── */}
        {history.length > 0 && (
          <div className="card dcl-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 className="section-title" style={{ fontSize: 14, margin: 0 }}>TODAY'S COLLECTIONS</h2>
              <span className="text-muted text-xs">{history.length} stops</span>
            </div>
            <div>
              {history.map((entry, i) => (
                <HistoryCard key={entry.id} entry={entry} index={i} />
              ))}
            </div>
          </div>
        )}

        {history.length === 0 && !currentStop && (
          <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
            <div className="text-muted text-sm">No collections recorded yet today.</div>
          </div>
        )}

      </div>
    </>
  )
}
