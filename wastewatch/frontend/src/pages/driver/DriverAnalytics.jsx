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
import {
    Award,
    TrendingUp,
    Clock,
    MapPin,
    WifiOff,
    CheckCircle2,
    BarChart3,
    Calendar,
    ChevronRight,
    Flame
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'
import {
    FeedCardSkeleton,
    StatCardSkeleton,
    ChartSkeleton,
    TableSkeleton,
} from '../../components/ui/Skeleton'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(n) { return n.toLocaleString() }

// ─── STAT CARD ────────────────────────────────────────────────────────────────

function StatCard({ label, value, unit, icon: Icon, color = '#15803d', sub }) {
    return (
        <div style={{
            background: '#ffffff',
            border: '1px solid #e4e6eb',
            borderRadius: 8,
            padding: '16px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>
                    {label}
                </span>
                {Icon && (
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: '#f0f2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#65676b' }}>
                        <Icon size={14} />
                    </div>
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#1c1e21' }}>
                    {value}
                </span>
                {unit && <span style={{ fontSize: 12, fontWeight: 500, color: '#65676b' }}>{unit}</span>}
            </div>
            {sub && <div style={{ fontSize: 11, color: '#65676b' }}>{sub}</div>}
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
            padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            background: active ? '#ffffff' : 'transparent',
            color: active ? '#1c1e21' : '#65676b',
            boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            transition: 'all .15s',
        }}>{label}</button>
    )
}

const BADGE_META = {
    gold:   { label: 'Gold',   bg: '#fef3c7', fg: '#b45309', border: '#fde68a' },
    silver: { label: 'Silver', bg: '#f1f5f9', fg: '#475569', border: '#e2e8f0' },
    bronze: { label: 'Bronze', bg: '#ffedd5', fg: '#c2410c', border: '#fed7aa' },
}

function DriverScoreCard({ score, period }) {
    if (!score?.me) {
        return (
            <div style={{
                background: '#ffffff',
                border: '1px solid #e4e6eb',
                borderRadius: 8,
                padding: '16px',
                marginBottom: 16,
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                textAlign: 'center',
            }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Driver Score</div>
                <p style={{ fontSize: 12, color: '#65676b', margin: '4px 0 0' }}>Complete a stop this {period} to appear on the board.</p>
            </div>
        )
    }
    const { me, leaders, fleet_size } = score
    const badge = me.badge ? BADGE_META[me.badge] : null
    return (
        <div style={{
            background: '#ffffff',
            border: '1px solid #e4e6eb',
            borderRadius: 8,
            padding: '16px 18px',
            marginBottom: 16,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                    width: 48, height: 48, borderRadius: 6, flexShrink: 0,
                    background: badge ? badge.bg : '#f0f2f5',
                    border: `1px solid ${badge ? badge.border : '#e4e6eb'}`,
                    color: badge ? badge.fg : '#65676b',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                    <span style={{ fontWeight: 700, fontSize: 16, lineHeight: 1 }}>#{me.rank}</span>
                    {badge && <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', marginTop: 2 }}>{badge.label}</span>}
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>Driver Score</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span style={{ fontSize: 24, fontWeight: 700, color: '#15803d' }}>
                            {me.points.toLocaleString()}
                        </span>
                        <span style={{ fontSize: 12, color: '#65676b', fontWeight: 500 }}>pts</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#65676b', marginTop: 2 }}>
                        Top {me.rank} of {me.of || fleet_size} · this {period}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                {[
                    { l: 'stops', v: `+${me.stops_completed * 50}`, c: '#15803d' },
                    { l: 'missed', v: me.stops_missed ? `-${me.stops_missed * 20}` : '0', c: me.stops_missed ? '#b91c1c' : '#65676b' },
                    { l: 'fill bonus', v: me.fill_bonus > 0 ? `+${me.fill_bonus}` : me.fill_bonus, c: me.fill_bonus < 0 ? '#b91c1c' : me.fill_bonus > 0 ? '#15803d' : '#65676b' },
                ].map(p => (
                    <span key={p.l} style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: '#f8fafc', border: '1px solid #e4e6eb',
                    }}>
                        <b style={{ color: p.c }}>{p.v}</b> <span style={{ color: '#65676b' }}>{p.l}</span>
                    </span>
                ))}
            </div>

            {leaders?.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid #f0f2f5', paddingTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', marginBottom: 6 }}>Fleet leaders</div>
                    {leaders.map(l => (
                        <div key={l.rank} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                            <span style={{ color: '#1c1e21' }}>#{l.rank} {l.name}</span>
                            <b style={{ color: '#1c1e21' }}>{l.points.toLocaleString()}</b>
                        </div>
                    ))}
                </div>
            )}
        </div>
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
    const [score, setScore] = useState(null)

    const fetchAnalytics = () => {
        setLoading(true)
        setError(null)
        Promise.allSettled([
            api.get(`/api/driver/shift/analytics/?period=${period}`),
            api.get(`/api/analytics/driver-summary/?period=${period}`),
        ]).then(([a, s]) => {
            if (a.status === 'rejected' || !a.value.data) {
                console.error('Failed to load analytics:', a.reason)
                setError('Failed to load performance data. Please check your connection.')
                return
            }
            const d = a.value.data
            if (d.summary) setSummary(d.summary)
            if (d.weekly)  setWeekly(d.weekly)
            if (d.trend)   setTrend(d.trend)
            setScore(s.status === 'fulfilled' ? s.value.data : null)
        }).finally(() => setLoading(false))
    }

    useEffect(() => {
        fetchAnalytics()
    }, [period])

    const weekStops = weekly.reduce((a, d) => a + d.stops, 0)
    const bestDay = [...weekly].sort((a, b) => b.stops - a.stops)[0]

    return (
        <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 80px' }}>
            <div style={{ maxWidth: 1240, margin: '0 auto' }}>

                {/* ── HEADER ── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div>
                        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#1c1e21' }}>
                            My Analytics
                        </h1>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#65676b' }}>
                            {user?.full_name || 'Driver'} · Performance Overview
                        </p>
                    </div>

                    {/* ── PERIOD TABS (Meta Segmented Control) ── */}
                    <div style={{
                        display: 'inline-flex', background: '#e4e6eb',
                        borderRadius: 6, padding: 2,
                    }}>
                        {['week', 'month'].map(p => (
                            <PeriodTab key={p}
                                label={p === 'week' ? 'This Week' : 'This Month'}
                                active={period === p}
                                onClick={() => setPeriod(p)}
                            />
                        ))}
                    </div>
                </div>

                {/* ── ERROR & LOADING STATES ── */}
                {loading && (
                    <div>
                        <FeedCardSkeleton count={1} compact style={{ marginBottom: 16 }} />
                        <StatCardSkeleton count={4} style={{ marginBottom: 18 }} />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                            <ChartSkeleton height={180} variant="bar" />
                            <ChartSkeleton height={180} variant="line" />
                        </div>
                        <TableSkeleton rows={4} cols={4} style={{ marginTop: 18 }} />
                    </div>
                )}

                {error && !loading && (
                    <div style={{ padding: '20px 16px', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>
                        <WifiOff size={24} style={{ color: '#b91c1c', margin: '0 auto 8px', display: 'block' }} />
                        <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{error}</div>
                        <button
                            onClick={fetchAnalytics}
                            style={{
                                padding: '6px 14px',
                                fontSize: 12,
                                fontWeight: 600,
                                background: '#16a34a',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: 6,
                                cursor: 'pointer',
                            }}
                        >
                            Try Again
                        </button>
                    </div>
                )}

                {/* ── STAT CARDS 2×2 ── */}
                {!loading && !error && (
                    <div className="ww-fade-in">
                    <DriverScoreCard score={score} period={period} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
                        <StatCard label="Routes Done" value={fmt(summary.routesCompleted)} icon={CheckCircle2} color="#15803d" sub={`this ${period}`} />
                        <StatCard label="Stops Done" value={fmt(summary.stopsCompleted)} icon={MapPin} color="#1d4ed8" sub={`this ${period}`} />
                        <StatCard label="Working Time" value={summary.totalWorkingHours} unit="hrs" icon={Clock} color="#b45309" sub="total hours logged" />
                        <StatCard label="Avg. Completion" value={summary.avgCompletionMins} unit="min" icon={TrendingUp} color="#7c3aed" sub="per route" />
                    </div>

                    {/* ── WEEKLY/MONTHLY BAR CHART ── */}
                    <div style={{
                        background: '#ffffff',
                        border: '1px solid #e4e6eb',
                        borderRadius: 8,
                        padding: '18px 20px',
                        marginBottom: 16,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1c1e21' }}>
                                    {period === 'week' ? 'Stops This Week' : 'Stops This Month'}
                                </h2>
                                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#65676b' }}>
                                    {weekStops} stops · Best: {bestDay?.day} ({bestDay?.stops})
                                </p>
                            </div>
                            <div style={{
                                background: '#e7f5eb', border: '1px solid #bbf7d0',
                                borderRadius: 6, padding: '4px 10px', textAlign: 'center',
                            }}>
                                <div style={{ fontWeight: 700, fontSize: 16, color: '#15803d' }}>
                                    {weekStops}
                                </div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', textTransform: 'uppercase' }}>TOTAL</div>
                            </div>
                        </div>
                        <BarChart data={weekly} color="#16a34a" />
                    </div>

                    {/* ── LINE CHART: COMPLETION TREND ── */}
                    <div style={{
                        background: '#ffffff',
                        border: '1px solid #e4e6eb',
                        borderRadius: 8,
                        padding: '18px 20px',
                        marginBottom: 16,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}>
                        <div style={{ marginBottom: 14 }}>
                            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1c1e21' }}>Completion Time Trend</h2>
                            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#65676b' }}>
                                Avg. minutes per route — last {trend.length} routes
                            </p>
                        </div>
                        <LineChart data={trend} color="#16a34a" label="m" />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                            <span style={{ fontSize: 11, color: '#65676b' }}>Route 1</span>
                            <span style={{ fontSize: 11, color: '#65676b' }}>Route {trend.length}</span>
                        </div>

                        {/* Trend badge */}
                        {trend.length >= 2 && (() => {
                            const vals = trend.map(t => typeof t === 'object' ? t.val : t)
                            const diff = vals[vals.length - 1] - vals[0]
                            const faster = diff < 0
                            return (
                                <div style={{
                                    marginTop: 12, padding: '8px 12px', borderRadius: 6,
                                    background: faster ? '#e7f5eb' : '#fef3c7',
                                    border: `1px solid ${faster ? '#bbf7d0' : '#fde68a'}`,
                                    display: 'flex', alignItems: 'center', gap: 8,
                                }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: faster ? '#15803d' : '#b45309' }}>
                                        {faster
                                            ? `You're ${Math.abs(diff)} min faster than your first route!`
                                            : `${Math.abs(diff)} min slower than your first route — keep pushing!`}
                                    </span>
                                </div>
                            )
                        })()}
                    </div>

                    {/* ── BREAKDOWN TABLE ── */}
                    <div style={{
                        background: '#ffffff',
                        border: '1px solid #e4e6eb',
                        borderRadius: 8,
                        padding: '18px 20px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}>
                        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', color: '#1c1e21' }}>
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
                                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px',
                                        borderBottom: i < weekly.length - 1 ? '1px solid #f0f2f5' : 'none',
                                        position: 'relative', cursor: 'pointer',
                                        background: hoverRow === i ? '#f8fafc' : 'transparent',
                                        borderRadius: 4,
                                        transition: 'background 0.15s ease',
                                    }}>
                                        <div style={{ width: 36, fontWeight: 600, fontSize: 13, color: '#1c1e21' }}>{d.day}</div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ height: 6, borderRadius: 3, background: '#f0f2f5', overflow: 'hidden' }}>
                                                <div style={{
                                                    height: '100%', borderRadius: 3,
                                                    background: d.stops === 0
                                                        ? '#ced0d4'
                                                        : '#16a34a',
                                                    width: `${pct}%`, transition: 'width .3s ease',
                                                }} />
                                            </div>
                                        </div>
                                        <div style={{
                                            width: 32, textAlign: 'right',
                                            fontWeight: 700, fontSize: 13,
                                            color: d.stops === 0 ? '#65676b' : '#15803d',
                                        }}>
                                            {d.stops}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                    </div>
                )}

            </div>
        </div>
    )
}
