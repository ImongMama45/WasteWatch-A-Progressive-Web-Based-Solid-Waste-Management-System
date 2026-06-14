/**
 * PerformanceAnalytics.jsx
 * -------------------------
 * Dynamic performance analytics powered by database records.
 * Provides fleet efficiency and barangay-level service metrics.
 */

import { useState, useEffect } from 'react'
import api from '../../api/client'

// ── Section card primitive ───────────────────────────────────────────────────

function PaCard({ icon, iconVariant, title, subtitle, children }) {
  return (
    <div className="ac-card">
      <div className="ac-card-head">
        <div className="ac-card-left">
          {icon && (
            <div className={`ac-card-icon${iconVariant ? ` ac-card-icon--${iconVariant}` : ''}`}>
              <span className="msi" style={{ fontSize: 18 }}>{icon}</span>
            </div>
          )}
          <div className="ac-card-titles">
            {title && <div className="ac-card-title">{title}</div>}
            {subtitle && <div className="ac-card-sub">{subtitle}</div>}
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PerformanceAnalytics({ selectedBarangay, dateFrom, dateTo, selectedRoute }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchPerformance() {
      setLoading(true)
      try {
        const res = await api.get('/api/analytics/dashboard/', {
          params: {
            barangay_id: selectedBarangay,
            date_from: dateFrom,
            date_to: dateTo,
            route: selectedRoute
          }
        })
        setData(res.data)
      } catch (err) {
        console.error("Failed to fetch performance data:", err)
      } finally {
        setLoading(false)
      }
    }
    fetchPerformance()
  }, [selectedBarangay, dateFrom, dateTo, selectedRoute])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ margin: '0 auto 12px' }} />
      Loading performance analytics…
    </div>
  )

  if (!data) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
      No data available for the selected filters.
    </div>
  )

  const { summary, fleet, barangays } = data

  const cards = [
    {
      id: 'waste-collected',
      label: 'Total Waste Collected',
      value: `${((summary.waste_collected_kg || 0) / 1000).toFixed(1)}`,
      unit: 't',
      sub: `${(summary.waste_collected_kg || 0).toLocaleString()} kg this period`,
      icon: 'scale',
      variant: 'blue',
    },
    {
      id: 'route-completion',
      label: 'Route Completion Rate',
      value: summary.completion_rate || 0,
      unit: '%',
      sub: `${summary.completed_routes || 0} of ${summary.total_trips || 0} routes done`,
      icon: 'route',
      variant: (summary.completion_rate || 0) >= 85 ? 'green' : (summary.completion_rate || 0) >= 65 ? 'amber' : 'red',
      bar: summary.completion_rate || 0,
    },
    {
      id: 'report-resolution',
      label: 'Report Resolution Rate',
      value: summary.resolution_rate || 0,
      unit: '%',
      sub: `${summary.resolved_reports || 0} of ${summary.total_reports || 0} reports resolved`,
      icon: 'task_alt',
      variant: (summary.resolution_rate || 0) >= 80 ? 'green' : (summary.resolution_rate || 0) >= 60 ? 'amber' : 'red',
      bar: summary.resolution_rate || 0,
    },
  ]

  return (
    <>
      <div className="ac-kpi-grid ac-kpi-grid--3" style={{ marginBottom: 20 }}>
        {cards.map(c => (
          <div key={c.id} className={`ac-kpi-card ac-kpi-card--${c.variant} ac-kpi-card--v2`}>
            <div className="ac-kpi-v2-glow" />
            <div className="ac-kpi-v2-head">
              <div className="ac-kpi-icon">
                <span className="msi" style={{ fontSize: 18 }}>{c.icon}</span>
              </div>
              <span className="ac-kpi-label">{c.label}</span>
            </div>
            <div className="ac-kpi-v2-val-row">
              <span className="ac-kpi-value">{c.value}</span>
              {c.unit && <span className="ac-kpi-v2-unit">{c.unit}</span>}
            </div>
            {c.bar !== undefined && (
              <div className="ac-kpi-v2-track">
                <div
                  className="ac-kpi-v2-fill"
                  style={{ width: `${Math.min(c.bar, 100)}%` }}
                />
              </div>
            )}
            <div className="ac-kpi-v2-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <PaCard icon="emoji_events" iconVariant="blue" title="Fleet Performance Leaderboard" subtitle="Per-vehicle score · routes & waste collected">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fleet.map((t, i) => {
              const score = t.routes_count > 0 ? Math.round((t.completed_count / t.routes_count) * 100) : 0
              return (
                <div key={t.plate_number} style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <div style={{ fontWeight: 800, color: 'var(--text-muted)', fontSize: 11 }}>#{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{t.plate_number}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.driver__full_name}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)' }}>{score}</div>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>SCORE</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                    <span><strong>{t.completed_count}</strong>/{t.routes_count} Routes</span>
                    <span><strong>{t.total_kg?.toLocaleString() || 0}</strong> kg</span>
                  </div>
                </div>
              )
            })}
          </div>
        </PaCard>

        <PaCard icon="leaderboard" iconVariant="red" title="Barangay Performance" subtitle="Report resolution and waste generation">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {barangays.map((b, i) => {
              const resRate = b.reports_count > 0 ? Math.round((b.resolved_count / b.reports_count) * 100) : 0
              return (
                <div key={b.name} style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 11, padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{b.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)' }}>{resRate}%</span>
                  </div>
                  <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                    <div style={{ width: `${resRate}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 9, color: 'var(--text-muted)' }}>
                    <span>{b.reports_count} Reports</span>
                    <span>{b.resolved_count} Resolved</span>
                    <span>{b.total_kg?.toLocaleString() || 0} kg Waste</span>
                  </div>
                </div>
              )
            })}
          </div>
        </PaCard>
      </div>
    </>
  )
}
