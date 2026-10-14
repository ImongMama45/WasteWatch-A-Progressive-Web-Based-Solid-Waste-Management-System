/**
 * GlobalInsights.jsx — Barangay Analytics (Revised)
 * ---------------------------------------------------
 * Waste Management Analytics Center for WasteWatch.
 * Pulls from existing backend: /api/analytics/kpi/, /api/analytics/barangay-performance/,
 * /api/analytics/truck-performance/, /api/analytics/trends/
 * Falls back to placeholder data while backend is being seeded.
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import BarangayRankingCard from './BarangayRankingCard'
import HotspotMap from './HotspotMap'
import { useLiveAnalytics } from './useLiveAnalytics'
import { toGlobal } from './globalMapper'
import { Trash2, CheckCircle2, Truck, Flame, AlertTriangle, Building2, BarChart2, LineChart as LineChartIcon, ClipboardCheck, Clock, XCircle, TrendingUp, MapPin, BarChart3, Flag, Hourglass, Users, Trophy, Map, ArrowRight, Search } from 'lucide-react'
import { fmtDay } from './perfMapper'

// ─── Reusable primitives ──────────────────────────────────────────────────────

function GCard({ children, style = {} }) {
  return (
    <div className="card" style={{ marginBottom: 16, ...style }}>
      {children}
    </div>
  )
}

function SHead({ icon, title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 3 }}>
          {icon}
          {title}
        </div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}


// ─── Mini bar chart ───────────────────────────────────────────────────────────
function MiniBar({ data, valueKey = 'value', color = 'var(--accent)', height = 80 }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1)
  return (
    <div className="ac-hide-scrollbar" style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height, minWidth: 'min-content' }}>
        {data.map((d, i) => {
          const val = d[valueKey] || 0
          const h = Math.max(Math.round((val / max) * (height - 18)), 4)
          const hot = val > max * 0.8
          return (
            <div key={i} style={{ flex: '1 0 35px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ fontSize: 7, color: 'var(--text-muted)', fontWeight: 600 }}>
                {val > 999 ? `${(val / 1000).toFixed(1)}k` : val}
              </div>
              <div style={{
                width: '100%', height: h, maxWidth: 35,
                background: hot ? 'var(--danger)' : color,
                borderRadius: '3px 3px 0 0', opacity: .8,
                transition: 'height .3s ease',
              }} />
              <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{d.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Mini line chart ──────────────────────────────────────────────────────────
function MiniLine({ data, valueKey = 'value', color = 'var(--accent)' }) {
  if (!data || data.length < 2) return <div style={{ height: 72, background: 'var(--surface-2)', borderRadius: 8 }} />
  const W = 300, H = 72, P = 10
  const vals = data.map(d => d[valueKey] || 0)
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals)
  const rng = max - min || 1
  const pts = vals.map((v, i) => [
    P + (i / (vals.length - 1)) * (W - P * 2),
    P + ((max - v) / rng) * (H - P * 2),
  ])
  const poly = pts.map(p => p.join(',')).join(' ')
  const area = [`M${pts[0][0]},${H}`, ...pts.map(p => `L${p[0]},${p[1]}`), `L${pts[pts.length - 1][0]},${H}`, 'Z'].join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`lg-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".18" />
          <stop offset="100%" stopColor={color} stopOpacity=".02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#lg-${valueKey})`} />
      <polyline points={poly} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
      ))}
    </svg>
  )
}

// ─── Forecast Line Chart ──────────────────────────────────────────────────────
function ForecastLine({ forecast }) {
  if (!forecast?.sufficient) {
    return (
      <GCard>
        <SHead icon={<TrendingUp size={16} />} title="7-Day Weight Forecast" subtitle="Predictive analytics" />
        <div style={{ height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', borderRadius: 12, border: '1px dashed var(--border)', color: 'var(--text-muted)' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>query_stats</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Forecast Unavailable</span>
          <span style={{ fontSize: 11, maxWidth: 200, textAlign: 'center', marginTop: 4 }}>
            {forecast?.reason === 'not_enough_data'
              ? `Requires 14 days of history (only ${forecast.days_available || 0} available).`
              : 'Not enough historical waste data to generate a forecast.'}
          </span>
        </div>
      </GCard>
    )
  }

  const { history, points } = forecast
  const allPts = [...history.map(d => d.kg), ...points.map(p => p.expected_kg)]
  const max = Math.max(...allPts, ...points.map(p => p.high_kg), 1)
  const min = Math.min(...allPts, ...points.map(p => p.low_kg), 0)
  const rng = max - min || 1

  const W = 350, H = 140, P = 14

  const getX = i => P + (i / (allPts.length - 1)) * (W - P * 2)
  const getY = v => P + ((max - v) / rng) * (H - P * 2)

  const histPts = history.map((d, i) => [getX(i), getY(d.kg)])
  const forcPts = points.map((d, i) => [getX(history.length + i), getY(d.expected_kg)])

  const histPoly = histPts.map(p => p.join(',')).join(' ')
  const forcPoly = [histPts[histPts.length - 1], ...forcPts].map(p => p.join(',')).join(' ')

  const bandPts = [
    histPts[histPts.length - 1],
    ...points.map((p, i) => [getX(history.length + i), getY(p.high_kg)]),
    ...[...points].reverse().map((p, i) => [getX(history.length + points.length - 1 - i), getY(p.low_kg)]),
    histPts[histPts.length - 1]
  ]
  const bandPoly = bandPts.map(p => p.join(',')).join(' ')

  return (
    <GCard>
      <SHead icon={<TrendingUp size={16} />} title="7-Day Weight Forecast" subtitle="Expected tonnage (80% confidence)" />
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
          {/* Background grid */}
          {[0, 0.5, 1].map((t, i) => {
            const y = P + t * (H - P * 2)
            const v = Math.round(max - t * rng)
            return (
              <g key={i}>
                <line x1={P} y1={y} x2={W - P} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="4,4" />
                <text x={P - 4} y={y + 3} fontSize="8" fill="var(--text-muted)" textAnchor="end">{v > 999 ? `${(v / 1000).toFixed(1)}k` : v}</text>
              </g>
            )
          })}

          {/* Confidence Band */}
          <polygon points={bandPoly} fill="var(--warning)" opacity="0.15" />

          {/* History Line */}
          <polyline points={histPoly} fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Forecast Line */}
          <polyline points={forcPoly} fill="none" stroke="var(--warning)" strokeWidth="2.5" strokeDasharray="6,4" strokeLinecap="round" strokeLinejoin="round" />

          {/* Forecast Dots */}
          {forcPts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="var(--warning)" stroke="var(--surface)" strokeWidth="1.5" />
          ))}
          <circle cx={histPts[histPts.length - 1][0]} cy={histPts[histPts.length - 1][1]} r="3.5" fill="var(--text-muted)" stroke="var(--surface)" strokeWidth="1.5" />
        </svg>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
        <span>{fmtDay(history[0].date)}</span>
        <span style={{ color: 'var(--text)' }}>Today</span>
        <span style={{ color: 'var(--warning)' }}>{fmtDay(points[points.length - 1].date)}</span>
      </div>
    </GCard>
  )
}



