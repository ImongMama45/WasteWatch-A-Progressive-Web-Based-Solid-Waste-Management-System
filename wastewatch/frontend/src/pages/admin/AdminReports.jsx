import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Filter,
  MapPin,
  AlertTriangle,
  AlertCircle,
  Clock,
  Calendar,
  CheckCircle2,
  ChevronRight,
  X,
  RotateCcw,
  FileText,
  User,
  Layers,
  Tag as TagIcon
} from 'lucide-react'
import api from '../../api/client'
import BarangaySelect from '../../components/BarangaySelect'
import ReportDetail from './ReportDetail'
import { TableRowsSkeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'

const STATUS_META = {
  pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' },
  approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)' },
  resolved: { label: 'Resolved', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)' },
}

const SEVERITY_META = {
  low: { label: 'Low', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  medium: { label: 'Medium', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  high: { label: 'High', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
}

const ISSUE_TYPE_LABELS = {
  overflow: 'Overflow',
  missed: 'Missed Collection',
  illegal_dumping: 'Illegal Dumping',
}

const ALL_TAGS = ['Near School', 'Near market', 'Side Road', 'Residential', 'Highway', 'Near River', 'Misconduct']

function StatusBadge({ s }) {
  const m = STATUS_META[s] || { label: s || 'Unknown', color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.2)' }
  return (
    <span style={{
      background: m.bg,
      color: m.color,
      border: `1px solid ${m.border}`,
      borderRadius: 20,
      padding: '3px 10px',
      fontSize: 10,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color }} />
      {m.label}
    </span>
  )
}

export default function AdminReports() {
  const navigate = useNavigate()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [filters, setFilters] = useState({
    status: '',
    barangay: '',
    issue_type: '',
    severity: '',
    tag: '',
  })
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function fetchReports() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        params.append('page', page)
        params.append('page_size', '10')
        if (filters.status) params.append('status', filters.status)
        if (filters.barangay) params.append('barangay', filters.barangay)
        if (filters.issue_type) params.append('issue_type', filters.issue_type)
        if (filters.severity) params.append('severity', filters.severity)
        if (filters.tag) params.append('tags__icontains', filters.tag)
        if (searchQuery.trim()) params.append('search', searchQuery.trim())

        const res = await api.get(`/api/watcher/reports/?${params.toString()}`)
        if (!cancelled) {
          if (res.data?.results) {
            setReports(res.data.results)
            setTotalCount(res.data.count || 0)
            setTotalPages(res.data.total_pages || 1)
          } else if (Array.isArray(res.data)) {
            setReports(res.data)
            setTotalCount(res.data.length)
            setTotalPages(Math.ceil(res.data.length / 10) || 1)
          }
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch reports:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchReports()

    return () => { cancelled = true }
  }, [filters, searchQuery, page, refreshTrigger])

  const handleFilterChange = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }))
    setPage(1)
  }

  const handleResetFilters = () => {
    setSearchQuery('')
    setPage(1)
    setFilters({
      status: '',
      barangay: '',
      issue_type: '',
      severity: '',
      tag: '',
    })
  }

  const hasActiveFilters = Boolean(
    filters.status || filters.barangay || filters.issue_type || filters.severity || filters.tag || searchQuery.trim()
  )

  const filteredReports = reports

  return (
    <div style={{
      background: 'var(--surface, #ffffff)',
      borderRadius: 16,
      border: '1px solid var(--border, #e2e8f0)',
      padding: '24px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.03)'
    }}>
      <style>{`
        .reports-table-row {
          transition: background 0.15s ease;
          cursor: pointer;
        }
        .reports-table-row:hover {
          background: var(--surface-2, #f8fafc) !important;
        }
        .reports-table-row:hover .row-arrow-icon {
          opacity: 1 !important;
          transform: translateX(2px);
        }
        .report-filter-select {
          width: 100%;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--border, #cbd5e1);
          background: var(--surface-2, #ffffff);
          color: var(--text, #0f172a);
          font-size: 12px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .report-filter-select:focus {
          border-color: var(--accent, #2ecc71);
        }
      `}</style>

      {/* Filter Controls Toolbar */}
      <div style={{
        background: 'var(--surface-2, #f8fafc)',
        padding: '16px 18px',
        borderRadius: 14,
        border: '1px solid var(--border, #e2e8f0)',
        marginBottom: 20
      }}>
        {/* Search row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 280px', position: 'relative' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)'
              }}
            />
            <input
              type="text"
              placeholder="Search reports by ID (e.g. #46), keyword, or reporter..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px 9px 36px',
                borderRadius: 9,
                border: '1px solid var(--border, #cbd5e1)',
                background: 'var(--surface, #ffffff)',
                color: 'var(--text, #0f172a)',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid var(--border, #cbd5e1)',
                background: 'var(--surface, #ffffff)',
                color: 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <RotateCcw size={12} /> Reset Filters
            </button>
          )}

          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>
              Showing <strong style={{ color: 'var(--text)' }}>{totalCount === 0 ? 0 : (page - 1) * 10 + 1}–{Math.min(page * 10, totalCount)}</strong> of <strong style={{ color: 'var(--text)' }}>{totalCount}</strong> reports
            </span>
            <span
              className="ww-pagination-ratio"
              style={{
                background: 'var(--surface-2, #f1f5f9)',
                border: '1px solid var(--border, #cbd5e1)',
                color: 'var(--accent, #10b981)',
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800
              }}
            >
              {reports.length}/{totalCount}
            </span>
          </div>
        </div>

        {/* Filters dropdowns row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 }}>
              Barangay
            </label>
            <BarangaySelect
              value={filters.barangay}
              onChange={val => handleFilterChange('barangay', val)}
              showAllOption={true}
            />
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 }}>
              Status
            </label>
            <select
              className="report-filter-select"
              value={filters.status}
              onChange={e => handleFilterChange('status', e.target.value)}
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 }}>
              Tag Filter
            </label>
            <select
              className="report-filter-select"
              value={filters.tag}
              onChange={e => handleFilterChange('tag', e.target.value)}
            >
              <option value="">All Tags</option>
              {ALL_TAGS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 }}>
              Severity
            </label>
            <select
              className="report-filter-select"
              value={filters.severity}
              onChange={e => handleFilterChange('severity', e.target.value)}
            >
              <option value="">All Severities</option>
              {Object.entries(SEVERITY_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Reports Table Container */}
      <div style={{
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border, #e2e8f0)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 700 }}>
            <thead>
              <tr style={{ background: 'var(--surface-2, #f8fafc)', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
                <th style={{ padding: '12px 18px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', width: 100 }}>
                  Report ID
                </th>
                <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Barangay
                </th>
                <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Issue / Tags
                </th>
                <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Reported Person
                </th>
                <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Status
                </th>
                <th style={{ padding: '12px 18px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Submitted
                </th>
                <th style={{ width: 40, padding: 0 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableRowsSkeleton rows={6} cols={7} />
              ) : filteredReports.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', color: 'var(--text-muted)' }}>
                      <FileText size={22} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
                      No reports found
                    </div>
                    <div style={{ fontSize: 12 }}>
                      {hasActiveFilters ? 'Try adjusting or resetting your filter criteria.' : 'No waste reports have been submitted yet.'}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredReports.map(r => {
                  const hasMisconduct = r.tags?.includes('Misconduct')
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedReportId(r.id)}
                      className="reports-table-row"
                      style={{
                        borderBottom: '1px solid var(--border, #e2e8f0)',
                        background: hasMisconduct ? 'rgba(239, 68, 68, 0.03)' : 'transparent',
                      }}
                    >
                      {/* Report ID */}
                      <td style={{ padding: '14px 18px', fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                        <span style={{ color: 'var(--accent, #2ecc71)', marginRight: 2 }}>#</span>{r.id}
                      </td>

                      {/* Barangay */}
                      <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                          <MapPin size={13} color="var(--text-muted)" />
                          {r.barangay_name || 'Lucena City'}
                        </div>
                      </td>

                      {/* Issue & Tags */}
                      <td style={{ padding: '14px 16px', fontSize: 13 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                          {ISSUE_TYPE_LABELS[r.issue_type] || r.issue_type}
                        </div>
                        {r.tags && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {r.tags.split(',').filter(Boolean).map(tag => (
                              <span
                                key={tag}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  background: tag === 'Misconduct' ? 'rgba(239, 68, 68, 0.12)' : 'var(--surface-2, #f1f5f9)',
                                  color: tag === 'Misconduct' ? '#ef4444' : 'var(--text-muted)',
                                  border: `1px solid ${tag === 'Misconduct' ? 'rgba(239, 68, 68, 0.3)' : 'var(--border, #cbd5e1)'}`,
                                  padding: '2px 7px',
                                  borderRadius: 5,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3
                                }}
                              >
                                {tag === 'Misconduct' && <AlertTriangle size={10} />}
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Reported Person (Strictly SVG icons - zero emojis) */}
                      <td style={{ padding: '14px 16px', fontSize: 13 }}>
                        {r.reported_user_name ? (
                          <div style={{
                            color: '#ef4444',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'rgba(239, 68, 68, 0.08)',
                            padding: '3px 8px',
                            borderRadius: 6
                          }}>
                            <AlertTriangle size={12} color="#ef4444" />
                            {r.reported_user_name}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge s={r.status} />
                      </td>

                      {/* Submitted Date */}
                      <td style={{ padding: '14px 18px', fontSize: 12, color: 'var(--text-muted)' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Clock size={12} />
                          {new Date(r.created_at).toLocaleDateString()}
                        </div>
                      </td>

                      {/* Row Action Arrow */}
                      <td style={{ paddingRight: 14, textAlign: 'right' }}>
                        <ChevronRight
                          size={16}
                          className="row-arrow-icon"
                          style={{
                            color: 'var(--text-muted)',
                            opacity: 0.3,
                            transition: 'all 0.15s ease'
                          }}
                        />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalCount={totalCount}
        pageSize={10}
        onPageChange={setPage}
        loading={loading}
      />

      {/* Report Detail Modal Overlay */}
      {selectedReportId && (
        <ReportDetail
          reportId={selectedReportId}
          onClose={() => setSelectedReportId(null)}
          onUpdated={() => setRefreshTrigger(t => t + 1)}
        />
      )}
    </div>
  )
}
