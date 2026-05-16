/**
 * components/OfflineAnalyticsSnapshot.jsx
 * -----------------------------------------
 * Displays cached waste analytics.
 * Reads from ww_analytics localStorage cache.
 * SVG-only charts — no chart library dependency.
 *
 * Shows:
 *   • Horizontal bar chart: last known waste volume per barangay
 *   • 7-day sparkline trend
 *   • Barangay comparison mini-table
 */

import { useState, useEffect } from 'react'
import { useOnline } from '../hooks/useOnline'
import api from '../api/client'

// ─── Cache helpers ────────────────────────────────────────────────────────────

const LS_KEY      = 'ww_analytics'
const LS_META_KEY = 'ww_analytics_meta'

function readCache() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null }
}
function writeCache(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
    localStorage.setItem(LS_META_KEY, JSON.stringify({ ts: Date.now() }))
  } catch {}
}
function readMeta() {
  try { return JSON.parse(localStorage.getItem(LS_META_KEY) || 'null') } catch { return null }
}

// ─── Fallback data ────────────────────────────────────────────────────────────

const FALLBACK = {
  barangays: [
    { name: 'Ibabang Dupay',    volume: 4.8, trend: [3.2,3.5,3.8,4.1,4.4,4.6,4.8], rank: 1 },
    { name: 'Gulang-Gulang',    volume: 4.2, trend: [3.8,3.9,4.0,4.1,4.0,4.1,4.2], rank: 2 },
    { name: 'Cotta',            volume: 3.9, trend: [4.2,4.1,4.0,3.9,3.8,3.9,3.9], rank: 3 },
    { name: 'Isabang',          volume: 3.4, trend: [3.0,3.1,3.2,3.3,3.2,3.4,3.4], rank: 4 },
    { name: 'Dalahican',        volume: 2.9, trend: [3.1,3.0,2.9,2.8,2.9,2.9,2.9], rank: 5 },
    { name: 'Ilayang Dupay',    volume: 2.5, trend: [2.2,2.3,2.4,2.5,2.4,2.5,2.5], rank: 6 },
  ],
  cityAvg  : 3.6,
  unit     : 'tons/day',
  lastSync : null,
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function Sparkline({ data, color = '#14b8a6', width = 60, height = 20 }) {
  if (!data?.length) return null
  const min  = Math.min(...data)
  const max  = Math.max(...data)
  const span = max - min || 1
  const pts  = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / span) * (height - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts.split(' ').pop().split(',')[0]} cy={pts.split(' ').pop().split(',')[1]}
        r="2.5" fill={color} />
    </svg>
  )
}

// ─── Horizontal bar ───────────────────────────────────────────────────────────

function BarRow({ name, volume, max, cityAvg, rank }) {
  const pct     = Math.round((volume / max) * 100)
  const avgPct  = Math.round((cityAvg / max) * 100)
  const color   = volume > cityAvg ? '#ef4444' : '#22c55e'
  return (
    <div className="oas-bar-row">
      <div className="oas-bar-row__label">
        <span className="oas-bar-row__rank">#{rank}</span>
        <span className="oas-bar-row__name">{name}</span>
      </div>
      <div className="oas-bar-track">
        <div className="oas-bar-fill" style={{ width: `${pct}%`, background: color }} />
        <div className="oas-bar-avg" style={{ left: `${avgPct}%` }} title={`City avg: ${cityAvg}`} />
      </div>
      <span className="oas-bar-val" style={{ color }}>{volume}t</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflineAnalyticsSnapshot() {
  const isOnline = useOnline()
  const [data,    setData]    = useState(readCache() || FALLBACK)
  const [loading, setLoading] = useState(false)
  const [isStale, setIsStale] = useState(true)

  useEffect(() => {
    const meta = readMeta()
    if (meta?.ts) setIsStale(Date.now() - meta.ts > 30 * 60 * 1000)
  }, [])

  useEffect(() => {
    if (!isOnline) return
    setLoading(true)
    api.get('/api/public/analytics/').then(res => {
      if (res?.data) { writeCache(res.data); setData(res.data); setIsStale(false) }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [isOnline])

  const d    = data || FALLBACK
  const max  = Math.max(...d.barangays.map(b => b.volume), 1)
  const meta = readMeta()

  return (
    <div className="oas-wrap">
      {/* Header */}
      <div className="oas-header">
        <div className="oas-header__left">
          <span className="oas-header__icon">📊</span>
          <div>
            <h3 className="oas-header__title">Waste Analytics</h3>
            <p className="oas-header__sub">
              {meta?.ts
                ? `Last sync: ${new Date(meta.ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : 'Using fallback data'}
            </p>
          </div>
        </div>
        <div className="oas-badge-group">
          {loading && <span className="oas-badge oas-badge--syncing">Updating…</span>}
          {!isOnline && <span className="oas-badge oas-badge--cached">📦 Cached</span>}
          {isOnline && !isStale && <span className="oas-badge oas-badge--live">● Live</span>}
        </div>
      </div>

      {/* Bar chart */}
      <div className="oas-chart">
        <div className="oas-chart__title">
          Waste Volume by Barangay <span className="oas-unit">({d.unit})</span>
        </div>
        <div className="oas-legend">
          <span><span className="oas-legend__dot" style={{ background: '#22c55e' }} />Below avg</span>
          <span><span className="oas-legend__dot" style={{ background: '#ef4444' }} />Above avg</span>
          <span><span className="oas-legend__line" />City avg ({d.cityAvg}t)</span>
        </div>
        <div className="oas-bars">
          {d.barangays.map((b, i) => (
            <BarRow key={b.name} {...b} max={max} cityAvg={d.cityAvg} rank={i + 1} />
          ))}
        </div>
      </div>

      {/* 7-day trend table */}
      <div className="oas-trend">
        <div className="oas-trend__title">7-Day Trend</div>
        <div className="oas-trend-list">
          {d.barangays.slice(0, 4).map(b => {
            const first = b.trend?.[0] || 0
            const last  = b.trend?.[b.trend.length - 1] || 0
            const delta = last - first
            return (
              <div key={b.name} className="oas-trend-row">
                <span className="oas-trend-row__name">{b.name}</span>
                <Sparkline data={b.trend} color={delta >= 0 ? '#ef4444' : '#22c55e'} />
                <span className="oas-trend-row__delta" style={{ color: delta >= 0 ? '#ef4444' : '#22c55e' }}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}t
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* City avg chip */}
      <div className="oas-footer-chip">
        City Average: <strong>{d.cityAvg} {d.unit}</strong>
      </div>
    </div>
  )
}
