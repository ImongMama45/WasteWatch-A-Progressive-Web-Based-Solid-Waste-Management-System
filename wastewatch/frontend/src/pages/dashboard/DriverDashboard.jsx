/**
 * DriverDashboard.jsx — Driver Home Screen
 * -----------------------------------------
 * Route progress + schedule pulled from /api/driver/collection-schedules/
 * to match NavigationModule.jsx's data source.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Hand, AlertTriangle, Ban, Calendar, Truck, Play, CheckCircle2,
  Map as MapIcon, ClipboardList
} from 'lucide-react'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import api from '../../api/client'
import useShiftTimer from '../../hooks/useShiftTimer'
import { useOptionalDriverGps } from '../../context/DriverGpsContext'
import IssueReporter from '../driver/components/IssueReporter'
import HomeCarousel from '../../components/carousel/HomeCarousel'

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────

const STATUSES = [
  { key: 'on_duty', label: 'On Duty', color: '#2ecc71', bg: 'rgba(46,204,113,0.12)' },
  { key: 'on_route', label: 'On Route', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  { key: 'at_stop', label: 'At Stop', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { key: 'issue', label: 'Issue', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
]

const ROUTE_SESSION_KEYS = [
  'ww_route_state',
  'ww_current_stop_index',
  'ww_stop_statuses',
  'ww_current_stop',
  'ww_route_complete',
  'ww_extended_mode',
  'ww_completed_stops',
  'ww_total_stops',
]

function clearRouteSession() {
  ROUTE_SESSION_KEYS.forEach(key => sessionStorage.removeItem(key))
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Convert a days string/array from the schedule into a human-readable label */
function formatDays(days) {
  if (!days) return '—'
  if (Array.isArray(days)) return days.join(', ')
  return String(days)
}

