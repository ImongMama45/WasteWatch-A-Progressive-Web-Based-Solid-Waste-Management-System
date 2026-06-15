import React, { useState } from 'react'
import { ICONS } from '../api/navConfig'
import { normalizeStopStatus, STOP_STATUS_LABELS } from '../utils/pickupStatusSync'

const STATUS_COLORS = {
  active: '#22c55e',
  weak_signal: '#f59e0b',
  offline: '#64748b',
}

export default function ZonePanel({ zone, barangayData, schedules = [], onClearFocus }) {
  const [activeModal, setActiveModal] = useState(null)

  const meta = {
    residential: { label: "Residential", icon: <div style={{ width: 24, height: 24 }}>{ICONS.barangay}</div> },
    commercial: { label: "Commercial", icon: <div style={{ width: 24, height: 24 }}>{ICONS.dashboard}</div> },
    industrial: { label: "Industrial", icon: <div style={{ width: 24, height: 24 }}>{ICONS.waste}</div> },
    agricultural: { label: "Agricultural", icon: <div style={{ width: 24, height: 24 }}>{ICONS.hotspot}</div> },
  }
  const m = meta[zone.type] || {}
  const { trucks = [], stops = [], loading = false } = barangayData || {}

  const currentStops = stops.filter(s => s.is_current)
  const collectingCount = stops.filter(s => normalizeStopStatus(s.current_status || s.status) === 'COLLECTION_REPORTED').length
  const readyCount = stops.filter(s => normalizeStopStatus(s.current_status || s.status) === 'READY_FOR_COLLECTION').length

  const brgy = zone.djangoBrgy || {}
  const establishments = brgy.establishments || []
  const population = brgy.population || 0
  const usersCount = brgy.users_count || 0
  const officials = brgy.brgy_officials || []

  const renderScheduleModal = () => {
    // Filter schedules that match this barangay
    const brgySchedules = schedules.filter(s => {
      const zoneId = zone.id ? String(zone.id) : null
      if (zoneId && s.barangays && s.barangays.some(bId => String(bId) === zoneId)) return true
      if (s.barangay_names && s.barangay_names.toLowerCase().includes(zone.name.toLowerCase())) return true
      return false
    })

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setActiveModal(null)} />
        <div style={{ position: 'relative', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, width: '100%', maxWidth: 400, maxHeight: '80vh', overflowY: 'auto', padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: 'white', margin: 0, fontSize: 18 }}>Collection Schedules</h3>
            <button onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>
          {brgySchedules.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '20px 0', fontSize: 14 }}>No schedules found for this barangay.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {brgySchedules.map(sched => (
                <div key={sched.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <strong style={{ color: '#14b8a6', fontSize: 15 }}>{sched.days || 'Regular'}</strong>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>{sched.start_time ? sched.start_time.slice(0, 5) : 'N/A'} - {sched.end_time ? sched.end_time.slice(0, 5) : 'N/A'}</span>
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 4 }}>
                    🚛 {sched.truck_plate || 'Unassigned'} ({sched.driver_name || 'No driver'})
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>
                    Stops: {sched.waypoints?.length || 0}
                  </div>
                  {sched.waypoints && sched.waypoints.length > 0 && (
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ color: '#3b82f6', fontSize: 12, cursor: 'pointer', outline: 'none' }}>View Stops</summary>
                      <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {sched.waypoints.map((wp, i) => (
                          <div key={i} style={{ color: '#94a3b8', fontSize: 11 }}>
                            <span style={{ color: '#cbd5e1' }}>{i + 1}.</span> {wp.label || wp.address || 'Unknown Stop'}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderAnalyticsModal = () => {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setActiveModal(null)} />
        <div style={{ position: 'relative', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, width: '100%', maxWidth: 400, padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: 'white', margin: 0, fontSize: 18 }}>Waste Analytics</h3>
            <button onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>
          
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: '.04em' }}>WASTE COLLECTED (MOCK DATA)</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ color: '#2dd4bf', fontSize: 20, fontWeight: 800 }}>3,240 <span style={{ fontSize: 12 }}>kg</span></div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>This Week</div>
              </div>
              <div style={{ flex: 1, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ color: '#60a5fa', fontSize: 20, fontWeight: 800 }}>14,500 <span style={{ fontSize: 12 }}>kg</span></div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>This Month</div>
              </div>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14 }}>
            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 12, letterSpacing: '.04em' }}>COLLECTION PATTERNS (MOCK DATA)</div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 8 }}>
              <span style={{ color: '#cbd5e1' }}>Most Frequent Day:</span>
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>Monday</span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#cbd5e1' }}>Most Frequent Time:</span>
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>06:30 AM</span>
            </div>
          </div>
          
          <div style={{ color: '#64748b', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
            * Note: This data is mocked and will be connected to the Dumpsite API later.
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {activeModal === 'schedule' && renderScheduleModal()}
      {activeModal === 'analytics' && renderAnalyticsModal()}

      {/* Zone header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ color: zone.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{m.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "white", fontWeight: 800, fontSize: 17 }}>{zone.name}</div>
          <div style={{ color: zone.color, fontSize: 12, fontWeight: 600 }}>{m.label} Zone</div>
        </div>
      </div>

      {/* Barangay Info Section */}
      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 14, marginBottom: 16, border: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 10, letterSpacing: '.04em' }}>BARANGAY DETAILS</div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: '#cbd5e1' }}>Population:</span>
          <span style={{ color: 'white', fontWeight: 600 }}>{population.toLocaleString()}</span>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: '#cbd5e1' }}>Registered Users:</span>
          <span style={{ color: 'white', fontWeight: 600 }}>{usersCount}</span>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: '#cbd5e1' }}>Assigned Official(s):</span>
          <span style={{ color: 'white', fontWeight: 600, textAlign: 'right' }}>
            {officials.length > 0 ? officials.join(', ') : <span style={{ color: '#64748b' }}>None</span>}
          </span>
        </div>

        {establishments.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>ESTABLISHMENTS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {establishments.map(est => (
                <div key={est.id} style={{
                  background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.2)',
                  borderRadius: 6, padding: '4px 8px', fontSize: 11, color: '#2dd4bf', fontWeight: 600
                }}>
                  {est.name}: {est.count}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b', fontSize: 13 }}>
          <div style={{ fontSize: 20, marginBottom: 8 }}>🔄</div>
          Loading trucks &amp; stops…
        </div>
      ) : trucks.length === 0 ? (
        <div style={{
          padding: '14px 16px', background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, color: '#64748b', fontSize: 13, marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 20, height: 20 }}>{ICONS.truck}</div>
          No active trucks assigned to this barangay right now.
        </div>
      ) : (
        <>
          {/* Active trucks list */}
          <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, marginBottom: 8, letterSpacing: '.04em' }}>
            ACTIVE TRUCKS ({trucks.length})
          </div>
          {trucks.map(truck => {
            const tColor = STATUS_COLORS[truck.status] || '#64748b'
            const tLabel = truck.status === 'active' ? 'LIVE'
              : truck.status === 'weak_signal' ? 'WEAK' : 'OFFLINE'
            return (
              <div key={truck.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: tColor, boxShadow: `0 0 6px ${tColor}`, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{truck.truckId}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{truck.driver}</div>
                </div>
                <div style={{ fontSize: 9, fontWeight: 800, color: tColor, background: `${tColor}18`, border: `1px solid ${tColor}44`, borderRadius: 20, padding: '2px 8px', letterSpacing: '.05em' }}>
                  {tLabel}
                </div>
              </div>
            )
          })}

          {currentStops.length > 0 && (
            <>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, margin: '16px 0 8px', letterSpacing: '.04em' }}>
                CURRENT STOP IN THIS BARANGAY
              </div>
              {currentStops.map(stop => (
                <div key={`${stop.schedule_id}-${stop.stop_order}`} style={{
                  padding: '10px 12px', marginBottom: 8, borderRadius: 10,
                  background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
                }}>
                  <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>{stop.label}</div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                    {STOP_STATUS_LABELS[normalizeStopStatus(stop.current_status || stop.status)] || 'Active stop'}
                    {stop.driver_name ? ` · ${stop.driver_name}` : ''}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, textAlign: 'center', padding: 8, borderRadius: 8, background: 'rgba(245,158,11,0.12)' }}>
                  <div style={{ color: '#f59e0b', fontWeight: 800 }}>{readyCount}</div>
                  <div style={{ color: '#94a3b8', fontSize: 10 }}>Ready</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', padding: 8, borderRadius: 8, background: 'rgba(234,179,8,0.12)' }}>
                  <div style={{ color: '#eab308', fontWeight: 800 }}>{collectingCount}</div>
                  <div style={{ color: '#94a3b8', fontSize: 10 }}>Collecting</div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── NEW BUTTONS replacing "Show All Barangays" ── */}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          onClick={() => setActiveModal('schedule')}
          style={{ flex: 1, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", color: "#93c5fd", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer", transition: 'all 0.15s' }}>
          🗓️ Schedule
        </button>
        <button
          onClick={() => setActiveModal('analytics')}
          style={{ flex: 1, background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)", color: "#fcd34d", borderRadius: 10, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer", transition: 'all 0.15s' }}>
          📊 Analytics
        </button>
      </div>
      
      {/* Optional: Keeping a subtle text link to clear focus if the user still needs it without reaching for the top X */}
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <span onClick={onClearFocus} style={{ color: '#64748b', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>
          Return to city map
        </span>
      </div>
    </>
  )
}