// ─── Overview KPIs ────────────────────────────────────────────────────────────
function OverviewKPIs({ kpi }) {
  const CARDS = [
    { label: 'Total Waste Collected', value: `${kpi.collected_kg?.toLocaleString() ?? '—'} kg`, delta: kpi.collected_kg_delta, sub: 'all recorded weight (unvalidated included)', icon: Trash2, color: 'var(--accent)' },
    { label: 'Collection Rate', value: kpi.collection_rate == null ? '—' : `${kpi.collection_rate}%`, delta: kpi.collection_rate_delta, icon: CheckCircle2, color: 'var(--accent)' },
    { label: 'Active Trucks', value: kpi.active_trucks ?? '—', delta: null, icon: Truck, color: 'var(--info)' },
    { label: 'Open Hotspots (All Time)', value: kpi.open_hotspots ?? '—', delta: kpi.hotspots_delta, icon: Flame, color: 'var(--danger)' },
    // Escalations omitted until backend supplies the field — was showing hard-coded 3
    { label: 'Barangays Served', value: kpi.barangays_served, hide: kpi.barangays_served == null, icon: Building2, color: 'var(--accent)', delta: null },
  ]

  return (
    <div className="ac-hide-scrollbar" style={{ display: 'flex', gap: 10, marginBottom: 16, overflowX: 'auto' }}>
      {CARDS.filter(c => !c.hide).map(c => {
        const Icon = c.icon;
        return (
          <div key={c.label} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '14px 12px',
            flex: '1 0 140px', minWidth: 140
          }}>
            <Icon size={20} color={c.color} style={{ display: 'block', marginBottom: 8 }} />
            <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)', lineHeight: 1 }}>{c.value}</div>
            {c.delta && (
              <div style={{
                fontSize: 10, fontWeight: 700, marginTop: 4,
                color: c.delta.startsWith('+') ? 'var(--accent)' : c.delta.startsWith('-') ? 'var(--danger)' : 'var(--text-muted)',
              }}>{c.delta} vs yesterday</div>
            )}
            {c.sub && (
              <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-muted)', marginTop: 4 }}>
                {c.sub}
              </div>
            )}
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.04em', marginTop: 4 }}>
              {c.label.toUpperCase()}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Waste Collection Chart ───────────────────────────────────────────────────
function WasteCollectionChart({ data }) {
  const [chartType, setChartType] = useState('bar')

  return (
    <GCard>
      <SHead
        icon={<Trash2 size={16} />}
        title="Daily Waste Collected"
        subtitle="Daily totals tracked from dumpsite weighing"
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
        {[
          { key: 'bar', icon: BarChart2, label: 'Bar' },
          { key: 'line', icon: LineChartIcon, label: 'Trend' },
        ].map((t, idx) => {
          const Icon = t.icon;
          return (
            <button key={t.key || idx} onClick={() => setChartType(t.key)} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 20, border: `1px solid ${chartType === t.key ? 'var(--accent)' : 'var(--border)'}`,
              fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)',
              color: chartType === t.key ? 'var(--accent)' : 'var(--text-muted)', background: 'transparent',
            }}>
              <Icon size={13} />
              {t.label}
            </button>
          )
        })}
      </div>

      {chartType === 'bar' && <MiniBar data={data} valueKey="value" color="var(--accent)" height={100} />}
      {chartType === 'line' && <MiniLine data={data} valueKey="value" />}


    </GCard>
  )
}

