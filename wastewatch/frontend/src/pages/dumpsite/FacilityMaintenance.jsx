import { useState, useEffect, useCallback } from 'react'
import {
  Wrench,
  Search,
  AlertCircle,
  Play,
  CheckCircle2,
  Edit3,
  Plus,
  Truck,
  X,
} from 'lucide-react'
import {
  getMaintenanceRecords,
  createMaintenanceRecord,
  updateMaintenanceRecord,
  startMaintenanceRecord,
  completeMaintenanceRecord,
  getFacilityTrucks,
  unwrapList,
  unwrapPaginated,
} from '../../api/dumpsiteApi'
import FacilityWorkspaceHeader from './components/FacilityWorkspaceHeader'
import { useFacilityScope } from './components/useFacilityScope'
import ConfirmActionDialog from './components/ConfirmActionDialog'
import {
  ConditionBadge,
  HoldBadge,
  MaintenanceBadge,
  RetirementBadge,
} from './components/TruckStatusPills'
import Pagination from '../../components/ui/Pagination'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { useNotification } from '../../context/NotificationContext'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

const MAINT_TYPES = [
  { value: 'PREVENTIVE', label: 'Preventive Maintenance' },
  { value: 'CORRECTIVE', label: 'Corrective Repair' },
  { value: 'INSPECTION_FOLLOWUP', label: 'Inspection Follow-up' },
  { value: 'EMERGENCY', label: 'Emergency Repair' },
]

