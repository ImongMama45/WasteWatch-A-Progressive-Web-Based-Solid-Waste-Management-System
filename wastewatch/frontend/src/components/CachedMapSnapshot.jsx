/**
 * components/CachedMapSnapshot.jsx
 * Online  → live MiniMap | Offline → static OSM tile snapshot + SVG pins
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnline } from '../hooks/useOnline'
import MiniMap from './MiniMap'

const LUCENA = { lat: 13.9373, lng: 121.617 }
const LS_CENTER_KEY = 'ww_last_location'

const CACHED_TRUCKS = [
  { id: 'T01', color: '#14b8a6', status: 'collecting', x: 32, y: 28 },
  { id: 'T02', color: '#f59e0b', status: 'collecting', x: 62, y: 55 },
  { id: 'T03', color: '#a78bfa', status: 'en_route',   x: 50, y: 72 },
]
const CACHED_REPORTS = [
  { id: 'R1', severity: 'high',   x: 55, y: 40 },
  { id: 'R2', severity: 'medium', x: 38, y: 68 },
  { id: 'R3', severity: 'low',    x: 70, y: 30 },
]
const SEV_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

function latLngToTile(lat, lng, z) {
  const n = Math.pow(2, z)
  const x = Math.floor((lng + 180) / 360 * n)
  const y = Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n
  )
  return { x, y, z }
}

function buildGrid(lat, lng, zoom = 14) {
  const { x, y, z } = latLngToTile(lat, lng, zoom)
  return [-1, 0, 1].flatMap(row =>
    [-1, 0, 1].map(col => {
      const sub = ['a', 'b', 'c'][Math.abs(x + col + y + row) % 3]
      return { key: `${col}-${row}`, url: `https://${sub}.tile.openstreetmap.org/${z}/${x + col}/${y + row}.png`, col, row }
    })
  )
}

function OfflineSnapshot({ center }) {
  const navigate = useNavigate()
  const tiles    = buildGrid(center.lat, center.lng)

  return (
    <div className="cms-snapshot">
      <div className="cms-offline-badge">📡 Offline — Cached Map</div>
      <button className="cms-expand-btn" onClick={() => navigate('/map')}>⛶ Full Map</button>

      <div className="cms-tile-grid">
        {tiles.map(t => (
          <img key={t.key} src={t.url} alt="" width={256} height={256}
            loading="lazy" draggable={false}
            style={{ display: 'block', userSelect: 'none', pointerEvents: 'none' }} />
        ))}
      </div>

      <svg className="cms-pins" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        {CACHED_TRUCKS.map(t => (
          <g key={t.id} transform={`translate(${t.x},${t.y})`}>
            <circle r="4" fill={t.color} stroke="white" strokeWidth="1.2" opacity="0.9" />
            <circle r="4" fill={t.color} opacity="0.25">
              <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.25;0;0.25" dur="2s" repeatCount="indefinite" />
            </circle>
          </g>
        ))}
        {CACHED_REPORTS.map(r => (
          <polygon key={r.id}
            points={`${r.x},${r.y - 5} ${r.x + 3},${r.y + 1} ${r.x - 3},${r.y + 1}`}
            fill={SEV_COLOR[r.severity]} stroke="white" strokeWidth="0.8" opacity="0.9" />
        ))}
      </svg>

      <div className="cms-stats-bar">
        <div className="cms-stat">
          <span className="cms-stat__dot" style={{ background: '#22c55e' }} />
          <span>{CACHED_TRUCKS.filter(t => t.status === 'collecting').length} Active Trucks</span>
        </div>
        <div className="cms-stat">
          <span className="cms-stat__dot" style={{ background: '#f59e0b' }} />
          <span>{CACHED_REPORTS.length} Reports Nearby</span>
        </div>
        <span className="cms-stat cms-stat--stale">📦 Cached snapshot</span>
      </div>
    </div>
  )
}

export default function CachedMapSnapshot() {
  const isOnline = useOnline()
  const [center, setCenter] = useState(LUCENA)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CENTER_KEY)
      if (raw) {
        const loc = JSON.parse(raw)
        if (loc?.lat && loc?.lng) setCenter({ lat: loc.lat, lng: loc.lng })
      }
    } catch {}

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude: lat, longitude: lng } = pos.coords
          setCenter({ lat, lng })
          try {
            const existing = JSON.parse(localStorage.getItem(LS_CENTER_KEY) || '{}')
            localStorage.setItem(LS_CENTER_KEY, JSON.stringify({ ...existing, lat, lng }))
          } catch {}
        },
        () => {},
        { timeout: 5000, maximumAge: 300000 }
      )
    }
  }, [])

  return (
    <div className="cms-wrap">
      <div className="cms-header">
        <span className="cms-header__title">📍 Live Map</span>
        <span className={`cms-header__status${isOnline ? ' cms-header__status--online' : ''}`}>
          <span className="cms-header__dot" />
          {isOnline ? 'Live' : 'Offline Snapshot'}
        </span>
      </div>
      <div className="cms-map-area">
        {isOnline ? <MiniMap /> : <OfflineSnapshot center={center} />}
      </div>
    </div>
  )
}
