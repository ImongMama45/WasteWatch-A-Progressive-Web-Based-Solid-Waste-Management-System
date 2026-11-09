import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Megaphone, ArrowRight, Trophy, Medal, Award, TrendingUp, Trash2, Camera,
  Map as MapIcon, Truck, PlayCircle, Navigation, CheckCircle,
  BarChart, AlertCircle, CheckSquare, MapPin, Eye, Building2, Activity,
  AlertTriangle, Pin, RefreshCw, Clock, Ban
} from 'lucide-react'
import RankingModal from './RankingModal'
import api from '../../api/client'

// ─── DASHBOARD WORKFLOW FALLBACKS (Pre-existing domain data) ─────────────────
const DRIVER_ROUTE = {
  label: 'Checking Today\'s Schedule',
  stops: 0,
  completed: 0,
  nextStop: '—',
  startTime: '—',
  status: 'no_schedule',
}

const DRIVER_STATS = { thisWeek: 38, onTime: '94%', rating: 4.8 }
const WATCHER_PENDING = { count: 7, urgent: 2, area: 'Barangay Isabang' }
const WATCHER_HOTSPOTS = { active: 4, high: 1 }
const OFFICIAL_OVERVIEW = { openReports: 11, pendingValidation: 4, resolvedThisWeek: 8 }

// ─── COMPACT RESPONSIVE CSS ───────────────────────────────────────────────────

