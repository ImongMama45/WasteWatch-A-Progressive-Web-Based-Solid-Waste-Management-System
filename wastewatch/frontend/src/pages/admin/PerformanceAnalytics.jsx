import { useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'

// ── Mock Data ─────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = ['This Week', 'Last Week', 'This Month', 'Last Month']

const KPI = {
  'This Week':  { collected: 2450, routes: 10, completed: 8,  missed: 4,  avgFill: 71, reports: 24, resolved: 18 },
  'Last Week':  { collected: 2180, routes: 10, completed: 9,  missed: 3,  avgFill: 66, reports: 19, resolved: 15 },
  'This Month': { collected: 9800, routes: 42, completed: 37, missed: 11, avgFill: 74, reports: 91, resolved: 76 },
  'Last Month': { collected: 8700, routes: 40, completed: 35, missed: 14, avgFill: 68, reports: 84, resolved: 62 },
}

const TRUCK_DATA = {
  'This Week': [
    { id: 'LCN-001', driver: 'Juan Dela Cruz',  routes: 3, completed: 3, missed: 0, fill: 85, km: 42 },
    { id: 'LCN-002', driver: 'Ana Mendoza',     routes: 2, completed: 2, missed: 0, fill: 60, km: 31 },
    { id: 'LCN-004', driver: 'Jose Bautista',   routes: 3, completed: 2, missed: 2, fill: 92, km: 38 },
    { id: 'LCN-005', driver: 'Carlo Ramos',     routes: 2, completed: 1, missed: 2, fill: 30, km: 19 },
  ],
  'Last Week': [
    { id: 'LCN-001', driver: 'Juan Dela Cruz',  routes: 3, completed: 3, missed: 0, fill: 80, km: 40 },
    { id: 'LCN-002', driver: 'Ana Mendoza',     routes: 2, completed: 2, missed: 1, fill: 55, km: 28 },
    { id: 'LCN-004', driver: 'Jose Bautista',   routes: 3, completed: 3, missed: 0, fill: 88, km: 41 },
    { id: 'LCN-005', driver: 'Carlo Ramos',     routes: 2, completed: 1, missed: 2, fill: 40, km: 22 },
  ],
  'This Month': [
    { id: 'LCN-001', driver: 'Juan Dela Cruz',  routes: 12, completed: 12, missed: 0,  fill: 83, km: 168 },
    { id: 'LCN-002', driver: 'Ana Mendoza',     routes: 10, completed: 9,  missed: 2,  fill: 61, km: 134 },
    { id: 'LCN-004', driver: 'Jose Bautista',   routes: 12, completed: 10, missed: 4,  fill: 90, km: 155 },
    { id: 'LCN-005', driver: 'Carlo Ramos',     routes: 8,  completed: 6,  missed: 5,  fill: 35, km: 98  },
  ],
  'Last Month': [
    { id: 'LCN-001', driver: 'Juan Dela Cruz',  routes: 11, completed: 11, missed: 0,  fill: 79, km: 162 },
    { id: 'LCN-002', driver: 'Ana Mendoza',     routes: 10, completed: 8,  missed: 3,  fill: 58, km: 128 },
    { id: 'LCN-004', driver: 'Jose Bautista',   routes: 11, completed: 9,  missed: 5,  fill: 86, km: 148 },
    { id: 'LCN-005', driver: 'Carlo Ramos',     routes: 8,  completed: 7,  missed: 6,  fill: 42, km: 104 },
  ],
}

const BRGY_DATA = {
  'This Week':  [
    { name: 'Isabang',        reports: 7,  resolved: 6,  kg: 520 },
    { name: 'Cotta',          reports: 5,  resolved: 3,  kg: 470 },
    { name: 'Gulang-Gulang',  reports: 4,  resolved: 2,  kg: 290 },
    { name: 'Ibabang Dupay',  reports: 3,  resolved: 3,  kg: 380 },
    { name: 'Kanlurang',      reports: 3,  resolved: 2,  kg: 310 },
    { name: 'Mayao Crossing', reports: 2,  resolved: 2,  kg: 480 },
  ],
  'This Month': [
    { name: 'Isabang',        reports: 28, resolved: 24, kg: 2080 },
    { name: 'Cotta',          reports: 21, resolved: 16, kg: 1880 },
    { name: 'Gulang-Gulang',  reports: 17, resolved: 12, kg: 1160 },
    { name: 'Ibabang Dupay',  reports: 12, resolved: 12, kg: 1520 },
    { name: 'Kanlurang',      reports: 10, resolved: 8,  kg: 1240 },
    { name: 'Mayao Crossing', reports: 9,  resolved: 9,  kg: 1920 },
  ],
}
// Reuse for Last/This Week/Month
BRGY_DATA['Last Week']  = BRGY_DATA['This Week'].map(b => ({ ...b, reports: Math.max(1, b.reports - 1), resolved: Math.max(0, b.resolved - 1) }))
BRGY_DATA['Last Month'] = BRGY_DATA['This Month'].map(b => ({ ...b, reports: Math.round(b.reports * 0.9), resolved: Math.round(b.resolved * 0.85) }))

const TREND_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TREND_DATA = {
  'This Week':  [5, 3, 6, 4, 4, 2],
  'Last Week':  [4, 2, 5, 3, 3, 2],
  'This Month': [5, 3, 6, 4, 4, 2],
  'Last Month': [4, 3, 5, 3, 4, 1],
}

// ── Mini Components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 22, opacity: .1 }}>{icon}</div>
      <div className="label">{label}</div>
      <div className="value" style={{ color, fontSize: 28 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Bar({ value, max, color, height = 80 }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1 }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{value}</span>
      <div style={{ width: '100%', height, background: 'var(--surface-2)', borderRadius: '4px 4px 0 0', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: `${pct}%`, background: color, borderRadius: '4px 4px 0 0', transition: 'height .5s' }} />
      </div>
    </div>
  )
}

function HBar({ value, max, color, label }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 96, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 20, height: 10, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 20, transition: 'width .5s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, width: 28, textAlign: 'right', color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function FillBar({ pct }) {
  const color = pct > 80 ? '#e74c3c' : pct > 55 ? '#f39c12' : '#2ecc71'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 20, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 20, transition: 'width .5s' }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 700, width: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

function TrendLine({ values, labels, color = '#2ecc71' }) {
  const max = Math.max(...values, 1)
  const H = 80, W = 260
  const pts = values.map((v, i) => [
    Math.round((i / (values.length - 1)) * W),
    Math.round(H - (v / max) * (H - 10)),
  ])
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L${W},${H} L0,${H} Z`} fill="url(#tg)" />
        <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
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

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PerformanceAnalytics() {
  const [period, setPeriod] = useState('This Week')

  const kpi   = KPI[period]
  const trucks = TRUCK_DATA[period] || TRUCK_DATA['This Week']
  const brgy   = BRGY_DATA[period]  || BRGY_DATA['This Week']
  const trend  = TREND_DATA[period] || TREND_DATA['This Week']

  const completionRate = Math.round((kpi.completed / kpi.routes) * 100)
  const resolutionRate = Math.round((kpi.resolved  / kpi.reports) * 100)
  const maxReports     = Math.max(...brgy.map(b => b.reports))
  const maxKg          = Math.max(...brgy.map(b => b.kg))

  return (
    <DashboardLayout>
      <style>{`
        .pa-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
        .pa-section-title { font-family: var(--font-head); font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing:.07em; margin: 0 0 14px; color: var(--text); }
      `}</style>

      <div className="page">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>Performance Analytics</h2>
              <span style={{ background: 'rgba(155,89,182,0.1)', color: '#9b59b6', border: '1px solid rgba(155,89,182,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>ADMIN</span>
            </div>
            <p className="text-muted text-sm">Track truck efficiency, missed stops, barangay reports, and issue trends.</p>
          </div>

          {/* Period selector */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 10, padding: 4 }}>
            {PERIOD_OPTIONS.map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: '6px 12px', borderRadius: 8, border: 'none',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer', transition: 'all .15s',
                background: period === p ? 'var(--surface)' : 'transparent',
                color: period === p ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: period === p ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
              }}>{p}</button>
            ))}
          </div>
        </div>

        {/* ── KPI Row ── */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <KpiCard label="Waste Collected"    value={`${(kpi.collected/1000).toFixed(1)}t`} sub="kg collected"          color="var(--text)"  icon="⚖️" />
          <KpiCard label="Routes Completed"   value={`${kpi.completed}/${kpi.routes}`}       sub={`${completionRate}% rate`} color="#2ecc71" icon="✅" />
          <KpiCard label="Missed Stops"       value={kpi.missed}                             sub="stops uncollected"    color={kpi.missed > 5 ? '#e74c3c' : '#f39c12'} icon="📭" />
          <KpiCard label="Reports Resolved"   value={`${kpi.resolved}/${kpi.reports}`}       sub={`${resolutionRate}% rate`} color="#5dade2" icon="📋" />
        </div>

        {/* ── Row 1: Truck Efficiency + Issue Trend ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

          {/* Truck Efficiency Table */}
          <div className="pa-card">
            <div className="pa-section-title">🚛 Truck Efficiency</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 1fr', gap: '0 8px', marginBottom: 8, padding: '0 0 6px', borderBottom: '1px solid var(--border)' }}>
              {['Truck / Driver', 'Done', 'Miss', 'Fill Rate'].map(h => (
                <span key={h} style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em' }}>{h}</span>
              ))}
            </div>
            {trucks.map(t => (
              <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 1fr', gap: '0 8px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t.id}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.driver}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#2ecc71' }}>{t.completed}/{t.routes}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.missed > 0 ? '#e74c3c' : 'var(--text-muted)' }}>{t.missed}</span>
                <FillBar pct={t.fill} />
              </div>
            ))}
          </div>

          {/* Issue Trend Line */}
          <div className="pa-card">
            <div className="pa-section-title">📈 Daily Issue Trend</div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              {[
                { label: 'Peak Day',  value: TREND_LABELS[trend.indexOf(Math.max(...trend))], color: '#e74c3c' },
                { label: 'Low Day',   value: TREND_LABELS[trend.indexOf(Math.min(...trend))], color: '#2ecc71' },
                { label: 'Avg/Day',   value: (trend.reduce((a, b) => a + b, 0) / trend.length).toFixed(1), color: '#f39c12' },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
            <TrendLine values={trend} labels={TREND_LABELS} color="#e74c3c" />
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 8 }}>ISSUE TYPE BREAKDOWN</div>
              {[
                { label: 'Overflow',        val: 9,  color: '#e74c3c' },
                { label: 'Illegal Dumping', val: 7,  color: '#f39c12' },
                { label: 'Missed Pickup',   val: 5,  color: '#5dade2' },
                { label: 'Other',           val: 3,  color: '#9b59b6' },
              ].map(r => <HBar key={r.label} label={r.label} value={r.val} max={10} color={r.color} />)}
            </div>
          </div>
        </div>

        {/* ── Row 2: Reports per Barangay + Waste Collection ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

          {/* Reports per Barangay */}
          <div className="pa-card">
            <div className="pa-section-title">📍 Reports per Barangay</div>
            {brgy.map(b => (
              <div key={b.name} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{b.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.resolved}/{b.reports} resolved</span>
                </div>
                <div style={{ display: 'flex', gap: 0, height: 8, borderRadius: 20, overflow: 'hidden', background: 'var(--surface-2)' }}>
                  <div style={{ width: `${Math.round((b.resolved / Math.max(b.reports, 1)) * 100)}%`, background: '#2ecc71', transition: 'width .5s' }} />
                  <div style={{ width: `${Math.round(((b.reports - b.resolved) / Math.max(b.reports, 1)) * 100)}%`, background: '#e74c3c', transition: 'width .5s' }} />
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
              {[{ color: '#2ecc71', label: 'Resolved' }, { color: '#e74c3c', label: 'Pending' }].map(l => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color }} />{l.label}
                </div>
              ))}
            </div>
          </div>

          {/* Waste Collected per Barangay — vertical bars */}
          <div className="pa-card">
            <div className="pa-section-title">⚖️ Waste Collected (kg) per Barangay</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100, marginBottom: 8 }}>
              {brgy.map(b => <Bar key={b.name} value={b.kg} max={maxKg} color="#5dade2" height={100} />)}
            </div>
            <div style={{ display: 'flex', gap: 0, justifyContent: 'space-around' }}>
              {brgy.map(b => (
                <span key={b.name} style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', flex: 1, lineHeight: 1.3 }}>
                  {b.name.split(' ')[0]}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 8 }}>TOP REPORTERS</div>
              {[...brgy].sort((a, b) => b.reports - a.reports).slice(0, 3).map((b, i) => (
                <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: ['#e74c3c','#f39c12','#2ecc71'][i], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{b.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#e74c3c' }}>{b.reports} reports</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Row 3: Missed Stops Detail ── */}
        <div className="pa-card">
          <div className="pa-section-title">📭 Missed Stop Analysis</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
            {trucks.map(t => {
              const rate = Math.round((t.missed / Math.max(t.routes, 1)) * 100)
              const color = rate > 30 ? '#e74c3c' : rate > 10 ? '#f39c12' : '#2ecc71'
              return (
                <div key={t.id} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{t.id}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.driver}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, fontSize: 20, color }}>{t.missed}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>missed</div>
                    </div>
                  </div>
                  <div style={{ background: 'var(--surface)', borderRadius: 20, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${rate}%`, height: '100%', background: color, borderRadius: 20, transition: 'width .5s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{t.completed}/{t.routes} routes done</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color }}>{rate}% miss rate</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </DashboardLayout>
  )
}
