import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Fuel,
  Search,
  AlertCircle,
  Truck,
  User,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import {
  getFuelLogs,
  recordFuelRefill,
  getFacilityShifts,
  getDumpsiteMonitoring,
  unwrapList,
  unwrapPaginated,
} from '../../api/dumpsiteApi'
import FacilityWorkspaceHeader from './components/FacilityWorkspaceHeader'
import { useFacilityScope } from './components/useFacilityScope'
import ConfirmActionDialog from './components/ConfirmActionDialog'
import Pagination from '../../components/ui/Pagination'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { useNotification } from '../../context/NotificationContext'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

export default function FuelManagement() {
  const { notify } = useNotification()
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()

  const [logs, setLogs] = useState([])
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // Operator Refill Form (Truck & Driver resolved server-side from DriverShift)
  const [selectedShiftId, setSelectedShiftId] = useState('')
  const [litersAdded, setLitersAdded] = useState('')
  const [fuelCost, setFuelCost] = useState('')
  const [odometerKm, setOdometerKm] = useState('')
  const [notes, setNotes] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const loadShifts = useCallback(async () => {
    if (!siteId) return
    try {
      const [monRes, shiftRes] = await Promise.all([
        getDumpsiteMonitoring(siteId, { page_size: 50 }).catch(() => null),
        getFacilityShifts({ page_size: 50 }).catch(() => null),
      ])
      const monRows = Array.isArray(monRes?.results) ? monRes.results : []
      const shiftRows = unwrapList(shiftRes)

      const mergedMap = new Map()
      monRows.forEach((m) => {
        mergedMap.set(String(m.shift_id), {
          id: m.shift_id,
          truck_plate: m.truck?.plate_number || 'Unresolved Truck',
          truck_model: m.truck?.model || '',
          driver_name: m.driver?.full_name || 'Unknown Driver',
          schedule_name: m.schedule_name || `Schedule #${m.schedule_id || '--'}`,
          is_active: m.is_active,
          monitoring_state: m.monitoring_state,
          gauge_percentage: m.latest_fuel_log?.gauge_percentage ?? null,
        })
      })

      shiftRows.forEach((s) => {
        const sid = String(s.id)
        if (!mergedMap.has(sid)) {
          mergedMap.set(sid, {
            id: s.id,
            truck_plate: s.truck_plate || s.effective_truck_plate || (s.truck ? `Truck #${s.truck}` : 'Unresolved Truck'),
            truck_model: '',
            driver_name: s.driver_name || s.driver_username || 'Driver',
            schedule_name: s.schedule_area || (s.schedule ? `Schedule #${s.schedule}` : 'Route Shift'),
            is_active: s.is_active,
            monitoring_state: s.is_active ? 'active' : 'closed',
            gauge_percentage: null,
          })
        }
      })
      setShifts(Array.from(mergedMap.values()))
    } catch {
      setShifts([])
    }
  }, [siteId])

  const fetchLogs = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getFuelLogs({
        dumpsite_id: siteId,
        status: statusFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: debouncedSearch || undefined,
        page,
        page_size: 10,
      })
      const paged = unwrapPaginated(res, 10)
      setLogs(paged.results)
      setTotalCount(paged.count)
      setTotalPages(paged.total_pages)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load fuel logs.'))
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [siteId, statusFilter, dateFrom, dateTo, debouncedSearch, page])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    loadShifts()
    fetchLogs()
  }, [siteId, scopeLoading, loadShifts, fetchLogs])

  const selectedShift = useMemo(
    () => shifts.find((s) => String(s.id) === String(selectedShiftId)) || null,
    [shifts, selectedShiftId]
  )

  const handleOpenConfirm = (e) => {
    e.preventDefault()
    if (!selectedShiftId) {
      notify({ variant: 'error-outline', message: 'Select a DriverShift first.' })
      return
    }
    if (!litersAdded || Number(litersAdded) <= 0) {
      notify({ variant: 'error-outline', message: 'Liters added must be greater than 0.' })
      return
    }
    if (fuelCost === '' || Number(fuelCost) < 0) {
      notify({ variant: 'error-outline', message: 'Fuel cost must be 0 or greater.' })
      return
    }
    if (odometerKm === '' || Number(odometerKm) < 0) {
      notify({ variant: 'error-outline', message: 'Odometer reading must be 0 or greater.' })
      return
    }
    setConfirmOpen(true)
  }

  const handleRecordRefill = async () => {
    setSubmitting(true)
    try {
      // Strictly NO client truck_id sent — server resolves authoritative Truck & Dumpsite from DriverShift
      await recordFuelRefill({
        driver_shift_id: Number(selectedShiftId),
        liters_added: Number(litersAdded),
        fuel_cost: Number(fuelCost),
        odometer_km: Number(odometerKm),
        notes: notes.trim(),
      })
      notify({ variant: 'success', message: 'Fuel refill recorded against shift.' })
      setConfirmOpen(false)
      setLitersAdded('')
      setFuelCost('')
      setOdometerKm('')
      setNotes('')
      setSelectedShiftId('')
      await Promise.all([fetchLogs(), loadShifts()])
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to record fuel refill.') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Fuel Recording & History"
          subtitle="Record refill liters, cost, and odometer readings against a DriverShift alongside Driver-submitted fuel gauge percentages."
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

        {/* Record Fuel Refill Card */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '18px 20px', marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #e4e6eb' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1c1e21', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Fuel size={18} color="#16a34a" /> Record Fuel Refill (Operator Entry)
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#65676b' }}>
              Truck and Driver attribution are automatically resolved server-side from the selected DriverShift (no manual Truck ID override).
            </p>
          </div>

          <form onSubmit={handleOpenConfirm} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>DriverShift *</label>
              <select
                value={selectedShiftId}
                onChange={(e) => setSelectedShiftId(e.target.value)}
                required
                style={inputStyle}
              >
                <option value="">-- Select Facility DriverShift --</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    Shift #{s.id} · {s.truck_plate} · {s.driver_name} ({s.schedule_name})
                  </option>
                ))}
              </select>
            </div>

            {/* Read-only server-resolved Truck / Driver preview */}
            {selectedShift && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 18,
                  fontSize: 12.5,
                  color: '#4b5563',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Truck size={14} color="#2563eb" />
                  Authoritative Truck: <strong style={{ color: '#1c1e21' }}>{selectedShift.truck_plate}</strong>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <User size={14} color="#16a34a" />
                  Driver: <strong style={{ color: '#1c1e21' }}>{selectedShift.driver_name}</strong>
                </span>
                <span>
                  Driver Gauge Reading:{' '}
                  <strong style={{ color: '#7c3aed' }}>
                    {selectedShift.gauge_percentage != null ? `${selectedShift.gauge_percentage}%` : 'Not yet submitted'}
                  </strong>
                </span>
              </div>
            )}

            <div>
              <label style={labelStyle}>Liters Added *</label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={litersAdded}
                onChange={(e) => setLitersAdded(e.target.value)}
                placeholder="e.g. 45.5"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Fuel Cost *</label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={fuelCost}
                onChange={(e) => setFuelCost(e.target.value)}
                placeholder="e.g. 2850.00"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Odometer (km) *</label>
              <input
                type="number"
                required
                min="0"
                step="0.1"
                value={odometerKm}
                onChange={(e) => setOdometerKm(e.target.value)}
                placeholder="e.g. 42310"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Receipt ref or remarks..."
                style={inputStyle}
              />
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={submitting || !siteId}
                style={{
                  background: '#16a34a',
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
                <CheckCircle2 size={15} /> Record Fuel Refill
              </button>
            </div>
          </form>
        </div>

        {/* Filter Bar */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              style={{ ...inputStyle, width: 170 }}
            >
              <option value="">All Fuel Statuses</option>
              <option value="GAUGE_SUBMITTED">Gauge Submitted</option>
              <option value="REFILL_RECORDED">Refill Recorded</option>
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              style={{ ...inputStyle, width: 150 }}
              title="From date"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              style={{ ...inputStyle, width: 150 }}
              title="To date"
            />
          </div>

          <div style={{ position: 'relative' }}>
            <Search size={14} color="#65676b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search truck plate, driver, notes..."
              style={{ height: 36, width: 240, paddingLeft: 32, paddingRight: 10, borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5 }}
            />
          </div>
        </div>

        {/* Fuel Logs Table */}
        {loading || scopeLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : logs.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #ced0d4', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: '#65676b' }}>
            <Fuel size={36} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', marginBottom: 4 }}>No fuel logs found</div>
            <div style={{ fontSize: 13 }}>Driver gauge submissions and Operator refill entries appear here.</div>
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e4e6eb', textAlign: 'left', color: '#65676b', fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px 16px' }}>Shift & Truck</th>
                    <th style={{ padding: '10px 16px' }}>Driver Gauge %</th>
                    <th style={{ padding: '10px 16px' }}>Liters Added</th>
                    <th style={{ padding: '10px 16px' }}>Fuel Cost</th>
                    <th style={{ padding: '10px 16px' }}>Odometer</th>
                    <th style={{ padding: '10px 16px' }}>Recorded Info</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid #f0f2f5' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 700, color: '#1c1e21', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Truck size={14} color="#2563eb" /> {l.truck_plate || `Truck #${l.truck}`}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#65676b', marginTop: 2 }}>
                          Shift #{l.driver_shift} · {l.driver_name || 'Driver'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#7c3aed' }}>
                        {l.gauge_percentage != null ? `${l.gauge_percentage}%` : '--'}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#15803d' }}>
                        {l.liters_added != null ? `${Number(l.liters_added).toLocaleString()} L` : '--'}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1c1e21' }}>
                        {l.fuel_cost != null ? `PHP ${Number(l.fuel_cost).toLocaleString()}` : '--'}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#4b5563' }}>
                        {l.odometer_km != null ? `${Number(l.odometer_km).toLocaleString()} km` : '--'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: '#65676b' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={11} />
                          {l.recorded_at || l.refill_recorded_at || l.gauge_submitted_at || l.created_at
                            ? new Date(l.recorded_at || l.refill_recorded_at || l.gauge_submitted_at || l.created_at).toLocaleString()
                            : '--'}
                        </div>
                        {l.notes && <div style={{ color: '#1c1e21', marginTop: 2 }}>{l.notes}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Pagination currentPage={page} totalPages={totalPages} totalCount={totalCount} pageSize={10} onPageChange={setPage} loading={loading} />

        <ConfirmActionDialog
          open={confirmOpen}
          title="Confirm Fuel Refill Entry"
          description={`Record ${litersAdded} L (cost ${fuelCost}, odometer ${odometerKm} km) for Shift #${selectedShiftId} (${selectedShift?.truck_plate || 'Server-resolved truck'})?`}
          confirmLabel="Record Refill"
          variant="primary"
          requireNotes={false}
          submitting={submitting}
          onConfirm={handleRecordRefill}
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
