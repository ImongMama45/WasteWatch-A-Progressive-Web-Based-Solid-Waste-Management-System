/**
 * pages/admin/HotspotDetection.jsx
 * ----------------------------------
 * Map-based hotspot detection showing areas with repeated reports.
 * Uses Leaflet CDN (same pattern as MapView) + circle overlays
 * sized/colored by report count to simulate a heatmap.
 */

import { useEffect, useRef, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'

const LUCENA_CENTER = [13.9373, 121.617]

// Hotspot data — each point has a lat/lng and a count of reports
const HOTSPOTS = [
  { id: 'H1',  lat: 13.9415, lng: 121.6175, count: 14, barangay: 'Ibabang Dupay',   type: 'Overflow',        status: 'critical', last: '20m ago' },
  { id: 'H2',  lat: 13.9345, lng: 121.6085, count: 11, barangay: 'Cotta',           type: 'Illegal Dumping', status: 'critical', last: '45m ago' },
  { id: 'H3',  lat: 13.9295, lng: 121.6230, count:  9, barangay: 'Gulang-Gulang',   type: 'Missed Pickup',   status: 'high',     last: '1h ago'  },
  { id: 'H4',  lat: 13.9470, lng: 121.6140, count:  8, barangay: 'Ibabang Dupay',   type: 'Overflow',        status: 'high',     last: '1.5h ago'},
  { id: 'H5',  lat: 13.9500, lng: 121.6280, count:  7, barangay: 'Mayao Crossing',  type: 'Illegal Dumping', status: 'high',     last: '2h ago'  },
  { id: 'H6',  lat: 13.9360, lng: 121.6150, count:  5, barangay: 'Cotta',           type: 'Littering',       status: 'medium',   last: '3h ago'  },
  { id: 'H7',  lat: 13.9430, lng: 121.6210, count:  4, barangay: 'Ibabang Dupay',   type: 'Overflow',        status: 'medium',   last: '4h ago'  },
  { id: 'H8',  lat: 13.9320, lng: 121.6260, count:  3, barangay: 'Gulang-Gulang',   type: 'Road Blockage',   status: 'medium',   last: '5h ago'  },
  { id: 'H9',  lat: 13.9482, lng: 121.6145, count:  2, barangay: 'Ibabang Dupay',   type: 'Missed Pickup',   status: 'low',      last: '6h ago'  },
  { id: 'H10', lat: 13.9380, lng: 121.6110, count:  2, barangay: 'Cotta',           type: 'Littering',       status: 'low',      last: '8h ago'  },
]

const STATUS_META = {
  critical: { label: 'Critical', color: '#e74c3c', bg: 'rgba(231,76,60,0.12)',  border: 'rgba(231,76,60,0.35)'  },
  high:     { label: 'High',     color: '#f39c12', bg: 'rgba(243,156,18,0.12)', border: 'rgba(243,156,18,0.35)' },
  medium:   { label: 'Medium',   color: '#f1c40f', bg: 'rgba(241,196,15,0.12)', border: 'rgba(241,196,15,0.35)' },
  low:      { label: 'Low',      color: '#2ecc71', bg: 'rgba(46,204,113,0.12)', border: 'rgba(46,204,113,0.35)' },
}

const TYPE_ICON = {
  'Overflow':        '🗑️',
  'Illegal Dumping': '🚯',
  'Missed Pickup':   '📭',
  'Road Blockage':   '🚧',
  'Littering':       '🍂',
}

// circle radius and fill color by count
function hotspotStyle(count) {
  if (count >= 12) return { radius: 80, fill: '#e74c3c', opacity: 0.52 }
  if (count >= 8)  return { radius: 60, fill: '#f39c12', opacity: 0.48 }
  if (count >= 5)  return { radius: 44, fill: '#f1c40f', opacity: 0.44 }
  return             { radius: 30, fill: '#2ecc71', opacity: 0.38 }
}

function StatusBadge({ s }) {
  const m = STATUS_META[s] || STATUS_META.low
  return (
    <span style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.color, borderRadius: 20, padding: '2px 10px', fontSize: 9, fontWeight: 800, letterSpacing: '.06em' }}>
      {m.label.toUpperCase()}
    </span>
  )
}