// ─── Collection Efficiency ────────────────────────────────────────────────────
function CollectionEfficiency({ kpi }) {
  const scheduled = kpi.total_routes ?? 0
  const completed = kpi.completed_routes ?? 0
  const missed = kpi.missed_stops ?? 0
  const pending = kpi.pending_stops ?? Math.max(0, scheduled - (completed + missed))
  const efficiency = kpi.completion_rate

  return (
    <GCard>
      <SHead icon={<ClipboardCheck size={16} />} title="Collection Efficiency" subtitle="Completed vs. decided stops" />

      {/* Big efficiency number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="40" cy="40" r="30" fill="none" stroke="var(--border)" strokeWidth="8" />
            <circle cx="40" cy="40" r="30" fill="none"
              stroke={efficiency == null ? 'var(--border)' : efficiency >= 90 ? 'var(--accent)' : efficiency >= 75 ? 'var(--warning)' : 'var(--danger)'}
              strokeWidth="8"
              strokeDasharray={`${((efficiency ?? 0) / 100) * 188.5} 188.5`}
              strokeLinecap="round"
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column',
          }}>
            <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', lineHeight: 1 }}>{efficiency != null ? `${efficiency}%` : '—'}</span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          {[
            { label: 'Scheduled', value: scheduled, color: 'var(--text-muted)', icon: Clock },
            { label: 'Completed', value: completed, color: 'var(--accent)', icon: CheckCircle2 },
            { label: 'Missed', value: missed, color: missed > 0 ? 'var(--danger)' : 'var(--text-muted)', icon: XCircle },
            { label: 'Pending', value: pending, color: pending > 0 ? 'var(--warning)' : 'var(--text-muted)', icon: Hourglass },
          ].map((r, idx) => {
            const Icon = r.icon;
            return (
              <div key={r.label || idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Icon size={14} color={r.color} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, height: 4, borderRadius: 20, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ width: `${scheduled > 0 ? (r.value / scheduled) * 100 : 0}%`, height: '100%', background: r.color, borderRadius: 20 }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: r.color, width: 22, textAlign: 'right' }}>{r.value}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 54 }}>{r.label.toUpperCase()}</span>
              </div>
            )
          })}
        </div>
      </div>
    </GCard>
  )
}

// ─── Truck Performance ────────────────────────────────────────────────────────
function TruckPerformanceSection({ trucks }) {
  const decided = t => (t.completed || 0) + (t.missed || 0)
  const rateOf = t => decided(t) > 0 ? Math.round((t.completed / decided(t)) * 100) : null
  const sorted = [...trucks].sort((a, b) => (rateOf(b) ?? -1) - (rateOf(a) ?? -1))

  return (
    <GCard>
      <SHead
        icon={<Truck size={16} />}
        title="Truck & Driver Performance"
        subtitle="Routes completed · Efficiency rankings"
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.length === 0 ? (
          <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, background: 'var(--surface)', borderRadius: 8 }}>
            No truck logs recorded for this period.
          </div>
        ) : (
          sorted.map((truck, i) => {
            const rate = rateOf(truck)
            const isTop = i === 0 && rate != null
            return (
              <div key={truck.truck_id} style={{
                background: 'var(--bg)', border: `1px solid ${isTop ? 'rgba(46,204,113,.3)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', padding: '12px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                {/* Rank */}
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: isTop ? 'rgba(46,204,113,.1)' : 'var(--surface)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isTop
                    ? <Trophy size={18} color="#f59e0b" />
                    : <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>#{i + 1}</span>
                  }
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{truck.truck_id}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{truck.driver_name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span><strong style={{ color: 'var(--accent)' }}>{truck.completed}</strong>/{decided(truck)} decided</span>
                    {truck.missed > 0 && <span style={{ color: 'var(--danger)' }}>{truck.missed} missed</span>}
                    <span>{truck.total_weight} delivered</span>
                  </div>
                </div>

                {/* Rate */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: rate == null ? 'var(--text-muted)' : rate >= 90 ? 'var(--accent)' : rate >= 75 ? 'var(--warning)' : 'var(--danger)' }}>
                    {rate ?? '—'}{rate != null && '%'}
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.04em' }}>EFFICIENCY</div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </GCard>
  )
}

