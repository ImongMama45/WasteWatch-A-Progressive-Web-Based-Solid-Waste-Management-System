/**
 * GlobalInsights.jsx
 * -------------------
 * Public analytics (all roles). Material Symbols icons.
 * Design matches WasteWatch .card / .card-dark system.
 */

import { useState } from 'react'
import BarangayRankingCard from './BarangayRankingCard'
import HotspotMap from './HotspotMap'
import { useAnalytics } from '../../hooks/useAnalytics'

// ─── Shared card shell ────────────────────────────────────────────────────────
function GCard({ children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {children}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHead({ icon, title, subtitle }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        fontSize: 10, fontWeight: 700, letterSpacing: '.09em',
        textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 4,
      }}>
        <span className="msi" style={{ fontSize: 16 }}>{icon}</span>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</div>
      )}
    </div>
  )
}

// ─── KPI strip ────────────────────────────────────────────────────────────────
function KpiStrip({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length},1fr)`, gap: 8, marginBottom: 16 }}>
      {items.map(s => (
        <div key={s.label} style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '10px 8px', textAlign: 'center',
        }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: s.color ?? 'var(--text)' }}>{s.value}</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.04em', marginTop: 2 }}>
            {s.label.toUpperCase()}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── SVG bar chart ───────────────────────────────────────────────────────────
function BarChart({ data, valueKey = 'general' }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
      {data.map((d, i) => {
        const val = d[valueKey] || 0
        const h   = Math.max(Math.round((val / max) * 80), 4)
        const hot = val > (max * 0.8)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ fontSize: 7, color: 'var(--text-muted)', fontWeight: 600 }}>
              {val > 999 ? `${(val / 1000).toFixed(1)}k` : val}
            </div>
            <div style={{
              width: '100%', height: h,
              background: hot ? 'var(--danger)' : 'var(--accent)',
              borderRadius: '4px 4px 0 0', opacity: .75,
            }} />
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── SVG stacked bar ─────────────────────────────────────────────────────────
function StackedChart({ data }) {
  const max = Math.max(...data.map(d => d.organic + d.residual), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
      {data.map((d, i) => {
        const op = Math.round((d.organic  / max) * 80)
        const rp = Math.round((d.residual / max) * 80)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ fontSize: 7, color: 'var(--text-muted)', fontWeight: 600 }}>{d.organic + d.residual}</div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', height: 80, justifyContent: 'flex-end', gap: 1 }}>
              <div style={{ height: op, background: 'var(--accent)', borderRadius: 0, opacity: .7 }} />
              <div style={{ height: rp, background: 'var(--info)',   borderRadius: '4px 4px 0 0', opacity: .7 }} />
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── SVG line chart ───────────────────────────────────────────────────────────
function LineChart({ data, valueKey = 'general' }) {
  if (!data || data.length < 2) return <div style={{ height: 72, background: 'var(--surface-2)', borderRadius: 8 }} />
  const W = 280, H = 72, P = 12
  const vals = data.map(d => d[valueKey] || 0)
  const max  = Math.max(...vals, 1)
  const min  = Math.min(...vals)
  const rng  = max - min || 1
  const pts  = vals.map((v, i) => [
    P + (i / (vals.length - 1)) * (W - P * 2),
    P + ((max - v) / rng) * (H - P * 2),
  ])
  const poly = pts.map(p => p.join(',')).join(' ')
  const area = [`M${pts[0][0]},${H}`, ...pts.map(p => `L${p[0]},${p[1]}`), `L${pts[pts.length-1][0]},${H}`, 'Z'].join(' ')
  const gid  = `lg-${valueKey}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--accent)" stopOpacity=".2" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity=".02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <polyline points={poly} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      ))}
    </svg>
  )
}

// ─── Waste Section ────────────────────────────────────────────────────────────
function WasteSection({ data, stats }) {
  const [chartType, setChartType] = useState('bar')
  const [period, setPeriod]       = useState('week')

  return (
    <GCard>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <SectionHead icon="delete_sweep" title="Waste Generation" subtitle="Daily · Weekly · Monthly data for Lucena City" />
        <div style={{ display: 'flex', gap: 3, background: 'var(--bg)', borderRadius: 8, padding: 3 }}>
          {['week', 'month'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
              background: period === p ? 'var(--surface)' : 'transparent',
              color: period === p ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: period === p ? `2px solid var(--accent)` : '2px solid transparent',
            }}>{p === 'week' ? 'Week' : 'Month'}</button>
          ))}
        </div>
      </div>

      <KpiStrip items={[
        { label: 'Total Reports', value: stats.totalWaste, color: 'var(--text)' },
        { label: 'Organic (est)',     value: stats.totalOrganic, color: 'var(--accent)' },
        { label: 'Residual (est)',    value: stats.totalResidual, color: 'var(--info)' },
      ]} />

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[
          { key: 'bar',     label: 'Bar',     icon: 'bar_chart' },
          { key: 'stacked', label: 'Stacked', icon: 'stacked_bar_chart' },
          { key: 'line',    label: 'Trend',   icon: 'show_chart' },
        ].map(t => (
          <button key={t.key} onClick={() => setChartType(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '5px 11px', borderRadius: 20,
            border: `1px solid ${chartType === t.key ? 'var(--accent)' : 'var(--border)'}`,
            fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)',
            color: chartType === t.key ? 'var(--accent)' : 'var(--text-muted)',
            background: 'transparent',
          }}>
            <span className="msi" style={{ fontSize: 14 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {chartType === 'bar'     && <BarChart     data={data} valueKey="general" />}
      {chartType === 'stacked' && <StackedChart data={data} />}
      {chartType === 'line'    && <LineChart    data={data} valueKey="general" />}

      {chartType === 'stacked' && (
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, background: 'var(--info)', borderRadius: 2 }} /> Residual
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 2 }} /> Organic
          </div>
        </div>
      )}

      <div style={{
        marginTop: 14, padding: '9px 12px', borderRadius: 8,
        background: 'rgba(231,76,60,.06)', border: '1px solid rgba(231,76,60,.2)',
        fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span className="msi" style={{ fontSize: 15, color: 'var(--danger)' }}>trending_up</span>
        <span><strong style={{ color: 'var(--danger)' }}>+12% forecast</strong> for next week based on market-day trends.</span>
      </div>
    </GCard>
  )
}

