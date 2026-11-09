/**
 * CollectionLogs.jsx — Dumpsite Collection Records & Inflow Analytics
 * -------------------------------------------------------------------
 * Displays recorded truck deliveries, waste inflow statistics,
 * verification statuses, and inspection evidence with photo lightbox.
 *
 * Integrates with ArrivalLogger modal for recording new truck arrivals.
 * Strictly SVG iconography (NO emojis) in compliance with project rules.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Search,
  Filter,
  Calendar,
  Clock,
  Truck,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  X,
  Eye,
  FileText,
  Scale,
  Sparkles,
  ShieldCheck,
  Check,
  Maximize2
} from 'lucide-react'
import api from '../../api/client'
import ArrivalLogger from './ArrivalLogger'
import { StatCardSkeleton, TableSkeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'

// ─── FILL LEVEL CONFIG ────────────────────────────────────────────────────────

const FILL_CONFIG = {
  nearly_empty: { label: 'Nearly Empty', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)', pct: 15 },
  quarter: { label: 'Quarter Full', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.3)', pct: 25 },
  half: { label: 'Half Full', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)', pct: 50 },
  three_quarters: { label: 'Three Quarters', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.3)', pct: 75 },
  full: { label: 'Full Capacity', color: '#ea580c', bg: 'rgba(234, 88, 12, 0.12)', border: 'rgba(234, 88, 12, 0.3)', pct: 100 },
  overflowing: { label: 'Overflowing', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.3)', pct: 115 },
}

function FillLevelBadge({ level }) {
  const f = FILL_CONFIG[level]
  if (!f) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 32, height: 6, borderRadius: 99,
        background: 'var(--surface-2, rgba(0,0,0,0.08))', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${Math.min(100, f.pct)}%`,
          background: f.color, borderRadius: 99,
        }} />
      </div>
      <span style={{
        background: f.bg,
        color: f.color,
        border: `1px solid ${f.border}`,
        borderRadius: 20,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        {f.label}
      </span>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function CollectionLogs() {
  const navigate = useNavigate()
  const [siteId, setSiteId] = useState(null)
  const [siteName, setSiteName] = useState('Dumpsite Facility')
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [logOpen, setLogOpen] = useState(false)
  const [photoPreview, setPhotoPreview] = useState(null)

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [dateQuickFilter, setDateQuickFilter] = useState('all') // all, today, yesterday, 7days, custom
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [truckFilter, setTruckFilter] = useState('')
  const [barangayFilter, setBarangayFilter] = useState('')
  const [fillFilter, setFillFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    api.get('/api/dumpsite/dumpsites/').then(res => {
      if (res.data?.length > 0) {
        setSiteId(res.data[0].id)
        if (res.data[0].name) setSiteName(res.data[0].name)
      } else {
        setLoading(false)
      }
    }).catch(() => { setLoading(false) })
  }, [])

  const fetchLogs = (targetPage) => {
    if (!siteId) return
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', typeof targetPage === 'number' ? targetPage : page)
    params.set('page_size', '10')

    // Date quick filter resolution
    let resolvedFrom = dateFrom
    let resolvedTo = dateTo
    const now = new Date()

    if (dateQuickFilter === 'today') {
      const todayStr = now.toISOString().split('T')[0]
      resolvedFrom = todayStr
      resolvedTo = todayStr
    } else if (dateQuickFilter === 'yesterday') {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      const yStr = y.toISOString().split('T')[0]
      resolvedFrom = yStr
      resolvedTo = yStr
    } else if (dateQuickFilter === '7days') {
      const past = new Date(now)
      past.setDate(past.getDate() - 7)
      resolvedFrom = past.toISOString().split('T')[0]
      resolvedTo = now.toISOString().split('T')[0]
    }

    if (resolvedFrom) params.set('date_from', resolvedFrom)
    if (resolvedTo) params.set('date_to', resolvedTo)
    if (truckFilter) params.set('truck', truckFilter)
    if (barangayFilter) params.set('barangay', barangayFilter)
    if (fillFilter) params.set('fill_level', fillFilter)

    api.get(`/api/dumpsite/dumpsites/${siteId}/deliveries/?${params}`)
      .then(res => {
        if (Array.isArray(res.data)) {
          setLogs(res.data)
          setTotalCount(res.data.length)
          setTotalPages(1)
        } else {
          setLogs(res.data?.results || [])
          setTotalCount(res.data?.count || 0)
          setTotalPages(res.data?.total_pages || 1)
        }
        setLoading(false)
      })
      .catch(() => {
        setLogs([])
        setTotalCount(0)
        setTotalPages(1)
        setLoading(false)
      })
  }

  // Filter buttons call this: restart from the first page
  const applyFilters = () => {
    if (page === 1) fetchLogs(1)
    else setPage(1)
  }

  useEffect(() => {
    if (siteId) fetchLogs()
  }, [siteId, dateQuickFilter, page])

  // Filter logs locally by search query
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs
    const q = searchQuery.toLowerCase()
    return logs.filter(l =>
      (l.truck_plate && l.truck_plate.toLowerCase().includes(q)) ||
      (l.driver_name && l.driver_name.toLowerCase().includes(q)) ||
      (l.barangay_name && l.barangay_name.toLowerCase().includes(q)) ||
      (l.remarks && l.remarks.toLowerCase().includes(q))
    )
  }, [logs, searchQuery])

  // KPI calculations
  const stats = useMemo(() => {
    const totalDeliveries = filteredLogs.length
    const totalKg = filteredLogs.reduce((acc, l) => acc + (Number(l.estimated_kg) || 0), 0)
    const totalTons = (totalKg / 1000).toFixed(1)
    const verifiedCount = filteredLogs.filter(l => l.is_validated).length
    const verifiedRate = totalDeliveries > 0 ? Math.round((verifiedCount / totalDeliveries) * 100) : 0
    const incidentCount = filteredLogs.reduce((acc, l) => acc + (Number(l.incident_count) || (l.fill_level === 'overflowing' ? 1 : 0)), 0)

    return { totalDeliveries, totalKg, totalTons, verifiedRate, incidentCount }
  }, [filteredLogs])

  // Unique barangays for dropdown filter
  const barangayOptions = useMemo(() => {
    const set = new Set()
    logs.forEach(l => {
      if (l.barangay_name) set.add(l.barangay_name)
    })
    return Array.from(set).sort()
  }, [logs])

  // CSV Export
  const handleExportCSV = () => {
    if (!filteredLogs.length) return
    const headers = ['ID', 'Date', 'Time', 'Truck Plate', 'Driver', 'Barangay', 'Fill Level', 'Est KG', 'Gross Weight', 'Verified', 'Remarks']
    const rows = filteredLogs.map(l => [
      l.id,
      l.date || '',
      l.arrival_time || '',
      `"${l.truck_plate || ''}"`,
      `"${l.driver_name || ''}"`,
      `"${l.barangay_name || ''}"`,
      l.fill_level || '',
      l.estimated_kg || '',
      l.gross_weight || '',
      l.is_validated ? 'YES' : 'NO',
      `"${(l.remarks || '').replace(/"/g, '""')}"`,
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `dumpsite_collection_logs_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleResetFilters = () => {
    setSearchQuery('')
    setDateQuickFilter('all')
    setDateFrom('')
    setDateTo('')
    setTruckFilter('')
    setBarangayFilter('')
    setFillFilter('')
    if (siteId) {
      setLoading(true)
      api.get(`/api/dumpsite/dumpsites/${siteId}/deliveries/`)
        .then(res => { setLogs(res.data || []); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }

  return (
    <>
      <style>{`
        .cl-container {
          max-width: 1240px;
          margin: 0 auto;
          padding: 20px 24px 60px;
        }
        .cl-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.02);
        }
        .cl-quick-btn {
          padding: 6px 12px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-muted);
          transition: all 0.15s ease;
        }
        .cl-quick-btn.active {
          background: #10b981;
          color: #ffffff;
          border-color: #10b981;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        }
        .cl-log-row {
          transition: background 0.15s ease;
        }
        .cl-log-row:hover {
          background: var(--surface-2, rgba(0,0,0,0.02)) !important;
        }
      `}</style>

      <div className="cl-container">
        {/* ── TOP HEADER ── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 20,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text)' }}>
                Collection Logs
              </h1>
              <span style={{
                background: 'rgba(16, 185, 129, 0.1)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 20,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <MapPin size={11} /> {siteName}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Real-time audit log of truck arrivals, waste volume measurements, and disposal verification
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={fetchLogs}
              title="Refresh Logs"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '10px 14px',
                color: 'var(--text-muted)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <RefreshCw size={15} /> Refresh
            </button>

            <button
              onClick={handleExportCSV}
              disabled={!filteredLogs.length}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '10px 14px',
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 700,
                cursor: filteredLogs.length ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                opacity: filteredLogs.length ? 1 : 0.5,
              }}
            >
              <Download size={15} /> Export CSV
            </button>

            <button
              onClick={() => setLogOpen(true)}
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 12,
                padding: '10px 18px',
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
              }}
            >
              <Plus size={16} strokeWidth={2.5} /> Log Truck Arrival
            </button>
          </div>
        </div>

        {/* ── KPI METRICS STRIP ── */}
        {loading && logs.length === 0 ? (
          <StatCardSkeleton count={4} style={{ marginBottom: 20 }} />
        ) : (
        <div className="ww-fade-in" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
          marginBottom: 20,
        }}>
          {/* Deliveries */}
          <div className="cl-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Truck size={22} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Total Deliveries
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginTop: 1 }}>
                {stats.totalDeliveries}
              </div>
            </div>
          </div>

          {/* Waste Received */}
          <div className="cl-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(16, 185, 129, 0.1)', color: '#10b981',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Scale size={22} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Total Waste Inflow
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981', marginTop: 1 }}>
                {stats.totalTons} <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Tons ({stats.totalKg.toLocaleString()} kg)</span>
              </div>
            </div>
          </div>

          {/* Verification Rate */}
          <div className="cl-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(147, 51, 234, 0.1)', color: '#9333ea',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ShieldCheck size={22} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Verification Rate
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#9333ea', marginTop: 1 }}>
                {stats.verifiedRate}%
              </div>
            </div>
          </div>

          {/* Incidents Flagged */}
          <div className="cl-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: stats.incidentCount > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(100, 116, 139, 0.1)',
              color: stats.incidentCount > 0 ? '#ef4444' : '#64748b',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertTriangle size={22} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Flagged Incidents
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: stats.incidentCount > 0 ? '#ef4444' : 'var(--text)', marginTop: 1 }}>
                {stats.incidentCount}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ── ADVANCED FILTERS BAR ── */}
        <div className="cl-card" style={{ padding: '16px 20px', marginBottom: 20 }}>
          {/* Top row: search + quick date presets */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 14,
          }}>
            {/* Search Input */}
            <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search truck plate, driver, or barangay…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 36px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2, #ffffff)',
                  color: 'var(--text)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>

            {/* Quick Date Presets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginRight: 4 }}>
                Date:
              </span>
              {[
                { id: 'all', label: 'All Records' },
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: '7days', label: 'Last 7 Days' },
                { id: 'custom', label: 'Custom Range' },
              ].map(preset => (
                <button
                  key={preset.id}
                  onClick={() => setDateQuickFilter(preset.id)}
                  className={`cl-quick-btn ${dateQuickFilter === preset.id ? 'active' : ''}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Secondary filter inputs row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
            alignItems: 'end',
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
          }}>
            {/* Custom Date From/To if active */}
            {dateQuickFilter === 'custom' && (
              <>
                <div>
                  <label style={filterLabel}>Date From</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={filterLabel}>Date To</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </>
            )}

            {/* Truck Filter */}
            <div>
              <label style={filterLabel}>Truck Plate</label>
              <input
                type="text"
                placeholder="e.g. TRK-01"
                value={truckFilter}
                onChange={e => setTruckFilter(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Barangay Filter */}
            <div>
              <label style={filterLabel}>Barangay</label>
              <select
                value={barangayFilter}
                onChange={e => setBarangayFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Barangays</option>
                {barangayOptions.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Fill Level Filter */}
            <div>
              <label style={filterLabel}>Fill Capacity</label>
              <select
                value={fillFilter}
                onChange={e => setFillFilter(e.target.value)}
                style={inputStyle}
              >
                <option value="">All Fill Levels</option>
                {Object.entries(FILL_CONFIG).map(([key, item]) => (
                  <option key={key} value={key}>{item.label}</option>
                ))}
              </select>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={applyFilters}
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  borderRadius: 10,
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Apply
              </button>
              <button
                onClick={handleResetFilters}
                style={{
                  padding: '9px 12px',
                  borderRadius: 10,
                  background: 'var(--surface-2, rgba(0,0,0,0.04))',
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* ── LOGS TABLE / FEED ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            Delivery Records
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
            <span>
              Showing <strong style={{ color: 'var(--text)' }}>{totalCount === 0 ? 0 : (page - 1) * 10 + 1}–{Math.min(page * 10, totalCount)}</strong> of <strong style={{ color: 'var(--text)' }}>{totalCount}</strong>
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
              {filteredLogs.length}/{totalCount}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : filteredLogs.length === 0 ? (
          <div className="cl-card" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <div style={{
              width: 54, height: 54, borderRadius: '50%',
              background: 'var(--surface-2, rgba(0,0,0,0.05))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 14px', color: 'var(--text-muted)',
            }}>
              <FileText size={26} />
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px', color: 'var(--text)' }}>
              No Collection Logs Found
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 360, margin: '0 auto 18px' }}>
              No truck deliveries matched the selected dates and search filters. Try clearing filters or record a new truck arrival.
            </p>
            <button
              onClick={handleResetFilters}
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          <div className="cl-card ww-fade-in" style={{ overflow: 'hidden' }}>
            {/* Table Header Row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px, 1.2fr) minmax(130px, 1fr) 140px 120px 100px 90px 40px',
              padding: '12px 18px',
              background: 'var(--surface-2, rgba(0,0,0,0.02))',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
              fontWeight: 800,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              <span>Truck & Driver</span>
              <span>Barangay</span>
              <span>Fill Capacity</span>
              <span>Estimated KG</span>
              <span>Time / Date</span>
              <span>Status</span>
              <span></span>
            </div>

            {/* Rows List */}
            {filteredLogs.map(log => {
              const isExpanded = expanded === log.id

              return (
                <div key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <div
                    onClick={() => setExpanded(isExpanded ? null : log.id)}
                    className="cl-log-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(180px, 1.2fr) minmax(130px, 1fr) 140px 120px 100px 90px 40px',
                      padding: '14px 18px',
                      cursor: 'pointer',
                      alignItems: 'center',
                      background: isExpanded ? 'rgba(37, 99, 235, 0.03)' : 'transparent',
                    }}
                  >
                    {/* Truck & Driver */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          background: 'rgba(37, 99, 235, 0.08)',
                          color: '#2563eb',
                          border: '1px solid rgba(37, 99, 235, 0.2)',
                          borderRadius: 6,
                          padding: '2px 6px',
                          fontSize: 11,
                          fontWeight: 800,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <Truck size={11} /> {log.truck_plate || 'TRUCK'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                        {log.driver_name || 'Driver Not Stated'}
                      </div>
                    </div>

                    {/* Barangay */}
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {log.barangay_name || '—'}
                    </div>

                    {/* Fill Level */}
                    <div>
                      <FillLevelBadge level={log.fill_level} />
                    </div>

                    {/* Estimated KG */}
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#10b981' }}>
                        {Number(log.estimated_kg || 0).toLocaleString()} <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>kg</span>
                      </span>
                    </div>

                    {/* Time / Date */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                        {log.arrival_time ? log.arrival_time.substring(0, 5) : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {log.date || ''}
                      </div>
                    </div>

                    {/* Status */}
                    <div>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: 20,
                        background: log.is_validated ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                        color: log.is_validated ? '#10b981' : '#f59e0b',
                        border: `1px solid ${log.is_validated ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                      }}>
                        {log.is_validated ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                        {log.is_validated ? 'Verified' : 'Logged'}
                      </span>
                    </div>

                    {/* Expand icon */}
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>

                  {/* Expanded Inspection Drawer */}
                  {isExpanded && (
                    <div style={{
                      padding: '16px 20px',
                      background: 'var(--surface-2, rgba(0,0,0,0.02))',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 24,
                      alignItems: 'flex-start',
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, flex: 1 }}>
                        <div>
                          <div style={detailLabel}>Gross Scale Weight</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                            {log.gross_weight ? `${Number(log.gross_weight).toLocaleString()} kg` : 'Not recorded'}
                          </div>
                        </div>

                        <div>
                          <div style={detailLabel}>Collection Route Area</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                            {log.schedule_area || log.barangay_name || 'Standard Route'}
                          </div>
                        </div>

                        <div>
                          <div style={detailLabel}>Incidents Reported</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: log.incident_count > 0 ? '#ef4444' : '#10b981' }}>
                            {log.incident_count ? `${log.incident_count} Incidents` : 'None Flagged'}
                          </div>
                        </div>

                        {log.remarks && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <div style={detailLabel}>Inspector Remarks</div>
                            <div style={{ fontSize: 13, color: 'var(--text)', background: 'var(--surface)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                              {log.remarks}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Photo Evidence Thumbnail with Lightbox */}
                      {log.photo && (
                        <div>
                          <div style={detailLabel}>Visual Inspection Photo</div>
                          <div
                            onClick={() => setPhotoPreview(log.photo)}
                            style={{
                              position: 'relative',
                              width: 100,
                              height: 75,
                              borderRadius: 10,
                              overflow: 'hidden',
                              border: '1.5px solid var(--border)',
                              cursor: 'pointer',
                            }}
                          >
                            <img
                              src={log.photo}
                              alt="Truck collection evidence"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            <div style={{
                              position: 'absolute', inset: 0,
                              background: 'rgba(0,0,0,0.3)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', opacity: 0, transition: 'opacity 0.2s',
                            }}
                              onMouseOver={e => e.currentTarget.style.opacity = '1'}
                              onMouseOut={e => e.currentTarget.style.opacity = '0'}
                            >
                              <Maximize2 size={16} />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Quick Action Button */}
                      <div style={{ alignSelf: 'center' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate('/dumpsite/queue')
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: 10,
                            padding: '8px 14px',
                            color: '#ef4444',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <AlertTriangle size={14} /> Flag Incident
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={10}
          onPageChange={setPage}
          loading={loading}
          style={{ margin: 16 }}
        />
      </div>

      {/* ── PHOTO LIGHTBOX PREVIEW MODAL ── */}
      {photoPreview && (
        <div
          onClick={() => setPhotoPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: 720,
              width: '100%',
              background: 'var(--surface)',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 18px',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
                Inspection Photographic Proof
              </span>
              <button
                onClick={() => setPhotoPreview(null)}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--text-muted)', cursor: 'pointer', padding: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>
            <img
              src={photoPreview}
              alt="Full inspection preview"
              style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', background: '#000000' }}
            />
          </div>
        </div>
      )}

      {/* ── LOG ARRIVAL MODAL ── */}
      <ArrivalLogger
        open={logOpen}
        onClose={(refresh) => {
          setLogOpen(false)
          if (refresh) fetchLogs()
        }}
      />
    </>
  )
}

// ─── STYLES & HELPERS ─────────────────────────────────────────────────────────

const filterLabel = {
  display: 'block',
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
}

const detailLabel = {
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface-2, #ffffff)',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
}
