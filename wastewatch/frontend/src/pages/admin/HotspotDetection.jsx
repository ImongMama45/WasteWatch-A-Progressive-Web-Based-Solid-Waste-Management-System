/**
 * pages/admin/HotspotDetection.jsx
 * ----------------------------------
 * Map-based hotspot detection showing areas with repeated reports.
 * Uses Leaflet CDN (same pattern as MapView) + circle overlays
 * sized/colored by report count to simulate a heatmap.
 */

import { useEffect, useRef, useState, useMemo } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import { useHotspots } from '../../hooks/useHotspots'
import AdminReports from './AdminReports'
import api from '../../api/client'

const LUCENA_CENTER = [13.9373, 121.617]

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

  const { items: hotspots, loading, refresh: refreshHotspots } = useHotspots()

  const [mapReady,  setMapReady]  = useState(false)
  const [selected,  setSelected]  = useState(null)
  const [filter,    setFilter]    = useState('all')
  const [typeFilter,setTypeFilter]= useState('all')
  const [distributionFilter, setDistributionFilter] = useState('all')
  const [showReports, setShowReports] = useState(false)
  const [routeModal, setRouteModal] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [trucks, setTrucks] = useState([])
  const [selectedTruckId, setSelectedTruckId] = useState('')

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

  // Load active trucks for the assign modal
  useEffect(() => {
    api.get('/api/driver/trucks/').then(res => {
      const active = (res.data || []).filter(t => t.status === 'active')
      setTrucks(active)
    }).catch(() => {})
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
  }, [mapReady])

  useEffect(() => {
    if (mapInst.current && hotspots.length > 0) {
      drawHotspots(mapInst.current)
    }
  }, [hotspots, mapReady])

  function drawHotspots(map) {
    const L = window.L
    // clear old
    circlesRef.current.forEach(c => { try { map.removeLayer(c) } catch {} })
    circlesRef.current = []

    hotspots.forEach(h => {
      const st = hotspotStyle(h.count)

      // Outer glow circle
      const outer = L.circle([h.latitude, h.longitude], {
        radius: st.radius,
        color: st.fill, weight: 0,
        fillColor: st.fill, fillOpacity: st.opacity * 0.4,
        interactive: false,
      }).addTo(map)

      // Inner circle
      const inner = L.circle([h.latitude, h.longitude], {
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
      const marker = L.marker([h.latitude, h.longitude], { icon }).addTo(map)

      marker.on('click', () => setSelected(h))
      inner.on('click',  () => setSelected(h))

      circlesRef.current.push(outer, inner, marker)
    })
  }

  function flyTo(h) {
    if (!mapInst.current) return
    mapInst.current.flyTo([h.latitude, h.longitude], 16, { duration: 1 })
    setSelected(h)
  }

  const allTypes = useMemo(() => [...new Set(hotspots.map(h => h.type).filter(Boolean))], [hotspots])

  const filtered = useMemo(() => hotspots.filter(h => {
    const ms = filter === 'all' || h.status === filter
    const mt = typeFilter === 'all' || h.type === typeFilter
    const md = distributionFilter === 'all' ? true : (distributionFilter === 'clustered' ? h.count > 1 : h.count <= 1)
    return ms && mt && md
  }).sort((a, b) => b.count - a.count), [hotspots, filter, typeFilter, distributionFilter])

  const counts = useMemo(() => ({
    critical: hotspots.filter(h => h.status === 'critical').length,
    high:     hotspots.filter(h => h.status === 'high').length,
    medium:   hotspots.filter(h => h.status === 'medium').length,
    low:      hotspots.filter(h => h.status === 'low').length,
  }), [hotspots])

  const maxCount = useMemo(() => Math.max(...hotspots.map(h => h.count), 1), [hotspots])

  return (
    <DashboardLayout>
      <style>{`
        .hs-row { transition: background .12s; cursor: pointer; }
        .hs-row:hover { background: var(--surface-2) !important; }
        .hs-filter { transition: all 0.2s ease; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .hs-filter:hover { transform: translateY(-1px); box-shadow: 0 3px 6px rgba(0,0,0,0.08); }
        .hs-filter:active { transform: translateY(0); box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      `}</style>

      <div className="page">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                {showReports ? 'Waste Reports' : 'Hotspot Detection'}
              </h2>
              {!showReports && counts.critical > 0 && (
                <span style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>
                  {counts.critical} CRITICAL
                </span>
              )}
            </div>
            <p className="text-muted text-sm">
              {showReports ? 'Comprehensive list of all submitted waste and incident reports.' : 'Areas with repeated waste reports — sized and colored by frequency.'}
            </p>
          </div>
          <div>
            <button
              onClick={() => setShowReports(!showReports)}
              style={{
                background: showReports ? 'var(--surface-2)' : 'var(--accent)',
                color: showReports ? 'var(--text)' : '#fff',
                border: showReports ? '1px solid var(--border)' : 'none',
                padding: '8px 16px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                boxShadow: showReports ? 'none' : '0 4px 12px rgba(46,204,113,0.3)'
              }}
            >
              {showReports ? '← Back to Map' : 'View All Reports 📋'}
            </button>
          </div>
        </div>

        {showReports ? (
          <AdminReports />
        ) : (
          <>
            {/* KPI strip */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Total Hotspots', value: hotspots.length,    color: 'var(--text)' },
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
                {hotspots.filter(h => h.status === 'critical').map(h => h.barangay_name).join(', ')}
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
                      <div style={{ color: '#94a3b8', fontSize: 11 }}>Brgy. {selected.barangay_name}</div>
                    </div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 16, cursor: 'pointer' }}>×</button>
                </div>
                {[
                  { label: 'REPORTS',     value: selected.count, accent: true },
                  { label: 'STATUS',       value: selected.status.charAt(0).toUpperCase() + selected.status.slice(1) },
                  { label: 'LAST REPORT',  value: selected.ago || 'recently' },
                  { label: 'LOCATION',     value: `${Number(selected.latitude).toFixed(4)}, ${Number(selected.longitude).toFixed(4)}` },
                  ...(selected.assigned_truck_plate ? [{ label: 'ASSIGNED TRUCK', value: `🚛 ${selected.assigned_truck_plate}` }] : [])
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700 }}>{r.label}</span>
                    <span style={{ color: r.accent ? STATUS_META[selected.status].color : '#e2e8f0', fontSize: 12, fontWeight: r.accent ? 800 : 400 }}>{r.value}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button style={{
                    flex: 1, background: 'rgba(46,204,113,0.1)',
                    border: '1px solid rgba(46,204,113,0.35)', color: '#2ecc71',
                    borderRadius: 8, padding: '8px', fontWeight: 700, fontSize: 11,
                    cursor: 'pointer', fontFamily: 'var(--font-body)',
                  }} onClick={() => window.location.href = '/admin/escalations'}>
                    Escalate
                  </button>
                  <button style={{
                    flex: 1, background: 'rgba(52,152,219,0.1)',
                    border: '1px solid rgba(52,152,219,0.35)', color: '#3498db',
                    borderRadius: 8, padding: '8px', fontWeight: 700, fontSize: 11,
                    cursor: 'pointer', fontFamily: 'var(--font-body)',
                  }} onClick={() => { setRouteModal(selected); setSelectedTruckId(selected.assigned_truck_id ? String(selected.assigned_truck_id) : '') }}>
                    {selected.assigned_truck_plate 
                      ? 'Re-assign Truck' 
                      : (selected.count > 1 ? '+ Add Route Part' : 'Assign Truck')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SIDE LIST */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 560 }}>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {['all', 'critical', 'high', 'medium', 'low'].map(f => {
                const m = STATUS_META[f] || { color: 'var(--text)', bg: 'var(--surface-2)', border: 'transparent' }
                const active = filter === f
                return (
                  <button key={`status-${f}`} className="hs-filter" onClick={() => setFilter(f)} style={{
                    padding: '6px 14px', borderRadius: 20, border: '1px solid',
                    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-body)',
                    borderColor: active ? (m.color || 'var(--accent)') : 'transparent',
                    color: active ? (m.color || 'var(--accent)') : 'var(--text)',
                    background: active ? (m.bg || 'rgba(46,204,113,0.12)') : 'var(--surface-2)',
                  }}>
                    {f === 'all' ? `All (${hotspots.length})` : m.label}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                { id: 'all', label: 'All Densities' },
                { id: 'clustered', label: 'Clustered (< 10m)' },
                { id: 'isolated', label: 'Isolated (Single)' }
              ].map(d => (
                <button key={`dist-${d.id}`} className="hs-filter" onClick={() => setDistributionFilter(d.id)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid',
                  fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-body)',
                  borderColor: distributionFilter === d.id ? 'var(--accent)' : 'transparent',
                  color: distributionFilter === d.id ? 'var(--accent)' : 'var(--text)',
                  background: distributionFilter === d.id ? 'rgba(46,204,113,0.12)' : 'var(--surface-2)',
                }}>
                  {d.label}
                </button>
              ))}
            </div>


            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {['all', ...allTypes].map(t => (
                <button key={`type-${t}`} className="hs-filter" onClick={() => setTypeFilter(t)} style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid',
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                  borderColor: typeFilter === t ? 'var(--accent)' : 'transparent',
                  color: typeFilter === t ? 'var(--accent)' : 'var(--text)',
                  background: typeFilter === t ? 'rgba(46,204,113,0.12)' : 'var(--surface-2)',
                }}>
                  {TYPE_ICON[t] || ''} {t === 'all' ? 'All Types' : t}
                </button>
              ))}
            </div>

            {/* Hotspot cards */}
            {filtered.map((h, i) => {
              const m  = STATUS_META[h.status] || STATUS_META.low
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
                        Brgy. {h.barangay_name} · {h.ago || 'recently'}
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
                    <div style={{ width: `${Math.round((h.count / maxCount) * 100)}%`, height: '100%', background: st.fill, borderRadius: 20, transition: 'width .5s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        </>
        )}

      </div>

      {/* Assign Truck Modal */}
      {routeModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)',
            padding: 24, width: '90%', maxWidth: 420, boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--text)', fontFamily: 'var(--font-head)', fontWeight: 800 }}>
              {routeModal.count > 1 ? 'Assign Truck for Route Waypoint' : 'Assign Truck for Direct Collection'}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.6 }}>
              Brgy. {routeModal.barangay_name} &nbsp;·&nbsp; {routeModal.count} report{routeModal.count > 1 ? 's' : ''}
              {routeModal.count > 1
                ? ' — this will be added as a waypoint in the selected truck\'s route.'
                : ' — the selected truck will be dispatched for isolated collection.'}
            </p>

            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>SELECT TRUCK</label>
            {trucks.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>No active trucks found.</p>
            ) : (
              <select
                value={selectedTruckId}
                onChange={e => setSelectedTruckId(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8, marginBottom: 18,
                  border: '1.5px solid var(--border)', background: 'var(--surface-2)',
                  color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-body)',
                }}
              >
                <option value=''>— Choose a truck —</option>
                {trucks.map(t => (
                  <option key={t.id} value={String(t.id)}>
                    {t.plate_number} · {t.model}{t.zone ? ` · ${t.zone}` : ''}
                  </option>
                ))}
              </select>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                disabled={isGenerating}
                onClick={() => { setRouteModal(null); setSelectedTruckId('') }}
                style={{
                  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
                  padding: '9px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  opacity: isGenerating ? 0.5 : 1,
                }}>Cancel</button>
              <button
                disabled={isGenerating || !selectedTruckId}
                onClick={async () => {
                  setIsGenerating(true)
                  try {
                    const res = await api.post(`/api/watcher/hotspots/${routeModal.id}/assign-truck/`, { truck_id: Number(selectedTruckId) })
                    setSelected(prev => prev ? { ...prev, assigned_truck_id: res.data.assigned_truck_id, assigned_truck_plate: res.data.assigned_truck_plate } : prev)
                    refreshHotspots()
                  } catch (err) {
                    console.error('[HotspotDetection] assign-truck failed', err)
                  } finally {
                    setIsGenerating(false)
                    setRouteModal(null)
                    setSelectedTruckId('')
                  }
                }}
                style={{
                  background: selectedTruckId ? 'var(--accent)' : 'var(--surface-2)',
                  border: 'none', color: selectedTruckId ? '#000' : 'var(--text-muted)',
                  padding: '9px 18px', borderRadius: 8, cursor: selectedTruckId ? 'pointer' : 'not-allowed',
                  fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                  opacity: isGenerating ? 0.7 : 1,
                }}>
                {isGenerating ? <div className='spinner' style={{ width: 14, height: 14, borderWidth: 2, borderColor: 'rgba(0,0,0,0.3)', borderTopColor: '#000' }} /> : null}
                {isGenerating ? 'Assigning...' : '🚛 Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

    </DashboardLayout>
  )
}
