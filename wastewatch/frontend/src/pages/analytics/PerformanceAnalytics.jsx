/**
 * PerformanceAnalytics.jsx
 * -------------------------
 * Truck efficiency · Missed stops · Barangay reports.
 * Redesigned: uses ac-card / ac- CSS classes to match the
 * Analytics Command Center design system.
 * All mock data and logic preserved exactly from document 17.
 */

import { useMemo } from 'react'
import { Trophy, Scale, Route, ClipboardCheck, Truck, Droplet, CheckCircle2, XCircle, TrendingUp, BarChart3, PieChart, Clock, ShieldCheck, ThumbsUp, AlertTriangle, AlertCircle, Hourglass } from 'lucide-react'
import { useLiveAnalytics } from './useLiveAnalytics'
import { toPerf } from './perfMapper'

// ── Chart primitives ──────────────────────────────────────────────────────────

function HBar({ value, max, color, label }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 130, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 20, height: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 20, transition: 'width .5s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, minWidth: 44, textAlign: 'right', color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function TrendLine({ values, labels, color = 'var(--accent)' }) {
  if (!Array.isArray(values) || values.length === 0) {
    return (
      <div style={{
        height: 96,
        borderRadius: 12,
        border: '1px dashed var(--border)',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 12,
        fontWeight: 600,
      }}>
        No data yet
      </div>
    )
  }

  if (values.length === 1) {
    return (
      <div style={{
        height: 96,
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'linear-gradient(180deg, var(--surface), var(--bg))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Single data point</div>
        <div style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800, color }}>
          {values[0]}
        </div>
      </div>
    )
  }

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
          values.length <= 31 && <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {(() => {
          const step = Math.ceil(labels.length / 6)
          return labels.filter((_, i) => i % step === 0 || i === labels.length - 1)
            .map((l, i) => <span key={i} style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{l}</span>)
        })()}
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
              {icon}
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

// one fill rule everywhere: ideal band 60–85%, overflow penalised harder
function fillScore(p) {
  if (p == null) return null
  if (p >= 60 && p <= 85) return 100
  return p > 85 ? Math.max(0, 100 - (p - 85) * 4) : Math.max(0, 100 - (60 - p) * 1.5)
}
function weighted(parts) {               // [[value, weight], ...], nulls skipped
  const live = parts.filter(([v]) => v != null)
  const w = live.reduce((s, [, x]) => s + x, 0)
  return w ? Math.round(live.reduce((s, [v, x]) => s + v * x, 0) / w) : null
}

export default function PerformanceAnalytics({ selectedBarangay, dateFrom, dateTo }) {
  const { raw, loading, error } = useLiveAnalytics({ selectedBarangay, dateFrom, dateTo })
  const data = useMemo(() => toPerf(raw), [raw])

  if (loading && !raw) return <div className="spinner" style={{ margin: '40px auto' }} />
  if (error && !raw) return <div className="ac-card">{error}</div>
  if (!data || (data.kpi.routes === 0 && data.kpi.collected === 0))
    return <div className="ac-card">No collection activity in this range.</div>

  const { kpi, trucks, brgy, trend, trendLabels, issueTypes } = data
  // Use the mapper's pre-computed rate (settled denominator: completed / decided)
  const completionRate = kpi.rate     // null when no stops decided yet
  const resolutionRate = kpi.resRate  // null when no reports
  const topBrgy = [...brgy].sort((a, b) => b.kg - a.kg).slice(0, 8)
  const maxKg = Math.max(...topBrgy.map(b => b.kg), 1)

  return (
    <>
      {(() => {
        // Fleet score: completion rate (70%) + fill quality (30%)
        // Report resolution is a citizen metric, not fleet performance
        const fleetScore = completionRate != null ? weighted([[completionRate, .7], [fillScore(kpi.avgFill), .3]]) : null
        const fleetUtil = kpi.avgFill
        const scoreVariant = fleetScore != null ? (fleetScore >= 80 ? 'green' : fleetScore >= 60 ? 'amber' : 'red') : 'blue'
        // utilVariant: ideal band 60-85% matches fillScore; red only above 85%
        const utilVariant = fleetUtil == null ? 'blue' : fleetUtil > 85 ? 'red' : fleetUtil >= 60 ? 'green' : 'amber'
        const cards = [
          {
            id: 'fleet-score',
            label: 'Fleet Performance Score',
            value: fleetScore ?? '—',
            unit: fleetScore != null ? '/100' : '',
            sub: fleetScore != null ? `${fleetScore >= 80 ? 'Excellent' : fleetScore >= 60 ? 'Good' : 'Needs Attention'} overall` : 'Insufficient data',
            icon: Trophy,
            variant: scoreVariant,
            bar: fleetScore,
          },
          {
            id: 'waste-collected',
            label: 'Total Waste Collected',
            value: kpi.collected >= 1000
              ? `${(kpi.collected / 1000).toFixed(1)}`
              : `${kpi.collected}`,
            unit: kpi.collected >= 1000 ? 't' : 'kg',
            sub: 'weight of deliveries serving this barangay',
            icon: Scale,
            variant: 'blue',
          },
          {
            id: 'route-completion',
            label: 'Stop Completion Rate',
            value: completionRate ?? '—',
            unit: completionRate != null ? '%' : '',
            sub: completionRate != null
              ? `${kpi.completed} of ${kpi.decided} decided stops · ${kpi.pending} pending`
              : `${kpi.pending} stops pending`,
            icon: Route,
            variant: completionRate == null ? 'blue' : completionRate >= 85 ? 'green' : completionRate >= 65 ? 'amber' : 'red',
            bar: completionRate,
          },
          {
            id: 'report-resolution',
            label: 'Report Resolution Rate',
            value: resolutionRate ?? '—',
            unit: resolutionRate != null ? '%' : '',
            sub: resolutionRate != null ? `${kpi.resolved} of ${kpi.reports} reports resolved` : 'No reports',
            icon: ClipboardCheck,
            variant: resolutionRate != null ? (resolutionRate >= 80 ? 'green' : resolutionRate >= 60 ? 'amber' : 'red') : 'blue',
            bar: resolutionRate,
          },
          {
            id: 'fleet-utilization',
            label: 'Fleet Utilization',
            value: fleetUtil ?? '—',
            unit: fleetUtil != null ? '%' : '',
            sub: `avg fill per delivery · ${trucks.length} truck${trucks.length !== 1 ? 's' : ''}`,
            icon: Truck,
            variant: utilVariant,
            bar: fleetUtil,
          },
        ]
        // .filter(c => c.value != null) removed — value is always set (number or '—')

        return (
          <div className="ac-kpi-grid ac-kpi-grid--5" style={{ marginBottom: 20 }}>
            {cards.map(c => {
              const Icon = c.icon;
              return (
                <div key={c.id} className={`ac-kpi-card ac-kpi-card--${c.variant} ac-kpi-card--v2`}>
                  <div className="ac-kpi-v2-glow" />
                  <div className="ac-kpi-v2-head">
                    <div className="ac-kpi-icon">
                      <Icon size={18} />
                    </div>
                    <span className="ac-kpi-label">{c.label}</span>
                  </div>
                  <div className="ac-kpi-v2-val-row">
                    <span className="ac-kpi-value">{c.value}</span>
                    {c.unit && <span className="ac-kpi-v2-unit">{c.unit}</span>}
                  </div>
                  {c.bar != null && (
                    <div className="ac-kpi-v2-track">
                      <div
                        className="ac-kpi-v2-fill"
                        style={{ width: `${Math.min(c.bar, 100)}%` }}
                      />
                    </div>
                  )}
                  {c.sub && <div className="ac-kpi-v2-sub">{c.sub}</div>}
                </div>
              )
            })}
          </div>
        )
      })()}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 16, marginBottom: 16 }}>
        {(() => {
          const ranked = [...trucks]
            .map(t => {
              // Use mapper's pre-computed rate (null for delivery-only / no decided stops)
              const score = t.rate != null
                ? weighted([[t.rate, .7], [fillScore(t.fill), .3]])
                : null
              const status = score == null ? 'none'
                : score >= 85 ? 'top' : score >= 65 ? 'good' : score >= 45 ? 'fair' : 'poor'
              return { ...t, score, status }
            })
            .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
          const STATUS_META = {
            none: { label: 'No Data', bg: 'var(--bg)', color: 'var(--text-muted)', border: 'var(--border)' },
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
            <PaCard icon={<Trophy size={18} />} iconVariant="blue" title="Fleet Performance Leaderboard" subtitle="Per-vehicle score · stops & utilisation">
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <span key={k} style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: m.bg, color: m.color, border: `1px solid ${m.border}`,
                    letterSpacing: '.05em', textTransform: 'uppercase',
                  }}>{m.label}</span>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ranked.map((t, i) => {
                  const sm = STATUS_META[t.status]
                  const isBest = i === 0 && t.score != null
                  const hasMedal = i < 3 && t.score != null
                  const rs = hasMedal ? RANK_STYLES[i] : RANK_STYLES[3]
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
                          fontSize: hasMedal ? 13 : 10, fontWeight: 800,
                        }}>
                          {hasMedal ? rs.label : `#${i + 1}`}
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
                          <div style={{ fontSize: 18, fontWeight: 800, color: sm.color, fontFamily: 'var(--font-head)', lineHeight: 1 }}>{t.score ?? '—'}</div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>{t.score != null ? '/100' : 'no data'}</div>
                        </div>
                      </div>
                      <div style={{ background: 'var(--border)', borderRadius: 20, height: 4, overflow: 'hidden', marginBottom: 7 }}>
                        <div style={{
                          width: `${t.score ?? 0}%`, height: '100%', borderRadius: 20,
                          background: sm.color, transition: 'width .55s cubic-bezier(.4,0,.2,1)',
                        }} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {[
                          { icon: CheckCircle2, val: `${t.completed}/${t.routes}`, label: 'stops', color: 'var(--accent)' },
                          { icon: XCircle, val: t.missed, label: 'missed', color: t.missed > 0 ? 'var(--danger)' : 'var(--text-muted)' },
                          ...(t.fill != null ? [{ icon: Droplet, val: `${t.fill}%`, label: 'fill', color: t.fill > 80 ? 'var(--warning)' : 'var(--info)' }] : []),
                          { icon: Scale, val: `${t.kg.toLocaleString()} kg`, label: 'delivered', color: 'var(--text-muted)' },
                        ].map((p, idx) => {
                          const Icon = p.icon;
                          return (
                            <div key={p.label || idx} style={{
                              display: 'flex', alignItems: 'center', gap: 3,
                              background: 'var(--surface)', border: '1px solid var(--border)',
                              borderRadius: 20, padding: '2px 7px',
                            }}>
                              <Icon size={11} color={p.color} />
                              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{p.val}</span>
                              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{p.label}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </PaCard>
          )
        })()}
        <PaCard icon={<TrendingUp size={18} />} iconVariant="amber" title="Daily Issue Trend" subtitle="Reported incidents per day">
          <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
            {(() => {
              const maxVal = Math.max(...trend, 0)
              const peak = maxVal > 0 ? trend.indexOf(Math.max(...trend)) : -1
              const low = maxVal > 0 ? trend.indexOf(Math.min(...trend.filter(v => v > 0))) : -1
              return [
                { label: 'Peak Day', value: peak >= 0 ? trendLabels[peak] : '—', color: 'var(--danger)' },
                { label: 'Low Day', value: low >= 0 ? trendLabels[low] : '—', color: 'var(--accent)' },
                { label: 'Avg/Day', value: trend.length ? (trend.reduce((a, b) => a + b, 0) / trend.length).toFixed(1) : '—', color: 'var(--warning)' },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: 'var(--font-head)' }}>{s.value}</div>
                </div>
              ))
            })()}
          </div>
          <TrendLine values={trend} labels={trendLabels} color="var(--danger)" />
          {issueTypes && issueTypes.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 8, textTransform: 'uppercase' }}>
                Issue Type Breakdown
              </div>
              {issueTypes.map(r => <HBar key={r.label} label={r.label} value={r.count} max={Math.max(...issueTypes.map(x => x.count), 1)} color="var(--warning)" />)}
            </div>
          )}
        </PaCard>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 16, marginBottom: 16 }}>
        {(() => {
          const ranked = [...brgy]
            .map(b => {
              // resRate comes pre-computed from mapper: null for zero-report barangays
              const resRate = b.resRate
              const needsAttn = resRate != null && b.reports >= 3 && resRate < 60
              const tier = resRate == null ? 'none'
                : resRate >= 85 ? 'excellent' : resRate >= 70 ? 'good' : resRate >= 50 ? 'fair' : 'poor'
              // Score: null for no-data barangays so they sort last
              const score = resRate
              return { ...b, resRate, needsAttn, tier, score }
            })
            // null-safe sort: no-data barangays sink to the bottom
            .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
          const TIER = {
            none: { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border)' },
            excellent: { color: 'var(--accent)', bg: 'rgba(46,204,113,.1)', border: 'rgba(46,204,113,.28)' },
            good: { color: 'var(--info)', bg: 'rgba(93,173,226,.1)', border: 'rgba(93,173,226,.28)' },
            fair: { color: 'var(--warning)', bg: 'rgba(243,156,18,.1)', border: 'rgba(243,156,18,.28)' },
            poor: { color: 'var(--danger)', bg: 'rgba(231,76,60,.1)', border: 'rgba(231,76,60,.28)' },
          }
          const MEDALS = ['🥇', '🥈', '🥉']
          return (
            <PaCard icon={<BarChart3 size={18} />} iconVariant="red" title="Barangay Performance Leaderboard" subtitle="Service score · resolution efficiency · activity">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {ranked.map((b, i) => {
                  const tm = TIER[b.tier]
                  const isTop = i === 0 && b.resRate != null
                  return (
                    <div key={b.name} style={{
                      background: isTop ? 'rgba(246,201,78,.04)' : 'var(--bg)',
                      border: `1px solid ${isTop ? 'rgba(246,201,78,.22)' : tm.border}`,
                      borderRadius: 11, padding: '10px 12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                          background: (i < 3 && b.resRate != null)
                            ? ['linear-gradient(135deg,#f6c94e,#e0a800)', 'linear-gradient(135deg,#c0c7d1,#8e9aaa)', 'linear-gradient(135deg,#d4876a,#a85f3d)'][i]
                            : 'var(--border)',
                          color: (i < 3 && b.resRate != null) ? ['#7a5100', '#3a4350', '#5c2d12'][i] : 'var(--text-muted)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: (i < 3 && b.resRate != null) ? 13 : 10, fontWeight: 800,
                        }}>
                          {(i < 3 && b.resRate != null) ? MEDALS[i] : `#${i + 1}`}
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
                            {b.resRate != null
                              ? `${b.resolved}/${b.reports} resolved · ${b.reports} total reports`
                              : `${b.kg.toLocaleString()} kg collected · no reports`}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: tm.color, fontFamily: 'var(--font-head)', lineHeight: 1 }}>{b.resRate ?? '—'}</div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>{b.resRate != null ? 'res. rate' : 'no data'}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', height: 5, borderRadius: 20, overflow: 'hidden', background: 'var(--border)', marginBottom: 6 }}>
                        {b.resRate != null ? (
                          <>
                            <div style={{ width: `${b.resRate}%`, background: tm.color, transition: 'width .55s cubic-bezier(.4,0,.2,1)' }} />
                            <div style={{ width: `${100 - b.resRate}%`, background: 'rgba(231,76,60,.25)', transition: 'width .55s cubic-bezier(.4,0,.2,1)' }} />
                          </>
                        ) : (
                          <div style={{ width: '100%', background: 'var(--border)' }} />
                        )}
                      </div>
                      {b.resRate != null ? (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 7px',
                          }}>
                            <PieChart size={11} color={tm.color} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{b.resRate}%</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>resolution</span>
                          </div>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 7px',
                          }}>
                            <CheckCircle2 size={11} color="var(--info)" />
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{b.resolved}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>resolved</span>
                          </div>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 7px',
                          }}>
                            <Clock size={11} color={b.reports - b.resolved > 0 ? 'var(--danger)' : 'var(--text-muted)'} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: b.reports - b.resolved > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{b.reports - b.resolved}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>pending</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>No reports submitted in this period</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </PaCard>
          )
        })()}
        <PaCard icon={<Scale size={18} />} iconVariant="blue" title="Waste Collected (kg)" subtitle="Per barangay, current period">
          {/* HBar: shows full names, prevents 'Barangay/Ibabang' label collisions */}
          {topBrgy.map(b => (
            <HBar key={b.name} label={b.name} value={b.kg} max={maxKg} color="var(--info)" />
          ))}
          {brgy.some(b => b.reports > 0) && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 8, marginTop: 12, textTransform: 'uppercase' }}>
                Top Reporters
              </div>
              {[...brgy].filter(b => b.reports > 0).sort((a, b) => b.reports - a.reports).slice(0, 3).map((b, i) => (
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
            </>
          )}
        </PaCard>
      </div>
      {(() => {
        const enriched = trucks.map(t => {
          // Use mapper's rate (null for delivery-only trucks with hasStops=false)
          const reliability = t.hasStops ? t.rate : null
          const completion = t.hasStops ? t.rate : null
          const category = reliability == null ? 'no-data'
            : reliability >= 90 ? 'excellent' : reliability >= 75 ? 'good' : reliability >= 50 ? 'needs-work' : 'critical'
          return { ...t, reliability, completion, category }
        })
        if (!enriched.length) return null
        const withStops = enriched.filter(t => t.reliability != null)
        const fleetAvg = withStops.length
          ? Math.round(withStops.reduce((s, t) => s + t.reliability, 0) / withStops.length)
          : null
        const CAT = {
          'no-data': { label: 'No Stop Data', color: 'var(--text-muted)', bg: 'var(--bg)', border: 'var(--border)', icon: AlertCircle },
          excellent: { label: 'Excellent', color: 'var(--accent)', bg: 'rgba(46,204,113,.1)', border: 'rgba(46,204,113,.3)', icon: ShieldCheck },
          good: { label: 'Good', color: 'var(--info)', bg: 'rgba(93,173,226,.1)', border: 'rgba(93,173,226,.3)', icon: ThumbsUp },
          'needs-work': { label: 'Needs Work', color: 'var(--warning)', bg: 'rgba(243,156,18,.1)', border: 'rgba(243,156,18,.3)', icon: AlertTriangle },
          critical: { label: 'Critical', color: 'var(--danger)', bg: 'rgba(231,76,60,.1)', border: 'rgba(231,76,60,.3)', icon: AlertCircle },
        }
        const catCounts = Object.keys(CAT).map(k => ({
          key: k, ...CAT[k], count: enriched.filter(t => t.category === k).length,
        }))
        return (
          <PaCard icon={<ShieldCheck size={18} />} iconVariant="green" title="Route Reliability Analysis" subtitle="Per-vehicle reliability score · completion rate · fleet average">
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center', marginBottom: 20 }}>
              <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="var(--border)" strokeWidth="8" />
                  <circle
                    cx="40" cy="40" r="32" fill="none"
                    stroke={fleetAvg == null ? 'var(--border)' : fleetAvg >= 90 ? 'var(--accent)' : fleetAvg >= 75 ? 'var(--info)' : fleetAvg >= 50 ? 'var(--warning)' : 'var(--danger)'}
                    strokeWidth="8"
                    strokeDasharray={`${((fleetAvg ?? 0) / 100) * 201} 201`}
                    strokeLinecap="round"
                    transform="rotate(-90 40 40)"
                    style={{ transition: 'stroke-dasharray .7s cubic-bezier(.4,0,.2,1)' }}
                  />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-head)', lineHeight: 1 }}>{fleetAvg ?? '—'}</span>
                  <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>avg</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {catCounts.map(c => {
                  const Icon = c.icon;
                  return (
                    <div key={c.key} style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      background: c.bg, border: `1px solid ${c.border}`,
                      borderRadius: 10, padding: '7px 10px',
                    }}>
                      <Icon size={15} color={c.color} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: c.color }}>{c.label}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{c.count} truck{c.count !== 1 ? 's' : ''}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 2 }}>avg per truck</div>
                <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-head)', lineHeight: 1, color: fleetAvg == null ? 'var(--text-muted)' : fleetAvg >= 90 ? 'var(--accent)' : fleetAvg >= 75 ? 'var(--info)' : fleetAvg >= 50 ? 'var(--warning)' : 'var(--danger)' }}>
                  {fleetAvg ?? '—'}{fleetAvg != null && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>%</span>}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>reliability</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {enriched.map(t => {
                const cm = CAT[t.category]
                const aboveAvg = t.reliability != null && fleetAvg != null && t.reliability >= fleetAvg
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
                      <span style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-head)', color: cm.color, lineHeight: 1 }}>{t.reliability ?? '—'}</span>
                      {t.reliability != null && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>%</span>}
                      {t.reliability != null && fleetAvg != null && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20, marginLeft: 'auto',
                          background: aboveAvg ? 'rgba(46,204,113,.1)' : 'rgba(231,76,60,.1)',
                          color: aboveAvg ? 'var(--accent)' : 'var(--danger)',
                          border: aboveAvg ? '1px solid rgba(46,204,113,.25)' : '1px solid rgba(231,76,60,.25)',
                        }}>
                          {aboveAvg ? '▲' : '▼'} {Math.abs(t.reliability - fleetAvg)}% vs avg
                        </span>
                      )}
                    </div>
                    <div style={{ background: 'var(--border)', borderRadius: 20, height: 5, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{
                        width: `${t.reliability ?? 0}%`, height: '100%', borderRadius: 20,
                        background: cm.color, transition: 'width .55s cubic-bezier(.4,0,.2,1)',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle2 size={12} color="var(--accent)" />
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>
                          {t.completed}/{t.decided}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>decided</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {t.missed > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <XCircle size={12} color="var(--danger)" />
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)' }}>{t.missed}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>missed</span>
                          </div>
                        )}
                        {t.pending > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Hourglass size={12} color="var(--warning)" />
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--warning)' }}>{t.pending}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>pending</span>
                          </div>
                        )}
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
