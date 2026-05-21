/**
 * HomeCarousel.jsx — Role-Based Swipeable Hero Carousel
 * -------------------------------------------------------
 * Roles supported: citizen | driver | watcher | barangay_official
 *
 * Each role gets 3 purpose-built slides tailored to their workflow.
 * Design: matches .card-dark (#1e2633) surface style.
 * No external dependencies — native pointer/touch + CSS transitions.
 *
 * Props:
 *   role           {string} — 'citizen' | 'driver' | 'watcher' | 'barangay_official'
 *   userBarangay   {string} — user's barangay name
 *   onReport       {fn}     — report submission handler (citizen/official)
 *   onValidate     {fn}     — validation handler (watcher/official)
 *   onStartRoute   {fn}     — route start handler (driver)
 *   extraSecondCta {object} — { label, icon, onClick } for an extra CTA
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import RankingModal from './RankingModal'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const ANNOUNCEMENT = {
  title: 'Collection Adjusted — Heavy Rain',
  body: 'Garbage collection in Isabang and Cotta is rescheduled to tomorrow 7AM due to heavy rainfall.',
  date: 'May 19, 2026',
  isNew: true,
}

const TOP3 = [
  { rank: 1, name: 'Gulang-Adasd', score: 98 },
  { rank: 2, name: 'Ibabang Dupay', score: 95 },
  { rank: 3, name: 'Mayao Crossing', score: 92 },
]

// Driver-specific mock
const DRIVER_ROUTE = {
  label: 'Zone A — Morning Run',
  stops: 14,
  completed: 6,
  nextStop: 'Purok 3, Isabang',
  startTime: '5:30 AM',
  status: 'in_progress', // 'pending' | 'in_progress' | 'done'
}

const DRIVER_STATS = {
  thisWeek: 38,
  onTime: '94%',
  rating: 4.8,
}

// Watcher-specific mock
const WATCHER_PENDING = {
  count: 7,
  urgent: 2,
  area: 'Baranggay Isabang',
}

const WATCHER_HOTSPOTS = {
  active: 4,
  high: 1,
}

// Brgy. Official mock
const OFFICIAL_OVERVIEW = {
  openReports: 11,
  pendingValidation: 4,
  resolvedThisWeek: 8,
  barangayRank: 4,
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
/* ── Root ── */
.hc-root {
  position: relative;
  border-radius: var(--radius, 14px);
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  margin-bottom: 4px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.18);
}

.hc-track {
  display: flex;
  transition: transform .38s cubic-bezier(.4,0,.2,1);
  will-change: transform;
}

/* Each slide */
.hc-slide {
  flex: 0 0 100%;
  width: 100%;
  background: var(--surface-3, #1e2633);
  padding: 24px 22px 22px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 190px;
  position: relative;
  overflow: hidden;
}

/* Decorative bg pattern */
.hc-slide::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 90% 10%, rgba(46,204,113,0.06) 0%, transparent 60%);
  pointer-events: none;
}

/* Desktop enhancements */
@media (min-width: 900px) {
  .hc-slide {
    min-height: 240px;
    padding: 32px 36px 28px;
    gap: 22px;
  }
  .hc-title { font-size: 22px !important; }
  .hc-body  { font-size: 14px !important; }
  .hc-label { font-size: 11px !important; }
}

/* Label row */
.hc-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .10em;
  text-transform: uppercase;
  color: var(--accent, #2ecc71);
  display: flex;
  align-items: center;
  gap: 6px;
}
.hc-label .msi { font-size: 16px; }

/* Heading */
.hc-title {
  font-size: 18px;
  font-weight: 800;
  color: #fff;
  line-height: 1.25;
  margin: 4px 0 3px;
}

/* Body text */
.hc-body {
  font-size: 12.5px;
  color: rgba(255,255,255,.55);
  line-height: 1.6;
}

