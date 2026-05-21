// MiniMap.jsx — Embedded map widget for the WasteWatch Dashboard
// Drop into src/components/MiniMap.jsx
// Requires Leaflet CDN in index.html:
//   <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
//   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ─── SHARED MOCK DATA (mirrors MapView.jsx — swap for API calls later) ────────

const LUCENA_CENTER = [13.9373, 121.617]

const TRUCK_ROUTES = [
  {
    id: 'T01', truckId: 'Truck 01', driver: 'Pedro Santos',
    barangay: 'Ibabang Dupay Zone 1', status: 'collecting',
    capacity: 75, collectedCount: 11, totalPoints: 15,
    eta: '1:45 PM', color: '#14b8a6',
    waypoints: [
      [13.946, 121.6085], [13.9472, 121.6102], [13.948, 121.612],
      [13.9488, 121.6138], [13.9475, 121.6155], [13.946, 121.616],
      [13.9448, 121.6145], [13.944, 121.6128], [13.9452, 121.611],
      [13.9464, 121.6095],
    ],
    completedUpTo: 7,
  },
  {
    id: 'T02', truckId: 'Truck 02', driver: 'Juan Dela Cruz',
    barangay: 'Ibabang Dupay Zone 3', status: 'collecting',
    capacity: 60, collectedCount: 9, totalPoints: 15,
    eta: '2:30 PM', color: '#f59e0b',
    waypoints: [
      [13.94, 121.6135], [13.941, 121.615], [13.942, 121.6165],
      [13.9432, 121.6178], [13.944, 121.619], [13.9448, 121.62],
      [13.9438, 121.6208], [13.9425, 121.6202], [13.9415, 121.6188],
      [13.9408, 121.617], [13.9402, 121.6152],
    ],
    completedUpTo: 8,
  },
  {
    id: 'T03', truckId: 'Truck 03', driver: 'Maria Reyes',
    barangay: 'Cotta Commercial', status: 'en_route',
    capacity: 30, collectedCount: 4, totalPoints: 12,
    eta: '3:15 PM', color: '#a78bfa',
    waypoints: [
      [13.933, 121.6095], [13.934, 121.611], [13.9352, 121.6125],
      [13.9362, 121.614], [13.937, 121.6155], [13.9362, 121.6168],
      [13.935, 121.6162], [13.9338, 121.6148],
    ],
    completedUpTo: 3,
  },
]

const GARBAGE_REPORTS = [
  { id: 'R1', lat: 13.9415, lng: 121.6175, type: 'overflow', severity: 'high', address: 'Ibabang Dupay Zone 3' },
  { id: 'R2', lat: 13.9358, lng: 121.613, type: 'illegal_dumping', severity: 'medium', address: 'Near Cotta District' },
  { id: 'R3', lat: 13.9482, lng: 121.6145, type: 'missed', severity: 'low', address: 'Zone 1 Side Street' },
]

// ─── ICON HELPERS ─────────────────────────────────────────────────────────────

const makeTruckIconHtml = (color, label) => `
  <div style="position:relative;width:36px;height:44px;">
    <div style="background:${color};border:2px solid white;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);width:32px;height:32px;
      box-shadow:0 3px 10px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;">
      <div style="transform:rotate(45deg);font-size:14px;">🚛</div>
    </div>
    <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);
      background:${color};color:white;font-size:8px;font-weight:700;
      padding:1px 4px;border-radius:6px;border:1px solid white;
      white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3);">${label}</div>
  </div>`

const reportIconHtml = (severity) => {
  const c = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }[severity] || '#f59e0b'
  return `<div style="background:${c};border:2px solid white;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);width:24px;height:24px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 2px 8px rgba(0,0,0,0.35);">
    <div style="transform:rotate(45deg);font-size:11px;">⚠️</div>
  </div>`
}

