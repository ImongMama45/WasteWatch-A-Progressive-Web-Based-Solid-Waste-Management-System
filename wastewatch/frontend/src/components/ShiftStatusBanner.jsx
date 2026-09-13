import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import useShiftTimer from '../hooks/useShiftTimer'
import { useAuth } from '../context/AuthContext'
import { Truck, ArrowRight, X } from 'lucide-react'

export default function ShiftStatusBanner() {
  const { shiftActive, formattedTime, loading } = useShiftTimer()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [dismissed, setDismissed] = useState(false)

  const isDriver = user?.role?.toLowerCase() === 'driver' || user?.groups?.includes('driver')
  const onFlowPage = location.pathname.includes('/driver/flow') || location.pathname.includes('/route')

  // While the backend check is in-flight, render nothing rather than
  // guessing — prevents a flash of the banner on every page load.
  if (loading || !isDriver || !shiftActive || dismissed || onFlowPage) {
    return null
  }

  return (
    <>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-100%); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-dot {
          0% { box-shadow: 0 0 0 0 rgba(46,204,113, 0.4); }
          70% { box-shadow: 0 0 0 6px rgba(46,204,113, 0); }
          100% { box-shadow: 0 0 0 0 rgba(46,204,113, 0); }
        }
        .dashboard-main,
        .page {
          padding-top: 136px !important;
        }
      `}</style>
      <div style={{
        position: 'fixed', top: '60px', left: 0, right: 0, zIndex: 900,
        padding: '16px 16px 0 16px', animation: 'slideDown .3s ease forwards',
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'var(--surface-3, #1e2633)', color: '#fff', padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          border: '1px solid rgba(255,255,255,0.05)', pointerEvents: 'auto',
          maxWidth: '800px', margin: '0 auto',
        }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, cursor: 'pointer' }}
            onClick={() => navigate('/driver/flow')}
          >
            <div style={{
              width: '40px', height: '40px', background: 'rgba(46,204,113,0.15)',
              color: 'var(--accent, #2ecc71)', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'pulse-dot 2s infinite', flexShrink: 0,
            }}>
              <Truck size={20} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 800, letterSpacing: '0.02em' }}>Active Shift in Progress</div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '2px', fontWeight: 500 }}>
                Elapsed Time: <span style={{ color: 'var(--accent, #2ecc71)' }}>{formattedTime}</span>
              </div>
            </div>
            <div style={{ color: 'var(--accent, #2ecc71)', marginLeft: 'auto', paddingRight: '8px', display: 'flex', alignItems: 'center' }}>
              <ArrowRight size={20} />
            </div>
          </div>

          <div style={{ width: '1px', height: '30px', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

          <button
            onClick={(e) => { e.stopPropagation(); setDismissed(true) }}
            style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
              cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center',
              borderRadius: '50%', transition: 'background 0.2s, color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.background = 'none' }}
            aria-label="Dismiss banner"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
