import { useState, useEffect, useMemo, useCallback } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import api from '../../api/client'
import { StatCardSkeleton, FeedCardSkeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'
import {
  History,
  ShieldCheck,
  PlusCircle,
  Edit3,
  Trash2,
  Settings,
  Search,
  RefreshCw,
  Layers,
  Clock,
  User,
  X,
  FileSearch,
  Filter,
  CheckCircle2,
  Calendar,
  AlertCircle
} from 'lucide-react'

const ACTIONS = {
  create: {
    label: 'Create',
    color: '#15803d',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    icon: PlusCircle
  },
  update: {
    label: 'Update',
    color: '#2563eb',
    bg: '#eff6ff',
    border: '#bfdbfe',
    icon: Edit3
  },
  delete: {
    label: 'Delete',
    color: '#dc2626',
    bg: '#fef2f2',
    border: '#fecaca',
    icon: Trash2
  },
  system: {
    label: 'System',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    icon: Settings
  },
}

const MODULES = [
  'Users',
  'Trucks',
  'Dumpsites',
  'Routes',
  'Escalations',
  'Notifications',
  'System'
]

function ActionBadge({ action }) {
  const m = ACTIONS[action] || ACTIONS.system
  const IconComp = m.icon
  return (
    <span style={{
      background: m.bg,
      border: `1px solid ${m.border}`,
      color: m.color,
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }}>
      <IconComp size={11} />
      <span>{m.label}</span>
    </span>
  )
}

export default function ActivityLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [moduleFilter, setModuleFilter] = useState('all')
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ count: 0, total_pages: 1, summary: null })

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = {
      page,
      page_size: 10,
      action: actionFilter,
      module: moduleFilter,
      search: search.trim(),
    }
    try {
      let res
      try {
        res = await api.get('/api/analytics/activity-logs/', { params })
      } catch (err) {
        if (err.response?.status === 404) {
          res = await api.get('/api/analytics/logs/', { params })
        } else {
          throw err
        }
      }
      if (Array.isArray(res.data)) {
        setLogs(res.data)
        setPagination({ count: res.data.length, total_pages: 1, summary: null })
      } else {
        setLogs(res.data?.results || [])
        setPagination({
          count: res.data?.count || 0,
          total_pages: res.data?.total_pages || 1,
          summary: res.data?.summary || null,
        })
      }
    } catch (err) {
      console.error('[ActivityLog] Failed to fetch logs:', err)
      setError('Unable to load activity logs.')
    } finally {
      setLoading(false)
    }
  }, [page, actionFilter, moduleFilter, search])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => { setPage(1) }, [actionFilter, moduleFilter, search])

  const counts = useMemo(() => pagination.summary || ({
    all: logs.length,
    create: logs.filter(l => l.action === 'create').length,
    update: logs.filter(l => l.action === 'update').length,
    delete: logs.filter(l => l.action === 'delete').length,
    system: logs.filter(l => l.action === 'system').length,
  }), [logs, pagination.summary])

  // Filtering and slicing are performed by the backend.
  const filteredLogs = logs

  const resetFilters = () => {
    setActionFilter('all')
    setModuleFilter('all')
    setSearch('')
  }

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
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .meta-stat-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 16px 20px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .meta-tab-btn {
          padding: 6px 14px;
          border-radius: 6px;
          border: 1px solid transparent;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          color: #65676b;
        }
        .meta-tab-btn.active {
          background: #ffffff;
          color: #050505;
          border-color: #ccd0d5;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .meta-tab-btn:hover:not(.active) {
          background: rgba(0,0,0,0.03);
          color: #050505;
        }
        .audit-row-hover {
          transition: background 0.15s ease;
        }
        .audit-row-hover:hover {
          background: #f9fafb !important;
        }
        .timeline-connector {
          position: absolute;
          left: 41px;
          top: 54px;
          bottom: -16px;
          width: 2px;
          background: #e4e6eb;
        }
        .audit-row-container:last-child .timeline-connector {
          display: none;
        }
        .meta-input {
          height: 36px;
          border: 1px solid #ccd0d5;
          border-radius: 6px;
          font-size: 13px;
          background: #ffffff;
          color: #050505;
          outline: none;
          padding: 0 12px;
          font-family: inherit;
        }
        .meta-input:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
        .meta-btn-secondary {
          height: 36px;
          background: #ffffff;
          border: 1px solid #ccd0d5;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          color: #050505;
          padding: 0 14px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          transition: background 0.15s ease;
        }
        .meta-btn-secondary:hover:not(:disabled) {
          background: #f0f2f5;
        }
        .meta-btn-primary {
          height: 36px;
          background: #16a34a;
          border: 1px solid #16a34a;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
          padding: 0 16px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          transition: background 0.15s ease;
        }
        .meta-btn-primary:hover:not(:disabled) {
          background: #15803d;
        }
      `}</style>

      <div className="meta-page-canvas">
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Page Header ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  background: '#e7f3ed',
                  color: '#166534',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <History size={18} />
                </div>
                <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#050505', letterSpacing: '-0.02em' }}>
                  Activity &amp; Audit Log
                </h1>
                <span style={{
                  background: '#f0f2f5',
                  color: '#65676b',
                  border: '1px solid #e4e6eb',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 4,
                  letterSpacing: '0.04em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4
                }}>
                  <ShieldCheck size={11} />
                  ADMIN AUDIT TRAIL
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#65676b' }}>
                Chronological record of administrative events, account state updates, and municipal data operations.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={fetchLogs}
                disabled={loading}
                className="meta-btn-secondary"
                style={{ opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                <RefreshCw size={13} className={loading ? 'icon-spin' : ''} />
                {loading ? 'Refreshing...' : 'Refresh Logs'}
              </button>
            </div>
          </div>

          {/* ── KPI Stat Strip ── */}
          {loading && logs.length === 0 ? (
            <StatCardSkeleton count={4} style={{ marginBottom: 20 }} />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 14,
              marginBottom: 20
            }}>
              {[
                {
                  label: 'Total Events',
                  value: counts.all,
                  icon: Layers,
                  subtext: 'Audited records on file',
                  iconColor: '#166534',
                  iconBg: '#e7f3ed'
                },
                {
                  label: 'Created Records',
                  value: counts.create,
                  icon: PlusCircle,
                  subtext: 'Entities added into system',
                  iconColor: '#15803d',
                  iconBg: '#f0fdf4'
                },
                {
                  label: 'Updated & Edited',
                  value: counts.update,
                  icon: Edit3,
                  subtext: 'Record modifications',
                  iconColor: '#2563eb',
                  iconBg: '#eff6ff'
                },
                {
                  label: 'Deleted Records',
                  value: counts.delete,
                  icon: Trash2,
                  subtext: 'High-sensitivity deletions',
                  iconColor: '#dc2626',
                  iconBg: '#fef2f2'
                },
              ].map(s => {
                const IconComp = s.icon
                return (
                  <div key={s.label} className="meta-stat-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: '#65676b', textTransform: 'uppercase' }}>
                        {s.label}
                      </span>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: s.iconBg, color: s.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <IconComp size={15} />
                      </div>
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: '#050505', lineHeight: 1.1, marginBottom: 4 }}>
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

          {/* ── Toolbar: Filters & Search ── */}
          <div className="meta-card" style={{
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center'
          }}>
            {/* Action Segmented Buttons */}
            <div style={{ display: 'flex', gap: 4, background: '#f0f2f5', borderRadius: 6, padding: 3, flexWrap: 'wrap' }}>
              {['all', 'create', 'update', 'delete'].map(act => {
                const active = actionFilter === act
                const actMeta = ACTIONS[act]
                return (
                  <button
                    key={act}
                    onClick={() => setActionFilter(act)}
                    className={`meta-tab-btn ${active ? 'active' : ''}`}
                  >
                    {act !== 'all' && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: actMeta.color }} />
                    )}
                    {act === 'all' ? `All (${counts.all})` : `${actMeta.label} (${counts[act] || 0})`}
                  </button>
                )
              })}
            </div>

            {/* Module Select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Module:
              </span>
              <select
                value={moduleFilter}
                onChange={e => setModuleFilter(e.target.value)}
                className="meta-input"
                style={{ cursor: 'pointer', paddingRight: 28 }}
              >
                <option value="all">All Modules</option>
                {MODULES.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Search box */}
            <div style={{ position: 'relative', width: 280, maxWidth: '100%', marginLeft: 'auto' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#65676b' }} />
              <input
                className="meta-input"
                placeholder="Search details or admin name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', paddingLeft: 30, paddingRight: search ? 30 : 12 }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#65676b',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* ── Timeline Audit Feed ── */}
          <div className="meta-card" style={{ overflow: 'hidden' }}>
            {/* Header info strip */}
            <div style={{
              padding: '12px 20px',
              borderBottom: '1px solid #e4e6eb',
              background: '#f7f8fa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              fontWeight: 700,
              color: '#65676b',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}>
              <span>Audit Timeline Stream ({filteredLogs.length}/{pagination.count} events)</span>
              <span>Sorted by Most Recent</span>
            </div>

            {loading && logs.length === 0 ? (
              <div style={{ padding: 16 }}>
                <FeedCardSkeleton count={5} compact />
              </div>
            ) : error ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', color: '#dc2626' }}>
                <AlertCircle size={28} style={{ margin: '0 auto 8px' }} />
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Error Loading Logs</div>
                <div style={{ fontSize: 12, color: '#65676b', marginBottom: 14 }}>{error}</div>
                <button
                  onClick={fetchLogs}
                  className="meta-btn-secondary"
                  style={{ margin: '0 auto' }}
                >
                  Retry
                </button>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  background: '#f0f2f5',
                  color: '#65676b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px'
                }}>
                  <FileSearch size={24} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#050505', marginBottom: 4 }}>
                  No Activity Matches Your Filters
                </div>
                <div style={{ fontSize: 13, color: '#65676b', maxWidth: 340, margin: '0 auto 16px' }}>
                  There are no audit events matching the selected action type, module, or search query.
                </div>
                {(actionFilter !== 'all' || moduleFilter !== 'all' || search) && (
                  <button
                    onClick={resetFilters}
                    className="meta-btn-primary"
                    style={{ margin: '0 auto' }}
                  >
                    Reset All Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="ww-stagger">
              {filteredLogs.map(log => {
                const isDelete = log.action === 'delete'
                const actMeta = ACTIONS[log.action] || ACTIONS.system
                const IconComp = actMeta.icon

                return (
                  <div
                    key={log.id}
                    className="audit-row-container audit-row-hover"
                    style={{
                      position: 'relative',
                      padding: '16px 20px',
                      borderBottom: '1px solid #e4e6eb',
                      background: isDelete ? '#fffbfb' : 'transparent'
                    }}
                  >
                    {/* Timeline connector line */}
                    <div className="timeline-connector" />

                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                      {/* Action Node */}
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        flexShrink: 0,
                        background: actMeta.bg,
                        border: `1px solid ${actMeta.border}`,
                        color: actMeta.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 2
                      }}>
                        <IconComp size={15} />
                      </div>

                      {/* Content Body */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <ActionBadge action={log.action} />
                            <span style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: '#65676b',
                              background: '#f0f2f5',
                              border: '1px solid #e4e6eb',
                              padding: '2px 7px',
                              borderRadius: 4,
                              letterSpacing: '0.04em'
                            }}>
                              {(log.module || 'SYSTEM').toUpperCase()}
                            </span>
                          </div>

                          {/* Timestamp */}
                          <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#65676b' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Calendar size={12} />
                              {new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                            <span>·</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: '#050505' }}>
                              <Clock size={12} />
                              {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                        </div>

                        {/* Detail Text */}
                        <div style={{
                          fontSize: 13,
                          lineHeight: 1.5,
                          marginBottom: 8,
                          color: isDelete ? '#dc2626' : '#050505',
                          fontWeight: isDelete ? 600 : 400
                        }}>
                          {log.details}
                        </div>

                        {/* Footer: Admin info */}
                        <div style={{
                          fontSize: 12,
                          color: '#65676b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}>
                          <div style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: '#f0f2f5',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#65676b'
                          }}>
                            <User size={11} />
                          </div>
                          <span>Admin Actor:</span>
                          <strong style={{ color: '#050505', fontWeight: 600 }}>
                            {log.admin_name || 'System Automated Task'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              </div>
            )}
          </div>

          <Pagination
            currentPage={page}
            totalPages={pagination.total_pages}
            totalCount={pagination.count}
            pageSize={10}
            onPageChange={setPage}
            loading={loading}
          />

        </div>
      </div>
    </DashboardLayout>
  )
}

