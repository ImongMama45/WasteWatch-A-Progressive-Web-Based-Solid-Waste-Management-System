/**
 * GlobalInsights.jsx — Barangay Analytics (Revised)
 * ---------------------------------------------------
 * Waste Management Analytics Center for WasteWatch.
 * Pulls from existing backend: /api/analytics/kpi/, /api/analytics/barangay-performance/,
 * /api/analytics/truck-performance/, /api/analytics/trends/
 * Falls back to placeholder data while backend is being seeded.
 */

import { useState, useEffect } from 'react'
import BarangayRankingCard from './BarangayRankingCard'
import HotspotMap from './HotspotMap'
import api from '../../api/client'
import { Trash2, CheckCircle2, Truck, Flame, AlertTriangle, Building2, BarChart2, LineChart, ClipboardCheck, Clock, XCircle, TrendingUp, MapPin, PieChart, BarChart3, Flag, Hourglass, Users, Trophy, Map } from 'lucide-react'

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

function PeriodToggle({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 8, padding: 3, flexShrink: 0 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
          fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-body)',
          background: value === o.value ? 'var(--surface)' : 'transparent',
          color: value === o.value ? 'var(--text)' : 'var(--text-muted)',
          borderBottom: value === o.value ? '2px solid var(--accent)' : '2px solid transparent',
          whiteSpace: 'nowrap',
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function asList(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.results)) return payload.results
  return []
}

function normalizePeriod(period) {
  return (period || '').trim().toLowerCase()
}

// ─── Mini bar chart ───────────────────────────────────────────────────────────
function MiniBar({ data, valueKey = 'value', color = 'var(--accent)', height = 80 }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height }}>
      {data.map((d, i) => {
        const val = d[valueKey] || 0
        const h = Math.max(Math.round((val / max) * (height - 18)), 4)
        const hot = val > max * 0.8
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ fontSize: 7, color: 'var(--text-muted)', fontWeight: 600 }}>
              {val > 999 ? `${(val / 1000).toFixed(1)}k` : val}
            </div>
            <div style={{
              width: '100%', height: h,
              background: hot ? 'var(--danger)' : color,
              borderRadius: '3px 3px 0 0', opacity: .8,
              transition: 'height .3s ease',
            }} />
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        )
      })}
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

// ─── Donut chart ──────────────────────────────────────────────────────────────
function Donut({ segments, size = 80 }) {
  const total = segments.reduce((s, c) => s + c.value, 0) || 1
  const r = 28, cx = size / 2, cy = size / 2
  const circumference = 2 * Math.PI * r
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circumference
        const gap = circumference - dash
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r}
            fill="none" stroke={seg.color} strokeWidth="10"
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
          />
        )
        offset += dash
        return el
      })}
    </svg>
  )
}