/* Accent bar */
.hc-accent-bar {
  width: 28px;
  height: 2.5px;
  background: var(--accent, #2ecc71);
  border-radius: 2px;
  margin-bottom: 3px;
}

/* Role-tinted bars */
.hc-bar--warning { background: var(--warning, #f59e0b) !important; }
.hc-bar--info    { background: var(--info, #3b82f6) !important; }
.hc-bar--danger  { background: var(--danger, #ef4444) !important; }

/* Labels by role color */
.hc-label--warning { color: var(--warning, #f59e0b) !important; }
.hc-label--info    { color: var(--info, #3b82f6) !important; }
.hc-label--danger  { color: var(--danger, #ef4444) !important; }

/* Announcement badge */
.hc-new-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: rgba(46,204,113,.12);
  border: 1px solid rgba(46,204,113,.35);
  color: var(--accent, #2ecc71);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .09em;
  padding: 2px 7px;
  border-radius: 20px;
}

/* Button row */
.hc-btns {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Buttons */
.hc-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  font-family: var(--font-body, sans-serif);
  letter-spacing: .03em;
  transition: opacity .15s, transform .1s;
  white-space: nowrap;
}
.hc-btn:active { transform: scale(.96); }
.hc-btn:hover  { opacity: .86; }
.hc-btn .msi  { font-size: 16px; }

.hc-btn--white  { background: #fff; color: var(--surface-3, #1e2633); }
.hc-btn--ghost  { background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.18) !important; color: rgba(255,255,255,.82); }
.hc-btn--accent { background: var(--accent, #2ecc71); color: #0d1117; }
.hc-btn--warn   { background: var(--warning, #f59e0b); color: #0d1117; }
.hc-btn--info   { background: var(--info, #3b82f6); color: #fff; }
.hc-btn--danger { background: var(--danger, #ef4444); color: #fff; }

/* Stat pill row (driver/watcher/official stats) */
.hc-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.hc-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px;
  padding: 8px 14px;
  min-width: 60px;
  flex: 1;
}
.hc-pill-val {
  font-size: 20px;
  font-weight: 800;
  color: #fff;
  font-family: var(--font-head, sans-serif);
  line-height: 1;
}
.hc-pill-lbl {
  font-size: 9px;
  font-weight: 700;
  color: rgba(255,255,255,.45);
  text-transform: uppercase;
  letter-spacing: .07em;
  margin-top: 4px;
}

/* Progress bar */
.hc-progress-track {
  width: 100%;
  height: 6px;
  background: rgba(255,255,255,.1);
  border-radius: 3px;
  overflow: hidden;
}
.hc-progress-fill {
  height: 100%;
  background: var(--accent, #2ecc71);
  border-radius: 3px;
  transition: width .5s ease;
}

/* Mini rank rows */
.hc-rank-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.hc-rank-row:last-child { border-bottom: none; }

/* Pagination dots */
.hc-dots {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin-bottom: 2%;
  margin-top: 2%;
}
.hc-dot {
  height: 6px;
  border-radius: 3px;
  border: none;
  padding: 0;
  cursor: pointer;
  transition: width .3s ease, background .3s ease;
}
.hc-dot-active   { width: 22px; background: var(--accent, #2ecc71); }
.hc-dot-inactive { width: 6px;  background: rgba(128,128,128,.3); }
`

let _injected = false
function injectStyles() {
  if (_injected) return
  _injected = true
  const el = document.createElement('style')
  el.textContent = CSS
  document.head.appendChild(el)
}

// ─── SHARED SLIDES ────────────────────────────────────────────────────────────

function AnnouncementSlide({ announcement }) {
  const navigate = useNavigate()
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <span className="msi">campaign</span>
          LGU Announcement
          {announcement?.isNew && <span className="hc-new-badge">NEW</span>}
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">{announcement?.title || 'No Announcements'}</div>
        <div className="hc-body" style={{
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {announcement?.body}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.32)', fontWeight: 500 }}>
          {announcement?.date}
        </span>
        <button className="hc-btn hc-btn--ghost" style={{ padding: '7px 13px' }}
          onClick={() => navigate('/announcements')}>
          Read More <span className="msi">arrow_forward</span>
        </button>
      </div>
    </div>
  )
}

function RankingsSlide({ onViewRankings }) {
  const MEDALS = ['looks_one', 'looks_two', 'looks_3']
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <span className="msi">emoji_events</span>
          Cleanliness Rankings
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">Top Cleanest Barangays</div>
        <div style={{ marginTop: 8 }}>
          {TOP3.map((b, i) => (
            <div key={b.rank} className="hc-rank-row">
              <span className="msi" style={{
                fontSize: 18, flexShrink: 0,
                color: ['#f59e0b', '#94a3b8', '#b45309'][i],
              }}>{MEDALS[i]}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: 'rgba(255,255,255,.82)', fontWeight: 600 }}>
                {b.name}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                {b.score}%
              </span>
            </div>
          ))}
        </div>
      </div>
      <button className="hc-btn hc-btn--accent" style={{ alignSelf: 'flex-start' }}
        onClick={onViewRankings}>
        <span className="msi">leaderboard</span>
        Full Rankings
      </button>
    </div>
  )
}

// ─── CITIZEN SLIDES ───────────────────────────────────────────────────────────

function CitizenReportSlide({ onReport }) {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <span className="msi">delete</span>
          Waste Reporting
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">Report a Garbage Issue</div>
        <div className="hc-body">
          See uncollected waste or illegal dumping? Let your barangay know instantly.
        </div>
      </div>
      <div className="hc-btns submit-button">
        <button className="hc-btn hc-btn--white " style={{ flex: 1 }} onClick={onReport}>
          <span className="msi">photo_camera</span>
          Submit Report
        </button>
        <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }}
          onClick={() => window.location?.assign?.('/map')}>
          <span className="msi">map</span>
          View Map
        </button>
      </div>
    </div>
  )
}

// ─── DRIVER SLIDES ────────────────────────────────────────────────────────────

function DriverRouteSlide({ route, onStartRoute }) {
  const pct = Math.round((route.completed / route.stops) * 100)
  const statusColor = {
    pending: 'var(--warning)',
    in_progress: 'var(--accent)',
    done: 'var(--info)',
  }[route.status] || 'var(--accent)'

  const statusLabel = {
    pending: 'NOT STARTED',
    in_progress: 'IN PROGRESS',
    done: 'COMPLETED',
  }[route.status]

  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label" style={{ color: 'var(--warning)', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="msi">local_shipping</span>
            Today's Route
          </div>
          <span style={{
            fontSize: 9, background: `${statusColor}18`, color: statusColor,
            border: `1px solid ${statusColor}40`, padding: '2px 8px', borderRadius: 20, fontWeight: 800,
          }}>{statusLabel}</span>
        </div>
        <div className="hc-accent-bar hc-bar--warning" />
        <div className="hc-title">{route.label}</div>
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="hc-body" style={{ margin: 0 }}>
              {route.completed}/{route.stops} stops · Next: {route.nextStop}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{pct}%</span>
          </div>
          <div className="hc-progress-track">
            <div className="hc-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="hc-btns submit-button">
        {route.status === 'pending' && (
          <button className="hc-btn hc-btn--warn" style={{ flex: 1 }} onClick={onStartRoute}>
            <span className="msi">play_circle</span>
            Start Route
          </button>
        )}
        {route.status === 'in_progress' && (
          <button className="hc-btn hc-btn--white" style={{ flex: 1 }} onClick={onStartRoute}>
            <span className="msi">navigation</span>
            Continue Route
          </button>
        )}
        {route.status === 'done' && (
          <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }}>
            <span className="msi">check_circle</span>
            Route Complete
          </button>
        )}
        <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }}>
          <span className="msi">map</span>
          View Map
        </button>
      </div>
    </div>
  )
}

function DriverStatsSlide() {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label hc-label--info">
          <span className="msi">bar_chart</span>
          Your Performance
        </div>
        <div className="hc-accent-bar hc-bar--info" />
        <div className="hc-title">This Week's Summary</div>
        <div className="hc-body">Keep up the great work! Your on-time rate is above average.</div>
      </div>
      <div className="hc-pills">
        <div className="hc-pill">
          <span className="hc-pill-val">{DRIVER_STATS.thisWeek}</span>
          <span className="hc-pill-lbl">Pickups</span>
        </div>
        <div className="hc-pill">
          <span className="hc-pill-val" style={{ color: 'var(--accent)' }}>{DRIVER_STATS.onTime}</span>
          <span className="hc-pill-lbl">On-Time</span>
        </div>
        <div className="hc-pill">
          <span className="hc-pill-val" style={{ color: 'var(--warning)' }}>{DRIVER_STATS.rating}</span>
          <span className="hc-pill-lbl">Rating</span>
        </div>
      </div>
    </div>
  )
}

// ─── WATCHER SLIDES ───────────────────────────────────────────────────────────

function WatcherPendingSlide({ pending, onValidate }) {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label hc-label--danger">
          <span className="msi">pending_actions</span>
          Needs Your Review
          {pending.urgent > 0 && (
            <span style={{
              background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.4)',
              color: 'var(--danger)', fontSize: 8, fontWeight: 800, padding: '2px 7px',
              borderRadius: 20, letterSpacing: '.08em',
            }}>{pending.urgent} URGENT</span>
          )}
        </div>
        <div className="hc-accent-bar hc-bar--danger" />
        <div className="hc-title">{pending.count} Reports Pending Validation</div>
        <div className="hc-body">
          Reports in {pending.area} need your on-ground assessment to proceed.
        </div>
      </div>
      <div className="hc-btns submit-button">
        <button className="hc-btn hc-btn--danger" style={{ flex: 1 }} onClick={onValidate}>
          <span className="msi">task_alt</span>
          Validate Reports
        </button>
        <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }}>
          <span className="msi">map</span>
          View on Map
        </button>
      </div>
    </div>
  )
}

function WatcherHotspotsSlide() {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label hc-label--warning">
          <span className="msi">location_on</span>
          Area Status
        </div>
        <div className="hc-accent-bar hc-bar--warning" />
        <div className="hc-title">Active Hotspots in Your Zone</div>
        <div className="hc-pills" style={{ marginTop: 4 }}>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--warning)' }}>
              {WATCHER_HOTSPOTS.active}
            </span>
            <span className="hc-pill-lbl">Active</span>
          </div>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--danger)' }}>
              {WATCHER_HOTSPOTS.high}
            </span>
            <span className="hc-pill-lbl">High Severity</span>
          </div>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--accent)' }}>
              3
            </span>
            <span className="hc-pill-lbl">Monitored</span>
          </div>
        </div>
      </div>
      <button className="hc-btn hc-btn--warn" style={{ alignSelf: 'flex-start' }}>
        <span className="msi">visibility</span>
        Inspect Hotspots
      </button>
    </div>
  )
}

// ─── BRGY. OFFICIAL SLIDES ────────────────────────────────────────────────────

function OfficialOverviewSlide({ overview, onValidate }) {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <span className="msi">account_balance</span>
          Barangay Overview
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">Your Barangay at a Glance</div>
        <div className="hc-pills" style={{ marginTop: 4 }}>
          <div className="hc-pill">
            <span className="hc-pill-val">{overview.openReports}</span>
            <span className="hc-pill-lbl">Open Reports</span>
          </div>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--warning)' }}>
              {overview.pendingValidation}
            </span>
            <span className="hc-pill-lbl">Pending</span>
          </div>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--accent)' }}>
              {overview.resolvedThisWeek}
            </span>
            <span className="hc-pill-lbl">Resolved</span>
          </div>
        </div>
      </div>
      <div className="hc-btns submit-button">
        <button className="hc-btn hc-btn--white" style={{ flex: 2 }} onClick={onValidate}>
          <span className="msi">task_alt</span>
          Validate Reports
        </button>
        <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }}>
          <span className="msi">analytics</span>
          Reports
        </button>
      </div>
    </div>
  )
}

function OfficialRankSlide({ overview, userBarangay, onViewRankings }) {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <span className="msi">emoji_events</span>
          Barangay Standing
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">{userBarangay || 'Your Barangay'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-head)', fontSize: 44, fontWeight: 900,
              color: 'var(--accent)', lineHeight: 1,
            }}>#{overview.barangayRank}</div>
            <div style={{
              fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.4)',
              textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 4,
            }}>City Ranking</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="hc-body" style={{ margin: 0 }}>
              You're in the top 25% of all barangays in Lucena City. Keep reducing waste reports to climb higher.
            </div>
          </div>
        </div>
      </div>
      <button className="hc-btn hc-btn--accent" style={{ alignSelf: 'flex-start' }}
        onClick={onViewRankings}>
        <span className="msi">leaderboard</span>
        Full Rankings
      </button>
    </div>
  )
}

// ─── PAGINATION DOTS ─────────────────────────────────────────────────────────

function Dots({ count, active, onDotClick }) {
  return (
    <div className="hc-dots">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          className={`hc-dot ${i === active ? 'hc-dot-active' : 'hc-dot-inactive'}`}
          onClick={() => onDotClick(i)}
          aria-label={`Slide ${i + 1}`}
        />
      ))}
    </div>
  )
}

// ─── SLIDE SETS BY ROLE ───────────────────────────────────────────────────────

function CitizenSlides({ active, onReport, onViewRankings }) {
  return (
    <>
      <CitizenReportSlide onReport={onReport} />
      <AnnouncementSlide announcement={ANNOUNCEMENT} />
      <RankingsSlide onViewRankings={onViewRankings} />
    </>
  )
}

function DriverSlides({ active, onStartRoute, onViewRankings }) {
  return (
    <>
      <DriverRouteSlide route={DRIVER_ROUTE} onStartRoute={onStartRoute} />
      <DriverStatsSlide />
      <AnnouncementSlide announcement={ANNOUNCEMENT} />
    </>
  )
}

function WatcherSlides({ active, onValidate, onViewRankings }) {
  return (
    <>
      <WatcherPendingSlide pending={WATCHER_PENDING} onValidate={onValidate} />
      <WatcherHotspotsSlide />
      <AnnouncementSlide announcement={ANNOUNCEMENT} />
    </>
  )
}

function OfficialSlides({ active, onReport, onValidate, userBarangay, onViewRankings }) {
  return (
    <>
      <OfficialOverviewSlide overview={OFFICIAL_OVERVIEW} onValidate={onValidate} />
      <AnnouncementSlide announcement={ANNOUNCEMENT} />
      <OfficialRankSlide overview={OFFICIAL_OVERVIEW} userBarangay={userBarangay} onViewRankings={onViewRankings} />
    </>
  )
}

// ─── MAIN CAROUSEL ────────────────────────────────────────────────────────────

export default function HomeCarousel({
  role = 'citizen',
  userBarangay = '',
  onReport,
  onValidate,
  onStartRoute,
  extraSecondCta,
}) {
  const navigate = useNavigate()
  const TOTAL = 3

  const [active, setActive] = useState(0)
  const [rankOpen, setRankOpen] = useState(false)

  const startX = useRef(0)
  const dragging = useRef(false)
  const autoTimer = useRef(null)
  const pauseTimer = useRef(null)

  injectStyles()

  const startAuto = useCallback(() => {
    clearInterval(autoTimer.current)
    autoTimer.current = setInterval(() => setActive(p => (p + 1) % TOTAL), 6000)
  }, [])

  const pauseAuto = useCallback(() => {
    clearInterval(autoTimer.current)
    clearTimeout(pauseTimer.current)
    pauseTimer.current = setTimeout(startAuto, 3500)
  }, [startAuto])

  useEffect(() => {
    startAuto()
    return () => {
      clearInterval(autoTimer.current)
      clearTimeout(pauseTimer.current)
    }
  }, [startAuto])

  function onDown(e) {
    startX.current = e.clientX ?? e.touches?.[0]?.clientX ?? 0
    dragging.current = true
    pauseAuto()
  }

  function onUp(e) {
    if (!dragging.current) return
    dragging.current = false
    const endX = e.clientX ?? e.changedTouches?.[0]?.clientX ?? startX.current
    const d = startX.current - endX
    if (Math.abs(d) > 40) {
      setActive(p => d > 0 ? Math.min(p + 1, TOTAL - 1) : Math.max(p - 1, 0))
    }
  }

  const handleViewRankings = useCallback(() => {
    pauseAuto()
    setRankOpen(true)
  }, [pauseAuto])

  const handleDotClick = useCallback((i) => {
    setActive(i)
    pauseAuto()
  }, [pauseAuto])

  const resolvedOnReport = onReport ?? (() => navigate('/report/submit'))
  const resolvedOnValidate = onValidate ?? (() => navigate('/reports/validate'))
  const resolvedOnStartRoute = onStartRoute ?? (() => navigate('/route'))

  // Determine slide content by role
  const renderSlides = () => {
    switch (role) {
      case 'driver':
        return <DriverSlides active={active} onStartRoute={resolvedOnStartRoute} onViewRankings={handleViewRankings} />
      case 'watcher':
        return <WatcherSlides active={active} onValidate={resolvedOnValidate} onViewRankings={handleViewRankings} />
      case 'barangay_official':
        return (
          <OfficialSlides
            active={active}
            onReport={resolvedOnReport}
            onValidate={resolvedOnValidate}
            userBarangay={userBarangay}
            onViewRankings={handleViewRankings}
          />
        )
      case 'citizen':
      default:
        return <CitizenSlides active={active} onReport={resolvedOnReport} onViewRankings={handleViewRankings} />
    }
  }

  return (
    <>
      <div>
        <div
          className="hc-root"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={e => { if (dragging.current) onUp(e) }}
          onTouchStart={onDown}
          onTouchEnd={onUp}
        >
          <div
            className="hc-track"
            style={{ transform: `translateX(-${active * 100}%)` }}
          >
            {renderSlides()}
          </div>
        </div>

        <Dots count={TOTAL} active={active} onDotClick={handleDotClick} />
      </div>

      <RankingModal
        open={rankOpen}
        onClose={() => setRankOpen(false)}
        userBarangay={userBarangay}
      />
    </>
  )
}