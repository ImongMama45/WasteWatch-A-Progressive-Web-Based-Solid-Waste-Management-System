/**
 * StopCompletedModule.jsx
 * ------------------------
 * Rendered when routeState === "completed".
 * Decision screen after a stop is confirmed.
 *
 * Driver chooses:
 *  - "Next Stop"           → setRouteState("navigating")
 *  - "I'm done for the day!" → setRouteState("end_shift")
 *
 * Props:
 *  - setRouteState: fn
 */

import { useState, useEffect } from 'react'
import { useAuth } from '../../../context/AuthContext'
import Navbar from '../../../components/Navbar'

// ─── MOCK ROUTE PROGRESS ──────────────────────────────────────────────────────
// TODO: Replace with real data from route context / API

const MOCK_STOPS = [
  { id: 1, name: 'Brgy. Hall, Zone A', status: 'completed', time: '6:42 AM' },
  { id: 2, name: 'Public Market, Purok 2', status: 'completed', time: '7:05 AM' },
  { id: 3, name: 'Covered Court, Zone B', status: 'completed', time: '7:28 AM' },
  { id: 4, name: 'Dump Site Collection', status: 'completed', time: '7:51 AM' },
  { id: 5, name: 'Isabang Elem. School', status: 'completed', time: null },
  { id: 6, name: 'St. Ferdinand Park', status: 'completed', time: null },
  { id: 7, name: 'Lucena Memorial Park', status: 'completed', time: null },
  { id: 8, name: 'Brgy. Isabang Hall', status: 'completed', time: null },
  { id: 9, name: 'Ilang Ilang St. Corner', status: 'completed', time: null },
  { id: 10, 'name': 'Final Disposal Point', status: 'pending', time: null },
]

