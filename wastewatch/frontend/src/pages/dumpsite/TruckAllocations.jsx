import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ArrowLeftRight,
  Search,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Truck,
  Calendar,
  Trash2,
  Plus,
} from 'lucide-react'
import {
  getScheduleTruckAllocations,
  allocateScheduleTruck,
  deleteScheduleTruckAllocation,
  getTruckReplacementRequests,
  approveTruckReplacementRequest,
  rejectTruckReplacementRequest,
  replaceTruckAssignment,
  getFacilitySchedules,
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

function isTruckDispatchable(t) {
  if (!t) return false
  const maintOk = !t.maintenance_status || t.maintenance_status === 'available'
  const mechStatusOk = !t.mechanical_status || t.mechanical_status === 'serviceable'
  const mechCondOk = !t.mechanical_condition || t.mechanical_condition === 'OPERATIONAL'
  const retStateOk = !t.retirement_state || t.retirement_state === 'operational'
  const provOk =
    !t.commissioning_provenance ||
    t.commissioning_provenance === 'commissioned_verified' ||
    t.commissioning_provenance === 'commissioned_date_unknown'
  return (
    t.status === 'active' &&
    !t.is_retired &&
    retStateOk &&
    provOk &&
    !t.is_operational_hold &&
    maintOk &&
    mechStatusOk &&
    mechCondOk
  )
}

export default function TruckAllocations() {
  const { notify } = useNotification()
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()

  const [activeTab, setActiveTab] = useState('allocations') // 'allocations' | 'replacements'
  const [schedules, setSchedules] = useState([])
  const [trucks, setTrucks] = useState([])
  const [allocations, setAllocations] = useState([])
  const [requests, setRequests] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [allocPage, setAllocPage] = useState(1)
  const [allocTotalCount, setAllocTotalCount] = useState(0)
  const [allocTotalPages, setAllocTotalPages] = useState(1)
  const [reqPage, setReqPage] = useState(1)
  const [reqTotalCount, setReqTotalCount] = useState(0)
  const [reqTotalPages, setReqTotalPages] = useState(1)
  const [reqStatusFilter, setReqStatusFilter] = useState('')

  // Allocate Truck Form
  const [allocScheduleId, setAllocScheduleId] = useState('')
  const [allocTruckId, setAllocTruckId] = useState('')
  const [allocDate, setAllocDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)

  // Direct Replacement Swap Form
  const [swapScheduleId, setSwapScheduleId] = useState('')
  const [swapNewTruckId, setSwapNewTruckId] = useState('')
  const [swapDate, setSwapDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [swapTransferDrivers, setSwapTransferDrivers] = useState(true)
  const [swapReason, setSwapReason] = useState('')
  const [swapConfirmOpen, setSwapConfirmOpen] = useState(false)

  // Confirmations
  const [deleteAllocTarget, setDeleteAllocTarget] = useState(null)
  const [approveTarget, setApproveTarget] = useState(null)
  const [approveTruckId, setApproveTruckId] = useState('')
  const [approveTransferDrivers, setApproveTransferDrivers] = useState(true)
  const [rejectTarget, setRejectTarget] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setAllocPage(1)
      setReqPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const facilitySchedules = useMemo(() => {
    if (!siteId) return []
    return schedules.filter((s) => String(s.dumpsite) === String(siteId))
  }, [schedules, siteId])

  const dispatchableTrucks = useMemo(() => trucks.filter(isTruckDispatchable), [trucks])

  const loadData = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    setError(null)
    try {
      const [schedRaw, truckRaw, allocRaw, reqRaw] = await Promise.all([
        getFacilitySchedules({ paginate: false }),
        getFacilityTrucks({ paginate: false }),
        getScheduleTruckAllocations({
          dumpsite_id: siteId,
          search: debouncedSearch || undefined,
          page: allocPage,
          page_size: 10,
        }),
        getTruckReplacementRequests({
          dumpsite_id: siteId,
          status: reqStatusFilter || undefined,
          search: debouncedSearch || undefined,
          page: reqPage,
          page_size: 10,
        }),
      ])

      const schedList = unwrapList(schedRaw)
      setSchedules(schedList)
      setTrucks(unwrapList(truckRaw))

      const siteSchedSet = new Set(
        schedList.filter((s) => String(s.dumpsite) === String(siteId)).map((s) => String(s.id))
      )

      const allocPaged = unwrapPaginated(allocRaw, 10)
      const filteredAlloc = allocPaged.results.filter(
        (a) => siteSchedSet.size === 0 || siteSchedSet.has(String(a.schedule)) || String(a.dumpsite) === String(siteId)
      )
      setAllocations(filteredAlloc)
      setAllocTotalCount(allocPaged.count)
      setAllocTotalPages(allocPaged.total_pages)

      const reqPaged = unwrapPaginated(reqRaw, 10)
      setRequests(reqPaged.results)
      setReqTotalCount(reqPaged.count)
      setReqTotalPages(reqPaged.total_pages)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load allocations and replacement requests.'))
    } finally {
      setLoading(false)
    }
  }, [siteId, debouncedSearch, allocPage, reqPage, reqStatusFilter])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    loadData()
  }, [siteId, scopeLoading, loadData])

  const handleAllocateTruck = async (e) => {
    e.preventDefault()
    if (!allocScheduleId || !allocTruckId || !allocDate) {
      notify({ variant: 'error-outline', message: 'Select a schedule, dispatchable truck, and allocation date.' })
      return
    }
    setSubmitting(true)
    try {
      await allocateScheduleTruck(allocScheduleId, {
        truck_id: Number(allocTruckId),
        allocation_date: allocDate,
      })
      notify({ variant: 'success', message: 'Schedule truck allocation saved.' })
      setAllocTruckId('')
      await loadData()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to allocate truck to schedule.') })
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmDeleteAlloc = async () => {
    if (!deleteAllocTarget) return
    setSubmitting(true)
    try {
      await deleteScheduleTruckAllocation(deleteAllocTarget.id)
      notify({ variant: 'success', message: 'Allocation override removed.' })
      setDeleteAllocTarget(null)
      await loadData()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to remove allocation.') })
    } finally {
      setSubmitting(false)
    }
  }

  const handleApproveRequest = async (resolutionNotes) => {
    if (!approveTarget || !approveTruckId) {
      notify({ variant: 'error-outline', message: 'Select a dispatchable replacement truck.' })
      return
    }
    setSubmitting(true)
    try {
      await approveTruckReplacementRequest(approveTarget.id, {
        replacement_truck_id: Number(approveTruckId),
        resolution_notes: resolutionNotes,
        transfer_drivers: approveTransferDrivers,
      })
      notify({ variant: 'success', message: `Replacement request #${approveTarget.id} approved.` })
      setApproveTarget(null)
      setApproveTruckId('')
      await loadData()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to approve replacement request.') })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRejectRequest = async (resolutionNotes) => {
    if (!rejectTarget) return
    setSubmitting(true)
    try {
      await rejectTruckReplacementRequest(rejectTarget.id, {
        resolution_notes: resolutionNotes,
      })
      notify({ variant: 'success', message: `Replacement request #${rejectTarget.id} rejected.` })
      setRejectTarget(null)
      await loadData()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to reject replacement request.') })
    } finally {
      setSubmitting(false)
    }
  }

  const selectedSwapSchedule = facilitySchedules.find((s) => String(s.id) === String(swapScheduleId))

  const handleDirectSwap = async (confirmNotes) => {
    if (!selectedSwapSchedule || !swapNewTruckId) {
      notify({ variant: 'error-outline', message: 'Select a schedule with an assigned truck and a dispatchable replacement truck.' })
      return
    }
    const sourceTruckId = selectedSwapSchedule.truck
    if (!sourceTruckId) {
      notify({ variant: 'error-outline', message: 'Selected schedule has no default truck to replace. Use Schedule Truck Allocation instead.' })
      return
    }
    setSubmitting(true)
    try {
      await replaceTruckAssignment(sourceTruckId, {
        replacement_truck_id: Number(swapNewTruckId),
        schedule_id: Number(selectedSwapSchedule.id),
        effective_date: swapDate,
        reason: confirmNotes || swapReason.trim() || 'Facility truck replacement',
        transfer_drivers: swapTransferDrivers,
      })
      notify({ variant: 'success', message: 'Truck replacement executed while preserving historical shift records.' })
      setSwapConfirmOpen(false)
      setSwapNewTruckId('')
      setSwapReason('')
      await loadData()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to replace truck.') })
    } finally {
      setSubmitting(false)
    }
  }

  const pendingReqCount = requests.filter((r) => r.status === 'PENDING').length

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Truck Allocations & Replacement Requests"
          subtitle="Manage facility-scoped daily truck allocations and approve or reject driver truck replacement requests."
          sites={sites}
          siteId={siteId}
          onSiteChange={(next) => { setSiteId(next); setAllocPage(1); setReqPage(1) }}
          activeSite={activeSite}
          isAdmin={isAdmin}
        />

        {(scopeError || error) && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <AlertCircle size={16} />
            <span>{scopeError || error}</span>
          </div>
        )}

        {/* Section Tabs + Search */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('allocations')}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                border: activeTab === 'allocations' ? '1px solid #bbf7d0' : '1px solid #e4e6eb',
                background: activeTab === 'allocations' ? '#e7f5eb' : '#f8fafc',
                color: activeTab === 'allocations' ? '#15803d' : '#4b5563',
              }}
            >
              Schedule Allocations ({allocTotalCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('replacements')}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                border: activeTab === 'replacements' ? '1px solid #bbf7d0' : '1px solid #e4e6eb',
                background: activeTab === 'replacements' ? '#e7f5eb' : '#f8fafc',
                color: activeTab === 'replacements' ? '#15803d' : '#4b5563',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              Replacement Requests ({reqTotalCount})
              {pendingReqCount > 0 && (
                <span style={{ background: '#dc2626', color: '#ffffff', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                  {pendingReqCount} pending
                </span>
              )}
            </button>
          </div>

          <div style={{ position: 'relative' }}>
            <Search size={14} color="#65676b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search schedule, truck plate, reason..."
              style={{ height: 36, width: 250, paddingLeft: 32, paddingRight: 10, borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5 }}
            />
          </div>
        </div>

        {activeTab === 'allocations' ? (
          <>
            {/* Allocate Truck to Schedule Form */}
            <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#1c1e21', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Plus size={16} color="#16a34a" /> Allocate Dispatchable Truck to Facility Schedule
              </h2>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#65676b' }}>
                Only active, commissioned trucks free of operational holds and maintenance can be allocated ({dispatchableTrucks.length} eligible).
              </p>

              <form onSubmit={handleAllocateTruck} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Facility Schedule *</label>
                  <select value={allocScheduleId} onChange={(e) => setAllocScheduleId(e.target.value)} required style={inputStyle}>
                    <option value="">-- Select Schedule --</option>
                    {facilitySchedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.area} (Default: {s.truck_plate || 'Unassigned'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Dispatchable Truck *</label>
                  <select value={allocTruckId} onChange={(e) => setAllocTruckId(e.target.value)} required style={inputStyle}>
                    <option value="">-- Select Eligible Truck --</option>
                    {dispatchableTrucks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.plate_number} — {t.model}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Allocation Date *</label>
                  <input type="date" required value={allocDate} onChange={(e) => setAllocDate(e.target.value)} style={inputStyle} />
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={submitting || !siteId}
                    style={{
                      width: '100%',
                      height: 36,
                      borderRadius: 6,
                      border: 'none',
                      background: '#16a34a',
                      color: '#ffffff',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: submitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submitting ? 'Allocating...' : 'Save Truck Allocation'}
                  </button>
                </div>
              </form>
            </div>

            {/* Facility Truck Dispatch Eligibility Overview */}
            {trucks.length > 0 && (
              <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
                  Facility Fleet Dispatch Eligibility
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                  {trucks.map((t) => {
                    const ok = isTruckDispatchable(t)
                    return (
                      <div key={t.id} style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`, background: ok ? '#f0fdf4' : '#fef2f2' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: '#1c1e21', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Truck size={14} /> {t.plate_number}
                          </span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: ok ? '#15803d' : '#b91c1c' }}>
                            {ok ? 'DISPATCHABLE' : 'BLOCKED'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          <ConditionBadge condition={t.mechanical_condition} />
                          <HoldBadge isHeld={t.is_operational_hold} />
                          <MaintenanceBadge status={t.maintenance_status} />
                          <RetirementBadge isRetired={t.is_retired} retirementState={t.retirement_state} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Allocations Table */}
            {loading || scopeLoading ? (
              <TableSkeleton rows={5} cols={5} />
            ) : allocations.length === 0 ? (
              <div style={{ background: '#ffffff', border: '1px dashed #ced0d4', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: '#65676b' }}>
                <Calendar size={34} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', marginBottom: 4 }}>No daily truck allocations found</div>
                <div style={{ fontSize: 13 }}>Allocate a dispatchable truck above to override or assign a truck for a service date.</div>
              </div>
            ) : (
              <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e4e6eb', textAlign: 'left', color: '#65676b', fontSize: 11, textTransform: 'uppercase' }}>
                        <th style={{ padding: '10px 16px' }}>Date</th>
                        <th style={{ padding: '10px 16px' }}>Schedule</th>
                        <th style={{ padding: '10px 16px' }}>Allocated Truck</th>
                        <th style={{ padding: '10px 16px' }}>Team / Allocated By</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map((a) => (
                        <tr key={a.id} style={{ borderBottom: '1px solid #f0f2f5' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 700, color: '#1c1e21' }}>{a.allocation_date}</td>
                          <td style={{ padding: '12px 16px', color: '#1c1e21', fontWeight: 600 }}>{a.schedule_area || `Schedule #${a.schedule}`}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ fontWeight: 700, color: '#15803d' }}>{a.truck_plate || `Truck #${a.truck}`}</span>
                            {a.truck_model && <span style={{ color: '#65676b', fontSize: 12 }}> · {a.truck_model}</span>}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#65676b' }}>
                            {a.team_name ? `${a.team_name} · ` : ''}{a.allocated_by_username || 'Admin/Operator'}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => setDeleteAllocTarget(a)}
                              style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <Trash2 size={12} /> Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Pagination currentPage={allocPage} totalPages={allocTotalPages} totalCount={allocTotalCount} pageSize={10} onPageChange={setAllocPage} loading={loading} />
          </>
        ) : (
          <>
            {/* Direct Truck Replacement Form */}
            <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#1c1e21', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ArrowLeftRight size={16} color="#16a34a" /> Direct Facility Truck Replacement
              </h2>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#65676b' }}>
                Replace a schedule&apos;s assigned truck with an eligible dispatchable truck while preserving historical DriverShift and allocation records.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Schedule to Replace *</label>
                  <select value={swapScheduleId} onChange={(e) => setSwapScheduleId(e.target.value)} style={inputStyle}>
                    <option value="">-- Select Facility Schedule --</option>
                    {facilitySchedules
                      .filter((s) => Boolean(s.truck))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.area} (Current: {s.truck_plate || `#${s.truck}`})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Replacement Truck *</label>
                  <select value={swapNewTruckId} onChange={(e) => setSwapNewTruckId(e.target.value)} style={inputStyle}>
                    <option value="">-- Select Eligible Truck --</option>
                    {dispatchableTrucks
                      .filter((t) => String(t.id) !== String(selectedSwapSchedule?.truck || ''))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.plate_number} — {t.model}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label style={labelStyle}>Effective Date *</label>
                  <input type="date" value={swapDate} onChange={(e) => setSwapDate(e.target.value)} style={inputStyle} />
                </div>

                <div>
                  <label style={labelStyle}>Reason *</label>
                  <input
                    type="text"
                    value={swapReason}
                    onChange={(e) => setSwapReason(e.target.value)}
                    placeholder="Reason for replacement..."
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#1c1e21', fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={swapTransferDrivers} onChange={(e) => setSwapTransferDrivers(e.target.checked)} />
                  Transfer assigned drivers to replacement truck
                </label>

                <button
                  type="button"
                  disabled={!swapScheduleId || !swapNewTruckId || submitting}
                  onClick={() => setSwapConfirmOpen(true)}
                  style={{
                    height: 36,
                    padding: '0 16px',
                    borderRadius: 6,
                    border: 'none',
                    background: !swapScheduleId || !swapNewTruckId ? '#d1d5db' : '#16a34a',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: !swapScheduleId || !swapNewTruckId ? 'not-allowed' : 'pointer',
                  }}
                >
                  Execute Truck Replacement
                </button>
              </div>
            </div>

            {/* Replacement Requests Filter */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {[
                { key: '', label: 'All Requests' },
                { key: 'PENDING', label: 'Pending' },
                { key: 'APPROVED', label: 'Approved' },
                { key: 'REJECTED', label: 'Rejected' },
              ].map((t) => (
                <button
                  key={t.key || 'all'}
                  type="button"
                  onClick={() => { setReqStatusFilter(t.key); setReqPage(1) }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: reqStatusFilter === t.key ? '1px solid #bbf7d0' : '1px solid #e4e6eb',
                    background: reqStatusFilter === t.key ? '#e7f5eb' : '#ffffff',
                    color: reqStatusFilter === t.key ? '#15803d' : '#4b5563',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {loading || scopeLoading ? (
              <TableSkeleton rows={5} cols={4} />
            ) : requests.length === 0 ? (
              <div style={{ background: '#ffffff', border: '1px dashed #ced0d4', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: '#65676b' }}>
                <ArrowLeftRight size={34} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', marginBottom: 4 }}>No truck replacement requests</div>
                <div style={{ fontSize: 13 }}>Driver replacement requests scoped to this facility will appear here.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {requests.map((req) => (
                  <div key={req.id} style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: '#1c1e21' }}>
                            Request #{req.id} · {req.truck_plate || `Truck #${req.truck}`}
                          </span>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              background: req.status === 'APPROVED' ? '#e7f5eb' : req.status === 'REJECTED' ? '#fee2e2' : '#fef3c7',
                              color: req.status === 'APPROVED' ? '#15803d' : req.status === 'REJECTED' ? '#b91c1c' : '#b45309',
                              border: `1px solid ${req.status === 'APPROVED' ? '#bbf7d0' : req.status === 'REJECTED' ? '#fecaca' : '#fde68a'}`,
                            }}
                          >
                            {req.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 12.5, color: '#65676b' }}>
                          Requested by <strong style={{ color: '#1c1e21' }}>{req.requested_by_username || 'Driver'}</strong>
                          {req.schedule ? ` · Schedule #${req.schedule}` : ''}
                          {req.driver_shift ? ` · Shift #${req.driver_shift}` : ''}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13, color: '#1c1e21' }}>
                          <strong>Reason:</strong> {req.reason}
                        </div>
                      </div>

                      {req.status === 'PENDING' && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setApproveTruckId('')
                              setApproveTransferDrivers(true)
                              setApproveTarget(req)
                            }}
                            style={{ background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                          >
                            <CheckCircle2 size={14} /> Approve & Replace
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectTarget(req)}
                            style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                          >
                            <XCircle size={14} /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Pagination currentPage={reqPage} totalPages={reqTotalPages} totalCount={reqTotalCount} pageSize={10} onPageChange={setReqPage} loading={loading} />
          </>
        )}

        {/* Confirmation Dialogs */}
        <ConfirmActionDialog
          open={Boolean(deleteAllocTarget)}
          title="Remove Daily Truck Allocation?"
          description={`Remove allocation for ${deleteAllocTarget?.truck_plate || 'truck'} on ${deleteAllocTarget?.allocation_date || ''}?`}
          confirmLabel="Remove Allocation"
          variant="danger"
          requireNotes={false}
          submitting={submitting}
          onConfirm={handleConfirmDeleteAlloc}
          onCancel={() => setDeleteAllocTarget(null)}
        />

        <ConfirmActionDialog
          open={Boolean(approveTarget)}
          title={`Approve Replacement Request #${approveTarget?.id || ''}`}
          description="Select an eligible dispatchable truck to fulfill this replacement request."
          confirmLabel="Approve & Replace"
          variant="primary"
          requireNotes={true}
          notesLabel="Resolution Notes"
          notesPlaceholder="Record replacement approval details..."
          submitting={submitting}
          onConfirm={handleApproveRequest}
          onCancel={() => setApproveTarget(null)}
        >
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Replacement Truck *</label>
            <select
              required
              value={approveTruckId}
              onChange={(e) => setApproveTruckId(e.target.value)}
              style={inputStyle}
            >
              <option value="">-- Select Eligible Truck --</option>
              {dispatchableTrucks
                .filter((t) => String(t.id) !== String(approveTarget?.truck || ''))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plate_number} — {t.model}
                  </option>
                ))}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#1c1e21', marginTop: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={approveTransferDrivers} onChange={(e) => setApproveTransferDrivers(e.target.checked)} />
              Transfer currently assigned drivers to replacement truck
            </label>
          </div>
        </ConfirmActionDialog>

        <ConfirmActionDialog
          open={Boolean(rejectTarget)}
          title={`Reject Replacement Request #${rejectTarget?.id || ''}`}
          description="Provide clear resolution notes explaining why this truck replacement request was rejected."
          confirmLabel="Reject Request"
          variant="danger"
          requireNotes={true}
          notesLabel="Rejection Reason"
          notesPlaceholder="Explain why replacement was rejected..."
          submitting={submitting}
          onConfirm={handleRejectRequest}
          onCancel={() => setRejectTarget(null)}
        />

        <ConfirmActionDialog
          open={swapConfirmOpen}
          title="Confirm Facility Truck Replacement"
          description="This updates the active truck assignment while preserving historical DriverShift and allocation records."
          confirmLabel="Confirm Replacement"
          variant="warning"
          requireNotes={true}
          notesLabel="Audit Reason"
          defaultNotes={swapReason}
          submitting={submitting}
          onConfirm={handleDirectSwap}
          onCancel={() => setSwapConfirmOpen(false)}
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
