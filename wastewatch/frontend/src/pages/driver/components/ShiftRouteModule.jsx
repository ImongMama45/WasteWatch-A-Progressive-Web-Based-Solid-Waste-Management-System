/**
 * ShiftRouteModule.jsx
 * ---------------------
 * Third stage of the Driver Shift Workflow (after CheckInModule).
 * Shows the driver their assigned route + map preview before they
 * officially start driving.
 *
 * Matches reference design:
 *  - Driver greeting + assignment info
 *  - Barangay name large/centred
 *  - Map preview with "View Full" button
 *  - "START ROUTE" CTA → setRouteState("ready")
 *
 * Props:
 *  - setRouteState: fn
 */

import { useAuth } from '../../../context/AuthContext'
import Navbar from '../../../components/Navbar'

const MOCK_ASSIGNMENT = {
  route: 'Purok 2 Route #3',
  truck: '#023AD',
  plateNo: '0123-ABCD',
  barangay: 'BARANGAY ISABANG',
}

export default function ShiftRouteModule({ setRouteState }) {
  const { user } = useAuth()
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  // Pull from sessionStorage if CheckInModule stored real API data
  const route = sessionStorage.getItem('ww_route_name') || MOCK_ASSIGNMENT.route
  const truck = sessionStorage.getItem('ww_truck') || MOCK_ASSIGNMENT.truck
  const plateNo = sessionStorage.getItem('ww_plate') || MOCK_ASSIGNMENT.plateNo
  const barangay = sessionStorage.getItem('ww_barangay') || MOCK_ASSIGNMENT.barangay

  return (
    <>
      <Navbar />
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f8fafc',
        fontFamily: 'var(--font-body)',
      }}>

        {/* ── TOP CONTENT ── */}
        <div style={{ flex: 1, padding: '24px 20px 0' }}>

          {/* Back arrow (decorative — going back re-enters checkin) */}
          <button
            onClick={() => setRouteState('checkin')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              color: '#0f172a', fontWeight: 600, fontSize: 14,
              padding: 0, marginBottom: 20,
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
            fontSize: 22, fontWeight: 900,
            color: '#0f172a', margin: '0 0 4px',
            textAlign: 'center',
          }}>
            Hello Driver, <span>{firstName}</span>
          </h1>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{ fontSize: 12, color: '#2563eb', cursor: 'default' }}>
              ( Not you? )
            </span>
          </div>

          {/* Assignment info */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ margin: '0 0 4px', fontSize: 14, color: '#0f172a' }}>
              <strong>Assigned Route</strong> : {route}
            </p>
            <p style={{ margin: '0 0 4px', fontSize: 14, color: '#0f172a' }}>
              <strong>Truck</strong> : {truck}
            </p>
            <p style={{ margin: 0, fontSize: 14, color: '#0f172a' }}>
              <strong>PlateNo.</strong> : {plateNo}
            </p>
          </div>

          {/* Barangay name — large centred */}
          <h2 style={{
            fontFamily: 'var(--font-head)',
            fontSize: 28, fontWeight: 900,
            textAlign: 'center', color: '#0f172a',
            letterSpacing: '.02em',
            marginBottom: 20,
          }}>
            {barangay}
          </h2>

          {/* Map preview */}
          <div style={{
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid #e2e8f0',
            height: 240,
            background: '#2a3441',   // dark map-like bg
            position: 'relative',
            marginBottom: 32,
          }}>
            {/* Street grid overlay simulation */}
            <div style={{
              position: 'absolute', inset: 0,
              backgroundImage: `
              linear-gradient(rgba(255,255,255,0.04) 1px, transparent 0),
              linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 0)
            `,
              backgroundSize: '32px 32px',
            }} />

            {/* Simulated road highlight */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              viewBox="0 0 320 240" preserveAspectRatio="none">
              <polyline
                points="20,120 80,120 120,80 200,80 240,140 300,140"
                fill="none"
                stroke="#22d3ee"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.85"
              />
              {/* Route arrow dot */}
              <circle cx="240" cy="140" r="8" fill="#22d3ee" opacity="0.9" />
            </svg>

            {/* "View Full" button overlay */}
            <button
              style={{
                position: 'absolute', top: 10, right: 10,
                background: 'rgba(255,255,255,0.92)',
                border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: 20, padding: '5px 12px',
                fontSize: 12, fontWeight: 700, color: '#0f172a',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                backdropFilter: 'blur(4px)',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
              View Full
            </button>
          </div>

          {/* START ROUTE CTA */}
          <button
            id="start-route-btn"
            onClick={() => {
              sessionStorage.setItem('ww_route_state', 'navigating')
              setRouteState('navigating')
            }}
            style={{
              width: '100%',
              padding: '18px',
              borderRadius: 30,
              background: '#0f172a',
              color: '#ffffff',
              border: 'none',
              fontFamily: 'var(--font-head)',
              fontSize: 16,
              fontWeight: 900,
              letterSpacing: '.1em',
              cursor: 'pointer',
              boxShadow: '0 6px 22px rgba(15,23,42,0.30)',
              transition: 'transform .1s ease, box-shadow .1s ease',
            }}
            onMouseDown={e => {
              e.currentTarget.style.transform = 'scale(0.97)'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(15,23,42,0.15)'
            }}
            onMouseUp={e => {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.boxShadow = '0 6px 22px rgba(15,23,42,0.30)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.boxShadow = '0 6px 22px rgba(15,23,42,0.30)'
            }}
          >
            START ROUTE
          </button>
        </div>

        {/* ── BOTTOM BANNER ── */}
        <div style={{
          background: '#0f172a',
          padding: '20px 24px',
          marginTop: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 60,
        }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, letterSpacing: '.06em' }}>
            Track · Monitor · Report
          </span>
        </div>

      </div>
    </>
  )

}
