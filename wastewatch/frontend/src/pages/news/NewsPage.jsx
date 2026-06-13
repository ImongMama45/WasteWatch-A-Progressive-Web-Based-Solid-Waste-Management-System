import { useState, useMemo, useRef } from 'react'
import { Bell, PlusCircle, X, Megaphone, AlertTriangle, Newspaper, Send, Save, CheckCircle, Image as ImageIcon } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import { useNewsItems } from '../../hooks/useNewsItems'
import { useEmergencyAlerts } from '../../hooks/useEmergencyAlerts'
import { useBarangaySpotlights } from '../../hooks/useBarangaySpotlights'
import api from '../../api/client'

import EmergencyAlertBanner from './components/EmergencyAlertBanner'
import FeaturedNewsCarousel from './components/FeaturedNewsCarousel'
import CategoryTabs from './components/CategoryTabs'
import NewsSearchBar from './components/NewsSearchBar'
import NewsFeed from './components/NewsFeed'
import BarangaySpotlight from './components/BarangaySpotlight'

// ── Constants (moved from CreateAnnouncementPage) ─────────────────────────────
const TYPE_OPTIONS = [
  { value: 'announcement', label: 'Announcement',    Icon: Megaphone,     desc: 'Official LGU notices' },
  { value: 'news',         label: 'News Article',    Icon: Newspaper,     desc: 'Community news' },
  { value: 'emergency',    label: 'Emergency Alert', Icon: AlertTriangle, desc: 'High-priority alerts' },
]
const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High — Urgent' },
]
const CATEGORIES = [
  'General', 'Announcements', 'News', 'Service Updates',
  'Community', 'Cleanup Drives', 'Rankings', 'Advisories', 'Emergency',
]

const EMPTY_FORM = {
  type: 'announcement', category: 'General',
  title: '', body: '', barangay: '',
  priority: 'medium', is_pinned: false, is_featured: false,
}