// ─── Rankings Section ─────────────────────────────────────────────────────────
function RankingsSection({ rankings, problematic, userBarangay }) {
  const [showProb, setShowProb] = useState(false)
  return (
    <GCard>
      <SectionHead icon="leaderboard" title="Barangay Cleanliness Rankings" subtitle="Ranked by compliance ratio · Updated daily" />

      <div style={{ display: 'flex', gap: 3, background: 'var(--bg)', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 14 }}>
        {[
          { key: false, label: 'Top Cleanest', icon: 'emoji_events' },
          { key: true,  label: 'Problematic Areas', icon: 'warning' },
        ].map(t => (
          <button key={String(t.key)} onClick={() => setShowProb(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
            background: showProb === t.key ? 'var(--surface)' : 'transparent',
            color: showProb === t.key ? 'var(--text)' : 'var(--text-muted)',
            borderBottom: showProb === t.key ? '2px solid var(--accent)' : '2px solid transparent',
          }}>
            <span className="msi" style={{ fontSize: 14 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
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

// ─── Hotspots Section ─────────────────────────────────────────────────────────
function HotspotsSection({ hotspots, stats }) {
  const SEV = {
    critical: { color: 'var(--danger)',   bg: 'rgba(231,76,60,.08)',  border: 'rgba(231,76,60,.25)'  },
    high:     { color: 'var(--warning)',  bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.25)' },
    medium:   { color: 'var(--text-muted)',bg:'rgba(0,0,0,.04)',      border: 'var(--border)'        },
    low:      { color: 'var(--text-muted)',bg:'rgba(0,0,0,.04)',      border: 'var(--border)'        },
  }

  return (
    <GCard>
      <SectionHead icon="local_fire_department" title="Illegal Dumping Hotspots" subtitle="Most reported areas · Time-based tracking" />
      <KpiStrip items={[
        { label: 'This Week', value: stats.reportsThisWeek, color: 'var(--danger)' },
        { label: 'Resolution',   value: `${stats.resolutionRate}%`, color: 'var(--accent)' },
        { label: 'Avg Resp',      value: `${stats.avgResponse}d`, color: 'var(--warning)' },
      ]} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {hotspots.slice(0, 5).map((h, i) => {
          const sv = SEV[h.severity] || SEV.medium
          const resRate = Math.round((h.resolved / (h.reports || 1)) * 100)
          return (
            <div key={h.id} style={{
              background: 'var(--surface)',
              border: `1px solid ${sv.border}`,
              borderRadius: 'var(--radius)', padding: '12px 14px',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                background: sv.bg, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 11, fontWeight: 800, color: sv.color,
              }}>#{i + 1}</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{h.location}</span>
                  <span style={{
                    fontSize: 8, fontWeight: 800, padding: '2px 7px', borderRadius: 20,
                    background: sv.bg, color: sv.color, letterSpacing: '.05em',
                  }}>
                    {h.severity.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {h.type} · {h.reports} total reports · {h.reportsWeek} this week
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 20, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: `${resRate}%`, height: '100%', background: 'var(--accent)', borderRadius: 20 }} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
                    {resRate}% resolved
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </GCard>
  )
}

// ─── Map Section ──────────────────────────────────────────────────────────────
function MapSection({ userBarangay }) {
  return (
    <GCard>
      <SectionHead icon="map" title="Barangay Cleanliness Map" subtitle="Color-coded by score · Red dots = active hotspots" />
      <HotspotMap userBarangay={userBarangay} />
    </GCard>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function GlobalInsights({ userBarangay }) {
  const { data, loading } = useAnalytics()

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading analytics...</div>

  return (
    <>
      <WasteSection data={data.wasteDaily} stats={data.stats} />
      <RankingsSection rankings={data.rankings} problematic={data.problematic} userBarangay={userBarangay} />
      <MapSection userBarangay={userBarangay} />
      <HotspotsSection hotspots={data.hotspots} stats={data.stats} />
    </>
  )
}
