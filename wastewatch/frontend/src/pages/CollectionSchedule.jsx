import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import DashboardLayout from '../components/DashboardLayout'
import Navbar from '../components/Navbar'
import BottomNav from '../components/BottomNav'

// Mock Data
const ROUTES_BY_BRGY = {
  'Cotta': [
    { id: 1, day: 'Monday', time: '06:00 AM – 10:00 AM', routeName: 'Cotta Main Road & Market', truck: 'Isuzu Elf (T-01)', isToday: true, driver: 'Juan Dela Cruz', active: true, stops: ['City Hall', 'Cotta Market', 'Cotta Pier', 'Purok 1', 'Main Landfill'] },
    { id: 2, day: 'Thursday', time: '06:00 AM – 10:00 AM', routeName: 'Cotta Riverside & Inner Streets', truck: 'Isuzu Elf (T-01)', isToday: false, driver: 'Juan Dela Cruz', active: false, stops: ['City Hall', 'Riverside', 'Purok 2', 'Purok 3', 'Main Landfill'] }
  ],
  'Gulang-Gulang': [
    { id: 3, day: 'Tuesday', time: '07:00 AM – 11:00 AM', routeName: 'Gulang-Gulang Highway', truck: 'Hino 300 (T-02)', isToday: false, driver: 'Ana Mendoza', active: false, stops: ['City Hall', 'Highway', 'Purok 4', 'Main Landfill'] },
    { id: 4, day: 'Friday', time: '07:00 AM – 11:00 AM', routeName: 'Gulang-Gulang Residential', truck: 'Hino 300 (T-02)', isToday: false, driver: 'Ana Mendoza', active: false, stops: ['City Hall', 'Subdivision A', 'Subdivision B', 'Main Landfill'] }
  ]
}

// Fallback for other barangays
const FALLBACK_SCHEDULE = [
  { id: 5, day: 'Wednesday', time: '08:00 AM – 12:00 PM', routeName: 'Main Zone', truck: 'Mitsubishi Canter (T-04)', isToday: false, driver: 'Jose Bautista', active: false, stops: ['City Hall', 'Zone Center', 'Main Landfill'] }
]

