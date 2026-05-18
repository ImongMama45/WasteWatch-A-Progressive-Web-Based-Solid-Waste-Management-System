/**
 * HotspotMap.jsx
 * ---------------
 * SVG grid map — offline-safe, no external map library.
 * Uses .msi (Material Symbols) for legend + tooltips.
 * Matches WasteWatch surface / border / accent tokens.
 */

import { useState } from 'react'

// REPLACE WITH: api.get('/api/analytics/barangay-map/')
const CELLS = [
  { id: 'b1',  name: 'Gulang-Gulang',   x: 1, y: 0, score: 98, reports: 2,  hotspots: 0 },
  { id: 'b2',  name: 'Ibabang Dupay',   x: 2, y: 0, score: 95, reports: 3,  hotspots: 0 },
  { id: 'b3',  name: 'Mayao Crossing',  x: 3, y: 0, score: 92, reports: 4,  hotspots: 1 },
  { id: 'b4',  name: 'Barangay 1',      x: 0, y: 1, score: 89, reports: 5,  hotspots: 1 },
  { id: 'b5',  name: 'Isabang',         x: 1, y: 1, score: 87, reports: 7,  hotspots: 2 },
  { id: 'b6',  name: 'Cotta',           x: 2, y: 1, score: 84, reports: 5,  hotspots: 2 },
  { id: 'b7',  name: 'Kanlurang Cotta', x: 3, y: 1, score: 81, reports: 3,  hotspots: 1 },
  { id: 'b8',  name: 'Barangay 2',      x: 0, y: 2, score: 78, reports: 6,  hotspots: 2 },
  { id: 'b9',  name: 'Barangay 3',      x: 1, y: 2, score: 75, reports: 4,  hotspots: 3 },
  { id: 'b10', name: 'Barangay 4',      x: 2, y: 2, score: 72, reports: 8,  hotspots: 3 },
  { id: 'b11', name: 'Barangay 5',      x: 3, y: 2, score: 68, reports: 9,  hotspots: 4 },
  { id: 'b12', name: 'Barangay 6',      x: 0, y: 3, score: 63, reports: 11, hotspots: 5 },
  { id: 'b13', name: 'Barangay 7',      x: 1, y: 3, score: 60, reports: 12, hotspots: 5 },
  { id: 'b14', name: 'Barangay 8',      x: 2, y: 3, score: 55, reports: 14, hotspots: 6 },
  { id: 'b15', name: 'Barangay 9',      x: 3, y: 3, score: 50, reports: 15, hotspots: 7 },
  { id: 'b16', name: 'Barangay 10',     x: 0, y: 0, score: 96, reports: 2,  hotspots: 0 },
]

function scoreColor(s) {
  if (s >= 90) return { fill: '#d1fae5', stroke: '#059669', text: '#065f46' }
  if (s >= 80) return { fill: '#dcfce7', stroke: '#16a34a', text: '#166534' }
  if (s >= 70) return { fill: '#fef9c3', stroke: '#ca8a04', text: '#713f12' }
  if (s >= 60) return { fill: '#ffedd5', stroke: '#ea580c', text: '#7c2d12' }
  return           { fill: '#fee2e2', stroke: '#dc2626', text: '#7f1d1d' }
}

const CELL = 54
const GAP  = 4
const COLS = 4
const ROWS = 4

export default function HotspotMap({ userBarangay }) {
  const [tip, setTip] = useState(null)
  const W = COLS * (CELL + GAP) - GAP + 20
  const H = ROWS * (CELL + GAP) - GAP + 28

  const LEGEND = [
    { color: '#059669', label: '90–100 Excellent' },
    { color: '#16a34a', label: '80–89 Good' },
    { color: '#ca8a04', label: '70–79 Fair' },
    { color: '#ea580c', label: '60–69 Poor' },
    { color: '#dc2626', label: '<60 Critical' },
  ]

  return (
    <div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {LEGEND.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>

      {/* Map */}
      <div style={{
        background: 'var(--bg)',
        borderRadius: 'var(--radius)',
        padding: 10, border: '1px solid var(--border)',
      }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 300, display: 'block', margin: '0 auto' }}>
          <text x="50%" y="13" textAnchor="middle" fontSize="8" fill="#7a8899" fontWeight="700" letterSpacing=".07em">
            LUCENA CITY BARANGAY MAP
          </text>
          {CELLS.map(cell => {
            const cx = 10 + cell.x * (CELL + GAP)
            const cy = 20 + cell.y * (CELL + GAP)
            const c  = scoreColor(cell.score)
            const isUser = userBarangay && cell.name.toLowerCase() === userBarangay.toLowerCase()
            return (
              <g key={cell.id} style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTip(cell)}
                onMouseLeave={() => setTip(null)}
                onClick={() => setTip(t => t?.id === cell.id ? null : cell)}
              >
                <rect x={cx} y={cy} width={CELL} height={CELL} rx="6"
                  fill={c.fill}
                  stroke={isUser ? '#000' : c.stroke}
                  strokeWidth={isUser ? 2.5 : 1.5}
                />
                <text x={cx + CELL / 2} y={cy + CELL / 2 - 4}
                  textAnchor="middle" fontSize="12" fontWeight="700" fill={c.text}
                >{cell.score}%</text>
                <text x={cx + CELL / 2} y={cy + CELL / 2 + 10}
                  textAnchor="middle" fontSize="6" fill={c.text} opacity=".7"
                >{cell.name.split(' ').slice(0, 2).join(' ')}</text>
                {cell.hotspots > 0 && (
                  <>
                    <circle cx={cx + CELL - 6} cy={cy + 6} r="5.5" fill="var(--danger, #e74c3c)" />
                    <text x={cx + CELL - 6} y={cy + 9} textAnchor="middle"
                      fontSize="6" fontWeight="800" fill="#fff"
                    >{cell.hotspots}</text>
                  </>
                )}
                {isUser && (
                  <circle cx={cx + 7} cy={cy + 7} r="4" fill="#1e2633" opacity=".7" />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Tooltip */}
      {tip && (
        <div style={{
          marginTop: 10,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '12px 14px',
        }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="msi" style={{ fontSize: 16, color: 'var(--accent)' }}>location_on</span>
            {tip.name}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {[
              { label: 'Score',    value: `${tip.score}%`, icon: 'analytics' },
              { label: 'Reports',  value: tip.reports,     icon: 'flag' },
              { label: 'Hotspots', value: tip.hotspots,    icon: 'local_fire_department' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--bg)', borderRadius: 8, padding: '8px', textAlign: 'center',
              }}>
                <span className="msi" style={{ fontSize: 16, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{s.icon}</span>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{s.value}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.04em' }}>{s.label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className="msi" style={{ fontSize: 13 }}>info</span>
        Red dot = hotspot count · Dark dot = your barangay · Tap a cell for details
      </div>
    </div>
  )
}
