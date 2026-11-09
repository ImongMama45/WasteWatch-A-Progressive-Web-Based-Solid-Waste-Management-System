/**
 * DriverStatusPanel.jsx — Shift & Truck Command Center
 * -----------------------------------------------------
 * Manages driver shift lifecycle, live operational status,
 * truck assignment details, and today's route progress.
 *
 * Supports dual display modes:
 *  1. Standalone full page (via /driver/status)
 *  2. Overlay modal / drawer (via isOverlay=true or onClose prop)
 *
 * Strictly SVG iconography (NO emojis) in compliance with project rules.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock,
  Truck,
  Play,
  Square,
  Navigation,
  CheckCircle2,
  AlertTriangle,
  User,
  Shield,
  MapPin,
  X,
  ChevronRight,
  Activity,
  ArrowRight,
  ChevronLeft,
  Circle,
  AlertCircle,
  FileText,
  Calendar,
  Ban
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import api, { handleStaleShift } from '../../api/client'
import useShiftTimer from '../../hooks/useShiftTimer'
import {
  resolveDriverSchedule,
  evaluateScheduleShiftTiming,
  formatScheduleDays,
} from '../../utils/driverSchedule'
import DriverSuiteHeader from './components/DriverSuiteHeader'
import DriverCollectionLog from './DriverCollectionLog'
import DriverHotspotAlert from './DriverHotspotAlert'
import { FeedCardSkeleton, SidebarWidgetSkeleton } from '../../components/ui/Skeleton'

// ─── DEFAULT FALLBACKS ────────────────────────────────────────────────────────

const DEFAULT_DRIVER = {
  name: 'Driver',
  employeeId: 'DRV-—',
  truck: 'TRUCK —',
  plateNumber: '—',
  barangay: 'Lucena City',
  route: 'Assigned Route',
}

const DEFAULT_ROUTE = {
  totalStops: 0,
  completedStops: 0,
}

// ─── STATUS CONFIG (NO EMOJIS) ────────────────────────────────────────────────

const STATUS_CONFIG = {
  off_shift: {
    label: 'Off Duty',
    color: '#65676b',
    bg: '#f0f2f5',
    border: '#ced0d4',
    Icon: Circle,
  },
  on_shift: {
    label: 'On Shift',
    color: '#15803d',
    bg: '#e7f5eb',
    border: '#bbf7d0',
    Icon: CheckCircle2,
  },
  on_route: {
    label: 'On Route',
    color: '#1d4ed8',
    bg: '#dbeafe',
    border: '#bfdbfe',
    Icon: Navigation,
  },
  delayed: {
    label: 'Delayed / Traffic',
    color: '#b45309',
    bg: '#fef3c7',
    border: '#fde68a',
    Icon: AlertTriangle,
  },
}

const STATUS_OPTIONS = ['on_shift', 'on_route', 'delayed']

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function InfoItem({ label, value, icon: Icon }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '1px solid #e4e6eb',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={14} style={{ color: '#65676b' }} />}
        <span style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#1c1e21' }}>
        {value || '—'}
      </span>
    </div>
  )
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.off_shift
  const Icon = cfg.Icon

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 4,
      padding: '3px 8px',
    }}>
      <Icon size={12} style={{ color: cfg.color }} />
      <span style={{ fontWeight: 700, fontSize: 11, color: cfg.color, letterSpacing: '0.04em' }}>
        {cfg.label.toUpperCase()}
      </span>
    </div>
  )
}

function RouteProgressBar({ completed, total }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Route Completion</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#10b981' }}>{pct}%</span>
      </div>
      <div style={{ background: 'var(--surface-2, rgba(0,0,0,0.06))', borderRadius: 99, height: 8, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          borderRadius: 99,
          background: 'linear-gradient(90deg, #10b981, #059669)',
          width: `${pct}%`,
          transition: 'width .5s ease',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{completed} completed</span>
        <span>{Math.max(0, total - completed)} remaining</span>
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DriverStatusPanel({ isOverlay = false, open = true, onClose }) {
  const { user } = useAuth()
  const { notify } = useNotification()
  const navigate = useNavigate()

  const [driver, setDriver] = useState(DEFAULT_DRIVER)
  const [route, setRoute] = useState(DEFAULT_ROUTE)
  const [schedule, setSchedule] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [opStatus, setOpStatus] = useState('off_shift')
  const [loading, setLoading] = useState(true)
  const [ending, setEnding] = useState(false)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [logsOverlayOpen, setLogsOverlayOpen] = useState(false)
  const [hotspotsOverlayOpen, setHotspotsOverlayOpen] = useState(false)

  // Shift timer hook
  const {
    shiftActive,
    startTime,
    formattedTime,
    scheduleId: activeScheduleId,
    endShift,
  } = useShiftTimer()

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  // Sync operational status with active timer
  useEffect(() => {
    if (shiftActive && opStatus === 'off_shift') setOpStatus('on_shift')
    if (!shiftActive) setOpStatus('off_shift')
  }, [shiftActive])

  useEffect(() => {
    if (!user?.id) {
      setLoading(false)
      return
    }
    Promise.all([
      api.get('/api/driver/shift/profile/').catch(() => ({ data: null })),
      api.get('/api/driver/route-assignments/today/').catch(() => ({ data: null })),
      api.get('/api/driver/collection-schedules/?paginate=false').catch(() => ({ data: [] })),
    ]).then(([profRes, routeRes, schedRes]) => {
      if (profRes.data) setDriver(d => ({ ...d, ...profRes.data }))
      if (routeRes.data) setRoute(r => ({ ...r, ...routeRes.data }))
      const match = resolveDriverSchedule(schedRes.data, user.id, activeScheduleId)
      setSchedule(match || null)
    }).finally(() => setLoading(false))
  }, [user?.id, activeScheduleId])

  const todayWeekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const timing = evaluateScheduleShiftTiming(schedule, now)
  const hasScheduleToday = timing.hasScheduleToday
  const isRouteDone = schedule?.truck_status === 'completed'
  const isShiftEndedIncomplete = schedule?.truck_status === 'returning_unfinished'
  const isShiftDone = isRouteDone || isShiftEndedIncomplete
  const isStartBlocked = Boolean(
    user?.is_suspended ||
    !schedule ||
    !hasScheduleToday ||
    isShiftDone
  )

  function handleStartShift() {
    if (user?.is_suspended) {
      notify({ variant: 'error-dark', message: 'Your account is suspended. You cannot start a shift.' })
      return
    }
    if (!schedule || !hasScheduleToday) {
      notify({ variant: 'warning-dark', message: 'You have no scheduled collection duty for today.' })
      return
    }
    if (isShiftDone) {
      notify({ variant: 'warning-dark', message: "Today's route has already ended." })
      return
    }
    if (onClose) onClose()
    navigate('/driver/flow')
  }

  function handleContinueDuty() {
    sessionStorage.setItem('ww_route_state', 'navigating')
    if (onClose) onClose()
    navigate('/driver/flow')
  }

  async function handleConfirmEndShift() {
    setEnding(true)
    setShowEndConfirm(false)
    try {
      const endTime = new Date()
      const durationMs = startTime ? (endTime - new Date(startTime)) : 0
      await endShift({
        scheduleId: schedule?.id ?? activeScheduleId,
        started_at: startTime ? new Date(startTime).toISOString() : null,
        ended_at: endTime.toISOString(),
        duration_ms: durationMs,
      })
      setOpStatus('off_shift')
      notify({ variant: 'success', message: 'Shift ended successfully. Great job today!' })
    } catch (err) {
      if (handleStaleShift(err)) return
      notify({ variant: 'error-dark', message: err.response?.data?.error || 'Failed to end shift. Please try again.' })
    } finally {
      setEnding(false)
    }
  }

  function handleStatusChange(newStatus) {
    if (!shiftActive) return
    setOpStatus(newStatus)
    api.post('/api/driver/shift/status/', { status: newStatus }).catch(() => { })
  }

  if (isOverlay && !open) return null

  const content = (
    <div className="dsp-content-wrapper" style={{
      minHeight: isOverlay ? 'auto' : '100vh',
      backgroundColor: isOverlay ? 'transparent' : '#f0f2f5',
      padding: isOverlay ? 0 : '20px 24px',
      color: '#1c1e21',
    }}>
      <style>{`
        .dsp-timer-display {
          font-family: 'Roboto Mono', monospace, -apple-system, sans-serif;
          font-variant-numeric: tabular-nums;
        }
        .dsp-status-chip {
          transition: all 0.15s ease;
        }
        .dsp-status-chip:hover {
          opacity: 0.9;
        }
      `}</style>

      {/* ── UNIFIED DRIVER SUITE HEADER (When standalone page) ── */}
      {!isOverlay && (
        <DriverSuiteHeader
          activeTab="status"
          title="Shift & Truck Status"
          subtitle={loading ? 'Driver Command Center' : `${driver.truck || 'TRUCK'} · ${driver.barangay || 'Lucena City'} · Driver Command Center`}
          truck={loading ? undefined : (driver.truck || driver.plateNumber)}
          barangay={loading ? undefined : driver.barangay}
          shiftActive={shiftActive}
          opStatus={opStatus}
          onOpenOverlay={(modalKey) => {
            if (modalKey === 'logs') setLogsOverlayOpen(true)
            else if (modalKey === 'hotspots') setHotspotsOverlayOpen(true)
            else if (modalKey === 'route') navigate('/driver/route')
          }}
          rightContent={
            <StatusBadge status={opStatus} />
          }
        />
      )}

      {/* ── OVERLAY HEADER (When in modal mode) ── */}
      {isOverlay && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid #e4e6eb',
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#1c1e21' }}>
              Driver Command Center
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#65676b' }}>
              {loading ? 'Loading assignment details...' : `${driver.truck} · ${driver.barangay}`}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusBadge status={opStatus} />
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  background: '#ffffff',
                  border: '1px solid #ced0d4',
                  borderRadius: 6,
                  padding: 6,
                  color: '#65676b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── RESPONSIVE 2-COLUMN LAYOUT (DESKTOP) / STACKED (MOBILE) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: 16,
        alignItems: 'start',
      }}>
        {/* ── LEFT COLUMN: SHIFT HUD, PRIMARY CONTROLS & ROUTE PROGRESS ── */}
        <div>
          {loading ? (
            <FeedCardSkeleton count={2} />
          ) : (
          <div className="ww-fade-in">
          {/* SHIFT TIMER HERO HUD */}
          <div style={{
            background: '#ffffff',
            borderRadius: 8,
            padding: '24px 20px',
            marginBottom: 16,
            textAlign: 'center',
            color: '#1c1e21',
            border: '1px solid #e4e6eb',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
          }}>
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: shiftActive ? '#15803d' : '#65676b',
              textTransform: 'uppercase',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}>
              <Clock size={14} color={shiftActive ? '#16a34a' : '#65676b'} /> {shiftActive ? 'LIVE SHIFT DURATION' : 'DRIVER STANDBY'}
            </div>

            <div
              className="dsp-timer-display"
              style={{
                fontSize: 'clamp(36px, 5vw, 48px)',
                fontWeight: 700,
                letterSpacing: '0.02em',
                color: shiftActive ? '#15803d' : '#1c1e21',
                margin: '6px 0',
              }}
            >
              {shiftActive ? formattedTime : '00:00:00'}
            </div>

            {shiftActive && startTime && (
              <div style={{ fontSize: 12, color: '#65676b', marginTop: 4 }}>
                Started at {startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>

          {/* PRIMARY SHIFT ACTIONS */}
          <div style={{ marginBottom: 16 }}>
            {!shiftActive ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {user?.is_suspended && (
                  <div style={{
                    background: 'rgba(220, 38, 38, 0.08)',
                    border: '1px solid rgba(220, 38, 38, 0.35)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    color: '#991b1b',
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}>
                    <Ban size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: 2 }}>Account Suspended</strong>
                      You cannot start a shift while unresolved escalations remain on your profile.
                    </div>
                  </div>
                )}

                {!user?.is_suspended && (!schedule || !hasScheduleToday) && (
                  <div style={{
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.38)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    color: '#92400e',
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}>
                    <Calendar size={16} style={{ flexShrink: 0, marginTop: 2, color: '#b45309' }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: 2 }}>No Scheduled Duty Today</strong>
                      {schedule
                        ? <>Today is <strong>{todayWeekday}</strong>. Your route only runs on <strong>{formatScheduleDays(schedule.days)}</strong>.</>
                        : 'No collection schedule is assigned to your account today.'}
                    </div>
                  </div>
                )}

                {!user?.is_suspended && schedule && hasScheduleToday && !isShiftDone && timing.isOffSchedule && (
                  <div style={{
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.45)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    color: '#92400e',
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}>
                    <Clock size={16} style={{ flexShrink: 0, marginTop: 2, color: '#d97706' }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: 2 }}>
                        {timing.isLate ? 'Off-Schedule Late Start' : 'Off-Schedule Early Start'}
                      </strong>
                      Your shift is scheduled for <strong>{timing.formattedWindow || timing.formattedStart}</strong> today.
                    </div>
                  </div>
                )}

                <button
                  onClick={handleStartShift}
                  disabled={isStartBlocked}
                  style={{
                    width: '100%',
                    padding: '12px 18px',
                    borderRadius: 6,
                    background: isStartBlocked
                      ? '#e4e6eb'
                      : timing.isOffSchedule
                        ? '#d97706'
                        : '#16a34a',
                    color: isStartBlocked ? '#8a8d91' : '#ffffff',
                    border: 'none',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: isStartBlocked ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    textAlign: 'center',
                    boxShadow: isStartBlocked ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.05)',
                    transition: 'background 0.15s ease',
                  }}
                >
                  {user?.is_suspended ? (
                    <><Ban size={16} /> Account Suspended</>
                  ) : (!schedule || !hasScheduleToday) ? (
                    <><Ban size={16} /> No Collection Today</>
                  ) : isRouteDone ? (
                    <><CheckCircle2 size={16} /> Route Completed Today</>
                  ) : isShiftEndedIncomplete ? (
                    <><CheckCircle2 size={16} /> Shift Ended Early</>
                  ) : timing.isOffSchedule ? (
                    <><Clock size={16} /> {timing.statusPanelCtaLabel}</>
                  ) : (
                    <><Play size={16} fill="currentColor" /> Start Today's Shift</>
                  )}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={handleContinueDuty}
                  style={{
                    width: '100%',
                    padding: '12px 18px',
                    borderRadius: 6,
                    background: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <Truck size={16} /> Continue Route Duty
                </button>

                {/* Operational status toggle bar + End Shift */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 240 }}>
                    {STATUS_OPTIONS.map(s => {
                      const cfg = STATUS_CONFIG[s]
                      const active = opStatus === s
                      const Icon = cfg.Icon

                      return (
                        <button
                          key={s}
                          onClick={() => handleStatusChange(s)}
                          className="dsp-status-chip"
                          style={{
                            flex: 1,
                            padding: '8px 6px',
                            borderRadius: 6,
                            background: active ? '#ffffff' : '#f0f2f5',
                            border: `1.5px solid ${active ? '#16a34a' : '#e4e6eb'}`,
                            color: active ? '#15803d' : '#65676b',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 5,
                            boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                          }}
                        >
                          <Icon size={13} color={active ? '#16a34a' : '#65676b'} /> {cfg.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* End Shift Button */}
                  <button
                    onClick={() => setShowEndConfirm(true)}
                    disabled={ending}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 6,
                      background: '#fee2e2',
                      border: '1px solid #fecaca',
                      color: '#b91c1c',
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: ending ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    <Square size={13} fill="currentColor" /> {ending ? 'Ending…' : 'End Shift'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* TODAY'S ROUTE PROGRESS */}
          {shiftActive && (
            <div style={{
              background: '#ffffff',
              border: '1px solid #e4e6eb',
              borderRadius: 8,
              padding: '20px',
              marginBottom: 16,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
                  Today's Route Progress
                </h3>
                <span style={{ fontSize: 11, color: '#65676b', fontWeight: 600 }}>
                  Live Synchronization
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                <div style={{
                  background: '#e7f5eb',
                  border: '1px solid #bbf7d0',
                  borderRadius: 6,
                  padding: '10px 6px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#15803d' }}>{route.completedStops}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Done</div>
                </div>

                <div style={{
                  background: '#fef3c7',
                  border: '1px solid #fde68a',
                  borderRadius: 6,
                  padding: '10px 6px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#b45309' }}>
                    {Math.max(0, route.totalStops - route.completedStops)}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Remaining</div>
                </div>

                <div style={{
                  background: '#f0f2f5',
                  border: '1px solid #e4e6eb',
                  borderRadius: 6,
                  padding: '10px 6px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1e21' }}>{route.totalStops}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Total</div>
                </div>
              </div>

              <RouteProgressBar completed={route.completedStops} total={route.totalStops} />

              <button
                onClick={() => {
                  if (onClose) onClose()
                  navigate('/driver/route')
                }}
                style={{
                  marginTop: 14,
                  width: '100%',
                  padding: '10px',
                  borderRadius: 6,
                  background: '#ffffff',
                  border: '1px solid #ced0d4',
                  color: '#1c1e21',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <MapPin size={14} color="#16a34a" /> View Full Route Map <ArrowRight size={14} />
              </button>
            </div>
          )}
          </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: DRIVER & TRUCK DETAILS + QUICK LINKS ── */}
        <div>
          {loading ? (
            <div style={{
              background: '#ffffff',
              border: '1px solid #e4e6eb',
              borderRadius: 8,
              padding: '20px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <SidebarWidgetSkeleton rows={4} showHeader />
            </div>
          ) : (
          <div className="ww-fade-in">
          {/* Driver Information */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e4e6eb',
            borderRadius: 8,
            padding: '20px',
            marginBottom: 16,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <User size={15} style={{ color: '#2563eb' }} />
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
                Driver Information
              </h3>
            </div>
            <InfoItem label="Name" value={driver.name} />
            <InfoItem label="Employee ID" value={driver.employeeId} />
            <InfoItem label="Barangay" value={driver.barangay} />
            <InfoItem label="Assigned Route" value={driver.route} />
          </div>

          {/* Truck Assignment */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e4e6eb',
            borderRadius: 8,
            padding: '20px',
            marginBottom: 16,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Truck size={15} style={{ color: '#16a34a' }} />
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
                Truck Assignment
              </h3>
            </div>
            <InfoItem label="Truck Number" value={driver.truck} />
            <InfoItem label="Plate Number" value={driver.plateNumber} />

            <div style={{ paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#65676b', textTransform: 'uppercase', marginBottom: 6 }}>
                Vehicle Status
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['Operational', 'Needs Maintenance', 'Out of Service'].map(s => {
                  const isOp = s === 'Operational'
                  return (
                    <span
                      key={s}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: isOp ? '#e7f5eb' : '#f0f2f5',
                        border: `1px solid ${isOp ? '#bbf7d0' : '#ced0d4'}`,
                        color: isOp ? '#15803d' : '#65676b',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {isOp && <CheckCircle2 size={12} />} {s}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Quick Collection Log Navigation Card */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e4e6eb',
            borderRadius: 8,
            padding: '20px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1c1e21', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 6px' }}>
              Collection Audit Records
            </h3>
            <p style={{ fontSize: 12, color: '#65676b', margin: '0 0 12px', lineHeight: 1.5 }}>
              Review past completed stops, category distribution, and verified timestamps over the last 7 days.
            </p>
            <button
              onClick={() => setLogsOverlayOpen(true)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: 6,
                background: '#ffffff',
                border: '1px solid #ced0d4',
                color: '#1c1e21',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <FileText size={14} color="#16a34a" /> Open Collection Logs Overlay <ArrowRight size={14} />
            </button>
          </div>
          </div>
          )}
        </div>
      </div>

      {/* ── CONFIRM END SHIFT MODAL ── */}
      {showEndConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: 24,
            maxWidth: 420,
            width: '100%',
            boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}>
              <AlertTriangle size={22} />
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px', color: 'var(--text)' }}>
              End Today's Shift?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Your shift duration ({formattedTime}) will be finalized and sent to the dispatch log.
              Make sure all scheduled collections for today are completed or logged.
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowEndConfirm(false)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  background: 'var(--surface-2, rgba(0,0,0,0.05))',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEndShift}
                style={{
                  padding: '10px 18px',
                  borderRadius: 10,
                  background: '#ef4444',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Square size={14} fill="currentColor" /> Yes, End Shift
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── COLLECTION LOGS OVERLAY MODAL ── */}
      {logsOverlayOpen && (
        <DriverCollectionLog
          isOverlay={true}
          open={true}
          onClose={() => setLogsOverlayOpen(false)}
        />
      )}

      {/* ── HOTSPOT ALERTS OVERLAY MODAL ── */}
      {hotspotsOverlayOpen && (
        <DriverHotspotAlert
          isOverlay={true}
          open={true}
          onClose={() => setHotspotsOverlayOpen(false)}
        />
      )}
    </div>
  )

  // ── Overlay Modal Wrapper vs Standalone Page ──
  if (isOverlay) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
      }}>
        <div style={{
          background: 'var(--surface)',
          borderRadius: 22,
          border: '1px solid var(--border)',
          maxWidth: 900,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        }}>
          {content}
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '20px 24px 100px' }}>
      {content}
    </div>
  )
}
