/**
 * ArrivedModule.jsx
 * ------------------
 * Rendered when routeState === "arrived".
 * Driver confirms collection at the stop and optionally adds a note.
 *
 * On confirm → setRouteState("completed")
 *
 * Designed for field conditions: fast, large targets, minimal steps.
 *
 * Props:
 *  - setRouteState: fn
 *
 * TODO (future sprints):
 *  - Wire stop.id from route context to POST to correct endpoint
 *  - Enable photo capture: <input type="file" capture="environment">
 *  - Show actual stop address from API instead of sessionStorage mock
 */

import { useState } from 'react'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'

// ─── QUICK NOTE PRESETS ───────────────────────────────────────────────────────

const QUICK_NOTES = [
  'Collected',
  'Partially collected',
  'No bins outside',
  'Overflowing',
]

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function ArrivedModule({ setRouteState }) {
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // TODO: pull real stop data from route context / API
  const stopName = sessionStorage.getItem('ww_current_stop') || 'Barangay Isabang Dump Site'
  const barangay = sessionStorage.getItem('ww_barangay') || 'BARANGAY ISABANG'

  function selectPreset(preset) {
    setNote(prev => prev ? `${prev}, ${preset}` : preset)
  }

  async function handleConfirm() {
    setSubmitting(true)

    // TODO: replace stop_id with real value from route context
    try {
      await api.post('/api/driver/stops/current/collect/', {
        note: note.trim() || null,
        collected_at: new Date().toISOString(),
        lat: sessionStorage.getItem('ww_gps_lat') || null,
        lng: sessionStorage.getItem('ww_gps_lng') || null,
      })
    } catch {
      // Optimistic — proceed even if network fails
    }

    sessionStorage.setItem('ww_route_state', 'navigating')  // next stop returns to nav
    setSubmitting(false)
    setRouteState('completed')
  }

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes amSlideUp {
          from { opacity:0; transform:translateY(16px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .am-card { animation: amSlideUp .25s ease both; }
      `}</style>

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f8fafc',
        fontFamily: 'var(--font-body)',
      }}>

        {/* ── ARRIVED HERO ── */}
        <div style={{
          background: 'linear-gradient(160deg, #0f172a 60%, #1e3a5f)',
          padding: '48px 24px 36px',
          textAlign: 'center',
          color: '#fff',
        }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>📍</div>
          <h1 style={{
            fontFamily: 'var(--font-head)',
            fontSize: 26, fontWeight: 900,
            margin: '0 0 8px', letterSpacing: '.02em',
          }}>
            You have arrived
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, margin: 0 }}>
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* ── STOP DETAILS ── */}
        <div className="am-card" style={{
          margin: '0 16px',
          marginTop: -20,
          background: '#fff',
          borderRadius: 16,
          padding: '18px 16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', marginBottom: 6 }}>
            CURRENT STOP
          </div>
          <div style={{ fontWeight: 900, fontSize: 16, color: '#0f172a', marginBottom: 4 }}>
            {stopName}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
            {barangay}
          </div>
        </div>

        {/* ── QUICK NOTE PRESETS ── */}
        <div style={{ padding: '0 16px', marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: '#94a3b8',
            letterSpacing: '.06em', marginBottom: 10,
          }}>
            QUICK NOTES
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {QUICK_NOTES.map(preset => (
              <button
                key={preset}
                onClick={() => selectPreset(preset)}
                style={{
                  padding: '8px 14px', borderRadius: 20,
                  border: `1px solid ${note.includes(preset) ? '#0f172a' : '#e2e8f0'}`,
                  background: note.includes(preset) ? '#0f172a' : '#fff',
                  color: note.includes(preset) ? '#fff' : '#475569',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  transition: 'all .15s',
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* ── FREE-TEXT NOTE ── */}
        <div style={{ padding: '0 16px', marginBottom: 20 }}>
          <textarea
            placeholder="Additional notes (optional)…"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={200}
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '12px 14px', borderRadius: 12,
              border: '1.5px solid #e2e8f0', background: '#fff',
              fontSize: 14, color: '#0f172a', resize: 'none',
              fontFamily: 'var(--font-body)',
              outline: 'none',
            }}
          />
        </div>

        {/* ── PHOTO PROOF PLACEHOLDER ── */}
        {/* TODO (future sprint): implement camera capture
            - <input type="file" accept="image/*" capture="environment">
            - Preview thumbnail before submit
            - POST to /api/driver/stops/current/photo/
        */}
        <div style={{
          margin: '0 16px',
          padding: '14px 16px',
          border: '1.5px dashed #cbd5e1',
          borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 28,
          cursor: 'default',
        }}>
          <span style={{ fontSize: 24 }}>📷</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>Photo Proof</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Camera upload — coming soon</div>
          </div>
        </div>

        {/* ── CONFIRM CTA ── */}
        <div style={{ padding: '0 16px', marginTop: 'auto', paddingBottom: 32 }}>
          <button
            id="confirm-collection-btn"
            onClick={handleConfirm}
            disabled={submitting}
            style={{
              width: '100%', padding: '18px', borderRadius: 30,
              background: submitting ? '#e2e8f0' : '#0f172a',
              color: submitting ? '#94a3b8' : '#fff',
              border: 'none',
              fontFamily: 'var(--font-head)',
              fontSize: 16, fontWeight: 900, letterSpacing: '.06em',
              cursor: submitting ? 'not-allowed' : 'pointer',
              boxShadow: submitting ? 'none' : '0 6px 20px rgba(15,23,42,0.3)',
              transition: 'all .2s',
            }}
          >
            {submitting ? 'Saving…' : '✓ Confirm Collection'}
          </button>
        </div>

      </div>
    </>
  )
}