// ── Create Post Modal ─────────────────────────────────────────────────────────
function CreatePostModal({ barangays, onClose, onPublished }) {
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [saving,    setSaving]    = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [imageFile,    setImageFile]    = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef(null)

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  function applyFile(file) {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = e => setImagePreview(e.target.result)
    reader.readAsDataURL(file)
  }
  function removeImage() { setImageFile(null); setImagePreview(null) }

  async function handleSubmit(isDraft = false) {
    if (!form.title.trim() || !form.body.trim()) {
      alert('Title and content are required.')
      return
    }
    setSaving(true)
    try {
      const endpoint = form.type === 'emergency' ? '/api/news/alerts/' : '/api/news/items/'
      const fd = new FormData()
      fd.append('title',       form.title)
      fd.append('description', form.body)
      fd.append('type',        form.type)
      fd.append('category',    form.category)
      fd.append('priority',    form.priority)
      fd.append('is_pinned',   form.is_pinned)
      fd.append('is_featured', form.is_featured)
      fd.append('is_active',   !isDraft)
      if (form.barangay) fd.append('barangay', form.barangay)
      if (imageFile)     fd.append('image', imageFile)
      await api.post(endpoint, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setSaving(false)
      if (isDraft) { alert('Draft saved.'); onClose() }
      else { setSubmitted(true); onPublished?.() }
    } catch (err) {
      console.error(err)
      const detail = err.response?.data
      alert(
        typeof detail === 'object'
          ? Object.entries(detail).map(([k, v]) => `${k}: ${v}`).join('\n')
          : 'Failed to save post.'
      )
      setSaving(false)
    }
  }

  return (
    // Backdrop
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
    >
      {/* Modal box */}
      <div style={{
        background: 'var(--surface)',
        borderRadius: 16,
        width: '100%', maxWidth: 580,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* ── Success state ── */}
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '48px 32px' }}>
            <CheckCircle size={48} strokeWidth={1.5}
              style={{ color: 'var(--accent)', display: 'block', margin: '0 auto 16px' }} />
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Published!</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
              Your {form.type} is now live.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
              <button className="btn btn-outline"
                onClick={() => { setSubmitted(false); setForm(EMPTY_FORM) }}>
                Create Another
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px 14px',
              borderBottom: '1px solid var(--border)',
              position: 'sticky', top: 0,
              background: 'var(--surface)', zIndex: 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Send size={18} strokeWidth={2} style={{ color: 'var(--accent)' }} />
                <span style={{ fontWeight: 700, fontSize: 16 }}>Create Announcement</span>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: 4, borderRadius: 6,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Type selector */}
              <div>
                <div className="form-label" style={{ marginBottom: 8 }}>Post Type</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {TYPE_OPTIONS.map(({ value, label, Icon, desc }) => (
                    <div
                      key={value}
                      onClick={() => set('type', value)}
                      style={{
                        padding: '10px 8px', borderRadius: 'var(--radius)',
                        border: `1.5px solid ${form.type === value ? 'var(--accent)' : 'var(--border)'}`,
                        background: form.type === value ? 'rgba(46,204,113,.06)' : 'var(--bg)',
                        textAlign: 'center', cursor: 'pointer',
                        transition: 'border-color .15s, background .15s',
                      }}
                    >
                      <Icon size={18} strokeWidth={1.8} style={{
                        color: form.type === value ? 'var(--accent)' : 'var(--text-muted)',
                        display: 'block', margin: '0 auto 5px',
                      }} />
                      <div style={{ fontWeight: 700, fontSize: 11,
                        color: form.type === value ? 'var(--text)' : 'var(--text-muted)', marginBottom: 2 }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>{desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Title</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Enter a clear, descriptive title..."
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  maxLength={120}
                />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, textAlign: 'right' }}>
                  {form.title.length}/120
                </div>
              </div>

              {/* Body */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Content</label>
                <textarea
                  className="form-input"
                  placeholder="Write the full content here..."
                  value={form.body}
                  onChange={e => set('body', e.target.value)}
                  style={{ minHeight: 110, resize: 'vertical' }}
                />
              </div>

              {/* Cover Image */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <ImageIcon size={13} strokeWidth={2} style={{ color: 'var(--text-muted)' }} />
                  Cover Image
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                {imagePreview ? (
                  <div style={{ position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <img src={imagePreview} alt="Preview" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
                    <button
                      onClick={removeImage}
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        background: 'rgba(0,0,0,.55)', border: 'none', borderRadius: '50%',
                        width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', color: '#fff',
                      }}
                    ><X size={13} strokeWidth={2.5} /></button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={e => { e.preventDefault(); setDragging(false); applyFile(e.dataTransfer.files[0]) }}
                    style={{
                      border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius)', padding: '16px',
                      textAlign: 'center', cursor: 'pointer',
                      background: dragging ? 'rgba(46,204,113,.04)' : 'transparent',
                      transition: 'border-color .15s',
                    }}
                  >
                    <ImageIcon size={22} strokeWidth={1.5} style={{ color: 'var(--text-muted)', display: 'block', margin: '0 auto 6px' }} />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Drag & drop or <span style={{ color: 'var(--accent)', fontWeight: 600 }}>browse</span>
                    </div>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => applyFile(e.target.files[0])} />
              </div>

              {/* Category + Priority */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Category</label>
                  <select className="form-input" value={form.category}
                    onChange={e => set('category', e.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Priority</label>
                  <select className="form-input" value={form.priority}
                    onChange={e => set('priority', e.target.value)}>
                    {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Barangay */}
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Target Barangay (optional)</label>
                <select className="form-input" value={form.barangay}
                  onChange={e => set('barangay', e.target.value)}>
                  <option value="">City-Wide</option>
                  {barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              {/* Checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { key: 'is_pinned',   label: 'Pin to top of feed' },
                  { key: 'is_featured', label: 'Feature in carousel' },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form[key]}
                      onChange={e => set(key, e.target.checked)}
                      style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Footer actions */}
            <div style={{
              display: 'flex', gap: 8, justifyContent: 'flex-end',
              padding: '12px 20px 16px',
              borderTop: '1px solid var(--border)',
              position: 'sticky', bottom: 0,
              background: 'var(--surface)',
            }}>
              <button className="btn btn-outline" onClick={() => handleSubmit(true)} disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Save size={14} strokeWidth={2} />
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button className="btn btn-primary" onClick={() => handleSubmit(false)} disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Send size={14} strokeWidth={2} />
                {saving ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── NewsPage ──────────────────────────────────────────────────────────────────
export default function NewsPage() {
  const { user } = useAuth()
  const isAdmin  = user?.role?.toLowerCase() === 'admin'

  const { items: newsItems, isRefreshing: itemsLoading } = useNewsItems()
  const { alerts, isRefreshing: alertsLoading }          = useEmergencyAlerts()
  const { spotlights, isRefreshing: spotsLoading }       = useBarangaySpotlights()

  const [category,   setCategory]   = useState('All')
  const [search,     setSearch]     = useState('')
  const [modalOpen,  setModalOpen]  = useState(false)
  const [barangays,  setBarangays]  = useState([])

  // Fetch barangays once when admin opens modal for the first time
  async function openModal() {
    if (barangays.length === 0) {
      try {
        const res = await api.get('/api/barangays/')
        setBarangays(res.data)
      } catch { /* ignore */ }
    }
    setModalOpen(true)
  }

  const filteredCount = useMemo(() => newsItems.filter(item => {
    const matchCat    = category === 'All' || item.category === category
    const q           = search.toLowerCase()
    const matchSearch = !q || item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) || (item.barangay || '').toLowerCase().includes(q)
    return matchCat && matchSearch
  }).length, [newsItems, category, search])

  const featuredItems = useMemo(() => newsItems.filter(i => i.is_featured), [newsItems])

  return (
    <DashboardLayout>
      <div className="page">

        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={22} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <h2 className="section-title" style={{ margin: 0, fontSize: 20 }}>News & Announcements</h2>
            </div>
            {isAdmin && (
              <button
                onClick={openModal}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 'var(--radius)',
                  background: 'var(--accent)', color: '#0d1117',
                  border: 'none', fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'var(--font-body)',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                <PlusCircle size={15} strokeWidth={2.5} />
                Create Post
              </button>
            )}
          </div>
          <p className="text-muted text-sm" style={{ margin: 0, paddingLeft: 30 }}>
            Stay updated with waste management activities and city advisories for Lucena City.
            {(itemsLoading || alertsLoading || spotsLoading) &&
              <span style={{ marginLeft: 8, color: 'var(--accent)' }}>Updating...</span>}
          </p>
        </div>

        <EmergencyAlertBanner alerts={alerts} />
        <FeaturedNewsCarousel items={featuredItems} />
        <NewsSearchBar value={search} onChange={setSearch}
          resultCount={search ? filteredCount : undefined} />
        <CategoryTabs active={category} onChange={setCategory} />
        <NewsFeed items={newsItems} category={category} search={search} />
        <div style={{ marginTop: 24 }}>
          <BarangaySpotlight items={spotlights} />
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <CreatePostModal
          barangays={barangays}
          onClose={() => setModalOpen(false)}
          onPublished={() => { /* optionally refetch newsItems here */ }}
        />
      )}
    </DashboardLayout>
  )
}