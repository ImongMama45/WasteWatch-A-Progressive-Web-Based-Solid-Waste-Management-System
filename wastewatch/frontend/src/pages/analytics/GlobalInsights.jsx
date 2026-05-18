/**
 * GlobalInsights.jsx
 * -------------------
 * Public analytics (all roles). Material Symbols icons.
 * Design matches WasteWatch .card / .card-dark system.
 *
 * Sections:
 *   1. Waste Generation Analytics
 *   2. Barangay Rankings
 *   3. Barangay Map
 *   4. Illegal Dumping Hotspots
 */

import { useState } from 'react'
import BarangayRankingCard from './BarangayRankingCard'
import HotspotMap from './HotspotMap'
import { TOP_BARANGAYS } from '../../components/carousel/RankingModal'

// ─── Mock data ────────────────────────────────────────────────────────────────
// REPLACE WITH: api.get('/api/analytics/global/waste/')
const WASTE_DAILY = [
  { label: 'Mon', organic: 380, residual: 210, general: 590 },
  { label: 'Tue', organic: 420, residual: 230, general: 650 },
  { label: 'Wed', organic: 290, residual: 180, general: 470 },
  { label: 'Thu', organic: 510, residual: 260, general: 770 },
  { label: 'Fri', organic: 480, residual: 250, general: 730 },
  { label: 'Sat', organic: 340, residual: 190, general: 530 },
  { label: 'Sun', organic: 220, residual: 140, general: 360 },
]
const WASTE_MONTHLY = [
  { label: 'Jan', kg: 8400 }, { label: 'Feb', kg: 7800 }, { label: 'Mar', kg: 9200 },
  { label: 'Apr', kg: 8900 }, { label: 'May', kg: 9800 }, { label: 'Jun', kg: 8100 },
]

// REPLACE WITH: api.get('/api/analytics/hotspots/')
const HOTSPOTS = [
  { id: 1, location: 'Near Public Market, Cotta',  type: 'Illegal Dumping', reports: 12, reportsWeek: 4, resolutionDays: 2.1, severity: 'critical', resolved: 8  },
  { id: 2, location: 'Riverside, Kanlurang Cotta', type: 'Overflow',        reports: 9,  reportsWeek: 3, resolutionDays: 1.8, severity: 'high',     resolved: 5  },
  { id: 3, location: 'Gulang-Gulang Crossing',     type: 'Illegal Dumping', reports: 8,  reportsWeek: 2, resolutionDays: 3.2, severity: 'high',     resolved: 4  },
  { id: 4, location: 'Zone 5, Purok 7',            type: 'Missed Pickup',   reports: 6,  reportsWeek: 1, resolutionDays: 1.0, severity: 'medium',   resolved: 6  },
  { id: 5, location: 'Isabang Market Street',      type: 'Overflow',        reports: 5,  reportsWeek: 2, resolutionDays: 2.5, severity: 'medium',   resolved: 3  },
]

