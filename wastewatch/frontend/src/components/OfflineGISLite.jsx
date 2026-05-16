/**
 * components/OfflineGISLite.jsx
 * --------------------------------
 * Pure SVG offline map — no Leaflet, no network required.
 * Renders simplified Lucena City barangay boundaries as SVG polygons.
 * Colors polygons by cleanliness score from ww_rankings cache.
 * Shows hotspot markers from ww_offline_reports cache.
 *
 * Coordinates are normalized to a 200×200 SVG viewport
 * based on approximate Lucena City bounding box:
 *   lat: 13.900 → 13.975  (y-axis, inverted)
 *   lng: 121.575 → 121.655 (x-axis)
 */

import { useState, useEffect, useCallback } from 'react'
import { useOnline } from '../hooks/useOnline'

// ─── Coordinate transform ─────────────────────────────────────────────────────

const BOUNDS = { latMin: 13.900, latMax: 13.975, lngMin: 121.575, lngMax: 121.655 }
const W = 200, H = 200

function toXY(lat, lng) {
  const x = ((lng - BOUNDS.lngMin) / (BOUNDS.lngMax - BOUNDS.lngMin)) * W
  const y = ((BOUNDS.latMax - lat) / (BOUNDS.latMax - BOUNDS.latMin)) * H
  return [parseFloat(x.toFixed(2)), parseFloat(y.toFixed(2))]
}

function pts(coords) {
  return coords.map(([lat, lng]) => toXY(lat, lng).join(',')).join(' ')
}

// ─── Simplified barangay polygon data ────────────────────────────────────────
// Approximate outlines for key Lucena City barangays

const BARANGAYS = [
  {
    id: 'ibabang_dupay', name: 'Ibabang Dupay',
    poly: [[13.944,121.604],[13.950,121.606],[13.952,121.618],[13.948,121.624],[13.942,121.621],[13.940,121.610]],
  },
  {
    id: 'gulang_gulang', name: 'Gulang-Gulang',
    poly: [[13.950,121.600],[13.958,121.602],[13.962,121.614],[13.956,121.618],[13.950,121.614],[13.948,121.606]],
  },
  {
    id: 'cotta', name: 'Cotta',
    poly: [[13.930,121.604],[13.938,121.606],[13.940,121.614],[13.935,121.618],[13.928,121.615],[13.926,121.607]],
  },
  {
    id: 'isabang', name: 'Isabang',
    poly: [[13.924,121.596],[13.932,121.598],[13.934,121.608],[13.928,121.612],[13.921,121.608],[13.920,121.600]],
  },
  {
    id: 'dalahican', name: 'Dalahican',
    poly: [[13.912,121.610],[13.920,121.612],[13.922,121.622],[13.916,121.628],[13.908,121.622],[13.907,121.614]],
  },
  {
    id: 'ilayang_dupay', name: 'Ilayang Dupay',
    poly: [[13.935,121.618],[13.942,121.620],[13.945,121.632],[13.938,121.636],[13.932,121.630],[13.930,121.622]],
  },
  {
    id: 'bocohan', name: 'Bocohan',
    poly: [[13.920,121.622],[13.928,121.625],[13.930,121.635],[13.923,121.638],[13.916,121.632],[13.915,121.624]],
  },
  {
    id: 'domoit', name: 'Domoit',
    poly: [[13.926,121.586],[13.934,121.590],[13.935,121.598],[13.928,121.600],[13.922,121.596],[13.921,121.588]],
  },
  {
    id: 'ibabang_iyam', name: 'Ibabang Iyam',
    poly: [[13.938,121.586],[13.946,121.590],[13.948,121.600],[13.942,121.604],[13.934,121.598],[13.932,121.590]],
  },
  {
    id: 'ransohan', name: 'Ransohan',
    poly: [[13.956,121.590],[13.964,121.593],[13.967,121.604],[13.960,121.607],[13.953,121.602],[13.951,121.594]],
  },
  {
    id: 'ilayang_iyam', name: 'Ilayang Iyam',
    poly: [[13.948,121.594],[13.956,121.596],[13.958,121.606],[13.952,121.610],[13.944,121.606],[13.942,121.597]],
  },
]

// ─── Score → fill color ───────────────────────────────────────────────────────

function scoreToFill(score) {
  if (!score) return '#1e2d3d'
  if (score >= 85) return 'rgba(34,197,94,0.35)'
  if (score >= 70) return 'rgba(245,158,11,0.30)'
  return 'rgba(239,68,68,0.28)'
}
function scoreToStroke(score) {
  if (!score) return '#334155'
  if (score >= 85) return '#22c55e'
  if (score >= 70) return '#f59e0b'
  return '#ef4444'
}

// ─── Hotspot circle ───────────────────────────────────────────────────────────

const SEV_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e', critical: '#7c3aed' }

function HotspotPin({ lat, lng, severity, id }) {
  const [x, y] = toXY(lat, lng)
  const c = SEV_COLOR[severity] || '#f59e0b'
  return (
    <g key={id}>
      <circle cx={x} cy={y} r="3" fill={c} stroke="white" strokeWidth="0.8" opacity="0.9" />
      <circle cx={x} cy={y} r="3" fill={c} opacity="0.2">
        <animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.2;0;0.2" dur="2s" repeatCount="indefinite" />
      </circle>
    </g>
  )
}

// ─── Popup ────────────────────────────────────────────────────────────────────

