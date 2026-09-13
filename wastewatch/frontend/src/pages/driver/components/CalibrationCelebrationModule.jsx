import React, { useEffect, useRef, useMemo } from 'react'
import Navbar from '../../../components/Navbar'
import RouteCompletionMiniMap from './RouteCompletionMiniMap'

const CheckIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
)

const WeightIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
  </svg>
)

const RouteIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
)

const MapPinIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
)

export default function CalibrationCelebrationModule({ calibrationData, schedule, stopStatuses, currentStopIndex, onContinue }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)

  // ── Resolve the stop-status map ─────────────────────────────────────────
  // Prefer the live prop; fall back to the snapshot written just before
  // TruckNotFull was shown (covers the auto-complete path where handleNextStop
  // is never called and ww_completed_stops is never written).
  const resolvedStatuses = useMemo(() => {
    if (stopStatuses && stopStatuses.size > 0) return stopStatuses
    try {
      const raw = sessionStorage.getItem('ww_stop_statuses_snapshot') ||
                  sessionStorage.getItem('ww_stop_statuses')
      if (raw) return new Map(JSON.parse(raw).map(([k, v]) => [Number(k), v]))
    } catch { }
    return new Map()
  }, [stopStatuses])

  // Statuses that count as "successfully handled" (not missed)
  const COMPLETED_STATUSES = new Set([
    'VERIFIED_COLLECTED',
    'COLLECTION_REPORTED',
    'COLLECTION_DISPUTED',
    'EMPTY_STOP',
  ])

  const totalStops = schedule?.waypoints?.length
    ? schedule.waypoints.length - 1
    : parseInt(sessionStorage.getItem('ww_total_stops') || '0', 10)

  // Derive completedStops from the status map — do NOT trust ww_completed_stops
  // because it is only written by handleNextStop (skipped on auto-complete).
  const completedStops = useMemo(() => {
    if (resolvedStatuses.size === 0) {
      // Last resort: ww_completed_stops written by the normal next-stop flow
      return parseInt(sessionStorage.getItem('ww_completed_stops') || '0', 10)
    }
    let count = 0
    resolvedStatuses.forEach((status, idx) => {
      if (idx >= 1 && COMPLETED_STATUSES.has(status)) count++
    })
    return count
  }, [resolvedStatuses])

  const missedStops = useMemo(() => {
    if (!schedule?.waypoints) {
      if (import.meta.env.DEV) {
        return [
          { lat: 13.93, lng: 121.61, label: 'Dummy Missed Stop 1' },
          { lat: 13.94, lng: 121.62, label: 'Dummy Missed Stop 2' },
        ]
      }
      return []
    }
    return schedule.waypoints.filter((wp, index) => {
      if (index === 0) return false // skip depot
      const status = resolvedStatuses.get(index)
      return !COMPLETED_STATUSES.has(status)
    })
  }, [schedule, resolvedStatuses])



  const kgCollected = calibrationData?.net_weight || calibrationData?.estimated_kg || '0.00'

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes fadeInScale {
          0% { opacity: 0; transform: scale(0.95); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUpCard {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes popOut {
          0% { transform: scale(0); }
          80% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>

      <div style={{
        height: '100dvh', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(to bottom, #f0fdf4 0%, #f8fafc 100%)',
        fontFamily: 'var(--font-body)', overflowY: 'auto',
      }}>
        <div style={{ padding: '40px 20px 24px', textAlign: 'center', animation: 'fadeInScale 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', background: '#22c55e',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', color: '#fff',
            boxShadow: '0 8px 30px rgba(34, 197, 94, 0.3)',
            animation: 'popOut 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both'
          }}>
            <CheckIcon />
          </div>
          <h1 style={{
            fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 900,
            color: '#0f172a', marginBottom: 8, letterSpacing: '-0.02em'
          }}>
            Waste Dumped!
          </h1>
          <p style={{ color: '#64748b', fontSize: 15, margin: 0, fontWeight: 500 }}>
            Your Garbage Collection has been successfully logged.
          </p>
        </div>

        <div style={{ padding: '0 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{
            background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
            borderRadius: 20, padding: '24px', border: '1px solid rgba(255,255,255,0.5)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            animation: 'slideUpCard 0.5s ease-out 0.2s both'
          }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0f172a' }}>
                <WeightIcon />
              </div>
              <div>
                <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600, marginBottom: 2 }}>Total Collected</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 900, color: '#0f172a' }}>
                  {kgCollected} <span style={{ fontSize: 16, color: '#94a3b8', fontWeight: 700 }}>kg</span>
                </div>
              </div>
            </div>
          </div>

          {totalStops > 0 && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
              borderRadius: 20, padding: '20px', border: '1px solid rgba(255,255,255,0.5)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
              animation: 'slideUpCard 0.5s ease-out 0.3s both'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
                  <RouteIcon />
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                  Route Summary
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>Completed Stops</span>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{completedStops} / {totalStops}</span>
              </div>

              <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', marginBottom: 20 }}>
                <div style={{
                  height: '100%',
                  background: completedStops === totalStops ? '#22c55e' : '#3b82f6',
                  width: `${Math.min(100, Math.max(0, (completedStops / totalStops) * 100))}%`,
                  borderRadius: 4
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>Missed Stops</span>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800, color: '#ef4444' }}>{missedStops.length}</span>
              </div>
            </div>
          )}

          {schedule?.waypoints && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
              borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
              animation: 'slideUpCard 0.5s ease-out 0.4s both'
            }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>
                  <MapPinIcon />
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                  Route Receipt
                </div>
              </div>
              <div style={{ padding: 12 }}>
                <RouteCompletionMiniMap schedule={schedule} stopStatuses={stopStatuses} />
              </div>
            </div>
          )}

        </div>

        <div style={{ padding: '24px 20px', background: 'transparent' }}>
          <button
            onClick={onContinue}
            style={{
              width: '100%', padding: '18px', borderRadius: 16,
              background: '#0f172a', color: '#fff', border: 'none',
              fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
              cursor: 'pointer', boxShadow: '0 8px 25px rgba(15,23,42,0.2)',
              letterSpacing: '0.02em', transition: 'transform 0.1s'
            }}
          >
            Continue to Base
          </button>
        </div>
      </div>
    </>
  )
}
