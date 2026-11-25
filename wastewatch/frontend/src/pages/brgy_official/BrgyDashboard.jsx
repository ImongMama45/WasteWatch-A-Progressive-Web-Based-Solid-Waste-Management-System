/**
 * BrgyDashboard.jsx — Barangay Official Dashboard (Revised UI)
 * Route: /brgy/dashboard
 *
 * Key changes from previous version:
 *  - "Escalate to Admin" is now a button that navigates to /brgy/escalate
 *  - Appears as 3rd action inside expanded truck card ONLY when missedYesterday=true
 *  - Improved visual hierarchy, tab pill design, card consistency
 *  - Filter pills on report validation tab
 *  - Status badges on schedule
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import MiniMap from '../../components/MiniMap'
import { useAuth } from '../../context/AuthContext'
import { useEscalations } from '../../hooks/useEscalations'
import { useNotification } from '../../context/NotificationContext'
import HomeCarousel from '../../components/carousel/HomeCarousel'
import { ICONS } from '../../api/navConfig'
import { getApiErrorMessage } from '../../utils/notificationHelpers'
import api from '../../api/client'
import DispatchCard from '../../components/DispatchCard'
import OfflineReportBuilder from '../../components/OfflineReportBuilder'
import { useOfflineReports } from '../../hooks/useOfflineReports'
import { useBarangayTracker } from '../../hooks/useBarangayTracker'
import LiveTrackerCard from '../../components/analytics/LiveTrackerCard'
import { StatCardSkeleton, FeedCardSkeleton, SidebarWidgetSkeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'
import { useCalendarEntries } from '../../hooks/useCalendarEntries'
import { formatToManilaDateString } from '../../api/calendarService'

/**
 * Resolves a positive integer barangay ID from authenticated user profiles.
 * Rejects 0, negatives, decimals, booleans, and non-numeric identifiers.
 */
export function resolveBarangayId(user) {
  if (!user || typeof user !== 'object') return null
  const candidate = user.barangay_id ?? (typeof user.barangay === 'object' && user.barangay !== null ? user.barangay.id : user.barangay)
  if (candidate === null || candidate === undefined || typeof candidate === 'boolean') return null

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }

  if (typeof candidate === 'number') {
    return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null
  }

  return null
}

/**
 * Calculates a bounded 14-day upcoming collection schedule window
 * anchored to Asia/Manila (today + 13 following calendar dates = exactly 14 inclusive days).
 */
export function calculateBrgyScheduleDateRange(referenceDate = new Date()) {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate)
  const todayFormatted = formatToManilaDateString(now)
  const [y, m, d] = todayFormatted.split('-').map(Number)
  const anchorDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const future = new Date(anchorDate.getTime() + 13 * 24 * 60 * 60 * 1000)
  const futureFormatted = formatToManilaDateString(future)
  return {
    startDateStr: todayFormatted,
    endDateStr: futureFormatted,
    todayStr: todayFormatted,
  }
}

/**
 * Formats an ISO datetime string into Asia/Manila date components.
 */
export function formatOccurrenceDate(isoString, todayDateStr) {
  if (!isoString) return { dayName: '', dateDisplay: '', isToday: false, isTomorrow: false, dateStr: '' }
  const dateStr = isoString.slice(0, 10)
  const isToday = dateStr === todayDateStr
  const [y, m, d] = dateStr.split('-').map(Number)
  const dateObj = new Date(y, m - 1, d)

  let isTomorrow = false
  if (todayDateStr) {
    const [ty, tm, td] = todayDateStr.split('-').map(Number)
    const todayObj = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0))
    const tomorrowObj = new Date(todayObj.getTime() + 24 * 60 * 60 * 1000)
    const tomorrowStr = formatToManilaDateString(tomorrowObj)
    isTomorrow = dateStr === tomorrowStr
  }

  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' })
  const dateDisplay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { dateStr, dayName, dateDisplay, isToday, isTomorrow }
}

/**
 * Formats start and end ISO timestamps into a 12-hour time window (e.g. '6:00 AM – 10:00 AM').
 */
