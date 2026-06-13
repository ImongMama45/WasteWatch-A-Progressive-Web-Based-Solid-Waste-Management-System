/**
 * DriverAnalytics.jsx — Driver Performance Analytics
 * ----------------------------------------------------
 * Displays:
 *  - Summary stat cards: routes, stops, working time, avg completion
 *  - Weekly bar chart   (stops completed per day) — pure CSS
 *  - Completion trend   (avg mins per route over last 8 routes) — SVG line chart
 *  - Weekly breakdown table with proportional progress bars
 *
 * No external chart library — lightweight and mobile-friendly.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const MOCK_SUMMARY = {
    routesCompleted: 24,
    stopsCompleted: 218,
    totalWorkingHours: 96,
    avgCompletionMins: 42,
}

const MOCK_WEEKLY = [
    { day: 'Mon', stops: 12 },
    { day: 'Tue', stops: 9 },
    { day: 'Wed', stops: 0 },
    { day: 'Thu', stops: 14 },
    { day: 'Fri', stops: 11 },
    { day: 'Sat', stops: 7 },
    { day: 'Sun', stops: 0 },
]

const MOCK_TREND = [10, 50, 48, 44, 46, 41, 43, 42]

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(n) { return n.toLocaleString() }

// ─── STAT CARD ────────────────────────────────────────────────────────────────

function StatCard({ label, value, unit, icon, color, sub }) {
    return (
        <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '18px 16px',
            display: 'flex', flexDirection: 'column', gap: 6,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="form-label" style={{ marginBottom: 0 }}>{label}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: 32, fontWeight: 800, color }}>
                    {value}
                </span>
                {unit && <span className="text-muted text-sm">{unit}</span>}
            </div>
            {sub && <div className="text-muted text-xs">{sub}</div>}
        </div>
    )
}

// ─── CSS BAR CHART ────────────────────────────────────────────────────────────

function BarChart({ data, color = '#2ecc71' }) {
    const max = Math.max(...data.map(d => d.stops), 1)
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
            {data.map((d, i) => {
                const pct = (d.stops / max) * 100
                return (
                    <div key={i} style={{
                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    }}>
                        <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'flex-end', position: 'relative' }}>
                            {d.stops > 0 && (
                                <div style={{
                                    position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)',
                                    fontSize: 10, fontWeight: 700, color,
                                }}>{d.stops}</div>
                            )}
                            <div style={{
                                width: '100%', borderRadius: '5px 5px 0 0',
                                background: d.stops === 0
                                    ? 'var(--bg)'
                                    : `linear-gradient(to top, ${color}, ${color}88)`,
                                height: `${pct}%`,
                                minHeight: d.stops === 0 ? 4 : 8,
                                transition: 'height .4s ease',
                                border: d.stops === 0 ? '1px dashed var(--border)' : 'none',
                            }} />
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>{d.day}</div>
                    </div>
                )
            })}
        </div>
    )
}

// ─── SVG LINE CHART ───────────────────────────────────────────────────────────

function LineChart({ data, color = '#3b82f6', label = 'm' }) {
    if (!Array.isArray(data) || data.length === 0) {
        return (
            <div style={{
                height: 120,
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

    if (data.length === 1) {
        const value = data[0]
        return (
            <div style={{
                height: 120,
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'linear-gradient(180deg, var(--surface), var(--bg))',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                color: 'var(--text-muted)',
            }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>Single data point</div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800, color }}>
                    {value}{label}
                </div>
            </div>
        )
    }

    const W = 320, H = 100, PAD = 16
    const max = Math.max(...data, 1)
    const min = Math.min(...data)
    const range = max - min || 1

    const pts = data.map((v, i) => {
        const x = PAD + (i / (data.length - 1)) * (W - PAD * 2)
        const y = PAD + ((max - v) / range) * (H - PAD * 2)
        return [x, y]
    })

    const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ')
    const areaD = [
        `M ${pts[0][0]},${H}`,
        ...pts.map(([x, y]) => `L ${x},${y}`),
        `L ${pts[pts.length - 1][0]},${H}`,
        'Z',
    ].join(' ')

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
            <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                </linearGradient>
            </defs>
            {[0, 0.5, 1].map((t, i) => {
                const y = PAD + t * (H - PAD * 2)
                const v = Math.round(max - t * range)
                return (
                    <g key={i}>
                        <line x1={PAD} y1={y} x2={W - PAD} y2={y}
                            stroke="var(--border)" strokeWidth="1" strokeDasharray="4,4" />
                        <text x={PAD - 3} y={y + 3} fontSize="8" fill="var(--text-muted)" textAnchor="end">
                            {v}{label}
                        </text>
                    </g>
                )
            })}
            <path d={areaD} fill="url(#areaGrad)" />
            <polyline points={polyline} fill="none" stroke={color}
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {pts.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="3.5" fill={color} stroke="var(--surface)" strokeWidth="2" />
            ))}
        </svg>
    )
}

// ─── PERIOD TAB ───────────────────────────────────────────────────────────────

function PeriodTab({ label, active, onClick }) {
    return (
        <button onClick={onClick} style={{
            padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            background: active ? 'var(--accent)' : 'transparent',
            color: active ? '#0d1117' : 'var(--text-muted)',
            transition: 'all .15s',
        }}>{label}</button>
    )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function DriverAnalytics() {
    const { user } = useAuth()
    const navigate = useNavigate()

    const [period, setPeriod] = useState('week')
    const [summary, setSummary] = useState(MOCK_SUMMARY)
    const [weekly, setWeekly] = useState(MOCK_WEEKLY)
    const [trend, setTrend] = useState(MOCK_TREND)

    useEffect(() => {
        api.get('/api/driver/shift/analytics/').catch(() => ({ data: null }))
            .then(res => {
                if (!res.data) return
                if (res.data.summary) setSummary(res.data.summary)
                if (res.data.weekly)  setWeekly(res.data.weekly)
                if (res.data.trend)   setTrend(res.data.trend)
            })
    }, [])

    const weekStops = weekly.reduce((a, d) => a + d.stops, 0)
    const bestDay = [...weekly].sort((a, b) => b.stops - a.stops)[0]

    return (
        <>
            <style>{`
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .da-card { animation: fadeUp .25s ease both; }
      `}</style>

            <div className="page" style={{ paddingBottom: 80 }}>

                {/* ── HEADER ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>

                    <div>
                        <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
                            My Analytics
                        </h1>
                        <p className="text-muted text-xs" style={{ marginTop: 2 }}>
                            {user?.full_name || 'Driver'} · Performance Overview
                        </p>
                    </div>
                </div>

                {/* ── PERIOD TABS ── */}
                <div style={{
                    display: 'inline-flex', background: 'var(--surface)',
                    border: '1px solid var(--border)', borderRadius: 24, padding: 4, marginBottom: 20,
                }}>
                    {['week', 'month'].map(p => (
                        <PeriodTab key={p}
                            label={p === 'week' ? 'This Week' : 'This Month'}
                            active={period === p}
                            onClick={() => setPeriod(p)}
                        />
                    ))}
                </div>

                {/* ── STAT CARDS 2×2 ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}
                    className="da-card">
                    <StatCard label="Routes Done" value={fmt(summary.routesCompleted)} color="#2ecc71" sub="this month" />
                    <StatCard label="Stops Done" value={fmt(summary.stopsCompleted)} color="#3b82f6" sub="this month" />
                    <StatCard label="Working Time" value={summary.totalWorkingHours} unit="hrs" color="#f59e0b" sub="total hours logged" />
                    <StatCard label="Avg. Completion" value={summary.avgCompletionMins} unit="min" color="#a78bfa" sub="per route" />
                </div>

                {/* ── WEEKLY BAR CHART ── */}
                <div className="card da-card" style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                        <div>
                            <h2 className="section-title" style={{ margin: 0, fontSize: 15 }}>Stops This Week</h2>
                            <p className="text-muted text-xs" style={{ marginTop: 3 }}>
                                {weekStops} stops · Best: {bestDay?.day} ({bestDay?.stops})
                            </p>
                        </div>
                        <div style={{
                            background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)',
                            borderRadius: 10, padding: '4px 10px', textAlign: 'center',
                        }}>
                            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 18, color: '#2ecc71' }}>
                                {weekStops}
                            </div>
                            <div className="form-label" style={{ marginBottom: 0 }}>TOTAL</div>
                        </div>
                    </div>
                    <BarChart data={weekly} color="#2ecc71" />
                </div>

                {/* ── LINE CHART: COMPLETION TREND ── */}
                <div className="card da-card" style={{ marginBottom: 20 }}>
                    <div style={{ marginBottom: 14 }}>
                        <h2 className="section-title" style={{ margin: 0, fontSize: 15 }}>Completion Time Trend</h2>
                        <p className="text-muted text-xs" style={{ marginTop: 3 }}>
                            Avg. minutes per route — last {trend.length} routes
                        </p>
                    </div>
                    <LineChart data={trend} color="#3b82f6" label="m" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                        <span className="text-muted text-xs">Route 1</span>
                        <span className="text-muted text-xs">Route {trend.length}</span>
                    </div>

                    {/* Trend badge */}
                    {trend.length >= 2 && (() => {
                        const diff = trend[trend.length - 1] - trend[0]
                        const faster = diff < 0
                        return (
                            <div style={{
                                marginTop: 12, padding: '8px 12px', borderRadius: 10,
                                background: faster ? 'rgba(46,204,113,0.08)' : 'rgba(245,158,11,0.08)',
                                border: `1px solid ${faster ? 'rgba(46,204,113,0.25)' : 'rgba(245,158,11,0.25)'}`,
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: faster ? 'var(--accent)' : 'var(--warning)' }}>
                                    {faster
                                        ? `You're ${Math.abs(diff)} min faster than your first route!`
                                        : `${Math.abs(diff)} min slower than your first route — keep pushing!`}
                                </span>
                            </div>
                        )
                    })()}
                </div>

                {/* ── WEEKLY BREAKDOWN TABLE ── */}
                <div className="card da-card">
                    <h2 className="section-title" style={{ fontSize: 15, marginBottom: 14 }}>Weekly Breakdown</h2>
                    <div>
                        {weekly.map((d, i) => {
                            const pct = weekStops > 0 ? (d.stops / weekStops) * 100 : 0
                            return (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                                    borderBottom: i < weekly.length - 1 ? '1px solid var(--border)' : 'none',
                                }}>
                                    <div style={{ width: 36, fontWeight: 700, fontSize: 13 }}>{d.day}</div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ height: 7, borderRadius: 99, background: 'var(--bg)', overflow: 'hidden' }}>
                                            <div style={{
                                                height: '100%', borderRadius: 99,
                                                background: d.stops === 0
                                                    ? 'var(--border)'
                                                    : 'linear-gradient(90deg,#2ecc71,#27ae60)',
                                                width: `${pct}%`, transition: 'width .4s ease',
                                            }} />
                                        </div>
                                    </div>
                                    <div style={{
                                        width: 28, textAlign: 'right',
                                        fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 14,
                                        color: d.stops === 0 ? 'var(--text-muted)' : 'var(--accent)',
                                    }}>
                                        {d.stops}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

            </div>
        </>
    )
}