// ─── Unified Hotspot & Issue Trends ──────────────────────────────────────────
function UnifiedHotspotMonitoring({ trends, hotspots, stats }) {
  const navigate = useNavigate()
  const SEV = {
    critical: { color: 'var(--danger)', bg: 'rgba(231,76,60,.08)', border: 'rgba(231,76,60,.25)' },
    high: { color: 'var(--warning)', bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.25)' },
    medium: { color: 'var(--info)', bg: 'rgba(93,173,226,.08)', border: 'var(--border)' },
    low: { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border)' },
  }

  const topToday = hotspots[0]

  return (
    <GCard>
      <SHead
        icon={<Flame size={16} />}
        title="Hotspot & Daily Issue Trends"
        subtitle="Illegal dumping, recurring violation areas & reports filed per day"
        right={
          <button
            onClick={() => navigate('/admin/hotspots')}
            style={{
              background: 'transparent', border: 'none', color: 'var(--accent)',
              fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
              cursor: 'pointer', padding: 0
            }}>
            VIEW ALL REPORTS <ArrowRight size={14} />
          </button>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Trend Bar Chart */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
            Daily Reports Filed
          </div>
          <MiniBar data={trends} valueKey="value" color="var(--warning)" height={70} />
        </div>

        {/* Hotspots List */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
            Active Hotspots
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hotspots.length === 0 ? (
              <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, background: 'var(--surface)', borderRadius: 8 }}>
                No active hotspots reported.
              </div>
            ) : (
              hotspots.slice(0, 5).map((h, i) => {
                const sv = SEV[h.severity.toLowerCase()] || SEV.medium
                const resRate = Math.round((h.resolved / Math.max(h.reports, 1)) * 100)
                return (
                  <div key={h.id} style={{
                    background: 'var(--surface)', border: `1px solid ${sv.border}`,
                    borderRadius: 'var(--radius)', padding: '11px 14px',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                      background: sv.bg, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 10, fontWeight: 800, color: sv.color,
                    }}>#{i + 1}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{h.location}</span>
                        <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 6px', borderRadius: 20, background: sv.bg, color: sv.color, letterSpacing: '.05em' }}>
                          {h.severity.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5 }}>
                        {h.type} · {h.reports} reports · {h.reports_in_range} in range
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 3, borderRadius: 20, background: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{ width: `${resRate}%`, height: '100%', background: 'var(--accent)', borderRadius: 20 }} />
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{resRate}% resolved</span>
                      </div>
                    </div>

                    <button
                      onClick={() => navigate('/admin/hotspots')}
                      style={{
                        background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                        borderRadius: 6, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        flexShrink: 0, fontSize: 10, fontWeight: 700, transition: 'all 0.2s', marginTop: 2
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                    >
                      <Map size={14} /> MAP
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </GCard>
  )
}


// ─── Rankings ─────────────────────────────────────────────────────────────────
function RankingsSection({ rankings, problematic, userBarangay, style }) {
  const [showProb, setShowProb] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const activeList = showProb ? problematic : rankings
  const filteredList = activeList.filter(b => b.name.toLowerCase().includes(searchTerm.toLowerCase()))

  return (
    <GCard style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <SHead icon={<BarChart3 size={16} />} title="Barangay Cleanliness Rankings" subtitle="Ranked by compliance ratio · Updated daily" />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, background: 'var(--bg)', borderRadius: 8, padding: 3, width: 'fit-content' }}>
          {[
            { key: false, label: 'Top Cleanest', icon: Trophy },
            { key: true, label: 'Problematic Areas', icon: AlertTriangle },
          ].map(t => {
            const Icon = t.icon;
            return (
              <button key={String(t.key)} onClick={() => setShowProb(t.key)} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                background: showProb === t.key ? 'var(--surface)' : 'transparent',
                color: showProb === t.key ? 'var(--text)' : 'var(--text-muted)',
                borderBottom: showProb === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
                <Icon size={13} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Search Bar */}
        <div style={{ position: 'relative', width: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search barangay..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%', padding: '6px 8px 6px 26px', fontSize: 11,
              borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)', outline: 'none', fontFamily: 'var(--font-body)'
            }}
          />
        </div>
      </div>

      <div className="rankings-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4, paddingBottom: 4 }}>
        {filteredList.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg)', borderRadius: 8 }}>
            No barangays found.
          </div>
        ) : (
          filteredList.map((b, i) => (
            <BarangayRankingCard
              key={b.name}
              brgy={b}
              rank={showProb ? '!' : rankings.findIndex(r => r.name === b.name) + 1}
              isUser={userBarangay && b.name.toLowerCase() === userBarangay.toLowerCase()}
            />
          ))
        )}
      </div>
    </GCard>
  )
}


// ─── Main export ──────────────────────────────────────────────────────────────
export default function GlobalInsights({ userBarangay, selectedBarangay, dateFrom, dateTo, selectedPeriod }) {
  const { raw, loading, error } = useLiveAnalytics({ selectedBarangay, dateFrom, dateTo })
  const data = useMemo(() => toGlobal(raw), [raw])

  const mapData = useMemo(
    () => data
      ? Object.fromEntries(data.rankings.map(b => [b.name, { score: b.score, hotspots: b.hotspots }]))
      : {},
    [data]
  )

  if (loading && !raw) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ margin: '0 auto 12px' }} />
      Loading analytics…
    </div>
  )

  // data is null when the fetch failed outright
  if (!data) return (
    <div style={{
      background: 'rgba(231,76,60,.08)', border: '1px solid rgba(231,76,60,.25)',
      borderRadius: 8, padding: '16px 14px', margin: '12px 0',
      fontSize: 13, color: 'var(--danger)', fontWeight: 600,
    }}>
      {error || 'Failed to load analytics data.'}
    </div>
  )

  return (
    <div style={{ position: 'relative' }}>
      {loading && raw && (
        <div style={{
          position: 'absolute', top: 10, right: 10, fontSize: 11,
          color: 'var(--accent)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--surface)', padding: '4px 10px', borderRadius: 20, zIndex: 10,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
          Updating…
        </div>
      )}
      {/* ── Overview KPIs ── */}
      <OverviewKPIs kpi={data.kpi} />

      {/* ── Two-column mid section ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <WasteCollectionChart data={data.wasteDaily} />
          <ForecastLine forecast={data.forecast} />
          <CollectionEfficiency kpi={data.kpi} />
        </div>
        {data.peersIncluded && (
          <div style={{ position: 'relative', minHeight: 400 }}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
              <RankingsSection rankings={data.rankings} problematic={data.problematic} userBarangay={userBarangay} style={{ flex: 1, minHeight: 0, marginBottom: 0 }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Lower sections ── */}
      <UnifiedHotspotMonitoring trends={data.issueTrends} hotspots={data.hotspots} />
      <TruckPerformanceSection trucks={data.trucks} />

      {/* ── Map ── */}
      {data.peersIncluded && (
        <GCard style={{ position: 'relative', zIndex: 1, isolation: 'isolate' }}>
          <SHead icon={<Map size={16} />} title="Barangay Cleanliness Map" subtitle="Color-coded by completion rate · Sourced from live delivery data" />
          <HotspotMap userBarangay={userBarangay} mapData={mapData} />
        </GCard>
      )}
    </div>
  )
}


