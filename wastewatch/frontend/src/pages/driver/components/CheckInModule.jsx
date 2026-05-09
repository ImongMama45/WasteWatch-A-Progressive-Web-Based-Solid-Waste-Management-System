/**
 * CheckInModule.jsx
 * ------------------
 * Second stage of the Driver Shift Workflow.
 *
 * On mount:
 *  1. Shows driver assignment info + mini map
 *  2. Automatically requests GPS permission
 *  3. Validates driver session (mock)
 *  4. Logs shift start timestamp
 *  5. Auto-advances → setRouteState("ready")
 *
 * No manual interaction required — this is a system boot screen.
 *
 * Props:
 *  - setRouteState: fn
 */

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../../context/AuthContext'
import useShiftTimer from '../../../hooks/useShiftTimer'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'

// ─── MOCK ASSIGNMENT DATA ─────────────────────────────────────────────────────

const MOCK_ASSIGNMENT = {
  route: 'Isabang–Brgy.12 Route',
  truck: '#023AD',
  plateNo: '0123-ABCD',
  barangay: 'Brgy. Isabang, Lucena City',
}

// ─── INIT STEPS ───────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'session', label: 'Verifying driver session…' },
  { key: 'gps', label: 'Activating GPS…' },
  { key: 'timestamp', label: 'Logging shift start time…' },
  { key: 'ready', label: 'All systems ready!' },
]

