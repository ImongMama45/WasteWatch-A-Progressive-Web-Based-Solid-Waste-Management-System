import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import LiveTrackerCard from '../../components/analytics/LiveTrackerCard'
import TrucksOverlay from '../dumpsite/components/TrucksOverlay'
import ArrivalLogger from '../dumpsite/ArrivalLogger'
import {
  Skeleton,
  ChartSkeleton,
  StatCardSkeleton,
  LiveTrackerSkeleton,
  FeedCardSkeleton,
} from '../../components/ui/Skeleton'

const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75, style = {}, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, display: 'block', ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const IcoTruck = p => <Ico {...p} d={["M1 3h15v13H1z", "M16 8h4l3 3v5h-7V8z", "M5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"]} />;
const IcoAlert = p => <Ico {...p} d={["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"]} />;
const IcoScale = p => <Ico {...p} d={["M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z", "M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z", "M7 21h10", "M12 3v18", "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"]} />;
const IcoHome = p => <Ico {...p} d={["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"]} />;
const IcoAddBox = p => <Ico {...p} d={["M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z", "M12 8v8", "M8 12h8"]} />;
const IcoRadar = p => <Ico {...p} d={["M12 12v.01", "M16.24 7.76a6 6 0 0 1 0 8.49", "M7.76 7.76a6 6 0 0 0 0 8.49", "M19.07 4.93a10 10 0 0 1 0 14.14", "M4.93 4.93a10 10 0 0 0 0 14.14"]} />;
const IcoListAlt = p => <Ico {...p} d={["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"]} />;
const IcoTrash = p => <Ico {...p} d={["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M10 11v6", "M14 11v6"]} />;

