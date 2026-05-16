/**
 * components/OfflineEventCalendar.jsx
 * -------------------------------------
 * Cached barangay/city event calendar — works offline.
 * Reads from ww_events localStorage cache.
 *
 * Shows:
 *   • 7-day strip (today + 6 days) with event dots
 *   • Upcoming event list with type, impact badge
 *   • Warning banner for high-waste-impact events in next 3 days
 */

import { useState, useEffect } from 'react'
import { useOnline } from '../hooks/useOnline'
import api from '../api/client'

// ─── Cache helpers ────────────────────────────────────────────────────────────

const LS_KEY = 'ww_events'

function readCache()    { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null } }
function writeCache(d)  { try { localStorage.setItem(LS_KEY, JSON.stringify(d)) } catch {} }

// ─── Fallback events ──────────────────────────────────────────────────────────

function buildFallback() {
  const today = new Date()
  const d = (offset, h = 0) => {
    const dt = new Date(today)
    dt.setDate(dt.getDate() + offset)
    dt.setHours(h, 0, 0, 0)
    return dt.toISOString()
  }
  return [
    { id: 'E1', name: 'Barangay Fiesta — Isabang',     type: 'fiesta',   date: d(1),  wasteImpact: 'high',   barangay: 'Isabang'        },
    { id: 'E2', name: 'Lucena City Public Market Day',  type: 'market',   date: d(2),  wasteImpact: 'medium', barangay: 'Cotta'          },
    { id: 'E3', name: 'Araw ng Lucena Holiday',         type: 'holiday',  date: d(4),  wasteImpact: 'high',   barangay: 'City-wide'      },
    { id: 'E4', name: 'Coastal Clean-up Drive',         type: 'cleanup',  date: d(5),  wasteImpact: 'low',    barangay: 'Dalahican'      },
    { id: 'E5', name: 'Weekly Palengke — Gulang',       type: 'market',   date: d(6),  wasteImpact: 'medium', barangay: 'Gulang-Gulang'  },
    { id: 'E6', name: 'Zone 3 Construction Activity',   type: 'other',    date: d(8),  wasteImpact: 'medium', barangay: 'Ilayang Dupay'  },
  ]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_META = {
  fiesta  : { emoji: '🎉', label: 'Fiesta'     },
  market  : { emoji: '🛒', label: 'Market Day' },
  holiday : { emoji: '🎌', label: 'Holiday'    },
  cleanup : { emoji: '🧹', label: 'Clean-up'   },
  other   : { emoji: '🏗️', label: 'Activity'   },
}

const IMPACT_META = {
  low    : { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   label: 'Low Impact'    },
  medium : { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  label: 'Med Impact'    },
  high   : { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   label: 'High Impact'   },
}

const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflineEventCalendar() {
  const isOnline = useOnline()
  const [events,      setEvents]      = useState(readCache() || buildFallback())
  const [selectedDay, setSelectedDay] = useState(null)

  // Online: background refresh
  useEffect(() => {
    if (!isOnline) return
    api.get('/api/public/events/').then(res => {
      if (res?.data?.length) { writeCache(res.data); setEvents(res.data) }
    }).catch(() => {})
  }, [isOnline])

  // Build 7-day strip
  const today = new Date(); today.setHours(0,0,0,0)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i); return d
  })

  const active  = selectedDay || today
  const dayEvts = events.filter(e => sameDay(new Date(e.date), active))

  // High-impact warning in next 3 days
  const warningEvts = events.filter(e => {
    const d = new Date(e.date); const diff = (d - today) / 86400000
    return diff >= 0 && diff <= 3 && e.wasteImpact === 'high'
  })

  return (
    <div className="oec-wrap">
      {/* Header */}
      <div className="oec-header">
        <div className="oec-header__left">
          <span className="oec-icon">📅</span>
          <div>
            <h3 className="oec-title">Event Calendar</h3>
            <p className="oec-sub">Waste impact forecast</p>
          </div>
        </div>
        {!isOnline && <span className="oas-badge oas-badge--cached">📦 Cached</span>}
      </div>

      {/* Warning banner */}
      {warningEvts.length > 0 && (
        <div className="oec-warning">
          <span>🔴</span>
          <div>
            <strong>High Waste Alert:</strong>{' '}
            {warningEvts.map(e => e.name).join(' · ')} in the next 3 days — prepare extra collection capacity.
          </div>
        </div>
      )}

      {/* 7-day strip */}
      <div className="oec-strip">
        {days.map((d, i) => {
          const dayEvs  = events.filter(e => sameDay(new Date(e.date), d))
          const isToday = sameDay(d, today)
          const isSel   = sameDay(d, active)
          const maxImpact = dayEvs.some(e => e.wasteImpact === 'high')   ? 'high'
                          : dayEvs.some(e => e.wasteImpact === 'medium') ? 'medium'
                          : dayEvs.length > 0                            ? 'low'
                          : null
          return (
            <button
              key={i}
              className={`oec-day${isSel ? ' oec-day--selected' : ''}${isToday ? ' oec-day--today' : ''}`}
              onClick={() => setSelectedDay(d)}
            >
              <span className="oec-day__label">{DAY_LABELS[d.getDay()]}</span>
              <span className="oec-day__num">{d.getDate()}</span>
              {maxImpact && (
                <span className="oec-day__dot" style={{ background: IMPACT_META[maxImpact].color }} />
              )}
            </button>
          )
        })}
      </div>

      {/* Event list for selected day */}
      <div className="oec-list">
        {dayEvts.length === 0 ? (
          <div className="oec-empty">
            <span>🗓️</span>
            <span>No events on {active.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          </div>
        ) : (
          dayEvts.map(e => {
            const tm = TYPE_META[e.type]   || { emoji: '📌', label: e.type }
            const im = IMPACT_META[e.wasteImpact] || IMPACT_META.low
            return (
              <div key={e.id} className="oec-event-row">
                <span className="oec-event-row__emoji">{tm.emoji}</span>
                <div className="oec-event-row__info">
                  <span className="oec-event-row__name">{e.name}</span>
                  <span className="oec-event-row__meta">{tm.label} · {e.barangay}</span>
                </div>
                <span className="oec-impact-badge" style={{ color: im.color, background: im.bg }}>
                  {im.label}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* All upcoming */}
      {selectedDay && (
        <button className="oec-all-btn" onClick={() => setSelectedDay(null)}>
          ← View Today
        </button>
      )}
    </div>
  )
}
