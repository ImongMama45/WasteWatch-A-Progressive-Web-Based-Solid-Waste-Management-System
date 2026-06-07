/**
 * StopCompletedModule.jsx
 * Route-progress screen shown after the driver confirms collection in
 * ArrivedModule. Photo proof has already been captured and uploaded
 * upstream, so buttons here are unlocked immediately.
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import Navbar from '../../../components/Navbar'
import api from '../../../api/client'

export default function StopCompletedModule({ setRouteState }) {
  const { user } = useAuth()
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  const [schedule, setSchedule] = useState(null)
  const [loading, setLoading] = useState(true)

  const currentStopIndex = parseInt(
    sessionStorage.getItem('ww_current_stop_index') || '1',
    10,
  )

  useEffect(() => {
    if (!user?.id) return
    setLoading(true)
    api
      .get('/api/driver/collection-schedules/')
      .then(res => {
        const match = res.data.find(s => String(s.driver) === String(user.id))
        setSchedule(match || null)
      })
      .catch(() => setSchedule(null))
      .finally(() => setLoading(false))
  }, [user?.id])

  useEffect(() => {
    if (!schedule?.waypoints?.length) return
    const stops = (schedule.waypoints || []).slice(1)
    const total = stops.length
    const completed = Math.min(currentStopIndex, total)
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0
    sessionStorage.setItem('ww_route_complete', total > 0 && progress === 100 ? 'true' : 'false')
    sessionStorage.setItem('ww_completed_stops', String(completed))
    sessionStorage.setItem('ww_total_stops', String(total))
  }, [schedule, currentStopIndex])

  const stops = (schedule?.waypoints || []).slice(1).map((wp, i) => {
    const wpIndex = i + 1
    return {
      id: wpIndex,
      name: wp.name || `Stop ${wpIndex}`,
      status: wpIndex <= currentStopIndex ? 'completed' : 'pending',
    }
  })

  const total = stops.length
  const completed = stops.filter(s => s.status === 'completed').length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const isRouteComplete = total > 0 && progress === 100

  function handleNextStop() {
    const nextIndex = currentStopIndex + 1
    sessionStorage.setItem('ww_current_stop_index', String(nextIndex))
    sessionStorage.setItem('ww_route_state', 'navigating')
    setRouteState('navigating')
  }

  function handleEndShift() {
    sessionStorage.setItem('ww_route_state', 'end_shift')
    setRouteState('end_shift')
  }

  function handleExtendedMode() {
    const nextIndex = currentStopIndex + 1
    sessionStorage.setItem('ww_current_stop_index', String(nextIndex))
    sessionStorage.setItem('ww_extended_mode', 'true')
    sessionStorage.setItem('ww_route_state', 'navigating')
    setRouteState('navigating')
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-body)', background: '#f8fafc',
      }}>
        Loading route progress...
      </div>
    )
  }

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'var(--font-body)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: 20 }}>

          <h1 style={{
            fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 900,
            color: '#0f172a', marginBottom: 8,
          }}>
            Well done, {firstName}!
          </h1>
          <p style={{ color: '#64748b', marginTop: 0 }}>
            Collection confirmed. Where to next?
          </p>

          {/* ── ROUTE PROGRESS ── */}
          <div style={{
            background: '#fff', border: '1px solid #e2e8f0',
            borderRadius: 14, padding: 14, marginBottom: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em' }}>
                ROUTE STATUS
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#0f172a' }}>
                {completed}/{total} locations
              </div>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
              <div style={{
                width: `${progress}%`, height: '100%',
                background: 'linear-gradient(90deg,#2ecc71,#16a34a)',
              }} />
            </div>
          </div>

          {/* ── ACTIONS ── */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <button
              onClick={handleNextStop}
              style={{
                flex: 1, padding: '16px', borderRadius: 14, border: 'none',
                background: '#0f172a', color: '#fff',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Next Stop
            </button>
            <button
              onClick={handleEndShift}
              style={{
                flex: 1, padding: '16px', borderRadius: 14, border: 'none',
                background: '#0f172a', color: '#fff',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              I'm done for the day!
            </button>
          </div>

          {isRouteComplete && (
            <button
              onClick={handleExtendedMode}
              style={{
                width: '100%', padding: '16px', borderRadius: 14, border: 'none',
                background: '#0f172a', color: '#fff',
                fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              My truck is still not full
            </button>
          )}

        </div>
      </div>
    </>
  )
}