/**
 * pages/admin/DumpsiteManagement.jsx
 * ------------------------------------
 * Admin: Map-based dumpsite & landfill management.
 * - Click map to place a new pin
 * - Fill in name, type, barangay, capacity
 * - Edit or remove existing pins
 * - Marker icons differ by type (landfill vs dumpsite vs transfer)
 * Uses same Leaflet CDN approach as MapView.jsx
 */

import { useEffect, useRef, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'

const LUCENA_CENTER = [13.9373, 121.617]

const BARANGAYS = [
  'Isabang', 'Cotta', 'Kanlurang Cotta', 'Ibabang Dupay',
  'Gulang-Gulang', 'Mayao Crossing', 'Barangay 1', 'Barangay 2',
  'Barangay 3', 'Ilayang Dupay',
]

const TYPES = [
  { value: 'landfill',  label: 'Landfill',         emoji: '🏔️', color: '#e74c3c' },
  { value: 'dumpsite',  label: 'Open Dumpsite',    emoji: '🗑️', color: '#f39c12' },
  { value: 'transfer',  label: 'Transfer Station', emoji: '🏭', color: '#5dade2' },
  { value: 'composting',label: 'Composting Area',  emoji: '🌿', color: '#2ecc71' },
]

const typeMap = Object.fromEntries(TYPES.map(t => [t.value, t]))

const INITIAL_SITES = [
  { id: 1, name: 'Main Landfill', type: 'landfill',  barangay: 'Gulang-Gulang', capacity: 82, notes: 'Primary city landfill', lat: 13.9295, lng: 121.623 },
  { id: 2, name: 'Cotta Transfer Station', type: 'transfer', barangay: 'Cotta', capacity: 55, notes: 'Mid-city transfer point', lat: 13.9345, lng: 121.6085 },
  { id: 3, name: 'Isabang Composting', type: 'composting', barangay: 'Isabang', capacity: 30, notes: 'Organic waste composting', lat: 13.943, lng: 121.614 },
]

const EMPTY_FORM = { name: '', type: 'dumpsite', barangay: '', capacity: '', notes: '' }

// ── Marker HTML by type ───────────────────────────────────────────────────────

function markerHtml(type) {
  const t = typeMap[type] || TYPES[1]
  return `<div style="
    background:${t.color};border:2.5px solid white;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);width:36px;height:36px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 14px rgba(0,0,0,0.4);">
    <div style="transform:rotate(45deg);font-size:16px;">${t.emoji}</div>
  </div>`
}

function pendingMarkerHtml() {
  return `<div style="
    background:#fff;border:3px dashed #f39c12;border-radius:50%;
    width:36px;height:36px;display:flex;align-items:center;justify-content:center;
    font-size:18px;box-shadow:0 4px 14px rgba(0,0,0,0.3);
    animation:ww-blink 1s infinite;">📍</div>`
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function SiteModal({ site, coords, onSave, onClose }) {
  const isEdit = !!site
  const [form, setForm] = useState(site ? {
    name: site.name, type: site.type, barangay: site.barangay,
    capacity: site.capacity, notes: site.notes || '',
  } : { ...EMPTY_FORM })
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function submit() {
    if (!form.name.trim()) { setErr('Name is required.'); return }
    if (!form.barangay) { setErr('Please select a barangay.'); return }
    onSave(form)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 24,
        width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 17, margin: 0 }}>
            {isEdit ? 'Edit Site' : 'Add New Site'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        {coords && !isEdit && (
          <div style={{
            background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.3)',
            borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#2ecc71',
            marginBottom: 14, fontWeight: 600,
          }}>
            📍 {coords[0].toFixed(5)}, {coords[1].toFixed(5)}
          </div>
        )}

        {err && (
          <div style={{
            background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#e74c3c', marginBottom: 12,
          }}>{err}</div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label className="form-label">Site Name</label>
          <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main Landfill — Gulang-Gulang" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="form-label">Type</label>
            <select className="form-input" value={form.type} onChange={e => set('type', e.target.value)}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Barangay</label>
            <select className="form-input" value={form.barangay} onChange={e => set('barangay', e.target.value)}>
              <option value="">— Select —</option>
              {BARANGAYS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label className="form-label">Capacity Used (%)</label>
          <input className="form-input" type="number" min="0" max="100"
            value={form.capacity} onChange={e => set('capacity', e.target.value)} placeholder="0 – 100" />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label className="form-label">Notes (optional)</label>
          <textarea className="form-input" rows={2} value={form.notes}
            onChange={e => set('notes', e.target.value)} placeholder="Additional info…"
            style={{ resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit}>
            {isEdit ? 'Save Changes' : 'Add Site'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Capacity Bar ──────────────────────────────────────────────────────────────

function CapBar({ pct }) {
  const p = Number(pct) || 0
  const color = p > 80 ? '#e74c3c' : p > 60 ? '#f39c12' : '#2ecc71'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: '#ddd', borderRadius: 20, height: 5, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: color, borderRadius: 20 }} />
      </div>
      <span style={{ fontSize: 10, color: '#888', width: 28, textAlign: 'right' }}>{p}%</span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DumpsiteManagement() {
  const mapRef         = useRef(null)
  const mapInstance    = useRef(null)
  const markersRef     = useRef({})       // id → leaflet marker
  const pendingRef     = useRef(null)     // temp marker while modal is open

  const [mapReady,   setMapReady]   = useState(false)
  const [sites,      setSites]      = useState(INITIAL_SITES)
  const [modal,      setModal]      = useState(null)  // null | 'add' | site obj
  const [pendingCoords, setPendingCoords] = useState(null)
  const [selected,   setSelected]   = useState(null)
  const [toast,      setToast]      = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [addMode,    setAddMode]    = useState(false)

  // refs for closure access in Leaflet event handlers
  const addModeRef = useRef(false)
  addModeRef.current = addMode

  // ── Load Leaflet CDN ───────────────────────────────────────────────────────
  useEffect(() => {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)
  }, [])

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || mapInstance.current) return
    const L = window.L
    const map = L.map(mapRef.current, { center: LUCENA_CENTER, zoom: 14, zoomControl: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    map.on('click', e => {
      if (!addModeRef.current) return
      const { lat, lng } = e.latlng
      // drop pending marker
      if (pendingRef.current) { try { map.removeLayer(pendingRef.current) } catch {} }
      const icon = L.divIcon({ html: pendingMarkerHtml(), className: '', iconSize: [36, 36], iconAnchor: [18, 36] })
      pendingRef.current = L.marker([lat, lng], { icon }).addTo(map)
      setPendingCoords([lat, lng])
      setModal('add')
      setAddMode(false)
    })
    mapInstance.current = map
  }, [mapReady])

  // ── Sync markers to map whenever sites list changes ────────────────────────
  useEffect(() => {
    if (!mapReady || !mapInstance.current) return
    const L = window.L
    const map = mapInstance.current

    // remove stale markers
    Object.keys(markersRef.current).forEach(id => {
      if (!sites.find(s => s.id === Number(id))) {
        try { map.removeLayer(markersRef.current[id]) } catch {}
        delete markersRef.current[id]
      }
    })

    // add / update markers
    sites.forEach(site => {
      if (markersRef.current[site.id]) {
        try { map.removeLayer(markersRef.current[site.id]) } catch {}
      }
      const icon = L.divIcon({ html: markerHtml(site.type), className: '', iconSize: [36, 42], iconAnchor: [18, 42] })
      const marker = L.marker([site.lat, site.lng], { icon }).addTo(map)
      const t = typeMap[site.type] || TYPES[1]
      marker.bindPopup(`
        <div style="font-family:sans-serif;min-width:160px;">
          <strong style="color:${t.color}">${t.emoji} ${site.name}</strong><br/>
          <span style="color:#555;font-size:11px;">${t.label} · ${site.barangay}</span><br/>
          <span style="color:#888;font-size:11px;">Capacity: ${site.capacity}% full</span>
        </div>`)
      marker.on('click', () => setSelected(site))
      markersRef.current[site.id] = marker
    })
  }, [sites, mapReady])

  // ── cursor style when addMode active ──────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current) return
    mapInstance.current.getContainer().style.cursor = addMode ? 'crosshair' : ''
  }, [addMode])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function handleSave(form) {
    if (modal === 'add') {
      const [lat, lng] = pendingCoords
      const newSite = { ...form, id: Date.now(), lat, lng, capacity: Number(form.capacity) || 0 }
      setSites(prev => [...prev, newSite])
      if (pendingRef.current) { try { mapInstance.current.removeLayer(pendingRef.current) } catch {} pendingRef.current = null }
      setPendingCoords(null)
      showToast('✅ Site added successfully.')
    } else {
      setSites(prev => prev.map(s => s.id === modal.id ? { ...s, ...form, capacity: Number(form.capacity) || 0 } : s))
      showToast('✅ Site updated.')
    }
    setModal(null)
  }

  function deleteSite(id) {
    if (!window.confirm('Remove this site from the map?')) return
    setSites(prev => prev.filter(s => s.id !== id))
    if (selected?.id === id) setSelected(null)
    showToast('🗑 Site removed.')
  }

  function flyTo(site) {
    if (!mapInstance.current) return
    mapInstance.current.flyTo([site.lat, site.lng], 16, { duration: 1 })
    setSelected(site)
  }

  const filtered = typeFilter === 'all' ? sites : sites.filter(s => s.type === typeFilter)

  return (
    <DashboardLayout>

      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 22px',
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      {modal && (
        <SiteModal
          site={modal === 'add' ? null : modal}
          coords={modal === 'add' ? pendingCoords : null}
          onSave={handleSave}
          onClose={() => {
            if (pendingRef.current) { try { mapInstance.current?.removeLayer(pendingRef.current) } catch {} pendingRef.current = null }
            setPendingCoords(null)
            setModal(null)
          }}
        />
      )}

      <style>{`
        @keyframes ww-blink { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .dm-row { transition:background .12s; cursor:pointer; }
        .dm-row:hover { background:var(--surface-2) !important; }
        .dm-site-btn { transition:all .15s; cursor:pointer; }
        .dm-site-btn:hover { opacity:.82; transform:scale(.97); }
      `}</style>

      <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                Dumpsite & Landfill Map
              </h2>
              <span style={{
                background: 'rgba(231,76,60,0.1)', color: '#e74c3c',
                border: '1px solid rgba(231,76,60,0.3)',
                fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
              }}>ADMIN</span>
            </div>
            <p className="text-muted text-sm">Click the map to drop a new site pin. Click existing markers to manage them.</p>
          </div>

          <button
            className="dm-site-btn btn"
            onClick={() => setAddMode(a => !a)}
            style={{
              background: addMode ? '#f39c12' : 'var(--accent)', color: '#0d1117',
              border: 'none', borderRadius: 10, padding: '9px 18px', fontWeight: 700,
            }}
          >
            {addMode ? '✕ Cancel — Click Map' : '+ Add Site (Click Map)'}
          </button>
        </div>

        {addMode && (
          <div style={{
            background: 'rgba(243,156,18,0.1)', border: '1px solid rgba(243,156,18,0.4)',
            borderRadius: 10, padding: '10px 16px', marginBottom: 14,
            fontSize: 13, color: '#f39c12', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            🖱️ Click anywhere on the map below to place a new site pin.
          </div>
        )}

        {/* ── Two-column layout: map + side list ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, height: 580 }}>

          {/* MAP */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative', borderRadius: 14 }}>
            <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
            {!mapReady && (
              <div style={{
                position: 'absolute', inset: 0, background: '#0f172a',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5,
              }}>
                <span style={{ color: '#5dade2', fontWeight: 600 }}>Loading Map…</span>
              </div>
            )}

            {/* Legend overlay */}
            <div style={{
              position: 'absolute', bottom: 16, left: 16, zIndex: 400,
              background: 'rgba(15,23,42,0.93)', borderRadius: 10, padding: '10px 14px',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {TYPES.map(t => (
                <div key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 14 }}>{t.emoji}</span>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                  <span style={{ color: '#cbd5e1', fontSize: 11 }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SIDE LIST */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>

            {/* Type filter pills */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button className="dm-site-btn" onClick={() => setTypeFilter('all')} style={{
                padding: '4px 12px', borderRadius: 20, border: '1px solid',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                borderColor: typeFilter === 'all' ? 'var(--accent)' : 'var(--border)',
                color: typeFilter === 'all' ? 'var(--accent)' : 'var(--text-muted)',
                background: typeFilter === 'all' ? 'rgba(46,204,113,0.08)' : 'transparent',
              }}>All ({sites.length})</button>
              {TYPES.map(t => (
                <button key={t.value} className="dm-site-btn" onClick={() => setTypeFilter(t.value)} style={{
                  padding: '4px 12px', borderRadius: 20, border: '1px solid',
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)',
                  borderColor: typeFilter === t.value ? t.color : 'var(--border)',
                  color: typeFilter === t.value ? t.color : 'var(--text-muted)',
                  background: typeFilter === t.value ? `${t.color}18` : 'transparent',
                }}>{t.emoji} {sites.filter(s => s.type === t.value).length}</button>
              ))}
            </div>

            {/* Site cards */}
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                No sites found.
              </div>
            )}

            {filtered.map(site => {
              const t = typeMap[site.type] || TYPES[1]
              const isSelected = selected?.id === site.id
              return (
                <div
                  key={site.id}
                  className="dm-row"
                  onClick={() => flyTo(site)}
                  style={{
                    background: isSelected ? `${t.color}10` : 'var(--surface)',
                    border: `1px solid ${isSelected ? t.color : 'var(--border)'}`,
                    borderRadius: 12, padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: `${t.color}18`, border: `1px solid ${t.color}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                    }}>{t.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {site.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t.label} · {site.barangay}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                      background: `${t.color}18`, color: t.color, border: `1px solid ${t.color}44`,
                    }}>{t.label.toUpperCase()}</span>
                  </div>

                  <CapBar pct={site.capacity} />

                  {site.notes && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, fontStyle: 'italic' }}>
                      {site.notes}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="dm-site-btn btn btn-outline btn-sm" style={{ flex: 1, fontSize: 11 }}
                      onClick={e => { e.stopPropagation(); setModal(site) }}>
                      ✏️ Edit
                    </button>
                    <button className="dm-site-btn btn btn-sm" style={{
                      background: 'rgba(231,76,60,0.07)', color: '#e74c3c',
                      border: '1px solid rgba(231,76,60,0.25)', fontSize: 11,
                    }} onClick={e => { e.stopPropagation(); deleteSite(site.id) }}>
                      🗑 Remove
                    </button>
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
