/**
 * NavigationModule.jsx
 * ---------------------
 * Module 4 — Core driver UI during active route execution.
 * Matches reference image: Grab/delivery driver-style operational screen.
 *
 * Sections:
 *  ① Stop info header (dark card — dump site + route info)
 *  ② Map area (placeholder) with turn-by-turn direction overlay
 *  ③ Stats bar — arrival, ETA mins, distance, total km
 *  ④ Action — "On the way…" status + "Arrived" CTA
 *
 * Props:
 *  - setRouteState: fn → call setRouteState("arrived") on arrival
 */

import { useState, useEffect } from 'react'
import useShiftTimer from '../../../hooks/useShiftTimer'
import useGpsTracking from '../../../hooks/useGpsTracking'
import BottomNav from '../../../components/BottomNav'
import Navbar from '../../../components/Navbar'

// ─── MOCK ROUTE DATA ──────────────────────────────────────────────────────────

const MOCK_STOP = {
  current: 1,
  total: 10,
  route: 'Purok 2  Route#3',
  siteName: 'Dump Site Collection',
  barangay: 'BARANGAY ISABANG',
  address: 'Barangay Isabang, Purok 2',
  landmark: 'Ilang Ilang Marinduque',
  etaMinutes: 10,
  arrivalTime: '1:40',
  distanceKm: 700,
  totalKmTravelled: 700,
}

const MOCK_DIRECTION = { instruction: 'Turn left', distanceM: 105 }

// ─── GPS STATUS PILL ─────────────────────────────────────────────────────────

function GpsStatusPill({ isTracking, error }) {
  const label = error ? 'GPS Lost' : isTracking ? 'GPS Active' : 'GPS…'
  const color = error ? '#ef4444' : isTracking ? '#2ecc71' : '#f59e0b'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: `${color}18`, border: `1px solid ${color}44`,
      borderRadius: 20, padding: '3px 10px',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        animation: isTracking && !error ? 'navPulse 2s ease infinite' : 'none',
        display: 'inline-block',
      }} />
      <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '.04em' }}>
        {label}
      </span>
    </div>
  )
}

// ─── CONNECTIVITY PILL ────────────────────────────────────────────────────────

function ConnPill() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: online ? 'rgba(46,204,113,0.1)' : 'rgba(239,68,68,0.1)',
      border: `1px solid ${online ? '#2ecc7144' : '#ef444444'}`,
      borderRadius: 20, padding: '3px 10px',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: online ? '#2ecc71' : '#ef4444', letterSpacing: '.04em' }}>
        {online ? '● Online' : '○ Offline'}
      </span>
    </div>
  )
}

// ─── STAT CELL ────────────────────────────────────────────────────────────────

