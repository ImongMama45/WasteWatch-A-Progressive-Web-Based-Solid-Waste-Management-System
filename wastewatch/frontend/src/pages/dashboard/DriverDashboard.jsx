/**
 * DriverDashboard.jsx — Driver Home Screen
 * -----------------------------------------
 * Route progress + schedule pulled from /api/driver/collection-schedules/.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Hand, AlertTriangle, Ban, Calendar, Clock, Truck, Play, CheckCircle2,
  Map as MapIcon, ClipboardList
} from 'lucide-react'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import api from '../../api/client'
import useShiftTimer, { clearDriverSessionData } from '../../hooks/useShiftTimer'
import { useOptionalDriverGps } from '../../context/DriverGpsContext'
import IssueReporter from '../driver/components/IssueReporter'
import HomeCarousel from '../../components/carousel/HomeCarousel'
import { isCompletedStopStatus, normalizeStopStatus } from '../../utils/pickupStatusSync'
import {
  extractArray,
  resolveDriverSchedule,
  evaluateScheduleShiftTiming,
  formatTime12h,
} from '../../utils/driverSchedule'
import {
  Skeleton,
  SkeletonPill,
  StatCardSkeleton,
  FeedCardSkeleton,
  SidebarWidgetSkeleton,
} from '../../components/ui/Skeleton'

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────

const STATUSES = [
  { key: 'on_duty', label: 'On Duty', color: '#2ecc71', bg: 'rgba(46,204,113,0.12)' },
  { key: 'on_route', label: 'On Route', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  { key: 'at_stop', label: 'At Stop', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { key: 'issue', label: 'Issue', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
]

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Convert a days string/array from the schedule into a human-readable label */
function formatDays(days) {
  if (!days) return '—'
  if (Array.isArray(days)) return days.join(', ')
  return String(days)
}

function formatTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  if (!h || !m) return timeStr
  let hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12 || 12
  return `${hour}:${m} ${ampm}`
}

