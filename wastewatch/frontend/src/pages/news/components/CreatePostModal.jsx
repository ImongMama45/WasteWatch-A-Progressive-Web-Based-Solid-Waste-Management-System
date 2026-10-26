/**
 * CreatePostModal.jsx
 * -------------------
 * Modal for creating announcements and emergency alerts.
 * Enforces file size limits (<5MB), correct payloads per endpoint,
 * and keyboard accessibility. Zero emojis.
 */

import { useState, useRef, useEffect } from 'react'
import {
  Send,
  X,
  CheckCircle,
  Image as ImageIcon,
  Megaphone,
  Newspaper,
  AlertTriangle,
} from 'lucide-react'
import api from '../../../api/client'
import { getApiErrorMessage } from '../../../utils/notificationHelpers'
import { useNotification } from '../../../context/NotificationContext'
import { NEWS_CATEGORIES } from '../utils/newsConfig'
import { useModal } from '../../../hooks/useModal'

const TYPE_OPTIONS = [
  { value: 'announcement', label: 'Announcement', Icon: Megaphone, desc: 'City advisories & updates' },
  { value: 'news', label: 'News', Icon: Newspaper, desc: 'Community features & reports' },
  { value: 'emergency', label: 'Emergency', Icon: AlertTriangle, desc: 'Critical immediate alerts' },
]

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low Priority' },
  { value: 'medium', label: 'Medium Priority' },
  { value: 'high', label: 'High Priority' },
]

const INITIAL_FORM = {
  type: 'announcement',
  title: '',
  body: '',
  category: 'Announcements',
  priority: 'low',
  barangay: '',
  is_pinned: false,
  is_featured: false,
}

