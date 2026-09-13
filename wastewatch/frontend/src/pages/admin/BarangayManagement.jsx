import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { ICONS } from '../../api/navConfig'
import DashboardLayout from '../../components/DashboardLayout'

export default function BarangayManagement() {
  const [barangays, setBarangays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Filters
  const [search, setSearch] = useState('')
  const [healthFilter, setHealthFilter] = useState('all') // 'all', 'critical', 'warning', 'healthy'

  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    api.get('/api/accounts/barangay-management/')
      .then(res => setBarangays(res.data))
      .catch(err => {
        console.error(err)
        setError('Failed to load barangays')
      })
      .finally(() => setLoading(false))
  }, [])

  const getHealthStatus = (brgy) => {
    if (brgy.open_escalations > 0 || brgy.has_unassigned_roles) return 'critical'
    if (brgy.pending_concerns > 5 || brgy.active_hotspots > 3) return 'warning'
    return 'healthy'
  }

  const filteredBarangays = useMemo(() => {
    return barangays.filter(brgy => {
      const matchesSearch = brgy.name.toLowerCase().includes(search.toLowerCase())
      if (!matchesSearch) return false
      if (healthFilter !== 'all' && getHealthStatus(brgy) !== healthFilter) return false
      return true
    })
  }, [barangays, search, healthFilter])

  // Summary Stats
  const stats = useMemo(() => {
    let critical = 0, warning = 0, healthy = 0
    barangays.forEach(b => {
      const h = getHealthStatus(b)
      if (h === 'critical') critical++
      else if (h === 'warning') warning++
      else healthy++
    })
    return { total: barangays.length, critical, warning, healthy }
  }, [barangays])

  return (
    <DashboardLayout>
      <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto', fontFamily: 'var(--font-sans, system-ui)' }}>
      {/* Header Area */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 8px 0', color: '#0F172A', letterSpacing: '-0.02em' }}>
            Barangay Operations
          </h1>
          <p style={{ margin: 0, color: '#64748B', fontSize: 14, fontWeight: 500 }}>
            Monitor zones, personnel assignments, and track active escalations.
          </p>
        </div>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 32 }}>
        <StatCard title="Total Barangays" value={stats.total} icon="🗺️" color="#3B82F6" bg="#EFF6FF" />
        <StatCard title="Healthy Zones" value={stats.healthy} icon="✅" color="#10B981" bg="#ECFDF5" />
        <StatCard title="Attention Needed" value={stats.warning} icon="⚠️" color="#F59E0B" bg="#FFFBEB" />
        <StatCard title="Critical Issues" value={stats.critical} icon="🚨" color="#EF4444" bg="#FEF2F2" />
      </div>

      {/* Toolbar */}
      <div style={{ 
        display: 'flex', gap: 16, marginBottom: 24, padding: 16, 
        background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.02)', alignItems: 'center'
      }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 14, top: 10, color: '#94A3B8' }}>{ICONS.search || '🔍'}</span>
          <input 
            type="text" 
            placeholder="Search barangay..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ 
              width: '100%', padding: '10px 16px 10px 42px', 
              borderRadius: 8, border: '1px solid #E2E8F0', 
              background: '#F8FAFC', fontSize: 14, outline: 'none'
            }} 
          />
        </div>
        
        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'critical', 'warning', 'healthy'].map(f => (
            <button
              key={f}
              onClick={() => setHealthFilter(f)}
              style={{
                padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                textTransform: 'capitalize', transition: 'all 0.2s',
                background: healthFilter === f ? '#0F172A' : '#F1F5F9',
                color: healthFilter === f ? '#FFF' : '#64748B',
                border: 'none'
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Data Table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 4px 24px rgba(0,0,0,0.03)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 900 }}>
            <thead style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              <tr>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Barangay Name</th>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Population</th>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personnel Assigned</th>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Concerns</th>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Hotspots</th>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Escalations</th>
                <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Health Status</th>
                <th style={{ padding: '16px 24px' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" style={{ padding: '60px', textAlign: 'center', color: '#94A3B8', fontWeight: 500 }}>Loading operations data...</td></tr>
              ) : error ? (
                <tr><td colSpan="8" style={{ padding: '60px', textAlign: 'center', color: '#EF4444', fontWeight: 500 }}>{error}</td></tr>
              ) : filteredBarangays.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: '60px', textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                    <div style={{ color: '#0F172A', fontWeight: 600, fontSize: 15 }}>No barangays found</div>
                    <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Try adjusting your search or filters.</div>
                  </td>
                </tr>
              ) : (
                filteredBarangays.map((brgy, idx) => {
                  const health = getHealthStatus(brgy)
                  return (
                    <tr 
                      key={brgy.id} 
                      style={{ 
                        borderBottom: idx === filteredBarangays.length - 1 ? 'none' : '1px solid #F1F5F9',
                        transition: 'background 0.2s',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => navigate(`/admin/barangays/${brgy.id}`)}
                    >
                      <td style={{ padding: '18px 24px' }}>
                        <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>Brgy {brgy.name}</div>
                      </td>
                      <td style={{ padding: '18px 24px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>
                        {brgy.population > 0 ? brgy.population.toLocaleString() : '-'}
                      </td>
                      <td style={{ padding: '18px 24px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <PersonnelChip count={brgy.official_count} role="Offc." />
                          <PersonnelChip count={brgy.watcher_count} role="Wtchr." />
                          <PersonnelChip count={brgy.driver_count} role="Drvr." />
                        </div>
                      </td>
                      <td style={{ padding: '18px 24px', textAlign: 'center' }}>
                        <CountBadge count={brgy.pending_concerns} threshold={5} type="warning" />
                      </td>
                      <td style={{ padding: '18px 24px', textAlign: 'center' }}>
                        <CountBadge count={brgy.active_hotspots} threshold={3} type="critical" />
                      </td>
                      <td style={{ padding: '18px 24px', textAlign: 'center' }}>
                        <CountBadge count={brgy.open_escalations} threshold={0} type="critical" />
                      </td>
                      <td style={{ padding: '18px 24px' }}>
                        <HealthPill status={health} />
                      </td>
                      <td style={{ padding: '18px 24px', textAlign: 'right' }}>
                        <button style={{
                          background: '#F1F5F9', color: '#0F172A', border: 'none',
                          padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                          cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#E2E8F0'; e.stopPropagation(); }}
                        onMouseLeave={e => e.currentTarget.style.background = '#F1F5F9'}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </DashboardLayout>
  )
}

// UI Components
function StatCard({ title, value, icon, color, bg }) {
  return (
    <div style={{ 
      background: '#fff', borderRadius: 16, padding: 24, 
      display: 'flex', alignItems: 'center', gap: 16,
      border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
    }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>{value}</div>
      </div>
    </div>
  )
}

function PersonnelChip({ count, role }) {
  const isMissing = count === 0;
  return (
    <div style={{ 
      display: 'inline-flex', alignItems: 'center', gap: 4, 
      padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: isMissing ? '#FEF2F2' : '#F1F5F9',
      color: isMissing ? '#DC2626' : '#475569',
      border: `1px solid ${isMissing ? '#FCA5A5' : 'transparent'}`
    }}>
      <span>{count}</span>
      <span style={{ opacity: 0.7, fontWeight: 600 }}>{role}</span>
    </div>
  )
}

function CountBadge({ count, threshold, type }) {
  const isOver = count > threshold;
  const bg = isOver ? (type === 'critical' ? '#FEF2F2' : '#FFFBEB') : '#F1F5F9';
  const color = isOver ? (type === 'critical' ? '#DC2626' : '#D97706') : '#475569';
  
  if (count === 0) return <span style={{ color: '#CBD5E1', fontWeight: 600 }}>-</span>;
  
  return (
    <span style={{ 
      display: 'inline-block', padding: '4px 10px', borderRadius: 12, fontSize: 13, fontWeight: 800,
      background: bg, color: color
    }}>
      {count}
    </span>
  )
}

function HealthPill({ status }) {
  const map = {
    critical: { bg: '#FEF2F2', color: '#DC2626', icon: '🚨' },
    warning: { bg: '#FFFBEB', color: '#D97706', icon: '⚠️' },
    healthy: { bg: '#F0FDF4', color: '#10B981', icon: '✅' },
  }
  const config = map[status];
  
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: config.bg, color: config.color,
      padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em'
    }}>
      <span style={{ fontSize: 14 }}>{config.icon}</span>
      {status}
    </div>
  )
}
