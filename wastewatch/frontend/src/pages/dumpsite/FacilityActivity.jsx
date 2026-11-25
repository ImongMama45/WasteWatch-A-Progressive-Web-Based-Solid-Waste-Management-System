import { useState, useEffect, useCallback } from 'react'
import {
  History,
  Search,
  AlertCircle,
  Clock,
  Truck,
  User,
} from 'lucide-react'
import {
  getDumpsiteActivity,
  getFacilityTrucks,
  unwrapList,
  unwrapPaginated,
} from '../../api/dumpsiteApi'
import FacilityWorkspaceHeader from './components/FacilityWorkspaceHeader'
import { useFacilityScope } from './components/useFacilityScope'
import Pagination from '../../components/ui/Pagination'
import { FeedCardSkeleton } from '../../components/ui/Skeleton'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

const CATEGORIES = [
  { key: 'all', label: 'All Activity' },
  { key: 'shift', label: 'Shifts' },
  { key: 'delivery', label: 'Deliveries' },
  { key: 'inspection', label: 'Inspections' },
  { key: 'hold', label: 'Operational Holds' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'allocation', label: 'Allocations' },
]

const CAT_BADGE = {
  shift: { label: 'Shift', color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe' },
  delivery: { label: 'Delivery', color: '#0f766e', bg: '#ccfbf1', border: '#99f6e4' },
  inspection: { label: 'Inspection', color: '#15803d', bg: '#e7f5eb', border: '#bbf7d0' },
  hold: { label: 'Hold', color: '#b91c1c', bg: '#fee2e2', border: '#fecaca' },
  maintenance: { label: 'Maintenance', color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  fuel: { label: 'Fuel', color: '#7c3aed', bg: '#f3e8ff', border: '#ddd6fe' },
  allocation: { label: 'Allocation', color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe' },
}

export default function FacilityActivity() {
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()

  const [events, setEvents] = useState([])
  const [trucks, setTrucks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [category, setCategory] = useState('all')
  const [truckId, setTruckId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!siteId) return
    getFacilityTrucks({ paginate: false })
      .then((raw) => setTrucks(unwrapList(raw)))
      .catch(() => { })
  }, [siteId])

  const fetchActivity = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getDumpsiteActivity(siteId, {
        category,
        truck_id: truckId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: debouncedSearch || undefined,
        page,
        page_size: 10,
      })
      const paged = unwrapPaginated(res, 10)
      setEvents(paged.results)
      setTotalCount(paged.count)
      setTotalPages(paged.total_pages)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load facility activity timeline.'))
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [siteId, category, truckId, dateFrom, dateTo, debouncedSearch, page])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    fetchActivity()
  }, [siteId, scopeLoading, fetchActivity])

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Facility Activity History"
          subtitle="Unified audit timeline across facility shifts, deliveries, inspections, operational holds, maintenance, fuel, and allocations."
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

        {/* Category Pills + Filter Controls */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map((cat) => {
              const active = category === cat.key
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => { setCategory(cat.key); setPage(1) }}
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
                  {cat.label}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={truckId}
                onChange={(e) => { setTruckId(e.target.value); setPage(1) }}
                style={{ height: 36, minWidth: 180, padding: '0 10px', borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5, background: '#ffffff' }}
              >
                <option value="">All Facility Trucks</option>
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>{t.plate_number} — {t.model}</option>
                ))}
              </select>

              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                style={{ height: 36, padding: '0 10px', borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5 }}
                title="From date"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                style={{ height: 36, padding: '0 10px', borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5 }}
                title="To date"
              />
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={14} color="#65676b" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search action, summary, actor, plate..."
                style={{ height: 36, width: 250, paddingLeft: 32, paddingRight: 10, borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5 }}
              />
            </div>
          </div>
        </div>

        {/* Timeline */}
        {loading || scopeLoading ? (
          <FeedCardSkeleton count={5} compact />
        ) : events.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #ced0d4', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: '#65676b' }}>
            <History size={36} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', marginBottom: 4 }}>No facility activity found</div>
            <div style={{ fontSize: 13 }}>Try broadening your category, truck, or date filters.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {events.map((ev) => {
              const badge = CAT_BADGE[ev.category] || {
                label: ev.category || 'Event',
                color: '#4b5563',
                bg: '#f3f4f6',
                border: '#e5e7eb',
              }
              return (
                <div
                  key={ev.id}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e4e6eb',
                    borderRadius: 10,
                    padding: '14px 18px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 360px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase' }}>
                        {badge.label}
                      </span>
                      {ev.truck_plate && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, color: '#1c1e21' }}>
                          <Truck size={13} color="#2563eb" /> {ev.truck_plate}
                        </span>
                      )}
                      {ev.action && (
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: '#65676b' }}>
                          · {ev.action}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1c1e21' }}>
                      {ev.summary || ev.action || 'Facility event'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, fontSize: 12, color: '#65676b' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <User size={12} /> {ev.actor_name || 'System'}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Clock size={12} /> {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '--'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <Pagination currentPage={page} totalPages={totalPages} totalCount={totalCount} pageSize={10} onPageChange={setPage} loading={loading} />
      </div>
    </div>
  )
}
