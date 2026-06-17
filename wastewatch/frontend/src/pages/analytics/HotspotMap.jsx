/**
 * HotspotMap.jsx
 * ---------------
 * Real Leaflet mini-map of Lucena City barangays.
 * Reuses the same GeoJSON (/data/lucena_barangays.geojson) and
 * score-to-color logic as the analytics data.
 * No external deps beyond Leaflet (already loaded by MapView).
 */

import { useState, useEffect, useRef } from 'react'

// ─── Score → color (matches existing analytics palette) ──────────────────────
function scoreColor(s) {
  if (s >= 90) return { fill: '#16a34a', stroke: '#14532d', opacity: 0.55 }
  if (s >= 80) return { fill: '#22c55e', stroke: '#166534', opacity: 0.50 }
  if (s >= 70) return { fill: '#eab308', stroke: '#713f12', opacity: 0.50 }
  if (s >= 60) return { fill: '#f97316', stroke: '#7c2d12', opacity: 0.50 }
  return              { fill: '#ef4444', stroke: '#7f1d1d', opacity: 0.55 }
}

// ─── Placeholder scores — replace with real API data ─────────────────────────
const BRGY_SCORES = {
  'Gulang-Gulang':    98, 'Ibabang Dupay':    95, 'Mayao Crossing':   92,
  'Barangay 1 (Pob.)': 89, 'Isabang':          87, 'Cotta':            84,
  'Kanlurang Cotta':  81, 'Barangay 2 (Pob.)': 78, 'Barangay 3 (Pob.)': 75,
  'Barangay 4 (Pob.)': 72, 'Barangay 5 (Pob.)': 68, 'Barangay 6 (Pob.)': 63,
  'Barangay 7 (Pob.)': 60, 'Barangay 8 (Pob.)': 55, 'Barangay 9 (Pob.)': 50,
  'Barangay 10 (Pob.)': 52, 'Barangay 11 (Pob.)': 58,
  'Mayao Kanluran':   76, 'Mayao Parada':     79, 'Mayao Silangan':   82,
  'Ilayang Dupay':    85,
}

const HOTSPOT_COUNTS = {
  'Barangay 9 (Pob.)': 8, 'Barangay 10 (Pob.)': 6, 'Barangay 6 (Pob.)': 5,
  'Barangay 7 (Pob.)': 5, 'Cotta': 2, 'Isabang': 2,
}

const LEGEND = [
  { color: '#16a34a', label: '90–100 Excellent' },
  { color: '#22c55e', label: '80–89 Good'       },
  { color: '#eab308', label: '70–79 Fair'        },
  { color: '#f97316', label: '60–69 Poor'        },
  { color: '#ef4444', label: '<60 Critical'      },
]