export default function StopCompletedModule({ setRouteState }) {
  const { user } = useAuth()
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  const [showRouteList, setShowRouteList] = useState(false)

  // TODO: pull from route context / API
  const stops = MOCK_STOPS
  const completed = stops.filter(s => s.status === 'completed').length
  const total = stops.length
  const progress = Math.round((completed / total) * 100)

  // Mark route complete in session so EndShiftModule knows which mode to show
  useEffect(() => {
    if (progress === 100) {
      sessionStorage.setItem('ww_route_complete', 'true')
      sessionStorage.setItem('ww_completed_stops', String(completed))
      sessionStorage.setItem('ww_total_stops', String(total))
    } else {
      sessionStorage.setItem('ww_route_complete', 'false')
    }
  }, [progress])

  const isRouteComplete = progress === 100

  function handleNextStop() {
    sessionStorage.setItem('ww_route_state', 'navigating')
    setRouteState('navigating')
  }

  function handleEndShift() {
    sessionStorage.setItem('ww_route_state', 'end_shift')
    setRouteState('end_shift')
  }

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes scmBounce {
          0%   { transform: scale(0.7); opacity:0; }
          60%  { transform: scale(1.08); }
          80%  { transform: scale(0.97); }
          100% { transform: scale(1); opacity:1; }
        }
        @keyframes scmFadeUp {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .scm-check  { animation: scmBounce .5s cubic-bezier(.36,.07,.19,.97) both; }
        .scm-fade   { animation: scmFadeUp .3s ease .2s both; }
        .scm-fade2  { animation: scmFadeUp .3s ease .35s both; }
      `}</style>

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f8fafc',
        fontFamily: 'var(--font-body)',
      }}>

        {/* ── HEADER ── */}
        <div style={{ padding: '20px 20px 0' }}>
          <button
            onClick={() => setRouteState('arrived')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              color: '#0f172a', fontWeight: 600, fontSize: 14,
              padding: 0, marginBottom: 24,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>

          {/* Greeting */}
          <h1 style={{
            fontFamily: 'var(--font-head)',
            fontSize: 26, fontWeight: 900,
            color: '#0f172a', margin: '0 0 20px',
            textAlign: 'center',
          }}>
            Well done, {firstName}!
          </h1>

          {/* Progress row */}
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 10,
          }}>
            {/* Left: label + bar */}
            <div style={{ flex: 1, marginRight: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {/* Green dot */}
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: '#2ecc71',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#0d1117" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: '#0f172a' }}>
                  PROGRESS INDICATOR
                </span>
              </div>

              {/* Bar + pct */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  flex: 1, height: 7, background: '#e2e8f0',
                  borderRadius: 99, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    background: 'linear-gradient(90deg,#2ecc71,#16a34a)',
                    width: `${progress}%`,
                    transition: 'width .6s ease',
                  }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#2ecc71', flexShrink: 0 }}>
                  {progress}%
                </span>
              </div>
            </div>

            {/* Right: verified locations */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                justifyContent: 'flex-end', marginBottom: 2,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2ecc71', display: 'inline-block' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#2ecc71' }}>Verified Location</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
                {completed}/{total} Locations
              </span>
            </div>
          </div>

          {/* Route list toggle */}
          <button
            onClick={() => setShowRouteList(p => !p)}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 10,
              background: '#f1f5f9', border: '1px solid #e2e8f0',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              cursor: 'pointer', marginBottom: showRouteList ? 0 : 0,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
              View stop details ({completed} completed · {total - completed} remaining)
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="14" height="14"
              style={{ transform: showRouteList ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Stop list dropdown */}
          {showRouteList && (
            <div style={{
              background: '#fff', border: '1px solid #e2e8f0',
              borderTop: 'none', borderRadius: '0 0 10px 10px',
              maxHeight: 220, overflowY: 'auto', marginBottom: 4,
            }}>
              {stops.map((stop, i) => (
                <div key={stop.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px',
                  borderBottom: i < stops.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}>
                  {/* Status icon */}
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: stop.status === 'completed' ? '#2ecc71' : '#e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 900,
                    color: stop.status === 'completed' ? '#0d1117' : '#94a3b8',
                  }}>
                    {stop.status === 'completed' ? '✓' : i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: stop.status === 'completed' ? '#0f172a' : '#94a3b8',
                    }}>
                      {stop.name}
                    </div>
                    {stop.time && (
                      <div style={{ fontSize: 10, color: '#2ecc71', fontWeight: 600 }}>⏱ {stop.time}</div>
                    )}
                  </div>
                  <div style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: '.05em', padding: '2px 8px',
                    borderRadius: 20, flexShrink: 0,
                    background: stop.status === 'completed' ? 'rgba(46,204,113,0.1)' : 'rgba(148,163,184,0.1)',
                    color: stop.status === 'completed' ? '#2ecc71' : '#94a3b8',
                  }}>
                    {stop.status === 'completed' ? 'DONE' : 'PENDING'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── HERO ── */}
        <div className="scm-fade" style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '24px 20px',
        }}>
          <p style={{
            fontFamily: 'var(--font-head)',
            fontSize: 22, fontWeight: 900,
            color: '#0f172a', marginBottom: 20,
          }}>
            {isRouteComplete ? 'Route Complete' : 'Good Job'}
          </p>

          {/* Large checkmark */}
          <div className="scm-check" style={{
            width: 100, height: 100, borderRadius: '50%',
            background: '#1e2a3a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 28px rgba(15,23,42,0.25)',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              width="48" height="48">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        {/* ── ACTION AREA ── */}
        <div className="scm-fade2" style={{ padding: '0 20px 32px' }}>
          {isRouteComplete ? (
            /* ROUTE COMPLETE: Done + Extended mode */
            <>
              <p style={{
                textAlign: 'center', fontSize: 14, color: '#64748b',
                marginBottom: 14, fontWeight: 500,
              }}>
                Ready for your next stop?
              </p>
              <button
                id="complete-done-btn"
                onClick={handleEndShift}
                style={{
                  width: '100%', padding: '18px', borderRadius: 14,
                  background: '#0f172a', color: '#fff', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
                  cursor: 'pointer', marginBottom: 8,
                  boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
                  letterSpacing: '.04em',
                }}
              >
                Done
              </button>
              <p style={{
                textAlign: 'center', fontSize: 12, color: '#94a3b8', margin: '0 0 8px',
              }}>
                Accept Unclaimed dump site
              </p>
              <button
                id="extended-mode-btn"
                onClick={() => {
                  sessionStorage.setItem('ww_extended_mode', 'true')
                  sessionStorage.setItem('ww_route_state', 'navigating')
                  setRouteState('navigating')
                }}
                style={{
                  width: '100%', padding: '18px', borderRadius: 14,
                  background: '#0f172a', color: '#fff', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
                  cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
                  letterSpacing: '.04em',
                }}
              >
                My Truck is still not full
              </button>
            </>
          ) : (
            /* INCOMPLETE: Next Stop + I'm done for the day */
            <>
              <p style={{
                textAlign: 'center', fontSize: 14, color: '#64748b',
                marginBottom: 14, fontWeight: 500,
              }}>
                Ready for your next stop?
              </p>
              <button
                id="next-stop-btn"
                onClick={handleNextStop}
                style={{
                  width: '100%', padding: '18px', borderRadius: 14,
                  background: '#0f172a', color: '#fff', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
                  cursor: 'pointer', marginBottom: 10,
                  boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
                  letterSpacing: '.04em',
                }}
              >
                Next Stop
              </button>
              <button
                id="end-shift-btn"
                onClick={handleEndShift}
                style={{
                  width: '100%', padding: '18px', borderRadius: 14,
                  background: '#0f172a', color: '#fff', border: 'none',
                  fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
                  cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(15,23,42,0.25)',
                  letterSpacing: '.04em',
                }}
              >
                I'm done for the day!
              </button>
            </>
          )}
        </div>

        {/* ── BOTTOM BANNER ── */}
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