function StatCell({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>
        {label}
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

// ─── GPS GEOFENCE UTILS ───────────────────────────────────────────────────────
// TODO: Replace DEST_LAT / DEST_LNG with real stop coordinates from API

const DEST_LAT = 13.9488   // mock: Barangay Isabang Dump Site
const DEST_LNG = 121.6138
const ARRIVAL_RADIUS_M = 100   // meters — tighten once real coords are in

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function NavigationModule({ setRouteState }) {
  const stop = MOCK_STOP
  const dir = MOCK_DIRECTION

  const { formattedTime } = useShiftTimer()
  const { position: gpsPos, isTracking, error: gpsError } = useGpsTracking({ enabled: true, intervalMs: 5000 })

  // ── GPS Geofence: unlock Arrived when within ARRIVAL_RADIUS_M ────────────
  // TODO: replace DEST_LAT/DEST_LNG with stop.lat / stop.lng from API response
  const distanceToStop = gpsPos
    ? haversineDistance(gpsPos.lat, gpsPos.lng, DEST_LAT, DEST_LNG)
    : null
  const isNearDestination = distanceToStop !== null && distanceToStop <= ARRIVAL_RADIUS_M

  // DEV OVERRIDE — remove before production
  // Uncomment next line to test the arrived state without real GPS:
  // const isNearDestination = true

  const isExtendedMode = sessionStorage.getItem('ww_extended_mode') === 'true'

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes navPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes navFadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f8fafc',
        fontFamily: 'var(--font-body)',
        overflowX: 'hidden',
      }}>

        {/* ── ① STOP INFO HEADER ── */}
        <div style={{
          background: '#1e2a3a',
          padding: '16px 18px 18px',
          color: '#fff',
        }}>
          {/* Status pills row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <GpsStatusPill isTracking={isTracking} error={gpsError} />
            <ConnPill />
            {/* Extended collection mode indicator */}
            {isExtendedMode && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'rgba(245,158,11,0.15)',
                border: '1px solid rgba(245,158,11,0.5)',
                borderRadius: 20, padding: '3px 10px',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#f59e0b',
                  animation: 'navPulse 1.5s ease infinite', display: 'inline-block',
                }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '.04em' }}>
                  COLLECTING UNCLAIMED
                </span>
              </div>
            )}
            <div style={{
              marginLeft: 'auto',
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 20, padding: '3px 10px',
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '.04em' }}>
                ⏱ {formattedTime}
              </span>
            </div>
          </div>

          {/* Site name + stop counter */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: 20, marginTop: 2 }}>📍</span>
            <div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, marginBottom: 2 }}>
                {stop.siteName}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                {stop.current} out of {stop.total} Route : {stop.route}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '12px 0' }} />

          {/* Location details */}
          <div>
            <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: '.04em', marginBottom: 3 }}>
              {stop.barangay}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 2 }}>{stop.address}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{stop.landmark}</div>
          </div>
        </div>

        {/* ── ② MAP AREA ── */}
        <div style={{ position: 'relative', height: 260, background: '#2a3441', flexShrink: 0 }}>
          {/* Grid road texture */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.04) 1px, transparent 0),
              linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 0)
            `,
            backgroundSize: '28px 28px',
          }} />

          {/* Simulated route path */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            viewBox="0 0 400 260" preserveAspectRatio="none">
            <polyline
              points="20,200 80,200 120,140 220,140 260,100 360,100 400,60"
              fill="none" stroke="#22d3ee" strokeWidth="6"
              strokeLinecap="round" strokeLinejoin="round" opacity="0.8"
            />
            {/* Driver position dot */}
            <circle cx="120" cy="140" r="10" fill="#fff" stroke="#22d3ee" strokeWidth="3" />
            <circle cx="120" cy="140" r="4" fill="#22d3ee" />
          </svg>

          {/* Turn direction card */}
          <div style={{
            position: 'absolute', top: 14, left: 14, right: 14,
            background: 'rgba(255,255,255,0.96)',
            borderRadius: 14,
            padding: '14px 18px',
            display: 'flex', alignItems: 'center', gap: 16,
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
            backdropFilter: 'blur(6px)',
          }}>
            {/* Turn arrow */}
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: '#f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#0f172a" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 900, color: '#0f172a' }}>
                {dir.instruction}
              </div>
              <div style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>
                {dir.distanceM}m
              </div>
            </div>
          </div>

          {/* Location re-center button */}
          <button style={{
            position: 'absolute', bottom: 14, left: 14,
            width: 40, height: 40, borderRadius: '50%',
            background: '#1d4ed8', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 2px 10px rgba(29,78,216,0.4)',
          }}>
            <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
            </svg>
          </button>

          {/* View Full button */}
          <button style={{
            position: 'absolute', bottom: 14, right: 14,
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 20, padding: '6px 14px',
            fontSize: 12, fontWeight: 700, color: '#0f172a',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            backdropFilter: 'blur(4px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
            View Full
          </button>
        </div>

        {/* ── ③ STATS BAR ── */}
        <div style={{
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          padding: '14px 12px',
          display: 'flex',
          alignItems: 'center',
        }}>
          <StatCell value={stop.arrivalTime} label="arrival" />
          <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
          <StatCell value={stop.etaMinutes} label="min" />
          <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
          <StatCell value={stop.distanceKm} label="km" />
          <div style={{ width: 1, height: 32, background: '#e2e8f0' }} />
          <StatCell value={stop.totalKmTravelled} label="total km travelled" />
        </div>

        {/* ── ④ ACTION AREA ── */}
        <div style={{
          flex: 1, padding: '20px 20px 28px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>

          {/* Status text — changes when GPS confirms arrival */}
          <p style={{
            fontFamily: 'var(--font-head)',
            fontSize: 18, fontWeight: 800,
            color: isNearDestination ? '#0f172a' : '#64748b',
            textAlign: 'center',
            marginBottom: 10,
            transition: 'color .3s',
          }}>
            {isNearDestination ? 'You have arrived' : 'On the way to the dump site'}
          </p>

          {/* Distance hint when not yet at destination */}
          {!isNearDestination && distanceToStop !== null && (
            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              {distanceToStop > 1000
                ? `${(distanceToStop / 1000).toFixed(1)} km to destination`
                : `${Math.round(distanceToStop)} m to destination`
              }
            </p>
          )}
          {!isNearDestination && distanceToStop === null && (
            <p style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>
              📡 Waiting for GPS signal…
            </p>
          )}

          {/* Arrived button — locked until GPS confirms proximity */}
          <button
            id="arrived-btn"
            disabled={!isNearDestination}
            onClick={() => {
              sessionStorage.setItem('ww_route_state', 'arrived')
              setRouteState('arrived')
            }}
            style={{
              width: '100%',
              maxWidth: 320,
              padding: '18px',
              borderRadius: 30,
              border: 'none',
              fontFamily: 'var(--font-head)',
              fontSize: 16,
              fontWeight: 900,
              letterSpacing: '.06em',
              transition: 'all .35s ease',
              cursor: isNearDestination ? 'pointer' : 'not-allowed',
              // Locked = gray; Unlocked by GPS = dark navy (matches reference)
              background: isNearDestination ? '#0f172a' : '#e2e8f0',
              color: isNearDestination ? '#ffffff' : '#94a3b8',
              boxShadow: isNearDestination
                ? '0 6px 20px rgba(15,23,42,0.3)'
                : 'none',
            }}
          >
            {isNearDestination ? 'Done' : 'Confirm on Arrival'}
          </button>

          {/* GPS unlock hint */}
          {!isNearDestination && (
            <p style={{ fontSize: 11, color: '#cbd5e1', marginTop: 10, textAlign: 'center' }}>
              Button unlocks automatically when GPS confirms your location
            </p>
          )}
        </div>
      </div>
      <BottomNav />
    </>
  )
}
