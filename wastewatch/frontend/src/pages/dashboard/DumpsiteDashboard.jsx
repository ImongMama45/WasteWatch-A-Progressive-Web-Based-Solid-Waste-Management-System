import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'

const FILL_LABEL = {
  nearly_empty:   { label: 'Nearly Empty', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  quarter:        { label: 'Quarter',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  half:           { label: 'Half',          color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  three_quarters: { label: 'Three Quarters',color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  full:           { label: 'Full',          color: '#a16207', bg: 'rgba(161,98,7,0.12)' },
  overflowing:    { label: 'Overflowing',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
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
  const radius  = 64
  const stroke  = 12
  const circumference = Math.PI * radius   // half circle
  const filled = (clamped / 120) * circumference
  const color   = clamped >= 95 ? '#ef4444' : clamped >= 80 ? '#f59e0b' : '#22c55e'

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
  const { user }    = useAuth()
  const navigate    = useNavigate()
  const [data, setData]       = useState(null)
  const [siteId, setSiteId]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

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
  }, [siteId])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 32, marginBottom: 12, animation: 'spin 1.5s linear infinite' }}>⏳</div>
        <p style={{ fontWeight: 600 }}>Loading Command Center...</p>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
      <p style={{ fontWeight: 700 }}>{error}</p>
    </div>
  )

  const kpis = [
    { label: 'KG Received Today', value: `${data.today_kg.toLocaleString()} kg`, color: '#22c55e', icon: '⚖️' },
    { label: 'Trucks Processed',  value: data.trucks_today,                       color: '#3b82f6', icon: '🚛' },
    { label: 'Barangays Covered', value: data.barangays_today,                    color: '#a855f7', icon: '🏘️' },
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
            onClick={() => navigate('/dumpsite/log-arrival')}
            style={{
              background: 'var(--accent)', color: '#0d1117', border: 'none',
              borderRadius: 18, padding: '1rem 1.5rem', fontWeight: 800,
              fontSize: '0.95rem', cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: '0 8px 24px rgba(46,204,113,0.35)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 30px rgba(46,204,113,0.45)' }}
            onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 8px 24px rgba(46,204,113,0.35)' }}
          >
            🚛 Log Arrival
          </button>
          <button
            onClick={() => navigate('/dumpsite/queue')}
            style={{
              background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
              border: '1px solid rgba(59,130,246,0.3)',
              borderRadius: 18, padding: '1rem 1.5rem', fontWeight: 700,
              fontSize: '0.9rem', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            📡 Truck Queue
          </button>
          <button
            onClick={() => navigate('/dumpsite/logs')}
            style={{
              background: 'rgba(148,163,184,0.07)', color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 18, padding: '0.85rem 1.5rem', fontWeight: 600,
              fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            📋 Collection Logs
          </button>
        </div>
      </div>

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
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗑️</div>
            <p style={{ fontWeight: 600 }}>No deliveries logged yet today</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {data.recent_deliveries.map(d => (
              <div key={d.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.9rem 1rem', background: 'var(--surface-1)', borderRadius: 14,
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20 }}>🚛</span>
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
    </div>
  )
}
