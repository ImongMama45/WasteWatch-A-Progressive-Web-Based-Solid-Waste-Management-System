import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ClipboardCheck,
  Search,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Truck,
  User,
  Clock,
} from 'lucide-react'
import {
  getTruckInspections,
  createTruckInspection,
  getDumpsiteMonitoring,
  getFacilityTrucks,
  unwrapList,
  unwrapPaginated,
} from '../../api/dumpsiteApi'
import FacilityWorkspaceHeader from './components/FacilityWorkspaceHeader'
import { useFacilityScope } from './components/useFacilityScope'
import ConfirmActionDialog from './components/ConfirmActionDialog'
import { ConditionBadge, InspectionBadge } from './components/TruckStatusPills'
import Pagination from '../../components/ui/Pagination'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { useNotification } from '../../context/NotificationContext'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

const INSPECTION_TYPES = [
  { value: 'POST_SHIFT', label: 'Post-Shift Inspection' },
  { value: 'FACILITY', label: 'Facility Safety Check' },
  { value: 'PRE_DISPATCH', label: 'Pre-Dispatch Check' },
]

const MECHANICAL_CONDITIONS = [
  { value: 'OPERATIONAL', label: 'Operational' },
  { value: 'NEEDS_REPAIR', label: 'Needs Repair' },
  { value: 'CRITICAL', label: 'Critical / Unsafe' },
]

