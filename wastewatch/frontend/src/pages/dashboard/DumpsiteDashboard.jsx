import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'

/**
 * DumpsiteDashboard.jsx — Command center for Dumpsite Operators
 * Route: /dashboard (when role='dumpsite')
 */
export default function DumpsiteDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState({ capacity: 65, inbound: 0, loggedToday: 12 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate API fetch for dashboard data
    const timer = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(timer)
  }, [])

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '60vh',
        color: 'var(--text-muted)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div className="msi" style={{ fontSize: '2rem', marginBottom: 12, animation: 'spin 2s linear infinite' }}>sync</div>
          <p style={{ fontWeight: 600 }}>Loading Commander Console...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--surface-3)', letterSpacing: '-0.02em' }}>
          Dumpsite Command Center
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span className="msi" style={{ color: 'var(--accent)', fontSize: 18 }}>location_on</span>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            Active Facility: <strong style={{ color: 'var(--surface-3)' }}>{user?.dumpsite_name || 'Lucena Central Landfill'}</strong>
          </p>
        </div>
      </header>

      {/* Key Metrics */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
        gap: '1.25rem',
        marginBottom: '2rem'
      }}>
        {[
          { label: 'Current Capacity', value: `${stats.capacity}%`, color: '#3b82f6', icon: 'battery_horiz_075' },
          { label: 'Inbound Trucks', value: stats.inbound, color: '#f59e0b', icon: 'local_shipping' },
          { label: 'Disposals (Today)', value: stats.loggedToday, color: '#10b981', icon: 'assignment' },
        ].map((s, i) => (
          <div key={i} className="card-light" style={{ padding: '1.5rem', borderRadius: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>{s.label}</div>
              <span className="msi" style={{ color: s.color, fontSize: 20, opacity: 0.8 }}>{s.icon}</span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--surface-3)', lineHeight: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {/* Inbound Queue */}
        <div className="card-light" style={{ padding: '1.5rem', borderRadius: 24 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="msi" style={{ color: 'var(--accent)', padding: 8, background: 'rgba(46,204,113,0.1)', borderRadius: 10 }}>radar</span> 
            Live Inbound Queue
          </h2>
          <div style={{ 
            textAlign: 'center', 
            padding: '3rem 1.5rem', 
            color: 'var(--text-muted)', 
            border: '2px dashed #e2e8f0', 
            borderRadius: 16,
            background: '#f8fafc'
          }}>
            <div className="msi" style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.3 }}>vibration_off</div>
            <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>No trucks detected</p>
            <p style={{ fontSize: '0.8rem', marginTop: 4 }}>Live tracking will appear here when trucks are within 5km.</p>
          </div>
        </div>

        {/* Recent Disposals */}
        <div className="card-light" style={{ padding: '1.5rem', borderRadius: 24 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="msi" style={{ color: 'var(--info)', padding: 8, background: 'rgba(93,173,226,0.1)', borderRadius: 10 }}>history</span> 
            Recent Activity
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {[
              { truck: 'T-042', time: '10:45 AM', type: 'Residential', weight: '2.8t' },
              { truck: 'T-015', time: '09:20 AM', type: 'Commercial', weight: '3.5t' },
              { truck: 'T-008', time: '08:15 AM', type: 'Residential', weight: '2.1t' },
            ].map((log, i) => (
              <div key={i} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '1rem', 
                background: '#f8fafc', 
                borderRadius: 14,
                border: '1px solid #f1f5f9'
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--surface-3)' }}>{log.truck}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {log.time} • {log.type}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '1rem' }}>{log.weight}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Logged</div>
                </div>
              </div>
            ))}
            <button style={{ 
              marginTop: 8,
              padding: '0.75rem',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 12,
              color: 'var(--surface-3)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}>
              View All Logs
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