const PROBLEMATIC = TOP_BARANGAYS.slice().reverse().slice(0, 5)

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
function WasteSection() {
  const [chartType, setChartType] = useState('bar')
  const [period, setPeriod]       = useState('week')
  const data = period === 'week' ? WASTE_DAILY : WASTE_MONTHLY

  const totalKg      = WASTE_DAILY.reduce((a, d) => a + d.general, 0)
  const totalOrganic = WASTE_DAILY.reduce((a, d) => a + d.organic,  0)
  const totalRes     = WASTE_DAILY.reduce((a, d) => a + d.residual, 0)

  return (
    <GCard>
      {/* Header row */}
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

      {/* KPI strip */}
      <KpiStrip items={[
        { label: 'Total Waste', value: `${(totalKg / 1000).toFixed(1)}t`, color: 'var(--text)' },
        { label: 'Organic',     value: `${(totalOrganic / 1000).toFixed(1)}t`, color: 'var(--accent)' },
        { label: 'Residual',    value: `${(totalRes / 1000).toFixed(1)}t`, color: 'var(--info)' },
      ]} />

      {/* Chart type tabs */}
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

      {/* Charts */}
      {chartType === 'bar'     && <BarChart     data={data} valueKey={period === 'month' ? 'kg' : 'general'} />}
      {chartType === 'stacked' && <StackedChart data={WASTE_DAILY} />}
      {chartType === 'line'    && <LineChart    data={WASTE_DAILY} valueKey="general" />}

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

      {/* Forecast note */}
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
function RankingsSection({ userBarangay }) {
  const [showProb, setShowProb] = useState(false)
  return (
    <GCard>
      <SectionHead icon="leaderboard" title="Barangay Cleanliness Rankings" subtitle="Ranked by compliance ratio · Updated daily" />

      {/* Toggle */}
      <div style={{ display: 'flex', gap: 3, background: 'var(--bg)', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 14 }}>
        {[
          { key: false, label: 'Top 10 Cleanest', icon: 'emoji_events' },
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
        {(showProb ? PROBLEMATIC : TOP_BARANGAYS).map((b, i) => (
          <BarangayRankingCard
            key={b.rank}
            brgy={b}
            rank={showProb ? TOP_BARANGAYS.length - i : b.rank}
            isUser={userBarangay && b.name.toLowerCase() === userBarangay.toLowerCase()}
          />
        ))}
      </div>

      {!showProb && (
        <div style={{
          marginTop: 12, padding: '9px 12px', borderRadius: 8,
          background: 'rgba(46,204,113,.06)', border: '1px solid rgba(46,204,113,.2)',
          fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span className="msi" style={{ fontSize: 15, color: 'var(--accent)' }}>info</span>
          Rankings reset monthly. Scores = waste generated vs. barangay population.
        </div>
      )}
    </GCard>
  )
}

// ─── Hotspots Section ─────────────────────────────────────────────────────────
function HotspotsSection() {
  const SEV = {
    critical: { color: 'var(--danger)',   bg: 'rgba(231,76,60,.08)',  border: 'rgba(231,76,60,.25)'  },
    high:     { color: 'var(--warning)',  bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.25)' },
    medium:   { color: 'var(--text-muted)',bg:'rgba(0,0,0,.04)',      border: 'var(--border)'        },
  }
  const totalReports = HOTSPOTS.reduce((a, h) => a + h.reports, 0)
  const totalResolved = HOTSPOTS.reduce((a, h) => a + h.resolved, 0)
  const avgDays = (HOTSPOTS.reduce((a, h) => a + h.resolutionDays, 0) / HOTSPOTS.length).toFixed(1)

  return (
    <GCard>
      <SectionHead icon="local_fire_department" title="Illegal Dumping Hotspots" subtitle="Most reported areas · Time-based tracking" />
      <KpiStrip items={[
        { label: 'Reports This Week', value: HOTSPOTS.reduce((a, h) => a + h.reportsWeek, 0), color: 'var(--danger)' },
        { label: 'Resolution Rate',   value: `${Math.round((totalResolved / totalReports) * 100)}%`, color: 'var(--accent)' },
        { label: 'Avg Response',      value: `${avgDays}d`, color: 'var(--warning)' },
      ]} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {HOTSPOTS.map((h, i) => {
          const sv = SEV[h.severity]
          const resRate = Math.round((h.resolved / h.reports) * 100)
          return (
            <div key={h.id} style={{
              background: 'var(--surface)',
              border: `1px solid ${sv.border}`,
              borderRadius: 'var(--radius)', padding: '12px 14px',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              {/* Rank */}
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
                {/* Resolution bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 20, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: `${resRate}%`, height: '100%', background: 'var(--accent)', borderRadius: 20 }} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
                    {resRate}% resolved
                  </span>
                </div>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, textAlign: 'right' }}>
                {h.resolutionDays}d avg
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
  return (
    <>
      <WasteSection />
      <RankingsSection userBarangay={userBarangay} />
      <MapSection userBarangay={userBarangay} />
      <HotspotsSection />
    </>
  )
}
