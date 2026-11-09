/**
 * AdminEventManagement.jsx
 * ------------------------
 * Dedicated Admin Event Management Workspace for Lucena City CENRO.
 * Allows administrators to create, view, edit, publish, cancel, complete,
 * archive, restore, and delete municipal events.
 *
 * Design: Light-Themed Municipal Editorial.
 * Strict rules: Lucide SVG icons only. ZERO emojis.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, RefreshCw, Calendar, CheckCircle2, AlertCircle } from 'lucide-react'
import DashboardLayout from '../../../components/DashboardLayout'
import api from '../../../api/client'
import { useAuth } from '../../../context/AuthContext'
import EventStatsOverview from './EventStatsOverview'
import EventFiltersToolbar from './EventFiltersToolbar'
import EventTable from './EventTable'
import EventEditorModal from './EventEditorModal'
import EventDetailModal from './EventDetailModal'
import EventActionConfirmModal from './EventActionConfirmModal'
import './AdminEventManagement.css'

export default function AdminEventManagement() {
  const { barangays: authBarangays } = useAuth()

  // Data states
  const [events, setEvents] = useState([])
  const [stats, setStats] = useState({
    total: 0,
    published: 0,
    upcoming: 0,
    drafts: 0,
    cancelled: 0,
    completed: 0,
    archived: 0,
  })
  const [barangays, setBarangays] = useState([])

  // Loading states
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [bannerNotice, setBannerNotice] = useState(null)

  // Filter controls
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Modal states
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewEvent, setPreviewEvent] = useState(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmActionType, setConfirmActionType] = useState('delete')
  const [confirmTargetEvent, setConfirmTargetEvent] = useState(null)

  // ── 1. Fetch Stats ────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await api.get('/api/events/admin-stats/')
      setStats(res.data)
    } catch (err) {
      console.error('Failed to load event stats:', err)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  // ── 2. Fetch Events ───────────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (categoryFilter && categoryFilter !== 'all') params.append('category', categoryFilter)
      if (scopeFilter && scopeFilter !== 'all') params.append('barangay', scopeFilter)
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)
      if (search.trim()) params.append('search', search.trim())

      const res = await api.get(`/api/events/?${params.toString()}`)
      const data = res.data?.results || res.data || []
      setEvents(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load municipal events:', err)
      setBannerNotice({
        type: 'error',
        message: 'Failed to load events from the server. Please refresh.',
      })
    } finally {
      setLoading(false)
    }
  }, [statusFilter, categoryFilter, scopeFilter, startDate, endDate, search])

  // ── 3. Fetch Barangays ───────────────────────────────────────────────────
  useEffect(() => {
    if (authBarangays && authBarangays.length > 0) {
      setBarangays(authBarangays)
    } else {
      api
        .get('/api/barangays/')
        .then((res) => setBarangays(res.data?.results || res.data || []))
        .catch(() => setBarangays([]))
    }
  }, [authBarangays])

  // Initial load & when filters change
  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  // Clear banner notice after timeout
  useEffect(() => {
    if (bannerNotice) {
      const timer = setTimeout(() => setBannerNotice(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [bannerNotice])

  const handleResetFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setScopeFilter('all')
    setStartDate('')
    setEndDate('')
  }

  // ── Modal Open Handlers ───────────────────────────────────────────────────
  const handleOpenCreate = () => {
    setEditingEvent(null)
    setEditorOpen(true)
  }

  const handleOpenEdit = (event) => {
    setEditingEvent(event)
    setEditorOpen(true)
  }

  const handleOpenPreview = (event) => {
    setPreviewEvent(event)
    setPreviewOpen(true)
  }

  const handleOpenConfirm = (event, actionType) => {
    setConfirmTargetEvent(event)
    setConfirmActionType(actionType)
    setConfirmOpen(true)
  }

  // ── Save Event Handler (Create / Edit) ────────────────────────────────────
  const handleSaveEvent = async (formData) => {
    if (saving) return
    setSaving(true)
    try {
      const hasFile = Boolean(formData.cover_image && typeof formData.cover_image !== 'string')
      let payload
      let config = {}

      if (hasFile) {
        payload = new FormData()
        Object.keys(formData).forEach((key) => {
          if (key === 'barangays') {
            payload.append('barangays', JSON.stringify(formData[key]))
          } else if (formData[key] !== null && formData[key] !== undefined) {
            payload.append(key, formData[key])
          }
        })
      } else {
        payload = { ...formData }
      }

      if (editingEvent) {
        await api.patch(`/api/events/${editingEvent.id}/`, payload, config)
        setBannerNotice({
          type: 'success',
          message: `Event "${formData.title}" updated successfully.`,
        })
      } else {
        await api.post('/api/events/', payload, config)
        setBannerNotice({
          type: 'success',
          message: `Event "${formData.title}" scheduled successfully.`,
        })
      }

      setEditorOpen(false)
      setEditingEvent(null)
      fetchEvents()
      fetchStats()
    } catch (err) {
      console.error('Error saving event:', err)
      const errorMsg =
        err.response?.data?.end_datetime?.[0] ||
        err.response?.data?.detail ||
        err.response?.data?.error ||
        'Failed to save event. Please verify required fields.'
      setBannerNotice({
        type: 'error',
        message: errorMsg,
      })
    } finally {
      setSaving(false)
    }
  }

  // ── Consequential Action Confirmed Handler ────────────────────────────────
  const handleExecuteAction = async () => {
    if (actionLoading || !confirmTargetEvent) return
    setActionLoading(true)
    const { id, title } = confirmTargetEvent

    try {
      if (confirmActionType === 'publish') {
        await api.post(`/api/events/${id}/publish/`)
        setBannerNotice({
          type: 'success',
          message: `Event "${title}" has been published and announced.`,
        })
      } else if (confirmActionType === 'cancel') {
        await api.post(`/api/events/${id}/cancel/`)
        setBannerNotice({
          type: 'success',
          message: `Event "${title}" has been marked as Cancelled.`,
        })
      } else if (confirmActionType === 'complete') {
        await api.post(`/api/events/${id}/complete/`)
        setBannerNotice({
          type: 'success',
          message: `Event "${title}" has been marked as Completed.`,
        })
      } else if (confirmActionType === 'archive') {
        await api.post(`/api/events/${id}/archive/`)
        setBannerNotice({
          type: 'success',
          message: `Event "${title}" has been archived.`,
        })
      } else if (confirmActionType === 'restore') {
        await api.post(`/api/events/${id}/restore/`)
        setBannerNotice({
          type: 'success',
          message: `Event "${title}" restored to Draft status.`,
        })
      } else if (confirmActionType === 'delete') {
        await api.delete(`/api/events/${id}/`)
        setBannerNotice({
          type: 'success',
          message: `Event "${title}" permanently deleted.`,
        })
      }

      setConfirmOpen(false)
      setConfirmTargetEvent(null)
      fetchEvents()
      fetchStats()
    } catch (err) {
      console.error(`Error executing ${confirmActionType}:`, err)
      const errorMsg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        `Failed to execute ${confirmActionType}. Please try again.`
      setBannerNotice({
        type: 'error',
        message: errorMsg,
      })
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="event-workspace" data-testid="admin-events-workspace">
        {/* Workspace Masthead */}
        <div className="event-workspace-header">
          <div className="event-workspace-title-area">
            <div className="event-workspace-badge">
              <Calendar size={13} strokeWidth={2.2} />
              <span>Municipal Administration</span>
            </div>
            <h1 className="event-workspace-title">Municipal Event Management</h1>
            <p className="event-workspace-subtitle">
              Schedule, publish, manage, and coordinate official solid waste programs, cleanup campaigns,
              and public orientation events across Lucena City.
            </p>
          </div>

          <div className="event-workspace-header-actions">
            <button
              type="button"
              className="btn-refresh-event"
              onClick={() => {
                fetchStats()
                fetchEvents()
              }}
              disabled={loading || statsLoading}
              title="Refresh events repository"
              data-testid="refresh-events-btn"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              className="btn-primary-event"
              onClick={handleOpenCreate}
              data-testid="create-event-btn"
            >
              <Plus size={16} strokeWidth={2.5} />
              <span>Schedule Event</span>
            </button>
          </div>
        </div>

        {/* Banner Notice Alert */}
        {bannerNotice && (
          <div
            className={`event-banner-notice ${bannerNotice.type}`}
            data-testid="event-banner-notice"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {bannerNotice.type === 'success' ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <span>{bannerNotice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Metrics Overview */}
        <EventStatsOverview stats={stats} loading={statsLoading} />

        {/* Filters Toolbar */}
        <EventFiltersToolbar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          categoryFilter={categoryFilter}
          onCategoryChange={setCategoryFilter}
          scopeFilter={scopeFilter}
          onScopeChange={setScopeFilter}
          barangays={barangays}
          startDate={startDate}
          onStartDateChange={setStartDate}
          endDate={endDate}
          onEndDateChange={setEndDate}
          onResetFilters={handleResetFilters}
        />

        {/* Events Table */}
        <EventTable
          events={events}
          loading={loading}
          onPreview={handleOpenPreview}
          onEdit={handleOpenEdit}
          onPublish={(ev) => handleOpenConfirm(ev, 'publish')}
          onCancel={(ev) => handleOpenConfirm(ev, 'cancel')}
          onComplete={(ev) => handleOpenConfirm(ev, 'complete')}
          onArchive={(ev) => handleOpenConfirm(ev, 'archive')}
          onRestore={(ev) => handleOpenConfirm(ev, 'restore')}
          onDelete={(ev) => handleOpenConfirm(ev, 'delete')}
        />

        {/* Modals */}
        <EventEditorModal
          isOpen={editorOpen}
          event={editingEvent}
          barangays={barangays}
          onClose={() => {
            setEditorOpen(false)
            setEditingEvent(null)
          }}
          onSave={handleSaveEvent}
          saving={saving}
        />

        <EventDetailModal
          isOpen={previewOpen}
          event={previewEvent}
          onClose={() => {
            setPreviewOpen(false)
            setPreviewEvent(null)
          }}
        />

        <EventActionConfirmModal
          isOpen={confirmOpen}
          actionType={confirmActionType}
          event={confirmTargetEvent}
          onClose={() => {
            setConfirmOpen(false)
            setConfirmTargetEvent(null)
          }}
          onConfirm={handleExecuteAction}
          loading={actionLoading}
        />
      </div>
    </DashboardLayout>
  )
}
