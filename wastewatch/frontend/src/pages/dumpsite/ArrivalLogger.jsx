import { useState, useEffect, useCallback } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Hourglass,
  Radio,
  RotateCcw,
  ShieldAlert,
  Truck,
  X,
} from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import {
  getDumpsites,
  getDumpsiteInboundQueue,
  getFacilityTrucks,
  logDumpsiteArrival,
  unwrapList,
} from '../../api/dumpsiteApi'
import { DetailModalSkeleton } from '../../components/ui/Skeleton'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

const LEVELS = ['nearly_empty', 'quarter', 'half', 'three_quarters', 'full', 'overflowing']
const LEVEL_LABELS = {
  nearly_empty: 'Nearly Empty',
  quarter: 'Quarter',
  half: 'Half',
  three_quarters: 'Three Quarters',
  full: 'Full',
  overflowing: 'Overflowing',
}
const LEVEL_PCT = { nearly_empty: 12, quarter: 35, half: 65, three_quarters: 80, full: 100, overflowing: 110 }

function getFillColor(pct) {
  if (pct > 100) return '#dc2626'
  if (pct > 75) return '#b45309'
  if (pct > 60) return '#d97706'
  return '#16a34a'
}

export default function ArrivalLogger({ open, onClose, defaultTruckId, siteId: propSiteId = null }) {
  const { user } = useAuth()
  const isOperator = Boolean(user?.role === 'dumpsite' && !user?.is_staff)

  const [siteId, setSiteId] = useState(propSiteId)
  const [trucks, setTrucks] = useState([])
  const [inbound, setInbound] = useState([])
  const [estimates, setEstimates] = useState({})
  const [barangays, setBarangays] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)

  const [selectedTruck, setSelectedTruck] = useState(defaultTruckId || '')
  const [selectedBarangays, setSelectedBarangays] = useState([])
  const [barangaySearch, setBarangaySearch] = useState('')
  const [barangayDropOpen, setBarangayDropOpen] = useState(false)
  const [fillLevel, setFillLevel] = useState('half')
  const [sliderPct, setSliderPct] = useState(65)
  const [estimatedKg, setEstimatedKg] = useState(0)
  const [customKg, setCustomKg] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (propSiteId) setSiteId(propSiteId)
  }, [propSiteId])

  useEffect(() => {
    if (defaultTruckId) setSelectedTruck(String(defaultTruckId))
  }, [defaultTruckId])

  const truckInfo = trucks.find((t) => String(t.id) === String(selectedTruck))

  useEffect(() => {
    if (!open) return
    setInitialLoading(true)
    Promise.allSettled([
      propSiteId ? Promise.resolve(null) : getDumpsites({ paginate: false }),
      getFacilityTrucks({ paginate: false }),
      api.get('/api/accounts/barangays/').then((res) => res.data),
    ])
      .then(([siteRes, trucksRes, brgyRes]) => {
        if (!propSiteId && siteRes.status === 'fulfilled' && siteRes.value) {
          const siteList = unwrapList(siteRes.value)
          if (siteList.length > 0) setSiteId(siteList[0].id)
        }
        if (trucksRes.status === 'fulfilled') {
          setTrucks(unwrapList(trucksRes.value))
        }
        if (brgyRes.status === 'fulfilled') {
          setBarangays(unwrapList(brgyRes.value))
        }
      })
      .finally(() => {
        setInitialLoading(false)
      })
  }, [open, propSiteId])

  useEffect(() => {
    if (!open || !siteId) return
    getDumpsiteInboundQueue(siteId)
      .then((raw) => setInbound(unwrapList(raw)))
      .catch(() => {})
  }, [open, siteId])

  useEffect(() => {
    if (!selectedTruck) return
    const inb = inbound.find((i) => String(i.truck_id) === String(selectedTruck))
    if (inb && inb.barangay_ids) {
      setSelectedBarangays(inb.barangay_ids)
    } else {
      setSelectedBarangays([])
    }

    api
      .get(`/api/driver/trucks/${selectedTruck}/`)
      .then((res) => {
        const ests = {}
        ;(res.data.fill_estimates || []).forEach((e) => {
          ests[e.fill_level] = parseFloat(e.estimated_kg)
        })
        setEstimates(ests)
        setFillLevel('full')
        setSliderPct(100)
        setCustomKg(false)
        setEstimatedKg(ests.full || res.data.max_capacity_kg || 1000)
      })
      .catch(() => {})
  }, [selectedTruck, inbound])

  useEffect(() => {
    if (customKg) return
    const kg = estimates[fillLevel] ?? 0
    setEstimatedKg(kg)
    setSliderPct(LEVEL_PCT[fillLevel] ?? 65)
  }, [fillLevel, estimates, customKg])

  const snapToLevel = useCallback((pct) => {
    let closest = 'half'
    let minDist = Infinity
    LEVELS.forEach((l) => {
      const d = Math.abs(LEVEL_PCT[l] - pct)
      if (d < minDist) {
        minDist = d
        closest = l
      }
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
    if (!isOperator) {
      setToast({ type: 'error', msg: 'Only assigned Dumpsite Operators can log truck arrivals. Administrators have read-only access.' })
      return
    }
    if (!siteId) {
      setToast({ type: 'error', msg: 'No active dumpsite selected.' })
      return
    }
    if (!selectedTruck) {
      setToast({ type: 'error', msg: 'Select a truck first.' })
      return
    }
    if (!estimatedKg) {
      setToast({ type: 'error', msg: 'Estimated KG cannot be 0.' })
      return
    }

    setSubmitting(true)
    const inboundTruck = inbound.find((i) => String(i.truck_id) === String(selectedTruck))

    if (inboundTruck && inboundTruck.op_status !== 'at_dumpsite') {
      setToast({ type: 'error', msg: 'Cannot log: Driver must click "Confirm on Arrival" on their app first.' })
      setSubmitting(false)
      return
    }

    try {
      await logDumpsiteArrival(siteId, {
        truck: selectedTruck,
        driver: inboundTruck?.driver_id || null,
        schedule: inboundTruck?.schedule_id || null,
        fill_level: fillLevel,
        estimated_kg: estimatedKg,
        gross_weight: estimatedKg,
        barangays: selectedBarangays,
        remarks,
      })
      setToast({ type: 'success', msg: 'Arrival logged successfully.' })
      setTimeout(() => {
        if (onClose) onClose(true)
      }, 1200)
    } catch (err) {
      setToast({ type: 'error', msg: getApiErrorMessage(err, 'Failed to log arrival.') })
    } finally {
      setSubmitting(false)
    }
  }

  const fillColor = getFillColor(sliderPct)

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.48)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={() => onClose && onClose()}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e4e6eb',
          borderRadius: 12,
          width: '100%',
          maxWidth: 720,
          maxHeight: '90vh',
          overflowY: 'auto',
          position: 'relative',
          boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '1.5rem' }}>
          {toast && (
            <div
              style={{
                position: 'fixed',
                top: 20,
                right: 20,
                zIndex: 9999,
                background: toast.type === 'success' ? '#16a34a' : '#dc2626',
                color: '#ffffff',
                padding: '0.85rem 1.25rem',
                borderRadius: 8,
                fontWeight: 600,
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                maxWidth: 360,
                fontSize: 13,
              }}
            >
              {toast.msg}
            </div>
          )}

          <div style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e4e6eb', paddingBottom: 12 }}>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: '#1c1e21', margin: 0 }}>
                Log Truck Arrival
              </h1>
              <p style={{ color: '#65676b', fontSize: 13, margin: '4px 0 0' }}>
                Record an incoming truck delivery using the fill level slider.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onClose && onClose()}
              style={{ background: '#f0f2f5', border: '1px solid #e4e6eb', borderRadius: 6, color: '#65676b', cursor: 'pointer', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>

          {initialLoading ? (
            <DetailModalSkeleton showBanner={false} style={{ padding: '0.5rem 0' }} />
          ) : (
            <>
              {!isOperator && (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 8,
                    padding: '12px 14px',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: '#92400e',
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  <ShieldAlert size={18} color="#d97706" style={{ flexShrink: 0 }} />
                  <span>
                    Arrival logging is strictly reserved for on-site Dumpsite Operators. Administrators have read-only oversight access.
                  </span>
                </div>
              )}
              <form className="ww-fade-in" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Truck selection */}
              <div style={{ padding: '1rem', borderRadius: 8, background: '#f8fafc', border: '1px solid #e4e6eb' }}>
                <label style={labelStyle}>Arriving Truck</label>

                {inbound.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: 11, color: '#65676b', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Radio size={13} color="#16a34a" /> Inbound Queue
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {inbound.map((i) => {
                        const active = String(selectedTruck) === String(i.truck_id)
                        return (
                          <button
                            key={i.shift_id}
                            type="button"
                            onClick={() => {
                              setSelectedTruck(String(i.truck_id))
                              setSelectedBarangays(i.barangay_ids || [])
                            }}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                              border: active ? '1.5px solid #16a34a' : '1px solid #ced0d4',
                              background: active ? '#e7f5eb' : '#ffffff',
                              color: active ? '#15803d' : '#1c1e21',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <Truck size={14} /> {i.truck_plate} <span style={{ opacity: 0.7 }}>· {i.driver}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <select value={selectedTruck} onChange={(e) => setSelectedTruck(e.target.value)} style={inputStyle} required>
                  <option value="">-- Select Truck --</option>
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.plate_number} · {t.model}
                    </option>
                  ))}
                </select>

                {truckInfo && (
                  <div style={{ marginTop: 10, padding: '0.65rem 0.85rem', background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 6, fontSize: 12, color: '#65676b', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <span>
                      Model: <strong style={{ color: '#1c1e21' }}>{truckInfo.model}</strong>
                    </span>
                    <span>
                      Max Capacity: <strong style={{ color: '#1c1e21' }}>{Number(truckInfo.max_capacity_kg || 0).toLocaleString()} kg</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Fill Level Slider */}
              <div style={{ padding: '1rem', borderRadius: 8, background: '#f8fafc', border: '1px solid #e4e6eb' }}>
                <label style={labelStyle}>Fill Level Estimate</label>

                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
                  {LEVELS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => {
                        setFillLevel(l)
                        setSliderPct(LEVEL_PCT[l])
                        setCustomKg(false)
                      }}
                      style={{
                        padding: '5px 11px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: fillLevel === l ? `1.5px solid ${fillColor}` : '1px solid #ced0d4',
                        background: fillLevel === l ? `${fillColor}18` : '#ffffff',
                        color: fillLevel === l ? fillColor : '#65676b',
                      }}
                    >
                      {LEVEL_LABELS[l]}
                    </button>
                  ))}
                </div>

                <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
                  <input
                    type="range"
                    min={0}
                    max={120}
                    step={1}
                    value={sliderPct}
                    onChange={handleSlider}
                    style={{ width: '100%', accentColor: fillColor, cursor: 'pointer', height: 8 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#65676b', fontWeight: 600, marginTop: 4 }}>
                    <span>Empty</span>
                    <span>Half</span>
                    <span>Full</span>
                    <span style={{ color: '#dc2626' }}>+Overflow</span>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '0.85rem 1rem',
                    borderRadius: 8,
                    background: '#ffffff',
                    border: `1.5px solid ${fillColor}55`,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#65676b', fontWeight: 700, marginBottom: 2 }}>FILL LEVEL</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: fillColor }}>
                      {LEVEL_LABELS[fillLevel]} · {sliderPct}%
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: '#65676b', fontWeight: 700, marginBottom: 4 }}>EST. WEIGHT</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        min={0}
                        step={10}
                        value={estimatedKg}
                        onChange={handleKgChange}
                        style={{
                          width: 110,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: `1.5px solid ${customKg ? '#d97706' : fillColor}`,
                          background: '#ffffff',
                          color: '#1c1e21',
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          textAlign: 'right',
                        }}
                      />
                      <span style={{ fontWeight: 700, color: '#65676b', fontSize: 13 }}>kg</span>
                    </div>
                    {customKg && (
                      <button
                        type="button"
                        onClick={resetCustomKg}
                        style={{
                          fontSize: 11,
                          color: '#b45309',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          marginTop: 4,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontWeight: 600,
                        }}
                      >
                        <RotateCcw size={11} /> Reset to preset
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Barangay + Remarks */}
              <div style={{ padding: '1rem', borderRadius: 8, background: '#f8fafc', border: '1px solid #e4e6eb', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div>
                  <label style={labelStyle}>Barangays Collected From</label>
                  <div
                    onClick={() => setBarangayDropOpen((v) => !v)}
                    style={{
                      ...inputStyle,
                      padding: '5px 9px',
                      minHeight: 40,
                      cursor: 'text',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 5,
                      alignItems: 'center',
                      position: 'relative',
                    }}
                  >
                    {barangays
                      .filter((b) => selectedBarangays.includes(b.id))
                      .map((b) => (
                        <span
                          key={b.id}
                          style={{
                            background: '#e7f5eb',
                            border: '1px solid #bbf7d0',
                            color: '#15803d',
                            borderRadius: 4,
                            padding: '2px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {b.name}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedBarangays((p) => p.filter((x) => x !== b.id))
                            }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 0, display: 'flex' }}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    <input
                      value={barangaySearch}
                      onChange={(e) => {
                        setBarangaySearch(e.target.value)
                        setBarangayDropOpen(true)
                      }}
                      onFocus={() => setBarangayDropOpen(true)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={selectedBarangays.length === 0 ? 'Search barangays...' : ''}
                      style={{ flex: 1, minWidth: 90, background: 'none', border: 'none', outline: 'none', color: '#1c1e21', fontSize: 12, padding: '2px 4px' }}
                    />
                    <ChevronDown size={14} color="#65676b" />
                    {barangayDropOpen && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          background: '#ffffff',
                          border: '1px solid #ced0d4',
                          borderRadius: 8,
                          marginTop: 4,
                          maxHeight: 200,
                          overflowY: 'auto',
                          zIndex: 100,
                          boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
                        }}
                      >
                        {barangays
                          .filter((b) => b.name.toLowerCase().includes(barangaySearch.toLowerCase()))
                          .map((b) => {
                            const on = selectedBarangays.includes(b.id)
                            return (
                              <div
                                key={b.id}
                                onClick={() => {
                                  setSelectedBarangays((p) => (on ? p.filter((x) => x !== b.id) : [...p, b.id]))
                                  setBarangaySearch('')
                                }}
                                style={{
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  borderBottom: '1px solid #f0f2f5',
                                  background: on ? '#f0fdf4' : 'transparent',
                                }}
                              >
                                <div
                                  style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: 4,
                                    border: `1.5px solid ${on ? '#16a34a' : '#ced0d4'}`,
                                    background: on ? '#16a34a' : '#ffffff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  {on && <Check size={11} strokeWidth={3} color="#ffffff" />}
                                </div>
                                <span style={{ fontSize: 13, color: on ? '#15803d' : '#1c1e21', fontWeight: on ? 600 : 400 }}>{b.name}</span>
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
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Any notes about this delivery..."
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !isOperator}
                style={{
                  background: !isOperator ? '#e4e6eb' : submitting ? '#86efac' : '#16a34a',
                  color: !isOperator ? '#8a8d91' : '#ffffff',
                  border: !isOperator ? '1px solid #ced0d4' : 'none',
                  borderRadius: 8,
                  padding: '0.85rem 1rem',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: (!isOperator || submitting) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {!isOperator ? (
                  <>
                    <ShieldAlert size={16} /> Operator Action Only
                  </>
                ) : submitting ? (
                  <>
                    <Hourglass size={16} /> Logging...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} /> Confirm Arrival
                  </>
                )}
              </button>
            </form>
          </>
        )}
        </div>
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 700,
  color: '#65676b',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
}

const inputStyle = {
  width: '100%',
  padding: '0.55rem 0.8rem',
  borderRadius: 6,
  border: '1px solid #ced0d4',
  background: '#ffffff',
  color: '#1c1e21',
  fontSize: 13,
  fontWeight: 500,
  boxSizing: 'border-box',
}