/** Derive a schedule-table row list from the real schedule object */
function buildScheduleRows(schedule) {
  if (!schedule) return []

  const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  // schedule.days might be a string like "Monday, Wednesday, Friday"
  // or an array. Normalise to an array of day names.
  let activeDays = []
  if (Array.isArray(schedule.days)) {
    activeDays = schedule.days
  } else if (typeof schedule.days === 'string') {
    activeDays = schedule.days.split(',').map(d => d.trim())
  }

  // Normalize activeDays to check by prefix (e.g. 'Mon' matches 'Monday')
  return DAY_ORDER
    .filter(d => activeDays.some(ad => d.toLowerCase().startsWith(ad.substring(0, 3).toLowerCase())))
    .map(day => ({
      day,
      zone: schedule.zone || schedule.barangay || '—',
      time: schedule.start_time && schedule.end_time
        ? `${schedule.start_time} – ${schedule.end_time}`
        : schedule.start_time || '—',
      done: day === today
        ? (schedule.completed === true)  // mark done if today's shift is completed
        : DAY_ORDER.indexOf(day) < DAY_ORDER.indexOf(today),
      isToday: day === today,
    }))
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { user } = useAuth()
  const { notify } = useNotification()
  const navigate = useNavigate()

  // Profile / truck info
  const [profile, setProfile] = useState({ route: '—', truck: '—', barangay: '—' })

  // Real schedule from the same endpoint NavigationModule uses
  const [schedule, setSchedule] = useState(null)
  const [scheduleRows, setScheduleRows] = useState([])
  const [driverAnalytics, setDriverAnalytics] = useState(null)
  const [carouselLoading, setCarouselLoading] = useState({ route: false })

  // Derived route progress from schedule waypoints + sessionStorage stop index
  const [routeStats, setRouteStats] = useState({
    totalStops: 0,
    completedStops: 0,
    distanceKm: 0,
    startTime: '—',
    estEnd: '—',
  })

  const [status, setStatus] = useState('on_route')
  const [loading, setLoading] = useState(true)
  const [issueOpen, setIssueOpen] = useState(false)

  const {
    shiftActive, startTime, formattedTime,
    scheduleId: activeScheduleId,
    loading: shiftLoading,
    startShift,
  } = useShiftTimer()
  const driverGps = useOptionalDriverGps()
  const gpsPosition = driverGps?.position ?? null
  const syncFailed = driverGps?.syncFailed ?? false
  const lastSyncedAt = driverGps?.lastSyncedAt ?? null

  const activeStatus = STATUSES.find(s => s.key === status) || STATUSES[0]
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  // Check if today is in the driver's collection schedule
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const hasScheduleToday = (() => {
    if (!schedule) return false
    let activeDays = []
    if (Array.isArray(schedule.days)) activeDays = schedule.days
    else if (typeof schedule.days === 'string') activeDays = schedule.days.split(',').map(d => d.trim())
    return activeDays.some(ad => today.toLowerCase().startsWith(ad.substring(0, 3).toLowerCase()))
  })()

  // If not on an active shift but finished today, show the backend confirmed completed stops
  const displayStats = {
    totalStops: routeStats.totalStops || 0,
    completedStops: Math.max(routeStats.completedStops || 0, schedule?.completed_stops || 0),
    distanceKm: routeStats.distanceKm || 0,
    startTime: routeStats.startTime || '—',
    estEnd: routeStats.estEnd || '—',
  }
  const displayProgress = displayStats.totalStops > 0
    ? Math.round((displayStats.completedStops / displayStats.totalStops) * 100)
    : 0
  const displayStopsLeft = displayStats.totalStops - displayStats.completedStops

  const isRouteDone = schedule?.truck_status === 'completed' || (displayStats.totalStops > 0 && displayStats.completedStops >= displayStats.totalStops)

  // ── Data fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return

    Promise.all([
      api.get('/api/driver/shift/profile/').catch(() => ({ data: null })),
      api.get('/api/driver/shift/status/').catch(() => ({ data: null })),
      api.get('/api/driver/collection-schedules/').catch(() => ({ data: [] })),
      api.get('/api/driver/shift/analytics/').catch(() => ({ data: null })),
    ]).then(([profileRes, shiftRes, schedulesRes, analyticsRes]) => {

      // ── Profile ──
      if (profileRes.data) {
        setProfile({
          route: profileRes.data.route || '—',
          truck: profileRes.data.truck || '—',
          barangay: profileRes.data.barangay || '—',
        })
      }

      // ── Shift sync ──

      // ── Analytics ──
      if (analyticsRes.data) {
        setDriverAnalytics(analyticsRes.data)
      }

      // ── Schedule ──
      const scheduleList = Array.isArray(schedulesRes.data) ? schedulesRes.data : []
      const match = scheduleList.find(s => String(s.driver) === String(user.id))
      setSchedule(match || null)

      if (match) {
        // Build schedule table rows
        setScheduleRows(buildScheduleRows(match))

        // Derive route progress from waypoints + persisted stop index
        const waypoints = match.waypoints || []
        const totalStops = match.total_stops !== undefined ? match.total_stops : Math.max(waypoints.length - 1, 0) // exclude depot/start (index 0)

        const savedIndex = parseInt(sessionStorage.getItem('ww_current_stop_index') || '1', 10)
        // completedStops = max of local session progress and backend confirmed progress
        const localCompleted = Math.max(0, savedIndex - 1)
        const backendCompleted = match.completed_stops || 0
        const completedStops = Math.max(localCompleted, backendCompleted)

        // Rough distance: sum haversine between consecutive waypoints
        let totalDistKm = 0
        for (let i = 1; i < waypoints.length; i++) {
          totalDistKm += haversinKm(
            waypoints[i - 1].lat, waypoints[i - 1].lng,
            waypoints[i].lat, waypoints[i].lng
          )
        }

        setRouteStats({
          totalStops,
          completedStops,
          distanceKm: Math.round(totalDistKm),
          startTime: match.start_time || '—',
          estEnd: match.end_time || '—',
        })
      }
    }).finally(() => setLoading(false))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-derive completedStops when navigation updates sessionStorage
  // (NavigationModule updates ww_current_stop_index on each stop advance)
  useEffect(() => {
    const interval = setInterval(() => {
      const savedIndex = parseInt(sessionStorage.getItem('ww_current_stop_index') || '1', 10)
      const localCompleted = Math.max(0, savedIndex - 1)
      
      setRouteStats(prev => {
        // Prevent local session (if cleared) from overwriting actual backend progress
        const completed = Math.max(localCompleted, schedule?.completed_stops || 0)
        if (prev.completedStops === completed) return prev
        return { ...prev, completedStops: completed }
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [schedule])

  // ── Shift toggle ─────────────────────────────────────────────────────────────
  async function handleShiftToggle() {
    if (!shiftActive) {
      if (!hasScheduleToday || !schedule?.id) return
      try {
        clearRouteSession()
        await startShift({ scheduleId: schedule.id })
        navigate('/driver/flow')
      } catch (err) {
        console.error('[DriverDashboard] Failed to start shift:', err)
        if (err?.response?.status === 409) {
          alert(err.response.data?.error || 'You already have an active shift on a different route.')
        } else {
          alert('Failed to start your shift. Please try again.')
        }
      }
      return
    }

    sessionStorage.setItem('ww_route_state', 'end_shift')
    navigate('/driver/flow')
  }

  // ── Carousel: Start/Continue Route ──────────────────────────────────────────
  async function handleCarouselStartRoute() {
    if (carouselLoading.route) return

    if (shiftActive) {
      navigate('/driver/flow')
      return
    }

    if (!hasScheduleToday || !schedule?.id) {
      notify({ variant: 'warning-dark', message: 'There is no route scheduled for today.' })
      return
    }

    setCarouselLoading(prev => ({ ...prev, route: true }))
    try {
      clearRouteSession()
      await startShift({ scheduleId: schedule.id })
      navigate('/driver/flow')
    } catch (err) {
      console.error('[DriverDashboard] Failed to start shift:', err)
      if (err?.response?.status === 409) {
        alert(err.response.data?.error || 'You already have an active shift on a different route.')
      } else {
        alert('Failed to start your shift. Please try again.')
      }
    } finally {
      setCarouselLoading(prev => ({ ...prev, route: false }))
    }
  }

  // ── Carousel: View Map ───────────────────────────────────────────────────────
  function handleCarouselViewMap() {
    navigate('/map')
  }

  // ── Carousel: Read More (announcements) ─────────────────────────────────────
  function handleCarouselReadMore() {
    navigate('/announcements')
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes fadeSlideIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideDown   { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
        @keyframes dd-pulse    { 0%,100%{opacity:1} 50%{opacity:.5} }
        .dcard { transition: box-shadow .18s, border-color .18s; }
        .dcard:hover { box-shadow: 0 4px 18px rgba(0,0,0,.09); }
        .abtn  { transition: opacity .15s, transform .1s; cursor:pointer; }
        .abtn:hover  { opacity:.88; }
        .abtn:active { transform:scale(.97); }
        .dd-pulse { animation: dd-pulse 2s ease infinite; }
      `}</style>

      <div className="page">

        {/* ── PAGE HEADER ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, flexWrap: 'wrap' }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              Hello, {firstName} <Hand size={22} color="#f59e0b" />
            </h2>
            <span style={{
              background: shiftActive ? 'rgba(46,204,113,0.1)' : 'rgba(120,120,120,0.1)',
              color: shiftActive ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${shiftActive ? 'rgba(46,204,113,0.3)' : 'var(--border)'}`,
              fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20, letterSpacing: '.08em',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span className={shiftActive ? 'dd-pulse' : ''} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: shiftActive ? '#2ecc71' : '#999', display: 'inline-block',
              }} />
              {shiftActive ? 'ACTIVE SHIFT' : 'OFF DUTY'}
            </span>
          </div>
          <p className="text-muted text-sm">
            {profile.truck} · {profile.barangay} · {profile.route}
          </p>

          {/* ── GPS SYNC WARNING ── */}
          {shiftActive && syncFailed && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 10, padding: '8px 14px', marginTop: 10,
              display: 'flex', alignItems: 'center', gap: 10, animation: 'fadeSlideIn .3s ease',
            }}>
              <AlertTriangle size={24} color="#ef4444" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#ef4444' }}>GPS Sync Paused — No Network</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {lastSyncedAt
                    ? `Last synced at ${lastSyncedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Location not yet synced to server'}
                </div>
              </div>
            </div>
          )}

          {shiftActive && activeScheduleId && schedule?.id && String(activeScheduleId) !== String(schedule.id) && (
            <div style={{
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)',
              borderRadius: 10, padding: '8px 14px', marginTop: 10,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <AlertTriangle size={24} color="#f59e0b" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#b45309' }}>Active Shift on a Different Route</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  You're currently clocked in on another schedule. Resume it or end it before starting this one.
                </div>
              </div>
              <button className="abtn btn" onClick={() => navigate('/driver/flow')}
                style={{ padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                Resume
              </button>
            </div>
          )}

          <div className="mobile-schedule">
            <HomeCarousel
              role="driver"
              userBarangay={user?.barangay_name}
              onStartRoute={handleCarouselStartRoute}
              onViewMap={handleCarouselViewMap}
              onReadMore={handleCarouselReadMore}
              loading={carouselLoading}
              driverStats={driverAnalytics ? {
                thisWeek: driverAnalytics.weekly?.reduce((acc, curr) => acc + curr.stops, 0) || 0,
                onTime: '98%', // placeholder until backend supports onTime metrics
                rating: 4.8    // placeholder until backend supports ratings
              } : undefined}
              driverRoute={schedule ? {
                label: `${schedule.zone || schedule.barangay || 'City Route'}`,
                stops: Math.max(displayStats.totalStops, 1),
                completed: displayStats.completedStops,
                nextStop: (schedule.waypoints && schedule.waypoints[displayStats.completedStops + 1])
                  ? (schedule.waypoints[displayStats.completedStops + 1].label || schedule.waypoints[displayStats.completedStops + 1].address || 'Next Stop')
                  : 'N/A',
                startTime: schedule.start_time || '—',
                status: isRouteDone ? 'done' : shiftActive ? 'in_progress' : 'pending'
              } : undefined}
            />
          </div>

          {/* ── SHIFT TIMER ── */}
          {shiftActive && (
            <div style={{
              marginTop: 10, display: 'flex', alignItems: 'center', gap: 12,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '10px 14px',
            }}>
              <div style={{ flex: 1 }}>
                <div className="form-label" style={{ marginBottom: 2 }}>SHIFT DURATION</div>
                <div style={{
                  fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800,
                  color: 'var(--accent)', letterSpacing: '.04em',
                }}>
                  {formattedTime}
                </div>
              </div>
              {startTime && (
                <div style={{ textAlign: 'right' }}>
                  <div className="form-label" style={{ marginBottom: 2 }}>STARTED</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="page-grid">

          {/* ════════════════════════════════════════
              MAIN COLUMN
          ════════════════════════════════════════ */}
          <div>

            {/* ── NO SCHEDULE TODAY BANNER ── */}
            {!loading && !shiftActive && !hasScheduleToday && (
              <div style={{
                marginBottom: 20,
                borderRadius: 14, overflow: 'hidden',
                border: '1.5px solid rgba(245,158,11,0.4)',
                background: 'rgba(245,158,11,0.06)',
                animation: 'fadeSlideIn .35s ease',
              }}>
                <div style={{
                  background: 'linear-gradient(135deg,rgba(245,158,11,0.15),rgba(234,179,8,0.1))',
                  padding: '18px 20px',
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: 'rgba(245,158,11,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22,
                  }}>
                    <Ban size={24} color="#b45309" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: '#92400e', marginBottom: 4 }}>
                      No Scheduled Collection Today
                    </div>
                    <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
                      Today is <strong>{today}</strong>. Your collection schedule does not include today.
                      You will not be able to start a shift until your next scheduled day.
                    </div>
                    {schedule && (
                      <div style={{
                        marginTop: 10, fontSize: 11, fontWeight: 700,
                        color: '#92400e', letterSpacing: '.03em',
                      }}>
                        <Calendar size={12} style={{ marginRight: 4 }} /> Scheduled days: {Array.isArray(schedule.days)
                          ? schedule.days.join(', ')
                          : schedule.days || '—'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── STAT CARDS ── */}
            <div className="stat-grid" style={{ marginBottom: 20 }}>
              {[
                { label: 'Stops Done', value: loading ? '…' : displayStats.completedStops },
                { label: 'Stops Left', value: loading ? '…' : displayStopsLeft },
                { label: 'Distance', value: loading ? '…' : `${displayStats.distanceKm}km` },
                { label: 'Total Stops', value: loading ? '…' : displayStats.totalStops },
              ].map(s => (
                <div key={s.label} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div className="label">{s.label}</div>
                  <div className="value" style={{ fontSize: 30 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* ── ROUTE PROGRESS CARD ── */}
            <div className="card dcard" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Today's Route</h3>
                <span style={{
                  background: isRouteDone ? 'rgba(46,204,113,0.1)' : status === 'issue' ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)',
                  color: isRouteDone ? '#2ecc71' : status === 'issue' ? 'var(--danger)' : '#3b82f6',
                  border: `1px solid ${isRouteDone ? 'rgba(46,204,113,0.3)' : status === 'issue' ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.3)'}`,
                  fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20, letterSpacing: '.07em',
                }}>
                  {loading
                    ? 'LOADING…'
                    : isRouteDone
                      ? '✓ COMPLETED'
                      : status === 'issue'
                        ? '⚠ DELAYED'
                        : displayStats.totalStops === 0
                          ? 'NO SCHEDULE'
                          : 'IN PROGRESS'}
                </span>
              </div>

              {/* Route name / days */}
              {schedule && (
                <div style={{
                  fontSize: 12, color: 'var(--text-muted)', marginBottom: 10,
                  display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center'
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={14} /> {formatDays(schedule.days)}</span>
                  {schedule.zone && <span>· {schedule.zone}</span>}
                  {schedule.barangay && <span>· {schedule.barangay}</span>}
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="text-muted text-sm">Progress (Today)</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {displayStats.completedStops} / {displayStats.totalStops} stops
                  </span>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    background: 'linear-gradient(90deg,#2ecc71,#27ae60)',
                    width: `${displayProgress}%`, transition: 'width .4s ease',
                  }} />
                </div>
                <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  {displayProgress}% complete
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                {[
                  { label: 'Start Time', value: displayStats.startTime },
                  { label: 'Est. End', value: displayStats.estEnd },
                  { label: 'Distance', value: `${displayStats.distanceKm} km` },
                ].map(item => (
                  <div key={item.label} style={{
                    background: 'var(--bg)', borderRadius: 10, padding: '10px', textAlign: 'center',
                  }}>
                    <div className="form-label" style={{ marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 700 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── STATUS TOGGLE + CTA ── */}
            <div className="status-card-mobile-only">
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h3 className="section-title" style={{ margin: 0 }}>Current Status</h3>
                  {!shiftActive && <span className="text-muted text-xs">Start shift to update</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                  {STATUSES.map(s => {
                    const isActive = status === s.key
                    return (
                      <button key={s.key} id={`status-${s.key}`} className="abtn"
                        onClick={() => shiftActive && setStatus(s.key)}
                        style={{
                          padding: '11px 4px', borderRadius: 10,
                          background: isActive ? s.bg : 'var(--surface)',
                          border: `2px solid ${isActive ? s.color : 'var(--border)'}`,
                          color: isActive ? s.color : 'var(--text-muted)',
                          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                          opacity: shiftActive ? 1 : 0.45,
                          cursor: shiftActive ? 'pointer' : 'not-allowed',
                        }}>
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ── MAIN CTA ── */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
                <button id="driver-main-cta" className="abtn btn"
                  onClick={() => shiftActive ? navigate('/driver/flow') : handleShiftToggle()}
                  disabled={(!shiftActive && !hasScheduleToday) || (!shiftActive && isRouteDone)}
                  style={{
                    flex: 2, padding: '16px 20px', borderRadius: 14,
                    fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800,
                    background: (!shiftActive && !hasScheduleToday) || (!shiftActive && isRouteDone)
                      ? 'rgba(148,163,184,0.15)'
                      : shiftActive
                        ? 'linear-gradient(135deg,#2ecc71,#27ae60)'
                        : 'linear-gradient(135deg,#3b82f6,#2563eb)',
                    color: (!shiftActive && !hasScheduleToday) || (!shiftActive && isRouteDone) ? '#94a3b8' : '#fff',
                    border: (!shiftActive && !hasScheduleToday) || (!shiftActive && isRouteDone) ? '1.5px solid var(--border)' : 'none',
                    cursor: (!shiftActive && !hasScheduleToday) || (!shiftActive && isRouteDone) ? 'not-allowed' : 'pointer',
                    boxShadow: (!shiftActive && !hasScheduleToday) || (!shiftActive && isRouteDone)
                      ? 'none'
                      : shiftActive
                        ? '0 4px 18px rgba(46,204,113,0.35)'
                        : '0 4px 18px rgba(59,130,246,0.35)',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!shiftActive && !hasScheduleToday && <Ban size={18} />}
                    {!shiftActive && hasScheduleToday && isRouteDone && <CheckCircle2 size={18} />}
                    {shiftActive && hasScheduleToday && <Truck size={18} />}
                    {!shiftActive && hasScheduleToday && !isRouteDone && <Play size={18} fill="currentColor" />}
                    <span>
                      {!shiftActive && !hasScheduleToday
                        ? 'No Collection Today'
                        : !shiftActive && isRouteDone
                          ? 'Route Completed'
                          : shiftActive ? 'Resume Route' : 'Start Duty'}
                    </span>
                  </div>
                </button>
                {shiftActive && (
                  <button id="driver-end-shift" className="abtn btn"
                    onClick={handleShiftToggle}
                    style={{
                      flex: 1, padding: '16px 14px', borderRadius: 14,
                      fontFamily: 'var(--font-head)', fontSize: 13, fontWeight: 700,
                      background: 'rgba(239,68,68,0.1)', border: '1.5px solid rgba(239,68,68,0.3)',
                      color: 'var(--danger)',
                    }}>
                    End Shift
                  </button>
                )}
              </div>
            </div>

            {/* ── LIVE MAP ── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Live Collection Map</h3>
                <button onClick={() => navigate('/map')}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Full View ›
                </button>
              </div>
              <MiniMap />
            </div>

            {/* ── COLLECTION SCHEDULE (real data) ── */}
            <div style={{ marginBottom: 24 }}>
              <h3 className="section-title">Collection Schedule</h3>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Loading schedule…
                  </div>
                ) : scheduleRows.length === 0 ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No schedule assigned yet.
                  </div>
                ) : (
                  scheduleRows.map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                      borderBottom: i < scheduleRows.length - 1 ? '1px solid var(--border)' : 'none',
                      background: s.isToday ? 'rgba(46,204,113,0.04)' : 'transparent',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: s.done ? 'rgba(46,204,113,0.12)' : s.isToday ? 'rgba(59,130,246,0.1)' : 'var(--surface-2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                      }}>
                        {s.done ? <CheckCircle2 size={18} color="var(--accent)" /> : s.isToday ? <Truck size={18} color="var(--info)" /> : <Calendar size={18} color="var(--text-muted)" />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                          {s.day}
                          {s.isToday && (
                            <span style={{
                              marginLeft: 6, fontSize: 9, fontWeight: 800,
                              background: 'rgba(59,130,246,0.1)', color: 'var(--info)',
                              padding: '2px 7px', borderRadius: 20, letterSpacing: '.05em',
                            }}>TODAY</span>
                          )}
                        </div>
                        <div className="text-muted text-sm">{s.zone} · {profile.barangay}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600,
                          color: s.time === '—' ? 'var(--text-muted)' : 'var(--text)',
                        }}>
                          {s.time}
                        </div>
                        <span style={{
                          fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20, letterSpacing: '.05em',
                          background: s.done
                            ? 'rgba(46,204,113,0.1)'
                            : s.isToday
                              ? 'rgba(59,130,246,0.1)'
                              : s.time === '—'
                                ? 'rgba(148,163,184,0.1)'
                                : 'rgba(243,156,18,0.1)',
                          color: s.done
                            ? 'var(--accent)'
                            : s.isToday
                              ? 'var(--info)'
                              : s.time === '—'
                                ? 'var(--text-muted)'
                                : 'var(--warning)',
                        }}>
                          {s.done ? 'DONE' : s.isToday ? 'ACTIVE' : s.time === '—' ? 'N/A' : 'UPCOMING'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>{/* end main column */}

          {/* ════════════════════════════════════════
              SIDEBAR (desktop only)
          ════════════════════════════════════════ */}
          <div className="sidebar">

            {/* Quick Actions */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Quick Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="abtn btn btn-full" onClick={() => navigate('/driver/route')}
                  style={{
                    background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.35)',
                    color: 'var(--accent)', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}>
                  <MapIcon size={16} /> View My Route
                </button>
                <button className="abtn btn btn-full" onClick={() => navigate('/driver/log')}
                  style={{
                    background: 'var(--surface-2)', border: '1px solid var(--border)', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}>
                  <ClipboardList size={16} /> Collection Log
                </button>
              </div>
            </div>

            {/* Route Summary */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Route Summary</h3>
              {loading ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Loading…</div>
              ) : (
                [
                  { label: 'Stops Done', value: displayStats.completedStops, color: 'var(--accent)' },
                  { label: 'Stops Left', value: displayStopsLeft, color: 'var(--warning)' },
                  { label: 'Total Stops', value: displayStats.totalStops, color: 'var(--text)' },
                  { label: 'Distance', value: `${displayStats.distanceKm} km`, color: 'var(--info)' },
                ].map(s => (
                  <div key={s.label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '9px 0', borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.label}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: 'var(--font-head)' }}>
                      {s.value}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Collection Schedule */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Collection Schedule</h3>
              {loading ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
              ) : scheduleRows.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No schedule.</div>
              ) : (
                scheduleRows.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                    borderBottom: i < scheduleRows.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{ fontSize: 14 }}>
                      {s.done ? <CheckCircle2 size={16} color="var(--accent)" /> : s.isToday ? <Truck size={16} color="var(--info)" /> : <Calendar size={16} color="var(--text-muted)" />}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{s.day}</div>
                      <div className="text-muted text-xs">{s.zone}</div>
                    </div>
                    <div className="text-muted text-xs" style={{ textAlign: 'right' }}>{s.time}</div>
                  </div>
                ))
              )}
            </div>

            {/* Driver Profile */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Your Profile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div className="form-label">Name</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{user?.full_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Email</div>
                  <div className="text-muted text-sm">{user?.email}</div>
                </div>
                <div>
                  <div className="form-label">Truck</div>
                  <div style={{ fontSize: 14 }}>{profile.truck}</div>
                </div>
                <div>
                  <div className="form-label">Status</div>
                  <span style={{
                    background: activeStatus.bg, color: activeStatus.color,
                    border: `1px solid ${activeStatus.color}55`,
                    fontSize: 9, fontWeight: 800, padding: '3px 10px',
                    borderRadius: 20, letterSpacing: '.07em', display: 'inline-block',
                  }}>
                    {activeStatus.label.toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="form-label">Role</div>
                  <span style={{
                    background: 'rgba(59,130,246,0.1)', color: 'var(--info)',
                    border: '1px solid rgba(59,130,246,0.25)',
                    fontSize: 9, fontWeight: 800, padding: '3px 10px',
                    borderRadius: 20, letterSpacing: '.07em', display: 'inline-block',
                  }}>DRIVER</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── FLOATING REPORT ISSUE BUTTON ── */}
      {shiftActive && (
        <button
          id="floating-report-issue"
          onClick={() => setIssueOpen(true)}
          style={{
            position: 'fixed', bottom: 80, right: 20, zIndex: 800,
            background: 'linear-gradient(135deg,#ef4444,#dc2626)',
            color: '#fff', border: 'none', borderRadius: '50%',
            width: 54, height: 54, fontSize: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 20px rgba(239,68,68,0.45)',
            cursor: 'pointer', transition: 'transform .15s',
          }}
          title="Report Issue"
        >
          <AlertTriangle size={24} color="#ffffff" />
        </button>
      )}

      {/* ── ISSUE REPORTER BOTTOM SHEET ── */}
      <IssueReporter
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        gpsPosition={gpsPosition}
      />
    </>
  )
}

// ─── UTIL ─────────────────────────────────────────────────────────────────────

function haversinKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
