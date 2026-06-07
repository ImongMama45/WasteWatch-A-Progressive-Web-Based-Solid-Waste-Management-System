/**
 * PerformanceAnalytics.jsx
 * -------------------------
 * Truck efficiency · Missed stops · Barangay reports.
 * Redesigned: uses ac-card / ac- CSS classes to match the
 * Analytics Command Center design system.
 * All mock data and logic preserved exactly from document 17.
 */

import { useState } from 'react'

// ── Mock Data ─────────────────────────────────────────────────────────────────

const KPI = {
  'This Week': { collected: 2450, routes: 10, completed: 8, missed: 4, avgFill: 71, reports: 24, resolved: 18 },
  'Last Week': { collected: 2180, routes: 10, completed: 9, missed: 3, avgFill: 66, reports: 19, resolved: 15 },
  'This Month': { collected: 9800, routes: 42, completed: 37, missed: 11, avgFill: 74, reports: 91, resolved: 76 },
  'Last Month': { collected: 8700, routes: 40, completed: 35, missed: 14, avgFill: 68, reports: 84, resolved: 62 },
}

const TRUCK_DATA = {
  'This Week': [
    { id: 'LCN-001', driver: 'Juan Dela Cruz', routes: 3, completed: 3, missed: 0, fill: 85, km: 42 },
    { id: 'LCN-002', driver: 'Ana Mendoza', routes: 2, completed: 2, missed: 0, fill: 60, km: 31 },
    { id: 'LCN-004', driver: 'Jose Bautista', routes: 3, completed: 2, missed: 2, fill: 92, km: 38 },
    { id: 'LCN-005', driver: 'Carlo Ramos', routes: 2, completed: 1, missed: 2, fill: 30, km: 19 },
  ],
  'Last Week': [
    { id: 'LCN-001', driver: 'Juan Dela Cruz', routes: 3, completed: 3, missed: 0, fill: 80, km: 40 },
    { id: 'LCN-002', driver: 'Ana Mendoza', routes: 2, completed: 2, missed: 1, fill: 55, km: 28 },
    { id: 'LCN-004', driver: 'Jose Bautista', routes: 3, completed: 3, missed: 0, fill: 88, km: 41 },
    { id: 'LCN-005', driver: 'Carlo Ramos', routes: 2, completed: 1, missed: 2, fill: 40, km: 22 },
  ],
  'This Month': [
    { id: 'LCN-001', driver: 'Juan Dela Cruz', routes: 12, completed: 12, missed: 0, fill: 83, km: 168 },
    { id: 'LCN-002', driver: 'Ana Mendoza', routes: 10, completed: 9, missed: 2, fill: 61, km: 134 },
    { id: 'LCN-004', driver: 'Jose Bautista', routes: 12, completed: 10, missed: 4, fill: 90, km: 155 },
    { id: 'LCN-005', driver: 'Carlo Ramos', routes: 8, completed: 6, missed: 5, fill: 35, km: 98 },
  ],
  'Last Month': [
    { id: 'LCN-001', driver: 'Juan Dela Cruz', routes: 11, completed: 11, missed: 0, fill: 79, km: 162 },
    { id: 'LCN-002', driver: 'Ana Mendoza', routes: 10, completed: 8, missed: 3, fill: 58, km: 128 },
    { id: 'LCN-004', driver: 'Jose Bautista', routes: 11, completed: 9, missed: 5, fill: 86, km: 148 },
    { id: 'LCN-005', driver: 'Carlo Ramos', routes: 8, completed: 7, missed: 6, fill: 42, km: 104 },
  ],
}

const BRGY_DATA = {
  'This Week': [
    { name: 'Isabang', reports: 7, resolved: 6, kg: 520 },
    { name: 'Cotta', reports: 5, resolved: 3, kg: 470 },
    { name: 'Gulang-Gulang', reports: 4, resolved: 2, kg: 290 },
    { name: 'Ibabang Dupay', reports: 3, resolved: 3, kg: 380 },
    { name: 'Kanlurang', reports: 3, resolved: 2, kg: 310 },
    { name: 'Mayao Crossing', reports: 2, resolved: 2, kg: 480 },
  ],
  'This Month': [
    { name: 'Isabang', reports: 28, resolved: 24, kg: 2080 },
    { name: 'Cotta', reports: 21, resolved: 16, kg: 1880 },
    { name: 'Gulang-Gulang', reports: 17, resolved: 12, kg: 1160 },
    { name: 'Ibabang Dupay', reports: 12, resolved: 12, kg: 1520 },
    { name: 'Kanlurang', reports: 10, resolved: 8, kg: 1240 },
    { name: 'Mayao Crossing', reports: 9, resolved: 9, kg: 1920 },
  ],
}
BRGY_DATA['Last Week'] = BRGY_DATA['This Week'].map(b => ({ ...b, reports: Math.max(1, b.reports - 1), resolved: Math.max(0, b.resolved - 1) }))
BRGY_DATA['Last Month'] = BRGY_DATA['This Month'].map(b => ({ ...b, reports: Math.round(b.reports * .9), resolved: Math.round(b.resolved * .85) }))

