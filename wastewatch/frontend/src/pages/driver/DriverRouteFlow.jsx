import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardList,
  Home,
  CheckCircle2,
  MapPin,
  Truck,
  Package,
  Flag,
  Wrench,
  X,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Minimize2
} from 'lucide-react'
import api, { handleStaleShift } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import { clearDriverSessionData } from '../../hooks/useShiftTimer'
import { DriverGpsProvider } from '../../context/DriverGpsContext'
import {
  canUseDevShiftReset,
  runShiftEligibilityCheck,
  advanceFlowPhase,
} from '../../utils/driverFlowGuard'
import AssignmentModule from './components/AssignmentModule'
import NavigateToBaseModule from './components/NavigateToBaseModule'
import ConfirmStartModule from './components/ConfirmStartModule'
import CheckInModule from './components/CheckInModule'
import ShiftRouteModule from './components/ShiftRouteModule'
import EndShiftModule from './components/EndShiftModule'
import { MobileFlowSkeleton } from '../../components/ui/Skeleton'

// ─── PHASE METADATA (STRICTLY SVG - ZERO EMOJIS) ─────────────────────────────
const PHASES = [
  { key: 'assignment', label: 'Assignment', icon: ClipboardList, color: '#6366f1', desc: 'Select truck & schedule' },
  { key: 'navigate_to_base', label: 'Navigate to Base', icon: Home, color: '#0ea5e9', desc: 'Head to collection base' },
  { key: 'confirm_start', label: 'Confirm Start', icon: CheckCircle2, color: '#16a34a', desc: 'Confirm shift start' },
  { key: 'checkin', label: 'Check-in', icon: MapPin, color: '#f59e0b', desc: 'Driver check-in & briefing' },
  { key: 'shiftroute', label: 'On Route', icon: Truck, color: '#2563eb', desc: 'Collecting waste stops' },
  { key: 'truck_not_full', label: 'Truck Not Full', icon: Package, color: '#ea580c', desc: 'Route done — missed stops review', devOnly: true },
  { key: 'end_shift', label: 'End Shift', icon: Flag, color: '#dc2626', desc: 'Return to dumpsite / end' },
]

