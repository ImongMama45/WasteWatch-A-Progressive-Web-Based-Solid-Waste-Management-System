/**
 * EndShiftModule.jsx
 * -------------------
 * Rendered when routeState === "end_shift".
 *
 * TWO MODES (detected via sessionStorage):
 *
 * 1. EARLY TERMINATION  (ww_route_complete !== 'true')
 *    — Form: driver explains why they ended early
 *    — Notifies admin via API
 *    — Submit → clears session → dashboard
 *
 * 2. ROUTE COMPLETED    (ww_route_complete === 'true')
 *    — Celebration screen: fireworks + shift summary
 *    — "My Truck is still not full" → extended collection mode
 *    — "Done" → clears session → dashboard
 *
 * Props:
 *  - setRouteState: fn (used for extended mode only)
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import useShiftTimer from '../../../hooks/useShiftTimer'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'

// ─── EARLY TERMINATION REASONS ────────────────────────────────────────────────

const EARLY_REASONS = [
  'Truck breakdown / mechanical issue',
  'Medical emergency',
  'Road is blocked / inaccessible',
  'Insufficient fuel',
  'Weather conditions',
  'End of scheduled shift hours',
  'Other',
]

// ─── FIREWORKS COMPONENT ──────────────────────────────────────────────────────

function Fireworks() {
  const particles = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * 360
    const dist = 80 + Math.random() * 60
    const x = Math.cos((angle * Math.PI) / 180) * dist
    const y = Math.sin((angle * Math.PI) / 180) * dist
    const colors = ['#2ecc71', '#3b82f6', '#f59e0b', '#ec4899', '#22d3ee', '#a78bfa', '#fff']
    const color = colors[i % colors.length]
    const delay = Math.random() * 0.4
    const size = 6 + Math.random() * 8
    return { x, y, color, delay, size, angle }
  })

  return (
    <div style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}>
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            width: p.size, height: p.size,
            borderRadius: i % 3 === 0 ? '50%' : '2px',
            background: p.color,
            animation: `fwBurst 1.2s cubic-bezier(.22,.61,.36,1) ${p.delay}s both`,
            '--tx': `${p.x}px`,
            '--ty': `${p.y}px`,
          }}
        />
      ))}
      {/* Central checkmark */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fwCheck .5s cubic-bezier(.36,.07,.19,.97) .2s both',
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: '#1e2a3a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(15,23,42,0.3)',
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            width="36" height="36">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
    </div>
  )
}

// ─── SUMMARY CARD ─────────────────────────────────────────────────────────────

