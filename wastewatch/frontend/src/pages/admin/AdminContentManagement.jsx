/**
 * AdminContentManagement.jsx
 * --------------------------
 * Dedicated Admin Content Management Workspace for Lucena City CENRO.
 * Allows administrators to create, edit, preview, publish, unpublish,
 * archive, restore, and delete official municipal information across:
 * - Announcements
 * - News & Features
 * - Emergency Advisories
 *
 * Design: Light-Themed Municipal Editorial.
 * Strict rules: Lucide SVG icons only. ZERO emojis.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Plus,
  ShieldAlert,
  Megaphone,
  FileText,
  RefreshCw,
  Building2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import ArticleDetailModal from '../news/components/ArticleDetailModal'
import EmergencyAlertDetailModal from '../news/components/EmergencyAlertDetailModal'
import ContentStatsOverview from './content/ContentStatsOverview'
import ContentFiltersToolbar from './content/ContentFiltersToolbar'
import NewsItemTable from './content/NewsItemTable'
import EmergencyAlertTable from './content/EmergencyAlertTable'
import NewsItemEditorModal from './content/NewsItemEditorModal'
import EmergencyAlertEditorModal from './content/EmergencyAlertEditorModal'
import DeleteConfirmModal from './content/DeleteConfirmModal'
import './content/AdminContentManagement.css'

export default function AdminContentManagement() {
  const { barangays: authBarangays } = useAuth()

  // Data states
  const [newsItems, setNewsItems] = useState([])
  const [alerts, setAlerts] = useState([])
  const [stats, setStats] = useState({
    total: 0,
    published: 0,
    drafts: 0,
    archived: 0,
    active_alerts: 0,
    total_alerts: 0,
  })
  const [barangays, setBarangays] = useState([])

  // Loading states
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [bannerNotice, setBannerNotice] = useState(null)

  // Filter & tab controls
  const [activeTab, setActiveTab] = useState('all') // 'all', 'announcement', 'news', 'alerts'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'published', 'draft', 'archived'
  const [scopeFilter, setScopeFilter] = useState('all') // 'all', 'citywide', or barangay id
  const [priorityFilter, setPriorityFilter] = useState('all') // 'all', 'high', 'medium', 'low'
  const [sortBy, setSortBy] = useState('updated') // 'updated', 'date', 'title', 'priority'

  // Modal states
  const [newsEditorOpen, setNewsEditorOpen] = useState(false)
  const [editingNewsItem, setEditingNewsItem] = useState(null)

  const [alertEditorOpen, setAlertEditorOpen] = useState(false)
  const [editingAlert, setEditingAlert] = useState(null)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null) // { item, isAlert }

  const [previewItem, setPreviewItem] = useState(null)
  const [previewAlert, setPreviewAlert] = useState(null)

  // ── 1. Fetch initial data ──────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/api/news/items/admin-stats/')
      setStats(res.data)
    } catch (err) {
      console.error('Failed to load admin content stats:', err)
    }
  }, [])

  const fetchContent = useCallback(async () => {
    setLoading(true)
    try {
      const [itemsRes, alertsRes] = await Promise.all([
        api.get('/api/news/items/?admin_mode=true'),
        api.get('/api/news/alerts/?include_inactive=true'),
      ])
      setNewsItems(itemsRes.data || [])
      setAlerts(alertsRes.data || [])
      await fetchStats()
    } catch (err) {
      console.error('Failed to load content workspace items:', err)
      showBanner('Failed to load content workspace records.', 'error')
    } finally {
      setLoading(false)
    }
  }, [fetchStats])

  // Populate barangays
  useEffect(() => {
    if (authBarangays && authBarangays.length > 0) {
      setBarangays(authBarangays)
    } else {
      api
        .get('/api/auth/barangays/')
        .then((res) => {
          if (Array.isArray(res.data)) setBarangays(res.data)
        })
        .catch(() => {
          api.get('/api/barangays/').then((res) => {
            if (Array.isArray(res.data)) setBarangays(res.data)
          }).catch(() => {})
        })
    }
  }, [authBarangays])

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  const showBanner = (message, type = 'success') => {
    setBannerNotice({ message, type })
    setTimeout(() => {
      setBannerNotice(null)
    }, 4500)
  }

  // ── 2. Computed counts for tabs ───────────────────────────────────────────
  const tabCounts = useMemo(() => {
    const announcements = newsItems.filter((i) => i.type === 'announcement').length
    const news = newsItems.filter((i) => i.type === 'news').length
    return {
      total: newsItems.length,
      announcements,
      news,
      total_alerts: alerts.length,
    }
  }, [newsItems, alerts])

  // ── 3. Filtered & Sorted News Items ────────────────────────────────────────
  const filteredNewsItems = useMemo(() => {
    let result = [...newsItems]

    // Tab filter
    if (activeTab === 'announcement') {
      result = result.filter((i) => i.type === 'announcement')
    } else if (activeTab === 'news') {
      result = result.filter((i) => i.type === 'news')
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((i) => i.status === statusFilter)
    }

    // Scope filter
    if (scopeFilter === 'citywide') {
      result = result.filter((i) => !i.barangay)
    } else if (scopeFilter !== 'all') {
      result = result.filter((i) => String(i.barangay) === String(scopeFilter))
    }

    // Priority filter
    if (priorityFilter !== 'all') {
      result = result.filter((i) => i.priority === priorityFilter)
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (i) =>
          (i.title || '').toLowerCase().includes(q) ||
          (i.description || '').toLowerCase().includes(q)
      )
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'updated') {
        const dateA = new Date(a.updated_at || a.date || 0)
        const dateB = new Date(b.updated_at || b.date || 0)
        return dateB - dateA
      }
      if (sortBy === 'date') {
        const dateA = new Date(a.date || 0)
        const dateB = new Date(b.date || 0)
        return dateB - dateA
      }
      if (sortBy === 'title') {
        return (a.title || '').localeCompare(b.title || '')
      }
      if (sortBy === 'priority') {
        const weight = { high: 3, medium: 2, low: 1 }
        return (weight[b.priority] || 0) - (weight[a.priority] || 0)
      }
      return 0
    })

    return result
  }, [newsItems, activeTab, statusFilter, scopeFilter, priorityFilter, search, sortBy])

  // ── 4. Filtered Alerts ─────────────────────────────────────────────────────
  const filteredAlerts = useMemo(() => {
    let result = [...alerts]
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (a) =>
          (a.title || '').toLowerCase().includes(q) ||
          (a.body || '').toLowerCase().includes(q)
      )
    }
    result.sort((a, b) => {
      if (sortBy === 'title') {
        return (a.title || '').localeCompare(b.title || '')
      }
      const dateA = new Date(a.updated_at || a.date || 0)
      const dateB = new Date(b.updated_at || b.date || 0)
      return dateB - dateA
    })
    return result
  }, [alerts, search, sortBy])

  // ── 5. Action Handlers ────────────────────────────────────────────────────
  const handleSaveNewsItem = async (payload, itemId) => {
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('title', payload.title)
      formData.append('type', payload.type)
      formData.append('category', payload.category)
      formData.append('priority', payload.priority)
      formData.append('status', payload.status)
      formData.append('is_active', payload.is_active ? 'true' : 'false')
      formData.append('is_featured', payload.is_featured ? 'true' : 'false')
      formData.append('is_pinned', payload.is_pinned ? 'true' : 'false')
      formData.append('description', payload.description)

      if (payload.barangay !== null && payload.barangay !== undefined) {
        formData.append('barangay', payload.barangay)
      } else {
        formData.append('barangay', '')
      }

      if (payload.imageFile) {
        formData.append('image', payload.imageFile)
      } else if (payload.removeExistingImage) {
        formData.append('image', '')
      }

      if (itemId) {
        await api.patch(`/api/news/items/${itemId}/`, formData)
        showBanner(`Updated "${payload.title}" successfully.`)
      } else {
        await api.post('/api/news/items/', formData)
        showBanner(
          payload.status === 'published'
            ? `Published "${payload.title}" successfully.`
            : `Saved "${payload.title}" as draft.`
        )
      }

      setNewsEditorOpen(false)
      setEditingNewsItem(null)
      await fetchContent()
    } catch (err) {
      console.error('Failed to save news item:', err)
      showBanner('Failed to save announcement. Please check all fields.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAlert = async (payload, alertId) => {
    setSaving(true)
    try {
      if (alertId) {
        await api.patch(`/api/news/alerts/${alertId}/`, payload)
        showBanner(`Emergency advisory "${payload.title}" updated.`)
      } else {
        await api.post('/api/news/alerts/', payload)
        showBanner(`Emergency advisory "${payload.title}" created.`)
      }

      setAlertEditorOpen(false)
      setEditingAlert(null)
      await fetchContent()
    } catch (err) {
      console.error('Failed to save alert:', err)
      showBanner('Failed to save emergency alert.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handlePublishItem = async (item) => {
    try {
      await api.post(`/api/news/items/${item.id}/publish/`)
      showBanner(`Published "${item.title}". Public citizens have been notified.`)
      await fetchContent()
    } catch (err) {
      console.error('Failed to publish item:', err)
      showBanner('Failed to publish notice.', 'error')
    }
  }

  const handleUnpublishItem = async (item) => {
    try {
      await api.post(`/api/news/items/${item.id}/unpublish/`)
      showBanner(`Unpublished "${item.title}" (moved to drafts).`)
      await fetchContent()
    } catch (err) {
      console.error('Failed to unpublish item:', err)
      showBanner('Failed to unpublish notice.', 'error')
    }
  }

  const handleArchiveItem = async (item) => {
    try {
      await api.post(`/api/news/items/${item.id}/archive/`)
      showBanner(`Archived "${item.title}".`)
      await fetchContent()
    } catch (err) {
      console.error('Failed to archive item:', err)
      showBanner('Failed to archive notice.', 'error')
    }
  }

  const handleRestoreItem = async (item) => {
    try {
      await api.post(`/api/news/items/${item.id}/restore/`, { status: 'draft' })
      showBanner(`Restored "${item.title}" to drafts.`)
      await fetchContent()
    } catch (err) {
      console.error('Failed to restore item:', err)
      showBanner('Failed to restore notice.', 'error')
    }
  }

  const handleToggleAlertActive = async (alert) => {
    try {
      const res = await api.post(`/api/news/alerts/${alert.id}/toggle-active/`)
      const nowActive = res.data?.is_active
      showBanner(
        nowActive
          ? `Emergency advisory "${alert.title}" is now ACTIVE.`
          : `Emergency advisory "${alert.title}" deactivated.`
      )
      await fetchContent()
    } catch (err) {
      console.error('Failed to toggle alert status:', err)
      showBanner('Failed to toggle alert broadcast status.', 'error')
    }
  }

  const handleOpenDelete = (item, isAlert = false) => {
    setDeleteTarget({ item, isAlert })
    setDeleteModalOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const { item, isAlert } = deleteTarget
      if (isAlert) {
        await api.delete(`/api/news/alerts/${item.id}/`)
        showBanner(`Permanently deleted advisory "${item.title}".`)
      } else {
        await api.delete(`/api/news/items/${item.id}/`)
        showBanner(`Permanently deleted "${item.title}".`)
      }
      setDeleteModalOpen(false)
      setDeleteTarget(null)
      await fetchContent()
    } catch (err) {
      console.error('Failed to delete content:', err)
      showBanner('Failed to delete item.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="content-workspace" data-testid="admin-content-workspace">
        {/* Toast / Banner Notification */}
        {bannerNotice && (
          <div
            style={{
              padding: '12px 18px',
              borderRadius: '8px',
              marginBottom: '20px',
              background: bannerNotice.type === 'error' ? '#fef2f2' : '#f0fdf4',
              border: `1px solid ${bannerNotice.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
              color: bannerNotice.type === 'error' ? '#991b1b' : '#166534',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
            role="status"
          >
            {bannerNotice.type === 'error' ? (
              <AlertCircle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
            <span>{bannerNotice.message}</span>
          </div>
        )}

        {/* ── Page Header ── */}
        <div className="content-workspace-header">
          <div className="content-workspace-title-area">
            <span className="content-workspace-badge">
              <Building2 size={13} />
              Lucena City CENRO · Official Information Hub
            </span>
            <h1 className="content-workspace-title">Content Management Workspace</h1>
            <p className="content-workspace-subtitle">
              Publish, review, and manage public announcements, official news, and emergency advisories.
              Draft notices remain isolated from public feeds until explicitly published.
            </p>
          </div>

          <div className="content-workspace-header-actions">
            <button
              type="button"
              className="btn-secondary-action"
              onClick={() => {
                setEditingAlert(null)
                setAlertEditorOpen(true)
              }}
              data-testid="btn-create-alert"
            >
              <ShieldAlert size={16} />
              <span>New Emergency Alert</span>
            </button>

            <button
              type="button"
              className="btn-primary-action"
              onClick={() => {
                setEditingNewsItem(null)
                setNewsEditorOpen(true)
              }}
              data-testid="btn-create-content"
            >
              <Plus size={16} />
              <span>Create Announcement / News</span>
            </button>
          </div>
        </div>

        {/* ── Aggregate Metric Cards ── */}
        <ContentStatsOverview stats={stats} loading={loading} />

        {/* ── Workspace Controls & Tabs ── */}
        <ContentFiltersToolbar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          counts={tabCounts}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          scopeFilter={scopeFilter}
          onScopeChange={setScopeFilter}
          barangays={barangays}
          priorityFilter={priorityFilter}
          onPriorityChange={setPriorityFilter}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />

        {/* ── Table Content Views ── */}
        {activeTab === 'alerts' ? (
          <EmergencyAlertTable
            alerts={filteredAlerts}
            loading={loading}
            onPreview={setPreviewAlert}
            onEdit={(alert) => {
              setEditingAlert(alert)
              setAlertEditorOpen(true)
            }}
            onToggleActive={handleToggleAlertActive}
            onDelete={(alert) => handleOpenDelete(alert, true)}
          />
        ) : (
          <NewsItemTable
            items={filteredNewsItems}
            loading={loading}
            onPreview={setPreviewItem}
            onEdit={(item) => {
              setEditingNewsItem(item)
              setNewsEditorOpen(true)
            }}
            onPublish={handlePublishItem}
            onUnpublish={handleUnpublishItem}
            onArchive={handleArchiveItem}
            onRestore={handleRestoreItem}
            onDelete={(item) => handleOpenDelete(item, false)}
          />
        )}

        {/* ── Modals & Editors ── */}
        <NewsItemEditorModal
          isOpen={newsEditorOpen}
          item={editingNewsItem}
          barangays={barangays}
          onClose={() => {
            setNewsEditorOpen(false)
            setEditingNewsItem(null)
          }}
          onSave={handleSaveNewsItem}
          saving={saving}
        />

        <EmergencyAlertEditorModal
          isOpen={alertEditorOpen}
          alert={editingAlert}
          onClose={() => {
            setAlertEditorOpen(false)
            setEditingAlert(null)
          }}
          onSave={handleSaveAlert}
          saving={saving}
        />

        <DeleteConfirmModal
          isOpen={deleteModalOpen}
          item={deleteTarget?.item}
          onClose={() => {
            setDeleteModalOpen(false)
            setDeleteTarget(null)
          }}
          onConfirm={handleConfirmDelete}
          deleting={deleting}
        />

        {/* ── Live Preview Modals (reusing public components) ── */}
        {previewItem && (
          <ArticleDetailModal
            item={previewItem}
            onClose={() => setPreviewItem(null)}
          />
        )}

        {previewAlert && (
          <EmergencyAlertDetailModal
            alert={previewAlert}
            onClose={() => setPreviewAlert(null)}
          />
        )}
      </div>
    </DashboardLayout>
  )
}
