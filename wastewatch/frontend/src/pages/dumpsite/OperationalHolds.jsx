import { useState, useEffect, useCallback } from 'react'
import {
  ShieldAlert,
  CheckCircle2,
  Search,
  AlertCircle,
  Truck,
  User,
  Clock,
} from 'lucide-react'
import {
  getTruckHolds,
  clearTruckHold,
  unwrapPaginated,
} from '../../api/dumpsiteApi'
import FacilityWorkspaceHeader from './components/FacilityWorkspaceHeader'
import { useFacilityScope } from './components/useFacilityScope'
import ConfirmActionDialog from './components/ConfirmActionDialog'
import Pagination from '../../components/ui/Pagination'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { useNotification } from '../../context/NotificationContext'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

export default function OperationalHolds() {
  const { notify } = useNotification()
  const { sites, siteId, setSiteId, activeSite, isAdmin, loading: scopeLoading, error: scopeError } = useFacilityScope()

  const [holds, setHolds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [activeFilter, setActiveFilter] = useState('true') // 'true' | 'false' | 'all'
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [clearTarget, setClearTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const fetchHolds = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getTruckHolds({
        dumpsite_id: siteId,
        is_active: activeFilter === 'all' ? undefined : activeFilter,
        search: debouncedSearch || undefined,
        page,
        page_size: 10,
      })
      const paged = unwrapPaginated(res, 10)
      setHolds(paged.results)
      setTotalCount(paged.count)
      setTotalPages(paged.total_pages)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load operational holds.'))
      setHolds([])
    } finally {
      setLoading(false)
    }
  }, [siteId, activeFilter, debouncedSearch, page])

  useEffect(() => {
    if (!siteId) {
      if (!scopeLoading) setLoading(false)
      return
    }
    fetchHolds()
  }, [siteId, scopeLoading, fetchHolds])

  const handleClearHold = async (resolutionNotes) => {
    if (!clearTarget) return
    setSubmitting(true)
    try {
      await clearTruckHold(clearTarget.truck, { resolution_notes: resolutionNotes })
      notify({
        variant: 'success',
        message: `Operational hold cleared for ${clearTarget.truck_plate || `Truck #${clearTarget.truck}`}. Audit history preserved.`,
      })
      setClearTarget(null)
      await fetchHolds()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to clear operational hold.') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ background: '#f0f2f5', minHeight: '100vh', padding: '20px 24px 60px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <FacilityWorkspaceHeader
          title="Operational Holds & Audit History"
          subtitle="Manage active facility holds blocking truck dispatch and review preserved clearance audit history."
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

        {/* Filter & Search Bar */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e6eb', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { key: 'true', label: 'Active Holds' },
              { key: 'false', label: 'Cleared History' },
              { key: 'all', label: 'All Hold Logs' },
            ].map((tab) => {
              const active = activeFilter === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setActiveFilter(tab.key); setPage(1) }}
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
              placeholder="Search truck plate, reason, notes..."
              style={{ height: 36, width: 250, paddingLeft: 32, paddingRight: 10, borderRadius: 6, border: '1px solid #ced0d4', fontSize: 12.5 }}
            />
          </div>
        </div>

        {loading || scopeLoading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : holds.length === 0 ? (
          <div style={{ background: '#ffffff', border: '1px dashed #ced0d4', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: '#65676b' }}>
            <ShieldAlert size={36} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1e21', marginBottom: 4 }}>No operational hold records found</div>
            <div style={{ fontSize: 13 }}>
              {activeFilter === 'true'
                ? 'No trucks at this facility are currently placed on operational hold.'
                : 'No hold audit entries match your filter.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {holds.map((h) => (
              <div
                key={h.id}
                style={{
                  background: '#ffffff',
                  border: h.is_active ? '1px solid #fecaca' : '1px solid #e4e6eb',
                  borderLeft: h.is_active ? '4px solid #dc2626' : '4px solid #16a34a',
                  borderRadius: 10,
                  padding: '16px 18px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 15, fontWeight: 700, color: '#1c1e21' }}>
                        <Truck size={16} color={h.is_active ? '#dc2626' : '#16a34a'} />
                        {h.truck_plate || `Truck #${h.truck}`}
                      </span>
                      {h.is_active ? (
                        <span style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ShieldAlert size={11} /> ACTIVE HOLD (DISPATCH BLOCKED)
                        </span>
                      ) : (
                        <span style={{ background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 size={11} /> CLEARED
                        </span>
                      )}
                      {h.inspection_id && (
                        <span style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>
                          Inspection #{h.inspection_id}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: '#1c1e21', fontWeight: 500, marginTop: 6 }}>
                      <strong>Hold Reason:</strong> {h.reason || 'Operational hold placed'}
                    </div>
                  </div>

                  {h.is_active && (
                    <button
                      type="button"
                      onClick={() => setClearTarget(h)}
                      style={{
                        background: '#16a34a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 6,
                        padding: '8px 14px',
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <CheckCircle2 size={14} /> Clear Operational Hold
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: '#65676b', paddingTop: 8, borderTop: '1px solid #f0f2f5' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <User size={12} /> Placed by: <strong style={{ color: '#1c1e21' }}>{h.placed_by_name || 'System'}</strong>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={12} /> Placed at: {h.placed_at ? new Date(h.placed_at).toLocaleString() : '--'}
                  </span>
                  {!h.is_active && (
                    <>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <User size={12} /> Cleared by: <strong style={{ color: '#15803d' }}>{h.cleared_by_name || 'Operator'}</strong>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Clock size={12} /> Cleared at: {h.cleared_at ? new Date(h.cleared_at).toLocaleString() : '--'}
                      </span>
                    </>
                  )}
                </div>

                {!h.is_active && h.resolution_notes && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, color: '#1c1e21' }}>
                    <strong>Resolution Notes:</strong> {h.resolution_notes}
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
          open={Boolean(clearTarget)}
          title={`Clear Operational Hold — ${clearTarget?.truck_plate || ''}`}
          description="Clearing this hold restores dispatch eligibility if no other blockers (maintenance or retirement) exist. The hold audit log entry will be permanently preserved."
          confirmLabel="Clear Hold"
          variant="primary"
          requireNotes={true}
          notesLabel="Resolution Notes"
          notesPlaceholder="Describe verification or corrective action completed before releasing this truck..."
          submitting={submitting}
          onConfirm={handleClearHold}
          onCancel={() => setClearTarget(null)}
        />
      </div>
    </div>
  )
}