export default function CheckInModule({ setRouteState }) {
  const { user } = useAuth()
  const { startShift } = useShiftTimer()

  const [stepIndex, setStepIndex] = useState(0)   // which step is running
  const [completed, setCompleted] = useState([])   // completed step keys
  const [gpsStatus, setGpsStatus] = useState('pending')  // pending|ok|error
  const [assignment, setAssignment] = useState(MOCK_ASSIGNMENT)

  const dutyType = sessionStorage.getItem('ww_duty_type') || 'normal'
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  // ── Run init sequence on mount ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function runInit() {
      // ── Step 0: Verify session ───────────────────────────────────────
      setStepIndex(0)
      try {
        const res = await api.get('/api/driver/profile/').catch(() => ({ data: null }))
        if (res.data) setAssignment(a => ({ ...a, ...res.data }))
      } catch { }
      await delay(900)
      if (cancelled) return
      setCompleted(c => [...c, 'session'])

      // ── Step 1: Request GPS ──────────────────────────────────────────
      setStepIndex(1)
      await new Promise(resolve => {
        if (!navigator.geolocation) {
          setGpsStatus('error')
          resolve()
          return
        }
        navigator.geolocation.getCurrentPosition(
          pos => {
            sessionStorage.setItem('ww_gps_lat', pos.coords.latitude)
            sessionStorage.setItem('ww_gps_lng', pos.coords.longitude)
            setGpsStatus('ok')
            resolve()
          },
          () => { setGpsStatus('error'); resolve() },
          { enableHighAccuracy: true, timeout: 8000 }
        )
      })
      if (cancelled) return
      await delay(500)
      setCompleted(c => [...c, 'gps'])

      // ── Step 2: Log shift start ──────────────────────────────────────
      setStepIndex(2)
      startShift()
      const ts = new Date().toISOString()
      sessionStorage.setItem('ww_shift_started_at', ts)
      try {
        await api.post('/api/driver/shift/start/', {
          duty_type: dutyType,
          started_at: ts,
        })
      } catch { }
      await delay(700)
      if (cancelled) return
      setCompleted(c => [...c, 'timestamp'])

      // ── Step 3: Done ─────────────────────────────────────────────────
      setStepIndex(3)
      await delay(800)
      if (cancelled) return
      setCompleted(c => [...c, 'ready'])

      // ── Auto-advance to route preview ────────────────────────────────
      await delay(600)
      if (!cancelled) setRouteState('shiftroute')
    }

    runInit()
    return () => { cancelled = true }
  }, [])

  const allDone = completed.includes('ready')
  const progress = Math.round((completed.length / STEPS.length) * 100)

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

        {/* ── HEADER ── */}
        <div style={{ padding: '24px 20px 0' }}>

          {/* Back arrow (disabled during init — decorative only) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            color: '#94a3b8', fontSize: 14, fontWeight: 600, marginBottom: 20,
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </div>

          {/* Driver greeting */}
          <h1 style={{
            fontFamily: 'var(--font-head)',
            fontSize: 22, fontWeight: 900,
            color: '#0f172a', margin: '0 0 4px',
            textAlign: 'center',
          }}>
            Hello Driver, <span style={{ fontWeight: 900 }}>{firstName}</span>
          </h1>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{ fontSize: 12, color: '#2563eb', textDecoration: 'underline', cursor: 'default' }}>
              ( Not you? )
            </span>
          </div>

          {/* Assignment info */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ margin: '0 0 4px', fontSize: 14, color: '#0f172a' }}>
              <strong>Assigned Route</strong> : {assignment.route}
            </p>
            <p style={{ margin: '0 0 4px', fontSize: 14, color: '#0f172a' }}>
              <strong>Truck</strong> : {assignment.truck}
            </p>
            <p style={{ margin: 0, fontSize: 14, color: '#0f172a' }}>
              <strong>PlateNo.</strong> : {assignment.plateNo}
            </p>
          </div>

          {/* Mini Map Placeholder */}
          <div style={{
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid #e2e8f0',
            height: 200,
            background: '#e0e7ef',
            position: 'relative',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {/* Grid texture */}
            <div style={{
              position: 'absolute', inset: 0, opacity: 0.3,
              backgroundImage: 'linear-gradient(#94a3b8 1px,transparent 0),linear-gradient(90deg,#94a3b8 1px,transparent 0)',
              backgroundSize: '24px 24px',
            }} />

            <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 6 }}>🗺️</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                {assignment.barangay}
              </div>
            </div>

            {/* View Full button */}
            <button style={{
              position: 'absolute', top: 10, right: 10,
              background: 'rgba(255,255,255,0.9)',
              border: '1px solid #e2e8f0',
              borderRadius: 20, padding: '5px 12px',
              fontSize: 12, fontWeight: 700, color: '#0f172a',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              backdropFilter: 'blur(4px)',
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
              View Full
            </button>
          </div>

          {/* GPS instruction */}
          <p style={{
            fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 6,
          }}>
            Head to your base location to start duty,{' '}
            <strong style={{ color: '#0f172a' }}>{assignment.barangay}</strong>{' '}
            — wait for location verification, please enable GPS.
          </p>
          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 28 }}>
            ( This might take a while )
          </p>
        </div>

        {/* ── INIT STEPS ── */}
        <div style={{ padding: '0 20px', flex: 1 }}>

          {/* Status badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: allDone ? 'rgba(46,204,113,0.1)' : 'rgba(59,130,246,0.1)',
            border: `1px solid ${allDone ? 'rgba(46,204,113,0.4)' : 'rgba(59,130,246,0.4)'}`,
            borderRadius: 20, padding: '5px 14px', marginBottom: 16,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: allDone ? '#2ecc71' : '#3b82f6',
              animation: allDone ? 'none' : 'ciPulse 1.2s ease infinite',
              display: 'inline-block',
            }} />
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '.06em',
              color: allDone ? '#15803d' : '#1d4ed8',
            }}>
              {allDone ? 'SHIFT ACTIVE' : 'INITIALIZING SHIFT'}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{
            background: '#e2e8f0', borderRadius: 99, height: 6,
            overflow: 'hidden', marginBottom: 20,
          }}>
            <div style={{
              height: '100%', borderRadius: 99,
              background: allDone
                ? 'linear-gradient(90deg,#2ecc71,#16a34a)'
                : 'linear-gradient(90deg,#3b82f6,#2563eb)',
              width: `${progress}%`,
              transition: 'width .5s ease',
            }} />
          </div>

          {/* Step list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {STEPS.map((step, i) => {
              const isDone = completed.includes(step.key)
              const isActive = stepIndex === i && !isDone
              const isPending = stepIndex < i

              let icon = '○'
              let color = '#94a3b8'
              if (isDone) { icon = '✓'; color = '#2ecc71' }
              if (isActive) { icon = '⟳'; color = '#3b82f6' }

              // Special GPS status
              let label = step.label
              if (step.key === 'gps' && isDone) {
                label = gpsStatus === 'ok'
                  ? 'GPS activated ✓'
                  : 'GPS unavailable — continuing with limited tracking'
              }

              return (
                <div key={step.key} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  opacity: isPending ? 0.35 : 1,
                  transition: 'opacity .3s',
                }}>
                  <span style={{
                    fontSize: 16, color, fontWeight: 800, width: 20, textAlign: 'center',
                    animation: isActive ? 'ciSpin 1s linear infinite' : 'none',
                    display: 'inline-block',
                  }}>
                    {icon}
                  </span>
                  <span style={{
                    fontSize: 14, fontWeight: isDone ? 600 : 400,
                    color: isDone ? '#0f172a' : isActive ? '#3b82f6' : '#94a3b8',
                  }}>
                    {label}
                  </span>
                </div>
              )
            })}
          </div>
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
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, letterSpacing: '.06em' }}>
            Track · Monitor · Report
          </span>
        </div>

        <style>{`
          @keyframes ciPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
          @keyframes ciSpin  { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </>
  )
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
