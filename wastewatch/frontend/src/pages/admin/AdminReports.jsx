import { useState, useEffect, useMemo } from 'react'
import api from '../../api/client'
import BarangaySelect from '../../components/BarangaySelect'

const STATUS_META = {
  pending: { label: 'Pending', color: '#f39c12', bg: 'rgba(243,156,18,0.1)' },
  approved: { label: 'Approved', color: '#3498db', bg: 'rgba(52,152,219,0.1)' },
  rejected: { label: 'Rejected', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },
  resolved: { label: 'Resolved', color: '#2ecc71', bg: 'rgba(46,204,113,0.1)' },
}

const SEVERITY_META = {
  low: { label: 'Low', color: '#2ecc71', bg: 'rgba(46,204,113,0.1)' },
  medium: { label: 'Medium', color: '#f39c12', bg: 'rgba(243,156,18,0.1)' },
  high: { label: 'High', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },
}

const ISSUE_TYPE_LABELS = {
  overflow: 'Overflow',
  missed: 'Missed Collection',
  illegal_dumping: 'Illegal Dumping',
}

const ALL_TAGS = ['Near School', 'Near market', 'Side Road', 'Residential', 'Highway', 'Near River', 'Misconduct']

function StatusBadge({ s }) {
  const m = STATUS_META[s] || { label: s, color: '#888', bg: '#eee' }
  return (
    <span style={{
      background: m.bg, color: m.color, borderRadius: 20,
      padding: '2px 10px', fontSize: 10, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.05em'
    }}>{m.label}</span>
  )
}

function SeverityBadge({ v }) {
  const m = SEVERITY_META[v] || { label: v, color: '#888', bg: '#eee' }
  return (
    <span style={{
      background: m.bg, color: m.color, borderRadius: 20,
      padding: '2px 10px', fontSize: 10, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.05em'
    }}>{m.label}</span>
  )
}

export default function AdminReports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    status: '',
    barangay: '',
    issue_type: '',
    severity: '',
    tag: '',
  })

  useEffect(() => {
    fetchReports()
  }, [filters])

  async function fetchReports() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.status) params.append('status', filters.status)
      if (filters.barangay) params.append('barangay', filters.barangay)
      if (filters.issue_type) params.append('issue_type', filters.issue_type)
      if (filters.severity) params.append('severity', filters.severity)
      if (filters.tag) params.append('tags__icontains', filters.tag)

      const res = await api.get(`/api/watcher/reports/?${params.toString()}`)
      setReports(res.data)
    } catch (err) {
      console.error('Failed to fetch reports:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }))
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24 }}>
      <div className="page" style={{ padding: 0 }}>

        {/* Filter Controls */}
        <div style={{
          display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap',
          background: 'var(--surface)', padding: 16, borderRadius: 12,
          border: '1px solid var(--border)'
        }}>
          <div style={{ flex: '1 1 180px' }}>
            <label className="text-xs font-bold text-muted mb-1 block">BARANGAY</label>
            <BarangaySelect
              value={filters.barangay}
              onChange={val => handleFilterChange('barangay', val)}
              showAllOption={true}
            />
          </div>

          <div style={{ flex: '1 1 120px' }}>
            <label className="text-xs font-bold text-muted mb-1 block">STATUS</label>
            <select
              className="form-input"
              value={filters.status}
              onChange={e => handleFilterChange('status', e.target.value)}
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '1 1 120px' }}>
            <label className="text-xs font-bold text-muted mb-1 block">TAG</label>
            <select
              className="form-input"
              value={filters.tag}
              onChange={e => handleFilterChange('tag', e.target.value)}
            >
              <option value="">All Tags</option>
              {ALL_TAGS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '1 1 120px' }}>
            <label className="text-xs font-bold text-muted mb-1 block">SEVERITY</label>
            <select
              className="form-input"
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

        {/* Reports Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>REPORT ID</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>BARANGAY</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>ISSUE / TAGS</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>REPORTED PERSON</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>STATUS</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted)' }}>SUBMITTED</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Loading reports...
                  </td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No reports found matching filters.
                  </td>
                </tr>
              ) : (
                reports.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: r.tags?.includes('Misconduct') ? 'rgba(231,76,60,0.03)' : 'transparent' }}>
                    <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 700 }}>#{r.id}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13 }}>{r.barangay_name}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13 }}>
                      <div style={{ fontWeight: 600 }}>{ISSUE_TYPE_LABELS[r.issue_type] || r.issue_type}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {r.tags?.split(',').map(tag => (
                          <span key={tag} style={{
                            fontSize: 10, background: tag === 'Misconduct' ? '#e74c3c' : 'var(--surface-2)',
                            color: tag === 'Misconduct' ? 'white' : 'var(--text)',
                            padding: '1px 6px', borderRadius: 4
                          }}>{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13 }}>
                      {r.reported_user_name ? (
                        <div style={{ color: '#e74c3c', fontWeight: 600 }}>⚠️ {r.reported_user_name}</div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <StatusBadge s={r.status} />
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
