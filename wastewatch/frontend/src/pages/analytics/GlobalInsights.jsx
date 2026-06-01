/**
 * GlobalInsights.jsx — Smart Waste Management Analytics Center
 * -------------------------------------------------------------
 * Complete UI redesign. All backend integrations, API endpoints,
 * placeholder data, and filtering logic are preserved exactly.
 *
 * Layout:
 *   - CommandKPIRow         (6 executive KPI cards with sparklines)
 *   - ac-workspace          (two-column: 70% main / 30% sidebar)
 *     Left:  WasteCollectionChart → CollectionEfficiency → HotspotIntelligence
 *     Right: BarangayRankings → OperationalInsights → QuickAlerts
 *   - TruckPerformance      (full width)
 *   - ac-bottom-grid        (WasteComposition + Map)
 */

import { useState, useEffect } from 'react'
import BarangayRankingCard from './BarangayRankingCard'
import HotspotMap from './HotspotMap'
import api from '../../api/client'

// ─────────────────────────────────────────────────────────────────────────────
// Micro chart primitives  (all preserved, just used in new layout contexts)
// ─────────────────────────────────────────────────────────────────────────────

/** Tiny sparkline — used inside KPI cards */
function Spark({ values = [], color = 'var(--accent)', w = 64, h = 22 }) {
  if (values.length < 2) return <div style={{ height: h }} />
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const rng = max - min || 1
  const P   = 2
  const pts = values.map((v, i) => [
    P + (i / (values.length - 1)) * (w - P * 2),
    P + ((max - v) / rng) * (h - P * 2),
  ])
  const poly = pts.map(p => p.join(',')).join(' ')
  const area = [
    `M${pts[0][0]},${h}`,
    ...pts.map(p => `L${p[0]},${p[1]}`),
    `L${pts[pts.length - 1][0]},${h}`, 'Z',
  ].join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible">
      <defs>
        <linearGradient id={`spk-${color.replace(/[^a-z0-9]/gi,'')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".18" />
          <stop offset="100%" stopColor={color} stopOpacity=".02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spk-${color.replace(/[^a-z0-9]/gi,'')})`} />
    </svg>
  )
}

/** Standard bar chart */
function MiniBar({ data, valueKey = 'value', color = 'var(--accent)', height = 90 }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }}>
      {data.map((d, i) => {
        const val = d[valueKey] || 0
        const h   = Math.max(Math.round((val / max) * (height - 20)), 4)
        const hot = val > max * 0.8
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ fontSize: 7, color: 'var(--text-muted)', fontWeight: 600 }}>
              {val > 999 ? `${(val / 1000).toFixed(1)}k` : val}
            </div>
            <div style={{
              width: '100%', height: h,
              background: hot ? 'var(--danger)' : color,
              borderRadius: '4px 4px 0 0', opacity: .85,
              transition: 'height .3s ease',
            }} title={`${d.label}: ${val}`} />
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

/** Line + area chart */
function MiniLine({ data, valueKey = 'value', color = 'var(--accent)' }) {
  if (!data || data.length < 2) return <div style={{ height: 80, background: 'var(--bg)', borderRadius: 8 }} />
  const W = 400, H = 80, P = 12
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
        <linearGradient id="ml-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".2" />
          <stop offset="100%" stopColor={color} stopOpacity=".02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ml-grad)" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
      ))}
    </svg>
  )
}

/** Donut chart */
function Donut({ segments, size = 88 }) {
  const total = segments.reduce((s, c) => s + c.value, 0) || 1
  const r = 30, cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circ
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r}
            fill="none" stroke={seg.color} strokeWidth="10"
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-offset}
          />
        )
        offset += dash
        return el
      })}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section card wrapper (replaces old GCard + SHead)
// ─────────────────────────────────────────────────────────────────────────────

