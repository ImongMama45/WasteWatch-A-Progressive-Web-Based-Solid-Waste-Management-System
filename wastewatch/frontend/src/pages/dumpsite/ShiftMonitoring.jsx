import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  Search,
  Truck,
  User,
  Clock,
  ClipboardCheck,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Fuel,
  Calendar,
} from 'lucide-react'
import { getDumpsiteMonitoring, unwrapPaginated } from '../../api/dumpsiteApi'
import FacilityWorkspaceHeader from './components/FacilityWorkspaceHeader'
import { useFacilityScope } from './components/useFacilityScope'
import {
  ConditionBadge,
  HoldBadge,
  MaintenanceBadge,
  InspectionBadge,
} from './components/TruckStatusPills'
import Pagination from '../../components/ui/Pagination'
import { StatCardSkeleton, TableSkeleton } from '../../components/ui/Skeleton'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

const STATE_TABS = [
  { key: 'all', label: 'All Shifts' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'operating', label: 'Operating' },
  { key: 'returning', label: 'Returning' },
  { key: 'shift_completed', label: 'Shift Completed' },
  { key: 'awaiting_post_shift_inspection', label: 'Awaiting Inspection' },
]

const STATE_BADGE = {
  preparing: { label: 'Preparing', color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe' },
  operating: { label: 'Operating', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  returning: { label: 'Returning', color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe' },
  shift_completed: { label: 'Shift Completed', color: '#374151', bg: '#f3f4f6', border: '#d1d5db' },
  awaiting_post_shift_inspection: { label: 'Awaiting Post-Shift Inspection', color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
}

export default function ShiftMonitoring() {
  const navigate = useNavigate()
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [stateFilter, setStateFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({})
  const [awaitingTrucks, setAwaitingTrucks] = useState([])
  const [operationalDate, setOperationalDate] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const fetchMonitoring = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getDumpsiteMonitoring(siteId, {
        date,
        state: stateFilter,
        search: debouncedSearch || undefined,
        page,
        page_size: 10,
      })
      const paged = unwrapPaginated(res, 10)
      setRows(paged.results)
      setTotalCount(paged.count)
      setTotalPages(paged.total_pages)
      setCounts(res?.counts || {})
      setAwaitingTrucks(Array.isArray(res?.awaiting_inspection_trucks) ? res.awaiting_inspection_trucks : [])
      setOperationalDate(res?.operational_date || date)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load incoming truck and driver shift monitoring.'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [siteId, date, stateFilter, debouncedSearch, page])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    fetchMonitoring()
  }, [siteId, scopeLoading, fetchMonitoring])

  const totalShiftsCount =
    (counts.preparing || 0) +
    (counts.operating || 0) +
    (counts.returning || 0) +
    (counts.shift_completed || 0) +
    (counts.awaiting_post_shift_inspection || 0)

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Incoming Truck & Driver Shift Monitoring"
          subtitle="Read-only operational visibility across preparing, operating, returning, completed, and post-shift inspection states."
          sites={sites}
          siteId={siteId}
          onSiteChange={(next) => { setSiteId(next); setPage(1) }}
          activeSite={activeSite}
          isAdmin={isAdmin}
          operationalDate={operationalDate || date}

        />

        {(scopeError || error) && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            <AlertCircle size={16} />
            <span>{scopeError || error}</span>
          </div>
        )}

        {/* Read-only policy notice */}
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <span>
            <strong>Monitoring Policy:</strong> Drivers control shift start and conclusion. Operators monitor shift progress here and perform post-shift truck inspections after shift conclusion.
          </span>
          <button
            type="button"
            onClick={() => navigate('/dumpsite/inspections')}
            style={{ background: '#1d4ed8', color: '#ffffff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ClipboardCheck size={14} /> Go to Post-Shift Inspections
          </button>
        </div>

        {/* Counts Strip */}
        {loading && !rows.length ? (
          <StatCardSkeleton count={5} style={{ marginBottom: 16 }} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { key: 'preparing', label: 'Preparing', count: counts.preparing ?? 0, color: '#4338ca' },
              { key: 'operating', label: 'Operating', count: counts.operating ?? 0, color: '#15803d' },
              { key: 'returning', label: 'Returning', count: counts.returning ?? 0, color: '#1d4ed8' },
              { key: 'shift_completed', label: 'Shift Completed', count: counts.shift_completed ?? 0, color: '#374151' },
              { key: 'awaiting_post_shift_inspection', label: 'Awaiting Inspection', count: counts.awaiting_post_shift_inspection ?? 0, color: '#b45309' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => { setStateFilter(item.key); setPage(1) }}
                style={{
                  background: '#ffffff',
                  border: stateFilter === item.key ? `1.5px solid ${item.color}` : '1px solid #e4e6eb',
                  borderRadius: 8,
                  padding: '12px 14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: item.color, marginTop: 4 }}>{item.count}</div>
              </button>
            ))}
          </div>
        )}

        {/* Awaiting Post-Shift Inspection Trucks Alert */}
        {awaitingTrucks.length > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#92400e', fontSize: 13, fontWeight: 700 }}>
                <ClipboardCheck size={16} />
                <span>{awaitingTrucks.length} truck(s) awaiting post-shift inspection at this facility</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {awaitingTrucks.slice(0, 6).map((t) => (
                  <button
                    key={t.id || t.truck_id}
                    type="button"
                    onClick={() => navigate(`/dumpsite/inspections?truck_id=${t.id || t.truck_id}`)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #fcd34d',
                      color: '#92400e',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {t.plate_number}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STATE_TABS.map((tab) => {
              const active = stateFilter === tab.key
              const badgeCount = tab.key === 'all' ? totalShiftsCount : (counts[tab.key] ?? 0)
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setStateFilter(tab.key); setPage(1) }}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: active ? '1px solid #bbf7d0' : '1px solid #e4e6eb',
                    background: active ? '#e7f5eb' : '#f8fafc',
                    color: active ? '#15803d' : '#4b5563',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {tab.label}
                  <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>({badgeCount})</span>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Calendar size={14} color="#65676b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setPage(1) }}
                style={{ height: 36, paddingLeft: 32, paddingRight: 10, borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5, color: '#1c1e21', background: '#ffffff' }}
              />
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={14} color="#65676b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search plate, driver, schedule..."
                style={{ height: 36, width: 230, paddingLeft: 32, paddingRight: 10, borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5, color: '#1c1e21', background: '#ffffff' }}
              />
            </div>
          </div>
        </div>

        {/* Monitoring List */}
        {loading || scopeLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : rows.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #ced0d4', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: '#65676b' }}>
            <Activity size={36} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', marginBottom: 4 }}>No shifts match the selected filters</div>
            <div style={{ fontSize: 13 }}>Try changing the operational date, state tab, or search query.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((item) => {
              const badge = STATE_BADGE[item.monitoring_state] || {
                label: String(item.monitoring_state || 'Unknown').replace(/_/g, ' '),
                color: '#4b5563',
                bg: '#f3f4f6',
                border: '#e5e7eb',
              }
              const truck = item.truck || {}
              const driver = item.driver || {}
              return (
                <div
                  key={item.shift_id}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e4e6eb',
                    borderRadius: 10,
                    padding: '16px 18px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Truck size={20} />
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21' }}>
                            {truck.plate_number || 'Unassigned Truck'}
                          </span>
                          <span style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                            {badge.label}
                          </span>
                          {item.is_active ? (
                            <span style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
                              ACTIVE SHIFT
                            </span>
                          ) : (
                            <span style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
                              CLOSED
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, color: '#65676b', marginTop: 3, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <User size={13} /> {driver.full_name || 'Unknown Driver'}
                          </span>
                          <span>· Schedule: <strong style={{ color: '#1c1e21' }}>{item.schedule_name || `#${item.schedule_id || '--'}`}</strong></span>
                          {truck.model && <span>· {truck.model}</span>}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, fontSize: 12, color: '#65676b' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} /> Started: {item.started_at ? new Date(item.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}
                      </span>
                      {item.ended_at && (
                        <span>
                          Ended: {new Date(item.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {item.end_shift_phase && (
                        <span style={{ fontSize: 11, color: '#4b5563' }}>Phase: {item.end_shift_phase}</span>
                      )}
                    </div>
                  </div>

                  {/* Truck Condition & Latest Inspection / Fuel Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingTop: 10, borderTop: '1px solid #f0f2f5' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <ConditionBadge condition={truck.mechanical_condition} />
                      <InspectionBadge state={truck.inspection_state} />
                      <HoldBadge isHeld={truck.is_operational_hold} />
                      <MaintenanceBadge status={truck.maintenance_status} />
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {item.latest_fuel_log && (
                        <span style={{ fontSize: 11.5, color: '#6b21a8', background: '#f3e8ff', border: '1px solid #ddd6fe', borderRadius: 4, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                          <Fuel size={12} />
                          {item.latest_fuel_log.gauge_percentage != null ? `${item.latest_fuel_log.gauge_percentage}% gauge` : 'Fuel logged'}
                          {item.latest_fuel_log.liters_added != null ? ` · ${item.latest_fuel_log.liters_added}L` : ''}
                        </span>
                      )}

                      {item.latest_inspection ? (
                        <span style={{ fontSize: 11.5, color: '#15803d', background: '#e7f5eb', border: '1px solid #bbf7d0', borderRadius: 4, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                          <CheckCircle2 size={12} /> Inspected: {item.latest_inspection.inspection_state}
                        </span>
                      ) : item.monitoring_state === 'awaiting_post_shift_inspection' ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/dumpsite/inspections?shift_id=${item.shift_id}&truck_id=${truck.id || ''}`)}
                          style={{
                            background: '#d97706',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '6px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <ClipboardCheck size={13} /> Record Post-Shift Inspection
                        </button>
                      ) : null}

                      {truck.is_operational_hold && (
                        <button
                          type="button"
                          onClick={() => navigate('/dumpsite/holds')}
                          style={{
                            background: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fecaca',
                            borderRadius: 6,
                            padding: '5px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <ShieldAlert size={13} /> View Hold
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
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
      </div>
    </div>
  )
}