// ─── Placeholder data (used until backend is seeded) ─────────────────────────
const PLACEHOLDER = {
  kpi: {
    collected_kg: 4820,
    collection_rate: 91,
    active_trucks: 7,
    open_hotspots: 14,
    escalations: 3,
    barangays_served: 22,
    collected_kg_delta: '+320',
    collection_rate_delta: '+2%',
    hotspots_delta: '-3',
  },
  wasteDaily: [
    { label: 'Mon', value: 680, organic: 420, residual: 260 },
    { label: 'Tue', value: 720, organic: 440, residual: 280 },
    { label: 'Wed', value: 590, organic: 370, residual: 220 },
    { label: 'Thu', value: 810, organic: 510, residual: 300 },
    { label: 'Fri', value: 940, organic: 580, residual: 360 },
    { label: 'Sat', value: 760, organic: 480, residual: 280 },
    { label: 'Sun', value: 320, organic: 200, residual: 120 },
  ],
  rankings: [
    { name: 'Gulang-Gulang', score: 98, compliance: 97, trend: 'up', population: 4200, hotspots: 0, reports: 2 },
    { name: 'Ibabang Dupay', score: 95, compliance: 94, trend: 'up', population: 3800, hotspots: 0, reports: 3 },
    { name: 'Mayao Crossing', score: 92, compliance: 91, trend: 'same', population: 5100, hotspots: 1, reports: 4 },
    { name: 'Cotta', score: 88, compliance: 87, trend: 'up', population: 6200, hotspots: 2, reports: 5 },
    { name: 'Isabang', score: 84, compliance: 83, trend: 'down', population: 4900, hotspots: 2, reports: 7 },
  ],
  problematic: [
    { name: 'Barangay 9', score: 44, compliance: 48, trend: 'down', population: 3100, hotspots: 8, reports: 24 },
    { name: 'Barangay 10', score: 51, compliance: 52, trend: 'down', population: 2800, hotspots: 6, reports: 19 },
    { name: 'Barangay 6', score: 58, compliance: 60, trend: 'same', population: 3400, hotspots: 5, reports: 15 },
  ],
  trucks: [
    { truck_id: 'LCN-001', driver_name: 'Juan Dela Cruz', routes: 18, completed: 17, missed: 1, avg_fill: 88, total_km: '142.5' },
    { truck_id: 'LCN-002', driver_name: 'Ana Mendoza', routes: 16, completed: 16, missed: 0, avg_fill: 94, total_km: '128.0' },
    { truck_id: 'LCN-003', driver_name: 'Jose Bautista', routes: 14, completed: 13, missed: 1, avg_fill: 79, total_km: '108.3' },
    { truck_id: 'LCN-004', driver_name: 'Maria Santos', routes: 15, completed: 15, missed: 0, avg_fill: 91, total_km: '119.7' },
  ],
  issueTrends: [
    { label: 'Jun 1', value: 8 },
    { label: 'Jun 2', value: 12 },
    { label: 'Jun 3', value: 7 },
    { label: 'Jun 4', value: 15 },
    { label: 'Jun 5', value: 11 },
    { label: 'Jun 6', value: 19 },
    { label: 'Jun 7', value: 14 },
  ],
  hotspots: [
    { id: 1, location: 'Purok 3, Barangay 9', severity: 'critical', type: 'Illegal Dumping', reports: 24, reportsWeek: 8, resolved: 6 },
    { id: 2, location: 'Market Area, Cotta', severity: 'high', type: 'Open Burning', reports: 18, reportsWeek: 5, resolved: 7 },
    { id: 3, location: 'Riverside, Isabang', severity: 'high', type: 'Illegal Dumping', reports: 15, reportsWeek: 4, resolved: 8 },
    { id: 4, location: 'Highway, Barangay 10', severity: 'medium', type: 'Littering', reports: 11, reportsWeek: 3, resolved: 9 },
    { id: 5, location: 'Purok 1, Barangay 6', severity: 'medium', type: 'Illegal Dumping', reports: 9, reportsWeek: 2, resolved: 5 },
  ],
  wasteComposition: [
    { label: 'Organic', value: 42, color: '#22c55e' },
    { label: 'Residual', value: 31, color: '#3b82f6' },
    { label: 'Recyclable', value: 19, color: '#f59e0b' },
    { label: 'Special', value: 8, color: '#ef4444' },
  ],
  stats: {
    totalWaste: '4,820 kg',
    totalOrganic: '2,024 kg',
    totalResidual: '1,494 kg',
    reportsThisWeek: 14,
    resolutionRate: 68,
    avgResponse: 2.4,
  },
}

