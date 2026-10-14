import { useState, useEffect } from 'react'
import api from '../../../api/client'

const Ico = ({ d, size = 14, color = 'currentColor', sw = 1.75, style = {}, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}
    strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0, display: 'block', ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
)

const IcoX = p => <Ico {...p} d="M18 6L6 18M6 6l12 12" />
const IcoTruck = p => <Ico {...p} d={["M1 3h15v13H1z", "M16 8h4l3 3v5h-7V8z", "M5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"]} />
const IcoCheck = p => <Ico {...p} d="M20 6L9 17l-5-5" />
const IcoWarning = p => <Ico {...p} d={["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"]} />

const formatDaysInitials = (daysStr) => {
  if (!daysStr) return ''
  const map = { 'Monday': 'M', 'Tuesday': 'T', 'Wednesday': 'W', 'Thursday': 'Th', 'Friday': 'F', 'Saturday': 'S', 'Sunday': 'Su' }
  return daysStr.split(',').map(d => map[d.trim()] || d.trim().substring(0, 2)).join(', ')
}

export default function TrucksOverlay({ open, onClose, siteId }) {
  const [trucks, setTrucks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (open && siteId) {
      setLoading(true)
      Promise.all([
        api.get('/api/driver/trucks/'),
        api.get('/api/driver/collection-schedules/')
      ])
        .then(([trucksRes, schedRes]) => {
          const allTrucks = trucksRes.data
          const schedules = schedRes.data
          
          // Get unique truck IDs from schedules assigned to this dumpsite
          const assignedTruckIds = new Set(
            schedules
              .filter(s => String(s.dumpsite) === String(siteId))
              .map(s => s.truck)
              .filter(Boolean)
          )
          
          // Filter trucks that are assigned to this dumpsite
          const assignedTrucks = allTrucks.filter(t => assignedTruckIds.has(t.id))
          setTrucks(assignedTrucks)
          setLoading(false)
        })
        .catch(err => {
          console.error(err)
          setLoading(false)
        })
    }
  }, [open, siteId])

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px'
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 24, width: '100%', maxWidth: 500,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        animation: 'slideUp 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.1)'
      }} onClick={e => e.stopPropagation()}>
        
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--surface-3)' }}>Assigned Trucks</h2>
            <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>All trucks operating in the area</p>
          </div>
          <button onClick={onClose} style={{
            background: 'var(--surface-1)', border: 'none', borderRadius: '50%', width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)'
          }}>
            <IcoX size={16} sw={2.5} />
          </button>
        </div>

        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading trucks...</div>
          ) : trucks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No trucks found.</div>
          ) : (
            trucks.map(t => (
              <div key={t.id} style={{
                padding: '16px', background: 'var(--surface-1)', border: '1px solid var(--border)',
                borderRadius: 16, display: 'flex', flexDirection: 'column', gap: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                    background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <IcoTruck size={24} sw={1.5} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--surface-3)' }}>{t.plate_number}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 2 }}>{t.model} {t.zone ? `· ${t.zone}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    {t.status === 'active' ? (
                      <span style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <IcoCheck size={12} sw={3} /> ACTIVE
                      </span>
                    ) : (
                      <span style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <IcoWarning size={12} sw={2.5} /> INACTIVE
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                      {Number(t.max_capacity_kg).toLocaleString()} kg
                    </span>
                  </div>
                </div>

                {/* Driver & Crew Details */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {t.driver_details && t.driver_details.length > 0 ? (
                    t.driver_details.map(d => (
                      <div key={d.id} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: '#0d1117',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11,
                          }}>{d.full_name[0]}</div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--surface-3)' }}>{d.full_name}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          <div style={{ marginBottom: 4 }}>
                            <strong style={{ color: 'var(--text)' }}>Schedule:</strong>
                            {Array.isArray(d.schedule_description) && d.schedule_description.length > 0 ? (
                              <ul style={{ listStyleType: 'disc', paddingLeft: 20, margin: '4px 0 0 0', color: 'var(--text)' }}>
                                {d.schedule_description.map((desc, i) => {
                                  let displayDesc = desc;
                                  const parts = desc.split(' | ');
                                  if (parts.length === 2) {
                                    displayDesc = `${formatDaysInitials(parts[0])} | ${parts[1]}`;
                                  }
                                  return <li key={i}>{displayDesc}</li>
                                })}
                              </ul>
                            ) : (
                              <span style={{ marginLeft: 4 }}>No active schedule</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: '#e74c3c' }}>No drivers assigned</div>
                  )}

                  {/* Crew Details */}
                  {t.crew_names && t.crew_names.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', marginBottom: 6 }}>
                        CREW MEMBERS ({t.crew_names.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {t.crew_names.map(c => (
                          <span key={c} style={{
                            background: 'var(--surface)', border: '1px solid var(--border)',
                            borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--text)'
                          }}>
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
