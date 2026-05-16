/**
 * components/OfflineBarangayProfile.jsx
 * ----------------------------------------
 * Reusable cached barangay profile card.
 * Reads from ww_barangay_profiles localStorage cache.
 * Shows zone type, avg waste generation gauge, collection frequency,
 * and SVG ring chart comparing to city average.
 *
 * Props:
 *   barangayName : string (optional — defaults to first in cache)
 */

import { useState, useEffect } from 'react'
import { useOnline } from '../hooks/useOnline'
import api from '../api/client'

// ─── Cache helpers ────────────────────────────────────────────────────────────

const LS_KEY = 'ww_barangay_profiles'

function readCache() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null } }
function writeCache(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)) } catch {} }

// ─── Fallback data ────────────────────────────────────────────────────────────

const FALLBACK_PROFILES = [
  {
    name              : 'Ibabang Dupay',
    zoneType          : 'urban',
    avgWasteKgPerDay  : 4800,
    collectionPerWeek : 3,
    households        : 2450,
    cleanliness       : 82,
    cityAvgWaste      : 3600,
    cityAvgCleanliness: 74,
    lastUpdated       : '2026-04-28',
  },
  {
    name              : 'Gulang-Gulang',
    zoneType          : 'urban',
    avgWasteKgPerDay  : 4200,
    collectionPerWeek : 3,
    households        : 2100,
    cleanliness       : 76,
    cityAvgWaste      : 3600,
    cityAvgCleanliness: 74,
    lastUpdated       : '2026-04-28',
  },
  {
    name              : 'Dalahican',
    zoneType          : 'coastal',
    avgWasteKgPerDay  : 2900,
    collectionPerWeek : 2,
    households        : 1400,
    cleanliness       : 68,
    cityAvgWaste      : 3600,
    cityAvgCleanliness: 74,
    lastUpdated       : '2026-04-28',
  },
  {
    name              : 'Isabang',
    zoneType          : 'rural',
    avgWasteKgPerDay  : 3400,
    collectionPerWeek : 2,
    households        : 1750,
    cleanliness       : 79,
    cityAvgWaste      : 3600,
    cityAvgCleanliness: 74,
    lastUpdated       : '2026-04-28',
  },
]

const ZONE_META = {
  urban   : { icon: '🏙️', color: '#3b82f6', label: 'Urban'   },
  rural   : { icon: '🌾', color: '#22c55e', label: 'Rural'   },
  coastal : { icon: '🌊', color: '#06b6d4', label: 'Coastal' },
  mixed   : { icon: '🏘️', color: '#a78bfa', label: 'Mixed'   },
}

// ─── SVG ring gauge ───────────────────────────────────────────────────────────

function RingGauge({ value, max = 100, color = '#14b8a6', size = 64, label }) {
  const r   = (size / 2) - 5
  const circ = 2 * Math.PI * r
  const pct  = Math.min(value / max, 1)
  const dash = circ * pct
  return (
    <div className="obp-ring-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
        />
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle"
          fontSize="13" fontWeight="800" fill="white">
          {value}
        </text>
      </svg>
      {label && <span className="obp-ring-label">{label}</span>}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflineBarangayProfile({ barangayName }) {
  const isOnline   = useOnline()
  const [profiles, setProfiles] = useState(readCache() || FALLBACK_PROFILES)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (!isOnline) return
    api.get('/api/public/barangay-profiles/').then(res => {
      if (res?.data?.length) { writeCache(res.data); setProfiles(res.data) }
    }).catch(() => {})
  }, [isOnline])

  // Find by name prop or default to first
  useEffect(() => {
    if (barangayName) {
      const idx = profiles.findIndex(p => p.name === barangayName)
      if (idx >= 0) setSelected(idx)
    }
  }, [barangayName, profiles])

  const p    = profiles[selected] || profiles[0]
  const zm   = ZONE_META[p?.zoneType] || ZONE_META.urban
  const wasteAboveAvg = p.avgWasteKgPerDay > p.cityAvgWaste

  return (
    <div className="obp-wrap">
      {/* Header */}
      <div className="obp-header">
        <span className="obp-header__icon">{zm.icon}</span>
        <div className="obp-header__text">
          <h3 className="obp-header__title">{p.name}</h3>
          <span className="obp-header__zone" style={{ color: zm.color }}>
            {zm.label} Zone
          </span>
        </div>
        {!isOnline && <span className="oas-badge oas-badge--cached">📦 Cached</span>}
      </div>

      {/* Barangay selector */}
      <div className="obp-selector">
        {profiles.map((pr, i) => (
          <button
            key={pr.name}
            className={`obp-sel-btn${selected === i ? ' obp-sel-btn--active' : ''}`}
            onClick={() => setSelected(i)}
          >
            {pr.name.split(' ')[0]}
          </button>
        ))}
      </div>

      {/* Stats grid */}
      <div className="obp-stats">
        {/* Gauges row */}
        <div className="obp-gauges">
          <RingGauge value={p.cleanliness} max={100} color="#14b8a6" size={72} label="Cleanliness" />
          <div className="obp-vs">vs city avg</div>
          <RingGauge value={p.cityAvgCleanliness} max={100} color="#475569" size={64} label="City Avg" />
        </div>

        {/* Info rows */}
        <div className="obp-info-list">
          <div className="obp-info-row">
            <span className="obp-info-row__key">🏠 Households</span>
            <span className="obp-info-row__val">{p.households.toLocaleString()}</span>
          </div>
          <div className="obp-info-row">
            <span className="obp-info-row__key">⚖️ Avg Waste/Day</span>
            <span className="obp-info-row__val" style={{ color: wasteAboveAvg ? '#ef4444' : '#22c55e' }}>
              {(p.avgWasteKgPerDay / 1000).toFixed(1)} t
              {wasteAboveAvg ? ' ▲' : ' ▼'}
            </span>
          </div>
          <div className="obp-info-row">
            <span className="obp-info-row__key">🚛 Collection</span>
            <span className="obp-info-row__val">{p.collectionPerWeek}× / week</span>
          </div>
          <div className="obp-info-row">
            <span className="obp-info-row__key">📅 Last Updated</span>
            <span className="obp-info-row__val">{p.lastUpdated}</span>
          </div>
        </div>
      </div>

      {/* Waste vs city avg bar */}
      <div className="obp-compare">
        <div className="obp-compare__label">
          <span>Waste vs City Average</span>
          <span style={{ color: wasteAboveAvg ? '#ef4444' : '#22c55e' }}>
            {wasteAboveAvg ? '▲' : '▼'} {Math.abs(p.avgWasteKgPerDay - p.cityAvgWaste).toLocaleString()} kg/day
          </span>
        </div>
        <div className="obp-compare__track">
          <div className="obp-compare__fill obp-compare__fill--brgy"
            style={{ width: `${Math.min((p.avgWasteKgPerDay / (p.cityAvgWaste * 2)) * 100, 100)}%`, background: wasteAboveAvg ? '#ef4444' : '#14b8a6' }} />
        </div>
        <div className="obp-compare__track" style={{ marginTop: 4 }}>
          <div className="obp-compare__fill obp-compare__fill--city"
            style={{ width: `${Math.min((p.cityAvgWaste / (p.cityAvgWaste * 2)) * 100, 100)}%` }} />
        </div>
        <div className="obp-compare__labels">
          <span>{p.name}</span>
          <span>City Avg</span>
        </div>
      </div>
    </div>
  )
}
