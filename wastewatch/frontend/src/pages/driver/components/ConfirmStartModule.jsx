/**
 * ConfirmStartModule.jsx
 * -----------------------
 * 1.75th step (between NavigateToBaseModule and CheckInModule) <== do not remove this indicator
 *
 * Shows a polished "Ready to Start?" confirmation screen once the driver
 * has reached home base. Displays route summary, truck, barangays, and
 * schedule info. Driver taps "Start My Shift" → transitions to 'checkin'.
 */

import { useState, useEffect } from 'react'
import { useAuth } from '../../../context/AuthContext'
import api from '../../../api/client'
import Navbar from '../../../components/Navbar'

export default function ConfirmStartModule({ onAdvance, shift }) {
  const { user } = useAuth()
  const firstName = user?.full_name?.split(' ')[0] || 'Driver'

  const [schedule, setSchedule] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    setLoading(true)
    Promise.all([
      api.get('/api/driver/collection-schedules/').catch(() => ({ data: [] })),
      api.get('/api/driver/shift/profile/').catch(() => ({ data: null })),
    ]).then(([schedRes, profRes]) => {
      const match = schedRes.data.find(s => String(s.driver) === String(user.id))
      setSchedule(match || null)
      setProfile(profRes.data || null)
    }).finally(() => setLoading(false))
  }, [user?.id])

  const stopCount = schedule ? (schedule.waypoints?.length || 1) - 1 : 0
  const routeName = shift?.barangay_names || schedule?.barangay_names || 'Your Route'
  const truckLabel = shift?.truck_model || '—'
  const plateLabel = shift?.truck_plate || '—'
  const barangayLabel = shift?.barangay_names || schedule?.barangay_names || '—'
  const daysLabel = schedule?.days || '—'
  const timeLabel = schedule?.start_time
    ? `${schedule.start_time.slice(0, 5)} – ${schedule.end_time?.slice(0, 5) || ''}`
    : '—'

  const now = new Date()
  const timeNow = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateNow = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  if (loading) {
    return (
      <>
        <Navbar />
        <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, background: '#f8fafc' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#0f172a', animation: 'csfSpin 1s linear infinite' }} />
          <style>{`@keyframes csfSpin { to{transform:rotate(360deg)} }`}</style>
          <span style={{ color: '#64748b', fontSize: 13 }}>Loading shift info…</span>
        </div>
      </>
    )
  }

  return (
    <>
      <Navbar />
      <style>{`
        @keyframes csfFadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes csfPulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes csfSpin   { to{transform:rotate(360deg)} }
        .csf-card { animation: csfFadeUp .3s ease both; }
      `}</style>

      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: '#f8fafc', fontFamily: 'var(--font-body)', overflowY: 'auto' }}>

        {/* ── HERO HEADER ── */}
        <div style={{ background: 'linear-gradient(160deg, #0f172a 0%, #1a3a5c 100%)', padding: '36px 24px 32px', color: '#fff', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: 'radial-gradient(circle at 50% 50%, #fff 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(22,163,74,0.18)', border: '2px solid rgba(22,163,74,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: 32 }}>
              🏠
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(22,163,74,0.9)', letterSpacing: '.1em', marginBottom: 6 }}>AT HOME BASE</div>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 900, margin: '0 0 6px', letterSpacing: '.02em' }}>
              Ready, {firstName}?
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '0 0 16px' }}>
              {dateNow} · {timeNow}
            </p>

            {/* Confirm at base badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(22,163,74,0.18)', border: '1px solid rgba(22,163,74,0.4)', borderRadius: 20, padding: '5px 14px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2ecc71', display: 'inline-block', animation: 'csfPulse 2s ease infinite' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#2ecc71', letterSpacing: '.04em' }}>BASE CONFIRMED</span>
            </div>
          </div>
        </div>

        {/* ── ASSIGNMENT CARD ── */}
        <div className="csf-card" style={{ margin: '0 16px', marginTop: -18, background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.09)', border: '1px solid #e2e8f0', marginBottom: 16 }}>
          <div style={{ padding: '16px 18px 4px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: '.08em', marginBottom: 2 }}>TODAY'S ASSIGNMENT</div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, color: '#0f172a', marginBottom: 2 }}>{routeName}</div>
          </div>
          {[
            { icon: '🚛', label: 'Truck', value: truckLabel },
            { icon: '🔖', label: 'Plate No.', value: plateLabel },
            { icon: '📍', label: 'Barangay', value: barangayLabel },
            { icon: '📅', label: 'Schedule', value: daysLabel },
            { icon: '⏰', label: 'Time', value: timeLabel },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{row.icon}</span>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600, flex: 1 }}>{row.label}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{row.value}</span>
            </div>
          ))}
          {/* Stop count badge */}
          <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>🗺️</span>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600, flex: 1 }}>Total Stops</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(15,23,42,0.08)', borderRadius: 20, padding: '3px 12px' }}>
              <span style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 900, color: '#0f172a' }}>{stopCount}</span>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>stops</span>
            </div>
          </div>
        </div>

        {/* ── INFO NOTICE ── */}
        <div className="csf-card" style={{ margin: '0 16px 20px', padding: '12px 16px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>ℹ️</span>
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            Tapping <strong>"Start My Shift"</strong> will initialize GPS tracking, log your shift start time, and begin route monitoring. Make sure you're ready before proceeding.
          </div>
        </div>

        {/* ── CTA BUTTON ── */}
        <div style={{ padding: '0 16px 32px', marginTop: 'auto' }}>
          <button
            id="confirm-start-shift-btn"
            onClick={() => {
              sessionStorage.setItem('ww_duty_type', 'normal')
              onAdvance('checkin')
            }}
            style={{
              width: '100%', padding: '20px', borderRadius: 30, border: 'none',
              background: 'linear-gradient(135deg, #10b981, #16a34a)',
              color: '#fff', fontFamily: 'var(--font-head)',
              fontSize: 17, fontWeight: 900, letterSpacing: '.06em',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(16,185,129,0.4)',
              transition: 'transform .15s, box-shadow .15s',
            }}
            onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.98)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(16,185,129,0.3)' }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(16,185,129,0.4)' }}
          >
            🚛 Start My Shift
          </button>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 10 }}>
            Your shift will be logged and tracked in real time
          </p>
        </div>

        {/* Footer */}
        <div style={{ background: '#0f172a', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, letterSpacing: '.06em' }}>Track · Monitor · Report</span>
        </div>
      </div>
    </>
  )
}
