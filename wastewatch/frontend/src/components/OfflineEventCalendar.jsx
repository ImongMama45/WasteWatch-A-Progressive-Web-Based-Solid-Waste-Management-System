/**
 * components/OfflineEventCalendar.jsx
 * -------------------------------------
 * Public municipal event calendar component for the Public Landing Dashboard.
 * Integrates directly with the unified Calendar Service (GET /api/calendar/entries/?source=municipal_event).
 *
 * Shows:
 *   - Interactive 7-day outlook strip (today + 6 days) with event indicator dots
 *   - Filter tabs: All Upcoming / Today / Selected Date
 *   - Genuine municipal event cards with authorized categories, location, organizer, and time window
 *   - Seamless cross-reference button to jump to that barangay's collection schedule
 *   - Truthful loading, capacity error (HTTP 503), network error, and empty states
 *
 * STRICT ICONOGRAPHY: ZERO emojis; SVG icons only.
 */

import { useState, useMemo } from 'react'
import {
  Calendar,
  AlertCircle,
  Trash2,
  Megaphone,
  Leaf,
  BookOpen,
  ChevronDown,
  ChevronUp,
  MapPin,
  Clock,
  CheckCircle2,
  Truck,
  RotateCw,
} from 'lucide-react'
import { useOnline } from '../hooks/useOnline'
import { useCalendarEntries } from '../hooks/useCalendarEntries'
import { formatToManilaDateString } from '../api/calendarService'

// ─── Authorized Backend Categories & Visual Metadata ─────────────────────────

const CATEGORY_META = {
  cleanup: {
    icon: <Trash2 size={16} />,
    label: 'Cleanup Drive',
    color: '#15803d',
    bg: '#f0fdf4',
    border: '#bbf7d0',
  },
  community_meeting: {
    icon: <Megaphone size={16} />,
    label: 'Community Meeting',
    color: '#0369a1',
    bg: '#f0f9ff',
    border: '#bae6fd',
  },
  hazardous_waste: {
    icon: <AlertCircle size={16} />,
    label: 'Special Waste Collection',
    color: '#b45309',
    bg: '#fffbeb',
    border: '#fde68a',
  },
  tree_planting: {
    icon: <Leaf size={16} />,
    label: 'Tree Planting',
    color: '#047857',
    bg: '#ecfdf5',
    border: '#a7f3d0',
  },
  workshop: {
    icon: <BookOpen size={16} />,
    label: 'Public Orientation & Seminar',
    color: '#6d28d9',
    bg: '#f5f3ff',
    border: '#ddd6fe',
  },
  general: {
    icon: <Calendar size={16} />,
    label: 'General Municipal Event',
    color: '#475569',
    bg: '#f8fafc',
    border: '#e2e8f0',
  },
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function sameDayInManila(isoDateStr, targetDate) {
  if (!isoDateStr || !targetDate) return false
  try {
    const entryDateStr = formatToManilaDateString(isoDateStr)
    const targetDateStr = formatToManilaDateString(targetDate)
    return entryDateStr === targetDateStr
  } catch {
    return false
  }
}

function formatDateDisplay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  })
}