export default function CreatePostModal({ barangays = [], onClose, onPublished }) {
  const [form, setForm] = useState(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef(null)
  const { notify } = useNotification()

  useModal(true, onClose)

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  function applyFile(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      notify({ variant: 'error-solid', message: 'Please select an image file.' })
      return
    }
    // Enforce 5MB limit
    if (file.size > 5 * 1024 * 1024) {
      notify({ variant: 'error-solid', message: 'Image must be smaller than 5MB.' })
      return
    }

    setImageFile(file)
    const reader = new FileReader()
    reader.onload = e => setImagePreview(e.target.result)
    reader.readAsDataURL(file)
  }

  function removeImage() {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit() {
    const trimmedTitle = form.title.trim()
    const trimmedBody = form.body.trim()

    if (!trimmedTitle || !trimmedBody) {
      notify({ variant: 'error-solid', message: 'Title and content are required.' })
      return
    }

    setSaving(true)
    try {
      if (form.type === 'emergency') {
        // EmergencyAlert endpoint expects JSON with title and body
        await api.post('/api/news/alerts/', {
          title: trimmedTitle,
          body: trimmedBody,
          is_active: true,
        })
      } else {
        // NewsItem endpoint expects FormData
        const fd = new FormData()
        fd.append('title', trimmedTitle)
        fd.append('description', trimmedBody)
        fd.append('type', form.type)
        fd.append('category', form.category)
        fd.append('priority', form.priority)
        fd.append('is_pinned', form.is_pinned)
        fd.append('is_featured', form.is_featured)
        fd.append('is_active', true)
        if (form.barangay) {
          fd.append('barangay', form.barangay)
        }
        if (imageFile) {
          fd.append('image', imageFile)
        }
        await api.post('/api/news/items/', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }

      setSaving(false)
      setSubmitted(true)
      notify({ variant: 'success', message: `${form.type === 'emergency' ? 'Alert' : 'Post'} published successfully.` })
      onPublished?.(form.type)
    } catch (err) {
      console.error('Publish error:', err)
      notify({ variant: 'error-dark', message: getApiErrorMessage(err, 'Failed to publish post.') })
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={e => e.target === e.currentTarget && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 580,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border)',
        }}
      >
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '48px 32px' }}>
            <CheckCircle
              size={48}
              strokeWidth={1.5}
              style={{ color: 'var(--accent)', display: 'block', margin: '0 auto 16px' }}
            />
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6, color: 'var(--text)' }}>
              Published!
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
              Your {form.type} is now live.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
              <button
                className="btn btn-outline"
                onClick={() => {
                  setSubmitted(false)
                  setForm(INITIAL_FORM)
                  removeImage()
                }}
              >
                Create Another
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '18px 20px 14px',
                borderBottom: '1px solid var(--border)',
                position: 'sticky',
                top: 0,
                background: 'var(--surface)',
                zIndex: 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Send size={18} strokeWidth={2} style={{ color: 'var(--accent)' }} />
                <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                  Create Announcement
                </span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 4,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Form Body */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Type Selector */}
              <div>
                <div className="form-label" style={{ marginBottom: 8 }}>Post Type</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {TYPE_OPTIONS.map(({ value, label, Icon, desc }) => {
                    const isSelected = form.type === value
                    return (
                      <div
                        key={value}
                        onClick={() => set('type', value)}
                        style={{
                          padding: '10px 8px',
                          borderRadius: 'var(--radius)',
                          border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                          background: isSelected ? 'rgba(46,204,113,.06)' : 'var(--bg)',
                          textAlign: 'center',
                          cursor: 'pointer',
                          transition: 'border-color .15s, background .15s',
                        }}
                      >
                        <Icon
                          size={18}
                          strokeWidth={1.8}
                          style={{
                            color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                            display: 'block',
                            margin: '0 auto 5px',
                          }}
                        />
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 11,
                            color: isSelected ? 'var(--text)' : 'var(--text-muted)',
                            marginBottom: 2,
                          }}
                        >
                          {label}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                          {desc}
                        </div>
                      </div>
                    )
                  })}
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

              {/* Content */}
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

              {/* Cover Image (Only for non-emergency items) */}
              {form.type !== 'emergency' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ImageIcon size={13} strokeWidth={2} style={{ color: 'var(--text-muted)' }} />
                    Cover Image
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                      (optional, max 5MB)
                    </span>
                  </label>
                  {imagePreview ? (
                    <div
                      style={{
                        position: 'relative',
                        borderRadius: 'var(--radius)',
                        overflow: 'hidden',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <img
                        src={imagePreview}
                        alt="Preview"
                        style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }}
                      />
                      <button
                        onClick={removeImage}
                        aria-label="Remove image"
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          background: 'rgba(0,0,0,.55)',
                          border: 'none',
                          borderRadius: '50%',
                          width: 26,
                          height: 26,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: '#fff',
                        }}
                      >
                        <X size={13} strokeWidth={2.5} />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => {
                        e.preventDefault()
                        setDragging(true)
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={e => {
                        e.preventDefault()
                        setDragging(false)
                        applyFile(e.dataTransfer.files[0])
                      }}
                      style={{
                        border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius)',
                        padding: '16px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: dragging ? 'rgba(46,204,113,.04)' : 'transparent',
                        transition: 'border-color .15s',
                      }}
                    >
                      <ImageIcon
                        size={22}
                        strokeWidth={1.5}
                        style={{ color: 'var(--text-muted)', display: 'block', margin: '0 auto 6px' }}
                      />
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Drag & drop or <span style={{ color: 'var(--accent)', fontWeight: 600 }}>browse</span>
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => applyFile(e.target.files[0])}
                  />
                </div>
              )}

              {/* Category + Priority (Only for non-emergency items) */}
              {form.type !== 'emergency' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Category</label>
                    <select
                      className="form-input"
                      value={form.category}
                      onChange={e => set('category', e.target.value)}
                    >
                      {NEWS_CATEGORIES.map(c => (
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
              )}

              {/* Barangay Target (Only for non-emergency items) */}
              {form.type !== 'emergency' && (
                <div className="form-group" style={{ margin: 0 }}>
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
              )}

              {/* Checkboxes (Only for non-emergency items) */}
              {form.type !== 'emergency' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { key: 'is_pinned', label: 'Pin to top of feed' },
                    { key: 'is_featured', label: 'Feature in carousel' },
                  ].map(({ key, label }) => (
                    <label
                      key={key}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={form[key]}
                        onChange={e => set(key, e.target.checked)}
                        style={{
                          width: 15,
                          height: 15,
                          accentColor: 'var(--accent)',
                          cursor: 'pointer',
                        }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Footer actions - Draft button removed */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                padding: '12px 20px 16px',
                borderTop: '1px solid var(--border)',
                position: 'sticky',
                bottom: 0,
                background: 'var(--surface)',
              }}
            >
              <button
                type="button"
                className="btn btn-outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
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
