/**
 * AssignmentModule.jsx
 * ---------------------
 * First stage of the Driver Shift Workflow.
 * Driver selects their duty type before starting.
 *
 * Props:
 *  - setRouteState: fn — advances workflow to 'checkin'
 *  - onBack: fn — goes back to dashboard
 */

import { useNavigate } from 'react-router-dom'
import Navbar from '../../../components/Navbar'

const DUTY_TYPES = [
  {
    key: 'normal',
    title: 'NORMAL DUTY',
    description: 'Follow routes designated location, undisturbed',
    buttonLabel: 'NORMAL',
  },
]

export default function AssignmentModule({ setRouteState }) {
  const navigate = useNavigate()

  function handleSelect(dutyKey) {
    // Store duty type for the rest of the workflow
    sessionStorage.setItem('ww_duty_type', dutyKey)
    setRouteState('checkin')
  }

  return (
    <>
      <Navbar />
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f8fafc',
        fontFamily: 'var(--font-body)',
        overflowX: 'hidden',
      }}>

        {/* ── TOP SECTION ── */}
        <div style={{ flex: 1, padding: '20px 20px 0' }}>

          {/* Back */}
          <button
            onClick={() => navigate('/dashboard')}
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

          {/* Title */}
          <h1 style={{
            fontFamily: 'var(--font-head)',
            fontSize: 24,
            fontWeight: 900,
            textAlign: 'center',
            color: '#0f172a',
            letterSpacing: '.02em',
            marginBottom: 28,
          }}>
            ARE YOU READY TO RIDE?
          </h1>

          {/* Duty Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {DUTY_TYPES.map(duty => (
              <div
                key={duty.key}
                style={{
                  background: '#e2e8f0',
                  borderRadius: 16,
                  padding: '24px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {/* Duty title */}
                <div style={{
                  fontFamily: 'var(--font-head)',
                  fontSize: 15,
                  fontWeight: 900,
                  color: '#0f172a',
                  letterSpacing: '.04em',
                }}>
                  {duty.title}
                </div>

                {/* Description */}
                <p style={{
                  fontSize: 14,
                  color: '#475569',
                  margin: 0,
                  lineHeight: 1.5,
                  paddingLeft: 4,
                }}>
                  {duty.description}
                </p>

                {/* Spacer */}
                <div style={{ flex: 1, minHeight: 40 }} />

                {/* Button */}
                <button
                  id={`duty-${duty.key}-btn`}
                  onClick={() => handleSelect(duty.key)}
                  style={{
                    width: '100%',
                    padding: '16px',
                    borderRadius: 30,
                    background: '#0f172a',
                    color: '#ffffff',
                    border: 'none',
                    fontFamily: 'var(--font-head)',
                    fontSize: 15,
                    fontWeight: 800,
                    letterSpacing: '.08em',
                    cursor: 'pointer',
                    transition: 'transform .1s ease, box-shadow .1s ease',
                    boxShadow: '0 4px 14px rgba(15,23,42,0.25)',
                  }}
                  onMouseDown={e => {
                    e.currentTarget.style.transform = 'scale(0.97)'
                    e.currentTarget.style.boxShadow = '0 2px 6px rgba(15,23,42,0.15)'
                  }}
                  onMouseUp={e => {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,23,42,0.25)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(15,23,42,0.25)'
                  }}
                >
                  {duty.buttonLabel}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── BOTTOM BANNER ── */}
        <div style={{
          background: '#0f172a',
          marginTop: 32,
          padding: '32px 24px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 16,
          minHeight: 180,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Text */}
          <div style={{ flex: 1, zIndex: 1 }}>
            <p style={{
              fontFamily: 'var(--font-head)',
              fontSize: 18,
              fontWeight: 900,
              color: '#ffffff',
              lineHeight: 1.3,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              " One app for monitoring all waste management related stuff "
            </p>
            <p style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: '.06em',
              fontWeight: 600,
            }}>
              Track · Monitor · Report
            </p>
          </div>

          {/* Truck illustration */}
          <div style={{
            position: 'absolute',
            right: -10,
            bottom: 0,
            fontSize: 100,
            lineHeight: 1,
            opacity: 0.9,
            filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))',
            userSelect: 'none',
          }}>
            🚛
          </div>
        </div>

      </div>
    </>
  )
}
