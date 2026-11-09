import React, { useState, useEffect, useMemo } from 'react'
import {
  Map,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Search,
  ChevronRight,
  Filter,
  MapPin,
  Users,
  Layers,
  ArrowUpDown,
  RefreshCw,
  X,
  Building2,
  Flame,
  FileWarning
} from 'lucide-react'
import api from '../../api/client'
import DashboardLayout from '../../components/DashboardLayout'
import BarangayDetailModal from './BarangayDetail'
import { StatCardSkeleton, TableRowsSkeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'

export default function BarangayManagement() {
  const [barangays, setBarangays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters & Pagination
  const [search, setSearch] = useState('')
  const [healthFilter, setHealthFilter] = useState('all') // 'all', 'critical', 'warning', 'healthy'
  const [issueFilter, setIssueFilter] = useState('all') // 'all', 'has_hotspots', 'has_escalations', 'no_issues'
  const [sortBy, setSortBy] = useState('name') // 'name', 'population', 'issues'
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [selectedBarangayId, setSelectedBarangayId] = useState(null)

  const fetchBarangays = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.append('page', page)
      params.append('page_size', '10')
      if (search.trim()) params.append('search', search.trim())

      const res = await api.get(`/api/accounts/barangay-management/?${params.toString()}`)
      if (res.data?.results) {
        setBarangays(res.data.results)
        setTotalCount(res.data.count || 0)
        setTotalPages(res.data.total_pages || 1)
      } else if (Array.isArray(res.data)) {
        setBarangays(res.data)
        setTotalCount(res.data.length)
        setTotalPages(Math.ceil(res.data.length / 10) || 1)
      }
    } catch (err) {
      console.error(err)
      setError('Failed to load barangay operations data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBarangays()
  }, [page, search])

  const getHealthStatus = (brgy) => {
    if (brgy.open_escalations > 0 || brgy.has_unassigned_roles) return 'critical'
    if (brgy.pending_concerns > 5 || brgy.active_hotspots > 3) return 'warning'
    return 'healthy'
  }

  const filteredBarangays = useMemo(() => {
    let result = barangays.filter(brgy => {
      const q = search.trim().toLowerCase()
      const matchesSearch = !q || (brgy.name || '').toLowerCase().includes(q)
      if (!matchesSearch) return false

      if (healthFilter !== 'all' && getHealthStatus(brgy) !== healthFilter) return false

      if (issueFilter === 'has_hotspots' && brgy.active_hotspots === 0) return false
      if (issueFilter === 'has_escalations' && brgy.open_escalations === 0) return false
      if (issueFilter === 'no_issues' && (brgy.active_hotspots > 0 || brgy.open_escalations > 0 || brgy.pending_concerns > 0)) return false

      return true
    })

    result.sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '')
      if (sortBy === 'population') return (b.population || 0) - (a.population || 0)
      if (sortBy === 'issues') {
        const issuesA = (a.active_hotspots || 0) + (a.open_escalations || 0) + (a.pending_concerns || 0)
        const issuesB = (b.active_hotspots || 0) + (b.open_escalations || 0) + (b.pending_concerns || 0)
        if (issuesB !== issuesA) return issuesB - issuesA
        return (a.name || '').localeCompare(b.name || '')
      }
      return 0
    })

    return result
  }, [barangays, search, healthFilter, issueFilter, sortBy])

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
      <style>{`
        .meta-page-canvas {
          background: #f0f2f5;
          min-height: calc(100vh - 60px);
          padding: 24px 32px 60px;
        }
        .meta-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .meta-stat-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 16px 20px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .meta-stat-card:hover {
          border-color: #ccd0d5;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
        }
        .meta-table-row {
          transition: background-color 0.12s ease;
        }
        .meta-table-row:hover {
          background: #f9fafb !important;
        }
        .meta-btn-secondary {
          background: #ffffff;
          border: 1px solid #ccd0d5;
          color: #050505;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
        }
        .meta-btn-secondary:hover {
          background: #f0f2f5;
          border-color: #bec3c9;
        }
        .meta-btn-primary {
          background: #16a34a;
          border: 1px solid #16a34a;
          color: #ffffff;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 16px;
        }
        .meta-btn-primary:hover {
          background: #15803d;
          border-color: #15803d;
        }
        .meta-tab-btn {
          padding: 7px 14px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          background: transparent;
          color: #65676b;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .meta-tab-btn:hover {
          background: #f0f2f5;
          color: #050505;
        }
        .meta-tab-btn.active {
          background: #e7f3ed;
          color: #166534;
          border-color: #bbf7d0;
        }
        .meta-select {
          height: 36px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid #ccd0d5;
          background: #ffffff;
          color: #050505;
          font-size: 13px;
          font-weight: 500;
          outline: none;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .meta-select:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
        .meta-input {
          height: 36px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid #ccd0d5;
          background: #ffffff;
          color: #050505;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .meta-input:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
      `}</style>

      <div className="meta-page-canvas">
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Page Header (Meta Business Suite Style) ── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 16
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{
                  fontSize: 22,
                  fontWeight: 700,
                  margin: 0,
                  color: '#050505',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.2
                }}>
                  Barangay Operations &amp; Zones
                </h1>
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#65676b',
                  background: '#e4e6eb',
                  padding: '2px 8px',
                  borderRadius: 4
                }}>
                  {stats.total} Zones
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#65676b' }}>
                Monitor operational health, staff deployment, active waste hotspots, and escalations across city zones.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={fetchBarangays}
                disabled={loading}
                className="meta-btn-secondary"
              >
                <RefreshCw size={14} className={loading ? 'icon-spin' : ''} color="#65676b" />
                <span>{loading ? 'Refreshing...' : 'Refresh Data'}</span>
              </button>
            </div>
          </div>

          {/* ── KPI Metric Summary (Meta Business Suite Style: Flat, Crisp, No Neon Rainbows) ── */}
          {loading && barangays.length === 0 ? (
            <StatCardSkeleton count={4} style={{ marginBottom: 18 }} />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 14,
              marginBottom: 18
            }}>
              {[
                {
                  label: 'Total Barangays',
                  value: stats.total,
                  subtext: 'City-wide collection zones',
                  icon: Map
                },
                {
                  label: 'Healthy Zones',
                  value: stats.healthy,
                  subtext: 'No active escalations',
                  icon: CheckCircle2,
                  highlight: '#166534'
                },
                {
                  label: 'Attention Needed',
                  value: stats.warning,
                  subtext: 'Elevated concerns or clusters',
                  icon: AlertTriangle,
                  highlight: stats.warning > 0 ? '#b45309' : undefined
                },
                {
                  label: 'Critical Issues',
                  value: stats.critical,
                  subtext: 'Open escalations or staffing gaps',
                  icon: AlertOctagon,
                  highlight: stats.critical > 0 ? '#b91c1c' : undefined
                },
              ].map(s => {
                const IconComp = s.icon
                return (
                  <div key={s.label} className="meta-stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {s.label}
                      </span>
                      <IconComp size={16} color="#8a8d91" />
                    </div>
                    <div style={{
                      fontSize: 26,
                      fontWeight: 700,
                      color: s.highlight || '#050505',
                      lineHeight: 1.15,
                      marginBottom: 4
                    }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: 12, color: '#65676b' }}>
                      {s.subtext}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Toolbar: Meta Business Suite Filters & Controls ── */}
          <div className="meta-card" style={{
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center'
          }}>
            {/* Health Filter Tabs */}
            <div style={{ display: 'flex', gap: 4, background: '#f0f2f5', borderRadius: 6, padding: 3, flexWrap: 'wrap' }}>
              {[
                { key: 'all', label: 'All Health' },
                { key: 'healthy', label: 'Healthy', dot: '#16a34a' },
                { key: 'warning', label: 'Warning', dot: '#f59e0b' },
                { key: 'critical', label: 'Critical', dot: '#ef4444' }
              ].map(f => {
                const active = healthFilter === f.key
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setHealthFilter(f.key)}
                    className={`meta-tab-btn ${active ? 'active' : ''}`}
                    style={{
                      background: active ? '#ffffff' : 'transparent',
                      color: active ? '#050505' : '#65676b',
                      border: active ? '1px solid #ccd0d5' : '1px solid transparent',
                      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                    }}
                  >
                    {f.dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.dot }} />}
                    <span>{f.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Issues Select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Issues:
              </span>
              <select
                value={issueFilter}
                onChange={e => setIssueFilter(e.target.value)}
                className="meta-select"
              >
                <option value="all">All Issues</option>
                <option value="has_hotspots">Has Hotspots</option>
                <option value="has_escalations">Has Escalations</option>
                <option value="no_issues">Clear (No Issues)</option>
              </select>
            </div>

            {/* Sort Select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Sort:
              </span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="meta-select"
              >
                <option value="name">Barangay Name (A–Z)</option>
                <option value="population">Population (High to Low)</option>
                <option value="issues">Most Issues &amp; Alerts</option>
              </select>
            </div>

            {/* Ratio Counter */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#65676b',
              fontWeight: 600,
            }}>
              <span>
                Showing <strong>{totalCount === 0 ? 0 : (page - 1) * 10 + 1}–{Math.min(page * 10, totalCount)}</strong> of <strong>{totalCount}</strong>
              </span>
              <span
                className="ww-pagination-ratio"
                style={{
                  background: '#f0f2f5',
                  border: '1px solid #ced0d4',
                  color: '#166534',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800
                }}
              >
                {barangays.length}/{totalCount}
              </span>
            </div>

            {/* Search Box */}
            <div style={{ position: 'relative', width: 260, maxWidth: '100%', marginLeft: 'auto' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#8a8d91' }} />
              <input
                className="meta-input"
                placeholder="Search barangay zone…"
                value={search}
                onChange={e => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                style={{
                  width: '100%',
                  paddingLeft: 32,
                  paddingRight: 28
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setPage(1)
                  }}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#8a8d91',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* ── Enterprise Table (Meta Business Suite Style) ── */}
          <div className="meta-card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 920 }}>
                <thead style={{ background: '#f7f8fa', borderBottom: '1px solid #e4e6eb' }}>
                  <tr>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Barangay Zone</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Population</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personnel Assigned</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Concerns</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Hotspots</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Escalations</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Health Status</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && barangays.length === 0 ? (
                    <TableRowsSkeleton rows={6} cols={8} />
                  ) : error ? (
                    <tr>
                      <td colSpan="8" style={{ padding: '50px 20px', textAlign: 'center', color: '#b91c1c' }}>
                        <AlertOctagon size={24} style={{ margin: '0 auto 8px' }} />
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{error}</div>
                      </td>
                    </tr>
                  ) : filteredBarangays.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ padding: '60px 20px', textAlign: 'center' }}>
                        <Map size={32} color="#8a8d91" style={{ margin: '0 auto 8px', opacity: 0.7 }} />
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#050505' }}>No barangays found</div>
                        <div style={{ fontSize: 12, color: '#65676b', marginTop: 2 }}>Try adjusting your search criteria or health filter.</div>
                      </td>
                    </tr>
                  ) : (
                    filteredBarangays.map((brgy, idx) => {
                      const health = getHealthStatus(brgy)
                      return (
                        <tr
                          key={brgy.id}
                          className="meta-table-row"
                          style={{
                            borderBottom: idx === filteredBarangays.length - 1 ? 'none' : '1px solid #e4e6eb',
                            cursor: 'pointer'
                          }}
                          onClick={() => setSelectedBarangayId(brgy.id)}
                        >
                          {/* Barangay Zone */}
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <MapPin size={15} color="#16a34a" style={{ flexShrink: 0 }} />
                              <strong style={{ fontSize: 13, color: '#050505', fontWeight: 600 }}>
                                Brgy. {brgy.name}
                              </strong>
                            </div>
                          </td>

                          {/* Population */}
                          <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontWeight: 500, color: '#050505' }}>
                            {brgy.population > 0 ? Number(brgy.population).toLocaleString() : '—'}
                          </td>

                          {/* Personnel Breakdown */}
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <PersonnelChip count={brgy.official_count} role="Offc" />
                              <PersonnelChip count={brgy.watcher_count} role="Watcher" />
                              <PersonnelChip count={brgy.driver_count} role="Driver" />
                            </div>
                          </td>

                          {/* Concerns */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <CountBadge count={brgy.pending_concerns} threshold={5} type="warning" />
                          </td>

                          {/* Hotspots */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <CountBadge count={brgy.active_hotspots} threshold={3} type="critical" />
                          </td>

                          {/* Escalations */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <CountBadge count={brgy.open_escalations} threshold={0} type="critical" />
                          </td>

                          {/* Health Status */}
                          <td style={{ padding: '12px 16px' }}>
                            <HealthPill status={health} />
                          </td>

                          {/* Manage Action */}
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                setSelectedBarangayId(brgy.id)
                              }}
                              className="meta-btn-secondary"
                              style={{
                                padding: '5px 11px',
                                fontSize: 12
                              }}
                            >
                              <span>Manage</span>
                              <ChevronRight size={13} color="#65676b" />
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSize={10}
              onPageChange={setPage}
              loading={loading}
            />
          </div>

        </div>
      </div>

      {selectedBarangayId && (
        <BarangayDetailModal
          barangayId={selectedBarangayId}
          onClose={() => setSelectedBarangayId(null)}
        />
      )}
    </DashboardLayout>
  )
}

function PersonnelChip({ count, role }) {
  const isMissing = count === 0
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 6px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      background: isMissing ? '#fee2e2' : '#f0f2f5',
      color: isMissing ? '#991b1b' : '#050505',
      border: `1px solid ${isMissing ? '#fecaca' : '#e4e6eb'}`
    }}>
      <span>{count}</span>
      <span style={{ color: '#65676b', fontSize: 10 }}>{role}</span>
    </span>
  )
}