export default function HotspotDetection() {
  const mapRef      = useRef(null)
  const mapInst     = useRef(null)
  const circlesRef  = useRef([])

  const [mapReady,  setMapReady]  = useState(false)
  const [selected,  setSelected]  = useState(null)
  const [filter,    setFilter]    = useState('all')
  const [typeFilter,setTypeFilter]= useState('all')

  // Load Leaflet
  useEffect(() => {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    s.onload = () => setMapReady(true)
    document.head.appendChild(s)
  }, [])

  // Init map
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInst.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    mapInst.current = map
    drawHotspots(map)
  }, [mapReady])

  function drawHotspots(map) {
    const L = window.L
    // clear old
    circlesRef.current.forEach(c => { try { map.removeLayer(c) } catch {} })
    circlesRef.current = []

    HOTSPOTS.forEach(h => {
      const st = hotspotStyle(h.count)

      // Outer glow circle
      const outer = L.circle([h.lat, h.lng], {
        radius: st.radius,
        color: st.fill, weight: 0,
        fillColor: st.fill, fillOpacity: st.opacity * 0.4,
        interactive: false,
      }).addTo(map)

      // Inner circle
      const inner = L.circle([h.lat, h.lng], {
        radius: st.radius * 0.5,
        color: st.fill, weight: 1.5,
        fillColor: st.fill, fillOpacity: st.opacity,
      }).addTo(map)

      // Label marker
      const icon = L.divIcon({
        html: `<div style="
          background:${st.fill};color:#fff;font-size:11px;font-weight:800;
          width:24px;height:24px;border-radius:50%;border:2px solid white;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 8px rgba(0,0,0,.35);">${h.count}</div>`,
        className: '', iconSize: [24, 24], iconAnchor: [12, 12],
      })
      const marker = L.marker([h.lat, h.lng], { icon }).addTo(map)

      marker.on('click', () => setSelected(h))
      inner.on('click',  () => setSelected(h))

      circlesRef.current.push(outer, inner, marker)
    })
  }

  function flyTo(h) {
    if (!mapInst.current) return
    mapInst.current.flyTo([h.lat, h.lng], 16, { duration: 1 })
    setSelected(h)
  }

  const allTypes = [...new Set(HOTSPOTS.map(h => h.type))]

  const filtered = HOTSPOTS.filter(h => {
    const ms = filter === 'all' || h.status === filter
    const mt = typeFilter === 'all' || h.type === typeFilter
    return ms && mt
  }).sort((a, b) => b.count - a.count)

  const counts = {
    critical: HOTSPOTS.filter(h => h.status === 'critical').length,
    high:     HOTSPOTS.filter(h => h.status === 'high').length,
    medium:   HOTSPOTS.filter(h => h.status === 'medium').length,
    low:      HOTSPOTS.filter(h => h.status === 'low').length,
  }

  return (
    <DashboardLayout>
      <style>{`
        .hs-row { transition: background .12s; cursor: pointer; }
        .hs-row:hover { background: var(--surface-2) !important; }
        .hs-filter { transition: all .15s; cursor: pointer; }
        .hs-filter:hover { opacity: .82; }
      `}</style>

      <div className="page">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>Hotspot Detection</h2>
              {counts.critical > 0 && (
                <span style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>
                  {counts.critical} CRITICAL
                </span>
              )}
            </div>
            <p className="text-muted text-sm">Areas with repeated waste reports — sized and colored by frequency.</p>
          </div>
        </div>

        {/* KPI strip */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Total Hotspots', value: HOTSPOTS.length,    color: 'var(--text)' },
            { label: 'Critical',       value: counts.critical,     color: '#e74c3c'     },
            { label: 'High',           value: counts.high,         color: '#f39c12'     },
            { label: 'Medium / Low',   value: counts.medium + counts.low, color: '#f1c40f' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="label">{s.label}</div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Critical banner */}
        {counts.critical > 0 && (
          <div style={{ background: 'rgba(231,76,60,0.05)', border: '1.5px solid rgba(231,76,60,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(231,76,60,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>🔥</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e74c3c', marginBottom: 1 }}>
                {counts.critical} critical hotspot(s) with high report density — dispatch recommended.
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {HOTSPOTS.filter(h => h.status === 'critical').map(h => h.barangay).join(', ')}
              </div>
            </div>
          </div>
        )}

        {/* Main layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>

          {/* MAP */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 14, height: 560, position: 'relative' }}>
            <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
            {!mapReady && (
              <div style={{ position: 'absolute', inset: 0, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
                <span style={{ color: '#5dade2', fontWeight: 600 }}>Loading Map…</span>
              </div>
            )}

            {/* Legend */}
            <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 400, background: 'rgba(15,23,42,0.92)', borderRadius: 10, padding: '10px 14px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.5)', letterSpacing: '.07em', marginBottom: 8 }}>HOTSPOT INTENSITY</div>
              {[
                { color: '#e74c3c', label: 'Critical  (12+ reports)' },
                { color: '#f39c12', label: 'High       (8–11 reports)' },
                { color: '#f1c40f', label: 'Medium  (5–7 reports)'   },
                { color: '#2ecc71', label: 'Low        (2–4 reports)' },
              ].map(l => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: l.color, opacity: 0.85 }} />
                  <span style={{ color: '#cbd5e1', fontSize: 10 }}>{l.label}</span>
                </div>
              ))}
            </div>

            {/* Selected popup overlay */}
            {selected && (
              <div style={{
                position: 'absolute', top: 12, left: 12, zIndex: 400,
                background: 'rgba(15,23,42,0.96)', borderRadius: 12, padding: '14px 16px',
                border: `1px solid ${STATUS_META[selected.status].border}`,
                minWidth: 220, maxWidth: 280,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{TYPE_ICON[selected.type] || '⚠️'}</span>
                    <div>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{selected.type}</div>
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>Brgy. {selected.barangay}</div>
                    </div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 16, cursor: 'pointer' }}>×</button>
                </div>
                {[
                  { label: 'REPORTS',  value: selected.count, accent: true },
                  { label: 'STATUS',   value: selected.status.charAt(0).toUpperCase() + selected.status.slice(1) },
                  { label: 'LAST REPORT', value: selected.last },
                  { label: 'LOCATION', value: `${selected.lat.toFixed(4)}, ${selected.lng.toFixed(4)}` },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>{r.label}</span>
                    <span style={{ color: r.accent ? STATUS_META[selected.status].color : '#e2e8f0', fontSize: 12, fontWeight: r.accent ? 800 : 400 }}>{r.value}</span>
                  </div>
                ))}
                <button style={{
                  width: '100%', marginTop: 12, background: 'rgba(46,204,113,0.1)',
                  border: '1px solid rgba(46,204,113,0.35)', color: '#2ecc71',
                  borderRadius: 8, padding: '8px', fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'var(--font-body)',
                }} onClick={() => window.location.href = '/admin/escalations'}>
                  Create Escalation →
                </button>
              </div>
            )}
          </div>

          {/* SIDE LIST */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 560 }}>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {['all', 'critical', 'high', 'medium', 'low'].map(f => {
                const m = STATUS_META[f] || { color: 'var(--text-muted)', bg: 'transparent', border: 'var(--border)' }
                const active = filter === f
                return (
                  <button key={f} className="hs-filter" onClick={() => setFilter(f)} style={{
                    padding: '4px 11px', borderRadius: 20, border: '1px solid',
                    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-body)',
                    borderColor: active ? (m.color || 'var(--accent)') : 'var(--border)',
                    color: active ? (m.color || 'var(--accent)') : 'var(--text-muted)',
                    background: active ? (m.bg || 'rgba(46,204,113,0.08)') : 'transparent',
                  }}>
                    {f === 'all' ? `All (${HOTSPOTS.length})` : m.label}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {['all', ...allTypes].map(t => (
                <button key={t} className="hs-filter" onClick={() => setTypeFilter(t)} style={{
                  padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)',
                  fontSize: 9, fontWeight: 600, fontFamily: 'var(--font-body)',
                  color: typeFilter === t ? 'var(--accent)' : 'var(--text-muted)',
                  background: typeFilter === t ? 'rgba(46,204,113,0.08)' : 'transparent',
                  borderColor: typeFilter === t ? 'var(--accent)' : 'var(--border)',
                }}>
                  {TYPE_ICON[t] || ''} {t === 'all' ? 'All Types' : t}
                </button>
              ))}
            </div>

            {/* Hotspot cards */}
            {filtered.map((h, i) => {
              const m  = STATUS_META[h.status]
              const st = hotspotStyle(h.count)
              const isSelected = selected?.id === h.id
              return (
                <div key={h.id} className="hs-row" onClick={() => flyTo(h)} style={{
                  background: isSelected ? m.bg : 'var(--surface)',
                  border: `1px solid ${isSelected ? m.border : 'var(--border)'}`,
                  borderRadius: 12, padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    {/* Rank */}
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: st.fill, color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {i + 1}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{TYPE_ICON[h.type]} {h.type}</span>
                        <StatusBadge s={h.status} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Brgy. {h.barangay} · {h.last}
                      </div>
                    </div>

                    {/* Report count bubble */}
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 22, color: st.fill, lineHeight: 1 }}>{h.count}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>reports</div>
                    </div>
                  </div>

                  {/* Mini bar */}
                  <div style={{ background: 'var(--surface-2)', borderRadius: 20, height: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round((h.count / 14) * 100)}%`, height: '100%', background: st.fill, borderRadius: 20, transition: 'width .5s' }} />
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