function Popup({ brgy, onClose }) {
  if (!brgy) return null
  return (
    <div className="ogl-popup">
      <div className="ogl-popup__header">
        <span className="ogl-popup__name">{brgy.name}</span>
        <button className="ogl-popup__close" onClick={onClose}>✕</button>
      </div>
      {brgy.score !== undefined && (
        <div className="ogl-popup__score" style={{ color: scoreToStroke(brgy.score) }}>
          Score: {brgy.score} pts
        </div>
      )}
      {brgy.hotspots > 0 && (
        <div className="ogl-popup__hotspot">⚠️ {brgy.hotspots} active report(s)</div>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflineGISLite() {
  const isOnline = useOnline()
  const [rankings,  setRankings]  = useState([])
  const [hotspots,  setHotspots]  = useState([])
  const [selected,  setSelected]  = useState(null)

  useEffect(() => {
    // Read rankings from cache
    try {
      const r = JSON.parse(localStorage.getItem('ww_rankings') || '[]')
      setRankings(r)
    } catch {}
    // Read pending reports as hotspots
    try {
      const rep = JSON.parse(localStorage.getItem('ww_offline_reports') || '[]')
      setHotspots(
        rep.filter(r => r.location?.lat && r.location?.lng)
           .map(r => ({ lat: r.location.lat, lng: r.location.lng, severity: r.severity || 'medium', id: r.id }))
      )
    } catch {}
  }, [])

  // Enrich barangays with score
  const enriched = BARANGAYS.map(b => {
    const rank = rankings.find(r => r.barangay?.toLowerCase().includes(b.name.split(' ')[0].toLowerCase()))
    const hots = hotspots.filter(h => {
      const [x, y] = toXY(h.lat, h.lng)
      // Rough bounding check
      const ptsArr = b.poly.map(([la, lo]) => toXY(la, lo))
      const minX = Math.min(...ptsArr.map(p => p[0])), maxX = Math.max(...ptsArr.map(p => p[0]))
      const minY = Math.min(...ptsArr.map(p => p[1])), maxY = Math.max(...ptsArr.map(p => p[1]))
      return x >= minX && x <= maxX && y >= minY && y <= maxY
    }).length
    return { ...b, score: rank?.score, hotspots: hots }
  })

  const selData = selected ? enriched.find(b => b.id === selected) : null

  return (
    <div className="ogl-wrap">
      {/* Header */}
      <div className="ogl-header">
        <div className="ogl-header__left">
          <span className="ogl-icon">🗺️</span>
          <div>
            <h3 className="ogl-title">GIS Lite — Offline</h3>
            <p className="ogl-sub">Barangay boundaries · Hotspots</p>
          </div>
        </div>
        <div className="ogl-legend">
          <span><span className="ogl-leg-dot" style={{ background: '#22c55e' }} />85+</span>
          <span><span className="ogl-leg-dot" style={{ background: '#f59e0b' }} />70–84</span>
          <span><span className="ogl-leg-dot" style={{ background: '#ef4444' }} />&lt;70</span>
        </div>
      </div>

      {/* SVG Map */}
      <div className="ogl-map-area">
        {!isOnline && (
          <div className="ogl-offline-chip">📡 Offline — Local Data</div>
        )}

        <svg
          viewBox={`-5 -5 ${W + 10} ${H + 10}`}
          className="ogl-svg"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Background */}
          <rect x="-5" y="-5" width={W + 10} height={H + 10} fill="#0a1628" />

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((f, i) => (
            <g key={i}>
              <line x1={W*f} y1={0} x2={W*f} y2={H} stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
              <line x1={0} y1={H*f} x2={W} y2={H*f} stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
            </g>
          ))}

          {/* Barangay polygons */}
          {enriched.map(b => (
            <polygon
              key={b.id}
              points={pts(b.poly)}
              fill={scoreToFill(b.score)}
              stroke={scoreToStroke(b.score)}
              strokeWidth={selected === b.id ? '1.5' : '0.8'}
              strokeOpacity={0.7}
              fillOpacity={selected === b.id ? 0.8 : 0.6}
              style={{ cursor: 'pointer', transition: 'fill-opacity 0.2s' }}
              onClick={() => setSelected(selected === b.id ? null : b.id)}
            />
          ))}

          {/* Barangay labels */}
          {enriched.map(b => {
            const center = b.poly.reduce(([ax, ay], [lat, lng]) => {
              const [x, y] = toXY(lat, lng); return [ax + x / b.poly.length, ay + y / b.poly.length]
            }, [0, 0])
            return (
              <text key={`lbl-${b.id}`} x={center[0]} y={center[1]}
                textAnchor="middle" dominantBaseline="middle"
                fontSize="4.5" fill="rgba(255,255,255,0.7)" fontWeight="600"
                style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {b.name.split(' ')[0]}
              </text>
            )
          })}

          {/* Hotspot pins */}
          {hotspots.map(h => <HotspotPin key={h.id} {...h} />)}
        </svg>

        {/* Popup */}
        {selData && <Popup brgy={selData} onClose={() => setSelected(null)} />}
      </div>

      {/* Stats bar */}
      <div className="ogl-stats-bar">
        <span>🏘️ {BARANGAYS.length} Barangays</span>
        <span>⚠️ {hotspots.length} Hotspots</span>
        <span>📊 {rankings.length > 0 ? 'Scores loaded' : 'No scores cached'}</span>
      </div>
    </div>
  )
}