// ─── DEV PHASE SWITCHER ───────────────────────────────────────────────────────
function DevPhaseSwitcher({ currentPhase, activeShift, user, canDevReset, onJump }) {
  const [open, setOpen] = useState(false)
  const [jumping, setJumping] = useState(null)
  const [resetting, setResetting] = useState(false)

  if (!import.meta.env.DEV) return null

  const canResetShift = canUseDevShiftReset({
    isDevEnv: import.meta.env.DEV,
    activeShift,
    user,
    canDevReset,
    isBusy: Boolean(jumping) || resetting,
  })

  async function jump(phaseKey) {
    if (phaseKey === currentPhase || jumping) return
    setJumping(phaseKey)
    await onJump(phaseKey)
    setJumping(null)
    setOpen(false)
  }

  return (
    <>
      <style>{`
        @keyframes devPop {
          from { opacity:0; transform:translateY(6px) scale(.98); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
      `}</style>

      {/* ── FLOATING TRIGGER BUTTON ── */}
      <button
        id="dev-phase-switcher-btn"
        onClick={() => setOpen(o => !o)}
        title="DEV: Jump to any phase"
        style={{
          position: 'fixed', bottom: 160, right: 16, zIndex: 9990,
          width: 44, height: 44, borderRadius: 8,
          background: open ? '#1c1e21' : '#ffffff',
          color: open ? '#ffffff' : '#1c1e21',
          border: '1px solid #ced0d4',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          transition: 'all .15s',
        }}
      >
        {open ? <X size={20} /> : <Wrench size={20} />}
      </button>

      {/* ── PHASE PANEL ── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 144, right: 16, zIndex: 9989,
          width: 270,
          background: '#ffffff',
          borderRadius: 8, padding: '12px 0',
          border: '1px solid #e4e6eb',
          boxShadow: '0 8px 30px rgba(0,0,0,0.14)',
          animation: 'devPop .15s ease',
        }}>
          {/* Header */}
          <div style={{ padding: '0 16px 10px', borderBottom: '1px solid #e4e6eb' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1c1e21', letterSpacing: '.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wrench size={13} color="#16a34a" /> DEV — PHASE SWITCHER
            </div>
            {activeShift ? (
              <div style={{ fontSize: 11, color: '#65676b', marginTop: 2 }}>
                Shift #{activeShift.id} · {activeShift.truck_plate || 'No truck'}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                No active shift — start shift first
              </div>
            )}
          </div>

          {/* Phase list */}
          <div style={{ padding: '6px 0' }}>
            {PHASES.map(p => {
              const isActive = p.key === currentPhase
              const isLoading = jumping === p.key
              const requiresShift = p.key !== 'assignment' && !activeShift
              const isDisabled = isActive || !!jumping || requiresShift
              const IconComponent = p.icon
              return (
                <button
                  key={p.key}
                  onClick={() => jump(p.key)}
                  disabled={isDisabled}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 16px', border: 'none',
                    background: isActive ? '#f0f2f5' : 'transparent',
                    borderLeft: isActive ? `3px solid ${p.color}` : '3px solid transparent',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    transition: 'all .15s',
                    opacity: requiresShift ? 0.4 : (jumping && !isLoading ? 0.5 : 1),
                  }}
                  onMouseOver={e => {
                    if (!isDisabled) e.currentTarget.style.background = '#f8fafc'
                  }}
                  onMouseOut={e => {
                    if (!isActive) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span style={{ flexShrink: 0, color: p.color, display: 'flex', alignItems: 'center' }}>
                    {isLoading ? <Loader2 size={16} className="icon-spin" /> : <IconComponent size={16} />}
                  </span>
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 600,
                      color: isActive ? '#1c1e21' : '#1c1e21',
                    }}>
                      {p.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#65676b', marginTop: 1 }}>
                      {p.desc}
                    </div>
                  </div>
                  {isActive && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '.04em',
                      color: '#15803d', background: '#e7f5eb',
                      border: '1px solid #bbf7d0',
                      borderRadius: 4, padding: '1px 6px', flexShrink: 0,
                    }}>
                      CURRENT
                    </span>
                  )}
                  {p.devOnly && !isActive && (
                    <span style={{
                      fontSize: 9, fontWeight: 600,
                      color: '#65676b', background: '#f0f2f5',
                      border: '1px solid #e4e6eb',
                      borderRadius: 4, padding: '1px 5px', flexShrink: 0,
                    }}>DEV</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Dev Nuke Reset Button inside panel */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #e4e6eb' }}>
            <button
              disabled={!canResetShift}
              title={
                !activeShift?.id
                  ? 'Requires an active shift'
                  : !canResetShift
                    ? 'Requires administrator authorization'
                    : 'Reset active shift back to Navigate to Base'
              }
              onClick={async () => {
                if (!canResetShift) return
                if (!window.confirm('NUKE this shift back to Navigate to Base and wipe all completed stops?')) return
                setResetting(true)
                try {
                  await api.post('/api/driver/shift/dev-reset/', {
                    phase: 'navigate_to_base',
                    shift_id: activeShift.id,
                  })
                  Object.keys(sessionStorage).forEach(k => {
                    if (k.startsWith('ww_')) sessionStorage.removeItem(k)
                  })
                  window.location.reload()
                } catch (e) {
                  alert('Reset failed: ' + (e.response?.data?.error || e.message))
                } finally {
                  setResetting(false)
                }
              }}
              style={{
                width: '100%',
                background: canResetShift ? '#fee2e2' : '#f1f5f9',
                color: canResetShift ? '#b91c1c' : '#94a3b8',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                border: `1px solid ${canResetShift ? '#fecaca' : '#e2e8f0'}`,
                cursor: canResetShift ? 'pointer' : 'not-allowed',
                opacity: canResetShift ? 1 : 0.65,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {resetting ? <Loader2 size={12} className="icon-spin" /> : <RotateCcw size={12} />}
              NUKE SHIFT TO BASE
            </button>
            {!canResetShift && (
              <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center', marginTop: 4 }}>
                {!activeShift?.id ? 'Start a shift to enable reset' : 'Admin authorization required'}
              </div>
            )}
          </div>

          {/* Warning */}
          <div style={{ padding: '6px 16px 2px', borderTop: '1px solid #e4e6eb' }}>
            <div style={{ fontSize: 10, color: '#65676b', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={11} color="#b45309" /> DEV only — skips GPS &amp; API guards.
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── LIVE STATUS BADGE (DEV only) ────────────────────────────────────────────
function DevStatusBadge({ phase, activeShift }) {
  if (!import.meta.env.DEV) return null
  const p = PHASES.find(f => f.key === phase)
  if (!p) return null
  const IconComponent = p.icon
  return (
    <div style={{
      position: 'fixed', top: 15, left: 145, zIndex: 9998,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: '#ffffff', border: '1px solid #e4e6eb',
      borderRadius: 6, padding: '4px 8px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      pointerEvents: 'none',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', color: p.color }}>
        <IconComponent size={12} />
      </span>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#1c1e21', letterSpacing: '.04em' }}>
        {p.label.toUpperCase()}
      </span>
      {activeShift?.is_extended_mode && (
        <span style={{
          fontSize: 8, fontWeight: 700, color: '#b45309',
          background: '#fef3c7', border: '1px solid #fde68a',
          borderRadius: 4, padding: '1px 4px',
        }}>EXT</span>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DriverRouteFlow() {
  const { user } = useAuth()
  const { notify } = useNotification()
  const navigate = useNavigate()
  const [phase, setPhase] = useState(null)
  const [activeShift, setActiveShift] = useState(null)
  const [truckPreviousShifts, setTruckPreviousShifts] = useState([])
  const [canDevReset, setCanDevReset] = useState(null)
  const [checkStatus, setCheckStatus] = useState('loading')
  const [eligibilityError, setEligibilityError] = useState(null)
  const [checkAttempt, setCheckAttempt] = useState(0)
  const [resumeBannerDismissed, setResumeBannerDismissed] = useState(false)
  const hasNotifiedBlockRef = useRef(false)

  // Auto-dismiss resume notification banner after 4 seconds to unblock driver view
  useEffect(() => {
    if (activeShift && !resumeBannerDismissed) {
      const timer = setTimeout(() => setResumeBannerDismissed(true), 4000)
      return () => clearTimeout(timer)
    }
  }, [activeShift, resumeBannerDismissed])

  // ── On mount / retry: verify shift eligibility fail-closed before mounting flow ──
  useEffect(() => {
    const cancel = runShiftEligibilityCheck({
      fetchCurrentShift: ({ signal } = {}) => api.get('/api/driver/shift/current/', { signal }),
      clearSessionData: clearDriverSessionData,
      onStateChange: next => {
        setCheckStatus(next.status)
        setPhase(next.phase)
        setActiveShift(next.activeShift)
        setTruckPreviousShifts(next.truckPreviousShifts)
        setCanDevReset(next.canDevReset)
        setEligibilityError(next.errorMessage)
      },
      onBlocked: ({ toastMessage }) => {
        if (!hasNotifiedBlockRef.current) {
          hasNotifiedBlockRef.current = true
          notify({ variant: 'warning-dark', message: toastMessage })
        }
        navigate('/dashboard', { replace: true })
      },
    })

    return cancel
  }, [user?.id, checkAttempt, navigate, notify])

  function handleRetryEligibility() {
    hasNotifiedBlockRef.current = false
    setCheckAttempt(n => n + 1)
  }

  // ── Normal phase advance (validated by backend, Finding M2) ─────────────
  async function advancePhase(nextPhase) {
    await advanceFlowPhase({
      nextPhase,
      activeShift,
      updateShiftStatus: ({ shiftId, nextPhase }) =>
        api.patch(`/api/driver/shift/${shiftId}/update-status/`, { status: nextPhase }).then(r => r.data),
      handleStaleShift,
      onPhaseChanged: ({ status: updatedStatus, opStatus }) => {
        setPhase(updatedStatus)
        setActiveShift(prev => (
          prev ? { ...prev, status: updatedStatus, op_status: opStatus || prev.op_status } : prev
        ))
      },
      onError: errMsg => notify({ variant: 'error', message: errMsg }),
      isDevSkip: false,
    })
  }

  // ── DEV: jump to any phase, bypassing guards ─────────────────────────────
  async function devJumpToPhase(nextPhase) {
    if (nextPhase !== 'assignment' && !activeShift) return
    // Clear stale route session keys so modules start fresh
    clearDriverSessionData()

    // truck_not_full is a DEV-only virtual phase — no backend equivalent
    // Pre-populate ww_route_complete and jump to shiftroute so ShiftRouteModule mounts it with real data
    if (nextPhase === 'truck_not_full') {
      sessionStorage.setItem('ww_route_complete', 'true')
      setPhase('shiftroute')
      return
    }

    await advanceFlowPhase({
      nextPhase,
      activeShift,
      updateShiftStatus: ({ shiftId, nextPhase, devSkip }) =>
        api.patch(`/api/driver/shift/${shiftId}/update-status/`, { status: nextPhase, dev_skip: devSkip }).then(r => r.data),
      handleStaleShift,
      onPhaseChanged: ({ status: updatedStatus, opStatus }) => {
        setPhase(updatedStatus)
        setActiveShift(prev => (
          prev ? { ...prev, status: updatedStatus, op_status: opStatus || prev.op_status } : prev
        ))
      },
      onError: errMsg => notify({ variant: 'error', message: errMsg }),
      isDevSkip: true,
    })
  }

  // ── Loading / Blocked redirect state (never mounts Assignment, GPS, or Dev controls) ──
  if (checkStatus === 'loading' || checkStatus === 'blocked') {
    return <MobileFlowSkeleton label="Checking shift eligibility..." />
  }

  // ── Fail-closed error / retry state on network, 5xx, or malformed payload ──
  if (checkStatus !== 'ready' || !phase) {
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f8fafc',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: '#fef2f2',
              color: '#dc2626',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <AlertTriangle size={22} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
            Unable to Verify Shift Eligibility
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 13, lineHeight: 1.5, color: '#475569' }}>
            {eligibilityError || 'Unable to verify shift eligibility right now. Check your connection and retry.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={handleRetryEligibility}
              style={{
                width: '100%',
                padding: '11px 16px',
                borderRadius: 8,
                border: 'none',
                background: '#16a34a',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <RotateCcw size={15} />
              Retry Check
            </button>
            <button
              type="button"
              onClick={() => navigate('/dashboard', { replace: true })}
              style={{
                width: '100%',
                padding: '11px 16px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#1e293b',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Home size={15} />
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  const showResumeBanner = activeShift && phase === activeShift.status

  return (
    <DriverGpsProvider hasActiveShift={Boolean(activeShift)}>
      {/* ── Shift resumed banner (production) ── */}
      {showResumeBanner && !resumeBannerDismissed && (
        <div style={{
          position: 'fixed', top: 70, left: 16, right: 16, zIndex: 9999,
          background: '#e7f5eb', border: '1px solid #bbf7d0',
          borderRadius: 6, padding: '8px 14px',
          fontSize: 12, color: '#15803d', fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          animation: 'fadePhase 0.25s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} /> Shift resumed — {activeShift.truck_plate} · {activeShift.barangay_names}
          </div>
          <button
            onClick={() => setResumeBannerDismissed(true)}
            title="Dismiss banner"
            style={{
              background: 'none', border: 'none', color: '#15803d',
              cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── DEV: live phase badge ── */}
      <DevStatusBadge phase={phase} activeShift={activeShift} />

      {/* ── Minimize to Dashboard Button ── */}
      <button
        onClick={() => navigate('/dashboard')}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          background: '#ffffff',
          border: '1px solid #ced0d4',
          color: '#1c1e21',
          borderRadius: 6, height: 36, padding: '0 12px', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          transition: 'background 0.15s ease',
        }}
        onMouseOver={e => e.currentTarget.style.background = '#f0f2f5'}
        onMouseOut={e => e.currentTarget.style.background = '#ffffff'}
      >
        <Minimize2 size={14} />
        Minimize
      </button>

      {/* ── Phase modules ── */}
      {/*
        IMPORTANT: .phase-wrapper uses opacity animation (fadePhase 0→1).
        Per CSS spec, opacity !== 1 creates a new containing block for
        position:fixed descendants — exactly what ShiftRouteModule and
        EndShiftModule rely on for their full-screen map and overlays.
        Fix: only apply the animated class to phases whose internals are
        regular flow-positioned (assignment, navigate_to_base, confirm_start,
        checkin). shiftroute and end_shift render without the wrapper so their
        fixed children remain viewport-relative at all times.
      */}
      <style>{`
        @keyframes fadePhase {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .phase-fade {
          animation: fadePhase 0.3s ease-in-out;
          width: 100%;
          display: flex;
          flex-direction: column;
        }
      `}</style>

      {phase === 'assignment' && (
        <div key="assignment" className="phase-fade">
          <AssignmentModule
            onAdvance={advancePhase}
            setActiveShift={setActiveShift}
            truckPreviousShifts={truckPreviousShifts}
          />
        </div>
      )}
      {phase === 'navigate_to_base' && (
        <div key="navigate_to_base" className="phase-fade">
          <NavigateToBaseModule onAdvance={advancePhase} shift={activeShift} />
        </div>
      )}
      {phase === 'confirm_start' && (
        <div key="confirm_start" className="phase-fade">
          <ConfirmStartModule onAdvance={advancePhase} shift={activeShift} />
        </div>
      )}
      {phase === 'checkin' && (
        <div key="checkin" className="phase-fade">
          <CheckInModule onAdvance={advancePhase} shift={activeShift} />
        </div>
      )}
      {/* shiftroute & end_shift: NO wrapper — their internals are position:fixed */}
      {phase === 'shiftroute' && <ShiftRouteModule onAdvance={advancePhase} shift={activeShift} />}
      {phase === 'end_shift' && <EndShiftModule onAdvance={advancePhase} shift={activeShift} />}

      {/* ── DEV: phase switcher ── */}
      <DevPhaseSwitcher
        currentPhase={phase}
        activeShift={activeShift}
        user={user}
        canDevReset={canDevReset}
        onJump={devJumpToPhase}
      />
    </DriverGpsProvider>
  )
}