const STATUS_COLORS = { collecting: '#22c55e', en_route: '#f59e0b', idle: '#64748b', done: '#3b82f6' }
const STATUS_LABELS = { collecting: 'Collecting', en_route: 'En Route', idle: 'Idle', done: 'Done' }

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function MiniMap() {
  const navigate = useNavigate()
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const layersRef = useRef({})

  const [leafletReady, setLeafletReady] = useState(false)
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)

  // ── Load Leaflet CSS + JS once ──────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setLeafletReady(true); return }

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setLeafletReady(true)
    document.head.appendChild(script)
  }, [])

  // ── Init map once Leaflet is ready ──────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return

    const L = window.L
    const map = L.map(mapRef.current, {
      center: LUCENA_CENTER,
      zoom: 14,
      zoomControl: false,
      scrollWheelZoom: false, // disabled in widget — full map has it
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    mapInstance.current = map
    drawLayers(map)
  }, [leafletReady])

  // ── Draw all map layers ─────────────────────────────────────────────────────
  function drawLayers(map) {
    const L = window.L

    // Truck routes
    TRUCK_ROUTES.forEach(route => {
      const donePts = route.waypoints.slice(0, route.completedUpTo + 1)
      const remPts = route.waypoints.slice(route.completedUpTo)

      const doneLine = L.polyline(donePts, {
        color: route.color, weight: 4, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(map)

      const remLine = L.polyline(remPts, {
        color: route.color, weight: 3, opacity: 0.45, dashArray: '9,7',
      }).addTo(map)

      const onClick = () => { setSelectedRoute(route); setPanelOpen(true) }
      doneLine.on('click', onClick)
      remLine.on('click', onClick)

      // Stop dots
      route.waypoints.forEach((coord, i) => {
        const done = i <= route.completedUpTo
        const circle = L.circleMarker(coord, {
          radius: done ? 6 : 4,
          fillColor: done ? route.color : '#1e293b',
          color: route.color, weight: 2,
          opacity: 1, fillOpacity: done ? 1 : 0.55,
        }).addTo(map)
        circle.on('click', onClick)
        layersRef.current[`stop-${route.id}-${i}`] = circle
      })

      layersRef.current[`done-${route.id}`] = doneLine
      layersRef.current[`rem-${route.id}`] = remLine
    })

    // Truck markers at current position
    TRUCK_ROUTES.forEach(route => {
      const pos = route.waypoints[route.completedUpTo]
      const icon = L.divIcon({
        html: makeTruckIconHtml(route.color, route.truckId),
        className: '', iconSize: [36, 44], iconAnchor: [18, 44],
      })
      const m = L.marker(pos, { icon }).addTo(map)
      m.on('click', () => { setSelectedRoute(route); setPanelOpen(true) })
      layersRef.current[`truck-${route.id}`] = m
    })

    // Garbage report markers
    GARBAGE_REPORTS.forEach(r => {
      const icon = L.divIcon({
        html: reportIconHtml(r.severity),
        className: '', iconSize: [24, 30], iconAnchor: [6, 30],
      })
      const m = L.marker([r.lat, r.lng], { icon }).addTo(map)
      m.bindPopup(`<b>⚠️ ${r.type.replace('_', ' ')}</b><br/><small>${r.address}</small>`)
      layersRef.current[`rep-${r.id}`] = m
    })
  }

  const pct = selectedRoute
    ? Math.round((selectedRoute.collectedCount / selectedRoute.totalPoints) * 100)
    : 0

  return (
    <div className="ww-minimap" style={{
      position: 'relative',
      zIndex: 0,
      isolation: 'isolate',
      borderRadius: 14,
      overflow: 'hidden',
      border: '1px solid rgba(20,184,166,0.2)',
    }}>

      {/* Scoped Leaflet z-index reset — prevents map panes escaping into navbar/bottom nav */}
      <style>{`
        .ww-minimap .leaflet-pane,
        .ww-minimap .leaflet-control-container { z-index: 1 !important; }
        .ww-minimap .leaflet-top,
        .ww-minimap .leaflet-bottom { z-index: 2 !important; }
        @keyframes mmSlideDown { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }
      `}</style>

      {/* ── MAP CONTAINER ── */}
      <div
        ref={mapRef}
        style={{ width: '100%', height: 240, background: '#0f172a', position: 'relative', zIndex: 0 }}
      />

      {/* Loading overlay */}
      {!leafletReady && (
        <div style={{
          position: 'absolute', inset: 0,
          background: '#0f172a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 14,
        }}>
          <span style={{ color: '#14b8a6', fontSize: 13, fontWeight: 600 }}>Loading map…</span>
        </div>
      )}



      {/* ── EXPAND BUTTON (top-right) ── */}
      <button
        onClick={() => navigate('/map')}
        style={{
          position: 'absolute', top: 10, right: 10, zIndex: 400,
          background: 'rgba(20,184,166,0.9)', border: 'none',
          color: 'white', borderRadius: 8, padding: '5px 10px',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 2px 10px rgba(20,184,166,0.4)',
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        ⛶ Full Map
      </button>

      {/* ── STATS BAR (bottom of map) ── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(to top,rgba(15,23,42,0.95),rgba(15,23,42,0))',
        padding: '20px 14px 10px',
        display: 'flex', gap: 16, alignItems: 'flex-end',
        zIndex: 400,
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <span style={{ color: '#cbd5e1', fontSize: 11 }}>
            {TRUCK_ROUTES.filter(r => r.status === 'collecting').length} Active Trucks
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 6px #f59e0b' }} />
          <span style={{ color: '#cbd5e1', fontSize: 11 }}>{GARBAGE_REPORTS.length} Reports Nearby</span>
        </div>
      </div>

      {/* ── ROUTE DETAIL PANEL (slides in below map) ── */}
      {panelOpen && selectedRoute && (
        <div style={{
          background: '#0f172a',
          borderTop: `2px solid ${selectedRoute.color}`,
          padding: '14px 16px 16px',
          animation: 'mmSlideDown 0.25s ease',
        }}>


          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>🚛</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: 'white', fontWeight: 800, fontSize: 15 }}>{selectedRoute.truckId}</div>
              <div style={{ color: '#94a3b8', fontSize: 11 }}>{selectedRoute.driver} · {selectedRoute.barangay}</div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: `${STATUS_COLORS[selectedRoute.status]}1a`,
              border: `1px solid ${STATUS_COLORS[selectedRoute.status]}`,
              borderRadius: 20, padding: '3px 10px',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[selectedRoute.status] }} />
              <span style={{ color: STATUS_COLORS[selectedRoute.status], fontSize: 11, fontWeight: 700 }}>
                {STATUS_LABELS[selectedRoute.status]}
              </span>
            </div>
            <button
              onClick={() => setPanelOpen(false)}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', padding: 0 }}
            >✕</button>
          </div>

          {/* Quick stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'ETA', value: selectedRoute.eta },
              { label: 'Stops', value: `${selectedRoute.collectedCount}/${selectedRoute.totalPoints}` },
              { label: 'Capacity', value: `${selectedRoute.capacity}%` },
            ].map(s => (
              <div key={s.label} style={{
                background: '#1e293b', borderRadius: 10, padding: '8px 10px', textAlign: 'center',
              }}>
                <div style={{ color: '#64748b', fontSize: 10, fontWeight: 600, marginBottom: 3 }}>{s.label}</div>
                <div style={{ color: selectedRoute.color, fontSize: 14, fontWeight: 800 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>ROUTE PROGRESS</span>
              <span style={{ color: 'white', fontSize: 11, fontWeight: 700 }}>{pct}%</span>
            </div>
            <div style={{ background: '#1e293b', borderRadius: 6, height: 8 }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: `linear-gradient(90deg,${selectedRoute.color},#22c55e)`,
                borderRadius: 6, transition: 'width 0.4s',
              }} />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => navigate('/map')}
              style={{
                flex: 1, background: `${selectedRoute.color}22`,
                border: `1px solid ${selectedRoute.color}`,
                color: selectedRoute.color, borderRadius: 10,
                padding: '9px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}
            >
              🗺 View Full Route
            </button>

          </div>
        </div>
      )}
    </div>
  )
}