export default function FacilityMaintenance() {
  const { notify } = useNotification()
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()

  const [records, setRecords] = useState([])
  const [trucks, setTrucks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // Dedicated full-page Create / Edit form
  const [editingId, setEditingId] = useState(null)
  const [truckId, setTruckId] = useState('')
  const [maintenanceType, setMaintenanceType] = useState('CORRECTIVE')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [scheduledFor, setScheduledFor] = useState(() => new Date().toISOString().slice(0, 10))
  const [cost, setCost] = useState('')
  const [odometerKm, setOdometerKm] = useState('')
  const [startImmediately, setStartImmediately] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Confirmations
  const [startTarget, setStartTarget] = useState(null)
  const [completeTarget, setCompleteTarget] = useState(null)
  const [completeCost, setCompleteCost] = useState('')
  const [completeOdometer, setCompleteOdometer] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const loadData = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    setError(null)
    try {
      const [recRes, trucksRes] = await Promise.all([
        getMaintenanceRecords({
          dumpsite_id: siteId,
          status: statusFilter || undefined,
          search: debouncedSearch || undefined,
          page,
          page_size: 10,
        }),
        getFacilityTrucks({ paginate: false }),
      ])
      const paged = unwrapPaginated(recRes, 10)
      setRecords(paged.results)
      setTotalCount(paged.count)
      setTotalPages(paged.total_pages)
      setTrucks(unwrapList(trucksRes))
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load facility maintenance records.'))
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [siteId, statusFilter, debouncedSearch, page])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    loadData()
  }, [siteId, scopeLoading, loadData])

  const resetForm = () => {
    setEditingId(null)
    setTruckId('')
    setMaintenanceType('CORRECTIVE')
    setTitle('')
    setNotes('')
    setScheduledFor(new Date().toISOString().slice(0, 10))
    setCost('')
    setOdometerKm('')
    setStartImmediately(false)
  }

  const startEdit = (rec) => {
    setEditingId(rec.id)
    setTruckId(String(rec.truck || ''))
    setMaintenanceType(rec.maintenance_type || 'CORRECTIVE')
    setTitle(rec.title || '')
    setNotes(rec.notes || '')
    setScheduledFor(rec.scheduled_for ? String(rec.scheduled_for).slice(0, 10) : '')
    setCost(rec.cost != null ? String(rec.cost) : '')
    setOdometerKm(rec.odometer_km != null ? String(rec.odometer_km) : '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSaveRecord = async (e) => {
    e.preventDefault()
    if (!title.trim()) {
      notify({ variant: 'error-outline', message: 'Maintenance title is required.' })
      return
    }
    setSubmitting(true)
    try {
      if (editingId) {
        await updateMaintenanceRecord(editingId, {
          maintenance_type: maintenanceType,
          title: title.trim(),
          notes: notes.trim(),
          scheduled_for: scheduledFor || null,
          cost: cost !== '' ? Number(cost) : null,
          odometer_km: odometerKm !== '' ? Number(odometerKm) : null,
        })
        notify({ variant: 'success', message: 'Maintenance record updated (existing truck notes/status_reason preserved).' })
      } else {
        if (!truckId) {
          notify({ variant: 'error-outline', message: 'Please select a facility truck.' })
          setSubmitting(false)
          return
        }
        await createMaintenanceRecord({
          truck_id: Number(truckId),
          maintenance_type: maintenanceType,
          title: title.trim(),
          notes: notes.trim(),
          scheduled_for: scheduledFor || null,
          cost: cost !== '' ? Number(cost) : null,
          odometer_km: odometerKm !== '' ? Number(odometerKm) : null,
          start_immediately: startImmediately,
        })
        notify({ variant: 'success', message: 'Maintenance record saved.' })
      }
      resetForm()
      await loadData()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to save maintenance record.') })
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmStart = async (startNotes) => {
    if (!startTarget) return
    setSubmitting(true)
    try {
      await startMaintenanceRecord(startTarget.id, startNotes ? { notes: startNotes } : {})
      notify({ variant: 'success', message: `Maintenance started for ${startTarget.truck_plate || `Truck #${startTarget.truck}`}.` })
      setStartTarget(null)
      await loadData()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to start maintenance.') })
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmComplete = async (completionNotes) => {
    if (!completeTarget) return
    setSubmitting(true)
    try {
      const payload = { completion_notes: completionNotes }
      if (completeCost !== '') payload.cost = Number(completeCost)
      if (completeOdometer !== '') payload.odometer_km = Number(completeOdometer)
      await completeMaintenanceRecord(completeTarget.id, payload)
      notify({
        variant: 'success',
        message: `Maintenance completed for ${completeTarget.truck_plate || `Truck #${completeTarget.truck}`}.`,
      })
      setCompleteTarget(null)
      setCompleteCost('')
      setCompleteOdometer('')
      await loadData()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to complete maintenance.') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Facility Maintenance Management"
          subtitle="Schedule, update, start, and complete maintenance records for trucks operating at this facility."
          sites={sites}
          siteId={siteId}
          onSiteChange={(next) => { setSiteId(next); setPage(1) }}
          activeSite={activeSite}
          isAdmin={isAdmin}

        />

        {(scopeError || error) && (
          <div style={{ background: '#fef2f5', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <AlertCircle size={16} />
            <span>{scopeError || error}</span>
          </div>
        )}

        {/* Policy Reminder */}
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12.5 }}>
          <strong>State Separation Policy:</strong> Completing maintenance never clears an active Operational Hold and never alters truck retirement or historical notes. Held trucks must still be cleared separately under Operational Holds.
        </div>

        {/* Dedicated Full-Page Create / Edit Maintenance Form */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '18px 20px', marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #e4e6eb' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1c1e21', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {editingId ? <Edit3 size={17} color="#2563eb" /> : <Plus size={17} color="#16a34a" />}
              {editingId ? `Edit Maintenance Record #${editingId}` : 'Schedule / Record Facility Maintenance'}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                style={{ background: '#f0f2f5', border: '1px solid #ced0d4', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: '#1c1e21', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <X size={13} /> Cancel Edit
              </button>
            )}
          </div>

          <form onSubmit={handleSaveRecord} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {!editingId && (
              <div>
                <label style={labelStyle}>Facility Truck *</label>
                <select value={truckId} onChange={(e) => setTruckId(e.target.value)} required style={inputStyle}>
                  <option value="">-- Select Truck --</option>
                  {trucks
                    .filter((t) => !t.is_retired)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.plate_number} — {t.model}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div>
              <label style={labelStyle}>Maintenance Type</label>
              <select value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)} style={inputStyle}>
                {MAINT_TYPES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Brake pad replacement"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Scheduled Date</label>
              <input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Estimated / Actual Cost</label>
              <input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>Odometer (km)</label>
              <input type="number" min="0" step="0.1" value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} placeholder="e.g. 42150" style={inputStyle} />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Maintenance Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Service details, parts required, or observations..."
                style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              {!editingId ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#1c1e21', fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={startImmediately} onChange={(e) => setStartImmediately(e.target.checked)} />
                  Start maintenance immediately (sets truck under repair if no active DriverShift)
                </label>
              ) : (
                <span />
              )}

              <button
                type="submit"
                disabled={submitting || !siteId}
                style={{
                  background: '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  height: 36,
                  padding: '0 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Wrench size={14} /> {submitting ? 'Saving...' : editingId ? 'Save Updates' : 'Save Maintenance Record'}
              </button>
            </div>
          </form>
        </div>

        {/* Facility Fleet State Overview Strip */}
        {trucks.length > 0 && (
          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
              Facility Fleet Condition vs. Hold vs. Maintenance vs. Retirement ({trucks.length})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {trucks.slice(0, 8).map((t) => (
                <div key={t.id} style={{ padding: '10px 12px', border: '1px solid #e4e6eb', borderRadius: 8, background: '#f8fafc' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Truck size={14} color="#2563eb" /> {t.plate_number}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <ConditionBadge condition={t.mechanical_condition} />
                    <HoldBadge isHeld={t.is_operational_hold} />
                    <MaintenanceBadge status={t.maintenance_status} />
                    <RetirementBadge isRetired={t.is_retired} retirementState={t.retirement_state} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { key: '', label: 'All Statuses' },
              { key: 'SCHEDULED', label: 'Scheduled' },
              { key: 'IN_PROGRESS', label: 'In Progress' },
              { key: 'COMPLETED', label: 'Completed' },
            ].map((tab) => {
              const active = statusFilter === tab.key
              return (
                <button
                  key={tab.key || 'all'}
                  type="button"
                  onClick={() => { setStatusFilter(tab.key); setPage(1) }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: active ? '1px solid #bbf7d0' : '1px solid #e4e6eb',
                    background: active ? '#e7f5eb' : '#f8fafc',
                    color: active ? '#15803d' : '#4b5563',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div style={{ position: 'relative' }}>
            <Search size={14} color="#65676b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plate, title, notes..."
              style={{ height: 36, width: 240, paddingLeft: 32, paddingRight: 10, borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5 }}
            />
          </div>
        </div>

        {/* Maintenance Records List */}
        {loading || scopeLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : records.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #ced0d4', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: '#65676b' }}>
            <Wrench size={36} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', marginBottom: 4 }}>No maintenance records found</div>
            <div style={{ fontSize: 13 }}>Use the form above to schedule or record maintenance for a facility truck.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {records.map((rec) => (
              <div
                key={rec.id}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e4e6eb',
                  borderRadius: 10,
                  padding: '16px 18px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21' }}>{rec.title}</span>
                      <MaintenanceBadge status={rec.status} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563', background: '#f0f2f5', border: '1px solid #e4e6eb', borderRadius: 4, padding: '2px 7px' }}>
                        {(rec.maintenance_type || 'CORRECTIVE').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: '#65676b', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>Truck: <strong style={{ color: '#1c1e21' }}>{rec.truck_plate || `#${rec.truck}`}</strong></span>
                      {rec.scheduled_for && <span>Scheduled: <strong style={{ color: '#1c1e21' }}>{rec.scheduled_for}</strong></span>}
                      {rec.cost != null && <span>Cost: <strong style={{ color: '#1c1e21' }}>{Number(rec.cost).toLocaleString()}</strong></span>}
                      {rec.odometer_km != null && <span>Odometer: <strong style={{ color: '#1c1e21' }}>{Number(rec.odometer_km).toLocaleString()} km</strong></span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {rec.status !== 'COMPLETED' && rec.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        onClick={() => startEdit(rec)}
                        style={{ background: '#ffffff', border: '1px solid #ced0d4', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#1c1e21', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <Edit3 size={13} /> Edit
                      </button>
                    )}
                    {rec.status === 'SCHEDULED' && (
                      <button
                        type="button"
                        onClick={() => setStartTarget(rec)}
                        style={{ background: '#d97706', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#ffffff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <Play size={13} /> Start
                      </button>
                    )}
                    {(rec.status === 'SCHEDULED' || rec.status === 'IN_PROGRESS') && (
                      <button
                        type="button"
                        onClick={() => {
                          setCompleteCost(rec.cost != null ? String(rec.cost) : '')
                          setCompleteOdometer(rec.odometer_km != null ? String(rec.odometer_km) : '')
                          setCompleteTarget(rec)
                        }}
                        style={{ background: '#16a34a', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#ffffff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <CheckCircle2 size={13} /> Complete
                      </button>
                    )}
                  </div>
                </div>

                {rec.notes && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12.5, color: '#4b5563' }}>
                    {rec.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={10}
          onPageChange={setPage}
          loading={loading}
        />

        <ConfirmActionDialog
          open={Boolean(startTarget)}
          title={`Start Maintenance — ${startTarget?.truck_plate || ''}`}
          description="Starting maintenance marks the truck as under repair and unavailable for dispatch until completed."
          confirmLabel="Start Maintenance"
          variant="warning"
          requireNotes={false}
          notesLabel="Start Notes"
          notesPlaceholder="Optional technician or bay notes..."
          submitting={submitting}
          onConfirm={handleConfirmStart}
          onCancel={() => setStartTarget(null)}
        />

        <ConfirmActionDialog
          open={Boolean(completeTarget)}
          title={`Complete Maintenance — ${completeTarget?.truck_plate || ''}`}
          description="Completing maintenance updates maintenance status to available. If an Operational Hold is active on this truck, it will remain held until cleared separately."
          confirmLabel="Mark Completed"
          variant="primary"
          requireNotes={true}
          notesLabel="Completion Notes"
          notesPlaceholder="Describe repairs completed and verification checks..."
          submitting={submitting}
          onConfirm={handleConfirmComplete}
          onCancel={() => setCompleteTarget(null)}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Final Cost</label>
              <input type="number" min="0" step="0.01" value={completeCost} onChange={(e) => setCompleteCost(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Odometer (km)</label>
              <input type="number" min="0" step="0.1" value={completeOdometer} onChange={(e) => setCompleteOdometer(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </ConfirmActionDialog>
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
  marginBottom: 5,
}

const inputStyle = {
  width: '100%',
  height: 36,
  padding: '0 10px',
  borderRadius: 6,
  border: '1px solid #ced0d4',
  background: '#ffffff',
  color: '#1c1e21',
  fontSize: 13,
  boxSizing: 'border-box',
}