function CountBadge({ count, threshold, type }) {
  const isOver = count > threshold

  if (!count || count === 0) {
    return <span style={{ color: '#8a8d91', fontWeight: 500, fontSize: 13 }}>—</span>
  }

  const bg = isOver
    ? (type === 'critical' ? '#fee2e2' : '#fef3c7')
    : '#f0f2f5'
  const color = isOver
    ? (type === 'critical' ? '#991b1b' : '#92400e')
    : '#050505'
  const border = isOver
    ? (type === 'critical' ? '1px solid #fecaca' : '1px solid #fde68a')
    : '1px solid #e4e6eb'

  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      background: bg,
      color: color,
      border: border
    }}>
      {count}
    </span>
  )
}

function HealthPill({ status }) {
  const map = {
    critical: {
      bg: '#fee2e2',
      border: '#fecaca',
      color: '#991b1b',
      icon: <AlertOctagon size={12} />,
      label: 'Critical'
    },
    warning: {
      bg: '#fef3c7',
      border: '#fde68a',
      color: '#92400e',
      icon: <AlertTriangle size={12} />,
      label: 'Warning'
    },
    healthy: {
      bg: '#e7f3ed',
      border: '#bbf7d0',
      color: '#166534',
      icon: <CheckCircle2 size={12} />,
      label: 'Healthy'
    },
  }
  const config = map[status] || map.healthy

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      background: config.bg,
      border: `1px solid ${config.border}`,
      color: config.color,
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }}>
      {config.icon}
      <span>{config.label}</span>
    </span>
  )
}