const FILL_LABEL = {
  nearly_empty: { label: 'Nearly Empty', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  quarter: { label: 'Quarter', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  half: { label: 'Half', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  three_quarters: { label: 'Three Quarters', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  full: { label: 'Full', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  overflowing: { label: 'Overflowing', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
}

function FillBadge({ level }) {
  const f = FILL_LABEL[level]
  if (!f) return null
  return (
    <span style={{
      background: f.bg, color: f.color, border: `1px solid ${f.border}`,
      borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em'
    }}>{f.label}</span>
  )
}

function ArcGauge({ percent }) {
  const clamped = Math.min(percent, 120)
  const radius = 64
  const stroke = 12
  const circumference = Math.PI * radius   // half circle
  const filled = (clamped / 120) * circumference
  const color = clamped >= 95 ? '#dc2626' : clamped >= 80 ? '#d97706' : '#16a34a'

  return (
    <div style={{ position: 'relative', width: 160, height: 90, margin: '0 auto' }}>
      <svg width="160" height="95" viewBox="0 0 160 95">
        <path
          d={`M 16 80 A ${radius} ${radius} 0 0 1 144 80`}
          fill="none" stroke="#e4e6eb" strokeWidth={stroke} strokeLinecap="round"
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
        <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{Math.round(percent)}%</div>
        <div style={{ fontSize: 10, color: '#65676b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 3 }}>Site Fill</div>
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
  const [radarError, setRadarError] = useState(false)
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
        setRadarError(false)
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
        setRadarError(true)
      })
    }

    fetchRadar()
    const interval = setInterval(fetchRadar, 15000) // Poll every 15s
    return () => clearInterval(interval)
  }, [siteId])

  const visibleTrucks = incomingTrucks.filter(t => !dismissed.includes(t.shift_id))

  if (loading) return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px' }}>
      <style>{`
        @media (max-width: 900px) {
          .dd-cmd-top-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={{ maxWidth: 1440, margin: '0 auto' }}>
        <header style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1c1e21', margin: 0, fontFamily: 'var(--font-head)', letterSpacing: '-0.02em' }}>
              Dumpsite Command Center
            </h1>
            <span style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '.05em' }}>
              OPERATOR
            </span>
          </div>
          <Skeleton width={210} height={14} radius={4} />
        </header>

        {/* 3-col top grid: Gauge + 3 KPIs + Quick Actions */}
        <div className="dd-cmd-top-grid" style={{ display: 'grid', gridTemplateColumns: '240px 1fr 200px', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
          <ChartSkeleton variant="gauge" height={150} />
          <StatCardSkeleton count={3} style={{ gridTemplateColumns: '1fr', gap: 10 }} />
          <div className="ww-sk-surface" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            <Skeleton height={36} radius={6} />
            <Skeleton height={36} radius={6} />
            <Skeleton height={36} radius={6} />
            <Skeleton height={36} radius={6} />
          </div>
        </div>

        {/* Incoming Trucks Radar skeleton */}
        <LiveTrackerSkeleton style={{ marginBottom: 16 }} />

        {/* Recent Activity skeleton */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Skeleton width={120} height={14} radius={4} />
            <Skeleton width={64} height={12} radius={4} />
          </div>
          <FeedCardSkeleton count={3} compact />
        </div>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#dc2626', background: '#f0f2f5', minHeight: '100vh' }}>
      <IcoAlert size={36} color="#dc2626" style={{ marginBottom: 12, margin: '0 auto' }} />
      <p style={{ fontWeight: 700, fontSize: 14 }}>{error}</p>
    </div>
  )

  const kpis = [
    { label: 'KG Received Today', value: `${data.today_kg.toLocaleString()} kg`, color: '#16a34a', icon: <IcoScale size={20} color="#16a34a" /> },
    { label: 'Trucks Processed', value: data.trucks_today, color: '#1877f2', icon: <IcoTruck size={20} color="#1877f2" /> },
    { label: 'Barangays Covered', value: data.barangays_today, color: '#7c3aed', icon: <IcoHome size={20} color="#7c3aed" /> },
  ]

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px' }}>
      <div className="ww-fade-in" style={{ maxWidth: 1440, margin: '0 auto' }}>

        {/* Header */}
        <header style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1c1e21', margin: 0, fontFamily: 'var(--font-head)', letterSpacing: '-0.02em' }}>
              Dumpsite Command Center
            </h1>
            <span style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '.05em' }}>
              OPERATOR
            </span>
          </div>
          <p style={{ color: '#65676b', fontSize: 13, margin: 0 }}>
            Active Facility: <strong style={{ color: '#16a34a' }}>{data.site_name}</strong>
          </p>
        </header>

        {/* Top row: Gauge + KPIs + CTA */}
        <div className="ww-stagger" style={{ display: 'grid', gridTemplateColumns: '240px 1fr 200px', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
          {/* Fill Gauge */}
          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8, padding: '16px 20px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', marginBottom: 12, letterSpacing: '.05em', textTransform: 'uppercase' }}>
              Site Capacity
            </div>
            <ArcGauge percent={data.fill_percent} />
            <div style={{ marginTop: 12, fontSize: 11, color: '#65676b', fontWeight: 600 }}>
              {data.current_fill_kg.toLocaleString()} / {data.max_capacity_kg.toLocaleString()} kg
            </div>
          </div>

          {/* KPI Cards */}
          <div className="ww-stagger" style={{ display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gap: 10 }}>
            {kpis.map((k, i) => (
              <div key={i} style={{
                background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8,
                padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1.2, marginTop: 2 }}>{k.value}</div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {k.icon}
                </div>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => setLogOpen(true)}
              style={{
                background: '#16a34a', color: '#ffffff', border: 'none',
                borderRadius: 6, height: 36, fontWeight: 600,
                fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'background 0.14s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
              }}
              onMouseOver={e => e.currentTarget.style.background = '#15803d'}
              onMouseOut={e => e.currentTarget.style.background = '#16a34a'}
            >
              <IcoAddBox size={16} sw={2} /> Log Arrival
            </button>
            <button
              onClick={() => navigate('/dumpsite/queue')}
              style={{
                background: '#ffffff', color: '#1c1e21',
                border: '1px solid #ced0d4',
                borderRadius: 6, height: 36, fontWeight: 600,
                fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'background 0.14s'
              }}
              onMouseOver={e => e.currentTarget.style.background = '#f0f2f5'}
              onMouseOut={e => e.currentTarget.style.background = '#ffffff'}
            >
              <IcoRadar size={16} sw={2} color="#1877f2" /> Truck Queue
            </button>
            <button
              onClick={() => navigate('/dumpsite/logs')}
              style={{
                background: '#ffffff', color: '#1c1e21',
                border: '1px solid #ced0d4',
                borderRadius: 6, height: 36, fontWeight: 600,
                fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'background 0.14s'
              }}
              onMouseOver={e => e.currentTarget.style.background = '#f0f2f5'}
              onMouseOut={e => e.currentTarget.style.background = '#ffffff'}
            >
              <IcoListAlt size={16} sw={2} color="#65676b" /> Collection Logs
            </button>
            <button
              onClick={() => setOverlayOpen(true)}
              style={{
                background: '#ffffff', color: '#1c1e21',
                border: '1px solid #ced0d4',
                borderRadius: 6, height: 36, fontWeight: 600,
                fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'background 0.14s'
              }}
              onMouseOver={e => e.currentTarget.style.background = '#f0f2f5'}
              onMouseOut={e => e.currentTarget.style.background = '#ffffff'}
            >
              <IcoTruck size={16} sw={2} color="#65676b" /> Assigned Trucks
            </button>
          </div>
        </div>

        {/* Incoming Trucks Radar */}
        {radarError && (
          <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 16, border: '1px solid #fecaca', background: '#fef2f2' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626' }}>
              <IcoAlert size={18} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Unable to update incoming truck radar. Retrying...</span>
            </div>
          </div>
        )}
        {!radarError && visibleTrucks.length > 0 && (
          <div className="ww-fade-in" style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8, padding: 18, marginBottom: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1c1e21', margin: '0 0 14px' }}>Incoming Trucks (Radar)</h2>
            <div className="ww-stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
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
                      position: 'absolute', top: 10, right: 10,
                      background: '#ffffff', color: '#65676b',
                      border: '1px solid #ced0d4', borderRadius: '50%',
                      width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', fontSize: 14, lineHeight: 1, zIndex: 10
                    }}
                    title="Dismiss from radar until next trip"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Deliveries */}
        <div className="ww-fade-in" style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 8, padding: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1c1e21', margin: 0 }}>Recent Activity</h2>
            <button
              onClick={() => navigate('/dumpsite/logs')}
              style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}
            >View All →</button>
          </div>
          {data.recent_deliveries.length === 0 ? (
            <div className="ww-fade-in" style={{ textAlign: 'center', padding: '32px 16px', color: '#65676b', border: '1px dashed #ced0d4', borderRadius: 6 }}>
              <IcoTrash size={32} color="#8a8d91" style={{ marginBottom: 8, margin: '0 auto' }} />
              <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>No deliveries logged yet today</p>
            </div>
          ) : (
            <div className="ww-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.recent_deliveries.map(d => (
                <div key={d.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', background: '#f8fafc', borderRadius: 6,
                  border: '1px solid #e2e8f0',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', color: '#1877f2', background: '#e7f3ff', padding: 6, borderRadius: 6 }}>
                      <IcoTruck size={18} />
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21' }}>{d.truck}</div>
                      <div style={{ fontSize: 11, color: '#65676b' }}>
                        {d.driver} {d.barangay ? `· ${d.barangay}` : ''} {d.time ? `· ${d.time}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FillBadge level={d.fill_level} />
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: '#16a34a', fontSize: 13 }}>{d.estimated_kg.toLocaleString()} kg</div>
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
    </div>
  )
}
