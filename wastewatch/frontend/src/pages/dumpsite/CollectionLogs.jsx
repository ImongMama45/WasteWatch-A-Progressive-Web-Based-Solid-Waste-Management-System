import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'

const FILL_LABELS = {
  nearly_empty:   { label: 'Nearly Empty', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  quarter:        { label: 'Quarter',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  half:           { label: 'Half',          color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  three_quarters: { label: 'Three Quarters',color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  full:           { label: 'Full',          color: '#a16207', bg: 'rgba(161,98,7,0.12)' },
  overflowing:    { label: 'Overflowing',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
}

function FillBadge({ level }) {
  const f = FILL_LABELS[level]
  if (!f) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
  return (
    <span style={{
      background: f.bg, color: f.color, border: `1px solid ${f.color}44`,
      borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700,
    }}>{f.label}</span>
  )
}

export default function CollectionLogs() {
  const navigate   = useNavigate()
  const [siteId,   setSiteId]   = useState(null)
  const [logs,     setLogs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState(null)

  // Filters
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [truck,      setTruck]      = useState('')
  const [barangay,   setBarangay]   = useState('')
  const [fillFilter, setFillFilter] = useState('')

  useEffect(() => {
    api.get('/api/dumpsite/dumpsites/').then(res => {
      if (res.data.length > 0) setSiteId(res.data[0].id)
    })
  }, [])

  const fetchLogs = () => {
    if (!siteId) return
    setLoading(true)
    const params = new URLSearchParams()
    if (dateFrom)   params.set('date_from', dateFrom)
    if (dateTo)     params.set('date_to', dateTo)
    if (truck)      params.set('truck', truck)
    if (barangay)   params.set('barangay', barangay)
    if (fillFilter) params.set('fill_level', fillFilter)

    api.get(`/api/dumpsite/dumpsites/${siteId}/deliveries/?${params}`)
      .then(res => { setLogs(res.data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { if (siteId) fetchLogs() }, [siteId])

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--surface-3)' }}>Collection Logs</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: 2 }}>All recorded truck arrivals at this site</p>
        </div>
        <button
          onClick={() => navigate('/dumpsite/log-arrival')}
          style={{ background: 'var(--accent)', color: '#0d1117', border: 'none', borderRadius: 14, padding: '0.7rem 1.25rem', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer' }}
        >
          + Log Arrival
        </button>
      </header>

      {/* Filters */}
      <div className="card-light" style={{ padding: '1rem 1.25rem', borderRadius: 18, marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
        <div>
          <div style={filterLabel}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={filterInput} />
        </div>
        <div>
          <div style={filterLabel}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={filterInput} />
        </div>
        <div>
          <div style={filterLabel}>Truck Plate</div>
          <input type="text" placeholder="e.g. ABC-123" value={truck} onChange={e => setTruck(e.target.value)} style={filterInput} />
        </div>
        <div>
          <div style={filterLabel}>Barangay</div>
          <input type="text" placeholder="Search..." value={barangay} onChange={e => setBarangay(e.target.value)} style={filterInput} />
        </div>
        <div>
          <div style={filterLabel}>Fill Level</div>
          <select value={fillFilter} onChange={e => setFillFilter(e.target.value)} style={filterInput}>
            <option value="">All</option>
            {Object.entries(FILL_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <button onClick={fetchLogs} style={{ background: 'var(--accent)', color: '#0d1117', border: 'none', borderRadius: 10, padding: '0.55rem 1rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}>
          Search
        </button>
        <button onClick={() => { setDateFrom(''); setDateTo(''); setTruck(''); setBarangay(''); setFillFilter('') }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 10, padding: '0.55rem 1rem', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
          Clear
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading...</div>
      ) : logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', border: '2px dashed var(--border)', borderRadius: 18, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <p style={{ fontWeight: 600 }}>No logs found for these filters.</p>
        </div>
      ) : (
        <div className="card-light" style={{ borderRadius: 20, overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 130px 110px 110px 80px 50px', padding: '0.65rem 1rem', background: 'var(--surface-1)', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }}>
            <span>Truck / Driver</span><span>Barangay</span><span>Fill Level</span><span>Est. KG</span><span>Time</span><span>Status</span><span></span>
          </div>

          {logs.map(log => (
            <div key={log.id}>
              <div
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 130px 110px 110px 80px 50px',
                  padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer', transition: 'background 0.15s',
                  background: expanded === log.id ? 'var(--surface-1)' : 'transparent',
                }}
                onMouseOver={e => { if (expanded !== log.id) e.currentTarget.style.background = 'rgba(148,163,184,0.04)' }}
                onMouseOut={e => { if (expanded !== log.id) e.currentTarget.style.background = 'transparent' }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{log.truck_plate || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.driver_name}</div>
                </div>
                <div style={{ fontSize: '0.875rem', alignSelf: 'center' }}>{log.barangay_name || '—'}</div>
                <div style={{ alignSelf: 'center' }}><FillBadge level={log.fill_level} /></div>
                <div style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '0.9rem', alignSelf: 'center' }}>
                  {Number(log.estimated_kg).toLocaleString()} kg
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                  {log.arrival_time ? new Date(`1970-01-01T${log.arrival_time}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : log.date}
                </div>
                <div style={{ alignSelf: 'center' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: log.is_validated ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                    color: log.is_validated ? '#22c55e' : '#f59e0b',
                  }}>
                    {log.is_validated ? 'Verified' : 'Logged'}
                  </span>
                </div>
                <div style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: 16 }}>
                  {expanded === log.id ? '▲' : '▼'}
                </div>
              </div>

              {/* Expanded row */}
              {expanded === log.id && (
                <div style={{ padding: '1rem 1.25rem', background: 'rgba(148,163,184,0.04)', borderBottom: '1px solid var(--border)', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  <Detail label="Schedule Area" value={log.schedule_area || '—'} />
                  <Detail label="Gross Weight" value={`${log.gross_weight} kg`} />
                  <Detail label="Incidents Flagged" value={log.incident_count || 0} />
                  {log.remarks && <Detail label="Remarks" value={log.remarks} />}
                  {log.photo && (
                    <div>
                      <div style={detailLabel}>Photo</div>
                      <img src={log.photo} alt="Proof" style={{ width: 80, height: 60, borderRadius: 8, objectFit: 'cover', border: '1.5px solid var(--border)' }} />
                    </div>
                  )}
                  <button
                    onClick={() => navigate(`/dumpsite/logs`)}
                    style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontWeight: 700, alignSelf: 'flex-start', marginTop: 16 }}
                  >
                    ⚠️ Flag Incident
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div>
      <div style={detailLabel}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--surface-3)' }}>{value}</div>
    </div>
  )
}

const detailLabel = { fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }
const filterLabel = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }
const filterInput = {
  padding: '0.5rem 0.75rem', borderRadius: 10, border: '1.5px solid var(--border)',
  background: 'var(--surface-1)', color: 'var(--surface-3)', fontSize: '0.875rem',
}