// ─── Inject Leaflet once ──────────────────────────────────────────────────────
let _leafletReady = false
function loadLeaflet(cb) {
  if (window.L) { cb(); return }
  if (_leafletReady) { const t = setInterval(() => { if (window.L) { clearInterval(t); cb() } }, 50); return }
  _leafletReady = true
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
  document.head.appendChild(link)
  const script = document.createElement('script')
  script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  script.onload = cb
  document.head.appendChild(script)
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function HotspotMap({ userBarangay, mapData }) {
  const containerRef   = useRef(null)
  const mapRef         = useRef(null)
  const geoLayerRef    = useRef(null)
  const [tip, setTip]  = useState(null)   // { name, score, hotspots }
  const [ready, setReady] = useState(false)

  // Extract from prop or use defaults
  const getBrgyScore = (name) => mapData?.[name]?.score ?? 75
  const getBrgyHotspots = (name) => mapData?.[name]?.hotspots ?? 0

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadLeaflet(() => {
      setReady(true)
    })
  }, [])

  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return

    const L   = window.L
    const map = L.map(containerRef.current, {
      center:         [13.9373, 121.6170],
      zoom:           13,
      zoomControl:    false,
      scrollWheelZoom: false,    // don't hijack page scroll
      dragging:       true,
      attributionControl: false,
    })

    // Subtle dark-ish tile for contrast
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map

    // Load GeoJSON
    fetch('/data/lucena_barangays.geojson')
      .then(r => r.json())
      .then(geo => {
        if (geoLayerRef.current) {
          map.removeLayer(geoLayerRef.current)
        }

        const layer = L.geoJSON(geo, {
          style: feature => {
            const name  = feature.properties.brgy_name
            const score = getBrgyScore(name)
            const c     = scoreColor(score)
            const isUser = userBarangay && name.toLowerCase() === userBarangay.toLowerCase()
            return {
              color:       isUser ? '#fff' : c.stroke,
              weight:      isUser ? 2.5    : 1.2,
              fillColor:   c.fill,
              fillOpacity: c.opacity,
              opacity:     0.9,
            }
          },

          onEachFeature: (feature, flayer) => {
            const name     = feature.properties.brgy_name
            const score    = getBrgyScore(name)
            const hotspots = getBrgyHotspots(name)
            const isUser   = userBarangay && name.toLowerCase() === userBarangay.toLowerCase()

            flayer.on('mouseover', () => {
              flayer.setStyle({ fillOpacity: 0.85, weight: 2 })
              setTip({ name, score, hotspots, isUser })
            })
            flayer.on('mouseout', () => {
              layer.resetStyle(flayer)
              setTip(null)
            })
            flayer.on('click', () => {
              setTip({ name, score, hotspots, isUser })
              map.fitBounds(flayer.getBounds(), { padding: [20, 20], maxZoom: 15 })
            })

            // Hotspot dot for problematic barangays
            if (hotspots > 0) {
              const center = flayer.getBounds().getCenter()
              const dot = L.circleMarker(center, {
                radius:      hotspots > 5 ? 7 : 5,
                fillColor:   '#ef4444',
                color:       '#fff',
                weight:      1.5,
                fillOpacity: 0.95,
              }).addTo(map)

              dot.bindTooltip(`${name}: ${hotspots} hotspot${hotspots > 1 ? 's' : ''}`, {
                direction: 'top',
                className: 'ww-mini-tip',
              })
            }
          },
        }).addTo(map)

        geoLayerRef.current = layer

        // Fit map to Lucena bounds
        try {
          map.fitBounds(layer.getBounds(), { padding: [8, 8] })
        } catch { /* layer might be empty */ }
      })
      .catch(() => {
        console.warn('HotspotMap: /data/lucena_barangays.geojson not found')
      })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [ready, mapData]) // Trigger re-creation or update on mapData change

  // Re-style when userBarangay changes
  useEffect(() => {
    if (!geoLayerRef.current || !window.L) return
    geoLayerRef.current.eachLayer(flayer => {
      const name    = flayer.feature?.properties?.brgy_name
      if (!name) return
      const score   = getBrgyScore(name)
      const c       = scoreColor(score)
      const isUser  = userBarangay && name.toLowerCase() === userBarangay.toLowerCase()
      flayer.setStyle({
        color:       isUser ? '#fff' : c.stroke,
        weight:      isUser ? 2.5    : 1.2,
        fillColor:   c.fill,
        fillOpacity: c.opacity,
      })
    })
  }, [userBarangay, mapData])

  return (
    <div>
      {/* Tooltip badge injected CSS */}
      <style>{`
        .ww-mini-tip {
          background: rgba(15,23,42,0.92) !important;
          border: 1px solid rgba(255,255,255,0.12) !important;
          color: #e2e8f0 !important;
          font-size: 11px !important;
          padding: 3px 8px !important;
          border-radius: 6px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
        }
        .ww-mini-tip::before { display: none !important; }
      `}</style>

      {/* Legend */}
      

      {/* Map container */}
      <div style={{
        position:     'relative',
        borderRadius: 'var(--radius)',
        overflow:     'hidden',
        border:       '1px solid var(--border)',
        background:   '#0f172a',
        height:       320,
      }}>
        {!ready && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 12,
          }}>
            Loading map…
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Hover tooltip overlay */}
        {tip && (
          <div style={{
            position:     'absolute',
            bottom:       12,
            left:         12,
            background:   'rgba(15,23,42,0.95)',
            border:       '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding:      '10px 14px',
            zIndex:       1000,
            minWidth:     170,
            pointerEvents: 'none',
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              {tip.isUser && <span style={{ fontSize: 9, background: 'rgba(46,204,113,.2)', color: '#4ade80', padding: '1px 5px', borderRadius: 8, fontWeight: 800 }}>YOU</span>}
              {tip.name}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { label: 'SCORE',    value: `${tip.score}%`,     color: tip.score >= 80 ? '#4ade80' : tip.score >= 60 ? '#eab308' : '#ef4444' },
                { label: 'HOTSPOTS', value: tip.hotspots || '0', color: tip.hotspots > 3 ? '#ef4444' : '#94a3b8' },
              ].map(s => (
                <div key={s.label} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 8, color: '#64748b', fontWeight: 700, letterSpacing: '.04em', marginTop: 1 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {LEGEND.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className="msi" style={{ fontSize: 13 }}>info</span>
        Red dot = hotspot cluster · White dot = your barangay · Hover or click a zone for details
      </div>
    </div>
  )
}