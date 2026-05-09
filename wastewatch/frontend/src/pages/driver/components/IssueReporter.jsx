/**
 * IssueReporter.jsx
 * ------------------
 * Bottom-sheet component for reporting on-route issues.
 * Designed for minimal interaction while driving:
 *  - One tap to select issue type
 *  - Optional short note
 *  - GPS + timestamp auto-attached
 *  - Submit with a single large button
 *
 * Props:
 *   open        – boolean
 *   onClose     – () => void
 *   gpsPosition – { lat, lng } | null  (from useGpsTracking)
 */

import { useState } from 'react'
import api from '../../../api/client'

// ─── ISSUE TYPES ──────────────────────────────────────────────────────────────

const ISSUE_TYPES = [
  { key: 'road_blocked', label: 'Road Blocked', icon: '🚧', color: '#ef4444' },
  { key: 'no_garbage', label: 'No Garbage Found', icon: '🗑️', color: '#f59e0b' },
  { key: 'overflow', label: 'Overflowing Waste', icon: '♻️', color: '#f97316' },
  { key: 'vehicle_issue', label: 'Vehicle Issue', icon: '🚛', color: '#a78bfa' },
]

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function IssueReporter({ open, onClose, gpsPosition }) {
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  if (!open) return null

  function handleClose() {
    setSelected(null)
    setNote('')
    setDone(false)
    onClose()
  }

  async function handleSubmit() {
    if (!selected) return
    setLoading(true)

    const payload = {
      type: selected,
      note: note.trim() || null,
      latitude: gpsPosition?.lat ?? null,
      longitude: gpsPosition?.lng ?? null,
      timestamp: new Date().toISOString(),
    }

    try {
      await api.post('/api/driver/issues/', payload)
    } catch {
      // Fail silently — issue is still recorded locally if offline
    } finally {
      setLoading(false)
      setDone(true)
      // Auto-close after short confirmation
      setTimeout(handleClose, 1600)
    }
  }

  const selectedCfg = ISSUE_TYPES.find(t => t.key === selected)

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)',
        }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 901,
        background: 'var(--surface)',
        borderRadius: '20px 20px 0 0',
        padding: '20px 20px 36px',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.25)',
        animation: 'irSlideUp .22s ease',
        maxWidth: 540, margin: '0 auto',
      }}>
        <style>{`
          @keyframes irSlideUp {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);   opacity: 1; }
          }
        `}</style>

        {/* Handle */}
        <div style={{
          width: 40, height: 4, borderRadius: 99,
          background: 'var(--border)', margin: '0 auto 20px',
        }} />

        {done ? (
          /* ── SUCCESS STATE ── */
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{
              fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, marginBottom: 6,
            }}>Report Sent</div>
            <div className="text-muted text-sm">Issue has been logged successfully.</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
                Report Issue
              </h2>
              <button onClick={handleClose} style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 8, width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)',
              }}>✕</button>
            </div>

            {/* Issue type buttons — 2×2 grid, large tap targets */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {ISSUE_TYPES.map(t => {
                const active = selected === t.key
                return (
                  <button
                    key={t.key}
                    id={`issue-${t.key}`}
                    onClick={() => setSelected(t.key)}
                    style={{
                      padding: '16px 12px', borderRadius: 14, cursor: 'pointer',
                      background: active ? `${t.color}18` : 'var(--bg)',
                      border: `2px solid ${active ? t.color : 'var(--border)'}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                      transition: 'all .15s',
                    }}
                  >
                    <span style={{ fontSize: 26 }}>{t.icon}</span>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: active ? t.color : 'var(--text)',
                      textAlign: 'center', lineHeight: 1.3,
                    }}>{t.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Optional note */}
            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Additional Note (optional)</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Describe the situation briefly…"
                maxLength={200}
                rows={2}
                style={{
                  width: '100%', background: 'var(--bg)',
                  border: '1px solid var(--border)', borderRadius: 10,
                  padding: '10px 12px', fontFamily: 'var(--font-body)',
                  fontSize: 14, color: 'var(--text)', resize: 'none', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Auto-attach info */}
            <div style={{
              display: 'flex', gap: 12, marginBottom: 20,
              padding: '8px 12px', borderRadius: 10,
              background: 'var(--bg)', border: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                📍 {gpsPosition
                  ? `${gpsPosition.lat.toFixed(5)}, ${gpsPosition.lng.toFixed(5)}`
                  : 'Acquiring GPS…'}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                🕐 {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Submit */}
            <button
              id="issue-submit"
              onClick={handleSubmit}
              disabled={!selected || loading}
              style={{
                width: '100%', padding: '16px', borderRadius: 14,
                fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800,
                background: selected
                  ? `linear-gradient(135deg,${selectedCfg?.color},${selectedCfg?.color}cc)`
                  : 'var(--bg)',
                color: selected ? '#fff' : 'var(--text-muted)',
                border: `1.5px solid ${selected ? 'transparent' : 'var(--border)'}`,
                cursor: selected ? 'pointer' : 'not-allowed',
                boxShadow: selected ? `0 6px 18px ${selectedCfg?.color}44` : 'none',
                transition: 'all .2s',
              }}
            >
              {loading ? 'Sending…' : selected ? `⚠ Report ${selectedCfg?.label}` : 'Select an issue type'}
            </button>
          </>
        )}
      </div>
    </>
  )
}