function formatTimeWindow(startIso, endIso) {
  if (!startIso) return 'Time TBA'
  const s = new Date(startIso)
  if (isNaN(s.getTime())) return 'Time TBA'

  const timeOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  }

  const startFormatted = s.toLocaleTimeString('en-PH', timeOptions)
  if (!endIso) return startFormatted

  const e = new Date(endIso)
  if (isNaN(e.getTime())) return startFormatted
  const endFormatted = e.toLocaleTimeString('en-PH', timeOptions)

  return `${startFormatted} – ${endFormatted}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflineEventCalendar({ onSelectBarangay }) {
  const isOnline = useOnline()
  const [selectedDay, setSelectedDay] = useState(null)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'day'
  const [expandedId, setExpandedId] = useState(null)

  // Build the 7-day outlook dates (today + 6 days) anchored in Manila time
  const { today, days, startDateStr, endDateStr } = useMemo(() => {
    const now = new Date()
    const dList = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now)
      d.setDate(now.getDate() + i)
      d.setHours(0, 0, 0, 0)
      return d
    })
    return {
      today: dList[0],
      days: dList,
      startDateStr: formatToManilaDateString(dList[0]),
      endDateStr: formatToManilaDateString(dList[6]),
    }
  }, [])

  // Fetch real MunicipalEvent entries across the 7-day window
  const {
    entries: events,
    loading,
    error,
    refresh,
    isRefreshing,
    isCapacityError,
    isNetworkError,
  } = useCalendarEntries({
    startDate: startDateStr,
    endDate: endDateStr,
    source: 'municipal_event',
    paginate: false,
    autoFetch: true,
  })

  const activeDate = selectedDay || today

  // Filter events matching selected date or all upcoming
  const dayEvents = useMemo(() => {
    return events.filter(e => sameDayInManila(e.start_datetime || e.start, activeDate))
  }, [events, activeDate])

  const todayEvents = useMemo(() => {
    return events.filter(e => sameDayInManila(e.start_datetime || e.start, today))
  }, [events, today])

  // Events to display based on active filter
  const displayEvents = useMemo(() => {
    if (filterMode === 'day' && selectedDay) {
      return dayEvents
    }
    return events
  }, [filterMode, selectedDay, dayEvents, events])

  return (
    <div className="oec-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div
        className="oec-header"
        style={{
          padding: '16px 20px',
          background: '#0d1f0f',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div className="oec-header__left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className="oec-icon"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#81c784',
            }}
          >
            <Calendar size={20} />
          </span>
          <div>
            <h3 className="oec-title" style={{ fontSize: '15px', color: '#fff', fontWeight: 800, margin: 0 }}>
              Municipal Events Calendar
            </h3>
            <p className="oec-sub" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', margin: '2px 0 0' }}>
              Lucena City community cleanups, orientations, and civic activities
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isRefreshing && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '11px',
                color: '#81c784',
              }}
            >
              <RotateCw size={12} className="ww-spin" /> Updating...
            </span>
          )}
          {!isOnline && (
            <span
              className="oas-badge oas-badge--cached"
              style={{
                background: 'rgba(230,81,0,0.2)',
                color: '#ffcc80',
                border: '1px solid rgba(255,204,128,0.4)',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: '11px',
                fontWeight: 700,
              }}
            >
              Offline
            </span>
          )}
        </div>
      </div>

      {/* Capacity error banner (HTTP 503) */}
      {isCapacityError && (
        <div
          style={{
            padding: '12px 18px',
            background: 'rgba(245,158,11,0.1)',
            borderLeft: '4px solid #f59e0b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={18} color="#b45309" style={{ flexShrink: 0 }} />
            <div style={{ fontSize: '12px', color: '#92400e', lineHeight: 1.4 }}>
              <strong>Calendar Service Busy:</strong> The system is currently experiencing high query traffic. Please try again shortly.
            </div>
          </div>
          <button
            onClick={() => refresh()}
            style={{
              background: 'none',
              border: '1px solid #d97706',
              borderRadius: 6,
              color: '#b45309',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Network error banner */}
      {isNetworkError && (
        <div
          style={{
            padding: '12px 18px',
            background: 'rgba(239,68,68,0.08)',
            borderLeft: '4px solid #ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
            <div style={{ fontSize: '12px', color: '#991b1b', lineHeight: 1.4 }}>
              <strong>Connection Error:</strong> Unable to load the latest municipal events. Please check your internet connection.
            </div>
          </div>
          <button
            onClick={() => refresh()}
            style={{
              background: 'none',
              border: '1px solid #ef4444',
              borderRadius: 6,
              color: '#b91c1c',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 7-day strip */}
      <div
        style={{
          padding: '14px 18px 6px',
          background: 'var(--ld-surface-2, #f0f7ec)',
          borderBottom: '1px solid var(--ld-line, #dce8d4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--ld-text-2, #4a6741)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Interactive 7-Day Outlook
          </span>
          {selectedDay && (
            <button
              onClick={() => {
                setSelectedDay(null)
                setFilterMode('all')
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--ld-green, #2e7d32)',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                padding: '2px 6px',
              }}
            >
              Reset to All
            </button>
          )}
        </div>

        <div className="oec-strip" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
          {days.map((d, i) => {
            const evsOnDay = events.filter(e => sameDayInManila(e.start_datetime || e.start, d))
            const isToday = sameDayInManila(today, d)
            const isSel = selectedDay && sameDayInManila(selectedDay, d)
            const hasEvents = evsOnDay.length > 0
            const firstCategory = hasEvents ? evsOnDay[0].category : null
            const dotColor = firstCategory && CATEGORY_META[firstCategory] ? CATEGORY_META[firstCategory].color : '#2e7d32'

            return (
              <button
                key={i}
                className={`oec-day${isSel ? ' oec-day--selected' : ''}${isToday ? ' oec-day--today' : ''}`}
                onClick={() => {
                  setSelectedDay(d)
                  setFilterMode('day')
                  if (evsOnDay.length > 0) {
                    setExpandedId(evsOnDay[0].id)
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 44,
                  background: isSel ? 'var(--ld-green, #2e7d32)' : isToday ? '#e8f5e9' : '#fff',
                  borderColor: isSel ? 'var(--ld-green, #2e7d32)' : isToday ? '#81c784' : '#e2e8f0',
                  borderRadius: 12,
                  padding: '8px 4px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isSel ? '0 4px 12px rgba(46,125,50,0.3)' : 'none',
                }}
              >
                <span
                  className="oec-day__label"
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    color: isSel ? '#fff' : isToday ? 'var(--ld-green, #2e7d32)' : '#64748b',
                  }}
                >
                  {DAY_LABELS[d.getDay()]}
                </span>
                <span
                  className="oec-day__num"
                  style={{
                    fontSize: '15px',
                    fontWeight: 800,
                    color: isSel ? '#fff' : '#1e293b',
                  }}
                >
                  {d.getDate()}
                </span>
                <div style={{ height: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {hasEvents ? (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: isSel ? '#fff' : dotColor,
                      }}
                    />
                  ) : (
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'transparent' }} />
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filter Tabs strip */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 18px',
          background: '#fff',
          borderBottom: '1px solid #f1f5f9',
          alignItems: 'center',
        }}
      >
        <button
          onClick={() => {
            setSelectedDay(null)
            setFilterMode('all')
          }}
          style={{
            padding: '5px 12px',
            borderRadius: 100,
            fontSize: '11px',
            fontWeight: 700,
            border: '1px solid',
            borderColor: filterMode === 'all' ? 'var(--ld-green, #2e7d32)' : '#e2e8f0',
            background: filterMode === 'all' ? 'var(--ld-green-lt, #e8f5e9)' : '#fff',
            color: filterMode === 'all' ? 'var(--ld-green, #2e7d32)' : '#64748b',
            cursor: 'pointer',
          }}
        >
          All Upcoming ({events.length})
        </button>

        {selectedDay && (
          <button
            onClick={() => setFilterMode('day')}
            style={{
              padding: '5px 12px',
              borderRadius: 100,
              fontSize: '11px',
              fontWeight: 700,
              border: '1px solid',
              borderColor: filterMode === 'day' ? 'var(--ld-green, #2e7d32)' : '#e2e8f0',
              background: filterMode === 'day' ? 'var(--ld-green-lt, #e8f5e9)' : '#fff',
              color: filterMode === 'day' ? 'var(--ld-green, #2e7d32)' : '#64748b',
              cursor: 'pointer',
            }}
          >
            {formatDateDisplay(selectedDay)} ({dayEvents.length})
          </button>
        )}

        {!selectedDay && todayEvents.length > 0 && (
          <button
            onClick={() => {
              setSelectedDay(today)
              setFilterMode('day')
            }}
            style={{
              padding: '5px 12px',
              borderRadius: 100,
              fontSize: '11px',
              fontWeight: 700,
              border: '1px solid #e2e8f0',
              background: '#fff',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            Today ({todayEvents.length})
          </button>
        )}
      </div>

      {/* Event list */}
      <div
        className="oec-list"
        style={{
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          maxHeight: 380,
          overflowY: 'auto',
        }}
      >
        {loading && events.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: '#64748b' }}>
            <Calendar size={28} style={{ color: '#a5d6a7', margin: '0 auto 8px', display: 'block' }} />
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Loading municipal events...</div>
          </div>
        ) : filterMode === 'day' && selectedDay && dayEvents.length === 0 ? (
          <div
            style={{
              padding: '20px 16px',
              background: '#f8fafc',
              borderRadius: 12,
              border: '1px dashed #cbd5e1',
              textAlign: 'center',
            }}
          >
            <Calendar size={24} style={{ color: '#94a3b8', margin: '0 auto 8px', display: 'block' }} />
            <div style={{ fontWeight: 700, fontSize: '13px', color: '#334155', marginBottom: 2 }}>
              No municipal events on {formatDateDisplay(activeDate)}
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 8px' }}>
              Standard barangay collection routes apply on this date.
            </p>
          </div>
        ) : events.length === 0 && !loading ? (
          <div
            style={{
              padding: '24px 16px',
              background: '#f8fafc',
              borderRadius: 12,
              border: '1px dashed #cbd5e1',
              textAlign: 'center',
            }}
          >
            <Calendar size={26} style={{ color: '#94a3b8', margin: '0 auto 8px', display: 'block' }} />
            <div style={{ fontWeight: 700, fontSize: '13px', color: '#334155', marginBottom: 2 }}>
              No Municipal Events Scheduled
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0' }}>
              There are no public clean-up drives, seminars, or special collection events scheduled for the next 7 days.
            </p>
          </div>
        ) : null}

        {displayEvents.map(e => {
          const categoryKey = e.category || 'general'
          const meta = CATEGORY_META[categoryKey] || CATEGORY_META.general
          const isExpanded = expandedId === e.id
          const primaryBarangay = e.barangay_details && e.barangay_details.length > 0
            ? e.barangay_details[0].name
            : e.is_citywide
            ? 'Citywide'
            : (e.location || 'Lucena City')

          return (
            <div
              key={e.id}
              style={{
                border: `1px solid ${isExpanded ? 'var(--ld-green-bdr2, #a5d6a7)' : '#e2e8f0'}`,
                borderRadius: 14,
                background: isExpanded ? '#fafdf9' : '#fff',
                padding: '12px 16px',
                transition: 'all 0.2s ease',
                boxShadow: isExpanded ? '0 4px 16px rgba(46,125,50,0.08)' : 'none',
              }}
            >
              {/* Row Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  cursor: 'pointer',
                }}
                onClick={() => setExpandedId(isExpanded ? null : e.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: meta.bg,
                      color: meta.color,
                      border: `1px solid ${meta.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {meta.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#1e293b' }}>
                        {e.title}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '11px', color: '#64748b', marginTop: 2 }}>
                      <span>{formatDateDisplay(e.start_datetime || e.start)}</span>
                      <span>•</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <MapPin size={11} /> {primaryBarangay}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      color: meta.color,
                      background: meta.bg,
                      border: `1px solid ${meta.border}`,
                      borderRadius: 100,
                      padding: '3px 9px',
                    }}
                  >
                    {e.category_display || meta.label}
                  </span>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    aria-label="Toggle event details"
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
              </div>

              {/* Expandable Details Section */}
              {isExpanded && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eef2f6' }}>
                  {/* Time window */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11.5px', color: '#475569', marginBottom: 8 }}>
                    <Clock size={13} color="#2e7d32" />
                    <span><strong>Schedule:</strong> {formatTimeWindow(e.start_datetime || e.start, e.end_datetime || e.end)}</span>
                  </div>

                  {/* Venue / Location */}
                  {e.location && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11.5px', color: '#475569', marginBottom: 8 }}>
                      <MapPin size={13} color="#2e7d32" />
                      <span><strong>Venue:</strong> {e.location}</span>
                    </div>
                  )}

                  {/* Event description */}
                  {e.description && (
                    <p style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5, margin: '0 0 10px' }}>
                      {e.description}
                    </p>
                  )}

                  {/* Organizer banner */}
                  {e.metadata?.organizer && (
                    <div
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--ld-text-2, #4a6741)',
                        background: 'var(--ld-surface-2, #f0f7ec)',
                        padding: '8px 12px',
                        borderRadius: 8,
                        marginBottom: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <CheckCircle2 size={14} color="var(--ld-green, #2e7d32)" />
                      <span><strong>Organized by:</strong> {e.metadata.organizer}</span>
                    </div>
                  )}

                  {/* Optional authentic fields if present */}
                  {e.surge && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '11.5px', fontWeight: 700, color: '#ef4444' }}>
                      <AlertCircle size={14} /> Forecasted Volume: {e.surge}
                    </div>
                  )}
                  {e.advisory && (
                    <p style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5, margin: '0 0 8px' }}>
                      <strong>Citizen Advisory:</strong> {e.advisory}
                    </p>
                  )}
                  {e.action && (
                    <div style={{ fontSize: '11.5px', color: 'var(--ld-text-2, #4a6741)', background: 'var(--ld-surface-2, #f0f7ec)', padding: '8px 12px', borderRadius: 8, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle2 size={14} color="var(--ld-green, #2e7d32)" />
                      <span><strong>Action:</strong> {e.action}</span>
                    </div>
                  )}

                  {/* Cross-reference to Collection Schedule */}
                  {onSelectBarangay && primaryBarangay && !e.is_citywide && (
                    <button
                      onClick={() => onSelectBarangay(primaryBarangay)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'var(--ld-green, #2e7d32)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '6px 12px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      <Truck size={13} /> View {primaryBarangay} Collection Schedule &rarr;
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
