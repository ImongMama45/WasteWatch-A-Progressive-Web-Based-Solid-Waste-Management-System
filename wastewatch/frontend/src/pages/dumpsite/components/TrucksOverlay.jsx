import { useState, useEffect } from 'react'
import { X, Truck, Check, AlertTriangle } from 'lucide-react'
import { getFacilityTrucks, getFacilitySchedules, unwrapList } from '../../../api/dumpsiteApi'
import { SidebarWidgetSkeleton } from '../../../components/ui/Skeleton'
import {
  ConditionBadge,
  HoldBadge,
  MaintenanceBadge,
  RetirementBadge,
  InspectionBadge,
} from './TruckStatusPills'

const formatDaysInitials = (daysStr) => {
  if (!daysStr) return ''
  const map = { Monday: 'M', Tuesday: 'T', Wednesday: 'W', Thursday: 'Th', Friday: 'F', Saturday: 'S', Sunday: 'Su' }
  return daysStr.split(',').map((d) => map[d.trim()] || d.trim().substring(0, 2)).join(', ')
}

export default function TrucksOverlay({ open, onClose, siteId }) {
  const [trucks, setTrucks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (open && siteId) {
      setLoading(true)
      Promise.all([
        getFacilityTrucks({ paginate: false }),
        getFacilitySchedules({ paginate: false }),
      ])
        .then(([trucksRaw, schedRaw]) => {
          const allTrucks = unwrapList(trucksRaw)
          const schedules = unwrapList(schedRaw)

          const assignedTruckIds = new Set(
            schedules
              .filter((s) => String(s.dumpsite) === String(siteId))
              .map((s) => s.truck)
              .filter(Boolean)
          )

          const assignedTrucks = allTrucks.filter(
            (t) => assignedTruckIds.has(t.id) || String(t.last_inspected_dumpsite) === String(siteId)
          )
          setTrucks(assignedTrucks.length > 0 ? assignedTrucks : allTrucks)
          setLoading(false)
        })
        .catch((err) => {
          console.error(err)
          setLoading(false)
        })
    } else if (open && !siteId) {
      setLoading(false)
    }
  }, [open, siteId])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e4e6eb',
          borderRadius: 12,
          width: '100%',
          maxWidth: 560,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #e4e6eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#1c1e21' }}>Facility Assigned Trucks</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#65676b' }}>Trucks scoped to this dumpsite facility</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f0f2f5',
              border: '1px solid #e4e6eb',
              borderRadius: 6,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#65676b',
            }}
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>

        <div style={{ padding: '16px 22px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', background: '#f8fafc' }}>
          {loading ? (
            <SidebarWidgetSkeleton rows={4} />
          ) : trucks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#65676b', background: '#ffffff', borderRadius: 8, border: '1px dashed #ced0d4' }}>
              No trucks found for this facility.
            </div>
          ) : (
            trucks.map((t) => (
              <div
                key={t.id}
                style={{
                  padding: '16px',
                  background: '#ffffff',
                  border: '1px solid #e4e6eb',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      flexShrink: 0,
                      background: '#eff6ff',
                      color: '#2563eb',
                      border: '1px solid #bfdbfe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Truck size={22} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#1c1e21' }}>{t.plate_number}</div>
                    <div style={{ fontSize: 12, color: '#65676b', marginTop: 2 }}>
                      {t.model} {t.zone ? `· ${t.zone}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {t.status === 'active' ? (
                      <span style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Check size={11} strokeWidth={3} /> ACTIVE
                      </span>
                    ) : (
                      <span style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={11} strokeWidth={2.5} /> {(t.status || 'INACTIVE').toUpperCase()}
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#65676b' }}>
                      {Number(t.max_capacity_kg || 0).toLocaleString()} kg
                    </span>
                  </div>
                </div>

                {/* Condition / Hold / Maintenance / Retirement distinction */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <ConditionBadge condition={t.mechanical_condition} />
                  <InspectionBadge state={t.inspection_state} />
                  <HoldBadge isHeld={t.is_operational_hold} />
                  <MaintenanceBadge status={t.maintenance_status} />
                  <RetirementBadge isRetired={t.is_retired} retirementState={t.retirement_state} />
                </div>

                <div style={{ borderTop: '1px solid #e4e6eb', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {t.driver_details && t.driver_details.length > 0 ? (
                    t.driver_details.map((d) => (
                      <div key={d.id} style={{ background: '#f8fafc', border: '1px solid #e4e6eb', borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              background: '#16a34a',
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: 11,
                            }}
                          >
                            {d.full_name?.[0] || 'D'}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#1c1e21' }}>{d.full_name}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#65676b' }}>
                          <strong style={{ color: '#1c1e21' }}>Schedule:</strong>
                          {Array.isArray(d.schedule_description) && d.schedule_description.length > 0 ? (
                            <ul style={{ listStyleType: 'disc', paddingLeft: 18, margin: '4px 0 0 0', color: '#4b5563' }}>
                              {d.schedule_description.map((desc, i) => {
                                const parts = desc.split(' | ')
                                const displayDesc = parts.length === 2 ? `${formatDaysInitials(parts[0])} | ${parts[1]}` : desc
                                return <li key={i}>{displayDesc}</li>
                              })}
                            </ul>
                          ) : (
                            <span style={{ marginLeft: 4 }}>No active schedule</span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: '#b91c1c' }}>No drivers assigned</div>
                  )}

                  {t.crew_names && t.crew_names.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#65676b', letterSpacing: '.06em', marginBottom: 6 }}>
                        CREW MEMBERS ({t.crew_names.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {t.crew_names.map((c) => (
                          <span
                            key={c}
                            style={{
                              background: '#f0f2f5',
                              border: '1px solid #e4e6eb',
                              borderRadius: 4,
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#1c1e21',
                            }}
                          >
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
    </div>
  )
}
