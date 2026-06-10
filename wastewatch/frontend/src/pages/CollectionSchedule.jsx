import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'
import api from '../api/client'

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS     = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Parse the backend "days" string (e.g. "Mon, Wed, Fri") into day-of-week numbers
function parseDayNums(daysStr = '') {
  const MAP = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 }
  return daysStr.split(/[\s,]+/).map(d => MAP[d.toLowerCase().slice(0,3)]).filter(n => n != null && !isNaN(n))
}

function fmt12(timeStr) {
  if (!timeStr) return '—'
  const [hStr, mStr] = timeStr.split(':')
  const h = parseInt(hStr, 10), m = mStr || '00'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12  = h % 12 || 12
  return `${h12}:${m} ${ampm}`
}

function buildCalendar(month, year) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return cells
}

export default function CollectionSchedule() {
  const { user } = useAuth()
  const role = user?.role?.toLowerCase() || 'citizen'
  const userBarangay = user?.barangay_name || ''

  const showDetails = ['brgy_official', 'watcher', 'driver', 'admin'].includes(role)
  const isDriver    = role === 'driver'

  // ── Data ──────────────────────────────────────────────────────────────────
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [expandedId, setExpandedId] = useState(null)

  // ── Calendar ──────────────────────────────────────────────────────────────
  const today = new Date()
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [calYear,  setCalYear]  = useState(today.getFullYear())

  useEffect(() => {
    setLoading(true)
    api.get('/api/driver/collection-schedules/')
      .then(res => {
        const raw = Array.isArray(res.data) ? res.data
          : Array.isArray(res.data?.results) ? res.data.results : []
        setSchedules(raw)
      })
      .catch(() => setError('Could not load schedules. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  // Filter: for non-admin/non-driver show only barangay-relevant schedules
  const visibleSchedules = schedules.filter(s => {
    if (['admin', 'driver'].includes(role)) return true
    if (!userBarangay) return true
    const names = (s.barangay_names || '').toLowerCase()
    return names.includes(userBarangay.toLowerCase()) || names === ''
  })

  // Today's schedules (match day-of-week to today)
  const todayDow = today.getDay() // 0-6
  const todayFull = DAYS_FULL[todayDow]
  const todaySchedules = visibleSchedules.filter(s => {
    const nums = parseDayNums(s.days || '')
    return nums.includes(todayDow) || (s.days || '').toLowerCase().includes(todayFull.toLowerCase().slice(0,3))
  })

  // Unique collection day-of-week numbers across all visible schedules (for calendar)
  const collectionDayNums = [...new Set(visibleSchedules.flatMap(s => parseDayNums(s.days || '')))]
  const cells = buildCalendar(calMonth, calYear)

  return (
    <div>
      <Navbar />
      <style>{`
        .sched-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px; margin-bottom: 16px; box-shadow: 0 4px 12px rgba(0,0,0,.03); transition: all 0.2s; }
        .sched-card.interactive:hover { border-color: var(--accent); cursor: pointer; }
        .sched-day-badge { background: rgba(46,204,113,.1); color: #2ecc71; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; border: 1px solid rgba(46,204,113,.3); }
        .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; }
        .status-badge.active { background: rgba(46,204,113,.15); color: #2ecc71; border: 1px solid rgba(46,204,113,.3); }
        .status-badge.inactive { background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border); }
        .stop-line { position: absolute; left: 11px; top: 24px; bottom: -8px; width: 2px; background: var(--border); }
        .stop-item:last-child .stop-line { display: none; }
        @keyframes schedFade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .sched-animate { animation: schedFade .3s ease both; }
      `}</style>

      <div className="page" style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, margin: 0 }}>Collection Schedule</h2>
            {userBarangay && (
              <span style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>
                BRGY. {userBarangay.toUpperCase()}
              </span>
            )}
          </div>
          <p className="text-muted text-sm">Live garbage collection schedules and routes for your area.</p>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Loading schedules…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#ef4444', fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* ── Mini Calendar ── */}
            <div className="sched-card" style={{ marginBottom: 16, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else setCalMonth(m => m - 1) }}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                <span style={{ fontWeight: 800, fontSize: 14, fontFamily: 'var(--font-head)' }}>{MONTHS[calMonth]} {calYear}</span>
                <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else setCalMonth(m => m + 1) }}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
                {DAYS_SHORT.map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', padding: '2px 0', letterSpacing: '.04em' }}>{d}</div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {cells.map((day, idx) => {
                  if (!day) return <div key={`e${idx}`} />
                  const cellDate  = new Date(calYear, calMonth, day)
                  const dow       = cellDate.getDay()
                  const isToday   = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()
                  const hasPickup = collectionDayNums.includes(dow)
                  const isPast    = cellDate < new Date(today.getFullYear(), today.getMonth(), today.getDate())
                  return (
                    <div key={day} style={{
                      textAlign: 'center', padding: '6px 2px', borderRadius: 8,
                      fontSize: 12, fontWeight: isToday ? 800 : hasPickup ? 700 : 400, position: 'relative',
                      background: isToday ? '#2ecc71' : hasPickup ? 'rgba(46,204,113,.1)' : 'transparent',
                      color: isToday ? '#0d1117' : hasPickup ? '#2ecc71' : isPast ? 'var(--text-muted)' : 'var(--text)',
                      border: hasPickup && !isToday ? '1px solid rgba(46,204,113,.3)' : '1px solid transparent',
                      opacity: isPast && !isToday ? 0.5 : 1,
                    }}>
                      {day}
                      {hasPickup && !isToday && <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#2ecc71', margin: '2px auto 0' }} />}
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2ecc71' }} /> Today
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(46,204,113,.15)', border: '1px solid rgba(46,204,113,.4)' }} /> Collection Day
                </div>
              </div>
            </div>

            {/* ── Today's Schedule ── */}
            <div className="sched-card" style={{ border: todaySchedules.length ? '2px solid rgba(46,204,113,.5)' : '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
              {todaySchedules.length > 0 && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: '#2ecc71' }} />}
              <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 16 }}>Today's Schedule</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div className={`status-badge ${todaySchedules.length ? 'active' : 'inactive'}`}>
                  {todaySchedules.length ? 'Collection Today' : 'No Collection Today'}
                </div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{todayFull}</div>
              </div>
              {todaySchedules.length > 0 ? todaySchedules.map(s => (
                <div key={s.id} className="sched-animate" style={{ display: 'grid', gap: 10, background: 'var(--surface-2)', padding: 16, borderRadius: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.05em' }}>TIME</div><div style={{ fontWeight: 600, fontSize: 14 }}>{fmt12(s.start_time)} – {fmt12(s.end_time)}</div></div>
                    <div><div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.05em' }}>AREA</div><div style={{ fontWeight: 600, fontSize: 14 }}>{s.area || s.barangay_names || '—'}</div></div>
                    {showDetails && <div><div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.05em' }}>TRUCK</div><div style={{ fontWeight: 600, fontSize: 14 }}>{s.truck_plate || '—'} {isDriver && <span style={{ color: '#5dade2', fontSize: 12 }}>(You)</span>}</div></div>}
                    {showDetails && <div><div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.05em' }}>DRIVER</div><div style={{ fontWeight: 600, fontSize: 14 }}>{s.driver_name || '—'}</div></div>}
                  </div>
                </div>
              )) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No garbage collection scheduled for today. Check the weekly schedule below.</div>
              )}
            </div>

            {/* ── Weekly Schedule ── */}
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, margin: '24px 0 16px' }}>
              Weekly Schedule {visibleSchedules.length > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>({visibleSchedules.length} route{visibleSchedules.length !== 1 ? 's' : ''})</span>}
            </h3>

            {visibleSchedules.length === 0 ? (
              <div className="sched-card" style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>No schedules found</div>
                <div style={{ fontSize: 13 }}>No collection routes have been configured for your barangay yet.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {visibleSchedules.map(item => {
                  const dayNums   = parseDayNums(item.days || '')
                  const isActive  = dayNums.includes(todayDow)
                  const isExpanded = expandedId === item.id
                  const canExpand  = showDetails

                  return (
                    <div key={item.id} className={`sched-card ${canExpand ? 'interactive' : ''}`} style={{ margin: 0, padding: 0 }}
                      onClick={() => canExpand && setExpandedId(isExpanded ? null : item.id)}>

                      {/* Main Row */}
                      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ width: 48, height: 48, borderRadius: 12, background: isActive ? 'rgba(46,204,113,.1)' : 'var(--surface-2)', border: `1px solid ${isActive ? 'rgba(46,204,113,.3)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: isActive ? '#2ecc71' : 'var(--text-muted)', textTransform: 'uppercase' }}>
                            {item.days || '—'}
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 15 }}>{item.area || item.barangay_names || `Route ${item.id}`}</span>
                            {isActive && <span className="sched-day-badge">Today</span>}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            <span>{fmt12(item.start_time)} – {fmt12(item.end_time)}</span>
                            <span>{item.barangay_names || ''}</span>
                            {showDetails && item.truck_plate && <span>🚛 {item.truck_plate}</span>}
                          </div>
                        </div>
                        {canExpand && (
                          <div style={{ color: 'var(--text-muted)', fontSize: 18, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>›</div>
                        )}
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && canExpand && (
                        <div className="sched-animate" style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 16 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
                            {item.driver_name && <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}><div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>DRIVER</div><div style={{ fontSize: 13, fontWeight: 600 }}>{item.driver_name}</div></div>}
                            {item.truck_plate && <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}><div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>TRUCK</div><div style={{ fontSize: 13, fontWeight: 600 }}>{item.truck_plate}</div></div>}
                            {item.dumpsite_name && <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}><div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>DUMPSITE</div><div style={{ fontSize: 13, fontWeight: 600 }}>{item.dumpsite_name}</div></div>}
                            <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}><div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>FREQUENCY</div><div style={{ fontSize: 13, fontWeight: 600 }}>{item.days || item.frequency || '—'}</div></div>
                          </div>

                          {/* Waypoints as route stops */}
                          {Array.isArray(item.waypoints) && item.waypoints.length > 0 && (
                            <>
                              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '.05em' }}>ROUTE STOPS</div>
                              <div style={{ position: 'relative', paddingLeft: 8 }}>
                                {item.waypoints.map((wp, i) => {
                                  const label = typeof wp === 'string' ? wp : wp?.label || wp?.address || `Stop ${i + 1}`
                                  const isFirst = i === 0, isLast = i === item.waypoints.length - 1
                                  return (
                                    <div key={i} className="stop-item" style={{ position: 'relative', paddingLeft: 24, paddingBottom: isLast ? 0 : 20 }}>
                                      <div className="stop-line" />
                                      <div style={{ position: 'absolute', left: 8, top: 4, width: 8, height: 8, borderRadius: '50%', background: isFirst || isLast ? '#5dade2' : 'var(--surface)', border: `2px solid ${isFirst || isLast ? '#5dade2' : '#888'}`, zIndex: 2 }} />
                                      <div style={{ fontSize: 13, fontWeight: isFirst || isLast ? 700 : 500 }}>
                                        {label}
                                        {isFirst && <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 500 }}> (Start)</span>}
                                        {isLast  && <span style={{ color: '#e74c3c', fontSize: 11, fontWeight: 500 }}> (End)</span>}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
