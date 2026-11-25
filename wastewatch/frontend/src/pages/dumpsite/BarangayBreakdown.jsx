import { useState, useEffect } from 'react'
import { BarChart3, Truck, AlertCircle } from 'lucide-react'
import { getDumpsiteBarangayBreakdown, unwrapList } from '../../api/dumpsiteApi'
import TrucksOverlay from './components/TrucksOverlay'
import FacilityWorkspaceHeader from './components/FacilityWorkspaceHeader'
import { useFacilityScope } from './components/useFacilityScope'
import { ChartSkeleton, TableSkeleton } from '../../components/ui/Skeleton'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

const PERIOD_OPTS = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
]

export default function BarangayBreakdown() {
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()
  const [period, setPeriod] = useState('day')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [overlayOpen, setOverlayOpen] = useState(false)

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    getDumpsiteBarangayBreakdown(siteId, { period })
      .then((raw) => {
        setData(unwrapList(raw))
        setLoading(false)
      })
      .catch((err) => {
        setError(getApiErrorMessage(err, 'Failed to load barangay breakdown.'))
        setData([])
        setLoading(false)
      })
  }, [siteId, period, scopeLoading])

  const maxKg = data.reduce((m, d) => Math.max(m, Number(d.total_kg) || 0), 0)

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Barangay Breakdown"
          subtitle="Waste collected and received by barangay for this facility, sorted by volume."
          sites={sites}
          siteId={siteId}
          onSiteChange={setSiteId}
          activeSite={activeSite}
          isAdmin={isAdmin}
          rightContent={
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setOverlayOpen(true)}
                disabled={!siteId}
                style={{
                  background: '#ffffff',
                  border: '1px solid #ced0d4',
                  color: '#1c1e21',
                  borderRadius: 6,
                  height: 36,
                  padding: '0 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: siteId ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Truck size={14} /> Assigned Trucks
              </button>

              <div style={{ display: 'inline-flex', gap: 4, background: '#f0f2f5', border: '1px solid #e4e6eb', borderRadius: 8, padding: 3 }}>
                {PERIOD_OPTS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setPeriod(o.value)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      border: 'none',
                      cursor: 'pointer',
                      background: period === o.value ? '#16a34a' : 'transparent',
                      color: period === o.value ? '#ffffff' : '#65676b',
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        {(scopeError || error) && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <AlertCircle size={16} />
            <span>{scopeError || error}</span>
          </div>
        )}

        {loading || scopeLoading ? (
          <div>
            <ChartSkeleton height={220} variant="bar" style={{ marginBottom: 16 }} />
            <TableSkeleton rows={5} cols={3} />
          </div>
        ) : data.length === 0 ? (
          <div className="ww-fade-in" style={{ background: '#ffffff', textAlign: 'center', padding: '3rem', border: '1px dashed #ced0d4', borderRadius: 10, color: '#65676b' }}>
            <BarChart3 size={36} style={{ margin: '0 auto 8px', opacity: 0.45 }} />
            <p style={{ fontWeight: 600, margin: 0, color: '#1c1e21' }}>No barangay delivery data for this period.</p>
          </div>
        ) : (
          <div className="ww-fade-in">
            <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '18px 20px', marginBottom: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.map((row, i) => {
                  const totalKg = Number(row.total_kg) || 0
                  const pct = maxKg > 0 ? (totalKg / maxKg) * 100 : 0
                  const barColor = i === 0 ? '#16a34a' : i === 1 ? '#2563eb' : i === 2 ? '#7c3aed' : '#64748b'
                  return (
                    <div key={row.barangay}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>
                        <span style={{ color: '#1c1e21' }}>{row.barangay}</span>
                        <span style={{ color: barColor }}>{totalKg.toLocaleString()} kg</span>
                      </div>
                      <div style={{ height: 10, background: '#f0f2f5', borderRadius: 6, overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: barColor,
                            borderRadius: 6,
                            transition: 'width 0.5s ease',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e4e6eb', textAlign: 'left', color: '#65676b', fontSize: 11, textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 16px' }}>Barangay</th>
                      <th style={{ padding: '10px 16px' }}>Total KG</th>
                      <th style={{ padding: '10px 16px' }}>Truck Trips</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => (
                      <tr key={row.barangay} style={{ borderBottom: '1px solid #f0f2f5' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1c1e21' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ width: 22, height: 22, borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              {i + 1}
                            </span>
                            {row.barangay}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#16a34a' }}>
                          {Number(row.total_kg || 0).toLocaleString()} kg
                        </td>
                        <td style={{ padding: '12px 16px', color: '#65676b' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Truck size={14} /> {row.truck_count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <TrucksOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} siteId={siteId} />
      </div>
    </div>
  )
}
