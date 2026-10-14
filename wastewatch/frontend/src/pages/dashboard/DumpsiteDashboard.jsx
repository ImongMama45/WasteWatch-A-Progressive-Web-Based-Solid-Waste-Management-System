import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import LiveTrackerCard from '../../components/analytics/LiveTrackerCard'
import TrucksOverlay from '../dumpsite/components/TrucksOverlay'
import ArrivalLogger from '../dumpsite/ArrivalLogger'

const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75, style = {}, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, display: 'block', ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const IcoTruck = p => <Ico {...p} d={["M1 3h15v13H1z", "M16 8h4l3 3v5h-7V8z", "M5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"]} />;
const IcoAlert = p => <Ico {...p} d={["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"]} />;
const IcoHourglass = p => <Ico {...p} d={["M12 2v20", "M8 2h8", "M8 22h8", "M10 6l4 12", "M14 6l-4 12"]} />;
const IcoScale = p => <Ico {...p} d={["M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z", "M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z", "M7 21h10", "M12 3v18", "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"]} />;
const IcoHome = p => <Ico {...p} d={["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"]} />;
const IcoAddBox = p => <Ico {...p} d={["M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z", "M12 8v8", "M8 12h8"]} />;
const IcoRadar = p => <Ico {...p} d={["M12 12v.01", "M16.24 7.76a6 6 0 0 1 0 8.49", "M7.76 7.76a6 6 0 0 0 0 8.49", "M19.07 4.93a10 10 0 0 1 0 14.14", "M4.93 4.93a10 10 0 0 0 0 14.14"]} />;
const IcoListAlt = p => <Ico {...p} d={["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"]} />;
const IcoTrash = p => <Ico {...p} d={["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M10 11v6", "M14 11v6"]} />;