// ─── Overview KPIs ────────────────────────────────────────────────────────────
function OverviewKPIs({ kpi }) {
  const CARDS = [
    { label: 'Waste Collected Today', value: `${kpi.collected_kg?.toLocaleString() ?? '—'} kg`, delta: kpi.collected_kg_delta, icon: Trash2, color: 'var(--accent)' },
    { label: 'Collection Rate', value: `${kpi.collection_rate ?? '—'}%`, delta: kpi.collection_rate_delta, icon: CheckCircle2, color: 'var(--accent)' },
    { label: 'Active Trucks', value: kpi.active_trucks ?? '—', delta: null, icon: Truck, color: 'var(--info)' },
    { label: 'Open Hotspots', value: kpi.open_hotspots ?? '—', delta: kpi.hotspots_delta, icon: Flame, color: 'var(--danger)' },
    { label: 'Escalations', value: kpi.escalations ?? '—', delta: null, icon: AlertTriangle, color: 'var(--warning)' },
    { label: 'Barangays Served', value: kpi.barangays_served ?? '—', delta: null, icon: Building2, color: 'var(--accent)' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))', gap: 10, marginBottom: 16 }}>
      {CARDS.map(c => {
        const Icon = c.icon;
        return (
          <div key={c.label} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '14px 12px',
          }}>
            <Icon size={20} color={c.color} style={{ display: 'block', marginBottom: 8 }} />
            <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)', lineHeight: 1 }}>{c.value}</div>
            {c.delta && (
              <div style={{
                fontSize: 10, fontWeight: 700, marginTop: 4,
                color: c.delta.startsWith('+') ? 'var(--accent)' : c.delta.startsWith('-') ? 'var(--danger)' : 'var(--text-muted)',
              }}>{c.delta} vs yesterday</div>
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
  const [period, setPeriod] = useState('week')
  const [chartType, setChartType] = useState('bar')

  return (
    <GCard>
      <SHead
        icon={<Trash2 size={16} />}
        title="Waste Collected per Barangay"
        subtitle="Daily totals tracked from dumpsite weighing"
        right={
          <PeriodToggle
            value={period} onChange={setPeriod}
            options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
          />
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
        {[
          { key: 'bar', icon: BarChart2, label: 'Bar' },
          { key: 'line', icon: LineChart, label: 'Trend' },
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

      {/* Stacked breakdown legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 10, color: 'var(--text-muted)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent)' }} /> Organic
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--info)' }} /> Residual
        </div>
      </div>
    </GCard>
  )
}

// ─── Collection Efficiency ────────────────────────────────────────────────────
function CollectionEfficiency({ kpi }) {
  const scheduled = kpi.total_routes || 40
  const completed = kpi.completed_routes || 37
  const missed = scheduled - completed
  const efficiency = Math.round((completed / scheduled) * 100)

  return (
    <GCard>
      <SHead icon={<ClipboardCheck size={16} />} title="Collection Efficiency" subtitle="Scheduled vs. completed routes this week" />

      {/* Big efficiency number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="40" cy="40" r="30" fill="none" stroke="var(--border)" strokeWidth="8" />
            <circle cx="40" cy="40" r="30" fill="none"
              stroke={efficiency >= 90 ? 'var(--accent)' : efficiency >= 75 ? 'var(--warning)' : 'var(--danger)'}
              strokeWidth="8"
              strokeDasharray={`${(efficiency / 100) * 188.5} 188.5`}
              strokeLinecap="round"
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column',
          }}>
            <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', lineHeight: 1 }}>{efficiency}%</span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          {[
            { label: 'Scheduled', value: scheduled, color: 'var(--text-muted)', icon: Clock },
            { label: 'Completed', value: completed, color: 'var(--accent)', icon: CheckCircle2 },
            { label: 'Missed', value: missed, color: missed > 0 ? 'var(--danger)' : 'var(--text-muted)', icon: XCircle },
          ].map((r, idx) => {
            const Icon = r.icon;
            return (
              <div key={r.label || idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Icon size={14} color={r.color} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, height: 4, borderRadius: 20, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ width: `${(r.value / scheduled) * 100}%`, height: '100%', background: r.color, borderRadius: 20 }} />
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
  const [period, setPeriod] = useState('This Week')
  const sorted = [...trucks].sort((a, b) => (b.completed / b.routes) - (a.completed / a.routes))

  return (
    <GCard>
      <SHead
        icon={<Truck size={16} />}
        title="Truck & Driver Performance"
        subtitle="Routes completed · Efficiency rankings"
        right={
          <PeriodToggle
            value={period} onChange={setPeriod}
            options={[{ value: 'This Week', label: 'Week' }, { value: 'This Month', label: 'Month' }]}
          />
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map((truck, i) => {
          const rate = Math.round((truck.completed / Math.max(truck.routes, 1)) * 100)
          const isTop = i === 0
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
                  <span><strong style={{ color: 'var(--accent)' }}>{truck.completed}</strong>/{truck.routes} routes</span>
                  {truck.missed > 0 && <span style={{ color: 'var(--danger)' }}>{truck.missed} missed</span>}
                  <span>{truck.total_km} km</span>
                </div>
              </div>

              {/* Rate */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: rate >= 90 ? 'var(--accent)' : rate >= 75 ? 'var(--warning)' : 'var(--danger)' }}>
                  {rate}%
                </div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.04em' }}>EFFICIENCY</div>
              </div>
            </div>
          )
        })}
      </div>
    </GCard>
  )
}

// ─── Daily Issue Trends ───────────────────────────────────────────────────────
function IssueTrendsSection({ trends, hotspots }) {
  const topToday = hotspots[0]
  return (
    <GCard>
      <SHead icon={<TrendingUp size={16} />} title="Daily Issue Trends" subtitle="Reports filed per day · Most reported barangay today" />

      {topToday && (
        <div style={{
          background: 'rgba(231,76,60,.06)', border: '1px solid rgba(231,76,60,.2)',
          borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <MapPin size={22} color="var(--danger)" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--danger)', marginBottom: 2 }}>Most Reported Today</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{topToday.location}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {topToday.reportsWeek} reports this week · {topToday.reports - topToday.resolved} unresolved
            </div>
          </div>
        </div>
      )}

      <MiniBar data={trends} valueKey="value" color="var(--warning)" height={90} />
    </GCard>
  )
}

// ─── Hotspots ─────────────────────────────────────────────────────────────────
function HotspotsSection({ hotspots, stats }) {
  const SEV = {
    critical: { color: 'var(--danger)', bg: 'rgba(231,76,60,.08)', border: 'rgba(231,76,60,.25)' },
    high: { color: 'var(--warning)', bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.25)' },
    medium: { color: 'var(--info)', bg: 'rgba(93,173,226,.08)', border: 'var(--border)' },
    low: { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border)' },
  }

  return (
    <GCard>
      <SHead icon={<Flame size={16} />} title="Hotspot Monitoring" subtitle="Illegal dumping & recurring violation areas" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 90px), 1fr))', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'This Week', value: stats.reportsThisWeek, color: 'var(--danger)' },
          { label: 'Resolved', value: `${stats.resolutionRate}%`, color: 'var(--accent)' },
          { label: 'Avg Response', value: `${stats.avgResponse}d`, color: 'var(--warning)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.04em', marginTop: 2 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {hotspots.slice(0, 5).map((h, i) => {
          const sv = SEV[h.severity] || SEV.medium
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
                  {h.type} · {h.reports} reports · {h.reportsWeek} this week
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 3, borderRadius: 20, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: `${resRate}%`, height: '100%', background: 'var(--accent)', borderRadius: 20 }} />
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{resRate}% resolved</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </GCard>
  )
}

// ─── Waste Composition ────────────────────────────────────────────────────────
function WasteComposition({ segments }) {
  const total = segments.reduce((s, c) => s + c.value, 0) || 1
  return (
    <GCard>
      <SHead icon={<PieChart size={16} />} title="Waste Composition" subtitle="Classification breakdown from dumpsite data" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 20 }}>
        <Donut segments={segments} size={90} />
        <div style={{ flex: '1 1 200px' }}>
          {segments.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <div style={{ flex: 1, height: 4, borderRadius: 20, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ width: `${s.value}%`, height: '100%', background: s.color, borderRadius: 20 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', width: 30, textAlign: 'right' }}>{s.value}%</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.03em', width: 60 }}>{s.label.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </div>
    </GCard>
  )
}

// ─── Rankings ─────────────────────────────────────────────────────────────────
function RankingsSection({ rankings, problematic, userBarangay }) {
  const [showProb, setShowProb] = useState(false)
  return (
    <GCard>
      <SHead icon={<BarChart3 size={16} />} title="Barangay Cleanliness Rankings" subtitle="Ranked by compliance ratio · Updated daily" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, background: 'var(--bg)', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 14 }}>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(showProb ? problematic : rankings).map((b, i) => (
          <BarangayRankingCard
            key={b.name}
            brgy={b}
            rank={showProb ? '!' : i + 1}
            isUser={userBarangay && b.name.toLowerCase() === userBarangay.toLowerCase()}
          />
        ))}
      </div>
    </GCard>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function GlobalInsights({ userBarangay, selectedBarangay, selectedPeriod }) {
  const [data, setData] = useState(PLACEHOLDER)
  const [loading, setLoading] = useState(true)
  const period = selectedPeriod || 'This Week'

  useEffect(() => {
    async function fetchAll() {
      try {
        const [kpiRes, brgyRes, truckRes, trendRes] = await Promise.allSettled([
          api.get('/api/analytics/kpi/'),
          api.get('/api/analytics/barangay-performance/'),
          api.get('/api/analytics/truck-performance/'),
          api.get('/api/analytics/trends/'),
        ])

        const kpis = kpiRes.status === 'fulfilled' ? asList(kpiRes.value.data) : []
        const barangayRows = brgyRes.status === 'fulfilled' ? asList(brgyRes.value.data) : []
        const truckRows = truckRes.status === 'fulfilled' ? asList(truckRes.value.data) : []
        const trendRows = trendRes.status === 'fulfilled' ? asList(trendRes.value.data) : []

        const targetPeriod = normalizePeriod(period)
        const selectedKpi = kpis.find(row => normalizePeriod(row.period) === targetPeriod) ?? kpis[0] ?? prev.kpi
        const selectedTruckRows = truckRows.filter(row => normalizePeriod(row.period) === targetPeriod)
        const selectedBrgyRows = barangayRows.filter(row => normalizePeriod(row.period) === targetPeriod)
        const selectedTruckCount = selectedTruckRows.length || prev.kpi.active_trucks || 0
        const selectedBarangayCount = selectedBrgyRows.length || prev.kpi.barangays_served || 0
        const selectedCollectionRate = selectedKpi.total_routes
          ? Math.round(((selectedKpi.completed_routes || 0) / Math.max(selectedKpi.total_routes, 1)) * 100)
          : prev.kpi.collection_rate
        const selectedResolutionRate = selectedKpi.total_reports
          ? Math.round(((selectedKpi.resolved_reports || 0) / Math.max(selectedKpi.total_reports, 1)) * 100)
          : prev.kpi.resolution_rate
        const normalizedKpi = {
          ...prev.kpi,
          collected_kg: selectedKpi.collected_kg ?? prev.kpi.collected_kg,
          collection_rate: selectedCollectionRate,
          active_trucks: selectedTruckCount,
          open_hotspots: prev.kpi.open_hotspots,
          escalations: selectedKpi.total_reports != null
            ? Math.max(0, (selectedKpi.total_reports || 0) - (selectedKpi.resolved_reports || 0))
            : prev.kpi.escalations,
          barangays_served: selectedBarangayCount,
          total_routes: selectedKpi.total_routes ?? prev.kpi.total_routes,
          completed_routes: selectedKpi.completed_routes ?? prev.kpi.completed_routes,
          missed_stops: selectedKpi.missed_stops ?? prev.kpi.missed_stops,
          avg_fill_rate: selectedKpi.avg_fill_rate ?? prev.kpi.avg_fill_rate,
          total_reports: selectedKpi.total_reports ?? prev.kpi.total_reports,
          resolved_reports: selectedKpi.resolved_reports ?? prev.kpi.resolved_reports,
          collected_kg_delta: prev.kpi.collected_kg_delta,
          collection_rate_delta: prev.kpi.collection_rate_delta,
          hotspots_delta: prev.kpi.hotspots_delta,
          resolution_rate: selectedResolutionRate,
        }
        const mappedTrucks = selectedTruckRows.length
          ? selectedTruckRows.map(row => ({
            id: row.truck_id,
            driver: row.driver_name,
            routes: Number(row.routes || 0),
            completed: Number(row.completed || 0),
            missed: Number(row.missed || 0),
            fill: Number(row.avg_fill || 0),
            km: Number(row.total_km || 0),
          }))
          : prev.trucks

        const mappedRankings = selectedBrgyRows.length
          ? selectedBrgyRows
            .map(row => {
              const reports = Number(row.reports || 0)
              const resolved = Number(row.resolved || 0)
              const score = Math.max(0, Math.min(100, Math.round(((resolved / Math.max(reports, 1)) * 100) * 0.7 + Math.min(Number(row.waste_collected_kg || 0) / 100, 30))))
              const trend = resolved >= reports ? 'up' : resolved >= reports * 0.6 ? 'same' : 'down'
              return {
                name: row.barangay_name,
                score,
                compliance: Math.round((resolved / Math.max(reports, 1)) * 100),
                trend,
                population: row.population || null,
                hotspots: row.hotspots || 0,
                reports,
              }
            })
            .sort((a, b) => b.score - a.score)
          : prev.rankings

        const mappedProblematic = selectedBrgyRows.length
          ? [...selectedBrgyRows]
            .map(row => {
              const reports = Number(row.reports || 0)
              const resolved = Number(row.resolved || 0)
              const score = Math.max(0, Math.min(100, Math.round(((resolved / Math.max(reports, 1)) * 100) * 0.7 + Math.min(Number(row.waste_collected_kg || 0) / 100, 30))))
              const trend = resolved >= reports ? 'up' : resolved >= reports * 0.6 ? 'same' : 'down'
              return {
                name: row.barangay_name,
                score,
                compliance: Math.round((resolved / Math.max(reports, 1)) * 100),
                trend,
                population: row.population || null,
                hotspots: row.hotspots || 0,
                reports,
              }
            })
            .filter(row => row.score < 60)
            .sort((a, b) => a.score - b.score)
          : prev.problematic

        setData(prev => ({
          ...prev,
          kpi: normalizedKpi,
          trucks: mappedTrucks,
          rankings: mappedRankings,
          problematic: mappedProblematic,
          issueTrends: trendRows.length
            ? trendRows.map(t => ({
              label: t.date,
              value: t.report_count,
            }))
            : prev.issueTrends,
        }))
      } catch { /* stay on placeholder */ }
      finally { setLoading(false) }
    }
    fetchAll()
  }, [period, selectedBarangay])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ margin: '0 auto 12px' }} />
      Loading analytics…
    </div>
  )

  return (
    <>
      {/* ── Overview KPIs ── */}
      <OverviewKPIs kpi={data.kpi} />

      {/* ── Two-column mid section ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16, alignItems: 'start' }}>
        <div>
          <WasteCollectionChart data={data.wasteDaily} />
          <CollectionEfficiency kpi={data.kpi} />
        </div>
        <div>
          <RankingsSection rankings={data.rankings} problematic={data.problematic} userBarangay={userBarangay} />
        </div>
      </div>

      {/* ── Lower sections ── */}
      <IssueTrendsSection trends={data.issueTrends} hotspots={data.hotspots} />
      <HotspotsSection hotspots={data.hotspots} stats={data.stats} />
      <TruckPerformanceSection trucks={data.trucks} />
      <WasteComposition segments={data.wasteComposition} />

      {/* ── Map ── */}
      <GCard>
        <SHead icon={<Map size={16} />} title="Barangay Cleanliness Map" subtitle="Color-coded by compliance score · Red = active hotspots" />
        <HotspotMap userBarangay={userBarangay} />
      </GCard>
    </>
  )
}
