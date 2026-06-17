import { useState, useEffect } from 'react'
import api from '../../api/client'

const PERIOD_OPTS = [
  { value: 'day',   label: 'Today' },
  { value: 'week',  label: 'This Week' },
  { value: 'month', label: 'This Month' },
]

export default function BarangayBreakdown() {
  const [siteId,  setSiteId]  = useState(null)
  const [period,  setPeriod]  = useState('day')
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/api/dumpsite/dumpsites/').then(res => {
      if (res.data.length > 0) setSiteId(res.data[0].id)
    })
  }, [])

  useEffect(() => {
    if (!siteId) return
    setLoading(true)
    api.get(`/api/dumpsite/dumpsites/${siteId}/barangay_breakdown/?period=${period}`)
      .then(res => { setData(res.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [siteId, period])

  const maxKg = data.reduce((m, d) => Math.max(m, d.total_kg), 0)

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--surface-3)' }}>Barangay Breakdown</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: 2 }}>Waste collected by barangay, sorted by volume</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '4px' }}>
          {PERIOD_OPTS.map(o => (
            <button key={o.value} onClick={() => setPeriod(o.value)}
              style={{
                padding: '6px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                border: 'none', cursor: 'pointer',
                background: period === o.value ? 'var(--accent)' : 'transparent',
                color: period === o.value ? '#0d1117' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}>
              {o.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading...</div>
      ) : data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', border: '2px dashed var(--border)', borderRadius: 20, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
          <p style={{ fontWeight: 600 }}>No data for this period.</p>
        </div>
      ) : (
        <>
          {/* Bar Chart */}
          <div className="card-light" style={{ padding: '1.5rem', borderRadius: 24, marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {data.map((row, i) => {
                const pct = maxKg > 0 ? (row.total_kg / maxKg) * 100 : 0
                const barColor = i === 0 ? '#22c55e' : i === 1 ? '#3b82f6' : i === 2 ? '#a855f7' : '#64748b'
                return (
                  <div key={row.barangay}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, fontWeight: 700 }}>
                      <span style={{ color: 'var(--surface-3)' }}>{row.barangay}</span>
                      <span style={{ color: barColor }}>{row.total_kg.toLocaleString()} kg</span>
                    </div>
                    <div style={{ height: 10, background: 'rgba(148,163,184,0.1)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`, background: barColor,
                        borderRadius: 8, transition: 'width 0.5s ease',
                        boxShadow: `0 0 8px ${barColor}44`,
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Table */}
          <div className="card-light" style={{ borderRadius: 20, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', padding: '0.6rem 1rem', background: 'var(--surface-1)', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }}>
              <span>Barangay</span><span>Total KG</span><span>Truck Trips</span>
            </div>
            {data.map((row, i) => (
              <div key={row.barangay} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 8, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>{row.barangay}</span>
                </div>
                <div style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '0.9rem' }}>{row.total_kg.toLocaleString()} kg</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>🚛 {row.truck_count}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
