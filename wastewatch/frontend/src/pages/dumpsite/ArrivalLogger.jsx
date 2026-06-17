import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api/client'

// Ordered list for slider snapping
const LEVELS = ['nearly_empty', 'quarter', 'half', 'three_quarters', 'full', 'overflowing']
const LEVEL_LABELS = {
  nearly_empty:   'Nearly Empty',
  quarter:        'Quarter',
  half:           'Half',
  three_quarters: 'Three Quarters',
  full:           'Full',
  overflowing:    'Overflowing',
}
const LEVEL_PCT = { nearly_empty: 12, quarter: 35, half: 65, three_quarters: 80, full: 100, overflowing: 110 }

function getFillColor(pct) {
  if (pct > 100) return '#ef4444'
  if (pct > 75)  return '#a16207'
  if (pct > 60)  return '#f59e0b'
  return '#22c55e'
}

export default function ArrivalLogger() {
  const navigate      = useNavigate()
  const [params]      = useSearchParams()
  const { user }      = useAuth()

  const [siteId,    setSiteId]    = useState(null)
  const [trucks,    setTrucks]    = useState([])
  const [inbound,   setInbound]   = useState([])
  const [estimates, setEstimates] = useState({})   // truckId → { level → kg }
  const [barangays, setBarangays] = useState([])

  // Form state
  const [selectedTruck, setSelectedTruck] = useState(params.get('truck_id') || '')
  const [selectedBarangays, setSelectedBarangays] = useState([])
  const [barangaySearch, setBarangaySearch] = useState('')
  const [barangayDropOpen, setBarangayDropOpen] = useState(false)
  const [fillLevel,   setFillLevel]   = useState('half')
  const [sliderPct,   setSliderPct]   = useState(65)
  const [estimatedKg, setEstimatedKg] = useState(0)
  const [customKg,    setCustomKg]    = useState(false)
  const [remarks,     setRemarks]     = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [toast,       setToast]       = useState(null)

  // Derived truck info
  const truckInfo = trucks.find(t => String(t.id) === String(selectedTruck))

  // Load site ID
  useEffect(() => {
    api.get('/api/dumpsite/dumpsites/').then(res => {
      if (res.data.length > 0) setSiteId(res.data[0].id)
    })
  }, [])

  // Load trucks + inbound queue
  useEffect(() => {
    api.get('/api/driver/trucks/').then(res => setTrucks(res.data))
    api.get('/api/accounts/barangays/').then(res => setBarangays(res.data))
  }, [])

  useEffect(() => {
    if (!siteId) return
    api.get(`/api/dumpsite/dumpsites/${siteId}/inbound_queue/`).then(res => setInbound(res.data))
  }, [siteId])

  // When truck changes, load fill estimates and auto-fill
  useEffect(() => {
    if (!selectedTruck) return
    const inb = inbound.find(i => String(i.truck_id) === String(selectedTruck))
    if (inb && inb.barangay_ids) {
      setSelectedBarangays(inb.barangay_ids)
    } else {
      setSelectedBarangays([])
    }

    api.get(`/api/driver/trucks/${selectedTruck}/`)
      .then(res => {
        const ests = {}
        ;(res.data.fill_estimates || []).forEach(e => { ests[e.fill_level] = parseFloat(e.estimated_kg) })
        setEstimates(ests)
        setFillLevel('full')
        setSliderPct(100)
        setCustomKg(false)
        setEstimatedKg(ests['full'] || res.data.max_capacity_kg || 1000)
      })
  }, [selectedTruck, inbound])

  // When fill level changes, update kg from presets (unless custom)
  useEffect(() => {
    if (customKg) return
    const kg = estimates[fillLevel] ?? 0
    setEstimatedKg(kg)
    setSliderPct(LEVEL_PCT[fillLevel] ?? 65)
  }, [fillLevel, estimates, customKg])

  const snapToLevel = useCallback((pct) => {
    let closest = 'half'
    let minDist = Infinity
    LEVELS.forEach(l => {
      const d = Math.abs(LEVEL_PCT[l] - pct)
      if (d < minDist) { minDist = d; closest = l }
    })
    return closest
  }, [])

  const handleSlider = (e) => {
    const pct = Number(e.target.value)
    setSliderPct(pct)
    const snapped = snapToLevel(pct)
    setFillLevel(snapped)
    if (!customKg) setEstimatedKg(estimates[snapped] ?? 0)
  }

  const handleKgChange = (e) => {
    setEstimatedKg(Number(e.target.value))
    setCustomKg(true)
  }

  const resetCustomKg = () => {
    setCustomKg(false)
    setEstimatedKg(estimates[fillLevel] ?? 0)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selectedTruck) { setToast({ type: 'error', msg: 'Select a truck first.' }); return }
    if (!estimatedKg)   { setToast({ type: 'error', msg: 'Estimated KG cannot be 0.' }); return }

    setSubmitting(true)
    const inboundTruck = inbound.find(i => String(i.truck_id) === String(selectedTruck))
    
    // Safety check: ensure truck is actually waiting for calibration
    if (inboundTruck && inboundTruck.op_status !== 'at_dumpsite') {
      setToast({ type: 'error', msg: 'Cannot log: Driver must click "Confirm on Arrival" on their app first.' })
      setSubmitting(false)
      return
    }

    try {
      await api.post(`/api/dumpsite/dumpsites/${siteId}/log_arrival/`, {
        truck:          selectedTruck,
        driver:         inboundTruck?.driver_id || null,
        schedule:       inboundTruck?.schedule_id || null,
        fill_level:     fillLevel,
        estimated_kg:   estimatedKg,
        gross_weight:   estimatedKg,
        barangays:      selectedBarangays,
        remarks,
      })
      setToast({ type: 'success', msg: 'Arrival logged successfully!' })
      setTimeout(() => navigate('/dumpsite/logs'), 1500)
    } catch (err) {
      const detail = err.response?.data
      const msg = typeof detail === 'object'
        ? Object.entries(detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : v}`).join(' | ')
        : 'Failed to log arrival.'
      setToast({ type: 'error', msg })
    } finally {
      setSubmitting(false)
    }
  }

  const fillColor = getFillColor(sliderPct)

  return (
    <div style={{ padding: '1.5rem', maxWidth: 720, margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: toast.type === 'success' ? '#22c55e' : '#ef4444',
          color: '#fff', padding: '0.9rem 1.5rem', borderRadius: 14, fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)', maxWidth: 360,
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ marginBottom: '2rem' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          ← Back
        </button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--surface-3)' }}>
          Log Truck Arrival
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Record an incoming truck delivery using the fill level slider.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Truck selection */}
        <div className="card-light" style={{ padding: '1.25rem', borderRadius: 20 }}>
          <label style={labelStyle}>Arriving Truck</label>

          {/* Inbound quick-select */}
          {inbound.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                📡 Inbound Queue
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {inbound.map(i => (
                  <button key={i.shift_id} type="button"
                    onClick={() => { setSelectedTruck(String(i.truck_id)); setSelectedBarangays(i.barangay_ids || []) }}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: String(selectedTruck) === String(i.truck_id)
                        ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: String(selectedTruck) === String(i.truck_id)
                        ? 'rgba(46,204,113,0.12)' : 'var(--surface-1)',
                      color: String(selectedTruck) === String(i.truck_id) ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    🚛 {i.truck_plate} <span style={{ opacity: 0.7 }}>· {i.driver}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <select value={selectedTruck} onChange={e => setSelectedTruck(e.target.value)} style={inputStyle} required>
            <option value="">— Select Truck —</option>
            {trucks.map(t => (
              <option key={t.id} value={t.id}>{t.plate_number} · {t.model}</option>
            ))}
          </select>

          {truckInfo && (
            <div style={{ marginTop: 10, padding: '0.75rem', background: 'var(--surface-1)', borderRadius: 12, fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: '1.5rem' }}>
              <span>Model: <strong style={{ color: 'var(--surface-3)' }}>{truckInfo.model}</strong></span>
              <span>Max Capacity: <strong style={{ color: 'var(--surface-3)' }}>{Number(truckInfo.max_capacity_kg).toLocaleString()} kg</strong></span>
            </div>
          )}
        </div>

        {/* Fill Level Slider */}
        <div className="card-light" style={{ padding: '1.5rem', borderRadius: 20 }}>
          <label style={labelStyle}>Fill Level Estimate</label>

          {/* Preset chips */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {LEVELS.map(l => (
              <button key={l} type="button"
                onClick={() => { setFillLevel(l); setSliderPct(LEVEL_PCT[l]); setCustomKg(false) }}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: fillLevel === l ? `2px solid ${fillColor}` : '1px solid var(--border)',
                  background: fillLevel === l ? `${fillColor}22` : 'var(--surface-1)',
                  color: fillLevel === l ? fillColor : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                {LEVEL_LABELS[l]}
              </button>
            ))}
          </div>

          {/* Slider */}
          <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
            <input
              type="range" min={0} max={120} step={1}
              value={sliderPct} onChange={handleSlider}
              style={{ width: '100%', accentColor: fillColor, cursor: 'pointer', height: 8 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginTop: 4 }}>
              <span>Empty</span><span>Half</span><span>Full</span><span style={{ color: '#ef4444' }}>+Overflow</span>
            </div>
          </div>

          {/* Fill Level readout */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '1rem',
            padding: '1rem', borderRadius: 14,
            background: `${fillColor}10`, border: `1.5px solid ${fillColor}44`,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 2 }}>FILL LEVEL</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 900, color: fillColor }}>{LEVEL_LABELS[fillLevel]} · {sliderPct}%</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>EST. WEIGHT</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number" min={0} step={10}
                  value={estimatedKg}
                  onChange={handleKgChange}
                  style={{
                    width: 100, padding: '4px 8px', borderRadius: 8,
                    border: `1.5px solid ${customKg ? '#f59e0b' : fillColor}`,
                    background: 'var(--surface-1)', color: 'var(--surface-3)',
                    fontWeight: 800, fontSize: '1rem', textAlign: 'right',
                  }}
                />
                <span style={{ fontWeight: 700, color: 'var(--text-muted)' }}>kg</span>
              </div>
              {customKg && (
                <button type="button" onClick={resetCustomKg}
                  style={{ fontSize: 10, color: '#f59e0b', background: 'none', border: 'none', cursor: 'pointer', marginTop: 3 }}>
                  ↩ Reset to preset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Barangay + Remarks */}
        <div className="card-light" style={{ padding: '1.25rem', borderRadius: 20, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Barangays Collected From</label>
            <div onClick={() => setBarangayDropOpen(v => !v)} style={{ ...inputStyle, padding: '5px 9px', minHeight: 40, cursor: 'text', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', position: 'relative' }}>
              {barangays.filter(b => selectedBarangays.includes(b.id)).map(b => (
                <span key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {b.name}
                  <span onClick={e => { e.stopPropagation(); setSelectedBarangays(p => p.filter(x => x !== b.id)) }} style={{ cursor: 'pointer', color: '#e74c3c', fontSize: 14, lineHeight: 1 }}>×</span>
                </span>
              ))}
              <input value={barangaySearch} onChange={e => { setBarangaySearch(e.target.value); setBarangayDropOpen(true) }} onFocus={() => setBarangayDropOpen(true)} onClick={e => e.stopPropagation()} placeholder={selectedBarangays.length === 0 ? 'Search barangays...' : ''} style={{ flex: 1, minWidth: 90, background: 'none', border: 'none', outline: 'none', color: 'var(--surface-3)', fontSize: 12, padding: '2px 4px' }} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>▼</span>
              {barangayDropOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 10, marginTop: 4, maxHeight: 200, overflowY: 'auto', zIndex: 100, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                  {barangays.filter(b => b.name.toLowerCase().includes(barangaySearch.toLowerCase())).map(b => {
                    const on = selectedBarangays.includes(b.id)
                    return (
                      <div key={b.id} onClick={() => { setSelectedBarangays(p => on ? p.filter(x => x !== b.id) : [...p, b.id]); setBarangaySearch('') }} style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', background: on ? 'rgba(46,204,113,0.05)' : 'transparent' }}>
                        <div style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {on && <span style={{ color: '#0d1117', fontSize: 9, fontWeight: 900 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: 13, color: on ? 'var(--surface-3)' : 'var(--text-muted)' }}>{b.name}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Remarks (optional)</label>
            <textarea
              value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="Any notes about this delivery..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Submit */}
        <button type="submit" disabled={submitting} style={{
          background: submitting ? 'rgba(46,204,113,0.5)' : 'var(--accent)',
          color: '#0d1117', border: 'none', borderRadius: 18,
          padding: '1rem', fontWeight: 800, fontSize: '1rem',
          cursor: submitting ? 'not-allowed' : 'pointer',
          boxShadow: submitting ? 'none' : '0 8px 24px rgba(46,204,113,0.35)',
          transition: 'all 0.15s',
        }}>
          {submitting ? '⏳ Logging...' : '✅ Confirm Arrival'}
        </button>
      </form>
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
}

const inputStyle = {
  width: '100%', padding: '0.65rem 0.9rem', borderRadius: 12,
  border: '1.5px solid var(--border)', background: 'var(--surface-1)',
  color: 'var(--surface-3)', fontSize: '0.9rem', fontWeight: 500,
  boxSizing: 'border-box',
}