/** Derive a schedule-table row list from the real schedule object */
function buildScheduleRows(schedule, isRouteDone = false) {
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
    .map(day => {
      const isToday = day === today
      const isPast = DAY_ORDER.indexOf(day) < DAY_ORDER.indexOf(today)

      return {
        day,
        zone: schedule.zone || schedule.barangay || '—',
        time: schedule.start_time && schedule.end_time
          ? `${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}`
          : schedule.start_time ? formatTime(schedule.start_time) : '—',
        done: isToday ? isRouteDone : false,
        isPast: !isToday && isPast,
        isToday,
      }
    })
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { user } = useAuth()
  const { notify } = useNotification()
  const navigate = useNavigate()

  // Profile / truck info
  const [profile, setProfile] = useState({ route: '—', truck: '—', barangay: '—' })

  // Real schedule from the same endpoint ShiftRouteModule uses
  const [schedule, setSchedule] = useState(null)
  const [scheduleRows, setScheduleRows] = useState([])
  const [driverAnalytics, setDriverAnalytics] = useState(null)
  const [carouselLoading, setCarouselLoading] = useState({ route: false })

  // Derived route progress from schedule waypoints + sessionStorage stop index
  const [routeStats, setRouteStats] = useState({
    totalStops: 0,
    completedStops: 0,
    missedStopsCollected: 0,
    distanceKm: 0,
    startTime: '—',
    estEnd: '—',
  })

  const [status, setStatus] = useState('on_route')
  const [loading, setLoading] = useState(true)
  const [issueOpen, setIssueOpen] = useState(false)
  
  const [blockingEscalation, setBlockingEscalation] = useState(null)
  const [ackLoading, setAckLoading] = useState(false)

  const [urgentDispatch, setUrgentDispatch] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await api.get('/api/watcher/hotspots/assigned/')
        const unacked = extractArray(res.data).find(h => h.assigned_truck_id && !h.dispatch_acknowledged)
        if (unacked && !cancelled) setUrgentDispatch(prev => prev?.id === unacked.id ? prev : unacked)
      } catch { /* silent */ }
    }
    poll()
    const id = setInterval(poll, 15000) // tune as needed
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  async function ackDispatch() {
    if (!urgentDispatch) return
    try { await api.post(`/api/watcher/hotspots/${urgentDispatch.id}/acknowledge-dispatch/`) }
    finally { setUrgentDispatch(null) }
  }

  const {
    shiftActive, startTime, formattedTime,
    scheduleId: activeScheduleId,
    shiftId,
    startShift,
  } = useShiftTimer()
  const driverGps = useOptionalDriverGps()
  const gpsPosition = driverGps?.position ?? null
  const syncFailed = driverGps?.syncFailed ?? false
  const lastSyncedAt = driverGps?.lastSyncedAt ?? null

  const activeStatus = STATUSES.find(s => s.key === status) || STATUSES[0]
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  // Check if today is in the driver's collection schedule + live clock for late/off-schedule status
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const today = now.toLocaleDateString('en-US', { weekday: 'long' })
  const timing = evaluateScheduleShiftTiming(schedule, now)
  const hasScheduleToday = timing.hasScheduleToday

  // If not on an active shift but finished today, show the backend confirmed completed stops
  const displayStats = {
    totalStops: routeStats.totalStops || 0,
    completedStops: Math.max(routeStats.completedStops || 0, schedule?.completed_stops || 0),
    distanceKm: routeStats.distanceKm || 0,
    startTime: routeStats.startTime && routeStats.startTime !== '—' ? formatTime12h(routeStats.startTime) : '—',
    estEnd: routeStats.estEnd && routeStats.estEnd !== '—' ? formatTime12h(routeStats.estEnd) : '—',
  }
  const displayProgress = displayStats.totalStops > 0
    ? Math.round((displayStats.completedStops / displayStats.totalStops) * 100)
    : 0
  const displayStopsLeft = displayStats.totalStops - displayStats.completedStops

  const isRouteDone = schedule?.truck_status === 'completed'
  const isShiftEndedIncomplete = schedule?.truck_status === 'returning_unfinished'
  const isShiftDone = isRouteDone || isShiftEndedIncomplete

  // ── Data fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return

    Promise.all([
      api.get('/api/driver/shift/profile/').catch(() => ({ data: null })),
      api.get('/api/driver/shift/status/').catch(() => ({ data: null })),
      api.get('/api/driver/collection-schedules/?paginate=false').catch(() => ({ data: [] })),
      api.get('/api/driver/shift/analytics/').catch(() => ({ data: null })),
    ]).then(([profileRes, _shiftRes, schedulesRes, analyticsRes]) => {

      // ── Profile ──
      if (profileRes.data) {
        setProfile({
          route: profileRes.data.route || '—',
          truck: profileRes.data.truck || '—',
          barangay: profileRes.data.barangay || '—',
        })
      }

      // ── Blocking Escalations ──
      api.get('/api/watcher/escalations/?status=approved&driver_acknowledged=false').then(res => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.results || [])
        const unacked = list.find(e => e.status === 'approved' && !e.driver_acknowledged)
        if (unacked) setBlockingEscalation(unacked)
      }).catch(err => console.error(err))

      // ── Analytics ──
      if (analyticsRes.data) {
        setDriverAnalytics(analyticsRes.data)
      }

      // ── Schedule ──
      const match = resolveDriverSchedule(schedulesRes.data, user.id, activeScheduleId)
      setSchedule(match || null)

      if (match) {
        // Derive route progress from waypoints + persisted stop index

        const waypoints = match.waypoints || []
        const totalStops = match.total_stops !== undefined ? match.total_stops : Math.max(waypoints.length - 1, 0) // exclude depot/start (index 0)

        // Prefer snapshot-based count (counts only genuinely collected/empty stops).
        // Falls back to index-based estimate if no snapshot exists yet.
        let localCompleted = 0
        try {
          const raw = sessionStorage.getItem('ww_stop_statuses_snapshot')
          if (raw) {
            const entries = new Map(JSON.parse(raw))
            localCompleted = [...entries.values()]
              .filter(s => isCompletedStopStatus(normalizeStopStatus(s)) || normalizeStopStatus(s) === 'EMPTY_STOP').length
          } else {
            const savedIndex = parseInt(sessionStorage.getItem('ww_current_stop_index') || '1', 10)
            localCompleted = Math.max(0, savedIndex - 1)
          }
        } catch {
          const savedIndex = parseInt(sessionStorage.getItem('ww_current_stop_index') || '1', 10)
          localCompleted = Math.max(0, savedIndex - 1)
        }
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

        const backendMissed = match.missed_stops_collected || 0
        const localMissed = parseInt(sessionStorage.getItem('ww_missed_stops_collected') || '0', 10)
        const missedStopsCollected = Math.max(localMissed, backendMissed)

        setRouteStats({
          totalStops,
          completedStops,
          missedStopsCollected,
          distanceKm: Math.round(totalDistKm),
          startTime: match.start_time || '—',
          estEnd: match.end_time || '—',
        })
      }
    }).finally(() => setLoading(false))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-derive completedStops when navigation updates sessionStorage
  // (ShiftRouteModule updates ww_current_stop_index on each stop advance)
  useEffect(() => {
    const interval = setInterval(() => {
      let localCompleted = 0
      try {
        const raw = sessionStorage.getItem('ww_stop_statuses_snapshot')
        if (raw) {
          const entries = new Map(JSON.parse(raw))
          localCompleted = [...entries.values()]
            .filter(s => isCompletedStopStatus(normalizeStopStatus(s)) || normalizeStopStatus(s) === 'EMPTY_STOP').length
        } else {
          const savedIndex = parseInt(sessionStorage.getItem('ww_current_stop_index') || '1', 10)
          localCompleted = Math.max(0, savedIndex - 1)
        }
      } catch {
        const savedIndex = parseInt(sessionStorage.getItem('ww_current_stop_index') || '1', 10)
        localCompleted = Math.max(0, savedIndex - 1)
      }

      setRouteStats(prev => {
        // Prevent local session (if cleared) from overwriting actual backend progress
        const completed = Math.max(localCompleted, schedule?.completed_stops || 0)
        const localMissed = parseInt(sessionStorage.getItem('ww_missed_stops_collected') || '0', 10)
        const missedStopsCollected = Math.max(localMissed, schedule?.missed_stops_collected || 0)
        
        if (prev.completedStops === completed && prev.missedStopsCollected === missedStopsCollected) return prev
        return { ...prev, completedStops: completed, missedStopsCollected }
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [schedule])

  // Update schedule rows when isRouteDone or schedule changes
  useEffect(() => {
    if (schedule) {
      setScheduleRows(buildScheduleRows(schedule, isShiftDone))
    }
  }, [schedule, isShiftDone])

  // ── Shift toggle ─────────────────────────────────────────────────────────────
  async function handleShiftToggle() {
    if (user?.is_suspended) {
      notify({ variant: 'error-dark', message: 'Your account is suspended. You cannot start a shift.' })
      return
    }
    if (!shiftActive) {
      if (!hasScheduleToday || !schedule?.id || isShiftDone) {
        notify({ variant: 'warning-dark', message: 'There is no active route scheduled for today.' })
        return
      }
      try {
        clearDriverSessionData()
        await startShift({ scheduleId: schedule.id })
        navigate('/driver/flow')
      } catch (err) {
        console.error('[DriverDashboard] Failed to start shift:', err)
        notify({
          variant: 'error-dark',
          message: err?.response?.data?.error || 'Failed to start your shift. Please try again.',
        })
      }
      return
    }

    // Mid-shift End Shift: PATCH the backend first so DriverRouteFlow resumes
    // into EndShiftModule (not back onto the live map). On failure, stop and
    // surface a user-facing message — navigating with a stale backend status
    // would drop the driver back on the active route with no explanation.
    try {
      if (shiftId) {
        await api.patch(`/api/driver/shift/${shiftId}/update-status/`, { status: 'end_shift' })
      }
    } catch (err) {
      console.error('[DriverDashboard] Could not end shift:', err)
      notify({ variant: 'error-dark', message: 'Could not end your shift. Check your connection and try again.' })
      return
    }
    // Copy local stop statuses to snapshot so EndShiftModule doesn't count
    // stops still in the offline photo queue as missed.
    const localStatuses = sessionStorage.getItem('ww_stop_statuses')
    if (localStatuses) sessionStorage.setItem('ww_stop_statuses_snapshot', localStatuses)
    navigate('/driver/flow')
  }

  // ── Carousel: Start/Continue Route ──────────────────────────────────────────
  async function handleCarouselStartRoute() {
    if (carouselLoading.route) return
    
    if (user?.is_suspended) {
      notify({ variant: 'error-dark', message: 'Your account is suspended. You cannot start a shift.' })
      return
    }

    if (shiftActive) {
      navigate('/driver/flow')
      return
    }

    if (!hasScheduleToday || !schedule?.id || isShiftDone) {
      notify({ variant: 'warning-dark', message: 'There is no route scheduled for today.' })
      return
    }

    setCarouselLoading(prev => ({ ...prev, route: true }))
    try {
      clearDriverSessionData()
      await startShift({ scheduleId: schedule.id })
      navigate('/driver/flow')
    } catch (err) {
      console.error('[DriverDashboard] Failed to start shift:', err)
      notify({
        variant: 'error-dark',
        message: err?.response?.data?.error || 'Failed to start your shift. Please try again.',
      })
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

  // ── Acknowledgment ──────────────────────────────────────────────────────────
  async function handleAcknowledge() {
    if (!blockingEscalation) return
    setAckLoading(true)
    try {
      await api.patch(`/api/watcher/escalations/${blockingEscalation.id}/acknowledge/`)
      setBlockingEscalation(null)
    } catch (err) {
      console.error(err)
      if (err.response?.status === 400) {
        // Admin resolved it while driver was viewing the modal
        setBlockingEscalation(null)
      } else {
        notify({ variant: 'error-dark', message: 'Failed to acknowledge.' })
      }
    } finally {
      setAckLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {urgentDispatch && (
        <div style={{ position:'fixed', inset:0, zIndex:99999, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding: 16 }}>
          <div style={{ background:'#ffffff', borderRadius:8, padding:24, maxWidth:380, width: '100%', textAlign:'center', border:'1px solid #e4e6eb', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 8, background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={24} />
              </div>
            </div>
            <h3 style={{ margin:'0 0 6px', fontSize: 16, fontWeight: 700, color: '#1c1e21' }}>Urgent Pickup Added</h3>
            <p style={{ fontSize:13, color:'#65676b', marginBottom:18, lineHeight: 1.4 }}>
              Brgy. {urgentDispatch.barangay} — {urgentDispatch.address}
            </p>
            <button onClick={ackDispatch} style={{ width:'100%', padding:'10px', background:'#dc2626', color:'#fff', border:'none', borderRadius:6, fontWeight:600, fontSize: 13, cursor: 'pointer' }}>
              Acknowledge
            </button>
          </div>
        </div>
      )}
      <style>{`
        @keyframes fadeSlideIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideDown   { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes dd-pulse    { 0%,100%{opacity:1} 50%{opacity:.5} }
        .dd-meta-canvas {
          background-color: #f0f2f5;
          min-height: 100vh;
          padding: 20px 24px;
          color: #1c1e21;
        }
        .dcard, .card {
          background: #ffffff !important;
          border: 1px solid #e4e6eb !important;
          border-radius: 8px !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;
        }
        .stat-card {
          background: #ffffff !important;
          border: 1px solid #e4e6eb !important;
          border-radius: 8px !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;
          padding: 14px 16px !important;
        }
        .stat-card .label {
          font-size: 11px !important;
          font-weight: 700 !important;
          color: #65676b !important;
          text-transform: uppercase !important;
          letter-spacing: .05em !important;
        }
        .stat-card .value {
          font-size: 26px !important;
          font-weight: 700 !important;
          color: #1c1e21 !important;
          margin-top: 4px !important;
        }
        .abtn  { transition: opacity .15s, transform .1s; cursor:pointer; }
        .abtn:hover  { opacity:.9; }
        .dd-pulse { animation: dd-pulse 2s ease infinite; }
      `}</style>

      <div className="dd-meta-canvas">

        {/* ── PAGE HEADER ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#1c1e21', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 6 }}>
              Hello, {firstName} <Hand size={20} color="#f59e0b" />
            </h2>
            <span style={{
              background: shiftActive ? '#e7f5eb' : '#f0f2f5',
              color: shiftActive ? '#15803d' : '#65676b',
              border: `1px solid ${shiftActive ? '#bbf7d0' : '#ced0d4'}`,
              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '.04em',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span className={shiftActive ? 'dd-pulse' : ''} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: shiftActive ? '#16a34a' : '#8a8d91', display: 'inline-block',
              }} />
              {shiftActive ? 'ACTIVE SHIFT' : 'OFF DUTY'}
            </span>
          </div>
          {loading ? (
            <Skeleton width={210} height={14} radius={4} style={{ marginTop: 4 }} />
          ) : (
            <p className="text-muted text-sm ww-fade-in">
              {profile.truck} · {profile.barangay} · {profile.route}
            </p>
          )}

          {/* ── SUSPENDED BANNER ── */}
          {user?.is_suspended && (
            <div style={{
              background: 'rgba(220, 38, 38, 0.1)', border: '1px solid rgba(220, 38, 38, 0.4)',
              borderRadius: 10, padding: '12px 16px', marginTop: 10, marginBottom: 15,
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <Ban size={24} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#991b1b', marginBottom: 4 }}>
                  Account Suspended
                </div>
                <div style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.4 }}>
                  Your account has been suspended due to unresolved escalations. You cannot start new shifts until this is resolved.
                </div>
              </div>
            </div>
          )}

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

          {shiftActive && (!activeScheduleId || !schedule?.id || String(activeScheduleId) === String(schedule.id)) && (
            <div style={{
              background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.4)',
              borderRadius: 10, padding: '8px 14px', marginTop: 10,
              display: 'flex', alignItems: 'center', gap: 10,
              animation: 'fadeSlideIn .3s ease',
            }}>
              <Play size={20} color="#3b82f6" fill="currentColor" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#1e40af' }}>Shift in progress</div>
                {loading ? (
                  <Skeleton width={100} height={13} radius={4} style={{ marginTop: 3 }} />
                ) : (
                  <div style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600 }}>
                    Stop {displayStats.completedStops} / {displayStats.totalStops}
                  </div>
                )}
              </div>
              <button className="abtn btn" onClick={() => navigate('/driver/flow')}
                style={{
                  padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 800, flexShrink: 0,
                  background: '#3b82f6', color: '#fff', border: 'none',
                  boxShadow: '0 4px 12px rgba(59,130,246,0.3)'
                }}>
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
              driverRoute={!loading ? {
                label: schedule
                  ? `${schedule.zone || schedule.barangay_names || schedule.barangay || 'City Route'}`
                  : 'No Route Assigned',
                stops: schedule && hasScheduleToday ? Math.max(displayStats.totalStops, 1) : (displayStats.totalStops || 0),
                completed: displayStats.completedStops,
                nextStop: !hasScheduleToday
                  ? 'No duty today'
                  : (schedule?.waypoints && schedule.waypoints[displayStats.completedStops + 1])
                    ? (schedule.waypoints[displayStats.completedStops + 1].label || schedule.waypoints[displayStats.completedStops + 1].address || 'Next Stop')
                    : 'N/A',
                startTime: timing.formattedStart || '—',
                ctaLabel: timing.compactCtaLabel,
                status: user?.is_suspended
                  ? 'suspended'
                  : shiftActive
                    ? 'in_progress'
                    : (!schedule || !hasScheduleToday)
                      ? 'no_schedule'
                      : isShiftDone
                        ? 'done'
                        : timing.isLate
                          ? 'late'
                          : timing.isEarlyOffSchedule
                            ? 'early'
                            : 'pending'
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

            {/* ── OFF-SCHEDULE / LATE BANNER ── */}
            {!loading && !shiftActive && !user?.is_suspended && hasScheduleToday && !isShiftDone && timing.isOffSchedule && (
              <div style={{
                marginBottom: 20,
                borderRadius: 14, overflow: 'hidden',
                border: '1.5px solid rgba(245,158,11,0.45)',
                background: 'rgba(245,158,11,0.06)',
                animation: 'fadeSlideIn .35s ease',
              }}>
                <div style={{
                  background: 'linear-gradient(135deg,rgba(245,158,11,0.16),rgba(217,119,6,0.1))',
                  padding: '16px 20px',
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                    background: 'rgba(245,158,11,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Clock size={22} color="#b45309" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14.5, color: '#92400e', marginBottom: 3 }}>
                      {timing.isLate ? 'Behind Scheduled Start Time' : 'Ahead of Scheduled Start Time'}
                    </div>
                    <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
                      Your shift today is scheduled for <strong>{timing.formattedWindow || timing.formattedStart}</strong>.
                      {timing.isLate
                        ? ' You can still start your route as a late shift.'
                        : ' Starting now will log your shift before the scheduled window.'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── STAT CARDS ── */}
            {loading ? (
              <StatCardSkeleton count={4} style={{ marginBottom: 20 }} />
            ) : (
              <div className="stat-grid ww-stagger" style={{ marginBottom: 20 }}>
                {[
                  { label: 'Stops Done', value: displayStats.completedStops },
                  { label: 'Stops Left', value: displayStopsLeft },
                  { label: 'Distance', value: `${displayStats.distanceKm}km` },
                  { label: 'Total Stops', value: displayStats.totalStops },
                ].map(s => (
                  <div key={s.label} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                    <div className="label">{s.label}</div>
                    <div className="value" style={{ fontSize: 30 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── ROUTE PROGRESS CARD ── */}
            <div className="card dcard" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 className="section-title" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1c1e21' }}>Today's Route</h3>
                {loading ? (
                  <SkeletonPill width={76} height={20} />
                ) : (
                  <span style={{
                    background: isRouteDone ? '#e7f5eb' : isShiftEndedIncomplete ? '#fef3c7' : status === 'issue' ? '#fee2e2' : '#dbeafe',
                    color: isRouteDone ? '#15803d' : isShiftEndedIncomplete ? '#b45309' : status === 'issue' ? '#b91c1c' : '#1d4ed8',
                    border: `1px solid ${isRouteDone ? '#bbf7d0' : isShiftEndedIncomplete ? '#fde68a' : status === 'issue' ? '#fecaca' : '#bfdbfe'}`,
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '.04em',
                  }}>
                    {isRouteDone
                      ? 'COMPLETED'
                      : isShiftEndedIncomplete
                        ? 'ENDED INCOMPLETE'
                        : status === 'issue'
                          ? 'DELAYED'
                          : displayStats.totalStops === 0
                            ? 'NO SCHEDULE'
                            : shiftActive
                              ? 'IN PROGRESS'
                              : 'NOT STARTED'}
                  </span>
                )}
              </div>

              {loading ? (
                <FeedCardSkeleton count={1} compact />
              ) : (
                <div className="ww-fade-in">
                  {/* Route name / days */}
                  {schedule && (
                    <div style={{
                      fontSize: 12, color: '#65676b', marginBottom: 10,
                      display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center'
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={14} /> {formatDays(schedule.days)}</span>
                      {schedule.zone && <span>· {schedule.zone}</span>}
                      {schedule.barangay && <span>· {schedule.barangay}</span>}
                    </div>
                  )}

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: '#65676b' }}>Progress (Today)</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21' }}>
                        {displayStats.completedStops} / {displayStats.totalStops} stops
                      </span>
                    </div>
                    <div style={{ background: '#e4e6eb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        background: '#16a34a',
                        width: `${displayProgress}%`, transition: 'width .4s ease',
                      }} />
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, color: '#65676b', marginTop: 4 }}>
                      {displayProgress}% complete
                    </div>
                    {routeStats.missedStopsCollected > 0 && (
                      <div style={{ 
                        marginTop: 12, 
                        padding: '8px 12px', 
                        background: '#fef3c7', 
                        border: '1px solid #fde68a',
                        borderRadius: 6, 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#b45309'
                      }}>
                        <CheckCircle2 size={16} color="#d97706" />
                        <span>
                          {routeStats.missedStopsCollected} Missed stops collected 
                          <span style={{ opacity: 0.8, marginLeft: 6, fontSize: 11 }}>(+{routeStats.missedStopsCollected * 50} pts)</span>
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                    {[
                      { label: 'Start Time', value: displayStats.startTime },
                      { label: 'Est. End', value: displayStats.estEnd },
                      { label: 'Distance', value: `${displayStats.distanceKm} km` },
                    ].map(item => (
                      <div key={item.label} style={{
                        background: '#f0f2f5', border: '1px solid #e4e6eb', borderRadius: 6, padding: '10px', textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── STATUS TOGGLE + CTA ── */}
            <div className="status-card-mobile-only">
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h3 className="section-title" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1c1e21' }}>Current Status</h3>
                  {!shiftActive && <span style={{ fontSize: 12, color: '#65676b' }}>Start shift to update</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                  {STATUSES.map(s => {
                    const isActive = status === s.key
                    return (
                      <button key={s.key} id={`status-${s.key}`} className="abtn"
                        onClick={() => shiftActive && setStatus(s.key)}
                        style={{
                          padding: '10px 4px', borderRadius: 6,
                          background: isActive ? '#ffffff' : '#f0f2f5',
                          border: `1.5px solid ${isActive ? '#16a34a' : '#e4e6eb'}`,
                          color: isActive ? '#15803d' : '#65676b',
                          fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                          boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
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
                  disabled={(!shiftActive && user?.is_suspended) || (!shiftActive && !hasScheduleToday) || (!shiftActive && isShiftDone)}
                  style={{
                    flex: 2, padding: '12px 18px', borderRadius: 6,
                    fontSize: 14, fontWeight: 700,
                    background: (!shiftActive && (user?.is_suspended || !hasScheduleToday || isShiftDone))
                      ? '#e4e6eb'
                      : (!shiftActive && timing.isOffSchedule)
                        ? '#d97706'
                        : '#16a34a',
                    color: (!shiftActive && (user?.is_suspended || !hasScheduleToday || isShiftDone)) ? '#8a8d91' : '#ffffff',
                    border: 'none',
                    cursor: (!shiftActive && (user?.is_suspended || !hasScheduleToday || isShiftDone)) ? 'not-allowed' : 'pointer',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center' }}>
                    {!shiftActive && user?.is_suspended && <Ban size={18} />}
                    {!shiftActive && !user?.is_suspended && !hasScheduleToday && <Ban size={18} />}
                    {!shiftActive && hasScheduleToday && isShiftDone && <CheckCircle2 size={18} />}
                    {shiftActive && <Truck size={18} />}
                    {!shiftActive && !user?.is_suspended && hasScheduleToday && !isShiftDone && timing.isOffSchedule && <Clock size={18} />}
                    {!shiftActive && !user?.is_suspended && hasScheduleToday && !isShiftDone && !timing.isOffSchedule && <Play size={18} fill="currentColor" />}
                    <span>
                      {!shiftActive && user?.is_suspended
                        ? 'Account Suspended'
                        : !shiftActive && !hasScheduleToday
                          ? 'No Collection Today'
                          : !shiftActive && isRouteDone
                            ? 'Route Completed'
                            : !shiftActive && isShiftEndedIncomplete
                              ? 'Shift Ended Early'
                              : shiftActive
                                ? 'Resume Route'
                                : timing.ctaLabel}
                    </span>
                  </div>
                </button>
                {shiftActive && (
                  <button id="driver-end-shift" className="abtn btn"
                    onClick={handleShiftToggle}
                    style={{
                      flex: 1, padding: '12px 14px', borderRadius: 6,
                      fontSize: 13, fontWeight: 600,
                      background: '#fee2e2', border: '1px solid #fecaca',
                      color: '#b91c1c', cursor: 'pointer',
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Collection Schedule</h3>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button onClick={() => navigate('/driver/route')}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapIcon size={14} /> Route Overview
                  </button>
                  <button onClick={() => navigate('/driver/log')}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ClipboardList size={14} /> Weekly Summary
                  </button>
                </div>
              </div>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                  <div style={{ padding: 16 }}>
                    <SidebarWidgetSkeleton rows={3} />
                  </div>
                ) : scheduleRows.length === 0 ? (
                  <div className="ww-fade-in" style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No schedule assigned yet.
                  </div>
                ) : (
                  <div className="ww-stagger">
                    {scheduleRows.map((s, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
                        borderBottom: i < scheduleRows.length - 1 ? '1px solid var(--border)' : 'none',
                        background: s.isToday ? 'rgba(46,204,113,0.04)' : 'transparent',
                      }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                          background: s.done ? 'rgba(46,204,113,0.12)' : s.isPast ? 'rgba(148,163,184,0.15)' : s.isToday ? 'rgba(59,130,246,0.1)' : 'var(--surface-2)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                        }}>
                          {s.done ? <CheckCircle2 size={18} color="var(--accent)" /> : s.isPast ? <Calendar size={18} color="#64748b" /> : s.isToday ? <Truck size={18} color="var(--info)" /> : <Calendar size={18} color="var(--text-muted)" />}
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
                              : s.isPast
                                ? 'rgba(148,163,184,0.15)'
                                : s.isToday
                                  ? 'rgba(59,130,246,0.1)'
                                  : s.time === '—'
                                    ? 'rgba(148,163,184,0.1)'
                                    : 'rgba(243,156,18,0.1)',
                            color: s.done
                              ? 'var(--accent)'
                              : s.isPast
                                ? '#64748b'
                                : s.isToday
                                  ? 'var(--info)'
                                  : s.time === '—'
                                    ? 'var(--text-muted)'
                                    : 'var(--warning)',
                          }}>
                            {s.done ? 'DONE' : s.isPast ? 'MISSED' : s.isToday ? 'ACTIVE' : s.time === '—' ? 'N/A' : 'UPCOMING'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
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
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Quick Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  id="driver-desktop-cta"
                  className="abtn btn btn-full"
                  onClick={() => shiftActive ? navigate('/driver/flow') : handleShiftToggle()}
                  disabled={loading || (!shiftActive && user?.is_suspended) || (!shiftActive && !hasScheduleToday) || (!shiftActive && isShiftDone)}
                  style={{
                    background: (!shiftActive && (user?.is_suspended || !hasScheduleToday || isShiftDone))
                      ? '#e4e6eb'
                      : (!shiftActive && timing.isOffSchedule)
                        ? '#d97706'
                        : '#16a34a',
                    border: 'none',
                    color: (!shiftActive && (user?.is_suspended || !hasScheduleToday || isShiftDone)) ? '#8a8d91' : '#ffffff',
                    fontWeight: 700,
                    borderRadius: 6,
                    padding: '10px 12px',
                    minHeight: 38,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    fontSize: 13,
                    textAlign: 'center',
                    lineHeight: 1.3,
                    cursor: (!shiftActive && (user?.is_suspended || !hasScheduleToday || isShiftDone)) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {!shiftActive && user?.is_suspended && <Ban size={15} style={{ flexShrink: 0 }} />}
                  {!shiftActive && !user?.is_suspended && !hasScheduleToday && <Ban size={15} style={{ flexShrink: 0 }} />}
                  {!shiftActive && hasScheduleToday && isShiftDone && <CheckCircle2 size={15} style={{ flexShrink: 0 }} />}
                  {shiftActive && <Truck size={15} style={{ flexShrink: 0 }} />}
                  {!shiftActive && !user?.is_suspended && hasScheduleToday && !isShiftDone && timing.isOffSchedule && <Clock size={15} style={{ flexShrink: 0 }} />}
                  {!shiftActive && !user?.is_suspended && hasScheduleToday && !isShiftDone && !timing.isOffSchedule && <Play size={15} fill="currentColor" style={{ flexShrink: 0 }} />}
                  <span>
                    {!shiftActive && user?.is_suspended
                      ? 'Account Suspended'
                      : !shiftActive && !hasScheduleToday
                        ? 'No Collection Today'
                        : !shiftActive && isRouteDone
                          ? 'Route Completed'
                          : !shiftActive && isShiftEndedIncomplete
                            ? 'Shift Ended Early'
                            : shiftActive
                              ? 'Resume Route'
                              : timing.ctaLabel}
                  </span>
                </button>
                <button className="abtn btn btn-full" onClick={() => navigate('/driver/route')}
                  style={{
                    background: '#ffffff', border: '1px solid #ced0d4',
                    color: '#1c1e21', fontWeight: 600, borderRadius: 6, height: 36,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 13,
                  }}>
                  <MapIcon size={16} color="#16a34a" /> Route Overview
                </button>
                <button className="abtn btn btn-full" onClick={() => navigate('/driver/log')}
                  style={{
                    background: '#ffffff', border: '1px solid #ced0d4', fontWeight: 600,
                    color: '#1c1e21', borderRadius: 6, height: 36,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 13,
                  }}>
                  <ClipboardList size={16} color="#65676b" /> Weekly Summary
                </button>
              </div>
            </div>

            {/* Route Summary */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Route Summary</h3>
              {loading ? (
                <SidebarWidgetSkeleton rows={3} />
              ) : (
                <div className="ww-stagger">
                  {[
                    { label: 'Stops Done', value: displayStats.completedStops, color: '#16a34a' },
                    { label: 'Stops Left', value: displayStopsLeft, color: '#d97706' },
                    { label: 'Total Stops', value: displayStats.totalStops, color: '#1c1e21' },
                    { label: 'Distance', value: `${displayStats.distanceKm} km`, color: '#2563eb' },
                  ].map(s => (
                    <div key={s.label} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 0', borderBottom: '1px solid #e4e6eb',
                    }}>
                      <span style={{ fontSize: 12, color: '#65676b' }}>{s.label}</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: s.color }}>
                        {s.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Collection Schedule */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Collection Schedule</h3>
              {loading ? (
                <SidebarWidgetSkeleton rows={3} />
              ) : scheduleRows.length === 0 ? (
                <div className="ww-fade-in" style={{ color: '#65676b', fontSize: 13 }}>No schedule.</div>
              ) : (
                <div className="ww-stagger">
                  {scheduleRows.map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                      borderBottom: i < scheduleRows.length - 1 ? '1px solid #e4e6eb' : 'none',
                    }}>
                      <span style={{ fontSize: 14 }}>
                        {s.done ? <CheckCircle2 size={16} color="#16a34a" /> : s.isToday ? <Truck size={16} color="#2563eb" /> : <Calendar size={16} color="#8a8d91" />}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1c1e21' }}>{s.day}</div>
                        <div style={{ fontSize: 11, color: '#65676b' }}>{s.zone}</div>
                      </div>
                      <div style={{ fontSize: 11, color: '#65676b', textAlign: 'right' }}>{s.time}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Driver Profile */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 14, fontWeight: 700, color: '#1c1e21' }}>Your Profile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginBottom: 2 }}>Name</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1c1e21' }}>{user?.full_name || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginBottom: 2 }}>Email</div>
                  <div style={{ fontSize: 13, color: '#65676b' }}>{user?.email}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginBottom: 2 }}>Truck</div>
                  <div style={{ fontSize: 14, color: '#1c1e21' }}>{profile.truck}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginBottom: 2 }}>Status</div>
                  <span style={{
                    background: activeStatus.bg, color: activeStatus.color,
                    border: `1px solid ${activeStatus.color}55`,
                    fontSize: 10, fontWeight: 700, padding: '3px 8px',
                    borderRadius: 4, letterSpacing: '.04em', display: 'inline-block',
                  }}>
                    {activeStatus.label.toUpperCase()}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginBottom: 2 }}>Role</div>
                  <span style={{
                    background: '#dbeafe', color: '#1d4ed8',
                    border: '1px solid #bfdbfe',
                    fontSize: 10, fontWeight: 700, padding: '3px 8px',
                    borderRadius: 4, letterSpacing: '.04em', display: 'inline-block',
                  }}>DRIVER</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginTop: 6, marginBottom: 2 }}>Trust Score / Points</div>
                  <div style={{
                    fontSize: 20, fontWeight: 700, 
                    color: user?.points < 0 ? '#dc2626' : user?.points < 500 ? '#d97706' : '#16a34a',
                  }}>
                    {user?.points !== undefined ? user.points : '—'}
                  </div>
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

      {/* ── MANDATORY ACKNOWLEDGMENT MODAL ── */}
      {blockingEscalation && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0,0,0,0.6)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 16, width: '100%', maxWidth: 400,
            overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            animation: 'fadeSlideIn .3s ease'
          }}>
            <div style={{
              background: 'linear-gradient(135deg, #ef4444, #dc2626)', padding: '24px 20px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              color: '#fff', textAlign: 'center'
            }}>
              <div style={{
                width: 54, height: 54, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <AlertTriangle size={28} color="#fff" />
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Formal Warning Issued</h2>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ margin: '0 0 16px 0', fontSize: 14, lineHeight: 1.5, color: 'var(--text)' }}>
                An escalation has been approved against your shift profile.
              </p>
              <div style={{
                background: 'var(--surface-2)', padding: 12, borderRadius: 8, marginBottom: 20,
                border: '1px solid var(--border)'
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Reason</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{blockingEscalation.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, marginBottom: 4 }}>Penalty</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)' }}>
                  -{blockingEscalation.points_deducted} Points
                </div>
              </div>
              <p style={{ margin: '0 0 24px 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                You must acknowledge this warning to continue using your dashboard. Repeated escalations may lead to suspension.
              </p>
              <button 
                className="abtn btn btn-primary btn-full" 
                onClick={handleAcknowledge}
                disabled={ackLoading}
                style={{ fontSize: 14, padding: 14, background: '#dc2626', borderColor: '#dc2626' }}
              >
                {ackLoading ? 'Acknowledging...' : 'I Acknowledge'}
              </button>
            </div>
          </div>
        </div>
      )}
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
