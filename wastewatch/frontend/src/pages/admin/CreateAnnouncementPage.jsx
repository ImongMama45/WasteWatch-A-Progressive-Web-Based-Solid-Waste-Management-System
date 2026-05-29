/**
 * CreateAnnouncementPage.jsx — Admin-only
 * -----------------------------------------
 * Route: /admin/news/create
 * Allows admins to create news posts, announcements, and emergency alerts.
 * Uses existing .form-group / .form-input / .form-label / .btn classes.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Megaphone, AlertTriangle, Newspaper, Send, Save, ArrowLeft, CheckCircle } from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import api from '../../api/client'

const TYPE_OPTIONS = [
  { value: 'announcement', label: 'Announcement',    Icon: Megaphone,     desc: 'Official LGU notices and advisories' },
  { value: 'news',         label: 'News Article',    Icon: Newspaper,     desc: 'Community news and updates' },
  { value: 'emergency',    label: 'Emergency Alert', Icon: AlertTriangle, desc: 'High-priority urgent alerts' },
]

const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High — Urgent' },
]

const CATEGORIES = ['General', 'Service Updates', 'Community', 'Rankings', 'Emergency']

const CSS = `
@keyframes cp-pop { 0%{transform:scale(0.92);opacity:0} 100%{transform:scale(1);opacity:1} }
.cp-type-card { transition: border-color .15s, background .15s, box-shadow .15s; cursor: pointer; }
.cp-type-card:hover { border-color: var(--accent) !important; }
.cp-type-card.selected { border-color: var(--accent) !important; background: rgba(46,204,113,.05) !important; box-shadow: 0 2px 10px rgba(46,204,113,.15); }
.cp-success { animation: cp-pop .25s ease; }
`
let _injected = false
function inject() { if (_injected) return; _injected = true; const e = document.createElement('style'); e.textContent = CSS; document.head.appendChild(e) }

export default function CreateAnnouncementPage() {
  inject()
  const navigate = useNavigate()
  const [barangays, setBarangays] = useState([])

  const [form, setForm] = useState({
    type: 'announcement',
    category: 'General',
    title: '',
    body: '',
    barangay: '',
    priority: 'medium',
    is_pinned: false,
    is_featured: false,
  })
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/api/barangays/').then(res => setBarangays(res.data))
  }, [])

  function set(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function handleSubmit(isDraft = false) {
    if (!form.title.trim() || !form.body.trim()) {
      alert('Title and content are required.')
      return
    }
    setSaving(true)
    try {
      const endpoint = form.type === 'emergency' ? '/api/news/alerts/' : '/api/news/items/'
      const payload = { 
        ...form, 
        is_active: !isDraft,
        description: form.body // Backend expects description
      }
      if (!payload.barangay) delete payload.barangay // Allow null/empty

      await api.post(endpoint, payload)
      setSaving(false)
      if (!isDraft) setSubmitted(true)
      else { alert('Draft saved.'); navigate('/announcements') }
    } catch (err) {
      console.error(err)
      alert('Failed to save post.')
      setSaving(false)
    }
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <DashboardLayout>
        <div className="page" style={{ maxWidth: 520 }}>
          <div className="card cp-success" style={{ textAlign: 'center', padding: '40px 28px' }}>
            <CheckCircle size={48} strokeWidth={1.5} style={{ color: 'var(--accent)', display: 'block', margin: '0 auto 16px' }} />
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>Post Published!</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
              Your {form.type} has been published to the News & Announcements page.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => navigate('/announcements')}>View Page</button>
              <button className="btn btn-outline" onClick={() => { setSubmitted(false); setForm(f => ({ ...f, title: '', body: '' })) }}>
                Create Another
              </button>
            </div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="page" style={{ maxWidth: 640 }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => navigate('/announcements')}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 13, fontWeight: 500,
              marginBottom: 12, fontFamily: 'var(--font-body)', padding: 0,
            }}
          >
            <ArrowLeft size={15} strokeWidth={2} />
            Back to News
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <Send size={20} strokeWidth={2} style={{ color: 'var(--accent)' }} />
            <h2 className="section-title" style={{ margin: 0, fontSize: 18 }}>Create Announcement</h2>
          </div>
          <p className="text-muted text-sm" style={{ margin: 0, paddingLeft: 28 }}>
            Publish news, announcements, or emergency alerts for Lucena City.
          </p>
        </div>

        {/* ── Type Selector ── */}
        <div className="card">
          <div className="form-label" style={{ marginBottom: 10 }}>Post Type</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {TYPE_OPTIONS.map(({ value, label, Icon, desc }) => (
              <div
                key={value}
                className={`cp-type-card ${form.type === value ? 'selected' : ''}`}
                onClick={() => set('type', value)}
                style={{
                  padding: '12px 10px', borderRadius: 'var(--radius)',
                  border: '1.5px solid var(--border)',
                  background: 'var(--bg)', textAlign: 'center',
                }}
              >
                <Icon size={20} strokeWidth={1.8} style={{
                  color: form.type === value ? 'var(--accent)' : 'var(--text-muted)',
                  display: 'block', margin: '0 auto 6px',
                }} />
                <div style={{ fontWeight: 700, fontSize: 12, color: form.type === value ? 'var(--text)' : 'var(--text-muted)', marginBottom: 3 }}>
                  {label}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.4 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Fields ── */}
        <div className="card">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              className="form-input"
              type="text"
              placeholder="Enter a clear, descriptive title..."
              value={form.title}
              onChange={e => set('title', e.target.value)}
              maxLength={120}
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
              {form.title.length}/120
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Content</label>
            <textarea
              className="form-input"
              placeholder="Write the full announcement or article content here..."
              value={form.body}
              onChange={e => set('body', e.target.value)}
              style={{ minHeight: 140, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Category</label>
              <select
                className="form-input"
                value={form.category}
                onChange={e => set('category', e.target.value)}
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Priority</label>
              <select
                className="form-input"
                value={form.priority}
                onChange={e => set('priority', e.target.value)}
              >
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
            <label className="form-label">Target Barangay (optional)</label>
            <select
              className="form-input"
              value={form.barangay}
              onChange={e => set('barangay', e.target.value)}
            >
              <option value="">City-Wide</option>
              {barangays.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Publish Options ── */}
        <div className="card">
          <div className="form-label" style={{ marginBottom: 12 }}>Publish Options</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { key: 'is_pinned',   label: 'Pin this post to the top of the feed' },
              { key: 'is_featured', label: 'Feature in the top carousel' },
            ].map(({ key, label }) => (
              <label key={key} style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => set(key, e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* ── Actions ── */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={() => handleSubmit(true)} disabled={saving}>
            <Save size={15} strokeWidth={2} />
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button className="btn btn-primary" onClick={() => handleSubmit(false)} disabled={saving}>
            <Send size={15} strokeWidth={2} />
            {saving ? 'Publishing...' : 'Publish'}
          </button>
        </div>

      </div>
    </DashboardLayout>
  )
}
