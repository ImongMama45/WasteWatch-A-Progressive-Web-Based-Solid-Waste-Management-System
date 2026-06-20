import { useState, useEffect } from 'react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { DriverGpsProvider } from '../../context/DriverGpsContext'
import AssignmentModule from './components/AssignmentModule'
import NavigateToBaseModule from './components/NavigateToBaseModule'
import ConfirmStartModule from './components/ConfirmStartModule'
import CheckInModule from './components/CheckInModule'
import ShiftRouteModule from './components/ShiftRouteModule'
import EndShiftModule from './components/EndShiftModule'
import TruckNotFull from './components/TruckNotFull'

// ─── PHASE METADATA ──────────────────────────────────────────────────────────
const PHASES = [
  { key: 'assignment',       label: 'Assignment',         icon: '📋', color: '#6366f1', desc: 'Select truck & schedule' },
  { key: 'navigate_to_base', label: 'Navigate to Base',   icon: '🏠', color: '#0ea5e9', desc: 'Head to collection base' },
  { key: 'confirm_start',    label: 'Confirm Start',      icon: '✅', color: '#10b981', desc: 'Confirm shift start' },
  { key: 'checkin',          label: 'Check-in',           icon: '📍', color: '#f59e0b', desc: 'Driver check-in & briefing' },
  { key: 'shiftroute',       label: 'On Route',           icon: '🚛', color: '#3b82f6', desc: 'Collecting waste stops' },
  { key: 'truck_not_full',   label: 'Truck Not Full',     icon: '📦', color: '#f97316', desc: 'Route done — missed stops review', devOnly: true },
  { key: 'end_shift',        label: 'End Shift',          icon: '🏁', color: '#ef4444', desc: 'Return to dumpsite / end' },
]