function AcCard({ icon, iconVariant, title, subtitle, actions, children, style = {} }) {
  return (
    <div className="ac-card" style={style}>
      <div className="ac-card-head">
        <div className="ac-card-left">
          {icon && (
            <div className={`ac-card-icon${iconVariant ? ` ac-card-icon--${iconVariant}` : ''}`}>
              <span className="msi" style={{ fontSize: 18 }}>{icon}</span>
            </div>
          )}
          <div className="ac-card-titles">
            <div className="ac-card-title">{title}</div>
            {subtitle && <div className="ac-card-sub">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="ac-card-actions">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

function PeriodToggle({ value, onChange, options }) {
  return (
    <div className="ac-period-tog">
      {options.map(o => (
        <button
          key={o.value}
          className={`ac-period-btn${value === o.value ? ' ac-period-btn--active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder data (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────
const PLACEHOLDER = {
  kpi: {
    collected_kg: 4820, collection_rate: 91, active_trucks: 7,
    open_hotspots: 14,  escalations: 3,      barangays_served: 22,
    collected_kg_delta: '+320', collection_rate_delta: '+2%', hotspots_delta: '-3',
    // sparkline histories (7-day)
    spark_waste:  [3800,4100,3600,4400,5100,4600,4820],
    spark_rate:   [87,89,86,90,91,89,91],
    spark_trucks: [6,7,6,7,8,7,7],
    spark_hot:    [17,16,18,15,16,15,14],
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
    { name: 'Gulang-Gulang',  score: 98, compliance: 97, trend: 'up',   population: 4200, hotspots: 0, reports: 2 },
    { name: 'Ibabang Dupay',  score: 95, compliance: 94, trend: 'up',   population: 3800, hotspots: 0, reports: 3 },
    { name: 'Mayao Crossing', score: 92, compliance: 91, trend: 'same', population: 5100, hotspots: 1, reports: 4 },
    { name: 'Cotta',          score: 88, compliance: 87, trend: 'up',   population: 6200, hotspots: 2, reports: 5 },
    { name: 'Isabang',        score: 84, compliance: 83, trend: 'down', population: 4900, hotspots: 2, reports: 7 },
  ],
  improved: [
    { name: 'Dalahican',      score: 79, compliance: 78, trend: 'up',   population: 3900, hotspots: 1, reports: 4 },
    { name: 'Mayao Silangan', score: 82, compliance: 81, trend: 'up',   population: 4100, hotspots: 1, reports: 3 },
    { name: 'Ransohan',       score: 76, compliance: 75, trend: 'up',   population: 2900, hotspots: 2, reports: 6 },
  ],
  problematic: [
    { name: 'Barangay 9',  score: 44, compliance: 48, trend: 'down', population: 3100, hotspots: 8,  reports: 24 },
    { name: 'Barangay 10', score: 51, compliance: 52, trend: 'down', population: 2800, hotspots: 6,  reports: 19 },
    { name: 'Barangay 6',  score: 58, compliance: 60, trend: 'same', population: 3400, hotspots: 5,  reports: 15 },
  ],
  trucks: [
    { truck_id: 'LCN-001', driver_name: 'Juan Dela Cruz',  routes: 18, completed: 17, missed: 1, avg_fill: 88, total_km: '142.5' },
    { truck_id: 'LCN-002', driver_name: 'Ana Mendoza',     routes: 16, completed: 16, missed: 0, avg_fill: 94, total_km: '128.0' },
    { truck_id: 'LCN-003', driver_name: 'Jose Bautista',   routes: 14, completed: 13, missed: 1, avg_fill: 79, total_km: '108.3' },
    { truck_id: 'LCN-004', driver_name: 'Maria Santos',    routes: 15, completed: 15, missed: 0, avg_fill: 91, total_km: '119.7' },
  ],
  issueTrends: [
    { label: 'Jun 1', value: 8  }, { label: 'Jun 2', value: 12 },
    { label: 'Jun 3', value: 7  }, { label: 'Jun 4', value: 15 },
    { label: 'Jun 5', value: 11 }, { label: 'Jun 6', value: 19 },
    { label: 'Jun 7', value: 14 },
  ],
  hotspots: [
    { id: 1, location: 'Purok 3, Barangay 9',  severity: 'critical', type: 'Illegal Dumping', reports: 24, reportsWeek: 8,  resolved: 6  },
    { id: 2, location: 'Market Area, Cotta',    severity: 'high',     type: 'Open Burning',   reports: 18, reportsWeek: 5,  resolved: 7  },
    { id: 3, location: 'Riverside, Isabang',    severity: 'high',     type: 'Illegal Dumping', reports: 15, reportsWeek: 4, resolved: 8  },
    { id: 4, location: 'Highway, Barangay 10',  severity: 'medium',   type: 'Littering',      reports: 11, reportsWeek: 3,  resolved: 9  },
    { id: 5, location: 'Purok 1, Barangay 6',   severity: 'medium',   type: 'Illegal Dumping', reports: 9,  reportsWeek: 2, resolved: 5  },
  ],
  wasteComposition: [
    { label: 'Organic',    value: 42, color: '#22c55e' },
    { label: 'Residual',   value: 31, color: '#3b82f6' },
    { label: 'Recyclable', value: 19, color: '#f59e0b' },
    { label: 'Special',    value: 8,  color: '#ef4444'  },
  ],
  stats: {
    totalWaste: '4,820 kg', totalOrganic: '2,024 kg', totalResidual: '1,494 kg',
    reportsThisWeek: 14, resolutionRate: 68, avgResponse: 2.4,
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Executive KPI Row
// ─────────────────────────────────────────────────────────────────────────────
function CommandKPIRow({ kpi }) {
  const CARDS = [
    {
      key: 'waste',   label: 'Waste Collected',    icon: 'delete_sweep',          variant: 'green',
      value: `${(kpi.collected_kg ?? 0).toLocaleString()} kg`,
      delta: kpi.collected_kg_delta, ddir: '+',
      spark: kpi.spark_waste ?? [], sparkColor: 'var(--accent)',
    },
    {
      key: 'rate',    label: 'Collection Rate',    icon: 'check_circle',           variant: 'green',
      value: `${kpi.collection_rate ?? '—'}%`,
      delta: kpi.collection_rate_delta, ddir: '+',
      spark: kpi.spark_rate ?? [], sparkColor: 'var(--accent)',
    },
    {
      key: 'trucks',  label: 'Active Trucks',       icon: 'local_shipping',         variant: 'blue',
      value: kpi.active_trucks ?? '—',
      delta: null,
      spark: kpi.spark_trucks ?? [], sparkColor: 'var(--info)',
    },
    {
      key: 'hot',     label: 'Open Hotspots',       icon: 'local_fire_department',  variant: 'red',
      value: kpi.open_hotspots ?? '—',
      delta: kpi.hotspots_delta, ddir: '-',
      spark: kpi.spark_hot ?? [], sparkColor: 'var(--danger)',
    },
    {
      key: 'esc',     label: 'Escalations',          icon: 'warning',               variant: 'amber',
      value: kpi.escalations ?? '—',
      delta: null,
      spark: [], sparkColor: 'var(--warning)',
    },
    {
      key: 'brgys',   label: 'Barangays Served',     icon: 'location_city',         variant: 'green',
      value: kpi.barangays_served ?? '—',
      delta: null,
      spark: [], sparkColor: 'var(--accent)',
    },
  ]

  function deltaClass(delta, positiveDir) {
    if (!delta) return 'ac-kpi-delta--flat'
    const starts = delta.startsWith('+') ? '+' : delta.startsWith('-') ? '-' : '='
    if (starts === '=') return 'ac-kpi-delta--flat'
    return starts === positiveDir ? 'ac-kpi-delta--up' : 'ac-kpi-delta--down'
  }

  return (
    <div className="ac-kpi-grid">
      {CARDS.map(c => (
        <div key={c.key} className={`ac-kpi-card ac-kpi-card--${c.variant}`}>
          <div className="ac-kpi-icon">
            <span className="msi" style={{ fontSize: 20 }}>{c.icon}</span>
          </div>
          <div className="ac-kpi-value">{c.value}</div>
          {c.delta && (
            <div className={`ac-kpi-delta ${deltaClass(c.delta, c.ddir)}`}>
              <span className="msi" style={{ fontSize: 10 }}>
                {c.delta.startsWith('+') ? 'trending_up' : c.delta.startsWith('-') ? 'trending_down' : 'trending_flat'}
              </span>
              {c.delta} vs yesterday
            </div>
          )}
          <div className="ac-kpi-label">{c.label}</div>
          {c.spark.length > 1 && (
            <div className="ac-kpi-spark">
              <Spark values={c.spark} color={c.sparkColor} w={80} h={22} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Waste Collection Chart
// ─────────────────────────────────────────────────────────────────────────────
function WasteCollectionChart({ data }) {
  const [period,    setPeriod]    = useState('week')
  const [chartType, setChartType] = useState('bar')

  const topDay = [...data].sort((a, b) => b.value - a.value)[0]

  return (
    <AcCard
      icon="delete_sweep"
      title="Waste Collection Volumes"
      subtitle="Daily totals from dumpsite weighing data"
      actions={
        <>
          <div className="ac-chart-tog">
            {[{ key:'bar',icon:'bar_chart',label:'Bar'},{ key:'line',icon:'show_chart',label:'Trend'}].map(t => (
              <button key={t.key} className={`ac-chart-btn${chartType===t.key?' ac-chart-btn--active':''}`} onClick={() => setChartType(t.key)}>
                <span className="msi" style={{ fontSize: 13 }}>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          <PeriodToggle
            value={period} onChange={setPeriod}
            options={[{value:'day',label:'Day'},{value:'week',label:'Week'},{value:'month',label:'Month'}]}
          />
        </>
      }
    >
      {chartType === 'bar'  && <MiniBar  data={data} valueKey="value" color="var(--accent)" height={110} />}
      {chartType === 'line' && <MiniLine data={data} valueKey="value" />}

      {topDay && (
        <div style={{
          marginTop: 12,
          background: 'var(--bg)',
          border: '1px solid rgba(46,204,113,.2)',
          borderRadius: 9,
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
        }}>
          <span className="msi" style={{ color: 'var(--accent)', fontSize: 16 }}>emoji_events</span>
          <span style={{ color: 'var(--text-muted)' }}>Top collection day:</span>
          <strong style={{ color: 'var(--text)' }}>{topDay.label}</strong>
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{topDay.value.toLocaleString()} kg</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 10, color: 'var(--text-muted)' }}>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ width:9,height:9,borderRadius:2,background:'var(--accent)',display:'inline-block' }}/> Organic
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ width:9,height:9,borderRadius:2,background:'var(--info)',display:'inline-block' }}/> Residual
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ width:9,height:9,borderRadius:2,background:'var(--danger)',display:'inline-block' }}/> High volume (&gt;80%)
        </span>
      </div>
    </AcCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Collection Efficiency Widget (radial)
// ─────────────────────────────────────────────────────────────────────────────
function CollectionEfficiency({ kpi }) {
  const scheduled  = kpi.total_routes  || 40
  const completed  = kpi.completed_routes || 37
  const missed     = scheduled - completed
  const efficiency = Math.round((completed / scheduled) * 100)
  const ringColor  = efficiency >= 90 ? 'var(--accent)' : efficiency >= 75 ? 'var(--warning)' : 'var(--danger)'
  const circ       = 2 * Math.PI * 34

  return (
    <AcCard icon="fact_check" title="Collection Efficiency" subtitle="Scheduled vs. completed routes">
      <div className="ac-eff-wrap">
        {/* Radial ring */}
        <div className="ac-eff-ring-wrap">
          <svg width="96" height="96" viewBox="0 0 96 96" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="48" cy="48" r="34" fill="none" stroke="var(--border)" strokeWidth="9" />
            <circle cx="48" cy="48" r="34" fill="none"
              stroke={ringColor} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${(efficiency / 100) * circ} ${circ}`}
              style={{ transition: 'stroke-dasharray .6s ease' }}
            />
          </svg>
          <div className="ac-eff-center">
            <span className="ac-eff-pct" style={{ color: ringColor }}>{efficiency}%</span>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.06em' }}>RATE</span>
          </div>
        </div>

        {/* Progress rows */}
        <div className="ac-eff-rows">
          {[
            { label: 'SCHEDULED', value: scheduled, total: scheduled, color: 'var(--text-muted)' },
            { label: 'COMPLETED', value: completed, total: scheduled, color: 'var(--accent)'     },
            { label: 'MISSED',    value: missed,    total: scheduled, color: missed > 0 ? 'var(--danger)' : 'var(--text-muted)' },
          ].map(r => (
            <div key={r.label} className="ac-eff-row">
              <div className="ac-eff-row-label">{r.label}</div>
              <div className="ac-eff-bar-track">
                <div className="ac-eff-bar-fill" style={{
                  width: `${(r.value / r.total) * 100}%`,
                  background: r.color,
                }} />
              </div>
              <div className="ac-eff-row-val" style={{ color: r.color }}>{r.value}</div>
            </div>
          ))}
        </div>
      </div>
    </AcCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Hotspot Intelligence
// ─────────────────────────────────────────────────────────────────────────────
function HotspotIntelligence({ hotspots, stats, trends }) {
  return (
    <AcCard icon="local_fire_department" iconVariant="red" title="Hotspot Intelligence" subtitle="Illegal dumping & recurring violation zones">

      {/* Mini stats */}
      <div className="ac-hotspot-stats">
        {[
          { label: 'Reports / Week', val: stats.reportsThisWeek, color: 'var(--danger)'  },
          { label: 'Resolved',       val: `${stats.resolutionRate}%`, color: 'var(--accent)' },
          { label: 'Avg Response',   val: `${stats.avgResponse}d`, color: 'var(--warning)' },
        ].map(s => (
          <div key={s.label} className="ac-mini-stat">
            <div className="ac-mini-stat__val" style={{ color: s.color }}>{s.val}</div>
            <div className="ac-mini-stat__label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Issue trend sparkline */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          7-Day Issue Trend
        </div>
        <MiniLine data={trends} valueKey="value" color="var(--warning)" />
      </div>

      {/* Hotspot list */}
      <div className="ac-hotspot-list">
        {hotspots.slice(0, 4).map((h, i) => {
          const resRate = Math.round((h.resolved / Math.max(h.reports, 1)) * 100)
          return (
            <div key={h.id} className="ac-hotspot-item">
              <div className="ac-hotspot-rank" style={{
                background: h.severity === 'critical' ? 'rgba(231,76,60,.1)' : h.severity === 'high' ? 'rgba(243,156,18,.1)' : 'var(--surface)',
                color:      h.severity === 'critical' ? 'var(--danger)'       : h.severity === 'high' ? 'var(--warning)'      : 'var(--text-muted)',
              }}>#{i + 1}</div>
              <div className="ac-hotspot-body">
                <div className="ac-hotspot-top">
                  <span className="ac-hotspot-location">{h.location}</span>
                  <span className={`ac-sev-badge ac-sev-badge--${h.severity}`}>{h.severity}</span>
                </div>
                <div className="ac-hotspot-meta">{h.type} · {h.reports} total · {h.reportsWeek} this week</div>
                <div className="ac-res-track">
                  <div className="ac-res-bar"><div className="ac-res-fill" style={{ width: `${resRate}%` }} /></div>
                  <span className="ac-res-pct">{resRate}% resolved</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </AcCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Barangay Rankings Sidebar
// ─────────────────────────────────────────────────────────────────────────────
function BarangayRankings({ rankings, improved, problematic, userBarangay }) {
  const [tab, setTab] = useState('clean')
  const TABS = [
    { key: 'clean', label: '🏆 Cleanest' },
    { key: 'impr',  label: '📈 Improved' },
    { key: 'prob',  label: '⚠️ Issues'   },
  ]
  const list = tab === 'clean' ? rankings : tab === 'impr' ? improved : problematic

  const scoreColor = s => s >= 90 ? 'var(--accent)' : s >= 75 ? 'var(--warning)' : 'var(--danger)'
  const TREND_ICON = { up: '↑', down: '↓', same: '→' }
  const TREND_COLOR = { up: 'var(--accent)', down: 'var(--danger)', same: 'var(--text-muted)' }
  const MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#b45309']

  return (
    <AcCard icon="leaderboard" title="Barangay Rankings" subtitle="Daily compliance scores">
      <div className="ac-rank-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`ac-rank-tab${tab===t.key?' ac-rank-tab--active':''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="ac-rank-list">
        {list.map((b, i) => {
          const isUser = userBarangay && b.name.toLowerCase() === userBarangay.toLowerCase()
          const sc = scoreColor(b.score)
          return (
            <div key={b.name} className={`ac-rank-item${isUser?' ac-rank-item--user':''}`}>
              <div className="ac-rank-badge" style={{ color: tab === 'prob' ? 'var(--danger)' : MEDAL_COLORS[i] ?? 'var(--text-muted)' }}>
                {tab === 'prob'
                  ? <span className="msi" style={{ fontSize: 14 }}>warning</span>
                  : i < 3
                    ? <span className="msi" style={{ fontSize: 16 }}>{['looks_one','looks_two','looks_3'][i]}</span>
                    : `#${i+1}`
                }
              </div>

              <div className="ac-rank-info">
                <div className="ac-rank-name" style={{ color: isUser ? 'var(--accent)' : 'var(--text)' }}>
                  {b.name}
                  {isUser && <span className="ac-you-badge">YOU</span>}
                </div>
                <div className="ac-rank-bar-track">
                  <div className="ac-rank-bar-fill" style={{ width: `${b.score}%`, background: sc }} />
                </div>
                <div className="ac-rank-pop">{b.population?.toLocaleString()} residents · {b.hotspots} hotspot{b.hotspots !== 1?'s':''}</div>
              </div>

              <div className="ac-rank-right">
                <div className="ac-rank-score" style={{ color: sc }}>{b.compliance}%</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>compliance</div>
                <div className="ac-rank-trend" style={{ color: TREND_COLOR[b.trend] }}>{TREND_ICON[b.trend]}</div>
              </div>
            </div>
          )
        })}
      </div>
    </AcCard>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// 7. Quick Alerts Sidebar
// ─────────────────────────────────────────────────────────────────────────────
function QuickAlerts({ hotspots, kpi }) {
  const alerts = [
    ...(hotspots.filter(h => h.severity === 'critical').map(h => ({
      title: `Critical: ${h.location}`,
      meta: `${h.reportsWeek} reports this week · ${h.type}`,
      severity: 'critical',
      tag: 'CRITICAL',
    }))),
    ...(kpi.escalations > 0 ? [{
      title: `${kpi.escalations} active escalations`,
      meta: 'Require admin review and assignment',
      severity: 'high',
      tag: 'ESCALATED',
    }] : []),
    ...(hotspots.filter(h => h.severity === 'high').slice(0, 2).map(h => ({
      title: h.location,
      meta: `${h.reports - h.resolved} unresolved of ${h.reports} reports`,
      severity: 'high',
      tag: 'HIGH',
    }))),
    {
      title: `${kpi.open_hotspots ?? 14} open hotspots city-wide`,
      meta: kpi.hotspots_delta ? `${kpi.hotspots_delta} vs yesterday` : 'Monitor for escalation',
      severity: 'medium',
      tag: 'MONITORING',
    },
  ].slice(0, 5)

  return (
    <AcCard icon="notifications_active" iconVariant="red" title="Quick Alerts" subtitle="High-priority items requiring attention">
      <div className="ac-alert-list">
        {alerts.map((a, i) => (
          <div key={i} className="ac-alert-item">
            <div className="ac-alert-dot-wrap">
              <div className={`ac-alert-dot ac-alert-dot--${a.severity}`} />
            </div>
            <div className="ac-alert-body">
              <div className="ac-alert-title">{a.title}</div>
              <div className="ac-alert-meta">{a.meta}</div>
            </div>
            <span className={`ac-alert-tag ac-alert-tag--${a.severity}`}>{a.tag}</span>
          </div>
        ))}
      </div>
    </AcCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────
export default function GlobalInsights({ userBarangay, selectedBarangay, selectedPeriod }) {
  const [data,    setData]    = useState(PLACEHOLDER)
  const [loading, setLoading] = useState(true)

  // ── Data fetching (all endpoints preserved exactly) ──────────────────────
  useEffect(() => {
    async function fetchAll() {
      try {
        const [kpiRes, brgyRes, truckRes, trendRes] = await Promise.allSettled([
          api.get('/api/analytics/kpi/'),
          api.get('/api/analytics/barangay-performance/'),
          api.get('/api/analytics/truck-performance/'),
          api.get('/api/analytics/trends/'),
        ])

        setData(prev => ({
          ...prev,
          kpi: kpiRes.status === 'fulfilled'
            ? { ...prev.kpi, ...(kpiRes.value.data[0] ?? {}) }
            : prev.kpi,
          trucks: truckRes.status === 'fulfilled'
            ? (truckRes.value.data ?? prev.trucks)
            : prev.trucks,
          issueTrends: trendRes.status === 'fulfilled'
            ? trendRes.value.data.map(t => ({ label: t.date, value: t.report_count }))
            : prev.issueTrends,
        }))
      } catch { /* stay on placeholder */ }
      finally { setLoading(false) }
    }
    fetchAll()
  }, [selectedPeriod, selectedBarangay])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
      <div className="spinner" style={{ margin: '0 auto 14px' }} />
      <div style={{ fontSize: 13, fontWeight: 500 }}>Loading analytics data…</div>
    </div>
  )

  return (
    <>
      {/* ── 1. Executive KPIs ── */}
      <div className="ac-bottom-grid">
        <AcCard icon="map" title="Barangay Cleanliness Map" subtitle="Color-coded by compliance score · Red dot = hotspot cluster">
          <HotspotMap userBarangay={userBarangay} />
        </AcCard>
      </div>

      <CommandKPIRow kpi={data.kpi} />

      {/* ── 2. Two-column workspace ── */}
      <div className="ac-workspace">
        {/* Left: main analytics */}
        <div className="ac-main-col">
          <WasteCollectionChart data={data.wasteDaily} />
          <CollectionEfficiency kpi={data.kpi} />
          <HotspotIntelligence hotspots={data.hotspots} stats={data.stats} trends={data.issueTrends} />
        </div>

        {/* Right: sidebar */}
        <div className="ac-aside-col">
          <BarangayRankings
            rankings={data.rankings}
            improved={data.improved}
            problematic={data.problematic}
            userBarangay={userBarangay}
          />
          <QuickAlerts hotspots={data.hotspots} kpi={data.kpi} />
        </div>
      </div>

       

      {/* ── 4. Bottom grid: Composition + Map ── */}
      
    </>
  )
}