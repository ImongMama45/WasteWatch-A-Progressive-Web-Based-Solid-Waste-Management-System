import { useEffect, useRef, useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'

const LUCENA_CENTER = [13.9373, 121.617]
const HOME_BASE = { lat: 13.9373, lng: 121.617, label: 'City Hall — Home Base' }

const TRUCKS = [
  { id: 'T01', plate: 'LCN-001', model: 'Isuzu Elf' },
  { id: 'T02', plate: 'LCN-002', model: 'Hino 300' },
  { id: 'T03', plate: 'LCN-004', model: 'Mitsubishi Canter' },
]
const DRIVERS = [
  { id: 1, name: 'Juan Dela Cruz' },
  { id: 2, name: 'Ana Mendoza' },
  { id: 3, name: 'Jose Bautista' },
]
const DUMPSITES = [
  { id: 'D1', name: 'Main Landfill — Gulang-Gulang', lat: 13.9295, lng: 121.623 },
  { id: 'D2', name: 'Cotta Transfer Station', lat: 13.9345, lng: 121.6085 },
]
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const STEP_LABELS = ['Truck & Driver','Schedule','Route Stops','Dumpsite','Preview & Save']

export default function RouteBuilder() {
  const mapRef      = useRef(null)
  const mapInst     = useRef(null)
  const layersRef   = useRef([])

  const [step, setStep]         = useState(0)
  const [mapReady, setMapReady] = useState(false)
  const [toast, setToast]       = useState(null)
  const [saved, setSaved]       = useState(false)

  // Form state
  const [truck,    setTruck]    = useState('')
  const [driver,   setDriver]   = useState('')
  const [days,     setDays]     = useState([])
  const [time,     setTime]     = useState('06:00')
  const [stops,    setStops]    = useState([])   // [{lat,lng,label}]
  const [dumpsite, setDumpsite] = useState('')
  const [addMode,  setAddMode]  = useState(false)

  const addModeRef = useRef(false)
  addModeRef.current = addMode

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

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
    map.on('click', e => {
      if (!addModeRef.current) return
      const { lat, lng } = e.latlng
      const label = `Stop ${stops.length + 1}`
      setStops(prev => [...prev, { lat, lng, label }])
      setAddMode(false)
    })
    mapInst.current = map
  }, [mapReady])

  // Redraw route on map
  useEffect(() => {
    if (!mapInst.current) return
    const L = window.L
    const map = mapInst.current
    layersRef.current.forEach(l => { try { map.removeLayer(l) } catch {} })
    layersRef.current = []

    const ds = DUMPSITES.find(d => d.id === dumpsite)
    const allPoints = [
      HOME_BASE,
      ...stops,
      ...(ds ? [{ lat: ds.lat, lng: ds.lng, label: ds.name }] : []),
      HOME_BASE,
    ]

    // Home base marker
    const homeIcon = L.divIcon({
      html: `<div style="background:#1e2633;border:2px solid #2ecc71;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 3px 8px rgba(0,0,0,.4);">🏛️</div>`,
      className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    })
    const hm = L.marker([HOME_BASE.lat, HOME_BASE.lng], { icon: homeIcon }).addTo(map)
    hm.bindPopup('<b>Home Base</b><br>' + HOME_BASE.label)
    layersRef.current.push(hm)

    // Stop markers
    stops.forEach((stop, i) => {
      const icon = L.divIcon({
        html: `<div style="background:#5dade2;border:2px solid white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:800;box-shadow:0 3px 8px rgba(0,0,0,.4);">${i + 1}</div>`,
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      })
      const m = L.marker([stop.lat, stop.lng], { icon, draggable: true }).addTo(map)
      m.bindPopup(`<b>${stop.label}</b>`)
      m.on('dragend', e => {
        const { lat, lng } = e.target.getLatLng()
        setStops(prev => prev.map((s, idx) => idx === i ? { ...s, lat, lng } : s))
      })
      layersRef.current.push(m)
    })

    // Dumpsite marker
    if (ds) {
      const dsIcon = L.divIcon({
        html: `<div style="background:#e74c3c;border:2px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 3px 8px rgba(0,0,0,.4);">🏭</div>`,
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      })
      const dm = L.marker([ds.lat, ds.lng], { icon: dsIcon }).addTo(map)
      dm.bindPopup(`<b>${ds.name}</b>`)
      layersRef.current.push(dm)
    }

    // Route line
    if (allPoints.length > 1) {
      const coords = allPoints.map(p => [p.lat, p.lng])
      const line = L.polyline(coords, { color: '#2ecc71', weight: 4, opacity: 0.85, dashArray: '10,6' }).addTo(map)
      layersRef.current.push(line)
      if (step >= 2) map.fitBounds(line.getBounds(), { padding: [40, 40] })
    }
  }, [stops, dumpsite, mapReady, step])

  // cursor
  useEffect(() => {
    if (!mapInst.current) return
    mapInst.current.getContainer().style.cursor = addMode ? 'crosshair' : ''
  }, [addMode])

  function removeStop(i) {
    setStops(prev => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, label: `Stop ${idx + 1}` })))
  }

  function moveStop(i, dir) {
    setStops(prev => {
      const arr = [...prev]
      const to = i + dir
      if (to < 0 || to >= arr.length) return arr;
      [arr[i], arr[to]] = [arr[to], arr[i]]
      return arr.map((s, idx) => ({ ...s, label: `Stop ${idx + 1}` }))
    })
  }

  function canNext() {
    if (step === 0) return truck && driver
    if (step === 1) return days.length > 0 && time
    if (step === 2) return stops.length > 0
    if (step === 3) return !!dumpsite
    return true
  }

  function handleSave() {
    const ds = DUMPSITES.find(d => d.id === dumpsite)
    const truckObj = TRUCKS.find(t => t.id === truck)
    const driverObj = DRIVERS.find(d => d.id === Number(driver))
    setSaved(true)
    showToast(`✅ Route saved! ${truckObj?.plate} · ${stops.length} stops · ${ds?.name}`)
  }

  const selectedDumpsite = DUMPSITES.find(d => d.id === dumpsite)
  const selectedTruck    = TRUCKS.find(t => t.id === truck)
  const selectedDriver   = DRIVERS.find(d => d.id === Number(driver))

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

      <style>{`
        .rb-btn { transition:all .15s; cursor:pointer; }
        .rb-btn:hover { opacity:.85; }
        .rb-btn:active { transform:scale(.97); }
        .rb-stop-row:hover { background:var(--surface-2) !important; }
      `}</style>

      <div className="page">
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
              Route Builder
            </h2>
            <span style={{ background: 'rgba(93,173,226,0.1)', color: '#5dade2', border: '1px solid rgba(93,173,226,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>ADMIN</span>
          </div>
          <p className="text-muted text-sm">Build a garbage collection route: assign truck → schedule → stops → dumpsite.</p>
        </div>

        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24, overflowX: 'auto' }}>
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div
                className="rb-btn"
                onClick={() => i < step && setStep(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 12,
                  background: i < step ? 'var(--accent)' : i === step ? 'var(--surface-3, #1e2633)' : 'var(--surface-2)',
                  color: i < step ? '#0d1117' : i === step ? '#fff' : 'var(--text-muted)',
                  border: i === step ? '2px solid var(--accent)' : '2px solid transparent',
                }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: 12, fontWeight: i === step ? 700 : 500, color: i === step ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div style={{ width: 24, height: 2, background: i < step ? 'var(--accent)' : 'var(--border)', margin: '0 8px', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

          {/* MAP */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 14, height: 540, position: 'relative' }}>
            <div ref={mapRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
            {!mapReady && (
              <div style={{ position: 'absolute', inset: 0, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
                <span style={{ color: '#5dade2', fontWeight: 600 }}>Loading Map…</span>
              </div>
            )}
            {/* Legend */}
            <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 400, background: 'rgba(15,23,42,0.9)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11, color: '#cbd5e1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>🏛️ <span>Home Base</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><div style={{ width: 18, height: 18, borderRadius: '50%', background: '#5dade2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800 }}>N</div><span>Stop</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>🏭 <span>Dumpsite</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 18, height: 2, background: '#2ecc71', borderTop: '2px dashed #2ecc71' }} /><span>Route</span></div>
            </div>
            {step === 2 && (
              <button
                className="rb-btn"
                onClick={() => setAddMode(a => !a)}
                style={{
                  position: 'absolute', top: 12, left: 12, zIndex: 400,
                  background: addMode ? '#f39c12' : 'rgba(15,23,42,0.92)',
                  color: addMode ? '#0d1117' : '#2ecc71',
                  border: '1px solid rgba(46,204,113,0.4)',
                  borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 12,
                  fontFamily: 'var(--font-body)',
                }}
              >
                {addMode ? '✕ Click map to add stop' : '+ Add Stop'}
              </button>
            )}
          </div>

          {/* SIDE PANEL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* STEP 0 — Truck & Driver */}
            {step === 0 && (
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>
                  1. Select Truck & Driver
                </h3>
                <div style={{ marginBottom: 14 }}>
                  <label className="form-label">Truck</label>
                  <select className="form-input" value={truck} onChange={e => setTruck(e.target.value)}>
                    <option value="">— Select truck —</option>
                    {TRUCKS.map(t => <option key={t.id} value={t.id}>{t.plate} · {t.model}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Driver</label>
                  <select className="form-input" value={driver} onChange={e => setDriver(e.target.value)}>
                    <option value="">— Select driver —</option>
                    {DRIVERS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                {truck && driver && (
                  <div style={{ marginTop: 14, background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 3 }}>{selectedTruck?.plate} — {selectedTruck?.model}</div>
                    <div style={{ color: 'var(--text-muted)' }}>Driver: {selectedDriver?.name}</div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 1 — Schedule */}
            {step === 1 && (
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>
                  2. Set Schedule
                </h3>
                <label className="form-label">Collection Days</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                  {DAYS.map(d => {
                    const on = days.includes(d)
                    return (
                      <button key={d} className="rb-btn" onClick={() => setDays(prev => on ? prev.filter(x => x !== d) : [...prev, d])}
                        style={{ padding: '5px 12px', borderRadius: 20, border: '1px solid', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', borderColor: on ? 'var(--accent)' : 'var(--border)', color: on ? 'var(--accent)' : 'var(--text-muted)', background: on ? 'rgba(46,204,113,0.1)' : 'transparent' }}>
                        {d.slice(0, 3)}
                      </button>
                    )
                  })}
                </div>
                <label className="form-label">Departure Time</label>
                <input className="form-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            )}

            {/* STEP 2 — Stops */}
            {step === 2 && (
              <div className="card" style={{ padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: 0 }}>
                    3. Route Stops ({stops.length})
                  </h3>
                  <button className="rb-btn btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => setAddMode(true)}>
                    + Add Stop
                  </button>
                </div>

                {stops.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                    Click "+ Add Stop" then click on the map to place collection stops.
                  </div>
                )}

                {/* Home base fixed row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 24, height: 24, background: '#1e2633', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>🏛️</div>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Home Base (City Hall)</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#2ecc71', fontWeight: 700 }}>START</span>
                </div>

                {stops.map((s, i) => (
                  <div key={i} className="rb-stop-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', transition: 'background .1s' }}>
                    <div style={{ width: 24, height: 24, background: '#5dade2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 10, flexShrink: 0 }}>{i + 1}</div>
                    <input
                      className="form-input"
                      value={s.label}
                      onChange={e => setStops(prev => prev.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                      style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                    />
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button className="rb-btn" onClick={() => moveStop(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                      <button className="rb-btn" onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, cursor: i === stops.length - 1 ? 'not-allowed' : 'pointer', opacity: i === stops.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button className="rb-btn" onClick={() => removeStop(i)} style={{ background: 'none', border: 'none', color: '#e74c3c', fontSize: 16, cursor: 'pointer' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* STEP 3 — Dumpsite */}
            {step === 3 && (
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>
                  4. Select Dumpsite
                </h3>
                {DUMPSITES.map(ds => (
                  <div key={ds.id} className="rb-btn" onClick={() => setDumpsite(ds.id)} style={{
                    border: `1.5px solid ${dumpsite === ds.id ? '#e74c3c' : 'var(--border)'}`,
                    background: dumpsite === ds.id ? 'rgba(231,76,60,0.07)' : 'var(--surface)',
                    borderRadius: 10, padding: '12px 14px', marginBottom: 10,
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <span style={{ fontSize: 22 }}>🏭</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{ds.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ds.lat.toFixed(4)}, {ds.lng.toFixed(4)}</div>
                    </div>
                    {dumpsite === ds.id && <span style={{ marginLeft: 'auto', color: '#e74c3c', fontWeight: 800 }}>✓</span>}
                  </div>
                ))}
              </div>
            )}

            {/* STEP 4 — Preview */}
            {step === 4 && (
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 16px' }}>
                  5. Route Summary
                </h3>
                <div style={{ marginBottom: 14 }}>
                  {[
                    { label: 'Truck',    value: `${selectedTruck?.plate} — ${selectedTruck?.model}` },
                    { label: 'Driver',   value: selectedDriver?.name },
                    { label: 'Days',     value: days.join(', ') },
                    { label: 'Time',     value: time },
                    { label: 'Stops',    value: `${stops.length} collection points` },
                    { label: 'Dumpsite', value: selectedDumpsite?.name },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>{r.label.toUpperCase()}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', maxWidth: 160 }}>{r.value || '—'}</span>
                    </div>
                  ))}
                </div>

                {/* Route path preview */}
                <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  🏛️ Home Base
                  {stops.map((s, i) => <span key={i}> → {s.label}</span>)}
                  {selectedDumpsite && <> → 🏭 {selectedDumpsite.name}</>}
                  {' → 🏛️ Return'}
                </div>

                {saved && (
                  <div style={{ marginTop: 14, background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#2ecc71', textAlign: 'center' }}>
                    ✅ Route saved successfully!
                  </div>
                )}
              </div>
            )}

            {/* Nav buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              {step > 0 && (
                <button className="rb-btn btn btn-outline" style={{ flex: 1 }} onClick={() => { setStep(s => s - 1); setSaved(false) }}>
                  ← Back
                </button>
              )}
              {step < 4 ? (
                <button
                  className="rb-btn btn btn-primary"
                  style={{ flex: 1, opacity: canNext() ? 1 : 0.4 }}
                  disabled={!canNext()}
                  onClick={() => setStep(s => s + 1)}
                >
                  Next →
                </button>
              ) : (
                <button
                  className="rb-btn btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleSave}
                  disabled={saved}
                >
                  {saved ? '✅ Saved' : '💾 Save Route'}
                </button>
              )}
            </div>

          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