// ─── DEV PHASE SWITCHER ───────────────────────────────────────────────────────
function DevPhaseSwitcher({ currentPhase, activeShift, onJump }) {
  const [open, setOpen] = useState(false)
  const [jumping, setJumping] = useState(null)

  if (!import.meta.env.DEV) return null

  const current = PHASES.find(p => p.key === currentPhase)

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
          from { opacity:0; transform:translateY(8px) scale(.97); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
      `}</style>

      {/* ── FLOATING TRIGGER BUTTON ── */}
      <button
        id="dev-phase-switcher-btn"
        onClick={() => setOpen(o => !o)}
        title="DEV: Jump to any phase"
        style={{
          position: 'fixed', bottom: 90, right: 16, zIndex: 9990,
          width: 48, height: 48, borderRadius: '50%',
          background: open ? '#1e293b' : 'rgba(30,41,59,0.92)',
          border: '2px solid rgba(99,102,241,.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(99,102,241,.4)',
          fontSize: 20,
          transition: 'all .2s',
        }}
      >
        {open ? '✕' : '🔧'}
      </button>

      {/* ── PHASE PANEL ── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 148, right: 16, zIndex: 9989,
          width: 260,
          background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
          borderRadius: 18, padding: '14px 0',
          border: '1px solid rgba(99,102,241,.3)',
          boxShadow: '0 8px 40px rgba(0,0,0,.5)',
          animation: 'devPop .2s ease',
        }}>
          {/* Header */}
          <div style={{ padding: '0 16px 10px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(99,102,241,.9)', letterSpacing: '.08em' }}>
              🔧 DEV — PHASE SWITCHER
            </div>
            {activeShift && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
                Shift #{activeShift.id} · {activeShift.truck_plate || 'No truck'}
              </div>
            )}
          </div>

          {/* Phase list */}
          <div style={{ padding: '8px 0' }}>
            {PHASES.map(p => {
              const isActive = p.key === currentPhase
              const isLoading = jumping === p.key
              return (
                <button
                  key={p.key}
                  onClick={() => jump(p.key)}
                  disabled={isActive || !!jumping}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 16px', border: 'none',
                    background: isActive ? `${p.color}22` : 'transparent',
                    borderLeft: isActive ? `3px solid ${p.color}` : '3px solid transparent',
                    cursor: isActive || jumping ? 'default' : 'pointer',
                    transition: 'all .15s',
                    opacity: jumping && !isLoading ? 0.5 : 1,
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>
                    {isLoading ? '⏳' : p.icon}
                  </span>
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: isActive ? p.color : 'rgba(255,255,255,.85)',
                    }}>
                      {p.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginTop: 1 }}>
                      {p.desc}
                    </div>
                  </div>
                  {isActive && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: '.06em',
                      color: p.color, background: `${p.color}22`,
                      border: `1px solid ${p.color}55`,
                      borderRadius: 20, padding: '2px 7px', flexShrink: 0,
                    }}>
                      CURRENT
                    </span>
                  )}
                  {p.devOnly && !isActive && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, letterSpacing: '.04em',
                      color: '#94a3b8', background: 'rgba(148,163,184,.12)',
                      border: '1px solid rgba(148,163,184,.2)',
                      borderRadius: 20, padding: '1px 5px', flexShrink: 0,
                    }}>DEV</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Warning */}
          <div style={{ padding: '8px 16px 0', borderTop: '1px solid rgba(255,255,255,.07)' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.25)', lineHeight: 1.5 }}>
              ⚠ DEV only — skips GPS & API guards. Does not appear in production.
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
  return (
    <div style={{
      position: 'fixed', top: 70, left: 16, zIndex: 9998,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: `${p.color}18`, border: `1px solid ${p.color}55`,
      backdropFilter: 'blur(8px)',
      borderRadius: 20, padding: '4px 12px',
      pointerEvents: 'none',
    }}>
      <span style={{ fontSize: 12 }}>{p.icon}</span>
      <span style={{ fontSize: 10, fontWeight: 800, color: p.color, letterSpacing: '.05em' }}>
        {p.label.toUpperCase()}
      </span>
      {activeShift?.is_extended_mode && (
        <span style={{
          fontSize: 9, fontWeight: 800, color: '#f59e0b',
          background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.4)',
          borderRadius: 20, padding: '1px 6px',
        }}>EXT</span>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DriverRouteFlow() {
  const { user } = useAuth()
  const [phase, setPhase]               = useState(null)
  const [activeShift, setActiveShift]   = useState(null)
  const [isCheckingShift, setIsChecking] = useState(true)
  const [resumeError, setResumeError]   = useState(false)

  // ── On mount: ask backend if an active shift exists ──────────────────────
  useEffect(() => {
    api.get('/api/driver/shift/current/')
      .then(r => {
        const shift = r.data.active_shift
        if (shift) {
          setActiveShift(shift)
          setPhase(shift.status)
        } else {
          setPhase('assignment')
        }
      })
      .catch(() => {
        setResumeError(true)
        setPhase('assignment')
      })
      .finally(() => setIsChecking(false))
  }, [user?.id])

  // ── Normal phase advance (validated by backend) ──────────────────────────
  async function advancePhase(nextPhase) {
    if (activeShift) {
      try {
        await api.patch(
          `/api/driver/shift/${activeShift.id}/update-status/`,
          { status: nextPhase }
        )
      } catch (err) {
        console.warn('[ShiftState] Failed to sync phase to backend:', err)
      }
    }
    setPhase(nextPhase)
  }

  // ── DEV: jump to any phase, bypassing guards ─────────────────────────────
  async function devJumpToPhase(nextPhase) {
    // Clear stale route session keys so modules start fresh
    const CLEAR_KEYS = [
      'ww_route_state', 'ww_current_stop_index', 'ww_stop_statuses',
      'ww_route_complete', 'ww_extended_mode', 'ww_stop_statuses_snapshot',
      'ww_pending_collection_note', 'ww_pending_collection_stop_id',
      'ww_current_stop', 'ww_completed_stops', 'ww_total_stops',
    ]
    CLEAR_KEYS.forEach(k => sessionStorage.removeItem(k))

    // truck_not_full is a DEV-only virtual phase — no backend equivalent
    // Pre-populate ww_route_complete and jump to shiftroute so ShiftRouteModule mounts it with real data
    if (nextPhase === 'truck_not_full') {
      sessionStorage.setItem('ww_route_complete', 'true')
      setPhase('shiftroute')
      return
    }

    if (activeShift) {
      try {
        await api.patch(
          `/api/driver/shift/${activeShift.id}/update-status/`,
          { status: nextPhase, dev_skip: true }
        )
      } catch (err) {
        console.warn('[DEV] Phase jump backend sync failed (proceeding anyway):', err)
      }
    }
    setPhase(nextPhase)
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isCheckingShift) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: 12,
      }}>
        <div className="rb-spinner" style={{ width: 24, height: 24 }} />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Checking for active shift…
        </span>
      </div>
    )
  }

  const showResumeBanner = activeShift && phase === activeShift.status

  return (
    <DriverGpsProvider>
      {/* ── Network error banner ── */}
      {resumeError && (
        <div style={{
          position: 'fixed', top: 70, left: 16, right: 16, zIndex: 9999,
          background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)',
          borderRadius: 9, padding: '8px 14px',
          fontSize: 12, color: 'var(--warning)', backdropFilter: 'blur(4px)',
        }}>
          ⚠ Could not reach server — resuming from last known state.
          Your progress will sync when connection is restored.
        </div>
      )}

      {/* ── Shift resumed banner (production) ── */}
      {!resumeError && showResumeBanner && (
        <div style={{
          position: 'fixed', top: 70, left: 16, right: 16, zIndex: 9999,
          background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.2)',
          borderRadius: 9, padding: '8px 14px',
          fontSize: 12, color: 'var(--accent)', fontWeight: 600, backdropFilter: 'blur(4px)',
        }}>
          ✓ Shift resumed — {activeShift.truck_plate} · {activeShift.barangay_names}
        </div>
      )}

      {/* ── DEV: live phase badge ── */}
      <DevStatusBadge phase={phase} activeShift={activeShift} />

      {/* ── Phase modules ── */}
      {phase === 'assignment'       && <AssignmentModule    onAdvance={advancePhase} setActiveShift={setActiveShift} />}
      {phase === 'navigate_to_base' && <NavigateToBaseModule onAdvance={advancePhase} shift={activeShift} />}
      {phase === 'confirm_start'    && <ConfirmStartModule  onAdvance={advancePhase} shift={activeShift} />}
      {phase === 'checkin'          && <CheckInModule       onAdvance={advancePhase} shift={activeShift} />}
      {phase === 'shiftroute'       && <ShiftRouteModule    onAdvance={advancePhase} shift={activeShift} />}
      {phase === 'end_shift'        && <EndShiftModule      onAdvance={advancePhase} shift={activeShift} />}



      {/* ── DEV: phase switcher ── */}
      <DevPhaseSwitcher
        currentPhase={phase}
        activeShift={activeShift}
        onJump={devJumpToPhase}
      />
    </DriverGpsProvider>
  )
}
