/**
 * components/OfflineCommandCenter.jsx
 * -------------------------------------
 * Simplified public-facing command view — works fully offline.
 * Shows last known garbage truck schedule + per-barangay collection status.
 * Reads from ww_trucks / ww_schedule localStorage caches.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnline } from '../hooks/useOnline'
import api from '../api/client'

// ─── Cache helpers ────────────────────────────────────────────────────────────

const LS_TRUCKS   = 'ww_trucks'
const LS_SCHEDULE = 'ww_schedule'

function readLS(key, fb) { try { return JSON.parse(localStorage.getItem(key) || 'null') || fb } catch { return fb } }
function writeLS(key, d) { try { localStorage.setItem(key, JSON.stringify(d)) } catch {} }

// ─── Fallback data ────────────────────────────────────────────────────────────

const FB_TRUCKS = [
  { id: 'T01', label: 'Truck 01', driver: 'Pedro Santos',    barangay: 'Ibabang Dupay',   status: 'collecting', capacity: 75, eta: '10:30 AM', color: '#14b8a6' },
  { id: 'T02', label: 'Truck 02', driver: 'Juan Dela Cruz',  barangay: 'Gulang-Gulang',   status: 'collecting', capacity: 60, eta: '11:15 AM', color: '#f59e0b' },
  { id: 'T03', label: 'Truck 03', driver: 'Maria Reyes',     barangay: 'Cotta',           status: 'en_route',  capacity: 30, eta: '1:00 PM',  color: '#a78bfa' },
  { id: 'T04', label: 'Truck 04', driver: 'Ramon Lim',       barangay: 'Isabang',         status: 'done',      capacity: 100, eta: 'Done',    color: '#22c55e' },
]

const FB_ZONES = [
  { zone: 'Ibabang Dupay',   status: 'collecting', time: '8:00–10:30 AM', isToday: true  },
  { zone: 'Gulang-Gulang',   status: 'collecting', time: '9:00–11:15 AM', isToday: true  },
  { zone: 'Cotta',           status: 'en_route',   time: '11:00–1:00 PM', isToday: true  },
  { zone: 'Isabang',         status: 'done',       time: '6:00–9:00 AM',  isToday: true  },
  { zone: 'Dalahican',       status: 'upcoming',   time: 'Wed 7:00 AM',   isToday: false },
  { zone: 'Ilayang Dupay',   status: 'missed',     time: 'Mon — Missed',  isToday: false },
]

const STATUS_META = {
  collecting : { label: '🚛 Collecting',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  en_route   : { label: '🛣 En Route',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  done       : { label: '✅ Done',        color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'  },
  upcoming   : { label: '⏳ Upcoming',    color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  missed     : { label: '❌ Missed',      color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
}

// ─── Countdown to next pickup ─────────────────────────────────────────────────

function useCountdown(nextTime) {
  const [label, setLabel] = useState('—')
  useEffect(() => {
    if (!nextTime) return
    const update = () => {
      const [h, m] = nextTime.split(':').map(Number)
      const target = new Date(); target.setHours(h, m, 0, 0)
      if (target < new Date()) target.setDate(target.getDate() + 1)
      const diff = target - new Date()
      const hh   = Math.floor(diff / 3600000)
      const mm   = Math.floor((diff % 3600000) / 60000)
      setLabel(`${hh}h ${mm}m`)
    }
    update()
    const t = setInterval(update, 60000)
    return () => clearInterval(t)
  }, [nextTime])
  return label
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflineCommandCenter() {
  const isOnline   = useOnline()
  const navigate   = useNavigate()
  const [trucks,   setTrucks]   = useState(readLS(LS_TRUCKS,   FB_TRUCKS))
  const [zones,    setZones]    = useState(readLS(LS_SCHEDULE,  FB_ZONES))
  const [lastSync, setLastSync] = useState(null)
  const [tab,      setTab]      = useState('trucks')  // 'trucks' | 'zones'

  useEffect(() => {
    if (!isOnline) return
    Promise.allSettled([
      api.get('/api/public/trucks/'),
      api.get('/api/public/schedule/'),
    ]).then(([tr, sc]) => {
      if (tr.status === 'fulfilled' && tr.value?.data) { writeLS(LS_TRUCKS, tr.value.data);   setTrucks(tr.value.data)   }
      if (sc.status === 'fulfilled' && sc.value?.data) { writeLS(LS_SCHEDULE, sc.value.data); setZones(sc.value.data)   }
      setLastSync(new Date())
    })
  }, [isOnline])

  const nextPickup  = trucks.find(t => t.status === 'en_route' || t.status === 'collecting')
  const countdown   = useCountdown(nextPickup?.eta?.split(' ')[0] || null)
  const activeCount = trucks.filter(t => ['collecting','en_route'].includes(t.status)).length

  return (
    <div className="occ-wrap">
      {/* Header */}
      <div className="occ-header">
        <div className="occ-header__left">
          <span className="occ-icon">🏢</span>
          <div>
            <h3 className="occ-title">Command Center</h3>
            <p className="occ-sub">
              {lastSync
                ? `Synced ${lastSync.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`
                : 'Showing cached data'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {!isOnline && <span className="oas-badge oas-badge--cached">📦 Cached</span>}
          <button className="occ-fullbtn" onClick={() => navigate('/map')}>Full Map ›</button>
        </div>
      </div>

      {/* KPI row */}
      <div className="occ-kpi-row">
        <div className="occ-kpi">
          <span className="occ-kpi__val" style={{ color: '#22c55e' }}>{activeCount}</span>
          <span className="occ-kpi__label">Active Trucks</span>
        </div>
        <div className="occ-kpi occ-kpi--mid">
          <span className="occ-kpi__val" style={{ color: '#f59e0b' }}>{countdown}</span>
          <span className="occ-kpi__label">Next Pickup</span>
        </div>
        <div className="occ-kpi">
          <span className="occ-kpi__val" style={{ color: '#ef4444' }}>
            {zones.filter(z => z.status === 'missed').length}
          </span>
          <span className="occ-kpi__label">Missed Today</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="occ-tabs">
        <button className={`occ-tab${tab === 'trucks' ? ' occ-tab--active' : ''}`} onClick={() => setTab('trucks')}>
          🚛 Trucks
        </button>
        <button className={`occ-tab${tab === 'zones' ? ' occ-tab--active' : ''}`} onClick={() => setTab('zones')}>
          🗺 Zones
        </button>
      </div>

      {/* Truck cards */}
      {tab === 'trucks' && (
        <div className="occ-list">
          {trucks.map(t => {
            const sm = STATUS_META[t.status] || STATUS_META.upcoming
            return (
              <div key={t.id} className="occ-truck-card" style={{ borderLeftColor: t.color }}>
                <div className="occ-truck-card__top">
                  <span className="occ-truck-card__id" style={{ color: t.color }}>🚛 {t.label}</span>
                  <span className="occ-truck-card__badge" style={{ color: sm.color, background: sm.bg }}>
                    {sm.label}
                  </span>
                </div>
                <div className="occ-truck-card__info">
                  <span>{t.driver}</span>
                  <span>·</span>
                  <span>{t.barangay}</span>
                </div>
                <div className="occ-truck-card__row">
                  <div className="occ-cap-bar">
                    <div className="occ-cap-bar__fill" style={{ width: `${t.capacity}%`, background: t.color }} />
                  </div>
                  <span className="occ-truck-card__eta">ETA: {t.eta}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Zone status list */}
      {tab === 'zones' && (
        <div className="occ-list">
          {zones.map((z, i) => {
            const sm = STATUS_META[z.status] || STATUS_META.upcoming
            return (
              <div key={i} className="occ-zone-row">
                <div className="occ-zone-row__dot" style={{ background: sm.color }} />
                <div className="occ-zone-row__info">
                  <span className="occ-zone-row__name">{z.zone}</span>
                  <span className="occ-zone-row__time">{z.time}</span>
                </div>
                <span className="occ-zone-row__badge" style={{ color: sm.color, background: sm.bg }}>
                  {sm.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