const FILL_LABEL = {
  nearly_empty: { label: 'Nearly Empty', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  quarter: { label: 'Quarter', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  half: { label: 'Half', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  three_quarters: { label: 'Three Quarters', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  full: { label: 'Full', color: '#a16207', bg: 'rgba(161,98,7,0.12)' },
  overflowing: { label: 'Overflowing', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
}

function FillBadge({ level }) {
  const f = FILL_LABEL[level]
  if (!f) return null
  return (
    <span style={{
      background: f.bg, color: f.color, border: `1px solid ${f.color}44`,
      borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700,
    }}>{f.label}</span>
  )
}

function ArcGauge({ percent }) {
  const clamped = Math.min(percent, 120)
  const radius = 64
  const stroke = 12
  const circumference = Math.PI * radius   // half circle
  const filled = (clamped / 120) * circumference
  const color = clamped >= 95 ? '#ef4444' : clamped >= 80 ? '#f59e0b' : '#22c55e'

  return (
    <div style={{ position: 'relative', width: 160, height: 90, margin: '0 auto' }}>
      <svg width="160" height="95" viewBox="0 0 160 95">
        <path
          d={`M 16 80 A ${radius} ${radius} 0 0 1 144 80`}
          fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={stroke} strokeLinecap="round"
        />
        <path
          d={`M 16 80 A ${radius} ${radius} 0 0 1 144 80`}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s' }}
        />
      </svg>
      <div style={{
        position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        textAlign: 'center', lineHeight: 1,
      }}>
        <div style={{ fontSize: 28, fontWeight: 900, color, letterSpacing: '-1px' }}>{Math.round(percent)}%</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>Site Fill</div>
      </div>
    </div>
  )
}

export default function DumpsiteDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [siteId, setSiteId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [incomingTrucks, setIncomingTrucks] = useState([])
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('radar_dismissed') || '[]')
    } catch {
      return []
    }
  })
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [logTruckId, setLogTruckId] = useState('')

  useEffect(() => {
    sessionStorage.setItem('radar_dismissed', JSON.stringify(dismissed))
  }, [dismissed])

  useEffect(() => {
    // Resolve the dumpsite ID for this operator
    api.get('/api/dumpsite/dumpsites/')
      .then(res => {
        const sites = res.data
        if (sites.length > 0) {
          setSiteId(sites[0].id)
        } else {
          setError('No dumpsite assigned to your account.')
          setLoading(false)
        }
      })
      .catch(() => { setError('Failed to load dumpsite.'); setLoading(false) })
  }, [])

  useEffect(() => {
    if (!siteId) return
    api.get(`/api/dumpsite/dumpsites/${siteId}/dashboard/`)
      .then(res => { setData(res.data); setLoading(false) })
      .catch(() => { setError('Failed to load dashboard data.'); setLoading(false) })

    const fetchRadar = () => {
      if (document.hidden) return
      api.get(`/api/dumpsite/dumpsites/${siteId}/inbound_queue/`).then(res => {
        if (res.data) {
          const radar = res.data
          // Prune dismissals for shifts no longer in the radar
          setDismissed(prev => prev.filter(id => radar.some(r => r.shift_id === id)))

          // Map to LiveTrackerCard format
          const trucks = radar.map(t => ({
            shift_id: t.shift_id,
            schedule_id: t.schedule_id || t.shift_id, // fallback for key
            state: 'unloading',
            truck: { id: t.truck_id, plate: t.truck_plate, capacity: t.truck_max_capacity_kg },
            driver_name: t.driver,
            op_status: t.op_status,
            eta_min: t.eta_min,
            eta_max: t.eta_max,
            fix_age_s: t.last_fix ? Math.floor((Date.now() - new Date(t.last_fix).getTime()) / 1000) : null,
            is_stale: t.last_fix ? (Math.floor((Date.now() - new Date(t.last_fix).getTime()) / 1000) > 180) : false
          }))
          setIncomingTrucks(trucks)
        }
      }).catch(err => {
        console.error('Radar poll error:', err)
        // Optionally set a small local error state here if needed
      })
    }

    fetchRadar()
    const interval = setInterval(fetchRadar, 15000) // Poll every 15s
    return () => clearInterval(interval)
  }, [siteId])

  const visibleTrucks = incomingTrucks.filter(t => !dismissed.includes(t.shift_id))

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <IcoHourglass size={32} style={{ marginBottom: 12, animation: 'spin 1.5s linear infinite', margin: '0 auto' }} />
        <p style={{ fontWeight: 600 }}>Loading Command Center...</p>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>
      <IcoAlert size={40} style={{ marginBottom: 12, margin: '0 auto' }} />
      <p style={{ fontWeight: 700 }}>{error}</p>
    </div>
  )

  const kpis = [
    { label: 'KG Received Today', value: `${data.today_kg.toLocaleString()} kg`, color: '#22c55e', icon: <IcoScale size={24} /> },
    { label: 'Trucks Processed', value: data.trucks_today, color: '#3b82f6', icon: <IcoTruck size={24} /> },
    { label: 'Barangays Covered', value: data.barangays_today, color: '#a855f7', icon: <IcoHome size={24} /> },
  ]

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--surface-3)', marginBottom: 4 }}>
          Dumpsite Command Center
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
          Active Facility: <strong style={{ color: 'var(--accent)' }}>{data.site_name}</strong>
        </p>
      </header>

      {/* Top row: Gauge + KPIs + CTA */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: '1.5rem', marginBottom: '1.5rem', alignItems: 'stretch' }}>
        {/* Fill Gauge */}
        <div className="card-light" style={{ padding: '1.5rem', borderRadius: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
            Site Capacity
          </div>
          <ArcGauge percent={data.fill_percent} />
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
            {data.current_fill_kg.toLocaleString()} / {data.max_capacity_kg.toLocaleString()} kg
          </div>
        </div>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          {kpis.map((k, i) => (
            <div key={i} className="card-light" style={{
              padding: '0.85rem 1.25rem', borderRadius: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.label}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, color: k.color, lineHeight: 1.2, marginTop: 2 }}>{k.value}</div>
              </div>
              <span style={{ fontSize: 26, opacity: 0.6 }}>{k.icon}</span>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', justifyContent: 'center' }}>
          <button
            onClick={() => setLogOpen(true)}
            style={{
              background: 'var(--accent)', color: '#0d1117', border: 'none',
              borderRadius: 18, padding: '1rem 1.5rem', fontWeight: 800,
              fontSize: '0.95rem', cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: '0 8px 24px rgba(46,204,113,0.35)',
              transition: 'transform 0.15s, box-shadow 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 30px rgba(46,204,113,0.45)' }}
            onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 8px 24px rgba(46,204,113,0.35)' }}
          >
            <IcoAddBox size={18} sw={2.5} /> Log Arrival
          </button>
          <button
            onClick={() => navigate('/dumpsite/queue')}
            style={{
              background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: 18, padding: '1rem 1.5rem', fontWeight: 700,
              fontSize: '0.9rem', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            <IcoRadar size={18} sw={2} /> Truck Queue
          </button>
          <button
            onClick={() => navigate('/dumpsite/logs')}
            style={{
              background: 'rgba(148,163,184,0.07)', color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 18, padding: '0.85rem 1.5rem', fontWeight: 600,
              fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            <IcoListAlt size={18} sw={2} /> Collection Logs
          </button>
          <button
            onClick={() => setOverlayOpen(true)}
            style={{
              background: 'transparent', color: 'var(--surface-3)',
              border: '1px solid var(--border)',
              borderRadius: 18, padding: '0.85rem 1.5rem', fontWeight: 600,
              fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            <IcoTruck size={18} sw={2} /> Assigned Trucks
          </button>
        </div>
      </div>

      {/* Incoming Trucks Radar */}
      {visibleTrucks.length > 0 && (
        <div className="card-light" style={{ padding: '1.5rem', borderRadius: 24, marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem' }}>Incoming Trucks (Radar)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
            {visibleTrucks.map(t => (
              <div key={t.shift_id} style={{ position: 'relative' }}>
                <LiveTrackerCard 
                  truck={t} 
                  variant="operator" 
                  onLogArrival={(id) => { setLogTruckId(id); setLogOpen(true); }}
                />
                <button
                  onClick={() => setDismissed(prev => [...prev, t.shift_id])}
                  style={{
                    position: 'absolute', top: 12, right: 12,
                    background: 'var(--bg)', color: 'var(--text-muted)',
                    border: '1px solid var(--border)', borderRadius: '50%',
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: 16, lineHeight: 1, zIndex: 10
                  }}
                  title="Dismiss from radar until next trip"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Deliveries */}
      <div className="card-light" style={{ padding: '1.5rem', borderRadius: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800 }}>Recent Activity</h2>
          <button
            onClick={() => navigate('/dumpsite/logs')}
            style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}
          >View All →</button>
        </div>
        {data.recent_deliveries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: 16 }}>
            <IcoTrash size={40} style={{ marginBottom: 8, opacity: 0.5, margin: '0 auto' }} />
            <p style={{ fontWeight: 600 }}>No deliveries logged yet today</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {data.recent_deliveries.map(d => (
              <div key={d.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.9rem 1rem', background: 'var(--surface-1)', borderRadius: 14,
                border: '1px solid var(--border)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', color: '#3b82f6', background: 'rgba(59,130,246,0.1)', padding: 8, borderRadius: 12 }}>
                    <IcoTruck size={24} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{d.truck}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {d.driver} {d.barangay ? `· ${d.barangay}` : ''} {d.time ? `· ${d.time}` : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FillBadge level={d.fill_level} />
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '0.95rem' }}>{d.estimated_kg.toLocaleString()} kg</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TrucksOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} siteId={siteId} />
      <ArrivalLogger 
        open={logOpen} 
        onClose={(refresh) => {
          setLogOpen(false)
          setLogTruckId('')
          if (refresh && siteId) {
            api.get(`/api/dumpsite/dumpsites/${siteId}/dashboard/`)
              .then(res => setData(res.data))
              .catch(console.error)
          }
        }} 
        defaultTruckId={logTruckId}
      />
    </div>
  )
}
