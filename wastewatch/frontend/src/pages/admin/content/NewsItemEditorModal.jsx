import { useState, useEffect, useRef } from 'react'
import { X, Upload, Trash2, Pin, Sparkles, MapPin, Check, FileText } from 'lucide-react'
import { useModal } from '../../../hooks/useModal'

const CATEGORIES = [
  'General',
  'Announcements',
  'News',
  'Service Updates',
  'Community',
  'Cleanup Drives',
  'Rankings',
  'Advisories',
  'Emergencies',
]

export default function NewsItemEditorModal({
  isOpen = false,
  item = null,
  barangays = [],
  onClose,
  onSave,
  saving = false,
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('announcement')
  const [category, setCategory] = useState('General')
  const [priority, setPriority] = useState('low')
  const [barangay, setBarangay] = useState('')
  const [isFeatured, setIsFeatured] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [description, setDescription] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [removeExistingImage, setRemoveExistingImage] = useState(false)
  const [errors, setErrors] = useState({})

  const fileInputRef = useRef(null)

  useModal(isOpen, onClose)

  useEffect(() => {
    if (item) {
      setTitle(item.title || '')
      setType(item.type || 'announcement')
      setCategory(item.category || 'General')
      setPriority(item.priority || 'low')
      setBarangay(item.barangay ? String(item.barangay) : '')
      setIsFeatured(Boolean(item.is_featured))
      setIsPinned(Boolean(item.is_pinned))
      setDescription(item.description || '')
      setImageFile(null)
      setImagePreview(item.image_url || null)
      setRemoveExistingImage(false)
    } else {
      setTitle('')
      setType('announcement')
      setCategory('General')
      setPriority('low')
      setBarangay('')
      setIsFeatured(false)
      setIsPinned(false)
      setDescription('')
      setImageFile(null)
      setImagePreview(null)
      setRemoveExistingImage(false)
    }
    setErrors({})
  }, [item, isOpen])

  if (!isOpen) return null

  const handleImageChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setImageFile(file)
      setImagePreview(URL.createObjectURL(file))
      setRemoveExistingImage(false)
    }
  }

  const handleClearImage = () => {
    setImageFile(null)
    setImagePreview(null)
    setRemoveExistingImage(true)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!title.trim()) {
      newErrors.title = 'Title is required'
    } else if (title.trim().length < 3) {
      newErrors.title = 'Title must be at least 3 characters'
    }

    if (!description.trim()) {
      newErrors.description = 'Notice content or description is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (targetStatus) => {
    if (!validate()) return

    const payload = {
      title: title.trim(),
      type,
      category,
      priority,
      barangay: barangay ? parseInt(barangay, 10) : null,
      is_featured: isFeatured,
      is_pinned: isPinned,
      description: description.trim(),
      status: targetStatus,
      is_active: targetStatus === 'published',
      imageFile,
      removeExistingImage,
    }

    onSave(payload, item?.id)
  }

  return (
    <div className="workspace-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="workspace-modal">
        {/* Header */}
        <div className="workspace-modal-header">
          <h2 id="editor-title" className="workspace-modal-title">
            {item ? 'Edit Notice or Article' : 'Create Official Announcement or News'}
          </h2>
          <button
            type="button"
            className="workspace-modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="workspace-modal-body">
          {/* Title */}
          <div className="form-group">
            <label className="form-label" htmlFor="content-title">
              Title <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              id="content-title"
              type="text"
              className="form-input"
              placeholder="e.g., Lucena City Solid Waste Reduction Guidelines"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-content-title"
            />
            {errors.title && (
              <span style={{ fontSize: '0.785rem', color: '#dc2626' }}>{errors.title}</span>
            )}
          </div>

          {/* Type, Category, Priority */}
          <div className="form-row-3">
            <div className="form-group">
              <label className="form-label" htmlFor="content-type">
                Content Type
              </label>
              <select
                id="content-type"
                className="form-select"
                value={type}
                onChange={(e) => setType(e.target.value)}
                data-testid="select-content-type"
              >
                <option value="announcement">Announcement</option>
                <option value="news">News Article</option>
                <option value="emergency">Emergency Notice</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="content-category">
                Category
              </label>
              <select
                id="content-category"
                className="form-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid="select-content-category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="content-priority">
                Priority
              </label>
              <select
                id="content-priority"
                className="form-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                data-testid="select-content-priority"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          {/* Scope and Flags */}
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="content-scope">
                Municipal Scope
              </label>
              <select
                id="content-scope"
                className="form-select"
                value={barangay}
                onChange={(e) => setBarangay(e.target.value)}
                data-testid="select-content-scope"
              >
                <option value="">City-Wide (All Lucena City)</option>
                <optgroup label="Barangays">
                  {(barangays || [])
                    .slice()
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Presentation Flags</label>
              <div className="form-switch-row" style={{ height: '42px', boxSizing: 'border-box' }}>
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    data-testid="checkbox-is-pinned"
                  />
                  <span>Pin to Top</span>
                </label>
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={isFeatured}
                    onChange={(e) => setIsFeatured(e.target.checked)}
                    data-testid="checkbox-is-featured"
                  />
                  <span>Featured Hero</span>
                </label>
              </div>
            </div>
          </div>

          {/* Cover Image Upload */}
          <div className="form-group">
            <label className="form-label">Cover Image (Optional)</label>
            {imagePreview ? (
              <div className="image-preview-box">
                <img src={imagePreview} alt="Cover Preview" />
                <button
                  type="button"
                  className="image-remove-btn"
                  onClick={handleClearImage}
                  title="Remove image"
                  aria-label="Remove image"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <div
                className="image-upload-zone"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={24} color="#94a3b8" style={{ marginBottom: '6px' }} />
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>
                  Click to select cover image
                </p>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  PNG, JPG, or WEBP up to 5MB
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageChange}
              data-testid="file-cover-image"
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label" htmlFor="content-description">
              Notice Content & Narrative <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              id="content-description"
              className="form-textarea"
              rows={6}
              placeholder="Provide detailed municipal information, operational guidelines, or schedules..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="textarea-content-description"
            />
            {errors.description && (
              <span style={{ fontSize: '0.785rem', color: '#dc2626' }}>{errors.description}</span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="workspace-modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-draft"
            onClick={() => handleSubmit('draft')}
            disabled={saving}
            data-testid="btn-save-draft"
          >
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button
            type="button"
            className="btn-publish"
            onClick={() => handleSubmit('published')}
            disabled={saving}
            data-testid="btn-save-publish"
          >
            {saving ? 'Publishing...' : 'Publish Notice'}
          </button>
        </div>
      </div>
    </div>
  )
}