export default function CollectionSchedule() {
  const { user } = useAuth()
  const role = user?.role?.toLowerCase() || 'citizen'
  const barangay = user?.barangay || 'Cotta'

  const [expandedId, setExpandedId] = useState(null)

  const schedule = ROUTES_BY_BRGY[barangay] || FALLBACK_SCHEDULE
  const todaySchedule = schedule.find(s => s.isToday)

  const showDetails = ['barangay_official', 'watcher', 'driver', 'admin'].includes(role)
  const isDriver = role === 'driver'  

  // Add this import at the top with your other useState import
  // useState is already imported, just add this helper:

  // ── Add this inside the component, after the existing state declarations ──────
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

  const today = new Date()
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [calYear,  setCalYear]  = useState(today.getFullYear())

  // Days that have collection for this barangay
  const collectionDays = schedule.map(s => s.day) // e.g. ['Monday', 'Thursday']
  const DAY_NAME_TO_NUM = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 }
  const collectionDayNums = collectionDays.map(d => DAY_NAME_TO_NUM[d])

  // Build calendar grid
  function buildCalendar(month, year) {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < firstDay; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    return cells
  }
  const cells = buildCalendar(calMonth, calYear)

  return (
    <div>
      <Navbar/>
      <style>{`
        .sched-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px; margin-bottom: 16px; box-shadow: 0 4px 12px rgba(0,0,0,.03); transition: all 0.2s; }
        .sched-card.interactive:hover { border-color: var(--accent); cursor: pointer; }
        .sched-day-badge { background: rgba(46,204,113,0.1); color: #2ecc71; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; border: 1px solid rgba(46,204,113,0.3); }
        .status-badge { display: inline-flex; alignItems: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; }
        .status-badge.active { background: rgba(46,204,113,0.15); color: #2ecc71; border: 1px solid rgba(46,204,113,0.3); }
        .status-badge.inactive { background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border); }
        .stop-line { position: absolute; left: 11px; top: 24px; bottom: -8px; width: 2px; background: var(--border); }
        .stop-item:last-child .stop-line { display: none; }
      `}</style>

      <div className="page" style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* 1. Header Section */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, margin: 0 }}>Collection Schedule</h2>
            <span style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>BRGY. {barangay.toUpperCase()}</span>
          </div>
          <p className="text-muted text-sm">View garbage collection schedules and routes for your area.</p>
        </div>

        

        {/* ── Mini Calendar ── */}
        <div className="sched-card" style={{ marginBottom: 16, padding: '16px 20px' }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <button
              onClick={() => {
                if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
                else setCalMonth(m => m - 1)
              }}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >‹</button>

            <span style={{ fontWeight: 800, fontSize: 14, fontFamily: 'var(--font-head)' }}>
              {MONTHS[calMonth]} {calYear}
            </span>

            <button
              onClick={() => {
                if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
                else setCalMonth(m => m + 1)
              }}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', padding: '2px 0', letterSpacing: '0.04em' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Date cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {cells.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} />

              const cellDate   = new Date(calYear, calMonth, day)
              const dayOfWeek  = cellDate.getDay()
              const isToday    = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()
              const hasPickup  = collectionDayNums.includes(dayOfWeek)
              const isPast     = cellDate < new Date(today.getFullYear(), today.getMonth(), today.getDate())

              return (
                <div
                  key={day}
                  style={{
                    textAlign:      'center',
                    padding:        '6px 2px',
                    borderRadius:   8,
                    fontSize:       12,
                    fontWeight:     isToday ? 800 : hasPickup ? 700 : 400,
                    position:       'relative',
                    background:     isToday
                      ? '#2ecc71'
                      : hasPickup
                        ? 'rgba(46,204,113,0.1)'
                        : 'transparent',
                    color:          isToday
                      ? '#0d1117'
                      : hasPickup
                        ? '#2ecc71'
                        : isPast
                          ? 'var(--text-muted)'
                          : 'var(--text)',
                    border:         hasPickup && !isToday
                      ? '1px solid rgba(46,204,113,0.3)'
                      : '1px solid transparent',
                    opacity:        isPast && !isToday ? 0.5 : 1,
                  }}
                >
                  {day}
                  {/* Small dot for pickup days */}
                  {hasPickup && !isToday && (
                    <div style={{
                      width: 4, height: 4, borderRadius: '50%',
                      background: '#2ecc71',
                      margin: '2px auto 0',
                    }} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2ecc71' }} />
              Today
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.4)' }} />
              Collection Day
            </div>
          </div>
        </div>

        {/* 2. Today's Schedule (Priority Section) */}

        {/* 2. Today's Schedule (Priority Section) */}
        <div className="sched-card" style={{ border: todaySchedule ? '2px solid rgba(46,204,113,0.5)' : '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
          {todaySchedule && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: '#2ecc71' }} />}

          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
            Today's Schedule
          </h3>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div className={`status-badge ${todaySchedule ? 'active' : 'inactive'}`}>
              {todaySchedule ? 'Collection Today' : 'No Collection Today'}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Monday</div>
          </div>

          {todaySchedule ? (
            <div style={{ display: 'grid', gap: 12, background: 'var(--surface-2)', padding: 16, borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>TIME</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{todaySchedule.time}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>ROUTE</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{todaySchedule.routeName}</div>
                </div>
              </div>
              {showDetails && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>ASSIGNED TRUCK</div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{todaySchedule.truck} {isDriver && <span style={{ color: '#5dade2', fontSize: 12 }}>(You)</span>}</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              There is no garbage collection scheduled for your barangay today. Please check the weekly schedule below.
            </div>
          )}
        </div>

        {/* 3. Weekly Schedule View */}
        <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 800, margin: '24px 0 16px' }}>Weekly Schedule View</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {schedule.map(item => {
            const isExpanded = expandedId === item.id
            const canExpand = showDetails // only non-residents can expand to see full route details

            return (
              <div key={item.id} className={`sched-card ${canExpand ? 'interactive' : ''}`} style={{ margin: 0, padding: 0 }} onClick={() => canExpand && setExpandedId(isExpanded ? null : item.id)}>

                {/* Main Row */}
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: item.isToday ? 'rgba(46,204,113,0.1)' : 'var(--surface-2)', border: `1px solid ${item.isToday ? 'rgba(46,204,113,0.3)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: item.isToday ? '#2ecc71' : 'var(--text-muted)', textTransform: 'uppercase' }}>{item.day.slice(0, 3)}</div>
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{item.day}</span>
                      {item.isToday && <span className="sched-day-badge">Today</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>{item.time}</span>
                      <span>{item.routeName}</span>
                      {showDetails && <span>{item.truck}</span>}
                    </div>
                  </div>

                  {canExpand && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 18, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
                      ›
                    </div>
                  )}
                </div>

                {/* 4. Route Details (Expandable) */}
                {isExpanded && canExpand && (
                  <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 16 }}>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
                      <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>DRIVER</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.driver}</div>
                      </div>
                      <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>TRUCK</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.truck}</div>
                      </div>
                    </div>

                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, letterSpacing: '0.05em' }}>ROUTE STOPS</div>
                    <div style={{ position: 'relative', paddingLeft: 8 }}>
                      {item.stops.map((stop, i) => (
                        <div key={i} className="stop-item" style={{ position: 'relative', paddingLeft: 24, paddingBottom: i === item.stops.length - 1 ? 0 : 20 }}>
                          <div className="stop-line" />
                          <div style={{ position: 'absolute', left: 8, top: 4, width: 8, height: 8, borderRadius: '50%', background: i === 0 || i === item.stops.length - 1 ? '#5dade2' : 'var(--surface)', border: `2px solid ${i === 0 || i === item.stops.length - 1 ? '#5dade2' : '#888'}`, zIndex: 2 }} />
                          <div style={{ fontSize: 13, fontWeight: i === 0 || i === item.stops.length - 1 ? 700 : 500 }}>
                            {stop} {i === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 500 }}>(Start)</span>}
                            {i === item.stops.length - 1 && <span style={{ color: '#e74c3c', fontSize: 11, fontWeight: 500 }}>(Dumpsite)</span>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* 5. Map Preview Button */}
                    <button className="btn btn-outline" style={{ width: '100%', marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      View Route on Map
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>
      <BottomNav/>
    </div>
  
  )
}