export function formatOccurrenceTime(startIso, endIso) {
  if (!startIso) return '—'
  const extractTime = (iso) => {
    if (!iso) return ''
    const timePart = iso.slice(11, 16)
    if (!timePart) return ''
    const [hStr, mStr] = timePart.split(':')
    const h = parseInt(hStr, 10), m = mStr || '00'
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${m} ${ampm}`
  }
  const s = extractTime(startIso)
  const e = extractTime(endIso)
  if (s && e) return `${s} – ${e}`
  return s || '—'
}

/**
 * Returns accessible styling and labels for occurrence completion statuses.
 * Preserves strict distinction between driver operational completion and watcher-verified collection.
 */
export function getOccurrenceStatusBadge(status, isToday) {
  switch (status) {
    case 'verified_collected':
      return {
        label: 'VERIFIED COLLECTED',
        color: '#15803d',
        bg: '#e7f5eb',
        border: '#bbf7d0',
      }
    case 'operationally_completed':
      return {
        label: 'REPORTED COMPLETE',
        color: '#0369a1',
        bg: '#f0f9ff',
        border: '#bae6fd',
      }
    case 'in_progress':
      return {
        label: isToday ? "TODAY'S PICKUP" : 'IN PROGRESS',
        color: '#b45309',
        bg: '#fffbeb',
        border: '#fde68a',
      }
    case 'scheduled':
    default:
      if (isToday) {
        return {
          label: 'TODAY',
          color: '#16a34a',
          bg: '#f0fdf4',
          border: '#bbf7d0',
        }
      }
      return {
        label: 'SCHEDULED',
        color: '#475569',
        bg: '#f1f5f9',
        border: '#cbd5e1',
      }
  }
}

/**
 * Selects the nearest relevant collection occurrence for a Barangay Official.
 * Prioritizes active/scheduled collections today, then the earliest upcoming collection in the future.
 */
export function selectNextPickupOccurrence(entries = [], todayDateStr) {
  if (!Array.isArray(entries) || entries.length === 0) return null

  // 1. Look for today's active/upcoming collection first (scheduled or in_progress)
  const todayActive = entries.find(e => {
    const dStr = (e.start_datetime || e.start || '').slice(0, 10)
    return dStr === todayDateStr && (e.status === 'scheduled' || e.status === 'in_progress')
  })
  if (todayActive) return todayActive

  // 2. If no active collection today, look for earliest upcoming occurrence in the future (date > today)
  const futureUpcoming = entries.find(e => {
    const dStr = (e.start_datetime || e.start || '').slice(0, 10)
    return dStr > todayDateStr && e.status !== 'cancelled'
  })
  if (futureUpcoming) return futureUpcoming

  // 3. If today had a collection that was already completed/verified, and no future occurrence in window
  const todayFinished = entries.find(e => {
    const dStr = (e.start_datetime || e.start || '').slice(0, 10)
    return dStr === todayDateStr
  })
  if (todayFinished) return todayFinished

  // 4. Fallback to first entry in chronological list
  return entries[0] || null
}

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_PENDING_REPORTS = [
  {
    id: 'R001', type: 'overflow', address: 'Corner Main St & 5th Ave',
    reporter: 'Juan Watcher', date: '2026-04-19', photo: true,
    description: 'Large pile of garbage overflowing near the corner.',
    tags: ['Near Market', 'Side Road'],
  },
  {
    id: 'R002', type: 'illegal_dumping', address: 'Barangay Hall Side Gate',
    reporter: 'Maria Santos', date: '2026-04-19', photo: true,
    description: 'Someone dumped construction waste overnight.',
    tags: ['Residential'],
  },
  {
    id: 'R003', type: 'missed', address: 'Zone 3 — Purok 2',
    reporter: 'Pedro Reyes', date: '2026-04-18', photo: false,
    description: 'Truck did not come on Monday despite being scheduled.',
    tags: ['Residential'],
  },
]

const ISSUE_LABELS = { overflow: 'Overflow', illegal_dumping: 'Illegal Dumping', missed: 'Missed Collection' }
const ISSUE_ICONS = { overflow: ICONS.trash, illegal_dumping: ICONS.hotspot, missed: ICONS.box }

const STATUS_BADGE = {
  pending: { label: 'PENDING', color: 'var(--warning)', bg: 'rgba(243,156,18,0.1)' },
  approved: { label: 'APPROVED', color: 'var(--accent)', bg: 'rgba(46,204,113,0.1)' },
  rejected: { label: 'REJECTED', color: 'var(--danger)', bg: 'rgba(231,76,60,0.1)' },
  resolved: { label: 'RESOLVED', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags
  if (!tags) return []
  return String(tags).split(',').map(t => t.trim()).filter(Boolean)
}

function formatReportDate(createdAt) {
  if (!createdAt) return '—'
  return new Date(createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function getIssueType(report) {
  return report.issue_type || report.type
}

const STATUS_COLORS = { collecting: '#22c55e', en_route: '#f59e0b', idle: '#94a3b8', done: '#3b82f6' }
const STATUS_LABELS = { collecting: 'Collecting', en_route: 'En Route', idle: 'Idle', done: 'Done' }

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function BrgyDashboard() {
  const { user } = useAuth()
  const { notify } = useNotification()
  const trucksRef = useRef(null)
  const navigate = useNavigate()
  const { items: escalations } = useEscalations()
  const { addReport } = useOfflineReports()

  const userBrgyId = useMemo(() => resolveBarangayId(user), [user])
  const tracker = useBarangayTracker(userBrgyId)

  // 14-day upcoming collection schedule window anchored to Asia/Manila (today through today + 13 days)
  const { startDateStr, endDateStr, todayStr } = useMemo(() => {
    return calculateBrgyScheduleDateRange()
  }, [])

  // Authoritative Calendar Service integration for Barangay Official
  const {
    entries: calendarEntries,
    loading: calendarLoading,
    error: calendarError,
    refresh: refreshCalendar,
    isRefreshing: isCalendarRefreshing,
    isFromCache: isCalendarFromCache,
    isStale: isCalendarStale,
    isCapacityError: isCalendarCapacityError,
    isNetworkError: isCalendarNetworkError,
  } = useCalendarEntries({
    startDate: startDateStr,
    endDate: endDateStr,
    barangayId: userBrgyId,
    source: 'collection_schedule',
    paginate: false,
    autoFetch: Boolean(userBrgyId),
  })

  const nextPickup = useMemo(() => selectNextPickupOccurrence(calendarEntries, todayStr), [calendarEntries, todayStr])

  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, resolved: 0 })
  const [loading, setLoading] = useState(true)
  const [allReports, setAllReports] = useState([])
  const [reportPage, setReportPage] = useState(1)
  const [reportTotalCount, setReportTotalCount] = useState(0)
  const [reportTotalPages, setReportTotalPages] = useState(1)
  const [trucks, setTrucks] = useState([])
  const [activeMainTab, setActiveMainTab] = useState('validation')
  const [reportFilter, setReportFilter] = useState('Pending')
  const [expandedTruck, setExpandedTruck] = useState(null)
  const [toast, setToast] = useState(null)
  const [activeDispatch, setActiveDispatch] = useState(null)
  const [showBuilder, setShowBuilder] = useState(false)

  useEffect(() => {
    fetchStats()
    fetchReports()
    async function fetchLiveDispatch() {
      try {
        const liveRes = await api.get('/api/public/live/')

        if (liveRes.data) {
          const userBrgy = user?.barangay_name || user?.barangay?.name
          if (userBrgy) {
            const dispatched = liveRes.data.find(d => d.barangays && d.barangays.includes(userBrgy))
            if (dispatched) setActiveDispatch(dispatched)
          }

          const mappedTrucks = liveRes.data.map(d => ({
            id: d.id,
            label: d.truck_plate !== 'Unknown' ? `Truck ${d.truck_plate}` : 'Unknown Truck',
            driver: d.driver_name,
            status: d.op_status === 'en_route' ? 'en_route' : d.op_status === 'collecting' ? 'collecting' : 'idle',
            scheduledTime: '—',
            actualTime: d.started_at ? new Date(d.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—',
            stopsCompleted: 0,
            totalStops: 0,
            missedYesterday: false,
            capacity: 0,
            truckId: d.truck_id,
            driverId: d.driver_id,
          }))
          setTrucks(mappedTrucks)
        }
      } catch (err) { /* silent */ }
    }
    fetchLiveDispatch()
  }, [user?.barangay_name, user?.barangay?.name])

  async function fetchStats() {
    try {
      const res = await api.get('/api/watcher/reports/stats/')
      setStats(res.data)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }

  async function fetchReports() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('page', reportPage)
      params.append('page_size', '10')
      if (reportFilter && reportFilter !== 'All') {
        params.append('status', reportFilter.toLowerCase())
      }
      const res = await api.get(`/api/watcher/reports/?${params.toString()}`)
      if (res.data?.results) {
        setAllReports(res.data.results)
        setReportTotalCount(res.data.count || 0)
        setReportTotalPages(res.data.total_pages || 1)
        if (res.data.summary) {
          setStats(prev => ({ ...prev, ...res.data.summary }))
        }
      } else if (Array.isArray(res.data)) {
        setAllReports(res.data)
        setReportTotalCount(res.data.length)
        setReportTotalPages(Math.ceil(res.data.length / 10) || 1)
      }
    } catch (err) {
      console.error('Failed to fetch reports:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [reportPage, reportFilter])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    if (activeMainTab !== "trucks") return
    const timer = setTimeout(() => {
      trucksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 80)
    return () => clearTimeout(timer)
  }, [activeMainTab])

  const pendingCount = stats.pending ?? allReports.filter(r => r.status === 'pending').length
  const missedCount = trucks.filter(t => t.missedYesterday).length

  const filteredReports = allReports

  return (
    <>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity:0; transform:translateY(-8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes slideDown {
          from { opacity:0; transform:translateY(-5px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .bcard { transition: box-shadow .18s, border-color .18s; }
        .bcard:hover { box-shadow: 0 4px 18px rgba(0,0,0,.09); }
        .abtn { transition: opacity .15s, transform .1s; cursor:pointer; }
        .abtn:hover { opacity:.88; }
        .abtn:active { transform:scale(.97); }
        .fpill { transition: all .15s; cursor:pointer; }
        .fpill:hover { opacity:.85; }
      `}</style>

      {/* ── Toast notification ── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 22px',
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(20,184,166,0.3)',
          boxShadow: '0 8px 32px rgba(0,0,0,.35)',
          whiteSpace: 'nowrap', animation: 'fadeSlideIn .2s',
        }}>
          {toast}
        </div>
      )}

      <div className="page ww-page-enter">

        {/* ── PAGE HEADER WITH CORNER LIVE TRACKER ── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 20,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                Barangay Dashboard
              </h2>
              <span style={{
                background: 'rgba(46,204,113,0.1)', color: 'var(--accent)',
                border: '1px solid rgba(46,204,113,0.28)',
                fontSize: 9, fontWeight: 800, padding: '3px 10px',
                borderRadius: 20, letterSpacing: '.08em',
              }}>OFFICIAL</span>
            </div>
            <p className="text-muted text-sm">
              {user?.barangay_name || 'Your Barangay'} · Monitor, validate &amp; coordinate
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {tracker.loading ? (
              <LiveTrackerCard loading />
            ) : tracker.data?.trucks?.length > 0 ? (
              tracker.data.trucks.map(t => <LiveTrackerCard key={t.schedule_id} truck={t} />)
            ) : (
              <DispatchCard
                dispatchData={activeDispatch}
                userBarangay={user?.barangay_name || user?.barangay?.name}
              />
            )}
          </div>
        </div>

        <div className='mobile-schedule'>
          <HomeCarousel role="brgy_official" userBarangay={user?.barangay_name} onReport={() => setShowBuilder(true)} extraSecondCta={{ label: 'Validate', onClick: () => navigate('/brgy/validate-reports') }} />
        </div>

        <div className="page-grid">

          {/* ════════════════════════════════════════
              MAIN COLUMN
          ════════════════════════════════════════ */}
          <div>

            {/* ── STAT CARDS ── */}
            {loading ? (
              <StatCardSkeleton count={4} useStatGridClass style={{ marginBottom: 20 }} />
            ) : (
              <div className="stat-grid ww-fade-in" style={{ marginBottom: 20 }}>
                {[
                  { label: 'Pending Validation', value: pendingCount, color: 'var(--card)' },
                  { label: 'Approved', value: stats.approved || 0, color: 'var(--card)' },
                  { label: 'Rejected', value: stats.rejected || 0, color: 'var(--card)' },
                  { label: 'Missed Pickups', value: missedCount, color: 'var(--card)' },
                ].map(s => (
                  <div key={s.label} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 12, right: 14, fontSize: 18, opacity: .15 }}>{s.icon}</div>
                    <div className="label">{s.label}</div>
                    <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── MISSED COLLECTION ALERT BAR ── */}
            {missedCount > 0 && (
              <div style={{
                background: 'rgba(231,76,60,0.05)',
                border: '1.5px solid rgba(231,76,60,0.28)',
                borderRadius: 12, padding: '12px 16px', marginBottom: 18,
                display: 'flex', alignItems: 'center', gap: 12,
                animation: 'fadeSlideIn .25s',
              }}>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)', marginBottom: 1 }}>
                    {missedCount} missed collection{missedCount > 1 ? 's' : ''} detected yesterday
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Review Truck Monitor — flag or escalate to Admin if needed.
                  </div>
                </div>
                <button className="abtn"
                  onClick={() => setActiveMainTab('trucks')}
                  style={{
                    background: 'var(--danger)', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}>
                  Review
                </button>
              </div>
            )}

            {/* ── LIVE MAP ── */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Live Collection Map</h3>
                <button onClick={() => navigate('/map')}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer'
                  }}>
                  Full View ›
                </button>
              </div>
              <MiniMap />
            </div>

            {/* ── MAIN TABS — pill style ── */}
            <div style={{
              display: 'flex', gap: 4, marginBottom: 16,
              background: 'var(--surface-2)', borderRadius: 10, padding: 4,
              width: 'fit-content', flexWrap: 'wrap',
            }}>
              {[
                { key: 'validation', label: 'Validate Reports', badge: pendingCount || null },
                { key: 'trucks', label: 'Truck Monitor', badge: missedCount > 0 ? '!' : null },
                { key: 'schedule', label: 'Schedule' },
              ].map(t => (
                <button key={t.key}
                  className="abtn"
                  onClick={() => setActiveMainTab(t.key)}
                  style={{
                    position: 'relative', padding: '8px 16px', borderRadius: 8,
                    border: 'none', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                    background: activeMainTab === t.key ? 'var(--surface-3)' : 'transparent',
                    color: activeMainTab === t.key ? '#fff' : 'var(--text-muted)',
                    boxShadow: activeMainTab === t.key ? '0 2px 8px rgba(0,0,0,.15)' : 'none',
                  }}>
                  {t.label}
                  {t.badge && (
                    <span style={{
                      position: 'absolute', top: 5, right: 5,
                      minWidth: 15, height: 15, background: t.badge === '!' ? 'var(--danger)' : 'var(--warning)',
                      color: '#fff', fontSize: 8, fontWeight: 800, borderRadius: 20,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                    }}>{t.badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ════════════════════════════════════════
                TAB 1 — REPORT VALIDATION
            ════════════════════════════════════════ */}
            {activeMainTab === 'validation' && (
              <div style={{ animation: 'slideDown .2s' }}>

                {/* Filter pills */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  {['All', 'Pending', 'Approved', 'Rejected'].map(f => (
                    <button key={f} className="fpill"
                      onClick={() => {
                        setReportFilter(f)
                        setReportPage(1)
                      }}
                      style={{
                        padding: '5px 14px', borderRadius: 20, border: '1px solid',
                        fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                        borderColor: reportFilter === f ? 'var(--accent)' : 'var(--border)',
                        color: reportFilter === f ? 'var(--accent)' : 'var(--text-muted)',
                        background: reportFilter === f ? 'rgba(46,204,113,0.08)' : 'transparent',
                      }}>
                      {f}
                    </button>
                  ))}

                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    marginLeft: 6
                  }}>
                    <span>
                      Showing <strong style={{ color: 'var(--text)' }}>
                        {reportTotalCount === 0 ? 0 : (reportPage - 1) * 10 + 1}–{Math.min(reportPage * 10, reportTotalCount)}
                      </strong> of <strong style={{ color: 'var(--text)' }}>{reportTotalCount}</strong>
                    </span>
                    <span
                      className="ww-pagination-ratio"
                      style={{
                        background: 'var(--surface-2, #f1f5f9)',
                        border: '1px solid var(--border, #cbd5e1)',
                        color: 'var(--accent, #10b981)',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 800
                      }}
                    >
                      {filteredReports.length}/{reportTotalCount}
                    </span>
                  </div>

                  <button onClick={() => navigate('/brgy/validate-reports')}
                    style={{
                      border: '1px dashed var(--border)', borderRadius: 20,
                      padding: '11px', fontSize: 12, fontWeight: 600,
                      marginLeft: 'auto', background: 'transparent',
                      color: 'var(--text-muted)', cursor: 'pointer', marginTop: 4,
                      fontFamily: 'var(--font-body)',
                    }}>
                    View All Reports
                  </button>
                </div>

                {loading ? (
                  <FeedCardSkeleton count={3} compact />
                ) : filteredReports.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--accent)' }}>
                      <div style={{ width: 42, height: 42 }}>{ICONS.check}</div>
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>No reports found</div>
                    <div className="text-muted text-sm">
                      {reportFilter === 'Pending' ? 'No pending reports to validate.' : `No ${reportFilter.toLowerCase()} reports.`}
                    </div>
                  </div>
                ) : (
                  <div className="ww-stagger">
                    {filteredReports.map(report => {
                      const issueType = getIssueType(report)
                      const statusBadge = STATUS_BADGE[report.status] || STATUS_BADGE.pending
                      const tags = parseTags(report.tags)

                      return (
                        <div key={report.id} className="bcard"
                          style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 14, marginBottom: 10,
                            overflow: 'hidden', cursor: 'pointer',
                            transition: 'border-color 0.2s, box-shadow 0.2s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.05)' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
                          onClick={() => navigate('/brgy/validate-reports')}
                        >
                          {/* Row */}
                          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{
                              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                              background: issueType === 'overflow' ? 'rgba(239,68,68,0.1)'
                                : issueType === 'illegal_dumping' ? 'rgba(243,156,18,0.1)'
                                  : 'rgba(93,173,226,0.1)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <div style={{ width: 20, height: 20, color: 'var(--accent)' }}>
                                {ISSUE_ICONS[issueType]}
                              </div>
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 2 }}>
                                <span style={{ fontWeight: 700, fontSize: 14 }}>{ISSUE_LABELS[issueType] || issueType}</span>
                                <span style={{
                                  background: statusBadge.bg, color: statusBadge.color,
                                  fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20, letterSpacing: '.05em',
                                }}>{statusBadge.label}</span>
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{report.address || report.barangay_name || 'No address'}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                                {report.user_name || 'Community Report'} · {formatReportDate(report.created_at || report.date)}
                              </div>
                            </div>

                            <div style={{
                              fontSize: 16, color: 'var(--text-muted)', flexShrink: 0,
                            }}>›</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <Pagination
                  currentPage={reportPage}
                  totalPages={reportTotalPages}
                  totalCount={reportTotalCount}
                  pageSize={10}
                  onPageChange={setReportPage}
                  loading={loading}
                />
              </div>
            )}

            {/* ════════════════════════════════════════
                TAB 2 — TRUCK MONITOR
            ════════════════════════════════════════ */}
            {activeMainTab === 'trucks' && (
              <div ref={trucksRef} style={{ animation: 'slideDown .2s' }}>
                <button onClick={() => navigate('/')}
                  style={{
                    display: 'block',
                    marginBottom: 14,
                    border: '1px dashed var(--border)', borderRadius: 20,
                    padding: '11px', fontSize: 12, fontWeight: 600,
                    marginLeft: 'auto', background: 'transparent',
                    color: 'var(--text-muted)', cursor: 'pointer', marginTop: 4,
                    fontFamily: 'var(--font-body)',
                  }}>
                  View Trucks In Area
                </button>

                {trucks.map(truck => (
                  <div key={truck.id} className="bcard"
                    style={{
                      background: 'var(--surface)',
                      border: truck.missedYesterday
                        ? '1.5px solid rgba(231,76,60,0.4)' : '1px solid var(--border)',
                      borderRadius: 14, marginBottom: 10,
                      overflow: 'hidden', cursor: 'pointer',
                    }}
                    onClick={() => setExpandedTruck(p => p === truck.id ? null : truck.id)}
                  >
                    {/* Row */}
                    <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                        background: 'var(--surface-2)', color: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <div style={{ width: 20, height: 20 }}>{ICONS.truck}</div>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{truck.label}</span>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            background: `${STATUS_COLORS[truck.status]}18`,
                            border: `1px solid ${STATUS_COLORS[truck.status]}55`,
                            color: STATUS_COLORS[truck.status],
                            fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20, letterSpacing: '.04em',
                          }}>
                            <span style={{
                              width: 5, height: 5, borderRadius: '50%',
                              background: STATUS_COLORS[truck.status], display: 'inline-block',
                            }} />
                            {STATUS_LABELS[truck.status]}
                          </span>
                          {truck.missedYesterday && (
                            <span style={{
                              background: 'rgba(231,76,60,0.1)', color: 'var(--danger)',
                              fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                            }}>MISSED</span>
                          )}
                          {truck.flagged && (
                            <span style={{
                              background: 'rgba(243,156,18,0.1)', color: 'var(--warning)',
                              fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                            }}>FLAGGED</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {truck.driver} · Sched. {truck.scheduledTime}
                          {truck.actualTime !== '—' ? ` · Started ${truck.actualTime}` : ''}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 6 }}>
                        <div style={{ fontSize: 15, fontWeight: 800 }}>
                          {truck.stopsCompleted}
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}>
                            /{truck.totalStops}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>stops</div>
                      </div>

                      <div style={{
                        fontSize: 16, color: 'var(--text-muted)',
                        transform: expandedTruck === truck.id ? 'rotate(90deg)' : 'rotate(0)',
                        transition: 'transform .2s',
                      }}>›</div>
                    </div>

                    {/* Expanded truck detail */}
                    {expandedTruck === truck.id && (
                      <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', animation: 'slideDown .18s' }}
                        onClick={e => e.stopPropagation()}>

                        {/* Progress */}
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em' }}>ROUTE PROGRESS</span>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>
                              {Math.round((truck.stopsCompleted / (truck.totalStops || 1)) * 100)}%
                            </span>
                          </div>
                          <div style={{ background: 'var(--border)', borderRadius: 20, height: 7, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 20,
                              width: `${(truck.stopsCompleted / (truck.totalStops || 1)) * 100}%`,
                              background: 'linear-gradient(90deg,var(--accent),#14b8a6)',
                              transition: 'width .4s',
                            }} />
                          </div>
                        </div>

                        {/* Capacity */}
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em' }}>CAPACITY</span>
                            <span style={{
                              fontSize: 12, fontWeight: 700,
                              color: truck.capacity > 80 ? 'var(--danger)' : 'var(--text-muted)',
                            }}>{truck.capacity}%</span>
                          </div>
                          <div style={{ background: 'var(--border)', borderRadius: 20, height: 7, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 20,
                              width: `${truck.capacity}%`,
                              background: truck.capacity > 80 ? 'var(--danger)' : truck.capacity > 60 ? 'var(--warning)' : 'var(--accent)',
                              transition: 'width .4s',
                            }} />
                          </div>
                        </div>

                        {/* Compliance note */}
                        <div style={{
                          background: truck.missedYesterday ? 'rgba(231,76,60,0.05)' : 'rgba(46,204,113,0.05)',
                          border: `1px solid ${truck.missedYesterday ? 'rgba(231,76,60,0.2)' : 'rgba(46,204,113,0.2)'}`,
                          borderRadius: 8, padding: '9px 12px', marginBottom: 14,
                          fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)',
                        }}>
                          {truck.missedYesterday
                            ? <><strong style={{ color: 'var(--danger)' }}>Missed collection yesterday.</strong> This truck did not complete its route.</>
                            : <><strong style={{ color: 'var(--accent)' }}>On schedule.</strong> No missed collections in the past 7 days.</>
                          }
                        </div>

                        {/* ── 3 ACTION BUTTONS ── */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>

                          {/* 1. Track on Map */}
                          <button className="abtn"
                            onClick={() => navigate('/map')}
                            style={{
                              flex: 1, minWidth: 90,
                              background: 'rgba(20,184,166,0.08)',
                              border: '1px solid rgba(20,184,166,0.35)',
                              color: 'var(--accent)', borderRadius: 10,
                              padding: '9px 8px', fontWeight: 700, fontSize: 12,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                            }}>
                            <div style={{ width: 14, height: 14 }}>{ICONS.map}</div> Track on Map
                          </button>

                          {/* 2. Escalate to Admin */}
                          {escalations.some(e => e.truck === truck.truckId && e.status !== 'resolved') ? (
                            <button className="abtn" disabled
                              style={{
                                flex: 1, minWidth: 100,
                                background: 'rgba(243,156,18,0.05)',
                                border: '1px solid rgba(243,156,18,0.3)',
                                color: 'var(--warning)', borderRadius: 10,
                                padding: '9px 8px', fontWeight: 700, fontSize: 12, opacity: .55,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                              }}>
                              <div style={{ width: 14, height: 14 }}>{ICONS.warning}</div> Escalation Active
                            </button>
                          ) : (
                            <button className="abtn"
                              onClick={() => navigate('/brgy/escalate', {
                                state: {
                                  shiftId: truck.id,
                                  truckLabel: truck.label,
                                  driver: truck.driver,
                                  severity: truck.missedYesterday ? 'high' : 'medium'
                                }
                              })}
                              style={{
                                flex: 1, minWidth: 100,
                                background: 'rgba(231,76,60,0.06)',
                                border: '1px solid rgba(231,76,60,0.35)',
                                color: 'var(--danger)', borderRadius: 10,
                                padding: '9px 8px', fontWeight: 700, fontSize: 12,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                              }}>
                              <div style={{ width: 14, height: 14 }}>{ICONS.warning}</div> Escalate to Admin
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ════════════════════════════════════════
                TAB 3 — SCHEDULE
            ════════════════════════════════════════ */}
            {activeMainTab === 'schedule' && (
              <div>
                <button onClick={() => navigate('/')}
                  style={{
                    display: 'block',
                    marginBottom: 14, marginTop: 4, marginLeft: 'auto',
                    border: '1px dashed var(--border)', borderRadius: 20,
                    padding: '11px', fontSize: 12, fontWeight: 600,
                    background: 'transparent',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                  }}>
                  View Brgy Collection Schedule
                </button>

                {/* ── Unassigned Barangay Warning ── */}
                {!userBrgyId && (
                  <div style={{
                    padding: '16px 20px',
                    background: 'rgba(243, 156, 18, 0.08)',
                    border: '1.5px solid rgba(243, 156, 18, 0.3)',
                    borderRadius: 12,
                    marginBottom: 16,
                    fontSize: 13,
                    color: 'var(--text)',
                  }}>
                    <strong style={{ color: 'var(--warning)', display: 'block', marginBottom: 4 }}>
                      Barangay Assignment Required
                    </strong>
                    Please contact your system administrator to assign your official account to a barangay.
                  </div>
                )}

                {/* ── Capacity Error Banner ── */}
                {userBrgyId && isCalendarCapacityError && calendarEntries.length === 0 && (
                  <div style={{
                    padding: '16px 20px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1.5px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 12,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--danger)', marginBottom: 2 }}>
                        Calendar Service Busy
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        The server is currently at capacity. Please try again shortly.
                      </div>
                    </div>
                    <button
                      className="abtn"
                      onClick={refreshCalendar}
                      style={{
                        background: 'var(--danger)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '7px 14px',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* ── Network Error Banner ── */}
                {userBrgyId && isCalendarNetworkError && calendarEntries.length === 0 && (
                  <div style={{
                    padding: '16px 20px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1.5px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 12,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--danger)', marginBottom: 2 }}>
                        Network Connection Issue
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Unable to reach the calendar service. Please check your network connection.
                      </div>
                    </div>
                    <button
                      className="abtn"
                      onClick={refreshCalendar}
                      style={{
                        background: 'var(--danger)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '7px 14px',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* ── Generic Error Banner ── */}
                {userBrgyId && calendarError && !isCalendarCapacityError && !isCalendarNetworkError && calendarEntries.length === 0 && (
                  <div style={{
                    padding: '16px 20px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1.5px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 12,
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--danger)', marginBottom: 2 }}>
                        Failed to Load Schedule
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        An unexpected error occurred while loading the collection schedule.
                      </div>
                    </div>
                    <button
                      className="abtn"
                      onClick={refreshCalendar}
                      style={{
                        background: 'var(--danger)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '7px 14px',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* ── Stale Cache Banner ── */}
                {isCalendarStale && (
                  <div style={{
                    padding: '8px 14px',
                    background: 'rgba(243, 156, 18, 0.1)',
                    border: '1px solid rgba(243, 156, 18, 0.3)',
                    borderRadius: 8,
                    marginBottom: 14,
                    fontSize: 12,
                    color: 'var(--warning)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <span>Showing cached schedule data. Revalidation pending.</span>
                    {isCalendarRefreshing && <span style={{ fontSize: 11, fontStyle: 'italic' }}>Refreshing...</span>}
                  </div>
                )}

                {/* ── Next Pickup Hero Banner ── */}
                {nextPickup && (() => {
                  const { dayName, dateDisplay, isToday, isTomorrow } = formatOccurrenceDate(nextPickup.start_datetime || nextPickup.start, todayStr)
                  const timeRange = formatOccurrenceTime(nextPickup.start_datetime || nextPickup.start, nextPickup.end_datetime || nextPickup.end)
                  const statusBadge = getOccurrenceStatusBadge(nextPickup.status, isToday)
                  const subtitle = nextPickup.raw_payload?.zone || nextPickup.raw_payload?.waste_type || user?.barangay_name || 'Assigned Zone'

                  return (
                    <div
                      key={nextPickup.id}
                      style={{
                        background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(20,184,166,0.04) 100%)',
                        border: '1.5px solid rgba(16,185,129,0.3)',
                        borderRadius: 14,
                        padding: '16px 20px',
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: 'var(--accent)' }}>
                          {isToday ? "TODAY'S COLLECTION" : isTomorrow ? "TOMORROW'S COLLECTION" : 'NEXT SCHEDULED PICKUP'}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 20, letterSpacing: '.05em',
                          background: statusBadge.bg, color: statusBadge.color, border: `1px solid ${statusBadge.border}`
                        }}>
                          {statusBadge.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
                        {dayName}, {dateDisplay}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {timeRange} · {subtitle}
                      </div>
                    </div>
                  )
                })()}

                {/* ── 14-Day Collection Occurrence List ── */}
                <div className="card" style={{ padding: 16, animation: 'slideDown .2s' }}>
                  {calendarLoading && calendarEntries.length === 0 ? (
                    <SidebarWidgetSkeleton rows={4} />
                  ) : calendarEntries.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                      No upcoming collection schedules found for the next 14 days.
                    </div>
                  ) : (
                    calendarEntries.map((entry, i) => {
                      const { dayName, dateDisplay, isToday } = formatOccurrenceDate(entry.start_datetime || entry.start, todayStr)
                      const timeRange = formatOccurrenceTime(entry.start_datetime || entry.start, entry.end_datetime || entry.end)
                      const badge = getOccurrenceStatusBadge(entry.status, isToday)
                      const zone = entry.raw_payload?.zone || entry.raw_payload?.waste_type || user?.barangay_name || 'Barangay'

                      return (
                        <div key={entry.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
                          borderBottom: i < calendarEntries.length - 1 ? '1px solid var(--border)' : 'none',
                        }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                            background: badge.bg,
                            color: badge.color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <div style={{ width: 16, height: 16 }}>
                              {entry.status === 'verified_collected' || entry.status === 'operationally_completed'
                                ? ICONS.check
                                : ICONS.schedule}
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>
                              {dayName}, {dateDisplay}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {zone} · {user?.barangay_name || 'Barangay'}
                            </div>
                          </div>
                          <div style={{
                            fontSize: 12, fontWeight: 600, textAlign: 'right', marginRight: 8,
                            color: 'var(--text)', flexShrink: 0,
                          }}>
                            {timeRange}
                          </div>
                          <span style={{
                            fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 20,
                            letterSpacing: '.05em', flexShrink: 0,
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`,
                          }}>
                            {badge.label}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

          </div>{/* end main column */}

          {/* ════════════════════════════════════════
              SIDEBAR (desktop only)
          ════════════════════════════════════════ */}
          <div className="sidebar">
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Quick Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="abtn btn btn-full"
                  onClick={() => navigate('/map')}
                  style={{
                    background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.35)',
                    color: 'var(--accent)', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}>
                  <div style={{ width: 16, height: 16 }}>{ICONS.map}</div> View Live Map
                </button>
                <button className="abtn btn btn-full"
                  onClick={() => navigate('/brgy/escalate')}
                  style={{
                    background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.35)',
                    color: 'var(--danger)', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}>
                  <div style={{ width: 16, height: 16 }}>{ICONS.escalation}</div> Escalate to Admin
                </button>
              </div>
            </div>

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Pending Summary</h3>
              {loading ? (
                <SidebarWidgetSkeleton rows={3} />
              ) : (
                [
                  { label: 'Reports to Validate', value: pendingCount, color: 'var(--warning)' },
                  { label: 'Missed Collections', value: missedCount, color: 'var(--danger)' },
                  { label: 'Flagged Trucks', value: trucks.filter(t => t.flagged).length, color: 'var(--warning)' },
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

            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 12, fontSize: 15 }}>Collection Schedule</h3>
              {!userBrgyId ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Barangay assignment required.</div>
              ) : calendarLoading && calendarEntries.length === 0 ? (
                <SidebarWidgetSkeleton rows={3} />
              ) : calendarError && calendarEntries.length === 0 ? (
                <div style={{ color: 'var(--danger)', fontSize: 12 }}>Unable to load schedule.</div>
              ) : calendarEntries.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No schedules available.</div>
              ) : (
                calendarEntries.slice(0, 3).map((entry, i) => {
                  const { dayName, dateDisplay, isToday, isTomorrow } = formatOccurrenceDate(entry.start_datetime || entry.start, todayStr)
                  const timeRange = formatOccurrenceTime(entry.start_datetime || entry.start, entry.end_datetime || entry.end)
                  const badge = getOccurrenceStatusBadge(entry.status, isToday)
                  const zone = entry.raw_payload?.zone || entry.raw_payload?.waste_type || user?.barangay_name || 'Assigned Zone'
                  const relativeLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : dayName

                  return (
                    <div key={entry.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                      borderBottom: i < Math.min(calendarEntries.length, 3) - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{
                        width: 14, height: 14, flexShrink: 0,
                        color: badge.color
                      }}>
                        {entry.status === 'verified_collected' || entry.status === 'operationally_completed'
                          ? ICONS.check
                          : ICONS.schedule}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {relativeLabel} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>({dateDisplay})</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {zone}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
                        {timeRange}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

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
                  <div className="form-label">Barangay</div>
                  <div style={{ fontSize: 14 }}>{user?.barangay_name || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Role</div>
                  <span style={{
                    background: 'rgba(46,204,113,0.1)', color: 'var(--accent)',
                    border: '1px solid rgba(46,204,113,0.25)',
                    fontSize: 9, fontWeight: 800, padding: '3px 10px',
                    borderRadius: 20, letterSpacing: '.07em', display: 'inline-block',
                  }}>BARANGAY OFFICIAL</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
      <OfflineReportBuilder
        isOpen={showBuilder}
        onClose={() => setShowBuilder(false)}
        onSubmit={async (data) => {
          await addReport(data)
          setShowBuilder(false)
        }}
      />
    </>
  )
}
