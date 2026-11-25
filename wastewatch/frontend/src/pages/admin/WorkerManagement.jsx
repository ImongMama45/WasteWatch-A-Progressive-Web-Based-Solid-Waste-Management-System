import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  Search,
  X,
  Edit2,
  GitMerge,
  RefreshCw,
  AlertTriangle,
  History
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import Pagination from '../../components/ui/Pagination'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import api from '../../api/client'
import { getWorkerAttendanceHistory } from '../../api/driverWorkflowApi'
import { getApiErrorMessage } from '../../utils/notificationHelpers'

const PAGE_SIZE = 10

const modalBackdropStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.55)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
  overflowY: 'auto',
  zIndex: 9999
}

const modalDialogStyle = {
  backgroundColor: 'var(--card-bg, #ffffff)',
  padding: '1.5rem',
  borderRadius: '0.75rem',
  width: '100%',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  margin: 'auto',
  border: '1px solid var(--border, #e5e7eb)',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
}

export default function WorkerManagement() {
  const { user } = useAuth()
  const { notify } = useNotification()

  const showNotification = useCallback((message, type = 'info') => {
    const variant = type === 'error' ? 'error-soft' : type === 'success' ? 'success' : 'neutral'
    if (notify) {
      notify({ message, variant })
    }
  }, [notify])

  const [activeTab, setActiveTab] = useState('workers') // 'workers' | 'quarantine'
  const [workers, setWorkers] = useState([])
  const [allActiveWorkers, setAllActiveWorkers] = useState([])
  const [reconciliations, setReconciliations] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all' | 'authenticated' | 'non_login' | 'provisional'
  const [filterStatus, setFilterStatus] = useState('all') // 'all' | 'active' | 'inactive'

  // Pagination States (max 10 entities per page)
  const [workersPage, setWorkersPage] = useState(1)
  const [workersTotalPages, setWorkersTotalPages] = useState(1)
  const [workersTotalCount, setWorkersTotalCount] = useState(0)

  const [reconPage, setReconPage] = useState(1)
  const [reconTotalPages, setReconTotalPages] = useState(1)
  const [reconTotalCount, setReconTotalCount] = useState(0)
  const [pendingReconCount, setPendingReconCount] = useState(0)

  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newEmployeeId, setNewEmployeeId] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newUserId, setNewUserId] = useState('')
  const [availableUsers, setAvailableUsers] = useState([])

  const [editWorker, setEditWorker] = useState(null)
  const [updatedEmployeeId, setUpdatedEmployeeId] = useState('')

  const [mergeWorker, setMergeWorker] = useState(null)
  const [targetWorkerId, setTargetWorkerId] = useState('')
  const [mergeNotes, setMergeNotes] = useState('')

  const [selectedAudit, setSelectedAudit] = useState(null)
  const [reconcileAction, setReconcileAction] = useState('PROMOTE')
  const [reconcileEmployeeId, setReconcileEmployeeId] = useState('')
  const [reconcileTargetId, setReconcileTargetId] = useState('')
  const [reconcileNotes, setReconcileNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [historyWorker, setHistoryWorker] = useState(null)
  const [workerHistoryData, setWorkerHistoryData] = useState(null)
  const [workerHistoryLoading, setWorkerHistoryLoading] = useState(false)

  const openWorkerHistory = useCallback(async (workerObj) => {
    setHistoryWorker(workerObj)
    setWorkerHistoryData(null)
    setWorkerHistoryLoading(true)
    try {
      const data = await getWorkerAttendanceHistory(workerObj.id)
      setWorkerHistoryData(data)
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to load worker attendance history'), 'error')
    } finally {
      setWorkerHistoryLoading(false)
    }
  }, [showNotification])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setWorkersPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const fetchWorkers = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        page: workersPage,
        page_size: PAGE_SIZE
      }
      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim()
      }
      if (filterType !== 'all') {
        params.worker_type = filterType
      }
      if (filterStatus === 'active') {
        params.is_active = 'true'
      } else if (filterStatus === 'inactive') {
        params.is_active = 'false'
      }

      const workersRes = await api.get('/api/driver/workers/', { params })
      const data = workersRes.data
      if (data && Array.isArray(data.results)) {
        setWorkers(data.results)
        setWorkersTotalCount(data.count ?? data.results.length)
        setWorkersTotalPages(data.total_pages ?? Math.max(1, Math.ceil((data.count ?? data.results.length) / PAGE_SIZE)))
      } else {
        const workerList = Array.isArray(data) ? data : []
        setWorkers(workerList.slice(0, PAGE_SIZE))
        setWorkersTotalCount(workerList.length)
        setWorkersTotalPages(Math.max(1, Math.ceil(workerList.length / PAGE_SIZE)))
      }
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to load worker management data.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [workersPage, debouncedSearch, filterType, filterStatus, showNotification])

  const fetchReconciliations = useCallback(async () => {
    try {
      const [reconRes, pendingRes] = await Promise.all([
        api.get('/api/driver/worker-reconciliations/', { params: { page: reconPage, page_size: PAGE_SIZE } }),
        api.get('/api/driver/worker-reconciliations/', { params: { status: 'PENDING_REVIEW', page_size: 1 } }).catch(() => null)
      ])
      const data = reconRes.data
      if (data && Array.isArray(data.results)) {
        setReconciliations(data.results)
        setReconTotalCount(data.count ?? data.results.length)
        setReconTotalPages(data.total_pages ?? Math.max(1, Math.ceil((data.count ?? data.results.length) / PAGE_SIZE)))
      } else {
        const reconList = Array.isArray(data) ? data : []
        setReconciliations(reconList.slice(0, PAGE_SIZE))
        setReconTotalCount(reconList.length)
        setReconTotalPages(Math.max(1, Math.ceil(reconList.length / PAGE_SIZE)))
      }

      if (pendingRes?.data) {
        setPendingReconCount(pendingRes.data.count ?? (Array.isArray(pendingRes.data) ? pendingRes.data.length : 0))
      }
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to load reconciliation records.'), 'error')
    }
  }, [reconPage, showNotification])

  const fetchUsers = useCallback(async () => {
    try {
      const usersRes = await api.get('/api/accounts/users/?page_size=200').catch(() => ({ data: { results: [] } }))
      const uList = Array.isArray(usersRes.data)
        ? usersRes.data
        : (usersRes.data?.results || [])
      setAvailableUsers(uList)
    } catch {
      // Non-blocking
    }
  }, [])

  const fetchData = useCallback(async () => {
    await Promise.all([fetchWorkers(), fetchReconciliations()])
  }, [fetchWorkers, fetchReconciliations])

  useEffect(() => {
    fetchWorkers()
  }, [fetchWorkers])

  useEffect(() => {
    fetchReconciliations()
  }, [fetchReconciliations])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    if (!mergeWorker && !selectedAudit) return
    api.get('/api/driver/workers/?is_active=true&all=true')
      .then((res) => {
        setAllActiveWorkers(res.data?.results || res.data || [])
      })
      .catch(() => {
        setAllActiveWorkers(workers.filter(w => w.is_active))
      })
  }, [mergeWorker, selectedAudit, workers])

  const handleCreateWorker = async (e) => {
    e.preventDefault()
    if (!newEmployeeId.trim() || !newFullName.trim()) return
    setSubmitting(true)
    try {
      const payload = {
        employee_id: newEmployeeId.trim(),
        full_name: newFullName.trim(),
        user: newUserId ? parseInt(newUserId, 10) : null,
        is_active: true
      }
      await api.post('/api/driver/workers/', payload)
      showNotification('Worker profile created successfully.', 'success')
      setShowCreateModal(false)
      setNewEmployeeId('')
      setNewFullName('')
      setNewUserId('')
      fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to create worker.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateEmployeeId = async (e) => {
    e.preventDefault()
    if (!editWorker || !updatedEmployeeId.trim()) return
    setSubmitting(true)
    try {
      await api.post(`/api/driver/workers/${editWorker.id}/update-employee-id/`, {
        new_employee_id: updatedEmployeeId.trim()
      })
      showNotification('Employee ID updated successfully.', 'success')
      setEditWorker(null)
      setUpdatedEmployeeId('')
      fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to update employee ID.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMergeWorkers = async (e) => {
    e.preventDefault()
    if (!mergeWorker || !targetWorkerId) return
    setSubmitting(true)
    try {
      await api.post(`/api/driver/workers/${mergeWorker.id}/merge/`, {
        target_worker_id: parseInt(targetWorkerId, 10),
        notes: mergeNotes
      })
      showNotification('Worker successfully merged.', 'success')
      setMergeWorker(null)
      setTargetWorkerId('')
      setMergeNotes('')
      fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to merge worker.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResolveReconciliation = async (e) => {
    e.preventDefault()
    if (!selectedAudit) return
    setSubmitting(true)
    try {
      const payload = {
        action: reconcileAction,
        notes: reconcileNotes,
        target_worker_id: reconcileAction === 'MERGE' ? parseInt(reconcileTargetId, 10) : undefined,
        new_employee_id: reconcileAction === 'PROMOTE' ? reconcileEmployeeId.trim() : undefined
      }
      await api.post(`/api/driver/worker-reconciliations/${selectedAudit.id}/resolve/`, payload)
      showNotification('Reconciliation decision recorded.', 'success')
      setSelectedAudit(null)
      setReconcileEmployeeId('')
      setReconcileTargetId('')
      setReconcileNotes('')
      fetchData()
    } catch (err) {
      showNotification(getApiErrorMessage(err, 'Failed to resolve reconciliation.'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DashboardLayout title="Personnel & Worker Management" subtitle="Manage canonical workers, non-login crew, and legacy reconciliation">
      <div style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>

        {/* Top Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text, #111827)', margin: 0 }}>
              Personnel & Worker Registry
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #6b7280)', margin: '0.25rem 0 0' }}>
              Canonical identity system decoupling human field workers from system accounts.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={fetchData}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.875rem',
                backgroundColor: 'var(--card-bg, #ffffff)',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: '0.375rem',
                color: 'var(--text, #374151)',
                cursor: 'pointer',
                fontWeight: '500',
                fontSize: '0.875rem'
              }}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                backgroundColor: '#16a34a',
                border: 'none',
                borderRadius: '0.375rem',
                color: '#ffffff',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.875rem'
              }}
            >
              <Plus size={16} /> New Worker
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border, #e5e7eb)', marginBottom: '1.5rem' }}>
          <button
            onClick={() => setActiveTab('workers')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.25rem',
              border: 'none',
              borderBottom: activeTab === 'workers' ? '2px solid #16a34a' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: activeTab === 'workers' ? '#16a34a' : 'var(--text-muted, #6b7280)',
              fontWeight: activeTab === 'workers' ? '600' : '500',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Canonical Workers ({workersTotalCount})
          </button>
          <button
            onClick={() => setActiveTab('quarantine')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.25rem',
              border: 'none',
              borderBottom: activeTab === 'quarantine' ? '2px solid #f59e0b' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: activeTab === 'quarantine' ? '#f59e0b' : 'var(--text-muted, #6b7280)',
              fontWeight: activeTab === 'quarantine' ? '600' : '500',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Legacy Crew Quarantine ({pendingReconCount})
          </button>
        </div>

        {/* Tab 1: Canonical Workers */}
        {activeTab === 'workers' && (
          <div>
            {/* Filter Bar */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1', minWidth: '240px' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  type="text"
                  placeholder="Search by name, employee ID, or username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem 0.5rem 2.25rem',
                    border: '1px solid var(--border, #d1d5db)',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    backgroundColor: 'var(--card-bg, #ffffff)',
                    color: 'var(--text, #111827)'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <select
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value)
                    setWorkersPage(1)
                  }}
                  style={{
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--border, #d1d5db)',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    backgroundColor: 'var(--card-bg, #ffffff)',
                    color: 'var(--text, #111827)'
                  }}
                >
                  <option value="all">All Personnel Types</option>
                  <option value="authenticated">Authenticated (User Linked)</option>
                  <option value="non_login">Non-Login Crew</option>
                  <option value="provisional">Provisional (Quarantined)</option>
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value)
                    setWorkersPage(1)
                  }}
                  style={{
                    padding: '0.5rem 0.75rem',
                    border: '1px solid var(--border, #d1d5db)',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    backgroundColor: 'var(--card-bg, #ffffff)',
                    color: 'var(--text, #111827)'
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div style={{ backgroundColor: 'var(--card-bg, #ffffff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: '0.5rem', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--table-header, #f9fafb)', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Employee ID</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Full Name</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Linked User Account</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Type</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Status</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                        Loading workers...
                      </td>
                    </tr>
                  ) : workers.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                        No worker records match your search criteria.
                      </td>
                    </tr>
                  ) : (
                    workers.map((w) => (
                      <tr key={w.id} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#111827' }}>
                          <span style={{ fontFamily: 'monospace', backgroundColor: '#f3f4f6', padding: '0.125rem 0.375rem', borderRadius: '0.25rem' }}>
                            {w.employee_id}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: '#111827' }}>{w.full_name}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          {w.user ? (
                            <span style={{ color: '#2563eb', fontWeight: '500' }}>
                              @{w.user_username} ({w.user_role})
                            </span>
                          ) : (
                            <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Non-Login Personnel</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          {w.is_provisional ? (
                            <span style={{ padding: '0.125rem 0.5rem', backgroundColor: '#fef3c7', color: '#b45309', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: '600' }}>
                              Provisional
                            </span>
                          ) : w.user ? (
                            <span style={{ padding: '0.125rem 0.5rem', backgroundColor: '#dbeafe', color: '#1d4ed8', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: '600' }}>
                              Authenticated
                            </span>
                          ) : (
                            <span style={{ padding: '0.125rem 0.5rem', backgroundColor: '#e5e7eb', color: '#374151', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: '600' }}>
                              Crew
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          {w.is_active ? (
                            <span style={{ color: '#16a34a', fontWeight: '500' }}>
                              Active
                            </span>
                          ) : (
                            <span style={{ color: '#dc2626', fontWeight: '500' }}>
                              Deactivated
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                            <button
                              onClick={() => openWorkerHistory(w)}
                              title="View Attendance & Team Membership History"
                              style={{
                                padding: '0.375rem 0.5rem',
                                backgroundColor: 'transparent',
                                border: '1px solid #d1d5db',
                                borderRadius: '0.25rem',
                                color: '#1d4ed8',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                            >
                              <History size={12} /> History
                            </button>
                            <button
                              onClick={() => {
                                setEditWorker(w)
                                setUpdatedEmployeeId(w.employee_id)
                              }}
                              title="Update Employee ID"
                              style={{
                                padding: '0.375rem 0.5rem',
                                backgroundColor: 'transparent',
                                border: '1px solid #d1d5db',
                                borderRadius: '0.25rem',
                                color: '#374151',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                            >
                              <Edit2 size={12} /> Edit ID
                            </button>
                            {w.is_active && (
                              <button
                                onClick={() => {
                                  setMergeWorker(w)
                                  setTargetWorkerId('')
                                  setMergeNotes('')
                                }}
                                title="Merge into Target Worker"
                                style={{
                                  padding: '0.375rem 0.5rem',
                                  backgroundColor: 'transparent',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '0.25rem',
                                  color: '#4b5563',
                                  cursor: 'pointer',
                                  fontSize: '0.75rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem'
                                }}
                              >
                                <GitMerge size={12} /> Merge
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={workersPage}
              totalPages={workersTotalPages}
              totalCount={workersTotalCount}
              pageSize={PAGE_SIZE}
              onPageChange={setWorkersPage}
              loading={loading}
            />
          </div>
        )}

        {/* Tab 2: Legacy Crew Quarantine */}
        {activeTab === 'quarantine' && (
          <div>
            <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <AlertTriangle size={20} style={{ color: '#d97706', flexShrink: 0 }} />
                <div>
                  <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: '600', color: '#92400e' }}>
                    Identity Quarantine Policy Enforced
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: '#b45309' }}>
                    Automated name-based merging is strictly prohibited. Unverified legacy crew records extracted from historical assignments receive provisional identities (PROV-WORKER-XXXX) and require administrative review to verify official municipal employee IDs or merge with verified personnel.
                  </p>
                </div>
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--card-bg, #ffffff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: '0.5rem', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--table-header, #f9fafb)', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Audit ID</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Provisional ID</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Raw Legacy Name</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Status</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151' }}>Notes</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#374151', textAlign: 'right' }}>Resolution Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliations.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                        No provisional records currently pending quarantine review.
                      </td>
                    </tr>
                  ) : (
                    reconciliations.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                        <td style={{ padding: '0.75rem 1rem', color: '#6b7280' }}>#{r.id}</td>
                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: '#b45309', fontWeight: '600' }}>
                          {r.provisional_worker_employee_id}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#111827' }}>
                          {r.raw_name_string}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span
                            style={{
                              padding: '0.125rem 0.5rem',
                              borderRadius: '0.25rem',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              backgroundColor:
                                r.reconciliation_status === 'PENDING_REVIEW'
                                  ? '#fef3c7'
                                  : r.reconciliation_status === 'PROMOTED'
                                  ? '#dcfce7'
                                  : r.reconciliation_status === 'MERGED'
                                  ? '#dbeafe'
                                  : '#fee2e2',
                              color:
                                r.reconciliation_status === 'PENDING_REVIEW'
                                  ? '#b45309'
                                  : r.reconciliation_status === 'PROMOTED'
                                  ? '#15803d'
                                  : r.reconciliation_status === 'MERGED'
                                  ? '#1d4ed8'
                                  : '#b91c1c'
                            }}
                          >
                            {r.reconciliation_status}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: '#4b5563', fontSize: '0.8125rem' }}>
                          {r.notes || 'No review notes'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          {r.reconciliation_status === 'PENDING_REVIEW' ? (
                            <button
                              onClick={() => {
                                setSelectedAudit(r)
                                setReconcileAction('PROMOTE')
                                setReconcileEmployeeId('')
                                setReconcileTargetId('')
                                setReconcileNotes('')
                              }}
                              style={{
                                padding: '0.375rem 0.75rem',
                                backgroundColor: '#2563eb',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '0.25rem',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                fontWeight: '600'
                              }}
                            >
                              Resolve
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                              Resolved by {r.resolved_by_username || 'Admin'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={reconPage}
              totalPages={reconTotalPages}
              totalCount={reconTotalCount}
              pageSize={PAGE_SIZE}
              onPageChange={setReconPage}
              loading={loading}
            />
          </div>
        )}

        {/* Modal: Create Worker */}
        {showCreateModal && createPortal(
          <div style={modalBackdropStyle}>
            <div style={{ ...modalDialogStyle, maxWidth: '480px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '700', color: 'var(--text, #111827)' }}>Create Canonical Worker</h3>
                <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
              </div>
              <form onSubmit={handleCreateWorker}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Employee ID *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. EMP-2026-0042"
                    value={newEmployeeId}
                    onChange={(e) => setNewEmployeeId(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                  />
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Juan C. Dela Cruz"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                  />
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Link User Account (Optional)</label>
                  <select
                    value={newUserId}
                    onChange={(e) => setNewUserId(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                  >
                    <option value="">None (Non-Login Crew Personnel)</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        @{u.username} — {u.full_name || u.email} ({u.role})
                      </option>
                    ))}
                  </select>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                    Leave empty for crew workers without personal mobile accounts or passwords.
                  </p>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setShowCreateModal(false)} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', background: 'transparent', borderRadius: '0.375rem', cursor: 'pointer' }}>Cancel</button>
                  <button type="submit" disabled={submitting} style={{ padding: '0.5rem 1rem', backgroundColor: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: '600' }}>
                    {submitting ? 'Creating...' : 'Create Worker'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

        {/* Modal: Edit Employee ID */}
        {editWorker && createPortal(
          <div style={modalBackdropStyle}>
            <div style={{ ...modalDialogStyle, maxWidth: '440px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '700', color: 'var(--text, #111827)' }}>Update Employee ID</h3>
                <button onClick={() => setEditWorker(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
              </div>
              <p style={{ fontSize: '0.875rem', color: '#4b5563', margin: '0 0 1rem' }}>
                Updating employee ID for <strong>{editWorker.full_name}</strong>. Because relations reference surrogate keys, historical shifts and attendance remain unbroken.
              </p>
              <form onSubmit={handleUpdateEmployeeId}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>New Employee ID *</label>
                  <input
                    type="text"
                    required
                    value={updatedEmployeeId}
                    onChange={(e) => setUpdatedEmployeeId(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setEditWorker(null)} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', background: 'transparent', borderRadius: '0.375rem', cursor: 'pointer' }}>Cancel</button>
                  <button type="submit" disabled={submitting} style={{ padding: '0.5rem 1rem', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: '600' }}>
                    {submitting ? 'Saving...' : 'Update ID'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

        {/* Modal: Merge Worker */}
        {mergeWorker && createPortal(
          <div style={modalBackdropStyle}>
            <div style={{ ...modalDialogStyle, maxWidth: '480px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '700', color: 'var(--text, #111827)' }}>Merge Worker Profile</h3>
                <button onClick={() => setMergeWorker(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
              </div>
              <p style={{ fontSize: '0.875rem', color: '#4b5563', margin: '0 0 1rem' }}>
                Merging <strong>{mergeWorker.full_name} ({mergeWorker.employee_id})</strong> into an active target worker will repoint all audit and shift references, and soft-deactivate this profile.
              </p>
              <form onSubmit={handleMergeWorkers}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Target Worker *</label>
                  <select
                    required
                    value={targetWorkerId}
                    onChange={(e) => setTargetWorkerId(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                  >
                    <option value="">Select Target Worker...</option>
                    {(allActiveWorkers.length > 0 ? allActiveWorkers : workers)
                      .filter((w) => w.id !== mergeWorker.id && w.is_active)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.full_name} ({w.employee_id}) {w.user ? `[@${w.user_username}]` : ''}
                        </option>
                      ))}
                  </select>
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Audit Notes / Reason</label>
                  <textarea
                    rows="3"
                    placeholder="Document reason for merge..."
                    value={mergeNotes}
                    onChange={(e) => setMergeNotes(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setMergeWorker(null)} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', background: 'transparent', borderRadius: '0.375rem', cursor: 'pointer' }}>Cancel</button>
                  <button type="submit" disabled={submitting} style={{ padding: '0.5rem 1rem', backgroundColor: '#d97706', color: '#ffffff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: '600' }}>
                    {submitting ? 'Merging...' : 'Confirm Merge'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

        {/* Modal: Resolve Quarantine */}
        {selectedAudit && createPortal(
          <div style={modalBackdropStyle}>
            <div style={{ ...modalDialogStyle, maxWidth: '500px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '700', color: 'var(--text, #111827)' }}>Resolve Quarantine Record #{selectedAudit.id}</h3>
                <button onClick={() => setSelectedAudit(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
              </div>
              <div style={{ padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '0.375rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
                <div><strong>Legacy Name:</strong> {selectedAudit.raw_name_string}</div>
                <div><strong>Provisional ID:</strong> {selectedAudit.provisional_worker_employee_id}</div>
              </div>
              <form onSubmit={handleResolveReconciliation}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Resolution Action *</label>
                  <select
                    value={reconcileAction}
                    onChange={(e) => setReconcileAction(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                  >
                    <option value="PROMOTE">Promote to Permanent Worker (Issue Official ID)</option>
                    <option value="MERGE">Merge with Existing Verified Worker</option>
                    <option value="DISMISS">Dismiss as Invalid / Duplicate Record</option>
                  </select>
                </div>

                {reconcileAction === 'PROMOTE' && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Official Employee ID *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. EMP-2026-0088"
                      value={reconcileEmployeeId}
                      onChange={(e) => setReconcileEmployeeId(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                    />
                  </div>
                )}

                {reconcileAction === 'MERGE' && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Verified Target Worker *</label>
                    <select
                      required
                      value={reconcileTargetId}
                      onChange={(e) => setReconcileTargetId(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                    >
                      <option value="">Select Target Worker...</option>
                      {(allActiveWorkers.length > 0 ? allActiveWorkers : workers)
                        .filter((w) => w.id !== selectedAudit.provisional_worker && w.is_active && !w.is_provisional)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.full_name} ({w.employee_id})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.25rem' }}>Supervisor Notes</label>
                  <textarea
                    rows="2"
                    placeholder="Document audit resolution evidence..."
                    value={reconcileNotes}
                    onChange={(e) => setReconcileNotes(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setSelectedAudit(null)} style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', background: 'transparent', borderRadius: '0.375rem', cursor: 'pointer' }}>Cancel</button>
                  <button type="submit" disabled={submitting} style={{ padding: '0.5rem 1rem', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: '600' }}>
                    {submitting ? 'Resolving...' : 'Save Resolution'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

        {/* Worker Attendance & Membership History Modal (Stage 5B) */}
        {historyWorker && createPortal(
          <div style={modalBackdropStyle} onClick={() => setHistoryWorker(null)}>
            <div style={{ ...modalDialogStyle, maxWidth: '720px' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '700', color: '#111827' }}>
                    Worker Attendance & Membership History
                  </h3>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: '#6b7280' }}>
                    {historyWorker.full_name} ({historyWorker.employee_id})
                  </p>
                </div>
                <button
                  onClick={() => setHistoryWorker(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                >
                  <X size={20} />
                </button>
              </div>

              {workerHistoryLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
                  Loading persisted attendance and membership records...
                </div>
              ) : workerHistoryData ? (
                <div>
                  {workerHistoryData.attendance_summary && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.5rem', marginBottom: '1.25rem' }}>
                      <div style={{ padding: '0.625rem', borderRadius: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>TOTAL LOGS</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0f172a' }}>{workerHistoryData.attendance_summary.total}</div>
                      </div>
                      <div style={{ padding: '0.625rem', borderRadius: '0.5rem', background: '#f0fdf4', border: '1px solid #86efac' }}>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#166534' }}>PRESENT</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#166534' }}>{workerHistoryData.attendance_summary.present}</div>
                      </div>
                      <div style={{ padding: '0.625rem', borderRadius: '0.5rem', background: '#fefce8', border: '1px solid #fde047' }}>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#854d0e' }}>LATE</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#854d0e' }}>{workerHistoryData.attendance_summary.late}</div>
                      </div>
                      <div style={{ padding: '0.625rem', borderRadius: '0.5rem', background: '#f0f9ff', border: '1px solid #7dd3fc' }}>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#075985' }}>EXCUSED</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#075985' }}>{workerHistoryData.attendance_summary.excused}</div>
                      </div>
                      <div style={{ padding: '0.625rem', borderRadius: '0.5rem', background: '#fef2f2', border: '1px solid #fca5a5' }}>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#991b1b' }}>ABSENT</div>
                        <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#991b1b' }}>{workerHistoryData.attendance_summary.absent}</div>
                      </div>
                    </div>
                  )}

                  <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.5rem' }}>
                    Persisted Crew Attendance Records ({workerHistoryData.personal_attendance?.length || 0})
                  </h4>
                  {(workerHistoryData.personal_attendance?.length || 0) === 0 ? (
                    <div style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '0.8125rem', marginBottom: '1rem' }}>
                      No persisted attendance records for this worker.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem', maxHeight: '260px', overflowY: 'auto' }}>
                      {workerHistoryData.personal_attendance.map((rec) => (
                        <div key={rec.id} style={{ padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0', background: '#ffffff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#0f172a' }}>
                                {rec.schedule_area || 'Deployment'} · {rec.service_date || '—'}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                Team: {rec.team_name ? `${rec.team_name} (${rec.team_code})` : '—'} | Submitted by: {rec.submitted_by_name || rec.checked_in_by_username || '—'}
                              </div>
                            </div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f172a' }}>
                              Status: {rec.effective_status} {rec.is_corrected ? `(Initial: ${rec.initial_status})` : ''}
                            </div>
                          </div>
                          {Array.isArray(rec.corrections) && rec.corrections.length > 0 && (
                            <div style={{ marginTop: '0.5rem', padding: '0.5rem', borderRadius: '0.375rem', background: '#f8fafc', fontSize: '0.75rem', color: '#334155' }}>
                              {rec.corrections.map((c) => (
                                <div key={c.id}>
                                  <strong>#{c.correction_sequence}: {c.previous_status} to {c.corrected_status}</strong> — {c.reason} ({c.corrected_by_name || c.corrected_by_username})
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <h4 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.5rem' }}>
                    Sanitation Team Membership History ({workerHistoryData.membership_history?.length || 0})
                  </h4>
                  {(workerHistoryData.membership_history?.length || 0) === 0 ? (
                    <div style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '0.8125rem' }}>
                      No team memberships recorded.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                      {workerHistoryData.membership_history.map((m) => (
                        <div key={m.id} style={{ padding: '0.625rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8125rem' }}>
                          <div>
                            <strong>{m.team_name} ({m.team_code})</strong> — Role: {m.role_in_team}
                          </div>
                          <span style={{ fontWeight: 600, color: m.is_active ? '#16a34a' : '#64748b' }}>
                            {m.is_active ? 'Active' : 'Historical'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  onClick={() => setHistoryWorker(null)}
                  style={{ padding: '0.5rem 1rem', border: '1px solid #d1d5db', background: 'transparent', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      </div>
    </DashboardLayout>
  )
}