function SummaryRow({ icon, label, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid #f1f5f9',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>{label}</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{value}</span>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function EndShiftModule({ setRouteState }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { formattedTime, endShift } = useShiftTimer()

  const isRouteComplete = sessionStorage.getItem('ww_route_complete') === 'true'
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  // ── EARLY TERMINATION state ───────────────────────────────────────────────
  const [reason, setReason] = useState('')
  const [customNote, setCustomNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Stop GPS + finalize session on mount
  useEffect(() => {
    sessionStorage.removeItem('ww_route_state')
  }, [])

  async function handleEarlySubmit() {
    if (!reason) return
    setSubmitting(true)
    const result = endShift()
    try {
      await api.post('/api/driver/shift/end/', {
        ended_early: true,
        reason: reason,
        notes: customNote.trim() || null,
        started_at: result.startTime?.toISOString(),
        ended_at: result.endTime?.toISOString(),
        duration_ms: result.durationMs,
      })
    } catch { }
    setSubmitting(false)
    setSubmitted(true)
  }

  async function handleDone() {
    const result = endShift()
    try {
      await api.post('/api/driver/shift/end/', {
        ended_early: false,
        started_at: result.startTime?.toISOString(),
        ended_at: result.endTime?.toISOString(),
        duration_ms: result.durationMs,
      })
    } catch { }
    sessionStorage.clear()  // clean full session on shift complete
    navigate('/dashboard', { replace: true })
  }

  function handleExtendedMode() {
    sessionStorage.setItem('ww_extended_mode', 'true')
    sessionStorage.setItem('ww_route_state', 'navigating')
    setRouteState('navigating')
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODE 1: EARLY TERMINATION
  // ─────────────────────────────────────────────────────────────────────────────

  if (!isRouteComplete) {
    // Post-submit confirmation screen
    if (submitted) {
      return (
        <>
          <Navbar />
          <div style={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: '#f8fafc', padding: '0 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>📋</div>
            <h2 style={{
              fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900,
              color: '#0f172a', marginBottom: 8,
            }}>Report Submitted</h2>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
              Your early shift end has been reported to the admin.<br />
              Stay safe, {firstName}.
            </p>
            <button
              onClick={() => { sessionStorage.clear(); navigate('/dashboard', { replace: true }) }}
              style={{
                width: '100%', maxWidth: 320, padding: '16px', borderRadius: 30,
                background: '#0f172a', color: '#fff', border: 'none',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800,
                cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        </>
      )
    }

    return (
      <>
        <Navbar />
        <style>{`
          @keyframes esSlideUp {
            from { opacity:0; transform:translateY(12px); }
            to   { opacity:1; transform:translateY(0); }
          }
        `}</style>

        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          background: '#f8fafc', fontFamily: 'var(--font-body)',
        }}>

          {/* Header */}
          <div style={{
            background: '#0f172a', padding: '28px 20px 24px', color: '#fff',
          }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
            <h1 style={{
              fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900,
              margin: '0 0 6px', letterSpacing: '.02em',
            }}>
              Ending Shift Early
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: 0 }}>
              Please let us know why you're stopping before completing your route.
              This will notify the admin and be stored in your shift log.
            </p>
          </div>

          <div style={{ flex: 1, padding: '24px 20px', animation: 'esSlideUp .25s ease both' }}>

            {/* Shift time so far */}
            <div style={{
              background: '#fff', borderRadius: 14, padding: '14px 16px',
              border: '1px solid #e2e8f0', marginBottom: 20,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Shift duration so far</span>
              <span style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                {formattedTime}
              </span>
            </div>

            {/* Reason selector */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: '#94a3b8',
                letterSpacing: '.06em', marginBottom: 10,
              }}>
                REASON FOR EARLY END *
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {EARLY_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    style={{
                      padding: '13px 16px', borderRadius: 12, textAlign: 'left',
                      border: `1.5px solid ${reason === r ? '#0f172a' : '#e2e8f0'}`,
                      background: reason === r ? '#0f172a' : '#fff',
                      color: reason === r ? '#fff' : '#475569',
                      fontWeight: 600, fontSize: 14, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10,
                      transition: 'all .15s',
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${reason === r ? '#fff' : '#cbd5e1'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {reason === r && (
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', display: 'block' }} />
                      )}
                    </span>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Additional notes */}
            <div style={{ marginBottom: 28 }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: '#94a3b8',
                letterSpacing: '.06em', marginBottom: 8,
              }}>
                ADDITIONAL NOTES <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
              </div>
              <textarea
                rows={3}
                maxLength={300}
                placeholder="e.g. Engine warning light appeared at Purok 3…"
                value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '12px 14px', borderRadius: 12,
                  border: '1.5px solid #e2e8f0', background: '#fff',
                  fontSize: 14, color: '#0f172a', resize: 'none',
                  fontFamily: 'var(--font-body)', outline: 'none',
                }}
              />
            </div>

            {/* Submit CTA */}
            <button
              id="early-end-submit-btn"
              onClick={handleEarlySubmit}
              disabled={!reason || submitting}
              style={{
                width: '100%', padding: '17px', borderRadius: 30,
                background: reason && !submitting ? '#ef4444' : '#e2e8f0',
                color: reason && !submitting ? '#fff' : '#94a3b8',
                border: 'none', fontFamily: 'var(--font-head)',
                fontSize: 15, fontWeight: 900, letterSpacing: '.04em',
                cursor: reason && !submitting ? 'pointer' : 'not-allowed',
                boxShadow: reason ? '0 6px 18px rgba(239,68,68,0.28)' : 'none',
                transition: 'all .2s',
              }}
            >
              {submitting ? 'Submitting report…' : '⏹ Submit & End Shift'}
            </button>

            {!reason && (
              <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 10 }}>
                Please select a reason above
              </p>
            )}
          </div>

        </div>
      </>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MODE 2: ROUTE COMPLETED — celebration screen
  // ─────────────────────────────────────────────────────────────────────────────

  const completedStops = parseInt(sessionStorage.getItem('ww_completed_stops') || '10', 10)
  const totalStops = parseInt(sessionStorage.getItem('ww_total_stops') || '10', 10)

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes fwBurst {
          0%   { transform: translate(-50%,-50%) scale(1); opacity:1; }
          100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0); opacity:0; }
        }
        @keyframes fwCheck {
          0%  { transform: scale(0); opacity:0; }
          60% { transform: scale(1.12); }
          80% { transform: scale(0.96); }
          100%{ transform: scale(1); opacity:1; }
        }
        @keyframes esFadeUp {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .es-fade1 { animation: esFadeUp .3s ease .1s both; }
        .es-fade2 { animation: esFadeUp .3s ease .4s both; }
        .es-fade3 { animation: esFadeUp .3s ease .6s both; }
      `}</style>

      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        background: '#f8fafc', fontFamily: 'var(--font-body)',
      }}>

        {/* Top greeting */}
        <div style={{ padding: '32px 20px 0', textAlign: 'center' }}>
          <h1 className="es-fade1" style={{
            fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 900,
            color: '#0f172a', marginBottom: 6,
          }}>
            Route Complete, {firstName}! 🎉
          </h1>
          <p className="es-fade1" style={{ color: '#64748b', fontSize: 14, marginBottom: 0 }}>
            You've completed all {totalStops} stops on your route today.
          </p>
        </div>

        {/* Fireworks hero */}
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <Fireworks />
        </div>

        {/* Shift summary */}
        <div className="es-fade2" style={{ padding: '0 20px', marginBottom: 24 }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '4px 16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}>
            <SummaryRow icon="⏱" label="Shift Duration" value={formattedTime} />
            <SummaryRow icon="📍" label="Stops Completed" value={`${completedStops} / ${totalStops}`} />
            <SummaryRow icon="✅" label="Completion" value="100%" />
            <SummaryRow icon="📅" label="Date" value={new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />
          </div>
        </div>

        {/* Action buttons */}
        <div className="es-fade3" style={{ padding: '0 20px 32px', marginTop: 'auto' }}>

          {/* Done */}
          <button
            id="end-shift-done-btn"
            onClick={handleDone}
            style={{
              width: '100%', padding: '17px', borderRadius: 14,
              background: '#0f172a', color: '#fff', border: 'none',
              fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
              cursor: 'pointer', marginBottom: 10,
              boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
              letterSpacing: '.04em',
            }}
          >
            Done
          </button>

          {/* Extended collection mode */}
          <p style={{
            textAlign: 'center', fontSize: 12, color: '#94a3b8', margin: '0 0 8px',
          }}>
            Accept Unclaimed dump site
          </p>
          <button
            id="extended-mode-btn"
            onClick={handleExtendedMode}
            style={{
              width: '100%', padding: '17px', borderRadius: 14,
              background: '#0f172a', color: '#fff', border: 'none',
              fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
              letterSpacing: '.04em',
            }}
          >
            My Truck is still not full
          </button>
        </div>

        {/* Bottom strip */}
        <div style={{
          background: '#0f172a', padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, letterSpacing: '.06em' }}>
            Track · Monitor · Report
          </span>
        </div>

      </div>
    </>
  )
}