const CSS = `
.hc-root { position: relative; border-radius: var(--radius, 14px); overflow: hidden; touch-action: pan-y; user-select: none; margin-bottom: 4px; box-shadow: 0 2px 16px rgba(0,0,0,0.14); }
.hc-track { display: flex; transition: transform .38s cubic-bezier(.4,0,.2,1); will-change: transform; }
.hc-slide {
  flex: 0 0 100%;
  width: 100%;
  background: var(--surface-3, #1e2633);
  padding: 16px 18px 14px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  min-height: 145px;
  position: relative;
  overflow: hidden;
}
.hc-slide::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 90% 10%, rgba(46,204,113,0.06) 0%, transparent 60%);
  pointer-events: none;
}
@media (min-width: 900px) {
  .hc-slide {
    min-height: 165px;
    padding: 20px 24px 16px;
    gap: 12px;
  }
  .hc-title { font-size: 18px !important; }
  .hc-body { font-size: 13px !important; }
  .hc-label { font-size: 10px !important; }
}
.hc-label { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent, #2ecc71); display: flex; align-items: center; gap: 6px; }
.hc-title { font-size: 16px; font-weight: 800; color: #fff; line-height: 1.25; margin: 3px 0 2px; }
.hc-body { font-size: 12px; color: rgba(255,255,255,.62); line-height: 1.5; }
.hc-accent-bar { width: 28px; height: 2.5px; background: var(--accent, #2ecc71); border-radius: 2px; margin-bottom: 2px; }
.hc-bar--warning { background: var(--warning, #f59e0b) !important; }
.hc-bar--info { background: var(--info, #3b82f6) !important; }
.hc-bar--danger { background: var(--danger, #ef4444) !important; }
.hc-bar--muted { background: rgba(255,255,255,0.2) !important; }
.hc-label--warning { color: var(--warning, #f59e0b) !important; }
.hc-label--info { color: var(--info, #3b82f6) !important; }
.hc-label--danger { color: var(--danger, #ef4444) !important; }
.hc-label--muted { color: rgba(255,255,255,0.45) !important; }
.hc-new-badge { display: inline-flex; align-items: center; gap: 3px; background: rgba(46,204,113,.15); border: 1px solid rgba(46,204,113,.4); color: var(--accent, #2ecc71); font-size: 8px; font-weight: 800; letter-spacing: .08em; padding: 1px 6px; border-radius: 20px; }
.hc-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.hc-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border-radius: 8px; font-size: 11.5px; font-weight: 700; cursor: pointer; border: none; font-family: var(--font-body, sans-serif); letter-spacing: .02em; transition: opacity .15s, transform .1s; white-space: nowrap; }
.hc-btn:active { transform: scale(.97); }
.hc-btn:hover { opacity: .88; }
.hc-btn:disabled { opacity: .55; cursor: not-allowed; transform: none; }
.hc-btn--white { background: #fff; color: var(--surface-3, #1e2633); }
.hc-btn--ghost { background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.18) !important; color: rgba(255,255,255,.85); }
.hc-btn--accent { background: var(--accent, #2ecc71); color: #0d1117; }
.hc-btn--warn { background: var(--warning, #f59e0b); color: #0d1117; }
.hc-btn--info { background: var(--info, #3b82f6); color: #fff; }
.hc-btn--danger { background: var(--danger, #ef4444); color: #fff; }
.hc-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.hc-pill { display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 6px 12px; min-width: 55px; flex: 1; }
.hc-pill-val { font-size: 18px; font-weight: 800; color: #fff; font-family: var(--font-head, sans-serif); line-height: 1; }
.hc-pill-lbl { font-size: 8.5px; font-weight: 700; color: rgba(255,255,255,.45); text-transform: uppercase; letter-spacing: .06em; margin-top: 3px; }
.hc-progress-track { width: 100%; height: 5px; background: rgba(255,255,255,.1); border-radius: 3px; overflow: hidden; }
.hc-progress-fill { height: 100%; background: var(--accent, #2ecc71); border-radius: 3px; transition: width .5s ease; }
.hc-rank-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
.hc-rank-row:last-child { border-bottom: none; }
.hc-dots { display: flex; justify-content: center; align-items: center; gap: 6px; margin-bottom: 2%; margin-top: 2%; }
.hc-dot { height: 5px; border-radius: 3px; border: none; padding: 0; cursor: pointer; transition: width .3s ease, background .3s ease; }
.hc-dot-active { width: 20px; background: var(--accent, #2ecc71); }
.hc-dot-inactive { width: 5px; background: rgba(128,128,128,.3); }
.hc-spinner { width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.3); border-top-color: currentColor; border-radius: 50%; animation: hc-spin .7s linear infinite; display: inline-block; }
@keyframes hc-spin { to { transform: rotate(360deg); } }
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

function AnnouncementSlide({
  announcement,
  loading = false,
  error = false,
  onReadMore,
}) {
  // 1. Loading State
  if (loading && !announcement) {
    return (
      <div className="hc-slide">
        <div>
          <div className="hc-label">
            <span className="hc-spinner" />
            <span>Checking Advisories…</span>
          </div>
          <div className="hc-accent-bar" />
          <div className="hc-title">Checking for City Notices</div>
          <div className="hc-body">
            Connecting to the public information hub to retrieve active advisories.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.38)', fontWeight: 500 }}>
            Lucena City Portal
          </span>
          <button
            className="hc-btn hc-btn--ghost"
            style={{ padding: '6px 12px', fontSize: 11 }}
            onClick={() => onReadMore?.()}
          >
            View Hub <ArrowRight size={13} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    )
  }

  // 2. Request Error State
  if (error && !announcement) {
    return (
      <div className="hc-slide">
        <div>
          <div className="hc-label hc-label--warning" style={{ color: 'var(--warning, #f59e0b)' }}>
            <AlertCircle size={14} strokeWidth={2.2} />
            <span>Notice System Unavailable</span>
          </div>
          <div className="hc-accent-bar hc-bar--warning" />
          <div className="hc-title">Unable to Load Advisories</div>
          <div className="hc-body">
            Could not retrieve active announcements. Check your connection or visit the announcements hub.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.38)', fontWeight: 500 }}>
            Offline State
          </span>
          <button
            className="hc-btn hc-btn--ghost"
            style={{ padding: '6px 12px', fontSize: 11 }}
            onClick={() => onReadMore?.()}
          >
            Open Hub <ArrowRight size={13} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    )
  }

  // 3. Empty State (Request succeeded, 0 items)
  if (!announcement) {
    return (
      <div className="hc-slide">
        <div>
          <div className="hc-label hc-label--muted">
            <Megaphone size={14} strokeWidth={2.2} />
            <span>Public Notices</span>
          </div>
          <div className="hc-accent-bar hc-bar--muted" />
          <div className="hc-title">No Active Announcements</div>
          <div className="hc-body">
            There are currently no active city advisories or urgent notices posted for your area.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.38)', fontWeight: 500 }}>
            Public Information Hub
          </span>
          <button
            className="hc-btn hc-btn--ghost"
            style={{ padding: '6px 12px', fontSize: 11 }}
            onClick={() => onReadMore?.()}
          >
            View Hub <ArrowRight size={13} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    )
  }

  // 4. Populated Announcement State
  const isEmergency = announcement.type === 'emergency'
  const isHigh = announcement.priority === 'high'
  const isPinned = Boolean(announcement.is_pinned ?? announcement.isPinned)

  const labelText = isEmergency
    ? 'EMERGENCY ADVISORY'
    : isHigh
    ? 'URGENT SERVICE NOTICE'
    : isPinned
    ? 'PINNED ADVISORY'
    : 'LGU ADVISORY'

  const LabelIcon = isEmergency ? AlertTriangle : isHigh ? AlertCircle : isPinned ? Pin : Megaphone
  const barClass = isEmergency ? 'hc-bar--danger' : isHigh ? 'hc-bar--warning' : ''
  const labelClass = isEmergency ? 'hc-label--danger' : isHigh ? 'hc-label--warning' : ''

  const formattedDate = (() => {
    if (!announcement.date) return 'Notice'
    try {
      const d = new Date(announcement.date)
      if (isNaN(d.getTime())) return String(announcement.date)
      return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return String(announcement.date)
    }
  })()

  const brgyTag =
    announcement.barangay_name ||
    (typeof announcement.barangay === 'string' ? announcement.barangay : null) ||
    (announcement.barangay && typeof announcement.barangay === 'object' ? announcement.barangay.name : null)

  return (
    <div className="hc-slide">
      <div>
        <div className={`hc-label ${labelClass}`} style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <LabelIcon size={14} strokeWidth={2.2} />
            <span>{labelText}</span>
            {announcement.isNew && <span className="hc-new-badge">NEW</span>}
          </div>
          {brgyTag && (
            <span style={{ fontSize: 9, opacity: 0.8, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
              {brgyTag}
            </span>
          )}
        </div>
        <div className={`hc-accent-bar ${barClass}`} />
        <div className="hc-title">{announcement.title || 'Untitled Notice'}</div>
        <div
          className="hc-body"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {announcement.description || announcement.body || 'No summary text provided.'}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', fontWeight: 500 }}>
          {formattedDate}
        </span>
        <button
          className="hc-btn hc-btn--ghost"
          style={{ padding: '6px 12px', fontSize: 11 }}
          onClick={() => onReadMore?.(announcement)}
        >
          Read Advisory <ArrowRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

function RankingsSlide({
  spotlights = [],
  loading = false,
  error = false,
  onViewRankings,
}) {
  const Medals = [Trophy, Medal, Award]

  const sortedTop3 = useMemo(() => {
    if (!spotlights || spotlights.length === 0) return []
    return [...spotlights]
      .filter(b => b && (b.barangay_name || b.barangay))
      .sort((a, b) => (typeof b.score === 'number' ? b.score : -1) - (typeof a.score === 'number' ? a.score : -1))
      .slice(0, 3)
  }, [spotlights])

  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <Trophy size={14} strokeWidth={2.2} />
          Cleanliness Rankings
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">Top Cleanest Barangays</div>
        <div style={{ marginTop: 4 }}>
          {loading ? (
            <div className="hc-body">Loading published standings…</div>
          ) : error ? (
            <div className="hc-body">Standings are temporarily unavailable.</div>
          ) : sortedTop3.length === 0 ? (
            <div className="hc-body">No barangay standings published yet for this period.</div>
          ) : (
            sortedTop3.map((b, i) => {
              const Icon = Medals[i] || Award
              const name =
                b.barangay_name ||
                (typeof b.barangay === 'object' ? b.barangay?.name : b.barangay) ||
                'Barangay'
              const scoreText = typeof b.score === 'number' ? `${b.score}%` : '—'
              return (
                <div key={b.id || i} className="hc-rank-row">
                  <Icon
                    size={15}
                    style={{ flexShrink: 0, color: ['#f59e0b', '#94a3b8', '#b45309'][i] || '#94a3b8' }}
                  />
                  <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,.82)', fontWeight: 600 }}>
                    {name}
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)' }}>{scoreText}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
      <button
        className="hc-btn hc-btn--accent"
        style={{ alignSelf: 'flex-start', padding: '6px 12px' }}
        onClick={onViewRankings}
      >
        <TrendingUp size={14} />
        Full Standings
      </button>
    </div>
  )
}

// ─── CITIZEN SLIDES ───────────────────────────────────────────────────────────

function CitizenReportSlide({ onReport, onViewMap, loadingReport }) {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <Trash2 size={14} />
          Waste Reporting
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">Report a Garbage Issue</div>
        <div className="hc-body">
          See uncollected waste or illegal dumping? Alert your barangay immediately.
        </div>
      </div>
      <div className="hc-btns submit-button">
        <button className="hc-btn hc-btn--white" style={{ flex: 1 }} onClick={onReport} disabled={loadingReport}>
          {loadingReport ? <span className="hc-spinner" /> : <Camera size={14} />}
          Submit Report
        </button>
        <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }} onClick={onViewMap}>
          <MapIcon size={14} />
          View Map
        </button>
      </div>
    </div>
  )
}

// ─── DRIVER SLIDES ────────────────────────────────────────────────────────────

function DriverRouteSlide({ route, onStartRoute, onViewMap, loadingRoute }) {
  const routeData = route || DRIVER_ROUTE
  const pct = routeData.stops > 0 ? Math.round((routeData.completed / routeData.stops) * 100) : 0
  const statusColor = {
    pending: 'var(--warning)',
    late: 'var(--warning)',
    early: 'var(--warning)',
    in_progress: 'var(--accent)',
    done: 'var(--info)',
    suspended: 'var(--danger)',
    no_schedule: 'rgba(255,255,255,0.55)',
  }[routeData.status] || 'var(--accent)'

  const statusLabel = {
    pending: 'NOT STARTED',
    late: routeData.startTime && routeData.startTime !== '—' ? `LATE · ${routeData.startTime}` : 'LATE START',
    early: routeData.startTime && routeData.startTime !== '—' ? `SCHED · ${routeData.startTime}` : 'OFF SCHEDULE',
    in_progress: 'IN PROGRESS',
    done: 'COMPLETED',
    suspended: 'SUSPENDED',
    no_schedule: 'NO DUTY TODAY',
  }[routeData.status] || 'STANDBY'

  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label" style={{ color: 'var(--warning)', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Truck size={14} />
            Today&apos;s Route
          </div>
          <span style={{
            fontSize: 9, background: `${statusColor}18`, color: statusColor,
            border: `1px solid ${statusColor}40`, padding: '2px 8px', borderRadius: 20, fontWeight: 800,
          }}>{statusLabel}</span>
        </div>
        <div className="hc-accent-bar hc-bar--warning" />
        <div className="hc-title">{routeData.label}</div>
        <div style={{ marginBottom: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span className="hc-body" style={{ margin: 0, fontSize: 11.5 }}>
              {routeData.completed}/{routeData.stops} stops · Next: {routeData.nextStop}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)' }}>{pct}%</span>
          </div>
          <div className="hc-progress-track">
            <div className="hc-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="hc-btns submit-button">
        {routeData.status === 'suspended' ? (
          <button className="hc-btn hc-btn--danger" style={{ flex: 1 }} disabled>
            <AlertCircle size={14} />
            Suspended
          </button>
        ) : routeData.status === 'no_schedule' ? (
          <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }} disabled>
            <Ban size={14} />
            No Duty Today
          </button>
        ) : (routeData.status === 'late' || routeData.status === 'early') ? (
          <button className="hc-btn hc-btn--warn" style={{ flex: 1 }} onClick={onStartRoute} disabled={loadingRoute}>
            {loadingRoute ? <span className="hc-spinner" /> : <Clock size={14} />}
            {routeData.ctaLabel || 'Start Late'}
          </button>
        ) : routeData.status === 'pending' ? (
          <button className="hc-btn hc-btn--accent" style={{ flex: 1 }} onClick={onStartRoute} disabled={loadingRoute}>
            {loadingRoute ? <span className="hc-spinner" /> : <PlayCircle size={14} />}
            Start Route
          </button>
        ) : routeData.status === 'in_progress' ? (
          <button className="hc-btn hc-btn--white" style={{ flex: 1 }} onClick={onStartRoute} disabled={loadingRoute}>
            {loadingRoute ? <span className="hc-spinner" /> : <Navigation size={14} />}
            Continue Route
          </button>
        ) : routeData.status === 'done' ? (
          <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }} disabled>
            <CheckCircle size={14} />
            Route Complete
          </button>
        ) : null}
        <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }} onClick={onViewMap}>
          <MapIcon size={14} />
          View Map
        </button>
      </div>
    </div>
  )
}

function DriverStatsSlide({ stats = DRIVER_STATS }) {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label hc-label--info">
          <BarChart size={14} />
          Your Performance
        </div>
        <div className="hc-accent-bar hc-bar--info" />
        <div className="hc-title">This Week&apos;s Summary</div>
        <div className="hc-body">Keep up the great work! Your on-time collection rate is above average.</div>
      </div>
      <div className="hc-pills">
        <div className="hc-pill">
          <span className="hc-pill-val">{stats.thisWeek ?? DRIVER_STATS.thisWeek}</span>
          <span className="hc-pill-lbl">Pickups</span>
        </div>
        <div className="hc-pill">
          <span className="hc-pill-val" style={{ color: 'var(--accent)' }}>{stats.onTime ?? DRIVER_STATS.onTime}</span>
          <span className="hc-pill-lbl">On-Time</span>
        </div>
        <div className="hc-pill">
          <span className="hc-pill-val" style={{ color: 'var(--warning)' }}>{stats.rating ?? DRIVER_STATS.rating}</span>
          <span className="hc-pill-lbl">Rating</span>
        </div>
      </div>
    </div>
  )
}

// ─── WATCHER SLIDES ───────────────────────────────────────────────────────────

function WatcherPendingSlide({ pending, onValidate, onViewMap, loadingValidate }) {
  const pendingData = pending || WATCHER_PENDING
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label hc-label--danger">
          <AlertCircle size={14} />
          Needs Your Review
          {pendingData.urgent > 0 && (
            <span style={{
              background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.4)',
              color: 'var(--danger)', fontSize: 8, fontWeight: 800, padding: '1px 6px',
              borderRadius: 20, letterSpacing: '.06em',
            }}>{pendingData.urgent} URGENT</span>
          )}
        </div>
        <div className="hc-accent-bar hc-bar--danger" />
        <div className="hc-title">{pendingData.count} Reports Pending Validation</div>
        <div className="hc-body">
          Reports in {pendingData.area} need your on-ground assessment to proceed.
        </div>
      </div>
      <div className="hc-btns submit-button">
        <button className="hc-btn hc-btn--danger" style={{ flex: 1 }} onClick={onValidate} disabled={loadingValidate}>
          {loadingValidate ? <span className="hc-spinner" /> : <CheckSquare size={14} />}
          Validate Reports
        </button>
        <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }} onClick={onViewMap}>
          <MapIcon size={14} />
          View on Map
        </button>
      </div>
    </div>
  )
}

function WatcherHotspotsSlide({ onInspectHotspots }) {
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label hc-label--warning">
          <MapPin size={14} />
          Area Status
        </div>
        <div className="hc-accent-bar hc-bar--warning" />
        <div className="hc-title">Active Hotspots in Your Zone</div>
        <div className="hc-pills" style={{ marginTop: 2 }}>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--warning)' }}>{WATCHER_HOTSPOTS.active}</span>
            <span className="hc-pill-lbl">Active</span>
          </div>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--danger)' }}>{WATCHER_HOTSPOTS.high}</span>
            <span className="hc-pill-lbl">High Severity</span>
          </div>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--accent)' }}>3</span>
            <span className="hc-pill-lbl">Monitored</span>
          </div>
        </div>
      </div>
      <button className="hc-btn hc-btn--warn" style={{ alignSelf: 'flex-start', padding: '6px 12px' }} onClick={onInspectHotspots}>
        <Eye size={14} />
        Inspect Hotspots
      </button>
    </div>
  )
}

// ─── OFFICIAL SLIDES ──────────────────────────────────────────────────────────

function OfficialOverviewSlide({ overview, onValidate, onViewReports, loadingValidate }) {
  const data = overview || OFFICIAL_OVERVIEW
  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <Building2 size={14} />
          Barangay Solid Waste Summary
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">Waste Activity Overview</div>
        <div className="hc-pills" style={{ marginTop: 2 }}>
          <div className="hc-pill">
            <span className="hc-pill-val">{data.openReports ?? 0}</span>
            <span className="hc-pill-lbl">Open</span>
          </div>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--warning)' }}>{data.pendingValidation ?? 0}</span>
            <span className="hc-pill-lbl">Pending</span>
          </div>
          <div className="hc-pill">
            <span className="hc-pill-val" style={{ color: 'var(--accent)' }}>{data.resolvedThisWeek ?? 0}</span>
            <span className="hc-pill-lbl">Resolved</span>
          </div>
        </div>
      </div>
      <div className="hc-btns submit-button">
        <button className="hc-btn hc-btn--accent" style={{ flex: 1 }} onClick={onValidate} disabled={loadingValidate}>
          {loadingValidate ? <span className="hc-spinner" /> : <CheckSquare size={14} />}
          Validate ({data.pendingValidation ?? 0})
        </button>
        <button className="hc-btn hc-btn--ghost" style={{ flex: 1 }} onClick={onViewReports}>
          <Activity size={14} />
          All Reports
        </button>
      </div>
    </div>
  )
}

function OfficialRankSlide({
  spotlights = [],
  loading = false,
  error = false,
  userBarangay,
  onViewRankings,
}) {
  const rankedEntry = useMemo(() => {
    if (!spotlights || spotlights.length === 0 || !userBarangay) return null
    const sorted = [...spotlights]
      .filter(b => b && (b.barangay_name || b.barangay))
      .sort((a, b) => (typeof b.score === 'number' ? b.score : -1) - (typeof a.score === 'number' ? a.score : -1))
    const idx = sorted.findIndex(
      b =>
        (b.barangay_name || (typeof b.barangay === 'object' ? b.barangay?.name : b.barangay) || '').toLowerCase() ===
        userBarangay.toLowerCase()
    )
    if (idx === -1) return null
    return { rank: idx + 1, item: sorted[idx] }
  }, [spotlights, userBarangay])

  return (
    <div className="hc-slide">
      <div>
        <div className="hc-label">
          <Trophy size={14} strokeWidth={2.2} />
          City Standings
        </div>
        <div className="hc-accent-bar" />
        <div className="hc-title">{userBarangay || 'Your Barangay'} Standings</div>
        <div className="hc-body">
          {loading ? (
            'Loading published standings…'
          ) : error ? (
            'Standings are temporarily unavailable.'
          ) : rankedEntry ? (
            <>
              Currently ranked <strong style={{ color: '#fff' }}>#{rankedEntry.rank}</strong> with{' '}
              <strong style={{ color: 'var(--accent)' }}>
                {typeof rankedEntry.item.score === 'number' ? `${rankedEntry.item.score}%` : '—'}
              </strong>{' '}
              compliance in published standings.
            </>
          ) : userBarangay ? (
            `No published standing is currently recorded for ${userBarangay}.`
          ) : (
            'Official standings will appear here once published by the evaluation team.'
          )}
        </div>
      </div>
      <button
        className="hc-btn hc-btn--accent"
        style={{ alignSelf: 'flex-start', padding: '6px 12px' }}
        onClick={onViewRankings}
      >
        <TrendingUp size={14} />
        View Full Standings
      </button>
    </div>
  )
}

// ─── DOTS INDICATOR ───────────────────────────────────────────────────────────

function Dots({ count, active, onDotClick }) {
  return (
    <div className="hc-dots">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          aria-label={`Slide ${i + 1}`}
          onClick={() => onDotClick(i)}
          className={`hc-dot ${i === active ? 'hc-dot-active' : 'hc-dot-inactive'}`}
        />
      ))}
    </div>
  )
}

// ─── SLIDE SETS BY ROLE ───────────────────────────────────────────────────────

function CitizenSlides({
  onReport,
  onViewMap,
  onReadMore,
  onViewRankings,
  loading,
  announcement,
  announcementLoading,
  announcementError,
  spotlights,
  spotlightsLoading,
  spotlightsError,
}) {
  return (
    <>
      <CitizenReportSlide onReport={onReport} onViewMap={onViewMap} loadingReport={loading.report} />
      <AnnouncementSlide
        announcement={announcement}
        loading={announcementLoading}
        error={announcementError}
        onReadMore={onReadMore}
      />
      <RankingsSlide
        spotlights={spotlights}
        loading={spotlightsLoading}
        error={spotlightsError}
        onViewRankings={onViewRankings}
      />
    </>
  )
}

function DriverSlides({
  onStartRoute,
  onViewMap,
  onReadMore,
  driverStats,
  driverRoute,
  loading,
  announcement,
  announcementLoading,
  announcementError,
}) {
  return (
    <>
      <DriverRouteSlide route={driverRoute} onStartRoute={onStartRoute} onViewMap={onViewMap} loadingRoute={loading.route} />
      <DriverStatsSlide stats={driverStats} />
      <AnnouncementSlide
        announcement={announcement}
        loading={announcementLoading}
        error={announcementError}
        onReadMore={onReadMore}
      />
    </>
  )
}

function WatcherSlides({
  onValidate,
  onViewMap,
  onInspectHotspots,
  onReadMore,
  loading,
  announcement,
  announcementLoading,
  announcementError,
}) {
  return (
    <>
      <WatcherPendingSlide pending={loading.pending} onValidate={onValidate} onViewMap={onViewMap} loadingValidate={loading.validate} />
      <WatcherHotspotsSlide onInspectHotspots={onInspectHotspots} />
      <AnnouncementSlide
        announcement={announcement}
        loading={announcementLoading}
        error={announcementError}
        onReadMore={onReadMore}
      />
    </>
  )
}

function OfficialSlides({
  onValidate,
  onViewReports,
  userBarangay,
  onViewRankings,
  onReadMore,
  loading,
  announcement,
  announcementLoading,
  announcementError,
  spotlights,
  spotlightsLoading,
  spotlightsError,
}) {
  return (
    <>
      <OfficialOverviewSlide overview={loading.overview} onValidate={onValidate} onViewReports={onViewReports} loadingValidate={loading.validate} />
      <AnnouncementSlide
        announcement={announcement}
        loading={announcementLoading}
        error={announcementError}
        onReadMore={onReadMore}
      />
      <OfficialRankSlide
        spotlights={spotlights}
        loading={spotlightsLoading}
        error={spotlightsError}
        userBarangay={userBarangay}
        onViewRankings={onViewRankings}
      />
    </>
  )
}

// ─── MAIN CAROUSEL ────────────────────────────────────────────────────────────

export default function HomeCarousel({
  role = 'citizen',
  userBarangay = '',
  announcements: propAnnouncements,
  onReport,
  onValidate,
  onStartRoute,
  onViewMap,
  onReadMore,
  onInspectHotspots,
  onViewReports,
  loading = {},
  driverStats,
  driverRoute,
}) {
  const navigate = useNavigate()
  const TOTAL = 3

  const [active, setActive] = useState(0)
  const [rankOpen, setRankOpen] = useState(false)
  const [liveAnnouncements, setLiveAnnouncements] = useState([])
  const [announcementsLoading, setAnnouncementsLoading] = useState(false)
  const [announcementsError, setAnnouncementsError] = useState(false)

  const [spotlights, setSpotlights] = useState([])
  const [spotlightsLoading, setSpotlightsLoading] = useState(false)
  const [spotlightsError, setSpotlightsError] = useState(false)

  const startX = useRef(0)
  const dragging = useRef(false)
  const autoTimer = useRef(null)
  const pauseTimer = useRef(null)

  injectStyles()

  // Load announcements from API if not supplied as prop
  useEffect(() => {
    if (propAnnouncements && Array.isArray(propAnnouncements) && propAnnouncements.length > 0) {
      setLiveAnnouncements(propAnnouncements)
      setAnnouncementsLoading(false)
      setAnnouncementsError(false)
      return
    }

    let activeEffect = true
    setAnnouncementsLoading(true)
    setAnnouncementsError(false)

    api
      .get('/api/news/items/for-dashboard/')
      .then(res => {
        if (!activeEffect) return
        const data = Array.isArray(res.data) ? res.data : (res.data?.results || [])
        setLiveAnnouncements(data)
        setAnnouncementsError(false)
      })
      .catch(() => {
        if (!activeEffect) return
        setAnnouncementsError(true)
      })
      .finally(() => {
        if (activeEffect) setAnnouncementsLoading(false)
      })

    return () => {
      activeEffect = false
    }
  }, [propAnnouncements])

  // Load spotlights for rankings slides
  useEffect(() => {
    let activeEffect = true
    setSpotlightsLoading(true)
    setSpotlightsError(false)

    api
      .get('/api/news/spotlights/')
      .then(res => {
        if (!activeEffect) return
        const data = Array.isArray(res.data) ? res.data : (res.data?.results || [])
        setSpotlights(data)
        setSpotlightsError(false)
      })
      .catch(() => {
        if (!activeEffect) return
        setSpotlightsError(true)
      })
      .finally(() => {
        if (activeEffect) setSpotlightsLoading(false)
      })

    return () => {
      activeEffect = false
    }
  }, [])

  // Resolve top urgent announcement
  const activeAnnouncement = useMemo(() => {
    if (!liveAnnouncements || liveAnnouncements.length === 0) return null
    const sorted = [...liveAnnouncements].sort((a, b) => {
      const aEmer = a.type === 'emergency' ? 1 : 0
      const bEmer = b.type === 'emergency' ? 1 : 0
      if (aEmer !== bEmer) return bEmer - aEmer

      const aHigh = a.priority === 'high' ? 1 : 0
      const bHigh = b.priority === 'high' ? 1 : 0
      if (aHigh !== bHigh) return bHigh - aHigh

      const aPin = a.is_pinned ? 1 : 0
      const bPin = b.is_pinned ? 1 : 0
      if (aPin !== bPin) return bPin - aPin

      return new Date(b.date || 0) - new Date(a.date || 0)
    })
    return sorted[0]
  }, [liveAnnouncements])

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
      setActive(p => (d > 0 ? Math.min(p + 1, TOTAL - 1) : Math.max(p - 1, 0)))
    }
  }

  const handleViewRankings = useCallback(() => {
    pauseAuto()
    setRankOpen(true)
  }, [pauseAuto])

  const handleDotClick = useCallback(
    i => {
      setActive(i)
      pauseAuto()
    },
    [pauseAuto]
  )

  const resolvedOnReport = onReport ?? (() => navigate('/report/submit'))
  const resolvedOnValidate = onValidate ?? (() => navigate('/reports/validate'))
  const resolvedOnStartRoute = onStartRoute ?? (() => navigate('/route'))
  const resolvedOnViewMap = onViewMap ?? (() => navigate('/map'))
  const resolvedOnReadMore =
    onReadMore ??
    (item => {
      if (item?.id) {
        navigate(`/announcements?article=${item.id}`)
      } else {
        navigate('/announcements')
      }
    })
  const resolvedOnInspectHotspots = onInspectHotspots ?? (() => navigate('/map'))
  const resolvedOnViewReports = onViewReports ?? (() => navigate('/reports'))

  const renderSlides = () => {
    switch (role) {
      case 'driver':
        return (
          <DriverSlides
            onStartRoute={resolvedOnStartRoute}
            onViewMap={resolvedOnViewMap}
            onReadMore={resolvedOnReadMore}
            driverStats={driverStats}
            driverRoute={driverRoute}
            loading={loading}
            announcement={activeAnnouncement}
            announcementLoading={announcementsLoading}
            announcementError={announcementsError}
          />
        )
      case 'watcher':
        return (
          <WatcherSlides
            onValidate={resolvedOnValidate}
            onViewMap={resolvedOnViewMap}
            onInspectHotspots={resolvedOnInspectHotspots}
            onReadMore={resolvedOnReadMore}
            loading={loading}
            announcement={activeAnnouncement}
            announcementLoading={announcementsLoading}
            announcementError={announcementsError}
          />
        )
      case 'brgy_official':
        return (
          <OfficialSlides
            onValidate={resolvedOnValidate}
            onViewReports={resolvedOnViewReports}
            userBarangay={userBarangay}
            onViewRankings={handleViewRankings}
            onReadMore={resolvedOnReadMore}
            loading={loading || {}}
            announcement={activeAnnouncement}
            announcementLoading={announcementsLoading}
            announcementError={announcementsError}
            spotlights={spotlights}
            spotlightsLoading={spotlightsLoading}
            spotlightsError={spotlightsError}
          />
        )
      case 'citizen':
      default:
        return (
          <CitizenSlides
            onReport={resolvedOnReport}
            onViewMap={resolvedOnViewMap}
            onReadMore={resolvedOnReadMore}
            onViewRankings={handleViewRankings}
            loading={loading || {}}
            announcement={activeAnnouncement}
            announcementLoading={announcementsLoading}
            announcementError={announcementsError}
            spotlights={spotlights}
            spotlightsLoading={spotlightsLoading}
            spotlightsError={spotlightsError}
          />
        )
    }
  }

  return (
    <>
      <div>
        <div
          className="hc-root"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={e => {
            if (dragging.current) onUp(e)
          }}
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