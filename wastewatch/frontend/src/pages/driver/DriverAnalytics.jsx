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

// ─── MOCK DATA REMOVED ────────────────────────────────────────────────────────

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
    const [hoverIndex, setHoverIndex] = useState(null)
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
            {data.map((d, i) => {
                const pct = (d.stops / max) * 100
                return (
                    <div key={i} 
                        onMouseEnter={() => setHoverIndex(i)}
                        onMouseLeave={() => setHoverIndex(null)}
                        style={{
                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, cursor: 'pointer', position: 'relative'
                    }}>
                        {/* CUSTOM HTML TOOLTIP */}
                        {hoverIndex === i && (
                            <div style={{
                                position: 'absolute',
                                left: '50%',
                                top: `calc(${100 - pct}% - 30px)`,
                                transform: 'translate(-50%, -100%)',
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                padding: '8px 12px',
                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                pointerEvents: 'none',
                                textAlign: 'center',
                                minWidth: 90,
                                zIndex: 10,
                                animation: 'fadeUp 0.15s ease-out'
                            }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>
                                    {d.day}
                                    <div style={{ fontSize: 9, fontWeight: 500, opacity: 0.8 }}>{d.date}</div>
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                                    {d.stops} <span style={{ fontSize: 11, fontWeight: 600 }}>stops</span>
                                </div>
                                {/* Tooltip Tail */}
                                <div style={{
                                    position: 'absolute',
                                    bottom: -5,
                                    left: '50%',
                                    transform: 'translateX(-50%) rotate(45deg)',
                                    width: 10,
                                    height: 10,
                                    background: 'var(--surface)',
                                    borderRight: '1px solid var(--border)',
                                    borderBottom: '1px solid var(--border)',
                                }} />
                            </div>
                        )}

                        <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'flex-end', position: 'relative' }}>
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
    const [hoverNode, setHoverNode] = useState(null)
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
        const value = typeof data[0] === 'object' ? data[0].val : data[0]
        const dateStr = typeof data[0] === 'object' ? data[0].date : ''
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
                {dateStr && <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)' }}>{dateStr}</div>}
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800, color }}>
                    {value}{label}
                </div>
            </div>
        )
    }

    const W = 320, H = 100, PAD = 16
    const vals = data.map(d => typeof d === 'object' ? d.val : d)
    const max = Math.max(...vals, 1)
    const min = Math.min(...vals)
    const range = max - min || 1

    const pts = data.map((d, i) => {
        const v = typeof d === 'object' ? d.val : d
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
        <div style={{ position: 'relative', width: '100%' }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible', display: 'block' }}>
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
                <g key={i}
                   onMouseEnter={() => setHoverNode({ 
                       i, x, y, 
                       val: typeof data[i] === 'object' ? data[i].val : data[i],
                       date: typeof data[i] === 'object' ? data[i].date : null
                   })}
                   onMouseLeave={() => setHoverNode(null)}
                   style={{ cursor: 'pointer' }}>
                    <circle cx={x} cy={y} r={hoverNode?.i === i ? "5" : "3.5"} fill={color} stroke="var(--surface)" strokeWidth="2" style={{ transition: 'r .2s ease' }} />
                    <circle cx={x} cy={y} r="16" fill="transparent" />
                </g>
            ))}
        </svg>
    
            {/* CUSTOM HTML TOOLTIP */}
            {hoverNode && (
                <div style={{
                    position: 'absolute',
                    left: `calc(${(hoverNode.x / W) * 100}%)`,
                    top: `calc(${(hoverNode.y / H) * 100}%)`,
                    transform: 'translate(-50%, -100%)',
                    marginTop: -10,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    pointerEvents: 'none',
                    textAlign: 'center',
                    minWidth: 80,
                    zIndex: 10,
                    animation: 'fadeUp 0.15s ease-out'
                }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>
                        Route {hoverNode.i + 1}
                        {hoverNode.date && <div style={{ fontSize: 9, fontWeight: 500, opacity: 0.8 }}>{hoverNode.date}</div>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                        {hoverNode.val} <span style={{ fontSize: 11, fontWeight: 600 }}>{label === 'm' ? 'mins' : label}</span>
                    </div>
                    {/* Tooltip Tail */}
                    <div style={{
                        position: 'absolute',
                        bottom: -5,
                        left: '50%',
                        transform: 'translateX(-50%) rotate(45deg)',
                        width: 10,
                        height: 10,
                        background: 'var(--surface)',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                    }} />
                </div>
            )}
        </div>
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
    const [summary, setSummary] = useState({ routesCompleted: 0, stopsCompleted: 0, totalWorkingHours: 0, avgCompletionMins: 0 })
    const [weekly, setWeekly] = useState([])
    const [trend, setTrend] = useState([])
    const [loading, setLoading] = useState(true)
    const [hoverRow, setHoverRow] = useState(null)
    const [error, setError] = useState(null)

        const fetchAnalytics = () => {
        setLoading(true)
        setError(null)
        api.get(`/api/driver/shift/analytics/?period=${period}`)
            .then(res => {
                if (!res.data) throw new Error('No data returned')
                if (res.data.summary) setSummary(res.data.summary)
                if (res.data.weekly)  setWeekly(res.data.weekly)
                if (res.data.trend)   setTrend(res.data.trend)
            })
            .catch(err => {
                console.error('Failed to load analytics:', err)
                setError('Failed to load performance data. Please check your connection.')
            })
            .finally(() => setLoading(false))
    }

    useEffect(() => {
        fetchAnalytics()
    }, [period])

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

                {/* ── ERROR & LOADING STATES ── */}
                {loading && (
                    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div className="spinner" style={{ margin: '0 auto 12px', width: 24, height: 24, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Loading analytics...</div>
                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    </div>
                )}

                {error && !loading && (
                    <div style={{ padding: '24px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, marginBottom: 24, textAlign: 'center' }}>
                        <span className="material-symbols-rounded" style={{ color: '#ef4444', fontSize: 28, marginBottom: 8 }}>wifi_off</span>
                        <div style={{ color: '#ef4444', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{error}</div>
                        <button onClick={fetchAnalytics} className="btn" style={{ padding: '6px 16px', fontSize: 13 }}>Try Again</button>
                    </div>
                )}

                {/* ── STAT CARDS 2×2 ── */}
                {!loading && !error && (
                    <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}
                    className="da-card">
                    <StatCard label="Routes Done" value={fmt(summary.routesCompleted)} color="#2ecc71" sub={`this ${period}`} />
                    <StatCard label="Stops Done" value={fmt(summary.stopsCompleted)} color="#3b82f6" sub={`this ${period}`} />
                    <StatCard label="Working Time" value={summary.totalWorkingHours} unit="hrs" color="#f59e0b" sub="total hours logged" />
                    <StatCard label="Avg. Completion" value={summary.avgCompletionMins} unit="min" color="#a78bfa" sub="per route" />
                </div>

                {/* ── WEEKLY/MONTHLY BAR CHART ── */}
                <div className="card da-card" style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                        <div>
                            <h2 className="section-title" style={{ margin: 0, fontSize: 15 }}>
                                {period === 'week' ? 'Stops This Week' : 'Stops This Month'}
                            </h2>
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

                {/* ── BREAKDOWN TABLE ── */}
                <div className="card da-card">
                    <h2 className="section-title" style={{ fontSize: 15, marginBottom: 14 }}>
                        {period === 'week' ? 'Weekly Breakdown' : 'Monthly Breakdown'}
                    </h2>
                    <div>
                        {weekly.map((d, i) => {
                            const pct = weekStops > 0 ? (d.stops / weekStops) * 100 : 0
                            return (
                                <div key={i} 
                                    onMouseEnter={() => setHoverRow(i)}
                                    onMouseLeave={() => setHoverRow(null)}
                                    style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                                    borderBottom: i < weekly.length - 1 ? '1px solid var(--border)' : 'none',
                                    position: 'relative', cursor: 'pointer'
                                }}>
                                    {/* CUSTOM HTML TOOLTIP */}
                                    {hoverRow === i && (
                                        <div style={{
                                            position: 'absolute',
                                            left: '50%',
                                            top: -35,
                                            transform: 'translate(-50%, 0)',
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            borderRadius: 8,
                                            padding: '8px 12px',
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                            pointerEvents: 'none',
                                            textAlign: 'center',
                                            minWidth: 90,
                                            zIndex: 10,
                                            animation: 'fadeUp 0.15s ease-out'
                                        }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>
                                                {d.day}
                                                <div style={{ fontSize: 9, fontWeight: 500, opacity: 0.8 }}>{d.date}</div>
                                            </div>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                                                {d.stops} <span style={{ fontSize: 11, fontWeight: 600 }}>stops</span>
                                            </div>
                                            {/* Tooltip Tail */}
                                            <div style={{
                                                position: 'absolute',
                                                bottom: -5,
                                                left: '50%',
                                                transform: 'translateX(-50%) rotate(45deg)',
                                                width: 10,
                                                height: 10,
                                                background: 'var(--surface)',
                                                borderRight: '1px solid var(--border)',
                                                borderBottom: '1px solid var(--border)',
                                            }} />
                                        </div>
                                    )}

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
                </>
                )}

            </div>
        </>
    )
}
