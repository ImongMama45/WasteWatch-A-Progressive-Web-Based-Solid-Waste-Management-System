import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import BarangayRankingCard from './BarangayRankingCard'
import HotspotMap from './HotspotMap'
import { useLiveAnalytics } from './useLiveAnalytics'
import { toGlobal } from './globalMapper'
import {
  Trash2,
  CheckCircle2,
  Truck,
  Flame,
  AlertTriangle,
  Building2,
  BarChart2,
  LineChart as LineChartIcon,
  ClipboardCheck,
  Clock,
  XCircle,
  TrendingUp,
  MapPin,
  BarChart3,
  Flag,
  Hourglass,
  Users,
  Trophy,
  Map,
  ArrowRight,
  Search
} from 'lucide-react'
import { fmtDay } from './perfMapper'
import { StatCardSkeleton, ChartSkeleton, SidebarWidgetSkeleton, TableSkeleton } from '../../components/ui/Skeleton'

// ─── Reusable primitives ──────────────────────────────────────────────────────

function GCard({ children, style = {} }) {
  return (
    <div className="meta-card" style={{ padding: '16px 20px', marginBottom: 16, ...style }}>
      {children}
    </div>
  )
}

function SHead({ icon, title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#166534', marginBottom: 2 }}>
          {icon}
          <span>{title}</span>
        </div>
        {subtitle && <div style={{ fontSize: 12, color: '#65676b' }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

// ─── Mini bar chart ───────────────────────────────────────────────────────────
function MiniBar({ data, valueKey = 'value', color = '#16a34a', height = 80 }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1)
  return (
    <div className="ac-hide-scrollbar" style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height, minWidth: 'min-content' }}>
        {data.map((d, i) => {
          const val = d[valueKey] || 0
          const h = Math.max(Math.round((val / max) * (height - 18)), 4)
          const hot = val > max * 0.8
          return (
            <div key={i} style={{ flex: '1 0 35px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ fontSize: 9, color: '#65676b', fontWeight: 600 }}>
                {val > 999 ? `${(val / 1000).toFixed(1)}k` : val}
              </div>
              <div style={{
                width: '100%', height: h, maxWidth: 32,
                background: hot ? '#dc2626' : color,
                borderRadius: '3px 3px 0 0',
                transition: 'height .3s ease',
              }} />
              <div style={{ fontSize: 10, color: '#65676b', fontWeight: 600, whiteSpace: 'nowrap' }}>{d.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Mini line chart ──────────────────────────────────────────────────────────
function MiniLine({ data, valueKey = 'value', color = '#16a34a' }) {
  if (!data || data.length < 2) return <div style={{ height: 72, background: '#f0f2f5', borderRadius: 6 }} />
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
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color} stroke="#ffffff" strokeWidth="1.5" />
      ))}
    </svg>
  )
}

// ─── Forecast Line Chart ──────────────────────────────────────────────────────
function ForecastLine({ forecast }) {
  const isRidge = forecast?.model_type === 'ridge'
  const isFallback = forecast?.is_fallback

  const modelBadge = forecast?.model_type ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: 999,
        background: isRidge ? '#fffbeb' : '#f0fdf4',
        color: isRidge ? '#b45309' : '#166534',
        border: `1px solid ${isRidge ? '#fde68a' : '#bbf7d0'}`
      }}>
        {isRidge ? 'Ridge ML (Experimental)' : isFallback ? 'Baseline Fallback' : 'Seasonal Baseline (Primary)'}
      </span>
      {forecast.model_version && (
        <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
          v{forecast.model_version.replace('ridge_v', '')}
        </span>
      )}
    </div>
  ) : null

  // F-21: Robust guard against empty history or points
  const hasData = forecast?.sufficient &&
    Array.isArray(forecast?.history) && forecast.history.length > 0 &&
    Array.isArray(forecast?.points) && forecast.points.length > 0

  if (!hasData) {
    const reasonText = forecast?.reason === 'not_enough_data'
      ? `Requires at least ${forecast.required_span || 14} calendar days and ${forecast.required_active || 7} active delivery days (${forecast?.days_available || 0} days / ${forecast?.active_days || 0} active recorded).`
      : (forecast?.fallback_reason || 'Not enough historical waste data to generate a forecast.')

    return (
      <GCard>
        <SHead
          icon={<TrendingUp size={16} />}
          title="7-Day Weight Forecast"
          subtitle="Predictive weight models"
          right={modelBadge}
        />
        <div style={{ height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', borderRadius: 6, border: '1px dashed #e4e6eb', color: '#65676b' }}>
          <TrendingUp size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#050505' }}>Forecast Unavailable</span>
          <span style={{ fontSize: 11, maxWidth: 280, textAlign: 'center', marginTop: 4, color: '#65676b', lineHeight: 1.4 }}>
            {reasonText}
          </span>
        </div>
      </GCard>
    )
  }

  // Sanitize numeric data to prevent NaN propagation (F-21 fix)
  const cleanHistory = forecast.history.map(d => ({
    date: d?.date || '',
    kg: (typeof d?.kg === 'number' && !isNaN(d.kg)) ? Math.max(0, d.kg) : 0
  }))

  const cleanPoints = forecast.points.map(p => {
    const exp = (typeof p?.expected_kg === 'number' && !isNaN(p.expected_kg)) ? Math.max(0, p.expected_kg) : 0
    const low = (typeof p?.low_kg === 'number' && !isNaN(p.low_kg)) ? Math.max(0, p.low_kg) : Math.max(0, exp * 0.8)
    const high = (typeof p?.high_kg === 'number' && !isNaN(p.high_kg)) ? Math.max(low, p.high_kg) : (exp * 1.2)
    return {
      date: p?.date || '',
      expected_kg: exp,
      low_kg: low,
      high_kg: high
    }
  })

  const allPts = [...cleanHistory.map(d => d.kg), ...cleanPoints.map(p => p.expected_kg)]
  const max = Math.max(...allPts, ...cleanPoints.map(p => p.high_kg), 1)
  const min = Math.min(...allPts, ...cleanPoints.map(p => p.low_kg), 0)
  const rng = max - min || 1

  const W = 350, H = 140, P = 14
  const totalCount = cleanHistory.length + cleanPoints.length

  const getX = i => P + (i / Math.max(totalCount - 1, 1)) * (W - P * 2)
  const getY = v => P + ((max - v) / rng) * (H - P * 2)

  const histPts = cleanHistory.map((d, i) => [getX(i), getY(d.kg)])
  const forcPts = cleanPoints.map((d, i) => [getX(cleanHistory.length + i), getY(d.expected_kg)])

  const lastHistPt = histPts[histPts.length - 1]
  const histPoly = histPts.map(p => p.join(',')).join(' ')
  const forcPoly = [lastHistPt, ...forcPts].map(p => p.join(',')).join(' ')

  const bandPts = [
    lastHistPt,
    ...cleanPoints.map((p, i) => [getX(cleanHistory.length + i), getY(p.high_kg)]),
    ...[...cleanPoints].reverse().map((p, i) => [getX(cleanHistory.length + cleanPoints.length - 1 - i), getY(p.low_kg)]),
    lastHistPt
  ]
  const bandPoly = bandPts.map(p => p.join(',')).join(' ')

  // F-21: Transparent disclosure without unverified coverage claims (Directive Phase 7)
  const subtitle = isRidge
    ? "Expected tonnage · Conformal prediction interval (Candidate shadow model)"
    : "Expected tonnage · Seasonal residual variation band (Production-primary baseline)"

  // Position 'Today' correctly at the boundary of history and forecast
  const todayLeftPercent = totalCount > 1
    ? ((cleanHistory.length - 1) / (totalCount - 1)) * 100
    : 66.7

  return (
    <GCard>
      <SHead
        icon={<TrendingUp size={16} />}
        title="7-Day Weight Forecast"
        subtitle={subtitle}
        right={modelBadge}
      />
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
          {[0, 0.5, 1].map((t, i) => {
            const y = P + t * (H - P * 2)
            const v = Math.round(max - t * rng)
            return (
              <g key={i}>
                <line x1={P} y1={y} x2={W - P} y2={y} stroke="#e4e6eb" strokeWidth="1" strokeDasharray="3,3" />
                <text x={P - 4} y={y + 3} fontSize="8" fill="#65676b" textAnchor="end">{v > 999 ? `${(v / 1000).toFixed(1)}k` : v}</text>
              </g>
            )
          })}

          {/* Prediction Interval Band */}
          <polygon points={bandPoly} fill="#d97706" opacity="0.12" />

          {/* History Line */}
          <polyline points={histPoly} fill="none" stroke="#65676b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Forecast Line */}
          <polyline points={forcPoly} fill="none" stroke="#d97706" strokeWidth="2" strokeDasharray="5,4" strokeLinecap="round" strokeLinejoin="round" />

          {/* Forecast Dots */}
          {forcPts.map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#d97706" stroke="#ffffff" strokeWidth="1.5" />
          ))}
          {lastHistPt && (
            <circle cx={lastHistPt[0]} cy={lastHistPt[1]} r="3" fill="#65676b" stroke="#ffffff" strokeWidth="1.5" />
          )}
        </svg>
      </div>

      <div style={{ position: 'relative', marginTop: 8, height: 18, fontSize: 11, color: '#65676b', fontWeight: 600 }}>
        <span style={{ position: 'absolute', left: 0 }}>{fmtDay(cleanHistory[0]?.date)}</span>
        <span style={{ position: 'absolute', left: `${todayLeftPercent}%`, transform: 'translateX(-50%)', color: '#050505' }}>Today</span>
        <span style={{ position: 'absolute', right: 0, color: '#d97706' }}>{fmtDay(cleanPoints[cleanPoints.length - 1]?.date)}</span>
      </div>

      {forecast.is_barangay && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af', fontStyle: 'italic' }}>
          * Barangay values represent estimated proportional allocations from multi-stop truck routes.
        </div>
      )}
    </GCard>
  )
}

// ─── Overview KPIs ────────────────────────────────────────────────────────────
function OverviewKPIs({ kpi }) {
  const CARDS = [
    { label: 'Total Waste Collected', value: `${kpi.collected_kg?.toLocaleString() ?? '—'} kg`, delta: kpi.collected_kg_delta, sub: 'All recorded weight', icon: Trash2, iconColor: '#166534', iconBg: '#e7f3ed' },
    { label: 'Collection Rate', value: kpi.collection_rate == null ? '—' : `${kpi.collection_rate}%`, delta: kpi.collection_rate_delta, icon: CheckCircle2, iconColor: '#15803d', iconBg: '#f0fdf4' },
    { label: 'Active Trucks', value: kpi.active_trucks ?? '—', delta: null, icon: Truck, iconColor: '#2563eb', iconBg: '#eff6ff' },
    { label: 'Open Hotspots', value: kpi.open_hotspots ?? '—', delta: kpi.hotspots_delta, icon: Flame, iconColor: '#dc2626', iconBg: '#fef2f2' },
    { label: 'Barangays Served', value: kpi.barangays_served, hide: kpi.barangays_served == null, icon: Building2, iconColor: '#166534', iconBg: '#e7f3ed', delta: null },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 14,
      marginBottom: 16
    }}>
      {CARDS.filter(c => !c.hide).map(c => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="meta-stat-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: '#65676b', textTransform: 'uppercase' }}>
                {c.label}
              </span>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: c.iconBg, color: c.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={15} />
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#050505', lineHeight: 1.1, marginBottom: 4 }}>
              {c.value}
            </div>
            {c.delta && (
              <div style={{
                fontSize: 11, fontWeight: 600, marginBottom: 2,
                color: c.delta.startsWith('+') ? '#15803d' : c.delta.startsWith('-') ? '#dc2626' : '#65676b',
              }}>
                {c.delta} vs yesterday
              </div>
            )}
            {c.sub && (
              <div style={{ fontSize: 11, color: '#65676b' }}>
                {c.sub}
              </div>
            )}
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
        subtitle="Daily totals tracked from municipal dumpsite weighing"
      />

      <div style={{ display: 'flex', gap: 4, background: '#f0f2f5', borderRadius: 6, padding: 3, width: 'fit-content', marginBottom: 14 }}>
        {[
          { key: 'bar', icon: BarChart2, label: 'Bar' },
          { key: 'line', icon: LineChartIcon, label: 'Trend' },
        ].map((t, idx) => {
          const Icon = t.icon;
          const active = chartType === t.key
          return (
            <button
              key={t.key || idx}
              onClick={() => setChartType(t.key)}
              className={`meta-tab-btn ${active ? 'active' : ''}`}
              style={{ height: 28, padding: '0 10px', fontSize: 12 }}
            >
              <Icon size={13} />
              {t.label}
            </button>
          )
        })}
      </div>

      {chartType === 'bar' && <MiniBar data={data} valueKey="value" color="#16a34a" height={100} />}
      {chartType === 'line' && <MiniLine data={data} valueKey="value" color="#16a34a" />}
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
      <SHead icon={<ClipboardCheck size={16} />} title="Collection Efficiency" subtitle="Completed vs. scheduled stops" />

      {/* Efficiency indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <svg width="76" height="76" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="40" cy="40" r="30" fill="none" stroke="#e4e6eb" strokeWidth="8" />
            <circle cx="40" cy="40" r="30" fill="none"
              stroke={efficiency == null ? '#ccd0d5' : efficiency >= 90 ? '#15803d' : efficiency >= 75 ? '#d97706' : '#dc2626'}
              strokeWidth="8"
              strokeDasharray={`${((efficiency ?? 0) / 100) * 188.5} 188.5`}
              strokeLinecap="round"
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column',
          }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#050505', lineHeight: 1 }}>{efficiency != null ? `${efficiency}%` : '—'}</span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          {[
            { label: 'Scheduled', value: scheduled, color: '#65676b', icon: Clock },
            { label: 'Completed', value: completed, color: '#15803d', icon: CheckCircle2 },
            { label: 'Missed', value: missed, color: missed > 0 ? '#dc2626' : '#65676b', icon: XCircle },
            { label: 'Pending', value: pending, color: pending > 0 ? '#d97706' : '#65676b', icon: Hourglass },
          ].map((r, idx) => {
            const Icon = r.icon;
            return (
              <div key={r.label || idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <Icon size={13} color={r.color} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, height: 4, borderRadius: 4, background: '#f0f2f5', overflow: 'hidden' }}>
                  <div style={{ width: `${scheduled > 0 ? (r.value / scheduled) * 100 : 0}%`, height: '100%', background: r.color, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: r.color, width: 22, textAlign: 'right' }}>{r.value}</span>
                <span style={{ fontSize: 10, color: '#65676b', width: 62, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.label}</span>
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
          <div style={{ padding: '20px 10px', textAlign: 'center', color: '#65676b', fontSize: 12, background: '#f9fafb', borderRadius: 6 }}>
            No truck logs recorded for this period.
          </div>
        ) : (
          sorted.map((truck, i) => {
            const rate = rateOf(truck)
            const isTop = i === 0 && rate != null
            return (
              <div key={truck.truck_id} style={{
                background: '#ffffff',
                border: `1px solid ${isTop ? '#bbf7d0' : '#e4e6eb'}`,
                borderRadius: 6,
                padding: '11px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
              }}>
                {/* Rank */}
                <div style={{
                  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                  background: isTop ? '#e7f3ed' : '#f0f2f5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isTop
                    ? <Trophy size={15} color="#d97706" />
                    : <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b' }}>#{i + 1}</span>
                  }
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#050505' }}>{truck.truck_id}</span>
                    <span style={{ fontSize: 11, color: '#65676b' }}>{truck.driver_name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#65676b', flexWrap: 'wrap' }}>
                    <span><strong style={{ color: '#15803d' }}>{truck.completed}</strong>/{decided(truck)} decided</span>
                    {truck.missed > 0 && <span style={{ color: '#dc2626' }}>{truck.missed} missed</span>}
                    <span>{truck.total_weight} delivered</span>
                  </div>
                </div>

                {/* Rate */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: rate == null ? '#65676b' : rate >= 90 ? '#15803d' : rate >= 75 ? '#d97706' : '#dc2626' }}>
                    {rate ?? '—'}{rate != null && '%'}
                  </div>
                  <div style={{ fontSize: 9, color: '#65676b', fontWeight: 600, letterSpacing: '0.04em' }}>EFFICIENCY</div>
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
    critical: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
    high: { color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
    medium: { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
    low: { color: '#65676b', bg: '#f0f2f5', border: '#e4e6eb' },
  }

  return (
    <GCard>
      <SHead
        icon={<Flame size={16} />}
        title="Hotspot & Daily Issue Trends"
        subtitle="Recurring waste cluster reports filed per day across Lucena"
        right={
          <button
            onClick={() => navigate('/admin/hotspots')}
            className="meta-btn-secondary"
            style={{ height: 30, padding: '0 10px', fontSize: 11 }}
          >
            <span>VIEW ALL REPORTS</span>
            <ArrowRight size={13} />
          </button>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Trend Bar Chart */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: '#65676b', marginBottom: 8, textTransform: 'uppercase' }}>
            Daily Reports Filed
          </div>
          <MiniBar data={trends} valueKey="value" color="#d97706" height={70} />
        </div>

        {/* Hotspots List */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: '#65676b', marginBottom: 8, textTransform: 'uppercase' }}>
            Active Hotspots
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hotspots.length === 0 ? (
              <div style={{ padding: '20px 10px', textAlign: 'center', color: '#65676b', fontSize: 12, background: '#f9fafb', borderRadius: 6 }}>
                No active hotspots reported.
              </div>
            ) : (
              hotspots.slice(0, 5).map((h, i) => {
                const sv = SEV[h.severity.toLowerCase()] || SEV.medium
                const resRate = Math.round((h.resolved / Math.max(h.reports, 1)) * 100)
                return (
                  <div key={h.id} style={{
                    background: '#ffffff',
                    border: `1px solid ${sv.border}`,
                    borderRadius: 6,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                      background: sv.bg, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 10, fontWeight: 700, color: sv.color,
                    }}>#{i + 1}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: '#050505' }}>{h.location}</span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                          background: sv.bg, color: sv.color, letterSpacing: '0.04em'
                        }}>
                          {h.severity.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#65676b', marginBottom: 4 }}>
                        {h.type} · {h.reports} reports · {h.reports_in_range} in range
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 4, borderRadius: 4, background: '#f0f2f5', overflow: 'hidden' }}>
                          <div style={{ width: `${resRate}%`, height: '100%', background: '#16a34a', borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a', flexShrink: 0 }}>{resRate}% resolved</span>
                      </div>
                    </div>

                    <button
                      onClick={() => navigate('/admin/hotspots')}
                      className="meta-btn-secondary"
                      style={{ height: 26, padding: '0 8px', fontSize: 10 }}
                    >
                      <Map size={12} /> MAP
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

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4, background: '#f0f2f5', borderRadius: 6, padding: 3 }}>
          {[
            { key: false, label: 'Top Cleanest', icon: Trophy },
            { key: true, label: 'Problematic', icon: AlertTriangle },
          ].map(t => {
            const Icon = t.icon;
            const active = showProb === t.key
            return (
              <button
                key={String(t.key)}
                onClick={() => setShowProb(t.key)}
                className={`meta-tab-btn ${active ? 'active' : ''}`}
                style={{ height: 28, padding: '0 10px', fontSize: 12 }}
              >
                <Icon size={12} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Search Bar */}
        <div style={{ position: 'relative', width: 170 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#65676b' }} />
          <input
            type="text"
            placeholder="Search barangay..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="meta-input"
            style={{ width: '100%', height: 30, paddingLeft: 26, fontSize: 11 }}
          />
        </div>
      </div>

      <div className="rankings-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4, paddingBottom: 4 }}>
        {filteredList.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: '#65676b', background: '#f9fafb', borderRadius: 6 }}>
            No barangays found.
          </div>
        ) : (
          filteredList.map((b) => (
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
    <div>
      <StatCardSkeleton count={5} minCardWidth={150} style={{ marginBottom: 20 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16 }}>
        <ChartSkeleton height={220} variant="bar" />
        <SidebarWidgetSkeleton rows={5} showHeader />
      </div>
      <TableSkeleton rows={4} cols={5} style={{ marginTop: 20 }} />
    </div>
  )

  if (!data) return (
    <div style={{
      background: '#fef2f2', border: '1px solid #fecaca',
      borderRadius: 6, padding: '14px 16px', margin: '12px 0',
      fontSize: 13, color: '#dc2626', fontWeight: 600,
    }}>
      {error || 'Failed to load analytics data.'}
    </div>
  )

  return (
    <div className="ww-fade-in" style={{ position: 'relative' }}>
      <style>{`
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
          padding: 5px 12px;
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
        .meta-input {
          height: 36px;
          border: 1px solid #ccd0d5;
          border-radius: 6px;
          font-size: 13px;
          background: #ffffff;
          color: #050505;
          outline: none;
          padding: 0 10px;
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
          padding: 0 12px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
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

      {loading && raw && (
        <div style={{
          position: 'absolute', top: 10, right: 10, fontSize: 11,
          color: '#166534', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
          background: '#ffffff', padding: '4px 10px', borderRadius: 4, zIndex: 10,
          border: '1px solid #e4e6eb', boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
        }}>
          <div className="spinner" style={{ width: 11, height: 11, borderWidth: 2 }} />
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