const TREND_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TREND_DATA = {
  'This Week': [5, 3, 6, 4, 4, 2],
  'Last Week': [4, 2, 5, 3, 3, 2],
  'This Month': [5, 3, 6, 4, 4, 2],
  'Last Month': [4, 3, 5, 3, 4, 1],
}

// ── Chart primitives ──────────────────────────────────────────────────────────

function Bar({ value, max, color, height = 80 }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1 }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{value}</span>
      <div style={{
        width: '100%', height, background: 'var(--bg)', borderRadius: '4px 4px 0 0',
        display: 'flex', alignItems: 'flex-end', overflow: 'hidden', border: '1px solid var(--border)'
      }}>
        <div style={{ width: '100%', height: `${pct}%`, background: color, borderRadius: '4px 4px 0 0', transition: 'height .5s' }} />
      </div>
    </div>
  )
}

function HBar({ value, max, color, label }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 96, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 20, height: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 20, transition: 'width .5s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, width: 24, textAlign: 'right', color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function FillBar({ pct }) {
  const color = pct > 80 ? 'var(--danger)' : pct > 55 ? 'var(--warning)' : 'var(--accent)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 20, height: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 20, transition: 'width .5s' }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 700, width: 32, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

function TrendLine({ values, labels, color = 'var(--accent)' }) {
  const max = Math.max(...values, 1)
  const H = 80, W = 280
  const pts = values.map((v, i) => [
    Math.round((i / (values.length - 1)) * W),
    Math.round(H - (v / max) * (H - 10)),
  ])
  const poly = pts.map(p => p.join(',')).join(' ')
  const area = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          <linearGradient id="tg-perf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${area} L${W},${H} L0,${H} Z`} fill="url(#tg-perf)" />
        <polyline points={poly} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {labels.map(l => <span key={l} style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{l}</span>)}
      </div>
    </div>
  )
}

// ── Section card (mirrors AcCard from GlobalInsights) ─────────────────────────

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

export default function PerformanceAnalytics({ selectedBarangay, selectedPeriod, selectedRoute }) {
  const period = selectedPeriod || 'This Week'
  const kpi = KPI[period] || KPI['This Week']

  const trucks = TRUCK_DATA[period] || TRUCK_DATA['This Week']
  const brgy = BRGY_DATA[period] || BRGY_DATA['This Week']
  const trend = TREND_DATA[period] || TREND_DATA['This Week']

  const completionRate = Math.round((kpi.completed / kpi.routes) * 100)
  const resolutionRate = Math.round((kpi.resolved / kpi.reports) * 100)
  const maxKg = Math.max(...brgy.map(b => b.kg))

  return (
    <>
      {(() => {
        const fleetScore = Math.round((completionRate * 0.5) + (resolutionRate * 0.3) + (kpi.avgFill * 0.2))
        const fleetUtil = kpi.avgFill
        const scoreVariant = fleetScore >= 80 ? 'green' : fleetScore >= 60 ? 'amber' : 'red'
        const utilVariant = fleetUtil >= 80 ? 'red' : fleetUtil >= 55 ? 'amber' : 'green'
        const cards = [
          {
            id: 'fleet-score',
            label: 'Fleet Performance Score',
            value: fleetScore,
            unit: '/100',
            sub: `${fleetScore >= 80 ? 'Excellent' : fleetScore >= 60 ? 'Good' : 'Needs Attention'} overall`,
            icon: 'emoji_events',
            variant: scoreVariant,
            ring: fleetScore,
          },
          {
            id: 'waste-collected',
            label: 'Total Waste Collected',
            value: `${(kpi.collected / 1000).toFixed(1)}`,
            unit: 't',
            sub: `${kpi.collected.toLocaleString()} kg this period`,
            icon: 'scale',
            variant: 'blue',
          },
          {
            id: 'route-completion',
            label: 'Route Completion Rate',
            value: completionRate,
            unit: '%',
            sub: `${kpi.completed} of ${kpi.routes} routes done`,
            icon: 'route',
            variant: completionRate >= 85 ? 'green' : completionRate >= 65 ? 'amber' : 'red',
            bar: completionRate,
          },
          {
            id: 'report-resolution',
            label: 'Report Resolution Rate',
            value: resolutionRate,
            unit: '%',
            sub: `${kpi.resolved} of ${kpi.reports} reports resolved`,
            icon: 'task_alt',
            variant: resolutionRate >= 80 ? 'green' : resolutionRate >= 60 ? 'amber' : 'red',
            bar: resolutionRate,
          },
          {
            id: 'fleet-utilization',
            label: 'Fleet Utilization',
            value: fleetUtil,
            unit: '%',
            sub: `avg bin fill across ${trucks.length} trucks`,
            icon: 'local_shipping',
            variant: utilVariant,
            bar: fleetUtil,
          },
        ]
        return (
          <div className="ac-kpi-grid ac-kpi-grid--5" style={{ marginBottom: 20 }}>
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
        )
      })()}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {(() => {
          const ranked = [...trucks]
            .map(t => {
              const compScore = t.routes > 0 ? (t.completed / t.routes) * 100 : 0
              const missScore = t.routes > 0 ? Math.max(0, 100 - (t.missed / t.routes) * 100) : 100
              const fillScore = t.fill > 80 ? 60 : t.fill > 40 ? 85 : 100   // penalise over-fill
              const score = Math.round(compScore * 0.5 + missScore * 0.3 + fillScore * 0.2)
              const status = score >= 85 ? 'top' : score >= 65 ? 'good' : score >= 45 ? 'fair' : 'poor'
              return { ...t, score, status }
            })
            .sort((a, b) => b.score - a.score)
          const STATUS_META = {
            top: { label: 'Top', bg: 'rgba(46,204,113,.12)', color: 'var(--accent)', border: 'rgba(46,204,113,.3)' },
            good: { label: 'Good', bg: 'rgba(93,173,226,.12)', color: 'var(--info)', border: 'rgba(93,173,226,.3)' },
            fair: { label: 'Fair', bg: 'rgba(243,156,18,.12)', color: 'var(--warning)', border: 'rgba(243,156,18,.3)' },
            poor: { label: 'At Risk', bg: 'rgba(231,76,60,.12)', color: 'var(--danger)', border: 'rgba(231,76,60,.3)' },
          }
          const RANK_STYLES = [
            { bg: 'linear-gradient(135deg,#f6c94e,#e0a800)', color: '#7a5100', label: '🥇' },
            { bg: 'linear-gradient(135deg,#c0c7d1,#8e9aaa)', color: '#3a4350', label: '🥈' },
            { bg: 'linear-gradient(135deg,#d4876a,#a85f3d)', color: '#5c2d12', label: '🥉' },
            { bg: 'var(--border)', color: 'var(--text-muted)', label: '' },
          ]
          return (
            <PaCard icon="emoji_events" iconVariant="blue" title="Fleet Performance Leaderboard" subtitle="Per-vehicle score · routes, stops & utilisation">
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <span key={k} style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: m.bg, color: m.color, border: `1px solid ${m.border}`,
                    letterSpacing: '.05em', textTransform: 'uppercase',
                  }}>{ m.label }</span>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ranked.map((t, i) => {
                  const rs = RANK_STYLES[Math.min(i, 3)]
                  const sm = STATUS_META[t.status]
                  const isBest = i === 0
                  return (
                    <div key={t.id} style={{
                      background: isBest ? 'rgba(246,201,78,.05)' : 'var(--bg)',
                      border: `1px solid ${isBest ? 'rgba(246,201,78,.25)' : 'var(--border)'}`,
                      borderRadius: 12,
                      padding: '10px 12px',
                      transition: 'border-color .18s, transform .18s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                          background: rs.bg, color: rs.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: i < 3 ? 13 : 10, fontWeight: 800,
                        }}>
                          {i < 3 ? rs.label : `#${i + 1}`}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{t.id}</span>
                            {isBest && (
                              <span style={{
                                fontSize: 8, fontWeight: 800, padding: '1px 6px', borderRadius: 20,
                                background: 'rgba(246,201,78,.18)', color: '#c8930a',
                                border: '1px solid rgba(246,201,78,.4)', textTransform: 'uppercase', letterSpacing: '.06em',
                              }}>Best</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.driver}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, flexShrink: 0,
                          background: sm.bg, color: sm.color, border: `1px solid ${sm.border}`,
                          textTransform: 'uppercase', letterSpacing: '.05em',
                        }}>{sm.label}</span>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: sm.color, fontFamily: 'var(--font-head)', lineHeight: 1 }}>{t.score}</div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>/100</div>
                        </div>
                      </div>
                      <div style={{ background: 'var(--border)', borderRadius: 20, height: 4, overflow: 'hidden', marginBottom: 7 }}>
                        <div style={{
                          width: `${t.score}%`, height: '100%', borderRadius: 20,
                          background: sm.color, transition: 'width .55s cubic-bezier(.4,0,.2,1)',
                        }} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[
                          { icon: 'check_circle', val: `${t.completed}/${t.routes}`, label: 'routes', color: 'var(--accent)' },
                          { icon: 'cancel', val: t.missed, label: 'missed', color: t.missed > 0 ? 'var(--danger)' : 'var(--text-muted)' },
                          { icon: 'water_drop', val: `${t.fill}%`, label: 'fill', color: t.fill > 80 ? 'var(--warning)' : 'var(--info)' },
                          { icon: 'route', val: `${t.km} km`, label: 'driven', color: 'var(--text-muted)' },
                        ].map(p => (
                          <div key={p.label} style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            background: 'var(--surface)', border: '1px solid var(--border)',
                            borderRadius: 20, padding: '2px 7px',
                          }}>
                            <span className="msi" style={{ fontSize: 11, color: p.color }}>{p.icon}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{p.val}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{p.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </PaCard>
          )
        })()}
        <PaCard icon="trending_up" iconVariant="amber" title="Daily Issue Trend" subtitle="Reported incidents per day">
          <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
            {[
              { label: 'Peak Day', value: TREND_LABELS[trend.indexOf(Math.max(...trend))], color: 'var(--danger)' },
              { label: 'Low Day', value: TREND_LABELS[trend.indexOf(Math.min(...trend))], color: 'var(--accent)' },
              { label: 'Avg/Day', value: (trend.reduce((a, b) => a + b, 0) / trend.length).toFixed(1), color: 'var(--warning)' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'var(--font-head)' }}>{s.value}</div>
              </div>
            ))}
          </div>
          <TrendLine values={trend} labels={TREND_LABELS} color="var(--danger)" />
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 8, textTransform: 'uppercase' }}>
              Issue Type Breakdown
            </div>
            {[
              { label: 'Overflow', val: 9, color: 'var(--danger)' },
              { label: 'Illegal Dumping', val: 7, color: 'var(--warning)' },
              { label: 'Missed Pickup', val: 5, color: 'var(--info)' },
              { label: 'Other', val: 3, color: 'var(--text-muted)' },
            ].map(r => <HBar key={r.label} label={r.label} value={r.val} max={10} color={r.color} />)}
          </div>
        </PaCard>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {(() => {
          const maxReports = Math.max(...brgy.map(b => b.reports), 1)
          const ranked = [...brgy]
            .map(b => {
              const resRate = Math.round((b.resolved / Math.max(b.reports, 1)) * 100)
              const density = Math.round((b.reports / maxReports) * 100)
              const score = Math.round(resRate * 0.6 + density * 0.4)
              const needsAttn = resRate < 60
              const tier = resRate >= 85 ? 'excellent' : resRate >= 70 ? 'good' : resRate >= 50 ? 'fair' : 'poor'
              return { ...b, resRate, density, score, needsAttn, tier }
            })
            .sort((a, b) => b.score - a.score)
          const TIER = {
            excellent: { color: 'var(--accent)', bg: 'rgba(46,204,113,.1)', border: 'rgba(46,204,113,.28)' },
            good: { color: 'var(--info)', bg: 'rgba(93,173,226,.1)', border: 'rgba(93,173,226,.28)' },
            fair: { color: 'var(--warning)', bg: 'rgba(243,156,18,.1)', border: 'rgba(243,156,18,.28)' },
            poor: { color: 'var(--danger)', bg: 'rgba(231,76,60,.1)', border: 'rgba(231,76,60,.28)' },
          }
          const MEDALS = ['🥇', '🥈', '🥉']
          return (
            <PaCard icon="leaderboard" iconVariant="red" title="Barangay Performance Leaderboard" subtitle="Service score · resolution efficiency · activity">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {ranked.map((b, i) => {
                  const tm = TIER[b.tier]
                  const isTop = i === 0
                  return (
                    <div key={b.name} style={{
                      background: isTop ? 'rgba(246,201,78,.04)' : 'var(--bg)',
                      border: `1px solid ${isTop ? 'rgba(246,201,78,.22)' : tm.border}`,
                      borderRadius: 11, padding: '10px 12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                          background: i < 3
                            ? ['linear-gradient(135deg,#f6c94e,#e0a800)', 'linear-gradient(135deg,#c0c7d1,#8e9aaa)', 'linear-gradient(135deg,#d4876a,#a85f3d)'][i]
                            : 'var(--border)',
                          color: i < 3 ? ['#7a5100', '#3a4350', '#5c2d12'][i] : 'var(--text-muted)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: i < 3 ? 13 : 10, fontWeight: 800,
                        }}>
                          {i < 3 ? MEDALS[i] : `#${i + 1}`}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                            {isTop && (
                              <span style={{
                                fontSize: 8, fontWeight: 800, padding: '1px 6px', borderRadius: 20, flexShrink: 0,
                                background: 'rgba(246,201,78,.18)', color: '#c8930a', border: '1px solid rgba(246,201,78,.4)',
                                textTransform: 'uppercase', letterSpacing: '.06em',
                              }}>Best</span>
                            )}
                            {b.needsAttn && (
                              <span style={{
                                fontSize: 8, fontWeight: 800, padding: '1px 6px', borderRadius: 20, flexShrink: 0,
                                background: 'rgba(231,76,60,.12)', color: 'var(--danger)', border: '1px solid rgba(231,76,60,.3)',
                                textTransform: 'uppercase', letterSpacing: '.06em',
                              }}>⚠ Needs Attention</span>
                            )}
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                            {b.resolved}/{b.reports} resolved · {b.reports} total reports
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: tm.color, fontFamily: 'var(--font-head)', lineHeight: 1 }}>{b.score}</div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>score</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', height: 5, borderRadius: 20, overflow: 'hidden', background: 'var(--border)', marginBottom: 6 }}>
                        <div style={{ width: `${b.resRate}%`, background: tm.color, transition: 'width .55s cubic-bezier(.4,0,.2,1)' }} />
                        <div style={{ width: `${100 - b.resRate}%`, background: 'rgba(231,76,60,.25)', transition: 'width .55s cubic-bezier(.4,0,.2,1)' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 3,
                          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 7px',
                        }}>
                          <span className="msi" style={{ fontSize: 11, color: tm.color }}>pie_chart</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{b.resRate}%</span>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>resolution</span>
                        </div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 3,
                          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 7px',
                        }}>
                          <span className="msi" style={{ fontSize: 11, color: 'var(--info)' }}>check_circle</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{b.resolved}</span>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>resolved</span>
                        </div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 3,
                          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 7px',
                        }}>
                          <span className="msi" style={{ fontSize: 11, color: b.reports - b.resolved > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>pending</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: b.reports - b.resolved > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{b.reports - b.resolved}</span>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>pending</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </PaCard>
          )
        })()}
        <PaCard icon="scale" iconVariant="blue" title="Waste Collected (kg)" subtitle="Per barangay, current period">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100, marginBottom: 8 }}>
            {brgy.map(b => <Bar key={b.name} value={b.kg} max={maxKg} color="var(--info)" height={100} />)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
            {brgy.map(b => (
              <span key={b.name} style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', flex: 1, lineHeight: 1.3 }}>
                {b.name.split(' ')[0]}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 8, textTransform: 'uppercase' }}>
            Top Reporters
          </div>
          {[...brgy].sort((a, b) => b.reports - a.reports).slice(0, 3).map((b, i) => (
            <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: ['var(--danger)', 'var(--warning)', 'var(--accent)'][i],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 9, fontWeight: 800,
              }}>{i + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{b.name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>{b.reports} reports</span>
            </div>
          ))}
        </PaCard>
      </div>
      {(() => {
        const enriched = trucks.map(t => {
          const missRate = t.routes > 0 ? (t.missed / t.routes) * 100 : 0
          const reliability = Math.round(100 - missRate)
          const completion = t.routes > 0 ? Math.round((t.completed / t.routes) * 100) : 0
          const category = reliability >= 90 ? 'excellent' : reliability >= 75 ? 'good' : reliability >= 50 ? 'needs-work' : 'critical'
          return { ...t, missRate, reliability, completion, category }
        })
        const fleetAvg = Math.round(enriched.reduce((s, t) => s + t.reliability, 0) / enriched.length)
        const CAT = {
          excellent: { label: 'Excellent', color: 'var(--accent)', bg: 'rgba(46,204,113,.1)', border: 'rgba(46,204,113,.3)', icon: 'verified' },
          good: { label: 'Good', color: 'var(--info)', bg: 'rgba(93,173,226,.1)', border: 'rgba(93,173,226,.3)', icon: 'thumb_up' },
          'needs-work': { label: 'Needs Work', color: 'var(--warning)', bg: 'rgba(243,156,18,.1)', border: 'rgba(243,156,18,.3)', icon: 'warning' },
          critical: { label: 'Critical', color: 'var(--danger)', bg: 'rgba(231,76,60,.1)', border: 'rgba(231,76,60,.3)', icon: 'error' },
        }
        const catCounts = Object.keys(CAT).map(k => ({
          key: k, ...CAT[k], count: enriched.filter(t => t.category === k).length,
        }))
        return (
          <PaCard icon="verified_user" iconVariant="green" title="Route Reliability Analysis" subtitle="Per-vehicle reliability score · completion rate · fleet average">
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center', marginBottom: 20 }}>
              <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="var(--border)" strokeWidth="8" />
                  <circle
                    cx="40" cy="40" r="32" fill="none"
                    stroke={fleetAvg >= 90 ? 'var(--accent)' : fleetAvg >= 75 ? 'var(--info)' : fleetAvg >= 50 ? 'var(--warning)' : 'var(--danger)'}
                    strokeWidth="8"
                    strokeDasharray={`${(fleetAvg / 100) * 201} 201`}
                    strokeLinecap="round"
                    transform="rotate(-90 40 40)"
                    style={{ transition: 'stroke-dasharray .7s cubic-bezier(.4,0,.2,1)' }}
                  />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-head)', lineHeight: 1 }}>{fleetAvg}</span>
                  <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>avg</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {catCounts.map(c => (
                  <div key={c.key} style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    background: c.bg, border: `1px solid ${c.border}`,
                    borderRadius: 10, padding: '7px 10px',
                  }}>
                    <span className="msi" style={{ fontSize: 15, color: c.color }}>{c.icon}</span>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: c.color }}>{c.label}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{c.count} truck{c.count !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 2 }}>Fleet avg</div>
                <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-head)', lineHeight: 1, color: fleetAvg >= 90 ? 'var(--accent)' : fleetAvg >= 75 ? 'var(--info)' : fleetAvg >= 50 ? 'var(--warning)' : 'var(--danger)' }}>
                  {fleetAvg}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>%</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>reliability</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {enriched.map(t => {
                const cm = CAT[t.category]
                const aboveAvg = t.reliability >= fleetAvg
                return (
                  <div key={t.id} style={{
                    background: 'var(--bg)', border: `1px solid ${cm.border}`,
                    borderRadius: 12, padding: '12px 14px', position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{
                      position: 'absolute', top: -20, right: -20, width: 60, height: 60,
                      borderRadius: '50%', background: cm.bg, pointerEvents: 'none',
                    }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{t.id}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{t.driver}</div>
                      </div>
                      <span style={{
                        fontSize: 8, fontWeight: 800, padding: '2px 7px', borderRadius: 20,
                        background: cm.bg, color: cm.color, border: `1px solid ${cm.border}`,
                        textTransform: 'uppercase', letterSpacing: '.05em', flexShrink: 0,
                      }}>{cm.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-head)', color: cm.color, lineHeight: 1 }}>{t.reliability}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>%</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, marginLeft: 'auto',
                        background: aboveAvg ? 'rgba(46,204,113,.1)' : 'rgba(231,76,60,.1)',
                        color: aboveAvg ? 'var(--accent)' : 'var(--danger)',
                        border: aboveAvg ? '1px solid rgba(46,204,113,.25)' : '1px solid rgba(231,76,60,.25)',
                      }}>
                        {aboveAvg ? '▲' : '▼'} {Math.abs(t.reliability - fleetAvg)}% vs avg
                      </span>
                    </div>
                    <div style={{ background: 'var(--border)', borderRadius: 20, height: 5, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{
                        width: `${t.reliability}%`, height: '100%', borderRadius: 20,
                        background: cm.color, transition: 'width .55s cubic-bezier(.4,0,.2,1)',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="msi" style={{ fontSize: 12, color: 'var(--accent)' }}>check_circle</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{t.completion}%</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>completion</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="msi" style={{ fontSize: 12, color: t.missed > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>cancel</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: t.missed > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{t.missed}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>missed</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </PaCard>
        )
      })()}
    </>
  )
}