export default function TruckInspections() {
  const { notify } = useNotification()
  const [searchParams] = useSearchParams()
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()

  const [inspections, setInspections] = useState([])
  const [awaitingShifts, setAwaitingShifts] = useState([])
  const [facilityTrucks, setFacilityTrucks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [stateFilter, setStateFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // Form state (full-page dedicated workflow)
  const [driverShiftId, setDriverShiftId] = useState(() => searchParams.get('shift_id') || '')
  const [truckId, setTruckId] = useState(() => searchParams.get('truck_id') || '')
  const [inspectionType, setInspectionType] = useState('POST_SHIFT')
  const [inspectionState, setInspectionState] = useState('PASSED')
  const [mechanicalCondition, setMechanicalCondition] = useState('OPERATIONAL')
  const [notes, setNotes] = useState('')
  const [checklist, setChecklist] = useState({
    brakes_ok: true,
    tires_ok: true,
    lights_ok: true,
    hydraulics_ok: true,
  })
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const loadContextData = useCallback(async () => {
    if (!siteId) return
    try {
      const [monRes, trucksRes] = await Promise.all([
        getDumpsiteMonitoring(siteId, { state: 'awaiting_post_shift_inspection', page_size: 50 }).catch(() => null),
        getFacilityTrucks({ paginate: false }).catch(() => []),
      ])
      const monRows = Array.isArray(monRes?.results) ? monRes.results : []
      setAwaitingShifts(monRows)
      setFacilityTrucks(unwrapList(trucksRes))
    } catch {
      // handled gracefully
    }
  }, [siteId])

  const fetchInspections = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getTruckInspections({
        dumpsite_id: siteId,
        inspection_state: stateFilter || undefined,
        inspection_type: typeFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        page_size: 10,
      })
      const paged = unwrapPaginated(res, 10)
      setInspections(paged.results)
      setTotalCount(paged.count)
      setTotalPages(paged.total_pages)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load inspection history.'))
      setInspections([])
    } finally {
      setLoading(false)
    }
  }, [siteId, stateFilter, typeFilter, debouncedSearch, page])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    loadContextData()
    fetchInspections()
  }, [siteId, scopeLoading, loadContextData, fetchInspections])

  const handleShiftSelect = (val) => {
    setDriverShiftId(val)
    if (val) {
      const match = awaitingShifts.find((s) => String(s.shift_id) === String(val))
      if (match?.truck?.id) setTruckId(String(match.truck.id))
      setInspectionType('POST_SHIFT')
    }
  }

  const executeSubmit = async () => {
    if (!truckId && !driverShiftId) {
      notify({ variant: 'error-outline', message: 'Select a DriverShift or Facility Truck to inspect.' })
      return
    }
    if (inspectionState === 'FAILED' && !notes.trim()) {
      notify({ variant: 'error-outline', message: 'Please provide inspection failure notes before placing an operational hold.' })
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        inspection_type: inspectionType,
        inspection_state: inspectionState,
        mechanical_condition: mechanicalCondition,
        notes: notes.trim(),
        checklist_data: checklist,
      }
      if (driverShiftId) payload.driver_shift_id = Number(driverShiftId)
      if (truckId) payload.truck_id = Number(truckId)

      await createTruckInspection(payload)
      notify({
        variant: 'success',
        message:
          inspectionState === 'FAILED'
            ? 'Failed inspection recorded. Operational hold placed on truck (no automatic maintenance created).'
            : 'Inspection recorded successfully.',
      })
      setConfirmOpen(false)
      setDriverShiftId('')
      setNotes('')
      await Promise.all([fetchInspections(), loadContextData()])
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to record inspection.') })
    } finally {
      setSubmitting(false)
    }
  }

  const handleFormSubmit = (e) => {
    e.preventDefault()
    if (!truckId && !driverShiftId) {
      notify({ variant: 'error-outline', message: 'Select a DriverShift or Facility Truck to inspect.' })
      return
    }
    if (inspectionState === 'FAILED') {
      if (!notes.trim()) {
        notify({ variant: 'error-outline', message: 'Failure notes are required when marking an inspection as FAILED.' })
        return
      }
      setConfirmOpen(true)
      return
    }
    executeSubmit()
  }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Post-Shift & Facility Inspections"
          subtitle="Review Driver post-shift inspection submissions and record facility safety checks."
          sites={sites}
          siteId={siteId}
          onSiteChange={(next) => { setSiteId(next); setPage(1) }}
          activeSite={activeSite}
          isAdmin={isAdmin}
        />

        {(scopeError || error) && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <AlertCircle size={16} />
            <span>{scopeError || error}</span>
          </div>
        )}

        {/* Dedicated Full-Page Inspection Entry Card */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '18px 20px', marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #e4e6eb' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1c1e21', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <ClipboardCheck size={18} color="#16a34a" /> Record Facility / Post-Shift Inspection
              </h2>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: '#65676b' }}>
                Failed inspections place an operational hold only (trucks cannot be dispatched until cleared; maintenance and retirement remain separate).
              </p>
            </div>
            {awaitingShifts.length > 0 && (
              <span style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 700 }}>
                {awaitingShifts.length} Shift(s) Awaiting Post-Shift Inspection
              </span>
            )}
          </div>

          <form onSubmit={handleFormSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>Awaiting Post-Shift Shift (optional)</label>
              <select value={driverShiftId} onChange={(e) => handleShiftSelect(e.target.value)} style={inputStyle}>
                <option value="">-- Select Shift (optional) --</option>
                {awaitingShifts.map((s) => (
                  <option key={s.shift_id} value={s.shift_id}>
                    Shift #{s.shift_id} · {s.truck?.plate_number} ({s.driver?.full_name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Facility Truck *</label>
              <select
                value={truckId}
                onChange={(e) => setTruckId(e.target.value)}
                required={!driverShiftId}
                style={inputStyle}
              >
                <option value="">-- Select Facility Truck --</option>
                {facilityTrucks
                  .filter((t) => !t.is_retired)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.plate_number} — {t.model} ({t.inspection_state || 'PENDING'})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Inspection Type</label>
              <select value={inspectionType} onChange={(e) => setInspectionType(e.target.value)} style={inputStyle}>
                {INSPECTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Inspection Result</label>
              <select
                value={inspectionState}
                onChange={(e) => {
                  const next = e.target.value
                  setInspectionState(next)
                  if (next === 'FAILED' && mechanicalCondition === 'OPERATIONAL') {
                    setMechanicalCondition('NEEDS_REPAIR')
                  }
                }}
                style={inputStyle}
              >
                <option value="PASSED">PASSED</option>
                <option value="FAILED">FAILED (Places Operational Hold)</option>
                <option value="PENDING_INSPECTION">PENDING INSPECTION</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Mechanical Condition</label>
              <select value={mechanicalCondition} onChange={(e) => setMechanicalCondition(e.target.value)} style={inputStyle}>
                {MECHANICAL_CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <label style={labelStyle}>Safety Checklist</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#1c1e21' }}>
                {[
                  { key: 'brakes_ok', label: 'Brakes' },
                  { key: 'tires_ok', label: 'Tires' },
                  { key: 'lights_ok', label: 'Lights' },
                  { key: 'hydraulics_ok', label: 'Hydraulics' },
                ].map((chk) => (
                  <label key={chk.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={checklist[chk.key]}
                      onChange={(e) => setChecklist((prev) => ({ ...prev, [chk.key]: e.target.checked }))}
                    />
                    {chk.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>
                Inspection Notes {inspectionState === 'FAILED' ? '*' : '(optional)'}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                required={inspectionState === 'FAILED'}
                placeholder="Document findings, defects, or verification remarks..."
                style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={submitting || !siteId}
                style={{
                  background: inspectionState === 'FAILED' ? '#dc2626' : '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  height: 38,
                  padding: '0 20px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {inspectionState === 'FAILED' ? <ShieldAlert size={15} /> : <CheckCircle2 size={15} />}
                {submitting ? 'Submitting...' : inspectionState === 'FAILED' ? 'Submit Failed Inspection & Hold Truck' : 'Submit Inspection'}
              </button>
            </div>
          </form>
        </div>

        {/* Filter Bar */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={stateFilter}
              onChange={(e) => { setStateFilter(e.target.value); setPage(1) }}
              style={{ ...inputStyle, width: 170 }}
            >
              <option value="">All Results</option>
              <option value="PASSED">Passed</option>
              <option value="FAILED">Failed</option>
              <option value="PENDING_INSPECTION">Pending</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
              style={{ ...inputStyle, width: 190 }}
            >
              <option value="">All Inspection Types</option>
              {INSPECTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div style={{ position: 'relative' }}>
            <Search size={14} color="#65676b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search truck plate, notes, inspector..."
              style={{ height: 36, width: 250, paddingLeft: 32, paddingRight: 10, borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5 }}
            />
          </div>
        </div>

        {/* Inspection History Table */}
        {loading || scopeLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : inspections.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #ced0d4', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: '#65676b' }}>
            <ClipboardCheck size={36} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', marginBottom: 4 }}>No inspection records found</div>
            <div style={{ fontSize: 13 }}>Recorded post-shift and facility inspections will appear here.</div>
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e4e6eb', textAlign: 'left', color: '#65676b', fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 16px' }}>Truck / Shift</th>
                    <th style={{ padding: '10px 16px' }}>Type</th>
                    <th style={{ padding: '10px 16px' }}>Result & Condition</th>
                    <th style={{ padding: '10px 16px' }}>Submitted By</th>
                    <th style={{ padding: '10px 16px' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {inspections.map((ins) => (
                    <tr key={ins.id} style={{ borderBottom: '1px solid #f0f2f5' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#1c1e21' }}>
                          <Truck size={14} color="#2563eb" />
                          {ins.truck_plate || `Truck #${ins.truck}`}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#65676b', marginTop: 2 }}>
                          {ins.driver_shift ? `Shift #${ins.driver_shift}` : 'Facility Inspection'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#1c1e21', fontWeight: 600 }}>
                        {(ins.inspection_type || 'POST_SHIFT').replace(/_/g, ' ')}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <InspectionBadge state={ins.inspection_state} />
                          <ConditionBadge condition={ins.mechanical_condition} />
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, color: '#1c1e21' }}>
                          <User size={13} color="#65676b" />
                          {ins.submitted_by_name || ins.driver_name || 'User'}
                        </div>
                        <div style={{ fontSize: 11, color: '#65676b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={11} />
                          {ins.inspected_at || ins.created_at ? new Date(ins.inspected_at || ins.created_at).toLocaleString() : '--'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#4b5563', maxWidth: 320 }}>
                        {ins.notes || '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          open={confirmOpen}
          title="Confirm Failed Inspection & Operational Hold"
          description="Marking this inspection as FAILED will place an Operational Hold on the truck so it cannot be dispatched until cleared. It will NOT automatically create a maintenance record or retire the truck."
          confirmLabel="Confirm Failed Inspection"
          variant="danger"
          submitting={submitting}
          onConfirm={executeSubmit}
          onCancel={() => setConfirmOpen(false)}
        />
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
